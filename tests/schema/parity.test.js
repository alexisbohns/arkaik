#!/usr/bin/env node

/**
 * Parity test: @arkaik/schema's validateBundle() must agree with the
 * battle-tested standalone validator (docs/arkaik-skill/scripts/validate-bundle.js)
 * on both the verdict (valid/invalid) and the finding counts (errors, warnings)
 * for every fixture below.
 *
 * The standalone validator is treated as the oracle: its output is parsed at
 * runtime, so this test can never silently drift out of agreement.
 */

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const { loadSchema, BUILD_DIR } = require("./load-schema");

const ROOT = path.join(__dirname, "..", "..");
const STANDALONE = path.join(ROOT, "docs", "arkaik-skill", "scripts", "validate-bundle.js");

const FIXTURES = [
  "seed/pebbles.json",
  "seed/arkaik-self-map.json",
  "public/schema/example-bundle.json",
  "tests/fixtures/valid-bundle.json",
  "tests/fixtures/valid-level2.json",
  "tests/fixtures/duplicate-node-id.json",
  "tests/fixtures/dangling-edge.json",
  "tests/fixtures/invalid-view-card-variant.json",
  "tests/fixtures/duplicate-ref-id.json",
  "tests/fixtures/invalid-kitchen-sink.json",
  "tests/fixtures/journal-status-mismatch.json",
];

/** Run the standalone validator and extract its verdict + finding counts. */
function runStandalone(fixturePath) {
  const result = spawnSync(process.execPath, [STANDALONE, fixturePath], { encoding: "utf8" });
  const out = result.stdout || "";
  const errors = (out.match(/^\s*ERROR:/gm) || []).length;
  const warnings = (out.match(/^\s*WARN:/gm) || []).length;
  return { valid: result.status === 0, errors, warnings };
}

function main() {
  const { validateBundle, parseBundle } = loadSchema();

  let failures = 0;
  for (const rel of FIXTURES) {
    const abs = path.join(ROOT, rel);
    const oracle = runStandalone(abs);

    const bundle = JSON.parse(fs.readFileSync(abs, "utf8"));
    const result = validateBundle(bundle);

    const mismatches = [];
    if (result.valid !== oracle.valid) {
      mismatches.push(`valid: got ${result.valid}, oracle ${oracle.valid}`);
    }
    if (result.errors.length !== oracle.errors) {
      mismatches.push(`errors: got ${result.errors.length}, oracle ${oracle.errors}`);
    }
    if (result.warnings.length !== oracle.warnings) {
      mismatches.push(`warnings: got ${result.warnings.length}, oracle ${oracle.warnings}`);
    }

    // parseBundle (shape-only) must accept every bundle the oracle deems valid.
    const parsed = parseBundle(bundle);
    if (oracle.valid && !parsed.success) {
      mismatches.push(`parseBundle rejected a valid bundle: ${parsed.error.issues[0]?.message}`);
    }

    // Every finding must carry the structured shape.
    for (const f of result.findings) {
      if (typeof f.path !== "string" || !f.rule || !f.message || (f.severity !== "error" && f.severity !== "warning")) {
        mismatches.push(`malformed finding: ${JSON.stringify(f)}`);
        break;
      }
    }

    if (mismatches.length === 0) {
      console.log(
        `PASS: ${rel} (${oracle.valid ? "valid" : "invalid"}, ${oracle.errors} errors, ${oracle.warnings} warnings)`,
      );
    } else {
      failures++;
      console.log(`FAIL: ${rel}`);
      for (const m of mismatches) console.log(`      ${m}`);
    }
  }

  fs.rmSync(BUILD_DIR, { recursive: true, force: true });

  if (failures > 0) {
    console.log(`\n${failures} of ${FIXTURES.length} parity test(s) failed.`);
    process.exit(1);
  }
  console.log(`\nAll ${FIXTURES.length} parity tests passed.`);
}

main();
