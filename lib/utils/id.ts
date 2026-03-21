import type { SpeciesId } from "@/lib/config/species";

export const SPECIES_PREFIX: Record<SpeciesId, string> = {
  flow: "F",
  view: "V",
  "data-model": "DM",
  "api-endpoint": "API",
};

export function generateNodeId(species: SpeciesId): string {
  const prefix = SPECIES_PREFIX[species];
  const short = crypto.randomUUID().slice(0, 8);
  return `${prefix}-${short}`;
}
