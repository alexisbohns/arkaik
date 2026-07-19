#!/usr/bin/env node

/**
 * Overview projections (lib/utils/coverage.ts) — hand fixtures for the edge
 * cases, then seed goldens: every number the dashboard shows for Pebbles is
 * pinned here, so a drifting projection fails CI before it lies on screen.
 */

const fs = require("fs");
const path = require("path");
const { loadCoverage, BUILD_DIR } = require("./load-coverage");

const {
  computeInventory,
  computeProductRollup,
  computeReleasePulse,
  computeDeliverySnapshot,
  computeUnreachableFromRoot,
  computeHealthIndicators,
} = loadCoverage();

let failures = 0;
function assert(cond, message) {
  if (cond) console.log(`PASS: ${message}`);
  else {
    failures++;
    console.log(`FAIL: ${message}`);
  }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// =========================== Hand fixtures ===================================

// --- Inventory: all species always present, config order, zero-safe ---------
const emptyInventory = computeInventory([], [], []);
assert(
  eq(emptyInventory.species.map((s) => s.species), ["flow", "view", "data-model", "api-endpoint", "acceptance"]),
  "inventory lists all five species in config order even when empty",
);
assert(
  emptyInventory.nodeCount === 0 && emptyInventory.edgeCount === 0 && emptyInventory.journalEventCount === 0,
  "empty inventory counts are zero",
);

const smallInventory = computeInventory(
  [
    { species: "view", status: "live" },
    { species: "view", status: "development" },
    { species: "flow", status: "development" },
  ],
  [{ id: "e1" }],
  [],
);
assert(
  eq(smallInventory.species.find((s) => s.species === "view").byStatus, { live: 1, development: 1 }),
  "inventory tallies node-level statuses per species",
);
assert(
  smallInventory.species.find((s) => s.species === "data-model").total === 0,
  "species with no nodes stay listed at zero",
);

// --- Product rollup: views only, override wins, uncounted statuses excluded --
const rollup = computeProductRollup(
  [
    {
      species: "view",
      status: "development",
      platforms: ["web", "ios"],
      metadata: { platformStatuses: { ios: "live" } },
    },
    { species: "api-endpoint", status: "live", platforms: ["web"] }, // not a view — ignored
    { species: "view", status: "idea", platforms: ["web"] }, // idea is uncounted
    { species: "flow", status: "development", platforms: ["web"] }, // rollup, not deliverable
  ],
  [], // no covers edges → views fall back to stored statuses
);
assert(eq(rollup.totals, { web: 1, ios: 1 }), `rollup counts views only (totals ${JSON.stringify(rollup.totals)})`);
assert(
  eq(rollup.counts, { web: { development: 1 }, ios: { live: 1 } }),
  "platformStatuses override wins per platform; uncounted statuses excluded",
);

// --- Release pulse: ordering, re-tag dedupe, boundary exclusion, empty -------
const pulseJournal = [
  // Stored shuffled on purpose — consumers must order. 0.1.0 is tagged twice:
  // the later marker (01E) must win wholesale (ts, platform, missing notes).
  { id: "01D", ts: "2026-01-04T00:00:00Z", type: "release.tagged", version: "0.2.0" },
  { id: "01B", ts: "2026-01-02T00:00:00Z", type: "node.created", node_id: "V-a", title: "A", species: "view" },
  { id: "01A", ts: "2026-01-01T00:00:00Z", type: "release.tagged", version: "0.1.0", notes: "first" },
  { id: "01C", ts: "2026-01-03T00:00:00Z", type: "node.status_changed", node_id: "V-a", from: "idea", to: "live" },
  { id: "01E", ts: "2026-01-05T00:00:00Z", type: "release.tagged", version: "0.1.0", platform: "ios" },
];
const pulse = computeReleasePulse(pulseJournal);
assert(
  eq(pulse.map((entry) => entry.version), ["0.1.0", "0.2.0"]),
  `pulse is newest-first by each version's LATEST marker (${pulse.map((e) => e.version).join(", ")})`,
);
assert(
  pulse[0].eventId === "01E" && pulse[0].platform === "ios" && pulse[0].notes === undefined,
  "a re-tagged version resolves to its latest marker wholesale (old notes gone)",
);
assert(
  pulse[0].eventCount === 0,
  `re-tag window is bounded by the preceding marker — computeChangelog's own rule (got ${pulse[0].eventCount})`,
);
assert(pulse[1].eventCount === 2, `0.2.0 spans the two events strictly between markers (got ${pulse[1].eventCount})`);
assert(eq(computeReleasePulse([]), []), "empty journal yields an empty pulse");

// --- Delivery snapshot: board defaults ---------------------------------------
const snapshotFixture = computeDeliverySnapshot([
  { id: "V-1", project_id: "p", species: "view", title: "One", status: "development", platforms: ["web", "ios"] },
  { id: "V-2", project_id: "p", species: "view", title: "Two", status: "live", platforms: ["web"] },
  { id: "A-1", project_id: "p", species: "api-endpoint", title: "Api", status: "live", platforms: ["web"] }, // default species = views only
]);
assert(snapshotFixture.totalItems === 3, `snapshot counts (node × platform) items for views (got ${snapshotFixture.totalItems})`);
assert(
  eq(
    snapshotFixture.statuses.filter((s) => s.count > 0),
    [
      { status: "development", count: 2 },
      { status: "live", count: 1 },
    ],
  ),
  "snapshot buckets by per-platform status in column order",
);

// --- Unreachable-from-root: posture + directedness ---------------------------
const reachNodes = [
  { id: "V-root", species: "view" },
  { id: "V-child", species: "view" },
  { id: "F-parentless", species: "flow" },
  { id: "DM-x", species: "data-model" },
];
const reachEdges = [
  { source_id: "V-root", target_id: "V-child", edge_type: "composes" },
  { source_id: "F-parentless", target_id: "V-child", edge_type: "composes" }, // composes INTO the reachable set
  { source_id: "V-root", target_id: "DM-x", edge_type: "displays" }, // non-composes never traversed
];
assert(eq(computeUnreachableFromRoot(reachNodes, reachEdges, undefined), []), "no root → empty, never an error");
assert(eq(computeUnreachableFromRoot(reachNodes, reachEdges, "V-ghost"), []), "unresolvable root → empty");
assert(
  eq(computeUnreachableFromRoot(reachNodes, reachEdges, "V-root"), ["F-parentless"]),
  "traversal is directed — a flow composing into reachable views is still orphaned",
);

// --- Health indicators: order, closing, denominators --------------------------
const healthNodes = [
  { id: "V-root", project_id: "p", species: "view", title: "Root", description: "has one", status: "live", platforms: ["web"] },
  { id: "V-bare", project_id: "p", species: "view", title: "Bare", status: "idea", platforms: [] },
  { id: "DM-loose", project_id: "p", species: "data-model", title: "Loose", description: " ", status: "idea", platforms: [] },
];
const healthEdges = [{ id: "e1", project_id: "p", source_id: "V-root", target_id: "V-bare", edge_type: "composes" }];
const healthEvents = [
  { id: "01A", ts: "2026-01-01T00:00:00Z", type: "idea.proposed", title: "Open idea" },
  { id: "01B", ts: "2026-01-02T00:00:00Z", type: "idea.proposed", title: "Closed idea", node_id: "V-bare" },
  { id: "01C", ts: "2026-01-03T00:00:00Z", type: "request.filed", title: "Open request", node_id: "V-nonexistent" },
];
const health = computeHealthIndicators(healthNodes, healthEdges, healthEvents, { rootNodeId: "V-root" });
assert(
  eq(
    health.map((indicator) => indicator.id),
    ["unreachable-from-root", "views-without-screenshot", "nodes-without-description", "disconnected-nodes", "open-backlog"],
  ),
  "health indicators come in fixed order",
);
const byId = new Map(health.map((indicator) => [indicator.id, indicator]));
assert(
  byId.get("views-without-screenshot").count === 2 && byId.get("views-without-screenshot").total === 2,
  "screenshot indicator counts views without any screenshot value",
);
assert(
  eq(byId.get("nodes-without-description").nodeIds, ["DM-loose", "V-bare"]),
  "whitespace-only descriptions count as missing; ids sorted",
);
assert(eq(byId.get("disconnected-nodes").nodeIds, ["DM-loose"]), "edge-less nodes are disconnected");
assert(
  byId.get("open-backlog").count === 2 && byId.get("open-backlog").nodeIds === undefined,
  "backlog items linked to existing nodes are closed; no nodeIds on the backlog indicator",
);

// ============================ Seed goldens =====================================

const ROOT = path.join(__dirname, "..", "..");
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "seed", "pebbles.json"), "utf8"));
const nodesById = new Map(bundle.nodes.map((node) => [node.id, node]));

const inventory = computeInventory(bundle.nodes, bundle.edges, bundle.journal);
assert(
  inventory.nodeCount === 150 && inventory.edgeCount === 280 && inventory.journalEventCount === 174,
  `seed census 150/280/174 (got ${inventory.nodeCount}/${inventory.edgeCount}/${inventory.journalEventCount})`,
);
assert(
  eq(
    inventory.species.map((entry) => [entry.species, entry.total]),
    [["flow", 10], ["view", 58], ["data-model", 30], ["api-endpoint", 49], ["acceptance", 3]],
  ),
  "seed species totals flow 10 / view 58 / data-model 30 / api-endpoint 49 / acceptance 3",
);

const seedRollup = computeProductRollup(bundle.nodes, bundle.edges);
assert(eq(seedRollup.totals, { web: 30, ios: 31, android: 18 }), `seed rollup totals web 30 / ios 31 / android 18 (got ${JSON.stringify(seedRollup.totals)})`);
assert(
  eq(seedRollup.counts, {
    web: { development: 25, live: 5 },
    ios: { development: 25, live: 6 },
    android: { development: 13, live: 5 },
  }),
  "seed rollup counts: V-pebble-detail now contributes android:development from its covering acceptances",
);

const seedPulse = computeReleasePulse(bundle.journal, { nodesById });
assert(
  eq(
    seedPulse.map((entry) => [entry.version, entry.platform ?? null, entry.eventCount]),
    [["0.4.0", "ios", 5], ["0.3.0", null, 5], ["0.2.0", null, 151]],
  ),
  `seed pulse [0.4.0 ios 5, 0.3.0 — 5, 0.2.0 — 151] (got ${JSON.stringify(seedPulse.map((e) => [e.version, e.platform ?? null, e.eventCount]))})`,
);

const seedSnapshot = computeDeliverySnapshot(bundle.nodes);
assert(
  eq(
    seedSnapshot.statuses.filter((entry) => entry.count > 0),
    [
      { status: "development", count: 62 },
      { status: "live", count: 16 },
    ],
  ) && seedSnapshot.totalItems === 78,
  `seed snapshot development 62 / live 16 / total 78 (got ${JSON.stringify(seedSnapshot.statuses.filter((e) => e.count > 0))}, total ${seedSnapshot.totalItems})`,
);

const seedHealth = computeHealthIndicators(bundle.nodes, bundle.edges, bundle.journal, {
  rootNodeId: bundle.project.root_node_id,
});
const seedById = new Map(seedHealth.map((indicator) => [indicator.id, indicator]));
assert(
  eq(seedById.get("unreachable-from-root").nodeIds, [
    "F-legal-consent",
    "F-swap-glyph",
    "V-admin-analytics",
    "V-admin-domains",
    "V-admin-glyph-moderation",
    "V-admin-glyph-upload",
    "V-docs-index",
    "V-docs-slug",
  ]) && seedById.get("unreachable-from-root").total === 68,
  `seed orphans: the 8 pinned ids out of 68 flows+views (got ${JSON.stringify(seedById.get("unreachable-from-root").nodeIds)})`,
);
assert(
  seedById.get("views-without-screenshot").count === 58 && seedById.get("views-without-screenshot").total === 58,
  "seed ships no screenshots: 58/58 views flagged",
);
assert(
  seedById.get("nodes-without-description").count === 0 && seedById.get("nodes-without-description").total === 150,
  "every seed node carries a description: 0/150",
);
assert(eq(seedById.get("disconnected-nodes").nodeIds, ["DM-bounce"]), "DM-bounce is the seed's one disconnected node");
assert(seedById.get("open-backlog").count === 3, `seed backlog has 3 open items (got ${seedById.get("open-backlog").count})`);

// Determinism: same inputs, same output.
assert(
  eq(seedHealth, computeHealthIndicators(bundle.nodes, bundle.edges, bundle.journal, { rootNodeId: bundle.project.root_node_id })),
  "health projection is deterministic",
);

fs.rmSync(BUILD_DIR, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll coverage tests passed");
