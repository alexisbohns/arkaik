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
import { isBlocked } from "@/lib/utils/blocked";

export type PlatformStatusCounts = Partial<Record<PlatformId, Partial<Record<StatusId, number>>>>;
export type PlatformTotals = Partial<Record<PlatformId, number>>;

/**
 * Invariant: for every platform `p`, `totals[p]` equals the sum of
 * `counts[p]`'s counted statuses — maintained by `addPlatformStatusToRollup`
 * and rebuilt from scratch by `mergeRollups`. A rollup that violates this
 * yields segments whose `count` and `ratio` disagree.
 */
export interface PlatformStatusRollup {
  counts: PlatformStatusCounts;
  totals: PlatformTotals;
  /** Nodes in this rollup carrying a non-empty `metadata.blocked_by`. Absent reads as 0. */
  blocked?: number;
}

/**
 * Severity precedence for `getRollupDisplayStatus` — the highest `STATUS_ORDER`
 * among a rollup's counted statuses wins, so among the `delivery` preset
 * (backlog, development, releasing, live) a rollup with anything already
 * `live` reports `live` ahead of `development` or `backlog`, most-advanced
 * status first. That value colors graph nodes (`system-graph.ts`,
 * `journey-graph.ts`). This is **not** a display order — rings and bars use
 * `compareStatusesForDisplay`.
 */
function compareStatusesBySeverity(left: StatusId, right: StatusId) {
  return STATUS_ORDER[right] - STATUS_ORDER[left];
}

/**
 * Display order for status segments — lifecycle-descending, so a ring reads
 * Live → Releasing → Development → Backlog. The historical pin that held
 * `blocked` last is gone along with the `blocked` status itself (now
 * `metadata.blocked_by`, which does not participate in this ordering). Shared
 * by the rings and the `PlatformGaugeList` bars so the two can never disagree.
 */
export function compareStatusesForDisplay(left: StatusId, right: StatusId) {
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

  const next = Object.entries(statuses).reduce((currentRollup, [platformId, status]) => {
    if (!status) {
      return currentRollup;
    }
    return addPlatformStatusToRollup(currentRollup, platformId as PlatformId, status, presetId);
  }, rollup);

  return isBlocked(node) ? { ...next, blocked: (next.blocked ?? 0) + 1 } : next;
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

  // Spread `rollup` first so fields this function doesn't know about (e.g.
  // `blocked`) survive — every caller that rebuilds a rollup by repeatedly
  // calling this (addNodeToRollup, mergeRollups) would otherwise silently
  // drop them on the first status added after such a field was set.
  return { ...rollup, counts: nextCounts, totals: nextTotals };
}

export function addNodeToRollup(
  rollup: PlatformStatusRollup,
  node: Pick<Node, "species" | "status" | "platforms" | "metadata">,
  presetId: CountedStatusPresetId = DEFAULT_COUNTED_STATUS_PRESET_ID,
) {
  const platformStatuses = getEditablePlatformStatuses(node);

  const next = Object.entries(platformStatuses).reduce((currentRollup, [platformId, status]) => {
    if (!status) {
      return currentRollup;
    }

    return addPlatformStatusToRollup(currentRollup, platformId as PlatformId, status, presetId);
  }, rollup);

  return isBlocked(node) ? { ...next, blocked: (next.blocked ?? 0) + 1 } : next;
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

    const blocked = (nextRollup.blocked ?? 0) + (rollup.blocked ?? 0);
    return blocked > 0 ? { ...nextRollup, blocked } : nextRollup;
  }, createEmptyRollup());
}

/** One counted status's share of a ring or bar. Always one entry per counted status, zeros included. */
export interface StatusSegment {
  status: StatusId;
  count: number;
  ratio: number;
  percentage: number;
}

function buildSegments(
  countFor: (status: StatusId) => number,
  total: number,
  presetId: CountedStatusPresetId,
): StatusSegment[] {
  return [...getCountedStatuses(presetId)].sort(compareStatusesForDisplay).map((status) => {
    const count = countFor(status);
    const ratio = total === 0 ? 0 : count / total;

    return { status, count, ratio, percentage: Math.round(ratio * 100) };
  });
}

export function getPlatformRollupSegments(
  rollup: PlatformStatusRollup,
  platformId: PlatformId,
  presetId: CountedStatusPresetId = DEFAULT_COUNTED_STATUS_PRESET_ID,
): StatusSegment[] {
  return buildSegments(
    (status) => rollup.counts[platformId]?.[status] ?? 0,
    rollup.totals[platformId] ?? 0,
    presetId,
  );
}

/**
 * The same segments, summed across every platform — the global ring. Percentages
 * divide by the grand total, so one acceptance live on three platforms counts
 * three times here, exactly as it does across the three platform rings.
 */
export function getRollupTotalSegments(
  rollup: PlatformStatusRollup,
  presetId: CountedStatusPresetId = DEFAULT_COUNTED_STATUS_PRESET_ID,
): StatusSegment[] {
  const total = PLATFORMS.reduce((sum, platform) => sum + (rollup.totals[platform.id] ?? 0), 0);

  return buildSegments(
    (status) =>
      PLATFORMS.reduce((sum, platform) => sum + (rollup.counts[platform.id]?.[status] ?? 0), 0),
    total,
    presetId,
  );
}

export function getRollupPlatforms(rollup: PlatformStatusRollup): PlatformId[] {
  return PLATFORMS
    .map((platform) => platform.id)
    .filter((platformId) => (rollup.totals[platformId] ?? 0) > 0 || Boolean(rollup.counts[platformId]));
}

/**
 * `platforms` widened by whatever the rollup actually counted, in config order.
 *
 * The union `PlatformGaugeList` used to apply internally, hoisted to the callers
 * that genuinely want it. A flow declares its own `platforms`, but its rollup is
 * aggregated from descendant views and covering acceptances, which can speak to
 * a platform the flow itself never lists — dropping those bars would hide
 * counted work. The seed has exactly one such flow (`F-swap-glyph` declares
 * web/ios, its rollup counts android via `V-glyphs-list`), which is enough to
 * make the widening load-bearing rather than hypothetical.
 *
 * **Under a product scope, clamp — do not drop the widening.** That composition
 * is {@link scopedRollupPlatforms}; call it rather than rewriting it.
 */
export function withRollupPlatforms(
  platforms: readonly PlatformId[],
  rollup: PlatformStatusRollup,
): PlatformId[] {
  const widened = new Set<PlatformId>([...platforms, ...getRollupPlatforms(rollup)]);
  return PLATFORMS.map((platform) => platform.id).filter((platformId) => widened.has(platformId));
}

/**
 * {@link withRollupPlatforms}, clamped to a product scope's platform menu.
 *
 * **A filter on top of the widening, never a replacement for it.** Under "All
 * products" `scopePlatforms` is the union of every declared product's menu, so a
 * platform the rollup counted but the flow never declared is still in it and the
 * bar survives — today's behavior, exactly preserved. Under a web-only scope the
 * menu is `["web"]` and that widened android bar clamps out, which is the whole
 * point of the feature. Passing `scopedPlatforms(node, scope)` straight through
 * instead would drop counted work in the unscoped case, which is the common one;
 * clamping loses it only where the product genuinely cannot ship that platform.
 *
 * The seed has exactly one flow that exercises this — `F-swap-glyph` declares
 * web/ios while its descendant `V-glyphs-list` declares android — so the
 * difference between the two implementations is real data, not a hypothetical.
 *
 * Takes the menu as a plain array rather than a `ProductScope` so this module
 * keeps its own dependencies: `product-scope.ts` imports platform-status, and
 * the reverse import would close a cycle. Three call sites share it (the library
 * card, the canvas flow node, the detail panel's computed status section), which
 * is why it is a named function and not an expression repeated three times.
 */
export function scopedRollupPlatforms(
  platforms: readonly PlatformId[],
  rollup: PlatformStatusRollup,
  scopePlatforms: readonly PlatformId[],
): PlatformId[] {
  return withRollupPlatforms(platforms, rollup).filter((platformId) => scopePlatforms.includes(platformId));
}

/**
 * The gauge tracks a canvas flow card draws — {@link scopedRollupPlatforms},
 * plus the empty-`platforms` fallback that call site has always had.
 *
 * A flow that declares nothing (and a synthetic branch node, which declares
 * `[]` by construction) would otherwise render no tracks at all, because
 * `PlatformGaugeList` returns `null` on an empty list. `FlowNode` therefore fell
 * back to **every** configured platform — which is a scope leak of exactly the
 * kind this feature exists to close: under a web-only product that fallback put
 * an iOS and an Android track on the card. The fallback is the *scope's menu*,
 * so under All products (or a project with no products at all) it is still
 * every platform and the card is pixel-identical to today.
 *
 * Extracted from the component rather than left inline because this repo has no
 * React test runner: as a pure function the product-scope suite can pin the
 * fallback, and the difference between `PLATFORM_IDS` and a one-entry menu is
 * precisely the regression that would otherwise be invisible until someone
 * opened a scoped map.
 */
export function flowGaugePlatforms(
  platforms: readonly PlatformId[],
  rollup: PlatformStatusRollup,
  scopePlatforms: readonly PlatformId[],
): PlatformId[] {
  if (platforms.length > 0) {
    return scopedRollupPlatforms(platforms, rollup, scopePlatforms);
  }
  // Re-ordered through PLATFORMS rather than returned as given: every other
  // platform list in this module is config-ordered, and a menu is a membership
  // set, never an ordering.
  return PLATFORMS.map((platform) => platform.id).filter((platformId) => scopePlatforms.includes(platformId));
}

export function getRollupDisplayStatus(
  rollup: PlatformStatusRollup,
  fallbackStatus: StatusId,
  presetId: CountedStatusPresetId = DEFAULT_COUNTED_STATUS_PRESET_ID,
): StatusId {
  const countedStatuses = [...getCountedStatuses(presetId)].sort(compareStatusesBySeverity);

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

function collectPlaylistViewIdsRecursive(
  entries: PlaylistEntry[],
  nodesById: ReadonlyMap<string, Pick<Node, "id" | "species" | "status" | "platforms" | "metadata">>,
  visited: Set<string>,
  found: Set<string>,
) {
  for (const entry of entries) {
    if (entry.type === "view") {
      if (nodesById.has(entry.view_id)) found.add(entry.view_id);
      continue;
    }

    if (entry.type === "flow") {
      if (visited.has(entry.flow_id)) continue;
      visited.add(entry.flow_id);
      const subEntries = nodesById.get(entry.flow_id)?.metadata?.playlist?.entries;
      if (Array.isArray(subEntries)) {
        collectPlaylistViewIdsRecursive(subEntries, nodesById, visited, found);
      }
      visited.delete(entry.flow_id);
      continue;
    }

    if (entry.type === "condition") {
      collectPlaylistViewIdsRecursive(entry.if_true, nodesById, visited, found);
      collectPlaylistViewIdsRecursive(entry.if_false, nodesById, visited, found);
      continue;
    }

    if (entry.type === "junction") {
      for (const playlistCase of entry.cases) {
        collectPlaylistViewIdsRecursive(playlistCase.entries, nodesById, visited, found);
      }
    }
  }
}

/**
 * The distinct views a flow's playlist reaches, sub-flows included — the unit
 * `computeFlowPlatformRollup` counts platform statuses over, and so the honest
 * center number for a flow's global ring. Walks the same entry tree with the
 * same cycle guard, and counts a view reused twice in one flow once.
 */
export function collectFlowViewIds(
  flowNode: Pick<Node, "id" | "metadata">,
  nodesById: ReadonlyMap<string, Pick<Node, "id" | "species" | "status" | "platforms" | "metadata">>,
): Set<string> {
  const entries = Array.isArray(flowNode.metadata?.playlist?.entries) ? flowNode.metadata.playlist.entries : [];
  const found = new Set<string>();
  collectPlaylistViewIdsRecursive(entries, nodesById, new Set([flowNode.id]), found);
  return found;
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
