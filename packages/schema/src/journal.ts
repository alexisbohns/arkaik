/**
 * Journal & Events — Format Level 2 (docs/spec/journal.md).
 *
 * The journal is an append-only log of typed events recording how the product
 * graph changed. This module is the **read/validate** core: the event types,
 * the ordering helper, the JSONL sidecar parser, and the snapshot↔journal
 * cross-check. It does **not** emit events — app-side emission is M3.
 *
 * Deliberately **zod-free** (type-only imports from ./ids, plus the zod-free
 * `normalizeStatus` from ./legacy-status, itself built on the plain ID lists).
 * validate.ts — which is bundled into the zero-dependency standalone validator
 * — imports {@link crossCheckJournal} from here, so pulling zod in would bloat
 * that artifact for no benefit. The zod schemas for these types live in
 * journal-events.ts.
 */

import type { SpeciesId, StatusId, PlatformId, EdgeTypeId } from "./ids";
import type { DecisionStatusId } from "./decision";
import { normalizeStatus } from "./legacy-status";

/**
 * The v1 event vocabulary (docs/spec/journal.md § Event Vocabulary). The list
 * grows without version bumps: unknown `type` values MUST be preserved on
 * rewrite and ignored on read, so this is a *known* set, never an exhaustive
 * gate.
 */
export const JOURNAL_EVENT_TYPES = [
  "node.created",
  "node.updated",
  "node.status_changed",
  "decision.status_changed",
  "node.deleted",
  "edge.added",
  "edge.removed",
  "release.tagged",
  "deliverable.shipped",
  "idea.proposed",
  "request.filed",
  "ref.added",
  "ref.removed",
  "ref.status_changed",
  "journal.baseline",
] as const;

/** A `type` value in the known v1 vocabulary. */
export type JournalEventType = (typeof JOURNAL_EVENT_TYPES)[number];

/**
 * One journal event — the envelope (docs/spec/journal.md § Event Envelope).
 * Type-specific payload fields sit flat on the object; the index signature
 * carries them plus any forward-compatible unknown fields, which MUST survive a
 * rewrite. Events carry no `project_id` — scope is the file/bundle they live in.
 */
export interface JournalEvent extends Record<string, unknown> {
  /** ULID — sortable, collision-free without coordination. */
  id: string;
  /** ISO 8601 timestamp. */
  ts: string;
  /** Who/what wrote it: "alexis", "claude-code", "arkaik-sync", "ci". */
  actor?: string;
  /** Event type — the v1 vocabulary, or an unknown forward-compatible value. */
  type: string;
  /** Reserved per-event payload version, for the day a payload shape changes. */
  v?: number;
}

/** Node added to the graph. */
export interface NodeCreatedEvent extends JournalEvent {
  type: "node.created";
  node_id: string;
  species: SpeciesId;
  title: string;
}

/** Non-status fields changed. `fields` lists changed paths; scalars MAY carry from/to. */
export interface NodeUpdatedEvent extends JournalEvent {
  type: "node.updated";
  node_id: string;
  fields: string[];
  from?: unknown;
  to?: unknown;
}

/** Lifecycle transition. `platform` present when a per-platform view status moved. */
export interface NodeStatusChangedEvent extends JournalEvent {
  type: "node.status_changed";
  node_id: string;
  from: StatusId;
  to: StatusId;
  platform?: PlatformId;
}

/** A decision moved between decision states (metadata.decision_status). */
export interface DecisionStatusChangedEvent extends JournalEvent {
  type: "decision.status_changed";
  node_id: string;
  from: DecisionStatusId;
  to: DecisionStatusId;
}

/**
 * Node removed. Implies cascade removal of every edge referencing it — writers
 * do not emit the cascaded `edge.removed` events; consumers apply the cascade.
 */
export interface NodeDeletedEvent extends JournalEvent {
  type: "node.deleted";
  node_id: string;
}

/** Relationship created. */
export interface EdgeAddedEvent extends JournalEvent {
  type: "edge.added";
  edge_id: string;
  source_id: string;
  target_id: string;
  edge_type: EdgeTypeId;
}

/** Relationship removed (non-cascade). */
export interface EdgeRemovedEvent extends JournalEvent {
  type: "edge.removed";
  edge_id: string;
}

/** A version shipped. `platform` absent = project-wide; present = that platform's rhythm. */
export interface ReleaseTaggedEvent extends JournalEvent {
  type: "release.tagged";
  version: string;
  notes?: string;
  platform?: PlatformId;
}

/**
 * A unit of shipped work (typically one merged PR): entity changes + a summary
 * note. Re-appending with the same `deliverable_id` edits — consumers resolve
 * content latest-wins, anchored at the first occurrence (when it shipped).
 */
export interface DeliverableShippedEvent extends JournalEvent {
  type: "deliverable.shipped";
  deliverable_id: string;
  title: string;
  summary?: string;
  url?: string;
  node_ids?: string[];
  platform?: PlatformId;
}

/** An idea, before (or linked to) any node. */
export interface IdeaProposedEvent extends JournalEvent {
  type: "idea.proposed";
  title: string;
  description?: string;
  node_id?: string;
}

/** An external ask (user feedback, stakeholder request). */
export interface RequestFiledEvent extends JournalEvent {
  type: "request.filed";
  title: string;
  description?: string;
  source?: string;
  node_id?: string;
}

/** External reference attached. */
export interface RefAddedEvent extends JournalEvent {
  type: "ref.added";
  node_id: string;
  ref_id: string;
  ref_type: string;
  url: string;
}

/** External reference detached. */
export interface RefRemovedEvent extends JournalEvent {
  type: "ref.removed";
  node_id: string;
  ref_id: string;
}

/** Mirrored external status moved (issue closed, PR merged). */
export interface RefStatusChangedEvent extends JournalEvent {
  type: "ref.status_changed";
  node_id: string;
  ref_id: string;
  from?: string;
  to: string;
  synced_at: string;
}

/**
 * Journal coverage marker: the listed nodes already existed when this journal's
 * coverage began, and their creation is **not** recorded in it.
 *
 * A bundle whose nodes predate journaling (exported from the app, hand-authored,
 * migrated from Level 0/1) has no `node.created` for them, and the very first
 * append — a release marker, a deliverable, one MCP mutation — makes the journal
 * non-empty and therefore cross-checked. Writers emit exactly one of these
 * immediately before that first append, so the provenance rule is satisfied by
 * an explicit, auditable statement about *coverage* rather than by fabricating a
 * `node.created` per node — history nobody witnessed. Its position in `ts` order
 * carries no meaning: provenance is a set membership test, not a replay.
 */
export interface JournalBaselineEvent extends JournalEvent {
  type: "journal.baseline";
  node_ids: string[];
}

/** The discriminated union of every known v1 event. */
export type KnownJournalEvent =
  | NodeCreatedEvent
  | NodeUpdatedEvent
  | NodeStatusChangedEvent
  | DecisionStatusChangedEvent
  | NodeDeletedEvent
  | EdgeAddedEvent
  | EdgeRemovedEvent
  | ReleaseTaggedEvent
  | DeliverableShippedEvent
  | IdeaProposedEvent
  | RequestFiledEvent
  | RefAddedEvent
  | RefRemovedEvent
  | RefStatusChangedEvent
  | JournalBaselineEvent;

/**
 * Order events by `ts`, tiebreaking by `id` (both ULID and ISO 8601 sort
 * lexicographically). Files MAY contain out-of-order lines — union merge
 * reorders — so consumers MUST tolerate that; this returns a new, sorted array
 * and never mutates the input. Events with a missing/non-string `ts` or `id`
 * sort as if empty rather than throwing.
 */
export function orderEvents<T extends { ts?: unknown; id?: unknown }>(events: readonly T[]): T[] {
  const key = (v: unknown): string => (typeof v === "string" ? v : "");
  return [...events].sort((a, b) => {
    const ta = key(a.ts);
    const tb = key(b.ts);
    if (ta < tb) return -1;
    if (ta > tb) return 1;
    const ia = key(a.id);
    const ib = key(b.id);
    if (ia < ib) return -1;
    if (ia > ib) return 1;
    return 0;
  });
}

/** Severity of a journal finding. All journal cross-check findings are errors. */
export type JournalSeverity = "error" | "warning";

/** A snapshot↔journal cross-check finding, shaped like a ValidationFinding. */
export interface JournalFinding {
  path: string;
  rule: string;
  message: string;
  severity: JournalSeverity;
}

/** A finding from parsing the JSONL sidecar — carries the offending line number. */
export interface JournalLineFinding {
  /** 1-based line number in the JSONL text. */
  line: number;
  rule: "journal-line-parse" | "journal-line-shape";
  message: string;
  severity: "error";
}

/** Result of {@link parseJournalLines}: the events that parsed, plus per-line findings. */
export interface JournalParseResult {
  events: JournalEvent[];
  findings: JournalLineFinding[];
}

/**
 * Parse a JSONL journal sidecar: one self-contained event per line
 * (docs/spec/journal.md § Canonical). A malformed line invalidates **exactly
 * that one event** — the finding reports its 1-based line number — and can
 * never damage the events on other lines: every well-formed line still parses.
 * Blank/whitespace-only lines (a trailing newline, gaps left by union merge)
 * are ignored. The returned events are in file order — call {@link orderEvents}
 * to sort them.
 */
export function parseJournalLines(text: string): JournalParseResult {
  const events: JournalEvent[] = [];
  const findings: JournalLineFinding[] = [];

  const lines = text.split(/\r?\n/);
  lines.forEach((raw, idx) => {
    const line = idx + 1;
    if (raw.trim() === "") return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      findings.push({
        line,
        rule: "journal-line-parse",
        message: `Line ${line}: not valid JSON — ${(e as Error).message}`,
        severity: "error",
      });
      return;
    }

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      findings.push({
        line,
        rule: "journal-line-shape",
        message: `Line ${line}: each journal line must be a single JSON event object.`,
        severity: "error",
      });
      return;
    }

    const ev = parsed as Record<string, unknown>;
    const missing: string[] = [];
    if (typeof ev.id !== "string") missing.push("id");
    if (typeof ev.ts !== "string") missing.push("ts");
    if (typeof ev.type !== "string") missing.push("type");
    if (missing.length > 0) {
      findings.push({
        line,
        rule: "journal-line-shape",
        message: `Line ${line}: event is missing required envelope field(s): ${missing.join(", ")}.`,
        severity: "error",
      });
      return;
    }

    events.push(ev as JournalEvent);
  });

  return { events, findings };
}

/** Node-reference payload fields per known event type, for the dangling-ref check. */
const NODE_REF_FIELDS: Record<string, readonly string[]> = {
  "node.updated": ["node_id"],
  "node.status_changed": ["node_id"],
  "decision.status_changed": ["node_id"],
  "node.deleted": ["node_id"],
  "edge.added": ["source_id", "target_id"],
  "ref.added": ["node_id"],
  "ref.removed": ["node_id"],
  "ref.status_changed": ["node_id"],
  "idea.proposed": ["node_id"],
  "request.filed": ["node_id"],
};

/**
 * Whether a journal's last `node.status_changed.to` agrees with the snapshot
 * `status`, across vocabulary vintages. The journal is never rewritten
 * (docs/spec/journal.md), while `migrateStatusVocabulary` remaps snapshots —
 * so a migrated bundle lawfully carries legacy ids in history against current
 * ids in the snapshot, and comparing raw strings would flag every such pair.
 *
 * Two allowances, nothing more:
 * - Both sides are normalized through the permanent dead-id aliases
 *   (`prioritized`→`backlog`, `blocked`→`development`) before comparing —
 *   those remaps are unambiguous whatever the vintage.
 * - Exactly one residual pair is tolerated, directionally: journal-last
 *   `"backlog"` vs snapshot `"idea"`. A pre-v3 journal's final "backlog" (old
 *   someday pile) may describe a node the v3 migration re-filed as `idea`;
 *   the bundle's vintage at event time is undecidable at validation time, so
 *   this single pair is accepted rather than rewriting history. The reverse
 *   pair — and every other mismatch — keeps full error strength.
 */
function statusesAgree(last: string, snapshot: unknown): boolean {
  if (last === snapshot) return true;
  if (typeof snapshot !== "string") return false;
  if (last === "backlog" && snapshot === "idea") return true;
  return (normalizeStatus(last) ?? last) === (normalizeStatus(snapshot) ?? snapshot);
}

/**
 * Cross-check the embedded snapshot against the embedded journal **by value**
 * (docs/spec/journal.md § Authority & Consistency Model) — never by timestamp,
 * because per-node timestamps don't exist and clocks lie. Runs only when a
 * non-empty `journal` is present; an absent or empty journal is the no-history
 * state, not an error.
 *
 * The rules, each producing an `error` finding naming both sides:
 * - **Status agreement:** the last project-level `node.status_changed.to` for a
 *   node must agree with its current snapshot `status` per
 *   {@link statusesAgree} — equality after the permanent legacy aliases, plus
 *   the one tolerated pre-v3 `"backlog"`→`idea` pair, because history keeps
 *   its legacy ids while snapshots migrate. Platform-scoped transitions
 *   (those carrying `platform`) move a per-platform view status, not
 *   `node.status`, and are excluded.
 * - **Provenance:** every node in the snapshot must have a `node.created` event,
 *   **or** be named by a `journal.baseline` — the explicit "this journal's
 *   coverage begins here, these nodes already existed" marker a writer emits
 *   when it first appends to a journal that predates the graph. Without that
 *   escape hatch the first append to a journal-less bundle would make every one
 *   of its nodes read as missing provenance, permanently (#357).
 * - **No dangling references:** no event may reference a node or edge that never
 *   existed — i.e. is neither in the current snapshot nor introduced by a
 *   `node.created` / `edge.added` / `journal.baseline`. The `node.deleted` edge
 *   cascade is applied:
 *   edges attached to a deleted node are removed without an explicit
 *   `edge.removed`, so the "ever existed" edge set (snapshot ∪ `edge.added`)
 *   already covers them and no cascaded `edge.removed` is ever demanded.
 *
 * Accepts a loose bundle: malformed events are reported (envelope errors) and
 * skipped rather than throwing, so this composes with the rest of validateBundle.
 */
export function crossCheckJournal(bundle: Record<string, unknown>): JournalFinding[] {
  const findings: JournalFinding[] = [];
  const journalRaw = (bundle as { journal?: unknown }).journal;
  if (journalRaw === undefined) return findings;

  if (!Array.isArray(journalRaw)) {
    findings.push({
      path: "journal",
      rule: "journal-shape",
      message: "journal must be an array of events when present.",
      severity: "error",
    });
    return findings;
  }
  if (journalRaw.length === 0) return findings;

  const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

  // --- Current snapshot state ---
  const nodesRaw = Array.isArray(bundle.nodes) ? (bundle.nodes as Record<string, unknown>[]) : [];
  const edgesRaw = Array.isArray(bundle.edges) ? (bundle.edges as Record<string, unknown>[]) : [];
  const snapshotNodeStatus = new Map<string, unknown>();
  const snapshotDecisionStatus = new Map<string, unknown>();
  for (const n of nodesRaw) {
    const id = str(n?.id);
    if (id !== undefined) {
      snapshotNodeStatus.set(id, (n as Record<string, unknown>).status);
      const metadata = (n as Record<string, unknown>).metadata;
      const decisionStatus =
        metadata && typeof metadata === "object" && !Array.isArray(metadata)
          ? (metadata as Record<string, unknown>).decision_status
          : undefined;
      snapshotDecisionStatus.set(id, decisionStatus ?? "proposed");
    }
  }
  const snapshotEdgeIds = new Set<string>();
  for (const e of edgesRaw) {
    const id = str(e?.id);
    if (id !== undefined) snapshotEdgeIds.add(id);
  }

  // --- Envelope-validate events, keeping their original index ---
  const valid: Array<{ ev: JournalEvent; index: number }> = [];
  journalRaw.forEach((raw, index) => {
    const path = `journal[${index}]`;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      findings.push({
        path,
        rule: "journal-event-shape",
        message: `journal[${index}]: each event must be a JSON object.`,
        severity: "error",
      });
      return;
    }
    const ev = raw as Record<string, unknown>;
    const missing: string[] = [];
    if (str(ev.id) === undefined) missing.push("id");
    if (str(ev.ts) === undefined) missing.push("ts");
    if (str(ev.type) === undefined) missing.push("type");
    if (missing.length > 0) {
      findings.push({
        path,
        rule: "journal-event-envelope",
        message: `journal[${index}]: event is missing required envelope field(s): ${missing.join(", ")}.`,
        severity: "error",
      });
      return;
    }
    valid.push({ ev: ev as JournalEvent, index });
  });

  // --- "Ever existed" sets: current snapshot ∪ everything the journal created/added ---
  // A `journal.baseline` counts as evidence on both axes: naming a node is a
  // statement that it existed (so references to it never dangle — including a
  // `node.deleted` for one adopted and then removed) and that its creation
  // predates this journal (so no `node.created` is demanded for it).
  const everNodes = new Set<string>(snapshotNodeStatus.keys());
  const everEdges = new Set<string>(snapshotEdgeIds);
  const baselined = new Set<string>();
  for (const { ev } of valid) {
    if (ev.type === "node.created") {
      const nid = str(ev.node_id);
      if (nid) everNodes.add(nid);
    } else if (ev.type === "edge.added") {
      const eid = str(ev.edge_id);
      if (eid) everEdges.add(eid);
    } else if (ev.type === "journal.baseline" && Array.isArray(ev.node_ids)) {
      for (const raw of ev.node_ids as unknown[]) {
        const nid = str(raw);
        if (nid) {
          baselined.add(nid);
          everNodes.add(nid);
        }
      }
    }
  }

  // --- Ordered projection: created provenance + last project-level status ---
  const ordered = orderEvents(valid.map((v) => v.ev));
  const created = new Set<string>();
  const lastProjectStatus = new Map<string, string>();
  const lastDecisionStatus = new Map<string, string>();
  for (const ev of ordered) {
    if (ev.type === "node.created") {
      const nid = str(ev.node_id);
      if (nid) created.add(nid);
    } else if (ev.type === "node.status_changed") {
      const nid = str(ev.node_id);
      if (nid && ev.platform === undefined) {
        const to = str(ev.to);
        if (to !== undefined) lastProjectStatus.set(nid, to);
      }
    } else if (ev.type === "decision.status_changed") {
      const nid = str(ev.node_id);
      if (nid) {
        const to = str(ev.to);
        if (to !== undefined) lastDecisionStatus.set(nid, to);
      }
    }
  }

  // --- No dangling references ---
  for (const { ev, index } of valid) {
    const nodeFields = NODE_REF_FIELDS[ev.type];
    if (nodeFields) {
      for (const field of nodeFields) {
        const ref = str(ev[field]);
        if (ref !== undefined && !everNodes.has(ref)) {
          findings.push({
            path: `journal[${index}].${field}`,
            rule: "journal-dangling-node-ref",
            message: `journal[${index}] (${ev.type}): references node "${ref}" that never existed in the snapshot or journal.`,
            severity: "error",
          });
        }
      }
    }
    // deliverable.shipped carries an ARRAY of node refs — NODE_REF_FIELDS
    // handles scalar fields only, so the array is walked here.
    if (ev.type === "deliverable.shipped" && Array.isArray(ev.node_ids)) {
      (ev.node_ids as unknown[]).forEach((raw, i) => {
        const ref = str(raw);
        if (ref !== undefined && !everNodes.has(ref)) {
          findings.push({
            path: `journal[${index}].node_ids[${i}]`,
            rule: "journal-dangling-node-ref",
            message: `journal[${index}] (${ev.type}): references node "${ref}" that never existed in the snapshot or journal.`,
            severity: "error",
          });
        }
      });
    }
    if (ev.type === "edge.removed") {
      const ref = str(ev.edge_id);
      if (ref !== undefined && !everEdges.has(ref)) {
        findings.push({
          path: `journal[${index}].edge_id`,
          rule: "journal-dangling-edge-ref",
          message: `journal[${index}] (edge.removed): references edge "${ref}" that never existed in the snapshot or journal.`,
          severity: "error",
        });
      }
    }
  }

  // --- Provenance + status agreement, per current snapshot node ---
  for (const [nodeId, status] of snapshotNodeStatus) {
    if (!created.has(nodeId) && !baselined.has(nodeId)) {
      findings.push({
        path: "journal",
        rule: "journal-missing-node-created",
        message: `Node "${nodeId}" is present in the snapshot but has no node.created event in the journal.`,
        severity: "error",
      });
    }
    const last = lastProjectStatus.get(nodeId);
    if (last !== undefined && !statusesAgree(last, status)) {
      findings.push({
        path: "journal",
        rule: "journal-status-mismatch",
        message: `Node "${nodeId}": journal's last node.status_changed.to "${last}" disagrees with snapshot status "${String(status)}".`,
        severity: "error",
      });
    }
  }

  // --- Decision status agreement, per node with at least one decision event ---
  // A decision with no decision.status_changed event is legal — it may predate
  // the vocabulary — so only nodes the journal actually tracked are compared.
  // A node absent from the snapshot may have been legitimately deleted after
  // its last transition (node.deleted, no cascade obligation here) — skip it,
  // mirroring how the project-status check above iterates snapshot state
  // rather than journal state.
  for (const [nodeId, last] of lastDecisionStatus) {
    if (!snapshotDecisionStatus.has(nodeId)) continue;
    const current = snapshotDecisionStatus.get(nodeId) ?? "proposed";
    if (last !== current) {
      findings.push({
        path: "journal",
        rule: "journal-decision-status-mismatch",
        message: `Node "${nodeId}": journal's last decision.status_changed.to "${last}" disagrees with snapshot decision_status "${String(current)}".`,
        severity: "error",
      });
    }
  }

  return findings;
}

/**
 * The snapshot node ids whose creation `events` does not account for — neither a
 * `node.created` nor a {@link JournalBaselineEvent} naming them — in snapshot
 * order, deduplicated. Exactly the set {@link crossCheckJournal} would flag
 * `journal-missing-node-created`, exposed as a pure helper so a writer can emit
 * ONE `journal.baseline` covering them immediately before its first append
 * (docs/spec/journal.md § Authority & Consistency Model).
 *
 * Pass the **full** journal — the working sidecar *plus* any compaction
 * archives — or a baseline will name nodes whose `node.created` merely moved
 * out of the working file at `arkaik release --compact` time.
 */
export function missingProvenanceNodeIds(
  snapshotNodeIds: Iterable<string>,
  events: readonly JournalEvent[],
): string[] {
  const covered = new Set<string>();
  for (const ev of events) {
    if (ev.type === "node.created") {
      if (typeof ev.node_id === "string") covered.add(ev.node_id);
    } else if (ev.type === "journal.baseline" && Array.isArray(ev.node_ids)) {
      for (const id of ev.node_ids as unknown[]) {
        if (typeof id === "string") covered.add(id);
      }
    }
  }

  const missing: string[] = [];
  const seen = new Set<string>();
  for (const id of snapshotNodeIds) {
    if (covered.has(id) || seen.has(id)) continue;
    seen.add(id);
    missing.push(id);
  }
  return missing;
}
