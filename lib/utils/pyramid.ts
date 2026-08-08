import type { PlatformId } from "@/lib/config/platforms";
import { VALUES, VALUE_TIERS_CONFIG, type ValueId, type ValueTierId } from "@/lib/config/values";
import type { Edge, Node } from "@/lib/data/types";
import { EMPTY_FILTERS, filterAcceptances } from "@/lib/utils/acceptance-matrix";
import {
  addPlatformStatusToRollup,
  createEmptyRollup,
  getNodePlatformStatuses,
  type PlatformStatusRollup,
} from "@/lib/utils/platform-status";
import type { ProductScope } from "@/lib/utils/product-scope";

/**
 * Pyramid aggregation — the value-delivery radar (spec §9.2). For each of the
 * 30 Bain elements: how many acceptances carry it, and the per-platform
 * distribution of their resolved statuses. Grouped by tier in pyramid order;
 * unserved elements come back with a zero count and an empty rollup so the
 * "what's missing" grid stays visible. Pure and deterministic — the app renders
 * it, and the MCP/CLI can serve the identical numbers.
 */

export interface PyramidElement {
  value: ValueId;
  tier: ValueTierId;
  /** Acceptances whose metadata.values includes this element (platform-independent). */
  acceptanceCount: number;
  /** Per-platform status distribution of those acceptances' resolved statuses. */
  rollup: PlatformStatusRollup;
}

export interface PyramidTier {
  tier: ValueTierId;
  elements: PyramidElement[];
}

export interface PyramidAggregationOptions {
  /**
   * The scope's platform **menu** — the distribution counts a resolved status
   * only when its platform is on it. Omitted means "no menu": every platform
   * the acceptances carry is counted, which is what a project with no products
   * declared must keep getting. A single-platform scope is `{ platforms: [p] }`,
   * and an empty menu is a real member of the domain rather than a mistake —
   * arity 0 (a CLI, a public API) genuinely has nothing to count, so `[]`
   * yields an empty rollup instead of falling back to everything.
   */
  platforms?: PlatformId[];
}

/**
 * @param acceptances acceptance nodes (caller filters `species === "acceptance"`,
 *   and — under a product scope — narrows them with `filterAcceptances`; product
 *   membership is an anchor-traversal question, not a value one, so it stays out
 *   of here).
 * @param options see {@link PyramidAggregationOptions}.
 */
export function computePyramidAggregation(
  acceptances: readonly Node[],
  options?: PyramidAggregationOptions,
): PyramidTier[] {
  // `null` is "no menu", distinct from an empty menu — see the option's doc.
  const menu = options?.platforms ? new Set<PlatformId>(options.platforms) : null;

  const byValue = new Map<ValueId, { count: number; rollup: PlatformStatusRollup }>(
    VALUES.map((value) => [value.id, { count: 0, rollup: createEmptyRollup() }]),
  );

  for (const acceptance of acceptances) {
    const values = acceptance.metadata?.values ?? [];
    const resolved = getNodePlatformStatuses(acceptance);

    for (const valueId of values) {
      const entry = byValue.get(valueId);
      if (!entry) continue; // an unknown id is a validation error elsewhere; ignore here
      // Deliberately outside the platform loop: `acceptanceCount` counts
      // acceptances carrying this element, not platform statuses, so the menu
      // must not reach it. Narrowing the scope to one platform re-shapes the
      // rings; it does not make an acceptance stop existing.
      entry.count += 1;
      for (const platformId of Object.keys(resolved) as PlatformId[]) {
        if (menu !== null && !menu.has(platformId)) continue;
        const status = resolved[platformId];
        if (status) {
          entry.rollup = addPlatformStatusToRollup(entry.rollup, platformId, status);
        }
      }
    }
  }

  return VALUE_TIERS_CONFIG.map((tierConfig) => ({
    tier: tierConfig.id,
    elements: VALUES.filter((value) => value.tier === tierConfig.id).map((value) => {
      const entry = byValue.get(value.id)!;
      return { value: value.id, tier: value.tier, acceptanceCount: entry.count, rollup: entry.rollup };
    }),
  }));
}

/**
 * **The scoped pyramid, composed once for every surface that draws one** — the
 * Pyramid page and the Overview's `PyramidCard`.
 *
 * Two steps, and both are load-bearing. `filterAcceptances` narrows to the
 * acceptances the scope actually contains, anchors before stored keys
 * (§ Decision 5); `platforms` then narrows each element's per-platform
 * distribution to the scope's menu.
 *
 * It is one function rather than two copies because the *easy half is a
 * plausible mistake*: passing `scope.platforms` alone re-shapes the rings while
 * still counting every product's acceptances, so the same scope would report a
 * different number of acceptances on the Overview than on the Pyramid. That is
 * a divergence nobody would see until they compared two screens, and no amount
 * of care at two call sites prevents it — sharing the composition does.
 */
export function computeScopedPyramidTiers(
  acceptances: readonly Node[],
  edges: readonly Edge[],
  nodesById: ReadonlyMap<string, Node>,
  scope: Pick<ProductScope, "productId" | "platforms">,
): PyramidTier[] {
  return computePyramidAggregation(
    filterAcceptances(acceptances, edges, nodesById, { ...EMPTY_FILTERS, product: scope.productId }),
    { platforms: scope.platforms },
  );
}

/**
 * A tier's elements split into the columns the Overview's 90° pyramid draws.
 *
 * The pyramid lies on its side: tiers read left to right, widest first, and a
 * tier's own elements stack vertically in one or two columns. Two rather than a
 * single tall column because a 14-element functional tier in one column is a
 * ladder, not a pyramid — split in half it is the base the shape needs.
 *
 * **Derived, never hardcoded.** Today's taxonomy is 14/10/5/1, which this turns
 * into 7+7, 5+5, 3+2 and 1 — the intended shape. Writing those numbers down
 * instead would mis-chunk silently the day an element is added to a tier, and
 * "silently" is the whole problem: the pyramid would still render, just wrong.
 *
 * A tier of one gets a single column: an apex is a point, and 1+0 would leave
 * an empty column's worth of gap beside it.
 */
export function splitTierColumns<T>(elements: readonly T[]): T[][] {
  if (elements.length === 0) return [];
  if (elements.length === 1) return [[elements[0]]];

  const first = Math.ceil(elements.length / 2);
  return [elements.slice(0, first), elements.slice(first)];
}
