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

fs.rmSync(BUILD_DIR, { recursive: true, force: true });
if (failures > 0) {
  console.log(`\n${failures} acceptance test(s) failed.`);
  process.exit(1);
}
console.log("\nAll acceptance tests passed.");
