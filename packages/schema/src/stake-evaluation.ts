/**
 * How a stake is evaluated: which reference reads it, and how critical a
 * Kritik criterion says it is (stake architecture, part 4).
 *
 * A stake does not carry a score of its own. A reference declares the kinds of
 * stake it reads, and the stake is read against that reference:
 *
 * - bug, friction and need are weighed on the value pyramid
 *   (`value-contribution@2` declares them in its `stake_species`), and carry
 *   `felt`, `matters` and `frequency` on the node ({@link ./stake});
 * - requirement, risk and defect are read against a Kritik criterion, and
 *   their criticality comes from the criterion, never from a copy on the stake.
 *
 * **Nothing here ranks across kinds.** There is deliberately no helper that
 * sums `matters` with a pyramid level, or with a Kritik criticality: they are
 * different scales about different things, and a number made of both would
 * mean nothing.
 *
 * Zod-free and fs-free, like {@link ./weighing}: it bundles into the standalone
 * validator and runs in the browser.
 */

import { severityOf, type FindingSeverity, type KritikLibrary, type QualityFinding } from "./quality";
import type { StakeSpeciesId } from "./stake";
import { majorOf, stakeSpeciesDeclaredBy } from "./weighing";
import { BUILT_IN_SETS } from "./weighing-library";

/** The reference that reads a stake of some species: a weighing set (by `id@major`), or the Kritik criteria. */
export type StakeReference = { kind: "weighing-set"; set: string } | { kind: "kritik" };

/**
 * The reference a stake species is read against. The built-in sets declare
 * the species they score, so this follows those declarations rather than
 * restating them: the first current set that declares the species wins (the
 * current major is listed first), and a species no set declares is read
 * against Kritik.
 */
export function referenceForStakeSpecies(species: StakeSpeciesId): StakeReference {
  const set = BUILT_IN_SETS.find((candidate) => stakeSpeciesDeclaredBy(candidate).includes(species));
  return set === undefined ? { kind: "kritik" } : { kind: "weighing-set", set: `${set.id}@${majorOf(set.version)}` };
}

/**
 * How critical a Kritik criterion says a stake is, read at the moment it is
 * asked, never stored on the stake.
 *
 * - `impact` and `weight` are the criterion's `default_impact` (1 to 5) and
 *   `weight` (1 to 3), when the library knows them. A criterion with no
 *   `default_impact` gives no `weight` either, since a synthesized criterion's
 *   weight is a placeholder.
 * - `severity` is the bucket of the finding that raised the stake
 *   ({@link severityOf}: impact times likelihood), when one is given.
 * - `source` says which of those the reading stands on: the finding, else the
 *   criterion, else nothing — an absent or synthesized library (one that was
 *   rebuilt from assessment ids has no `default_impact`) reads no impact and no
 *   weight, and is "unknown" unless a finding supplies its own severity (that
 *   number is the finding's, not invented here); never a throw.
 */
export interface KritikCriticality {
  criterion_id: string;
  /** The criterion's name, when the library has one. */
  name?: string;
  impact?: number;
  weight?: number;
  severity?: FindingSeverity;
  source: "finding" | "criterion" | "unknown";
}

const isScore = (value: unknown, max: number): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 1 && value <= max;

export function kritikCriticality(
  criterionId: string,
  library: Pick<KritikLibrary, "criteria"> & Partial<Pick<KritikLibrary, "scales">> | null | undefined,
  finding?: Pick<QualityFinding, "impact" | "likelihood"> | null,
): KritikCriticality {
  const criterion = Array.isArray(library?.criteria) ? library.criteria.find((candidate) => candidate?.id === criterionId) : undefined;
  const impact = isScore(criterion?.default_impact, 5) ? criterion.default_impact : undefined;
  // A criterion's weight stands only beside a real default impact: a library rebuilt from assessment ids gives every
  // criterion a weight of 1 that nobody wrote, and that is not a reading.
  const weight = impact !== undefined && isScore(criterion?.weight, 3) ? criterion.weight : undefined;
  const severity =
    finding !== undefined && finding !== null && isScore(finding.impact, 5) && isScore(finding.likelihood, 5)
      ? severityOf(finding, library as KritikLibrary | undefined)
      : undefined;
  return {
    criterion_id: criterionId,
    ...(typeof criterion?.name === "string" && criterion.name !== "" ? { name: criterion.name } : {}),
    ...(impact !== undefined ? { impact } : {}),
    ...(weight !== undefined ? { weight } : {}),
    ...(severity !== undefined ? { severity } : {}),
    source: severity !== undefined ? "finding" : impact !== undefined ? "criterion" : "unknown",
  };
}
