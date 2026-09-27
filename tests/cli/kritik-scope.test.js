#!/usr/bin/env node

/**
 * `arkaik kritik scope` end to end (issue #443): score an audit, record it,
 * resolve and accept findings, and read back the run sheet of cells those
 * fixes made stale — terminal and `--json`.
 *
 * Drives the BUILT CLI in mkdtemp dirs against the shipped criteria pack, like
 * `kritik.test.js` beside it. Its own suite rather than more blocks in that one
 * because the scope is read from a journal whose every event matters: sharing
 * a repo with forty other assertions would make "which resolutions are in the
 * window" depend on what ran before.
 */

const { spawnSync } = require("child_process");
const { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("fs");
const { tmpdir } = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const CLI = path.join(ROOT, "packages", "cli", "dist", "index.js");

if (!existsSync(CLI)) {
  console.error(`CLI not built at ${CLI}. Run \`npm run build -w arkaik\` first.`);
  process.exit(1);
}

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
function repo({ bundle = true } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "arkaik-kritik-scope-"));
  dirs.push(dir);
  if (bundle) {
    mkdirSync(path.join(dir, "docs", "arkaik"), { recursive: true });
    writeFileSync(path.join(dir, "docs", "arkaik", "bundle.json"), BUNDLE);
  }
  const run = (args) => spawnSync(process.execPath, [CLI, "kritik", ...args], { encoding: "utf8", cwd: dir });
  return { dir, run };
}

const AUDIT = "2026-08";
// The scoped audits are named for the month they run in (`<YYYY-MM>-scoped`),
// which is what the CLI defaults to — computed the way the CLI computes it.
const now = new Date();
const MONTH = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

try {
  // --- no journal -------------------------------------------------------------

  {
    const { run } = repo({ bundle: false });
    run(["profile", "--surface", "web"]);
    const noBundle = run(["scope"]);
    check(
      "without a bundle there is no journal to measure from, and it says so",
      noBundle.status === 1 && noBundle.stderr.includes("no bundle at"),
      noBundle.stderr,
    );
  }

  // --- the scoped cycle -------------------------------------------------------

  const { dir, run } = repo();
  const ok = (args, label) => {
    const result = run(args);
    if (result.status !== 0) {
      failures++;
      console.log(`FAIL: setup — ${label ?? args.join(" ")}\n${result.stderr}${result.stdout}`);
    }
    return result;
  };

  ok(["profile", "--surface", "web:Web app:web", "--surface", "supabase:Database contract"]);
  for (const [criterion, surface, level] of [
    ["SEC-01", "web", "2"],
    ["SEC-04", "web", "2"],
    ["PRV-01", "web", "3"],
    ["SEC-01", "supabase", "2"],
    ["SEC-02", "supabase", "1"],
  ]) {
    ok(["score", criterion, surface, level, "--evidence", `${criterion}.ts:1`, "--audit", AUDIT]);
  }

  const open = (criterion, surface, extra = []) =>
    ok(
      ["finding", "open", criterion, surface, "--title", `${criterion} on ${surface}`, "--impact", "3", "--likelihood", "3", "--cost", "M", "--evidence", "x.ts:1", "--audit", AUDIT, ...extra],
      `open ${criterion} ${surface}`,
    );
  open("SEC-01", "web", ["--nodes", "V-home"]); //         F-2026-08-SEC-web-01  — resolved: direct
  open("SEC-04", "web", ["--nodes", "V-home"]); //         F-2026-08-SEC-web-02  — stays open: widened neighbour
  open("PRV-01", "web"); //                                F-2026-08-PRV-web-01  — stays open, no shared node
  open("SEC-01", "cross-surface"); //                      F-2026-08-SEC-cross-surface-01 — resolved: fans out
  open("SEC-02", "supabase"); //                           F-2026-08-SEC-supabase-01 — accepted: out of scope

  const unrecorded = run(["scope"]);
  check(
    "before any audit is recorded there is nothing to measure from",
    unrecorded.status === 0 && unrecorded.stdout.includes("no recorded audit yet"),
    unrecorded.stdout + unrecorded.stderr,
  );

  ok(["matrix", AUDIT, "--record"]);

  const quiet = run(["scope"]);
  check(
    "a freshly recorded audit has nothing stale",
    quiet.status === 0 && quiet.stdout.includes("0 cells to re-score from 0 resolved findings since 2026-08"),
    quiet.stdout,
  );

  ok(["finding", "resolve", "F-2026-08-SEC-web-01", "--by", "https://github.com/o/r/pull/7"]);
  ok(["finding", "resolve", "F-2026-08-SEC-cross-surface-01"]);
  ok(["finding", "accept", "F-2026-08-SEC-supabase-01", "--note", "RLS is enforced upstream"]);
  // A resolution naming an id no audit holds — the #440 mis-closure shape.
  appendFileSync(
    path.join(dir, "docs", "arkaik", "journal.jsonl"),
    `${JSON.stringify({ id: "01ZZZZZZZZZZZZZZZZZZZZZZZZ", ts: new Date().toISOString(), type: "quality.finding.resolved", finding_id: "F-2026-08-NOPE-web-01", actor: "github-app" })}\n`,
  );

  // --- the run sheet ------------------------------------------------------------

  const sheet = run(["scope"]);
  const lines = sheet.stdout.split("\n").map((line) => line.trim());
  check("scope exits 0", sheet.status === 0, sheet.stderr);
  check(
    "a resolved finding's own cell is listed with its score and the PR that closed it",
    lines.includes(
      "web · SEC-01 · at 2 (2026-08) · because F-2026-08-SEC-web-01 (resolved by https://github.com/o/r/pull/7), F-2026-08-SEC-cross-surface-01",
    ),
    sheet.stdout,
  );
  check(
    "a neighbour sharing a node is widened in, and says through which",
    lines.includes("web · SEC-04 · at 2 (2026-08) · widened via V-home"),
    sheet.stdout,
  );
  check(
    "a contract finding scopes the other columns its criterion applies to",
    lines.includes("supabase · SEC-01 · at 2 (2026-08) · because F-2026-08-SEC-cross-surface-01"),
    sheet.stdout,
  );
  check("an accepted risk scopes nothing", !sheet.stdout.includes("SEC-02"), sheet.stdout);
  check("a cell sharing no node with any fix stays out", !sheet.stdout.includes("PRV-01"), sheet.stdout);
  check(
    "the run sheet is grouped by surface, in the profile's order",
    sheet.stdout.indexOf("web · SEC-04") < sheet.stdout.indexOf("supabase · SEC-01"),
    sheet.stdout,
  );
  check(
    "the totals line counts cells, splits direct from widened, and names the audit",
    lines.includes("3 cells to re-score (2 direct, 1 widened) from 2 resolved findings since 2026-08"),
    sheet.stdout,
  );
  check(
    "an id that names no finding is warned about, not dropped",
    sheet.stdout.includes("1 resolved id names no finding") && lines.includes("F-2026-08-NOPE-web-01"),
    sheet.stdout,
  );
  check(
    "and it points at what to do next — into an audit of its own, never the measured one",
    sheet.stdout.includes("--evidence … --scope") && sheet.stdout.includes("never 2026-08") && sheet.stdout.includes("arkaik kritik matrix --record"),
    sheet.stdout,
  );
  check("no unscorable block when every fix has a cell", !sheet.stdout.includes("nothing can re-score"), sheet.stdout);

  const json = run(["scope", "--json"]);
  let parsed = {};
  try {
    parsed = JSON.parse(json.stdout);
  } catch (error) {
    check("--json is JSON", false, `${error.message}\n${json.stdout}`);
  }
  check("--json carries the measuring audit", parsed.since === AUDIT && typeof parsed.since_ts === "string", json.stdout.slice(0, 300));
  check(
    "--json carries every cell with its kind",
    JSON.stringify((parsed.cells ?? []).map((cell) => `${cell.surface}:${cell.criterion_id}:${cell.kind}`)) ===
      JSON.stringify(["web:SEC-01:direct", "web:SEC-04:widened", "supabase:SEC-01:direct"]),
    json.stdout.slice(0, 600),
  );
  check("--json carries the unknown ids", (parsed.unknown ?? []).join() === "F-2026-08-NOPE-web-01");
  check("--json carries an (empty) unscorable list", Array.isArray(parsed.unscorable) && parsed.unscorable.length === 0, JSON.stringify(parsed.unscorable));
  check("--json carries the summary an agent can quote", parsed.summary === "3 cells to re-score (2 direct, 1 widened) from 2 resolved findings since 2026-08", parsed.summary);

  const exact = run(["scope", "--no-widen", "--json"]);
  const exactCells = (JSON.parse(exact.stdout).cells ?? []).map((cell) => cell.kind);
  check("--no-widen keeps only the direct cells", exactCells.length === 2 && exactCells.every((kind) => kind === "direct"), exact.stdout.slice(0, 400));

  const missing = run(["scope", "--since", "2026-01"]);
  check(
    "a --since that was never recorded is refused, naming what was",
    missing.status === 1 && missing.stderr.includes('no recorded audit "2026-01"') && missing.stderr.includes("recorded: 2026-08"),
    missing.stderr,
  );

  // --- score --scope (part 2) ---------------------------------------------------

  const readJson = (...parts) => JSON.parse(readFileSync(path.join(dir, ...parts), "utf8"));
  const auditEvents = () =>
    readFileSync(path.join(dir, "docs", "arkaik", "journal.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
      .filter((event) => event.type === "quality.audit.completed");

  const outOfScope = run(["score", "PRV-01", "web", "3", "--evidence", "x.ts:1", "--scope"]);
  check(
    "--scope refuses a cell the scope does not list, and names the verb that does",
    outOfScope.status === 1 && outOfScope.stderr.includes("not in the current scope") && outOfScope.stderr.includes("arkaik kritik scope"),
    outOfScope.stderr,
  );

  const intoMeasured = run(["score", "SEC-01", "web", "3", "--evidence", "x.ts:1", "--scope", "--audit", AUDIT]);
  check(
    "--scope refuses to re-score inside the audit it is measured from",
    intoMeasured.status === 1 && intoMeasured.stderr.includes("measured from"),
    intoMeasured.stderr,
  );
  check(
    "and names the flag to name a new audit with",
    intoMeasured.stderr.includes("--audit"),
    intoMeasured.stderr,
  );

  const sortsEarly = run(["score", "SEC-01", "web", "3", "--evidence", "x.ts:1", "--scope", "--audit", "2026-01-fix"]);
  check(
    "--scope refuses an audit that would lose the latest-wins merge",
    sortsEarly.status === 1 && sortsEarly.stderr.includes("sorts before"),
    sortsEarly.stderr,
  );

  const scoped1 = `${MONTH}-scoped`;
  const first = run(["score", "SEC-01", "web", "3", "--evidence", "auth.ts:40 rotates the session", "--scope"]);
  check("an in-scope cell is re-scored", first.status === 0, first.stderr);
  check(`it lands in a scoped audit of its own (${scoped1})`, existsSync(path.join(dir, "docs", "quality", "audits", scoped1, "scores.json")), first.stdout);
  check("and says it is a scoped re-audit", first.stdout.includes(`scoped re-audit since ${AUDIT}`), first.stdout);

  ok(["score", "SEC-04", "web", "3", "--evidence", "csp.ts:2", "--scope"]);
  const scopedScores = readJson("docs", "quality", "audits", scoped1, "scores.json");
  check("the second in-scope score continues the same scoped audit", scopedScores.assessments.length === 2, JSON.stringify(scopedScores.assessments.map((a) => a.criterion_id)));
  check("the scoped audit is stamped with what it was measured from", scopedScores.scope?.since === AUDIT, JSON.stringify(scopedScores.scope));
  check("the measured audit was not touched", readJson("docs", "quality", "audits", AUDIT, "scores.json").assessments.find((a) => a.criterion_id === "SEC-01" && a.surface === "web").level === 2);

  // --- the scoped matrix and its record -------------------------------------------

  const sparse = run(["matrix", scoped1]);
  check(
    "matrix on a scoped audit says what the table is and what a record carries",
    sparse.status === 0 && sparse.stdout.includes(`scoped re-audit: 2 cells re-scored since ${AUDIT}`) && sparse.stdout.includes("--record records the merged matrix"),
    sparse.stdout,
  );
  check(
    "and it lists the scoped cell not re-scored yet — supabase got the contract fix too",
    sparse.stdout.includes("1 cell in the scope not re-scored yet") && sparse.stdout.includes("supabase · SEC-01 (direct)"),
    sparse.stdout,
  );
  const perAudit = readJson("docs", "quality", "audits", scoped1, "matrix.json");
  check("matrix.json keeps this audit alone — supabase was not re-scored, so it is N/A there", perAudit.matrix.SEC.supabase === null, JSON.stringify(perAudit.matrix.SEC));

  const closing = ok(["matrix", scoped1, "--record"]);
  check(
    "recording with a scoped cell left over says the window is closing on it",
    closing.stdout.includes("1 cell in the scope was left unscored — recording closes the window") && closing.stdout.includes("supabase · SEC-01 (direct)"),
    closing.stdout,
  );
  const recorded = auditEvents().pop();
  check(
    "the recorded event is marked as a scoped re-audit",
    recorded.audit_id === scoped1 && JSON.stringify(recorded.scope) === JSON.stringify({ partial: true, cells: 2, since: AUDIT }),
    JSON.stringify(recorded),
  );
  check(
    "its scores are the merged picture — the columns this audit never touched keep their last score",
    typeof recorded.scores.supabase.SEC === "number" && typeof recorded.scores.web.PRV === "number",
    JSON.stringify(recorded.scores),
  );
  check(
    "and the cells it did re-score moved",
    recorded.scores.web.SEC > auditEvents()[0].scores.web.SEC,
    `${auditEvents()[0].scores.web.SEC} -> ${recorded.scores.web.SEC}`,
  );

  const fresh = run(["scope"]);
  check(
    "recording the scoped audit starts a fresh window, measured from it",
    fresh.stdout.includes(`0 cells to re-score from 0 resolved findings since ${scoped1}`) && !fresh.stdout.includes("NOPE"),
    fresh.stdout,
  );

  const trend = run(["trend", "--json"]);
  const rows = JSON.parse(trend.stdout).rows ?? [];
  check(
    "the trend reads the scoped audit as a full row, not a mostly-empty one",
    rows.length === 2 && rows[1].cells.supabase.score !== null && rows[1].cells.supabase.score === rows[0].cells.supabase.score,
    trend.stdout.slice(0, 600),
  );

  // --- a second scoped pass, and a regression only the merge can see --------------

  ok(["finding", "resolve", "F-2026-08-SEC-web-02", "--by", "https://github.com/o/r/pull/8"]);
  const scoped2 = `${MONTH}-scoped-02`;
  const second = run(["score", "SEC-04", "web", "1", "--evidence", "csp.ts:2 was reverted", "--scope"]);
  check(`a new window opens a new scoped audit (${scoped2}), never the recorded one`, second.status === 0 && existsSync(path.join(dir, "docs", "quality", "audits", scoped2, "scores.json")), second.stdout + second.stderr);

  // SEC-04 x web was 2 in 2026-08, 3 in the first scoped pass, 1 now. Compare
  // a scoped audit that did not touch it with one that did: sparse-against-
  // sparse would call the cell "scored in only one" and miss the drop.
  const merged = run(["matrix", scoped2, "--record"]);
  check("the second scoped audit records", merged.status === 0, merged.stderr);
  ok(["score", "PRV-01", "web", "3", "--evidence", "x.ts:1", "--audit", `${MONTH}-scoped-03`], "a deliberate out-of-scope re-score without --scope");
  const regressions = run(["regressions", "--from", scoped1, "--to", `${MONTH}-scoped-03`, "--json"]);
  const found = JSON.parse(regressions.stdout || "{}").regressions ?? [];
  check(
    "regressions compares merged-through readings, so a cell the newer audit did not re-score is still compared",
    found.some((r) => r.kind === "level-drop" && r.criterion_id === "SEC-04" && r.surface === "web" && r.detail.includes("3 → 1")),
    regressions.stdout.slice(0, 600),
  );

  // --- the declared path, and the traps it must not fall into ---------------------

  const declared = run(["matrix", `${MONTH}-scoped-03`, "--scope"]);
  check(
    "matrix --scope records an unstamped audit as scoped, from the newest recorded audit sorting before it",
    declared.status === 0 && declared.stdout.includes(`scoped re-audit: 1 cell re-scored since ${scoped2}`),
    declared.stdout + declared.stderr,
  );
  const recordedBefore = auditEvents().length;
  const measured = run(["matrix", AUDIT, "--scope", "--record"]);
  check(
    "matrix --scope refuses an audit already recorded — it would re-record the measured reading as partial",
    measured.status === 1 && measured.stderr.includes("already recorded"),
    measured.stderr,
  );
  check("and nothing was recorded", auditEvents().length === recordedBefore, `${recordedBefore} -> ${auditEvents().length}`);

  const plain = run(["score", "PRV-01", "web", "3", "--evidence", "x.ts:1", "--audit", AUDIT]);
  check(
    "a plain score into a recorded audit says it rewrites that reading, and points at --scope",
    plain.status === 0 && plain.stdout.includes(`note: ${AUDIT} is already recorded`) && plain.stdout.includes("--scope"),
    plain.stdout,
  );
  check("and says the audit sorts before later ones, which win the merge", plain.stdout.includes(`"${AUDIT}" sorts before`), plain.stdout);

  // A directory from a clock that ran ahead: the scoped default would sort
  // before it and lose the merge, so --scope refuses rather than guess.
  ok(["finding", "resolve", "F-2026-08-PRV-web-01"]);
  mkdirSync(path.join(dir, "docs", "quality", "audits", "2099-01"));
  const early = run(["score", "PRV-01", "web", "2", "--evidence", "x.ts:1", "--scope"]);
  check(
    "--scope refuses a default scoped audit that would sort before the newest on disk",
    early.status === 1 && early.stderr.includes("would sort before") && early.stderr.includes("2099-01"),
    early.stderr,
  );
  check(
    "and names the flag to name it with, since the CLI naming rule is mode-neutral now",
    early.stderr.includes("--audit"),
    early.stderr,
  );
} finally {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nAll kritik scope checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
