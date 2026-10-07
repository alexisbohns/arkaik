#!/usr/bin/env node
/**
 * The Journey's block layout (spec 2026-10-08 § The layout): pure, synchronous,
 * local. Pinned over the Pebbles seed and the self-map, collapsed and with
 * every flow expanded.
 */
const fs = require("fs");
const path = require("path");
const { loadJourneyGraph, BUILD_DIR } = require("./load-journey-graph");
const {
  buildJourneyGraph,
  computeComposeClosure,
  computeViewApiRelations,
  layoutJourney,
  findBlock,
  blockNodeIds,
  estimateJourneyCardSize,
  GAP_MAIN,
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
const display = { images: true, flow_platforms: "rings", view_platforms: "chips" };

/** The builder's inputs for a seed, the way JourneyMap derives them. */
function paramsFor(file) {
  const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "seed", file), "utf8"));
  const nodesById = new Map(bundle.nodes.map((node) => [node.id, node]));
  const composeChildIdsByParent = new Map();
  const composeParentByChild = new Map();
  for (const edge of bundle.edges) {
    if (edge.edge_type !== "composes") continue;
    composeChildIdsByParent.set(edge.source_id, [...(composeChildIdsByParent.get(edge.source_id) ?? []), edge.target_id]);
    if (!composeParentByChild.has(edge.target_id)) composeParentByChild.set(edge.target_id, edge.source_id);
  }
  const explicitRootNode = nodesById.get(bundle.project.root_node_id) ?? null;
  return {
    label: file,
    flowIds: bundle.nodes.filter((node) => node.species === "flow").map((node) => node.id),
    params: {
      dataNodes: bundle.nodes,
      dataEdges: bundle.edges,
      nodesById,
      composeParentByChild,
      explicitRootNode,
      composeClosure: computeComposeClosure(explicitRootNode, composeChildIdsByParent, nodesById),
      display,
      viewApiRelationsByViewId: computeViewApiRelations(bundle.edges, nodesById),
    },
  };
}

function lay(graph, direction = "DOWN", transposeCards = false) {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const sizeOf = (id) => {
    const size = estimateJourneyCardSize(byId.get(id));
    return transposeCards ? { width: size.height, height: size.width } : size;
  };
  const positions = layoutJourney(graph.roots, sizeOf, direction);
  const rects = new Map();
  for (const node of graph.nodes) {
    const size = sizeOf(node.id);
    const at = positions.get(node.id);
    rects.set(node.id, { x: at.x, y: at.y, width: size.width, height: size.height });
  }
  return { positions, rects, sizeOf };
}

const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

for (const seed of [paramsFor("pebbles.json"), paramsFor("arkaik-self-map.json")]) {
  for (const [state, expandedFlows] of [["collapsed", new Set()], ["all expanded", new Set(seed.flowIds)]]) {
    const graph = buildJourneyGraph({ ...seed.params, expandedFlows });
    const { positions, rects } = lay(graph);
    const tag = `${seed.label} ${state}`;

    assert(graph.nodes.every((node) => positions.has(node.id)), `${tag}: every card is placed`);
    assert(
      [...positions.values()].every((p) => Number.isInteger(p.x) && Number.isInteger(p.y) && p.x >= 0 && p.y >= 0),
      `${tag}: positions are non-negative integers`,
    );

    const list = [...rects.entries()];
    const collisions = [];
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        if (overlaps(list[i][1], list[j][1])) collisions.push(`${list[i][0]} × ${list[j][0]}`);
      }
    }
    assert(collisions.length === 0, `${tag}: no two cards overlap${collisions.length ? ` (${collisions.slice(0, 3).join(", ")}…)` : ""}`);

    // Structure: a parent sits GAP_MAIN above its child row and is centred over it;
    // a sequence is a straight line.
    const centreX = (id) => rects.get(id).x + rects.get(id).width / 2;
    const bottom = (id) => rects.get(id).y + rects.get(id).height;
    const firstCard = (block) => {
      if (block.kind !== "sequence") return block.id;
      for (const item of block.items) {
        const id = firstCard(item);
        if (id) return id;
      }
      return null;
    };
    const problems = [];
    const walk = (block) => {
      if (block.kind === "sequence") {
        const centres = new Set();
        for (const item of block.items) {
          const id = firstCard(item);
          if (!id) continue;
          centres.add(Math.round(centreX(id)));
          walk(item);
        }
        if (centres.size > 1) problems.push(`sequence not straight: ${[...centres].join("/")}`);
        return;
      }
      const under = block.kind === "node" ? block.children : block.arms;
      const heads = under.map(firstCard).filter(Boolean);
      for (const head of heads) {
        if (rects.get(head).y !== bottom(block.id) + GAP_MAIN) problems.push(`${head} is not GAP_MAIN under ${block.id}`);
      }
      // The row is made of whole blocks (a child's subtree may be wider than
      // its card), so centring is read over every card under the row.
      const rowIds = under.flatMap(blockNodeIds);
      if (rowIds.length > 0) {
        const rowLeft = Math.min(...rowIds.map((id) => rects.get(id).x));
        const rowRight = Math.max(...rowIds.map((id) => rects.get(id).x + rects.get(id).width));
        if (Math.abs((rowLeft + rowRight) / 2 - centreX(block.id)) > 1) problems.push(`${block.id} is not centred over its row`);
      }
      under.forEach(walk);
    };
    graph.roots.forEach(walk);
    assert(problems.length === 0, `${tag}: parents centred, rows GAP_MAIN below, sequences straight${problems.length ? ` (${problems.slice(0, 3).join("; ")})` : ""}`);

    // Reading RIGHT with transposed cards is the transpose of reading DOWN:
    // the direction only swaps which axis is which.
    const right = lay(graph, "RIGHT", true).positions;
    assert(
      graph.nodes.every((node) => right.get(node.id).x === positions.get(node.id).y && right.get(node.id).y === positions.get(node.id).x),
      `${tag}: RIGHT over transposed cards is the transpose of DOWN`,
    );
  }
}

// --- Locality: a toggle moves only its sequence's tail and re-centres its rows --
{
  const seed = paramsFor("pebbles.json");
  const toggled = "F-manage-collections";
  const before = buildJourneyGraph({ ...seed.params, expandedFlows: new Set(["F-record-pebble"]) });
  const after = buildJourneyGraph({ ...seed.params, expandedFlows: new Set(["F-record-pebble", toggled]) });
  const a = lay(before);
  const b = lay(after);
  const inside = new Set(blockNodeIds(findBlock(after.roots, toggled)));
  assert(inside.has(toggled) && inside.size > 1, `the toggled block holds the flow and its ${inside.size - 1} new cards`);

  const widthBefore = a.rects.get(toggled).width; // a collapsed leaf: the card
  const bounds = (ids, rects) => {
    const rs = ids.map((id) => rects.get(id));
    return Math.max(...rs.map((r) => r.x + r.width)) - Math.min(...rs.map((r) => r.x));
  };
  const widthAfter = bounds([...inside], b.rects);
  const half = (widthAfter - widthBefore) / 2;

  // The layout is anchored at cross 0, so growth goes rightward: a card left of
  // the toggled block stays, one right of it slides by the whole delta, and a
  // parent centred over both slides by half. Nothing moves along the main axis.
  const allowed = [0, half, 2 * half];
  const offenders = [];
  for (const node of before.nodes) {
    if (inside.has(node.id)) continue;
    const p = a.positions.get(node.id);
    const q = b.positions.get(node.id);
    if (!q) continue;
    if (p.y !== q.y) offenders.push(`${node.id} moved along the main axis`);
    else if (!allowed.some((d) => Math.abs(q.x - p.x - d) <= 1)) offenders.push(`${node.id} slid ${q.x - p.x}, not 0/${half}/${2 * half}`);
  }
  assert(offenders.length === 0, `outside the toggled block, nothing moves except the rightward re-centring (0, ${half} or ${2 * half})${offenders.length ? ` (${offenders.slice(0, 3).join("; ")})` : ""}`);
  assert(b.positions.get(toggled).y === a.positions.get(toggled).y, "the toggled flow keeps its main-axis position");
}

// --- Helpers the canvas relies on ------------------------------------------
{
  const seed = paramsFor("pebbles.json");
  const graph = buildJourneyGraph({ ...seed.params, expandedFlows: new Set(["F-record-pebble"]) });
  assert(findBlock(graph.roots, "no-such-id") === null, "findBlock: unknown id → null");
  const ids = blockNodeIds(findBlock(graph.roots, "F-record-pebble"));
  assert(ids.length === 4 && ids[0] === "F-record-pebble", `blockNodeIds: the flow first, then its 3 cards (got ${ids.length})`);
  assert(layoutJourney([], () => ({ width: 1, height: 1 })).size === 0, "an empty journey lays out to nothing");
}

fs.rmSync(BUILD_DIR, { recursive: true, force: true });

if (failures > 0) {
  console.log(`\n${failures} journey-layout test(s) failed.`);
  process.exit(1);
}
console.log("\nAll journey-layout tests passed.");
