export const SPECIES = [
  { id: "token",      level: 0, label: "Token",        description: "color token, spacing value, translation key" },
  { id: "state",      level: 1, label: "State",        description: "button:hover, card:loading, input:error" },
  { id: "component",  level: 2, label: "Component",    description: "Button, Card, Input" },
  { id: "section",    level: 3, label: "Section",      description: "Card grid, Header bar" },
  { id: "view",       level: 4, label: "View",         description: "a page or screen in a flow" },
  { id: "flow",       level: 5, label: "Flow",         description: "a sequence of steps" },
  { id: "scenario",   level: 6, label: "Scenario",     description: "a composed set of flows" },
  { id: "product",    level: 7, label: "Product",      description: "top-level" },
  { id: "data-model", level: null, label: "Data Model",   description: "parallel layer: data model" },
  { id: "api-endpoint", level: null, label: "API Endpoint", description: "parallel layer: API endpoint" },
] as const;

export type SpeciesId = (typeof SPECIES)[number]["id"];
/** @deprecated Use SpeciesId */
export type Species = SpeciesId;
