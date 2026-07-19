/**
 * Parity-matrix projections for the /acceptances surface (spec §9.1): filter
 * acceptances by the filter-bar criteria, and group them under the view/flow
 * they cover (product-level last). Pure functions over nodes/edges, built on
 * the schema projections (resolvePlatformStatus/hasParityGap) — no stored state.
 */

import type { Node, Edge } from "@/lib/data/types";
import type { PlatformId } from "@/lib/config/platforms";
import type { StatusId } from "@/lib/config/statuses";
import { resolvePlatformStatus, hasParityGap, type ValueId } from "@arkaik/schema";
import { matchesSearch } from "@/lib/utils/search";

export interface AcceptanceFilters {
  search: string;
  platform: PlatformId | "all";
  status: StatusId | "all";
  value: ValueId | "all";
  anchor: string | "all";
  parityGap: boolean;
}

export const EMPTY_FILTERS: AcceptanceFilters = {
  search: "",
  platform: "all",
  status: "all",
  value: "all",
  anchor: "all",
  parityGap: false,
};

/** Anchor ids an acceptance covers (outgoing `covers` edges). */
function coveredAnchorIds(acceptanceId: string, edges: readonly Edge[]): string[] {
  return edges
    .filter((e) => e.edge_type === "covers" && e.source_id === acceptanceId)
    .map((e) => e.target_id);
}

/** True if any applicable platform of the acceptance resolves to `status`. */
function hasResolvedStatusOnAny(acceptance: Node, status: StatusId): boolean {
  return acceptance.platforms.some((p) => resolvePlatformStatus(acceptance, p) === status);
}

/**
 * Filter acceptances by the parity-matrix filter bar. Filters compose (AND).
 * `search` matches title, description, or gherkin. `status` matches when the
 * (optionally platform-scoped) resolved status equals it. `anchor` keeps
 * acceptances whose `covers` edges include that node id.
 */
export function filterAcceptances(
  acceptances: readonly Node[],
  edges: readonly Edge[],
  filters: AcceptanceFilters,
): Node[] {
  return acceptances.filter((acc) => {
    if (filters.search) {
      const gherkin = typeof acc.metadata?.gherkin === "string" ? acc.metadata.gherkin : "";
      if (!matchesSearch({ title: acc.title, description: `${acc.description ?? ""} ${gherkin}` }, filters.search)) {
        return false;
      }
    }
    if (filters.platform !== "all" && !acc.platforms.includes(filters.platform)) return false;
    if (filters.status !== "all") {
      if (filters.platform !== "all") {
        if (resolvePlatformStatus(acc, filters.platform) !== filters.status) return false;
      } else if (!hasResolvedStatusOnAny(acc, filters.status)) {
        return false;
      }
    }
    if (filters.value !== "all" && !(acc.metadata?.values ?? []).includes(filters.value)) return false;
    if (filters.anchor !== "all" && !coveredAnchorIds(acc.id, edges).includes(filters.anchor)) return false;
    if (filters.parityGap && !hasParityGap(acc)) return false;
    return true;
  });
}

export interface AnchorGroup {
  /** null = product-level (0 covers edges). */
  anchorId: string | null;
  anchorNode: Node | null;
  anchorSpecies: Node["species"] | null;
  acceptances: Node[];
  gapCount: number;
}

/**
 * Group acceptances under the view/flow they cover, product-level last. An
 * acceptance covering n anchors appears in each of the n groups (spec §9.1).
 * Anchor groups are ordered by title; the product-level bucket is always last.
 */
export function groupAcceptancesByAnchor(
  acceptances: readonly Node[],
  edges: readonly Edge[],
  nodesById: ReadonlyMap<string, Node>,
): { groups: AnchorGroup[] } {
  const byAnchor = new Map<string, Node[]>();
  const product: Node[] = [];
  for (const acc of acceptances) {
    const anchors = coveredAnchorIds(acc.id, edges).filter((id) => nodesById.has(id));
    if (anchors.length === 0) {
      product.push(acc);
      continue;
    }
    for (const anchorId of anchors) {
      const list = byAnchor.get(anchorId) ?? [];
      list.push(acc);
      byAnchor.set(anchorId, list);
    }
  }

  const anchorGroups: AnchorGroup[] = [...byAnchor.entries()]
    .map(([anchorId, accs]) => {
      const anchorNode = nodesById.get(anchorId) ?? null;
      return {
        anchorId,
        anchorNode,
        anchorSpecies: anchorNode ? anchorNode.species : null,
        acceptances: accs,
        gapCount: accs.filter((a) => hasParityGap(a)).length,
      };
    })
    .sort((a, b) => (a.anchorNode?.title ?? "").localeCompare(b.anchorNode?.title ?? ""));

  const groups = [...anchorGroups];
  if (product.length > 0) {
    groups.push({
      anchorId: null,
      anchorNode: null,
      anchorSpecies: null,
      acceptances: product,
      gapCount: product.filter((a) => hasParityGap(a)).length,
    });
  }
  return { groups };
}
