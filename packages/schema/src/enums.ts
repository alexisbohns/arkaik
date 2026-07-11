import { z } from "zod";

export const SPECIES_IDS = ["flow", "view", "data-model", "api-endpoint"] as const;
export const SpeciesSchema = z.enum(SPECIES_IDS);
export type SpeciesId = z.infer<typeof SpeciesSchema>;

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
export const StatusSchema = z.enum(STATUS_IDS);
export type StatusId = z.infer<typeof StatusSchema>;

export const PLATFORM_IDS = ["web", "ios", "android"] as const;
export const PlatformSchema = z.enum(PLATFORM_IDS);
export type PlatformId = z.infer<typeof PlatformSchema>;

export const EDGE_TYPE_IDS = ["composes", "calls", "displays", "queries"] as const;
export const EdgeTypeSchema = z.enum(EDGE_TYPE_IDS);
export type EdgeTypeId = z.infer<typeof EdgeTypeSchema>;
