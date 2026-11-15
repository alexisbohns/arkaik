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
 * so one bad cell (a level of 3.5, a confidence of 4, a scorer with no id, a
 * matrix with no set) must never refuse an import of the project. Only the keys
 * a record cannot be addressed without stay required; every judgement about a
 * value — range, kind, shape — belongs to {@link ./weighing-validate}, which
 * warns. The exported types describe a WELL-FORMED record, so the loosened
 * schemas are cast to them: a parse proves the keys are present, and a reader
 * must still tolerate a value the validator warned about (every projection here
 * already degrades to a blank cell).
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

/** 0 guess · 1 inferred · 2 evidenced · 3 verified — but any number parses; the validator warns outside 0..3. */
export const WeighingConfidenceSchema = z.number();

export const WeighingScorerSchema = z
  .object({
    kind: z.string().meta({ description: "Who judged: human, agent or rule. A human's level beats an agent's, which beats a rule's. Any string parses; the validator warns on another kind." }),
    id: z.string().optional().meta({ description: "A person's handle, an agent's name, or a seeding rule's id." }),
    model: z.string().optional().meta({ description: "The model behind an agent, when it says." }),
    on_behalf_of: z.string().optional().meta({ description: "Whom the scorer acts for: an opaque user id or handle, never an email. Stamped by the writer where identity is known." }),
  })
  .catchall(z.unknown())
  .meta({ id: "WeighingScorer", description: "Provenance of one assessment." }) as unknown as z.ZodType<WeighingScorer>;

export const WeighingScaleSchema: z.ZodType<WeighingScale> = z
  .object({
    min: z.number(),
    max: z.number(),
    anchors: z.record(z.string(), z.string()).meta({ description: "Every level described in words, keyed by the level as a string." }),
  })
  .catchall(z.unknown())
  .meta({ id: "WeighingScale", description: "A criteria set's scale: its bounds and every level's anchor." });

export const WeighingGroupSchema: z.ZodType<WeighingGroup> = z
  .object({ id: z.string(), title: z.string() })
  .catchall(z.unknown())
  .meta({ id: "WeighingGroup", description: "A grouping of criteria — the tiers, for the value set." });

export const WeighingCriterionSchema: z.ZodType<WeighingCriterion> = z
  .object({
    id: z.string().meta({ description: "Stable identifier. Never redefined — retired via superseded_by." }),
    group: z.string().optional(),
    name: z.string().optional(),
    question: z.string().optional(),
    definition: z.string().optional(),
    anchors: z.record(z.string(), z.string()).optional().meta({
      description: "This criterion's own wording of each level — on a positioning, in the product's words.",
    }),
    weight: z.number().optional().meta({ description: "On a positioning: how much the product stands on it. Absent means 1." }),
    superseded_by: z.string().optional(),
  })
  .catchall(z.unknown())
  .meta({ id: "WeighingCriterion", description: "One question on a scale where every level is described." });

export const WeighingCriteriaSetSchema = z
  .object({
    id: z.string(),
    version: z.string().meta({ description: "Semver. Levels are comparable only within a major." }),
    title: z.string().optional(),
    subject: z.string().meta({ description: "What the set judges: acceptance today." }),
    scale: WeighingScaleSchema.optional(),
    groups: z.array(WeighingGroupSchema).optional(),
    criteria: z.array(WeighingCriterionSchema).optional(),
    role: z.literal("positioning").optional().meta({ description: "positioning marks the set a project writes about itself." }),
    status: z.enum(["draft", "active"]).optional().meta({ description: "Absent means active. A draft feeds no roll-up." }),
    extends: z.string().optional().meta({ description: "A positioning's ruler, e.g. value-contribution@1." }),
  })
  .catchall(z.unknown())
  .meta({ id: "WeighingCriteriaSet", description: "A versioned list of criteria for one kind of subject. The 30 elements of value are one; a positioning is another." }) as unknown as z.ZodType<WeighingCriteriaSet>;

export const WeighingMatrixSchema = z
  .object({
    id: z.string(),
    title: z.string().optional(),
    set: z.string().optional().meta({ description: "The set's id and major, e.g. value-contribution@1." }),
    subjects: z.union([
      z.object({ kind: z.literal("query"), species: z.string() }).catchall(z.unknown()),
      z
        .object({
          kind: z.literal("list"),
          items: z.array(z.object({ id: z.string(), title: z.string().optional(), node_id: z.string().optional() }).catchall(z.unknown())),
        })
        .catchall(z.unknown()),
    ]).optional(),
    positioning: z.string().optional().meta({ description: "The id of the positioning set that re-weights this matrix." }),
    context: z.object({ node_id: z.string() }).catchall(z.unknown()).optional(),
    status: z.enum(["draft", "active"]).optional(),
  })
  .catchall(z.unknown())
  .meta({ id: "WeighingMatrix", description: "A criteria set applied to a list of subjects." }) as unknown as z.ZodType<WeighingMatrix>;

export const WeighingAssessmentBasisSchema = z
  .object({
    fingerprint: z.string().optional().meta({ description: "A hash of the subject's judged fields." }),
    commit: z.string().optional(),
    set_version: z.string().optional(),
  })
  .catchall(z.unknown()) as unknown as z.ZodType<WeighingAssessmentBasis>;

export const WeighingAssessmentSchema = z
  .object({
    matrix: z.string(),
    subject: z.string(),
    criterion: z.string(),
    level: z.number().meta({ description: "A whole number on the set's scale. 0 means unrelated. No half points — but any number parses; the validator warns on one off the scale." }),
    scorer: WeighingScorerSchema.optional().meta({ description: "Who judged. Required in practice: without it a human, an agent and a rule are indistinguishable, so the validator warns." }),
    confidence: WeighingConfidenceSchema.meta({ description: "0 guess · 1 inferred · 2 evidenced · 3 verified." }),
    evidence: z.string().optional(),
    refs: z.array(z.string()).optional(),
    basis: WeighingAssessmentBasisSchema.optional().meta({ description: "What the scorer was looking at, so a re-read can tell the score went stale." }),
    run: z.string().optional(),
    ts: z.string(),
  })
  .catchall(z.unknown())
  .meta({ id: "WeighingAssessment", description: "One (matrix × subject × criterion) judgement — latest per scorer kind wins; history lives in the journal." }) as unknown as z.ZodType<WeighingAssessment>;

export const WeighingSectionSchema = z
  .object({
    sets: z.array(WeighingCriteriaSetSchema).optional(),
    matrices: z.array(WeighingMatrixSchema).optional(),
    assessments: z.array(WeighingAssessmentSchema).optional(),
  })
  .catchall(z.unknown())
  .meta({
    id: "WeighingSection",
    description:
      "The project's weighing state (docs/rfcs/weighing.md) — its own criteria sets (a positioning), matrices and assessments. The built-in value set is library content, not stored; served, cost and kept share are derived, never stored. Each list may be absent; a reader treats it as empty.",
  }) as unknown as z.ZodType<WeighingSection>;
