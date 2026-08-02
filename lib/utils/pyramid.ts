import type { PlatformId } from "@/lib/config/platforms";
import { VALUES, VALUE_TIERS_CONFIG, type ValueId, type ValueTierId } from "@/lib/config/values";
import type { Node } from "@/lib/data/types";
import {
  addPlatformStatusToRollup,
  createEmptyRollup,
  getNodePlatformStatuses,
  type PlatformStatusRollup,
} from "@/lib/utils/platform-status";

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
