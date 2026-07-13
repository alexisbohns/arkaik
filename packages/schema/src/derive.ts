/**
 * Journal event derivation — the pure half of a dual-write (issue #218,
 * generalized). Given a graph mutation (a create, a delete, or an update
 * patch), these functions produce the matching journal event(s) a writer must
 * append so the mutated bundle passes the same `crossCheckJournal` every
 * dual-writer is held to (docs/spec/journal.md § Authority & Consistency
 * Model, the skill's § Which events to append).
 *
 * Lives in @arkaik/schema so every writer shares one derivation: the app binds
 * the actor `"arkaik-app"` in `lib/data/emit-events.ts` (which re-exports this
 * module), and the MCP server binds `"arkaik-mcp"` (docs/spec/mcp.md § Write
 * Path). Deliberately free of any storage import: this module only computes
 * event payloads and stamps them via {@link makeEvent}. The *append* lives
 * with each consumer. Keeping the derivation pure means it is browser/SSR-safe
 * and unit-testable without a real store (tests/data/emit-events).
 *
 * ## Op → event mapping (mirrors docs/arkaik-skill/skill.md:81-90)
 * - createNode          → `node.created`
 * - createEdge          → `edge.added`
 * - deleteNode(s)       → `node.deleted` (one per node; the edge cascade is
 *                         implied — NO `edge.removed` for cascaded edges,
 *                         docs/spec/journal.md:71)
 * - deleteEdge          → `edge.removed`
 * - updateNode(patch)   → {@link diffNodeUpdate}: `status` → `node.status_changed`
 *                         (project-level); a `metadata.platformStatuses[p]` delta
 *                         → `node.status_changed` + `platform`; `metadata.refs`
 *                         gained/lost → `ref.added` / `ref.removed`; any other
 *                         changed field path → `node.updated` with `fields[]`.
 *
 * ## Asset exclusion (hard rule, docs/spec/journal.md:61, docs/vision.md § Asset Policy)
 * Events MUST NOT embed asset payloads. Editors may rewrite the *whole*
 * `metadata` object on any platform-variant edit, so {@link diffNodeUpdate}
 * diffs metadata **per key** (and per platform for the map-typed keys): a note
 * edit records only the note's path, never dragging the sibling screenshot's
 * data-URI into the event. `node.updated` only ever carries `from`/`to` for a
 * single short top-level scalar (e.g. a title rename), never for a metadata
 * path — so a screenshot blob can never appear in an event.
 */

import { makeEvent } from "./emit";
import type { JournalEvent } from "./journal";
import type { Edge, Node } from "./bundle";

/** A single event before the envelope is stamped: its `type` and flat payload. */
export interface EventInput {
  type: string;
  payload: Record<string, unknown>;
}

/** Stamp each {@link EventInput} into a validated {@link JournalEvent} via
 * `makeEvent` (ULID id, ISO ts, the writer's actor), throwing on a malformed
 * payload so a bad event is never appended. */
export function toJournalEvents(inputs: readonly EventInput[], actor: string): JournalEvent[] {
  return inputs.map((input) => makeEvent(input.type, input.payload, { actor }));
}

/** `node.created` for a newly created node. */
export function nodeCreatedInput(node: Node): EventInput {
  return {
    type: "node.created",
    payload: { node_id: node.id, species: node.species, title: node.title },
  };
}

/** `node.deleted` for a removed node. The edge cascade is implied — callers
 * MUST NOT emit `edge.removed` for the cascaded edges (docs/spec/journal.md:71). */
export function nodeDeletedInput(nodeId: string): EventInput {
  return { type: "node.deleted", payload: { node_id: nodeId } };
}

/** `edge.added` for a newly created edge. */
export function edgeAddedInput(edge: Edge): EventInput {
  return {
    type: "edge.added",
    payload: {
      edge_id: edge.id,
      source_id: edge.source_id,
      target_id: edge.target_id,
      edge_type: edge.edge_type,
    },
  };
}

/** `edge.removed` for an edge removed on its own (the node stays). */
export function edgeRemovedInput(edgeId: string): EventInput {
  return { type: "edge.removed", payload: { edge_id: edgeId } };
}

/** Top-level Node fields (excluding id/project_id/metadata) worth diffing. */
const TOP_LEVEL_FIELDS = ["species", "title", "description", "status", "platforms"] as const;

/** Cap for a `from`/`to` scalar so `node.updated` stays a "short scalar" record
 * (docs/spec/journal.md:61) and never an unbounded blob. */
const MAX_SCALAR_LEN = 512;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A short scalar safe to record verbatim as `node.updated.from`/`to`. */
function isShortScalar(value: unknown): boolean {
  if (typeof value === "number" || typeof value === "boolean") return true;
  return typeof value === "string" && value.length <= MAX_SCALAR_LEN;
}

/** Structural equality, sufficient for change detection (values come from
 * editor state spreads). Order-independent at the top of each compared value
 * because metadata is diffed per key, so a parent key reorder never
 * masquerades as a change. */
function valueEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Platform keys whose value differs between two map-typed metadata values. */
function changedMapKeys(prev: unknown, next: unknown): string[] {
  const p = isRecord(prev) ? prev : {};
  const n = isRecord(next) ? next : {};
  const changed: string[] = [];
  for (const key of new Set([...Object.keys(p), ...Object.keys(n)])) {
    if (!valueEqual(p[key], n[key])) changed.push(key);
  }
  return changed.sort();
}

/** Per-platform `node.status_changed` events for a `platformStatuses` delta.
 * A newly added / removed override has only one endpoint, so the missing side
 * falls back to the node's project-level status — keeping both `from` and `to`
 * valid statuses (the schema requires it) without inventing a "none" status. */
function diffPlatformStatuses(
  nodeId: string,
  currentBase: unknown,
  nextBase: unknown,
  prev: unknown,
  next: unknown,
): EventInput[] {
  const p = isRecord(prev) ? prev : {};
  const n = isRecord(next) ? next : {};
  const events: EventInput[] = [];
  for (const platform of [...new Set([...Object.keys(p), ...Object.keys(n)])].sort()) {
    const from = p[platform];
    const to = n[platform];
    if (valueEqual(from, to)) continue;
    events.push({
      type: "node.status_changed",
      payload: {
        node_id: nodeId,
        from: from ?? currentBase,
        to: to ?? nextBase,
        platform,
      },
    });
  }
  return events;
}

/** `ref.added` / `ref.removed` for entries gained/lost in `metadata.refs`
 * (matched by ref `id`). A ref modified in place with no id change is out of
 * scope for v1 emission (docs/arkaik-skill/skill.md:89 covers attach/detach). */
function diffRefs(nodeId: string, prev: unknown, next: unknown): EventInput[] {
  const prevArr = Array.isArray(prev) ? prev : [];
  const nextArr = Array.isArray(next) ? next : [];
  const byId = (arr: unknown[]) => {
    const map = new Map<string, Record<string, unknown>>();
    for (const item of arr) {
      if (isRecord(item) && typeof item.id === "string") map.set(item.id, item);
    }
    return map;
  };
  const prevById = byId(prevArr);
  const nextById = byId(nextArr);
  const events: EventInput[] = [];
  for (const [id, ref] of nextById) {
    if (!prevById.has(id)) {
      events.push({
        type: "ref.added",
        payload: { node_id: nodeId, ref_id: id, ref_type: ref.type, url: ref.url },
      });
    }
  }
  for (const id of prevById.keys()) {
    if (!nextById.has(id)) {
      events.push({ type: "ref.removed", payload: { node_id: nodeId, ref_id: id } });
    }
  }
  return events;
}

/**
 * Derive the journal events for an `updateNode(current, patch)` call. `patch`
 * carries only the fields being changed (metadata, when present, is the *whole*
 * new metadata object — see the module header). Returns events in emit order;
 * an unchanged patch yields `[]`.
 */
export function diffNodeUpdate(current: Node, patch: Partial<Node>): EventInput[] {
  const events: EventInput[] = [];
  const nodeId = current.id;
  const changedPaths: string[] = [];
  const cur = current as unknown as Record<string, unknown>;
  const pat = patch as unknown as Record<string, unknown>;

  // --- Top-level fields ---
  for (const field of TOP_LEVEL_FIELDS) {
    if (!(field in pat)) continue;
    const prev = cur[field];
    const nextVal = pat[field];
    if (valueEqual(prev, nextVal)) continue;

    if (field === "status") {
      // Project-level lifecycle transition (no platform).
      events.push({ type: "node.status_changed", payload: { node_id: nodeId, from: prev, to: nextVal } });
    } else {
      changedPaths.push(field);
    }
  }

  // --- Metadata, diffed per key (editors rewrite the whole object) ---
  if ("metadata" in pat) {
    const prevMeta = isRecord(current.metadata) ? current.metadata : {};
    const nextMeta = isRecord(patch.metadata) ? patch.metadata : {};
    const currentBase = current.status;
    const nextBase = "status" in pat && pat.status !== undefined ? pat.status : current.status;

    for (const key of new Set([...Object.keys(prevMeta), ...Object.keys(nextMeta)])) {
      if (key === "platformStatuses") {
        events.push(...diffPlatformStatuses(nodeId, currentBase, nextBase, prevMeta[key], nextMeta[key]));
      } else if (key === "refs") {
        events.push(...diffRefs(nodeId, prevMeta[key], nextMeta[key]));
      } else if (key === "platformScreenshots" || key === "platformNotes") {
        // Map-typed: record only each changed platform PATH — never the value,
        // so a screenshot data-URI is structurally excluded from the event.
        for (const platform of changedMapKeys(prevMeta[key], nextMeta[key])) {
          changedPaths.push(`metadata.${key}.${platform}`);
        }
      } else if (!valueEqual(prevMeta[key], nextMeta[key])) {
        changedPaths.push(`metadata.${key}`);
      }
    }
  }

  // --- Everything else → one node.updated with the changed paths ---
  if (changedPaths.length > 0) {
    changedPaths.sort();
    const payload: Record<string, unknown> = { node_id: nodeId, fields: changedPaths };
    // from/to only for a single top-level scalar change (e.g. a title rename):
    // a metadata path (contains ".") never carries a value, so no blob leaks.
    const only = changedPaths.length === 1 ? changedPaths[0] : undefined;
    if (only !== undefined && !only.includes(".") && isShortScalar(cur[only]) && isShortScalar(pat[only])) {
      payload.from = cur[only];
      payload.to = pat[only];
    }
    events.push({ type: "node.updated", payload });
  }

  return events;
}
