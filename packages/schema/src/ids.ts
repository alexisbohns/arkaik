/**
 * Plain ID lists with no zod dependency — kept separate from enums.ts (which
 * wraps these in zod schemas) so that consumers needing only the semantic
 * rule set (validate.ts, and the standalone validator built from it) don't
 * pull the zod runtime in along with it.
 */

export const SPECIES_IDS = ["flow", "view", "data-model", "api-endpoint", "acceptance", "decision"] as const;
export type SpeciesId = (typeof SPECIES_IDS)[number];

export const STATUS_IDS = [
  "idea",
  "discovery",
  "backlog",
  "development",
  "releasing",
  "live",
  "archived",
] as const;
export type StatusId = (typeof STATUS_IDS)[number];

export const PLATFORM_IDS = ["web", "ios", "android"] as const;
export type PlatformId = (typeof PLATFORM_IDS)[number];

export const EDGE_TYPE_IDS = ["composes", "calls", "displays", "queries", "covers"] as const;
export type EdgeTypeId = (typeof EDGE_TYPE_IDS)[number];

/**
 * Which `[source species, target species]` pairs each edge type admits — the
 * graph model's grammar, and the one table both `validateBundle()` and the
 * editor's connect dialog read. Any pair absent here is an `edge-semantics`
 * error on import (docs/graph-model.md § Edge Types).
 */
export const VALID_EDGE_SEMANTICS: Record<EdgeTypeId, ReadonlyArray<[SpeciesId, SpeciesId]>> = {
  composes: [
    ["flow", "view"],
    ["flow", "flow"],
    ["view", "flow"],
    ["view", "view"],
  ],
  // `calls` names the initiator, which is why it runs in both directions
  // between a view and an endpoint: view → api is the outbound/write
  // affordance, api → view the inbound/read one a server opens itself (a
  // webhook, an SSE channel, a push). Both project onto the View card
  // (docs/graph-model.md § Edge Types). Consumers that walk `calls` must
  // therefore not assume it points down into the system layer — see
  // `buildProductUsageIndex` in ./products.ts, which restricts hops by
  // target species for exactly this reason.
  calls: [
    ["view", "api-endpoint"],
    ["flow", "api-endpoint"],
    ["api-endpoint", "api-endpoint"],
    ["api-endpoint", "view"],
  ],
  displays: [["view", "data-model"]],
  queries: [["api-endpoint", "data-model"]],
  covers: [
    ["acceptance", "view"],
    ["acceptance", "flow"],
  ],
};

/** True when `edgeType` may run from `source` to `target`, in that direction. */
export function isValidEdgeSemantic(edgeType: string, source: string, target: string): boolean {
  const pairs = VALID_EDGE_SEMANTICS[edgeType as EdgeTypeId];
  if (!pairs) return false;
  return pairs.some(([s, t]) => s === source && t === target);
}

/**
 * The edge types that may connect this ordered species pair, in `EDGE_TYPE_IDS`
 * order — what the connect dialog offers once the user has drawn a link. An
 * empty result means the two species have no legal relationship in that
 * direction, so nothing should be offered.
 */
export function edgeTypesForSpeciesPair(source: string, target: string): EdgeTypeId[] {
  return EDGE_TYPE_IDS.filter((edgeType) => isValidEdgeSemantic(edgeType, source, target));
}

export const VALUE_TIER_IDS = ["functional", "emotional", "life-changing", "social-impact"] as const;
export type ValueTierId = (typeof VALUE_TIER_IDS)[number];

/**
 * The Bain & Company B2C "Elements of Value" pyramid — 30 elements in 4 tiers.
 * An Arkaik core enum (not project-specific), spec §3.2. Additive extensions
 * only; never renumber or rename.
 */
export const VALUE_IDS = [
  // functional (14)
  "saves-time", "simplifies", "makes-money", "reduces-risk", "organizes",
  "integrates", "connects", "reduces-effort", "avoids-hassles", "reduces-cost",
  "quality", "variety", "sensory-appeal", "informs",
  // emotional (10)
  "reduces-anxiety", "rewards-me", "nostalgia", "design-aesthetics", "badge-value",
  "wellness", "therapeutic-value", "fun-entertainment", "attractiveness", "provides-access",
  // life-changing (5)
  "provides-hope", "self-actualization", "motivation", "heirloom", "affiliation-belonging",
  // social-impact (1)
  "self-transcendence",
] as const;
export type ValueId = (typeof VALUE_IDS)[number];

export const VALUE_TIERS: Record<ValueId, ValueTierId> = {
  "saves-time": "functional", simplifies: "functional", "makes-money": "functional",
  "reduces-risk": "functional", organizes: "functional", integrates: "functional",
  connects: "functional", "reduces-effort": "functional", "avoids-hassles": "functional",
  "reduces-cost": "functional", quality: "functional", variety: "functional",
  "sensory-appeal": "functional", informs: "functional",
  "reduces-anxiety": "emotional", "rewards-me": "emotional", nostalgia: "emotional",
  "design-aesthetics": "emotional", "badge-value": "emotional", wellness: "emotional",
  "therapeutic-value": "emotional", "fun-entertainment": "emotional",
  attractiveness: "emotional", "provides-access": "emotional",
  "provides-hope": "life-changing", "self-actualization": "life-changing",
  motivation: "life-changing", heirloom: "life-changing", "affiliation-belonging": "life-changing",
  "self-transcendence": "social-impact",
};
