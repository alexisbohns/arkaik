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
  "2. Get the run sheet: `arkaik kritik signals --domain SEC --surface web`. It exits 1 when a signal has tripped since the last recorded audit: that is information for this audit, not an error.",
  "3. Score exactly these cells and no others:",
  '   - SEC-01 on web: `arkaik kritik score SEC-01 web <level> --evidence "<file:line …>" --audit 2026-11-zplan-1100-sec-web`',
  '   - SEC-04 on web: `arkaik kritik score SEC-04 web <level> --evidence "<file:line …>" --audit 2026-11-zplan-1100-sec-web`',
  '   - SEC-05 on web: `arkaik kritik score SEC-05 web <level> --evidence "<file:line …>" --audit 2026-11-zplan-1100-sec-web`',
  '   - SEC-06 on web: `arkaik kritik score SEC-06 web <level> --evidence "<file:line …>" --audit 2026-11-zplan-1100-sec-web`',
  '   - SEC-07 on web: `arkaik kritik score SEC-07 web <level> --evidence "<file:line …>" --audit 2026-11-zplan-1100-sec-web`',
  '   - SEC-08 on web: `arkaik kritik score SEC-08 web <level> --evidence "<file:line …>" --audit 2026-11-zplan-1100-sec-web`',
  "4. Open every finding on this part's audit: `arkaik kritik finding open <criterion> web --title \"<one line>\" --impact <1-5> --likelihood <1-5> --cost <S|M|L|XL> --evidence \"<file:line …>\" --audit 2026-11-zplan-1100-sec-web`. Give file-and-line evidence, and verify every Critical and High finding adversarially before you open it.",
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
  "2. Get the run sheet: `arkaik kritik signals --domain SEC --surface web`. It exits 1 when a signal has tripped since the last recorded audit: that is information for this audit, not an error.",
  "3. Score exactly these cells and no others:",
  '   - SEC-01 on web: `arkaik kritik score SEC-01 web <level> --evidence "<file:line …>" --audit 2026-11-zplan-1100-sec-web`',
  '   - SEC-04 on web: `arkaik kritik score SEC-04 web <level> --evidence "<file:line …>" --audit 2026-11-zplan-1100-sec-web`',
  '   - SEC-05 on web: `arkaik kritik score SEC-05 web <level> --evidence "<file:line …>" --audit 2026-11-zplan-1100-sec-web`',
  '   - SEC-06 on web: `arkaik kritik score SEC-06 web <level> --evidence "<file:line …>" --audit 2026-11-zplan-1100-sec-web`',
  '   - SEC-07 on web: `arkaik kritik score SEC-07 web <level> --evidence "<file:line …>" --audit 2026-11-zplan-1100-sec-web`',
  '   - SEC-08 on web: `arkaik kritik score SEC-08 web <level> --evidence "<file:line …>" --audit 2026-11-zplan-1100-sec-web`',
  "4. Open every finding on this part's audit: `arkaik kritik finding open <criterion> web --title \"<one line>\" --impact <1-5> --likelihood <1-5> --cost <S|M|L|XL> --evidence \"<file:line …>\" --audit 2026-11-zplan-1100-sec-web`. Give file-and-line evidence, and verify every Critical and High finding adversarially before you open it.",
  "",
  "Part AGT:ios, audit id 2026-11-zplan-1100-agt-ios (8 cells, 42 checklist steps):",
  "5. Get the run sheet: `arkaik kritik signals --domain AGT --surface ios`. It exits 1 when a signal has tripped since the last recorded audit: that is information for this audit, not an error.",
  "6. Score exactly these cells and no others:",
  '   - AGT-01 on ios: `arkaik kritik score AGT-01 ios <level> --evidence "<file:line …>" --audit 2026-11-zplan-1100-agt-ios`',
  '   - AGT-02 on ios: `arkaik kritik score AGT-02 ios <level> --evidence "<file:line …>" --audit 2026-11-zplan-1100-agt-ios`',
  '   - AGT-03 on ios: `arkaik kritik score AGT-03 ios <level> --evidence "<file:line …>" --audit 2026-11-zplan-1100-agt-ios`',
  '   - AGT-04 on ios: `arkaik kritik score AGT-04 ios <level> --evidence "<file:line …>" --audit 2026-11-zplan-1100-agt-ios`',
  '   - AGT-05 on ios: `arkaik kritik score AGT-05 ios <level> --evidence "<file:line …>" --audit 2026-11-zplan-1100-agt-ios`',
  '   - AGT-06 on ios: `arkaik kritik score AGT-06 ios <level> --evidence "<file:line …>" --audit 2026-11-zplan-1100-agt-ios`',
  '   - AGT-07 on ios: `arkaik kritik score AGT-07 ios <level> --evidence "<file:line …>" --audit 2026-11-zplan-1100-agt-ios`',
  '   - AGT-08 on ios: `arkaik kritik score AGT-08 ios <level> --evidence "<file:line …>" --audit 2026-11-zplan-1100-agt-ios`',
  "7. Open every finding on this part's audit: `arkaik kritik finding open <criterion> ios --title \"<one line>\" --impact <1-5> --likelihood <1-5> --cost <S|M|L|XL> --evidence \"<file:line …>\" --audit 2026-11-zplan-1100-agt-ios`. Give file-and-line evidence, and verify every Critical and High finding adversarially before you open it.",
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
  const findingLine = prompt.split("\n").find((line) => line.includes("kritik finding open")) ?? "";
  check(
    `${part.domain}:${part.surface}: findings open on the part's audit`,
    findingLine.includes(`finding open <criterion> ${part.surface} `) && findingLine.includes(`--audit ${part.auditId}\``),
    findingLine,
  );
  check(
    `${part.domain}:${part.surface}: the finding command carries every flag \`finding open\` requires`,
    ["--title", "--impact", "--likelihood", "--cost", "--evidence"].every((flag) => findingLine.includes(` ${flag} `)) && !findingLine.includes(" … --audit"),
    findingLine,
  );
  const signalsLine = prompt.split("\n").find((line) => line.includes("kritik signals")) ?? "";
  check(
    `${part.domain}:${part.surface}: the signals step says its exit 1 on a trip is information, not an error`,
    signalsLine.includes("exits 1 when a signal has tripped since the last recorded audit") && signalsLine.includes("not an error"),
    signalsLine,
  );
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
