/**
 * Journal & Events — Format Level 2 (docs/spec/journal.md).
 *
 * The journal is an append-only log of typed events recording how the product
 * graph changed. This module is the **read/validate** core: the event types,
 * the ordering helper, the JSONL sidecar parser, and the snapshot↔journal
 * cross-check. It does **not** emit events — app-side emission is M3.
 *
 * Deliberately **zod-free** (only type-only imports from ./ids). validate.ts —
 * which is bundled into the zero-dependency standalone validator — imports
 * {@link crossCheckJournal} from here, so pulling zod in would bloat that
 * artifact for no benefit. The zod schemas for these types live in
 * journal-events.ts.
 */

import type { SpeciesId, StatusId, PlatformId, EdgeTypeId } from "./ids";

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
  "node.deleted",
  "edge.added",
  "edge.removed",
  "release.tagged",
  "idea.proposed",
  "request.filed",
  "ref.added",
  "ref.removed",
  "ref.status_changed",
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

/** The discriminated union of every known v1 event. */
export type KnownJournalEvent =
  | NodeCreatedEvent
  | NodeUpdatedEvent
  | NodeStatusChangedEvent
  | NodeDeletedEvent
  | EdgeAddedEvent
  | EdgeRemovedEvent
  | ReleaseTaggedEvent
  | IdeaProposedEvent
  | RequestFiledEvent
  | RefAddedEvent
  | RefRemovedEvent
  | RefStatusChangedEvent;

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
  "node.deleted": ["node_id"],
  "edge.added": ["source_id", "target_id"],
  "ref.added": ["node_id"],
  "ref.removed": ["node_id"],
  "ref.status_changed": ["node_id"],
  "idea.proposed": ["node_id"],
  "request.filed": ["node_id"],
};

/**
 * Cross-check the embedded snapshot against the embedded journal **by value**
 * (docs/spec/journal.md § Authority & Consistency Model) — never by timestamp,
 * because per-node timestamps don't exist and clocks lie. Runs only when a
 * non-empty `journal` is present; an absent or empty journal is the no-history
 * state, not an error.
 *
 * The rules, each producing an `error` finding naming both sides:
 * - **Status agreement:** the last project-level `node.status_changed.to` for a
 *   node must equal its current snapshot `status`. Platform-scoped transitions
 *   (those carrying `platform`) move a per-platform view status, not
 *   `node.status`, and are excluded.
 * - **Provenance:** every node in the snapshot must have a `node.created` event.
 * - **No dangling references:** no event may reference a node or edge that never
 *   existed — i.e. is neither in the current snapshot nor introduced by a
 *   `node.created` / `edge.added`. The `node.deleted` edge cascade is applied:
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
  for (const n of nodesRaw) {
    const id = str(n?.id);
    if (id !== undefined) snapshotNodeStatus.set(id, (n as Record<string, unknown>).status);
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
  const everNodes = new Set<string>(snapshotNodeStatus.keys());
  const everEdges = new Set<string>(snapshotEdgeIds);
  for (const { ev } of valid) {
    if (ev.type === "node.created") {
      const nid = str(ev.node_id);
      if (nid) everNodes.add(nid);
    } else if (ev.type === "edge.added") {
      const eid = str(ev.edge_id);
      if (eid) everEdges.add(eid);
    }
  }

  // --- Ordered projection: created provenance + last project-level status ---
  const ordered = orderEvents(valid.map((v) => v.ev));
  const created = new Set<string>();
  const lastProjectStatus = new Map<string, string>();
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
    if (!created.has(nodeId)) {
      findings.push({
        path: "journal",
        rule: "journal-missing-node-created",
        message: `Node "${nodeId}" is present in the snapshot but has no node.created event in the journal.`,
        severity: "error",
      });
    }
    const last = lastProjectStatus.get(nodeId);
    if (last !== undefined && last !== status) {
      findings.push({
        path: "journal",
        rule: "journal-status-mismatch",
        message: `Node "${nodeId}": journal's last node.status_changed.to "${last}" disagrees with snapshot status "${String(status)}".`,
        severity: "error",
      });
    }
  }

  return findings;
}
