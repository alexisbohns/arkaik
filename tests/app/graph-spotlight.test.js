#!/usr/bin/env node

/**
 * Neighborhood spotlight — the System map's hover/pin legibility mode
 * (lib/utils/graph-spotlight.ts). Pins the selection semantics (anchor +
 * direct neighbors + anchor-incident edges lit, everything else dimmed) and
 * the identity contract: lit elements keep their object identity so React
 * Flow's memoized wrappers skip them entirely.
 */

const fs = require("fs");
const { loadGraphSpotlight, BUILD_DIR } = require("./load-graph-spotlight");

const { buildSpotlightIndex, applySpotlight, SPOTLIGHT_DIM_CLASS } = loadGraphSpotlight();

let failures = 0;
function assert(cond, message) {
  if (cond) console.log(`PASS: ${message}`);
  else {
    failures++;
    console.log(`FAIL: ${message}`);
  }
}

// A star with a tail plus a detached pair:
//   hub — a, hub — b (a and b also linked to each other), b — tail;
//   far1 — far2 detached from the hub component entirely.
const nodes = [
  { id: "hub", className: "existing" },
  { id: "a" },
  { id: "b" },
  { id: "tail" },
  { id: "far1" },
  { id: "far2" },
];
const edges = [
  { id: "e-hub-a", source: "hub", target: "a" },
  { id: "e-hub-b", source: "hub", target: "b" },
  { id: "e-a-b", source: "a", target: "b", className: "cross" },
  { id: "e-b-tail", source: "b", target: "tail" },
  { id: "e-far", source: "far1", target: "far2" },
];

const index = buildSpotlightIndex(edges);

// --- buildSpotlightIndex: undirected adjacency + incident-edge index ---
assert(
  index.neighborsByNodeId.get("hub").has("a") && index.neighborsByNodeId.get("a").has("hub"),
  "adjacency is undirected (hub↔a both directions)",
);
assert(
  index.neighborsByNodeId.get("hub").size === 2,
  `hub has exactly its two direct neighbors (got ${index.neighborsByNodeId.get("hub").size})`,
);
assert(
  !index.neighborsByNodeId.get("hub").has("tail"),
  "two-hop node (tail) is not a hub neighbor",
);
const hubEdges = index.edgeIdsByNodeId.get("hub");
assert(
  hubEdges.size === 2 && hubEdges.has("e-hub-a") && hubEdges.has("e-hub-b"),
  "hub's incident-edge index holds exactly its two edges",
);

// --- applySpotlight on the hub ---
const lit = applySpotlight(nodes, edges, "hub", index);

const dimmedNodeIds = lit.nodes
  .filter((node) => (node.className ?? "").includes(SPOTLIGHT_DIM_CLASS))
  .map((node) => node.id)
  .sort();
assert(
  JSON.stringify(dimmedNodeIds) === JSON.stringify(["far1", "far2", "tail"]),
  `anchor + neighbors stay lit; the rest dim (dimmed: ${dimmedNodeIds.join(", ")})`,
);

const dimmedEdgeIds = lit.edges
  .filter((edge) => (edge.className ?? "").includes(SPOTLIGHT_DIM_CLASS))
  .map((edge) => edge.id)
  .sort();
assert(
  JSON.stringify(dimmedEdgeIds) === JSON.stringify(["e-a-b", "e-b-tail", "e-far"]),
  `only anchor-incident edges stay lit — neighbor-to-neighbor (e-a-b) dims too (dimmed: ${dimmedEdgeIds.join(", ")})`,
);

// --- identity contract: lit elements are the SAME objects; dimmed are new ---
assert(
  lit.nodes[0] === nodes[0] && lit.nodes[1] === nodes[1] && lit.nodes[2] === nodes[2],
  "lit nodes keep object identity (memoized wrappers skip them)",
);
assert(
  lit.nodes[3] !== nodes[3] && lit.nodes[4] !== nodes[4],
  "dimmed nodes are fresh objects",
);
assert(
  lit.edges[0] === edges[0] && lit.edges[1] === edges[1] && lit.edges[2] !== edges[2],
  "lit edges keep identity; dimmed edges are fresh",
);
assert(nodes[3].className === undefined, "inputs are not mutated");

// --- className handling ---
const dimmedCross = lit.edges.find((edge) => edge.id === "e-a-b");
assert(
  dimmedCross.className === `cross ${SPOTLIGHT_DIM_CLASS}`,
  `dim class appends after existing classes (got "${dimmedCross.className}")`,
);
const dimmedBare = lit.nodes.find((node) => node.id === "tail");
assert(
  dimmedBare.className === SPOTLIGHT_DIM_CLASS,
  `elements without classes get the bare dim class (got "${dimmedBare.className}")`,
);

// --- anchoring on a leaf: its single edge + both endpoints lit ---
const tailLit = applySpotlight(nodes, edges, "tail", index);
const tailLitNodeIds = tailLit.nodes
  .filter((node) => !(node.className ?? "").includes(SPOTLIGHT_DIM_CLASS))
  .map((node) => node.id)
  .sort();
assert(
  JSON.stringify(tailLitNodeIds) === JSON.stringify(["b", "tail"]),
  `leaf anchor lights itself + its one neighbor (lit: ${tailLitNodeIds.join(", ")})`,
);

// --- unknown anchor (deleted under the cursor): inputs untouched ---
const untouched = applySpotlight(nodes, edges, "ghost", index);
assert(
  untouched.nodes === nodes && untouched.edges === edges,
  "unknown anchor returns the input arrays untouched",
);

// --- orphan anchor with no edges: everything else dims (correct signal) ---
const orphanNodes = [...nodes, { id: "orphan" }];
const orphanLit = applySpotlight(orphanNodes, edges, "orphan", index);
const orphanLitIds = orphanLit.nodes
  .filter((node) => !(node.className ?? "").includes(SPOTLIGHT_DIM_CLASS))
  .map((node) => node.id);
assert(
  JSON.stringify(orphanLitIds) === JSON.stringify(["orphan"]),
  "edge-less anchor spotlights only itself",
);

fs.rmSync(BUILD_DIR, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll graph-spotlight tests passed");
