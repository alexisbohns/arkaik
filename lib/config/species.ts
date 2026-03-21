export const SPECIES = [
  { id: "flow",       level: 1, label: "Flow",         description: "an ordered sequence of views and sub-flows" },
  { id: "view",       level: 0, label: "View",         description: "a reusable page or screen" },
  { id: "data-model", level: null, label: "Data Model",   description: "parallel layer: data model" },
  { id: "api-endpoint", level: null, label: "API Endpoint", description: "parallel layer: API endpoint" },
] as const;

export type SpeciesId = (typeof SPECIES)[number]["id"];
/** @deprecated Use SpeciesId */
export type Species = SpeciesId;
