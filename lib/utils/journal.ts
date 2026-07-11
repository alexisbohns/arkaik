/**
 * Journal projections — pure functions over (snapshot, journal), the same
 * pattern as the status rollups in `lib/utils/platform-status.ts`
 * (docs/spec/journal.md § Projections). Module-local exported result types,
 * minimal `Pick<>` inputs, no I/O, no React, immutable: every function returns
 * fresh data and never mutates its arguments.
 *
 * The journal is the *read* surface here — these functions never emit events
 * (app-side emission is M3). Ordering follows the journal ordering rule (by
 * `ts`, tiebreaking by `id`); {@link orderEvents} is reused from the schema
 * package so the rule lives in exactly one place. A bundle without a journal
 * yields the empty projection, never an error — that is the whole
 * backward-compatibility story (docs/spec/journal.md § Projections).
 */

import { orderEvents } from "@arkaik/schema";
import type { PlatformId } from "@/lib/config/platforms";
import type {
  Node,
  JournalEvent,
  EdgeAddedEvent,
  ReleaseTaggedEvent,
  IdeaProposedEvent,
  RequestFiledEvent,
} from "@/lib/data/types";

/** Narrow an `unknown` journal field to a string in one place. */
function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

// --- Node timeline -------------------------------------------------------

/** The ordered events touching a single node (docs/spec/journal.md:102). */
export type NodeTimeline = JournalEvent[];

/**
 * Every event touching `nodeId`, in journal order. An event touches a node when
 * it carries that `node_id` (creation, updates, status changes, deletion, refs,
 * a linked idea/request) or when the node is an endpoint of an edge event —
 * `edge.added` directly, `edge.removed` resolved back to the endpoints its
 * earlier `edge.added` recorded. Returns a fresh array; an empty journal (or a
 * node nothing references) yields `[]`.
 */
export function computeNodeTimeline(events: readonly JournalEvent[], nodeId: string): NodeTimeline {
  // Resolve edge endpoints from edge.added so a later edge.removed — which
  // carries only edge_id — can still be attributed to the nodes it connected.
  const edgeEndpoints = new Map<string, { source?: string; target?: string }>();
  for (const ev of events) {
    if (ev.type === "edge.added") {
      const edgeId = asString((ev as EdgeAddedEvent).edge_id);
      if (edgeId !== undefined) {
        edgeEndpoints.set(edgeId, {
          source: asString((ev as EdgeAddedEvent).source_id),
          target: asString((ev as EdgeAddedEvent).target_id),
        });
      }
    }
  }

  const touches = (ev: JournalEvent): boolean => {
    if (asString(ev.node_id) === nodeId) return true;
    if (ev.type === "edge.added") {
      const edge = ev as EdgeAddedEvent;
      return asString(edge.source_id) === nodeId || asString(edge.target_id) === nodeId;
    }
    if (ev.type === "edge.removed") {
      const edgeId = asString(ev.edge_id);
      const ends = edgeId !== undefined ? edgeEndpoints.get(edgeId) : undefined;
      return Boolean(ends && (ends.source === nodeId || ends.target === nodeId));
    }
    return false;
  };

  return orderEvents(events.filter(touches));
}

// --- Changelog -----------------------------------------------------------

/**
 * The ordered slice of events between two `release.tagged` markers
 * (docs/spec/journal.md:92,103). Both markers are boundaries and are excluded
 * from `events`.
 */
export interface Changelog {
  /** The earlier marker's version, or `null` when the slice starts at the journal's beginning. */
  fromVersion: string | null;
  /** The later marker's version — the release this changelog describes. */
  toVersion: string;
  /** Set when the `to` marker is platform-scoped; `events` is then filtered to that platform. */
  platform?: PlatformId;
  /** The events strictly between the two markers, in journal order. */
  events: JournalEvent[];
}

export interface ChangelogOptions {
  /**
   * The earlier boundary. Omit to use the `release.tagged` marker immediately
   * preceding `toVersion`; pass `null` to start from the journal's beginning.
   */
  fromVersion?: string | null;
  /**
   * Snapshot nodes keyed by id, used only to resolve platform filtering when the
   * `to` marker is platform-scoped. Absent → a platform-scoped changelog keeps
   * only events that name the platform themselves (e.g. `node.status_changed`).
   */
  nodesById?: ReadonlyMap<string, Pick<Node, "platforms">>;
}

/** Does an event fall within a platform-scoped release's changelog? */
function eventAffectsPlatform(
  ev: JournalEvent,
  platform: PlatformId,
  nodesById?: ReadonlyMap<string, Pick<Node, "platforms">>,
): boolean {
  // An event that carries its own platform speaks for that platform directly
  // (a per-platform status change, a platform-scoped release marker).
  const ownPlatform = asString(ev.platform);
  if (ownPlatform !== undefined) return ownPlatform === platform;

  if (!nodesById) return false;

  const onPlatform = (id: unknown): boolean => {
    const nodeId = asString(id);
    return nodeId !== undefined && (nodesById.get(nodeId)?.platforms.includes(platform) ?? false);
  };

  if (onPlatform(ev.node_id)) return true;
  if (ev.type === "edge.added") {
    const edge = ev as EdgeAddedEvent;
    return onPlatform(edge.source_id) || onPlatform(edge.target_id);
  }
  return false;
}

/**
 * The changelog for release `toVersion`: the ordered events between its
 * `release.tagged` marker and the previous one (both markers excluded). When
 * `toVersion`'s marker is platform-scoped, the slice is filtered to events
 * affecting that platform's nodes (docs/spec/journal.md:92). A `toVersion` with
 * no matching marker — including an empty journal — yields an empty changelog.
 */
export function computeChangelog(
  events: readonly JournalEvent[],
  toVersion: string,
  options: ChangelogOptions = {},
): Changelog {
  const ordered = orderEvents(events);
  const isRelease = (ev: JournalEvent, version: string): boolean =>
    ev.type === "release.tagged" && asString((ev as ReleaseTaggedEvent).version) === version;

  // The `to` marker: last matching, so a re-tagged version resolves to the latest.
  let toIndex = -1;
  for (let i = ordered.length - 1; i >= 0; i -= 1) {
    if (isRelease(ordered[i], toVersion)) {
      toIndex = i;
      break;
    }
  }
  if (toIndex === -1) {
    return { fromVersion: null, toVersion, events: [] };
  }

  const platform = asString((ordered[toIndex] as ReleaseTaggedEvent).platform) as PlatformId | undefined;

  // The `from` boundary index.
  let fromIndex = -1;
  if (options.fromVersion === null) {
    fromIndex = -1; // explicit: from the beginning
  } else if (typeof options.fromVersion === "string") {
    for (let i = 0; i < toIndex; i += 1) {
      if (isRelease(ordered[i], options.fromVersion)) {
        fromIndex = i;
        break;
      }
    }
  } else {
    // Default: the release marker immediately preceding `toIndex`.
    for (let i = toIndex - 1; i >= 0; i -= 1) {
      if (ordered[i].type === "release.tagged") {
        fromIndex = i;
        break;
      }
    }
  }

  let slice = ordered.slice(fromIndex + 1, toIndex);
  if (platform) {
    slice = slice.filter((ev) => eventAffectsPlatform(ev, platform, options.nodesById));
  }

  return {
    fromVersion: fromIndex >= 0 ? asString((ordered[fromIndex] as ReleaseTaggedEvent).version) ?? null : null,
    toVersion,
    ...(platform ? { platform } : {}),
    events: slice,
  };
}

// --- Backlog -------------------------------------------------------------

/** Open ideas and requests (docs/spec/journal.md:105). */
export interface Backlog {
  /** Open `idea.proposed` items, in journal order. */
  ideas: IdeaProposedEvent[];
  /** Open `request.filed` items, in journal order. */
  requests: RequestFiledEvent[];
  /** Open ideas and requests interleaved, in journal order. */
  items: (IdeaProposedEvent | RequestFiledEvent)[];
}

export interface BacklogOptions {
  /**
   * Ids of nodes that currently exist — the authoritative snapshot. An item
   * whose `node_id` is present here has a linked node and is closed. When
   * omitted, existence is derived from the journal's `node.created` /
   * `node.deleted` events instead.
   */
  existingNodeIds?: ReadonlySet<string>;
}

/** Nodes that exist after replaying the journal's create/delete events. */
function deriveExistingNodeIds(orderedEvents: readonly JournalEvent[]): Set<string> {
  const existing = new Set<string>();
  for (const ev of orderedEvents) {
    const nodeId = asString(ev.node_id);
    if (nodeId === undefined) continue;
    if (ev.type === "node.created") existing.add(nodeId);
    else if (ev.type === "node.deleted") existing.delete(nodeId);
  }
  return existing;
}

/**
 * The open backlog: every `idea.proposed` / `request.filed` that has not yet
 * been resolved. An item is *open* until a linked node exists — its `node_id`
 * points at a node in the snapshot (or, when no snapshot is supplied, at a node
 * the journal created and has not deleted). An item with no `node_id`, or one
 * whose linked node no longer exists, stays open. An empty journal yields an
 * empty backlog.
 */
export function computeBacklog(events: readonly JournalEvent[], options: BacklogOptions = {}): Backlog {
  const ordered = orderEvents(events);
  const existing = options.existingNodeIds ?? deriveExistingNodeIds(ordered);

  const items: (IdeaProposedEvent | RequestFiledEvent)[] = [];
  for (const ev of ordered) {
    if (ev.type !== "idea.proposed" && ev.type !== "request.filed") continue;
    const linkedId = asString(ev.node_id);
    const closed = linkedId !== undefined && existing.has(linkedId);
    if (!closed) items.push(ev as IdeaProposedEvent | RequestFiledEvent);
  }

  return {
    ideas: items.filter((item): item is IdeaProposedEvent => item.type === "idea.proposed"),
    requests: items.filter((item): item is RequestFiledEvent => item.type === "request.filed"),
    items,
  };
}
