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
