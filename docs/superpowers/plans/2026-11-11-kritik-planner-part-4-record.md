# Kritik planner — Part 4: recording a plan — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record a planned partial audit as one reading — `arkaik kritik matrix <planId> --record --plan` and `kritik_matrix plan=true` — through one shared record function, and make every reader of the result honest about it: coverage beside every roll-up, a plan marker on the trend, a plan's parts read as one reading by every `regressions` pairing, and a plan record that is never a scope's anchor.

**Architecture:** `preparePlanRecord` in `packages/schema/src/cli/kritik-plan.ts` reads the plan file, the profile, the parts' `scores.json` and the journal, refuses in the contract's order, and returns the merged section, the merged matrix, the `PlanAuditScope` marker and the `quality.audit.completed` input. It writes nothing; the CLI appends through `reportJournal`, the MCP tool through `record()`. Pure helpers (`coverageOf`, `coverageNotes`, `auditReadings`, `readingOf`) live in `quality-plan.ts`; the trend learns a separate `plan` marker in `quality-trend.ts`. The CLI, the MCP repo branch and the plugin's `detect-regressions.js` all pair readings, not directories.

**Tech Stack:** TypeScript (`@arkaik/schema`, bundled raw into the CLI and MCP by esbuild), plain Node test scripts (`node tests/...`, Node 20 in CI), zod 4 only where the contract allows it.

**Spec:** `docs/superpowers/specs/2026-11-11-kritik-planner-design.md`

**Contract:** `docs/superpowers/plans/2026-11-11-kritik-planner-stack.md` (authoritative over the spec)

**Branch:** `feat/kritik-plan-record`, created with `gh stack` on top of `feat/kritik-plan-scope`.

**Position in the stack:** part 4 of 4, the top. Parts 1 (`feat/kritik-plan-schema`), 2 (`feat/kritik-plan-cli`) and 3 (`feat/kritik-plan-scope`) sit below and are present when this plan runs. All version bumps of the stack happen here. The stack merges as a unit.

---

## Contract deviations

None to a name, a signature or a file owned by another part. Three things this plan does that the contract's part-4 row does not say, each the smallest change that does the job:

1. **`lib/utils/quality.ts` is touched (one function).** The contract lists it under "Must NOT touch" for part 4. The product owner decided open risk 1 the other way: `describeAuditCompleted` gains a branch so a plan record reads in the journal feed as "Planned partial audit of N cells", not as a scoped re-audit (Task 12). Nothing else in `lib/` changes; `lib/services/graph/quality-events.ts` is untouched.
2. **`coverage.surfaces` is part of the event** — the owner accepted open risk 2. Written exactly as the contract's `PlanCoverage` says.
3. **Two MCP messages beyond the contract's MCP list**, for parity with the CLI's "`scope` and `score --scope` with only plan records say why": `kritik_scope`'s `note` and `kritik_score scope=true`'s refusal name the plan-only case (Task 11). Additive; no input or output shape changes.

Behaviour the contract implies and this plan makes explicit:

- **A preview of an already-recorded plan refuses.** `matrix <planId> --plan` and `kritik_matrix plan=true` call `preparePlanRecord`, the one record function, whose second check is "already recorded". The trend shows a recorded plan's reading.
- **`coverageOf` with no profile** (the contract types `profile` as optional) reads the surfaces the assessments name, first seen first.
- **`resolveAuditPair` (private, MCP) changes signature** to take readings. The hosted branch wraps each id as its own reading, so its behaviour and wording are unchanged.

## What this plan relies on from parts 1 to 3

- P1: `quality-plan.ts` exports `planCells`, `planCellKey`, `isPlanId`, `isPlanPartId`, `planIdOfPartId`, `readPlanScope`, the types `KritikPlan`, `KritikPlanCell`, `PlanCoverage`, `PlanAuditScope`, `PlanScopeReading`; `quality-plan.ts` is already re-exported by `index.ts`. P1 does **not** export `coverageOf` (its private helper is `readCoverage`). `tests/schema/quality-plan.test.js` exists, wired as `test:quality-plan`, and defines the house helper `check(name, cond, detail)` with a `failures` counter (every schema suite does). If P1 named the helper differently, use that name in the appended blocks; the assertions do not change.
- P2: `planPartStatuses`, `planRecordCommand`; in `cli/kritik-plan.ts` `loadPlan`, `listPlanIds`; `arkaik kritik plan --run … --counts-only` writes `docs/quality/plans/<planId>.json` and exits 0; `kritik_plan` returns `{ plan, path, written, warnings }`; `test:cli` ends with `&& node tests/cli/kritik-plan.test.js`; `kritik.ts` and `kritik-tools.ts` already import from `@arkaik/schema/src/cli/kritik-plan`.
- P3: `quality-scope.ts` exports `recordedAuditIds` (each plan record's parts follow its plan id), `recordedPlans`, `recordedSinceIds`, `scopeAnchorId`; `deriveAuditScope` implements rules 1 to 7. P3 leaves `declaredScopeSince` calls and the `--since` checks for this part.

Where this plan says "add to the import from X", add each name the line does not already hold; a duplicate import of a name fails `tsc`.

## Traps that apply (each named again in its task)

- **Node 20 in CI.** No test `require`s a `.ts` file: schema code is reached through `tests/schema/load-schema.js`; `cli/kritik-plan.ts` only through the built CLI and MCP.
- **Generated artifacts.** The plugin's `compute-matrix.js` and `detect-regressions.js` bundle `quality-plan.ts` and `quality-scope.ts`; the minifier renames identifiers whenever those sources change, even when the new code is tree-shaken. Every task that edits a `packages/schema/src` module runs `npm run generate`, checks `git status`, and commits what changed with the source. CI's "Fail on generated-artifact drift" step enforces it.
- **Alias tables.** `tests/app/load-quality.js` and `tests/services/load-quality-events.js` rewrite only `@arkaik/schema` (and `@/lib/utils/quality`). Task 12 adds a name to the existing `@arkaik/schema` import only, so neither table changes.
- **Lint and types.** `npm run lint` (eslint; `tests/**` is ignored) and `npx tsc --noEmit -p .` (root tsconfig, `include: **/*.ts`). No workflow file changes, so actionlint has nothing new.
- **Exact counts.** `tests/mcp/run-mcp-tests.js` counts tools: this part adds none. `version.test.js` (CLI and MCP) compares `--version` with `package.json`: rebuild after the bump.
- **Source-asserting suites.** None reads `kritik.ts`, `kritik-tools.ts`, the quality modules or `lib/utils/quality.ts` as text.

---

## File map

**Schema (pure)**
- Modify `packages/schema/src/quality-plan.ts` — `coverageOf`, `coverageNotes`, `AuditReading`, `auditReadings`, `readingOf`.
- Modify `packages/schema/src/quality-ops.ts` — `auditCompletedInput`'s `meta.scope` accepts `PlanAuditScope` (type only).
- Modify `packages/schema/src/quality-trend.ts` — `AuditSnapshot.plan`, `TrendRow.plan`, `scopeOf` skips plan records, deltas gated on the plan's scored cells.

**Schema (fs)**
- Modify `packages/schema/src/cli/kritik-plan.ts` — `PlanRecord`, `preparePlanRecord`.
- Modify `packages/schema/src/cli/kritik-regressions-cli.ts` — pairs readings.

**CLI** — Modify `packages/cli/src/commands/kritik.ts`: `MATRIX_USAGE`, `TREND_USAGE`, `SCOPE_USAGE`, `REGRESSIONS_USAGE`; `printMatrixReport` (extracted), `runPlanMatrix`, `--plan` in `runMatrix` with its refusals, the part-id and plan-id refusals, coverage under every human table, the trend's plan line, `planOnlyScopeNote`, `currentScope`'s anchor guard, `scopedSince` over `recordedSinceIds`, `auditPair` and `runRegressions` over readings.

**MCP** — Modify `packages/mcp/src/kritik-tools.ts`: `kritik_matrix` `plan` input, hosted refusal, plan branch, part-id and plan-id refusals; `resolveAuditPair` over readings; `scopeOf`'s anchor guard; `declaredScopeSince` over `recordedSinceIds`; plan-only messages in `kritik_scope` and `kritik_score`; `kritik_regressions` input descriptions.

**App** — Modify `lib/utils/quality.ts` (`describeAuditCompleted` only).

**Docs** — Modify `docs/kritik-skill/skill.md` (frontmatter `version: 0.8.0`; roll-up coverage, regressions readings, trend plan row, recording the plan), `docs/spec/mcp.md` (`kritik_matrix` and `kritik_regressions` rows).

**Tests**
- Create `tests/cli/kritik-plan-record.test.js`.
- Modify `tests/schema/quality-plan.test.js`, `tests/schema/quality-trend.test.js`, `tests/schema/kritik-plugin.test.js`, `tests/mcp/kritik-tools.test.js`, `tests/app/quality.test.js`.

**Wiring** — Modify `package.json`: append `&& node tests/cli/kritik-plan-record.test.js` to `test:cli`. No change to `.github/workflows/ci.yml` (`test:cli`, `test:mcp`, `test:quality-plan`, `test:quality-trend`, `test:kritik-plugin`, `test:quality-page` already run there).

**Versions** — `packages/cli/package.json` 0.10.0 → 0.11.0, `packages/mcp/package.json` 0.9.0 → 0.10.0, the two matching entries in `package-lock.json`.

**Generated (committed)** — `plugin-kritik/skills/kritik/SKILL.md`, `plugin-kritik/.claude-plugin/plugin.json` (version 0.8.0), `plugin-kritik/skills/kritik/scripts/detect-regressions.js`, and `compute-matrix.js` whenever the minifier renames inside it.

---

### Task 1: `coverageOf` and `coverageNotes`

**Files:**
- Modify: `packages/schema/src/quality-plan.ts`
- Test: `tests/schema/quality-plan.test.js`
- Generated: `plugin-kritik/skills/kritik/scripts/*.js` (whatever `npm run generate` changes)

- [ ] **Step 1: Write the failing test**

Append this block to `tests/schema/quality-plan.test.js`, immediately above the file's final summary lines (the `console.log(...)`/`process.exit(...)` pair):

```js
// --- part 4: coverage, and the recorded scope marker -------------------------
{
  const p4 = require("./load-schema").loadSchema();
  const { coverageOf, coverageNotes, readPlanScope, auditCompletedInput, makeEvent, applicableCells } = p4;
  const p4fs = require("fs");
  const p4path = require("path");
  const sameJson = (a, b) => {
    const sorted = (v) =>
      Array.isArray(v)
        ? v.map(sorted)
        : v !== null && typeof v === "object"
          ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])]))
          : v;
    return JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
  };

  const pack = JSON.parse(p4fs.readFileSync(p4path.join(__dirname, "..", "..", "packages", "kritik-library", "framework.json"), "utf8"));
  const library = { version: pack.version, domains: pack.domains, criteria: pack.criteria };
  const SURFACES = ["web", "ios", "android", "admin", "supabase"];
  const profile = { surfaces: SURFACES.map((id) => ({ id, title: id })) };
  const all = applicableCells(library, SURFACES).flatMap((entry) =>
    entry.surfaces.map((surface) => ({ criterion_id: entry.criterion_id, surface, level: 2 })),
  );
  const per = (surface) => all.filter((a) => a.surface === surface).length;
  const secWeb = ["SEC-01", "SEC-04", "SEC-05", "SEC-06", "SEC-07", "SEC-08"].map((criterion_id) => ({ criterion_id, surface: "web", level: 4 }));

  const full = coverageOf({ profile, assessments: all }, library);
  check("coverageOf: a full audit assesses every applicable cell", full.assessed === 338 && full.applicable === 338 && full.scored === 0, JSON.stringify({ assessed: full.assessed, applicable: full.applicable, scored: full.scored }));
  check(
    "coverageOf: one entry per profile surface, in profile order",
    JSON.stringify(Object.keys(full.surfaces)) === JSON.stringify(SURFACES) && full.surfaces.web.assessed === per("web") && full.surfaces.web.applicable === per("web"),
    JSON.stringify(full.surfaces),
  );

  const sparse = coverageOf({ profile, assessments: secWeb }, library, 6);
  check("coverageOf: a first plan covers its own cells and no more", sparse.scored === 6 && sparse.assessed === 6 && sparse.applicable === 338, JSON.stringify({ scored: sparse.scored, assessed: sparse.assessed, applicable: sparse.applicable }));
  check(
    "coverageOf: web holds 6 of its cells, iOS none of its",
    sparse.surfaces.web.assessed === 6 && sparse.surfaces.web.applicable === per("web") && sparse.surfaces.ios.assessed === 0 && sparse.surfaces.ios.applicable === per("ios"),
    JSON.stringify(sparse.surfaces),
  );

  const noisy = coverageOf(
    {
      profile,
      assessments: [
        ...secWeb,
        secWeb[0],
        { criterion_id: "SEC-02", surface: "web", level: 3 },
        { criterion_id: "X-99", surface: "web", level: 3 },
        { criterion_id: "SEC-01", surface: "cross-surface", level: 3 },
      ],
    },
    library,
  );
  check("coverageOf counts a cell once, and never one that does not apply", noisy.assessed === 6 && noisy.surfaces.web.assessed === 6, JSON.stringify(noisy.surfaces.web));

  const bare = coverageOf({ assessments: [{ criterion_id: "AGT-01", surface: "ios", level: 2 }, { criterion_id: "SEC-01", surface: "web", level: 2 }] }, library);
  check(
    "coverageOf with no profile reads the surfaces its assessments name, first seen first",
    JSON.stringify(Object.keys(bare.surfaces)) === JSON.stringify(["ios", "web"]) && bare.assessed === 2 && bare.applicable === per("ios") + per("web"),
    JSON.stringify(bare),
  );

  const notes = coverageNotes(sparse, { web: 100, ios: null, android: 50 });
  check(
    "coverageNotes: one line per surface not fully looked at, its score or a dash",
    notes.length === 5 &&
      notes[0] === `web 100, from 6 of ${per("web")} cells` &&
      notes[1] === `ios —, from 0 of ${per("ios")} cells` &&
      notes[2] === `android 50, from 0 of ${per("android")} cells` &&
      notes[3] === `admin —, from 0 of ${per("admin")} cells`,
    JSON.stringify(notes),
  );
  check("coverageNotes: nothing to say about a full reading", coverageNotes(full, { web: 50 }).length === 0);

  const planScope = {
    partial: true,
    cells: 2,
    since: "2026-10",
    plan: "2026-11-zplan-1100",
    parts: ["2026-11-zplan-1100-sec-web"],
    scored: ["SEC-01::web", "SEC-04::web"],
    coverage: { scored: 2, assessed: 2, applicable: 338, surfaces: { web: { assessed: 2, applicable: 73 } } },
  };
  const matrix = {
    surfaces: ["web"],
    domains: ["SEC"],
    matrix: { SEC: { web: { score: 100, grade: "A", capped: false, criteria: 2, findings: { critical: 0, high: 0, medium: 0, low: 0 } } } },
    overall: { web: 100 },
    finding_counts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
  };
  const input = auditCompletedInput(matrix, { audit_id: "2026-11-zplan-1100", framework_version: "0.1.0", scope: planScope });
  const stamped = makeEvent(input.type, input.payload, { actor: "test" });
  check("the plan marker survives the event schema whole: parts, scored, coverage", sameJson(stamped.scope, planScope), JSON.stringify(stamped.scope));
  check("and reads back as a plan record", readPlanScope(stamped.scope)?.plan === "2026-11-zplan-1100" && readPlanScope(stamped.scope)?.coverage?.applicable === 338);
}
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test:quality-plan`
Expected: FAIL — the process throws `TypeError: coverageOf is not a function` at the new block (every earlier check still prints PASS).

- [ ] **Step 3: Write the implementation**

In `packages/schema/src/quality-plan.ts`, add to the import from `"./quality"`: `CROSS_SURFACE_ID`, `applicableCells`, `type KritikLibrary`, `type QualityProfile`, `type QualitySection`. Then append at the end of the file (function declarations only, so the top-level rule holds and esbuild can still drop them):

```ts
// --- P4: coverage and readings -------------------------------------------------------------

/**
 * How much of the product a reading actually looked at (spec "A first audit that is a plan").
 *
 * `rollUpSurface` averages the domains that scored and skips the rest, so a surface with only
 * Security scored rolls up to its Security score — which reads as a grade for the whole surface.
 * Coverage is what says otherwise: `assessed` counts the applicable cells holding a score, once
 * each, against `applicable`, every cell the profile's surfaces make applicable. An assessment on a
 * cell that does not apply (a retired or unknown criterion, `cross-surface`, a surface outside the
 * profile) counts nowhere. `scored` is the caller's — the cells a plan re-scored — and 0 for a
 * plain reading.
 *
 * Surfaces are the profile's, in its order; with no profile, those the assessments name, first
 * seen first. Lenient and total like every reader here: a malformed row is skipped.
 */
export function coverageOf(
  section: Pick<QualitySection, "assessments"> & { profile?: Pick<QualityProfile, "surfaces"> | null },
  library: Pick<KritikLibrary, "criteria">,
  scored = 0,
): PlanCoverage {
  const assessments = Array.isArray(section.assessments) ? section.assessments : [];
  const listed = section.profile?.surfaces;
  const surfaces: string[] = [];
  for (const surface of Array.isArray(listed) ? listed : []) {
    const id = surface?.id;
    if (typeof id === "string" && id !== "" && id !== CROSS_SURFACE_ID && !surfaces.includes(id)) surfaces.push(id);
  }
  if (surfaces.length === 0) {
    for (const assessment of assessments) {
      const id = assessment?.surface;
      if (typeof id === "string" && id !== "" && id !== CROSS_SURFACE_ID && !surfaces.includes(id)) surfaces.push(id);
    }
  }

  const perSurface: Record<string, { assessed: number; applicable: number }> = {};
  for (const surface of surfaces) perSurface[surface] = { assessed: 0, applicable: 0 };

  const applicable = new Set<string>();
  for (const entry of applicableCells(library, surfaces)) {
    for (const surface of entry.surfaces) {
      applicable.add(planCellKey(entry.criterion_id, surface));
      perSurface[surface].applicable++;
    }
  }

  const assessed = new Set<string>();
  for (const assessment of assessments) {
    if (typeof assessment?.criterion_id !== "string" || typeof assessment?.surface !== "string") continue;
    const key = planCellKey(assessment.criterion_id, assessment.surface);
    if (!applicable.has(key) || assessed.has(key)) continue;
    assessed.add(key);
    perSurface[assessment.surface].assessed++;
  }

  return { scored, assessed: assessed.size, applicable: applicable.size, surfaces: perSurface };
}

/**
 * The line a roll-up wears when it rests on part of its surface: `web 62, from 6 of 71 cells`, one
 * per surface whose `assessed` is below `applicable`, in `coverage.surfaces` order. The score is
 * the surface's roll-up from `overall`, an em dash when it has none. A fully covered surface says
 * nothing — the plain roll-up is already true.
 */
export function coverageNotes(coverage: PlanCoverage, overall: Readonly<Record<string, number | null>>): string[] {
  const notes: string[] = [];
  const surfaces = coverage.surfaces ?? {};
  for (const surface of Object.keys(surfaces)) {
    const { assessed, applicable } = surfaces[surface];
    if (!(assessed < applicable)) continue;
    const score = overall[surface];
    notes.push(`${surface} ${typeof score === "number" ? score : "—"}, from ${assessed} of ${applicable} cells`);
  }
  return notes;
}
```

- [ ] **Step 4: Run it, type-check, regenerate**

Run: `npm run test:quality-plan`
Expected: PASS, every check including the new ones.

Run: `npx tsc --noEmit -p .` — Expected: no errors.

Run: `npm run generate && git status --porcelain`
Expected: the source and test files above, plus possibly `plugin-kritik/skills/kritik/scripts/compute-matrix.js` and/or `detect-regressions.js` (the minifier renames identifiers when `quality-plan.ts` changes). Nothing else. Then `npm run test:kritik-plugin` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/schema/src/quality-plan.ts tests/schema/quality-plan.test.js plugin-kritik/skills/kritik/scripts
git commit -m "feat(schema): coverageOf and coverageNotes — how much a reading looked at" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `auditReadings` and `readingOf`

**Files:**
- Modify: `packages/schema/src/quality-plan.ts`
- Test: `tests/schema/quality-plan.test.js`
- Generated: `plugin-kritik/skills/kritik/scripts/*.js`

- [ ] **Step 1: Write the failing test**

Append this block below Task 1's block (still above the final summary lines):

```js
// --- part 4: a plan's parts are one reading ----------------------------------
{
  const { auditReadings, readingOf } = require("./load-schema").loadSchema();
  const ids = [
    "2026-08",
    "2026-09-scoped",
    "2026-11-sec-web",
    "2026-11-zplan-1100-agt-ios",
    "2026-11-zplan-1100-sec-web",
    "2026-11-zplan-1100-sec-web-scoped",
    "2026-11-zplan-1101-prv-web",
  ];
  const readings = auditReadings(ids);
  check(
    "auditReadings: a plan's parts are one reading under the plan id; every other id is its own",
    JSON.stringify(readings) ===
      JSON.stringify([
        { id: "2026-08", auditIds: ["2026-08"] },
        { id: "2026-09-scoped", auditIds: ["2026-09-scoped"] },
        { id: "2026-11-sec-web", auditIds: ["2026-11-sec-web"] },
        { id: "2026-11-zplan-1100", auditIds: ["2026-11-zplan-1100-agt-ios", "2026-11-zplan-1100-sec-web"] },
        { id: "2026-11-zplan-1100-sec-web-scoped", auditIds: ["2026-11-zplan-1100-sec-web-scoped"] },
        { id: "2026-11-zplan-1101", auditIds: ["2026-11-zplan-1101-prv-web"] },
      ]),
    JSON.stringify(readings),
  );
  check("readingOf finds a reading by its id", readingOf(readings, "2026-11-zplan-1100")?.auditIds.length === 2);
  check("readingOf finds a plan's reading by any of its part ids", readingOf(readings, "2026-11-zplan-1100-agt-ios")?.id === "2026-11-zplan-1100");
  check("readingOf answers undefined for an id no reading holds", readingOf(readings, "2026-07") === undefined);
  check("auditReadings of nothing is nothing", auditReadings([]).length === 0);
}
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test:quality-plan`
Expected: FAIL — `TypeError: auditReadings is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `packages/schema/src/quality-plan.ts`, below `coverageNotes`:

```ts
/** One reading for `regressions`: a plan's parts under the plan id, any other audit under its own id. */
export interface AuditReading {
  id: string;
  /** The audit directories that make the reading, in the order given (oldest first from `listAuditIds`). */
  auditIds: string[];
}

/**
 * The audits on disk as readings (spec "`regressions` after a plan", decision 14). A plan's parts
 * are scored in parallel and recorded once, so two of them are never two readings: each part id
 * folds into its plan's reading, and every other id — full, scoped, hand-named, a scoped re-audit
 * named after a part — stays its own. Ordered by each reading's first audit id. A reading's state
 * is every audit through its last member, merged latest-wins (`loadQualitySectionThrough`).
 */
export function auditReadings(auditIds: readonly string[]): AuditReading[] {
  const readings: AuditReading[] = [];
  const byId = new Map<string, AuditReading>();
  for (const auditId of auditIds) {
    const id = isPlanPartId(auditId) ? (planIdOfPartId(auditId) ?? auditId) : auditId;
    const existing = byId.get(id);
    if (existing !== undefined) {
      existing.auditIds.push(auditId);
      continue;
    }
    const reading: AuditReading = { id, auditIds: [auditId] };
    byId.set(id, reading);
    readings.push(reading);
  }
  return readings;
}

/** The reading `id` names: a reading id first, else the reading holding `id` as a member. */
export function readingOf(readings: readonly AuditReading[], id: string): AuditReading | undefined {
  return readings.find((reading) => reading.id === id) ?? readings.find((reading) => reading.auditIds.includes(id));
}
```

- [ ] **Step 4: Run it, type-check, regenerate**

Run: `npm run test:quality-plan` — Expected: PASS.
Run: `npx tsc --noEmit -p .` — Expected: no errors.
Run: `npm run generate && git status --porcelain` — Expected: the two files above and possibly plugin scripts; then `npm run test:kritik-plugin` — PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/schema/src/quality-plan.ts tests/schema/quality-plan.test.js plugin-kritik/skills/kritik/scripts
git commit -m "feat(schema): auditReadings — a plan's parts read as one reading" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The trend's plan marker

**Files:**
- Modify: `packages/schema/src/quality-trend.ts`
- Test: `tests/schema/quality-trend.test.js`

- [ ] **Step 1: Write the failing test**

In `tests/schema/quality-trend.test.js`, insert immediately above the final line pair (`console.log(failures === 0 ? "\nAll quality-trend tests OK" …` and `process.exit(…)`):

```js
// --- planned partial audits (kritik planner, part 4) -------------------------
{
  const planScope = (over = {}) => ({
    partial: true,
    cells: 2,
    plan: "2026-11-zplan-1100",
    parts: ["2026-11-zplan-1100-sec-web"],
    scored: ["SEC-01::web", "SEC-04::web"],
    coverage: { scored: 2, assessed: 40, applicable: 338, surfaces: { web: { assessed: 20, applicable: 73 }, ios: { assessed: 20, applicable: 71 } } },
    ...over,
  });
  const events = [
    audit("2026-10", "2026-10-01T00:00:00.000Z", { web: { SEC: 50, PRV: 50 }, ios: { SEC: 50 } }),
    audit("2026-11-zplan-1100", "2026-11-11T00:00:00.000Z", { web: { SEC: 75, PRV: 50 }, ios: { SEC: 60 } }, { scope: planScope({ since: "2026-10" }) }),
    audit("2026-12", "2026-12-01T00:00:00.000Z", { web: { SEC: 75, PRV: 50 }, ios: { SEC: 60 } }),
  ];
  const trend = deriveQualityTrend(events);
  const planned = trend.snapshots[1];
  check(
    "a plan record's snapshot carries the plan marker",
    planned.plan?.plan === "2026-11-zplan-1100" && eq(planned.plan?.parts, ["2026-11-zplan-1100-sec-web"]) && planned.plan?.since === "2026-10" && planned.plan?.coverage?.applicable === 338,
    JSON.stringify(planned.plan),
  );
  check("and never the scoped re-audit marker, even with a since", planned.scope === undefined, JSON.stringify(planned.scope));

  const { rows } = trendRows(trend);
  check("its row carries the plan too", rows[1].plan?.plan === "2026-11-zplan-1100" && rows[1].scope === undefined, JSON.stringify(rows[1]));
  check(
    "its delta is read where it re-scored: web moved",
    rows[1].cells.web.delta !== null && rows[1].cells.web.delta === rows[1].cells.web.score - rows[0].cells.web.score && rows[1].cells.web.delta !== 0,
    JSON.stringify(rows[1].cells),
  );
  check("and nowhere else: iOS, which it never looked at, has no delta", rows[1].cells.ios.score === 60 && rows[1].cells.ios.delta === null, JSON.stringify(rows[1].cells.ios));
  check("the row after a plan compares against it as usual", rows[2].cells.ios.delta === 0 && rows[2].plan === undefined, JSON.stringify(rows[2]));

  const sec = trendRows(trend, { domain: "SEC" }).rows;
  const prv = trendRows(trend, { domain: "PRV" }).rows;
  check("with a domain, one the plan re-scored on a surface keeps its delta", sec[1].cells.web.delta === 25, JSON.stringify(sec[1].cells));
  check("and one it did not re-score there has none", prv[1].cells.web.score === 50 && prv[1].cells.web.delta === null, JSON.stringify(prv[1].cells));

  const first = deriveQualityTrend([audit("2026-11-zplan-1100", "2026-11-11T00:00:00.000Z", { web: { SEC: 75 } }, { scope: planScope() })]);
  check(
    "a first audit that is a plan reads as a plan with no since, never as a full audit",
    first.snapshots[0].plan?.since === null && first.snapshots[0].scope === undefined,
    JSON.stringify(first.snapshots[0]),
  );

  const blank = deriveQualityTrend([
    audit("2026-11-scoped", "2026-11-11T00:00:00.000Z", { web: { SEC: 75 } }, { scope: { partial: true, cells: 3, since: "2026-10", plan: "" } }),
  ]);
  check("an empty plan field is not a plan: the scoped marker stands", blank.snapshots[0].plan === undefined && blank.snapshots[0].scope?.since === "2026-10", JSON.stringify(blank.snapshots[0]));
}
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test:quality-trend`
Expected: FAIL — "a plan record's snapshot carries the plan marker" (no `plan` key), "and never the scoped re-audit marker" (`scope` is `{"since":"2026-10","cells":2}`), "and nowhere else: iOS …" (delta 10).

- [ ] **Step 3: Write the implementation**

In `packages/schema/src/quality-trend.ts`:

Replace the header sentence

```ts
 * Same two disciplines as `quality.ts` and `quality-regressions.ts`: zod-free
 * and fs-free (the runtime imports are `orderEvents` and `rollUpSurface`, both
 * pure), and nothing mutates its input. Lenient and total, too: a malformed
```

with

```ts
 * Same two disciplines as `quality.ts` and `quality-regressions.ts`: zod-free
 * and fs-free (the runtime imports are `orderEvents`, `rollUpSurface`,
 * `domainCodeOf` and `readPlanScope`, all pure), and nothing mutates its
 * input. Lenient and total, too: a malformed
```

Replace the imports

```ts
import { orderEvents, type JournalEvent } from "./journal";
import { rollUpSurface, type FindingSeverity, type QualityMatrix, type QualityProfile } from "./quality";
```

with

```ts
import { orderEvents, type JournalEvent } from "./journal";
import { rollUpSurface, type FindingSeverity, type QualityMatrix, type QualityProfile } from "./quality";
import { domainCodeOf } from "./quality-ops";
import { readPlanScope, type PlanScopeReading } from "./quality-plan";
```

In `interface AuditSnapshot`, after the `scope?: { since: string; cells: number | null };` line, add:

```ts
  /**
   * Present when the event records a planned partial audit (`scope.plan`): the merged reading, with
   * the plan's parts, the cells it re-scored and its coverage. A plan record never carries `scope`,
   * whose `since` would make it read as a scoped re-audit — and without one, as a full audit.
   */
  plan?: PlanScopeReading;
```

Replace `scopeOf`:

```ts
/** The event's scope marker, kept to what a row can show: the audit it followed, and how many cells it re-scored. */
function scopeOf(raw: unknown): { scope: { since: string; cells: number | null } } | undefined {
  if (!isRecord(raw) || typeof raw.since !== "string" || raw.since === "") return undefined;
```

with

```ts
/**
 * The event's scope marker, kept to what a row can show: the audit it followed, and how many cells
 * it re-scored. `undefined` for a plan record, which carries its own marker (`plan`) instead.
 */
function scopeOf(raw: unknown): { scope: { since: string; cells: number | null } } | undefined {
  if (readPlanScope(raw) !== null) return undefined;
  if (!isRecord(raw) || typeof raw.since !== "string" || raw.since === "") return undefined;
```

In `deriveQualityTrend`, replace

```ts
    for (const surface of Object.keys(scores)) overall[surface] = rollUpSurface(scores[surface], weights);
    const snapshot: AuditSnapshot = {
```

with

```ts
    for (const surface of Object.keys(scores)) overall[surface] = rollUpSurface(scores[surface], weights);
    const plan = readPlanScope(event.scope);
    const snapshot: AuditSnapshot = {
```

and replace

```ts
      ...(scopeOf(event.scope) ?? {}),
    };
    byAudit.delete(auditId);
```

with

```ts
      ...(scopeOf(event.scope) ?? {}),
      ...(plan !== null ? { plan } : {}),
    };
    byAudit.delete(auditId);
```

In `interface TrendRow`, after its `scope?: …` line, add:

```ts
  /** Present when the row is a planned partial audit's merged reading; its deltas cover the plan's scored cells only. */
  plan?: PlanScopeReading;
```

Above `export function trendRows(`, add:

```ts
/**
 * Whether a plan record re-scored any cell in this column — with `domain`, any cell of that domain.
 * A plan's point carries the merged matrix, so a column it never looked at only repeats its last
 * reading; its delta is read over the scored cells alone (spec "Trend"). The domain is the scored
 * criterion's id prefix: the event carries no library, and every shipped criterion's domain is it.
 */
function planScored(plan: PlanScopeReading, surface: string, domain: string | undefined): boolean {
  return plan.scored.some((key) => {
    const at = key.lastIndexOf("::");
    if (at <= 0 || key.slice(at + 2) !== surface) return false;
    return domain === undefined || domainCodeOf(key.slice(0, at)) === domain;
  });
}
```

In `trendRows`, replace

```ts
      const delta = snapshot.comparable && score !== null && before !== null ? score - before : null;
```

with

```ts
      const looked = snapshot.plan === undefined || planScored(snapshot.plan, surface, filter.domain);
      const delta = looked && snapshot.comparable && score !== null && before !== null ? score - before : null;
```

and replace

```ts
      ...(snapshot.scope !== undefined ? { scope: snapshot.scope } : {}),
    });
```

with

```ts
      ...(snapshot.scope !== undefined ? { scope: snapshot.scope } : {}),
      ...(snapshot.plan !== undefined ? { plan: snapshot.plan } : {}),
    });
```

- [ ] **Step 4: Run, type-check, regenerate**

Run: `npm run test:quality-trend` — Expected: PASS, including the older baseline/scoped block.
Run: `npm run test:quality-page` — Expected: PASS (the app's trend readers see an extra optional key only).
Run: `npx tsc --noEmit -p .` — Expected: no errors.
Run: `npm run generate && git status --porcelain` — Expected: the two files above only (no plugin script bundles `quality-trend.ts`); commit anything else it lists.

- [ ] **Step 5: Commit**

```bash
git add packages/schema/src/quality-trend.ts tests/schema/quality-trend.test.js
git commit -m "feat(schema): the trend's plan marker, deltas over the plan's scored cells" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Acceptance — record a plan (spec steps 1 to 8)

The spec's eight acceptance steps on a synthetic fixture, through the real CLI entry point, plus every refusal inside the record function. Steps 1 to 3 exercise part 2, step 7 part 3; a failure there is a bug below this part.

**Files:**
- Create: `tests/cli/kritik-plan-record.test.js`
- Modify: `package.json` (`test:cli`)
- Modify: `packages/schema/src/quality-ops.ts` (type), `packages/schema/src/cli/kritik-plan.ts` (`preparePlanRecord`), `packages/cli/src/commands/kritik.ts` (`printMatrixReport`, `runPlanMatrix`, `--plan`)

- [ ] **Step 1: Write the failing test**

Create `tests/cli/kritik-plan-record.test.js`:

```js
#!/usr/bin/env node

/**
 * Recording a planned partial audit — `arkaik kritik matrix <planId> --record --plan`
 * (docs/superpowers/specs/2026-11-11-kritik-planner-design.md, "matrix --record --plan").
 *
 * The spec's eight acceptance steps end to end, every refusal of the record function,
 * the CLI's own refusals around a plan, coverage beside every roll-up, the first audit
 * that is a plan, the scope's anchor guard, and `regressions` reading a plan's parts
 * as one reading.
 *
 * Drives the BUILT CLI (`test:cli` builds it first) in mkdtemp repos against the
 * shipped criteria pack. The fixture is synthetic: a five-surface profile, a full
 * audit's 338 assessments generated from `applicableCells`, findings and part scores
 * written as files. No model is called. TypeScript is reached only through
 * tests/schema/load-schema.js — CI runs Node 20, which cannot require a .ts file.
 */

const { spawnSync } = require("child_process");
const { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } = require("fs");
const { tmpdir } = require("os");
const path = require("path");
const { loadSchema } = require("../schema/load-schema");

const ROOT = path.join(__dirname, "..", "..");
const CLI = path.join(ROOT, "packages", "cli", "dist", "index.js");

if (!existsSync(CLI)) {
  console.error(`CLI not built at ${CLI}. Run \`npm run build -w arkaik\` first.`);
  process.exit(1);
}

const { applicableCells } = loadSchema();
const pack = JSON.parse(readFileSync(path.join(ROOT, "packages", "kritik-library", "framework.json"), "utf8"));
const SURFACES = ["web", "ios", "android", "admin", "supabase"];
/** Every applicable (criterion, surface) pair — a full audit's cells, 338 on the shipped pack. */
const ALL_CELLS = applicableCells(pack, SURFACES).flatMap((entry) => entry.surfaces.map((surface) => [entry.criterion_id, surface]));
const APPLICABLE = Object.fromEntries(SURFACES.map((surface) => [surface, ALL_CELLS.filter(([, s]) => s === surface).length]));
const FULL = "2026-01";

// Plan ids are named for the local day they are made on, the way the CLI names them.
const now = new Date();
const MONTH = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
const DAY = String(now.getDate()).padStart(2, "0");

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`PASS: ${name}`);
  else {
    failures++;
    console.log(`FAIL: ${name}${detail ? `\n${detail}` : ""}`);
  }
}

const BUNDLE = JSON.stringify({
  schema_version: 3,
  project: { id: "demo", title: "Demo", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" },
  nodes: [{ id: "V-home", project_id: "demo", species: "view", title: "Home", status: "live", platforms: ["web"] }],
  edges: [],
});

const dirs = [];
function repo() {
  const dir = mkdtempSync(path.join(tmpdir(), "arkaik-kritik-plan-record-"));
  dirs.push(dir);
  mkdirSync(path.join(dir, "docs", "arkaik"), { recursive: true });
  writeFileSync(path.join(dir, "docs", "arkaik", "bundle.json"), BUNDLE);
  const at = (...parts) => path.join(dir, ...parts);
  const run = (args) => spawnSync(process.execPath, [CLI, "kritik", ...args], { encoding: "utf8", cwd: dir });
  const ok = (args) => {
    const result = run(args);
    if (result.status !== 0) {
      failures++;
      console.log(`FAIL: setup — kritik ${args.join(" ")}\n${result.stderr}${result.stdout}`);
    }
    return result;
  };
  const writeJson = (relative, value) => {
    const target = at(relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
  };
  const writeScores = (auditId, cells, level) =>
    writeJson(`docs/quality/audits/${auditId}/scores.json`, {
      audit_id: auditId,
      framework_version: pack.version,
      assessments: cells.map(([criterion_id, surface]) => ({
        criterion_id,
        surface,
        level,
        evidence: `${criterion_id}.ts:1`,
        audit_id: auditId,
        ts: "2026-01-15T00:00:00.000Z",
      })),
    });
  const journal = () => {
    const file = at("docs", "arkaik", "journal.jsonl");
    return existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
  };
  const findingsText = () => {
    const audits = at("docs", "quality", "audits");
    if (!existsSync(audits)) return "";
    return readdirSync(audits)
      .sort()
      .map((id) => {
        const file = path.join(audits, id, "findings.json");
        return `${id}\n${existsSync(file) ? readFileSync(file, "utf8") : "-"}`;
      })
      .join("\n");
  };
  const plans = () => {
    const folder = at("docs", "quality", "plans");
    return existsSync(folder) ? readdirSync(folder).filter((name) => name.endsWith(".json")).map((name) => name.slice(0, -5)).sort() : [];
  };
  /** A plan made through the real `kritik plan`, read back from the file it wrote. */
  const makePlan = (...runs) => {
    const before = plans();
    ok(["plan", ...runs.flatMap((token) => ["--run", token]), "--counts-only"]);
    const made = plans().filter((id) => !before.includes(id));
    if (made.length !== 1) {
      failures++;
      console.log(`FAIL: setup — kritik plan ${runs.join(" ")} wrote ${made.length} plan files`);
      return { planId: "", parts: [] };
    }
    return JSON.parse(readFileSync(at("docs", "quality", "plans", `${made[0]}.json`), "utf8"));
  };
  const scopeJson = () => {
    try {
      return JSON.parse(run(["scope", "--json"]).stdout);
    } catch {
      return {};
    }
  };
  const scopeKeys = () => (scopeJson().cells ?? []).map((cell) => `${cell.criterion_id}::${cell.surface}`).sort();
  return { dir, at, run, ok, writeJson, writeScores, journal, findingsText, makePlan, scopeJson, scopeKeys };
}

const finding = (id, criterionId, surface) => ({
  id,
  criterion_id: criterionId,
  surface,
  title: `${criterionId} on ${surface}`,
  detail: `${criterionId} on ${surface}`,
  evidence: "x.ts:1",
  impact: 2,
  likelihood: 2,
  cost: "S",
  status: "open",
});

/** A five-surface repo with one full audit recorded and two of its findings resolved after it (spec step 4). */
function auditedRepo() {
  const r = repo();
  r.ok(["profile", ...SURFACES.flatMap((surface) => ["--surface", surface])]);
  r.writeScores(FULL, ALL_CELLS, 2);
  r.writeJson(`docs/quality/audits/${FULL}/findings.json`, {
    audit_id: FULL,
    framework_version: pack.version,
    findings: [
      finding("F-2026-01-SEC-web-01", "SEC-01", "web"),
      finding("F-2026-01-AGT-ios-01", "AGT-01", "ios"),
      finding("F-2026-01-PRV-web-01", "PRV-01", "web"),
    ],
  });
  r.ok(["matrix", FULL, "--record"]);
  r.ok(["finding", "resolve", "F-2026-01-SEC-web-01", "--by", "https://github.com/o/r/pull/1"]);
  r.ok(["finding", "resolve", "F-2026-01-AGT-ios-01", "--by", "https://github.com/o/r/pull/2"]);
  return r;
}

const cellsOf = (part) => (part?.cells ?? []).map((cell) => [cell.criterion_id, cell.surface]);

/** A refusal: exit 1, nothing appended to the journal, and the message says each needle. */
function refuses(target, label, args, needles) {
  const before = target.journal().length;
  const result = target.run(args);
  check(
    `${label}: refused with exit 1, nothing appended`,
    result.status === 1 && target.journal().length === before,
    `status ${result.status}\n${result.stderr}${result.stdout.slice(0, 300)}`,
  );
  for (const needle of needles) check(`${label}: says "${needle}"`, result.stderr.includes(needle), result.stderr);
}

try {
  // === Acceptance: Pebbles, SEC on web (spec "Acceptance", steps 1 to 8) =========

  const a = auditedRepo();
  // Two hand-named audits the part has to sort after (step 2).
  mkdirSync(a.at("docs", "quality", "audits", `${MONTH}-sec-web`), { recursive: true });
  mkdirSync(a.at("docs", "quality", "audits", `${MONTH}-scoped`), { recursive: true });

  // 1. The plan.
  const plan = a.makePlan("SEC:web");
  const planId = plan.planId;
  const part = plan.parts[0] ?? { cells: [] };
  check(
    "1. `plan --run SEC:web --counts-only` writes <YYYY-MM>-zplan-<DD>00.json",
    planId === `${MONTH}-zplan-${DAY}00` && existsSync(a.at("docs", "quality", "plans", `${planId}.json`)),
    planId,
  );
  check(
    "1. one part: 6 cells, 36 steps, included",
    plan.parts.length === 1 && part.cells.length === 6 && part.steps === 36 && part.status === "included",
    JSON.stringify({ cells: part.cells.length, steps: part.steps, status: part.status }),
  );

  // 2. Sort-last.
  const others = readdirSync(a.at("docs", "quality", "audits"));
  check(
    "2. the part id sorts after every audit id, including a hand-named <month>-sec-web and <month>-scoped",
    others.length === 3 && others.every((id) => part.auditId > id),
    `${part.auditId} vs ${others.join(", ")}`,
  );

  // 3. The part's prompt.
  const prompt = part.prompt ?? "";
  const named = [...prompt.matchAll(/^\s+- (\S+) on web: `arkaik kritik score /gm)].map((match) => match[1]).sort();
  check("3. the part prompt names exactly its 6 cells", JSON.stringify(named) === JSON.stringify(part.cells.map((cell) => cell.criterion_id).sort()), JSON.stringify(named));
  check(
    "3. every score line passes --audit <partId>",
    prompt.split("\n").filter((line) => line.includes("kritik score")).every((line) => line.includes(`--audit ${part.auditId}`)),
    prompt,
  );
  check("3. the part prompt never records", !prompt.includes("--record"));

  // 4. The journal holds a resolution on SEC on web and one on AGT on iOS, after the full audit.
  check("4. the scope lists the SEC-on-web and the AGT-on-iOS cells", JSON.stringify(a.scopeKeys()) === JSON.stringify(["AGT-01::ios", "SEC-01::web"]), JSON.stringify(a.scopeKeys()));

  // 5. The part's scores, then the record.
  a.writeScores(part.auditId, cellsOf(part), 4);
  const findingsBefore = a.findingsText();
  const journalBefore = a.journal().length;

  const preview = a.run(["matrix", planId, "--plan"]);
  check(
    "a preview (`matrix <planId> --plan`) prints the plan's reading and writes nothing",
    preview.status === 0 &&
      preview.stdout.includes(`planned partial audit ${planId}: 6 cells re-scored in 1 part since ${FULL}`) &&
      a.journal().length === journalBefore &&
      !existsSync(a.at("docs", "quality", "audits", planId)),
    preview.stderr + preview.stdout.slice(-600),
  );

  const recorded = a.run(["matrix", planId, "--record", "--plan"]);
  check("5. `matrix <planId> --record --plan` records", recorded.status === 0, recorded.stderr + recorded.stdout.slice(-400));
  const appended = a.journal().slice(journalBefore);
  const event = appended[0] ?? {};
  check(
    "5. exactly one event, a quality.audit.completed under the plan id",
    appended.length === 1 && event.type === "quality.audit.completed" && event.audit_id === planId,
    JSON.stringify(appended.map((e) => [e.type, e.audit_id])),
  );
  check("5. the record writes no audit directory for the plan", !existsSync(a.at("docs", "quality", "audits", planId)));

  // 6. The event.
  const scope = event.scope ?? {};
  check("6. scope.partial is true and scope.plan is the plan id", scope.partial === true && scope.plan === planId, JSON.stringify(scope).slice(0, 300));
  check(
    "6. scope.scored holds the 6 cells and scope.parts the one part",
    scope.cells === 6 &&
      JSON.stringify([...(scope.scored ?? [])].sort()) === JSON.stringify(part.cells.map((cell) => `${cell.criterion_id}::web`).sort()) &&
      JSON.stringify(scope.parts) === JSON.stringify([part.auditId]),
    JSON.stringify(scope).slice(0, 400),
  );
  check("6. since is the full audit the plan followed", scope.since === FULL, String(scope.since));
  check(
    "6. coverage: 6 re-scored, every applicable cell assessed",
    scope.coverage?.scored === 6 &&
      scope.coverage?.assessed === ALL_CELLS.length &&
      scope.coverage?.applicable === ALL_CELLS.length &&
      scope.coverage?.surfaces?.web?.applicable === APPLICABLE.web,
    JSON.stringify(scope.coverage).slice(0, 300),
  );
  check(
    "6. the recorded matrix is the merged one: SEC on web at the part's 100, every other cell at its last score",
    event.scores?.web?.SEC === 100 && event.scores?.ios?.SEC === 50 && Object.keys(event.scores ?? {}).length === SURFACES.length,
    JSON.stringify(event.scores?.web),
  );
  check("6. so its web composite is not the 6-cell score", Object.values(event.scores?.web ?? {}).some((score) => score !== 100), JSON.stringify(event.scores?.web));

  // 7. Findings untouched; the window closed per cell.
  check("7. no finding changed status", a.findingsText() === findingsBefore);
  check("7. AGT on iOS is still listed and SEC on web is not", JSON.stringify(a.scopeKeys()) === JSON.stringify(["AGT-01::ios"]), JSON.stringify(a.scopeKeys()));
  check("7. the scope is still measured from the full audit", a.scopeJson().since === FULL, String(a.scopeJson().since));

  // 8. The same sequence through today's workaround, in a second repo.
  const b = auditedRepo();
  check("8. the second repo starts from the same scope", JSON.stringify(b.scopeKeys()) === JSON.stringify(["AGT-01::ios", "SEC-01::web"]), JSON.stringify(b.scopeKeys()));
  const handNamed = `${MONTH}-sec-web`;
  b.writeScores(handNamed, cellsOf(part), 4);
  b.ok(["matrix", handNamed, "--record", "--scope"]);
  check(
    "8. `matrix <id> --record --scope` drops the AGT-on-iOS cell from the scope: the trap",
    b.scopeJson().since === handNamed && !b.scopeKeys().includes("AGT-01::ios"),
    JSON.stringify(b.scopeJson()).slice(0, 300),
  );

  // === Every refusal of the record function exits 1 and appends nothing =========

  const r = auditedRepo();
  const rPlan = r.makePlan("SEC:web");
  const rPart = rPlan.parts[0] ?? { cells: [] };
  const rCells = cellsOf(rPart);
  const recordArgs = ["matrix", rPlan.planId, "--record", "--plan"];

  refuses(r, "a part with no directory", recordArgs, [
    "6 plan cells have no score yet",
    `${rPart.auditId}: no audit directory in this checkout`,
    "another worktree",
    `plan --status ${rPlan.planId}`,
  ]);
  r.writeScores(rPart.auditId, rCells.slice(0, 3), 3);
  refuses(r, "plan cells with no score", recordArgs, [
    "3 plan cells have no score yet",
    `${rPart.auditId}: ${rCells.slice(3).map(([criterion]) => `${criterion} on web`).join(", ")}`,
  ]);
  r.writeScores(rPart.auditId, [...rCells, ["PRV-01", "web"]], 3);
  refuses(r, "a score outside the plan", recordArgs, ["1 score outside plan", `${rPart.auditId}: PRV-01 on web`]);
  r.writeScores(rPart.auditId, rCells, 3);

  const planFile = r.at("docs", "quality", "plans", `${rPlan.planId}.json`);
  const planText = readFileSync(planFile, "utf8");
  writeFileSync(planFile, JSON.stringify({ ...rPlan, frameworkVersion: "0.0.1" }, null, 2));
  refuses(r, "a framework that moved since the plan", recordArgs, ["the cells have moved", "0.0.1", "--run SEC:web"]);
  writeFileSync(planFile, JSON.stringify({ ...rPlan, parts: [{ ...rPart, cells: rPart.cells.slice(1) }] }, null, 2));
  refuses(r, "cells that moved since the plan", recordArgs, ["the cells have moved", `SEC:web gained ${rPart.cells[0]?.criterion_id}`]);
  writeFileSync(planFile, planText);

  const broken = `${MONTH}-zplan-3198`;
  r.writeJson(`docs/quality/plans/${broken}.json`, { schema: "arkaik.kritik.plan/9" });
  refuses(r, "a plan file that fails the schema", ["matrix", broken, "--record", "--plan"], [`${broken}.json`]);
  rmSync(r.at("docs", "quality", "plans", `${broken}.json`));
  refuses(r, "a plan file that is not there", ["matrix", `${MONTH}-zplan-3199`, "--record", "--plan"], ["no plan at"]);

  const rBefore = r.journal().length;
  r.ok(recordArgs);
  check("once every check holds, the plan records", r.journal().length === rBefore + 1);
  refuses(r, "a plan already recorded", recordArgs, ["already recorded", "make a new plan", "--run SEC:web"]);

  // ── later sections are inserted above this line ──
} finally {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nAll kritik plan-record checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
```

In `package.json`, append ` && node tests/cli/kritik-plan-record.test.js` to the end of the `test:cli` value (after part 2's `&& node tests/cli/kritik-plan.test.js`).

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run build -w arkaik && node tests/cli/kritik-plan-record.test.js`
Expected: steps 1 to 4 PASS (parts 2 and 3); the preview and step 5 FAIL with `kritik: --plan needs a value` (the flag is unknown to `collect`), so steps 6 and 7's event checks FAIL; step 8 PASSES; every record refusal FAILS on its needles.

- [ ] **Step 3: Write the implementation**

**3a. `packages/schema/src/quality-ops.ts`** — add after the `import type { EventInput } from "./derive";` line:

```ts
import type { PlanAuditScope } from "./quality-plan";
```

and change `auditCompletedInput`'s `meta` type from

```ts
  meta: { audit_id: string; framework_version: string; commit?: string; scope?: AuditCompletedScope },
```

to

```ts
  meta: { audit_id: string; framework_version: string; commit?: string; scope?: AuditCompletedScope | PlanAuditScope },
```

Add one paragraph at the end of its doc comment (before ` */`):

```ts
 *
 * A **planned partial audit** passes a `PlanAuditScope` (`cli/kritik-plan.ts`'s
 * `preparePlanRecord`), with the merged matrix through the plan's last part, under
 * the plan id: the same "where does the product stand", plus which cells it re-scored.
```

(Type-only import: `quality-ops.ts` stays zod-free and adds no runtime import.)

**3b. `packages/schema/src/cli/kritik-plan.ts`** — add these imports, merging names into part 2's existing import lines from the same modules:

```ts
import type { EventInput } from "../derive";
import type { JournalEvent } from "../journal";
import { deriveQualityMatrix, type KritikLibrary, type QualityAssessment, type QualityMatrix, type QualitySection } from "../quality";
import { auditCompletedInput } from "../quality-ops";
import {
  coverageOf,
  planCellKey,
  planCells,
  planPartStatuses,
  type KritikPlan,
  type KritikPlanCell,
  type PlanAuditScope,
} from "../quality-plan";
import { recordedAuditIds, recordedPlans, scopeAnchorId } from "../quality-scope";
import { listAuditIds, loadQualitySectionThrough, loadScoresOrEmpty, requireProfile } from "./kritik-audit";
```

Append to the end of the file:

```ts
// --- P4: recording a plan ------------------------------------------------------------------

/** Everything a plan's record needs, and nothing written: the caller appends `input` through its own path. */
export interface PlanRecord {
  plan: KritikPlan;
  section: QualitySection;
  matrix: QualityMatrix;
  scope: PlanAuditScope;
  input: EventInput;
}

const cellLabel = (cell: KritikPlanCell): string => `${cell.criterion_id} on ${cell.surface}`;
const runFlags = (parts: Pick<KritikPlan, "parts">["parts"]): string => parts.map((part) => `--run ${part.domain}:${part.surface}`).join(" ");

/**
 * The one record function (spec "`matrix --record --plan`"), behind both
 * `arkaik kritik matrix <planId> --record --plan` and `kritik_matrix plan=true`.
 *
 * It reads the plan file, the profile, the parts' `scores.json` and the given journal events,
 * and throws `Error` at the first refusal, in this order: the plan file is missing or invalid;
 * the plan is already recorded; its cells or framework version moved since it was made; a part
 * holds a score outside its cells (refused, not ignored — the merge reads every audit directory,
 * so a stray score would enter the matrix anyway); a plan cell has no score. Then it builds the
 * merged reading through the plan's last part (`loadQualitySectionThrough`, latest-wins), the
 * `PlanAuditScope` marker — `since` from the newest non-plan record, omitted on a first audit —
 * and the `quality.audit.completed` input under the plan id.
 *
 * Recording never resolves, reopens or opens a finding; nothing here touches one.
 */
export function preparePlanRecord(root: string, planId: string, library: KritikLibrary, events: readonly JournalEvent[]): PlanRecord {
  // 1. The plan file: throws "no plan at <path>" or "<path>: <issue>".
  const plan = loadPlan(root, planId);

  // 2. Once per plan. The journal is append-only; a correction is a new plan.
  if (recordedPlans(events).some((recorded) => recorded.plan === planId) || recordedAuditIds(events).includes(planId)) {
    throw new Error(
      `plan "${planId}" is already recorded — its reading is history, and the journal is append-only. ` +
        `To correct it, make a new plan for the same parts (\`arkaik kritik plan ${runFlags(plan.parts)}\`) and record that one.`,
    );
  }

  const included = plan.parts.filter((part) => part.status === "included");
  if (included.length === 0) {
    throw new Error(`plan "${planId}" includes no part — every part was deferred, so there is nothing to record.`);
  }

  // 3. The cells as the library and the profile make them now, against the plan's, as sets.
  const surfaces = (requireProfile(root).surfaces ?? []).map((surface) => surface.id);
  const moved: string[] = [];
  if (plan.frameworkVersion !== library.version) {
    moved.push(`the framework is ${library.version} now, and the plan was made against ${plan.frameworkVersion}`);
  }
  for (const part of included) {
    const now = planCells(library, surfaces, { domain: part.domain, surface: part.surface }).cells;
    const was = new Set(part.cells.map((cell) => planCellKey(cell.criterion_id, cell.surface)));
    const is = new Set(now.map((cell) => planCellKey(cell.criterion_id, cell.surface)));
    const added = now.filter((cell) => !was.has(planCellKey(cell.criterion_id, cell.surface)));
    const removed = part.cells.filter((cell) => !is.has(planCellKey(cell.criterion_id, cell.surface)));
    const changes: string[] = [];
    if (added.length > 0) changes.push(`gained ${added.map((cell) => cell.criterion_id).join(", ")}`);
    if (removed.length > 0) changes.push(`lost ${removed.map((cell) => cell.criterion_id).join(", ")}`);
    if (changes.length > 0) moved.push(`${part.domain}:${part.surface} ${changes.join(" and ")}`);
  }
  if (moved.length > 0) {
    throw new Error(
      `the cells have moved since plan "${planId}" was made — ${moved.join("; ")}. ` +
        `Make a new plan: \`arkaik kritik plan ${runFlags(included)}\`.`,
    );
  }

  // 4 and 5. Each part scored exactly its cells.
  const onDisk = new Set(listAuditIds(root));
  const scoresByPart: Record<string, QualityAssessment[]> = {};
  for (const part of included) scoresByPart[part.auditId] = loadScoresOrEmpty(root, part.auditId).assessments;
  const statuses = planPartStatuses({ parts: included }, scoresByPart);

  const strays = statuses.filter((status) => status.stray.length > 0);
  if (strays.length > 0) {
    const count = strays.reduce((sum, status) => sum + status.stray.length, 0);
    throw new Error(
      `${count} score${count === 1 ? "" : "s"} outside plan "${planId}" — the merge reads every audit directory, ` +
        `so ${count === 1 ? "it" : "they"} would enter the recorded matrix anyway. ` +
        `Remove ${count === 1 ? "it" : "them"} from the part's scores.json, or make a plan that includes ${count === 1 ? "it" : "them"}:\n` +
        strays.map((status) => `  ${status.auditId}: ${status.stray.map(cellLabel).join(", ")}`).join("\n"),
    );
  }

  const unscored = statuses.filter((status) => status.missing.length > 0);
  if (unscored.length > 0) {
    const count = unscored.reduce((sum, status) => sum + status.missing.length, 0);
    throw new Error(
      `${count} plan cell${count === 1 ? " has" : "s have"} no score yet — a plan records once, after every part is scored ` +
        `(\`arkaik kritik plan --status ${planId}\`):\n` +
        unscored
          .map((status) =>
            onDisk.has(status.auditId)
              ? `  ${status.auditId}: ${status.missing.map(cellLabel).join(", ")}`
              : `  ${status.auditId}: no audit directory in this checkout — if this part ran in another worktree, ` +
                `copy or merge its docs/quality/audits/${status.auditId}/ here first`,
          )
          .join("\n"),
    );
  }

  // The merged reading through the plan's last part, and its marker.
  const last = included.map((part) => part.auditId).sort()[included.length - 1];
  const section = loadQualitySectionThrough(root, last, library);
  const matrix = deriveQualityMatrix({ quality: section }, library);
  const scored = included.flatMap((part) => part.cells.map((cell) => planCellKey(cell.criterion_id, cell.surface)));
  const since = scopeAnchorId(events);
  const scope: PlanAuditScope = {
    partial: true,
    cells: scored.length,
    ...(since !== null ? { since } : {}),
    plan: plan.planId,
    parts: included.map((part) => part.auditId),
    scored,
    coverage: coverageOf(section, library, scored.length),
  };
  const input = auditCompletedInput(matrix, {
    audit_id: plan.planId,
    framework_version: plan.frameworkVersion,
    commit: plan.commit ?? undefined,
    scope,
  });
  return { plan, section, matrix, scope, input };
}
```

**3c. `packages/cli/src/commands/kritik.ts`** — add `planRecordCommand` and `type QualityMatrix` to the import from `"@arkaik/schema"`; add `preparePlanRecord` and `type PlanRecord` to part 2's import from `"@arkaik/schema/src/cli/kritik-plan"`.

Extract the human report. Above `function runMatrix(`, add:

```ts
/** The human matrix report: the table, the open findings by severity and lane, and the P0 shortlist. */
function printMatrixReport(section: QualitySection, matrix: QualityMatrix, library: KritikLibrary): void {
  const domainNames = new Map((library.domains ?? []).map((d) => [d.code, d.name]));
  console.log(`\n${renderMatrixMarkdown(matrix, domainNames)}\n`);

  const open = section.findings.filter(isOpenFinding);
  const lanes: Record<string, number> = { P0: 0, P1: 0, P2: 0, P3: 0 };
  for (const finding of open) lanes[priorityOf(finding, library)]++;
  const counts = matrix.finding_counts;
  console.log(
    `${section.assessments.length} assessments · ${open.length} open findings ` +
      `(${counts.critical} critical, ${counts.high} high, ${counts.medium} medium, ${counts.low} low)\n` +
      `lanes: P0 ${lanes.P0} · P1 ${lanes.P1} · P2 ${lanes.P2} · P3 ${lanes.P3}`,
  );

  const p0 = open.filter((finding) => priorityOf(finding, library) === "P0");
  if (p0.length > 0) {
    console.log(`\nP0 — fix first:`);
    for (const finding of p0) {
      console.log(`  [${severityOf(finding, library)}] ${finding.surface} · ${finding.id} — ${finding.title}`);
    }
  }
}

/**
 * `matrix <planId> --plan [--record]` — a planned partial audit, read and, with --record,
 * recorded as one reading (spec "matrix --record --plan"). Every check is
 * `preparePlanRecord`'s, shared with `kritik_matrix plan=true`; what lives here is printing
 * and the journal write. Nothing goes to disk but the journal: a plan has no audit directory.
 */
function runPlanMatrix(planId: string, flags: Set<string>, common: CommonOptions, library: KritikLibrary): void {
  const record = flags.has("record");
  const journal = resolveJournal(common.root, common.bundlePath);
  const events = journal.present ? readFullJournalEvents(journal.journalPath) : [];
  let prepared: PlanRecord;
  try {
    prepared = preparePlanRecord(common.root, planId, library, events);
  } catch (error) {
    return fail(`kritik: ${(error as Error).message}`);
  }
  const { plan, section, matrix, scope } = prepared;
  const parts = scope.parts.length;

  if (flags.has("json")) {
    console.log(
      JSON.stringify(
        {
          audit_id: plan.planId,
          ...(plan.commit !== null ? { commit: plan.commit } : {}),
          framework_version: plan.frameworkVersion,
          matrix: matrix.matrix,
          overall: matrix.overall,
          finding_counts: matrix.finding_counts,
          scope,
        },
        null,
        2,
      ),
    );
  } else {
    printMatrixReport(section, matrix, library);
    console.log(
      `\nplanned partial audit ${plan.planId}: ${scope.cells} cell${scope.cells === 1 ? "" : "s"} re-scored in ${parts} part${parts === 1 ? "" : "s"}` +
        (scope.since !== undefined ? ` since ${scope.since}` : ", with no full audit before it") +
        `. The table is the merged reading through the plan's last part — every other cell at its last score.` +
        (record ? "" : `\nNothing written. Record it: \`${planRecordCommand(plan.planId)}\``),
    );
  }
  if (record) reportJournal(common.root, [prepared.input], common);
  console.log("");
  process.exit(0);
}
```

In `runMatrix`, replace

```ts
  const { flags, positionals } = collect(args, [], ["json", "record", "scope"]);
  if (flags.has("help")) {
    console.log(MATRIX_USAGE);
    process.exit(0);
  }

  const library = loadLibraryOrFail(common.root);
  let auditId: string;
```

with

```ts
  const { flags, positionals } = collect(args, [], ["json", "record", "scope", "plan"]);
  if (flags.has("help")) {
    console.log(MATRIX_USAGE);
    process.exit(0);
  }

  const library = loadLibraryOrFail(common.root);
  if (flags.has("plan")) {
    const planId = positionals[0];
    if (planId === undefined) return fail(`kritik: --plan needs the plan id — \`arkaik kritik matrix <planId> --record --plan\`.`);
    return runPlanMatrix(planId, flags, common, library);
  }
  let auditId: string;
```

and replace the human branch's opening

```ts
  } else {
    const domainNames = new Map((library.domains ?? []).map((d) => [d.code, d.name]));
    console.log(`\n${renderMatrixMarkdown(matrix, domainNames)}\n`);

    const open = section.findings.filter(isOpenFinding);
    const lanes: Record<string, number> = { P0: 0, P1: 0, P2: 0, P3: 0 };
    for (const finding of open) lanes[priorityOf(finding, library)]++;
    const counts = matrix.finding_counts;
    console.log(
      `${section.assessments.length} assessments · ${open.length} open findings ` +
        `(${counts.critical} critical, ${counts.high} high, ${counts.medium} medium, ${counts.low} low)\n` +
        `lanes: P0 ${lanes.P0} · P1 ${lanes.P1} · P2 ${lanes.P2} · P3 ${lanes.P3}`,
    );

    const p0 = open.filter((finding) => priorityOf(finding, library) === "P0");
    if (p0.length > 0) {
      console.log(`\nP0 — fix first:`);
      for (const finding of p0) {
        console.log(`  [${severityOf(finding, library)}] ${finding.surface} · ${finding.id} — ${finding.title}`);
      }
    }
    console.log(`\nwrote ${matrixPath(common.root, auditId)}`);
```

with

```ts
  } else {
    printMatrixReport(section, matrix, library);
    console.log(`\nwrote ${matrixPath(common.root, auditId)}`);
```

The plain report prints byte-for-byte what it printed before.

- [ ] **Step 4: Run it, then the neighbours, types, lint, generated artifacts**

Run: `npm run build -w arkaik && node tests/cli/kritik-plan-record.test.js`
Expected: every check PASS.

Run: `node tests/cli/kritik.test.js && node tests/cli/kritik-scope.test.js` — Expected: PASS (the plain report is unchanged).
Run: `npx tsc --noEmit -p .` and `npm run lint` — Expected: clean.
Run: `npm run generate && git status --porcelain` — Expected: only this task's files, plus any plugin script it lists (commit those).

- [ ] **Step 5: Commit**

```bash
git add tests/cli/kritik-plan-record.test.js package.json packages/schema/src/quality-ops.ts packages/schema/src/cli/kritik-plan.ts packages/cli/src/commands/kritik.ts plugin-kritik
git commit -m "feat(kritik): record a plan — matrix <planId> --record --plan" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The CLI's own refusals around a plan

**Files:**
- Modify: `packages/cli/src/commands/kritik.ts` (`MATRIX_USAGE`, `runMatrix`)
- Test: `tests/cli/kritik-plan-record.test.js`

- [ ] **Step 1: Write the failing test**

Insert immediately above `  // ── later sections are inserted above this line ──`:

```js
  // === The CLI's own refusals around a plan ======================================

  refuses(a, "recording a part id directly", ["matrix", part.auditId, "--record"], [`is one part of plan "${planId}"`, `arkaik kritik matrix ${planId} --record --plan`]);
  refuses(a, "recording the newest audit when it is a part", ["matrix", "--record"], [`arkaik kritik matrix ${planId} --record --plan`]);
  refuses(a, "declaring a part scoped", ["matrix", part.auditId, "--scope"], [`is one part of plan "${planId}"`]);
  refuses(a, "a plan id without --plan", ["matrix", planId], ["is a plan, not an audit", `arkaik kritik matrix ${planId} --plan`]);
  refuses(a, "--plan with --scope", ["matrix", planId, "--plan", "--scope"], ["cannot be combined"]);
  refuses(a, "--plan with no plan id", ["matrix", "--plan"], ["--plan needs the plan id", planId]);
  refuses(a, "--plan with a part id", ["matrix", part.auditId, "--plan"], [`is one part of plan "${planId}"`, `arkaik kritik matrix ${planId} --record --plan`]);
  refuses(a, "--record --plan with --no-journal", ["matrix", planId, "--record", "--plan", "--no-journal"], ["--no-journal"]);
  const partTable = a.run(["matrix", part.auditId]);
  check("a part's own table still prints: only recording or declaring it is refused", partTable.status === 0, partTable.stderr);

  const nb = repo();
  nb.ok(["profile", ...SURFACES.flatMap((surface) => ["--surface", surface])]);
  const nbPlan = nb.makePlan("SEC:web");
  rmSync(nb.at("docs", "arkaik", "bundle.json"));
  refuses(nb, "--record --plan with no journal to append to", ["matrix", nbPlan.planId, "--record", "--plan"], ["needs a journal", "no bundle at"]);
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run build -w arkaik && node tests/cli/kritik-plan-record.test.js`
Expected: FAIL — "recording a part id directly" exits 0 and appends a `quality.audit.completed` under the part id; "a plan id without --plan" fails with `no scores.json at …`; "--plan with --scope" and "--record --plan with --no-journal" fail with "already recorded"; "--plan with no plan id" lacks the plan list; "--plan with a part id" says `no plan at …`; the no-journal case says "6 plan cells have no score yet".

- [ ] **Step 3: Write the implementation**

In `packages/cli/src/commands/kritik.ts`, add `isPlanId`, `isPlanPartId`, `planIdOfPartId` to the `"@arkaik/schema"` import and `listPlanIds` to the `"@arkaik/schema/src/cli/kritik-plan"` import.

Replace the whole `MATRIX_USAGE` constant with:

```ts
const MATRIX_USAGE = `arkaik kritik matrix [audit-id] [--json] [--record] [--scope]
arkaik kritik matrix <plan-id> --plan [--record] [--json]

Roll one audit up into its comparative matrix and write matrix.json — the only
thing that may write that file.

  audit-id          The audit under docs/quality/audits/ (default: the newest).
  --json            Print matrix.json instead of the markdown table.
  --record          Also append quality.audit.completed, carrying these scores
                    and counts. Do this once per finished audit.
  --scope           Treat the audit as a scoped re-audit even though it was
                    scored without \`score --scope\` (which marks it for you).
  --plan            The id is a plan from \`arkaik kritik plan\`: read the merged
                    matrix through its last part, writing nothing; with --record,
                    append it as one quality.audit.completed under the plan id.
                    Refused unless every part scored exactly its cells, and
                    never with --scope.

A scoped re-audit holds only the cells it re-scored, so matrix.json shows just
those ("how did this audit go"), while --record carries the merged matrix
through this audit ("where does the product stand") — the reading the trend
replays. Everything else keeps its last score.

A plan records once, as a whole: a part's own id is refused with --record or
--scope. Under every table, a coverage line names each surface whose roll-up
rests on fewer cells than apply to it: "web 62, from 6 of 73 cells".`;
```

In `runMatrix`, replace part 4's provisional block

```ts
  if (flags.has("plan")) {
    const planId = positionals[0];
    if (planId === undefined) return fail(`kritik: --plan needs the plan id — \`arkaik kritik matrix <planId> --record --plan\`.`);
    return runPlanMatrix(planId, flags, common, library);
  }
```

with

```ts
  if (flags.has("plan")) {
    const planId = positionals[0];
    if (flags.has("scope")) {
      return fail(`kritik: --plan and --scope cannot be combined — a plan records its own scope marker, measured from the newest full or scoped audit.`);
    }
    if (planId === undefined) {
      const plans = listPlanIds(common.root);
      return fail(
        `kritik: --plan needs the plan id — \`arkaik kritik matrix <planId> --record --plan\` ` +
          `(plans: ${plans.join(", ") || "none — `arkaik kritik plan` makes one"}).`,
      );
    }
    if (isPlanPartId(planId)) {
      const owner = planIdOfPartId(planId) ?? planId;
      return fail(`kritik: "${planId}" is one part of plan "${owner}" — pass the plan id: \`arkaik kritik matrix ${owner} --record --plan\`.`);
    }
    if (flags.has("record")) {
      if (!common.journal) {
        return fail(`kritik: --record --plan appends the plan's reading to the journal, and --no-journal says not to — drop one of them.`);
      }
      const journal = resolveJournal(common.root, common.bundlePath);
      if (!journal.present) {
        return fail(
          `kritik: --record --plan needs a journal, and there is no bundle at ${journal.bundlePath} — ` +
            `a plan's reading exists only as its quality.audit.completed.`,
        );
      }
    }
    return runPlanMatrix(planId, flags, common, library);
  }
```

Then, right after the `try { auditId = positionals[0] ?? newestAuditId(common.root); } catch …` block and before `let computed: ReturnType<typeof computeAuditMatrix>;`, insert:

```ts
  if (isPlanId(auditId)) {
    return fail(
      `kritik: "${auditId}" is a plan, not an audit — pass --plan: \`arkaik kritik matrix ${auditId} --plan\` previews its merged reading, ` +
        `\`arkaik kritik matrix ${auditId} --record --plan\` records it.`,
    );
  }
  if (isPlanPartId(auditId) && (flags.has("record") || flags.has("scope"))) {
    const owner = planIdOfPartId(auditId) ?? auditId;
    return fail(
      `kritik: "${auditId}" is one part of plan "${owner}" — a plan records once, as a whole, and carries its own scope marker: ` +
        `\`arkaik kritik matrix ${owner} --record --plan\`.`,
    );
  }
```

- [ ] **Step 4: Run it**

Run: `npm run build -w arkaik && node tests/cli/kritik-plan-record.test.js` — Expected: PASS.
Run: `node tests/cli/kritik.test.js && node tests/cli/kritik-scope.test.js` — Expected: PASS.
Run: `npx tsc --noEmit -p .` and `npm run lint` — Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/kritik.ts tests/cli/kritik-plan-record.test.js
git commit -m "feat(kritik): refuse recording a plan part, a bare plan id, and --plan's conflicting flags" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Coverage beside every roll-up, and the first audit that is a plan

**Files:**
- Modify: `packages/cli/src/commands/kritik.ts` (`printMatrixReport`, `runTrend`, `TREND_USAGE`)
- Test: `tests/cli/kritik-plan-record.test.js`

- [ ] **Step 1: Write the failing test**

Insert above the `// ── later sections …` marker:

```js
  // === Coverage beside every roll-up, and the first audit that is a plan =========

  const fullTable = a.run(["matrix", FULL]);
  check("a full audit's table carries no coverage lines", fullTable.status === 0 && !fullTable.stdout.includes("coverage —"), fullTable.stdout.slice(-400));

  const aTrend = a.run(["trend"]);
  check("trend marks the plan's row", aTrend.status === 0 && aTrend.stdout.includes(`planned partial audit: 6 cells re-scored in 1 part since ${FULL}`), aTrend.stdout);
  const aRows = JSON.parse(a.run(["trend", "--json"]).stdout || "{}").rows ?? [];
  check("trend --json carries the plan marker, not a scope marker", aRows[1]?.plan?.plan === planId && aRows[1]?.scope === undefined, JSON.stringify(aRows[1]).slice(0, 300));
  check(
    "its delta moves only where the plan looked: web compared, iOS not",
    aRows[1]?.cells?.web?.delta !== null && aRows[1]?.cells?.web?.delta === aRows[1]?.cells?.web?.score - aRows[0]?.cells?.web?.score && aRows[1]?.cells?.ios?.delta === null,
    JSON.stringify(aRows[1]?.cells),
  );

  const c = repo();
  c.ok(["profile", ...SURFACES.flatMap((surface) => ["--surface", surface])]);
  const cPlan = c.makePlan("SEC:web");
  const cPart = cPlan.parts[0] ?? { cells: [] };
  c.writeScores(cPart.auditId, cellsOf(cPart), 3);
  const webLine = new RegExp(`web \\d+, from 6 of ${APPLICABLE.web} cells`);
  const iosLine = `ios —, from 0 of ${APPLICABLE.ios} cells`;

  const cPreview = c.run(["matrix", cPlan.planId, "--plan"]);
  check(
    "first audit as a plan: the preview prints coverage beside the roll-ups",
    cPreview.status === 0 && cPreview.stdout.includes("coverage —") && webLine.test(cPreview.stdout) && cPreview.stdout.includes(iosLine),
    cPreview.stderr + cPreview.stdout.slice(-800),
  );
  check(
    "and says no full audit came before it",
    cPreview.stdout.includes(`planned partial audit ${cPlan.planId}: 6 cells re-scored in 1 part, with no full audit before it`),
    cPreview.stdout.slice(-400),
  );

  const cRecorded = c.run(["matrix", cPlan.planId, "--record", "--plan"]);
  const cEvent = c.journal().filter((e) => e.type === "quality.audit.completed").at(-1) ?? {};
  check("first audit as a plan records", cRecorded.status === 0 && cEvent.audit_id === cPlan.planId, cRecorded.stderr);
  check("its record has no since", cEvent.scope !== undefined && !("since" in cEvent.scope), JSON.stringify(cEvent.scope).slice(0, 200));
  check(
    "its coverage: 6 scored, 6 assessed, 338 applicable",
    cEvent.scope?.coverage?.scored === 6 && cEvent.scope?.coverage?.assessed === 6 && cEvent.scope?.coverage?.applicable === ALL_CELLS.length,
    JSON.stringify(cEvent.scope?.coverage).slice(0, 300),
  );
  check(
    "per surface: web 6 of its cells, iOS none of its",
    cEvent.scope?.coverage?.surfaces?.web?.assessed === 6 &&
      cEvent.scope?.coverage?.surfaces?.web?.applicable === APPLICABLE.web &&
      cEvent.scope?.coverage?.surfaces?.ios?.assessed === 0 &&
      cEvent.scope?.coverage?.surfaces?.ios?.applicable === APPLICABLE.ios,
    JSON.stringify(cEvent.scope?.coverage?.surfaces),
  );
  check("the record prints its coverage too", webLine.test(cRecorded.stdout), cRecorded.stdout.slice(-600));

  const cPartTable = c.run(["matrix", cPart.auditId]);
  check("a part's own table carries coverage", cPartTable.status === 0 && webLine.test(cPartTable.stdout), cPartTable.stdout.slice(-600));

  const cTrend = c.run(["trend"]);
  check(
    "trend prints the plan line and its coverage lines",
    cTrend.status === 0 &&
      cTrend.stdout.includes("planned partial audit: 6 cells re-scored in 1 part — no full audit before it") &&
      webLine.test(cTrend.stdout) &&
      cTrend.stdout.includes(iosLine),
    cTrend.stdout,
  );
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run build -w arkaik && node tests/cli/kritik-plan-record.test.js`
Expected: FAIL — "trend marks the plan's row", every coverage-line check, and "trend prints the plan line …". The `--json` trend checks and the record checks PASS (Task 3 and Task 4).

- [ ] **Step 3: Write the implementation**

In `packages/cli/src/commands/kritik.ts`, add `coverageNotes` and `coverageOf` to the `"@arkaik/schema"` import.

In `printMatrixReport`, replace

```ts
  console.log(`\n${renderMatrixMarkdown(matrix, domainNames)}\n`);

  const open = section.findings.filter(isOpenFinding);
```

with

```ts
  console.log(`\n${renderMatrixMarkdown(matrix, domainNames)}\n`);

  // A roll-up averages the domains that scored, so on a sparse reading it reads as
  // a grade for a whole surface it never looked at; the coverage line says so.
  const notes = coverageNotes(coverageOf(section, library), matrix.overall);
  if (notes.length > 0) {
    console.log(`coverage — a roll-up reads only the cells that hold a score:`);
    for (const note of notes) console.log(`  ${note}`);
    console.log("");
  }

  const open = section.findings.filter(isOpenFinding);
```

In `runTrend`, replace

```ts
    if (row.scope) {
      console.log(`  ${"".padEnd(widths[0])}   scoped re-audit of ${row.scope.cells ?? "?"} cell(s) since ${row.scope.since}`);
    }
```

with

```ts
    if (row.scope) {
      console.log(`  ${"".padEnd(widths[0])}   scoped re-audit of ${row.scope.cells ?? "?"} cell(s) since ${row.scope.since}`);
    }
    if (row.plan) {
      const parts = row.plan.parts.length;
      console.log(
        `  ${"".padEnd(widths[0])}   planned partial audit: ${row.plan.cells ?? "?"} cell${row.plan.cells === 1 ? "" : "s"} ` +
          `re-scored in ${parts} part${parts === 1 ? "" : "s"}` +
          (row.plan.since !== null ? ` since ${row.plan.since}` : " — no full audit before it"),
      );
      if (row.plan.coverage !== null) {
        const shown = {
          ...row.plan.coverage,
          surfaces: Object.fromEntries(Object.entries(row.plan.coverage.surfaces ?? {}).filter(([surface]) => surfaces.includes(surface))),
        };
        for (const note of coverageNotes(shown, trend.snapshots[index].overall)) {
          console.log(`  ${"".padEnd(widths[0])}   ${note}`);
        }
      }
    }
```

Replace the end of `TREND_USAGE`

```ts
bump between two audits breaks the comparison there (SPEC § 8): the row still
prints, without an arrow.`;
```

with

```ts
bump between two audits breaks the comparison there (SPEC § 8): the row still
prints, without an arrow.

A planned partial audit's row says so — "planned partial audit: 6 cells
re-scored in 1 part since 2026-08" — moves its arrows only where the plan
re-scored, and lists each surface it did not fully cover: "web 62, from 6 of
73 cells".`;
```

- [ ] **Step 4: Run it**

Run: `npm run build -w arkaik && node tests/cli/kritik-plan-record.test.js` — Expected: PASS.
Run: `node tests/cli/kritik.test.js && node tests/cli/kritik-scope.test.js` — Expected: PASS (a sparse scoped table now prints coverage lines; no existing check asserts their absence).
Run: `npx tsc --noEmit -p .` and `npm run lint` — Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/kritik.ts tests/cli/kritik-plan-record.test.js
git commit -m "feat(kritik): coverage beside every roll-up in matrix and trend" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The scope's anchor guard, and an empty scope that says why

**Files:**
- Modify: `packages/cli/src/commands/kritik.ts` (`SCOPE_USAGE`, `planOnlyScopeNote`, `currentScope`, `runScope`, `runScore`, `scopedSince`)
- Test: `tests/cli/kritik-plan-record.test.js`

- [ ] **Step 1: Write the failing test**

Insert above the `// ── later sections …` marker:

```js
  // === The scope's anchor guard, and an empty scope that says why ================

  refuses(a, "a plan id as --since", ["scope", "--since", planId], ["is a plan record, never a scope's anchor", `recorded: ${FULL}`]);
  refuses(a, "a part id as --since", ["scope", "--since", part.auditId], ["never a scope's anchor"]);

  const later = `${MONTH}-zz-later`;
  a.writeScores(later, [["SEC-04", "ios"]], 3);
  const declared = a.run(["matrix", later, "--scope"]);
  check(
    "a hand-declared scoped audit after a plan is measured from the full audit, never the plan or its part",
    declared.status === 0 && declared.stdout.includes(`since ${FULL}`) && !declared.stdout.includes(`since ${part.auditId}`) && !declared.stdout.includes(`since ${planId}`),
    declared.stderr + declared.stdout.slice(-400),
  );

  const cScope = c.run(["scope"]);
  check(
    "with only plan records, scope says why it is empty",
    cScope.status === 0 && cScope.stdout.includes("only plan records") && cScope.stdout.includes(cPlan.planId) && cScope.stdout.includes("never what a scope is measured from"),
    cScope.stdout,
  );
  check("and its JSON carries the same note", (c.scopeJson().note ?? "").includes("only plan records"), JSON.stringify(c.scopeJson()).slice(0, 300));
  refuses(c, "score --scope with only plan records", ["score", "SEC-01", "web", "3", "--evidence", "x.ts:1", "--scope"], ["only plan records", "never what a scope is measured from"]);

  // A recorded plan's parts are recorded audits for every writer (part 3's recordedAuditIds).
  const intoPart = a.run(["score", "SEC-01", "web", "3", "--evidence", "x.ts:1", "--audit", part.auditId]);
  check("a plain score into a recorded part warns that it rewrites a recorded reading", intoPart.status === 0 && intoPart.stdout.includes(`${part.auditId} is already recorded`), intoPart.stdout + intoPart.stderr);
  refuses(a, "a recorded part as a scoped re-audit's target", ["score", "AGT-01", "ios", "3", "--evidence", "x.ts:1", "--scope", "--audit", part.auditId], ["already recorded"]);
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run build -w arkaik && node tests/cli/kritik-plan-record.test.js`
Expected: FAIL — `scope --since <planId>` exits 0 with an empty scope; the declared audit prints `since <partId>`; the plan-only scope prints "no recorded audit yet"; `score --scope` says "needs a recorded audit". The two recorded-part checks PASS already (part 3).

- [ ] **Step 3: Write the implementation**

In `packages/cli/src/commands/kritik.ts`, add `recordedPlans` and `recordedSinceIds` to the `"@arkaik/schema"` import.

In `scopedSince`, replace

```ts
    return declaredScopeSince(auditId, recordedAuditIds(readFullJournalEvents(journal.journalPath)));
```

with

```ts
    // A plan record is never what a scoped audit followed: only full and scoped records count.
    return declaredScopeSince(auditId, recordedSinceIds(readFullJournalEvents(journal.journalPath)));
```

Above `function currentScope(`, add:

```ts
/**
 * Why a scope is empty when the journal holds plan records and nothing else (spec "A first audit
 * that is a plan"): a plan record is never a scope's anchor, so until a full audit is recorded a
 * fix is re-checked by running its part again in a new plan.
 */
function planOnlyScopeNote(plans: readonly string[]): string {
  return (
    `only plan records are in this journal (${plans.join(", ")}) — a plan record is never what a scope is measured from. ` +
    `Until a full audit is recorded, re-check a fix by running its plan part again: \`arkaik kritik plan --run <DOMAIN:SURFACE>\`, then record that plan.`
  );
}
```

Replace `currentScope`'s signature line

```ts
): { scope: AuditScope; journalPath: string; recorded: string[] } {
```

with

```ts
): { scope: AuditScope; journalPath: string; recorded: string[]; plans: string[] } {
```

and replace its since check

```ts
  const events = readFullJournalEvents(journal.journalPath);
  const recorded = recordedAuditIds(events);

  if (options.since !== undefined) {
    if (!recorded.includes(options.since)) {
      fail(
        `kritik: no recorded audit "${options.since}" in ${journal.journalPath} ` +
          `(recorded: ${recorded.join(", ") || "none — `arkaik kritik matrix --record` writes one"}).\n` +
          `A scope is measured from a recorded reading; an audit directory that was never recorded is not one.`,
      );
    }
  }
```

with

```ts
  const events = readFullJournalEvents(journal.journalPath);
  const recorded = recordedAuditIds(events);
  const sinceIds = recordedSinceIds(events);
  const plans = recordedPlans(events).map((plan) => plan.plan);

  if (options.since !== undefined) {
    const since = options.since;
    if (isPlanId(since) || isPlanPartId(since) || (recorded.includes(since) && !sinceIds.includes(since))) {
      fail(
        `kritik: "${since}" is a plan record, never a scope's anchor — a scope is measured from a full or scoped audit ` +
          `(recorded: ${sinceIds.join(", ") || "none yet — `arkaik kritik matrix --record` writes one"}).`,
      );
    }
    if (!sinceIds.includes(since)) {
      fail(
        `kritik: no recorded audit "${since}" in ${journal.journalPath} ` +
          `(recorded: ${sinceIds.join(", ") || "none — `arkaik kritik matrix --record` writes one"}).\n` +
          `A scope is measured from a recorded reading; an audit directory that was never recorded is not one.`,
      );
    }
  }
```

and its return

```ts
  return { scope: deriveAuditScope(events, section, library, options), journalPath: journal.journalPath, recorded };
```

with

```ts
  return { scope: deriveAuditScope(events, section, library, options), journalPath: journal.journalPath, recorded, plans };
```

In `runScore`, replace

```ts
    const { scope, recorded } = currentScope(common, library, profile);
    if (scope.since === null) {
      fail(`kritik: --scope needs a recorded audit to measure from — \`arkaik kritik matrix --record\` writes one.`);
    }
```

with

```ts
    const { scope, recorded, plans } = currentScope(common, library, profile);
    if (scope.since === null) {
      fail(
        plans.length > 0
          ? `kritik: --scope needs a full or scoped audit to measure from, and ${planOnlyScopeNote(plans)}`
          : `kritik: --scope needs a recorded audit to measure from — \`arkaik kritik matrix --record\` writes one.`,
      );
    }
```

In `runScope`, replace

```ts
  const { scope } = currentScope(common, library, profile, {
```

with

```ts
  const { scope, plans } = currentScope(common, library, profile, {
```

replace

```ts
    console.log(JSON.stringify({ ...scope, summary: scopeSummary(scope) }, null, 2));
```

with

```ts
    console.log(
      JSON.stringify(
        { ...scope, summary: scopeSummary(scope), ...(scope.since === null && plans.length > 0 ? { note: `No full audit recorded yet: ${planOnlyScopeNote(plans)}` } : {}) },
        null,
        2,
      ),
    );
```

and replace

```ts
  if (scope.since === null) {
    console.log(
      `\n  no recorded audit yet — a scope is measured from one. \`arkaik kritik matrix --record\` writes it.\n`,
    );
    process.exit(0);
  }
```

with

```ts
  if (scope.since === null) {
    console.log(
      plans.length > 0
        ? `\n  no full audit recorded yet: ${planOnlyScopeNote(plans)}\n`
        : `\n  no recorded audit yet — a scope is measured from one. \`arkaik kritik matrix --record\` writes it.\n`,
    );
    process.exit(0);
  }
```

In `SCOPE_USAGE`, replace

```
  --since <audit>   Measure from this recorded audit (default: the newest
                    quality.audit.completed in the journal).
```

with

```
  --since <audit>   Measure from this recorded audit (default: the newest
                    quality.audit.completed that is not a plan's). A plan
                    record is never what a scope is measured from.
```

- [ ] **Step 4: Run it**

Run: `npm run build -w arkaik && node tests/cli/kritik-plan-record.test.js` — Expected: PASS.
Run: `node tests/cli/kritik.test.js && node tests/cli/kritik-scope.test.js` — Expected: PASS (no plan record there, so every message is as before).
Run: `npx tsc --noEmit -p .` and `npm run lint` — Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/kritik.ts tests/cli/kritik-plan-record.test.js
git commit -m "feat(kritik): a plan record is never a scope's anchor, and an empty scope says why" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: `regressions` reads a plan's parts as one reading (CLI)

**Files:**
- Modify: `packages/cli/src/commands/kritik.ts` (`REGRESSIONS_USAGE`, `auditPair`, `runRegressions`)
- Test: `tests/cli/kritik-plan-record.test.js`

- [ ] **Step 1: Write the failing test**

Insert above the `// ── later sections …` marker:

```js
  // === regressions reads a plan's parts as one reading ===========================

  const g = auditedRepo();
  const g1 = g.makePlan("SEC:web");
  g.writeScores(g1.parts[0]?.auditId, cellsOf(g1.parts[0]), 4);
  const g2 = g.makePlan("AGT:ios", "SEC:ios");
  const [agtIos, secIos] = g2.parts;
  g.writeScores(agtIos?.auditId, cellsOf(agtIos), 1); // AGT on iOS drops from 2 to 1
  g.writeScores(secIos?.auditId, cellsOf(secIos), 2);

  const pair = g.run(["regressions", "--json"]);
  const pairJson = JSON.parse(pair.stdout || "{}");
  check(
    "regressions defaults to the newest plan against the reading before it, never two parts of one plan",
    pairJson.from === g1.planId && pairJson.to === g2.planId,
    JSON.stringify({ from: pairJson.from, to: pairJson.to }) + pair.stderr,
  );
  check(
    "and finds the drop one of the plan's parts scored",
    pair.status === 1 && (pairJson.regressions ?? []).some((x) => x.kind === "level-drop" && x.criterion_id === "AGT-01" && x.surface === "ios"),
    pair.stdout.slice(0, 400),
  );
  const byPart = JSON.parse(g.run(["regressions", "--to", agtIos?.auditId, "--json"]).stdout || "{}");
  check("--to naming a part resolves to its plan", byPart.to === g2.planId && byPart.from === g1.planId, JSON.stringify({ from: byPart.from, to: byPart.to }));
  refuses(g, "two parts of one plan as --from and --to", ["regressions", "--from", agtIos?.auditId, "--to", secIos?.auditId], ["name the same audit", g2.planId]);
  const earlier = g.run(["regressions", "--from", FULL, "--to", g1.planId, "--json"]);
  check("the full audit against the first plan: nothing regressed", earlier.status === 0 && JSON.parse(earlier.stdout || "{}").total === 0, earlier.stdout.slice(0, 300) + earlier.stderr);
  const unknownId = g.run(["regressions", "--from", "nope"]);
  check("an unknown id lists the readings", unknownId.status === 1 && unknownId.stderr.includes(`have: ${FULL}, ${g1.planId}, ${g2.planId}`), unknownId.stderr);
  refuses(c, "regressions with one plan and nothing before it", ["regressions"], [`only "${cPlan.planId}" exists`]);
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run build -w arkaik && node tests/cli/kritik-plan-record.test.js`
Expected: FAIL — the default pair is the two parts of `g2` (`from` is `…-agt-ios`), `--to <part>` names the part, the same-plan pair is compared rather than refused, the `have:` list names directories, and the first-audit repo says `only "<partId>" exists`.

- [ ] **Step 3: Write the implementation**

In `packages/cli/src/commands/kritik.ts`, add `auditReadings`, `readingOf` and `type AuditReading` to the `"@arkaik/schema"` import.

Replace the whole `auditPair` function with:

```ts
/** The audit directory a reading's state runs through: its last member. */
const lastAuditOf = (reading: AuditReading): string => reading.auditIds[reading.auditIds.length - 1];

/**
 * The two readings to compare, or a refusal saying why there is no pair. A plan's parts are one
 * reading (`auditReadings`): ids accepted are reading ids or member ids, the default `to` is the
 * last reading and the default `from` the one before.
 */
function auditPair(root: string, from?: string, to?: string): { from: AuditReading; to: AuditReading } {
  const readings = auditReadings(listAuditIds(root));
  if (readings.length < 2) {
    fail(
      `kritik: regressions needs two audits to compare — ` +
        `${readings.length === 0 ? "docs/quality/audits/ holds none" : `only "${readings[0].id}" exists`}.\n` +
        `A regression is the difference between two readings; one reading is a baseline.`,
    );
  }
  const known = (id: string): AuditReading => {
    const reading = readingOf(readings, id);
    if (reading === undefined) {
      return fail(`kritik: no audit "${id}" under docs/quality/audits/ (have: ${readings.map((r) => r.id).join(", ")})`);
    }
    return reading;
  };
  const newer = to === undefined ? readings[readings.length - 1] : known(to);
  const older = from === undefined ? readings[readings.indexOf(newer) - 1] : known(from);
  if (older === undefined) {
    fail(`kritik: "${newer.id}" is the oldest audit — there is nothing before it to compare against.`);
  }
  if (older === newer) {
    fail(`kritik: --from and --to name the same audit ("${newer.id}") — a regression needs two readings.`);
  }
  // Order is the whole verdict: `detectRegressions` reads its first argument as
  // the EARLIER reading, so a hand-swapped pair reports a clean run where a real
  // regression exists — a false green in the CI step this verb exists to be.
  if (readings.indexOf(older) > readings.indexOf(newer)) {
    fail(`kritik: --from "${older.id}" is newer than --to "${newer.id}" — swap them, or the comparison inverts.`);
  }
  return { from: older, to: newer };
}
```

In `runRegressions`, replace

```ts
  const { from, to } = auditPair(common.root, single.from, single.to);
```

with

```ts
  const pair = auditPair(common.root, single.from, single.to);
  const from = pair.from.id;
  const to = pair.to.id;
```

and replace

```ts
      loadQualitySectionThrough(common.root, from, library),
      loadQualitySectionThrough(common.root, to, library),
```

with

```ts
      loadQualitySectionThrough(common.root, lastAuditOf(pair.from), library),
      loadQualitySectionThrough(common.root, lastAuditOf(pair.to), library),
```

In `REGRESSIONS_USAGE`, replace

```
  --from <audit>    The older reading (default: the audit before --to).
  --to <audit>      The newer reading (default: the newest on disk).
```

with

```
  --from <audit>    The older reading (default: the reading before --to).
  --to <audit>      The newer reading (default: the newest on disk).
                    A plan's parts are one reading: a plan id, or any of its
                    part ids, names the state through the plan's last part.
```

- [ ] **Step 4: Run it**

Run: `npm run build -w arkaik && node tests/cli/kritik-plan-record.test.js` — Expected: PASS.
Run: `node tests/cli/kritik.test.js && node tests/cli/kritik-scope.test.js` — Expected: PASS (no plan parts there; every reading is one directory, so pairs and wording are unchanged).
Run: `npx tsc --noEmit -p .` and `npm run lint` — Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/kritik.ts tests/cli/kritik-plan-record.test.js
git commit -m "feat(kritik): regressions reads a plan's parts as one reading" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: `detect-regressions.js` reads a plan as one reading

**Files:**
- Modify: `packages/schema/src/cli/kritik-regressions-cli.ts`
- Test: `tests/schema/kritik-plugin.test.js`
- Generated: `plugin-kritik/skills/kritik/scripts/detect-regressions.js` (and any other script the minifier touches)

- [ ] **Step 1: Write the failing test**

In `tests/schema/kritik-plugin.test.js`, insert immediately after the main block's closing

```js
} finally {
  fs.rmSync(repo, { recursive: true, force: true });
}
```

and before the final `console.log(failures === 0 ? …`:

```js
// --- detect-regressions.js reads a plan's parts as one reading -----------------
{
  const planned = fs.mkdtempSync(path.join(os.tmpdir(), "kritik-plan-readings-"));
  try {
    const write = (relative, value) => {
      const target = path.join(planned, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, JSON.stringify(value));
    };
    write("docs/quality/profile.json", fixture.section.profile);
    write("docs/quality/audits/2026-08/scores.json", { audit_id: "2026-08", framework_version: fixture.section.framework_version, assessments: fixture.section.assessments });
    write("docs/quality/audits/2026-08/findings.json", { audit_id: "2026-08", findings: fixture.section.findings });
    const plan = "2026-09-zplan-0100";
    const part = (id, criterionId, surface, level) =>
      write(`docs/quality/audits/${id}/scores.json`, {
        audit_id: id,
        framework_version: fixture.section.framework_version,
        assessments: [{ criterion_id: criterionId, surface, level, evidence: "x.ts:1", audit_id: id, ts: "2026-09-01T00:00:00.000Z" }],
      });
    part(`${plan}-agt-ios`, "AGT-01", "ios", 2); // unchanged
    part(`${plan}-sec-web`, "SEC-01", "web", 1); // 2 -> 1: a level drop

    const byDefault = runReportingExit("detect-regressions.js", ["--root", planned, "--json"], planned);
    const parsed = JSON.parse(byDefault.stdout || "{}");
    check("detect-regressions compares a plan's parts as one reading against the reading before it", parsed.from === "2026-08" && parsed.to === plan, `${byDefault.stdout.slice(0, 200)}${byDefault.stderr}`);
    check(
      "and reports the drop one of its parts scored",
      byDefault.status === 1 && (parsed.regressions ?? []).some((r) => r.kind === "level-drop" && r.criterion_id === "SEC-01" && r.surface === "web"),
      byDefault.stdout.slice(0, 300),
    );
    const byPart = JSON.parse(runReportingExit("detect-regressions.js", ["--root", planned, "--to", `${plan}-agt-ios`, "--json"], planned).stdout || "{}");
    check("a part id given as --to reads its whole plan", byPart.to === plan && byPart.from === "2026-08", JSON.stringify({ from: byPart.from, to: byPart.to }));
    const sameReading = runExpectingFailure("detect-regressions.js", ["--root", planned, "--from", `${plan}-agt-ios`, "--to", `${plan}-sec-web`], planned);
    check("two parts of one plan are the same reading, refused", sameReading !== null && sameReading.includes(`("${plan}")`), sameReading ?? "");
  } finally {
    fs.rmSync(planned, { recursive: true, force: true });
  }
}
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test:kritik-plugin`
Expected: FAIL on the four new checks — the committed script pairs the two part directories (`from` is `2026-09-zplan-0100-agt-ios`).

- [ ] **Step 3: Write the implementation**

In `packages/schema/src/cli/kritik-regressions-cli.ts`, add after the `import { detectRegressions, … } from "../quality-regressions";` line:

```ts
import { auditReadings, readingOf, type AuditReading } from "../quality-plan";
```

Replace, in `main()`, everything from `  const audits = listAuditIds(root);` through the inverted-order guard's closing `}` with:

```ts
  // A plan's parts are scored apart and recorded once, so they are one reading:
  // the same pairing `arkaik kritik regressions` and `kritik_regressions` make.
  const readings = auditReadings(listAuditIds(root));
  if (readings.length < 2) {
    return die(
      `detect-regressions: needs two audits to compare — ` +
        `${readings.length === 0 ? "docs/quality/audits/ holds none" : `only "${readings[0].id}" exists`}.`,
    );
  }
  // An unknown id and "there is nothing older" are different refusals and must
  // read differently — folding them together names the wrong audit and hides
  // what the repo actually holds. The CLI verb and the MCP tool say the same
  // two things; a third wording here is how three entry points drift apart.
  const known = (id: string, flag: string): AuditReading => {
    const reading = readingOf(readings, id);
    if (reading === undefined) {
      return die(`detect-regressions: no audit "${id}" for ${flag} (have: ${readings.map((r) => r.id).join(", ")})`);
    }
    return reading;
  };
  const toReading = requestedTo === undefined ? readings[readings.length - 1] : known(requestedTo, "--to");
  const fromReading = requestedFrom === undefined ? readings[readings.indexOf(toReading) - 1] : known(requestedFrom, "--from");
  if (fromReading === undefined) {
    return die(`detect-regressions: "${toReading.id}" is the oldest audit — there is nothing before it to compare against.`);
  }
  if (fromReading === toReading) return die(`detect-regressions: --from and --to name the same audit ("${toReading.id}")`);
  // Order is the whole verdict: `detectRegressions` reads its first argument as
  // the earlier reading, so a hand-swapped pair would silently report a clean
  // run where a real regression exists — a false green in CI.
  if (readings.indexOf(fromReading) > readings.indexOf(toReading)) {
    return die(`detect-regressions: --from "${fromReading.id}" is newer than --to "${toReading.id}" — swap them, or the comparison inverts.`);
  }
  const from = fromReading.id;
  const to = toReading.id;
  const lastAuditOf = (reading: AuditReading): string => reading.auditIds[reading.auditIds.length - 1];
```

and replace

```ts
      loadQualitySectionThrough(root, from, library),
      loadQualitySectionThrough(root, to, library),
```

with

```ts
      loadQualitySectionThrough(root, lastAuditOf(fromReading), library),
      loadQualitySectionThrough(root, lastAuditOf(toReading), library),
```

- [ ] **Step 4: Regenerate and run**

Trap: the test reads the **committed** script, so it passes only after the generator rebuilds it.

Run: `npm run generate && git status --porcelain`
Expected: `packages/schema/src/cli/kritik-regressions-cli.ts`, `tests/schema/kritik-plugin.test.js`, `plugin-kritik/skills/kritik/scripts/detect-regressions.js`, possibly `compute-matrix.js`. Nothing else.

Run: `npm run test:kritik-plugin` — Expected: PASS, including "detect-regressions.js bundles to a zero-dependency artifact".
Run: `npx tsc --noEmit -p .` and `npm run lint` — Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/schema/src/cli/kritik-regressions-cli.ts tests/schema/kritik-plugin.test.js plugin-kritik/skills/kritik/scripts
git commit -m "feat(kritik-plugin): detect-regressions.js reads a plan's parts as one reading" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: `kritik_matrix plan=true`, and the part-id refusal over MCP

**Files:**
- Modify: `packages/mcp/src/kritik-tools.ts`
- Test: `tests/mcp/kritik-tools.test.js`

- [ ] **Step 1: Write the failing test**

In `tests/mcp/kritik-tools.test.js`, change the requires at the top:

```js
const { spawn } = require("child_process");
```

to

```js
const { spawn, spawnSync } = require("child_process");
```

```js
const { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("fs");
```

to

```js
const { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("fs");
```

and below `const SERVER = …;` add:

```js
// test:mcp builds the CLI first; the plan-record parity check runs it in a twin checkout.
const CLI = path.join(ROOT, "packages", "cli", "dist", "index.js");
```

Insert this block immediately before the line `  // --- hosted mode -------------------------------------------------------------`:

```js
  // --- a planned partial audit (repo mode) ------------------------------------
  //
  // kritik_matrix plan=true is `arkaik kritik matrix <planId> --record --plan`
  // over MCP — one preparePlanRecord behind both, so one event. The parity check
  // records the same plan with the CLI in a twin copied just before the MCP record.

  const planned = startSession();
  const twin = mkdtempSync(path.join(tmpdir(), "arkaik-mcp-kritik-twin-"));
  try {
    await planned.request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "kritik-test", version: "0" } });
    const made = await planned.call("kritik_plan", { runs: ["SEC:web"] });
    const plan = made.json.plan ?? { parts: [] };
    const planId = plan.planId;
    const part = plan.parts[0] ?? { cells: [] };
    check("kritik_plan writes the plan kritik_matrix records", !made.isError && made.json.written === true && typeof planId === "string", made.text.slice(0, 300));
    for (const cell of part.cells) {
      await planned.call("kritik_score", { criterion_id: cell.criterion_id, surface: cell.surface, level: 3, evidence: `${cell.criterion_id}.ts:1`, audit_id: part.auditId });
    }
    const before = planned.journal().length;

    const partRecord = await planned.call("kritik_matrix", { audit_id: part.auditId, record: true });
    check(
      "kritik_matrix refuses to record a plan part on its own, and points to the plan",
      partRecord.isError && partRecord.json.message.includes(`"${planId}"`) && partRecord.json.message.includes("plan=true") && planned.journal().length === before,
      partRecord.text.slice(0, 300),
    );
    const bare = await planned.call("kritik_matrix", { audit_id: planId });
    check("a plan id without plan=true is told to pass it", bare.isError && bare.json.message.includes("plan=true"), bare.text.slice(0, 300));
    const both = await planned.call("kritik_matrix", { audit_id: planId, plan: true, scope: true });
    check("plan=true with scope=true is refused", both.isError && both.json.message.includes("cannot be combined"), both.text.slice(0, 300));
    const viaPart = await planned.call("kritik_matrix", { audit_id: part.auditId, plan: true });
    check("plan=true with a part id names the plan to pass", viaPart.isError && viaPart.json.message.includes(`"${planId}"`), viaPart.text.slice(0, 300));

    const preview = await planned.call("kritik_matrix", { audit_id: planId, plan: true });
    check("plan=true without record previews and writes nothing", !preview.isError && preview.json.events?.length === 0 && planned.journal().length === before, preview.text.slice(0, 300));
    check(
      "the preview carries the plan marker",
      preview.json.scope?.plan === planId && JSON.stringify(preview.json.scope?.parts) === JSON.stringify([part.auditId]) && preview.json.scope?.cells === part.cells.length,
      JSON.stringify(preview.json.scope).slice(0, 300),
    );
    check(
      "and its coverage: a first audit that is a plan looked at its own cells only",
      preview.json.coverage?.scored === part.cells.length &&
        preview.json.coverage?.assessed === part.cells.length &&
        preview.json.coverage?.surfaces?.web?.assessed === part.cells.length &&
        preview.json.coverage?.applicable > part.cells.length,
      JSON.stringify(preview.json.coverage).slice(0, 300),
    );
    check(
      "coverage_notes say it beside the web roll-up",
      (preview.json.coverage_notes ?? []).some((note) => note.startsWith("web ") && note.includes(`from ${part.cells.length} of`)),
      JSON.stringify(preview.json.coverage_notes),
    );

    cpSync(planned.dir, twin, { recursive: true });
    const recorded = await planned.call("kritik_matrix", { audit_id: planId, plan: true, record: true });
    const event = recorded.json.events?.[0] ?? {};
    check(
      "plan=true record=true appends one quality.audit.completed under the plan id",
      !recorded.isError && recorded.json.events.length === 1 && event.type === "quality.audit.completed" && event.audit_id === planId && planned.journal().length === before + 1,
      recorded.text.slice(0, 300),
    );
    check("a first audit that is a plan records no since", event.scope?.plan === planId && event.scope !== undefined && !("since" in event.scope), JSON.stringify(event.scope).slice(0, 300));

    const cli = spawnSync(process.execPath, [CLI, "kritik", "matrix", planId, "--record", "--plan"], { cwd: twin, encoding: "utf8" });
    const twinEvents = readFileSync(path.join(twin, "docs", "arkaik", "journal.jsonl"), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
    const cliEvent = twinEvents[twinEvents.length - 1] ?? {};
    const sorted = (value) =>
      Array.isArray(value)
        ? value.map(sorted)
        : value !== null && typeof value === "object"
          ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted(value[key])]))
          : value;
    const payload = (e) => {
      const { id: _id, ts: _ts, actor: _actor, ...rest } = e;
      return JSON.stringify(sorted(rest));
    };
    check(
      "kritik_matrix plan=true appends the same event as the CLI",
      cli.status === 0 && payload(cliEvent) === payload(event),
      `${cli.stderr}\nCLI: ${payload(cliEvent).slice(0, 300)}\nMCP: ${payload(event).slice(0, 300)}`,
    );

    const again = await planned.call("kritik_matrix", { audit_id: planId, plan: true, record: true });
    check("recording the plan twice is refused", again.isError && again.json.message.includes("already recorded") && planned.journal().length === before + 1, again.text.slice(0, 300));
  } finally {
    planned.stop();
    rmSync(twin, { recursive: true, force: true });
  }

```

In the hosted "nothing to measure from" block, insert immediately after the `hosted kritik_scope since=<unknown> with no audit points at a restore, not record=true` check (inside the `empty` session's `try`):

```js
    const hostedPlan = await empty.call("kritik_matrix", { audit_id: "2026-11-zplan-1100", plan: true, record: true });
    check(
      "a hosted session refuses plan=true — a plan's parts live in the repository",
      hostedPlan.isError && hostedPlan.json.message.includes("plan=true") && hostedPlan.json.message.includes("--bundle"),
      hostedPlan.text.slice(0, 300),
    );
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run build -w arkaik && npm run build -w arkaik-mcp && node tests/mcp/kritik-tools.test.js`
Expected: FAIL — `plan` is rejected as an unknown property (`additionalProperties: false`) on every `plan: true` call; `kritik_matrix` with the part id and `record: true` records; the plan id without `plan` fails with `no scores.json at …`; the CLI parity check fails (no MCP event). The `kritik_plan` and scoring setup PASS.

- [ ] **Step 3: Write the implementation**

In `packages/mcp/src/kritik-tools.ts`, add `coverageNotes`, `isPlanId`, `isPlanPartId`, `planIdOfPartId` to the `"@arkaik/schema"` import, and `listPlanIds`, `preparePlanRecord`, `type PlanRecord` to part 2's import from `"@arkaik/schema/src/cli/kritik-plan"`.

In the `kritik_matrix` definition, replace the tail of its `description` string (the text before it is unchanged)

```ts
so the trend never reads its unscored cells as dropped; matrix.json stays this audit alone.",
```

with

```ts
so the trend never reads its unscored cells as dropped; matrix.json stays this audit alone. With plan=true (repo mode only) audit_id is a plan made by kritik_plan: it returns the plan's merged reading — every audit through its last part, latest-wins — with `scope` (the plan marker), `coverage` and `coverage_notes`, writes nothing, and with record=true appends it as one quality.audit.completed under the plan id, after checking the plan's cells have not moved and every part scored exactly its cells. A plan part's own id is refused with record or scope: a plan records once, as a whole.",
```


Add to its `inputSchema.properties`, after `scope`:

```ts
          plan: {
            type: "boolean",
            description:
              "audit_id is a plan made by kritik_plan: return its merged reading with scope and coverage, and with record=true append it as one quality.audit.completed under the plan id. Repo mode only; never with scope.",
          },
```

At the start of the hosted branch, replace

```ts
      if (hosted) {
        if (args.record === true) {
          if (typeof args.audit_id !== "string" || args.audit_id === "") {
```

with

```ts
      if (hosted) {
        if (args.plan === true) {
          throw new ToolError(
            "plan=true records a planned partial audit, whose parts live in docs/quality/audits/ — a hosted session has none. " +
              "Run it where the checkout is — `arkaik-mcp --bundle <path>`.",
          );
        }
        if (args.record === true) {
          if (typeof args.audit_id !== "string" || args.audit_id === "") {
```

In the repo branch, replace

```ts
      const root = repoRootOf(ctx, REPO_MODE_ONLY);
      const library = libraryOf(root);
      let auditId: string;
      try {
        auditId = typeof args.audit_id === "string" && args.audit_id !== "" ? args.audit_id : newestAuditId(root);
      } catch (error) {
        throw new ToolError((error as Error).message);
      }
```

with

```ts
      const root = repoRootOf(ctx, REPO_MODE_ONLY);
      const library = libraryOf(root);

      // A planned partial audit: the same preparePlanRecord as `matrix <planId> --plan`.
      if (args.plan === true) {
        const requested = typeof args.audit_id === "string" && args.audit_id !== "" ? args.audit_id : undefined;
        if (args.scope === true) {
          throw new ToolError("plan=true and scope=true cannot be combined — a plan records its own scope marker, measured from the newest full or scoped audit.");
        }
        if (requested === undefined) {
          const plans = listPlanIds(root);
          throw new ToolError(`plan=true needs the plan id as audit_id (plans: ${plans.join(", ") || "none — kritik_plan makes one"}).`);
        }
        if (isPlanPartId(requested)) {
          const owner = planIdOfPartId(requested) ?? requested;
          throw new ToolError(`"${requested}" is one part of plan "${owner}" — pass the plan id: audit_id "${owner}" with plan=true.`);
        }
        const graph = await load();
        let prepared: PlanRecord;
        try {
          prepared = preparePlanRecord(root, requested, library, graph.journal);
        } catch (error) {
          throw new ToolError((error as Error).message);
        }
        const events = args.record === true ? await record(graph, [prepared.input]) : [];
        const { open, lanes, p0 } = openFindingsSummary(prepared.section.findings, library);
        return {
          audit_id: prepared.plan.planId,
          ...(prepared.plan.commit !== null ? { commit: prepared.plan.commit } : {}),
          framework_version: prepared.plan.frameworkVersion,
          matrix: prepared.matrix.matrix,
          overall: prepared.matrix.overall,
          finding_counts: prepared.matrix.finding_counts,
          scope: prepared.scope,
          coverage: prepared.scope.coverage,
          coverage_notes: coverageNotes(prepared.scope.coverage, prepared.matrix.overall),
          assessment_count: prepared.section.assessments.length,
          open_findings: open.length,
          lanes,
          p0,
          events,
          ...(args.record === true
            ? {}
            : { note: `Preview only — nothing written. record=true appends this reading as one quality.audit.completed under ${prepared.plan.planId}.` }),
        };
      }

      let auditId: string;
      try {
        auditId = typeof args.audit_id === "string" && args.audit_id !== "" ? args.audit_id : newestAuditId(root);
      } catch (error) {
        throw new ToolError((error as Error).message);
      }
      if (isPlanId(auditId)) {
        throw new ToolError(
          `"${auditId}" is a plan, not an audit — pass plan=true: audit_id "${auditId}" with plan=true previews its merged reading, and with record=true records it.`,
        );
      }
      if (isPlanPartId(auditId) && (args.record === true || args.scope === true)) {
        const owner = planIdOfPartId(auditId) ?? auditId;
        throw new ToolError(
          `"${auditId}" is one part of plan "${owner}" — a plan records once, as a whole, and carries its own scope marker: ` +
            `kritik_matrix with audit_id "${owner}", plan=true and record=true.`,
        );
      }
```

- [ ] **Step 4: Run it**

Run: `npm run test:mcp`
Expected: PASS — `run-mcp-tests.js` still counts 30 tools (part 2's count; this part adds none), `version.test.js` passes, every `kritik-tools.test.js` check passes.
Run: `npx tsc --noEmit -p .` and `npm run lint` — Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/mcp/src/kritik-tools.ts tests/mcp/kritik-tools.test.js
git commit -m "feat(mcp): kritik_matrix plan=true records a plan; refuses recording a part" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: MCP readings, the anchor guard, and plan-only messages

**Files:**
- Modify: `packages/mcp/src/kritik-tools.ts` (`planOnlyNote`, `lastAuditOf`, `resolveAuditPair`, `kritik_regressions`, `scopeOf`, `kritik_matrix`'s `declaredScopeSince`, `kritik_scope`, `kritik_score`)
- Test: `tests/mcp/kritik-tools.test.js`

- [ ] **Step 1: Write the failing test**

In the planned-audit block added by Task 10, insert immediately after the `recording the plan twice is refused` check (still inside its `try`):

```js
    // --- after the plan record: the scope's anchor, and regressions readings ---

    const emptyScope = await planned.call("kritik_scope", {});
    check(
      "with only plan records, kritik_scope is empty and says why",
      !emptyScope.isError && emptyScope.json.since === null && (emptyScope.json.note ?? "").includes("only plan records") && (emptyScope.json.note ?? "").includes(planId),
      emptyScope.text.slice(0, 400),
    );
    const planSince = await planned.call("kritik_scope", { since: planId });
    check("a plan id is never a scope's anchor", planSince.isError && planSince.json.message.includes("never a scope's anchor"), planSince.text.slice(0, 300));
    const scopedScore = await planned.call("kritik_score", { criterion_id: "SEC-01", surface: "web", level: 3, evidence: "x.ts:1", scope: true });
    check("kritik_score scope=true with only plan records says why there is nothing to measure from", scopedScore.isError && scopedScore.json.message.includes("only plan records"), scopedScore.text.slice(0, 300));

    const writeScores = (auditId, cells, level) => {
      const dir = path.join(planned.dir, "docs", "quality", "audits", auditId);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        path.join(dir, "scores.json"),
        JSON.stringify({
          audit_id: auditId,
          framework_version: plan.frameworkVersion,
          assessments: cells.map((cell) => ({ criterion_id: cell.criterion_id, surface: cell.surface, level, evidence: `${cell.criterion_id}.ts:1`, audit_id: auditId, ts: "2026-11-01T00:00:00.000Z" })),
        }),
      );
    };
    // An audit sorting after the plan's part, declared scoped by hand: there is
    // no full or scoped record before it, so it is refused — never measured from the plan.
    const later = `${planId.slice(0, 7)}-zz-later`;
    writeScores(later, [{ criterion_id: "SEC-02", surface: "supabase" }], 2);
    const declaredAfterPlan = await planned.call("kritik_matrix", { audit_id: later, scope: true });
    check("scope=true never takes a plan or its part as the audit it followed", declaredAfterPlan.isError && declaredAfterPlan.json.message.includes("no recorded audit sorts before"), declaredAfterPlan.text.slice(0, 300));
    rmSync(path.join(planned.dir, "docs", "quality", "audits", later), { recursive: true, force: true });

    const oneReading = await planned.call("kritik_regressions", {});
    check("one plan is one reading — nothing to compare yet", oneReading.isError && oneReading.json.message.includes(`only "${planId}" exists`), oneReading.text.slice(0, 300));
    const made2 = await planned.call("kritik_plan", { runs: ["SEC:supabase", "PRV:web"] });
    const plan2 = made2.json.plan ?? { parts: [] };
    const [secSupabase, prvWeb] = plan2.parts;
    writeScores(secSupabase?.auditId, secSupabase?.cells ?? [], 2);
    writeScores(prvWeb?.auditId, prvWeb?.cells ?? [], 2);
    const pairDefault = await planned.call("kritik_regressions", {});
    check("kritik_regressions defaults to the newest plan against the reading before it", !pairDefault.isError && pairDefault.json.from === planId && pairDefault.json.to === plan2.planId, pairDefault.text.slice(0, 300));
    const toPart = await planned.call("kritik_regressions", { to: prvWeb?.auditId });
    check("a part id given as to reads its whole plan", !toPart.isError && toPart.json.to === plan2.planId, toPart.text.slice(0, 300));
    const samePlan = await planned.call("kritik_regressions", { from: secSupabase?.auditId, to: prvWeb?.auditId });
    check("two parts of one plan are one reading", samePlan.isError && samePlan.json.message.includes("same audit"), samePlan.text.slice(0, 300));
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run build -w arkaik && npm run build -w arkaik-mcp && node tests/mcp/kritik-tools.test.js`
Expected: FAIL — the scope note says "No recorded audit yet"; `since: <planId>` returns an empty scope; `kritik_score` says "needs a recorded audit"; the declared audit is measured from the part; regressions pair directories (`only "<partId>" exists`, then the two parts of plan 2).

- [ ] **Step 3: Write the implementation**

In `packages/mcp/src/kritik-tools.ts`, add `auditReadings`, `readingOf`, `recordedPlans`, `recordedSinceIds` and `type AuditReading` to the `"@arkaik/schema"` import.

Below the `NO_HOSTED_AUDIT` constant, add:

```ts
/**
 * Why a repo scope is empty when the journal holds plan records and nothing else: a plan
 * record is never a scope's anchor, so a fix is re-checked by running its part again.
 */
function planOnlyNote(plans: readonly string[]): string {
  return (
    `only plan records are in this journal (${plans.join(", ")}) — a plan record is never what a scope is measured from. ` +
    `Until a full audit is recorded, re-check a fix by running its plan part again: kritik_plan, then kritik_matrix with plan=true and record=true.`
  );
}

/** The audit directory a reading's state runs through: its last member. */
const lastAuditOf = (reading: AuditReading): string => reading.auditIds[reading.auditIds.length - 1];
```

Replace the whole `resolveAuditPair` function with:

```ts
/**
 * Resolve the `from`/`to` pair for a regression comparison out of the readings on hand
 * (ascending), applying the same not-found / too-few / same-reading / inverted-order guards
 * `kritik_regressions` needs in both modes — only the "no audit under X" phrasing and where
 * the readings come from differ. In repo mode a plan's parts are one reading
 * (`auditReadings`); a hosted session passes each audit id as its own.
 */
function resolveAuditPair(
  readings: readonly AuditReading[],
  args: Record<string, unknown>,
  notFoundHint: string,
): { from: AuditReading; to: AuditReading } {
  if (readings.length < 2) {
    throw new ToolError(
      `regressions needs two audits to compare — ${readings.length === 0 ? `${notFoundHint} holds none` : `only "${readings[0].id}" exists`}. ` +
        `A regression is the difference between two readings; one reading is a baseline.`,
    );
  }
  const known = (id: string): AuditReading => {
    const reading = readingOf(readings, id);
    if (reading === undefined) throw new ToolError(`no audit "${id}" ${notFoundHint} (have: ${readings.map((r) => r.id).join(", ")})`);
    return reading;
  };
  const to = typeof args.to === "string" && args.to !== "" ? known(args.to) : readings[readings.length - 1];
  const from = typeof args.from === "string" && args.from !== "" ? known(args.from) : readings[readings.indexOf(to) - 1];
  if (from === undefined) throw new ToolError(`"${to.id}" is the oldest audit — there is nothing before it to compare against.`);
  if (from === to) throw new ToolError(`from and to name the same audit ("${to.id}") — a regression needs two readings.`);
  // Order is the whole verdict: a hand-swapped pair reports a clean run where
  // a real regression exists.
  if (readings.indexOf(from) > readings.indexOf(to)) {
    throw new ToolError(`from "${from.id}" is newer than to "${to.id}" — swap them, or the comparison inverts.`);
  }
  return { from, to };
}
```

In `kritik_regressions`, replace the hosted pairing

```ts
        const audits = [...grouped.keys()].sort();
        const { from, to } = resolveAuditPair(audits, args, "in this project's assessments");
```

with

```ts
        const audits = [...grouped.keys()].sort();
        // Hosted assessments carry their audit id alone, so each id is its own reading.
        const hostedPair = resolveAuditPair(audits.map((id) => ({ id, auditIds: [id] })), args, "in this project's assessments");
        const from = hostedPair.from.id;
        const to = hostedPair.to.id;
```

replace the repo pairing

```ts
      const audits = listAuditIds(root);
      const { from, to } = resolveAuditPair(audits, args, "under docs/quality/audits/");
```

with

```ts
      const pair = resolveAuditPair(auditReadings(listAuditIds(root)), args, "under docs/quality/audits/");
      const from = pair.from.id;
      const to = pair.to.id;
```

and replace

```ts
          loadQualitySectionThrough(root, from, library),
          loadQualitySectionThrough(root, to, library),
```

with

```ts
          loadQualitySectionThrough(root, lastAuditOf(pair.from), library),
          loadQualitySectionThrough(root, lastAuditOf(pair.to), library),
```

In its `inputSchema`, replace

```ts
          from: { type: "string", description: "The older audit. Default: the audit before `to`." },
          to: { type: "string", description: "The newer audit. Default: the newest on disk." },
```

with

```ts
          from: { type: "string", description: "The older reading. Default: the reading before `to`. A plan id, or any of its part ids, reads the whole plan." },
          to: { type: "string", description: "The newer reading. Default: the newest on disk. A plan id, or any of its part ids, reads the whole plan." },
```

In `scopeOf`, replace

```ts
    if (options.since !== undefined) {
      const recorded = recordedAuditIds(events);
      if (!recorded.includes(options.since)) {
```

with

```ts
    if (options.since !== undefined) {
      const recordedAll = recordedAuditIds(events);
      const recorded = recordedSinceIds(events);
      const since = options.since;
      if (isPlanId(since) || isPlanPartId(since) || (recordedAll.includes(since) && !recorded.includes(since))) {
        throw new ToolError(
          `"${since}" is a plan record, never a scope's anchor — a scope is measured from a full or scoped audit (recorded: ${recorded.join(", ") || "none"}).`,
        );
      }
      if (!recorded.includes(since)) {
```

(The rest of that block — the hint and the "No recorded audit" refusal, which now lists `recordedSinceIds` — stays as it is.)

In `kritik_matrix`'s repo branch, replace

```ts
          since = declaredScopeSince(auditId, recordedAuditIds(graph.journal));
```

with

```ts
          since = declaredScopeSince(auditId, recordedSinceIds(graph.journal));
```

In `kritik_scope`, replace

```ts
      return {
        ...scope,
        cells,
        summary: scopeSummary(scope),
```

with

```ts
      const planOnly = ctx.qualityRoot !== undefined && scope.since === null ? recordedPlans(graph.journal).map((p) => p.plan) : [];
      return {
        ...scope,
        cells,
        summary: scopeSummary(scope),
```

and replace

```ts
                ctx.qualityRoot === undefined
                  ? NO_HOSTED_AUDIT
                  : "No recorded audit yet — a scope is measured from one. `kritik_matrix` with record=true writes it.",
```

with

```ts
                ctx.qualityRoot === undefined
                  ? NO_HOSTED_AUDIT
                  : planOnly.length > 0
                    ? `No full audit recorded yet: ${planOnlyNote(planOnly)}`
                    : "No recorded audit yet — a scope is measured from one. `kritik_matrix` with record=true writes it.",
```

In `kritik_score`'s repo branch, replace

```ts
        if (scope.since === null) {
          throw new ToolError("scope=true needs a recorded audit to measure from — kritik_matrix with record=true writes one.");
        }
```

with

```ts
        if (scope.since === null) {
          const plans = recordedPlans(graph.journal).map((p) => p.plan);
          throw new ToolError(
            plans.length > 0
              ? `scope=true needs a full or scoped audit to measure from, and ${planOnlyNote(plans)}`
              : "scope=true needs a recorded audit to measure from — kritik_matrix with record=true writes one.",
          );
        }
```

- [ ] **Step 4: Run it**

Run: `npm run test:mcp` — Expected: PASS, including the hosted regressions checks (singletons, unchanged wording) and the earlier repo regressions block.
Run: `npx tsc --noEmit -p .` and `npm run lint` — Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/mcp/src/kritik-tools.ts tests/mcp/kritik-tools.test.js
git commit -m "feat(mcp): plan readings in kritik_regressions, the anchor guard in kritik_scope and kritik_score" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: The journal feed reads a plan record as a planned partial audit

Owner decision on contract open risk 1. Trap: `tests/app/load-quality.js` and `tests/services/load-quality-events.js` rewrite only the `@arkaik/schema` specifier — `readPlanScope` joins the existing import, so neither table changes.

**Files:**
- Modify: `lib/utils/quality.ts` (`describeAuditCompleted` only)
- Test: `tests/app/quality.test.js`

- [ ] **Step 1: Write the failing test**

In `tests/app/quality.test.js`, inside the `// --- describeAuditCompleted (issue #443)` block, insert immediately above

```js
  assert(describeAuditCompleted({}).text === "Audit ? completed", "an event with nothing on it still renders");
```

the following:

```js
  const planned = describeAuditCompleted({
    type: "quality.audit.completed",
    audit_id: "2026-11-zplan-1100",
    framework_version: "0.1.0",
    scope: {
      partial: true,
      cells: 14,
      since: "2026-10",
      plan: "2026-11-zplan-1100",
      parts: ["2026-11-zplan-1100-agt-ios", "2026-11-zplan-1100-sec-web"],
      scored: [],
      coverage: { scored: 14, assessed: 152, applicable: 338, surfaces: {} },
    },
  });
  assert(planned.text === "Planned partial audit of 14 cells", `a plan record reads as a planned partial audit, never a scoped re-audit (got ${planned.text})`);
  assert(
    planned.meta === "2026-11-zplan-1100 · 2 parts · since 2026-10 · Kritik 0.1.0",
    `its meta names the plan, its parts, what it followed, and the pack (got ${planned.meta})`,
  );
  const firstPlan = describeAuditCompleted({
    audit_id: "2026-11-zplan-1100",
    scope: { partial: true, cells: 1, plan: "2026-11-zplan-1100", parts: ["2026-11-zplan-1100-sec-web"] },
  });
  assert(
    firstPlan.text === "Planned partial audit of 1 cell" && firstPlan.meta === "2026-11-zplan-1100 · 1 part",
    `a first audit that is a plan has no since, and one cell is singular (got ${JSON.stringify(firstPlan)})`,
  );
  const uncountedPlan = describeAuditCompleted({ audit_id: "2026-11-zplan-1100", scope: { partial: true, cells: "six", plan: "2026-11-zplan-1100", parts: [] } });
  assert(uncountedPlan.text === "Planned partial audit 2026-11-zplan-1100", `a malformed count falls back to the plan id (got ${JSON.stringify(uncountedPlan)})`);
  const blankPlan = describeAuditCompleted({ audit_id: "2026-09-scoped", scope: { partial: true, cells: 3, since: "2026-08", plan: "" } });
  assert(blankPlan.text === "Scoped re-audit of 3 cells", `an empty plan field is not a plan (got ${blankPlan.text})`);
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test:quality-page`
Expected: FAIL — `a plan record reads as a planned partial audit … (got Scoped re-audit of 14 cells)` and the `firstPlan`/`uncountedPlan` asserts.

- [ ] **Step 3: Write the implementation**

In `lib/utils/quality.ts`, add `readPlanScope,` to the import from `"@arkaik/schema"` (after `domainCodeOf,`).

In `describeAuditCompleted`'s doc comment, add before ` */`:

```ts
 * A planned partial audit's record (`scope.plan`) reads as one — "Planned partial
 * audit of 14 cells" — with the plan, its parts and the audit it followed in the meta.
```

Replace

```ts
  const kritik = framework ? `Kritik ${framework}` : undefined;

  const scope = event.scope as { partial?: unknown; cells?: unknown; since?: unknown } | null | undefined;
```

with

```ts
  const kritik = framework ? `Kritik ${framework}` : undefined;

  const plan = readPlanScope(event.scope);
  if (plan !== null) {
    const parts = plan.parts.length;
    const text =
      plan.cells !== null ? `Planned partial audit of ${plan.cells} cell${plan.cells === 1 ? "" : "s"}` : `Planned partial audit ${plan.plan}`;
    const meta = [
      plan.cells !== null ? plan.plan : undefined,
      parts > 0 ? `${parts} part${parts === 1 ? "" : "s"}` : undefined,
      plan.since !== null ? `since ${plan.since}` : undefined,
      kritik,
    ]
      .filter((part): part is string => part !== undefined)
      .join(" · ");
    return meta === "" ? { text } : { text, meta };
  }

  const scope = event.scope as { partial?: unknown; cells?: unknown; since?: unknown } | null | undefined;
```

- [ ] **Step 4: Run it**

Run: `npm run test:quality-page` — Expected: PASS.
Run: `npm run test:quality-events` — Expected: PASS (its loader rewrites the same specifier).
Run: `npx tsc --noEmit -p .` and `npm run lint` — Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add lib/utils/quality.ts tests/app/quality.test.js
git commit -m "feat(journal): a plan record reads as a planned partial audit in the feed" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Docs, the skill at 0.8.0, and the regenerated plugin

**Files:**
- Modify: `docs/kritik-skill/skill.md`, `docs/spec/mcp.md`
- Generated: `plugin-kritik/skills/kritik/SKILL.md`, `plugin-kritik/.claude-plugin/plugin.json`

- [ ] **Step 1: Edit the skill (this makes the plugin test fail)**

In `docs/kritik-skill/skill.md`:

Frontmatter: `version: 0.7.0` → `version: 0.8.0`.

Under `### 6. Roll up — this is the gate`, after the paragraph ending `A cell full of 3s does not get to absorb a\nlive account-takeover.`, add:

```markdown

**Read the coverage lines.** When a surface's roll-up rests on fewer cells than
apply to it — a partial audit, a planned part, a first audit that covered one
domain — `arkaik kritik matrix` prints one line per such surface under the
table: `web 62, from 6 of 73 cells`. The roll-up is the weighted mean of the
domains that scored, so with only Security scored, web's overall *is* its
Security score. Report it with its coverage, never as a grade for the whole
surface. (The plugin's `compute-matrix.js` prints the table alone.)
```

Under `### Regressions — the check that needs nobody`, after the paragraph ending `single reading is a baseline, not a trend.`, add:

```markdown

A planned partial audit's parts count as **one reading**: with no arguments,
`regressions` compares the state through a plan's last part with the reading
before it, never two parts of the same plan, and `--from`/`--to` take a plan id
or any of its part ids. `detect-regressions.js` and `kritik_regressions` pair
them the same way.
```

Under `### Trend — from where we started to where we are now`, after the paragraph ending `restored but never recorded, both start from that baseline row.`, add:

```markdown

A planned partial audit's row says so — `planned partial audit: 6 cells
re-scored in 1 part since 2026-08` — and its arrows move only on the surfaces
(with `--domain`, only the domain) the plan re-scored. Under it, one coverage
line per surface the reading has not fully looked at: `web 62, from 6 of 73
cells`.
```

At the end of the `### A planned partial audit` subsection part 2 added (immediately before the heading that follows it), add:

````markdown

**Record the plan once, when every part is scored.** `arkaik kritik plan --status
<planId>` shows each part as not started, in progress or scored. Preview the
merged reading first — it writes nothing — then record it, from one session:

```
arkaik kritik matrix <planId> --plan
arkaik kritik matrix <planId> --record --plan
```

The record checks that the plan's cells have not moved since it was made (same
pack version, same profile), that every part scored exactly its cells — a score
outside the plan is refused, not ignored, because the merge reads every audit
directory — and that no plan cell is missing a score. A part scored in another
worktree has no directory here: copy or merge it first. Then it appends **one**
`quality.audit.completed` under the plan id, carrying the merged matrix and
`scope: { partial, cells, since, plan, parts, scored, coverage }`. Recording
changes no finding: resolve one explicitly when you see its defect is gone.

The record clears the scope **per cell**: only the stale cells the plan
re-scored leave `arkaik kritik scope`; every other stale cell stays listed.
Never record a part on its own — `matrix <partId> --record` refuses and points
here — and never record a plan twice: to correct a recorded plan, make a new
plan for the same parts. Over MCP the same record is `kritik_matrix` with
`audit_id: <planId>`, `plan: true` and `record: true`.

A project's first audit may be a plan. Its record has no `since`, the matrix
and the trend print a coverage line beside every roll-up that rests on part of
its surface, and `arkaik kritik scope` stays empty until a full audit is
recorded: a plan record is never what a scope is measured from. Re-check a fix
by running its part again in a new plan.
````

- [ ] **Step 2: Watch the plugin test fail**

Run: `npm run test:kritik-plugin`
Expected: FAIL on "the shipped skill is a byte-for-byte copy of its canonical source" — the shipped SKILL.md is still the old copy until `npm run generate` copies the edited source and stamps 0.8.0 into plugin.json.

- [ ] **Step 3: Edit the MCP spec**

In `docs/spec/mcp.md`, in the `kritik_matrix` row, replace

```
| `kritik_matrix` | `audit_id?`, `record?`, `scope?`, `commit?` |
```

with

```
| `kritik_matrix` | `audit_id?`, `record?`, `scope?`, `plan?`, `commit?` |
```

and replace

```
stays an error | `quality.audit.completed` (only with `record: true`; hosted, only a scoped one, marked `scope: {partial, cells, since}`) |
```

with

```
stays an error. Repo `plan: true` takes a plan id from `kritik_plan` as `audit_id`: it returns the plan's merged reading — every audit through its last part, latest-wins — with `scope` (the plan marker), `coverage` and `coverage_notes`, writes nothing, and with `record: true` appends it as one event under the plan id, after the same checks as `arkaik kritik matrix <planId> --record --plan` (cells unmoved, every part scored exactly its cells). A plan part's own id is refused with `record` or `scope`, a plan id without `plan: true`, and `plan` in a hosted session | `quality.audit.completed` (only with `record: true`; hosted, only a scoped one, marked `scope: {partial, cells, since}`; a plan record is marked `scope: {partial, cells, since?, plan, parts, scored, coverage}`) |
```

In the `kritik_regressions` row, replace

```
a finding resolved and open again. Hosted comparisons
```

with

```
a finding resolved and open again. In repo mode a planned partial audit's parts are one reading: the default pair is the newest reading and the one before it, `from`/`to` take a plan id or any of its part ids, and the reply names readings. Hosted comparisons
```

- [ ] **Step 4: Regenerate and run**

Run: `npm run generate && git status --porcelain`
Expected: `docs/kritik-skill/skill.md`, `docs/spec/mcp.md`, `plugin-kritik/skills/kritik/SKILL.md`, `plugin-kritik/.claude-plugin/plugin.json` (version `0.8.0`). Nothing else.

Run: `npm run test:kritik-plugin` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/kritik-skill/skill.md docs/spec/mcp.md plugin-kritik
git commit -m "docs(kritik): recording a plan, coverage lines and plan readings; skill 0.8.0" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Version bumps

No test is written first: `version.test.js` (CLI and MCP) already compares `--version` with `package.json`, and is the check.

**Files:**
- Modify: `packages/cli/package.json`, `packages/mcp/package.json`, `package-lock.json`

- [ ] **Step 1: Bump**

`packages/cli/package.json`: `"version": "0.10.0"` → `"version": "0.11.0"`.
`packages/mcp/package.json`: `"version": "0.9.0"` → `"version": "0.10.0"`.

- [ ] **Step 2: Refresh the lockfile**

Run: `npm install --package-lock-only`
Then: `git diff package-lock.json`
Expected: exactly two hunks — `"packages/cli"` 0.10.0 → 0.11.0 and `"packages/mcp"` 0.9.0 → 0.10.0 (the way #470, #476, #480 and #520 bumped). Anything else: revert the lockfile and rerun.

- [ ] **Step 3: Verify**

Run: `npm run build -w arkaik && node tests/cli/version.test.js` — Expected: PASS (prints 0.11.0).
Run: `npm run build -w arkaik-mcp && node tests/mcp/version.test.js` — Expected: PASS (0.10.0).

- [ ] **Step 4: Commit**

```bash
git add packages/cli/package.json packages/mcp/package.json package-lock.json
git commit -m "chore(release): arkaik 0.11.0 + arkaik-mcp 0.10.0 — record a planned partial audit" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Part done when

All of these pass on `feat/kritik-plan-record`:

```bash
npm run test:quality-plan
npm run test:quality-trend
npm run test:quality-ops
npm run test:quality-regressions
npm run test:quality-scope
npm run test:quality-baseline
npm run test:quality
npm run test:quality-events
npm run test:quality-page
npm run test:kritik-plugin
npm run test:schema
npm run test:cli
npm run test:mcp
npm run lint
npx tsc --noEmit -p .
npm run build
npm run generate && git status --porcelain   # prints nothing: every regenerated plugin file is committed
```

`tests/cli/kritik-plan-record.test.js` (inside `test:cli`) is the acceptance gate: the spec's eight steps on a synthetic five-surface fixture, through `packages/cli/dist/index.js`, with no model call.

Versions are bumped (`arkaik` 0.11.0, `arkaik-mcp` 0.10.0, kritik skill 0.8.0) **but not published** — the owner publishes by hand, after the whole stack has merged.

**PR:** open with `gh stack` above `feat/kritik-plan-scope`.

Title: `feat(kritik): record a planned partial audit (part 4/4)`

Body ends with the Lab Note, then the attribution line:

````markdown
## Lab Note

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

🤖 Generated with [Claude Code](https://claude.com/claude-code)
````

After opening the PR, read its comments for the Lab Note reminder and fix the body if it flags anything.
