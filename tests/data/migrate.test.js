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
const { loadSchema, BUILD_DIR: SCHEMA_BUILD_DIR } = require("../schema/load-schema");
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
const { validateBundle } = loadSchema();

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
    eq(edgeIds, ["e-F-root-V-a", "e-F-root-V-b"]),
    "v0→1 backfill + v1→2 normalization: composes edges backfilled with conventional e-{source}-{target} ids",
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

// --- v1 → 2: deterministic-id retrofit (issue #215) ---
// A synthetic v1 store carrying the app's identifier defects: random
// `${prefix}${8 hex}` node ids, a `legacy-compose-*` edge id and a raw-UUID
// edge id, a flow playlist + root_node_id pointing at random ids, and unknown
// fields at both the top level and on a node.
function v1RandomBundle() {
  return {
    schema_version: 1,
    project: {
      id: "proj-1",
      title: "Proj 1",
      root_node_id: "F-aaaaaaaa",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    },
    nodes: [
      {
        id: "F-aaaaaaaa",
        project_id: "proj-1",
        species: "flow",
        title: "Onboarding",
        status: "idea",
        platforms: ["web"],
        custom_field: "keep-me",
        metadata: {
          playlist: {
            entries: [
              { type: "view", view_id: "V-bbbbbbbb" },
              { type: "view", view_id: "V-cccccccc" },
            ],
          },
        },
      },
      { id: "V-bbbbbbbb", project_id: "proj-1", species: "view", title: "Home", status: "idea", platforms: ["web"] },
      { id: "V-cccccccc", project_id: "proj-1", species: "view", title: "Home", status: "idea", platforms: ["web"] },
    ],
    edges: [
      {
        id: "legacy-compose-F-aaaaaaaa-V-bbbbbbbb",
        project_id: "proj-1",
        source_id: "F-aaaaaaaa",
        target_id: "V-bbbbbbbb",
        edge_type: "composes",
      },
      {
        id: "b3d1c0de-0000-4000-8000-000000000000",
        project_id: "proj-1",
        source_id: "F-aaaaaaaa",
        target_id: "V-cccccccc",
        edge_type: "composes",
      },
    ],
    future_field: { anything: true },
  };
}

{
  const out = migrateBundle(v1RandomBundle());

  const ids = out.nodes.map((n) => n.id).sort();
  assert(
    eq(ids, ["F-onboarding", "V-home", "V-home-2"]),
    "v1→2: random node ids become title-derived, colliding titles disambiguate with -2",
  );

  const flow = out.nodes.find((n) => n.id === "F-onboarding");
  assert(
    eq(flow.metadata.playlist.entries, [
      { type: "view", view_id: "V-home" },
      { type: "view", view_id: "V-home-2" },
    ]),
    "v1→2: playlist entry references are repointed to the new node ids",
  );
  assert(flow.custom_field === "keep-me", "v1→2: unknown node fields are preserved");

  assert(out.project.root_node_id === "F-onboarding", "v1→2: project.root_node_id is repointed");

  const edgeIds = out.edges.map((e) => e.id).sort();
  assert(
    eq(edgeIds, ["e-F-onboarding-V-home", "e-F-onboarding-V-home-2"]),
    "v1→2: raw-UUID and legacy-compose-* edge ids are normalized to e-{source}-{target}",
  );
  const legacyEdge = out.edges.find((e) => e.id === "e-F-onboarding-V-home");
  assert(
    legacyEdge.source_id === "F-onboarding" && legacyEdge.target_id === "V-home",
    "v1→2: edge endpoints are repointed alongside the id",
  );

  assert(eq(out.future_field, { anything: true }), "v1→2: unknown top-level fields are preserved");
  assert(out.schema_version === 1, "v1→2: does not stamp schema_version (data-shape migration only)");

  const validation = validateBundle(out);
  assert(validation.valid, "v1→2: migrated bundle passes validateBundle (no errors)");
  assert(
    !validation.findings.some((f) => f.rule === "edge-id-convention"),
    "v1→2: migrated bundle has no edge-id-convention warnings",
  );
  assert(
    !validation.findings.some((f) => f.rule === "dangling-edge" || f.rule === "playlist-ref-exists"),
    "v1→2: migrated bundle has no dangling edge or playlist references",
  );

  const twice = migrateBundle(out);
  assert(eq(twice, out), "v1→2: idempotent (re-migrating a retrofitted bundle is a no-op)");
}

// --- v1 → 2: untitled-node fallback ---
{
  const bundle = {
    schema_version: 1,
    project: { id: "p", title: "P", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" },
    nodes: [{ id: "V-deadbeef", project_id: "p", species: "view", title: "", status: "idea", platforms: ["web"] }],
    edges: [],
  };
  const first = migrateBundle(bundle);
  const newId = first.nodes[0].id;
  assert(newId.startsWith("V-") && newId !== "V-deadbeef", "v1→2 untitled: a random hex id with no title is still rewritten");
  assert(!/^V-[0-9a-f]{8}$/.test(newId), "v1→2 untitled: the fallback id is not itself random-shaped (stays put on re-run)");
  assert(eq(migrateBundle(bundle).nodes[0].id, newId), "v1→2 untitled: fallback id is deterministic across runs");
  assert(migrateBundle(first).nodes[0].id === newId, "v1→2 untitled: idempotent");
}

// --- v0 (no schema_version) runs the full chain through v1→2 ---
{
  const v0 = v1RandomBundle();
  delete v0.schema_version;
  const out = migrateBundle(v0);
  assert(
    eq(out.nodes.map((n) => n.id).sort(), ["F-onboarding", "V-home", "V-home-2"]),
    "chain: a versionless bundle passes through both v0→1 and v1→2",
  );
}

fs.rmSync(BUILD_DIR, { recursive: true, force: true });
fs.rmSync(SCHEMA_BUILD_DIR, { recursive: true, force: true });

if (failures > 0) {
  console.log(`\n${failures} migration test(s) failed.`);
  process.exit(1);
}
console.log("\nAll migration tests passed.");
