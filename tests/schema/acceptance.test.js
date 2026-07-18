#!/usr/bin/env node

/**
 * Foundation tests for the acceptance & value model
 * (docs/superpowers/specs/2026-07-19-acceptance-value-model-design.md):
 * enums, id derivation, metadata fields, validator rules, projections,
 * backdated-journal ordering, and per-platform event diffing.
 */

const { loadSchema, BUILD_DIR } = require("./load-schema");
const fs = require("fs");

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`PASS: ${name}`);
  else {
    failures++;
    console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const schema = loadSchema();
const {
  SPECIES_IDS, EDGE_TYPE_IDS, VALUE_IDS, VALUE_TIER_IDS, VALUE_TIERS,
  SPECIES_PREFIXES, deriveNodeId,
} = schema;

// --- Task 1: enums & prefixes ------------------------------------------------
check("acceptance is a species", SPECIES_IDS.includes("acceptance"));
check("covers is an edge type", EDGE_TYPE_IDS.includes("covers"));
check("VALUE_IDS has the 30 Bain B2C elements", VALUE_IDS.length === 30, `got ${VALUE_IDS.length}`);
check("VALUE_TIER_IDS has 4 tiers", VALUE_TIER_IDS.length === 4);
check(
  "every value maps to a valid tier",
  VALUE_IDS.every((v) => VALUE_TIER_IDS.includes(VALUE_TIERS[v])),
);
check(
  "tier distribution is 14/10/5/1",
  ["functional", "emotional", "life-changing", "social-impact"]
    .map((t) => VALUE_IDS.filter((v) => VALUE_TIERS[v] === t).length)
    .join("/") === "14/10/5/1",
);
check("acceptance id prefix is AC-", SPECIES_PREFIXES.acceptance === "AC-");
check(
  "deriveNodeId prefixes acceptances",
  deriveNodeId("acceptance", "Pebble draw-in animation") === "AC-pebble-draw-in-animation",
);

// (later tasks append their sections here)

// --- Task 2: NodeMetadata fields --------------------------------------------
const { parseBundle } = schema;
const NOW = "2026-07-19T00:00:00.000Z";
function makeBundle(nodes, edges = [], extra = {}) {
  return {
    schema_version: 2,
    project: { id: "p", title: "P", created_at: NOW, updated_at: NOW },
    nodes,
    edges,
    ...extra,
  };
}
const acc = {
  id: "AC-pebble-draw-in-animation",
  project_id: "p",
  species: "acceptance",
  title: "Pebble draw-in animation",
  status: "backlog",
  platforms: ["web", "ios", "android"],
  metadata: {
    gherkin: "When I'm on the Pebble Detail, Then I see the Pebble appearing in a drawing animation.",
    values: ["fun-entertainment", "design-aesthetics"],
    platformStatuses: { ios: "live", android: "development" },
  },
};
const view = {
  id: "V-pebble-detail", project_id: "p", species: "view", title: "Pebble Detail",
  status: "live", platforms: ["web", "ios", "android"],
};
const covers = {
  id: "e-AC-pebble-draw-in-animation-V-pebble-detail", project_id: "p",
  source_id: "AC-pebble-draw-in-animation", target_id: "V-pebble-detail", edge_type: "covers",
};

const parsed = parseBundle(makeBundle([acc, view], [covers]));
check("parseBundle accepts gherkin/values/covers", parsed.success, JSON.stringify(parsed.success ? "" : parsed.error.issues[0]));

const badValue = JSON.parse(JSON.stringify(acc));
badValue.metadata.values = ["synergy"];
check("parseBundle rejects unknown value ids", !parseBundle(makeBundle([badValue, view], [covers])).success);

// --- Task 3: validator rules -------------------------------------------------
const { validateBundle } = schema;
const rules = (result) => result.findings.map((f) => `${f.severity}:${f.rule}`);

const okResult = validateBundle(makeBundle([acc, view], [covers]));
check("valid acceptance bundle has no findings", okResult.valid && okResult.findings.length === 0, JSON.stringify(rules(okResult)));

const flowNode = {
  id: "F-record", project_id: "p", species: "flow", title: "Record",
  status: "live", platforms: ["web"],
  metadata: { playlist: { entries: [{ type: "view", view_id: "V-pebble-detail" }] } },
};
const composesEdge = {
  id: "e-F-record-V-pebble-detail", project_id: "p",
  source_id: "F-record", target_id: "V-pebble-detail", edge_type: "composes",
};
const coversFlow = {
  id: "e-AC-pebble-draw-in-animation-F-record", project_id: "p",
  source_id: "AC-pebble-draw-in-animation", target_id: "F-record", edge_type: "covers",
};
const flowOk = validateBundle(makeBundle([acc, view, flowNode], [covers, composesEdge, coversFlow]));
check("covers acceptance→flow is admitted", flowOk.valid, JSON.stringify(flowOk.errors));

const badCovers = validateBundle(makeBundle([acc, view], [
  { id: "e-V-pebble-detail-AC-pebble-draw-in-animation", project_id: "p",
    source_id: "V-pebble-detail", target_id: "AC-pebble-draw-in-animation", edge_type: "covers" },
]));
check("covers view→acceptance is rejected", rules(badCovers).includes("error:edge-semantics"), JSON.stringify(rules(badCovers)));

const badVal = JSON.parse(JSON.stringify(acc));
badVal.metadata.values = ["synergy"];
check("unknown value element is an error",
  rules(validateBundle(makeBundle([badVal, view], [covers]))).includes("error:valid-value"));

const draft = { id: "AC-draft", project_id: "p", species: "acceptance", title: "Draft", status: "idea", platforms: ["web"] };
const draftResult = validateBundle(makeBundle([draft]));
check("title-only acceptance draft: two warnings, still valid",
  draftResult.valid &&
  rules(draftResult).includes("warning:acceptance-gherkin-missing") &&
  rules(draftResult).includes("warning:acceptance-values-missing"),
  JSON.stringify(rules(draftResult)));

const viewWithGherkin = JSON.parse(JSON.stringify(view));
viewWithGherkin.metadata = { gherkin: "When…", values: ["informs"] };
const misplaced = validateBundle(makeBundle([viewWithGherkin]));
check("gherkin/values on a view are warnings",
  misplaced.valid &&
  rules(misplaced).includes("warning:gherkin-species") &&
  rules(misplaced).includes("warning:values-species"),
  JSON.stringify(rules(misplaced)));

const accBadSubset = JSON.parse(JSON.stringify(acc));
accBadSubset.platforms = ["ios"];
accBadSubset.metadata.platformStatuses = { web: "live", ios: "live" };
check("platformStatuses outside platforms stays a warning on acceptances (spec deviation note)",
  rules(validateBundle(makeBundle([accBadSubset, view], [covers]))).includes("warning:platform-statuses-subset"));

const uncovered = validateBundle(makeBundle([draft]));
check("acceptance with zero covers edges is NOT an orphan finding",
  !rules(uncovered).some((r) => r.includes("orphan")));

// --- Task 5: projections -----------------------------------------------------
const {
  resolvePlatformStatus, hasParityGap, computeParityGaps,
  acceptancesCovering, computeUncoveredViews, computeAnchorRollup,
} = schema;

check("resolvePlatformStatus: override wins", resolvePlatformStatus(acc, "ios") === "live");
check("resolvePlatformStatus: base fallback", resolvePlatformStatus(acc, "web") === "backlog");
check("resolvePlatformStatus: non-applicable platform is undefined",
  resolvePlatformStatus({ ...acc, platforms: ["ios"] }, "web") === undefined);

check("hasParityGap: live on ios, not on web/android", hasParityGap(acc) === true);
const allLive = { ...acc, status: "live", metadata: { ...acc.metadata, platformStatuses: {} } };
check("hasParityGap: uniformly live is no gap", hasParityGap(allLive) === false);
const noneLive = { ...acc, metadata: { ...acc.metadata, platformStatuses: { ios: "development", android: "development" } } };
check("hasParityGap: nothing delivered is no gap", hasParityGap(noneLive) === false);
check("hasParityGap: archived acceptances are excluded", hasParityGap({ ...acc, status: "archived" }) === false);
check("hasParityGap: threshold parameter", hasParityGap(noneLive, ["live", "development"]) === true);

const gaps = computeParityGaps([acc, view, allLive]);
check("computeParityGaps returns only gapped acceptances",
  gaps.length === 1 && gaps[0].node_id === "AC-pebble-draw-in-animation" &&
  gaps[0].delivered.includes("ios") && gaps[0].missing.web === "backlog" && gaps[0].missing.android === "development",
  JSON.stringify(gaps));

check("acceptancesCovering finds the acceptance",
  acceptancesCovering("V-pebble-detail", [acc, view], [covers]).map((n) => n.id).join() === "AC-pebble-draw-in-animation");

const orphanView = { id: "V-orphan", project_id: "p", species: "view", title: "Orphan", status: "idea", platforms: ["web"] };
check("computeUncoveredViews lists views without covers",
  computeUncoveredViews([acc, view, orphanView], [covers]).map((n) => n.id).join() === "V-orphan");

const rollup = computeAnchorRollup("V-pebble-detail", [acc, view], [covers]);
check("computeAnchorRollup counts resolved statuses per platform",
  rollup !== null && rollup.ios.live === 1 && rollup.android.development === 1 && rollup.web.backlog === 1,
  JSON.stringify(rollup));
check("computeAnchorRollup is null when nothing covers (fallback signal)",
  computeAnchorRollup("V-orphan", [acc, view, orphanView], [covers]) === null);

const multiAnchorNodes = [acc, view, flowNode];
const multiAnchorEdges = [covers, composesEdge, coversFlow];
check("acceptancesCovering works for flow anchors",
  acceptancesCovering("F-record", multiAnchorNodes, multiAnchorEdges).map((n) => n.id).join() === "AC-pebble-draw-in-animation");
const flowRollup = computeAnchorRollup("F-record", multiAnchorNodes, multiAnchorEdges);
check("computeAnchorRollup works for flow anchors",
  flowRollup !== null && flowRollup.ios.live === 1 && flowRollup.web.backlog === 1,
  JSON.stringify(flowRollup));
check("multi-anchor acceptance appears under each anchor independently",
  acceptancesCovering("V-pebble-detail", multiAnchorNodes, multiAnchorEdges).length === 1 &&
  acceptancesCovering("F-record", multiAnchorNodes, multiAnchorEdges).length === 1 &&
  computeAnchorRollup("V-pebble-detail", multiAnchorNodes, multiAnchorEdges).ios.live === 1);

// --- Task 6: backdated journal + event diffing -------------------------------
const { orderEvents, computeNodeTimeline, diffNodeUpdate } = schema;

// Retro-population appends events NOW with historical ts (spec §5): file order
// is newest-first here; projections must still read chronologically.
const backdated = [
  { id: "01K0ZZZZZZZZZZZZZZZZZZZZZZ", ts: "2026-07-19T00:00:00.000Z", type: "node.status_changed", node_id: "AC-x", from: "development", to: "live", platform: "ios" },
  { id: "01K0AAAAAAAAAAAAAAAAAAAAAA", ts: "2025-11-02T00:00:00.000Z", type: "node.created", node_id: "AC-x", species: "acceptance", title: "X", actor: "backfill-agent" },
  { id: "01K0BBBBBBBBBBBBBBBBBBBBBB", ts: "2026-02-14T00:00:00.000Z", type: "node.status_changed", node_id: "AC-x", from: "backlog", to: "development", platform: "ios", actor: "backfill-agent" },
];
const ordered = orderEvents(backdated);
check("orderEvents sorts backdated appends by ts",
  ordered[0].ts.startsWith("2025-11") && ordered[1].ts.startsWith("2026-02") && ordered[2].ts.startsWith("2026-07"),
  ordered.map((e) => e.ts).join(", "));
const timeline = computeNodeTimeline(backdated, "AC-x");
check("computeNodeTimeline reads backdated events chronologically",
  timeline[0]?.type === "node.created" && timeline.length === 3,
  JSON.stringify(timeline).slice(0, 200));

// diffNodeUpdate emits node.status_changed + platform for an acceptance's
// platformStatuses delta — same mechanism views use (derive.ts:125).
const patchInputs = diffNodeUpdate(acc, {
  metadata: { ...acc.metadata, platformStatuses: { ...acc.metadata.platformStatuses, android: "live" } },
});
const platformEvents = patchInputs.filter((input) => input.type === "node.status_changed");
check("diffNodeUpdate emits per-platform status_changed for acceptances",
  platformEvents.length === 1 &&
  platformEvents[0].payload.platform === "android" &&
  platformEvents[0].payload.from === "development" &&
  platformEvents[0].payload.to === "live",
  JSON.stringify(patchInputs));

fs.rmSync(BUILD_DIR, { recursive: true, force: true });
if (failures > 0) {
  console.log(`\n${failures} acceptance test(s) failed.`);
  process.exit(1);
}
console.log("\nAll acceptance tests passed.");
