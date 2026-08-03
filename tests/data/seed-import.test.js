#!/usr/bin/env node

/**
 * Verifies (issue #201 Verification, updated for the status lifecycle
 * overhaul's v2→3 step) that every seed and the example bundle still import
 * cleanly:
 *  - parseBundle() accepts them (shape parse preserves schema_version);
 *  - migrateBundle() lands every bundle at schema_version 3 and is STABLE
 *    (re-migrating the result is a byte-for-byte no-op — the stamp is what
 *    prevents the non-idempotent backlog→idea remap from re-running);
 *  - structurally-conformant seeds pass through content-unchanged apart from
 *    the vocabulary remap: node ids, edges, and journal are untouched;
 *  - both shipped seeds declare schema_version 3 natively (they were upgraded
 *    in place when the v3 vocabulary landed: old `backlog` someday-pile
 *    statuses — including inside platformStatuses — became `idea`), carry no
 *    dead legacy ids, and migrate as an exact no-op.
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

const { migrateBundle, CURRENT_SCHEMA_VERSION } = loadMigrate();
const { parseBundle, STATUS_IDS } = loadSchema();

for (const rel of BUNDLES) {
  const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));

  // As-is.
  assert(parseBundle(bundle).success, `${rel}: parseBundle accepts it as-is`);

  const migrated = migrateBundle(bundle);
  assert(
    migrated.schema_version === CURRENT_SCHEMA_VERSION,
    `${rel}: migrateBundle lands at schema_version ${CURRENT_SCHEMA_VERSION}`,
  );
  assert(eq(migrateBundle(migrated), migrated), `${rel}: re-migrating the result is a byte-for-byte no-op (stable)`);
  assert(
    eq(migrated.nodes.map((n) => n.id), bundle.nodes.map((n) => n.id)),
    `${rel}: node ids are unchanged by migration`,
  );
  assert(eq(migrated.edges, bundle.edges), `${rel}: edges are unchanged by migration`);
  assert(eq(migrated.journal, bundle.journal), `${rel}: the journal is never rewritten`);
  assert(
    migrated.nodes.every((n) => STATUS_IDS.includes(n.status)),
    `${rel}: every migrated status is in the current 7-id vocabulary`,
  );
  assert(parseBundle(migrated).success, `${rel}: parseBundle accepts the migrated bundle`);

  if (bundle.schema_version === undefined) {
    // The unversioned bundles already use the shared subset of the vocabulary
    // (no old `backlog`/`prioritized`/`blocked`), so migration is exactly the
    // stamp — nothing else may change.
    assert(
      eq(migrated, { ...bundle, schema_version: CURRENT_SCHEMA_VERSION }),
      `${rel}: migration of an unversioned seed is exactly the schema_version stamp`,
    );

    // With an explicit schema_version: 1 (Conformance Level 1) the parse must
    // preserve the declared version rather than stripping it.
    const versioned = { schema_version: 1, ...bundle };
    const parsed = parseBundle(versioned);
    assert(parsed.success, `${rel}: parseBundle accepts it with explicit schema_version: 1`);
    assert(
      parsed.success && parsed.data.schema_version === 1,
      `${rel}: parseBundle preserves schema_version: 1 (not stripped)`,
    );
  } else {
    const parsed = parseBundle(bundle);
    assert(
      parsed.success && parsed.data.schema_version === bundle.schema_version,
      `${rel}: parseBundle preserves declared schema_version: ${bundle.schema_version} (not stripped)`,
    );
  }
}

// Both shipped seeds were upgraded in place to the v3 vocabulary (the pebbles
// seed's old `backlog` someday-pile statuses — node-level AND inside
// platformStatuses — became `idea`). They now declare schema_version 3
// natively, so the migration chain must treat them as already current: the
// non-idempotent v2→3 backlog→idea remap must NOT re-run, and nothing in them
// may carry a dead legacy id (`prioritized`, `blocked`).
for (const rel of ["seed/pebbles.json", "seed/arkaik-self-map.json"]) {
  const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
  assert(
    bundle.schema_version === CURRENT_SCHEMA_VERSION,
    `${rel}: seed natively declares schema_version ${CURRENT_SCHEMA_VERSION}`,
  );
  assert(
    bundle.nodes.every((n) => STATUS_IDS.includes(n.status)),
    `${rel}: every node status is already in the current 7-id vocabulary (no dead ids)`,
  );
  assert(
    bundle.nodes.every((n) => {
      const platformStatuses = n.metadata && n.metadata.platformStatuses;
      return !platformStatuses || Object.values(platformStatuses).every((s) => STATUS_IDS.includes(s));
    }),
    `${rel}: every platformStatus is already in the current 7-id vocabulary (no dead ids)`,
  );
  const migrated = migrateBundle(bundle);
  assert(
    eq(migrated, bundle),
    `${rel}: migrateBundle is a byte-for-byte no-op on the v3 seed (statuses unchanged, version stays ${CURRENT_SCHEMA_VERSION})`,
  );
}

fs.rmSync(MIGRATE_BUILD_DIR, { recursive: true, force: true });
fs.rmSync(SCHEMA_BUILD_DIR, { recursive: true, force: true });

if (failures > 0) {
  console.log(`\n${failures} seed-import test(s) failed.`);
  process.exit(1);
}
console.log("\nAll seed-import tests passed.");
