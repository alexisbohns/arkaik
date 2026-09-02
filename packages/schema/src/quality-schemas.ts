/**
 * Zod schemas for the Kritik quality section (docs/rfcs/kritik.md § 4.1).
 *
 * Same split as the journal's: {@link ./quality} owns the types and the pure
 * projections and stays zod-free so the standalone validator can bundle it,
 * this module owns the shapes. Every object is `.catchall(z.unknown())` — a
 * pack that grows a field, or a project that hangs its own key off a criterion,
 * must survive import → export → Synk → Publik untouched, exactly as unknown
 * journal event types do.
 *
 * The section is additive: `schema_version` stays 3, and older readers preserve
 * `quality` through the bundle root's own catchall.
 */

import { z } from "zod";
import { PlatformSchema } from "./enums";
import type {
  KritikCriterion,
  KritikDomain,
  KritikIssueTemplate,
  KritikLibrary,
  KritikReference,
  KritikScales,
  QualityAssessment,
  QualityFinding,
  QualityProfile,
  QualitySection,
  SurfaceDef,
} from "./quality";

const GradeSchema = z.enum(["A", "B", "C", "D", "E"]);

export const KritikScalesSchema: z.ZodType<KritikScales> = z
  .object({
    grades: z.partialRecord(GradeSchema, z.number()).optional(),
    severity_buckets: z
      .partialRecord(z.enum(["critical", "high", "medium", "low", "info"]), z.tuple([z.number(), z.number()]))
      .optional(),
    caps: z
      .object({ critical_open: GradeSchema.optional(), high_open: GradeSchema.optional() })
      .catchall(z.unknown())
      .optional(),
  })
  .catchall(z.unknown())
  .meta({
    id: "KritikScales",
    description:
      "Overridable maturity/severity/grade scales carried by a criteria pack. Absent entries fall back to the framework defaults (packages/kritik-library/SPEC.md § 4).",
  });

export const KritikReferenceSchema: z.ZodType<KritikReference> = z
  .object({ title: z.string(), anchor: z.string().optional(), url: z.string().optional() })
  .catchall(z.unknown())
  .meta({ id: "KritikReference", description: "A stable external anchor behind a criterion (OWASP control, GDPR article, WCAG SC…)." });

export const KritikIssueTemplateSchema: z.ZodType<KritikIssueTemplate> = z
  .object({
    title_template: z.string().optional(),
    labels: z.array(z.string()).optional(),
    body_skeleton: z.string().optional(),
  })
  .catchall(z.unknown())
  .meta({ id: "KritikIssueTemplate", description: "Per-criterion issue skeleton — what `arkaik kritik issue` prefills." });

export const KritikDomainSchema: z.ZodType<KritikDomain> = z
  .object({ code: z.string(), name: z.string(), description: z.string().optional() })
  .catchall(z.unknown())
  .meta({ id: "KritikDomain", description: "A top-level criteria category owning a roll-up row in the matrix." });

export const KritikCriterionSchema: z.ZodType<KritikCriterion> = z
  .object({
    id: z.string().meta({ description: "Stable identifier, `<DOMAIN>-NN`. Never redefined — retired via superseded_by." }),
    domain: z.string(),
    subcategory: z.string().optional(),
    name: z.string().optional(),
    question: z.string().optional(),
    definition: z.string().optional(),
    rationale: z.string().optional(),
    applies_to: z.array(z.string()).optional().meta({ description: "Surface ids where the criterion is meaningful; absence means N/A." }),
    level_anchors: z.record(z.string(), z.string()).optional().meta({ description: "Observable descriptions per maturity level, keyed l0…l4." }),
    default_impact: z.number().optional(),
    weight: z.number().optional().meta({ description: "Weight in the domain roll-up (1–3; 3 = load-bearing). Absent means 1." }),
    references: z.array(KritikReferenceSchema).optional(),
    checklist: z.array(z.string()).optional(),
    signals: z.array(z.string()).optional().meta({ description: "Mechanically checkable monitoring hooks run between audits." }),
    remediation: z.string().optional(),
    issue: KritikIssueTemplateSchema.optional(),
    superseded_by: z.string().optional(),
  })
  .catchall(z.unknown())
  .meta({ id: "KritikCriterion", description: "The atomic auditable unit (packages/kritik-library/SPEC.md § 5)." });

export const KritikLibrarySchema: z.ZodType<KritikLibrary> = z
  .object({
    version: z.string().meta({ description: "Semver of the pack; matrices are comparable only within a major." }),
    domains: z.array(KritikDomainSchema),
    criteria: z.array(KritikCriterionSchema),
    scales: KritikScalesSchema.optional(),
  })
  .catchall(z.unknown())
  .meta({
    id: "KritikLibrary",
    description: "A versioned criteria pack. Embedded on export; repos may instead pin it as a sidecar file.",
  });

export const SurfaceDefSchema: z.ZodType<SurfaceDef> = z
  .object({
    id: z.string(),
    title: z.string(),
    platform: PlatformSchema.optional().meta({
      description: "Optional bridge to PLATFORM_IDS where a surface is also a view-shipping platform. Surfaces are not platforms (RFC § 2).",
    }),
    path: z.string().optional(),
  })
  .catchall(z.unknown())
  .meta({ id: "SurfaceDef", description: "One independently assessable body of code — an audit target, chosen at install." });

export const QualityProfileSchema: z.ZodType<QualityProfile> = z
  .object({
    surfaces: z.array(SurfaceDefSchema),
    domain_weights: z.record(z.string(), z.number()).optional().meta({
      description: "Per-domain weight in the surface roll-up, keyed by domain code. A missing weight is 1.",
    }),
  })
  .catchall(z.unknown())
  .meta({ id: "QualityProfile", description: "The project's parameterization of the pack (RFC § 6)." });

export const QualityAssessmentSchema: z.ZodType<QualityAssessment> = z
  .object({
    criterion_id: z.string(),
    surface: z.string(),
    level: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).meta({
      description: "Maturity 0–4. N/A is the absence of the row, never a level.",
    }),
    evidence: z.string().meta({ description: "file:line / config citations. A score without evidence is an opinion, not an assessment." }),
    audit_id: z.string(),
    commit: z.string().optional(),
    ts: z.string(),
  })
  .catchall(z.unknown())
  .meta({ id: "QualityAssessment", description: "One (criterion × surface) score — latest wins; history lives in the journal." });

export const QualityFindingSchema: z.ZodType<QualityFinding> = z
  .object({
    id: z.string(),
    criterion_id: z.string(),
    surface: z.string(),
    title: z.string(),
    detail: z.string(),
    evidence: z.string(),
    impact: z.number().meta({ description: "Worst plausible consequence, 1–5." }),
    likelihood: z.number().meta({ description: "Probability it materializes, 1–5." }),
    cost: z.enum(["S", "M", "L", "XL"]),
    status: z.enum(["open", "resolved", "refuted", "accepted-risk"]),
    remediation: z.string().optional(),
    node_ids: z.array(z.string()).optional().meta({ description: "Graph nodes this finding is about — the tie deliverable.shipped already uses." }),
    issue_url: z.string().optional(),
    commit: z.string().optional().meta({
      description:
        "Commit SHA anchoring the file:line evidence. Required by policy on any finding written away from a checkout (issue #400 decision 4) — without it a stale citation is indistinguishable from a wrong one.",
    }),
    verification: z
      .object({ verdict: z.enum(["CONFIRMED", "REFUTED", "DOWNGRADED"]), note: z.string().optional() })
      .catchall(z.unknown())
      .optional()
      .meta({ description: "Result of the adversarial refutation pass. Refuted findings are disclosed, not deleted." }),
  })
  .catchall(z.unknown())
  .meta({
    id: "QualityFinding",
    description:
      "One concrete defect. Severity and priority are deliberately absent — they are derived from impact × likelihood and cost (deriveQualityMatrix), so a finding can never carry a severity its own numbers disagree with.",
  });

export const QualitySectionSchema: z.ZodType<QualitySection> = z
  .object({
    framework_version: z.string(),
    library: KritikLibrarySchema.optional(),
    profile: QualityProfileSchema,
    assessments: z.array(QualityAssessmentSchema),
    findings: z.array(QualityFindingSchema),
  })
  .catchall(z.unknown())
  .meta({
    id: "QualitySection",
    description:
      "The project's Kritik state (docs/rfcs/kritik.md § 4.1) — profile, assessments, findings. Criteria are library content, not graph nodes; the matrix is a projection, never stored.",
  });
