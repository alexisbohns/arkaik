import { SPECIES, type SpeciesId } from "@/lib/config/species";
import { getCountedStatuses, type CountedStatusPresetId, type StatusId } from "@/lib/config/statuses";
import type { Edge, JournalEvent, Node, ReleaseTaggedEvent } from "@/lib/data/types";
import { computeDeliveryItems, groupItemsByStatus } from "@/lib/utils/delivery";
import { computeBacklog, computeChangelog } from "@/lib/utils/journal";
import { addEffectiveNodeToRollup, createEmptyRollup, type PlatformStatusRollup } from "@/lib/utils/platform-status";
import { orderEvents } from "@arkaik/schema";

/**
 * Overview projections — the strategist reading over (snapshot, journal)
 * (vision.md § Core Product, Overview; docs/spec/maps.md § Overview
 * Composition). Same doctrine as lib/utils/delivery.ts: pure, deterministic,
 * minimal inputs, JSON-serializable results — the app renders these, and the
 * MCP server (CP-F) will serve the identical aggregations to agents.
 */

// --- Inventory: the census ---------------------------------------------------

export interface SpeciesInventory {
  species: SpeciesId;
  total: number;
  /** Node-level statuses (a view's per-platform overrides are the gauges' business, not the census's). */
  byStatus: Partial<Record<StatusId, number>>;
}

export interface Inventory {
  nodeCount: number;
  edgeCount: number;
  journalEventCount: number;
  /** One entry per known species, in SPECIES config order — zeroes included. */
  species: SpeciesInventory[];
}

export function computeInventory(
  nodes: readonly Pick<Node, "species" | "status">[],
  edges: readonly Pick<Edge, "id">[],
  events: readonly JournalEvent[],
): Inventory {
  const bySpecies = new Map<SpeciesId, SpeciesInventory>(
    SPECIES.map((species) => [species.id, { species: species.id, total: 0, byStatus: {} }]),
  );

  for (const node of nodes) {
    const entry = bySpecies.get(node.species);
    if (!entry) continue;
    entry.total += 1;
    entry.byStatus[node.status] = (entry.byStatus[node.status] ?? 0) + 1;
  }

  return {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    journalEventCount: events.length,
    species: [...bySpecies.values()],
  };
}

// --- Platform gauges: the whole-product view-delivery rollup ------------------

/**
 * Reduce views into one product-wide rollup — the source for the overview
 * page's product-wide per-platform gauge. Only views contribute (filtered
 * explicitly here) and only counted-preset statuses are tallied — the same
 * reading as the flow cards' gauges, at product scale. Feeds
 * `getPlatformRollupSegments` / `PlatformGaugeList` directly.
 *
 * The view filter is explicit rather than relying on `getEditablePlatformStatuses`
 * returning `{}` for other species: that helper now also seeds the acceptance
 * editor (view + acceptance), so acceptances would otherwise leak into this
 * product-delivery gauge. Views covered by acceptances contribute their
 * acceptance-derived (effective) per-platform statuses via the rollup seam
 * (`addEffectiveNodeToRollup`); uncovered views fall back to their stored
 * statuses.
 */
export function computeProductRollup(
  nodes: readonly Node[],
  edges: readonly Edge[],
  presetId?: CountedStatusPresetId,
): PlatformStatusRollup {
  return nodes
    .filter((node) => node.species === "view")
    .reduce(
      (rollup, node) => addEffectiveNodeToRollup(rollup, node, nodes, edges, presetId),
      createEmptyRollup(),
    );
}

// --- Release pulse -------------------------------------------------------------

export interface ReleasePulseEntry {
  version: string;
  ts: string;
  platform?: ReleaseTaggedEvent["platform"];
  notes?: string;
  /** The release.tagged event id — a stable key. */
  eventId: string;
  /** Events inside this release per computeChangelog (boundary markers excluded). */
  eventCount: number;
}

/**
 * Every tagged release, newest first. A version tagged more than once resolves
 * to its latest marker — `computeChangelog`'s own rule, so the pulse and the
 * changelog page can never disagree about what a version means.
 */
export function computeReleasePulse(
  events: readonly JournalEvent[],
  options: { nodesById?: ReadonlyMap<string, Pick<Node, "platforms">> } = {},
): ReleasePulseEntry[] {
  const ordered = orderEvents(events);
  const latestByVersion = new Map<string, ReleaseTaggedEvent>();

  for (const event of ordered) {
    if (event.type !== "release.tagged") continue;
    const tag = event as ReleaseTaggedEvent;
    latestByVersion.set(tag.version, tag);
  }

  return [...latestByVersion.values()]
    .sort((a, b) => (a.ts === b.ts ? (a.id < b.id ? 1 : -1) : a.ts < b.ts ? 1 : -1))
    .map((tag) => ({
      version: tag.version,
      ts: tag.ts,
      ...(tag.platform !== undefined ? { platform: tag.platform } : {}),
      ...(tag.notes !== undefined ? { notes: tag.notes } : {}),
      eventId: tag.id,
      eventCount: computeChangelog(events, tag.version, { nodesById: options.nodesById }).events.length,
    }));
}

// --- Delivery snapshot: the board's column totals --------------------------------

export interface DeliverySnapshot {
  /** One entry per requested status, in the given column order. */
  statuses: { status: StatusId; count: number }[];
  totalItems: number;
}

/**
 * The Delivery board's numbers without the board: (node × platform) items via
 * `computeDeliveryItems`, bucketed by `groupItemsByStatus`. Defaults mirror
 * the board's defaults (views, counted-preset columns).
 */
export function computeDeliverySnapshot(
  nodes: readonly Node[],
  species: readonly SpeciesId[] = ["view"],
  statuses: readonly StatusId[] = getCountedStatuses(),
): DeliverySnapshot {
  const items = computeDeliveryItems(nodes, species);
  const groups = groupItemsByStatus(items, statuses);

  const statusCounts = statuses.map((status) => ({ status, count: groups.get(status)?.length ?? 0 }));
  return {
    statuses: statusCounts,
    totalItems: statusCounts.reduce((sum, entry) => sum + entry.count, 0),
  };
}

// --- Health indicators ------------------------------------------------------------

export type HealthIndicatorId =
  | "unreachable-from-root"
  | "views-without-screenshot"
  | "nodes-without-description"
  | "disconnected-nodes"
  | "open-backlog";

export interface HealthIndicator {
  id: HealthIndicatorId;
  label: string;
  /** Offending count — 0 means healthy. */
  count: number;
  /** Denominator, when one is meaningful. */
  total?: number;
  /** Offending node ids, sorted (absent for open-backlog — those are events, not nodes). */
  nodeIds?: string[];
}

/**
 * Flow/view ids the journey can never reach: **directed** BFS over `composes`
 * edges (source → target) from the root. Directed is the journey's own
 * traversal direction — an undirected walk would absolve an orphan flow that
 * merely *composes into* reachable views (docs/spec/maps.md § Orphans).
 * Data models and API endpoints are out of scope: composes never reaches
 * them by design. An unset or unresolvable root yields `[]`, never an error —
 * the § Subgraph Algorithm rule-4 posture.
 */
export function computeUnreachableFromRoot(
  nodes: readonly Pick<Node, "id" | "species">[],
  edges: readonly Pick<Edge, "source_id" | "target_id" | "edge_type">[],
  rootNodeId: string | null | undefined,
): string[] {
  const eligibleIds = new Set(
    nodes.filter((node) => node.species === "flow" || node.species === "view").map((node) => node.id),
  );
  if (!rootNodeId || !eligibleIds.has(rootNodeId)) {
    return [];
  }

  const childrenByParent = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.edge_type !== "composes") continue;
    if (!eligibleIds.has(edge.source_id) || !eligibleIds.has(edge.target_id)) continue;
    const children = childrenByParent.get(edge.source_id);
    if (children) children.push(edge.target_id);
    else childrenByParent.set(edge.source_id, [edge.target_id]);
  }

  const visited = new Set<string>([rootNodeId]);
  const queue = [rootNodeId];
  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    for (const childId of childrenByParent.get(nodeId) ?? []) {
      if (visited.has(childId)) continue;
      visited.add(childId);
      queue.push(childId);
    }
  }

  return [...eligibleIds].filter((id) => !visited.has(id)).sort();
}

function hasScreenshot(node: Pick<Node, "metadata">): boolean {
  const screenshots = node.metadata?.platformScreenshots;
  if (!screenshots) return false;
  return Object.values(screenshots).some((value) => typeof value === "string" && value.length > 0);
}

/**
 * The dashboard's doc-health row (fixed order, deterministic). Labels live
 * here beside the data, like `STATUSES`; link targets are presentation and
 * live in the HealthCard.
 */
export function computeHealthIndicators(
  nodes: readonly Node[],
  edges: readonly Edge[],
  events: readonly JournalEvent[],
  options: { rootNodeId?: string | null } = {},
): HealthIndicator[] {
  const flowAndViewCount = nodes.filter((node) => node.species === "flow" || node.species === "view").length;
  const unreachable = computeUnreachableFromRoot(nodes, edges, options.rootNodeId);

  const views = nodes.filter((node) => node.species === "view");
  const viewsWithoutScreenshot = views.filter((node) => !hasScreenshot(node)).map((node) => node.id).sort();

  const withoutDescription = nodes.filter((node) => !node.description?.trim()).map((node) => node.id).sort();

  const connectedIds = new Set<string>();
  for (const edge of edges) {
    connectedIds.add(edge.source_id);
    connectedIds.add(edge.target_id);
  }
  const disconnected = nodes.filter((node) => !connectedIds.has(node.id)).map((node) => node.id).sort();

  const existingNodeIds = new Set(nodes.map((node) => node.id));
  const backlog = computeBacklog(events, { existingNodeIds });

  return [
    {
      id: "unreachable-from-root",
      label: "Unreachable from root",
      count: unreachable.length,
      total: flowAndViewCount,
      nodeIds: unreachable,
    },
    {
      id: "views-without-screenshot",
      label: "Views without screenshots",
      count: viewsWithoutScreenshot.length,
      total: views.length,
      nodeIds: viewsWithoutScreenshot,
    },
    {
      id: "nodes-without-description",
      label: "Nodes without descriptions",
      count: withoutDescription.length,
      total: nodes.length,
      nodeIds: withoutDescription,
    },
    {
      id: "disconnected-nodes",
      label: "Disconnected nodes",
      count: disconnected.length,
      total: nodes.length,
      nodeIds: disconnected,
    },
    {
      id: "open-backlog",
      label: "Open backlog items",
      count: backlog.items.length,
    },
  ];
}
