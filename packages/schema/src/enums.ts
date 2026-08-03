import { z } from "zod";
import { SPECIES_IDS, STATUS_IDS, PLATFORM_IDS, EDGE_TYPE_IDS, VALUE_IDS, VALUE_TIER_IDS } from "./ids";
import { LEGACY_STATUS_IDS } from "./legacy-status";

export { SPECIES_IDS, STATUS_IDS, PLATFORM_IDS, EDGE_TYPE_IDS, VALUE_IDS, VALUE_TIER_IDS, VALUE_TIERS } from "./ids";
export { VALID_EDGE_SEMANTICS, isValidEdgeSemantic, edgeTypesForSpeciesPair } from "./ids";
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

/**
 * Status as persisted data may carry it: the current vocabulary plus the two
 * pre-v3 legacy ids (`prioritized`, `blocked`). Used for bundle fields and
 * journal `from`/`to` so an old bundle parses BEFORE the migration chain runs
 * (parse happens first on every import path). Everything the app newly writes
 * uses the strict {@link StatusSchema}; `migrateStatusVocabulary` erases legacy
 * ids from live data on load.
 */
export const AnyStatusSchema = z.enum([...STATUS_IDS, ...LEGACY_STATUS_IDS]).meta({
  id: "AnyStatus",
  description:
    "Lifecycle status as stored: the current vocabulary, or a legacy id (prioritized, blocked) accepted from pre-v3 bundles and migrated on load.",
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
