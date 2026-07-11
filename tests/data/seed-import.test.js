#!/usr/bin/env node

/**
 * Verifies (issue #201 Verification) that every seed and the example bundle
 * still import unchanged after the v2 foundation lands — both as-is and with an
 * explicit `schema_version: 1`:
 *  - parseBundle() accepts them (shape parse preserves schema_version);
 *  - migrateBundle() is a no-op on them (already v1-clean) — export → import
 *    round-trip is byte-for-byte unchanged.
 */

const fs = require("fs");
const path = require("path");

const { loadMigrate, BUILD_DIR: MIGRATE_BUILD_DIR } = require("./load-migrate");
const { loadSchema, BUILD_DIR: SCHEMA_BUILD_DIR } = require("../schema/load-schema");

const ROOT = path.join(__dirname, "..", "..");
const BUNDLES = ["seed/pebbles.json", "seed/arkaik-self-map.json", "public/schema/example-bundle.json"];

let failures = 0;
function assert(cond, message) {
  if (cond) console.log(`PASS: ${message}`);
  else {
    failures++;
    console.log(`FAIL: ${message}`);
  }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const { migrateBundle } = loadMigrate();
const { parseBundle } = loadSchema();

for (const rel of BUNDLES) {
  const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));

  // As-is.
  assert(parseBundle(bundle).success, `${rel}: parseBundle accepts it as-is`);
  assert(eq(migrateBundle(bundle), bundle), `${rel}: migrateBundle is a no-op (round-trip unchanged)`);

  // With an explicit schema_version: 1 (Conformance Level 1).
  const versioned = { schema_version: 1, ...bundle };
  const parsed = parseBundle(versioned);
  assert(parsed.success, `${rel}: parseBundle accepts it with explicit schema_version: 1`);
  assert(
    parsed.success && parsed.data.schema_version === 1,
    `${rel}: parseBundle preserves schema_version: 1 (not stripped)`,
  );
  assert(eq(migrateBundle(versioned), versioned), `${rel}: migrateBundle is a no-op on a declared-v1 bundle`);
}

fs.rmSync(MIGRATE_BUILD_DIR, { recursive: true, force: true });
fs.rmSync(SCHEMA_BUILD_DIR, { recursive: true, force: true });

if (failures > 0) {
  console.log(`\n${failures} seed-import test(s) failed.`);
  process.exit(1);
}
console.log("\nAll seed-import tests passed.");
