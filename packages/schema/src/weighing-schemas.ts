/**
 * Zod schemas for the weighing section (docs/rfcs/weighing.md).
 *
 * Same split as Kritik's ({@link ./quality-schemas}): {@link ./weighing} owns the
 * types and the pure helpers and stays zod-free so the standalone validator can
 * bundle it; this module owns the shapes. Every object is
 * `.catchall(z.unknown())` — a scorer that keeps its full probability
 * distribution in an extra field, or a project that hangs its own key off a
 * criterion, must survive import → export → Synk → Publik untouched.
 *
 * The section is additive: `schema_version` stays 3, and older readers preserve
 * `weighing` through the bundle root's own catchall.
 *
 * **Import never blocks.** These shapes are deliberately looser than
 * {@link ./quality-schemas}: weighing is filled at scale by agents and scorers,
 * so one bad cell must never refuse an import of the project. Only the
 * CONTAINERS are strict — `weighing` is an object and each of its lists is an
 * array. Every item in a list may be anything (a `null` row parses), and every
 * leaf below is `z.unknown()`: a level of "2", a confidence of 4, a scorer
 * that is a string, a matrix with no id, a criterion with no weight all parse.
 * The `.meta` descriptions still document what each field should hold, and the
 * validator ({@link ./weighing-validate}) warns on every one that does not.
 *
 * Values must survive round trips untouched, so nothing here coerces, strips
 * or falls back (no `.catch()`). The exported types describe a well-formed
 * record, so the loosened schemas are cast to them; a reader goes through the
 * shape guards ({@link ./weighing}, {@link ./weighing-library}).
 */

import { z } from "zod";
import type {
  WeighingAssessment,
  WeighingAssessmentBasis,
  WeighingCriteriaSet,
  WeighingMatrix,
  WeighingScorer,
  WeighingCriterion,
  WeighingGroup,
  WeighingScale,
  WeighingSection,
} from "./weighing";

/** A shape that documents what a value should be, and still accepts anything else untouched. */
const documented = <T extends z.ZodType>(schema: T) => z.union([schema, z.unknown()]);
/** A leaf: any value, or none, with a description of what it should hold. */
const leaf = (description: string) => z.unknown().optional().meta({ description });

/** 0 guess · 1 inferred · 2 evidenced · 3 verified — but any value parses; the validator warns outside 0..3. */
export const WeighingConfidenceSchema = z.unknown().meta({ description: "0 guess · 1 inferred · 2 evidenced · 3 verified." });

export const WeighingScorerSchema = z
  .object({
    kind: leaf("Who judged: human, agent or rule. A human's level beats an agent's, which beats a rule's. Any value parses; the validator warns on another kind."),
    id: leaf("A person's handle, an agent's name, or a seeding rule's id."),
    model: leaf("The model behind an agent, when it says."),
    on_behalf_of: leaf("Whom the scorer acts for: a user id, a handle or a display name, never an email. Stamped by the writer where identity is known."),
  })
  .catchall(z.unknown())
  .meta({ id: "WeighingScorer", description: "Provenance of one assessment." }) as unknown as z.ZodType<WeighingScorer>;

export const WeighingScaleSchema = z
  .object({
    min: leaf("The lowest level, e.g. -3."),
    max: leaf("The highest level, e.g. 3."),
    anchors: leaf("Every level described in words, keyed by the level as a string."),
  })
  .catchall(z.unknown())
  .meta({ id: "WeighingScale", description: "A criteria set's scale: its bounds and every level's anchor." }) as unknown as z.ZodType<WeighingScale>;

export const WeighingGroupSchema = z
  .object({ id: leaf("The group's id."), title: leaf("The group's title.") })
  .catchall(z.unknown())
  .meta({ id: "WeighingGroup", description: "A grouping of criteria — the tiers, for the value set." }) as unknown as z.ZodType<WeighingGroup>;

export const WeighingCriterionSchema = z
  .object({
    id: leaf("Stable identifier. Never redefined — retired via superseded_by."),
    group: leaf("A group id — for the value set, the tier."),
    name: leaf("A short name."),
    question: leaf("The question a scorer answers."),
    definition: leaf("What the criterion means."),
    anchors: leaf("This criterion's own wording of each level — on a positioning, in the product's words."),
    weight: leaf("On a positioning: how much the product stands on it, a number above 0. Absent means 1."),
    superseded_by: leaf("The id of the criterion that replaces this one."),
  })
  .catchall(z.unknown())
  .meta({ id: "WeighingCriterion", description: "One question on a scale where every level is described." }) as unknown as z.ZodType<WeighingCriterion>;

export const WeighingCriteriaSetSchema = z
  .object({
    id: leaf("The set's id."),
    version: leaf("Semver. Levels are comparable only within a major."),
    title: leaf("A human title."),
    subject: leaf("What the set judges: acceptance today."),
    scale: documented(WeighingScaleSchema).optional().meta({ description: "The scale. A positioning may leave it out and use its ruler's." }),
    groups: documented(z.array(documented(WeighingGroupSchema))).optional(),
    criteria: documented(z.array(documented(WeighingCriterionSchema))).optional(),
    role: leaf("positioning marks the set a project writes about itself."),
    status: leaf("Absent or active is active; anything else is a draft, which feeds no roll-up."),
    extends: leaf("A positioning's ruler, e.g. value-contribution@2."),
  })
  .catchall(z.unknown())
  .meta({ id: "WeighingCriteriaSet", description: "A versioned list of criteria for one kind of subject. The 30 elements of value are one; a positioning is another." }) as unknown as z.ZodType<WeighingCriteriaSet>;

export const WeighingMatrixSchema = z
  .object({
    id: leaf("The matrix's id."),
    title: leaf("A human title."),
    set: leaf("The set's id and major, e.g. value-contribution@2."),
    subjects: documented(
      z.object({ kind: leaf("query or list."), species: leaf("For a query: the species judged."), items: leaf("For a list: the subjects.") }).catchall(z.unknown()),
    ).optional().meta({ description: "What the matrix judges: { kind: query, species } or { kind: list, items }." }),
    positioning: leaf("The id of the positioning set that re-weights this matrix."),
    context: leaf("The node the matrix is about, as { node_id }."),
    status: leaf("Absent or active is active; anything else is a draft."),
  })
  .catchall(z.unknown())
  .meta({ id: "WeighingMatrix", description: "A criteria set applied to a list of subjects." }) as unknown as z.ZodType<WeighingMatrix>;

export const WeighingAssessmentBasisSchema = z
  .object({
    fingerprint: leaf("A hash of the subject's judged fields."),
    commit: leaf("The commit the scorer was looking at."),
    set_version: leaf("The full version of the set the level was read against."),
  })
  .catchall(z.unknown()) as unknown as z.ZodType<WeighingAssessmentBasis>;

export const WeighingAssessmentSchema = z
  .object({
    matrix: leaf("The matrix's id. A row without it cannot be addressed: readers skip it and the validator warns."),
    subject: leaf("A node id for the value matrix."),
    criterion: leaf("A criterion id."),
    level: leaf("A whole number on the set's scale. 0 means unrelated. No half points — but any value parses; the validator warns on one off the scale."),
    scorer: documented(WeighingScorerSchema).optional().meta({ description: "Who judged. Required in practice: without it a human, an agent and a rule are indistinguishable, so the validator warns." }),
    confidence: leaf("0 guess · 1 inferred · 2 evidenced · 3 verified."),
    evidence: leaf("Markdown."),
    refs: leaf("Ids cited: nodes, journal events, findings."),
    basis: documented(WeighingAssessmentBasisSchema).optional().meta({ description: "What the scorer was looking at, so a re-read can tell the score went stale." }),
    run: leaf("The audit or plan the score belongs to."),
    p_serves: leaf("Optional: a probabilistic scorer's certainty (0 to 1) that the subject serves the element. Certainty, not size. Any value parses; the validator warns on one outside 0..1."),
    p_costs: leaf("Optional: the same for costs, asked independently, so both can be high."),
    ts: leaf("ISO 8601."),
  })
  .catchall(z.unknown())
  .meta({ id: "WeighingAssessment", description: "One (matrix × subject × criterion) judgement — latest per scorer kind wins; history lives in the journal." }) as unknown as z.ZodType<WeighingAssessment>;

export const WeighingSectionSchema = z
  .object({
    sets: z.array(documented(WeighingCriteriaSetSchema)).optional(),
    matrices: z.array(documented(WeighingMatrixSchema)).optional(),
    assessments: z.array(documented(WeighingAssessmentSchema)).optional(),
  })
  .catchall(z.unknown())
  .meta({
    id: "WeighingSection",
    description:
      "The project's weighing state (docs/rfcs/weighing.md) — its own criteria sets (a positioning), matrices and assessments. The built-in value set is library content, not stored; served, cost and kept share are derived, never stored. Each list may be absent; a reader treats it as empty.",
  }) as unknown as z.ZodType<WeighingSection>;
