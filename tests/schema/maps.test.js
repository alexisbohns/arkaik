#!/usr/bin/env node

/**
 * Maps — MapDefinition resolution, computeMapSubgraph selection semantics
 * (docs/spec/maps.md § Subgraph Algorithm), listMaps composition, and the
 * warning-severity validation rules (§ Validation).
 */

const { loadSchema, BUILD_DIR } = require("./load-schema");
const fs = require("fs");

const {
  BUILT_IN_MAPS,
  computeMapSubgraph,
  isBuiltInMapId,
  listMaps,
  resolveMapDefaults,
  validateBundle,
} = loadSchema();

let failures = 0;
function assert(cond, message) {
  if (cond) console.log(`PASS: ${message}`);
  else {
    failures++;
    console.log(`FAIL: ${message}`);
  }
}

// --- Fixture graph: one flow, two views, one API, one data model -----------
const nodes = [
  {
    id: "F-a",
    project_id: "p",
    species: "flow",
    title: "A",
    status: "live",
    platforms: ["web"],
    metadata: { playlist: { entries: [{ type: "view", view_id: "V-b" }] } },
  },
  { id: "V-b", project_id: "p", species: "view", title: "B", status: "live", platforms: ["web"] },
  { id: "V-c", project_id: "p", species: "view", title: "C", status: "idea", platforms: ["web"] },
  { id: "API-d", project_id: "p", species: "api-endpoint", title: "D", status: "live", platforms: ["web"] },
  { id: "DM-e", project_id: "p", species: "data-model", title: "E", status: "live", platforms: ["web"] },
];
const edges = [
  { id: "e-F-a-V-b", project_id: "p", source_id: "F-a", target_id: "V-b", edge_type: "composes" },
  { id: "e-V-b-V-c", project_id: "p", source_id: "V-b", target_id: "V-c", edge_type: "composes" },
  { id: "e-V-b-API-d", project_id: "p", source_id: "V-b", target_id: "API-d", edge_type: "calls" },
  { id: "e-API-d-DM-e", project_id: "p", source_id: "API-d", target_id: "DM-e", edge_type: "queries" },
  { id: "e-V-c-DM-e", project_id: "p", source_id: "V-c", target_id: "DM-e", edge_type: "displays" },
];

const ids = (elements) => elements.map((el) => el.id).sort();

// --- resolveMapDefaults ----------------------------------------------------
{
  const journey = resolveMapDefaults({ id: "journey", title: "Journey", kind: "journey" });
  assert(
    JSON.stringify(journey.species) === JSON.stringify(["flow", "view"]) &&
      JSON.stringify(journey.edge_types) === JSON.stringify(["composes"]),
    "resolveMapDefaults: journey defaults to flow+view / composes",
  );

  const system = resolveMapDefaults({ id: "system", title: "System", kind: "system" });
  assert(
    JSON.stringify(system.species) === JSON.stringify(["view", "api-endpoint", "data-model"]) &&
      JSON.stringify(system.edge_types) === JSON.stringify(["calls", "displays", "queries"]),
    "resolveMapDefaults: system defaults to view+api+dm / cross-layer edges",
  );

  const explicit = resolveMapDefaults({ id: "x", title: "X", kind: "system", species: ["view"] });
  assert(
    JSON.stringify(explicit.species) === JSON.stringify(["view"]),
    "resolveMapDefaults: explicit species wins over kind defaults",
  );

  const unknown = resolveMapDefaults({ id: "y", title: "Y", kind: "mystery" });
  assert(
    unknown.species.length === 0 && unknown.edge_types.length === 0,
    "resolveMapDefaults: unknown kind resolves to empty filters",
  );
}

// --- computeMapSubgraph: kind selection -------------------------------------
{
  const journey = computeMapSubgraph({ id: "journey", title: "J", kind: "journey" }, nodes, edges);
  assert(
    JSON.stringify(ids(journey.nodes)) === JSON.stringify(["F-a", "V-b", "V-c"]),
    "journey subgraph keeps flows and views only",
  );
  assert(
    JSON.stringify(ids(journey.edges)) === JSON.stringify(["e-F-a-V-b", "e-V-b-V-c"]),
    "journey subgraph keeps composes edges only",
  );

  const system = computeMapSubgraph({ id: "system", title: "S", kind: "system" }, nodes, edges);
  assert(
    JSON.stringify(ids(system.nodes)) === JSON.stringify(["API-d", "DM-e", "V-b", "V-c"]),
    "system subgraph keeps views, APIs, and data models",
  );
  assert(
    JSON.stringify(ids(system.edges)) === JSON.stringify(["e-API-d-DM-e", "e-V-b-API-d", "e-V-c-DM-e"]),
    "system subgraph keeps cross-layer edges (endpoint-survival: composes dropped with the flow)",
  );

  // Endpoint survival: a calls edge whose view endpoint is filtered out drops.
  const apisOnly = computeMapSubgraph(
    { id: "z", title: "Z", kind: "system", species: ["api-endpoint", "data-model"] },
    nodes,
    edges,
  );
  assert(
    JSON.stringify(ids(apisOnly.edges)) === JSON.stringify(["e-API-d-DM-e"]),
    "edge filter requires both endpoints to survive the species filter",
  );
}

// --- computeMapSubgraph: root scoping ---------------------------------------
{
  const scoped = computeMapSubgraph(
    { id: "s", title: "S", kind: "system", root_node_id: "DM-e" },
    nodes,
    edges,
  );
  assert(
    JSON.stringify(ids(scoped.nodes)) === JSON.stringify(["API-d", "DM-e", "V-b", "V-c"]),
    "root scope is undirected (DM-e reaches its callers upstream)",
  );

  const bounded = computeMapSubgraph(
    { id: "s", title: "S", kind: "system", root_node_id: "DM-e", depth: 1 },
    nodes,
    edges,
  );
  assert(
    JSON.stringify(ids(bounded.nodes)) === JSON.stringify(["API-d", "DM-e", "V-c"]),
    "depth bounds the traversal (V-b is two hops from DM-e)",
  );
  assert(
    JSON.stringify(ids(bounded.edges)) === JSON.stringify(["e-API-d-DM-e", "e-V-c-DM-e"]),
    "bounded subgraph keeps only edges among visited nodes",
  );

  const unresolvable = computeMapSubgraph(
    { id: "s", title: "S", kind: "system", root_node_id: "V-nope" },
    nodes,
    edges,
  );
  assert(
    unresolvable.nodes.length === 0 && unresolvable.edges.length === 0,
    "unresolvable root yields the empty subgraph, not an error",
  );

  const filteredRoot = computeMapSubgraph(
    { id: "s", title: "S", kind: "system", root_node_id: "F-a" },
    nodes,
    edges,
  );
  assert(
    filteredRoot.nodes.length === 0,
    "a root removed by the species filter is unresolvable (flow root on a system map)",
  );
}

// --- computeMapSubgraph: generic passthrough --------------------------------
{
  const decorated = nodes.map((node) => ({ ...node, extra: `decorated-${node.id}` }));
  const result = computeMapSubgraph({ id: "j", title: "J", kind: "journey" }, decorated, edges);
  assert(
    result.nodes.every((node) => node.extra === `decorated-${node.id}`) &&
      result.nodes.every((node) => decorated.includes(node)),
    "callers get their own element objects back (generic passthrough, no copies)",
  );
}

// --- listMaps ---------------------------------------------------------------
{
  assert(isBuiltInMapId("journey") && isBuiltInMapId("system") && !isBuiltInMapId("custom"), "isBuiltInMapId");

  const project = {
    metadata: {
      maps: [
        { id: "custom", title: "Custom", kind: "journey", root_node_id: "V-b" },
        { id: "journey", title: "Shadow", kind: "journey" }, // reserved — skipped
        { id: 42, title: "Bad id" }, // malformed — skipped
        "not-an-object", // malformed — skipped
        { id: "weird", title: "Weird", kind: "mystery" }, // unknown kind — listed
      ],
    },
  };
  const maps = listMaps(project);
  assert(
    JSON.stringify(maps.map((m) => m.id)) === JSON.stringify(["journey", "system", "custom", "weird"]),
    "listMaps = built-ins, then stored (reserved ids and malformed entries skipped; unknown kinds listed)",
  );
  assert(
    JSON.stringify(listMaps({}).map((m) => m.id)) === JSON.stringify(["journey", "system"]),
    "listMaps without metadata yields the built-ins",
  );
  assert(BUILT_IN_MAPS.length === 2, "two built-in maps");
}

// --- Validator warnings (docs/spec/maps.md § Validation) --------------------
{
  const baseBundle = () => ({
    project: {
      id: "p",
      title: "P",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      metadata: {},
    },
    nodes: JSON.parse(JSON.stringify(nodes)),
    edges: JSON.parse(JSON.stringify(edges)),
  });

  const clean = validateBundle(baseBundle());
  assert(clean.valid && clean.findings.length === 0, "fixture bundle is clean before map findings");

  const withMaps = baseBundle();
  withMaps.project.metadata.maps = [
    { id: "dup", title: "One", kind: "journey" },
    { id: "dup", title: "Two", kind: "journey" },
    { id: "system", title: "Shadow", kind: "system" },
    { id: "dangling", title: "Dangling", kind: "journey", root_node_id: "V-nope" },
    { id: "odd", title: "Odd", kind: "system", species: ["view", "gremlin"], edge_types: ["calls", "wires"] },
  ];
  const result = validateBundle(withMaps);
  const rules = result.findings.map((f) => f.rule);

  assert(rules.includes("map-duplicate-id"), "map-duplicate-id fires");
  assert(rules.includes("map-shadows-built-in"), "map-shadows-built-in fires");
  assert(rules.includes("map-unknown-root"), "map-unknown-root fires");
  assert(rules.includes("map-unknown-species"), "map-unknown-species fires");
  assert(rules.includes("map-unknown-edge-type"), "map-unknown-edge-type fires");
  assert(
    result.findings.every((f) => f.severity === "warning"),
    "every map finding is warning severity",
  );
  assert(result.valid, "a bundle with broken maps stays valid (warnings never fail CI)");
}

fs.rmSync(BUILD_DIR, { recursive: true, force: true });

if (failures > 0) {
  console.log(`\n${failures} maps test(s) failed.`);
  process.exit(1);
}
console.log("\nAll maps tests passed.");
