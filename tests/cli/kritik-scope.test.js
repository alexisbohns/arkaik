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
const { appendFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } = require("fs");
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
  check("and it points at what to do next", sheet.stdout.includes("arkaik kritik matrix --record"), sheet.stdout);

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

  // --- the cycle closes -----------------------------------------------------------

  ok(["matrix", AUDIT, "--record"]);
  const after = run(["scope"]);
  check(
    "recording the re-audit starts a fresh window",
    after.stdout.includes("0 cells to re-score from 0 resolved findings since 2026-08") && !after.stdout.includes("NOPE"),
    after.stdout,
  );
} finally {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nAll kritik scope checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
