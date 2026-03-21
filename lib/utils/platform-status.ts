import { PLATFORMS, type PlatformId } from "@/lib/config/platforms";
import {
  DEFAULT_COUNTED_STATUS_PRESET_ID,
  getCountedStatuses,
  isCountedStatus,
  STATUS_ORDER,
  type CountedStatusPresetId,
  type StatusId,
} from "@/lib/config/statuses";
import type { Node, PlaylistEntry, PlatformStatusMap } from "@/lib/data/types";

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

export function getEditablePlatformStatuses(node: Pick<Node, "species" | "status" | "platforms" | "metadata">): PlatformStatusMap {
  if (node.species !== "view") {
    return {};
  }

  return getNodePlatformStatuses(node);
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
  nodesById: ReadonlyMap<string, Pick<Node, "species" | "status" | "platforms" | "metadata">>,
  visited: Set<string>,
): PlatformStatusRollup {
  let rollup = createEmptyRollup();

  for (const entry of entries) {
    if (entry.type === "view") {
      const viewNode = nodesById.get(entry.view_id);
      if (viewNode) {
        rollup = addNodeToRollup(rollup, viewNode);
      }
      continue;
    }

    if (entry.type === "flow") {
      if (!visited.has(entry.flow_id)) {
        visited.add(entry.flow_id);
        const flowNode = nodesById.get(entry.flow_id);
        const subEntries = flowNode?.metadata?.playlist?.entries;
        if (Array.isArray(subEntries)) {
          rollup = mergeRollups(rollup, computePlaylistRollupRecursive(subEntries, nodesById, visited));
        }
        visited.delete(entry.flow_id);
      }
      continue;
    }

    if (entry.type === "condition") {
      rollup = mergeRollups(
        rollup,
        computePlaylistRollupRecursive(entry.if_true, nodesById, visited),
        computePlaylistRollupRecursive(entry.if_false, nodesById, visited),
      );
      continue;
    }

    if (entry.type === "junction") {
      rollup = mergeRollups(
        rollup,
        ...entry.cases.map((c) => computePlaylistRollupRecursive(c.entries, nodesById, visited)),
      );
    }
  }

  return rollup;
}

export function computePlaylistRollup(
  entries: PlaylistEntry[],
  nodesById: ReadonlyMap<string, Pick<Node, "species" | "status" | "platforms" | "metadata">>,
): PlatformStatusRollup {
  return computePlaylistRollupRecursive(entries, nodesById, new Set());
}