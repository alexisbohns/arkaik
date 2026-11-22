import {
  QUALITY_STAKE_SPECIES,
  STAKE_SPECIES_IDS,
  USER_FACING_STAKE_SPECIES,
  type StakeSpeciesId,
} from "@arkaik/schema";

/**
 * The six stake species as the interface says them: a label, and one line that
 * tells them apart (docs/rfcs/stake-architecture.md § 3).
 */
const STAKE_SPECIES_COPY: Record<StakeSpeciesId, { label: string; hint: string }> = {
  bug: { label: "Bug", hint: "Something expected to work one way that does not." },
  friction: { label: "Friction", hint: "Something that works as designed and still gets in the way." },
  need: { label: "Need", hint: "A value people expect, want or would enjoy." },
  requirement: { label: "Requirement", hint: "An obligation from outside, such as GDPR or another regulation." },
  risk: { label: "Risk", hint: "A threat that can only be mitigated." },
  defect: { label: "Defect", hint: "A flaw of our own making, in design or build, that leaves a threat." },
};

export const STAKE_SPECIES = STAKE_SPECIES_IDS.map((id) => ({
  id,
  label: STAKE_SPECIES_COPY[id].label,
  hint: STAKE_SPECIES_COPY[id].hint,
  /** User-facing species are weighed on the value pyramid; the others are read against Kritik. */
  family: (USER_FACING_STAKE_SPECIES as readonly string[]).includes(id) ? ("user-facing" as const) : ("quality" as const),
}));

export const STAKE_SPECIES_LABELS: Record<StakeSpeciesId, string> = Object.fromEntries(
  STAKE_SPECIES.map((entry) => [entry.id, entry.label]),
) as Record<StakeSpeciesId, string>;

export { QUALITY_STAKE_SPECIES, USER_FACING_STAKE_SPECIES };
export type { StakeSpeciesId };
