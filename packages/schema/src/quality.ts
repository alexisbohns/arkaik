/**
 * Kritik — the quality layer (docs/rfcs/kritik.md). A project pins a versioned
 * criteria **library**, declares a **profile** (its surfaces and domain
 * weights), and records **assessments** (a maturity level per criterion per
 * surface, with evidence) and **findings** (defects carrying impact,
 * likelihood, and remediation cost). Everything downstream — severity, the
 * priority lane, domain scores, grades, the anti-averaging caps — is
 * *derived* here and never stored, exactly as delivery and backlog are journal
 * projections rather than fields.
 *
 * Surfaces are Kritik-local, deliberately **not** an extension of
 * `PLATFORM_IDS` (RFC §2): a database contract or an admin back-office is an
 * audit target, not a view-shipping platform. A surface MAY carry a `platform`
 * mapping where the two coincide, which is what lets a `SEC` finding on `ios`
 * decorate iOS view variants later.
 *
 * Same doctrine as {@link ./maps} and {@link ./products}: pure functions,
 * minimal `Pick<>` inputs, immutable, deliberately **zod-free** (type-only
 * imports plus plain constants) so the module stays browser-safe and adds
 * nothing to the standalone validator bundle. The zod shapes live next door in
 * {@link ./quality-schemas}, the same split the journal already uses
 * (`journal.ts` types, `journal-events.ts` shapes).
 *
 * Everything here is lenient and total. A stale criterion id, a surface that
 * left the profile, a missing library — none of them throw; they degrade to an
 * N/A cell and a `validateBundle()` warning, because a hand-edited quality
 * section must never fail an import or a CI gate.
 *
 * The roll-up is a port of the pilot's reference implementation
 * (`docs/quality/scripts/compute-matrix.mjs` in pbbls#738); the golden test in
 * `tests/schema/quality.test.js` replays that audit's 338 assessments and 246
 * findings and asserts this produces its committed matrix.
 */

import type { PlatformId } from "./ids";
import type { ProjectBundle } from "./bundle";

/** Read an unknown field as an array, never throwing on a hand-edited section. */
const asArray = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

// --- Scales (packages/kritik-library/SPEC.md § 4) ----------------------------

/** How systematically a criterion is handled on a surface. N/A = row absent. */
export type MaturityLevel = 0 | 1 | 2 | 3 | 4;

export const MATURITY_LEVELS: readonly MaturityLevel[] = [0, 1, 2, 3, 4];

/** Severity bucket over `impact × likelihood` (1–25). */
export type FindingSeverity = "critical" | "high" | "medium" | "low" | "info";

export const FINDING_SEVERITIES: readonly FindingSeverity[] = ["critical", "high", "medium", "low", "info"];

/** Action lane derived from severity × cost. */
export type FindingPriority = "P0" | "P1" | "P2" | "P3";

export const FINDING_PRIORITIES: readonly FindingPriority[] = ["P0", "P1", "P2", "P3"];

/** Remediation cost band (SPEC §4.3). */
export type RemediationCost = "S" | "M" | "L" | "XL";

export const REMEDIATION_COSTS: readonly RemediationCost[] = ["S", "M", "L", "XL"];

/**
 * Finding lifecycle. `refuted` is a first-class outcome, not a deletion: the
 * framework's adversarial-verification pass discloses what it knocked down
 * (SPEC §1.7). `accepted-risk` is a decision, and reads like one in the UI.
 */
export type FindingStatus = "open" | "resolved" | "refuted" | "accepted-risk";

export const FINDING_STATUSES: readonly FindingStatus[] = ["open", "resolved", "refuted", "accepted-risk"];

/** Letter grade for a (domain × surface) cell or a surface roll-up. */
export type QualityGrade = "A" | "B" | "C" | "D" | "E";

/** Best to worst — the order `capGrade` walks to take the harsher of two. */
export const QUALITY_GRADES: readonly QualityGrade[] = ["A", "B", "C", "D", "E"];

/** Inclusive lower bound of each grade band (SPEC §4.5). */
export const DEFAULT_GRADE_BANDS: Readonly<Record<QualityGrade, number>> = { A: 85, B: 70, C: 55, D: 40, E: 0 };

/** Inclusive `[min, max]` of `impact × likelihood` per severity (SPEC §4.2). */
export const DEFAULT_SEVERITY_BUCKETS: Readonly<Record<FindingSeverity, readonly [number, number]>> = {
  critical: [20, 25],
  high: [12, 19],
  medium: [6, 11],
  low: [2, 5],
  info: [1, 1],
};

/**
 * The anti-averaging rules (SPEC §4.5): one open Critical finding caps its
 * (domain × surface) grade at D, one open High caps it at B. Without these a
 * domain full of 3s absorbs a live account-takeover into a B.
 */
export const DEFAULT_CAPS: Readonly<{ critical_open: QualityGrade; high_open: QualityGrade }> = {
  critical_open: "D",
  high_open: "B",
};

/** Overridable scale table carried by a library pack. */
export interface KritikScales extends Record<string, unknown> {
  grades?: Partial<Record<QualityGrade, number>>;
  severity_buckets?: Partial<Record<FindingSeverity, readonly [number, number]>>;
  caps?: { critical_open?: QualityGrade; high_open?: QualityGrade };
}

// --- The library (the pinned criteria pack) ----------------------------------

/** A stable, precise external anchor (OWASP control, GDPR article, WCAG SC…). */
export interface KritikReference extends Record<string, unknown> {
  title: string;
  anchor?: string;
  url?: string;
}

/** The per-criterion GitHub issue skeleton a project fills in and files. */
export interface KritikIssueTemplate extends Record<string, unknown> {
  title_template?: string;
  labels?: string[];
  body_skeleton?: string;
}

/** A top-level category (Security, Privacy, …) owning criteria and a roll-up. */
export interface KritikDomain extends Record<string, unknown> {
  /** Stable identifier, e.g. `SEC`. Criterion ids are `<code>-NN`. */
  code: string;
  name: string;
  description?: string;
}

/**
 * The atomic auditable unit. Criteria are **append-and-supersede**: an id is
 * never redefined, only deprecated via `superseded_by` and replaced, so a score
 * recorded two audits ago still means what it meant (SPEC §8).
 */
export interface KritikCriterion extends Record<string, unknown> {
  id: string;
  /** Owning {@link KritikDomain.code}. */
  domain: string;
  subcategory?: string;
  name?: string;
  question?: string;
  definition?: string;
  rationale?: string;
  /** Surface ids where the criterion is meaningful; absence from it means N/A. */
  applies_to?: string[];
  /** Observable descriptions of each maturity level, keyed `l0`…`l4`. */
  level_anchors?: Record<string, string>;
  /** Seeds a finding's impact (1–5). */
  default_impact?: number;
  /** Weight in the domain roll-up (1–3; 3 = load-bearing). */
  weight?: number;
  references?: KritikReference[];
  /** Concrete audit steps an agent can execute. */
  checklist?: string[];
  /** Mechanically checkable monitoring hooks between audits. */
  signals?: string[];
  remediation?: string;
  issue?: KritikIssueTemplate;
  /** Id of the criterion that replaces this one; set means retired. */
  superseded_by?: string;
}

/** A versioned criteria pack: the scales, the domains, and the criteria. */
export interface KritikLibrary extends Record<string, unknown> {
  version: string;
  domains: KritikDomain[];
  criteria: KritikCriterion[];
  scales?: KritikScales;
}

// --- The project's own quality state -----------------------------------------

/**
 * One independently assessable body of code. `platform` is the optional bridge
 * back to `PLATFORM_IDS` for the surfaces that happen to be view-shipping
 * platforms; `admin` and `supabase` shaped surfaces simply have none.
 */
export interface SurfaceDef extends Record<string, unknown> {
  id: string;
  title: string;
  platform?: PlatformId;
  /** Where the surface lives in the repo, e.g. `apps/web`. */
  path?: string;
}

/**
 * The reserved surface id for the contract *between* surfaces (SPEC § 6.4). A
 * dedicated auditor checks schema/RPC symmetry, client-to-client payload
 * tolerance, and mirror parity; a defect there belongs to the contract, not to
 * any one client, so it cannot honestly be filed against a single surface.
 *
 * It is a findings-only lens: it holds no assessments and therefore never
 * becomes a matrix column, which is why a project never picks it and the
 * profile never declares it. Its findings still count in the global tallies —
 * a broken contract between two clients is not less real for spanning them.
 */
export const CROSS_SURFACE_ID = "cross-surface";

/**
 * The project's parameterization of the pack, written at install time by the
 * surface picker. `domain_weights` grades a product hardest on the dimensions
 * where its users are most exposed; a missing weight is 1.
 */
export interface QualityProfile extends Record<string, unknown> {
  surfaces: SurfaceDef[];
  domain_weights?: Record<string, number>;
}

/** One (criterion × surface) score with the evidence behind it. */
export interface QualityAssessment extends Record<string, unknown> {
  /** Resolved against the pinned library, e.g. `SEC-01`. */
  criterion_id: string;
  /** A {@link SurfaceDef.id} from the profile. */
  surface: string;
  level: MaturityLevel;
  /** `file:line` / config citations, markdown. A score without it is an opinion. */
  evidence: string;
  /** The audit run this score belongs to, e.g. `2026-08`. */
  audit_id: string;
  /** Commit the evidence is pinned to. */
  commit?: string;
  /** ISO 8601 timestamp. */
  ts: string;
}

/**
 * One concrete defect or gap. `severity` and `priority` are deliberately absent
 * — they are {@link severityOf} and {@link priorityOf} of the stored risk
 * inputs, so a finding can never carry a severity its own numbers disagree with.
 */
export interface QualityFinding extends Record<string, unknown> {
  /** e.g. `F-2026-08-SEC-web-01`. */
  id: string;
  criterion_id: string;
  surface: string;
  title: string;
  detail: string;
  evidence: string;
  /** Worst plausible consequence, 1–5 (SPEC §4.2). */
  impact: number;
  /** Probability it materializes, 1–5 (SPEC §4.2). */
  likelihood: number;
  cost: RemediationCost;
  status: FindingStatus;
  remediation?: string;
  /** Graph nodes this finding is about — the same tie `deliverable.shipped` uses. */
  node_ids?: string[];
  issue_url?: string;
  /** Commit SHA anchoring the `file:line` evidence (issue #400 decision 4). */
  commit?: string;
  /** Result of the adversarial refutation pass (SPEC §6.5). */
  verification?: { verdict: "CONFIRMED" | "REFUTED" | "DOWNGRADED"; note?: string };
}

/**
 * The project-owned quality state, a top-level bundle section rather than a
 * seventh species: 88 criteria × surfaces would drown a product graph, and
 * criteria are library content, not product anatomy (RFC §4.1).
 */
export interface QualitySection extends Record<string, unknown> {
  /** The pack version the assessments were scored against. */
  framework_version: string;
  /** Embedded on export; repos may instead keep the pack as a sidecar file. */
  library?: KritikLibrary;
  profile: QualityProfile;
  /** Latest per (criterion × surface); the history lives in the journal. */
  assessments: QualityAssessment[];
  findings: QualityFinding[];
}

// --- The project-local overlay (RFC § 6) -------------------------------------

/**
 * A project's own criteria, layered over the pinned pack at load. It lives
 * beside the pack rather than inside it — `docs/quality/criteria.custom.json` —
 * which is the whole point: a pack upgrade rewrites the pack and never touches
 * this file, so a project's own criteria survive every bump.
 */
export interface KritikOverlay extends Record<string, unknown> {
  /** The pack version this overlay was authored against. Informational. */
  extends?: string;
  /** Project-defined domains, for criteria that fit none of the pack's. */
  domains?: KritikDomain[];
  criteria?: KritikCriterion[];
  /** Scale overrides, shallow-merged over the pack's. */
  scales?: KritikScales;
}

/**
 * The effective library: the pinned pack with a project's overlay layered on.
 *
 * Matching ids **replace** rather than merge — an overlay criterion is a
 * complete criterion, and half of one silently inheriting the other half's
 * anchors would produce a criterion nobody wrote. Non-matching ids append, in
 * pack-then-overlay order, so a custom criterion rolls up into its domain
 * exactly like a pack one.
 *
 * Returns fresh data and never mutates either input. An absent or malformed
 * overlay yields the pack untouched: a project that has not written one yet is
 * the normal case, not an error.
 */
export function mergeKritikLibrary(pack: KritikLibrary, overlay?: KritikOverlay | null): KritikLibrary {
  if (!overlay || typeof overlay !== "object") return pack;

  const domains = [...asArray<KritikDomain>(pack.domains)];
  for (const domain of asArray<KritikDomain>(overlay.domains)) {
    if (typeof domain?.code !== "string" || domain.code === "") continue;
    const at = domains.findIndex((existing) => existing?.code === domain.code);
    if (at >= 0) domains[at] = domain;
    else domains.push(domain);
  }

  const criteria = [...asArray<KritikCriterion>(pack.criteria)];
  for (const criterion of asArray<KritikCriterion>(overlay.criteria)) {
    if (typeof criterion?.id !== "string" || criterion.id === "") continue;
    const at = criteria.findIndex((existing) => existing?.id === criterion.id);
    if (at >= 0) criteria[at] = criterion;
    else criteria.push(criterion);
  }

  const scales =
    pack.scales || overlay.scales
      ? { ...(pack.scales ?? {}), ...(overlay.scales ?? {}) }
      : undefined;

  return { ...pack, domains, criteria, ...(scales ? { scales } : {}) };
}

/**
 * The criteria a run should actually score, given a library and the surfaces a
 * profile declares: every non-retired criterion whose `applies_to` intersects
 * the selected surfaces, paired with those surfaces. A criterion with no
 * `applies_to` is treated as applying everywhere — the pack always states it,
 * but a hand-written custom criterion that forgot to should widen rather than
 * silently vanish.
 *
 * This is what collapses a single-surface project's matrix to one column
 * without any special case: intersect a five-surface pack with one surface and
 * every cell set has exactly one member.
 */
export function applicableCells(
  library: Pick<KritikLibrary, "criteria">,
  surfaces: readonly string[],
): { criterion_id: string; surfaces: string[] }[] {
  const selected = surfaces.filter((id) => id !== CROSS_SURFACE_ID);
  const cells: { criterion_id: string; surfaces: string[] }[] = [];
  for (const criterion of asArray<KritikCriterion>(library.criteria)) {
    if (typeof criterion?.id !== "string" || criterion.id === "") continue;
    if (typeof criterion.superseded_by === "string" && criterion.superseded_by !== "") continue;
    const appliesTo = Array.isArray(criterion.applies_to) ? criterion.applies_to : undefined;
    const matched = appliesTo === undefined ? [...selected] : selected.filter((id) => appliesTo.includes(id));
    if (matched.length > 0) cells.push({ criterion_id: criterion.id, surfaces: matched });
  }
  return cells;
}

// --- Derivations (SPEC §4.2–4.5) ---------------------------------------------

function bucketsOf(library?: KritikLibrary): Record<FindingSeverity, readonly [number, number]> {
  const stored = library?.scales?.severity_buckets;
  const out = { ...DEFAULT_SEVERITY_BUCKETS } as Record<FindingSeverity, readonly [number, number]>;
  if (!stored || typeof stored !== "object") return out;
  for (const severity of FINDING_SEVERITIES) {
    const band = (stored as Record<string, unknown>)[severity];
    if (Array.isArray(band) && typeof band[0] === "number" && typeof band[1] === "number") {
      out[severity] = [band[0], band[1]];
    }
  }
  return out;
}

function bandsOf(library?: KritikLibrary): Record<QualityGrade, number> {
  const stored = library?.scales?.grades;
  const out = { ...DEFAULT_GRADE_BANDS } as Record<QualityGrade, number>;
  if (!stored || typeof stored !== "object") return out;
  for (const grade of QUALITY_GRADES) {
    const min = (stored as Record<string, unknown>)[grade];
    if (typeof min === "number" && Number.isFinite(min)) out[grade] = min;
  }
  return out;
}

function capsOf(library?: KritikLibrary): { critical_open: QualityGrade; high_open: QualityGrade } {
  const stored = library?.scales?.caps;
  const pick = (value: unknown, fallback: QualityGrade): QualityGrade =>
    typeof value === "string" && (QUALITY_GRADES as readonly string[]).includes(value) ? (value as QualityGrade) : fallback;
  return {
    critical_open: pick(stored?.critical_open, DEFAULT_CAPS.critical_open),
    high_open: pick(stored?.high_open, DEFAULT_CAPS.high_open),
  };
}

/**
 * Risk bucket for a finding: `impact × likelihood` against the severity bands,
 * matched on each band's lower bound walking worst-first. Bounds rather than
 * ranges because a score above the top band must read `critical`, not fall
 * through to `info` — leniency here has to fail loud, not quiet. Non-numeric
 * inputs score 0 and land in `info` rather than throwing; the shape rules
 * report those while the projection keeps rendering.
 */
export function severityOf(
  finding: Pick<QualityFinding, "impact" | "likelihood">,
  library?: KritikLibrary,
): FindingSeverity {
  const impact = typeof finding.impact === "number" ? finding.impact : 0;
  const likelihood = typeof finding.likelihood === "number" ? finding.likelihood : 0;
  const score = impact * likelihood;
  const buckets = bucketsOf(library);
  const worstFirst = [...FINDING_SEVERITIES].sort((a, b) => buckets[b][0] - buckets[a][0]);
  for (const severity of worstFirst) {
    if (score >= buckets[severity][0]) return severity;
  }
  return "info";
}

/**
 * The action lane (SPEC §4.4). Critical is never demoted by cost: an expensive
 * Critical is still P0 — cost budgets the fix, it does not decide whether.
 */
export function priorityOf(
  finding: Pick<QualityFinding, "impact" | "likelihood" | "cost">,
  library?: KritikLibrary,
): FindingPriority {
  const severity = severityOf(finding, library);
  const cheap = finding.cost === "S";
  if (severity === "critical") return "P0";
  if (severity === "high") return cheap ? "P0" : "P1";
  if (severity === "medium") return cheap ? "P1" : "P2";
  if (severity === "low") return cheap ? "P2" : "P3";
  return "P3";
}

/** Letter grade for a 0–100 score, matched on each band's lower bound, best first. */
export function gradeOf(score: number, library?: KritikLibrary): QualityGrade {
  const bands = bandsOf(library);
  const bestFirst = [...QUALITY_GRADES].sort((a, b) => bands[b] - bands[a]);
  for (const grade of bestFirst) {
    if (score >= bands[grade]) return grade;
  }
  return "E";
}

/** The harsher (lower) of two grades — how a cap is applied. */
export function capGrade(grade: QualityGrade, cap: QualityGrade): QualityGrade {
  return QUALITY_GRADES[Math.max(QUALITY_GRADES.indexOf(grade), QUALITY_GRADES.indexOf(cap))];
}

/** Only `open` findings weigh on a cell; an absent status reads as open. */
export function isOpenFinding(finding: Pick<QualityFinding, "status">): boolean {
  return (finding.status ?? "open") === "open";
}

// --- The comparative matrix ---------------------------------------------------

/** One (domain × surface) cell. `null` in the matrix means N/A — nothing scored. */
export interface QualityMatrixCell {
  /** Weighted maturity as a 0–100 percentage. */
  score: number;
  /** Band of `score`, after caps. */
  grade: QualityGrade;
  /** True when an open Critical/High finding pulled the grade below its band. */
  capped: boolean;
  /** How many assessments the score averages. */
  criteria: number;
  /** Open findings in this cell by severity. */
  findings: { critical: number; high: number; medium: number; low: number };
}

export interface QualityMatrix {
  framework_version?: string;
  /** Column order — the profile's surfaces. */
  surfaces: string[];
  /** Row order — the library's domains. */
  domains: string[];
  /** `matrix[domainCode][surfaceId]`. */
  matrix: Record<string, Record<string, QualityMatrixCell | null>>;
  /** Weighted mean of a surface's domain scores, `null` when nothing applies. */
  overall: Record<string, number | null>;
  /** Every open finding by severity, including ones outside any cell. */
  finding_counts: Record<FindingSeverity, number>;
}

/**
 * The library to score against: an explicit pack (the sidecar case, lane 1),
 * else the one embedded in the section. When neither exists the assessments
 * still have to render, so a minimal library is synthesized from the criterion
 * ids themselves — `SEC-01` implies domain `SEC`, every weight 1, domains in
 * alphabetical order. That keeps a lane-1 bundle whose pack lives outside the
 * repo readable instead of blank; `validateBundle()` warns that the pack is
 * missing so the degradation is never silent.
 */
export function resolveKritikLibrary(
  section: Pick<QualitySection, "library" | "assessments" | "findings"> | undefined,
  library?: KritikLibrary,
): KritikLibrary | undefined {
  const explicit = library ?? section?.library;
  if (explicit && Array.isArray(explicit.criteria) && Array.isArray(explicit.domains)) return explicit;
  if (!section) return undefined;

  const ids = new Set<string>();
  for (const row of [...asArray<QualityAssessment>(section.assessments), ...asArray<QualityFinding>(section.findings)]) {
    if (typeof row?.criterion_id === "string" && row.criterion_id !== "") ids.add(row.criterion_id);
  }
  if (ids.size === 0) return undefined;

  // `SEC-01` implies `SEC`, `A11Y-01` implies `A11Y`. Split on the LAST hyphen
  // so a hyphenated domain code survives; an id with none is its own domain.
  const domainOf = (id: string) => (id.includes("-") ? id.slice(0, id.lastIndexOf("-")) : id);
  const criteria = [...ids].sort().map((id) => ({ id, domain: domainOf(id), weight: 1 }));
  const domains = [...new Set(criteria.map((c) => c.domain))].sort().map((code) => ({ code, name: code }));
  return { version: explicit?.version ?? "unknown", domains, criteria, scales: explicit?.scales };
}

/**
 * The comparative matrix for a bundle's stored quality state (RFC §4.1): rows
 * domains, columns the profile's surfaces, each cell a weighted maturity score
 * with its grade, its cap flag, and its open-finding tally.
 *
 * Domain score = `Σ(level × weight) / Σ(4 × weight) × 100` over the criteria
 * actually scored on that surface — never over the ones that were skipped, so a
 * narrow audit reads as a narrow audit rather than a bad one. A cell with no
 * assessments is `null` (N/A) and drops out of the surface roll-up entirely.
 *
 * Pass `library` to score against a sidecar pack; otherwise the section's
 * embedded one is used. Returns fresh data and never mutates its input; a
 * bundle with no `quality` section yields the empty matrix, never an error.
 */
export function deriveQualityMatrix(
  bundle: Pick<ProjectBundle, "quality">,
  library?: KritikLibrary,
): QualityMatrix {
  const section = bundle.quality;
  const pack = resolveKritikLibrary(section, library);

  const assessments = asArray<QualityAssessment>(section?.assessments);
  const findings = asArray<QualityFinding>(section?.findings);
  const openFindings = findings.filter((finding) => isOpenFinding(finding));

  // Column order is the profile's, so the picker's choices drive the UI. With
  // no profile (a sidecar-only lane-1 bundle) fall back to the surfaces the
  // assessments actually name, sorted, rather than rendering nothing.
  const declared = asArray<SurfaceDef>(section?.profile?.surfaces)
    .map((surface) => surface?.id)
    .filter((id): id is string => typeof id === "string" && id !== "");
  const surfaces = declared.length > 0 ? [...new Set(declared)] : [...new Set(assessments.map((a) => a.surface).filter((id): id is string => typeof id === "string" && id !== ""))].sort();

  const domains = asArray<KritikDomain>(pack?.domains)
    .map((domain) => domain?.code)
    .filter((code): code is string => typeof code === "string" && code !== "");

  const domainOfCriterion = new Map<string, string>();
  const weightOfCriterion = new Map<string, number>();
  for (const criterion of asArray<KritikCriterion>(pack?.criteria)) {
    if (typeof criterion?.id !== "string") continue;
    if (typeof criterion.domain === "string") domainOfCriterion.set(criterion.id, criterion.domain);
    weightOfCriterion.set(criterion.id, typeof criterion.weight === "number" && criterion.weight > 0 ? criterion.weight : 1);
  }

  const caps = capsOf(pack);
  const weights = section?.profile?.domain_weights;

  const matrix: Record<string, Record<string, QualityMatrixCell | null>> = {};
  for (const domain of domains) {
    matrix[domain] = {};
    for (const surface of surfaces) {
      // An unresolvable criterion_id belongs to no domain, so it lands in no
      // cell — deliberately, since scoring it would need a weight nobody wrote.
      const rows = assessments.filter((a) => a.surface === surface && domainOfCriterion.get(a.criterion_id) === domain);
      if (rows.length === 0) {
        matrix[domain][surface] = null;
        continue;
      }

      let earned = 0;
      let available = 0;
      for (const row of rows) {
        const weight = weightOfCriterion.get(row.criterion_id) ?? 1;
        const level = typeof row.level === "number" ? Math.min(Math.max(row.level, 0), 4) : 0;
        earned += level * weight;
        available += 4 * weight;
      }
      if (available === 0) {
        matrix[domain][surface] = null;
        continue;
      }
      const score = Math.round((earned / available) * 100);

      const cellSeverities = openFindings
        .filter((finding) => finding.surface === surface && domainOfCriterion.get(finding.criterion_id) === domain)
        .map((finding) => severityOf(finding, pack));

      const banded = gradeOf(score, pack);
      let grade = banded;
      if (cellSeverities.includes("critical")) grade = capGrade(grade, caps.critical_open);
      else if (cellSeverities.includes("high")) grade = capGrade(grade, caps.high_open);

      matrix[domain][surface] = {
        score,
        grade,
        capped: grade !== banded,
        criteria: rows.length,
        findings: {
          critical: cellSeverities.filter((s) => s === "critical").length,
          high: cellSeverities.filter((s) => s === "high").length,
          medium: cellSeverities.filter((s) => s === "medium").length,
          low: cellSeverities.filter((s) => s === "low").length,
        },
      };
    }
  }

  // Surface roll-up: the weighted mean of the *scores*, not the grades. Caps
  // shape the cell a reader acts on; folding them in again here would punish
  // one finding twice.
  const overall: Record<string, number | null> = {};
  for (const surface of surfaces) {
    let weighted = 0;
    let total = 0;
    for (const domain of domains) {
      const cell = matrix[domain]?.[surface];
      if (!cell) continue;
      const weight = typeof weights?.[domain] === "number" ? weights[domain] : 1;
      weighted += cell.score * weight;
      total += weight;
    }
    overall[surface] = total > 0 ? Math.round(weighted / total) : null;
  }

  const finding_counts: Record<FindingSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const finding of openFindings) finding_counts[severityOf(finding, pack)]++;

  return {
    framework_version: section?.framework_version,
    surfaces,
    domains,
    matrix,
    overall,
    finding_counts,
  };
}
