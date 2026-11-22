import type { SpeciesId } from "@arkaik/schema";

export const SPECIES = [
  { id: "flow",       level: 1, label: "Flow",         description: "an ordered sequence of views and sub-flows" },
  { id: "view",       level: 0, label: "View",         description: "a reusable page or screen" },
  { id: "data-model", level: null, label: "Data Model",   description: "parallel layer: data model" },
  { id: "api-endpoint", level: null, label: "API Endpoint", description: "parallel layer: API endpoint" },
  { id: "acceptance", level: null, label: "Acceptance", description: "a testable promise: What (title), How (gherkin), Why (values), status per platform" },
  { id: "decision",   level: null, label: "Decision",     description: "an ADR-style decision record: Context (why), Decision (what), Consequences (how), with its own decision status" },
  { id: "stake",      level: null, label: "Stake",        description: "something that matters about the product: a bug, friction, need, requirement, risk or defect, anchored to the part of the product it concerns" },
] as const satisfies readonly {
  id: SpeciesId;
  level: number | null;
  label: string;
  description: string;
}[];

export type { SpeciesId };
/** @deprecated Use SpeciesId */
export type Species = SpeciesId;
