#!/usr/bin/env node

/**
 * Rollup seam (lib/utils/platform-status.ts) — a view's effective per-platform
 * status from covering acceptances, with stored fallback; the flow rollup
 * extended by directly-covering acceptances (spec §3.4); and the widening rule
 * that decides which platforms a gauge draws a bar for.
 */

const fs = require("fs");
const path = require("path");
const { loadEffectiveStatus, BUILD_DIR } = require("./load-effective-status");

const {
  getEffectivePlatformStatuses,
  getNodePlatformStatuses,
  computePlaylistRollup,
  computeFlowPlatformRollup,
  withRollupPlatforms,
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

// ====================== withRollupPlatforms (the widening) ===================
//
// Which platforms a gauge draws a bar for. `PlatformGaugeList` used to union its
// `platforms` prop with the rollup internally; that union now lives here, called
// explicitly by the flow-shaped call sites. Two guarantees: set union with the
// rollup's own platforms, and PLATFORMS config order (web, ios, android)
// regardless of argument order.

const emptyRollup = { counts: {}, totals: {} };
const threeRollup = {
  counts: { web: { live: 3 }, ios: { development: 2 }, android: { prioritized: 1 } },
  totals: { web: 3, ios: 2, android: 1 },
};
const androidOnlyRollup = { counts: { android: { live: 1 } }, totals: { android: 1 } };

// The regression this rule exists to prevent: a flow declaring less than its
// rollup counted. Without the widening the android bar silently disappears.
assert(
  eq(withRollupPlatforms(["web"], threeRollup), ["web", "ios", "android"]),
  "a declared list narrower than the rollup is widened by what the rollup counted",
);
assert(
  eq(withRollupPlatforms(["web", "ios"], androidOnlyRollup), ["web", "ios", "android"]),
  "the widening adds only what is missing — declared entries are not dropped",
);

// The other direction: a declared platform the rollup never counted still gets a
// bar (an empty one), because the node genuinely claims that platform.
assert(
  eq(withRollupPlatforms(["web", "ios", "android"], androidOnlyRollup), ["web", "ios", "android"]),
  "a declared list wider than the rollup is preserved, not narrowed to what was counted",
);
assert(
  eq(withRollupPlatforms(["web", "ios"], emptyRollup), ["web", "ios"]),
  "an empty rollup returns the declared list unchanged",
);
assert(eq(withRollupPlatforms([], emptyRollup), []), "nothing declared and nothing counted is empty");

// Ordering is PLATFORMS' (web, ios, android), never the argument's — the gauge
// stacks bars in this order and must not reshuffle when a caller reorders.
assert(
  eq(withRollupPlatforms(["android", "web"], emptyRollup), ["web", "android"]),
  "ordering follows PLATFORMS config order, not argument order",
);
assert(
  eq(withRollupPlatforms(["android", "ios", "web"], emptyRollup), ["web", "ios", "android"]),
  "a fully reversed argument comes back in config order",
);

// Discrimination check: the ordering assertion above is only meaningful if
// config order and argument order actually differ, so pin that they do. If
// `withRollupPlatforms` were mutated to `[...new Set([...declared, ...rollup])]`
// — preserving argument order — the assertion above flips to FAIL, not to a
// vacuous PASS.
assert(
  !eq(["android", "web"], withRollupPlatforms(["android", "web"], emptyRollup)),
  "the ordering fixture is discriminating: argument order and config order really differ",
);

// The union is a set, not a concatenation — a platform in both inputs appears once.
assert(
  withRollupPlatforms(["android"], androidOnlyRollup).filter((p) => p === "android").length === 1,
  "a platform present in both the declared list and the rollup is not duplicated",
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

// The seed's one flow whose rollup outruns its own platforms: F-swap-glyph
// declares web/ios, but its descendant V-glyphs-list declares android, so the
// rollup counts a platform the flow never claims. Arguably a seed authoring
// smell — but it is real data, and it is what makes withRollupPlatforms
// load-bearing rather than hypothetical. Do NOT "fix" the seed to make this
// pass; the widening is what keeps that android bar on screen.
const swapDeclared = byId("F-swap-glyph").platforms;
assert(
  !swapDeclared.includes("android") && (swapEff.totals.android ?? 0) > 0,
  "seed: F-swap-glyph's rollup counts android while the flow itself declares only web/ios",
);
assert(
  eq(withRollupPlatforms(swapDeclared, swapEff), ["web", "ios", "android"]),
  "seed: the widening keeps F-swap-glyph's android bar, which its declared list alone would drop",
);

fs.rmSync(BUILD_DIR, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll effective-status tests passed");
