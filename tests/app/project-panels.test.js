#!/usr/bin/env node

/**
 * The panel descriptor union (lib/utils/project-panels.ts). Pins the three
 * things the union makes newly breakable: a non-node panel must survive a node
 * prune, it must not be what the URL addresses, and pushing it must not close
 * what is already open.
 */

const fs = require("fs");
const { loadPanelStack, loadProjectPanels, BUILD_DIR } = require("./load-panel-utils");

const { openFrom, initStack } = loadPanelStack();
const { RAW_PANEL_KEY, isNodeEntry, topNodeKey, pruneNodeEntries } = loadProjectPanels();

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

fs.rmSync(BUILD_DIR, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll project-panels tests passed");
