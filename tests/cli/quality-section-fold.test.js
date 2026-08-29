#!/usr/bin/env node

/**
 * Exercises the lane-2 bundle writer (issue #389): `docs/quality/` sidecars
 * folded into a bundle's `quality` section at assembly time.
 *
 * Drives the BUILT CLI in mkdtemp repos, never the repo itself — the same
 * reasoning as tests/cli/kritik.test.js, and the only option available:
 * packages/schema/src/cli/* is not reachable from tests/schema/load-schema.js
 * (which transpiles only src/*.ts and returns index.ts's exports).
 *
 * THE POINT OF THE TWO-AUDIT FIXTURE. With a single audit, a "merge"
 * implemented as plain concatenation and one implemented as "newest audit
 * only" both pass every assertion. So 2026-09 re-scores a cell 2026-08
 * already scored (newer must win, and the row must not be duplicated), adds
 * a cell 2026-08 never had, and leaves 2026-08's finding untouched (it must
 * still be present). Each of the three plausible wrong implementations fails
 * at least one assertion below.
 *
 * THE POINT OF THE VENDORED PACK. Its grade bands and severity buckets are
 * deliberately NOT the schema defaults (A:97 not 85; critical [21,25] not
 * [20,25]) and its weights are 3/1/2, so an assertion on the embedded
 * library can tell "embedded the project's effective pack" from "embedded
 * whatever the CLI shipped with". Phase D lost this distinction for two
 * phases; do not normalize these numbers.
 */

const { spawnSync } = require("child_process");
const { existsSync, mkdirSync, mkdtempSync, writeFileSync } = require("fs");
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
  if (cond) {
    console.log(`PASS: ${name}`);
  } else {
    failures++;
    console.log(`FAIL: ${name}${detail ? `\n${detail}` : ""}`);
  }
}

// --- the fixture repo ------------------------------------------------------

const BUNDLE = {
  schema_version: 3,
  project: {
    id: "demo",
    title: "Demo",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  },
  nodes: [
    { id: "V-home", project_id: "demo", species: "view", title: "Home", status: "live", platforms: ["web"] },
  ],
  edges: [],
};

/** Non-default scales and weights on purpose — see the header. */
const PACK = {
  name: "test-pack",
  version: "9.9.9",
  domains: [
    { code: "SEC", name: "Security" },
    { code: "TST", name: "Testing" },
  ],
  criteria: [
    { id: "SEC-01", domain: "SEC", name: "Secrets", weight: 3, question: "Are secrets kept out of the repo?" },
    { id: "SEC-02", domain: "SEC", name: "Authorization", weight: 1 },
    { id: "TST-01", domain: "TST", name: "Unit tests", weight: 2 },
  ],
  scales: {
    grades: { A: 97, B: 88, C: 71, D: 52, E: 0 },
    severity_buckets: { critical: [21, 25], high: [13, 20], medium: [7, 12], low: [3, 6], info: [1, 2] },
    caps: { critical_open: "D", high_open: "C" },
  },
};

const OVERLAY = {
  extends: "9.9.9",
  criteria: [{ id: "SEC-99", domain: "SEC", name: "Project-specific control", weight: 2 }],
};

const PROFILE = {
  surfaces: [
    { id: "web", title: "Web app", platform: "web" },
    { id: "admin", title: "Admin console" },
  ],
  domain_weights: { SEC: 2, TST: 1 },
};

const SCORES_08 = {
  audit_id: "2026-08",
  commit: "aaaaaaa",
  framework_version: "9.9.9",
  assessments: [
    { criterion_id: "SEC-01", surface: "web", level: 2, evidence: "app/a.ts:1", audit_id: "2026-08", ts: "2026-08-01T00:00:00.000Z" },
    { criterion_id: "SEC-02", surface: "web", level: 4, evidence: "app/b.ts:1", audit_id: "2026-08", ts: "2026-08-01T00:00:00.000Z" },
    { criterion_id: "TST-01", surface: "web", level: 1, evidence: "app/c.ts:1", audit_id: "2026-08", ts: "2026-08-01T00:00:00.000Z" },
    { criterion_id: "SEC-01", surface: "admin", level: 3, evidence: "app/d.ts:1", audit_id: "2026-08", ts: "2026-08-01T00:00:00.000Z" },
  ],
};

// severity/priority are STORED here on purpose: the real sidecars carry them
// and the fold must drop them.
const FINDINGS_08 = {
  audit_id: "2026-08",
  framework_version: "9.9.9",
  findings: [
    {
      id: "F-2026-08-SEC-web-01",
      criterion_id: "SEC-01",
      surface: "web",
      title: "Token in the repo",
      detail: "A live token is committed.",
      evidence: "app/a.ts:1",
      impact: 5,
      likelihood: 4,
      cost: "M",
      status: "open",
      severity: "critical",
      priority: "P0",
      source_cell: "SEC-01/web",
    },
  ],
};

const SCORES_09 = {
  audit_id: "2026-09",
  commit: "bbbbbbb",
  framework_version: "9.9.9",
  assessments: [
    // Re-scores a 2026-08 cell: 2 -> 4. Newer must win, and the row must not double.
    { criterion_id: "SEC-01", surface: "web", level: 4, evidence: "app/a.ts:9", audit_id: "2026-09", ts: "2026-09-01T00:00:00.000Z" },
    // A cell 2026-08 never scored.
    { criterion_id: "TST-01", surface: "admin", level: 2, evidence: "app/e.ts:1", audit_id: "2026-09", ts: "2026-09-01T00:00:00.000Z" },
  ],
};

const FINDINGS_09 = {
  audit_id: "2026-09",
  framework_version: "9.9.9",
  findings: [
    {
      id: "F-2026-09-TST-admin-01",
      criterion_id: "TST-01",
      surface: "admin",
      title: "No tests on the admin console",
      detail: "Nothing covers it.",
      evidence: "app/e.ts:1",
      impact: 2,
      likelihood: 2,
      cost: "S",
      status: "open",
      severity: "low",
      priority: "P3",
    },
  ],
};

function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

/**
 * A repo with a bundle and, unless told otherwise, a vendored pack, an
 * overlay, a profile and two audits.
 */
function makeRepo(options = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "arkaik-qfold-"));
  writeJson(path.join(dir, "docs", "arkaik", "bundle.json"), BUNDLE);
  if (options.profile !== false) writeJson(path.join(dir, "docs", "quality", "profile.json"), PROFILE);
  if (options.audits !== false) {
    writeJson(path.join(dir, "docs", "quality", "library.json"), PACK);
    writeJson(path.join(dir, "docs", "quality", "criteria.custom.json"), OVERLAY);
    writeJson(path.join(dir, "docs", "quality", "audits", "2026-08", "scores.json"), SCORES_08);
    writeJson(path.join(dir, "docs", "quality", "audits", "2026-08", "findings.json"), FINDINGS_08);
    writeJson(path.join(dir, "docs", "quality", "audits", "2026-09", "scores.json"), SCORES_09);
    writeJson(path.join(dir, "docs", "quality", "audits", "2026-09", "findings.json"), FINDINGS_09);
  }
  return dir;
}

const runIn = (dir, args) => spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", cwd: dir });

/** `arkaik pack` writes the bundle to stdout and its notices to stderr. */
function packIn(dir, args = []) {
  const result = runIn(dir, ["pack", ...args]);
  let bundle;
  try {
    bundle = JSON.parse(result.stdout);
  } catch {
    bundle = undefined;
  }
  return { result, bundle };
}

// --- 1. the merge ----------------------------------------------------------

{
  const dir = makeRepo();
  const { result, bundle } = packIn(dir);

  check("pack exits 0 on a repo with audits", result.status === 0, `${result.stdout.slice(0, 200)}\n${result.stderr}`);
  check("pack emits a quality section", bundle !== undefined && bundle.quality !== undefined, result.stderr);

  const section = (bundle && bundle.quality) || {};
  const assessments = section.assessments || [];
  const findings = section.findings || [];

  // 5 distinct cells across the two audits. Concatenation gives 6; newest-only gives 2.
  check("merge keeps one row per (criterion x surface)", assessments.length === 5, `got ${assessments.length}`);

  const cell = (criterionId, surface) =>
    assessments.filter((a) => a.criterion_id === criterionId && a.surface === surface);

  check("the re-scored cell appears exactly once", cell("SEC-01", "web").length === 1, JSON.stringify(cell("SEC-01", "web")));
  check(
    "the newer audit wins on the overlap (level 4, not 2)",
    cell("SEC-01", "web")[0] && cell("SEC-01", "web")[0].level === 4,
    JSON.stringify(cell("SEC-01", "web")),
  );
  check(
    "the newer audit's row carries its own audit_id",
    cell("SEC-01", "web")[0] && cell("SEC-01", "web")[0].audit_id === "2026-09",
    JSON.stringify(cell("SEC-01", "web")),
  );
  check(
    "a cell only the older audit scored survives",
    cell("SEC-02", "web")[0] && cell("SEC-02", "web")[0].level === 4,
    JSON.stringify(cell("SEC-02", "web")),
  );
  check(
    "a cell only the newer audit scored is present",
    cell("TST-01", "admin")[0] && cell("TST-01", "admin")[0].level === 2,
    JSON.stringify(cell("TST-01", "admin")),
  );

  // Findings pool across audits — newest-only would drop the 2026-08 one.
  check("findings pool across every audit", findings.length === 2, `got ${findings.length}`);
  check(
    "a finding from the older audit is still present",
    findings.some((f) => f.id === "F-2026-08-SEC-web-01"),
    JSON.stringify(findings.map((f) => f.id)),
  );

  // --- 2. derived fields stripped, everything else kept ---
  check(
    "no folded finding stores a derived severity",
    findings.every((f) => !("severity" in f)),
    JSON.stringify(findings.map((f) => Object.keys(f))),
  );
  check(
    "no folded finding stores a derived priority",
    findings.every((f) => !("priority" in f)),
    JSON.stringify(findings.map((f) => Object.keys(f))),
  );
  const stripped = findings.find((f) => f.id === "F-2026-08-SEC-web-01");
  check("the numbers severity is derived FROM survive", stripped && stripped.impact === 5 && stripped.likelihood === 4);
  check("an unknown finding key survives the strip", stripped && stripped.source_cell === "SEC-01/web");

  // --- 3. the rest of the section ---
  check("framework_version comes from the newest audit", section.framework_version === "9.9.9", section.framework_version);
  check(
    "the profile is carried verbatim",
    section.profile && Array.isArray(section.profile.surfaces) && section.profile.surfaces.length === 2,
    JSON.stringify(section.profile),
  );
  check("the notice names what was folded", /Quality: folded 5 assessment\(s\), 2 finding\(s\) from 2 audit\(s\)/.test(result.stderr), result.stderr);

  // --- 4. the bundle file on disk is NEVER rewritten ---
  const onDisk = require(path.join(dir, "docs", "arkaik", "bundle.json"));
  check("pack does not write quality into the source bundle", onDisk.quality === undefined);
}

console.log(`\n${failures === 0 ? "OK" : "FAILURES"}: quality-section-fold`);
process.exit(failures > 0 ? 1 : 0);
