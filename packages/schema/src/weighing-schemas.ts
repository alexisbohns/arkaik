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
 */

import { z } from "zod";
import type {
  Assessment,
  AssessmentBasis,
  CriteriaSet,
  Matrix,
  Scorer,
  WeighingCriterion,
  WeighingGroup,
  WeighingScale,
  WeighingSection,
} from "./weighing";

export const ConfidenceSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);

export const ScorerSchema: z.ZodType<Scorer> = z
  .object({
    kind: z.enum(["human", "agent", "rule"]).meta({ description: "Who judged. A human's level beats an agent's, which beats a rule's." }),
    id: z.string().meta({ description: "A person's handle, an agent's name, or a seeding rule's id." }),
    model: z.string().optional().meta({ description: "The model behind an agent, when it says." }),
    on_behalf_of: z.string().optional().meta({ description: "Whom the scorer acts for: an opaque user id or handle, never an email. Stamped by the writer where identity is known." }),
  })
  .catchall(z.unknown())
  .meta({ id: "Scorer", description: "Provenance of one assessment." });

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

export const CriteriaSetSchema: z.ZodType<CriteriaSet> = z
  .object({
    id: z.string(),
    version: z.string().meta({ description: "Semver. Levels are comparable only within a major." }),
    title: z.string().optional(),
    subject: z.string().meta({ description: "What the set judges: acceptance today." }),
    scale: WeighingScaleSchema,
    groups: z.array(WeighingGroupSchema).optional(),
    criteria: z.array(WeighingCriterionSchema),
    role: z.literal("positioning").optional().meta({ description: "positioning marks the set a project writes about itself." }),
    status: z.enum(["draft", "active"]).optional().meta({ description: "Absent means active. A draft feeds no roll-up." }),
    extends: z.string().optional().meta({ description: "A positioning's ruler, e.g. value-contribution@1." }),
  })
  .catchall(z.unknown())
  .meta({ id: "CriteriaSet", description: "A versioned list of criteria for one kind of subject. The 30 elements of value are one; a positioning is another." });

export const MatrixSchema: z.ZodType<Matrix> = z
  .object({
    id: z.string(),
    title: z.string().optional(),
    set: z.string().meta({ description: "The set's id and major, e.g. value-contribution@1." }),
    subjects: z.union([
      z.object({ kind: z.literal("query"), species: z.string() }).catchall(z.unknown()),
      z
        .object({
          kind: z.literal("list"),
          items: z.array(z.object({ id: z.string(), title: z.string().optional(), node_id: z.string().optional() }).catchall(z.unknown())),
        })
        .catchall(z.unknown()),
    ]),
    positioning: z.string().optional().meta({ description: "The id of the positioning set that re-weights this matrix." }),
    context: z.object({ node_id: z.string() }).catchall(z.unknown()).optional(),
    status: z.enum(["draft", "active"]).optional(),
  })
  .catchall(z.unknown())
  .meta({ id: "Matrix", description: "A criteria set applied to a list of subjects." });

export const AssessmentBasisSchema: z.ZodType<AssessmentBasis> = z
  .object({
    fingerprint: z.string().optional().meta({ description: "A hash of the subject's judged fields." }),
    commit: z.string().optional(),
    set_version: z.string(),
  })
  .catchall(z.unknown());

export const AssessmentSchema: z.ZodType<Assessment> = z
  .object({
    matrix: z.string(),
    subject: z.string(),
    criterion: z.string(),
    level: z.number().int().meta({ description: "A whole number on the set's scale. 0 means unrelated. No half points." }),
    scorer: ScorerSchema,
    confidence: ConfidenceSchema.meta({ description: "0 guess · 1 inferred · 2 evidenced · 3 verified." }),
    evidence: z.string().optional(),
    refs: z.array(z.string()).optional(),
    basis: AssessmentBasisSchema.optional().meta({ description: "What the scorer was looking at, so a re-read can tell the score went stale." }),
    run: z.string().optional(),
    ts: z.string(),
  })
  .catchall(z.unknown())
  .meta({ id: "Assessment", description: "One (matrix × subject × criterion) judgement — latest per scorer kind wins; history lives in the journal." });

export const WeighingSectionSchema: z.ZodType<WeighingSection> = z
  .object({
    sets: z.array(CriteriaSetSchema),
    matrices: z.array(MatrixSchema),
    assessments: z.array(AssessmentSchema),
  })
  .catchall(z.unknown())
  .meta({
    id: "WeighingSection",
    description:
      "The project's weighing state (docs/rfcs/weighing.md) — its own criteria sets (a positioning), matrices and assessments. The built-in value set is library content, not stored; served, cost and kept share are derived, never stored.",
  });
