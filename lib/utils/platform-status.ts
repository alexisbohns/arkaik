import { PLATFORMS, type PlatformId } from "@/lib/config/platforms";
import {
  DEFAULT_COUNTED_STATUS_PRESET_ID,
  getCountedStatuses,
  isCountedStatus,
  STATUS_ORDER,
  type CountedStatusPresetId,
  type StatusId,
} from "@/lib/config/statuses";
import type { Edge, Node, PlaylistEntry, PlatformStatusMap } from "@/lib/data/types";

export type PlatformStatusCounts = Partial<Record<PlatformId, Partial<Record<StatusId, number>>>>;
export type PlatformTotals = Partial<Record<PlatformId, number>>;

export interface PlatformStatusRollup {
  counts: PlatformStatusCounts;
  totals: PlatformTotals;
}

function sortStatusesDescending(left: StatusId, right: StatusId) {
  return STATUS_ORDER[right] - STATUS_ORDER[left];
}

export function getNodePlatformStatuses(node: Pick<Node, "species" | "status" | "platforms" | "metadata">): PlatformStatusMap {
  const metadataStatuses = node.metadata?.platformStatuses;
  const statuses: PlatformStatusMap = {};

  for (const platformId of node.platforms) {
    statuses[platformId] = metadataStatuses?.[platformId] ?? node.status;
  }

  return statuses;
}

export function hasExplicitPlatformStatuses(node: Pick<Node, "metadata">): boolean {
  return Boolean(node.metadata?.platformStatuses);
}

/**
 * Per-platform statuses that seed an editable `PlatformVariants` control.
 * Returns a full map (override ?? node.status per platform) for the species
 * that own a per-platform status editor — `view` and `acceptance` — and `{}`
 * for every other species. Callers that must stay views-only (e.g. the
 * product-delivery rollup in `computeProductRollup`) filter by species
 * themselves rather than relying on this returning `{}` for acceptances.
 */
export function getEditablePlatformStatuses(node: Pick<Node, "species" | "status" | "platforms" | "metadata">): PlatformStatusMap {
  if (node.species !== "view" && node.species !== "acceptance") {
    return {};
  }

  return getNodePlatformStatuses(node);
}

/**
 * Acceptance nodes whose `covers` edge targets `anchorId` (incoming covers).
 *
 * Mirrors @arkaik/schema's acceptancesCovering — duplicated (not imported) to
 * keep this module's @arkaik/schema imports type-only, so the effective-status
 * test harness needn't build the schema package.
 */
function coveringAcceptances(
  anchorId: string,
  nodes: readonly Node[],
  edges: readonly Edge[],
): Node[] {
  const coveringIds = new Set(
    edges
      .filter((edge) => edge.edge_type === "covers" && edge.target_id === anchorId)
      .map((edge) => edge.source_id),
  );
  return nodes.filter((node) => node.species === "acceptance" && coveringIds.has(node.id));
}

/** The less-advanced of two statuses, by lifecycle order (STATUS_ORDER). */
function weakerStatus(left: StatusId, right: StatusId): StatusId {
  return STATUS_ORDER[left] <= STATUS_ORDER[right] ? left : right;
}

/**
 * A view's **effective** per-platform statuses (spec §3.4): when acceptances
 * cover the view, each platform's status is the *weakest* (least-advanced)
 * resolved status among the covering acceptances applicable to it — a view is
 * only as shipped on a platform as its laggiest promise. A view no acceptance
 * covers falls back to its stored `platformStatuses`. Non-view species always
 * use their stored statuses (acceptances resolve their own overrides).
 *
 * A view platform that no covering acceptance speaks to is omitted — an honest
 * empty rather than an invented status.
 */
export function getEffectivePlatformStatuses(
  node: Pick<Node, "id" | "species" | "status" | "platforms" | "metadata">,
  nodes: readonly Node[],
  edges: readonly Edge[],
): PlatformStatusMap {
  if (node.species !== "view") {
    return getNodePlatformStatuses(node);
  }

  const covering = coveringAcceptances(node.id, nodes, edges);
  if (covering.length === 0) {
    return getNodePlatformStatuses(node);
  }

  const byPlatform: Partial<Record<PlatformId, StatusId>> = {};
  for (const acceptance of covering) {
    const resolved = getNodePlatformStatuses(acceptance);
    for (const platformId of Object.keys(resolved) as PlatformId[]) {
      const status = resolved[platformId];
      if (!status) continue;
      const current = byPlatform[platformId];
      byPlatform[platformId] = current ? weakerStatus(current, status) : status;
    }
  }

  const effective: PlatformStatusMap = {};
  for (const platformId of node.platforms) {
    const status = byPlatform[platformId];
    if (status) effective[platformId] = status;
  }
  return effective;
}

/**
 * Add a node's **effective** per-platform statuses to a rollup — the seam-aware
 * twin of `addNodeToRollup`. For views this reflects covering acceptances;
 * acceptances contribute their own stored statuses. Unlike `addNodeToRollup`, a
 * non-view/non-acceptance node also contributes its stored per-platform statuses
 * here rather than nothing — pass only views/acceptances unless you intend that.
 */
export function addEffectiveNodeToRollup(
  rollup: PlatformStatusRollup,
  node: Pick<Node, "id" | "species" | "status" | "platforms" | "metadata">,
  nodes: readonly Node[],
  edges: readonly Edge[],
  presetId: CountedStatusPresetId = DEFAULT_COUNTED_STATUS_PRESET_ID,
): PlatformStatusRollup {
  const statuses = getEffectivePlatformStatuses(node, nodes, edges);

  return Object.entries(statuses).reduce((currentRollup, [platformId, status]) => {
    if (!status) {
      return currentRollup;
    }
    return addPlatformStatusToRollup(currentRollup, platformId as PlatformId, status, presetId);
  }, rollup);
}

export function createEmptyRollup(): PlatformStatusRollup {
  return { counts: {}, totals: {} };
}

export function addPlatformStatusToRollup(
  rollup: PlatformStatusRollup,
  platformId: PlatformId,
  status: StatusId,
  presetId: CountedStatusPresetId = DEFAULT_COUNTED_STATUS_PRESET_ID,
) {
  if (!isCountedStatus(status, presetId)) {
    return rollup;
  }

  const nextCounts = {
    ...rollup.counts,
    [platformId]: {
      ...rollup.counts[platformId],
      [status]: (rollup.counts[platformId]?.[status] ?? 0) + 1,
    },
  };
  const nextTotals = {
    ...rollup.totals,
    [platformId]: (rollup.totals[platformId] ?? 0) + 1,
  };

  return { counts: nextCounts, totals: nextTotals };
}

export function addNodeToRollup(
  rollup: PlatformStatusRollup,
  node: Pick<Node, "species" | "status" | "platforms" | "metadata">,
  presetId: CountedStatusPresetId = DEFAULT_COUNTED_STATUS_PRESET_ID,
) {
  const platformStatuses = getEditablePlatformStatuses(node);

  return Object.entries(platformStatuses).reduce((currentRollup, [platformId, status]) => {
    if (!status) {
      return currentRollup;
    }

    return addPlatformStatusToRollup(currentRollup, platformId as PlatformId, status, presetId);
  }, rollup);
}

export function mergeRollups(...rollups: PlatformStatusRollup[]): PlatformStatusRollup {
  return rollups.reduce((merged, rollup) => {
    let nextRollup = merged;

    for (const platformId of Object.keys(rollup.counts) as PlatformId[]) {
      const platformCounts = rollup.counts[platformId];
      if (!platformCounts) continue;

      for (const status of Object.keys(platformCounts) as StatusId[]) {
        const count = platformCounts[status] ?? 0;
        for (let index = 0; index < count; index += 1) {
          nextRollup = addPlatformStatusToRollup(nextRollup, platformId, status);
        }
      }
    }

    return nextRollup;
  }, createEmptyRollup());
}

export function getPlatformRollupSegments(
  rollup: PlatformStatusRollup,
  platformId: PlatformId,
  presetId: CountedStatusPresetId = DEFAULT_COUNTED_STATUS_PRESET_ID,
) {
  const total = rollup.totals[platformId] ?? 0;
  const countedStatuses = getCountedStatuses(presetId);

  return [...countedStatuses].sort(sortStatusesDescending).map((status) => {
    const count = rollup.counts[platformId]?.[status] ?? 0;
    const ratio = total === 0 ? 0 : count / total;

    return {
      status,
      count,
      ratio,
      percentage: Math.round(ratio * 100),
    };
  });
}

export function getRollupPlatforms(rollup: PlatformStatusRollup): PlatformId[] {
  return PLATFORMS
    .map((platform) => platform.id)
    .filter((platformId) => (rollup.totals[platformId] ?? 0) > 0 || Boolean(rollup.counts[platformId]));
}

export function getRollupDisplayStatus(
  rollup: PlatformStatusRollup,
  fallbackStatus: StatusId,
  presetId: CountedStatusPresetId = DEFAULT_COUNTED_STATUS_PRESET_ID,
): StatusId {
  const countedStatuses = [...getCountedStatuses(presetId)].sort(sortStatusesDescending);

  for (const status of countedStatuses) {
    const hasStatus = Object.values(rollup.counts).some((platformCounts) => (platformCounts?.[status] ?? 0) > 0);
    if (hasStatus) {
      return status;
    }
  }

  return fallbackStatus;
}

function computePlaylistRollupRecursive(
  entries: PlaylistEntry[],
  nodesById: ReadonlyMap<string, Pick<Node, "id" | "species" | "status" | "platforms" | "metadata">>,
  visited: Set<string>,
  nodes: readonly Node[],
  edges: readonly Edge[],
): PlatformStatusRollup {
  let rollup = createEmptyRollup();

  for (const entry of entries) {
    if (entry.type === "view") {
      const viewNode = nodesById.get(entry.view_id);
      if (viewNode) {
        rollup = addEffectiveNodeToRollup(rollup, viewNode, nodes, edges);
      }
      continue;
    }

    if (entry.type === "flow") {
      if (!visited.has(entry.flow_id)) {
        visited.add(entry.flow_id);
        const flowNode = nodesById.get(entry.flow_id);
        const subEntries = flowNode?.metadata?.playlist?.entries;
        if (Array.isArray(subEntries)) {
          rollup = mergeRollups(rollup, computePlaylistRollupRecursive(subEntries, nodesById, visited, nodes, edges));
        }
        visited.delete(entry.flow_id);
      }
      continue;
    }

    if (entry.type === "condition") {
      rollup = mergeRollups(
        rollup,
        computePlaylistRollupRecursive(entry.if_true, nodesById, visited, nodes, edges),
        computePlaylistRollupRecursive(entry.if_false, nodesById, visited, nodes, edges),
      );
      continue;
    }

    if (entry.type === "junction") {
      rollup = mergeRollups(
        rollup,
        ...entry.cases.map((c) => computePlaylistRollupRecursive(c.entries, nodesById, visited, nodes, edges)),
      );
    }
  }

  return rollup;
}

export function computePlaylistRollup(
  entries: PlaylistEntry[],
  nodesById: ReadonlyMap<string, Pick<Node, "id" | "species" | "status" | "platforms" | "metadata">>,
  nodes: readonly Node[] = [],
  edges: readonly Edge[] = [],
): PlatformStatusRollup {
  return computePlaylistRollupRecursive(entries, nodesById, new Set(), nodes, edges);
}

/**
 * A flow's effective platform rollup (spec §3.4, flow extended): its playlist's
 * (effective) view rollup **plus** the resolved statuses of acceptances covering
 * the flow directly. Directly-covering acceptances are distinct from the ones
 * covering descendant views, so this is purely additive — no double counting.
 */
export function computeFlowPlatformRollup(
  flowNode: Pick<Node, "id" | "metadata">,
  nodesById: ReadonlyMap<string, Pick<Node, "id" | "species" | "status" | "platforms" | "metadata">>,
  nodes: readonly Node[],
  edges: readonly Edge[],
): PlatformStatusRollup {
  const entries = Array.isArray(flowNode.metadata?.playlist?.entries) ? flowNode.metadata.playlist.entries : [];
  let rollup = computePlaylistRollup(entries, nodesById, nodes, edges);

  for (const acceptance of coveringAcceptances(flowNode.id, nodes, edges)) {
    const resolved = getNodePlatformStatuses(acceptance);
    for (const platformId of Object.keys(resolved) as PlatformId[]) {
      const status = resolved[platformId];
      if (status) {
        rollup = addPlatformStatusToRollup(rollup, platformId, status);
      }
    }
  }

  return rollup;
}
