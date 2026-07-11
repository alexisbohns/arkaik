#!/usr/bin/env node

/**
 * Unit tests for the explicit Bundle Format migration chain
 * (lib/data/migrate.ts, docs/spec/bundle-format.md § Schema Versioning).
 *
 * Covers, per issue #201:
 *  - the implicit/v0 → 1 step (former normalizeBundle) transforms legacy
 *    parent_id/sort_order/position_* nodes into playlists + composes edges;
 *  - the step is idempotent (safe to run on every load/save/import);
 *  - version dispatch: a bundle already declaring schema_version >= 1 skips the
 *    legacy step;
 *  - a version newer than we support is imported untouched, with unknown
 *    top-level fields preserved (no silent stripping);
 *  - unknown top-level keys survive the v0 → 1 migration.
 */

const { loadMigrate, BUILD_DIR } = require("./load-migrate");
const fs = require("fs");

let failures = 0;
function assert(cond, message) {
  if (cond) {
    console.log(`PASS: ${message}`);
  } else {
    failures++;
    console.log(`FAIL: ${message}`);
  }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const { migrateBundle, CURRENT_SCHEMA_VERSION } = loadMigrate();

function legacyBundle() {
  return {
    project: {
      id: "p1",
      title: "P1",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    },
    nodes: [
      { id: "F-root", project_id: "p1", species: "flow", title: "Root", status: "idea", platforms: ["web"] },
      {
        id: "V-a",
        project_id: "p1",
        species: "view",
        title: "A",
        status: "idea",
        platforms: ["web"],
        parent_id: "F-root",
        sort_order: 2,
        position_x: 10,
        position_y: 20,
      },
      {
        id: "V-b",
        project_id: "p1",
        species: "view",
        title: "B",
        status: "idea",
        platforms: ["web"],
        parent_id: "F-root",
        sort_order: 1,
      },
    ],
    edges: [],
  };
}

// --- v0 → 1: legacy transform ---
{
  const out = migrateBundle(legacyBundle());

  const hasLegacyKeys = out.nodes.some(
    (n) => "parent_id" in n || "sort_order" in n || "position_x" in n || "position_y" in n,
  );
  assert(!hasLegacyKeys, "v0→1: legacy parent_id/sort_order/position_* fields are stripped");

  const root = out.nodes.find((n) => n.id === "F-root");
  assert(
    eq(root.metadata?.playlist?.entries, [
      { type: "view", view_id: "V-b" },
      { type: "view", view_id: "V-a" },
    ]),
    "v0→1: parent flow gets a playlist ordered by sort_order (V-b before V-a)",
  );

  const edgeIds = out.edges.map((e) => e.id).sort();
  assert(
    eq(edgeIds, ["legacy-compose-F-root-V-a", "legacy-compose-F-root-V-b"]),
    "v0→1: missing composes edges are backfilled",
  );
  assert(
    out.edges.every((e) => e.edge_type === "composes" && e.project_id === "p1"),
    "v0→1: backfilled edges are composes edges scoped to the project",
  );

  assert(out.schema_version === undefined, "v0→1: migration does not stamp schema_version (absent still means 1)");
}

// --- idempotency ---
{
  const once = migrateBundle(legacyBundle());
  const twice = migrateBundle(once);
  assert(eq(once, twice), "idempotent: migrating an already-migrated bundle is a no-op");
}

// --- version dispatch: schema_version >= 1 skips the legacy step ---
{
  const v1 = legacyBundle();
  v1.schema_version = 1;
  const out = migrateBundle(v1);

  const va = out.nodes.find((n) => n.id === "V-a");
  assert(va.parent_id === "F-root", "dispatch: a schema_version:1 bundle skips the v0→1 legacy transform");
  const root = out.nodes.find((n) => n.id === "F-root");
  assert(!root.metadata?.playlist, "dispatch: no playlist is synthesized for a declared-v1 bundle");
  assert(out.edges.length === 0, "dispatch: no legacy composes edges are backfilled for a declared-v1 bundle");
  assert(out.schema_version === 1, "dispatch: declared schema_version is preserved");
}

// --- reading a newer version: import untouched, preserve unknown fields ---
{
  const future = {
    schema_version: CURRENT_SCHEMA_VERSION + 98,
    project: {
      id: "p2",
      title: "P2",
      version: "3.0.0",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    },
    nodes: [{ id: "V-x", project_id: "p2", species: "view", title: "X", status: "idea", platforms: ["web"] }],
    edges: [],
    journal: [{ id: "01J", type: "node.created" }],
    future_field: { anything: true },
  };
  const out = migrateBundle(future);
  assert(eq(out, future), "newer version: bundle is returned untouched, byte-for-byte");
  assert(eq(out.journal, future.journal), "newer version: unknown top-level `journal` is preserved");
  assert(out.project.version === "3.0.0", "newer version: unknown project.version is preserved");
  assert(eq(out.future_field, future.future_field), "newer version: unknown forward-compat key is preserved");
}

// --- unknown top-level key survives the v0 → 1 migration ---
{
  const legacy = legacyBundle();
  legacy.journal = [{ id: "01K", type: "release.tagged" }];
  const out = migrateBundle(legacy);
  assert(eq(out.journal, legacy.journal), "v0→1: unknown top-level `journal` key survives the migration");
}

fs.rmSync(BUILD_DIR, { recursive: true, force: true });

if (failures > 0) {
  console.log(`\n${failures} migration test(s) failed.`);
  process.exit(1);
}
console.log("\nAll migration tests passed.");
