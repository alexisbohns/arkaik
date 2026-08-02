#!/usr/bin/env node

/**
 * The edge semantics table and the lookup the editor asks before offering a
 * relationship (issue #317). The table is the single source of truth shared by
 * validateBundle() and the connect dialog — before this, the dialog offered all
 * five edge types for any pair, so the app could author graphs its own
 * validator rejected at export.
 */

const { loadSchema, BUILD_DIR } = require("./load-schema");
const fs = require("fs");

const { VALID_EDGE_SEMANTICS, edgeTypesForSpeciesPair, isValidEdgeSemantic, EDGE_TYPE_IDS } = loadSchema();

let failures = 0;
function assert(cond, message) {
  if (cond) console.log(`PASS: ${message}`);
  else {
    failures++;
    console.log(`FAIL: ${message}`);
  }
}

// --- The table covers every edge type --------------------------------------
assert(
  EDGE_TYPE_IDS.every((id) => Array.isArray(VALID_EDGE_SEMANTICS[id]) && VALID_EDGE_SEMANTICS[id].length > 0),
  "every edge type has at least one admitted species pair",
);

// --- `calls` runs in both directions between a view and an endpoint --------
assert(isValidEdgeSemantic("calls", "view", "api-endpoint"), "calls view → api-endpoint is admitted");
assert(isValidEdgeSemantic("calls", "flow", "api-endpoint"), "calls flow → api-endpoint is admitted");
assert(
  isValidEdgeSemantic("calls", "api-endpoint", "api-endpoint"),
  "calls api-endpoint → api-endpoint is admitted (endpoint fan-out, #264)",
);
assert(
  isValidEdgeSemantic("calls", "api-endpoint", "view"),
  "calls api-endpoint → view is admitted (the inbound/read affordance, #317)",
);

// --- and still refuses the shapes that have no meaning ---------------------
assert(!isValidEdgeSemantic("calls", "api-endpoint", "flow"), "calls api-endpoint → flow stays rejected");
assert(!isValidEdgeSemantic("calls", "view", "view"), "calls view → view stays rejected");
assert(!isValidEdgeSemantic("displays", "data-model", "view"), "displays is one-directional");
assert(!isValidEdgeSemantic("queries", "data-model", "api-endpoint"), "queries is one-directional");
assert(!isValidEdgeSemantic("covers", "view", "acceptance"), "covers view → acceptance stays rejected");
assert(!isValidEdgeSemantic("wires", "view", "view"), "an unknown edge type is never valid");

// --- The dialog's lookup ---------------------------------------------------
assert(
  JSON.stringify(edgeTypesForSpeciesPair("view", "api-endpoint")) === JSON.stringify(["calls"]),
  "view → api-endpoint offers calls only",
);
assert(
  JSON.stringify(edgeTypesForSpeciesPair("api-endpoint", "view")) === JSON.stringify(["calls"]),
  "api-endpoint → view offers calls only",
);
assert(
  JSON.stringify(edgeTypesForSpeciesPair("view", "flow")) === JSON.stringify(["composes"]),
  "view → flow offers composes only",
);
assert(
  JSON.stringify(edgeTypesForSpeciesPair("acceptance", "view")) === JSON.stringify(["covers"]),
  "acceptance → view offers covers only",
);
assert(
  JSON.stringify(edgeTypesForSpeciesPair("data-model", "view")) === JSON.stringify([]),
  "a pair with no admitted relationship offers nothing",
);
assert(
  JSON.stringify(edgeTypesForSpeciesPair("view", "gremlin")) === JSON.stringify([]),
  "an unknown species offers nothing rather than throwing",
);

// --- Results are in EDGE_TYPE_IDS order, and never lie about the table -----
for (const source of ["flow", "view", "data-model", "api-endpoint", "acceptance"]) {
  for (const target of ["flow", "view", "data-model", "api-endpoint", "acceptance"]) {
    const offered = edgeTypesForSpeciesPair(source, target);
    const expected = EDGE_TYPE_IDS.filter((id) => isValidEdgeSemantic(id, source, target));
    if (JSON.stringify(offered) !== JSON.stringify(expected)) {
      failures++;
      console.log(`FAIL: ${source} → ${target} offered ${JSON.stringify(offered)}, table says ${JSON.stringify(expected)}`);
    }
  }
}
assert(true, "every species pair's offer agrees with the table, in EDGE_TYPE_IDS order");

fs.rmSync(BUILD_DIR, { recursive: true, force: true });

if (failures > 0) {
  console.log(`\n${failures} edge-semantics test(s) failed.`);
  process.exit(1);
}
console.log("\nAll edge-semantics tests passed.");
