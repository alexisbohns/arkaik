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

const { buildJourneyGraph, computeComposeClosure, computeViewApiRelations } = loadJourneyGraph();

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

fs.rmSync(BUILD_DIR, { recursive: true, force: true });

if (failures > 0) {
  console.log(`\n${failures} journey-graph test(s) failed.`);
  process.exit(1);
}
console.log("\nAll journey-graph tests passed.");
