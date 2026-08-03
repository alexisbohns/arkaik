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
 *
 * And, for the v2 → 3 status-vocabulary step (status lifecycle overhaul):
 *  - a v2 bundle's old `backlog`/`prioritized`/`blocked` statuses are remapped
 *    to `idea`/`backlog`/`development` with `metadata.blocked_by` stamped, and
 *    the bundle lands stamped at `schema_version: 3`;
 *  - a v3 bundle's `backlog` (new meaning: ready to start) is NOT remapped;
 *  - a future (v4) bundle is never downgraded or touched;
 *  - an unversioned legacy bundle rides the whole chain (v0→1 playlist
 *    transform AND the status remap) and ends stamped at 3 — which is also the
 *    stamp a freshly created in-app bundle gets on its first save.
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

  assert(
    out.schema_version === 3,
    "chain: an unversioned bundle ends stamped at schema_version 3 (the v2→3 step stamps)",
  );
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
  assert(out.schema_version === 3, "dispatch: a declared-v1 bundle still rides the rest of the chain to 3");
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
  assert(out.schema_version === 3, "v1→2 then v2→3: the chain ends stamped at schema_version 3");

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
  assert(out.schema_version === 3, "chain: a versionless bundle also reaches v2→3 and gets the stamp");
}

// --- v2 → 3: status vocabulary overhaul ---
function v2StatusBundle() {
  return {
    schema_version: 2,
    project: { id: "p3", title: "P3", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" },
    nodes: [
      { id: "V-old-backlog", project_id: "p3", species: "view", title: "Old Backlog", status: "backlog", platforms: ["web"] },
      { id: "V-prioritized", project_id: "p3", species: "view", title: "Prioritized", status: "prioritized", platforms: ["web"] },
      { id: "V-blocked", project_id: "p3", species: "view", title: "Blocked", status: "blocked", platforms: ["web"] },
      { id: "V-live", project_id: "p3", species: "view", title: "Live", status: "live", platforms: ["web"] },
    ],
    edges: [],
    journal: [{ id: "01M", type: "node.status_changed", to: "blocked" }],
  };
}

{
  const src = v2StatusBundle();
  const out = migrateBundle(src);
  const status = (id) => out.nodes.find((n) => n.id === id).status;

  assert(status("V-old-backlog") === "idea", "v2→3: old `backlog` (someday pile) remaps to `idea`");
  assert(status("V-prioritized") === "backlog", "v2→3: `prioritized` remaps to the new `backlog`");
  assert(status("V-blocked") === "development", "v2→3: `blocked` remaps to `development`");
  assert(
    typeof out.nodes.find((n) => n.id === "V-blocked").metadata?.blocked_by === "string",
    "v2→3: a formerly-blocked node gets metadata.blocked_by stamped",
  );
  assert(status("V-live") === "live", "v2→3: statuses shared by both vocabularies stay put");
  assert(out.schema_version === 3, "v2→3: the bundle is stamped schema_version 3");
  assert(eq(out.journal, src.journal), "v2→3: the journal is never rewritten (history keeps legacy ids)");

  const twice = migrateBundle(out);
  assert(eq(twice, out), "v2→3: re-migrating the stamped result is a no-op (stamp prevents the re-run)");
}

// --- v3: the new `backlog` must NOT be remapped ---
{
  const v3 = v2StatusBundle();
  v3.schema_version = 3;
  const out = migrateBundle(v3);
  assert(
    out.nodes.find((n) => n.id === "V-old-backlog").status === "backlog",
    "v3: `backlog` on a v3 bundle means ready-to-start and stays `backlog`",
  );
  assert(out.schema_version === 3, "v3: schema_version is left alone");
}

// --- v4 (future): never downgraded, never touched ---
{
  const v4 = v2StatusBundle();
  v4.schema_version = 4;
  const out = migrateBundle(v4);
  assert(eq(out, v4), "v4: a future bundle is returned untouched (the chain never downgrades)");
  assert(out.schema_version === 4, "v4: the future schema_version is preserved");
}

// --- unversioned legacy bundle: v0→1 playlist transform AND status remap ---
{
  const legacy = legacyBundle();
  legacy.nodes.find((n) => n.id === "V-a").status = "backlog"; // old someday pile
  legacy.nodes.find((n) => n.id === "V-b").status = "blocked";
  const out = migrateBundle(legacy);

  const root = out.nodes.find((n) => n.id === "F-root");
  assert(
    eq(root.metadata?.playlist?.entries, [
      { type: "view", view_id: "V-b" },
      { type: "view", view_id: "V-a" },
    ]),
    "legacy chain: the v0→1 playlist transform still applies alongside the status remap",
  );
  assert(out.nodes.find((n) => n.id === "V-a").status === "idea", "legacy chain: old `backlog` remaps to `idea`");
  assert(
    out.nodes.find((n) => n.id === "V-b").status === "development",
    "legacy chain: `blocked` remaps to `development`",
  );
  assert(out.schema_version === 3, "legacy chain: the unversioned bundle ends at schema_version 3");
}

// --- fresh creation: an unversioned empty bundle gets the stamp on first save ---
// The app assembles a brand-new project bundle with no schema_version
// (app/projects/page.tsx) and persists it through saveProject →
// migrateBundle → splitBundle. This is the DB-free half of that flow: the
// migration must stamp it so the stored snapshot can never read as v0 (and
// re-run the non-idempotent backlog→idea remap) on a later load. splitBundle's
// journal-only strip is covered by inspection in lib/data/db.ts.
{
  const fresh = {
    project: {
      id: "fresh-1",
      title: "Fresh",
      metadata: {},
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      archived_at: null,
    },
    nodes: [],
    edges: [],
  };
  const out = migrateBundle(fresh);
  assert(
    out.schema_version === CURRENT_SCHEMA_VERSION && CURRENT_SCHEMA_VERSION === 3,
    "fresh create: an unversioned empty bundle is stamped with the current schema_version (3 — pinned on purpose: re-check the creation seam when bumping)",
  );
  assert(eq(out.nodes, []) && eq(out.edges, []), "fresh create: nothing else changes on an empty bundle");
}

fs.rmSync(BUILD_DIR, { recursive: true, force: true });
fs.rmSync(SCHEMA_BUILD_DIR, { recursive: true, force: true });

if (failures > 0) {
  console.log(`\n${failures} migration test(s) failed.`);
  process.exit(1);
}
console.log("\nAll migration tests passed.");
