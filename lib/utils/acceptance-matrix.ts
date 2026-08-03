/**
 * Parity-matrix projections for the /acceptances surface (spec §9.1): filter
 * acceptances by the filter-bar criteria, and group them under the view/flow
 * they cover (unanchored last). Pure functions over nodes/edges, built on
 * the schema projections (resolvePlatformStatus/hasParityGap) — no stored state.
 */

import type { Node, Edge } from "@/lib/data/types";
import type { PlatformId } from "@/lib/config/platforms";
import type { StatusId } from "@/lib/config/statuses";
import { resolvePlatformStatus, hasParityGap, type ValueId } from "@arkaik/schema";
import { matchesSearch } from "@/lib/utils/search";
// `productsOfAcceptance` lives in product-scope.ts, with the resolver for every
// other species — one module answers "which products does this node belong to?".
// Re-exported here because this module was its home and its test still asks for
// it by name. The dependency runs one way only: product-scope knows nothing
// about the matrix.
import { coveredAnchorIds, productsOfAcceptance } from "@/lib/utils/product-scope";

export { productsOfAcceptance };

export interface AcceptanceFilters {
  search: string;
  platform: PlatformId | "all";
  status: StatusId | "all";
  value: ValueId | "all";
  anchor: string | "all";
  parityGap: boolean;
  /**
   * The product scope, not a filter-bar control: it comes from the shell's
   * global scope, never from the URL. `null` is "All products" — a real member
   * of the domain rather than an absence, which is why it is not `"all"` like
   * its neighbours: those name a *column* that could be missing, this names a
   * *frame* that is always present.
   */
  product: string | null;
}

export const EMPTY_FILTERS: AcceptanceFilters = {
  search: "",
  platform: "all",
  status: "all",
  value: "all",
  anchor: "all",
  parityGap: false,
  product: null,
};

/**
 * The heading of the `anchorId: null` bucket. Exported so the label lives in the
 * module a plain Node test can reach, rather than inline in a component this
 * repo has no runner for.
 */
export const UNANCHORED_GROUP_LABEL = "Unanchored";

/**
 * The `anchor` filter value that means "the intake inbox" — acceptances covering
 * nothing, rather than acceptances covering one named node.
 *
 * A sentinel in the same field rather than a second control, because it answers
 * the same question the field already asks ("anchored to what?") and one of its
 * answers is "nothing yet". It cannot collide with a node id: every node id
 * carries a species prefix (`V-`, `F-`, …), and this has none.
 *
 * It exists because filing an idea before its flows and views (§ Decision 5) is
 * only half a workflow if you cannot find the ideas again — the unanchored
 * *group* is always last in the matrix, which is the least reachable place on a
 * long page.
 */
export const UNANCHORED_FILTER = "unanchored";

/** True if any applicable platform of the acceptance resolves to `status`. */
function hasResolvedStatusOnAny(acceptance: Node, status: StatusId): boolean {
  return acceptance.platforms.some((p) => resolvePlatformStatus(acceptance, p) === status);
}

/**
 * Filter acceptances by the parity-matrix filter bar. Filters compose (AND).
 * `search` matches title, description, or gherkin. `status` matches when the
 * (optionally platform-scoped) resolved status equals it. `anchor` keeps
 * acceptances whose `covers` edges include that node id.
 *
 * `product` is applied first because it is the frame the rest of the filters
 * read inside, not another criterion: a scoped product keeps only the
 * acceptances {@link productsOfAcceptance} places in it, and an acceptance it
 * places nowhere is dropped rather than shown everywhere.
 */
export function filterAcceptances(
  acceptances: readonly Node[],
  edges: readonly Edge[],
  nodesById: ReadonlyMap<string, Node>,
  filters: AcceptanceFilters,
): Node[] {
  return acceptances.filter((acc) => {
    if (filters.product !== null && !productsOfAcceptance(acc, edges, nodesById).has(filters.product)) {
      return false;
    }
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
    if (filters.anchor === UNANCHORED_FILTER) {
      // Resolvable anchors, the same test `groupAcceptancesByAnchor` applies, so
      // the filter and the "Unanchored" group it exists to reach never disagree
      // about an acceptance whose only `covers` edge dangles.
      if (coveredAnchorIds(acc.id, edges).some((id) => nodesById.has(id))) return false;
    } else if (filters.anchor !== "all" && !coveredAnchorIds(acc.id, edges).includes(filters.anchor)) {
      return false;
    }
    if (filters.parityGap && !hasParityGap(acc)) return false;
    return true;
  });
}

export interface AnchorGroup {
  /**
   * `null` = **unanchored**: 0 covers edges, or none that resolve. It used to
   * read "product-level", which under products says the opposite of what this
   * bucket means — these are not statements standing above every product, they
   * are ideas in intake that have not been attached to a view or flow yet
   * (§ Decision 5). The label is {@link UNANCHORED_GROUP_LABEL}; the `null`
   * contract itself is unchanged.
   */
  anchorId: string | null;
  anchorNode: Node | null;
  anchorSpecies: Node["species"] | null;
  acceptances: Node[];
  gapCount: number;
}

/**
 * Group acceptances under the view/flow they cover, unanchored last. An
 * acceptance covering n anchors appears in each of the n groups (spec §9.1).
 * Anchor groups are ordered by title; the unanchored bucket is always last.
 */
export function groupAcceptancesByAnchor(
  acceptances: readonly Node[],
  edges: readonly Edge[],
  nodesById: ReadonlyMap<string, Node>,
): { groups: AnchorGroup[] } {
  const byAnchor = new Map<string, Node[]>();
  const unanchored: Node[] = [];
  for (const acc of acceptances) {
    const anchors = coveredAnchorIds(acc.id, edges).filter((id) => nodesById.has(id));
    if (anchors.length === 0) {
      unanchored.push(acc);
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
  if (unanchored.length > 0) {
    groups.push({
      anchorId: null,
      anchorNode: null,
      anchorSpecies: null,
      acceptances: unanchored,
      gapCount: unanchored.filter((a) => hasParityGap(a)).length,
    });
  }
  return { groups };
}
