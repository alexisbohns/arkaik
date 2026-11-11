/**
 * The Kritik planner's shapes and pure rules
 * (docs/superpowers/specs/2026-11-11-kritik-planner-design.md; the stack
 * contract is docs/superpowers/plans/2026-11-11-kritik-planner-stack.md).
 *
 * A plan splits a partial audit into parts, one per domain × surface. Each part
 * scores into its own audit directory, named so it sorts after every audit
 * that already exists: the merge is latest-wins in lexical id order, so a part
 * that sorted earlier would have its fresh scores outvoted by the stale ones.
 *
 * Same disciplines as `quality-scope.ts`: zod-free (the plan file's zod schema
 * lives in `quality-schemas.ts`, annotated against the interfaces here),
 * fs-free, and nothing mutates its input. The top level holds only regex
 * literals, constants, types and function declarations — no calls — so
 * esbuild drops this module from any plugin script that does not use it.
 */

import { applicableCells, CROSS_SURFACE_ID, type KritikCriterion, type KritikLibrary, type QualityAssessment } from "./quality";
import { domainCodeOf } from "./quality-ops";
import { planRecordCommand, renderPartPrompt, renderPlanPrompt } from "./kritik-plan-prompt";

// --- Shapes ------------------------------------------------------------------

/** The plan file's `schema` value. A reader refuses any other. */
export const KRITIK_PLAN_SCHEMA = "arkaik.kritik.plan/1";

/** Where plan files live, under `docs/quality/`. */
export const PLAN_PLANS_DIR = "plans";

export interface KritikPlanBand {
  low: number;
  mid: number;
  high: number;
}

export interface KritikPlanCell {
  criterion_id: string;
  surface: string;
}

export interface KritikPlanEstimate {
  tokens: KritikPlanBand;
  usd: KritikPlanBand | null;
  inputs: { P: number; B: number; c: KritikPlanBand; q: KritikPlanBand; h: KritikPlanBand; V: KritikPlanBand };
  calibrated: boolean;
}

export interface KritikPlanPart {
  domain: string;
  surface: string;
  auditId: string;
  cells: KritikPlanCell[];
  steps: number;
  /** Always `null` until the estimator ships. */
  estimate: KritikPlanEstimate | null;
  /** Always `"included"` until budgets ship. */
  status: "included" | "deferred";
  prompt: string;
}

export interface KritikPlan {
  schema: typeof KRITIK_PLAN_SCHEMA;
  planId: string;
  createdAt: string;
  commit: string | null;
  frameworkVersion: string;
  tier: string | null;
  budgetTokens: number | null;
  budgetUsd: number | null;
  pricePerMTok: number | null;
  parts: KritikPlanPart[];
  totals: { cells: number; steps: number; applicableCells: number; tokens: KritikPlanBand | null; usd: KritikPlanBand | null };
  prompt: string;
  recordCommand: string;
}

/** One `--run DOMAIN:SURFACE`: the domain upper case, the surface exactly as the profile declares it. */
export interface PlanRun {
  domain: string;
  surface: string;
}

// --- Partial audit ids ---------------------------------------------------------

/** `<month>-scoped`, `<month>-scoped-02`…, and a scoped re-audit named after a plan part. */
const SCOPED_AUDIT_ID = /-scoped(-\d+)?$/;
/** `YYYY-MM-zplan-DDNN`. */
const PLAN_ID = /^\d{4}-\d{2}-zplan-\d{4}$/;
/** `<planId>-<domain>-<surface>`, lower case. */
const PLAN_PART_ID = /^\d{4}-\d{2}-zplan-\d{4}-[a-z0-9]{2,5}-.+$/;
/** The length of a plan id, and so the prefix of each of its part ids. */
const PLAN_ID_LENGTH = 18;

/** The key a plan names a cell by in `scope.scored` — the `criterion::surface` key `quality-scope.ts` uses. */
export function planCellKey(criterionId: string, surface: string): string {
  return `${criterionId}::${surface}`;
}

/** A scoped re-audit's id: `<month>-scoped`, `-scoped-NN`, or `<partId>-scoped…`. */
export function isScopedAuditId(id: unknown): boolean {
  return typeof id === "string" && SCOPED_AUDIT_ID.test(id);
}

/** A plan's own id. It names the plan file and the recorded event, never an audit directory. */
export function isPlanId(id: unknown): boolean {
  return typeof id === "string" && PLAN_ID.test(id);
}

/** A plan part's audit id. A scoped id always wins: `2026-11-zplan-1100-sec-web-scoped` is a scoped re-audit, not a part. */
export function isPlanPartId(id: unknown): boolean {
  return typeof id === "string" && PLAN_PART_ID.test(id) && !isScopedAuditId(id);
}

/** An id whose reading covers part of the product: a scoped re-audit, a plan, or one of its parts. Never an implicit baseline. */
export function isPartialAuditId(id: unknown): boolean {
  return isScopedAuditId(id) || isPlanId(id) || isPlanPartId(id);
}

/** The plan a part id belongs to, or `null` when `id` is not a plan part. */
export function planIdOfPartId(id: string): string | null {
  return isPlanPartId(id) ? id.slice(0, PLAN_ID_LENGTH) : null;
}

// --- The --run grammar -----------------------------------------------------------

/** `DOMAIN:SURFACE`. Domain codes carry digits (`A11Y`); surfaces are profile ids. */
const RUN_TOKEN = /^([A-Za-z0-9]{2,5}):([A-Za-z0-9_-]+)$/;
/** A domain code a `--run` token can name once upper-cased. A declared code outside it can never be planned. */
const PLANNABLE_DOMAIN = /^[A-Z0-9]{2,5}$/;

/**
 * The `--run` tokens as parts, in the order given (the priority order a budget
 * cut will walk). The domain is upper-cased and must be one of
 * `vocabulary.domains` (the effective library's codes, pack plus overlay); the
 * surface must equal one of `vocabulary.surfaces` (the profile's ids) exactly,
 * as `applicableCells` matches it. A duplicate after normalisation collapses
 * into its first occurrence with one warning. Two distinct runs that would
 * share one part id (surfaces differing only by case) throw, as does every
 * other problem.
 */
export function parseRun(
  tokens: readonly string[],
  vocabulary: { domains: readonly string[]; surfaces: readonly string[] },
): { runs: PlanRun[]; warnings: string[] } {
  if (tokens.length === 0) throw new Error("at least one --run DOMAIN:SURFACE is required");
  const surfaces = vocabulary.surfaces.filter((id) => id !== CROSS_SURFACE_ID);
  const plannable = vocabulary.domains.filter((code) => PLANNABLE_DOMAIN.test(code));
  const unplannable = vocabulary.domains.filter((code) => !PLANNABLE_DOMAIN.test(code));
  const runs: PlanRun[] = [];
  const warnings: string[] = [];
  /** The token each kept run came from, by its part id's suffix (planPartId lower-cases both halves). */
  const tokenBySuffix = new Map<string, string>();
  for (const token of tokens) {
    const match = RUN_TOKEN.exec(token);
    if (match === null) {
      throw new Error(
        `--run "${token}" is not DOMAIN:SURFACE — a domain code of 2 to 5 letters or digits, a colon, ` +
          `then a surface id of letters, digits, "-" or "_" (for example SEC:web).`,
      );
    }
    const domain = match[1].toUpperCase();
    const surface = match[2];
    if (!plannable.includes(domain)) {
      throw new Error(
        `--run "${token}": ${domain} is not a domain of this library. ` +
          `Domain codes: ${plannable.length > 0 ? plannable.join(", ") : "none that can be planned"}.` +
          (unplannable.length > 0
            ? ` ${unplannable.join(", ")} cannot be planned: a domain code must be 2 to 5 upper-case letters or digits.`
            : ""),
      );
    }
    if (surface === CROSS_SURFACE_ID) {
      throw new Error(
        `--run "${token}": ${CROSS_SURFACE_ID} is a lens for findings, not a surface anything is scored on. Plan the surfaces it connects instead.`,
      );
    }
    if (!surfaces.includes(surface)) {
      throw new Error(
        `--run "${token}": "${surface}" is not a surface of this project's profile. ` +
          `Surfaces: ${surfaces.length > 0 ? surfaces.join(", ") : "none declared"}. A surface must match its id exactly, case included.`,
      );
    }
    if (runs.some((run) => run.domain === domain && run.surface === surface)) {
      warnings.push(`--run ${token} repeats ${domain}:${surface}; the two are one part.`);
      continue;
    }
    const suffix = `${domain.toLowerCase()}-${surface.toLowerCase()}`;
    const other = tokenBySuffix.get(suffix);
    if (other !== undefined) {
      throw new Error(
        `--run "${other}" and --run "${token}" name surfaces that differ only by case, so both would score into ` +
          `the one part id "<planId>-${suffix}". Plan one of them, or give the profile's surfaces ids that differ by more than case.`,
      );
    }
    tokenBySuffix.set(suffix, token);
    runs.push({ domain, surface });
  }
  return { runs, warnings };
}

// --- Cells per part ----------------------------------------------------------------

/**
 * A part's cells: the entries of `applicableCells(library, surfaces)` whose
 * domain (`domainCodeOf`: the criterion's `domain`, else its id prefix) is
 * `run.domain` and whose surfaces include `run.surface`, in library order.
 * `steps` sums those criteria's checklist lengths; a criterion with no
 * checklist counts 0. Zero cells is not an error here — the plan builder
 * refuses it, with the reason.
 *
 * Not built on `signalRunSheet`: that sheet is one row per signal, skips
 * criteria without signals and matches `--domain` case-sensitively. On the
 * shipped pack its distinct cells equal these, which a test pins.
 */
export function planCells(
  library: Pick<KritikLibrary, "criteria">,
  surfaces: readonly string[],
  run: PlanRun,
): { cells: KritikPlanCell[]; steps: number } {
  const byId = new Map<string, KritikCriterion>();
  for (const criterion of Array.isArray(library.criteria) ? library.criteria : []) {
    if (typeof criterion?.id === "string" && !byId.has(criterion.id)) byId.set(criterion.id, criterion);
  }
  const cells: KritikPlanCell[] = [];
  let steps = 0;
  for (const entry of applicableCells(library, surfaces)) {
    if (!entry.surfaces.includes(run.surface)) continue;
    if (domainCodeOf(entry.criterion_id, library as KritikLibrary) !== run.domain) continue;
    cells.push({ criterion_id: entry.criterion_id, surface: run.surface });
    const checklist = byId.get(entry.criterion_id)?.checklist;
    steps += Array.isArray(checklist) ? checklist.length : 0;
  }
  return { cells, steps };
}

/** Every applicable cell over `surfaces` — the whole product a plan is read against (338 for a Pebbles-like profile). */
export function applicableCellCount(library: Pick<KritikLibrary, "criteria">, surfaces: readonly string[]): number {
  let count = 0;
  for (const entry of applicableCells(library, surfaces)) count += entry.surfaces.length;
  return count;
}

// --- Plan and part ids -----------------------------------------------------------

/**
 * A part's audit id: `<planId>-<domain>-<surface>`, lower case. Throws when
 * the result would read as a scoped re-audit (a surface named `scoped`, or
 * ending in `-scoped` / `-scoped-NN`), since every reader would then classify
 * the part as one.
 */
export function planPartId(planId: string, domain: string, surface: string): string {
  const id = `${planId}-${domain.toLowerCase()}-${surface.toLowerCase()}`;
  if (isScopedAuditId(id)) {
    throw new Error(
      `the part ${domain}:${surface} would be named "${id}", which reads as a scoped re-audit. ` +
        `A surface named "scoped", or ending in "-scoped" or "-scoped-NN", cannot be planned.`,
    );
  }
  return id;
}

/**
 * The next plan id: `YYYY-MM-zplan-DDNN` from `now`'s local date, the clock
 * `currentAuditId()` reads. The `z` lead sorts it after every same-month id
 * whose third segment starts with a digit or `a` to `y` (`2026-11-scoped`,
 * `2026-11-sec-web`), and the fixed-width `DDNN` sorts a later plan after an
 * earlier plan's parts.
 *
 * NN is the smallest of 00 to 99 where no `known` id is the candidate or one of
 * its parts, and every part id the runs would get sorts after the greatest
 * `known` id under plain string comparison. `known` is every id that exists:
 * audit directories, plan files and recorded audits. Throws with no run.
 */
export function planId(input: { now: Date; known: readonly string[]; runs: readonly PlanRun[] }): string {
  const { now, known, runs } = input;
  // With no run, rule (b) holds vacuously and any candidate would do: a plan id that checked nothing.
  if (runs.length === 0) throw new Error("a plan id needs at least one run: with none, no part is checked to sort last");
  const ids = known.filter((id) => typeof id === "string" && id !== "");
  const greatest = [...ids].sort().at(-1);
  const year = String(now.getFullYear()).padStart(4, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  for (let n = 0; n < 100; n++) {
    const candidate = `${year}-${month}-zplan-${day}${String(n).padStart(2, "0")}`;
    if (ids.some((id) => id === candidate || id.startsWith(`${candidate}-`))) continue;
    if (greatest !== undefined && !runs.every((run) => planPartId(candidate, run.domain, run.surface) > greatest)) continue;
    return candidate;
  }
  throw new Error(`no plan id on ${year}-${month}-${day} sorts after "${greatest}"`);
}

/**
 * The ids in `known` that now sort after the part `partId` and do not belong
 * to its plan — each once, ascending. A part is named to sort last when its
 * plan is made, but a scoped re-audit or a second plan made while it is still
 * unscored can sort after it; on any cell both hold, the part's later scores
 * would then lose the latest-wins merge. Sibling parts never share a cell, so
 * they never count. `[]` when `partId` is not a plan part.
 */
export function outsortedBy(partId: string, known: readonly string[]): string[] {
  const plan = planIdOfPartId(partId);
  if (plan === null) return [];
  const after = new Set<string>();
  for (const id of known) {
    if (typeof id !== "string" || !(id > partId)) continue;
    if (planIdOfPartId(id) === plan) continue;
    after.add(id);
  }
  return [...after].sort();
}

// --- The recorded event's scope marker -------------------------------------------

/** How much of the product a plan record's merged matrix holds a score for. */
export interface PlanCoverage {
  /** Cells this plan re-scored (= `scope.cells`). */
  scored: number;
  /** Applicable cells holding a score after the merge. */
  assessed: number;
  /** `applicableCellCount` over the profile's surfaces (338 for a Pebbles-like profile). */
  applicable: number;
  /** Per profile surface, in profile order. */
  surfaces: Record<string, { assessed: number; applicable: number }>;
}

/** The `scope` a plan record carries on its `quality.audit.completed`. */
export interface PlanAuditScope {
  partial: true;
  cells: number;
  /** The newest recorded audit that is not a plan; absent on a first audit. */
  since?: string;
  plan: string;
  /** Included part ids, plan order. */
  parts: string[];
  /** `planCellKey` per cell, plan order then library order. */
  scored: string[];
  coverage: PlanCoverage;
}

/** What `readPlanScope` makes of a recorded `scope`: every field present, `null` where the event did not carry it usably. */
export interface PlanScopeReading {
  plan: string;
  parts: string[];
  scored: string[];
  cells: number | null;
  since: string | null;
  coverage: PlanCoverage | null;
}

const isCount = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;

const nonEmptyStrings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item !== "") : [];

/** A recorded `coverage`, or `null` when any of its three counts is missing; a surface entry missing either count, or keyed `__proto__`, is dropped. */
function readCoverage(value: unknown): PlanCoverage | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  if (!isCount(row.scored) || !isCount(row.assessed) || !isCount(row.applicable)) return null;
  const surfaces: Record<string, { assessed: number; applicable: number }> = {};
  if (typeof row.surfaces === "object" && row.surfaces !== null && !Array.isArray(row.surfaces)) {
    for (const [surface, entry] of Object.entries(row.surfaces as Record<string, unknown>)) {
      // Assigning a "__proto__" key would set the prototype, not a surface.
      if (surface === "__proto__") continue;
      if (typeof entry !== "object" || entry === null) continue;
      const { assessed, applicable } = entry as Record<string, unknown>;
      if (isCount(assessed) && isCount(applicable)) surfaces[surface] = { assessed, applicable };
    }
  }
  return { scored: row.scored, assessed: row.assessed, applicable: row.applicable, surfaces };
}

/**
 * A lenient reader of an event's `scope`: non-null iff it is an object with a
 * non-empty string `plan`. Never throws. `parts` and `scored` keep only
 * non-empty strings; `cells` and the coverage counts must be non-negative
 * integers, else `null`.
 */
export function readPlanScope(scope: unknown): PlanScopeReading | null {
  if (typeof scope !== "object" || scope === null) return null;
  const row = scope as Record<string, unknown>;
  if (typeof row.plan !== "string" || row.plan === "") return null;
  return {
    plan: row.plan,
    parts: nonEmptyStrings(row.parts),
    scored: nonEmptyStrings(row.scored),
    cells: isCount(row.cells) ? row.cells : null,
    since: typeof row.since === "string" && row.since !== "" ? row.since : null,
    coverage: readCoverage(row.coverage),
  };
}

// --- P2: assembly and progress ---------------------------------------------------------

/** What {@link buildKritikPlan} needs: the effective library, the profile's surface ids, the parsed runs, and every id a new plan must sort after. */
export interface BuildKritikPlanInput {
  library: KritikLibrary;
  surfaces: readonly string[];
  runs: readonly PlanRun[];
  /** Audit directory ids, plan file ids and recorded audit ids. */
  known: readonly string[];
  now: Date;
  /** HEAD at plan time; null outside git. */
  commit: string | null;
}

/**
 * A counts-only plan: one included part per run, in run order, with its cells,
 * its checklist steps, an audit id that sorts after every known id, and its
 * prompt. Throws when a run has no applicable cell, and (through `planId`) when
 * no id on this day sorts last. Pure: the caller reads the files and writes the plan.
 */
export function buildKritikPlan(input: BuildKritikPlanInput): KritikPlan {
  const { library, surfaces, runs, known, now, commit } = input;
  const counted = runs.map((run) => {
    const { cells, steps } = planCells(library, surfaces, run);
    if (cells.length === 0) {
      throw new Error(
        `no ${run.domain} criterion applies to "${run.surface}" — every ${run.domain} criterion's applies_to leaves it out, so this part would score nothing.`,
      );
    }
    return { run, cells, steps };
  });
  const id = planId({ now, known, runs });
  const parts: Omit<KritikPlanPart, "prompt">[] = counted.map(({ run, cells, steps }) => ({
    domain: run.domain,
    surface: run.surface,
    auditId: planPartId(id, run.domain, run.surface),
    cells,
    steps,
    estimate: null,
    status: "included",
  }));
  const included = parts.filter((part) => part.status === "included");
  const head: Omit<KritikPlan, "prompt" | "parts"> = {
    schema: KRITIK_PLAN_SCHEMA,
    planId: id,
    createdAt: now.toISOString(),
    commit,
    frameworkVersion: library.version,
    tier: null,
    budgetTokens: null,
    budgetUsd: null,
    pricePerMTok: null,
    totals: {
      cells: included.reduce((sum, part) => sum + part.cells.length, 0),
      steps: included.reduce((sum, part) => sum + part.steps, 0),
      applicableCells: applicableCellCount(library, surfaces),
      tokens: null,
      usd: null,
    },
    recordCommand: planRecordCommand(id),
  };
  return {
    schema: head.schema,
    planId: head.planId,
    createdAt: head.createdAt,
    commit: head.commit,
    frameworkVersion: head.frameworkVersion,
    tier: head.tier,
    budgetTokens: head.budgetTokens,
    budgetUsd: head.budgetUsd,
    pricePerMTok: head.pricePerMTok,
    parts: parts.map((part) => ({ ...part, prompt: renderPartPrompt({ planId: id, commit }, part) })),
    totals: head.totals,
    prompt: renderPlanPrompt({ ...head, parts }),
    recordCommand: head.recordCommand,
  };
}

/** Where a part stands, read from its audit directory. Never written into the plan file. */
export type PlanPartProgress = "not started" | "in progress" | "scored" | "deferred";

export interface PlanPartStatus {
  auditId: string;
  domain: string;
  surface: string;
  progress: PlanPartProgress;
  /** Plan cells holding a score. */
  scored: number;
  /** Plan cells in the part. */
  cells: number;
  /** Plan cells with no score yet, in plan order. */
  missing: KritikPlanCell[];
  /** Scores in the part's audit that are not plan cells, in file order. The record refuses them. */
  stray: KritikPlanCell[];
}

/**
 * Each part's progress from the scores in its audit: `not started` with no
 * score at all, `scored` when every plan cell holds one, `in progress` between
 * (a stray score counts as started), `deferred` for a part a budget cut.
 * A part whose audit id is absent from `scoresByPart` has no scores.
 */
export function planPartStatuses(
  plan: Pick<KritikPlan, "parts">,
  scoresByPart: Readonly<Record<string, readonly Pick<QualityAssessment, "criterion_id" | "surface">[]>>,
): PlanPartStatus[] {
  return plan.parts.map((part) => {
    const planned = new Set(part.cells.map((cell) => planCellKey(cell.criterion_id, cell.surface)));
    const scoredKeys = new Set<string>();
    const strayKeys = new Set<string>();
    const stray: KritikPlanCell[] = [];
    const scores = Object.prototype.hasOwnProperty.call(scoresByPart, part.auditId) ? scoresByPart[part.auditId] : [];
    for (const score of scores) {
      const key = planCellKey(score.criterion_id, score.surface);
      if (planned.has(key)) scoredKeys.add(key);
      else if (!strayKeys.has(key)) {
        strayKeys.add(key);
        stray.push({ criterion_id: score.criterion_id, surface: score.surface });
      }
    }
    const missing = part.cells.filter((cell) => !scoredKeys.has(planCellKey(cell.criterion_id, cell.surface)));
    const scored = part.cells.length - missing.length;
    const progress: PlanPartProgress =
      part.status === "deferred"
        ? "deferred"
        : scored === 0 && stray.length === 0
          ? "not started"
          : missing.length === 0
            ? "scored"
            : "in progress";
    return {
      auditId: part.auditId,
      domain: part.domain,
      surface: part.surface,
      progress,
      scored,
      cells: part.cells.length,
      missing,
      stray,
    };
  });
}
