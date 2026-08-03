#!/usr/bin/env node

/**
 * Legacy status vocabulary + the pure v3 migration
 * (packages/schema/src/legacy-status.ts).
 *
 * The load-bearing bit: old `backlog` (someday pile) must land on `idea`
 * BEFORE `prioritized` takes over the `backlog` id — a chained remap would
 * send `prioritized` all the way to `idea`. And the migration is gated on
 * schema_version: a v3 bundle's `backlog` means "ready to start" and must
 * not move.
 */

const assert = require("node:assert");
const { loadSchema } = require("./load-schema");
const { normalizeStatus, migrateStatusVocabulary, LEGACY_STATUS_ALIASES, STATUS_VOCABULARY_VERSION } = loadSchema();

assert.equal(normalizeStatus("prioritized"), "backlog");
assert.equal(normalizeStatus("blocked"), "development");
assert.equal(normalizeStatus("discovery"), "discovery");
assert.equal(normalizeStatus("live"), "live");
assert.equal(normalizeStatus("nonsense"), undefined);
assert.deepEqual(LEGACY_STATUS_ALIASES, { prioritized: "backlog", blocked: "development" });
assert.equal(STATUS_VOCABULARY_VERSION, 3);

const oldBundle = {
  schema_version: 2,
  project: { id: "p", title: "P", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" },
  nodes: [
    { id: "V-a", project_id: "p", species: "view", title: "A", status: "backlog", platforms: ["web"] },
    { id: "V-b", project_id: "p", species: "view", title: "B", status: "prioritized", platforms: ["web"] },
    { id: "V-c", project_id: "p", species: "view", title: "C", status: "blocked", platforms: ["web"] },
    { id: "AC-d", project_id: "p", species: "acceptance", title: "D", status: "live", platforms: ["web", "ios"],
      metadata: { platformStatuses: { web: "prioritized", ios: "blocked" }, refs: [{ id: "r1", type: "github-pr", url: "https://x", status_mapped: "prioritized" }] } },
  ],
  edges: [],
  journal: [{ id: "01A", ts: "2026-01-01T00:00:00.000Z", type: "node.status_changed", node_id: "V-a", from: "prioritized", to: "blocked" }],
};

const migrated = migrateStatusVocabulary(oldBundle);
assert.equal(migrated.nodes[0].status, "idea");
assert.equal(migrated.nodes[1].status, "backlog");
assert.equal(migrated.nodes[2].status, "development");
assert.equal(migrated.nodes[2].metadata.blocked_by, "migrated from legacy blocked status");
assert.equal(migrated.nodes[3].metadata.platformStatuses.web, "backlog");
assert.equal(migrated.nodes[3].metadata.platformStatuses.ios, "development");
// a platform-only `blocked` (base status untouched) still stamps blocked_by
assert.equal(migrated.nodes[3].metadata.blocked_by, "migrated from legacy blocked status");
assert.equal(migrated.nodes[3].metadata.refs[0].status_mapped, "backlog");
assert.equal(migrated.schema_version, 3);
assert.deepEqual(migrated.journal, oldBundle.journal);
assert.equal(oldBundle.nodes[0].status, "backlog"); // input not mutated

const newBundle = { ...oldBundle, schema_version: 3, nodes: [{ id: "V-x", project_id: "p", species: "view", title: "X", status: "backlog", platforms: ["web"] }] };
assert.equal(migrateStatusVocabulary(newBundle), newBundle);

// The dead-id aliases apply even at v3 (a hand-edited file), WITHOUT the
// backlog->idea remap and WITHOUT touching schema_version.
const handEdited = {
  ...oldBundle,
  schema_version: 3,
  nodes: [
    { id: "V-h", project_id: "p", species: "view", title: "H", status: "prioritized", platforms: ["web"] },
    { id: "V-k", project_id: "p", species: "view", title: "K", status: "backlog", platforms: ["web"] },
    { id: "V-l", project_id: "p", species: "view", title: "L", status: "blocked", platforms: ["web"] },
  ],
};
const repaired = migrateStatusVocabulary(handEdited);
assert.equal(repaired.nodes[0].status, "backlog"); // prioritized alias applies at v3
assert.equal(repaired.nodes[1].status, "backlog"); // v3 backlog means "ready to start" — must not move
assert.equal(repaired.nodes[1], handEdited.nodes[1]); // untouched node keeps its identity
assert.equal(repaired.nodes[2].status, "development");
assert.equal(repaired.nodes[2].metadata.blocked_by, "migrated from legacy blocked status");
assert.equal(repaired.schema_version, 3);
assert.equal(handEdited.nodes[0].status, "prioritized"); // input not mutated
const { schema_version: _drop, ...unversioned } = oldBundle;
assert.equal(migrateStatusVocabulary(unversioned).schema_version, 3);
const preset = { schema_version: 2, project: oldBundle.project, nodes: [{ id: "V-p", project_id: "p", species: "view", title: "P", status: "blocked", platforms: ["web"], metadata: { blocked_by: "V-a" } }], edges: [] };
assert.equal(migrateStatusVocabulary(preset).nodes[0].metadata.blocked_by, "V-a");
assert.deepEqual(migrateStatusVocabulary(migrated), migrated);

console.log("legacy-status: all assertions passed");
