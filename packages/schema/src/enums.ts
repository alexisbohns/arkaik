import { z } from "zod";

export const SPECIES_IDS = ["flow", "view", "data-model", "api-endpoint"] as const;
export const SpeciesSchema = z.enum(SPECIES_IDS).meta({
  id: "Species",
  description:
    "The species of a node. flow = ordered sequence of views/sub-flows. view = reusable page or screen. data-model = data entity/table. api-endpoint = API endpoint.",
});
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
export const StatusSchema = z.enum(STATUS_IDS).meta({
  id: "Status",
  description: "Lifecycle status of a node.",
});
export type StatusId = z.infer<typeof StatusSchema>;

export const PLATFORM_IDS = ["web", "ios", "android"] as const;
export const PlatformSchema = z.enum(PLATFORM_IDS).meta({
  id: "Platform",
  description: "Target platform.",
});
export type PlatformId = z.infer<typeof PlatformSchema>;

export const EDGE_TYPE_IDS = ["composes", "calls", "displays", "queries"] as const;
export const EdgeTypeSchema = z.enum(EDGE_TYPE_IDS).meta({
  id: "EdgeType",
  description:
    "composes = structural hierarchy (flow↔view). calls = view/flow → api-endpoint. displays = view → data-model. queries = api-endpoint → data-model.",
});
export type EdgeTypeId = z.infer<typeof EdgeTypeSchema>;
