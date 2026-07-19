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

/**
 * @param acceptances acceptance nodes (caller filters `species === "acceptance"`).
 * @param platform when set, the distribution counts only that platform.
 */
export function computePyramidAggregation(
  acceptances: readonly Node[],
  platform?: PlatformId,
): PyramidTier[] {
  const byValue = new Map<ValueId, { count: number; rollup: PlatformStatusRollup }>(
    VALUES.map((value) => [value.id, { count: 0, rollup: createEmptyRollup() }]),
  );

  for (const acceptance of acceptances) {
    const values = acceptance.metadata?.values ?? [];
    const resolved = getNodePlatformStatuses(acceptance);

    for (const valueId of values) {
      const entry = byValue.get(valueId);
      if (!entry) continue; // an unknown id is a validation error elsewhere; ignore here
      entry.count += 1;
      for (const platformId of Object.keys(resolved) as PlatformId[]) {
        if (platform !== undefined && platformId !== platform) continue;
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
