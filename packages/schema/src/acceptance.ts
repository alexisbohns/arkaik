/**
 * Acceptance projections — parity gaps, coverage, and per-anchor rollups
 * (docs/superpowers/specs/2026-07-19-acceptance-value-model-design.md §3.4–3.5).
 *
 * Deliberately zod-free (type-only imports) like validate.ts/journal.ts, so
 * the logic can bundle into standalone tools and stays browser-safe. These are
 * pure functions over nodes/edges; nothing here is stored state.
 */

import type { PlatformId, StatusId } from "./ids";
import type { Edge, Node } from "./bundle";

type StatusCarrier = Pick<Node, "status" | "platforms" | "metadata">;

/** Default "delivered" bucket for parity: shipped means live (spec §3.5). */
export const DEFAULT_DELIVERED_STATUSES: readonly StatusId[] = ["live"];

/**
 * Resolved status of a node for one platform: the platformStatuses override,
 * else the node's base status. Undefined when the platform is not applicable.
 */
export function resolvePlatformStatus(node: StatusCarrier, platform: PlatformId): StatusId | undefined {
  if (!node.platforms.includes(platform)) return undefined;
  return node.metadata?.platformStatuses?.[platform] ?? node.status;
}

/**
 * A parity gap: delivered on at least one applicable platform, not on at least
 * one other (spec §3.5). Archived acceptances never gap.
 */
export function hasParityGap(
  node: StatusCarrier,
  deliveredStatuses: readonly StatusId[] = DEFAULT_DELIVERED_STATUSES,
): boolean {
  if (node.status === "archived") return false;
  const resolved = node.platforms
    .map((platform) => resolvePlatformStatus(node, platform))
    .filter((status): status is StatusId => status !== undefined);
  const delivered = resolved.filter((status) => deliveredStatuses.includes(status));
  return delivered.length > 0 && delivered.length < resolved.length;
}

export interface AcceptanceParityGap {
  node_id: string;
  title: string;
  /** Platforms where the acceptance is delivered. */
  delivered: PlatformId[];
  /** Lagging platforms → their resolved (non-delivered) status. */
  missing: Partial<Record<PlatformId, StatusId>>;
}

/** Every acceptance node with a parity gap, in node order. */
export function computeParityGaps(
  nodes: readonly Node[],
  deliveredStatuses: readonly StatusId[] = DEFAULT_DELIVERED_STATUSES,
): AcceptanceParityGap[] {
  const gaps: AcceptanceParityGap[] = [];
  for (const node of nodes) {
    if (node.species !== "acceptance") continue;
    if (!hasParityGap(node, deliveredStatuses)) continue;
    const delivered: PlatformId[] = [];
    const missing: Partial<Record<PlatformId, StatusId>> = {};
    for (const platform of node.platforms) {
      const status = resolvePlatformStatus(node, platform);
      if (status === undefined) continue;
      if (deliveredStatuses.includes(status)) delivered.push(platform);
      else missing[platform] = status;
    }
    gaps.push({ node_id: node.id, title: node.title, delivered, missing });
  }
  return gaps;
}

/** The acceptance nodes covering `anchorId` (incoming covers edges). */
export function acceptancesCovering(
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

/** Views no acceptance covers — the "what's missing" coverage radar (spec §4). */
export function computeUncoveredViews(nodes: readonly Node[], edges: readonly Edge[]): Node[] {
  const coveredIds = new Set(
    edges.filter((edge) => edge.edge_type === "covers").map((edge) => edge.target_id),
  );
  return nodes.filter((node) => node.species === "view" && !coveredIds.has(node.id));
}

export type AnchorRollup = Partial<Record<PlatformId, Partial<Record<StatusId, number>>>>;

/**
 * Per-platform status counts of the acceptances covering an anchor, or null
 * when nothing covers it — the caller's signal to fall back to the anchor's
 * own stored platformStatuses (spec §3.4 computed-with-fallback).
 */
export function computeAnchorRollup(
  anchorId: string,
  nodes: readonly Node[],
  edges: readonly Edge[],
): AnchorRollup | null {
  const covering = acceptancesCovering(anchorId, nodes, edges);
  if (covering.length === 0) return null;
  const rollup: AnchorRollup = {};
  for (const acceptance of covering) {
    for (const platform of acceptance.platforms) {
      const status = resolvePlatformStatus(acceptance, platform);
      if (status === undefined) continue;
      const platformCounts = (rollup[platform] ??= {});
      platformCounts[status] = (platformCounts[status] ?? 0) + 1;
    }
  }
  return rollup;
}
