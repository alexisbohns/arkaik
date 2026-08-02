#!/usr/bin/env node

/**
 * The panel descriptor union (lib/utils/project-panels.ts). Pins the three
 * things the union makes newly breakable: a non-node panel must survive a node
 * prune, it must not be what the URL addresses, and pushing it must not close
 * what is already open.
 *
 * Also pins the crumb mapping, whose depths the header hands straight to
 * `unwindTo` — an off-by-one there sends a click to the wrong panel, and looks
 * like working navigation until you count the columns.
 */

const fs = require("fs");
const { loadPanelStack, loadProjectPanels, BUILD_DIR } = require("./load-panel-utils");

const { openFrom, initStack } = loadPanelStack();
const {
  RAW_PANEL_KEY,
  isNodeEntry,
  topNodeKey,
  pruneNodeEntries,
  buildPanelCrumbs,
  unwindDoomed,
} = loadProjectPanels();

let failures = 0;
function assert(cond, message) {
  if (cond) console.log(`PASS: ${message}`);
  else {
    failures++;
    console.log(`FAIL: ${message}`);
  }
}

const keys = (stack) => stack.map((entry) => entry.key).join(" · ");
const node = (id) => ({ kind: "node", nodeId: id });
const raw = () => ({ kind: "raw" });

// --- entry discrimination ---
const nodeEntry = { key: "A", instanceId: "p1", payload: node("A") };
const rawEntry = { key: RAW_PANEL_KEY, instanceId: "p2", payload: raw() };
assert(isNodeEntry(nodeEntry), "a node entry is a node entry");
assert(!isNodeEntry(rawEntry), "a raw entry is not a node entry");

// --- Raw pushes on top rather than collapsing the trail ---
const withAB = openFrom(openFrom(initStack(), 0, "A", node("A")), 1, "B", node("B"));
const withRaw = openFrom(withAB, withAB.length, RAW_PANEL_KEY, raw());
assert(
  keys(withRaw) === `A · B · ${RAW_PANEL_KEY}`,
  `opening Raw appends without closing anything (got "${keys(withRaw)}")`,
);
assert(withRaw[0] === withAB[0] && withRaw[1] === withAB[1], "the node panels keep their identity");

// --- the URL addresses the top NODE, scanning past Raw ---
assert(topNodeKey(withAB) === "B", "with no Raw open the top node is the top entry");
assert(topNodeKey(withRaw) === "B", "a Raw panel on top does not become the address");
assert(topNodeKey([rawEntry]) === null, "Raw alone addresses nothing");
assert(topNodeKey([]) === null, "an empty stack addresses nothing");

// --- pruning deleted nodes must not evict Raw ---
const pruned = pruneNodeEntries(withRaw, new Set(["A"]));
assert(
  keys(pruned) === `A · ${RAW_PANEL_KEY}`,
  `pruning drops the missing node and keeps Raw (got "${keys(pruned)}")`,
);
assert(pruned[0] === withRaw[0], "a surviving node entry keeps its identity");
assert(
  pruneNodeEntries(withRaw, new Set(["A", "B"])) === withRaw,
  "a prune that removes nothing returns the same array — no render loop",
);
assert(
  keys(pruneNodeEntries([rawEntry], new Set())) === RAW_PANEL_KEY,
  "an empty node set still keeps Raw",
);
const noPanels = initStack();
assert(
  pruneNodeEntries(noPanels, new Set()) === noPanels,
  "pruning an empty stack returns the same array — the case every render hits",
);

// --- Raw is not always on top: a node opened from inside it sits above ---
const rawThenC = openFrom(withRaw, withRaw.length, "C", node("C"));
assert(
  keys(rawThenC) === `A · B · ${RAW_PANEL_KEY} · C`,
  `a node opens from inside Raw (got "${keys(rawThenC)}")`,
);
assert(topNodeKey(rawThenC) === "C", "the node above Raw is the address");
assert(
  keys(pruneNodeEntries(rawThenC, new Set(["A", "C"]))) === `A · ${RAW_PANEL_KEY} · C`,
  "a prune keeps Raw where it sits, mid-stack",
);

// --- crumbs: the depth mapping the header binds to unwindTo ---
const crumbTitles = { A: "Alpha", B: "Beta", [RAW_PANEL_KEY]: "never wins" };
const titleOf = (id) => crumbTitles[id];

assert(
  buildPanelCrumbs([], "Canvas", titleOf).length === 0,
  "an empty stack has no crumbs — the header shows the page's own meta instead",
);

const crumbs = buildPanelCrumbs(rawThenC, "Canvas", titleOf);
assert(
  crumbs.length === rawThenC.length + 1,
  `every panel gets a crumb, plus the surface (got ${crumbs.length})`,
);
assert(
  crumbs[0].label === "Canvas" && crumbs[0].id === "root" && crumbs[0].depth === 0,
  "the root crumb is the surface, unwinding to depth 0",
);
assert(
  crumbs.slice(1, -1).every((crumb, index) => crumb.depth === index + 1),
  `the panel at index i unwinds to depth i + 1 (got ${JSON.stringify(crumbs.map((c) => c.depth))})`,
);
assert(
  crumbs[crumbs.length - 1].depth === null,
  "the last crumb has nowhere to go — you are already there",
);
assert(
  crumbs.slice(1).every((crumb, index) => crumb.id === rawThenC[index].instanceId),
  "each panel crumb is keyed by its entry's instanceId, so a rename cannot remount it",
);
assert(
  crumbs[1].label === "Alpha" && crumbs[2].label === "Beta",
  "a node crumb shows the title titleOf hands back",
);
assert(crumbs[3].label === "Raw bundle", "Raw is labelled from the union, never from titleOf");
assert(
  crumbs[4].label === "C",
  "a node titleOf does not know falls back to its key — a crumb is never blank",
);

// --- what a close destroys ---
assert(
  JSON.stringify(unwindDoomed(0, 4)) === "[3,2,1,0]",
  `unwinding to the surface takes the whole stack (got ${JSON.stringify(unwindDoomed(0, 4))})`,
);
assert(
  JSON.stringify(unwindDoomed(3, 4)) === "[3]",
  `Escape takes only the top panel (got ${JSON.stringify(unwindDoomed(3, 4))})`,
);
assert(
  unwindDoomed(4, 4).length === 0,
  "unwinding to the current depth destroys nothing — no panel gets asked",
);
assert(unwindDoomed(9, 4).length === 0, "unwinding past the top destroys nothing");
assert(
  unwindDoomed(1, 5).every((index, position, all) => position === 0 || all[position - 1] > index),
  `the doomed set is always descending, so the confirm belongs to the visible panel (got ${JSON.stringify(unwindDoomed(1, 5))})`,
);

fs.rmSync(BUILD_DIR, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll project-panels tests passed");
