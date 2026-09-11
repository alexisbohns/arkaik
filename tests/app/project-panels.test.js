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
const path = require("path");
const { loadPanelStack, loadProjectPanels, BUILD_DIR } = require("./load-panel-utils");

const { openFrom, initStack } = loadPanelStack();
const {
  RAW_PANEL_KEY,
  cellPanelKey,
  criterionPanelKey,
  isCellEntry,
  isCriterionEntry,
  isNodeEntry,
  topNodeKey,
  pruneNodeEntries,
  buildPanelCrumbs,
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

// --- criterion entries: the third kind, addressless like Raw ---
const criterionEntry = {
  key: criterionPanelKey("SEC-03", "web"),
  instanceId: "i-c",
  payload: { kind: "criterion", criterionId: "SEC-03", surface: "web" },
};
const homeEntry = { key: "V-home", instanceId: "i-n", payload: node("V-home") };

assert(
  criterionPanelKey("SEC-03", "web") === "criterion:SEC-03@web",
  "a criterion key is namespaced so it can never collide with a node id",
);
assert(
  criterionPanelKey("SEC-03") === "criterion:SEC-03@",
  "a criterion key without a surface is still namespaced",
);
assert(
  criterionPanelKey("SEC-03", "web") !== criterionPanelKey("SEC-03", "ios"),
  "the same criterion on two surfaces is two panels",
);
assert(isCriterionEntry(criterionEntry) === true, "a criterion entry is recognised");
assert(isCriterionEntry(homeEntry) === false, "a node entry is not a criterion entry");
assert(isCriterionEntry(rawEntry) === false, "a raw entry is not a criterion entry");
assert(isNodeEntry(criterionEntry) === false, "a criterion entry is not a node entry");

assert(
  topNodeKey([homeEntry, criterionEntry]) === "V-home",
  "a criterion panel above a node does not displace what ?node= names",
);
assert(
  topNodeKey([criterionEntry]) === null,
  "a stack of only criterion panels addresses no node",
);

const criterionPruned = pruneNodeEntries([homeEntry, criterionEntry], new Set());
assert(
  criterionPruned.length === 1 && isCriterionEntry(criterionPruned[0]),
  "a node prune never evicts a criterion panel",
);

const criterionCrumbs = buildPanelCrumbs([criterionEntry], "Quality", () => undefined);
assert(
  criterionCrumbs[criterionCrumbs.length - 1].label === "SEC-03",
  "a criterion crumb reads as its criterion id, not its namespaced key",
);

// --- cell entries: the fourth kind, addressless for the same reason ---
const cellEntry = {
  key: cellPanelKey("SEC", "web"),
  instanceId: "i-cell",
  payload: { kind: "cell", domain: "SEC", surface: "web" },
};

assert(
  cellPanelKey("SEC", "web") === "cell:SEC@web",
  "a cell key namespaces both halves — a domain code is a word a pack picks freely",
);
assert(
  cellPanelKey("SEC", "web") !== cellPanelKey("SEC", "ios"),
  "the same domain on two surfaces is two panels",
);
assert(
  cellPanelKey("SEC", "web") !== RAW_PANEL_KEY && !isNodeEntry(cellEntry),
  "a cell entry is neither the raw panel nor a node",
);
assert(
  isCellEntry(cellEntry) && !isCellEntry(criterionEntry) && !isCriterionEntry(cellEntry),
  "the three non-node kinds are told apart by kind, never by key",
);
assert(
  topNodeKey([homeEntry, cellEntry]) === "V-home",
  "a cell panel above a node does not displace what ?node= names",
);

const cellPruned = pruneNodeEntries([homeEntry, cellEntry], new Set());
assert(
  cellPruned.length === 1 && isCellEntry(cellPruned[0]),
  "a node prune never evicts a cell panel",
);

const cellCrumbs = buildPanelCrumbs([cellEntry], "Matrix", () => undefined);
assert(
  cellCrumbs[cellCrumbs.length - 1].label === "SEC × web",
  "a cell crumb reads as its domain and surface, not its namespaced key",
);

// --- the History section reads the journal by the route id, never the node's ---
// A hosted project stores the imported bundle verbatim under a server-minted
// `prj_…` id, so its nodes keep the bundle's own `project_id`; a section keyed
// on that would route to the local provider and read an empty (or a colliding
// local project's) journal. Pinned at the source because the panel is a
// client component with no bundler-free load path.
const panelSource = fs.readFileSync(
  path.join(__dirname, "..", "..", "components", "panels", "NodeDetailPanel.tsx"),
  "utf8",
);
assert(
  !panelSource.includes("useJournal(node.project_id)"),
  "HistorySection never keys the journal on node.project_id",
);
assert(
  /const projectId = useProjectId\(\);\s*\n\s*const \{[^}]*\} = useJournal\(projectId\);/.test(panelSource),
  "HistorySection reads the journal by the route id from useProjectId()",
);
assert(
  panelSource.includes('import { useProjectId } from "@/lib/hooks/useProjectId";'),
  "NodeDetailPanel imports useProjectId from the shared route-param hook",
);

fs.rmSync(BUILD_DIR, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll project-panels tests passed");
