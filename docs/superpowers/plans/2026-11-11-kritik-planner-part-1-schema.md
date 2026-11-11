# Kritik planner — Part 1: plan schema, `--run` grammar and sort-last ids — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the planner's pure layer — plan types, the `--run DOMAIN:SURFACE` grammar, cells per part, plan and part ids that sort after every audit, the partial-id predicates, the reader for a plan record's scope marker, and the plan file's zod schema — and teach the two existing id rules about plan parts: the implicit baseline never picks one, and a scoped re-audit after a plan is named after its newest part. Nothing a user can reach changes yet.

**Architecture:** A new zod-free, fs-free module `packages/schema/src/quality-plan.ts` holds the interfaces and every pure rule; its top level is only regex literals, constants, types and function declarations, so esbuild drops whatever a plugin script does not call. The zod schemas `KritikPlanPartSchema` / `KritikPlanSchema` and `parseKritikPlan` go into `quality-schemas.ts`, annotated `z.ZodType<…>` against those interfaces. `quality-baseline.ts` swaps its private scoped-id regex for `isPartialAuditId`; `quality-scope.ts`'s candidate generator gains a plan-part base. Everything is re-exported from `index.ts` and tested through `tests/schema/load-schema.js`.

**Tech Stack:** TypeScript in `@arkaik/schema` (zod 4.4.3), plain Node test scripts (`check(name, cond)` style) that load the TypeScript through `tests/schema/load-schema.js`, GitHub Actions (`build` job).

**Spec:** `docs/superpowers/specs/2026-11-11-kritik-planner-design.md` (Rollout PR 2).

**Contract:** `docs/superpowers/plans/2026-11-11-kritik-planner-stack.md` — authoritative for every name, signature and file below.

**Branch:** `feat/kritik-plan-schema` (exists, cut from `main` at `2f697cd`). Bottom of a four-part `gh stack`: `feat/kritik-plan-cli` (part 2), `feat/kritik-plan-scope` (part 3) and `feat/kritik-plan-record` (part 4) stack on top, and the stack merges as a unit. No package or plugin version moves in this part.

---

## Contract deviations

**1. This part regenerates two plugin scripts.** The contract lists `plugin-kritik` under "must not touch" for part 1, and its verified fact 11 says `detect-regressions.js` changes in part 4 only. That cannot hold. `cli/kritik-audit.ts` imports `scopedAuditId` from `quality-scope.ts`, so `quality-scope.ts` — and, through its new import, `quality-plan.ts` and `quality-ops.ts` — sit in the module graph of `compute-matrix.js` and `detect-regressions.js`. esbuild tree-shakes the unused code correctly (an unminified build of both scripts is byte-identical before and after this part), but its minifier picks short identifier names from character frequencies that include the tree-shaken code. Checked by rebuilding the four plugin entries with the options of `scripts/generate/build-kritik-scripts.js` against a copy of the tree:

| Change applied (cumulative) | Plugin scripts |
| --- | --- |
| `quality-plan.ts` added, `index.ts`, `quality-schemas.ts` | identical |
| `quality-baseline.ts` (Task 8) | identical |
| `quality-scope.ts` (Task 9) | `compute-matrix.js` and `detect-regressions.js` differ (identifier renaming only, ±2 bytes) |
| a comment-only edit to `quality-scope.ts` | identical |

So Task 9 runs `npm run generate` and commits `plugin-kritik/skills/kritik/scripts/compute-matrix.js` and `plugin-kritik/skills/kritik/scripts/detect-regressions.js` with the scope change. Behaviour is unchanged; `npm run test:kritik-plugin` runs both scripts. `docs/arkaik-skill/scripts/validate-bundle.js` (which bundles `quality-schemas.ts` through `bundle.ts`) stays byte-identical: zod is `sideEffects: false`, so the unused plan schemas are dropped. The deviation is the smallest possible: no other generated file moves.

**Consequence for parts 2 to 4 (the caller should relay this).** After this part, any non-comment change to `quality-plan.ts` or `quality-scope.ts` reshuffles names in `compute-matrix.js` (checked: appending one function to `quality-plan.ts` changes it). Parts 2, 3 and 4 all edit one of those files, so each must run `npm run generate` and commit the plugin script churn, including part 3, whose contract row says "No wiring change".

**Not deviations, but choices the contract leaves open:**

- `KritikPlanSchema` enforces the spec's comment "`pricePerMTok` required when `budgetUsd` is set" with a `superRefine` (issue at `pricePerMTok`). In zod 4 a refinement keeps the `ZodObject` type, so the `z.ZodType<KritikPlan>` annotation holds.
- `parseKritikPlan` reports an issue on the value itself (not an object) as `(root): <message>`.
- Private helpers in `quality-plan.ts`: `isCount`, `nonEmptyStrings`, `readCoverage`. They are named so that part 4's exported `coverageOf` does not collide; parts 2 and 4 may reuse them and must not redeclare them.

---

## File map

- Create `packages/schema/src/quality-plan.ts` — shapes, partial-id predicates, `parseRun`, `planCells`, `applicableCellCount`, `planPartId`, `planId`, the scope-marker types and `readPlanScope`.
- Modify `packages/schema/src/index.ts` — `export * from "./quality-plan";`.
- Modify `packages/schema/src/quality-schemas.ts` — `KritikPlanPartSchema`, `KritikPlanSchema`, `parseKritikPlan`.
- Modify `packages/schema/src/quality-baseline.ts` — drop the private `SCOPED_AUDIT_ID` / `isScopedAuditId`; filter with `isPartialAuditId`.
- Modify `packages/schema/src/quality-scope.ts` — `scopedAuditId`, `suggestedAuditId`, `scopedCandidates` only.
- Create `tests/schema/quality-plan.test.js`.
- Modify `tests/schema/quality-scope.test.js` (candidates after a plan part) and `tests/schema/quality-baseline.test.js` (a part id is never the baseline).
- Modify `package.json` — `"test:quality-plan": "node tests/schema/quality-plan.test.js"`.
- Modify `.github/workflows/ci.yml` — one `build`-job step after the baseline step.
- Generated (committed, see Contract deviations): `plugin-kritik/skills/kritik/scripts/compute-matrix.js`, `plugin-kritik/skills/kritik/scripts/detect-regressions.js`.
- Committed as-is: `docs/superpowers/specs/2026-11-11-kritik-planner-design.md`, `docs/superpowers/plans/2026-11-11-kritik-planner-stack.md` and the four part plans `docs/superpowers/plans/2026-11-11-kritik-planner-part-*.md`.

Not touched: `packages/cli`, `packages/mcp`, `lib/`, `docs/kritik-skill`, `recordedAuditIds`, `deriveAuditScope`, any version.

**Traps that apply throughout.**

- **Node 20 in CI, Node 26 locally.** Tests never `require` a `.ts` file; they load the package through `tests/schema/load-schema.js`, which discovers every `packages/schema/src/*.ts` (so `quality-plan.ts` needs no loader change; `scripts/generate/load-schema-package.js` discovers modules the same way). The test code uses nothing newer than Node 20 has.
- **Hand-maintained alias tables.** `tests/services/load-quality-events.js` rewrites only `@arkaik/schema` and `@/lib/utils/quality`. This part adds no import to `lib/`, so no table changes; `npm run test:quality-events` proves the hosted path still loads.
- **`export *` duplicates fail `tsc`.** Before Task 2's index edit, run the grep in Task 2 Step 3.
- **Source-asserting suites.** None reads the quality modules as text (contract, checked); nothing to update.

---

### Task 1: Commit the design documents

**Files:**
- Add: `docs/superpowers/specs/2026-11-11-kritik-planner-design.md`, `docs/superpowers/plans/2026-11-11-kritik-planner-stack.md`, `docs/superpowers/plans/2026-11-11-kritik-planner-part-1-schema.md` and the part 2 to 4 plans beside it.

The stack's precedent (`c97871d`, stone skins part 1) commits the spec and every part plan in part 1.

- [ ] **Step 1: Check the branch and the files**

Run: `git branch --show-current && git status --porcelain`
Expected: `feat/kritik-plan-schema`, and only `??` lines for the spec, the contract and the four `2026-11-11-kritik-planner-part-*.md` plans.

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-11-11-kritik-planner-design.md docs/superpowers/plans/2026-11-11-kritik-planner-stack.md docs/superpowers/plans/2026-11-11-kritik-planner-part-*.md
git commit -m "docs(kritik): the planner spec, its stack contract and the four part plans" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Plan shapes and the partial-id predicates

**Files:**
- Create: `packages/schema/src/quality-plan.ts`
- Modify: `packages/schema/src/index.ts`, `package.json`
- Test: `tests/schema/quality-plan.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/schema/quality-plan.test.js`. Later tasks insert their sections directly above the `// --- summary ---` line.

```js
#!/usr/bin/env node

/**
 * The Kritik planner's pure rules (docs/superpowers/specs/2026-11-11-kritik-planner-design.md,
 * part 1 of docs/superpowers/plans/2026-11-11-kritik-planner-stack.md): the
 * `--run` grammar, the cells per part, plan and part ids that sort last, the
 * partial-id predicates, the recorded scope marker's reader, and the plan
 * file's zod schema.
 *
 * Pure and DB-free — `quality-plan.ts` imports nothing at runtime but
 * `applicableCells`, `domainCodeOf` and a constant — so this runs in CI's fast
 * build job beside the other quality suites. TypeScript is loaded through
 * `load-schema.js` (CI runs Node 20, which cannot require a `.ts` file).
 *
 * The cell counts are pinned against the shipped pack
 * (`packages/kritik-library/framework.json`, version 0.1.0) and its Pebbles
 * profile: SEC on web is 6 cells and 36 checklist steps, AGT on iOS 8 and 42,
 * and the whole product 338 applicable cells.
 */

const fs = require("fs");
const path = require("path");
const { loadSchema } = require("./load-schema");

const ROOT = path.join(__dirname, "..", "..");
const PACK = JSON.parse(fs.readFileSync(path.join(ROOT, "packages/kritik-library/framework.json"), "utf8"));
const PEBBLES = PACK.profiles.pbbls.surfaces;
const SURFACES = PEBBLES.map((surface) => surface.id);
const DOMAINS = PACK.domains.map((domain) => domain.code);

const S = loadSchema();

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`PASS: ${name}`);
  else { failures++; console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`); }
}
const throws = (fn) => {
  try {
    fn();
    return undefined;
  } catch (error) {
    return error.message;
  }
};

// --- partial ids ----------------------------------------------------------------

{
  const { isScopedAuditId, isPlanId, isPlanPartId, isPartialAuditId, planIdOfPartId, planCellKey } = S;

  check("a month is a full audit id", !isPartialAuditId("2026-11") && !isScopedAuditId("2026-11") && !isPlanId("2026-11") && !isPlanPartId("2026-11"));
  check("a hand-named audit is a full audit id", !isPartialAuditId("2026-11-sec-web"));
  check("<month>-scoped and -scoped-NN are scoped", isScopedAuditId("2026-11-scoped") && isScopedAuditId("2026-11-scoped-02") && isPartialAuditId("2026-11-scoped-02"));
  check("a plan id is a plan id, not a part", isPlanId("2026-11-zplan-1100") && !isPlanPartId("2026-11-zplan-1100") && isPartialAuditId("2026-11-zplan-1100"));
  check("a plan part id is a part, not a plan", isPlanPartId("2026-11-zplan-1100-sec-web") && !isPlanId("2026-11-zplan-1100-sec-web") && isPartialAuditId("2026-11-zplan-1100-sec-web"));
  check("a part with a digit domain and a dashed surface is a part", isPlanPartId("2026-11-zplan-1100-a11y-web-app"));
  check(
    "a scoped id wins over a part: <partId>-scoped is scoped, not a part",
    isScopedAuditId("2026-11-zplan-1100-sec-web-scoped") && !isPlanPartId("2026-11-zplan-1100-sec-web-scoped") && isPartialAuditId("2026-11-zplan-1100-sec-web-scoped"),
  );
  check("upper case is not a part id", !isPlanPartId("2026-11-zplan-1100-SEC-web"));
  check("a three-digit DDN is not a plan id", !isPlanId("2026-11-zplan-110") && !isPlanPartId("2026-11-zplan-110-sec-web"));
  check("non-strings are never ids", [undefined, null, 42, {}, ["2026-11-scoped"]].every((value) => !isPartialAuditId(value)));
  check("planIdOfPartId reads the plan off a part", planIdOfPartId("2026-11-zplan-1100-sec-web") === "2026-11-zplan-1100");
  check(
    "planIdOfPartId is null for anything but a part",
    planIdOfPartId("2026-11-zplan-1100") === null && planIdOfPartId("2026-11-zplan-1100-sec-web-scoped") === null && planIdOfPartId("2026-11") === null,
  );
  check("planCellKey is criterion::surface", planCellKey("SEC-01", "web") === "SEC-01::web");
}

// --- summary ------------------------------------------------------------------------

console.log(failures === 0 ? "\nAll quality-plan checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
```

Add the script to `package.json`, directly after the `"test:quality-baseline"` line:

```json
    "test:quality-plan": "node tests/schema/quality-plan.test.js",
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:quality-plan`
Expected: exit 1, crashing with `TypeError: isPartialAuditId is not a function` (the module does not exist yet, so `loadSchema()` returns no such export).

- [ ] **Step 3: Write the module and export it**

Check first that no module `index.ts` re-exports already uses the new names (an `export *` duplicate fails `tsc`):

Run: `grep -nwE "KRITIK_PLAN_SCHEMA|PLAN_PLANS_DIR|KritikPlan(Band|Cell|Estimate|Part)?|PlanRun|planCellKey|isScopedAuditId|isPlanId|isPlanPartId|isPartialAuditId|planIdOfPartId|parseRun|planCells|applicableCellCount|planId|planPartId|PlanCoverage|PlanAuditScope|PlanScopeReading|readPlanScope|KritikPlanSchema|KritikPlanPartSchema|parseKritikPlan" packages/schema/src/*.ts`
Expected: only the two lines of `quality-baseline.ts` that declare and use its private, unexported `isScopedAuditId` (removed in Task 8).

Create `packages/schema/src/quality-plan.ts`:

```ts
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
```

In `packages/schema/src/index.ts`, directly after `export * from "./quality-baseline";`, add:

```ts
export * from "./quality-plan";
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:quality-plan && npx tsc --noEmit -p .`
Expected: every line `PASS:`, ending `All quality-plan checks passed.`; `tsc` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add packages/schema/src/quality-plan.ts packages/schema/src/index.ts tests/schema/quality-plan.test.js package.json
git commit -m "feat(kritik): plan shapes and the partial audit id predicates" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The `--run` grammar

**Files:**
- Modify: `packages/schema/src/quality-plan.ts`
- Test: `tests/schema/quality-plan.test.js`

The contract corrects the spec here: domains are 2 to 5 letters or digits (`A11Y` ships), validated against the caller's vocabulary (the effective library's codes, pack plus overlay), not a fixed list of eleven.

- [ ] **Step 1: Write the failing test**

Insert directly above the `// --- summary ---` line of `tests/schema/quality-plan.test.js`:

```js
// --- the --run grammar ------------------------------------------------------------

{
  const { parseRun } = S;
  const vocabulary = { domains: DOMAINS, surfaces: [...SURFACES, "cross-surface"] };

  {
    const { runs, warnings } = parseRun(["SEC:web", "agt:ios", "A11Y:web", "a11y:admin"], vocabulary);
    check(
      "valid tokens parse in order, domains upper-cased, surfaces kept",
      JSON.stringify(runs) ===
        JSON.stringify([
          { domain: "SEC", surface: "web" },
          { domain: "AGT", surface: "ios" },
          { domain: "A11Y", surface: "web" },
          { domain: "A11Y", surface: "admin" },
        ]) && warnings.length === 0,
      JSON.stringify({ runs, warnings }),
    );
  }
  {
    const { runs, warnings } = parseRun(["SEC:web", "AGT:ios", "sec:web", "Sec:web"], vocabulary);
    check(
      "a duplicate after normalisation collapses into its first occurrence, one warning each",
      JSON.stringify(runs) === JSON.stringify([{ domain: "SEC", surface: "web" }, { domain: "AGT", surface: "ios" }]) &&
        warnings.length === 2 &&
        warnings[0].includes("sec:web") &&
        warnings[0].includes("SEC:web"),
      JSON.stringify({ runs, warnings }),
    );
  }
  check("no token refuses", throws(() => parseRun([], vocabulary)) === "at least one --run DOMAIN:SURFACE is required");
  for (const token of ["SEC", "SEC:", ":web", "SEC:web:x", "S:web", "SECURE:web", "SEC:we b", "SEC:web/app", "SE*:web", ""]) {
    const message = throws(() => parseRun([token], vocabulary));
    check(
      `the malformed token ${JSON.stringify(token)} refuses, showing the grammar and the token`,
      message !== undefined && message.includes(`"${token}"`) && message.includes("DOMAIN:SURFACE") && message.includes("2 to 5"),
      message,
    );
  }
  {
    const message = throws(() => parseRun(["XYZ:web"], vocabulary));
    check("an unknown domain refuses and lists the codes", message !== undefined && message.includes("XYZ") && message.includes(DOMAINS.join(", ")), message);
  }
  {
    const message = throws(() => parseRun(["SEC:api"], vocabulary));
    check(
      "an unknown surface refuses, lists the profile's surfaces and asks for a literal match",
      message !== undefined && message.includes('"api"') && message.includes(SURFACES.join(", ")) && message.includes("exactly"),
      message,
    );
  }
  {
    const message = throws(() => parseRun(["SEC:Web"], vocabulary));
    check("surfaces match literally: Web is not web", message !== undefined && message.includes('"Web"'), message);
  }
  {
    const message = throws(() => parseRun(["SEC:cross-surface"], vocabulary));
    check("cross-surface refuses as a findings-only lens", message !== undefined && message.includes("cross-surface") && message.includes("lens"), message);
  }
  {
    const message = throws(() => parseRun(["SEC:web", "SEC"], vocabulary));
    check("one bad token among good ones still refuses", message !== undefined && message.includes('"SEC"'), message);
  }
  {
    const { runs } = parseRun(["ux1:web"], { domains: ["UX1"], surfaces: ["web"] });
    check("the domain vocabulary is the caller's (an overlay code)", runs.length === 1 && runs[0].domain === "UX1");
  }
}

```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:quality-plan`
Expected: exit 1, crashing with `TypeError: parseRun is not a function`.

- [ ] **Step 3: Write `parseRun`**

In `packages/schema/src/quality-plan.ts`, insert directly above the `// --- Shapes ---…` line (after the module comment):

```ts
import { CROSS_SURFACE_ID } from "./quality";

```

Append to the end of the file:

```ts

// --- The --run grammar -----------------------------------------------------------

/** `DOMAIN:SURFACE`. Domain codes carry digits (`A11Y`); surfaces are profile ids. */
const RUN_TOKEN = /^([A-Za-z0-9]{2,5}):([A-Za-z0-9_-]+)$/;

/**
 * The `--run` tokens as parts, in the order given (the priority order a budget
 * cut will walk). The domain is upper-cased and must be one of
 * `vocabulary.domains` (the effective library's codes, pack plus overlay); the
 * surface must equal one of `vocabulary.surfaces` (the profile's ids) exactly,
 * as `applicableCells` matches it. A duplicate after normalisation collapses
 * into its first occurrence with one warning. Every other problem throws.
 */
export function parseRun(
  tokens: readonly string[],
  vocabulary: { domains: readonly string[]; surfaces: readonly string[] },
): { runs: PlanRun[]; warnings: string[] } {
  if (tokens.length === 0) throw new Error("at least one --run DOMAIN:SURFACE is required");
  const surfaces = vocabulary.surfaces.filter((id) => id !== CROSS_SURFACE_ID);
  const runs: PlanRun[] = [];
  const warnings: string[] = [];
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
    if (!vocabulary.domains.includes(domain)) {
      throw new Error(`--run "${token}": ${domain} is not a domain of this library. Domain codes: ${vocabulary.domains.join(", ")}.`);
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
    runs.push({ domain, surface });
  }
  return { runs, warnings };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:quality-plan && npx tsc --noEmit -p .`
Expected: `All quality-plan checks passed.`; `tsc` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add packages/schema/src/quality-plan.ts tests/schema/quality-plan.test.js
git commit -m "feat(kritik): parse --run DOMAIN:SURFACE tokens against the library and the profile" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Cells and steps per part

**Files:**
- Modify: `packages/schema/src/quality-plan.ts`
- Test: `tests/schema/quality-plan.test.js`

The contract corrects the spec here too: `planCells` is built on `applicableCells`, not on `signalRunSheet` (one row per signal, skips criteria without signals, matches `--domain` case-sensitively). The test pins the two to the same distinct cells on the shipped pack, plus SEC:web = 6 cells / 36 steps, AGT:ios = 8 / 42 and 338 applicable cells (counted from `packages/kritik-library/framework.json` 0.1.0 and its `pbbls` profile).

- [ ] **Step 1: Write the failing test**

Insert directly above the `// --- summary ---` line:

```js
// --- cells per part -----------------------------------------------------------------

{
  const { planCells, applicableCellCount, signalRunSheet } = S;

  {
    const { cells, steps } = planCells(PACK, SURFACES, { domain: "SEC", surface: "web" });
    check(
      "SEC on web is 6 cells and 36 steps",
      cells.length === 6 && steps === 36 && cells.map((cell) => cell.criterion_id).join(",") === "SEC-01,SEC-04,SEC-05,SEC-06,SEC-07,SEC-08" && cells.every((cell) => cell.surface === "web"),
      JSON.stringify({ cells, steps }),
    );
  }
  {
    const { cells, steps } = planCells(PACK, SURFACES, { domain: "AGT", surface: "ios" });
    check("AGT on iOS is 8 cells and 42 steps", cells.length === 8 && steps === 42, JSON.stringify({ count: cells.length, steps }));
  }
  check("the Pebbles profile has 338 applicable cells", applicableCellCount(PACK, SURFACES) === 338, String(applicableCellCount(PACK, SURFACES)));

  // The run sheet is one row per signal, and filters on `criterion.domain`
  // with exact case — so the comparison is over its distinct cells. On the
  // shipped pack every criterion has signals and none is retired, which is
  // what makes the two sets equal.
  const mismatches = [];
  let total = 0;
  for (const domain of DOMAINS) {
    for (const surface of SURFACES) {
      const planned = planCells(PACK, SURFACES, { domain, surface }).cells.map((cell) => `${cell.criterion_id}::${cell.surface}`);
      const sheet = [...new Set(signalRunSheet(PACK, PEBBLES, { domain, surface }).map((row) => `${row.criterion_id}::${row.surface}`))];
      total += planned.length;
      if (JSON.stringify(planned) !== JSON.stringify(sheet)) mismatches.push(`${domain}:${surface}`);
    }
  }
  check("every domain × surface of the shipped pack gives the run sheet's cells, in the same order", mismatches.length === 0, mismatches.join(", "));
  check("the parts of every domain × surface add up to the applicable cells", total === 338, String(total));

  const LIB = {
    criteria: [
      { id: "SEC-01", domain: "SEC", applies_to: ["web"], checklist: ["a", "b"] },
      { id: "SEC-02", domain: "SEC", applies_to: ["web"], superseded_by: "SEC-01", checklist: ["a"] },
      { id: "SEC-03", domain: "SEC", applies_to: ["web"] },
      { id: "SEC-04", domain: "SEC", applies_to: ["ios"], checklist: ["a"] },
      { id: "SEC-05", domain: "SEC", checklist: ["a", "b", "c"] },
      { id: "UX-01", checklist: ["a"] },
    ],
  };
  {
    const { cells, steps } = planCells(LIB, ["web", "ios"], { domain: "SEC", surface: "web" });
    check(
      "retired criteria are out, no applies_to is everywhere, a missing checklist counts 0",
      cells.map((cell) => cell.criterion_id).join(",") === "SEC-01,SEC-03,SEC-05" && steps === 5,
      JSON.stringify({ cells, steps }),
    );
  }
  {
    const { cells } = planCells(LIB, ["web", "ios"], { domain: "UX", surface: "ios" });
    check("a criterion with no domain belongs to its id prefix", cells.length === 1 && cells[0].criterion_id === "UX-01");
  }
  {
    const result = planCells(LIB, ["web", "ios"], { domain: "SEC", surface: "android" });
    check("a surface outside the given surfaces gives zero cells, not an error", result.cells.length === 0 && result.steps === 0);
  }
  check("cross-surface never counts as an applicable surface", applicableCellCount(LIB, ["web", "cross-surface"]) === applicableCellCount(LIB, ["web"]));
}

```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:quality-plan`
Expected: exit 1, crashing with `TypeError: planCells is not a function`.

- [ ] **Step 3: Write `planCells` and `applicableCellCount`**

In `packages/schema/src/quality-plan.ts`, replace the line

```ts
import { CROSS_SURFACE_ID } from "./quality";
```

with

```ts
import { applicableCells, CROSS_SURFACE_ID, type KritikCriterion, type KritikLibrary } from "./quality";
import { domainCodeOf } from "./quality-ops";
```

Append to the end of the file:

```ts

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
```

`domainCodeOf` is typed `(criterionId, library?: KritikLibrary)` and only reads `library.criteria`, hence the `as KritikLibrary` on a `Pick<KritikLibrary, "criteria">`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:quality-plan && npx tsc --noEmit -p .`
Expected: `All quality-plan checks passed.`; `tsc` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add packages/schema/src/quality-plan.ts tests/schema/quality-plan.test.js
git commit -m "feat(kritik): cells and checklist steps per plan part" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Plan and part ids that sort last

**Files:**
- Modify: `packages/schema/src/quality-plan.ts`
- Test: `tests/schema/quality-plan.test.js`

`planId` reads the local calendar, the clock `currentAuditId()` uses (`packages/cli/src/commands/kritik.ts:376`), so the tests build dates with the local `new Date(y, m, d)` constructor and pass in any time zone. The property test generates histories with the five kinds of id the spec names (`YYYY-MM`, `-scoped`, `-scoped-NN`, a hand-named `2026-11-sec-web`, earlier plans and their parts and scoped re-audits), including same-day plans, so it fails if either NN rule is dropped.

- [ ] **Step 1: Write the failing test**

Insert directly above the `// --- summary ---` line:

```js
// --- plan and part ids --------------------------------------------------------------

{
  const { planId, planPartId, isPlanId, isPlanPartId, isScopedAuditId } = S;
  // Local time on purpose: the id follows the local calendar, as currentAuditId() does.
  const NOW = new Date(2026, 10, 11, 9, 30);
  const RUNS = [{ domain: "SEC", surface: "web" }, { domain: "AGT", surface: "ios" }];

  check("planPartId lower-cases the domain and the surface", planPartId("2026-11-zplan-1100", "A11Y", "Web") === "2026-11-zplan-1100-a11y-web");
  for (const surface of ["scoped", "pre-scoped", "web-scoped-02"]) {
    check(`planPartId refuses the surface "${surface}", which would read as a scoped id`, throws(() => planPartId("2026-11-zplan-1100", "SEC", surface)) !== undefined);
  }
  check("planPartId accepts a surface that merely contains scoped", planPartId("2026-11-zplan-1100", "SEC", "scoped-api") === "2026-11-zplan-1100-sec-scoped-api");

  check("with nothing known, the first plan of the day is DD00", planId({ now: NOW, known: [], runs: RUNS }) === "2026-11-zplan-1100");
  check("the id pads the month and the day", planId({ now: new Date(2026, 0, 5, 12), known: [], runs: RUNS }) === "2026-01-zplan-0500");
  check(
    "a plan id is a plan id, and its parts are parts",
    isPlanId(planId({ now: NOW, known: [], runs: RUNS })) && RUNS.every((run) => isPlanPartId(planPartId("2026-11-zplan-1100", run.domain, run.surface))),
  );
  check("a known plan id is skipped", planId({ now: NOW, known: ["2026-11-zplan-1100"], runs: RUNS }) === "2026-11-zplan-1101");
  // Its parts would sort after the known one, so only the "starts with" rule skips it.
  check("a known part of a candidate is skipped", planId({ now: NOW, known: ["2026-11-zplan-1100-a11y-admin"], runs: RUNS }) === "2026-11-zplan-1101");
  check(
    "a candidate whose parts would sort before the greatest known id is skipped",
    planId({ now: NOW, known: ["2026-11-zplan-1100-zzz-web"], runs: [{ domain: "SEC", surface: "web" }] }) === "2026-11-zplan-1101",
  );
  check("known need not arrive sorted", planId({ now: NOW, known: ["2026-11-zplan-1103-sec-web", "2026-10"], runs: RUNS }) === "2026-11-zplan-1104");
  {
    const message = throws(() => planId({ now: NOW, known: ["2026-10", "2026-12"], runs: RUNS }));
    check("past NN 99 it throws, naming the greatest known id", message === 'no plan id on 2026-11-11 sorts after "2026-12"', message);
  }
  {
    const known = Array.from({ length: 100 }, (_, n) => `2026-11-zplan-11${String(n).padStart(2, "0")}`);
    const message = throws(() => planId({ now: NOW, known, runs: RUNS }));
    check("a day with all 100 plan ids taken throws", message === 'no plan id on 2026-11-11 sorts after "2026-11-zplan-1199"', message);
  }

  // Sort-last property: whatever exists, every new part id sorts after all of it.
  // mulberry32: seeded, so a failure reproduces.
  let seed = 20261111;
  const random = (n) => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n);
  };
  const pick = (items) => items[random(items.length)];
  const surfaces = ["web", "ios", "android", "admin", "supabase", "web-app", "api_v2"];
  const domains = ["SEC", "PRV", "GDP", "SAF", "ARC", "TST", "PLT", "A11Y", "PRF", "REL", "AGT"];
  const two = (n) => String(n).padStart(2, "0");
  const existing = () => {
    const month = `2026-${two(1 + random(11))}`;
    const plan = `${month}-zplan-${two(1 + random(28))}${two(random(90))}`;
    switch (random(7)) {
      case 0:
        return month;
      case 1:
        return `${month}-scoped`;
      case 2:
        return `${month}-scoped-${two(2 + random(98))}`;
      case 3:
        return `${month}-${pick(domains).toLowerCase()}-${pick(surfaces)}`;
      case 4:
        return plan;
      case 5:
        return `${plan}-${pick(domains).toLowerCase()}-${pick(surfaces)}`;
      default:
        return `${plan}-${pick(domains).toLowerCase()}-${pick(surfaces)}-scoped`;
    }
  };
  const violations = [];
  for (let trial = 0; trial < 500; trial++) {
    const known = Array.from({ length: 1 + random(12) }, existing);
    // Every generated id is dated on or before 2026-11-28 and numbered below
    // 90, so a plan on the 28th always fits. Same-day plans are what make the
    // NN rule, not the date, decide whether a part sorts last.
    const now = new Date(2026, 10, 28, 8);
    const runs = Array.from({ length: 1 + random(3) }, () => ({ domain: pick(domains), surface: pick(surfaces) }));
    const id = planId({ now, known, runs });
    const parts = runs.map((run) => planPartId(id, run.domain, run.surface));
    const late = parts.filter((part) => known.some((other) => !(part > other)));
    if (late.length > 0 || known.includes(id) || !parts.every((part) => isPlanPartId(part) && !isScopedAuditId(part))) violations.push(JSON.stringify({ known, runs, id }));
  }
  check("500 generated histories: every new part id sorts after every existing id", violations.length === 0, violations.slice(0, 3).join(" | "));
}

```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:quality-plan`
Expected: exit 1, crashing with `TypeError: planPartId is not a function`.

- [ ] **Step 3: Write `planPartId` and `planId`**

Append to the end of `packages/schema/src/quality-plan.ts`:

```ts

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
 * audit directories, plan files and recorded audits.
 */
export function planId(input: { now: Date; known: readonly string[]; runs: readonly PlanRun[] }): string {
  const { now, known, runs } = input;
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:quality-plan && npx tsc --noEmit -p .`
Expected: `All quality-plan checks passed.`; `tsc` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add packages/schema/src/quality-plan.ts tests/schema/quality-plan.test.js
git commit -m "feat(kritik): plan and part ids that sort after every audit" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The recorded scope marker and its reader

**Files:**
- Modify: `packages/schema/src/quality-plan.ts`
- Test: `tests/schema/quality-plan.test.js`

Part 3 reads plan records with `readPlanScope`; part 4 writes `PlanAuditScope`. Nothing writes one yet.

- [ ] **Step 1: Write the failing test**

Insert directly above the `// --- summary ---` line:

```js
// --- the recorded scope marker ------------------------------------------------------

{
  const { readPlanScope } = S;
  const coverage = { scored: 14, assessed: 152, applicable: 338, surfaces: { web: { assessed: 40, applicable: 71 } } };
  const full = {
    partial: true,
    cells: 14,
    since: "2026-10",
    plan: "2026-11-zplan-1100",
    parts: ["2026-11-zplan-1100-sec-web", "2026-11-zplan-1100-agt-ios"],
    scored: ["SEC-01::web", "AGT-08::ios"],
    coverage,
  };
  check(
    "a full marker reads back field for field",
    JSON.stringify(readPlanScope(full)) ===
      JSON.stringify({ plan: full.plan, parts: full.parts, scored: full.scored, cells: 14, since: "2026-10", coverage }),
    JSON.stringify(readPlanScope(full)),
  );
  check(
    "a first audit's marker has no since",
    readPlanScope({ ...full, since: undefined }).since === null && readPlanScope({ partial: true, plan: "2026-11-zplan-1100" }).since === null,
  );
  check(
    "a scoped re-audit's marker is not a plan",
    readPlanScope({ partial: true, cells: 12, since: "2026-10" }) === null && readPlanScope({ partial: true, plan: "" }) === null,
  );
  check("anything but an object is not a plan", [undefined, null, "2026-11-zplan-1100", 42, true].every((value) => readPlanScope(value) === null));
  {
    const reading = readPlanScope({ plan: "2026-11-zplan-1100", parts: ["a", 3, "", null, "b"], scored: "SEC-01::web", cells: -1 });
    check(
      "malformed fields are dropped or null, never thrown on",
      reading !== null && JSON.stringify(reading.parts) === '["a","b"]' && reading.scored.length === 0 && reading.cells === null && reading.coverage === null,
      JSON.stringify(reading),
    );
  }
  {
    const reading = readPlanScope({ plan: "p", coverage: { scored: 1, assessed: 2, applicable: 3, surfaces: { web: { assessed: 1, applicable: 2 }, ios: { assessed: "x" }, admin: null } } });
    check(
      "a coverage keeps its well-formed surfaces only",
      JSON.stringify(reading.coverage) === JSON.stringify({ scored: 1, assessed: 2, applicable: 3, surfaces: { web: { assessed: 1, applicable: 2 } } }),
      JSON.stringify(reading.coverage),
    );
  }
  check("a coverage missing a count is null", readPlanScope({ plan: "p", coverage: { scored: 1, assessed: 2 } }).coverage === null);
  {
    const input = JSON.parse(JSON.stringify(full));
    readPlanScope(input);
    check("nothing is mutated", JSON.stringify(input) === JSON.stringify(full));
  }
}

```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:quality-plan`
Expected: exit 1, crashing with `TypeError: readPlanScope is not a function`.

- [ ] **Step 3: Write the types and `readPlanScope`**

Append to the end of `packages/schema/src/quality-plan.ts`:

```ts

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

/** A recorded `coverage`, or `null` when any of its three counts is missing; a surface entry missing either count is dropped. */
function readCoverage(value: unknown): PlanCoverage | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  if (!isCount(row.scored) || !isCount(row.assessed) || !isCount(row.applicable)) return null;
  const surfaces: Record<string, { assessed: number; applicable: number }> = {};
  if (typeof row.surfaces === "object" && row.surfaces !== null && !Array.isArray(row.surfaces)) {
    for (const [surface, entry] of Object.entries(row.surfaces as Record<string, unknown>)) {
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:quality-plan && npx tsc --noEmit -p .`
Expected: `All quality-plan checks passed.`; `tsc` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add packages/schema/src/quality-plan.ts tests/schema/quality-plan.test.js
git commit -m "feat(kritik): the plan record's scope marker and a lenient reader for it" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The plan file's zod schema

**Files:**
- Modify: `packages/schema/src/quality-schemas.ts`
- Test: `tests/schema/quality-plan.test.js`

Contract choices: `schema: z.literal(KRITIK_PLAN_SCHEMA)`, `createdAt: z.iso.datetime()` (zod 4.4.3; `z.string().datetime()` is deprecated), part `domain` `^[A-Z0-9]{2,5}$`, `cells.min(1)`, `parts.min(1)`, plain `z.object` (unknown keys stripped), no `.meta({ id })` so `public/schema/project-bundle.json` cannot change. `quality-schemas.ts` may import zod; `quality-plan.ts` stays zod-free and is imported here, never the reverse.

- [ ] **Step 1: Write the failing test**

Insert directly above the `// --- summary ---` line:

```js
// --- the plan file schema -----------------------------------------------------------

{
  const { parseKritikPlan, KritikPlanSchema, KritikPlanPartSchema, KRITIK_PLAN_SCHEMA, PLAN_PLANS_DIR } = S;
  const part = (domain, surface, cells, steps) => ({
    domain,
    surface,
    auditId: `2026-11-zplan-1100-${domain.toLowerCase()}-${surface}`,
    cells: cells.map((criterion_id) => ({ criterion_id, surface })),
    steps,
    estimate: null,
    status: "included",
    prompt: `Run part ${domain}:${surface} of Kritik plan 2026-11-zplan-1100.`,
  });
  const PLAN = {
    schema: "arkaik.kritik.plan/1",
    planId: "2026-11-zplan-1100",
    createdAt: "2026-11-11T09:30:00.000Z",
    commit: "3f9c2e1",
    frameworkVersion: "0.1.0",
    tier: null,
    budgetTokens: null,
    budgetUsd: null,
    pricePerMTok: null,
    parts: [part("SEC", "web", ["SEC-01", "SEC-04"], 12), part("AGT", "ios", ["AGT-01"], 5)],
    totals: { cells: 3, steps: 17, applicableCells: 338, tokens: null, usd: null },
    prompt: "Run Kritik plan 2026-11-zplan-1100.",
    recordCommand: "arkaik kritik matrix 2026-11-zplan-1100 --record --plan",
  };
  const withPlan = (over) => ({ ...JSON.parse(JSON.stringify(PLAN)), ...over });

  check("the schema constants", KRITIK_PLAN_SCHEMA === "arkaik.kritik.plan/1" && PLAN_PLANS_DIR === "plans");
  {
    const result = parseKritikPlan(PLAN);
    check("a counts-only plan parses and round-trips unchanged", result.ok === true && JSON.stringify(result.plan) === JSON.stringify(PLAN), JSON.stringify(result));
    const again = parseKritikPlan(JSON.parse(JSON.stringify(result.plan)));
    check("its serialized form parses to the same plan", again.ok === true && JSON.stringify(again.plan) === JSON.stringify(PLAN));
  }
  {
    const band = { low: 1, mid: 2, high: 3 };
    const estimated = withPlan({
      budgetTokens: 400000,
      budgetUsd: 5,
      pricePerMTok: 3,
      tier: "opus",
      parts: [
        { ...part("SEC", "web", ["SEC-01"], 6), estimate: { tokens: band, usd: band, inputs: { P: 1, B: 2, c: band, q: band, h: band, V: band }, calibrated: false } },
        { ...part("AGT", "ios", ["AGT-01"], 5), status: "deferred" },
      ],
      totals: { cells: 1, steps: 6, applicableCells: 338, tokens: band, usd: band },
    });
    const result = parseKritikPlan(estimated);
    check("a plan with an estimate, budgets and a deferred part parses", result.ok === true && JSON.stringify(result.plan) === JSON.stringify(estimated), JSON.stringify(result));
  }
  {
    const result = parseKritikPlan(withPlan({ schema: "arkaik.kritik.plan/2" }));
    check("an unknown schema version is rejected at schema", result.ok === false && result.issue.startsWith("schema: "), JSON.stringify(result));
  }
  {
    const result = parseKritikPlan(withPlan({ extra: 1, parts: [{ ...part("SEC", "web", ["SEC-01"], 6), note: "x" }] }));
    check("unknown keys are stripped, not kept", result.ok === true && !("extra" in result.plan) && !("note" in result.plan.parts[0]), JSON.stringify(result));
  }
  const rejects = (name, value, at) => {
    const result = parseKritikPlan(value);
    check(name, result.ok === false && result.issue.startsWith(`${at}: `), JSON.stringify(result));
  };
  rejects("a plan with no parts is rejected", withPlan({ parts: [] }), "parts");
  rejects("a part with no cells is rejected", withPlan({ parts: [part("SEC", "web", [], 0)] }), "parts.0.cells");
  rejects("a lower-case part domain is rejected", withPlan({ parts: [part("sec", "web", ["SEC-01"], 6)] }), "parts.0.domain");
  rejects("a six-letter part domain is rejected", withPlan({ parts: [part("SECURE", "web", ["SEC-01"], 6)] }), "parts.0.domain");
  rejects("an empty part surface is rejected", withPlan({ parts: [part("SEC", "", ["SEC-01"], 6)] }), "parts.0.surface");
  rejects("a fractional step count is rejected", withPlan({ parts: [part("SEC", "web", ["SEC-01"], 1.5)] }), "parts.0.steps");
  rejects("an unknown part status is rejected", withPlan({ parts: [{ ...part("SEC", "web", ["SEC-01"], 6), status: "skipped" }] }), "parts.0.status");
  rejects("a createdAt that is not an ISO datetime is rejected", withPlan({ createdAt: "11 Nov 2026" }), "createdAt");
  rejects("a zero token budget is rejected", withPlan({ budgetTokens: 0 }), "budgetTokens");
  rejects("a dollar budget with no price is rejected", withPlan({ budgetUsd: 5 }), "pricePerMTok");
  rejects("a missing recordCommand is rejected", withPlan({ recordCommand: undefined }), "recordCommand");
  {
    const result = parseKritikPlan([PLAN]);
    check("a value that is not an object reports at (root)", result.ok === false && result.issue.startsWith("(root): "), JSON.stringify(result));
  }
  check(
    "the exported schemas are the ones parseKritikPlan uses",
    KritikPlanSchema.safeParse(PLAN).success === true && KritikPlanPartSchema.safeParse(PLAN.parts[0]).success === true && KritikPlanPartSchema.safeParse({}).success === false,
  );
}

```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:quality-plan`
Expected: exit 1, crashing with `TypeError: parseKritikPlan is not a function`.

- [ ] **Step 3: Write the schemas**

In `packages/schema/src/quality-schemas.ts`, replace

```ts
  SurfaceDef,
} from "./quality";
```

with

```ts
  SurfaceDef,
} from "./quality";
import { KRITIK_PLAN_SCHEMA, type KritikPlan, type KritikPlanPart } from "./quality-plan";
```

Append to the end of the file:

```ts

// --- The Kritik plan file (docs/superpowers/specs/2026-11-11-kritik-planner-design.md) ---
//
// Plain `z.object`, unlike everything above: a plan file is written by `arkaik
// kritik plan` and read back by the same toolchain, never round-tripped through
// a bundle, so an unknown key is stripped rather than carried. No `.meta({ id })`
// either — the plan is not part of the project bundle's published JSON Schema.

const KritikPlanBandSchema = z.object({
  low: z.number().nonnegative(),
  mid: z.number().nonnegative(),
  high: z.number().nonnegative(),
});

const KritikPlanCellSchema = z.object({ criterion_id: z.string(), surface: z.string() });

export const KritikPlanPartSchema: z.ZodType<KritikPlanPart> = z.object({
  domain: z.string().regex(/^[A-Z0-9]{2,5}$/),
  surface: z.string().min(1),
  auditId: z.string(),
  cells: z.array(KritikPlanCellSchema).min(1),
  steps: z.number().int().nonnegative(),
  estimate: z
    .object({
      tokens: KritikPlanBandSchema,
      usd: KritikPlanBandSchema.nullable(),
      inputs: z.object({
        P: z.number(),
        B: z.number(),
        c: KritikPlanBandSchema,
        q: KritikPlanBandSchema,
        h: KritikPlanBandSchema,
        V: KritikPlanBandSchema,
      }),
      calibrated: z.boolean(),
    })
    .nullable(),
  status: z.enum(["included", "deferred"]),
  prompt: z.string(),
});

export const KritikPlanSchema: z.ZodType<KritikPlan> = z
  .object({
    schema: z.literal(KRITIK_PLAN_SCHEMA),
    planId: z.string(),
    createdAt: z.iso.datetime(),
    commit: z.string().nullable(),
    frameworkVersion: z.string(),
    tier: z.string().nullable(),
    budgetTokens: z.number().int().positive().nullable(),
    budgetUsd: z.number().positive().nullable(),
    pricePerMTok: z.number().positive().nullable(),
    parts: z.array(KritikPlanPartSchema).min(1),
    totals: z.object({
      cells: z.number().int(),
      steps: z.number().int(),
      applicableCells: z.number().int(),
      tokens: KritikPlanBandSchema.nullable(),
      usd: KritikPlanBandSchema.nullable(),
    }),
    prompt: z.string(),
    recordCommand: z.string(),
  })
  .superRefine((plan, ctx) => {
    if (plan.budgetUsd !== null && plan.pricePerMTok === null) {
      ctx.addIssue({ code: "custom", path: ["pricePerMTok"], message: "required when budgetUsd is set" });
    }
  });

/** A plan file's content, parsed — or its first problem as `<path>: <message>` (`(root)` when the value itself is wrong). */
export function parseKritikPlan(value: unknown): { ok: true; plan: KritikPlan } | { ok: false; issue: string } {
  const result = KritikPlanSchema.safeParse(value);
  if (result.success) return { ok: true, plan: result.data };
  const first = result.error.issues[0];
  const path = first === undefined ? "" : first.path.map(String).join(".");
  return { ok: false, issue: `${path === "" ? "(root)" : path}: ${first?.message ?? "not a plan"}` };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:quality-plan && npm run test:quality && npm run test:schema && npx tsc --noEmit -p .`
Expected: `All quality-plan checks passed.`, `All quality tests passed`, the parity suite passes, and `tsc` prints nothing. A `tsc` error naming `ZodType<KritikPlanPart, …>` means a schema field and its interface field disagree; fix the schema, never the interface (the interfaces are the contract).

- [ ] **Step 5: Commit**

```bash
git add packages/schema/src/quality-schemas.ts tests/schema/quality-plan.test.js
git commit -m "feat(kritik): the plan file's zod schema and parseKritikPlan" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: A plan part is never the implicit baseline

**Files:**
- Modify: `packages/schema/src/quality-baseline.ts`
- Test: `tests/schema/quality-baseline.test.js`

With no recorded audit, `implicitAuditBaseline` takes the newest assessment `audit_id` that is not scoped. A project whose first audit is a plan has parts on disk before the plan is recorded, and a part would be read as a full audit.

- [ ] **Step 1: Write the failing test**

In `tests/schema/quality-baseline.test.js`, insert directly above the line `// --- stored and folded sections give the same baseline -----------------------------` (the block reuses `auditOnlyScore` from the scoped-id block above it):

```js
// --- plan part ids are never the baseline ------------------------------------------
//
// A project whose first audit is a plan has scored parts on disk before the
// plan is recorded. A part scores a handful of cells; read as the baseline it
// would pass for a full audit.

const PLAN_SECTION = {
  profile: SECTION.profile,
  assessments: [
    assess("SEC-01", 3, "2026-08", "2026-08-04T10:00:00.000Z"),
    assess("SEC-02", 3, "2026-08", "2026-08-05T10:00:00.000Z"),
    assess("SEC-01", 1, "2026-11-zplan-1100-sec-web", "2026-11-11T10:00:00.000Z"),
    assess("SEC-02", 1, "2026-11-zplan-1100-sec-web", "2026-11-11T10:05:00.000Z"),
    assess("SEC-02", 0, "2026-11-zplan-1100-sec-web-scoped", "2026-11-12T10:00:00.000Z"),
  ],
  findings: [],
};
const planBaseline = implicitAuditBaseline([], PLAN_SECTION, LIBRARY);
check(
  "a plan part id is never the baseline: the newest full audit is, dated and scored from it alone",
  planBaseline !== null &&
    planBaseline.audit_id === "2026-08" &&
    planBaseline.ts === "2026-08-05T10:00:00.000Z" &&
    planBaseline.scores.web.SEC === auditOnlyScore,
  JSON.stringify(planBaseline),
);
check(
  "a section holding only a plan's parts → no baseline",
  implicitAuditBaseline([], { ...PLAN_SECTION, assessments: PLAN_SECTION.assessments.filter((a) => a.audit_id !== "2026-08") }, LIBRARY) === null,
);

```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:quality-baseline`
Expected: exit 1 with

```
FAIL: a plan part id is never the baseline: the newest full audit is, dated and scored from it alone — {"id":"implicit-baseline:2026-11-zplan-1100-sec-web",…}
FAIL: a section holding only a plan's parts → no baseline
```

and `2 check(s) failed`.

- [ ] **Step 3: Use `isPartialAuditId`**

In `packages/schema/src/quality-baseline.ts`, make four edits.

Replace

```ts
 * - **Which audit:** the lexically newest `audit_id` among the assessments,
 *   skipping scoped ones (`<month>-scoped`, `<month>-scoped-02`) — a hosted
 *   score landing between the section read and the journal read must never
 *   pass for the restored audit. The scoped rows are left out of the matrix
 *   too; every other row feeds it, as it always has.
```

with

```ts
 * - **Which audit:** the lexically newest `audit_id` among the assessments,
 *   skipping partial ones (`isPartialAuditId`: scoped re-audits such as
 *   `<month>-scoped`, plans and plan parts such as `2026-11-zplan-1100-sec-web`)
 *   — a hosted score landing between the section read and the journal read
 *   must never pass for the restored audit, and neither may a plan part scored
 *   before its plan is recorded. The partial rows are left out of the matrix
 *   too; every other row feeds it, as it always has.
```

Replace

```ts
import { auditCompletedInput } from "./quality-ops";
```

with

```ts
import { auditCompletedInput } from "./quality-ops";
import { isPartialAuditId } from "./quality-plan";
```

Delete these three lines (the private regex, its doc comment, and the private predicate; `isString` stays, it is used below):

```ts
/** `<month>-scoped` and `<month>-scoped-02`…: the ids a scoped re-audit writes into (`scopedAuditTarget`). */
const SCOPED_AUDIT_ID = /-scoped(-\d+)?$/;
```

```ts
const isScopedAuditId = (value: unknown): boolean => isString(value) && SCOPED_AUDIT_ID.test(value);
```

Replace

```ts
  // Every valid assessment row but a scoped audit's feeds the matrix below;
```

with

```ts
  // Every valid assessment row but a partial audit's feeds the matrix below;
```

and replace

```ts
  // restored scoped audit with no recording is not a real case, so skipping
  // them costs nothing.
  const assessmentRows = objectRowsOf<QualityAssessment>(section?.assessments).filter((row) => !isScopedAuditId(row.audit_id));
```

with

```ts
  // restored scoped audit with no recording is not a real case, so skipping
  // them costs nothing. A plan part (`2026-11-zplan-1100-sec-web`) is skipped
  // too: it scores a handful of cells, and until its plan is recorded nothing
  // says so — read as the baseline, six Security cells would pass for a full
  // audit.
  const assessmentRows = objectRowsOf<QualityAssessment>(section?.assessments).filter((row) => !isPartialAuditId(row.audit_id));
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:quality-baseline && npm run test:quality-events && npm run test:quality-trend && npx tsc --noEmit -p . && npm run lint`
Expected: `All checks passed`; the hosted-events suite (which calls `implicitAuditBaseline` through `lib/services/graph/quality-events.ts`) and the trend suite pass unchanged; `tsc` and eslint print no error.

- [ ] **Step 5: Commit**

```bash
git add packages/schema/src/quality-baseline.ts tests/schema/quality-baseline.test.js
git commit -m "feat(kritik): an unrecorded plan part is never the implicit baseline" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Scoped re-audits after a plan start from its newest part

**Files:**
- Modify: `packages/schema/src/quality-scope.ts` (`scopedAuditId`, `suggestedAuditId`, `scopedCandidates` only)
- Test: `tests/schema/quality-scope.test.js`
- Generated: `plugin-kritik/skills/kritik/scripts/compute-matrix.js`, `plugin-kritik/skills/kritik/scripts/detect-regressions.js`

In a month that holds a plan, `<month>-scoped` sorts before the plan's parts, so `score --scope` refuses. The candidates' base becomes the newest known id when it is a plan part, or a scoped re-audit named after one: `<partId>-scoped`, `<partId>-scoped-02`, … The repo (`scopedAuditTarget`), the MCP server and the hosted planner (`lib/services/graph/quality-events.ts:442`) all call `scopedAuditId`, so all three get it with no change of their own. **Trap:** this is the change that moves the minified plugin scripts (see Contract deviations).

- [ ] **Step 1: Write the failing test**

In `tests/schema/quality-scope.test.js`, insert directly above the final line pair `console.log(failures === 0 ? "\nAll quality-scope checks passed." : …)` / `process.exit(…)`:

```js
// --- scopedAuditId after a plan (the planner, part 1) ------------------------
//
// A plan's parts (`2026-11-zplan-1100-sec-web`) sort after every same-month id
// by design, so `<month>-scoped` would sort before them and be refused. The
// candidates start from the newest part instead.

{
  const throws = (fn) => {
    try {
      fn();
      return undefined;
    } catch (error) {
      return error.message;
    }
  };
  const PARTS = ["2026-11-zplan-1100-agt-ios", "2026-11-zplan-1100-sec-web"];
  const base = { since: "2026-10", month: "2026-11", recorded: ["2026-10", "2026-11-zplan-1100", ...PARTS] };

  check(
    "after a plan in the same month, the scoped audit is named after the newest part",
    scopedAuditId({ ...base, known: ["2026-10", ...PARTS] }) === "2026-11-zplan-1100-sec-web-scoped",
  );
  check(
    "a taken <partId>-scoped rolls to -02, read off the scoped id's stem",
    scopedAuditId({ ...base, known: ["2026-10", ...PARTS, "2026-11-zplan-1100-sec-web-scoped"] }) === "2026-11-zplan-1100-sec-web-scoped-02",
  );
  check(
    "-02 taken rolls to -03",
    scopedAuditId({ ...base, known: ["2026-10", ...PARTS, "2026-11-zplan-1100-sec-web-scoped", "2026-11-zplan-1100-sec-web-scoped-02"] }) ===
      "2026-11-zplan-1100-sec-web-scoped-03",
  );
  check(
    "known need not arrive sorted",
    scopedAuditId({ ...base, known: ["2026-11-zplan-1100-sec-web", "2026-10", "2026-11-zplan-1100-agt-ios"] }) === "2026-11-zplan-1100-sec-web-scoped",
  );
  check(
    "a plan in an earlier month leaves the month base alone",
    scopedAuditId({ since: "2026-10", month: "2026-11", known: ["2026-10", "2026-10-zplan-3100-sec-web"], recorded: ["2026-10", "2026-10-zplan-3100"] }) ===
      "2026-11-scoped",
  );
  check(
    "a plan id alone (no part on disk) is not a part: the month base still applies, and still refuses",
    /would sort before "2026-11-zplan-1100"/.test(
      throws(() => scopedAuditId({ since: "2026-10", month: "2026-11", known: ["2026-10", "2026-11-zplan-1100"], recorded: ["2026-10", "2026-11-zplan-1100"] })),
    ),
  );
  check(
    "a newest id that is not a plan part still refuses as before",
    /would sort before "2026-11-zz"/.test(throws(() => scopedAuditId({ since: "2026-10", month: "2026-11", known: ["2026-10", "2026-11-zz"], recorded: ["2026-10"] }))),
  );
  {
    const input = { ...base, requested: "2026-11-scoped", known: ["2026-10", ...PARTS] };
    const message = throws(() => scopedAuditId(input));
    const suggestion = (/e\.g\. `([^`]+)`/.exec(message ?? "") ?? [])[1];
    check(
      "a refused request after a plan suggests <partId>-scoped, which is accepted",
      /sorts before/.test(message) && suggestion === "2026-11-zplan-1100-sec-web-scoped" && scopedAuditId({ ...input, requested: suggestion }) === suggestion,
      message,
    );
  }
  check(
    "a requested <partId>-scoped is accepted",
    scopedAuditId({ ...base, requested: "2026-11-zplan-1100-sec-web-scoped", known: ["2026-10", ...PARTS] }) === "2026-11-zplan-1100-sec-web-scoped",
  );
}

```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:quality-scope`
Expected: exit 1, crashing on the first new check with ``Error: "2026-11-scoped" would sort before "2026-11-zplan-1100-sec-web", so its scores would lose the latest-wins merge. Name the scoped audit yourself, one that sorts after "2026-11-zplan-1100-sec-web" (e.g. `2026-11-zplan-1100-sec-web-scoped`).``

- [ ] **Step 3: Give the candidates a plan-part base**

In `packages/schema/src/quality-scope.ts`, make four edits.

Replace

```ts
} from "./quality";
```

(the end of the `./quality` import, line 38) with

```ts
} from "./quality";
import { isPlanPartId } from "./quality-plan";
```

In the doc comment of `scopedAuditId`, replace

```ts
 * candidate instead), else opens `<month>-scoped`, then `<month>-scoped-02`
 * and on, the convention SPEC § 6 names.
 */
```

with

```ts
 * candidate instead), else opens `<month>-scoped`, then `<month>-scoped-02`
 * and on, the convention SPEC § 6 names. After a plan in the same month,
 * `<month>-scoped` would sort before the plan's parts, so the candidates start
 * from the newest part instead: `<partId>-scoped`, `<partId>-scoped-02` (see
 * `scopedCandidates`).
 */
```

Replace both call sites — `for (const candidate of scopedCandidates(month)) {` in `scopedAuditId` and in `suggestedAuditId` — with

```ts
  for (const candidate of scopedCandidates(month, known)) {
```

(`known` is already destructured in both functions.)

Replace the generator

```ts
/** `<month>-scoped`, then `<month>-scoped-02` … `-99` — the convention SPEC § 6 names, in the order a new audit takes them. */
function* scopedCandidates(month: string): Generator<string> {
  for (let n = 1; n < 100; n++) yield n === 1 ? `${month}-scoped` : `${month}-scoped-${String(n).padStart(2, "0")}`;
}
```

with

```ts
/**
 * `<base>-scoped`, then `<base>-scoped-02` … `-99` — the convention SPEC § 6
 * names, in the order a new audit takes them.
 *
 * The base is `month`, unless `<month>-scoped` sorts before the newest known id
 * and that id is a plan part, or a scoped re-audit named after one (its stem,
 * minus `-scoped` / `-scoped-NN`, is a plan part). Then the base is that part
 * id: a plan's parts sort after every same-month id by design
 * (`2026-11-zplan-…`), so a month-based candidate could only be refused, and
 * `<partId>-scoped` is the nearest id that sorts after them.
 */
function* scopedCandidates(month: string, known: readonly string[]): Generator<string> {
  const newest = [...known].sort().at(-1) ?? "";
  const stem = newest.replace(/-scoped(-\d+)?$/, "");
  const base = `${month}-scoped` < newest && isPlanPartId(stem) ? stem : month;
  for (let n = 1; n < 100; n++) yield n === 1 ? `${base}-scoped` : `${base}-scoped-${String(n).padStart(2, "0")}`;
}
```

- [ ] **Step 4: Run the tests, then regenerate**

Run: `npm run test:quality-scope && npm run test:quality-events && npm run test:quality-baseline && npx tsc --noEmit -p . && npm run lint`
Expected: `All quality-scope checks passed.` (every pre-existing `scopedAuditId` check still passes: with no plan part known, the base is the month), the hosted-events suite passes, `All checks passed`, no `tsc` or eslint error.

Run: `npm run generate && git status --porcelain`
Expected: besides this task's two edited files, exactly

```
 M plugin-kritik/skills/kritik/scripts/compute-matrix.js
 M plugin-kritik/skills/kritik/scripts/detect-regressions.js
```

Each diff is the minified line(s) with identifiers renamed and the file within a few bytes of its old size. Anything else in the list (in particular `docs/arkaik-skill/scripts/validate-bundle.js`, `plugin/skills/arkaik/…` or `public/schema/project-bundle.json`) is a regression from this part: stop and find it.

Run: `npm run test:kritik-plugin`
Expected: passes — it runs the regenerated scripts as separate Node processes.

- [ ] **Step 5: Commit**

```bash
git add packages/schema/src/quality-scope.ts tests/schema/quality-scope.test.js plugin-kritik/skills/kritik/scripts/compute-matrix.js plugin-kritik/skills/kritik/scripts/detect-regressions.js
git commit -m "feat(kritik): scoped re-audits after a plan are named after its newest part" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Wire the suite into CI and verify the part

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add the CI step**

In `.github/workflows/ci.yml` (`build` job), directly after

```yaml
      - name: Kritik baseline tests (implicit reading, window, scope unlock)
        run: npm run test:quality-baseline
```

insert

```yaml

      # The Kritik planner's pure rules (docs/superpowers/specs/2026-11-11-kritik-planner-design.md):
      # the --run grammar, the cells per part pinned to the shipped pack, plan
      # and part ids that sort after every audit, the partial-id predicates and
      # the plan file's schema. Pure like the five above.
      - name: Kritik plan tests (grammar, cells, sort-last ids, partial ids, schema)
        run: npm run test:quality-plan
```

A plain `run:` line, so shellcheck has nothing to flag.

- [ ] **Step 2: Lint the workflows**

Run: `actionlint`
Expected: no output, exit 0 (CI runs actionlint 1.7.12 over every workflow file in the `build` job; a local `actionlint` from Homebrew reads `.github/workflows/` the same way).

- [ ] **Step 3: Run the part's full gate**

Run each; every one must pass:

```bash
npm run test:quality-plan
npm run test:quality-scope
npm run test:quality-baseline
npm run test:quality
npm run test:quality-events
npm run test:kritik-plugin
npm run test:schema
npm run lint
npx tsc --noEmit -p .
npm run generate && git status --porcelain
```

Expected: the test scripts end on their pass lines; lint and `tsc` report no error; after `npm run generate`, `git status --porcelain` prints only ` M .github/workflows/ci.yml` (the generate step changes nothing that Task 9 did not already commit).

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: run the Kritik plan tests in the build job" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Part done when

All of these pass on `feat/kritik-plan-schema`, from a clean tree:

```bash
npm run test:quality-plan
npm run test:quality-scope
npm run test:quality-baseline
npm run test:quality
npm run test:quality-events
npm run test:kritik-plugin
npm run test:schema
npm run lint
actionlint
npx tsc --noEmit -p .
npm run generate && git status --porcelain   # prints nothing
```

- `plugin-kritik/skills/kritik/scripts/compute-matrix.js` and `detect-regressions.js` are committed as regenerated (renaming only); no other generated artifact moved, no version moved.
- Nothing a user can reach has changed: no command, tool or page reads a plan yet, and no plan record can exist before part 4.
- **PR:** `feat(kritik): plan schema, run grammar and sort-last ids (part 1/4)`, opened with `gh stack` as the bottom of the stack (base `main`), body ending with the attribution line. **No Lab Note** (contract: parts 1 and 3 change nothing a user can reach): add the `no-lab-note` label. After opening, read the PR's comments in case the Lab Note reminder posted anyway.
