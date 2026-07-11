#!/usr/bin/env node

/**
 * Runs the ProjectBundle validator against each fixture in this directory
 * and asserts it exits 0 (valid) or non-zero (invalid) as expected.
 */

const { spawnSync } = require("child_process");
const path = require("path");

const VALIDATOR = path.join(__dirname, "..", "..", "docs", "arkaik-skill", "scripts", "validate-bundle.js");

const CASES = [
  { file: "valid-bundle.json", expectValid: true },
  { file: "duplicate-node-id.json", expectValid: false },
  { file: "dangling-edge.json", expectValid: false },
  { file: "invalid-view-card-variant.json", expectValid: false },
];

let failures = 0;

for (const { file, expectValid } of CASES) {
  const fixturePath = path.join(__dirname, file);
  const result = spawnSync(process.execPath, [VALIDATOR, fixturePath], { encoding: "utf8" });
  const isValid = result.status === 0;

  if (isValid === expectValid) {
    console.log(`PASS: ${file} (expected ${expectValid ? "valid" : "invalid"})`);
  } else {
    failures++;
    console.log(`FAIL: ${file} (expected ${expectValid ? "valid" : "invalid"}, got ${isValid ? "valid" : "invalid"})`);
    console.log(result.stdout);
    console.log(result.stderr);
  }
}

if (failures > 0) {
  console.log(`\n${failures} of ${CASES.length} fixture test(s) failed.`);
  process.exit(1);
}

console.log(`\nAll ${CASES.length} fixture tests passed.`);
process.exit(0);
