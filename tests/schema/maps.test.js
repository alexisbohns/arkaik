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
  DEFAULT_MAP_DISPLAY,
  buildProductGraph,
  computeMapSubgraph,
  isBuiltInMapId,
  listMaps,
  resolveMapDefaults,
  resolveMapDisplay,
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

// --- resolveMapDisplay (docs/spec/maps.md § Display Options) ----------------
{
  const journey = { id: "journey", title: "Journey", kind: "journey" };

  assert(
    JSON.stringify(resolveMapDisplay()) === JSON.stringify(DEFAULT_MAP_DISPLAY),
    "resolveMapDisplay with no arguments is the default display",
  );
  assert(
    JSON.stringify(resolveMapDisplay(journey, {})) === JSON.stringify(DEFAULT_MAP_DISPLAY),
    "a project with no metadata gets the default display",
  );

  assert(
    DEFAULT_MAP_DISPLAY.flow_platforms === "rings" &&
      DEFAULT_MAP_DISPLAY.view_platforms === "chips" &&
      DEFAULT_MAP_DISPLAY.images === true &&
      DEFAULT_MAP_DISPLAY.minimap_color === "status",
    "the default display is rings + chips + status minimap, images on",
  );

  const minimap = resolveMapDisplay(
    { id: "custom", display: { minimap_color: "species" } },
    { metadata: {} },
  );
  assert(
    minimap.minimap_color === "species" && minimap.view_platforms === "chips",
    "minimap_color resolves on its own without disturbing the other keys",
  );

  const minimapOverride = resolveMapDisplay(
    { id: "custom", display: { minimap_color: "species" } },
    { metadata: { map_display: { custom: { minimap_color: "status" } } } },
  );
  assert(
    minimapOverride.minimap_color === "status",
    "a per-map minimap_color override wins over the definition",
  );

  assert(
    resolveMapDisplay(
      { id: "custom", display: { minimap_color: "rainbow" } },
      { metadata: {} },
    ).minimap_color === "status",
    "an unknown minimap_color falls back to the default",
  );

  const legacy = resolveMapDisplay(journey, { metadata: { view_card_variant: "large" } });
  assert(
    JSON.stringify(legacy) === JSON.stringify(DEFAULT_MAP_DISPLAY),
    "the superseded view_card_variant is not a resolution layer — it no longer moves anything",
  );

  const authored = resolveMapDisplay(
    { id: "custom", display: { images: false, flow_platforms: "bars" } },
    { metadata: {} },
  );
  assert(
    authored.images === false && authored.flow_platforms === "bars" && authored.view_platforms === "chips",
    "a definition's own display wins over the defaults, key by key",
  );

  const overridden = resolveMapDisplay(
    { id: "custom", display: { images: false, flow_platforms: "bars" } },
    { metadata: { map_display: { custom: { images: true } } } },
  );
  assert(
    overridden.images === true && overridden.flow_platforms === "bars",
    "the per-map override wins over the definition, key by key",
  );

  const perMap = { metadata: { map_display: { journey: { view_platforms: "rows" }, loop: { view_platforms: "chips" } } } };
  assert(
    resolveMapDisplay({ id: "journey" }, perMap).view_platforms === "rows" &&
      resolveMapDisplay({ id: "loop" }, perMap).view_platforms === "chips",
    "two maps in one project resolve to different displays",
  );
  assert(
    resolveMapDisplay({ id: "system" }, perMap).view_platforms === DEFAULT_MAP_DISPLAY.view_platforms,
    "a map with no override keeps the default",
  );

  const garbage = resolveMapDisplay(
    { id: "journey", display: { flow_platforms: "sparklines", images: "yes" } },
    { metadata: { map_display: { journey: { view_platforms: 7 } } } },
  );
  assert(
    JSON.stringify(garbage) === JSON.stringify(DEFAULT_MAP_DISPLAY),
    "unknown values fall back rather than blanking the card",
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

// --- Product scope (docs/spec/maps.md § Product Scope) ----------------------
//
// The restriction is inside `computeMapSubgraph`, not applied by the caller
// before it (issue #319). Every audience therefore gets it: the canvas, the MCP
// server's `get_map` / `list_maps`, and anything that calls the function next.
{
  const p = (product) => ({ product });
  const productNodes = [
    { id: "F-admin", project_id: "p", species: "flow", title: "Admin", status: "live", platforms: ["web"], metadata: p("admin") },
    { id: "V-admin", project_id: "p", species: "view", title: "Admin view", status: "live", platforms: ["web"], metadata: p("admin") },
    { id: "V-shop", project_id: "p", species: "view", title: "Shop view", status: "live", platforms: ["web"], metadata: p("shop") },
    { id: "V-loose", project_id: "p", species: "view", title: "Unassigned", status: "idea", platforms: ["web"] },
    { id: "API-admin", project_id: "p", species: "api-endpoint", title: "Admin API", status: "live", platforms: ["web"] },
    { id: "DM-shared", project_id: "p", species: "data-model", title: "Shared", status: "live", platforms: ["web"] },
    { id: "DM-orphan", project_id: "p", species: "data-model", title: "Orphan", status: "idea", platforms: ["web"] },
    { id: "AC-admin", project_id: "p", species: "acceptance", title: "Admin AC", status: "live", platforms: ["web"] },
  ];
  const productEdges = [
    { id: "pe1", project_id: "p", source_id: "F-admin", target_id: "V-admin", edge_type: "composes" },
    { id: "pe2", project_id: "p", source_id: "V-admin", target_id: "API-admin", edge_type: "calls" },
    { id: "pe3", project_id: "p", source_id: "API-admin", target_id: "DM-shared", edge_type: "queries" },
    { id: "pe4", project_id: "p", source_id: "V-shop", target_id: "DM-shared", edge_type: "displays" },
    { id: "pe5", project_id: "p", source_id: "AC-admin", target_id: "V-admin", edge_type: "covers" },
  ];

  const system = { id: "s", title: "S", kind: "system" };

  const unscoped = computeMapSubgraph(system, productNodes, productEdges);
  assert(
    JSON.stringify(ids(unscoped.nodes)) ===
      JSON.stringify(["API-admin", "DM-orphan", "DM-shared", "V-admin", "V-loose", "V-shop"]) &&
      unscoped.edges.length === 3,
    "computeMapSubgraph: a definition with no product selects every species match",
  );

  // The bug: this used to return the unscoped subgraph above.
  const scoped = computeMapSubgraph({ ...system, product: "admin" }, productNodes, productEdges);
  assert(
    JSON.stringify(ids(scoped.nodes)) === JSON.stringify(["API-admin", "DM-orphan", "DM-shared", "V-admin"]),
    "computeMapSubgraph: definition.product restricts the selection by default",
  );
  assert(
    JSON.stringify(ids(scoped.edges)) === JSON.stringify(["pe2", "pe3"]),
    "computeMapSubgraph: an edge loses an endpoint to the product filter and drops out",
  );

  // Per-species membership, all four readings in one assertion set.
  assert(
    ids(scoped.nodes).includes("V-admin") && !ids(scoped.nodes).includes("V-shop"),
    "product scope: a view's stored membership governs",
  );
  assert(
    !ids(scoped.nodes).includes("V-loose"),
    "product scope: an unassigned view is out of every named product (triage, not everywhere)",
  );
  assert(
    ids(scoped.nodes).includes("API-admin") && ids(scoped.nodes).includes("DM-shared"),
    "product scope: the system layer derives membership from its consumers",
  );
  assert(
    ids(scoped.nodes).includes("DM-orphan"),
    "product scope: an orphan model stays visible under every named product",
  );

  const shop = computeMapSubgraph({ ...system, product: "shop" }, productNodes, productEdges);
  assert(
    JSON.stringify(ids(shop.nodes)) === JSON.stringify(["DM-orphan", "DM-shared", "V-shop"]),
    "product scope: a model two products reach appears in both — a restriction is not a partition",
  );

  // The acceptance reading, which needs a species-explicit map to be selected
  // at all: anchors govern, so AC-admin is admin's although it stores no key.
  const acceptances = { id: "a", title: "A", kind: "system", species: ["acceptance"], edge_types: [] };
  assert(
    ids(computeMapSubgraph({ ...acceptances, product: "admin" }, productNodes, productEdges).nodes).join() ===
      "AC-admin" &&
      computeMapSubgraph({ ...acceptances, product: "shop" }, productNodes, productEdges).nodes.length === 0,
    "product scope: an acceptance takes membership from the anchors it covers",
  );

  // The app's override: the shell's global scope is the default for a map that
  // declares no product of its own, and never outranks one that does.
  assert(
    ids(computeMapSubgraph(system, productNodes, productEdges, { product: "admin" }).nodes).join() ===
      ids(scoped.nodes).join(),
    "options.product scopes a definition that declares none",
  );
  assert(
    ids(computeMapSubgraph({ ...system, product: "admin" }, productNodes, productEdges, { product: "admin" }).nodes)
      .join() === ids(scoped.nodes).join(),
    "options.product carries the resolved precedence — the caller resolves it, this does not re-resolve",
  );
  assert(
    ids(computeMapSubgraph({ ...system, product: "admin" }, productNodes, productEdges, { product: null }).nodes)
      .join() === ids(unscoped.nodes).join(),
    "options.product null is All products — an explicit widening, not an absent option",
  );

  // A pre-built graph is the same answer, never a different one: the app builds
  // one per snapshot because the usage index is a traversal.
  const prebuilt = buildProductGraph(productNodes, productEdges);
  assert(
    ids(computeMapSubgraph({ ...system, product: "admin" }, productNodes, productEdges, { graph: prebuilt }).nodes)
      .join() === ids(scoped.nodes).join(),
    "options.graph is honoured and agrees with the graph built internally",
  );

  // Nothing to resolve, nothing to pay: a project with no product anywhere must
  // render byte-identically to the way it did before products existed.
  assert(
    ids(computeMapSubgraph(system, nodes, edges).nodes).join() ===
      ids(computeMapSubgraph(system, nodes, edges, { product: null }).nodes).join(),
    "a definition with no product is unchanged by the restriction",
  );

  // The root BFS composes on top of the restriction rather than around it.
  const rooted = computeMapSubgraph(
    { ...system, product: "admin", root_node_id: "DM-shared", depth: 1 },
    productNodes,
    productEdges,
  );
  assert(
    JSON.stringify(ids(rooted.nodes)) === JSON.stringify(["API-admin", "DM-shared"]),
    "product scope: step 3's BFS walks the restricted graph, so V-shop is not a neighbour of DM-shared",
  );
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
    { id: "gaudy", title: "Gaudy", kind: "journey", display: { flow_platforms: "sparklines" } },
  ];
  withMaps.project.metadata.map_display = { journey: { view_platforms: "columns", images: "yes", minimap_color: "rainbow" } };
  const result = validateBundle(withMaps);
  const rules = result.findings.map((f) => f.rule);

  assert(rules.includes("map-duplicate-id"), "map-duplicate-id fires");
  assert(rules.includes("map-shadows-built-in"), "map-shadows-built-in fires");
  assert(rules.includes("map-unknown-root"), "map-unknown-root fires");
  assert(rules.includes("map-unknown-species"), "map-unknown-species fires");
  assert(rules.includes("map-unknown-edge-type"), "map-unknown-edge-type fires");
  assert(
    result.findings.filter((f) => f.rule === "map-unknown-display").length === 4,
    "map-unknown-display fires on the stored definition and on every bad override key",
  );
  assert(
    result.findings.some((f) => f.path === "project.metadata.map_display.journey.view_platforms") &&
      result.findings.some((f) => f.path === "project.metadata.map_display.journey.minimap_color") &&
      result.findings.some((f) => f.path === "project.metadata.maps[5].display.flow_platforms"),
    "map-unknown-display paths point at the offending value",
  );
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
