import { z } from "zod";
import { SPECIES_IDS, STATUS_IDS, PLATFORM_IDS, EDGE_TYPE_IDS, VALUE_IDS, VALUE_TIER_IDS } from "./ids";

export { SPECIES_IDS, STATUS_IDS, PLATFORM_IDS, EDGE_TYPE_IDS, VALUE_IDS, VALUE_TIER_IDS, VALUE_TIERS } from "./ids";
export type { SpeciesId, StatusId, PlatformId, EdgeTypeId, ValueId, ValueTierId } from "./ids";

export const SpeciesSchema = z.enum(SPECIES_IDS).meta({
  id: "Species",
  description:
    "The species of a node. flow = ordered sequence of views/sub-flows. view = reusable page or screen. data-model = data entity/table. api-endpoint = API endpoint. acceptance = a testable promise (one Given/When/Then) with per-platform status.",
});

export const StatusSchema = z.enum(STATUS_IDS).meta({
  id: "Status",
  description: "Lifecycle status of a node.",
});

export const PlatformSchema = z.enum(PLATFORM_IDS).meta({
  id: "Platform",
  description: "Target platform.",
});

export const EdgeTypeSchema = z.enum(EDGE_TYPE_IDS).meta({
  id: "EdgeType",
  description:
    "composes = structural hierarchy (flow↔view). calls = view/flow → api-endpoint, or api-endpoint → api-endpoint (endpoint fan-out to internal/external APIs). displays = view → data-model. queries = api-endpoint → data-model. covers = acceptance → view/flow (which surface the acceptance is proven on).",
});

export const ValueTierSchema = z.enum(VALUE_TIER_IDS).meta({
  id: "ValueTier",
  description: "Bain value pyramid tier.",
});

export const ValueSchema = z.enum(VALUE_IDS).meta({
  id: "Value",
  description: "A Bain B2C Elements-of-Value element served by an acceptance (spec §3.2).",
});
