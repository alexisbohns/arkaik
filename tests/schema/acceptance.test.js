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

fs.rmSync(BUILD_DIR, { recursive: true, force: true });
if (failures > 0) {
  console.log(`\n${failures} acceptance test(s) failed.`);
  process.exit(1);
}
console.log("\nAll acceptance tests passed.");
