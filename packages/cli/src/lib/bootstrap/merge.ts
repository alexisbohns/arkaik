/**
 * Deterministic fragment assembly.
 *
 * Everything an agent must not have to think about lives here: ID uniqueness
 * across independently-written fragments, edge endpoint resolution, the
 * `node.created`/`node.status_changed` events the validator requires, the
 * reconcile ops, journal order and de-duplication.
 *
 * Two rules shape the whole file:
 *  - **Bootstrap never deletes.** `retire` sets `status: archived` and records
 *    a reason; removal stays a human act, which is what makes re-runs safe.
 *  - **Merging is pure.** Same fragments and same base state in, byte-identical
 *    bundle and journal out — hence `deterministicEventId` rather than a
 *    random ULID, and hence the journal de-duplication below.
 *
 * This file was rewritten from the plan's reference code, not transcribed —
 * the plan's own carry-forward review (docs/superpowers/plans/
 * 2026-08-04-bootstrap-method.md, Task 6) found three defects in that
 * reference before a line of it ran, and this task's own probing found more.
 * What follows is what changed and why:
 *
 * 1. **Journal de-duplication.** The reference concatenated `baseJournal` and
 *    freshly-derived events and sorted — with no de-dup. Since
 *    `deterministicEventId` gives the SAME event the SAME id every run, a
 *    second `merge` over unchanged story fragments (`events` arrays) would
 *    re-push every one of them, doubling the journal on every re-run. (Pass
 *    1's `node.created` synthesis dodges this only because it checks
 *    `nodes.has(id)` first — a guard the `events` path never had.) Fixed:
 *    {@link mergeJournal} merges by `id`, base's copy winning on a collision,
 *    counting only genuinely-new ids toward `counts.eventsAdded`.
 * 2. **`deterministicEventId` now throws on an unparseable/missing `ts`**
 *    (event-id.ts, probe 4) instead of silently encoding epoch 0. Every call
 *    site below is wrapped in try/catch and reports a `MergeProblem` naming
 *    the unit and the bad `ts`, rather than letting one malformed fragment
 *    crash the whole merge with an uncaught exception.
 * 3. **The event key now actually distinguishes events.** The reference's
 *    wave-3 key (`${type}:${node_id ?? deliverable_id ?? version ?? ""}:
 *    ${ts}`) collided for real: an `idea.proposed`/`request.filed` with no
 *    `node_id` collapsed to `type::ts` (every such event on a day collides,
 *    by construction, since neither field is required); `release.tagged`
 *    omitted `platform` (two same-day per-platform releases collide); and
 *    `node.status_changed`/`decision.status_changed` keyed on `node_id` +
 *    `ts` alone, colliding whenever a node crosses two statuses on one day —
 *    exactly what the wave-3 "status arcs" unit plans to emit (1-3 events per
 *    node). {@link eventKey} below folds in every identifying field a known
 *    event type carries (platform, from/to, edge/ref ids, title) when
 *    present, closing all three.
 * 4. **Retire and update now emit `node.status_changed`.** Neither did in the
 *    reference: `retire` set `status: archived` and `update` could patch
 *    `status`, both by direct mutation, with no journal event. Verified
 *    against the real validator (not just by reading): `crossCheckJournal`'s
 *    `journal-status-mismatch` only fires when a node ALREADY has at least
 *    one recorded `node.status_changed` (it compares the journal's LAST
 *    recorded status against the snapshot; a node with none has no "last" to
 *    disagree with) — so this bug was silent for a node's first-ever status
 *    change but loud for every subsequent one, which is exactly the
 *    brownfield reconcile shape: an existing map's nodes typically already
 *    carry real status history. Fixed: both ops record the node's status
 *    before mutating it and, when it actually changed, emit a
 *    `node.status_changed` (`actor: "bootstrap"`, `from`/`to`) at the
 *    fragment's own `changed_ts` when supplied, else the merge's fallback ts.
 * 5. **Node id collisions are now caught across merge runs, not just within
 *    one.** The reference only recorded an added node's originating unit in
 *    `nodeOrigin`; a base node (already in the bundle before this run — from
 *    a prior merge, or pre-existing brownfield content) had no origin
 *    recorded, so `if (owner && ...)` was false whenever `owner` was
 *    `undefined` — silently skipping collision detection for anything
 *    already persisted. Reproduced: run 1 adds node X titled "Foo"; a LATER,
 *    unrelated fragment (a different area's agent, re-run weeks later)
 *    declares X with title "Bar" — the reference discarded "Bar" with zero
 *    error. Fixed: base nodes are seeded into `nodeOrigin` too, so the same
 *    "same id, different title" check now runs whether the existing node
 *    came from this run's earlier fragments or from before this run started.
 *    Re-declaring a node with an id AND title that already match (the
 *    ordinary idempotent-rerun case) is still accepted silently — only a
 *    genuine content mismatch errors.
 * 6. **`platforms` defaults to `[]` on every added node that omits it.**
 *    `validateBundle` already errors on a missing/empty `platforms` for every
 *    non-decision species, so this changes nothing there. But
 *    `@arkaik/schema`'s zod `NodeSchema` requires `platforms` unconditionally
 *    — including on `decision` nodes, which `validateBundle` deliberately
 *    exempts from the non-empty check (decisions are platform-agnostic by
 *    spec). A decision fragment that omits `platforms` entirely would pass
 *    `arkaik validate` but fail `parseBundle`'s stricter shape check. `[]` is
 *    exactly the right value for a platform-agnostic species, so defaulting
 *    it closes that parity gap for free.
 * 7. **Same-`ts` order-sensitive events for one node are now refused, not
 *    written with an arbitrary order.** Found by a coordinator review of this
 *    file after (4)/(3) above shipped, and worse than theoretical: `update`/
 *    `retire` share ONE `fallbackTs` across a whole run when a fragment omits
 *    `changed_ts`, so two status changes to one node in a single run get
 *    IDENTICAL `ts`; separately, item 3's own regression fixture (two
 *    `node.status_changed` events for one node, same `ts`, different
 *    `from`/`to`) produces distinct ids — correct per item 3 — but
 *    `sortEvents` below ties-breaks same-`ts` events by that hash-derived
 *    `id`, which bears NO relationship to which transition actually happened
 *    first. It doesn't matter what order this file writes to disk: on every
 *    READ, `crossCheckJournal` re-derives order independently via
 *    `@arkaik/schema`'s `orderEvents`, using the identical (ts, id) rule —
 *    so whether the snapshot ends up agreeing with the journal's "last"
 *    status came down to whether a hash happened to agree with causality.
 *    Reproduced: a node `idea -> backlog -> development` via two `update`
 *    patches with no `changed_ts` merges cleanly, then `arkaik validate`
 *    fails `journal-status-mismatch` depending on hash luck. **Fixed, by
 *    refusing rather than guessing:** {@link isOrderSensitive} identifies the
 *    two event types `crossCheckJournal` actually orders by "last one wins"
 *    per node (`node.status_changed` when not platform-scoped, and
 *    `decision.status_changed`); {@link pushEvent} tracks the one already
 *    seen for each `(type, node_id, ts)` and, on a SECOND, genuinely
 *    different one (a different id — i.e. a different from/to) at the exact
 *    same instant, raises a `MergeProblem` naming the node, both
 *    transitions, and both units, instead of writing an order nobody chose.
 *    A resort inside this file could not fix this even if it wanted to,
 *    since `orderEvents` re-derives order on every read regardless of what
 *    order the file was written in — the real fix is distinct timestamps,
 *    and the corpus already carries full-instant merge timestamps for a
 *    story agent to use. The identical event twice (same id — an idempotent
 *    re-run) is not a conflict; it just doesn't advance what's "seen".
 * 8. **`mergeJournal`'s "base wins" precedence is correct but was silently
 *    wrong-ergonomic on genuine divergence.** Base winning on an id collision
 *    is the right call — the append-only-journal invariant, and because
 *    "fresh wins" would let a re-run silently clobber a deliberate,
 *    out-of-band correction to a committed journal, which is worse. But it
 *    was entirely silent even when the fresh event's PAYLOAD actually
 *    differs from what's committed (e.g. a fragment corrects a
 *    `deliverable.shipped`'s `summary`, unrelated to `eventKey`, and
 *    re-runs): `+0 events`, journal unchanged, the correction discarded with
 *    output indistinguishable from "nothing changed." **Fixed:** when a
 *    fresh event shares an `id` with a base event but the two payloads
 *    differ (compared key-order-independently via {@link canonicalJson}),
 *    `mergeJournal` reports the collision and `mergeFragments` raises a
 *    `MergeProblem` for it — the same treatment already given to a node-id
 *    collision with differing titles. Base still wins (nothing is
 *    overwritten silently), but the run refuses instead of hiding the
 *    divergence; correcting committed history is a deliberate, out-of-band
 *    act (e.g. `arkaik log`), not something `merge` does implicitly.
 *    Identical payloads (the ordinary idempotent re-run) stay a silent no-op.
 *
 * Loading the base bundle and its journal (including the fix for a base
 * bundle that happens to carry an EMBEDDED `journal[]` rather than only a
 * sidecar — the interchange projection shape, docs/spec/journal.md) is the
 * caller's job; see `runMerge` in ../../commands/bootstrap.ts.
 */
import { edgeId } from "@arkaik/schema";

import { deterministicEventId } from "./event-id";
import type { LoadedFragment } from "./fragments";

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

type AnyRecord = Record<string, unknown>;

function asArray(value: unknown): AnyRecord[] {
  return Array.isArray(value) ? (value as AnyRecord[]) : [];
}

/** Sort events by ts, then id — the same total order `@arkaik/schema`'s `orderEvents` gives. */
function sortEvents(events: AnyRecord[]): AnyRecord[] {
  return [...events].sort((a, b) => {
    const at = String(a.ts ?? "");
    const bt = String(b.ts ?? "");
    if (at !== bt) return at < bt ? -1 : 1;
    const ai = String(a.id ?? "");
    const bi = String(b.id ?? "");
    return ai < bi ? -1 : ai > bi ? 1 : 0;
  });
}

/** `JSON.stringify` for non-string values, so an object/array/number payload field still yields a stable, comparable string. */
function stringify(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

/**
 * Key-order-independent JSON serialization, for comparing two event objects
 * by VALUE rather than by their accidental property insertion order (a base
 * event read back from disk and a freshly-constructed one can differ only in
 * key order and still be "the same event"). Used by {@link mergeJournal} to
 * tell a genuine payload divergence apart from a harmless re-run.
 */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value as AnyRecord).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson((value as AnyRecord)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Whether `ev` participates in `crossCheckJournal`'s "last transition wins"
 * comparison against the snapshot — the only place where the READ-BACK ORDER
 * of two same-node events (not just their presence) actually matters. A
 * platform-scoped `node.status_changed` (`platform` present) moves a
 * per-platform view status, which nothing in `crossCheckJournal` cross-checks
 * against the snapshot today, so it's excluded — see item 7 in the file doc.
 */
function isOrderSensitive(ev: AnyRecord): boolean {
  if (ev.type === "decision.status_changed") return true;
  if (ev.type === "node.status_changed") return ev.platform === undefined;
  return false;
}

/**
 * A key that actually distinguishes two events sharing a `type` and `ts` —
 * see item 3 in the file doc above. Every field below is folded in WHEN
 * PRESENT on `raw`; two events differing in any of them get different keys,
 * and thus (via `deterministicEventId`) different ids. `ts` is included
 * explicitly even though `deterministicEventId` already encodes it into the
 * id's time prefix — redundant, but harmless, and keeps the key self-
 * describing on its own.
 */
function eventKey(raw: AnyRecord, ts: string): string {
  const type = String(raw.type ?? "");
  const parts = [type, `ts=${ts}`];
  const field = (label: string, value: unknown): void => {
    if (value !== undefined) parts.push(`${label}=${stringify(value)}`);
  };
  field("node", raw.node_id);
  field("deliverable", raw.deliverable_id);
  field("version", raw.version);
  field("edge", raw.edge_id);
  field("ref", raw.ref_id);
  field("source", raw.source_id);
  field("target", raw.target_id);
  field("platform", raw.platform);
  field("from", raw.from);
  field("to", raw.to);
  field("title", raw.title);
  field("url", raw.url);
  return parts.join("|");
}

export interface JournalConflict {
  id: string;
  base: AnyRecord;
  fresh: AnyRecord;
}

/**
 * Merge `base` (the journal already on disk / embedded in the base bundle)
 * with `fresh` (this run's newly-derived events), de-duplicating by `id`.
 *
 * The whole point of `deterministicEventId` is that the SAME logical event
 * gets the SAME id on every run — which means a naive concat-then-sort (the
 * reference's approach) doubles the journal every time `merge` re-runs over
 * unchanged story fragments. `base`'s copy always wins on an id collision
 * (it's the one already committed — the append-only-journal invariant, and
 * "fresh wins" would let a re-run silently clobber a deliberate, out-of-band
 * edit to committed history, which is worse); `added` counts only ids that
 * were not already present, so `counts.eventsAdded` reports what genuinely
 * changed, not what got re-derived and thrown away.
 *
 * `conflicts` names every id where the fresh payload actually DIFFERS from
 * what's committed (item 8 in the file doc) — base still wins, nothing is
 * silently overwritten, but the caller turns each one into a `MergeProblem`
 * rather than letting a real divergence disappear as an indistinguishable
 * "+0 events". Compared via {@link canonicalJson} so two representations of
 * the same value (different key order) don't false-positive.
 */
function mergeJournal(
  base: readonly AnyRecord[],
  fresh: readonly AnyRecord[],
): { journal: AnyRecord[]; added: number; conflicts: JournalConflict[] } {
  const byId = new Map<string, AnyRecord>();
  for (const ev of base) {
    const id = typeof ev.id === "string" ? ev.id : undefined;
    if (id) byId.set(id, ev);
  }
  let added = 0;
  const conflicts: JournalConflict[] = [];
  for (const ev of fresh) {
    const id = typeof ev.id === "string" ? ev.id : undefined;
    if (!id) continue;
    const existing = byId.get(id);
    if (existing) {
      if (canonicalJson(existing) !== canonicalJson(ev)) {
        conflicts.push({ id, base: existing, fresh: ev });
      }
      continue;
    }
    byId.set(id, ev);
    added += 1;
  }
  return { journal: sortEvents([...byId.values()]), added, conflicts };
}

export interface MergeInput {
  base: AnyRecord;
  baseJournal: readonly AnyRecord[];
  fragments: readonly LoadedFragment[];
  /** Fallback `node.created`/`node.status_changed` timestamp when a fragment supplies no ts of its own. */
  fallbackTs: string;
}

export function mergeFragments(input: MergeInput): MergeResult {
  const errors: MergeProblem[] = [];
  const projectId = String((input.base.project as AnyRecord | undefined)?.id ?? "");

  const nodes = new Map<string, AnyRecord>();
  // Seeded for every base node too (item 5 above) — not just nodes added
  // during this run — so an id collision is caught whether the existing
  // node came from an earlier fragment in THIS run or was already persisted
  // before this run started. The sentinel label only ever surfaces inside an
  // error message.
  const nodeOrigin = new Map<string, string>();
  for (const node of asArray(input.base.nodes)) {
    const id = String(node.id);
    nodes.set(id, { ...node });
    nodeOrigin.set(id, "(already in the bundle)");
  }

  const edges = new Map<string, AnyRecord>();
  for (const edge of asArray(input.base.edges)) {
    edges.set(String(edge.id ?? edgeId(String(edge.source_id), String(edge.target_id))), { ...edge });
  }

  const newEvents: AnyRecord[] = [];
  const counts = { nodesAdded: 0, nodesUpdated: 0, nodesRetired: 0, edgesAdded: 0, eventsAdded: 0 };

  // Item 7: tracks, per (type, node_id, ts), the one order-sensitive event
  // already seen — seeded from the base journal too, so a fresh event
  // colliding with committed history is caught, not just fresh-vs-fresh
  // within this run. Item 8: which unit produced each fresh event's id, so a
  // payload-divergence conflict (surfaced after mergeJournal runs, below) can
  // be attributed to the unit that produced it.
  const orderSensitiveSeen = new Map<string, { id: string; unit: string; from: unknown; to: unknown }>();
  for (const ev of input.baseJournal) {
    if (!isOrderSensitive(ev)) continue;
    const key = `${String(ev.type)}:${String(ev.node_id ?? "")}:${String(ev.ts ?? "")}`;
    if (!orderSensitiveSeen.has(key)) {
      orderSensitiveSeen.set(key, { id: String(ev.id ?? ""), unit: "(already in the journal)", from: ev.from, to: ev.to });
    }
  }
  const eventUnit = new Map<string, string>();

  /**
   * The single path every new event reaches `newEvents` through. Order-
   * sensitive events (item 7) are checked against everything already seen —
   * base history and earlier pushes in this same run alike — before being
   * accepted; a genuine same-(type, node_id, ts) conflict is refused with a
   * `MergeProblem` instead of being written with an arbitrary tie-break
   * order, because `orderEvents` re-derives that order on every future read
   * regardless of what this file chose to write.
   */
  const pushEvent = (unitId: string, ev: AnyRecord): void => {
    if (isOrderSensitive(ev)) {
      const nodeId = String(ev.node_id ?? "");
      const key = `${String(ev.type)}:${nodeId}:${String(ev.ts ?? "")}`;
      const existing = orderSensitiveSeen.get(key);
      if (existing && existing.id !== String(ev.id)) {
        errors.push({
          unit: unitId,
          message:
            `two \`${String(ev.type)}\` events for node \`${nodeId}\` land at the identical ts ${String(ev.ts)} — ` +
            `${JSON.stringify(existing.from)} -> ${JSON.stringify(existing.to)} (from ${existing.unit}) and ` +
            `${JSON.stringify(ev.from)} -> ${JSON.stringify(ev.to)} (from ${unitId}). Read-back order between ` +
            "events sharing one ts is not guaranteed to match write order (orderEvents ties-break on a hash-" +
            "derived id, not causality), so one of these could silently become the \"last\" status. Give one of " +
            "them a distinct timestamp (`update`/`retire`: `changed_ts`; wave-3 `events`: `ts`) and re-run.",
        });
        return;
      }
      if (!existing) {
        orderSensitiveSeen.set(key, { id: String(ev.id), unit: unitId, from: ev.from, to: ev.to });
      }
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
      // Item 6: @arkaik/schema's zod NodeSchema requires `platforms`
      // unconditionally, even on decision nodes (which validateBundle itself
      // exempts from the non-empty check) — default rather than let a
      // schema-only rejection surface far from where it was introduced.
      if (!Array.isArray(node.platforms)) node.platforms = [];

      if (nodes.has(id)) {
        const existingTitle = String(nodes.get(id)?.title ?? "");
        const incomingTitle = String(node.title ?? "");
        const owner = nodeOrigin.get(id) ?? "(already in the bundle)";
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
      const rawPatch = (patch.patch ?? {}) as AnyRecord;
      Object.assign(target, rawPatch, { id, project_id: projectId });
      counts.nodesUpdated += 1;

      // Item 4: a patch that changes `status` must leave a
      // node.status_changed event behind it, or a node with any prior status
      // history fails arkaik validate's journal-status-mismatch the moment
      // this merge's snapshot disagrees with the journal's last recorded
      // transition.
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
      // Self-review finding, caught by probe 4's parseBundle/validateBundle
      // round trip: `FragmentEdge.kind` is the agent-facing field name (every
      // fragment fixture in this plan — Task 7's and Task 9's alike — writes
      // `kind: "composes"` etc.), but the bundle schema's field is
      // `edge_type` (EdgeSchema, validate.ts's `valid-edge-type` check). The
      // reference merge.ts spread `raw` straight onto the edge with no
      // translation, so every merged edge silently carried `kind` and no
      // `edge_type` at all — invisible in this file's own determinism test
      // (it has no edges), and never caught by Task 7's or Task 9's reference
      // tests either, because neither actually runs `arkaik validate` (or
      // checks `edge_type`) against a fixture with edges. Reproduced directly:
      // validateBundle reports `invalid edge_type "undefined"` on a merge
      // output built from every edge fixture in this plan. Fixed here, not by
      // asking agents to spell the bundle's own internal field name.
      const kindValue = raw.kind;
      const edgeTypeValue = raw.edge_type;
      const resolvedType = typeof edgeTypeValue === "string" ? edgeTypeValue : typeof kindValue === "string" ? kindValue : undefined;
      if (!resolvedType) {
        errors.push({ unit: unit.id, message: `edge ${source} -> ${target} has no \`kind\` (its edge type)` });
        continue;
      }
      const id = edgeId(source, target);
      if (edges.has(id)) continue;
      const edge: AnyRecord = { ...raw, id, project_id: projectId, source_id: source, target_id: target, edge_type: resolvedType };
      delete edge.kind;
      edges.set(id, edge);
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

  // Item 8: a fresh event sharing an id with a committed one, but carrying
  // different content, is a real divergence — base still wins (nothing is
  // silently overwritten), but the run refuses rather than making that
  // divergence indistinguishable from "nothing changed".
  for (const conflict of conflicts) {
    errors.push({
      unit: eventUnit.get(conflict.id) ?? "(unknown unit)",
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
