# Kritik planner — stack contract (parts 1 to 4)

**Spec:** `docs/superpowers/specs/2026-11-11-kritik-planner-design.md` (PRs 2, 3 and 4 of its Rollout).
**Out of this stack:** the estimator, budgets, the ledger, the docs pages (spec PRs 5 to 7). Every plan is
counts-only. `--budget`, `--budget-tokens`, `--price` and `--tier` are parsed and refused (exit 1):
`kritik: --budget is not available yet — the estimator ships later, and every plan is counts-only for now.`
`--counts-only` is accepted and changes nothing.

This document is the contract between the four part plans. A name, signature or file listed here is
binding; a part plan may add private helpers but may not rename, move or re-sign anything below.

## Parts

| # | Branch | Goal | Must NOT touch |
| --- | --- | --- | --- |
| 1 | `feat/kritik-plan-schema` | Plan types and zod schema, `--run` grammar, cells per part, plan and part ids, `isPartialAuditId` in the implicit baseline, scoped-audit candidates after a plan part. Pure code plus tests. | `packages/cli`, `packages/mcp`, `lib/`, `docs/kritik-skill`, `plugin-kritik`, `recordedAuditIds`, `deriveAuditScope`, any version |
| 2 | `feat/kritik-plan-cli` | `arkaik kritik plan` (counts-only), the plan file, prompts, `--json`, `--dry-run`, `--status`; `kritik_plan` MCP tool; the planned-partial-audit procedure in the skill. | `matrix`, `scope`, `trend`, `regressions`, `quality-scope.ts`, `quality-trend.ts`, any version |
| 3 | `feat/kritik-plan-scope` | Reading plan records: `recordedAuditIds` returns parts; `deriveAuditScope` rules 1 to 7; the hosted case. Pure and shared. | `packages/cli`, `packages/mcp`, `lib/` source (tests only), `quality-trend.ts`, `quality-ops.ts`, any version |
| 4 | `feat/kritik-plan-record` | Recording a plan: `preparePlanRecord` behind `matrix <planId> --record --plan` and `kritik_matrix plan:true`; coverage in `trend` and `matrix`; first audit as a plan; `regressions` reads a plan as one reading; refusing a part id. All version bumps. | the hosted write path (`lib/services/graph/quality-events.ts` source), `lib/utils/quality.ts`, the app UI |

The stack merges as a unit. Part 2's printed record command and plan file name `matrix --plan`, which
lands in part 4; no package or plugin version moves until part 4.

## Where zod may be imported

Verified: the CLI and MCP bundles already contain zod (`packages/cli/dist/index.js` and
`packages/mcp/dist/index.js` both bundle `@arkaik/schema`'s index, which exports `quality-schemas.ts`
and `journal-events.ts`). The constraint is the plugin: `scripts/generate/build-kritik-scripts.js`
bundles `packages/schema/src/cli/kritik-{matrix,criterion,profile,regressions}-cli.ts` into
`plugin-kritik/skills/kritik/scripts/*.js`, and esbuild tree-shakes what those entries do not call
(the shipped `compute-matrix.js` holds no trace of `quality-scope.ts`, although `kritik-audit.ts` imports it).

- **May import zod:** `quality-schemas.ts`, `journal-events.ts`, and the new `cli/kritik-plan.ts`.
- **Must stay zod-free and fs-free:** `quality-plan.ts`, `kritik-plan-prompt.ts`, `quality-scope.ts`,
  `quality-trend.ts`, `quality-baseline.ts`, `quality-ops.ts`. They may use `import type` from
  `quality-schemas.ts` only if they never need a runtime value from it; prefer the interfaces in `quality-plan.ts`.
- **Top level of `quality-plan.ts` and `kritik-plan-prompt.ts`:** only regex literals, string and number
  constants, types and function declarations. No calls, so esbuild can drop them from the plugin scripts.
- **`cli/kritik-audit.ts` must never import `cli/kritik-plan.ts`.** The dependency runs one way:
  `kritik-plan.ts` imports `kritik-audit.ts`.
- **Plan types are TS interfaces in `quality-plan.ts`; the schemas in `quality-schemas.ts` are annotated
  `z.ZodType<…>` against them** (the file's existing convention: `KritikLibrarySchema: z.ZodType<KritikLibrary>`).
  The spec's single name `KritikPlan` for both const and type becomes `KritikPlanSchema` + `KritikPlan`.
- **No `.meta({ id })` on the plan schemas**, so `public/schema/project-bundle.json` cannot change.

## Shared names and signatures

`P1` to `P4` mark the part that creates the name. Everything new in `packages/schema/src/*.ts`
is re-exported from `packages/schema/src/index.ts` (`export * from "./quality-plan"` in P1,
`export * from "./kritik-plan-prompt"` in P2). Before adding an export, grep `index.ts`'s modules for the
name: `export *` with a duplicate name fails `tsc`.

### `packages/schema/src/quality-plan.ts` (new, P1; extended in P2 and P4)

```ts
// --- P1: shapes ------------------------------------------------------------------
export const KRITIK_PLAN_SCHEMA = "arkaik.kritik.plan/1";
export const PLAN_PLANS_DIR = "plans";                         // under docs/quality/
export interface KritikPlanBand { low: number; mid: number; high: number }
export interface KritikPlanCell { criterion_id: string; surface: string }
export interface KritikPlanEstimate {
  tokens: KritikPlanBand; usd: KritikPlanBand | null;
  inputs: { P: number; B: number; c: KritikPlanBand; q: KritikPlanBand; h: KritikPlanBand; V: KritikPlanBand };
  calibrated: boolean;
}
export interface KritikPlanPart {
  domain: string; surface: string; auditId: string; cells: KritikPlanCell[]; steps: number;
  estimate: KritikPlanEstimate | null;            // always null in this stack
  status: "included" | "deferred";                // always "included" in this stack
  prompt: string;
}
export interface KritikPlan {
  schema: typeof KRITIK_PLAN_SCHEMA; planId: string; createdAt: string; commit: string | null;
  frameworkVersion: string; tier: string | null; budgetTokens: number | null; budgetUsd: number | null;
  pricePerMTok: number | null; parts: KritikPlanPart[];
  totals: { cells: number; steps: number; applicableCells: number; tokens: KritikPlanBand | null; usd: KritikPlanBand | null };
  prompt: string; recordCommand: string;
}
export interface PlanRun { domain: string; surface: string }  // domain upper case, surface as declared

// --- P1: grammar, cells, ids ---------------------------------------------------------
export function parseRun(
  tokens: readonly string[],
  vocabulary: { domains: readonly string[]; surfaces: readonly string[] },
): { runs: PlanRun[]; warnings: string[] };
export function planCells(library: Pick<KritikLibrary, "criteria">, surfaces: readonly string[], run: PlanRun):
  { cells: KritikPlanCell[]; steps: number };
export function applicableCellCount(library: Pick<KritikLibrary, "criteria">, surfaces: readonly string[]): number;
export function planId(input: { now: Date; known: readonly string[]; runs: readonly PlanRun[] }): string;
export function planPartId(planId: string, domain: string, surface: string): string;
export function planCellKey(criterionId: string, surface: string): string;   // `${criterionId}::${surface}`
export function isScopedAuditId(id: unknown): boolean;   // /-scoped(-\d+)?$/
export function isPlanId(id: unknown): boolean;          // /^\d{4}-\d{2}-zplan-\d{4}$/
export function isPlanPartId(id: unknown): boolean;      // /^\d{4}-\d{2}-zplan-\d{4}-[a-z0-9]{2,5}-.+$/ and !isScopedAuditId
export function isPartialAuditId(id: unknown): boolean;  // isScopedAuditId || isPlanId || isPlanPartId
export function planIdOfPartId(id: string): string | null; // first 18 chars when isPlanPartId, else null

// --- P1: the recorded event's scope marker (read by P3, written by P4) ----------------
export interface PlanCoverage {
  scored: number;      // cells this plan re-scored (= scope.cells)
  assessed: number;    // applicable cells holding a score after the merge
  applicable: number;  // applicableCellCount over the profile's surfaces (338 for a Pebbles-like profile)
  surfaces: Record<string, { assessed: number; applicable: number }>;   // per profile surface, profile order
}
export interface PlanAuditScope {
  partial: true; cells: number; since?: string; plan: string;
  parts: string[];     // included part ids, plan order
  scored: string[];    // planCellKey per cell, plan order then library order
  coverage: PlanCoverage;
}
export interface PlanScopeReading {
  plan: string; parts: string[]; scored: string[]; cells: number | null; since: string | null; coverage: PlanCoverage | null;
}
/** Lenient reader of an event's `scope`: non-null iff it is an object with a non-empty string `plan`. Never throws. */
export function readPlanScope(scope: unknown): PlanScopeReading | null;

// --- P2: assembly and progress ---------------------------------------------------------
export interface BuildKritikPlanInput {
  library: KritikLibrary; surfaces: readonly string[]; runs: readonly PlanRun[];
  known: readonly string[]; now: Date; commit: string | null;
}
export function buildKritikPlan(input: BuildKritikPlanInput): KritikPlan;
export type PlanPartProgress = "not started" | "in progress" | "scored" | "deferred";
export interface PlanPartStatus {
  auditId: string; domain: string; surface: string; progress: PlanPartProgress;
  scored: number; cells: number; missing: KritikPlanCell[]; stray: KritikPlanCell[];
}
export function planPartStatuses(
  plan: Pick<KritikPlan, "parts">,
  scoresByPart: Readonly<Record<string, readonly Pick<QualityAssessment, "criterion_id" | "surface">[]>>,
): PlanPartStatus[];

// --- P4: coverage and readings -------------------------------------------------------------
export function coverageOf(
  section: Pick<QualitySection, "assessments"> & { profile?: Pick<QualityProfile, "surfaces"> | null },
  library: Pick<KritikLibrary, "criteria">,
  scored?: number,
): PlanCoverage;
/** One line per surface whose assessed < applicable: `web 62, from 6 of 71 cells` (score "—" when null). */
export function coverageNotes(coverage: PlanCoverage, overall: Readonly<Record<string, number | null>>): string[];
export interface AuditReading { id: string; auditIds: string[] }   // id: the plan id for a plan's parts, else the audit id
export function auditReadings(auditIds: readonly string[]): AuditReading[];   // ordered by first audit id
export function readingOf(readings: readonly AuditReading[], id: string): AuditReading | undefined; // by reading id or member id
```

Rules the signatures carry:

- **`parseRun`.** Token grammar: `^([A-Za-z0-9]{2,5}):([A-Za-z0-9_-]+)$`. The domain is upper-cased and must
  be one of `vocabulary.domains` (the effective library's `domains[].code`, pack plus overlay); the surface
  is matched literally against `vocabulary.surfaces` (the profile's ids). `cross-surface` is refused as a
  findings-only lens. Throws `Error` for: no token (`at least one --run DOMAIN:SURFACE is required`), a
  malformed token (message shows the grammar and the token), an unknown domain (lists the codes), an
  unknown surface (lists the profile's surfaces, says a literal match is required). A duplicate after
  normalisation collapses to its first occurrence and adds one warning. Order is kept.
- **`planCells`.** The entries of `applicableCells(library, surfaces)` whose `domainCodeOf(criterion_id, library)`
  equals `run.domain` and whose `surfaces` include `run.surface`, in library order. `steps` sums those
  criteria's `checklist.length` (missing checklist counts 0). Zero cells is not an error here; `buildKritikPlan` refuses it.
- **`planId`.** `YYYY-MM-zplan-DDNN` from `now`'s **local** year, month and day (the same clock as
  `currentAuditId()` in `kritik.ts:376` and `kritik-tools.ts:350`). NN runs 00 to 99; take the smallest NN
  where (a) no `known` id equals the candidate or starts with `${candidate}-`, and (b) every
  `planPartId(candidate, run)` sorts after the greatest `known` id under plain string comparison. Past 99,
  throw naming the greatest known id: `no plan id on <YYYY-MM-DD> sorts after "<id>"`. `known` is the union
  of audit directory ids, plan file ids and recorded audit ids.
- **`planPartId`.** `${planId}-${domain.toLowerCase()}-${surface.toLowerCase()}`. Throws when the result
  would satisfy `isScopedAuditId` (a surface `scoped` or ending `-scoped`/`-scoped-NN`).
- **Classification order.** `isScopedAuditId` wins: `2026-11-zplan-1100-sec-web-scoped` is scoped, not a part.

### `packages/schema/src/quality-schemas.ts` (P1)

```ts
export const KritikPlanPartSchema: z.ZodType<KritikPlanPart>;
export const KritikPlanSchema: z.ZodType<KritikPlan>;
export function parseKritikPlan(value: unknown): { ok: true; plan: KritikPlan } | { ok: false; issue: string };
```

Field rules as in the spec's schema block, with these exact choices: `schema: z.literal(KRITIK_PLAN_SCHEMA)`;
`createdAt: z.iso.datetime()` (zod 4.4.3; `z.string().datetime()` is deprecated); part `domain` regex
`^[A-Z0-9]{2,5}$`; `cells.min(1)`; `parts.min(1)`; plain `z.object` (unknown keys are stripped, not kept).
`parseKritikPlan` returns the first issue as `<path>: <message>`.

### `packages/schema/src/kritik-plan-prompt.ts` (new, P2)

```ts
export function planRecordCommand(planId: string): string;   // "arkaik kritik matrix <planId> --record --plan"
export function renderPartPrompt(plan: Pick<KritikPlan, "planId" | "commit">, part: Omit<KritikPlanPart, "prompt">): string;
export function renderPlanPrompt(plan: Omit<KritikPlan, "prompt" | "parts"> & { parts: readonly Omit<KritikPlanPart, "prompt">[] }): string;
```

The spec's template, with these decisions: the `Estimate:` sentence is omitted when `estimate` is null;
a null commit renders `not a git checkout`; each cell line under step 3 is
`   - SEC-01 on web: \`arkaik kritik score SEC-01 web <level> --evidence "<file:line …>" --audit <partId>\``;
step 4 names `arkaik kritik finding open … --audit <partId>`. Invariants a test pins: every line containing
`kritik score` contains `--audit <partId>`; a part prompt contains no `--record`; the combined prompt contains
`--record` exactly once, in its last step; deferred parts are listed under `Not in this run (over budget):`.

### `packages/schema/src/cli/kritik-plan.ts` (new, P2; extended in P4; fs and zod allowed)

```ts
export const plansDir = (root: string): string;                  // join(root, QUALITY_DIR, PLAN_PLANS_DIR)
export const planPath = (root: string, planId: string): string;  // <plansDir>/<planId>.json
export function listPlanIds(root: string): string[];             // *.json basenames, sorted; [] when absent
export function readPlanFile(path: string): KritikPlan;          // throws "no plan at <path>" or "<path>: <issue>"
export function loadPlan(root: string, planId: string): KritikPlan;
export function savePlan(path: string, plan: KritikPlan): void;  // writeJson
export function gitHead(root: string): string | null;            // spawnSync git rev-parse HEAD; null on any failure
export function createPlan(
  root: string, library: KritikLibrary, runTokens: readonly string[],
  options?: { recorded?: readonly string[]; now?: Date },
): { plan: KritikPlan; warnings: string[] };                      // requireProfile + parseRun + buildKritikPlan; writes nothing
export function planStatus(root: string, plan: KritikPlan): PlanPartStatus[];  // loadScoresOrEmpty per part
// P4
export interface PlanRecord { plan: KritikPlan; section: QualitySection; matrix: QualityMatrix; scope: PlanAuditScope; input: EventInput }
export function preparePlanRecord(root: string, planId: string, library: KritikLibrary, events: readonly JournalEvent[]): PlanRecord;
```

`frameworkVersion` is the effective library's `version` at plan time (what `score` stamps into a new
`scores.json`). `--out` writes elsewhere, but `--status`, `matrix --plan` and `kritik_plan` read only
`planPath(root, planId)`; `plan --out` prints that the file must be moved there before recording.

**`preparePlanRecord`** is the one record function (spec "`matrix --record --plan`"). It reads files and
writes nothing; the caller appends `input` through its own path. It throws `Error` with the spec's error-table
gist, in this order: plan file missing or invalid; plan already recorded (`recordedPlans(events)` names it,
or `recordedAuditIds(events)` holds `planId`); cells or `frameworkVersion` changed (recompute with
`planCells` against `requireProfile(root)` and the given library; compare as sets per part); scores outside
the plan per part (`planPartStatuses(...).stray`, message names them); plan cells with no score per part
(`missing`; a part with no directory says the scores may be in another worktree). Then:
`section = loadQualitySectionThrough(root, <greatest included part id>, library)`,
`matrix = deriveQualityMatrix({ quality: section }, library)`, `since = scopeAnchorId(events)` (omitted when null),
`coverage = coverageOf(section, library, scored.length)`, and
`input = auditCompletedInput(matrix, { audit_id: planId, framework_version: plan.frameworkVersion, commit: plan.commit ?? undefined, scope })`.

### The recorded event (P4 writes it, P3 reads it)

```json
{ "type": "quality.audit.completed", "audit_id": "2026-11-zplan-1100", "framework_version": "0.1.0",
  "commit": "3f9c2e1…", "scores": { "web": { "SEC": 62 } }, "counts": { "critical": 0, "high": 1 },
  "scope": { "partial": true, "cells": 14, "since": "2026-10", "plan": "2026-11-zplan-1100",
    "parts": ["2026-11-zplan-1100-sec-web", "2026-11-zplan-1100-agt-ios"],
    "scored": ["SEC-01::web", "…", "AGT-08::ios"],
    "coverage": { "scored": 14, "assessed": 152, "applicable": 338,
      "surfaces": { "web": { "assessed": 40, "applicable": 71 } } } } }
```

`since` is absent on a first audit. `coverage.surfaces` is this contract's addition to the spec (per-surface
coverage is what "web 62, from 6 of 71 cells" needs). A **plan record** is any `quality.audit.completed`
whose `readPlanScope(event.scope)` is non-null.

### `packages/schema/src/quality-scope.ts`

- **P1:** `scopedAuditId(input: ScopedAuditIdInput): string` keeps its signature. Candidate base: `month`,
  unless `${month}-scoped` sorts before the greatest known id and that id is a plan part (or a scoped id whose
  stem, minus `-scoped(-NN)?`, is a plan part): then the base is that plan part id, giving
  `<partId>-scoped`, `<partId>-scoped-02`, … `suggestedAuditId` uses the same base. Repo, MCP and hosted all
  get it, since all three call this function.
- **P3:**

```ts
export function recordedAuditIds(events: readonly JournalEvent[]): string[];  // unchanged signature; each plan record's parts follow its plan id
export interface RecordedPlan { plan: string; parts: string[]; scored: string[]; ts: string | null }
export function recordedPlans(events: readonly JournalEvent[]): RecordedPlan[];   // journal order
export function isPlanRecord(event: unknown): boolean;
export function recordedSinceIds(events: readonly JournalEvent[]): string[];      // recordedAuditIds over non-plan records only
export function scopeAnchorId(events: readonly JournalEvent[]): string | null;    // audit_id of the newest non-plan record (rule 1)
export function deriveAuditScope(/* signature unchanged */): AuditScope;
```

`deriveAuditScope` implements the spec's rules 1 to 7 inside the existing function: the anchor loop
(`quality-scope.ts:154`) skips plan records, and `options.since` naming a plan or part finds no anchor (empty
scope). A resolution at journal index `r` counts for cell `k` iff `r` is after the anchor and after the last
plan record whose `scored` holds `k`. Track the latest resolution index per finding and per node; apply the
threshold per target cell for direct and cross-surface cells, and per candidate cell for widening. `findings`
and `resolved_by` keep only drivers of a listed cell; `unknown` and `unscorable` are computed as today.

### Other changed signatures

- `quality-baseline.ts` (P1): the private `SCOPED_AUDIT_ID`/`isScopedAuditId` (`:57`, `:64`) go; the filter
  at `:132` uses `isPartialAuditId`. No signature change.
- `quality-ops.ts` (P4): `auditCompletedInput(matrix, meta: { audit_id: string; framework_version: string; commit?: string; scope?: AuditCompletedScope | PlanAuditScope })`.
- `quality-trend.ts` (P4): `AuditSnapshot.plan?: PlanScopeReading` and `TrendRow.plan?: PlanScopeReading`.
  `scopeOf` returns `undefined` for a plan record, so `scope` stays "scoped re-audit" only. In `trendRows`, a
  row carrying `plan` gets `delta: null` for a surface with no scored cell on it (with `domain`, no scored cell
  of that domain on it; domain from `domainCodeOf(criterionId)` without a library, the id prefix).
- Regressions (P4): the CLI's `auditPair` (`kritik.ts:1061`), the MCP's `resolveAuditPair` repo branch
  (`kritik-tools.ts:242`) and `kritik-regressions-cli.ts:62-82` keep their guards and wording but run over
  `auditReadings(listAuditIds(root))`: ids accepted are reading ids or member ids, the default `to` is the last
  reading, the default `from` the one before, and each side loads `loadQualitySectionThrough(root, reading.auditIds.at(-1))`.
  Output `from`/`to` are reading ids. The hosted regressions branch is unchanged.
- Since validation (P4): `currentScope` (`kritik.ts:1342`), the MCP `scopeOf` since check, and every
  `declaredScopeSince(auditId, recorded)` call pass `recordedSinceIds(events)`; a plan or part id given as
  `--since` is refused as "a plan record, never a scope's anchor".

## File map

**Part 1**
- Create `packages/schema/src/quality-plan.ts`, `tests/schema/quality-plan.test.js`.
- Modify `packages/schema/src/quality-schemas.ts`, `index.ts`, `quality-baseline.ts`, `quality-scope.ts` (`scopedAuditId`, `suggestedAuditId`, `scopedCandidates` only).
- Modify `tests/schema/quality-scope.test.js` (candidates after a plan part), `tests/schema/quality-baseline.test.js` (a part id is never the baseline).
- Modify `package.json`: `"test:quality-plan": "node tests/schema/quality-plan.test.js"`; `.github/workflows/ci.yml`: one `build`-job step `Kritik plan tests (grammar, cells, sort-last ids, partial ids, schema)` running `npm run test:quality-plan`, after the baseline step.

**Part 2**
- Create `packages/schema/src/kritik-plan-prompt.ts`, `packages/schema/src/cli/kritik-plan.ts`, `tests/schema/kritik-plan-prompt.test.js`, `tests/cli/kritik-plan.test.js`.
- Modify `packages/schema/src/quality-plan.ts` (`buildKritikPlan`, `planPartStatuses`), `index.ts`.
- Modify `packages/cli/src/commands/kritik.ts`: `USAGE` line, `PLAN_USAGE`, `runPlan`, `case "plan"`. Flags only; logic stays in the schema package.
- Modify `packages/mcp/src/kritik-tools.ts`: `kritik_plan` with `runs: string[]` (required unless `status`), `dry_run?: boolean`, `status?: string`; repo mode only (hosted throws a `ToolError`); returns `{ plan, path, written, warnings }`, or `{ plan_id, recorded: false, parts: PlanPartStatus[] }` for `status`.
- Modify `docs/kritik-skill/skill.md`: under `## Scoping a run`, a `### A planned partial audit` subsection (make the plan, one session per part or the combined prompt, always `--audit <partId>`, never record a part, `plan --status`). Run `npm run generate`; commit `plugin-kritik/skills/kritik/SKILL.md`. Frontmatter `version` stays 0.7.0.
- Modify `docs/spec/mcp.md`: a `kritik_plan` row; the tool count sentence.
- Modify `package.json`: `test:quality-plan` becomes `node tests/schema/quality-plan.test.js && node tests/schema/kritik-plan-prompt.test.js`; append `&& node tests/cli/kritik-plan.test.js` to `test:cli`.
- Modify `tests/schema/quality-plan.test.js`, `tests/mcp/kritik-tools.test.js` (kritik_plan), `tests/mcp/run-mcp-tests.js:124` (29 tools becomes 30; fix the stale "16 + 12" comment).

**Part 3**
- Modify `packages/schema/src/quality-scope.ts`.
- Modify `tests/schema/quality-scope.test.js` (rules 1 to 7, recorded parts, `recordedSinceIds`, `scopeAnchorId`), `tests/services/quality-events.test.js` (hosted case). No wiring change.

**Part 4**
- Modify `packages/schema/src/quality-plan.ts` (coverage, readings), `quality-ops.ts`, `quality-trend.ts`, `cli/kritik-plan.ts` (`preparePlanRecord`), `cli/kritik-regressions-cli.ts`.
- Modify `packages/cli/src/commands/kritik.ts`: `matrix` gains `--plan` (refuse with `--scope`; needs the plan id; `--record --plan` needs a journal and refuses `--no-journal`; without `--record` it previews, writing nothing); `matrix <partId> --record` refuses and points to `matrix <planId> --record --plan`; `matrix <planId>` without `--plan` says to pass it; coverage notes under every human matrix table where a surface has assessed < applicable; `trend` prints a plan line and its coverage notes; `scope` and `score --scope` with only plan records say why the scope is empty; regressions readings; since validation.
- Modify `packages/mcp/src/kritik-tools.ts`: `kritik_matrix` gains `plan?: boolean` (repo only; with `record` it appends `input` via `record()`; returns the merged matrix, `scope`, `coverage`); refuses a part id with `record`; regressions readings; since validation.
- Modify `docs/kritik-skill/skill.md` (record step, coverage reading), frontmatter `version: 0.8.0`; `docs/spec/mcp.md` (`kritik_matrix` row). Run `npm run generate`; commit `plugin-kritik/` (SKILL.md, `.claude-plugin/plugin.json`, `scripts/detect-regressions.js`).
- Versions: `packages/cli/package.json` 0.10.0 → 0.11.0, `packages/mcp/package.json` 0.9.0 → 0.10.0, and the two matching entries in `package-lock.json` (`npm install --package-lock-only`). This is how #470, #476, #480 and #520 bumped.
- Create `tests/cli/kritik-plan-record.test.js` (append to `test:cli`). Modify `tests/schema/quality-plan.test.js`, `tests/schema/quality-trend.test.js`, `tests/schema/kritik-plugin.test.js` (detect-regressions reads a plan as one reading), `tests/mcp/kritik-tools.test.js`.

## Verified facts (spec against code)

1. **Wrong in the spec: the `--run` grammar.** `domain := 2*4 ALPHA` rejects `A11Y`, a shipped domain with
   digits (framework.json domain codes: SEC, PRV, GDP, SAF, ARC, TST, PLT, A11Y, PRF, REL, AGT). Overlay
   domains are free-form (`kritik-overlay.ts:196-209`). Decision: 2 to 5 alphanumerics, matching the schema
   regex, validated against the effective library's codes rather than a fixed eleven.
2. **Wrong in the spec: "pin planCells to signalRunSheet".** `signalRunSheet` (`quality-ops.ts:371-402`)
   returns one row per signal (23 for SEC:web, not 36), skips criteria without signals, filters on
   `criterion.domain` with exact case (`:381`, and `kritik.ts:1009` passes `--domain` raw, so `--domain sec`
   finds nothing), and treats `superseded_by !== undefined` as retired (`:379`) where `applicableCells`
   (`quality.ts:342`) needs a non-empty string. `planCells` cannot share it. The pin holds on the shipped pack
   (every criterion has signals, none is retired): the distinct `(criterion_id, surface)` pairs of
   `signalRunSheet` equal `planCells`. SEC:web is 6 cells and 36 checklist steps (SEC-01, 04, 05, 06, 07, 08);
   AGT:ios 8 and 42 (AGT-01 to 08); 338 applicable cells over the five surfaces. All counted from
   `packages/kritik-library/framework.json` (version 0.1.0).
3. **Domain code.** `domainCodeOf` (`quality-ops.ts:125`): the criterion's `domain`, else the id prefix
   before the first `-`. All 88 shipped criteria have `domain` equal to their prefix.
4. **Holds: `scope` accepts extra keys.** `journal-events.ts:242-249` is `z.object({partial, cells, since}).catchall(z.unknown()).optional()`,
   `since` optional; `makeEvent` parses through it (`emit.ts:120`), so nested keys survive.
5. **Wrong in the spec: "a plan record reuses the trend's scope marker".** `scopeOf` (`quality-trend.ts:111`)
   drops any scope without a `since`, so a first-audit plan record would read as a full audit. Decision:
   a separate `plan` marker on snapshots and rows.
6. **Missing from the spec.** Once `recordedAuditIds` returns parts, `declaredScopeSince` (`kritik-audit.ts:348`,
   "newest recorded id before this one") and the `--since` checks (`kritik.ts:1359`, MCP `scopeOf`) would
   accept a plan or part id as a scope's anchor. Decision: `recordedSinceIds`, wired in part 4.
7. **Missing from the spec: three regressions pairings, not one** (CLI, MCP repo, plugin script). Decision:
   all three over `auditReadings`; the plugin's `detect-regressions.js` is regenerated.
8. **Hosted is affected by part 1, as the spec intends.** The hosted planner calls `scopedAuditId` with
   `known` built from recorded ids and assessment ids (`lib/services/graph/quality-events.ts:425-442`); in a
   month holding a plan it would refuse with `audit_id_conflict` without the part 1 candidate rule.
9. **The CLI build.** esbuild bundles `@arkaik/schema` raw TS into one file (`packages/cli/build.js`, target
   node18); the MCP build does the same and aliases `arkaik/io` to the CLI source. No runtime dependency is added.
10. **The skill is generated.** `docs/kritik-skill/skill.md` is the source; `scripts/generate/generate-kritik-plugin.js`
    copies it to `plugin-kritik/skills/kritik/SKILL.md` (verified byte-identical) and stamps `plugin.json`'s
    `version` from its frontmatter (now 0.7.0); `tests/schema/kritik-plugin.test.js:300-301` checks both.
11. **Generated artifacts in this stack's path.** CI diffs `plugin-kritik` among others (`ci.yml`, "Fail on
    generated-artifact drift"). The skill copy changes in parts 2 and 4; `detect-regressions.js` changes in
    part 4 only. `public/schema/project-bundle.json` is built from `ProjectBundleSchema` alone and does not
    reach the plan schema. `lib/landing/generated/*` samples `arkaik validate` and `list_nodes` only. `npm run generate`
    was not run for this contract; this is from reading the generators.
12. **Spec details resolved here.** `frameworkVersion` cannot come from `scores.json` at plan time (no part is
    scored yet): it is the effective library's `version`. The spec's "first part over budget exits 3" contradicts
    its own "every refusal exits 1"; irrelevant until budgets ship.
13. **MCP tool count.** `tests/mcp/run-mcp-tests.js:124` asserts exactly 29 tools (16 graph + 13 kritik; its
    comment says 12). `docs/spec/mcp.md:112` says "Twelve"; there are thirteen today.

## Test strategy

Fixtures are synthetic. No real project carries `docs/quality`. Pure suites build inline objects; CLI and
MCP suites build a `mkdtemp` repo exactly like `tests/cli/kritik-scope.test.js`: a minimal `docs/arkaik/bundle.json`,
`arkaik kritik profile --surface web --surface ios --surface android --surface admin --surface supabase`, the
pack the build ships, and `scores.json`/`findings.json` written directly as files (generate a full audit's
338 assessments in the test from `applicableCells` over `packages/kritik-library/framework.json`). Compute the
month and read the plan id from `--json` output; never hard-code a date. Schema suites load TypeScript only
through `tests/schema/load-schema.js` (which discovers every `packages/schema/src/*.ts`, so a new top-level
module needs no loader change). It cannot reach `src/cli/*`, so `cli/kritik-plan.ts` is tested only through
the built CLI and MCP.

| Part | Suites | Must pass |
| --- | --- | --- |
| 1 | new `quality-plan.test.js`: grammar (each malformed token in the spec table, case, duplicates, `A11Y:web`, `cross-surface`); cells (every domain × surface of the shipped pack equals the `signalRunSheet` pairs; SEC:web 6/36, AGT:ios 8/42); sort-last property over generated ids (`YYYY-MM`, `-scoped`, `-scoped-NN`, `2026-11-sec-web`, earlier plans' parts) plus NN overflow; partial ids; schema round-trip and unknown `schema` rejected; `readPlanScope`. Extend `quality-scope.test.js`, `quality-baseline.test.js`. | `npm run` each of `test:quality-plan`, `test:quality-scope`, `test:quality-baseline`, `test:quality`, `test:quality-events`, `test:kritik-plugin`, `test:schema`, `npm run lint`, `npx tsc --noEmit -p .`, then `npm run generate && git status --porcelain` shows nothing. |
| 2 | `quality-plan.test.js` (`buildKritikPlan`, `planPartStatuses`); `kritik-plan-prompt.test.js` (inline-string snapshot of SEC:web + AGT:ios with a hand-made deferred third part, plus the invariants); `tests/cli/kritik-plan.test.js` (acceptance steps 1 to 3, every plan refusal in the spec table, budget flags refused, `--json`, `--dry-run` writes nothing, `--status`); `kritik_plan` in `kritik-tools.test.js` writes a file equal to the CLI's except `planId`, `createdAt`, `commit`. | Part 1's list, plus `npm run test:cli`, `npm run test:mcp`; generate leaves only the committed SKILL.md change. |
| 3 | `quality-scope.test.js`: one case per rule 1 to 7 (cross-surface finding with web re-scored, widened cell re-scored, a cell coming back), `recordedAuditIds` with parts, a full record still clears all, no-plan journals unchanged; `quality-events.test.js`: a hosted journal holding a plan record refuses a score on the re-scored cell (`out_of_scope`), accepts the other stale cell, and names `<partId>-scoped` in a plan month. | `npm run` each of `test:quality-scope`, `test:quality-events`, `test:quality-baseline`, `test:cli`, `test:mcp`; lint; tsc. |
| 4 | `kritik-plan-record.test.js`: acceptance steps 4 to 8 (step 8 in a second repo through `matrix --record --scope`), recorded parts warn on `score --audit <partId>` and are refused as `score --scope --audit` targets, every record refusal exits 1 and appends nothing, no finding changes status, first audit as a plan (no `since`, coverage, `trend`/`matrix` print it, `scope` explains), `regressions` default pair after a plan; `quality-trend.test.js` (plan marker, delta gating); `quality-plan.test.js` (`coverageOf`, `coverageNotes`, `auditReadings`); `kritik-plugin.test.js`; `kritik_matrix plan:true` appends the same event as the CLI and refuses a part id. | Everything above plus `npm run` each of `test:quality-trend`, `test:quality-regressions`, `test:quality-ops`; generate leaves only the committed `plugin-kritik` changes. |

## Known traps (each checked)

- **Node 20 in CI, Node 26 here** (`node --version` = v26.7.0; `ci.yml` pins 20). Never `require` a `.ts`
  file in a test; load through `tests/schema/load-schema.js` or the built `dist/`.
- **Hand-maintained alias rewrites.** `tests/services/load-quality-events.js` rewrites only `@arkaik/schema`
  and `@/lib/utils/quality`. Part 3 must not add an import to `lib/services/graph/quality-events.ts`.
- **Lint gates CI.** `npm run lint` (eslint) and actionlint over every workflow file both fail the `build` job.
  Part 1's new CI step is a plain `run: npm run test:quality-plan`.
- **Generated-artifact drift.** Run `npm run generate` before every PR and commit what it changes. A part
  that changes a function the plugin scripts actually call, or that makes a plugin-reachable module import
  zod or a module with top-level calls, changes `plugin-kritik/skills/kritik/scripts/*.js`.
- **Source-asserting suites.** Checked: none reads `kritik.ts`, `kritik-tools.ts` or the quality modules as
  text. `tests/types/quality-events-parity.ts` type-checks hosted input shapes, which this stack does not change.
- **Typecheck is the root tsconfig** (`include: **/*.ts`): `npx tsc --noEmit -p .` locally; CI gets it from
  `next build`. A duplicate name across `export *` modules in `index.ts` fails it.
- **Exact counts.** `run-mcp-tests.js` counts tools; `version.test.js` (CLI and MCP) reads `package.json`.

## Lab Notes

Parts 1 and 3 change nothing a user can reach (no plan record can exist before part 4): no Lab Note, label
`no-lab-note`. Parts 2 and 4 are user-facing. `V-cli-terminal` and `V-mcp-tool-catalog` exist in
`seed/arkaik-self-map.json`; no Kritik node does.

Part 2:

```yaml
en:
  title: "Plan a Kritik run before you spend it"
  summary: "Pick the corners you want audited, say Security on web, and Arkaik counts the cells, names the run and hands you a prompt ready to paste into an agent session."
fr:
  title: "Planifie ton audit Kritik avant de le lancer"
  summary: "Choisis les coins à auditer, la sécurité sur le web par exemple, et Arkaik compte les cases, nomme le passage et te tend un prompt prêt à coller dans une session d'agent."
nodes: [V-cli-terminal, V-mcp-tool-catalog]
suggested:
  molecule: arkaik
  type: feature
  tags: [kritik]
```

Part 4:

```yaml
en:
  title: "Audit one corner without blurring the rest"
  summary: "Record a planned run and only the cells it re-checked leave your to-do list. Everything else stays put, and every score now says how much of the product was actually looked at."
fr:
  title: "Audite un coin sans brouiller le reste"
  summary: "Enregistre un passage planifié : seules les cases revérifiées quittent ta liste, le reste ne bouge pas, et chaque score dit enfin quelle part du produit a vraiment été regardée."
nodes: [V-cli-terminal, V-mcp-tool-catalog]
suggested:
  molecule: arkaik
  type: feature
  tags: [kritik]
```

After opening each PR, read its comments for the Lab Note reminder.

## Open risks

1. **The app's journal feed misnames a plan record.** `describeAuditCompleted` (`lib/utils/quality.ts:618`)
   reads any `scope.partial` as "Scoped re-audit of N cells". This stack leaves the app alone, per the spec's
   "the dashboard follows with the Launch panel". The product owner should confirm that wording is acceptable
   until then, or add a one-line branch on `scope.plan` to part 4.
2. **`coverage.surfaces` extends the spec's event shape.** It is additive and catchall-safe, but the Launch
   panel will read it; the product owner should accept it as part of the event contract.
3. **The stack must merge as a unit.** Part 2 ships a plan whose record command lands in part 4, and all
   version bumps sit in part 4. Publishing between the two would ship a command that points at a missing flag.
