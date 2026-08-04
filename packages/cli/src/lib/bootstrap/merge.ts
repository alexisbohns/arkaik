/**
 * Deterministic fragment assembly.
 *
 * Everything an agent must not have to think about lives here: ID uniqueness
 * across independently-written fragments, edge endpoint resolution, the
 * `node.created`/`node.status_changed`/`decision.status_changed` events the
 * validator requires, the reconcile ops, journal order and de-duplication.
 *
 * Two rules shape the whole file:
 *  - **Bootstrap never deletes.** `retire` sets `status: archived` and records
 *    a reason; `update`'s `metadata` deep-merges rather than replacing it
 *    wholesale. Removal stays a human act, which is what makes re-runs safe.
 *  - **Merging is pure.** Same fragments and same base state in, byte-identical
 *    bundle and journal out — hence `deterministicEventId` rather than a
 *    random ULID, and hence the de-duplicating merge in `./journal-merge`.
 *
 * The journal algebra — event keys, order-sensitivity, and the
 * de-duplicating merge itself — lives in `./journal-merge`, a zero-import
 * module with its own direct tests (`tests/cli/bootstrap-journal-merge.test.js`).
 *
 * This file (and `./journal-merge`) went through several review rounds
 * before landing on this shape. The full defect-by-defect history — what the
 * plan's original reference code got wrong, what each round reproduced and
 * fixed, and why — lives in docs/superpowers/plans/2026-08-04-bootstrap-method.md,
 * Task 6. Read that before changing this file's behavior; the comments here
 * explain what the code does, not the story of how it got here.
 *
 * Loading the base bundle and its journal (including a base bundle that
 * happens to carry an EMBEDDED `journal[]` rather than only a sidecar — the
 * interchange projection shape, docs/spec/journal.md) is the caller's job;
 * see `runMerge` in ../../commands/bootstrap.ts, which also runs
 * `validateBundle` over the result before writing anything.
 */
import { edgeId } from "@arkaik/schema";

import { deterministicEventId } from "./event-id";
import type { LoadedFragment } from "./fragments";
import { eventKey, isOrderSensitive, mergeJournal, type AnyRecord } from "./journal-merge";

export interface MergeProblem {
  unit: string;
  message: string;
}

export interface MergeResult {
  bundle: Record<string, unknown>;
  journal: Array<Record<string, unknown>>;
  errors: MergeProblem[];
  counts: { nodesAdded: number; nodesUpdated: number; nodesRetired: number; edgesAdded: number; eventsAdded: number };
}

function asArray(value: unknown): AnyRecord[] {
  return Array.isArray(value) ? (value as AnyRecord[]) : [];
}

export interface MergeInput {
  base: AnyRecord;
  baseJournal: readonly AnyRecord[];
  fragments: readonly LoadedFragment[];
  /** Fallback `node.created`/`node.status_changed`/`decision.status_changed` timestamp when a fragment supplies no ts of its own. */
  fallbackTs: string;
}

export function mergeFragments(input: MergeInput): MergeResult {
  const errors: MergeProblem[] = [];
  const projectId = String((input.base.project as AnyRecord | undefined)?.id ?? "");

  const nodes = new Map<string, AnyRecord>();
  // Seeded for every base node too — not just nodes added during this run —
  // so an id collision is caught whether the existing node came from an
  // earlier fragment in THIS run or was already persisted before this run
  // started. The sentinel label only ever surfaces inside an error message.
  const nodeOrigin = new Map<string, string>();
  for (const node of asArray(input.base.nodes)) {
    const id = String(node.id);
    nodes.set(id, { ...node });
    nodeOrigin.set(id, "(already in the bundle)");
  }

  const edges = new Map<string, AnyRecord>();
  const edgeOrigin = new Map<string, string>();
  for (const edge of asArray(input.base.edges)) {
    const id = String(edge.id ?? edgeId(String(edge.source_id), String(edge.target_id)));
    edges.set(id, { ...edge });
    edgeOrigin.set(id, "(already in the bundle)");
  }

  const newEvents: AnyRecord[] = [];
  const counts = { nodesAdded: 0, nodesUpdated: 0, nodesRetired: 0, edgesAdded: 0, eventsAdded: 0 };

  // Tracks, per (type, node_id, ts), one order-sensitive event already seen —
  // seeded from the base journal too, so a fresh event colliding with
  // committed history is caught, not just fresh-vs-fresh within this run.
  // Compares on `to`, not `id`: `crossCheckJournal` reads exactly one field
  // off these events for its "last one wins" comparison — `to` — so two
  // events at the identical ts that agree on `to` are interchangeable for
  // every check that reads them, whatever their `id` or `from` say. This
  // matters concretely for brownfield: a real ULID already in the base
  // journal (written by `arkaik log`) and a wave-3 fragment mining the same
  // PR into the identical transition at the identical ts get DIFFERENT ids
  // (one's a real ULID, one's deterministic) but the SAME `to` — refusing
  // that pair would be a false positive, and the fix it would have
  // suggested ("give one a distinct timestamp") would be actively wrong
  // advice: it would append a duplicate transition to an append-only
  // journal. Only a genuine `to` disagreement at the same instant is refused
  // — that's the one case where read-back order (undefined, since
  // `orderEvents` ties-breaks same-ts events by a hash-derived id with no
  // relationship to causality) actually decides which status the snapshot
  // must agree with.
  const orderSensitiveSeen = new Map<string, { unit: string; from: unknown; to: unknown }>();
  for (const ev of input.baseJournal) {
    if (!isOrderSensitive(ev)) continue;
    const key = `${String(ev.type)}:${String(ev.node_id ?? "")}:${String(ev.ts ?? "")}`;
    if (!orderSensitiveSeen.has(key)) {
      orderSensitiveSeen.set(key, { unit: "(already in the journal)", from: ev.from, to: ev.to });
    }
  }
  // Which unit produced each fresh event's id — so a payload-divergence
  // conflict (surfaced after mergeJournal runs, below) can be attributed to
  // the unit that produced it.
  const eventUnit = new Map<string, string>();

  /**
   * The single path every new event reaches `newEvents` through. See the
   * `orderSensitiveSeen` comment above for the refusal criterion.
   */
  const pushEvent = (unitId: string, ev: AnyRecord): void => {
    if (isOrderSensitive(ev)) {
      const nodeId = String(ev.node_id ?? "");
      const key = `${String(ev.type)}:${nodeId}:${String(ev.ts ?? "")}`;
      const existing = orderSensitiveSeen.get(key);
      if (existing && String(existing.to) !== String(ev.to)) {
        errors.push({
          unit: unitId,
          message:
            `two \`${String(ev.type)}\` events for node \`${nodeId}\` land at the identical ts ${String(ev.ts)} but ` +
            `disagree on the outcome — ${JSON.stringify(existing.from)} -> ${JSON.stringify(existing.to)} (from ` +
            `${existing.unit}) vs ${JSON.stringify(ev.from)} -> ${JSON.stringify(ev.to)} (from ${unitId}). ` +
            "crossCheckJournal reads only the LAST such event's `to` per node, and read-back order between events " +
            "sharing one ts is not guaranteed to match write order — give one of them a distinct timestamp " +
            "(`update`/`retire`: `changed_ts`; wave-3 `events`: `ts`) and re-run.",
        });
        return;
      }
      if (!existing) {
        orderSensitiveSeen.set(key, { unit: unitId, from: ev.from, to: ev.to });
      }
      // `to` agrees (or this is the first sighting): accept quietly, even if
      // `id` or `from` differ — see the comment above for why that's safe.
    }
    eventUnit.set(String(ev.id), unitId);
    newEvents.push(ev);
  };

  const mintEvent = (
    unitId: string,
    ts: string,
    payload: AnyRecord,
    onFail: string,
  ): void => {
    try {
      const id = deterministicEventId(ts, eventKey(payload, ts));
      pushEvent(unitId, { id, ts, actor: "bootstrap", ...payload });
    } catch (err) {
      errors.push({ unit: unitId, message: `${onFail}: ${err instanceof Error ? err.message : String(err)}` });
    }
  };

  // --- pass 1: nodes (every fragment, so edges in pass 2 can see all of them)
  for (const { unit, fragment } of input.fragments) {
    for (const raw of [...(fragment.nodes ?? []), ...(fragment.add ?? [])]) {
      const id = String(raw.id ?? "");
      if (!id) {
        errors.push({ unit: unit.id, message: "a node has no id" });
        continue;
      }
      const { created_ts: createdTs, ...node } = raw;
      // @arkaik/schema's zod NodeSchema requires `platforms` unconditionally,
      // even on decision nodes (which validateBundle itself exempts from the
      // non-empty check) — default rather than let a schema-only rejection
      // surface far from where it was introduced.
      if (!Array.isArray(node.platforms)) node.platforms = [];

      if (nodes.has(id)) {
        const existingTitle = String(nodes.get(id)?.title ?? "");
        const incomingTitle = String(node.title ?? "");
        // `nodeOrigin` always has an entry here: every id that reaches
        // `nodes.has(id) === true` was either seeded from base (with the
        // sentinel label above) or recorded below when added earlier in this
        // run.
        const owner = nodeOrigin.get(id) as string;
        if (existingTitle !== incomingTitle) {
          // Two agents minted the same id for different things. Never union
          // them silently — print both titles and both origins, fail the merge.
          errors.push({
            unit: unit.id,
            message: `id collision on \`${id}\`: "${existingTitle}" (from ${owner}) vs "${incomingTitle}" (from ${unit.id})`,
          });
        }
        continue;
      }
      nodes.set(id, { ...node, id, project_id: projectId });
      nodeOrigin.set(id, unit.id);
      counts.nodesAdded += 1;

      const ts = typeof createdTs === "string" && createdTs ? createdTs : input.fallbackTs;
      mintEvent(
        unit.id,
        ts,
        { type: "node.created", node_id: id, species: node.species, title: node.title },
        `cannot mint a node.created event for \`${id}\` (ts ${JSON.stringify(ts)})`,
      );
    }

    for (const patch of fragment.update ?? []) {
      const id = String(patch.id ?? "");
      const target = nodes.get(id);
      if (!target) {
        errors.push({ unit: unit.id, message: `update targets unknown node \`${id}\`` });
        continue;
      }
      const fromStatus = target.status;
      const existingMetadata = (target.metadata as AnyRecord | undefined) ?? {};
      // crossCheckJournal defaults an absent metadata.decision_status to
      // "proposed" (journal.ts's snapshotDecisionStatus) — mirror that
      // default here so "absent -> proposed" registers as no change, and so
      // any emitted event below carries the same value crossCheckJournal
      // will actually compare against.
      const fromDecisionStatus = String(existingMetadata.decision_status ?? "proposed");

      const rawPatch = (patch.patch ?? {}) as AnyRecord;
      const { metadata: patchMetadata, ...restPatch } = rawPatch;
      Object.assign(target, restPatch, { id, project_id: projectId });
      // `metadata` deep-merges rather than replacing wholesale. `Object.assign`
      // is shallow — a patch that only wants to touch ONE metadata field (a
      // single ref, or decision_status) used to silently erase every other one
      // (refs, playlist, decision context, product membership, ...) with no
      // error and no signal: reproduced as base `{"refs":[...],"note":"keep
      // me"}` + patch `{"metadata":{"note2":"added"}}` => result `{"note2":
      // "added"}`, everything else gone. Contradicts this file's own "bootstrap
      // never deletes" rule, and was inconsistent with `retire` a few lines
      // below, which already merges correctly.
      if (patchMetadata !== undefined && typeof patchMetadata === "object" && patchMetadata !== null) {
        target.metadata = { ...existingMetadata, ...(patchMetadata as AnyRecord) };
      }
      counts.nodesUpdated += 1;

      // A patch that changes `status` must leave a node.status_changed event
      // behind it, or a node with any prior status history fails arkaik
      // validate's journal-status-mismatch the moment this merge's snapshot
      // disagrees with the journal's last recorded transition.
      const toStatus = target.status;
      if (Object.prototype.hasOwnProperty.call(rawPatch, "status") && toStatus !== fromStatus) {
        const ts = typeof patch.changed_ts === "string" && patch.changed_ts ? patch.changed_ts : input.fallbackTs;
        mintEvent(
          unit.id,
          ts,
          { type: "node.status_changed", node_id: id, from: fromStatus, to: toStatus },
          `cannot mint a node.status_changed event for \`${id}\` (ts ${JSON.stringify(ts)})`,
        );
      }

      // Exactly the symmetric hole for decisions: journal-decision-status-
      // mismatch compares the journal's last decision.status_changed.to
      // against metadata.decision_status the same way journal-status-mismatch
      // compares node.status_changed against status. A patch that legitimately
      // advances a decision (proposed -> accepted, etc.) must mint this event
      // too, or it merges cleanly and fails validate the moment that decision
      // already has prior decision-status history — reproduced exactly the
      // same way item 4 above was.
      const finalMetadata = (target.metadata as AnyRecord | undefined) ?? {};
      const toDecisionStatus = String(finalMetadata.decision_status ?? "proposed");
      const patchTouchesDecisionStatus =
        patchMetadata !== undefined &&
        typeof patchMetadata === "object" &&
        patchMetadata !== null &&
        Object.prototype.hasOwnProperty.call(patchMetadata as AnyRecord, "decision_status");
      if (patchTouchesDecisionStatus && toDecisionStatus !== fromDecisionStatus) {
        const ts = typeof patch.changed_ts === "string" && patch.changed_ts ? patch.changed_ts : input.fallbackTs;
        mintEvent(
          unit.id,
          ts,
          { type: "decision.status_changed", node_id: id, from: fromDecisionStatus, to: toDecisionStatus },
          `cannot mint a decision.status_changed event for \`${id}\` (ts ${JSON.stringify(ts)})`,
        );
      }
    }

    for (const retire of fragment.retire ?? []) {
      const id = String(retire.id ?? "");
      const target = nodes.get(id);
      if (!target) {
        errors.push({ unit: unit.id, message: `retire targets unknown node \`${id}\`` });
        continue;
      }
      const fromStatus = target.status;
      // Never a delete: archived, with the reason kept on the node.
      target.status = "archived";
      const metadata = (target.metadata as AnyRecord | undefined) ?? {};
      target.metadata = { ...metadata, retired_reason: retire.reason };
      counts.nodesRetired += 1;

      if (fromStatus !== "archived") {
        const ts = typeof retire.changed_ts === "string" && retire.changed_ts ? retire.changed_ts : input.fallbackTs;
        mintEvent(
          unit.id,
          ts,
          { type: "node.status_changed", node_id: id, from: fromStatus, to: "archived" },
          `cannot mint a node.status_changed event for \`${id}\` (retire, ts ${JSON.stringify(ts)})`,
        );
      }
    }
  }

  // --- pass 2: edges, now that every node id is known
  for (const { unit, fragment } of input.fragments) {
    for (const raw of fragment.edges ?? []) {
      const source = String(raw.source_id ?? "");
      const target = String(raw.target_id ?? "");
      if (!nodes.has(source) || !nodes.has(target)) {
        errors.push({
          unit: unit.id,
          message: `edge ${source} -> ${target} references ${!nodes.has(source) ? source : target}, which no fragment created`,
        });
        continue;
      }
      // `FragmentEdge.kind` is the agent-facing field name for the edge
      // type; the bundle schema's field is `edge_type` (EdgeSchema,
      // validate.ts's `valid-edge-type` check). Translate rather than ask
      // agents to spell the bundle's own internal field name.
      const kindValue = raw.kind;
      const edgeTypeValue = raw.edge_type;
      const resolvedType = typeof edgeTypeValue === "string" ? edgeTypeValue : typeof kindValue === "string" ? kindValue : undefined;
      if (!resolvedType) {
        errors.push({ unit: unit.id, message: `edge ${source} -> ${target} has no \`kind\` (its edge type)` });
        continue;
      }
      const id = edgeId(source, target);
      if (edges.has(id)) {
        // An edge id encodes only its endpoints (`e-{source}-{target}`), so
        // it can hold exactly one type — two fragments disagreeing on that
        // type is a real modeling conflict, not a re-declaration, and the
        // second one silently losing would be indistinguishable from
        // agreement. Mirrors the node-id-collision-on-title-mismatch error
        // above.
        const existingType = String(edges.get(id)?.edge_type ?? "");
        const owner = edgeOrigin.get(id) as string;
        if (existingType !== resolvedType) {
          errors.push({
            unit: unit.id,
            message:
              `edge ${source} -> ${target} disagrees on type: "${existingType}" (from ${owner}) vs "${resolvedType}" ` +
              `(from ${unit.id}) — an edge id encodes only its endpoints, so it can hold exactly one type.`,
          });
        }
        continue;
      }
      const edge: AnyRecord = { ...raw, id, project_id: projectId, source_id: source, target_id: target, edge_type: resolvedType };
      delete edge.kind;
      edges.set(id, edge);
      edgeOrigin.set(id, unit.id);
      counts.edgesAdded += 1;
    }
  }

  // --- pass 3: story events
  for (const { unit, fragment } of input.fragments) {
    for (const raw of fragment.events ?? []) {
      const type = String(raw.type ?? "");
      const ts = String(raw.ts ?? "");
      if (!type || !ts) {
        errors.push({ unit: unit.id, message: "an event is missing `type` or `ts`" });
        continue;
      }
      if (typeof raw.id === "string" && raw.id) {
        // A fragment-supplied id is honored as-is and NOT validated against
        // eventKey/deterministicEventId — an agent that hand-mints an id
        // (e.g. re-using a real ULID already in the corpus) is trusted to
        // have done so correctly; this only affects that one event's own
        // identity, and mergeJournal's de-dup/conflict logic treats it like
        // any other id either way.
        pushEvent(unit.id, { ...raw, id: raw.id, ts, type });
        continue;
      }
      try {
        const id = deterministicEventId(ts, eventKey(raw, ts));
        pushEvent(unit.id, { ...raw, id, ts, type });
      } catch (err) {
        errors.push({ unit: unit.id, message: `cannot mint an id for a \`${type}\` event: ${err instanceof Error ? err.message : String(err)}` });
      }
    }
  }

  // Existing history is preserved verbatim (base's copy wins on an id
  // collision, e.g. a re-run); new events are merged in and the whole file
  // is written in ts order. Nothing is ever rewritten or dropped.
  const { journal, added, conflicts } = mergeJournal(input.baseJournal, newEvents);
  counts.eventsAdded = added;

  // A fresh event sharing an id with a committed one, but carrying different
  // content, is a real divergence — base still wins (nothing is silently
  // overwritten), but the run refuses rather than making that divergence
  // indistinguishable from "nothing changed".
  for (const conflict of conflicts) {
    // `eventUnit` always has an entry here: mergeJournal only reports a
    // conflict for an id present in `fresh`, and every event in `fresh` was
    // pushed via `pushEvent`, which always records it.
    const unitId = eventUnit.get(conflict.id) as string;
    errors.push({
      unit: unitId,
      message:
        `event \`${conflict.id}\` already exists in the journal with different content — the committed copy ` +
        `always wins, but this looks like a real correction, not a harmless re-run. Committed: ` +
        `${JSON.stringify(conflict.base)}. Freshly derived: ${JSON.stringify(conflict.fresh)}. merge never ` +
        "rewrites committed history — correct the committed event by hand (or via `arkaik log`) if it's wrong.",
    });
  }

  const bundle: AnyRecord = {
    ...input.base,
    nodes: [...nodes.values()],
    edges: [...edges.values()],
  };
  // The repo's own bundle is sidecar-only (docs/spec/journal.md: "In a
  // repository (Kommit mode), the journal is a sidecar file next to the
  // snapshot — never inside it"). `journal` above is the full merged history
  // and is written to the sidecar by the caller; an embedded copy would be a
  // second, instantly-stale source of truth.
  delete bundle.journal;

  return { bundle, journal, errors, counts };
}
