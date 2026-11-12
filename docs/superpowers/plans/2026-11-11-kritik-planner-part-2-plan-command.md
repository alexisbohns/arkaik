# Kritik planner — Part 2: the plan command — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `arkaik kritik plan` in counts-only form — the plan file, its per-part and combined prompts, `--json`, `--dry-run`, `--out` and `--status` — the `kritik_plan` MCP tool over the same functions, and the planned-partial-audit procedure in the Kritik skill the prompts point to.

**Architecture:** Three layers, each in the package the stack contract assigns. The pure half lives in `@arkaik/schema`: `kritik-plan-prompt.ts` renders the prompts, and `quality-plan.ts` (created by part 1) gains `buildKritikPlan` (assembly) and `planPartStatuses` (progress). The file half is `packages/schema/src/cli/kritik-plan.ts`: paths, read/parse/write, `gitHead`, `createPlan` (profile + grammar + assembly, writes nothing) and `planStatus`. The CLI verb (`packages/cli/src/commands/kritik.ts`) and the MCP tool (`packages/mcp/src/kritik-tools.ts`) only parse flags, refuse, call those, and print or return. The skill source gains `### A planned partial audit`, regenerated into `plugin-kritik`.

**Tech Stack:** TypeScript (`@arkaik/schema`, bundled raw into the CLI and MCP by esbuild, target node18), zod 4 (only in `cli/kritik-plan.ts`, through part 1's `parseKritikPlan`), plain Node test scripts (CommonJS, Node 20 in CI).

**Spec:** `docs/superpowers/specs/2026-11-11-kritik-planner-design.md` (rollout PR 3)

**Contract:** `docs/superpowers/plans/2026-11-11-kritik-planner-stack.md` — authoritative over the spec.

**Branch:** `feat/kritik-plan-cli`, created on top of part 1 with `gh stack add feat/kritik-plan-cli` from the `feat/kritik-plan-schema` checkout (drive it with the `gh-stack` skill).

**Position in the stack:** part 2 of 4. Below: part 1 (`feat/kritik-plan-schema`, plan types, grammar, cells, ids, schema). Above: part 3 (`feat/kritik-plan-scope`) and part 4 (`feat/kritik-plan-record`). The record command this part prints (`matrix <planId> --record --plan`) lands in part 4; the stack merges as a unit, and no version moves in this part.

---

## Contract deviations

None. Every name, signature and file below is the contract's. Six readings of it, stated so a reviewer does not take them for drift:

1. **`recorded` is computed, not a literal.** The contract writes the status shape as `{ plan_id, recorded: false, parts }`. Both the CLI (`--status --json`) and `kritik_plan` return `recorded: recordedAuditIds(events).includes(planId)`. A plan record's `audit_id` is the plan id, so this is `false` in every state reachable before part 4 and correct after it with no change.
2. **Only the combined prompt lists deferred parts.** `renderPartPrompt(plan: Pick<KritikPlan, "planId" | "commit">, part)` cannot see the other parts, so the spec's "deferred parts at the end of both prompts" holds for the combined prompt only. A part prompt already says "Score exactly these cells and no others". Nothing is deferred until budgets ship.
3. **Part step 5 is reworded.** The spec's "Do not run `arkaik kritik matrix … --record`" would break the contract invariant "a part prompt contains no `--record`". It reads "Do not record this part. The plan is recorded once, after every part is scored, with the plan's own command."
4. **Refusals added beyond the spec's table**, each exit 1 / `ToolError`, each writing nothing: `--out` onto an existing file; `--status` with `--run`, `--out` or `--dry-run`; `kritik_plan` with an empty `runs`, or with both `runs` and `status`.
5. **`docs/spec/mcp.md`:** besides the `kritik_plan` row and the count sentence, `kritik_plan` joins the "What stays repo-only is …" sentence, which would otherwise be false.
6. **Part 1's test harness.** Task 2 appends a block to part 1's `tests/schema/quality-plan.test.js` and calls its `check(name, cond, detail)` helper, which increments its `failures` counter — the shape of every suite under `tests/schema/`. If part 1 named the helper differently, rename the calls in the block; change nothing else.

## Before you start

Part 1 must be committed below this branch. Confirm the names this part calls exist, with these exact spellings:

```bash
grep -nE "export (const KRITIK_PLAN_SCHEMA|const PLAN_PLANS_DIR|interface (KritikPlan|KritikPlanPart|KritikPlanCell|KritikPlanBand|PlanRun)\b|function (parseRun|planCells|applicableCellCount|planId|planPartId|planCellKey)\()" packages/schema/src/quality-plan.ts
grep -n "export function parseKritikPlan" packages/schema/src/quality-schemas.ts
grep -n 'export \* from "./quality-plan"' packages/schema/src/index.ts
grep -nE "^function check|^let failures" tests/schema/quality-plan.test.js
grep -n '"test:quality-plan"' package.json
```

Expected: every grep prints at least one line (the first prints 13). If one does not, stop: part 1 is not what the contract says, and this plan cannot be executed against it.

## File map

- Create `packages/schema/src/kritik-plan-prompt.ts` — `planRecordCommand`, `renderPartPrompt`, `renderPlanPrompt`. Pure, zod-free, no top-level calls.
- Modify `packages/schema/src/quality-plan.ts` — append the P2 section: `BuildKritikPlanInput`, `buildKritikPlan`, `PlanPartProgress`, `PlanPartStatus`, `planPartStatuses`; import the prompt renderers.
- Modify `packages/schema/src/index.ts` — `export * from "./kritik-plan-prompt";`.
- Create `packages/schema/src/cli/kritik-plan.ts` — `plansDir`, `planPath`, `listPlanIds`, `readPlanFile`, `loadPlan`, `savePlan`, `gitHead`, `createPlan`, `planStatus`. Never exported from `index.ts` (it imports `node:child_process`, and `index.ts` reaches the Next app).
- Modify `packages/cli/src/commands/kritik.ts` — the `USAGE` line, `PLAN_USAGE`, `runPlan` (with its private printers), `case "plan"`.
- Modify `packages/mcp/src/kritik-tools.ts` — the `kritik_plan` tool.
- Modify `docs/kritik-skill/skill.md` — one pointer sentence in "Scoping a run", and the `### A planned partial audit` subsection. Frontmatter `version` stays `0.7.0`.
- Regenerated (committed): `plugin-kritik/skills/kritik/SKILL.md`. Nothing else under `plugin-kritik/` changes.
- Modify `docs/spec/mcp.md` — "Twelve" becomes "Fourteen", a `kritik_plan` row, `kritik_plan` in the repo-only sentence.
- Create `tests/schema/kritik-plan-prompt.test.js`, `tests/cli/kritik-plan.test.js`.
- Modify `tests/schema/quality-plan.test.js` (part 1's suite: a `buildKritikPlan` / `planPartStatuses` block), `tests/mcp/kritik-tools.test.js` (`kritik_plan`), `tests/mcp/run-mcp-tests.js` (29 tools become 30; the stale "16 + 12" comment becomes "16 + 14").
- Modify `package.json` — `test:quality-plan` gains the prompt suite; `test:cli` gains the plan suite.
- No CI wiring change: part 1's `build`-job step already runs `npm run test:quality-plan`, and the `test:cli` and `test:mcp` jobs run the scripts this part extends.

## Traps that apply

| Trap | Where it bites in this part | What to do |
| --- | --- | --- |
| Node 20 in CI, Node 26 here | Every new test | Load TypeScript only through `tests/schema/load-schema.js` (schema suites, and the CLI suite's fixture generator) or the built `dist/`. Never `require` a `.ts` file. `Array.prototype.at` is fine on 20. |
| `export *` duplicates fail `tsc` | Task 1 | Grep `packages/schema/src/*.ts` for the three new names before adding the export. |
| Top level of `quality-plan.ts` / `kritik-plan-prompt.ts` | Tasks 1, 2 | Only regex literals, string constants, types and function declarations, so the new code is tree-shaken out of the plugin scripts. A regenerated script may still differ by renamed identifiers; it must never gain plan or prompt code. |
| zod reachability | Tasks 1 to 3 | Only `cli/kritik-plan.ts` imports `quality-schemas.ts`. `cli/kritik-audit.ts` never imports `cli/kritik-plan.ts`. |
| Hand-maintained alias tables | Tasks 3, 4 | None needed: `@arkaik/schema/src/cli/kritik-plan` resolves through the workspace link exactly like `…/cli/kritik-audit`; the MCP build aliases only `arkaik/io`; `load-schema.js` discovers new top-level modules and never reaches `src/cli/`. |
| Exact tool count | Task 4 | `tests/mcp/run-mcp-tests.js` asserts 30. |
| Generated-artifact drift | Tasks 2, 5 | Any edit to `quality-plan.ts` may rename identifiers in `compute-matrix.js` / `detect-regressions.js` (contract correction from part 1): Task 2 runs `npm run generate` and commits them. Task 5 commits `plugin-kritik/skills/kritik/SKILL.md`. |
| Lint gates CI | Every task | `npm run lint` (eslint covers `packages/*/src`; `tests/` and `scripts/` are ignored). No workflow file changes, so actionlint has nothing new. |
| Source-asserting suites | — | Checked: none reads `kritik.ts`, `kritik-tools.ts`, `skill.md` or `mcp.md` as text, except `kritik-plugin.test.js`'s byte-for-byte copy check (Task 5). |

---

### Task 1: The prompts

**Files:**
- Create: `packages/schema/src/kritik-plan-prompt.ts`
- Create: `tests/schema/kritik-plan-prompt.test.js`
- Modify: `packages/schema/src/index.ts`, `package.json`

- [ ] **Step 1: Write the failing test and wire it**

Create `tests/schema/kritik-plan-prompt.test.js`:

```js
#!/usr/bin/env node

/**
 * The prompts a Kritik plan carries (docs/superpowers/specs/2026-11-11-kritik-planner-design.md
 * § Prompt template): a snapshot of the per-part and combined prompts for
 * SEC:web + AGT:ios with a hand-made deferred third part, and the invariants
 * that make a prompt safe to paste — every score line names its part's audit,
 * a part never records, the plan records exactly once, at the end.
 *
 * Pure: the parts are built inline, so this pins the renderer, not the cell
 * selection (tests/schema/quality-plan.test.js pins that against the pack).
 */

const { loadSchema } = require("./load-schema");
const { planRecordCommand, renderPartPrompt, renderPlanPrompt } = loadSchema();

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`PASS: ${name}`);
  else { failures++; console.log(`FAIL: ${name}${detail ? `\n${detail}` : ""}`); }
}

const PLAN_ID = "2026-11-zplan-1100";
const COMMIT = "3f9c2e1d4b5a69788796a5b4c3d2e1f0a9b8c7d6";
const cells = (ids, surface) => ids.map((criterion_id) => ({ criterion_id, surface }));

const SEC_WEB = {
  domain: "SEC", surface: "web", auditId: `${PLAN_ID}-sec-web`,
  cells: cells(["SEC-01", "SEC-04", "SEC-05", "SEC-06", "SEC-07", "SEC-08"], "web"),
  steps: 36, estimate: null, status: "included",
};
const AGT_IOS = {
  domain: "AGT", surface: "ios", auditId: `${PLAN_ID}-agt-ios`,
  cells: cells(["AGT-01", "AGT-02", "AGT-03", "AGT-04", "AGT-05", "AGT-06", "AGT-07", "AGT-08"], "ios"),
  steps: 42, estimate: null, status: "included",
};
// Hand-made: nothing in this stack defers a part (budgets ship with the
// estimator), but the combined prompt must already keep one out of the run.
const A11Y_ANDROID = {
  domain: "A11Y", surface: "android", auditId: `${PLAN_ID}-a11y-android`,
  cells: cells(["A11Y-01", "A11Y-02"], "android"),
  steps: 11, estimate: null, status: "deferred",
};
const HEAD = {
  schema: "arkaik.kritik.plan/1",
  planId: PLAN_ID,
  createdAt: "2026-11-11T09:00:00.000Z",
  commit: COMMIT,
  frameworkVersion: "0.1.0",
  tier: null,
  budgetTokens: null,
  budgetUsd: null,
  pricePerMTok: null,
  totals: { cells: 14, steps: 78, applicableCells: 338, tokens: null, usd: null },
  recordCommand: planRecordCommand(PLAN_ID),
};

const SEC_WEB_PROMPT = [
  "Run part SEC:web of Kritik plan 2026-11-zplan-1100 in this repo (commit 3f9c2e1d4b5a69788796a5b4c3d2e1f0a9b8c7d6).",
  "Scope: 6 cells, 36 checklist steps.",
  "Audit id for this part: 2026-11-zplan-1100-sec-web",
  "",
  '1. Follow the Kritik skill (SKILL.md), section "A planned partial audit". Run it in the repository checkout: a hosted session cannot score a plan part.',
  "2. Get the run sheet: `arkaik kritik signals --domain SEC --surface web`",
  "3. Score exactly these cells and no others:",
  '   - SEC-01 on web: `arkaik kritik score SEC-01 web <level> --evidence "<file:line …>" --audit 2026-11-zplan-1100-sec-web`',
  '   - SEC-04 on web: `arkaik kritik score SEC-04 web <level> --evidence "<file:line …>" --audit 2026-11-zplan-1100-sec-web`',
  '   - SEC-05 on web: `arkaik kritik score SEC-05 web <level> --evidence "<file:line …>" --audit 2026-11-zplan-1100-sec-web`',
  '   - SEC-06 on web: `arkaik kritik score SEC-06 web <level> --evidence "<file:line …>" --audit 2026-11-zplan-1100-sec-web`',
  '   - SEC-07 on web: `arkaik kritik score SEC-07 web <level> --evidence "<file:line …>" --audit 2026-11-zplan-1100-sec-web`',
  '   - SEC-08 on web: `arkaik kritik score SEC-08 web <level> --evidence "<file:line …>" --audit 2026-11-zplan-1100-sec-web`',
  "4. Open every finding on this part's audit: `arkaik kritik finding open <criterion> web … --audit 2026-11-zplan-1100-sec-web`. Give file-and-line evidence, and verify every Critical and High finding adversarially before you open it.",
  "5. Do not record this part. The plan is recorded once, after every part is scored, with the plan's own command.",
  "6. Finish by printing this session's usage readout: model, tokens in and out, duration, number of agents.",
].join("\n");

const PLAN_PROMPT = [
  "Run Kritik plan 2026-11-zplan-1100 in this repo (commit 3f9c2e1d4b5a69788796a5b4c3d2e1f0a9b8c7d6): 2 parts, one after the other, in this session.",
  "Scope: 14 cells, 78 checklist steps, of 338 applicable cells.",
  "",
  '1. Follow the Kritik skill (SKILL.md), section "A planned partial audit". Run it in the repository checkout: a hosted session cannot score a plan part. Do not record a part on its own.',
  "",
  "Part SEC:web, audit id 2026-11-zplan-1100-sec-web (6 cells, 36 checklist steps):",
  "2. Get the run sheet: `arkaik kritik signals --domain SEC --surface web`",
  "3. Score exactly these cells and no others:",
  '   - SEC-01 on web: `arkaik kritik score SEC-01 web <level> --evidence "<file:line …>" --audit 2026-11-zplan-1100-sec-web`',
  '   - SEC-04 on web: `arkaik kritik score SEC-04 web <level> --evidence "<file:line …>" --audit 2026-11-zplan-1100-sec-web`',
  '   - SEC-05 on web: `arkaik kritik score SEC-05 web <level> --evidence "<file:line …>" --audit 2026-11-zplan-1100-sec-web`',
  '   - SEC-06 on web: `arkaik kritik score SEC-06 web <level> --evidence "<file:line …>" --audit 2026-11-zplan-1100-sec-web`',
  '   - SEC-07 on web: `arkaik kritik score SEC-07 web <level> --evidence "<file:line …>" --audit 2026-11-zplan-1100-sec-web`',
  '   - SEC-08 on web: `arkaik kritik score SEC-08 web <level> --evidence "<file:line …>" --audit 2026-11-zplan-1100-sec-web`',
  "4. Open every finding on this part's audit: `arkaik kritik finding open <criterion> web … --audit 2026-11-zplan-1100-sec-web`. Give file-and-line evidence, and verify every Critical and High finding adversarially before you open it.",
  "",
  "Part AGT:ios, audit id 2026-11-zplan-1100-agt-ios (8 cells, 42 checklist steps):",
  "5. Get the run sheet: `arkaik kritik signals --domain AGT --surface ios`",
  "6. Score exactly these cells and no others:",
  '   - AGT-01 on ios: `arkaik kritik score AGT-01 ios <level> --evidence "<file:line …>" --audit 2026-11-zplan-1100-agt-ios`',
  '   - AGT-02 on ios: `arkaik kritik score AGT-02 ios <level> --evidence "<file:line …>" --audit 2026-11-zplan-1100-agt-ios`',
  '   - AGT-03 on ios: `arkaik kritik score AGT-03 ios <level> --evidence "<file:line …>" --audit 2026-11-zplan-1100-agt-ios`',
  '   - AGT-04 on ios: `arkaik kritik score AGT-04 ios <level> --evidence "<file:line …>" --audit 2026-11-zplan-1100-agt-ios`',
  '   - AGT-05 on ios: `arkaik kritik score AGT-05 ios <level> --evidence "<file:line …>" --audit 2026-11-zplan-1100-agt-ios`',
  '   - AGT-06 on ios: `arkaik kritik score AGT-06 ios <level> --evidence "<file:line …>" --audit 2026-11-zplan-1100-agt-ios`',
  '   - AGT-07 on ios: `arkaik kritik score AGT-07 ios <level> --evidence "<file:line …>" --audit 2026-11-zplan-1100-agt-ios`',
  '   - AGT-08 on ios: `arkaik kritik score AGT-08 ios <level> --evidence "<file:line …>" --audit 2026-11-zplan-1100-agt-ios`',
  "7. Open every finding on this part's audit: `arkaik kritik finding open <criterion> ios … --audit 2026-11-zplan-1100-agt-ios`. Give file-and-line evidence, and verify every Critical and High finding adversarially before you open it.",
  "",
  "8. Check that every part is scored: `arkaik kritik plan --status 2026-11-zplan-1100`",
  "9. Print this session's usage readout: model, tokens in and out, duration, number of agents.",
  "10. When every part is scored, run `arkaik kritik matrix 2026-11-zplan-1100 --record --plan`",
  "",
  "Not in this run (over budget):",
  "   - A11Y:android (2026-11-zplan-1100-a11y-android). Do not score it.",
].join("\n");

const firstDiff = (actual, expected) => {
  const a = actual.split("\n");
  const e = expected.split("\n");
  const at = a.findIndex((line, index) => line !== e[index]);
  const index = at === -1 ? Math.min(a.length, e.length) : at;
  return `line ${index + 1}\n  got:  ${JSON.stringify(a[index])}\n  want: ${JSON.stringify(e[index])}`;
};

// --- the record command ---------------------------------------------------------

check("the record command names the plan id and --plan", planRecordCommand(PLAN_ID) === "arkaik kritik matrix 2026-11-zplan-1100 --record --plan");

// --- snapshots ------------------------------------------------------------------

const partPrompt = renderPartPrompt({ planId: PLAN_ID, commit: COMMIT }, SEC_WEB);
check("the SEC:web part prompt matches its snapshot", partPrompt === SEC_WEB_PROMPT, firstDiff(partPrompt, SEC_WEB_PROMPT));

const planPrompt = renderPlanPrompt({ ...HEAD, parts: [SEC_WEB, AGT_IOS, A11Y_ANDROID] });
check("the combined prompt matches its snapshot", planPrompt === PLAN_PROMPT, firstDiff(planPrompt, PLAN_PROMPT));

// --- invariants -----------------------------------------------------------------

for (const part of [SEC_WEB, AGT_IOS]) {
  const prompt = renderPartPrompt({ planId: PLAN_ID, commit: COMMIT }, part);
  const scoreLines = prompt.split("\n").filter((line) => line.includes("kritik score"));
  check(`${part.domain}:${part.surface}: one score line per cell`, scoreLines.length === part.cells.length, scoreLines.join("\n"));
  check(
    `${part.domain}:${part.surface}: every score line passes --audit <partId>`,
    scoreLines.every((line) => line.includes(`--audit ${part.auditId}`)),
    scoreLines.join("\n"),
  );
  check(
    `${part.domain}:${part.surface}: the cells named are exactly the part's cells`,
    JSON.stringify(scoreLines.map((line) => line.trim().split(" ")[1])) === JSON.stringify(part.cells.map((cell) => cell.criterion_id)),
  );
  check(`${part.domain}:${part.surface}: a part prompt never records`, !prompt.includes("--record"));
  check(`${part.domain}:${part.surface}: findings open on the part's audit`, prompt.includes(`finding open <criterion> ${part.surface} … --audit ${part.auditId}`));
}

const planLines = planPrompt.split("\n");
const scoreLines = planLines.filter((line) => line.includes("kritik score"));
const auditOf = (line) => line.match(/--audit (\S+?)`/)?.[1];
check(
  "combined: every score line passes the audit of the part it sits under",
  scoreLines.length === 14 &&
    scoreLines.every((line) => auditOf(line) === (line.includes(" on web:") ? SEC_WEB.auditId : AGT_IOS.auditId)),
  scoreLines.join("\n"),
);
const recordLines = planLines.filter((line) => line.includes("--record"));
check("combined: --record appears exactly once", recordLines.length === 1, recordLines.join("\n"));
const numbered = planLines.filter((line) => /^\d+\. /.test(line));
check(
  "combined: --record sits in the last numbered step",
  numbered.at(-1) === recordLines[0] && recordLines[0].includes(HEAD.recordCommand),
  numbered.at(-1),
);
const deferredAt = planLines.indexOf("Not in this run (over budget):");
check(
  "combined: the deferred part is listed after the steps and never scored",
  deferredAt > planLines.indexOf(recordLines[0]) &&
    planLines[deferredAt + 1].includes(A11Y_ANDROID.auditId) &&
    !scoreLines.some((line) => line.includes("A11Y")),
);
check(
  "combined: the deferred part does not count in the header",
  planLines[0].includes(": 2 parts,"),
  planLines[0],
);

// --- what changes with the inputs -------------------------------------------------

const noGit = renderPartPrompt({ planId: PLAN_ID, commit: null }, SEC_WEB);
check("a null commit reads 'not a git checkout'", noGit.split("\n")[0].endsWith("in this repo (not a git checkout)."), noGit.split("\n")[0]);

const estimated = renderPartPrompt(
  { planId: PLAN_ID, commit: COMMIT },
  {
    ...SEC_WEB,
    estimate: {
      tokens: { low: 12000, mid: 20000, high: 30500 },
      usd: { low: 0.036, mid: 0.06, high: 0.0915 },
      inputs: { P: 1, B: 1, c: { low: 1, mid: 1, high: 1 }, q: { low: 1, mid: 1, high: 1 }, h: { low: 1, mid: 1, high: 1 }, V: { low: 1, mid: 1, high: 1 } },
      calibrated: false,
    },
  },
);
check(
  "an estimate adds one sentence to the scope line, tokens first, dollars when priced, uncalibrated said out loud",
  estimated.split("\n")[1] === "Scope: 6 cells, 36 checklist steps. Estimate: 12,000–30,500 tokens ($0.04–$0.09), uncalibrated.",
  estimated.split("\n")[1],
);
check("a counts-only part has no Estimate sentence", !partPrompt.includes("Estimate:"));

const single = renderPartPrompt({ planId: PLAN_ID, commit: COMMIT }, { ...SEC_WEB, cells: SEC_WEB.cells.slice(0, 1), steps: 1 });
check("one cell and one step read in the singular", single.split("\n")[1] === "Scope: 1 cell, 1 checklist step.", single.split("\n")[1]);

console.log(failures === 0 ? "\nAll Kritik plan prompt checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
```

In `package.json`, replace part 1's script:

```json
    "test:quality-plan": "node tests/schema/quality-plan.test.js",
```

with:

```json
    "test:quality-plan": "node tests/schema/quality-plan.test.js && node tests/schema/kritik-plan-prompt.test.js",
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node tests/schema/kritik-plan-prompt.test.js`
Expected: exit 1 with `TypeError: planRecordCommand is not a function` (the module does not exist, so `loadSchema()` exports nothing by that name).

- [ ] **Step 3: Write the renderer**

Check the names are free first (an `export *` duplicate fails `tsc`):

```bash
grep -n "planRecordCommand\|renderPartPrompt\|renderPlanPrompt" packages/schema/src/*.ts
```

Expected: no output.

Create `packages/schema/src/kritik-plan-prompt.ts`:

```ts
/**
 * The prompts a Kritik plan carries (docs/superpowers/specs/2026-11-11-kritik-planner-design.md
 * § Prompt template): one per part, for a session that runs that part alone,
 * and one for a session that runs every included part in order.
 *
 * A prompt is the whole interface between the planner and an agent, so it
 * names every cell and every command in full. Two invariants carry the plan's
 * safety and a test pins both: every `kritik score` line passes `--audit
 * <partId>` (without it a score lands in the newest audit on disk, which with
 * two parts in flight may be the other part), and only the combined prompt's
 * last step records — a part prompt never names `--record`, because a part
 * is half a reading.
 *
 * Pure and zod-free. Its top level holds only constants and function
 * declarations, so esbuild drops it from the plugin scripts that do not call it.
 */

import type { KritikPlan, KritikPlanBand, KritikPlanPart } from "./quality-plan";

/** A part as the renderers read it: everything but the prompt being rendered. */
type PromptPart = Omit<KritikPlanPart, "prompt">;

const THOUSANDS = /\B(?=(\d{3})+(?!\d))/g;

const SKILL_STEP =
  'Follow the Kritik skill (SKILL.md), section "A planned partial audit". Run it in the repository checkout: a hosted session cannot score a plan part.';

const USAGE_READOUT = "this session's usage readout: model, tokens in and out, duration, number of agents.";

/** The one command that records a plan, printed by `plan` and run once at the end. */
export function planRecordCommand(planId: string): string {
  return `arkaik kritik matrix ${planId} --record --plan`;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function tokenCount(value: number): string {
  return String(Math.round(value)).replace(THOUSANDS, ",");
}

function dollars(value: number): string {
  return `$${value.toFixed(2)}`;
}

/** `(commit <sha>)`, or what a plan made outside git says instead. */
function where(commit: string | null): string {
  return commit === null ? "not a git checkout" : `commit ${commit}`;
}

/** ` Estimate: … tokens …, uncalibrated.` — or nothing, for a counts-only plan. */
function estimateSentence(tokens: KritikPlanBand | null, usd: KritikPlanBand | null, calibrated: boolean): string {
  if (tokens === null) return "";
  const cost = usd === null ? "" : ` (${dollars(usd.low)}–${dollars(usd.high)})`;
  return ` Estimate: ${tokenCount(tokens.low)}–${tokenCount(tokens.high)} tokens${cost}${calibrated ? "" : ", uncalibrated"}.`;
}

function scopeSentence(cells: number, steps: number): string {
  return `${plural(cells, "cell")}, ${plural(steps, "checklist step")}`;
}

/** Steps `first` to `first + 2` of a part: the run sheet, the cells, the findings. */
function partSteps(part: PromptPart, first: number): string[] {
  const audit = `--audit ${part.auditId}`;
  return [
    `${first}. Get the run sheet: \`arkaik kritik signals --domain ${part.domain} --surface ${part.surface}\``,
    `${first + 1}. Score exactly these cells and no others:`,
    ...part.cells.map(
      (cell) =>
        `   - ${cell.criterion_id} on ${cell.surface}: \`arkaik kritik score ${cell.criterion_id} ${cell.surface} <level> --evidence "<file:line …>" ${audit}\``,
    ),
    `${first + 2}. Open every finding on this part's audit: \`arkaik kritik finding open <criterion> ${part.surface} … ${audit}\`. ` +
      `Give file-and-line evidence, and verify every Critical and High finding adversarially before you open it.`,
  ];
}

/** The prompt for one part, run in a session of its own. */
export function renderPartPrompt(plan: Pick<KritikPlan, "planId" | "commit">, part: Omit<KritikPlanPart, "prompt">): string {
  const estimate =
    part.estimate === null ? "" : estimateSentence(part.estimate.tokens, part.estimate.usd, part.estimate.calibrated);
  return [
    `Run part ${part.domain}:${part.surface} of Kritik plan ${plan.planId} in this repo (${where(plan.commit)}).`,
    `Scope: ${scopeSentence(part.cells.length, part.steps)}.${estimate}`,
    `Audit id for this part: ${part.auditId}`,
    "",
    `1. ${SKILL_STEP}`,
    ...partSteps(part, 2),
    "5. Do not record this part. The plan is recorded once, after every part is scored, with the plan's own command.",
    `6. Finish by printing ${USAGE_READOUT}`,
  ].join("\n");
}

/** The prompt for one session that runs every included part in order, then records the plan. */
export function renderPlanPrompt(
  plan: Omit<KritikPlan, "prompt" | "parts"> & { parts: readonly Omit<KritikPlanPart, "prompt">[] },
): string {
  const included = plan.parts.filter((part) => part.status === "included");
  const deferred = plan.parts.filter((part) => part.status === "deferred");
  const calibrated = included.every((part) => part.estimate?.calibrated === true);
  const lines = [
    `Run Kritik plan ${plan.planId} in this repo (${where(plan.commit)}): ${plural(included.length, "part")}, one after the other, in this session.`,
    `Scope: ${scopeSentence(plan.totals.cells, plan.totals.steps)}, of ${plan.totals.applicableCells} applicable cells.` +
      estimateSentence(plan.totals.tokens, plan.totals.usd, calibrated),
    "",
    `1. ${SKILL_STEP} Do not record a part on its own.`,
  ];
  let step = 2;
  for (const part of included) {
    lines.push(
      "",
      `Part ${part.domain}:${part.surface}, audit id ${part.auditId} (${scopeSentence(part.cells.length, part.steps)}):`,
      ...partSteps(part, step),
    );
    step += 3;
  }
  lines.push(
    "",
    `${step}. Check that every part is scored: \`arkaik kritik plan --status ${plan.planId}\``,
    `${step + 1}. Print ${USAGE_READOUT}`,
    `${step + 2}. When every part is scored, run \`${plan.recordCommand}\``,
  );
  if (deferred.length > 0) {
    lines.push(
      "",
      "Not in this run (over budget):",
      ...deferred.map((part) => `   - ${part.domain}:${part.surface} (${part.auditId}). Do not score it.`),
    );
  }
  return lines.join("\n");
}
```

In `packages/schema/src/index.ts`, directly after part 1's line `export * from "./quality-plan";`, add:

```ts
export * from "./kritik-plan-prompt";
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npm run test:quality-plan`
Expected: part 1's suite passes, then every `PASS:` line of the prompt suite, ending `All Kritik plan prompt checks passed.`; exit 0.

Run: `npx tsc --noEmit -p . && npm run lint`
Expected: no output from `tsc`, no lint errors.

- [ ] **Step 5: Commit**

```bash
git add packages/schema/src/kritik-plan-prompt.ts packages/schema/src/index.ts tests/schema/kritik-plan-prompt.test.js package.json
git commit -m "feat(kritik): render a plan's part prompts and its combined prompt" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Assemble a plan, read its progress

**Files:**
- Modify: `packages/schema/src/quality-plan.ts`
- Modify: `tests/schema/quality-plan.test.js`

- [ ] **Step 1: Write the failing test**

In `tests/schema/quality-plan.test.js` (part 1's suite), insert this block directly before the `// --- summary ---` comment, so its checks are counted before the suite's closing `console.log(…)` / `process.exit(…)`:

```js
// --- part 2: buildKritikPlan and planPartStatuses ----------------------------------
//
// Against the shipped pack, as the cells block above is: the plan a CLI run
// would build for SEC:web + AGT:ios on a Pebbles-like profile, and the
// progress a status read derives from each part's scores.
{
  const P2 = require("./load-schema").loadSchema();
  const PACK = require("../../packages/kritik-library/framework.json");
  const SURFACES = ["web", "ios", "android", "admin", "supabase"];
  const NOW = new Date(2026, 10, 11, 9, 30); // local time, as planId reads it: day 11
  const COMMIT = "3f9c2e1d4b5a69788796a5b4c3d2e1f0a9b8c7d6";
  const KNOWN = ["2026-08", "2026-11-scoped", "2026-11-sec-web"];
  const RUNS = [{ domain: "SEC", surface: "web" }, { domain: "AGT", surface: "ios" }];

  const plan = P2.buildKritikPlan({ library: PACK, surfaces: SURFACES, runs: RUNS, known: KNOWN, now: NOW, commit: COMMIT });

  check("buildKritikPlan: the plan id is the day's first that sorts last", plan.planId === "2026-11-zplan-1100", plan.planId);
  check(
    "buildKritikPlan: one included part per run, in run order, each with its own audit id",
    JSON.stringify(plan.parts.map((part) => [part.domain, part.surface, part.auditId, part.status])) ===
      JSON.stringify([
        ["SEC", "web", "2026-11-zplan-1100-sec-web", "included"],
        ["AGT", "ios", "2026-11-zplan-1100-agt-ios", "included"],
      ]),
    JSON.stringify(plan.parts.map((part) => part.auditId)),
  );
  check(
    "buildKritikPlan: SEC:web is 6 cells and 36 steps, AGT:ios 8 and 42",
    plan.parts[0].cells.length === 6 && plan.parts[0].steps === 36 && plan.parts[1].cells.length === 8 && plan.parts[1].steps === 42,
    JSON.stringify(plan.parts.map((part) => [part.cells.length, part.steps])),
  );
  check(
    "buildKritikPlan: the cells are planCells' cells",
    JSON.stringify(plan.parts.map((part) => part.cells)) ===
      JSON.stringify(RUNS.map((run) => P2.planCells(PACK, SURFACES, run).cells)),
  );
  check("buildKritikPlan: counts only — no estimate on any part", plan.parts.every((part) => part.estimate === null));
  check(
    "buildKritikPlan: totals sum the included parts and count the whole product",
    JSON.stringify(plan.totals) === JSON.stringify({ cells: 14, steps: 78, applicableCells: 338, tokens: null, usd: null }),
    JSON.stringify(plan.totals),
  );
  check(
    "buildKritikPlan: the header is the schema, the clock, the commit and the library's version",
    plan.schema === "arkaik.kritik.plan/1" &&
      plan.createdAt === NOW.toISOString() &&
      plan.commit === COMMIT &&
      plan.frameworkVersion === PACK.version &&
      plan.tier === null && plan.budgetTokens === null && plan.budgetUsd === null && plan.pricePerMTok === null,
  );
  check("buildKritikPlan: the record command names the plan", plan.recordCommand === "arkaik kritik matrix 2026-11-zplan-1100 --record --plan");
  check(
    "buildKritikPlan: each part carries the part prompt rendered from it",
    plan.parts.every(({ prompt, ...part }) => prompt === P2.renderPartPrompt({ planId: plan.planId, commit: COMMIT }, part)),
  );
  check(
    "buildKritikPlan: the plan carries the combined prompt",
    plan.prompt === P2.renderPlanPrompt({ ...plan, parts: plan.parts.map(({ prompt: _prompt, ...part }) => part) }),
  );
  check(
    "buildKritikPlan: every part id sorts after every known id",
    plan.parts.every((part) => KNOWN.every((id) => part.auditId > id)),
  );
  const parsed = P2.parseKritikPlan(JSON.parse(JSON.stringify(plan)));
  check("buildKritikPlan: the plan parses as written to disk", parsed.ok === true, parsed.ok ? "" : parsed.issue);
  check(
    "buildKritikPlan: a plan id already taken moves the counter",
    P2.buildKritikPlan({ library: PACK, surfaces: SURFACES, runs: RUNS, known: [...KNOWN, ...plan.parts.map((part) => part.auditId)], now: NOW, commit: null }).planId ===
      "2026-11-zplan-1101",
  );

  let zero;
  try {
    P2.buildKritikPlan({ library: PACK, surfaces: [...SURFACES, "cli"], runs: [{ domain: "SEC", surface: "cli" }], known: [], now: NOW, commit: null });
  } catch (error) {
    zero = error;
  }
  check(
    "buildKritikPlan: a part with no applicable cell is refused, naming the domain and the surface",
    zero instanceof Error && zero.message.includes('no SEC criterion applies to "cli"'),
    zero?.message,
  );

  // --- planPartStatuses ---

  const DEFERRED = {
    domain: "A11Y", surface: "android", auditId: "2026-11-zplan-1100-a11y-android",
    cells: [{ criterion_id: "A11Y-01", surface: "android" }], steps: 5, estimate: null, status: "deferred", prompt: "",
  };
  const parts = [...plan.parts, DEFERRED];
  const [sec, agt] = plan.parts;
  const score = (criterion_id, surface) => ({ criterion_id, surface });

  const fresh = P2.planPartStatuses({ parts }, {});
  check(
    "planPartStatuses: with no scores every included part is not started and misses every cell",
    JSON.stringify(fresh.map((status) => [status.auditId, status.progress, status.scored, status.cells, status.missing.length, status.stray.length])) ===
      JSON.stringify([
        [sec.auditId, "not started", 0, 6, 6, 0],
        [agt.auditId, "not started", 0, 8, 8, 0],
        [DEFERRED.auditId, "deferred", 0, 1, 1, 0],
      ]),
    JSON.stringify(fresh),
  );

  const mixed = P2.planPartStatuses(
    { parts },
    {
      [sec.auditId]: [score("SEC-01", "web"), score("PRV-01", "web"), score("SEC-05", "web"), score("PRV-01", "web")],
      [agt.auditId]: agt.cells.map((cell) => score(cell.criterion_id, cell.surface)),
      "2026-08": [score("SEC-04", "web")],
    },
  );
  check(
    "planPartStatuses: some plan cells scored is in progress, missing the rest in plan order",
    mixed[0].progress === "in progress" &&
      mixed[0].scored === 2 &&
      JSON.stringify(mixed[0].missing.map((cell) => cell.criterion_id)) === JSON.stringify(["SEC-04", "SEC-06", "SEC-07", "SEC-08"]),
    JSON.stringify(mixed[0]),
  );
  check(
    "planPartStatuses: a score outside the plan is a stray, listed once",
    JSON.stringify(mixed[0].stray) === JSON.stringify([{ criterion_id: "PRV-01", surface: "web" }]),
    JSON.stringify(mixed[0].stray),
  );
  check(
    "planPartStatuses: every plan cell scored is scored",
    mixed[1].progress === "scored" && mixed[1].scored === 8 && mixed[1].missing.length === 0,
    JSON.stringify(mixed[1]),
  );
  check("planPartStatuses: another audit's scores never count for a part", mixed[0].missing.some((cell) => cell.criterion_id === "SEC-04"));

  const strayOnly = P2.planPartStatuses({ parts: [sec] }, { [sec.auditId]: [score("PRV-01", "web")] });
  check(
    "planPartStatuses: a stray alone means the part was started",
    strayOnly[0].progress === "in progress" && strayOnly[0].scored === 0 && strayOnly[0].stray.length === 1,
    JSON.stringify(strayOnly[0]),
  );
}
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node tests/schema/quality-plan.test.js`
Expected: part 1's checks pass, then exit 1 with `TypeError: P2.buildKritikPlan is not a function`.

- [ ] **Step 3: Write the assembly and the progress reader**

At the top of `packages/schema/src/quality-plan.ts`:

1. Make sure `QualityAssessment` is imported as a type from `./quality`: add `type QualityAssessment` to part 1's existing import from `"./quality"` (per part 1's plan, `import { applicableCells, CROSS_SURFACE_ID, type KritikCriterion, type KritikLibrary } from "./quality";` becomes `import { applicableCells, CROSS_SURFACE_ID, type KritikCriterion, type KritikLibrary, type QualityAssessment } from "./quality";`).
2. Below part 1's imports, add:

```ts
import { planRecordCommand, renderPartPrompt, renderPlanPrompt } from "./kritik-plan-prompt";
```

(`kritik-plan-prompt.ts` imports `quality-plan.ts` for types only, so there is no runtime cycle.)

Then append at the end of the file:

```ts
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
```

- [ ] **Step 4: Run it and watch it pass, then regenerate the plugin scripts**

Run: `npm run test:quality-plan`
Expected: every check passes in both suites; exit 0.

Run: `npx tsc --noEmit -p . && npm run lint`
Expected: clean.

Trap (generated-artifact drift, contract correction from part 1): `plugin-kritik/skills/kritik/scripts/compute-matrix.js` and `detect-regressions.js` bundle `quality-plan.ts` through `quality-scope.ts`, and the minifier renames identifiers whenever that source changes, even though `buildKritikPlan`, `planPartStatuses` and the prompt module are tree-shaken out. So editing `quality-plan.ts` may change those scripts, and they are committed with the source change.

Run: `npm run generate && git status --porcelain`
Expected: this task's two files, plus any of `plugin-kritik/skills/kritik/scripts/compute-matrix.js` and `plugin-kritik/skills/kritik/scripts/detect-regressions.js` the regeneration changed (in a dry run against a stand-in for part 1 neither changed; with part 1's real code either may). Nothing else. Open a changed script's diff and confirm it is renamed identifiers only: a new string such as `zplan`, `Score exactly these cells` or `checklist step` in it means a top-level call slipped into `quality-plan.ts` or `kritik-plan-prompt.ts` and defeated tree-shaking; remove it and regenerate.

Run: `npm run test:kritik-plugin`
Expected: `All Kritik plugin tests passed`; exit 0.

- [ ] **Step 5: Commit**

Stage the source, the test, and whichever generated scripts `git status` listed (a path with no change stages nothing):

```bash
git add packages/schema/src/quality-plan.ts tests/schema/quality-plan.test.js plugin-kritik/skills/kritik/scripts/compute-matrix.js plugin-kritik/skills/kritik/scripts/detect-regressions.js
git commit -m "feat(kritik): assemble a counts-only plan and read each part's progress" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The plan file and `arkaik kritik plan`

`cli/kritik-plan.ts` is outside `load-schema.js`'s reach (`src/cli/` is not loaded), so it is tested through the built CLI here and the built MCP in Task 4.

**Files:**
- Create: `packages/schema/src/cli/kritik-plan.ts`
- Modify: `packages/cli/src/commands/kritik.ts`
- Create: `tests/cli/kritik-plan.test.js`
- Modify: `package.json`

- [ ] **Step 1: Write the failing test and wire it**

Create `tests/cli/kritik-plan.test.js`:

```js
#!/usr/bin/env node

/**
 * `arkaik kritik plan` end to end (docs/superpowers/specs/2026-11-11-kritik-planner-design.md):
 * acceptance steps 1 to 3 (a counts-only SEC:web plan, a part id that sorts
 * after every audit on disk, a prompt that names exactly its cells and never
 * records), every plan refusal in the spec's error table, the estimator flags
 * refused, `--json`, `--dry-run`, `--out` and `--status`.
 *
 * Drives the BUILT CLI in mkdtemp repos against the shipped criteria pack, like
 * kritik-scope.test.js beside it. The fixture is synthetic: a five-surface
 * profile like Pebbles', one recorded full audit of all 338 applicable cells
 * (generated from the pack, written as a file), plus a hand-named
 * `<month>-sec-web` and a `<month>-scoped` audit. Dates are computed, never
 * hard-coded, and plan ids are read back from `--json`.
 */

const { spawnSync } = require("child_process");
const { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } = require("fs");
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
const PACK = JSON.parse(readFileSync(path.join(ROOT, "packages", "kritik-library", "framework.json"), "utf8"));
const SURFACES = ["web", "ios", "android", "admin", "supabase"];

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

// The plan id is built from the local date, the way the CLI builds it.
const now = new Date();
const MONTH = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
const DAY = String(now.getDate()).padStart(2, "0");
const FIRST_PLAN = `${MONTH}-zplan-${DAY}00`;
const SECOND_PLAN = `${MONTH}-zplan-${DAY}01`;
const SEC_WEB = ["SEC-01", "SEC-04", "SEC-05", "SEC-06", "SEC-07", "SEC-08"];
const ESTIMATOR = (flag) => `kritik: --${flag} is not available yet — the estimator ships later, and every plan is counts-only for now.`;

const dirs = [];
function repo({ bundle = true, surfaces = SURFACES } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "arkaik-kritik-plan-"));
  dirs.push(dir);
  if (bundle) {
    mkdirSync(path.join(dir, "docs", "arkaik"), { recursive: true });
    writeFileSync(path.join(dir, "docs", "arkaik", "bundle.json"), BUNDLE);
  }
  const run = (args) => spawnSync(process.execPath, [CLI, "kritik", ...args], { encoding: "utf8", cwd: dir });
  if (surfaces !== null) {
    const profile = run(["profile", ...surfaces.flatMap((surface) => ["--surface", surface])]);
    if (profile.status !== 0) {
      failures++;
      console.log(`FAIL: setup — profile\n${profile.stderr}`);
    }
  }
  const plansDir = path.join(dir, "docs", "quality", "plans");
  const writeScores = (auditId, assessments, extra = {}) => {
    mkdirSync(path.join(dir, "docs", "quality", "audits", auditId), { recursive: true });
    writeFileSync(
      path.join(dir, "docs", "quality", "audits", auditId, "scores.json"),
      JSON.stringify({ audit_id: auditId, framework_version: PACK.version, ...extra, assessments }, null, 2),
    );
  };
  return { dir, run, plansDir, writeScores };
}

const assessment = (criterion_id, surface, auditId) => ({
  criterion_id, surface, level: 2, evidence: `${criterion_id}.ts:1`, audit_id: auditId, ts: "2026-08-20T00:00:00.000Z",
});
/** Every applicable cell of the shipped pack over the five surfaces: a full audit. */
const fullAudit = (auditId) =>
  applicableCells(PACK, SURFACES).flatMap(({ criterion_id, surfaces }) => surfaces.map((surface) => assessment(criterion_id, surface, auditId)));
const json = (result) => {
  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
};

try {
  // --- no profile --------------------------------------------------------------

  {
    const { run, plansDir } = repo({ surfaces: null });
    const noProfile = run(["plan", "--run", "SEC:web"]);
    check(
      "with no profile, plan refuses and points at `arkaik kritik profile`",
      noProfile.status === 1 && noProfile.stderr.includes("arkaik kritik profile") && !existsSync(plansDir),
      noProfile.stderr,
    );
  }

  // --- the fixture ---------------------------------------------------------------

  const { dir, run, plansDir, writeScores } = repo();
  const ok = (args, label) => {
    const result = run(args);
    if (result.status !== 0) {
      failures++;
      console.log(`FAIL: setup — ${label ?? args.join(" ")}\n${result.stderr}${result.stdout}`);
    }
    return result;
  };

  const full = fullAudit("2026-08");
  check("the fixture's full audit is 338 cells", full.length === 338, String(full.length));
  writeScores("2026-08", full, { commit: "abc1234" });
  ok(["matrix", "2026-08", "--record"]);
  writeScores(`${MONTH}-sec-web`, [assessment("SEC-01", "web", `${MONTH}-sec-web`)]);
  writeScores(`${MONTH}-scoped`, [assessment("SEC-04", "web", `${MONTH}-scoped`)], { scope: { since: "2026-08" } });

  // --- refusals: each exits 1 and writes nothing ---------------------------------------

  const help = run(["plan", "--help"]);
  check("plan --help prints its usage", help.status === 0 && help.stdout.includes("--run D:S") && help.stdout.includes("--status <id>"), help.stdout);

  const noRun = run(["plan"]);
  check("no --run is refused", noRun.status === 1 && noRun.stderr.includes("at least one --run"), noRun.stderr);

  for (const token of ["SEC", "SEC:", "SEC:web:x"]) {
    const bad = run(["plan", "--run", token]);
    check(`a malformed token (${token}) is refused, showing the token`, bad.status === 1 && bad.stderr.includes(token), bad.stderr);
  }

  const unknownDomain = run(["plan", "--run", "XYZ:web"]);
  check(
    "an unknown domain is refused, listing the codes",
    unknownDomain.status === 1 && unknownDomain.stderr.includes("XYZ") && unknownDomain.stderr.includes("A11Y") && unknownDomain.stderr.includes("AGT"),
    unknownDomain.stderr,
  );

  const unknownSurface = run(["plan", "--run", "SEC:api"]);
  check(
    "a surface the profile does not declare is refused, listing the profile's surfaces",
    unknownSurface.status === 1 && unknownSurface.stderr.includes("api") && unknownSurface.stderr.includes("supabase"),
    unknownSurface.stderr,
  );

  const wrongCase = run(["plan", "--run", "SEC:Web"]);
  check("a surface is matched literally: Web is not web", wrongCase.status === 1 && wrongCase.stderr.includes("Web"), wrongCase.stderr);

  const lens = run(["plan", "--run", "SEC:cross-surface"]);
  check("cross-surface is refused as a findings-only lens", lens.status === 1 && lens.stderr.includes("cross-surface") && lens.stderr.includes("lens"), lens.stderr);

  for (const flag of ["budget", "budget-tokens", "price", "tier"]) {
    const refused = run(["plan", "--run", "SEC:web", `--${flag}`, "5"]);
    check(`--${flag} is refused until the estimator ships`, refused.status === 1 && refused.stderr.trim() === ESTIMATOR(flag), refused.stderr);
  }

  const statusAndRun = run(["plan", "--status", FIRST_PLAN, "--run", "SEC:web"]);
  check("--status with --run is refused", statusAndRun.status === 1 && statusAndRun.stderr.includes("--status"), statusAndRun.stderr);

  check("no refusal wrote a plan", !existsSync(plansDir));

  // --- --dry-run --------------------------------------------------------------------

  const dry = run(["plan", "--run", "SEC:web", "--counts-only", "--dry-run"]);
  check(
    "--dry-run prints the plan and its prompt, and writes nothing",
    dry.status === 0 &&
      dry.stdout.includes(`Plan ${FIRST_PLAN}`) &&
      dry.stdout.includes("dry run — nothing written") &&
      dry.stdout.includes(`Run Kritik plan ${FIRST_PLAN}`) &&
      !existsSync(plansDir),
    dry.stdout + dry.stderr,
  );

  // --- acceptance step 1: a counts-only SEC:web plan -----------------------------------------

  const first = run(["plan", "--run", "SEC:web", "--counts-only", "--json"]);
  const plan = json(first);
  check("plan --json exits 0 and prints the plan", first.status === 0 && plan !== null, first.stdout + first.stderr);
  const planFile = path.join(plansDir, `${FIRST_PLAN}.json`);
  check("the plan is the day's first: <month>-zplan-<day>00", plan?.planId === FIRST_PLAN, plan?.planId);
  check(
    "it is written to docs/quality/plans/<planId>.json, exactly as printed",
    existsSync(planFile) && JSON.stringify(JSON.parse(readFileSync(planFile, "utf8"))) === JSON.stringify(plan),
  );
  const part = plan?.parts?.[0];
  check(
    "one part: SEC:web, 6 cells, 36 steps, included, no estimate",
    plan?.parts?.length === 1 &&
      part.domain === "SEC" && part.surface === "web" &&
      part.cells.length === 6 && part.steps === 36 &&
      part.status === "included" && part.estimate === null,
    JSON.stringify(part ?? null).slice(0, 300),
  );
  check(
    "the totals count the whole product: 6 of 338",
    plan?.totals?.cells === 6 && plan.totals.steps === 36 && plan.totals.applicableCells === 338 && plan.totals.tokens === null,
    JSON.stringify(plan?.totals),
  );
  check(
    "a plan made outside git carries no commit, and the library's version",
    plan?.commit === null && plan.frameworkVersion === PACK.version && plan.schema === "arkaik.kritik.plan/1",
  );
  check("the record command names the plan", plan?.recordCommand === `arkaik kritik matrix ${FIRST_PLAN} --record --plan`);

  // --- acceptance step 2: the part id sorts last ------------------------------------------------

  const partId = `${FIRST_PLAN}-sec-web`;
  check("the part's audit id is <planId>-sec-web", part?.auditId === partId, part?.auditId);
  const audits = readdirSync(path.join(dir, "docs", "quality", "audits"));
  check(
    "it sorts after every audit in the fixture, the hand-named and the scoped one included",
    audits.includes(`${MONTH}-sec-web`) && audits.includes(`${MONTH}-scoped`) && audits.every((id) => partId > id),
    audits.join(", "),
  );

  // --- acceptance step 3: the part prompt -----------------------------------------------------

  const scoreLines = (part?.prompt ?? "").split("\n").filter((line) => line.includes("kritik score"));
  check(
    "the part prompt names exactly the 6 cells",
    JSON.stringify(scoreLines.map((line) => line.trim().split(" ")[1])) === JSON.stringify(SEC_WEB),
    scoreLines.join("\n"),
  );
  check("every score line passes --audit <partId>", scoreLines.every((line) => line.includes(`--audit ${partId}`)), scoreLines.join("\n"));
  check("the part prompt never records", !(part?.prompt ?? "--record").includes("--record"));
  check(
    "the combined prompt records once, last",
    (plan?.prompt ?? "").split("--record").length === 2 && plan.prompt.trimEnd().endsWith(`\`${plan.recordCommand}\``),
  );

  // --- the human summary, a second plan, duplicates ------------------------------------------------

  const second = run(["plan", "--run", "SEC:web", "--run", "AGT:ios", "--run", "sec:web"]);
  check("a second plan the same day takes the next counter", second.status === 0 && second.stdout.includes(`Plan ${SECOND_PLAN}`), second.stdout + second.stderr);
  check(
    "the summary prints each part, the totals against the whole product, and the file it wrote",
    second.stdout.includes(`${SECOND_PLAN}-sec-web`) &&
      second.stdout.includes(`${SECOND_PLAN}-agt-ios`) &&
      second.stdout.includes("of 338 applicable cells") &&
      // tmpdir() may sit behind a symlink (macOS /var -> /private/var), so match the tail.
      second.stdout.includes(path.join("docs", "quality", "plans", `${SECOND_PLAN}.json`)) &&
      second.stdout.includes("  wrote "),
    second.stdout,
  );
  check("a duplicate --run is merged, with a note", second.stdout.includes("note:"), second.stdout);
  const secondPlan = JSON.parse(readFileSync(path.join(plansDir, `${SECOND_PLAN}.json`), "utf8"));
  check(
    "the duplicate collapsed: two parts, 14 cells, 78 steps",
    secondPlan.parts.length === 2 && secondPlan.totals.cells === 14 && secondPlan.totals.steps === 78,
    JSON.stringify(secondPlan.totals),
  );
  check(
    "the summary ends with the combined prompt and the record command",
    second.stdout.includes(secondPlan.prompt) && second.stdout.includes(`After every part is scored:  ${secondPlan.recordCommand}`),
  );

  // --- --out -------------------------------------------------------------------------------

  const outside = path.join(dir, "elsewhere", "plan.json");
  const out = run(["plan", "--run", "AGT:ios", "--out", outside]);
  const outPlan = existsSync(outside) ? JSON.parse(readFileSync(outside, "utf8")) : null;
  check(
    "--out writes the plan there, and says where it must be before recording",
    out.status === 0 && outPlan !== null && out.stdout.includes("move the file there before recording") &&
      !existsSync(path.join(plansDir, `${outPlan.planId}.json`)),
    out.stdout + out.stderr,
  );
  const outStatus = run(["plan", "--status", outPlan?.planId ?? "missing"]);
  check("--status reads only docs/quality/plans/", outStatus.status === 1 && outStatus.stderr.includes("no plan at"), outStatus.stderr);
  const outAgain = run(["plan", "--run", "AGT:ios", "--out", outside]);
  check("--out never overwrites a file", outAgain.status === 1 && outAgain.stderr.includes("already exists"), outAgain.stderr);

  // --- --status ------------------------------------------------------------------------------

  const statusJson = (id) => json(run(["plan", "--status", id, "--json"]));
  const fresh = statusJson(FIRST_PLAN);
  check(
    "--status: an unscored part is not started",
    fresh?.plan_id === FIRST_PLAN && fresh.recorded === false && fresh.parts[0].progress === "not started" && fresh.parts[0].scored === 0,
    JSON.stringify(fresh),
  );

  // Run the prompt's own score line, so its shape is proven to be a real command.
  const line = scoreLines[0];
  const [, criterion, surface, audit] = line.match(/arkaik kritik score (\S+) (\S+) <level> --evidence "<file:line …>" --audit (\S+)`/) ?? [];
  ok(["score", criterion, surface, "2", "--evidence", "app/auth.ts:12", "--audit", audit], "the prompt's first score line");
  ok(["score", "PRV-01", "web", "3", "--evidence", "app/privacy.ts:4", "--audit", partId], "a stray score");

  const started = statusJson(FIRST_PLAN);
  check(
    "--status: one plan cell scored is in progress, 1 of 6",
    started?.parts[0].progress === "in progress" && started.parts[0].scored === 1 && started.parts[0].missing.length === 5,
    JSON.stringify(started?.parts[0]),
  );
  check(
    "--status: a score outside the plan is reported as stray",
    JSON.stringify(started?.parts[0].stray) === JSON.stringify([{ criterion_id: "PRV-01", surface: "web" }]),
    JSON.stringify(started?.parts[0].stray),
  );
  const startedText = run(["plan", "--status", FIRST_PLAN]);
  check(
    "--status prints progress, the cells still to score, and the stray to remove",
    startedText.status === 0 &&
      startedText.stdout.includes("not recorded") &&
      startedText.stdout.includes("in progress") &&
      startedText.stdout.includes("1 of 6") &&
      startedText.stdout.includes("SEC-04 on web") &&
      startedText.stdout.includes("outside the plan") &&
      startedText.stdout.includes("PRV-01 on web"),
    startedText.stdout,
  );

  for (const id of SEC_WEB.slice(1)) ok(["score", id, "web", "3", "--evidence", `${id}.ts:1`, "--audit", partId], `score ${id}`);
  const partScores = path.join(dir, "docs", "quality", "audits", partId, "scores.json");
  const scoresFile = JSON.parse(readFileSync(partScores, "utf8"));
  writeFileSync(partScores, JSON.stringify({ ...scoresFile, assessments: scoresFile.assessments.filter((a) => a.criterion_id !== "PRV-01") }, null, 2));
  const done = run(["plan", "--status", FIRST_PLAN]);
  check(
    "--status: every plan cell scored and nothing stray says to record, naming the command",
    done.status === 0 && done.stdout.includes("scored") && done.stdout.includes("6 of 6") && done.stdout.includes("every part is scored") &&
      done.stdout.includes(`arkaik kritik matrix ${FIRST_PLAN} --record --plan`),
    done.stdout,
  );
  check("--status writes nothing", JSON.stringify(JSON.parse(readFileSync(planFile, "utf8"))) === JSON.stringify(plan));

  const missing = run(["plan", "--status", `${MONTH}-zplan-${DAY}77`]);
  check("--status on a plan that does not exist is refused", missing.status === 1 && missing.stderr.includes("no plan at"), missing.stderr);

  // Last in this repo: a plan file named past every counter blocks later plans.
  const brokenId = `${MONTH}-zplan-${DAY}99`;
  writeFileSync(path.join(plansDir, `${brokenId}.json`), JSON.stringify({ schema: "arkaik.kritik.plan/9" }));
  const broken = run(["plan", "--status", brokenId]);
  check(
    "a plan file that fails the schema is refused, naming the path and the issue",
    broken.status === 1 && broken.stderr.includes(`${brokenId}.json`) && broken.stderr.includes("schema"),
    broken.stderr,
  );

  // --- zero cells -----------------------------------------------------------------------------

  {
    const { run: runCli, plansDir: cliPlans } = repo({ surfaces: ["web", "cli"] });
    const zero = runCli(["plan", "--run", "SEC:cli"]);
    check(
      "a pair with no applicable cell is refused, naming the domain and the surface",
      zero.status === 1 && zero.stderr.includes('no SEC criterion applies to "cli"') && !existsSync(cliPlans),
      zero.stderr,
    );
  }

  // --- no counter sorts last -------------------------------------------------------------------

  {
    const { dir: late, run: runLate, plansDir: latePlans } = repo();
    const ahead = `${MONTH}-zzz`;
    mkdirSync(path.join(late, "docs", "quality", "audits", ahead), { recursive: true });
    const blocked = runLate(["plan", "--run", "SEC:web"]);
    check(
      "an audit directory past every counter is refused, naming the id that blocks the sort",
      blocked.status === 1 && blocked.stderr.includes(`"${ahead}"`) && !existsSync(latePlans),
      blocked.stderr,
    );

    // The same id, recorded in the journal but with no directory: still known.
    rmSync(path.join(late, "docs", "quality", "audits", ahead), { recursive: true, force: true });
    appendFileSync(
      path.join(late, "docs", "arkaik", "journal.jsonl"),
      `${JSON.stringify({ id: "01ZZZZZZZZZZZZZZZZZZZZZZZZ", ts: new Date().toISOString(), type: "quality.audit.completed", audit_id: ahead, framework_version: PACK.version, actor: "test" })}\n`,
    );
    const recordedBlock = runLate(["plan", "--run", "SEC:web"]);
    check(
      "a recorded audit id is known too, even with no directory",
      recordedBlock.status === 1 && recordedBlock.stderr.includes(`"${ahead}"`) && !existsSync(latePlans),
      recordedBlock.stderr,
    );
  }
} finally {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nAll kritik plan checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
```

In `package.json`, append the suite to the end of `test:cli`: the script currently ends

```
… && node tests/cli/kritik-scope.test.js && node tests/cli/quality-section-fold.test.js",
```

and becomes

```
… && node tests/cli/kritik-scope.test.js && node tests/cli/quality-section-fold.test.js && node tests/cli/kritik-plan.test.js",
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run build -w arkaik && node tests/cli/kritik-plan.test.js`
Expected: exit 1 with most checks failing — the first is `FAIL: with no profile, plan refuses and points at \`arkaik kritik profile\``, because the CLI answers every `plan` call with `kritik: unknown subcommand "plan"`.

- [ ] **Step 3: Write the file module and the verb**

Create `packages/schema/src/cli/kritik-plan.ts`:

```ts
/**
 * The plan file under `docs/quality/plans/<planId>.json` — making a plan from
 * the repo's files, writing it, reading it back, and reading each part's
 * progress from its audit directory (docs/superpowers/specs/2026-11-11-kritik-planner-design.md).
 *
 * The assembly is pure (`buildKritikPlan` in `quality-plan.ts`); this module is
 * the half that touches the disk and git. Like `kritik-audit.ts` beside it,
 * everything here **throws** rather than exiting: `arkaik kritik plan` turns a
 * throw into a usage-shaped failure and `kritik_plan` into a `ToolError`.
 *
 * A plan file is written once and never updated. Part status is derived from
 * the parts' audit directories on every read, so parallel sessions scoring
 * different parts never contend for the file.
 *
 * zod is allowed here (the stack contract): the plugin scripts never import
 * this module, and `kritik-audit.ts` must never import it — the dependency
 * runs one way, from here to there.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { KritikLibrary } from "../quality";
import {
  PLAN_PLANS_DIR,
  buildKritikPlan,
  parseRun,
  planPartStatuses,
  type KritikPlan,
  type PlanPartStatus,
} from "../quality-plan";
import { parseKritikPlan } from "../quality-schemas";
import { listAuditIds, loadScoresOrEmpty, requireProfile } from "./kritik-audit";
import { QUALITY_DIR, readJson, writeJson } from "./kritik-paths";

/** Where plan files live: `docs/quality/plans/`. */
export const plansDir = (root: string): string => join(root, QUALITY_DIR, PLAN_PLANS_DIR);

/** The one path `--status`, `matrix --plan` and `kritik_plan` read a plan from. */
export const planPath = (root: string, planId: string): string => join(plansDir(root), `${planId}.json`);

/** Every plan file's id (its basename without `.json`), sorted; `[]` when there is no plans directory. */
export function listPlanIds(root: string): string[] {
  const dir = plansDir(root);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json") && statSync(join(dir, name)).isFile())
    .map((name) => name.slice(0, -".json".length))
    .sort();
}

/** A plan file, parsed and checked against the schema. Throws `no plan at <path>` or `<path>: <issue>`. */
export function readPlanFile(path: string): KritikPlan {
  if (!existsSync(path)) throw new Error(`no plan at ${path}`);
  const parsed = parseKritikPlan(readJson<unknown>(path));
  if (!parsed.ok) throw new Error(`${path}: ${parsed.issue}`);
  return parsed.plan;
}

export function loadPlan(root: string, planId: string): KritikPlan {
  return readPlanFile(planPath(root, planId));
}

export function savePlan(path: string, plan: KritikPlan): void {
  writeJson(path, plan);
}

/** HEAD's full sha, or null outside a git checkout, without git, or on any other failure. */
export function gitHead(root: string): string | null {
  try {
    const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
    if (result.error !== undefined || result.status !== 0) return null;
    const sha = result.stdout.trim();
    return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
  } catch {
    return null;
  }
}

/**
 * A new plan from the repo as it stands: the profile's surfaces, the library's
 * domain codes, and every id the plan must sort after — audit directories, plan
 * files, and the recorded audit ids the caller read from its journal. Writes
 * nothing; the caller decides where (and whether) the plan goes.
 */
export function createPlan(
  root: string,
  library: KritikLibrary,
  runTokens: readonly string[],
  options: { recorded?: readonly string[]; now?: Date } = {},
): { plan: KritikPlan; warnings: string[] } {
  const profile = requireProfile(root);
  const surfaces = (profile.surfaces ?? []).map((surface) => surface.id);
  const { runs, warnings } = parseRun(runTokens, {
    domains: (library.domains ?? []).map((domain) => domain.code),
    surfaces,
  });
  const known = [...new Set([...listAuditIds(root), ...listPlanIds(root), ...(options.recorded ?? [])])];
  const plan = buildKritikPlan({
    library,
    surfaces,
    runs,
    known,
    now: options.now ?? new Date(),
    commit: gitHead(root),
  });
  return { plan, warnings };
}

/** Each part's progress, from the scores under its audit id in this checkout. */
export function planStatus(root: string, plan: KritikPlan): PlanPartStatus[] {
  const scoresByPart = Object.fromEntries(
    plan.parts.map((part) => [part.auditId, loadScoresOrEmpty(root, part.auditId).assessments]),
  );
  return planPartStatuses(plan, scoresByPart);
}
```

In `packages/cli/src/commands/kritik.ts`:

1. In the `from "@arkaik/schema"` import list, add `type KritikPlan,` after `type KritikLibrary,` and `type PlanPartStatus,` after `type MaturityLevel,`.

2. Replace

```ts
import { loadProfile, profilePath, writeJson } from "@arkaik/schema/src/cli/kritik-paths";
import { existsSync, readFileSync } from "node:fs";
```

with

```ts
import { loadProfile, profilePath, writeJson } from "@arkaik/schema/src/cli/kritik-paths";
import { createPlan, loadPlan, planPath, planStatus, savePlan } from "@arkaik/schema/src/cli/kritik-plan";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
```

3. In `USAGE`, after the `scope` line, add the `plan` line, so the block reads:

```
  scope                 The cells your resolved findings made stale since the last audit.
  plan --run <D:S>      Plan a partial audit: its parts, their cells, audit ids and prompts.
  issue <criterion>     Print the prefilled GitHub issue skeleton.
```

4. Insert this section directly before the line `// --- issue -------------------------------------------------------------------`:

```ts
// --- plan --------------------------------------------------------------------

const PLAN_USAGE = `arkaik kritik plan --run <DOMAIN:SURFACE> [--run …] [--out <path>] [--json] [--dry-run]
arkaik kritik plan --status <planId> [--json]

Plan a partial audit before you run it. Each --run is one part: a domain on one
surface, with an audit id of its own that sorts after every audit already on
disk, the exact cells it scores, and a prompt to paste into an agent session.
Run the parts in parallel sessions or one after the other, then record the plan
once, after every part is scored: \`arkaik kritik matrix <planId> --record --plan\`.

  --run D:S         One part: a domain code and a profile surface, e.g. SEC:web.
                    Repeatable; the order given is kept. The surface must match
                    a profile id exactly (web, never Web).
  --out <path>      Write the plan file here instead. --status and the record
                    step read only docs/quality/plans/<planId>.json, so move it
                    there before recording.
  --json            Print the plan file instead of the summary.
  --dry-run         Print the plan, write nothing.
  --counts-only     Accepted. Every plan counts cells and checklist steps only.
  --status <id>     Read-only: each part's progress (not started, in progress,
                    scored) from its audit directory, and any score outside the plan.

--budget, --budget-tokens, --price and --tier arrive with the estimator. Until
then they are refused.

Writes docs/quality/plans/<planId>.json`;

/** The flags the estimator will read. Parsed so a script that passes one fails loudly instead of being ignored. */
const ESTIMATOR_FLAGS = ["budget", "budget-tokens", "price", "tier"] as const;

/** Recorded audit ids from the journal, or none without one: a plan reads them only to sort after them. */
function recordedIdsOf(common: CommonOptions): string[] {
  const journal = resolveJournal(common.root, common.bundlePath);
  return journal.present ? recordedAuditIds(readFullJournalEvents(journal.journalPath)) : [];
}

/** A plain aligned table, two spaces in, three between columns; numeric columns right-aligned. */
function alignedTable(rows: string[][], numeric: readonly number[] = []): string[] {
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)));
  return rows.map((row) =>
    `  ${row.map((cell, column) => (numeric.includes(column) ? cell.padStart(widths[column]) : cell.padEnd(widths[column]))).join("   ")}`.trimEnd(),
  );
}

function printPlanStatus(plan: KritikPlan, statuses: PlanPartStatus[], recorded: boolean): void {
  console.log(`\n  Plan ${plan.planId} — ${recorded ? "recorded" : "not recorded"}\n`);
  const rows = [
    ["part", "audit id", "progress", "scored"],
    ...statuses.map((status) => [
      `${status.domain}:${status.surface}`,
      status.auditId,
      status.progress,
      `${status.scored} of ${status.cells}`,
    ]),
  ];
  for (const line of alignedTable(rows)) console.log(line);

  const cellList = (cells: readonly { criterion_id: string; surface: string }[]) =>
    cells.map((cell) => `${cell.criterion_id} on ${cell.surface}`).join(", ");
  const notes: string[] = [];
  for (const status of statuses) {
    if (status.progress === "in progress" && status.missing.length > 0) {
      notes.push(`${status.domain}:${status.surface} still to score: ${cellList(status.missing)}`);
    }
    if (status.stray.length > 0) {
      notes.push(`${status.domain}:${status.surface} outside the plan, remove before recording: ${cellList(status.stray)}`);
    }
  }
  if (notes.length > 0) console.log("");
  for (const note of notes) console.log(`  ${note}`);

  const included = statuses.filter((status) => status.progress !== "deferred");
  const done = included.filter((status) => status.progress === "scored").length;
  const clean = included.every((status) => status.stray.length === 0);
  if (recorded) {
    console.log(`\n  recorded — to correct it, make a new plan for the same parts.\n`);
  } else if (done === included.length && clean) {
    console.log(`\n  every part is scored — record it once:  ${plan.recordCommand}\n`);
  } else {
    console.log(`\n  ${done} of ${included.length} part${included.length === 1 ? "" : "s"} scored — record once every part is scored:  ${plan.recordCommand}\n`);
  }
}

function printPlanSummary(plan: KritikPlan, warnings: readonly string[], written: string | null, home: string): void {
  const commit = plan.commit === null ? "not a git checkout" : `@ ${plan.commit.slice(0, 7)}`;
  console.log(`\n  Plan ${plan.planId}   ${commit}   framework ${plan.frameworkVersion}\n`);
  const rows = [
    ["part", "audit id", "cells", "steps", "status"],
    ...plan.parts.map((part) => [`${part.domain}:${part.surface}`, part.auditId, String(part.cells.length), String(part.steps), part.status]),
    ["total", "", String(plan.totals.cells), String(plan.totals.steps), `of ${plan.totals.applicableCells} applicable cells`],
  ];
  for (const line of alignedTable(rows, [2, 3])) console.log(line);
  console.log(`\n  counts only: cells and checklist steps. The token estimate ships with the estimator.`);
  for (const warning of warnings) console.log(`  note: ${warning}`);
  if (written === null) {
    console.log(`  dry run — nothing written`);
  } else {
    console.log(`  wrote ${written}`);
    if (resolve(written) !== resolve(home)) {
      console.log(`  --status and the record step read only ${home} — move the file there before recording.`);
    }
  }
  console.log(`\nPaste into one agent session. For one session per part, each part's own prompt is parts[].prompt in the plan file (--json prints it).\n`);
  console.log(plan.prompt);
  console.log(`\nAfter every part is scored:  ${plan.recordCommand}\n`);
}

function runPlan(args: string[], common: CommonOptions): void {
  const { single, many, flags } = collect(args, ["run"], ["json", "dry-run", "counts-only"]);
  if (flags.has("help")) {
    console.log(PLAN_USAGE);
    process.exit(0);
  }
  for (const flag of ESTIMATOR_FLAGS) {
    if (single[flag] !== undefined) {
      fail(`kritik: --${flag} is not available yet — the estimator ships later, and every plan is counts-only for now.`);
    }
  }

  if (single.status !== undefined) {
    if (many.run.length > 0 || single.out !== undefined || flags.has("dry-run")) {
      fail(`kritik: --status reads a plan that exists — it takes no --run, --out or --dry-run.\n\n${PLAN_USAGE}`);
    }
    let plan: KritikPlan;
    let statuses: PlanPartStatus[];
    try {
      plan = loadPlan(common.root, single.status);
      statuses = planStatus(common.root, plan);
    } catch (error) {
      return fail(`kritik: ${(error as Error).message}`);
    }
    const recorded = recordedIdsOf(common).includes(plan.planId);
    if (flags.has("json")) {
      console.log(JSON.stringify({ plan_id: plan.planId, recorded, parts: statuses }, null, 2));
    } else {
      printPlanStatus(plan, statuses, recorded);
    }
    process.exit(0);
  }

  if (many.run.length === 0) fail(`kritik: at least one --run DOMAIN:SURFACE is required\n\n${PLAN_USAGE}`);

  const library = loadLibraryOrFail(common.root);
  let created: ReturnType<typeof createPlan>;
  try {
    created = createPlan(common.root, library, many.run, { recorded: recordedIdsOf(common) });
  } catch (error) {
    return fail(`kritik: ${(error as Error).message}`);
  }
  const { plan, warnings } = created;
  const home = planPath(common.root, plan.planId);
  const target = single.out ?? home;

  let written: string | null = null;
  if (!flags.has("dry-run")) {
    if (single.out !== undefined && existsSync(target)) {
      fail(`kritik: ${target} already exists — a plan file is written once. Pick another --out.`);
    }
    savePlan(target, plan);
    written = target;
  }

  if (flags.has("json")) {
    console.log(JSON.stringify(plan, null, 2));
    for (const warning of warnings) console.error(`note: ${warning}`);
    if (written !== null) {
      console.error(`wrote ${written}`);
      if (resolve(written) !== resolve(home)) {
        console.error(`--status and the record step read only ${home} — move the file there before recording.`);
      }
    }
  } else {
    printPlanSummary(plan, warnings, written, home);
  }
  process.exit(0);
}
```

5. In `runKritik`'s `switch`, after `case "scope": return runScope(subArgs, common);`, add:

```ts
    case "plan":
      return runPlan(subArgs, common);
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npm run test:cli`
Expected: every suite passes, the last printing `All kritik plan checks passed.`; exit 0.

Run: `npx tsc --noEmit -p . && npm run lint`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/schema/src/cli/kritik-plan.ts packages/cli/src/commands/kritik.ts tests/cli/kritik-plan.test.js package.json
git commit -m "feat(cli): arkaik kritik plan — the plan file, its prompts, --json, --dry-run, --out and --status" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `kritik_plan` over MCP

**Files:**
- Modify: `packages/mcp/src/kritik-tools.ts`
- Modify: `tests/mcp/kritik-tools.test.js`, `tests/mcp/run-mcp-tests.js`
- Modify: `docs/spec/mcp.md`

- [ ] **Step 1: Write the failing tests**

In `tests/mcp/run-mcp-tests.js`, replace

```js
  // 16 graph tools + 12 kritik_* (docs/spec/mcp.md § Tool Catalog).
  check("tools/list exposes the 29-tool catalog", toolNames.length === 29, toolNames.join(", "));
```

with

```js
  // 16 graph tools + 14 kritik_* (docs/spec/mcp.md § Tool Catalog).
  check("tools/list exposes the 30-tool catalog", toolNames.length === 30, toolNames.join(", "));
```

In `tests/mcp/kritik-tools.test.js`:

1. Replace `const { spawn } = require("child_process");` with `const { spawn, spawnSync } = require("child_process");`.
2. After the `const SERVER = …;` line, add:

```js
// The CLI, for the kritik_plan parity check — test:mcp builds it first (arkaik/io lives in it).
const CLI = path.join(ROOT, "packages", "cli", "dist", "index.js");
```

3. In the catalog list (the `for (const name of [` array that ends with `"kritik_scope",`), add `"kritik_plan",` after `"kritik_scope",`.
4. In the repo session, insert this block directly before the line `    // --- the whole journal -----------------------------------------------------`:

```js
    // --- kritik_plan --------------------------------------------------------------
    //
    // The same plan file `arkaik kritik plan` writes, from the same shared
    // function: compared field for field with the CLI's, run in this very repo,
    // except the plan id (the CLI's comes after the file this tool wrote),
    // createdAt and commit.

    const planDef = (listed.result?.tools ?? []).find((tool) => tool.name === "kritik_plan");
    check(
      "kritik_plan takes runs, dry_run and status, and nothing else",
      JSON.stringify(Object.keys(planDef?.inputSchema?.properties ?? {}).sort()) === JSON.stringify(["dry_run", "runs", "status"]) &&
        planDef.inputSchema.additionalProperties === false,
      JSON.stringify(planDef?.inputSchema),
    );

    const journalBeforePlan = session.journal().length;
    const dryPlan = await session.call("kritik_plan", { runs: ["SEC:web"], dry_run: true });
    check(
      "kritik_plan dry_run=true returns the plan and writes nothing",
      !dryPlan.isError && dryPlan.json.written === false && dryPlan.json.plan.parts.length === 1 && !existsSync(dryPlan.json.path),
      dryPlan.text.slice(0, 300),
    );

    const made = await session.call("kritik_plan", { runs: ["SEC:web", "sec:web"] });
    const madePlan = made.json.plan;
    check(
      "kritik_plan writes docs/quality/plans/<planId>.json and returns it",
      !made.isError &&
        made.json.written === true &&
        made.json.path.endsWith(path.join("docs", "quality", "plans", `${madePlan.planId}.json`)) &&
        JSON.stringify(session.readJson("docs", "quality", "plans", `${madePlan.planId}.json`)) === JSON.stringify(madePlan),
      made.text.slice(0, 300),
    );
    check(
      "a duplicate run collapses into one part, with a warning",
      madePlan?.parts.length === 1 && madePlan.parts[0].cells.length === 6 && made.json.warnings.length === 1,
      JSON.stringify(made.json.warnings),
    );
    check("kritik_plan appends nothing to the journal", session.journal().length === journalBeforePlan);

    const cliPlan = spawnSync(process.execPath, [CLI, "kritik", "plan", "--run", "SEC:web", "--run", "sec:web", "--dry-run", "--json"], {
      cwd: session.dir,
      encoding: "utf8",
    });
    const normalize = (plan) => JSON.stringify({ ...plan, createdAt: null, commit: null }).split(plan.planId).join("<planId>");
    let cliJson = null;
    try {
      cliJson = JSON.parse(cliPlan.stdout);
    } catch {
      // reported by the check below
    }
    check(
      "kritik_plan writes the same plan as the CLI, but for planId, createdAt and commit",
      cliPlan.status === 0 && cliJson !== null && cliJson.planId !== madePlan.planId && normalize(cliJson) === normalize(madePlan),
      cliPlan.stderr || cliPlan.stdout.slice(0, 300),
    );

    const partId = madePlan.parts[0].auditId;
    const notStarted = await session.call("kritik_plan", { status: madePlan.planId });
    check(
      "kritik_plan status reads each part's progress from its audit directory",
      !notStarted.isError &&
        notStarted.json.plan_id === madePlan.planId &&
        notStarted.json.recorded === false &&
        notStarted.json.parts[0].auditId === partId &&
        notStarted.json.parts[0].progress === "not started",
      notStarted.text.slice(0, 300),
    );
    const intoPart = await session.call("kritik_score", { criterion_id: "SEC-01", surface: "web", level: 2, evidence: "middleware.ts:14", audit_id: partId });
    check("kritik_score with the part's audit_id lands in the part", !intoPart.isError && intoPart.json.audit_id === partId, intoPart.text.slice(0, 300));
    const inProgress = await session.call("kritik_plan", { status: madePlan.planId });
    check(
      "and the part reads in progress, 1 of 6",
      inProgress.json.parts?.[0]?.progress === "in progress" && inProgress.json.parts[0].scored === 1 && inProgress.json.parts[0].missing.length === 5,
      inProgress.text.slice(0, 300),
    );

    const noRuns = await session.call("kritik_plan", { runs: [] });
    check("kritik_plan without runs is an actionable tool error", noRuns.isError && /runs/.test(noRuns.json.message), noRuns.text);
    const badSurfacePlan = await session.call("kritik_plan", { runs: ["SEC:android"] });
    check(
      "kritik_plan refuses a surface the profile does not declare, listing the profile's",
      badSurfacePlan.isError && badSurfacePlan.json.message.includes("android") && badSurfacePlan.json.message.includes("supabase"),
      badSurfacePlan.text,
    );
    const noSuchPlan = await session.call("kritik_plan", { status: "2026-11-zplan-1199" });
    check("kritik_plan status on a missing plan names the path it read", noSuchPlan.isError && noSuchPlan.json.message.includes("no plan at"), noSuchPlan.text);
    const both = await session.call("kritik_plan", { runs: ["SEC:web"], status: madePlan.planId });
    check("kritik_plan refuses runs and status together", both.isError && /status/.test(both.json.message), both.text);
```

5. In the hosted session, insert directly before `    const tripSignalRefused = await hosted.call("kritik_trip_signal", …`:

```js
    const planRefused = await hosted.call("kritik_plan", { runs: ["SEC:web"] });
    check(
      "kritik_plan refuses in hosted mode, saying a part needs a checkout",
      planRefused.isError && /checkout/.test(planRefused.text) && /hosted project/.test(planRefused.text),
      planRefused.text.slice(0, 300),
    );

```

- [ ] **Step 2: Run them and watch them fail**

Run: `npm run build -w arkaik && npm run build -w arkaik-mcp && node tests/mcp/run-mcp-tests.js`
Expected: `FAIL: tools/list exposes the 30-tool catalog` (29 tools); exit 1.

Run: `node tests/mcp/kritik-tools.test.js`
Expected: `FAIL: catalog includes kritik_plan` and `FAIL: kritik_plan takes runs, dry_run and status, and nothing else`, then the run stops with a `TypeError` inside the kritik_plan block (the tool is unknown, so `made.json.plan` is undefined); exit 1.

- [ ] **Step 3: Write the tool and its documentation**

In `packages/mcp/src/kritik-tools.ts`, after the line `import { loadProfile } from "@arkaik/schema/src/cli/kritik-paths";`, add:

```ts
import { createPlan, loadPlan, planPath, planStatus, savePlan } from "@arkaik/schema/src/cli/kritik-plan";
```

Then insert this tool directly before the `kritik_issue` tool (the `  tool(` whose definition has `name: "kritik_issue"`):

```ts
  tool(
    {
      name: "kritik_plan",
      description:
        "Plan a partial audit before running it: one part per DOMAIN:SURFACE in runs (e.g. SEC:web), each with its own audit id that sorts after every audit on disk, the exact cells it scores, its checklist step count, and a prompt to paste into an agent session — plus one combined prompt for a session that runs every part in order. Writes docs/quality/plans/<planId>.json (dry_run=true writes nothing) and returns the plan, the path and any warnings; the same plan file `arkaik kritik plan` writes. Counts only: no token estimate yet. With status=<planId> it instead reads each part's progress from its audit directory (not started, in progress, scored; cells still missing; scores outside the plan, which block the record) and writes nothing. Score every cell with kritik_score and audit_id=<the part's audit id>; never record a part on its own — the plan is recorded once, after every part is scored, with `arkaik kritik matrix <planId> --record --plan`. Repo sessions only: a part is scored against a checkout.",
      inputSchema: {
        type: "object",
        properties: {
          runs: {
            type: "array",
            items: { type: "string" },
            description: "One DOMAIN:SURFACE per part, e.g. [\"SEC:web\", \"AGT:ios\"]. The order is kept. Required unless status is given.",
          },
          dry_run: { type: "boolean", description: "Build and return the plan, write nothing. Default: false." },
          status: { type: "string", description: "A plan id: return each part's progress instead of making a plan. Read-only." },
        },
        additionalProperties: false,
      },
    },
    async (args) => {
      const root = repoRootOf(
        ctx,
        "A plan's parts are audits under docs/quality/audits/, scored against a checkout.",
      );
      const graph = await load();
      const recorded = recordedAuditIds(graph.journal);

      if (args.status !== undefined) {
        const planId = requireString(args, "status");
        if (args.runs !== undefined) {
          throw new ToolError("status reads a plan that exists — pass runs or status, not both.");
        }
        try {
          const plan = loadPlan(root, planId);
          return { plan_id: plan.planId, recorded: recorded.includes(plan.planId), parts: planStatus(root, plan) };
        } catch (error) {
          throw new ToolError((error as Error).message);
        }
      }

      const runs = args.runs;
      if (!Array.isArray(runs) || runs.length === 0 || runs.some((run) => typeof run !== "string")) {
        throw new ToolError("`runs` is required: one DOMAIN:SURFACE string per part, e.g. [\"SEC:web\"].");
      }
      const library = libraryOf(root);
      let created: ReturnType<typeof createPlan>;
      try {
        created = createPlan(root, library, runs as string[], { recorded });
      } catch (error) {
        throw new ToolError((error as Error).message);
      }
      const path = planPath(root, created.plan.planId);
      const written = args.dry_run !== true;
      if (written) savePlan(path, created.plan);
      return { plan: created.plan, path, written, warnings: created.warnings };
    },
  );
```

In `docs/spec/mcp.md`:

1. Replace `Twelve \`kritik_*\` tools mirror the \`arkaik kritik\` verbs` with `Fourteen \`kritik_*\` tools mirror the \`arkaik kritik\` verbs` (thirteen exist today; this adds the fourteenth).
2. Add this row directly after the `kritik_scope` row of the quality tools table:

```markdown
| `kritik_plan` | `runs?`, `dry_run?`, `status?` | a counts-only plan for a partial audit, the same file `arkaik kritik plan` writes: one part per `DOMAIN:SURFACE` in `runs` (order kept, duplicates merged with a warning), each with its own audit id sorting after every audit on disk, its cells, its checklist step count and a prompt to paste, plus a combined prompt and the record command. Written to `docs/quality/plans/<planId>.json` unless `dry_run`; returns `{plan, path, written, warnings}`. With `status: <planId>` instead it writes nothing and returns `{plan_id, recorded, parts}`: each part's `progress` (`not started`, `in progress`, `scored`), its `missing` cells and its `stray` scores, read from the part's audit directory. Counts only: no estimate and no budget yet. Repo sessions only — a part is scored against a checkout | — |
```

3. Replace

```markdown
`kritik_signals`, `kritik_trip_signal` and `kritik_open_finding` — a signal is checked against the
repo, and a new finding cites code — and a **comprehensive** audit
```

with

```markdown
`kritik_signals`, `kritik_trip_signal`, `kritik_open_finding` and `kritik_plan` — a signal is checked
against the repo, a new finding cites code, and a plan's parts are scored in one — and a **comprehensive** audit
```

- [ ] **Step 4: Run them and watch them pass**

Run: `npm run test:mcp`
Expected: every suite passes, ending `All Kritik MCP tests passed`; exit 0. The parity check (`kritik_plan writes the same plan as the CLI, but for planId, createdAt and commit`) runs the built CLI in the session's repo.

Run: `npx tsc --noEmit -p . && npm run lint`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/mcp/src/kritik-tools.ts tests/mcp/kritik-tools.test.js tests/mcp/run-mcp-tests.js docs/spec/mcp.md
git commit -m "feat(mcp): kritik_plan, the same plan file over MCP in repo sessions" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The planned partial audit in the Kritik skill

Every prompt's step 1 sends the agent to the skill's section "A planned partial audit", so the section must exist in the shipped skill before the prompts do. The test that catches a skill edit without a regeneration is `kritik-plugin.test.js`'s byte-for-byte copy check.

**Files:**
- Modify: `docs/kritik-skill/skill.md`
- Regenerate: `plugin-kritik/skills/kritik/SKILL.md`

- [ ] **Step 1: Edit the skill source**

In `docs/kritik-skill/skill.md`, under `## Scoping a run`, replace the end of the partial-audit bullet:

```markdown
  you did not look at gets no row** — leaving it out reads as "not assessed",
  while inventing a level reads as fact and is worse than silence.

Either way, say which you did when you report back.
```

with

````markdown
  you did not look at gets no row** — leaving it out reads as "not assessed",
  while inventing a level reads as fact and is worse than silence. To run one on
  purpose and record it as one reading, plan it (see "A planned partial audit"
  below).

Either way, say which you did when you report back.

### A planned partial audit

When you pick the corner before you start (Security on web, agents on iOS), plan
it first. The plan names the run, counts its cells, and gives every part an audit
id of its own that sorts after every audit already on disk, so its fresh scores
win the merge.

```
arkaik kritik plan --run SEC:web --run AGT:ios
```

Each `--run` is one **part**: a domain code, then a surface id spelled exactly as
the profile spells it (`web`, never `Web`). The command prints each part's cells
and checklist steps against the whole product's applicable cells, writes
`docs/quality/plans/<planId>.json`, and prints a prompt to paste. `--dry-run`
looks without writing; `--json` prints the plan file itself. Over MCP in a repo
session it is `kritik_plan` with `runs: ["SEC:web", "AGT:ios"]`. Every plan
counts cells only for now: there is no token estimate yet, and `--budget` is
refused.

Then run it one of two ways:

- **One session per part**, in parallel if you like. Give each session its part's
  own prompt (`parts[].prompt` in the plan file). Parts never share an audit id,
  so two sessions cannot collide on a score or a finding id.
- **One session for every part.** Paste the combined prompt the command printed.
  It runs the parts in order and records at the end.

If you were handed one of those prompts, you are the auditor. Run steps 2 to 5 of
*Running an audit* on the cells it lists, and nothing else: the plan already
pinned the commit and named the audit. Four rules on top:

- **Always pass the part's id.** Every `score` and every `finding open` carries
  `--audit <partId>`, the id the prompt names (`kritik_score` and
  `kritik_open_finding` take it as `audit_id`). Without it, `score` writes into
  the newest audit on disk, which with two parts in flight may be the other part.
- **Score exactly the listed cells.** A score outside the plan's cells blocks the
  record until it is removed: the merge reads every audit directory, so a stray
  score would enter the matrix anyway.
- **Never record a part.** Not `arkaik kritik matrix <partId> --record`, and not
  `kritik_matrix` with a part's `audit_id` and `record: true`. A part is half a
  reading. The plan is recorded once, after every part is scored, with the
  command it prints: `arkaik kritik matrix <planId> --record --plan`.
- **End with the usage readout** the prompt asks for (model, tokens in and out,
  duration, number of agents). It is what a future estimate is calibrated from.

`arkaik kritik plan --status <planId>` (over MCP, `kritik_plan` with `status`)
reads each part's audit directory and says whether it is not started, in progress
or scored, which cells are still missing, and any score outside the plan. It
writes nothing. Run it before recording. Status and the record read only the
current checkout: a part scored in another git worktree left its scores there, so
copy them over first.

A plan runs in the repository. A hosted session cannot take a part: hosted
scoring is scoped re-audits only, and a part's prompt says so.
````

The new subsection ends directly before `## Reporting back`. Leave the frontmatter `version: 0.7.0` alone: part 4 bumps it.

- [ ] **Step 2: Run the plugin suite and watch it fail**

Run: `npm run test:kritik-plugin`
Expected: `FAIL: the shipped skill is a byte-for-byte copy of its canonical source`; exit 1.

- [ ] **Step 3: Regenerate**

Run: `npm run generate && git status --porcelain`
Expected: exactly two modified files, `docs/kritik-skill/skill.md` and `plugin-kritik/skills/kritik/SKILL.md`. `plugin-kritik/.claude-plugin/plugin.json` stays at `0.7.0`, and no script under `plugin-kritik/skills/kritik/scripts/` changes (Task 2 already committed what editing `quality-plan.ts` regenerated). If a script does change here, a later task touched a module the scripts bundle: commit it with this task and say so in the PR.

- [ ] **Step 4: Run the plugin suite and watch it pass**

Run: `npm run test:kritik-plugin`
Expected: `All Kritik plugin tests passed`; exit 0.

- [ ] **Step 5: Commit**

```bash
git add docs/kritik-skill/skill.md plugin-kritik/skills/kritik/SKILL.md
git commit -m "docs(kritik): the planned partial audit in the Kritik skill" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Part done when

All of these pass on `feat/kritik-plan-cli`, with part 1 below it:

```bash
npm run test:quality-plan
npm run test:quality-scope
npm run test:quality-baseline
npm run test:quality
npm run test:quality-events
npm run test:kritik-plugin
npm run test:schema
npm run test:cli
npm run test:mcp
npm run lint
npx tsc --noEmit -p .
npm run generate && git status --porcelain   # prints nothing: every regenerated file is committed
```

- The generated files this part changed are committed in the same commit as the source that changed them: `plugin-kritik/skills/kritik/SKILL.md` (Task 5) and, if regeneration touched them, `compute-matrix.js` / `detect-regressions.js` (Task 2). `git diff feat/kritik-plan-schema --stat -- plugin-kritik` lists nothing else.
- No version moved: `packages/cli/package.json`, `packages/mcp/package.json` and the skill frontmatter are as part 1 left them.
- `matrix`, `scope`, `trend`, `regressions`, `quality-scope.ts` and `quality-trend.ts` are untouched (`git diff feat/kritik-plan-schema --stat` lists none of them).

**PR:** submit with `gh stack` (the `gh-stack` skill). Title:

```
feat(kritik): plan a partial audit — arkaik kritik plan and kritik_plan (part 2/4)
```

Say in the body that the printed record command (`arkaik kritik matrix <planId> --record --plan`) lands in part 4 and that the stack merges as a unit. Include this section, as is:

````markdown
## Lab Note

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
````

End the body with the attribution line `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. After opening the PR, read its comments: the Lab Note reminder comments there if the note does not parse, and clears its own comment once the body is fixed.
