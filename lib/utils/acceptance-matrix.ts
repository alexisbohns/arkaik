/**
 * Parity-matrix projections for the /acceptances surface (spec §9.1): filter
 * acceptances by the filter-bar criteria, and group them under the view/flow
 * they cover (unanchored last). Pure functions over nodes/edges, built on
 * the schema projections (resolvePlatformStatus/hasParityGap) — no stored state.
 */

import type { Node, Edge } from "@/lib/data/types";
import type { PlatformId } from "@/lib/config/platforms";
import type { StatusId } from "@/lib/config/statuses";
import { productOf, resolvePlatformStatus, hasParityGap, type ValueId } from "@arkaik/schema";
import { matchesSearch } from "@/lib/utils/search";

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

/** Anchor ids an acceptance covers (outgoing `covers` edges). */
function coveredAnchorIds(acceptanceId: string, edges: readonly Edge[]): string[] {
  return edges
    .filter((e) => e.edge_type === "covers" && e.source_id === acceptanceId)
    .map((e) => e.target_id);
}

/**
 * The products an acceptance belongs to — possibly none, possibly several.
 *
 * **Anchors govern when there are any** (RFC decision 3): an acceptance is a
 * statement about the views and flows it covers, so its membership is theirs.
 * Stored `metadata.product` is the answer only for an acceptance with nothing
 * to derive from — the intake case (§ Decision 5), where a PM files an idea
 * knowing which app it is for long before they know which screens it needs.
 * Reading the stored value first would let a stale key on an anchored
 * acceptance out-vote the graph it is attached to.
 *
 * Unresolvable anchors are skipped, exactly as {@link groupAcceptancesByAnchor}
 * skips them, so a dangling `covers` edge cannot make an acceptance both
 * anchored-for-membership and unanchored-for-grouping.
 *
 * An **empty** result is meaningful and is not the same as "everywhere": it is
 * triage. Either the acceptance is anchorless and unassigned, or every anchor it
 * covers is itself unassigned. Both show under All products only.
 */
export function productsOfAcceptance(
  acceptance: Node,
  edges: readonly Edge[],
  nodesById: ReadonlyMap<string, Node>,
): Set<string> {
  const anchors = coveredAnchorIds(acceptance.id, edges)
    .map((anchorId) => nodesById.get(anchorId))
    .filter((anchor): anchor is Node => anchor !== undefined);

  if (anchors.length === 0) {
    const stored = productOf(acceptance);
    return stored === null ? new Set<string>() : new Set([stored]);
  }

  const products = new Set<string>();
  for (const anchor of anchors) {
    const product = productOf(anchor);
    if (product !== null) products.add(product);
  }
  return products;
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
    if (filters.anchor !== "all" && !coveredAnchorIds(acc.id, edges).includes(filters.anchor)) return false;
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
