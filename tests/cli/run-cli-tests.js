#!/usr/bin/env node

/**
 * Spawns the built `arkaik` CLI (packages/cli/dist/index.js) against fixtures
 * and asserts exit codes + output — mirroring tests/fixtures/run-fixture-tests.js.
 *
 * The CLI must be built first (`npm run build -w arkaik`); the root `test:cli`
 * script does that before invoking this runner.
 *
 * Covers:
 *  - `arkaik validate <path>` behaves like the standalone validate-bundle.js
 *    (valid/invalid + sidecar cases), exiting 0/1 with a pathed error report.
 *  - `arkaik validate --fix-format` canonicalizes in place, is idempotent, and
 *    round-trips embedded journal / schema_version / unknown keys+fields.
 */

const { spawnSync } = require("child_process");
const { existsSync, readFileSync, writeFileSync, mkdtempSync, copyFileSync } = require("fs");
const { tmpdir } = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const CLI = path.join(ROOT, "packages", "cli", "dist", "index.js");
const FIXTURES = path.join(ROOT, "tests", "fixtures");
const CLI_FIXTURES = path.join(__dirname, "fixtures");

if (!existsSync(CLI)) {
  console.error(`CLI not built at ${CLI}. Run \`npm run build -w arkaik\` first.`);
  process.exit(1);
}

function runCli(args) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });
}

let failures = 0;
let passes = 0;

function check(name, cond, detail) {
  if (cond) {
    passes++;
    console.log(`PASS: ${name}`);
  } else {
    failures++;
    console.log(`FAIL: ${name}`);
    if (detail) console.log(detail);
  }
}

// ---------------------------------------------------------------------------
// validate: exit-code parity with the standalone validator, incl. sidecars.
// ---------------------------------------------------------------------------
const VALIDATE_CASES = [
  { file: "valid-bundle.json", expectValid: true },
  { file: "valid-level2.json", expectValid: true },
  { file: "duplicate-node-id.json", expectValid: false },
  { file: "dangling-edge.json", expectValid: false },
  { file: "sidecar-valid/bundle.json", expectValid: true },
  { file: "sidecar-mismatch/bundle.json", expectValid: false },
  { file: "sidecar-bad-line/bundle.json", expectValid: false },
];

for (const { file, expectValid } of VALIDATE_CASES) {
  const result = runCli(["validate", path.join(FIXTURES, file)]);
  const isValid = result.status === 0;
  check(
    `validate ${file} -> ${expectValid ? "valid" : "invalid"}`,
    isValid === expectValid,
    `exit=${result.status}\n${result.stdout}\n${result.stderr}`,
  );
}

// A known-invalid bundle must surface a *pathed* error (JSON path in output).
{
  const result = runCli(["validate", path.join(FIXTURES, "duplicate-node-id.json")]);
  check(
    "validate duplicate-node-id emits a pathed error",
    result.status === 1 && /nodes\[/.test(result.stdout),
    `exit=${result.status}\n${result.stdout}`,
  );
}

// Missing path is a usage error (exit 1).
{
  const result = runCli(["validate"]);
  check("validate with no path -> exit 1", result.status === 1);
}

// Top-level help exits 0.
{
  const result = runCli(["--help"]);
  check("--help -> exit 0", result.status === 0 && /Usage:/.test(result.stdout));
}

// Unknown command exits 1.
{
  const result = runCli(["frobnicate"]);
  check("unknown command -> exit 1", result.status === 1);
}

// ---------------------------------------------------------------------------
// validate --fix-format: canonicalize in place, idempotent, lossless round-trip.
// ---------------------------------------------------------------------------
{
  const dir = mkdtempSync(path.join(tmpdir(), "arkaik-cli-"));
  const target = path.join(dir, "bundle.json");
  copyFileSync(path.join(CLI_FIXTURES, "unsorted-bundle.json"), target);

  const original = readFileSync(target, "utf8");
  const first = runCli(["validate", "--fix-format", target]);
  const afterFirst = readFileSync(target, "utf8");

  check("fix-format exits 0", first.status === 0);
  check("fix-format changed the unsorted file", afterFirst !== original);

  // Idempotence: a second run makes no further change.
  const second = runCli(["validate", "--fix-format", target]);
  const afterSecond = readFileSync(target, "utf8");
  check("fix-format is idempotent (2nd run no-op)", second.status === 0 && afterSecond === afterFirst);

  // Canonical shape: trailing newline, top-level key order, nodes sorted by id.
  check("fix-format output ends with newline", afterFirst.endsWith("\n"));
  const parsed = JSON.parse(afterFirst);
  const topKeys = Object.keys(parsed);
  check(
    "fix-format top-level key order is canonical",
    JSON.stringify(topKeys) ===
      JSON.stringify(["schema_version", "project", "nodes", "edges", "journal", "custom_top_level"]),
    `got ${JSON.stringify(topKeys)}`,
  );
  check(
    "fix-format sorts nodes by id",
    parsed.nodes.map((n) => n.id).join(",") === "V-home,V-zebra",
    `got ${parsed.nodes.map((n) => n.id).join(",")}`,
  );

  // Lossless round-trip: embedded journal, schema_version, unknown top-level
  // key, and unknown node field all survive.
  check("fix-format keeps schema_version", parsed.schema_version === 2);
  check("fix-format keeps embedded journal", Array.isArray(parsed.journal) && parsed.journal.length === 1);
  check(
    "fix-format keeps unknown top-level key",
    parsed.custom_top_level && parsed.custom_top_level.a === 2 && parsed.custom_top_level.z === 1,
  );
  const zebra = parsed.nodes.find((n) => n.id === "V-zebra");
  check("fix-format keeps unknown node field", zebra && zebra.custom_node_field === "kept");

  // fix-format must NOT fold a sidecar into the bundle file. Run it on a copy of
  // the sidecar fixture (which has NO embedded journal) and confirm the file
  // still carries no `journal` key afterward.
  const scDir = mkdtempSync(path.join(tmpdir(), "arkaik-cli-sc-"));
  const scTarget = path.join(scDir, "bundle.json");
  copyFileSync(path.join(FIXTURES, "sidecar-valid", "bundle.json"), scTarget);
  copyFileSync(path.join(FIXTURES, "sidecar-valid", "journal.jsonl"), path.join(scDir, "journal.jsonl"));
  runCli(["validate", "--fix-format", scTarget]);
  const scParsed = JSON.parse(readFileSync(scTarget, "utf8"));
  check("fix-format does not fold sidecar into the bundle", scParsed.journal === undefined);
}

console.log(`\n${passes} passed, ${failures} failed.`);
process.exit(failures > 0 ? 1 : 0);
