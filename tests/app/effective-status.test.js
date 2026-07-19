#!/usr/bin/env node

/**
 * Rollup seam (lib/utils/platform-status.ts) — a view's effective per-platform
 * status from covering acceptances, with stored fallback; the flow rollup
 * extended by directly-covering acceptances (spec §3.4).
 */

const fs = require("fs");
const path = require("path");
const { loadEffectiveStatus, BUILD_DIR } = require("./load-effective-status");

const {
  getEffectivePlatformStatuses,
  getNodePlatformStatuses,
  computePlaylistRollup,
  computeFlowPlatformRollup,
} = loadEffectiveStatus();

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

const view = { id: "V-x", species: "view", status: "idea", platforms: ["web", "ios", "android"], metadata: { platformStatuses: { ios: "live" } } };
const accA = { id: "AC-a", species: "acceptance", status: "backlog", platforms: ["web", "ios", "android"], metadata: { platformStatuses: { ios: "live", android: "development" } } };
const accB = { id: "AC-b", species: "acceptance", status: "backlog", platforms: ["web", "ios", "android"], metadata: { platformStatuses: { ios: "live", android: "live" } } };
const coverA = { id: "e-a", edge_type: "covers", source_id: "AC-a", target_id: "V-x" };
const coverB = { id: "e-b", edge_type: "covers", source_id: "AC-b", target_id: "V-x" };

// Uncovered view → stored fallback (identical to getNodePlatformStatuses).
assert(
  eq(getEffectivePlatformStatuses(view, [view], []), getNodePlatformStatuses(view)),
  "uncovered view falls back to its stored platform statuses",
);

// Covered view → weakest-link per platform.
assert(
  eq(getEffectivePlatformStatuses(view, [view, accA, accB], [coverA, coverB]), { web: "backlog", ios: "live", android: "development" }),
  "covered view collapses covering acceptances to the weakest status per platform",
);

// A view platform no covering acceptance speaks to is omitted (honest empty).
const narrowAcc = { id: "AC-n", species: "acceptance", status: "live", platforms: ["web"], metadata: {} };
const coverN = { id: "e-n", edge_type: "covers", source_id: "AC-n", target_id: "V-x" };
assert(
  eq(getEffectivePlatformStatuses(view, [view, narrowAcc], [coverN]), { web: "live" }),
  "platforms no covering acceptance applies to are omitted from the effective map",
);

// Non-view species keep their stored statuses regardless of edges.
assert(
  eq(getEffectivePlatformStatuses(accA, [accA], []), getNodePlatformStatuses(accA)),
  "non-view species return stored statuses (acceptances resolve their own overrides)",
);

// Flow rollup: playlist views (effective) + acceptances covering the flow directly.
const flow = { id: "F-x", species: "flow", status: "development", platforms: ["web"], metadata: { playlist: { entries: [{ type: "view", view_id: "V-x" }] } } };
const flowAcc = { id: "AC-f", species: "acceptance", status: "development", platforms: ["web"], metadata: { platformStatuses: { web: "live" } } };
const coverFlow = { id: "e-f", edge_type: "covers", source_id: "AC-f", target_id: "F-x" };
const flowNodes = [view, accA, accB, flow, flowAcc];
const flowEdges = [coverA, coverB, coverFlow];
const flowNodesById = new Map(flowNodes.map((n) => [n.id, n]));
const flowRollup = computeFlowPlatformRollup(flow, flowNodesById, flowNodes, flowEdges);
assert(
  (flowRollup.counts.web?.live ?? 0) === 1,
  "flow rollup includes web:live from the acceptance covering the flow directly",
);
assert(
  (flowRollup.counts.android?.development ?? 0) === 1,
  "flow rollup counts the effective (weakest) status of a covered descendant view",
);

// =========================== Seed goldens ====================================

const ROOT = path.join(__dirname, "..", "..");
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "seed", "pebbles.json"), "utf8"));
const nodesById = new Map(bundle.nodes.map((node) => [node.id, node]));
const byId = (id) => bundle.nodes.find((n) => n.id === id);

assert(
  eq(getEffectivePlatformStatuses(byId("V-pebble-detail"), bundle.nodes, bundle.edges), { web: "backlog", ios: "live", android: "development" }),
  "seed: V-pebble-detail effective statuses derive from its two covering acceptances",
);
assert(
  eq(getEffectivePlatformStatuses(byId("V-glyphs-list"), bundle.nodes, bundle.edges), getNodePlatformStatuses(byId("V-glyphs-list"))),
  "seed: an uncovered view keeps its stored statuses",
);

// F-swap-glyph gains web:live from AC-buy-community-glyph vs the stored playlist rollup.
const swapEntries = byId("F-swap-glyph").metadata.playlist.entries;
const swapBase = computePlaylistRollup(swapEntries, nodesById);
const swapEff = computeFlowPlatformRollup(byId("F-swap-glyph"), nodesById, bundle.nodes, bundle.edges);
assert(
  (swapEff.counts.web?.live ?? 0) === (swapBase.counts.web?.live ?? 0) + 1,
  "seed: F-swap-glyph flow rollup gains one web:live from AC-buy-community-glyph",
);

fs.rmSync(BUILD_DIR, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll effective-status tests passed");
