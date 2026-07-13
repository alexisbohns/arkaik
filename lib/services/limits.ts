import "server-only";

/**
 * Tier limits — the server-side source of truth for Synk enforcement
 * (docs/spec/services.md § Tier Enforcement Points).
 *
 * M4 builds the sockets Basik/Klub will plug into and nothing else. Enforcement
 * lives in exactly two places, both in lib/services/synk.ts: the PUT backup
 * handler (projects + entities) and the retention prune step (retention_days).
 * `users.tier` selects the row; M4 has no path that sets it to anything but
 * 'synk', but the lookup is real (getLimitsForTier) so M5's billing work only
 * flips the column — it never touches enforcement.
 */

/**
 * The tier → limits table, transcribed verbatim from the spec. `Infinity` for
 * klub means "no cap": in synk.ts the entity/project comparisons are `actual >
 * limit`, which is always false against Infinity, and retention pruning is
 * skipped entirely when `retention_days` is not finite (so klub keeps every
 * backup forever). Infinity never reaches a JSON response body — the only place
 * a limit is serialized is the 403 rejection, which klub can never trigger.
 */
export const TIER_LIMITS = {
  synk: { projects: 1, entities: 250, retention_days: 7 },
  basik: { projects: 3, entities: 1000, retention_days: 30 },
  klub: { projects: Infinity, entities: Infinity, retention_days: Infinity },
} as const;

export type Tier = keyof typeof TIER_LIMITS;
export type TierLimits = (typeof TIER_LIMITS)[Tier];

/**
 * Resolve the limits row for a tier string read from `users.tier`. Unknown or
 * missing tiers fall back to the most restrictive row (synk) — the safe default
 * for a backup service: an unrecognized tier must never grant more than the
 * free floor.
 */
export function getLimitsForTier(tier: string | null | undefined): TierLimits {
  if (tier && Object.prototype.hasOwnProperty.call(TIER_LIMITS, tier)) {
    return TIER_LIMITS[tier as Tier];
  }
  return TIER_LIMITS.synk;
}
