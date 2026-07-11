/**
 * Plain ID lists with no zod dependency — kept separate from enums.ts (which
 * wraps these in zod schemas) so that consumers needing only the semantic
 * rule set (validate.ts, and the standalone validator built from it) don't
 * pull the zod runtime in along with it.
 */

export const SPECIES_IDS = ["flow", "view", "data-model", "api-endpoint"] as const;
export type SpeciesId = (typeof SPECIES_IDS)[number];

export const STATUS_IDS = [
  "idea",
  "backlog",
  "prioritized",
  "development",
  "releasing",
  "live",
  "archived",
  "blocked",
] as const;
export type StatusId = (typeof STATUS_IDS)[number];

export const PLATFORM_IDS = ["web", "ios", "android"] as const;
export type PlatformId = (typeof PLATFORM_IDS)[number];

export const EDGE_TYPE_IDS = ["composes", "calls", "displays", "queries"] as const;
export type EdgeTypeId = (typeof EDGE_TYPE_IDS)[number];
