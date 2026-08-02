#!/usr/bin/env node

/**
 * Journey graph golden parity — pins buildJourneyGraph's output over the
 * Pebbles seed to the counts verified against the live canvas before the
 * extraction (22 base nodes collapsed; 25 with the first top-level flow
 * expanded). Guards the canvas-page → journey-graph.ts decomposition.
 */

const fs = require("fs");
const path = require("path");
const { loadJourneyGraph, BUILD_DIR } = require("./load-journey-graph");

const {
  buildJourneyGraph,
  computeComposeClosure,
  computeViewApiRelations,
  resolveJourneySelection,
  computeMapCounts,
  resolveProductScope,
  buildProductUsageIndex,
} = loadJourneyGraph();

let failures = 0;
function assert(cond, message) {
  if (cond) console.log(`PASS: ${message}`);
  else {
    failures++;
    console.log(`FAIL: ${message}`);
  }
}

const ROOT = path.join(__dirname, "..", "..");
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "seed", "pebbles.json"), "utf8"));

const dataNodes = bundle.nodes;
const dataEdges = bundle.edges;
const nodesById = new Map(dataNodes.map((node) => [node.id, node]));

const composeChildIdsByParent = new Map();
const composeParentByChild = new Map();
for (const edge of dataEdges) {
  if (edge.edge_type !== "composes") continue;
  const children = composeChildIdsByParent.get(edge.source_id) ?? [];
  children.push(edge.target_id);
  composeChildIdsByParent.set(edge.source_id, children);
  if (!composeParentByChild.has(edge.target_id)) {
    composeParentByChild.set(edge.target_id, edge.source_id);
  }
}

const explicitRootNode = nodesById.get(bundle.project.root_node_id) ?? null;
assert(explicitRootNode !== null, "seed root resolves (V-landing)");

const composeClosure = computeComposeClosure(explicitRootNode, composeChildIdsByParent, nodesById);
assert(composeClosure.pairs.length === 21, `compose closure walks 21 pairs (got ${composeClosure.pairs.length})`);
assert(composeClosure.flowIds.size === 8, `8 top-level flows discovered (got ${composeClosure.flowIds.size})`);
const [firstTopLevelFlowId] = composeClosure.flowIds;
assert(firstTopLevelFlowId === "F-record-pebble", `first top-level flow is F-record-pebble (got ${firstTopLevelFlowId})`);

const viewApiRelationsByViewId = computeViewApiRelations(dataEdges, nodesById);

const baseParams = {
  dataNodes,
  dataEdges,
  nodesById,
  composeParentByChild,
  explicitRootNode,
  composeClosure,
  viewCardVariant: "large",
  viewApiRelationsByViewId,
};

// --- Collapsed: the base closure, golden count from the live canvas ---------
{
  const graph = buildJourneyGraph({ ...baseParams, expandedFlows: new Set() });
  assert(graph.nodes.length === 22, `collapsed journey renders 22 nodes (got ${graph.nodes.length})`);
  assert(
    graph.edges.filter((edge) => edge.type === "compose").length === 21,
    "collapsed journey draws one compose edge per closure pair",
  );

  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  assert(
    graph.edges.every((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target)),
    "every edge endpoint is a rendered node",
  );
  assert(
    graph.nodes.every((node) => !Object.values(node.data).some((value) => typeof value === "function")),
    "headless build carries no function props (serializable golden output)",
  );
}

// --- First flow expanded: golden count from the live canvas -----------------
{
  const graph = buildJourneyGraph({ ...baseParams, expandedFlows: new Set([firstTopLevelFlowId]) });
  assert(graph.nodes.length === 25, `expanded journey renders 25 nodes (got ${graph.nodes.length})`);

  const visualNodes = graph.nodes.filter((node) => node.id.includes(`@${firstTopLevelFlowId}:`));
  assert(
    visualNodes.length === 3,
    `F-record-pebble expands into 3 playlist visual nodes (got ${visualNodes.length})`,
  );

  const expandedFlowNode = graph.nodes.find((node) => node.id === firstTopLevelFlowId);
  assert(expandedFlowNode?.data.expanded === true, "the expanded flow card carries expanded: true");
}

// --- Determinism -------------------------------------------------------------
{
  const first = buildJourneyGraph({ ...baseParams, expandedFlows: new Set([firstTopLevelFlowId]) });
  const second = buildJourneyGraph({ ...baseParams, expandedFlows: new Set([firstTopLevelFlowId]) });
  assert(JSON.stringify(first) === JSON.stringify(second), "builds are deterministic");
}

// --- Fallback branch: no explicit root → parentless flow/view roots ---------
{
  const graph = buildJourneyGraph({
    ...baseParams,
    explicitRootNode: null,
    composeClosure: { pairs: [], flowIds: new Set() },
    expandedFlows: new Set(),
  });
  const orphanFlows = graph.nodes.filter((node) => ["F-legal-consent", "F-swap-glyph"].includes(node.id));
  assert(orphanFlows.length === 2, "no-root fallback surfaces the orphan flows");
}

// === Product scope ==========================================================
//
// The bug: scoped to Admin — a web-only product with four views, no flows and
// no `root_node_id` — the Journey drew the *app* product's 22 nodes, because
// `JourneyMap` passed every node to `buildJourneyGraph` (`buildSystemGraph`
// has always filtered) and the anchor chain fell through Admin's missing
// anchor to `project.root_node_id`, which is the app's front door. The card
// beside it advertised a third number again. All three answers are resolved by
// `resolveJourneySelection`, which is what the canvas and both count sites now
// call.

const scopeOf = (productId, project = bundle.project) => resolveProductScope({ project }, productId);
const usageIndex = buildProductUsageIndex(dataNodes, dataEdges);
const productGraph = { edges: dataEdges, nodesById, usageIndex };

const JOURNEY = { id: "journey", title: "Journey", kind: "journey", species: ["flow", "view"], edge_types: ["composes"] };
const SYSTEM = {
  id: "system",
  title: "System",
  kind: "system",
  species: ["view", "api-endpoint", "data-model"],
  edge_types: ["calls", "displays", "queries"],
};
const storedMaps = bundle.project.metadata.maps ?? [];

/** Exactly what `JourneyMap` renders: the selection, then the collapsed build. */
function renderJourney(definition, scope, project = bundle.project) {
  const selection = resolveJourneySelection({ definition, dataNodes, dataEdges, project, scope, graph: productGraph });
  if (selection.emptyReason !== null) return { selection, graph: { nodes: [], edges: [] } };
  return {
    selection,
    graph: buildJourneyGraph({
      dataNodes: selection.nodes,
      dataEdges,
      nodesById: selection.nodesById,
      composeParentByChild: selection.composeParentByChild,
      explicitRootNode: selection.anchorNode,
      composeClosure: selection.composeClosure,
      expandedFlows: new Set(),
      viewCardVariant: "compact",
      viewApiRelationsByViewId: computeViewApiRelations(dataEdges, selection.nodesById),
    }),
  };
}

// --- Preconditions: the fixture is the shape the bug needs ------------------

const adminNodes = dataNodes.filter((node) => node.metadata?.product === "admin");
assert(
  adminNodes.length === 4 && adminNodes.every((node) => node.species === "view"),
  `precondition: the seed's Admin product is four views and no flows (got ${adminNodes.length})`,
);
assert(
  (bundle.project.metadata.products ?? []).find((p) => p.id === "admin")?.root_node_id === undefined &&
    bundle.project.root_node_id === "V-landing" &&
    nodesById.get("V-landing").metadata?.product === "app",
  "precondition: Admin declares no anchor, and the project's is an APP view — the fall-through the bug rode in on",
);

// --- Under Admin: no `app` node, and an honest reason -----------------------

{
  const admin = scopeOf("admin");
  const { selection, graph } = renderJourney(JOURNEY, admin);

  assert(
    graph.nodes.length === 0 && selection.emptyReason === "no-anchor",
    `THE BUG: under Admin the built-in Journey draws NOTHING and says why (got ${graph.nodes.length} nodes, reason ${selection.emptyReason})`,
  );
  assert(
    selection.anchorId === undefined,
    "…because the anchor chain stopped at the product boundary rather than borrowing V-landing",
  );
  // The membership filter is the *other* half, and it holds on its own: no
  // flow or view of another product survives it. (System-layer orphans do —
  // nothing reaches them, so they are in every named scope by design — but the
  // journey's species filter never looks at them.)
  const selectableJourneySpecies = selection.nodes.filter((node) => ["flow", "view"].includes(node.species));
  assert(
    selectableJourneySpecies.length === 4 &&
      selectableJourneySpecies.every((node) => node.metadata?.product === "admin"),
    `the membership filter alone leaves ONLY Admin's own flows and views selectable (got ${selectableJourneySpecies.length})`,
  );

  // Every journey the project offers, under Admin, contains no `app` node —
  // stated over the rendered graph rather than over the selection, because the
  // renderer is what the reader sees.
  for (const stored of storedMaps) {
    const rendered = renderJourney({ species: ["flow", "view"], edge_types: ["composes"], ...stored }, admin);
    const foreign = rendered.graph.nodes
      .map((node) => nodesById.get(node.id.split("@")[0]))
      .filter((node) => node && node.metadata?.product === "app");
    assert(
      foreign.length === 0,
      `under Admin the stored map "${stored.id}" draws no app node (got ${foreign.length})`,
    );
  }
  const recording = renderJourney({ ...storedMaps.find((m) => m.id === "recording-loop") }, admin);
  assert(
    recording.selection.emptyReason === "anchor-outside-product" &&
      recording.selection.anchorId === "F-record-pebble",
    `an app-anchored stored map under Admin says its anchor is not in this product (got ${recording.selection.emptyReason})`,
  );
}

// --- The degenerate cases are byte-identical to today ------------------------
//
// The regression that matters most. Both are compared against the golden
// `baseParams` build at the top of this file — the pre-products render — by
// JSON identity, not by node count.

const goldenCollapsed = JSON.stringify(buildJourneyGraph({ ...baseParams, expandedFlows: new Set() }));

for (const [label, scope, project] of [
  ["All products", scopeOf(null), bundle.project],
  ["a project declaring no products", scopeOf(null, { ...bundle.project, metadata: { ...bundle.project.metadata, products: undefined } }), { ...bundle.project, metadata: { ...bundle.project.metadata, products: undefined } }],
]) {
  const { selection, graph } = renderJourney(JOURNEY, scope, project);
  assert(selection.emptyReason === null, `${label}: no empty state — the journey still renders`);
  assert(
    selection.nodes === dataNodes,
    `${label}: the selection is the caller's OWN array, not a filtered copy — nothing was restricted`,
  );
  assert(
    JSON.stringify(buildJourneyGraph({ ...baseParams, explicitRootNode: selection.anchorNode, composeClosure: selection.composeClosure, expandedFlows: new Set() })) === goldenCollapsed,
    `${label}: byte-identical to the pre-products golden render`,
  );
}

// --- The card can never advertise a count the map does not draw --------------
//
// Every built-in and every stored map, under every scope. This is the assertion
// the pre-existing count bug failed under *all* of them: the built-in Journey
// carries no `root_node_id`, so `computeMapSubgraph` skipped its BFS and
// counted all 68 flows and views against a canvas of 22; `recording-loop` does
// carry one, and the algorithm's undirected BFS walked up out of the flow and
// back down through the whole product — 64 against a canvas of 1.

const allDefinitions = [JOURNEY, SYSTEM, ...storedMaps.map((m) => ({ species: ["flow", "view"], edge_types: ["composes"], ...m }))];

for (const [label, productId] of [["All products", null], ["Admin", "admin"], ["Pebbles", "app"]]) {
  const scope = scopeOf(productId);
  for (const definition of allDefinitions) {
    if (definition.kind !== "journey") continue;
    const { graph } = renderJourney(definition, scope);
    const counts = computeMapCounts(definition, {
      dataNodes,
      dataEdges,
      project: bundle.project,
      scope,
      graph: productGraph,
    });
    assert(
      counts.nodes === graph.nodes.length && counts.edges === graph.edges.length,
      `${label} / ${definition.id}: the card's count IS the canvas's (${counts.nodes}/${counts.edges} vs ${graph.nodes.length}/${graph.edges.length})`,
    );
  }
}

// The numbers themselves, so a future refactor cannot make the equality above
// true by making both sides wrong together.
assert(
  computeMapCounts(JOURNEY, { dataNodes, dataEdges, project: bundle.project, scope: scopeOf(null), graph: productGraph })
    .nodes === 22,
  "…and under All products that count is 22, the golden canvas figure — not the 68 the subgraph algorithm returned",
);
assert(
  computeMapCounts(
    { species: ["flow", "view"], edge_types: ["composes"], ...storedMaps.find((m) => m.id === "recording-loop") },
    { dataNodes, dataEdges, project: bundle.project, scope: scopeOf(null), graph: productGraph },
  ).nodes === 1,
  "…and the flow-anchored stored map counts 1 collapsed card, not the 64 an undirected BFS wandered into",
);

// System keeps `computeMapSubgraph`: it is a direct projection render, and this
// change must not have moved it.
assert(
  computeMapCounts(SYSTEM, { dataNodes, dataEdges, project: bundle.project, scope: scopeOf(null), graph: productGraph })
    .nodes === 137,
  "the System map's count is untouched — 137 nodes under All products",
);

fs.rmSync(BUILD_DIR, { recursive: true, force: true });

if (failures > 0) {
  console.log(`\n${failures} journey-graph test(s) failed.`);
  process.exit(1);
}
console.log("\nAll journey-graph tests passed.");
