# Journey canvas rework — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Journey map's global, async ELK layout with a pure synchronous block layout, give flow cards a real fold handle, and make the camera follow the click instead of the panel.

**Architecture:** `buildJourneyGraph` keeps producing React Flow nodes/edges and additionally returns the block tree it walked (`roots`). A new pure module `journey-layout.ts` turns that tree into positions synchronously; `JourneyCanvas` runs it in a `useMemo` with measured card sizes overriding estimates. `Canvas` (shared with the System map) gains three small props — `onMeasured`, `pin`, `focus` — and loses its re-fit-on-panel behaviour. Spec: `docs/superpowers/specs/2026-10-08-journey-canvas-rework-design.md`.

**Tech Stack:** Next.js app, React 19, `@xyflow/react` 12.10, plain-Node test scripts transpiled by `tests/app/load-journey-graph.js` (TypeScript `transpileModule`, hand-maintained module/specifier tables), eslint, `tsc`.

**Stack of PRs (one branch per part, chained with `gh stack`):**

| Part | Branch | Tasks |
|---|---|---|
| 1 | `journey-layout-1-block-tree` | 1–6 |
| 2 | `journey-layout-2-sync-canvas` | 7–11 |
| 3 | `journey-layout-3-fold-handle` | 12 |
| 4 | `journey-layout-4-camera` | 13–14 |

Verification commands used throughout:

```bash
npm run test:journey-graph      # golden parity over seed/pebbles.json
npm run test:journey-layout     # new, Task 5
npm run test:product-scope      # reads FlowNode/ViewNode SOURCE text — touch those files carefully
npx tsc --noEmit
npm run lint
```

Each part must pass all five on its own before the next part starts (docs/conventions.md § Shipping larger work).

---

## Part 1 — block tree, context-keyed ids, pure layout

### Task 1: Visual ids carry the whole entry context

**Files:**
- Modify: `lib/utils/graph-build.ts:28-36`
- Modify: `lib/utils/journey-graph.ts:372,381`
- Modify: `components/maps/JourneyMap.tsx:698-707`
- Test: `tests/app/journey-graph.test.js:145-150`

- [ ] **Step 1: Write the failing test** — append to `tests/app/journey-graph.test.js` just before the final `process.exit` / failure summary (end of file):

```js
// --- Branch arms never share a card (spec 2026-10-08 § Visual ids) ----------
// The self-map's routing flow references the same flows at index 0 of two
// arms; each arm draws its own card, so the junction labels never pile up.
{
  const selfMap = JSON.parse(fs.readFileSync(path.join(ROOT, "seed", "arkaik-self-map.json"), "utf8"));
  const smNodesById = new Map(selfMap.nodes.map((node) => [node.id, node]));
  const smChildren = new Map();
  const smParent = new Map();
  for (const edge of selfMap.edges) {
    if (edge.edge_type !== "composes") continue;
    smChildren.set(edge.source_id, [...(smChildren.get(edge.source_id) ?? []), edge.target_id]);
    if (!smParent.has(edge.target_id)) smParent.set(edge.target_id, edge.source_id);
  }
  const smRoot = smNodesById.get(selfMap.project.root_node_id);
  const smClosure = computeComposeClosure(smRoot, smChildren, smNodesById);
  const graph = buildJourneyGraph({
    dataNodes: selfMap.nodes,
    dataEdges: selfMap.edges,
    nodesById: smNodesById,
    composeParentByChild: smParent,
    explicitRootNode: smRoot,
    composeClosure: smClosure,
    expandedFlows: new Set(["F-projects-routing"]),
    display: { images: true, flow_platforms: "rings", view_platforms: "chips" },
    viewApiRelationsByViewId: computeViewApiRelations(selfMap.edges, smNodesById),
  });
  const createCards = graph.nodes.filter((node) => getBaseNodeId(node.id) === "F-create-project");
  assert(createCards.length === 2, `F-create-project is drawn once per arm (got ${createCards.length})`);
  const incoming = graph.edges.filter((edge) => edge.type === "compose" && getBaseNodeId(edge.target) === "F-create-project");
  assert(
    incoming.length === 2 && new Set(incoming.map((edge) => edge.target)).size === 2,
    "each arm's card has exactly one incoming compose edge",
  );
}
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm run test:journey-graph 2>&1 | grep -E "FAIL|arm"`
Expected: `FAIL: F-create-project is drawn once per arm (got 1)`

- [ ] **Step 3: Change the id builder** — in `lib/utils/graph-build.ts` replace the doc comment and function:

```ts
/**
 * A reused node renders once per playlist occurrence as a *visual* node:
 * `{nodeId}@{contextKey}`, where the context key is the entry's whole path
 * through the walk (`root:F-a:0:1:0`, `…:flow:1`) — so the same node at the
 * same index of two branch arms is two cards. `getBaseNodeId` maps any visual
 * id back to the underlying data node.
 */
export const VISUAL_NODE_ID_SEPARATOR = "@";

export function createVisualNodeId(nodeId: string, contextKey: string): string {
  return `${nodeId}${VISUAL_NODE_ID_SEPARATOR}${contextKey}`;
}
```

- [ ] **Step 4: Use the entry context at both call sites** in `lib/utils/journey-graph.ts`:

```ts
        const viewVisualId = createVisualNodeId(viewNode.id, entryContextKey);
```
```ts
        const flowVisualId = createVisualNodeId(flowNode.id, entryContextKey);
```

- [ ] **Step 5: Fix the two readers of the old shape.**

`tests/app/journey-graph.test.js` (expanded golden block):
```js
  const visualNodes = graph.nodes.filter((node) => node.id.startsWith(`${firstTopLevelFlowId}`) === false && node.id.includes(`:${firstTopLevelFlowId}:`));
```
Simplify to exactly this (the three playlist cards are `V-…@root:F-record-pebble:N`):
```js
  const visualNodes = graph.nodes.filter((node) => node.id.includes(`@root:${firstTopLevelFlowId}:`));
```

`components/maps/JourneyMap.tsx` `handleLayout` (this whole function is deleted in Task 9; for Part 1 it must keep working):
```ts
    // Any card drawn under this flow's expansion: a visual id whose context
    // path passes through the flow (`…:F-x:…`), under any root kind.
    if (!layoutedNodes.some((node) => getBaseNodeId(node.id) !== node.id && node.id.includes(`:${flowId}:`))) return;
```
and drop `VISUAL_NODE_ID_SEPARATOR` from the import list at the top of the file if it is now unused (`npm run lint` will say).

- [ ] **Step 6: Run the suites**

Run: `npm run test:journey-graph 2>&1 | grep -c FAIL; npx tsc --noEmit; npm run lint`
Expected: `0`, no tsc output, lint 0 errors.

- [ ] **Step 7: Commit**

```bash
git add lib/utils/graph-build.ts lib/utils/journey-graph.ts components/maps/JourneyMap.tsx tests/app/journey-graph.test.js
git commit -m "fix(journey): a node reused in two branch arms is two cards, not one

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 2: The block tree type and the card-size module

**Files:**
- Create: `lib/utils/journey-layout.ts` (types only for now; the algorithm comes in Task 4)
- Create: `lib/utils/journey-card-size.ts`
- Modify: `lib/utils/elk-layout.ts:6-60`

- [ ] **Step 1: Create `lib/utils/journey-layout.ts` with the types**

```ts
/**
 * The Journey map's layout (docs/superpowers/specs/2026-10-08-journey-canvas-rework-design.md).
 *
 * `buildJourneyGraph` walks the journey — the compose closure, then each
 * expanded flow's playlist with its branches — and returns the structure it
 * walked as a tree of blocks. `layoutJourney` turns that tree into positions,
 * synchronously and deterministically: a toggle moves only what sits after the
 * toggled flow in its own sequence, and re-centres the rows that contain it.
 */

export type JourneyBlock =
  /**
   * A card. `children` are the blocks hung under it: the compose children of a
   * closure node, or the playlist sequence of an expanded flow.
   */
  | { kind: "node"; id: string; children: JourneyBlock[] }
  /** Playlist entries one after the other. */
  | { kind: "sequence"; items: JourneyBlock[] }
  /** The synthetic branch card, its arms side by side. */
  | { kind: "branch"; id: string; arms: JourneyBlock[] };

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Rect extends Point, Size {}

/** Reading direction: `DOWN` stacks a sequence top to bottom, `RIGHT` left to right. */
export type JourneyDirection = "DOWN" | "RIGHT";
```

- [ ] **Step 2: Create `lib/utils/journey-card-size.ts`** — the flow/view/branch estimates moved out of `elk-layout.ts`, with the branch variants measured on the live canvas (condition pill 117×34, junction card 224×145 on 2026-10-08). Full file:

```ts
import type { Node } from "@xyflow/react";
import type { Size } from "@/lib/utils/journey-layout";

/** Every flow and view card is this wide (`w-60`). */
export const CARD_WIDTH = 240;

// Chrome every card pays: py-3 (24) + border-2 (4) + the title row (28).
const CARD_CHROME_HEIGHT = 56;
const CARD_GAP = 12; // gap-3 between a card's stacked blocks

/**
 * The size a Journey card will render at, summed block by block from the same
 * `data` the component reads — an estimate the canvas replaces with the
 * measured size as soon as React Flow reports one, so a drift here costs one
 * frame, never an overlap. Keep the constants in step with `FlowNode` and
 * `ViewNode`.
 */
export function estimateJourneyCardSize(node: Pick<Node, "type" | "data">): Size {
  const data = node.data as Record<string, unknown>;

  switch (node.type) {
    case "flow": {
      if (data.renderVariant === "branch") {
        // A condition is an inline pill; a junction is a dashed summary card.
        return data.branchKind === "condition" ? { width: 160, height: 36 } : { width: 224, height: 145 };
      }
      // rings (the default): one 30px ring row; bars: three h-2 gauges on
      // gap-2 rows. Both fallbacks match the components' own.
      const platformBlock = data.platformDisplay === "bars" ? 58 : 30;
      // py-3 (24) + border-2 (4) + the flow's taller title row (38) + gap-3.
      return { width: CARD_WIDTH, height: 24 + 4 + 38 + CARD_GAP + platformBlock };
    }
    case "view": {
      const display = data.display as Record<string, unknown> | undefined;
      const platforms = (data.platforms as string[] | undefined) ?? [];
      const screenshots = data.platformScreenshots as Record<string, string> | undefined;
      const hasScreenshot = screenshots != null && Object.values(screenshots).some(Boolean);
      const hasCover = typeof data.coverUrl === "string";
      const showsImage = display?.images !== false && (hasScreenshot || hasCover);
      const showsRows = display?.view_platforms === "rows" && platforms.length > 0;
      const showsChips = display?.view_platforms !== "rows" && platforms.length > 0;
      const hasApi =
        ((data.apiInbound as unknown[] | undefined)?.length ?? 0) > 0 ||
        ((data.apiOutbound as unknown[] | undefined)?.length ?? 0) > 0;

      let height = CARD_CHROME_HEIGHT;
      if (showsImage) height += CARD_GAP + 112; // h-28
      // Rows are text-xs (20) on space-y-2 (8).
      if (showsRows) height += CARD_GAP + platforms.length * 20 + (platforms.length - 1) * 8;
      // The footer only exists when it has something in it: API chips, platform chips, or both.
      if (hasApi || showsChips) height += CARD_GAP + 36;

      return { width: CARD_WIDTH, height };
    }
    default:
      return { width: 180, height: 100 };
  }
}
```

- [ ] **Step 3: Make `elk-layout.ts` delegate.** Replace its `CARD_CHROME_HEIGHT`, `CARD_GAP` constants and the `getNodeSize` function (lines 6–60) with:

```ts
import { estimateJourneyCardSize } from "./journey-card-size";

/**
 * Size lookup matching rendered node dimensions. Flow and view cards are the
 * Journey's — `journey-card-size.ts` owns their estimate; the System map's
 * own species are fixed-size cards.
 */
function getNodeSize(node: Node): { width: number; height: number } {
  switch (node.type) {
    case "flow":
    case "view":
      return estimateJourneyCardSize(node);
    case "dataModel":
    case "apiEndpoint":
      return { width: 192, height: 92 };
    default:
      return { width: 180, height: 100 };
  }
}
```

- [ ] **Step 4: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add lib/utils/journey-layout.ts lib/utils/journey-card-size.ts lib/utils/elk-layout.ts
git commit -m "refactor(journey): card size estimates in their own module; block tree types

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 3: The builder returns the block tree it walked

**Files:**
- Modify: `lib/utils/journey-graph.ts` (imports, `RenderSequenceResult`, `renderSequence`, the three root branches, return type)
- Modify: `tests/app/load-journey-graph.js:22-45` (module tables)
- Test: `tests/app/journey-graph.test.js`

- [ ] **Step 1: Teach the test loader the new modules.** In `tests/app/load-journey-graph.js`, `MODULES` gains two rows **before** `journey-graph`:

```js
  ["lib/utils/journey-layout.ts", "journey-layout"],
  ["lib/utils/journey-card-size.ts", "journey-card-size"],
```
and `SPECIFIER_MAP` gains:
```js
  "@/lib/utils/journey-layout": "./journey-layout",
  "@/lib/utils/journey-card-size": "./journey-card-size",
```
and the returned object gains:
```js
    layoutJourney: require(path.join(BUILD_DIR, "journey-layout.js")).layoutJourney,
    findBlock: require(path.join(BUILD_DIR, "journey-layout.js")).findBlock,
    blockNodeIds: require(path.join(BUILD_DIR, "journey-layout.js")).blockNodeIds,
    GAP_MAIN: require(path.join(BUILD_DIR, "journey-layout.js")).GAP_MAIN,
    GAP_CROSS: require(path.join(BUILD_DIR, "journey-layout.js")).GAP_CROSS,
    estimateJourneyCardSize: require(path.join(BUILD_DIR, "journey-card-size.js")).estimateJourneyCardSize,
```
(`layoutJourney`, `findBlock`, `blockNodeIds`, `GAP_*` exist after Task 4; `require` of a missing export yields `undefined`, which is fine until then.)

- [ ] **Step 2: Write the failing test** — append to `tests/app/journey-graph.test.js`:

```js
// --- The builder returns the structure it walked (spec § Structure) --------
{
  const graph = buildJourneyGraph({ ...baseParams, expandedFlows: new Set([firstTopLevelFlowId]) });
  assert(Array.isArray(graph.roots) && graph.roots.length === 1, "an anchored journey has one root block");
  const root = graph.roots[0];
  assert(root.kind === "node" && root.id === explicitRootNode.id, "the root block is the anchor's card");

  const flat = [];
  const walk = (block) => {
    if (block.kind === "sequence") { block.items.forEach(walk); return; }
    flat.push(block.id);
    (block.kind === "node" ? block.children : block.arms).forEach(walk);
  };
  graph.roots.forEach(walk);
  const drawn = new Set(graph.nodes.map((node) => node.id));
  assert(flat.length === graph.nodes.length && flat.every((id) => drawn.has(id)), "every drawn card appears exactly once in the tree");

  const find = (block, id) => {
    if (block.kind !== "sequence" && block.id === id) return block;
    for (const child of block.kind === "sequence" ? block.items : block.kind === "node" ? block.children : block.arms) {
      const hit = find(child, id);
      if (hit) return hit;
    }
    return null;
  };
  const expanded = find(root, firstTopLevelFlowId);
  assert(
    expanded && expanded.children.length === 1 && expanded.children[0].kind === "sequence" && expanded.children[0].items.length === 3,
    "an expanded flow's one child is its playlist as a sequence of 3 cards",
  );
  const collapsed = find(root, "F-manage-collections");
  assert(collapsed && collapsed.children.length === 0, "a collapsed flow is a leaf");

  const branchy = buildJourneyGraph({ ...baseParams, expandedFlows: new Set(["F-manage-collections"]) });
  const branch = find(branchy.roots[0], "branch-root:F-manage-collections:1");
  assert(
    branch && branch.kind === "branch" && branch.arms.length === 4 && branch.arms.every((arm) => arm.kind === "sequence" && arm.items.length === 1),
    "a junction is a branch block with one sequence per case, in authored order",
  );
}
```

- [ ] **Step 3: Run it to see it fail**

Run: `npm run test:journey-graph 2>&1 | grep -E "FAIL"`
Expected: `FAIL: an anchored journey has one root block` (and the rest of the block).

- [ ] **Step 4: Thread blocks through the walk.** In `lib/utils/journey-graph.ts`:

Add the import:
```ts
import type { JourneyBlock } from "@/lib/utils/journey-layout";
```

Replace `RenderSequenceResult`:
```ts
interface RenderSequenceResult {
  startIds: string[];
  endIds: string[];
  entryNodeId?: string;
  /** What this sequence or entry laid down, for the layout; `null` when nothing was drawn. */
  block: JourneyBlock | null;
}

type NodeBlock = Extract<JourneyBlock, { kind: "node" }>;

/** The builder's output: React Flow nodes and edges, plus the tree the layout places. */
export interface JourneyGraph {
  nodes: Node[];
  edges: Edge[];
  /** One root block per journey root (exactly one with an explicit anchor). */
  roots: JourneyBlock[];
}
```

Change the signature: `export function buildJourneyGraph(params: JourneyGraphParams): JourneyGraph {`. Update the function's doc comment last line to: `Pure: positions are \`{0,0}\` placeholders — \`layoutJourney\` places the \`roots\` tree.`

In `renderSequence`:
```ts
    if (entries.length === 0) {
      return { startIds: [], endIds: [], block: null };
    }

    let sequenceStartIds: string[] = [];
    let previousResult: RenderSequenceResult | null = null;
    const items: JourneyBlock[] = [];
```
In `renderEntry`, every `return { startIds: [], endIds: [] }` becomes `return { startIds: [], endIds: [], block: null }` (three of them: missing view, missing flow — and keep the shape everywhere else). The view return:
```ts
        return {
          startIds: [viewVisualId],
          endIds: [viewVisualId],
          entryNodeId: viewVisualId,
          block: { kind: "node", id: viewVisualId, children: [] },
        };
```
The flow entry:
```ts
        let flowEndIds = [flowVisualId];
        const children: JourneyBlock[] = [];

        if (expandedFlows.has(flowNode.id) && !renderedExpandedFlows.has(flowVisualId) && !flowTrail.has(flowNode.id)) {
          renderedExpandedFlows.add(flowVisualId);
          const nextTrail = new Set(flowTrail);
          nextTrail.add(flowNode.id);
          const flowEntries = getPlaylistEntries(nodesById, flowNode.id);
          const childSequence = renderSequence(flowEntries, depth + 1, nextTrail, `${entryContextKey}:flow`, flowVisualId);
          connectIds([flowVisualId], childSequence.startIds);
          if (childSequence.endIds.length > 0) {
            flowEndIds = childSequence.endIds;
          }
          if (childSequence.block) children.push(childSequence.block);
        }

        return {
          startIds: [flowVisualId],
          endIds: flowEndIds,
          entryNodeId: flowVisualId,
          block: { kind: "node", id: flowVisualId, children },
        };
```
The branch: declare `const arms: JourneyBlock[] = [];` before `branches.forEach`, and inside it:
```ts
        if (branch.entries.length === 0) {
          branchEndIds.push(branchId);
          arms.push({ kind: "sequence", items: [] });
          return;
        }

        const branchSequence = renderSequence(/* unchanged args */);
        arms.push(branchSequence.block ?? { kind: "sequence", items: [] });
```
and the branch return:
```ts
      return {
        startIds: [branchId],
        endIds: uniqueIds(branchEndIds.length > 0 ? branchEndIds : [branchId]),
        block: { kind: "branch", id: branchId, arms },
      };
```
In the entries loop, right after `if (entryResult.startIds.length === 0) { continue; }`:
```ts
      if (entryResult.block) items.push(entryResult.block);
```
and the sequence's return:
```ts
    return {
      startIds: uniqueIds(sequenceStartIds),
      endIds: uniqueIds(terminalIds),
      block: { kind: "sequence", items },
    };
```

- [ ] **Step 5: Build the closure tree.** Before `if (explicitRootNode) {` add:

```ts
  // The closure is already a tree: `computeComposeClosure` visits each child
  // once, so a pair's child hangs under exactly one parent.
  const roots: JourneyBlock[] = [];
  const blockByNodeId = new Map<string, NodeBlock>();
  const blockFor = (id: string): NodeBlock => {
    let block = blockByNodeId.get(id);
    if (!block) {
      block = { kind: "node", id, children: [] };
      blockByNodeId.set(id, block);
    }
    return block;
  };
```
Then in the three branches:

```ts
  if (explicitRootNode) {
    addDataNode(explicitRootNode);
    roots.push(blockFor(explicitRootNode.id));

    composeClosure.pairs.forEach(({ parentId, child }) => {
      addDataNode(child);
      addComposeEdge(parentId, child.id);
      blockFor(parentId).children.push(blockFor(child.id));

      if (child.species === "flow" && expandedFlows.has(child.id)) {
        renderedExpandedFlows.add(child.id);
        const childSequence = renderSequence(
          getPlaylistEntries(nodesById, child.id),
          2,
          new Set([child.id]),
          `root:${child.id}`,
          child.id,
        );
        connectIds([child.id], childSequence.startIds);
        if (childSequence.block) blockFor(child.id).children.push(childSequence.block);
      }
    });

    if (explicitRootNode.species === "flow" && expandedFlows.has(explicitRootNode.id) && composeClosure.pairs.length === 0) {
      renderedExpandedFlows.add(explicitRootNode.id);
      const rootSequence = renderSequence(
        getPlaylistEntries(nodesById, explicitRootNode.id),
        2,
        new Set([explicitRootNode.id]),
        `root-self:${explicitRootNode.id}`,
        explicitRootNode.id,
      );
      connectIds([explicitRootNode.id], rootSequence.startIds);
      if (rootSequence.block) blockFor(explicitRootNode.id).children.push(rootSequence.block);
    }
  } else {
    const rootNodes = dataNodes.filter((node) => !composeParentByChild.has(node.id) && FLOW_CHILD_SPECIES.has(node.species));

    rootNodes.forEach((rootNode) => {
      addDataNode(rootNode);
      roots.push(blockFor(rootNode.id));

      if (rootNode.species === "flow" && expandedFlows.has(rootNode.id)) {
        renderedExpandedFlows.add(rootNode.id);
        const rootSequence = renderSequence(
          getPlaylistEntries(nodesById, rootNode.id),
          2,
          new Set([rootNode.id]),
          `fallback:${rootNode.id}`,
          rootNode.id,
        );
        connectIds([rootNode.id], rootSequence.startIds);
        if (rootSequence.block) blockFor(rootNode.id).children.push(rootSequence.block);
      }
    });
  }
```
And the final line: `return { nodes: visibleNodes, edges: visibleEdges, roots };`

- [ ] **Step 6: Run the suites**

Run: `npm run test:journey-graph 2>&1 | grep -c FAIL; npx tsc --noEmit; npm run lint`
Expected: `0`, clean, clean. (`JourneyCanvas` still reads only `.nodes`/`.edges`, so it compiles unchanged.)

- [ ] **Step 7: Commit**

```bash
git add lib/utils/journey-graph.ts tests/app/load-journey-graph.js tests/app/journey-graph.test.js
git commit -m "feat(journey): the graph builder returns the block tree it walked

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 4: `layoutJourney`

**Files:**
- Modify: `lib/utils/journey-layout.ts`
- Test: `tests/app/journey-layout.test.js` (Task 5 — write the test first, below)

- [ ] **Step 1: Write the failing test** — create `tests/app/journey-layout.test.js`:

```js
#!/usr/bin/env node
/**
 * The Journey's block layout (spec 2026-10-08 § The layout): pure, synchronous,
 * local. Pinned over the Pebbles seed and the self-map, collapsed and with
 * every flow expanded.
 */
const fs = require("fs");
const path = require("path");
const { loadJourneyGraph } = require("./load-journey-graph");
const {
  buildJourneyGraph,
  computeComposeClosure,
  computeViewApiRelations,
  layoutJourney,
  findBlock,
  blockNodeIds,
  estimateJourneyCardSize,
  GAP_MAIN,
  GAP_CROSS,
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

function lay(graph, direction = "DOWN") {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const sizeOf = (id) => estimateJourneyCardSize(byId.get(id));
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
    // a sequence is a straight line; arms are GAP_CROSS apart.
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
    const walk = (block, axisX) => {
      if (block.kind === "sequence") {
        const centres = new Set();
        for (const item of block.items) {
          const id = firstCard(item);
          if (!id) continue;
          centres.add(Math.round(centreX(id)));
          walk(item, axisX);
        }
        if (centres.size > 1) problems.push(`sequence not straight: ${[...centres].join("/")}`);
        return;
      }
      const under = block.kind === "node" ? block.children : block.arms;
      const heads = under.map(firstCard).filter(Boolean);
      for (const head of heads) {
        if (rects.get(head).y !== bottom(block.id) + GAP_MAIN) problems.push(`${head} is not GAP_MAIN under ${block.id}`);
      }
      if (heads.length > 0) {
        const rowLeft = Math.min(...heads.map((h) => rects.get(h).x));
        const rowRight = Math.max(...heads.map((h) => rects.get(h).x + rects.get(h).width));
        if (Math.abs((rowLeft + rowRight) / 2 - centreX(block.id)) > 1) problems.push(`${block.id} is not centred over its row`);
      }
      under.forEach((child) => walk(child, centreX(block.id)));
    };
    graph.roots.forEach((root) => walk(root, null));
    assert(problems.length === 0, `${tag}: parents centred, rows GAP_MAIN below, sequences straight${problems.length ? ` (${problems.slice(0, 3).join("; ")})` : ""}`);

    // RIGHT is the exact axis swap of DOWN.
    const right = lay(graph, "RIGHT").positions;
    assert(
      graph.nodes.every((node) => right.get(node.id).x === positions.get(node.id).y && right.get(node.id).y === positions.get(node.id).x),
      `${tag}: RIGHT swaps the axes of DOWN`,
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

if (failures > 0) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nAll journey layout tests passed");
```

- [ ] **Step 2: Add the script and run it to see it fail**

In `package.json` scripts, after `"test:journey-graph"`:
```json
    "test:journey-layout": "node tests/app/journey-layout.test.js",
```
Run: `npm run test:journey-layout`
Expected: crashes with `TypeError: layoutJourney is not a function`.

- [ ] **Step 3: Implement the layout** — append to `lib/utils/journey-layout.ts`:

```ts
/** Space along the reading direction between a card and the row under it, and between sequence items. */
export const GAP_MAIN = 48;
/** Space across the reading direction between siblings in a row. */
export const GAP_CROSS = 40;

/** A block's extent in reading-direction (`main`) and across it (`cross`). */
interface Extent {
  main: number;
  cross: number;
}

const EMPTY: Extent = { main: 0, cross: 0 };

const childrenOf = (block: JourneyBlock): JourneyBlock[] =>
  block.kind === "sequence" ? block.items : block.kind === "node" ? block.children : block.arms;

/**
 * Place every card of the block tree. Pure and synchronous.
 *
 * In abstract axes — `main` is the reading direction, `cross` the other one:
 * a card's children form a row across, `GAP_MAIN` below it, and the card is
 * centred over the row; a sequence stacks its items along `main`, each centred
 * on the sequence's cross-centre; a branch is a card over the row of its arms.
 * Every flow and view card is `CARD_WIDTH` wide, so a sequence of cards is a
 * straight line. A toggle therefore moves only the items after the toggled
 * flow in its own sequence, and re-centres the rows that contain it — nothing
 * else.
 *
 * `direction` swaps the axes: `DOWN` reads top to bottom, `RIGHT` left to right.
 */
export function layoutJourney(
  roots: readonly JourneyBlock[],
  sizeOf: (id: string) => Size,
  direction: JourneyDirection = "DOWN",
): Map<string, Point> {
  const extents = new Map<JourneyBlock, Extent>();

  const cardExtent = (id: string): Extent => {
    const size = sizeOf(id);
    return direction === "DOWN" ? { main: size.height, cross: size.width } : { main: size.width, cross: size.height };
  };

  const rowExtent = (blocks: readonly JourneyBlock[]): Extent => {
    let main = 0;
    let cross = 0;
    for (const block of blocks) {
      const extent = measure(block);
      if (extent.cross === 0) continue;
      cross += (cross > 0 ? GAP_CROSS : 0) + extent.cross;
      main = Math.max(main, extent.main);
    }
    return { main, cross };
  };

  const measure = (block: JourneyBlock): Extent => {
    const known = extents.get(block);
    if (known) return known;

    let extent: Extent;
    if (block.kind === "sequence") {
      let main = 0;
      let cross = 0;
      for (const item of block.items) {
        const itemExtent = measure(item);
        if (itemExtent.cross === 0) continue;
        main += (main > 0 ? GAP_MAIN : 0) + itemExtent.main;
        cross = Math.max(cross, itemExtent.cross);
      }
      extent = main === 0 ? EMPTY : { main, cross };
    } else {
      const card = cardExtent(block.id);
      const row = rowExtent(childrenOf(block));
      extent = {
        main: card.main + (row.main > 0 ? GAP_MAIN + row.main : 0),
        cross: Math.max(card.cross, row.cross),
      };
    }

    extents.set(block, extent);
    return extent;
  };

  const positions = new Map<string, Point>();
  const put = (id: string, main: number, cross: number) => {
    const at = { main: Math.round(main), cross: Math.round(cross) };
    positions.set(id, direction === "DOWN" ? { x: at.cross, y: at.main } : { x: at.main, y: at.cross });
  };

  const placeRow = (blocks: readonly JourneyBlock[], main: number, crossCentre: number) => {
    const row = rowExtent(blocks);
    let cross = crossCentre - row.cross / 2;
    for (const block of blocks) {
      const extent = measure(block);
      if (extent.cross === 0) continue;
      place(block, main, cross + extent.cross / 2);
      cross += extent.cross + GAP_CROSS;
    }
  };

  const place = (block: JourneyBlock, main: number, crossCentre: number) => {
    if (block.kind === "sequence") {
      let cursor = main;
      for (const item of block.items) {
        const extent = measure(item);
        if (extent.cross === 0) continue;
        place(item, cursor, crossCentre);
        cursor += extent.main + GAP_MAIN;
      }
      return;
    }

    const card = cardExtent(block.id);
    put(block.id, main, crossCentre - card.cross / 2);
    placeRow(childrenOf(block), main + card.main + GAP_MAIN, crossCentre);
  };

  placeRow(roots, 0, rowExtent(roots).cross / 2);
  return positions;
}

/** The node or branch block carrying `id`, searched depth-first; `null` when none does. */
export function findBlock(roots: readonly JourneyBlock[], id: string): JourneyBlock | null {
  for (const block of roots) {
    if (block.kind !== "sequence" && block.id === id) return block;
    const hit = findBlock(childrenOf(block), id);
    if (hit) return hit;
  }
  return null;
}

/** Every card id inside a block, the block's own card first. */
export function blockNodeIds(block: JourneyBlock | null): string[] {
  if (!block) return [];
  const ids: string[] = [];
  const walk = (current: JourneyBlock) => {
    if (current.kind !== "sequence") ids.push(current.id);
    childrenOf(current).forEach(walk);
  };
  walk(block);
  return ids;
}

/** The bounding box of a block's cards, from placed positions; `null` for an empty block. */
export function blockBounds(
  block: JourneyBlock | null,
  positions: ReadonlyMap<string, Point>,
  sizeOf: (id: string) => Size,
): Rect | null {
  let rect: Rect | null = null;
  for (const id of blockNodeIds(block)) {
    const at = positions.get(id);
    if (!at) continue;
    const size = sizeOf(id);
    if (!rect) {
      rect = { x: at.x, y: at.y, width: size.width, height: size.height };
      continue;
    }
    const right = Math.max(rect.x + rect.width, at.x + size.width);
    const bottom = Math.max(rect.y + rect.height, at.y + size.height);
    rect.x = Math.min(rect.x, at.x);
    rect.y = Math.min(rect.y, at.y);
    rect.width = right - rect.x;
    rect.height = bottom - rect.y;
  }
  return rect;
}
```

- [ ] **Step 4: Run the layout and graph suites**

Run: `npm run test:journey-layout 2>&1 | grep -E "FAIL|passed|failure"; npm run test:journey-graph 2>&1 | grep -c FAIL`
Expected: `All journey layout tests passed`, `0`.

If the "no two cards overlap" assertion fails for the self-map, the culprit is almost certainly a condition pill estimate narrower than its label; widen the estimate in `journey-card-size.ts` rather than the gap, and note the measured size in the commit.

- [ ] **Step 5: Typecheck, lint, commit**

Run: `npx tsc --noEmit && npm run lint`

```bash
git add lib/utils/journey-layout.ts tests/app/journey-layout.test.js package.json
git commit -m "feat(journey): a pure, synchronous block layout for the journey tree

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 5: CI runs the new suite

**Files:**
- Modify: `.github/workflows/ci.yml:184-190`

- [ ] **Step 1: Add the step** right after the `Journey graph` step (the one running `npm run test:journey-graph`), with the same indentation and job:

```yaml
      - name: Journey layout tests
        run: npm run test:journey-layout
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: run the journey layout suite

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 6: Open PR 1

- [ ] **Step 1: Full gate**

Run: `npm run test:journey-graph && npm run test:journey-layout && npm run test:product-scope && npx tsc --noEmit && npm run lint`
Expected: all green.

- [ ] **Step 2: Regenerate artifacts if the repo has a generate step** (memory: CI diffs generated artifacts). Run `git status` after `npm run build:schema 2>/dev/null || true` — if anything under `packages/` or `docs/` changed, commit it.

- [ ] **Step 3: Push and open the PR with `gh stack`** (use the `gh-stack` skill). Body:

```markdown
Part 1 of the Journey canvas rework (spec: docs/superpowers/specs/2026-10-08-journey-canvas-rework-design.md).

- Visual ids carry the whole entry context, so a flow referenced at the same index of two branch arms is two cards. On the self-map, *Projects Actions Routing* drew 4 cards for 7 references and its case labels piled up on the merged ones.
- `buildJourneyGraph` returns the block tree it walks (`roots`).
- `journey-layout.ts`: a pure synchronous block layout (not yet wired to the canvas — part 2).
- Card size estimates move to `journey-card-size.ts`; ELK delegates to it.

## Lab Note

```yaml
en:
  title: "Every branch of a journey now shows its own cards"
  summary: "When two branches of a flow lead to the same screen, the Journey map draws it once per branch, so their labels no longer pile up on a single card."
fr:
  title: "Chaque branche d'un parcours a maintenant ses propres cartes"
  summary: "Quand deux branches d'un flow mènent au même écran, la carte Journey le dessine une fois par branche : fini les libellés qui s'empilent sur une seule carte."
nodes: [F-projects-routing]
suggested:
  molecule: arkaik
  type: fix
  tags: [journey]
```

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

Then read the PR's comments (`gh pr view --comments`) for the Lab Note reminder and fix the body if it complains.

---

## Part 2 — the canvas lays out synchronously

Branch `journey-layout-2-sync-canvas`, stacked on part 1.

### Task 7: `Canvas` reports measured sizes

**Files:**
- Modify: `components/graph/Canvas.tsx:33-60` (props) and the `measured` state block

- [ ] **Step 1: Add the prop.** In `CanvasProps`:

```ts
  /**
   * Measured card sizes, as React Flow reports them. The Journey lays itself
   * out synchronously from estimates and re-lays from these, so a wrong
   * estimate costs one frame, never an overlap.
   */
  onMeasured?: (sizes: Record<string, { width: number; height: number }>) => void;
```
Destructure `onMeasured` in the component's parameter list.

- [ ] **Step 2: Report after each change.** Right after the `handleNodesChange` callback:

```ts
  // Reported from an effect, not from inside the state updater — updaters must
  // stay pure (StrictMode double-invokes them).
  const onMeasuredRef = useRef(onMeasured);
  useEffect(() => {
    onMeasuredRef.current = onMeasured;
  });
  useEffect(() => {
    onMeasuredRef.current?.(measured);
  }, [measured]);
```

- [ ] **Step 3: Typecheck, commit**

```bash
npx tsc --noEmit && npm run lint
git add components/graph/Canvas.tsx
git commit -m "feat(canvas): report measured card sizes to the owner

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 8: `JourneyCanvas` lays out with `layoutJourney`

**Files:**
- Rewrite: `components/graph/JourneyCanvas.tsx`

- [ ] **Step 1: Replace the file** with:

```tsx
"use client";

import { useCallback, useMemo, useState } from "react";
import type { Node, NodeMouseHandler, OnConnect, EdgeMouseHandler } from "@xyflow/react";
import type { MapMinimapColorMode } from "@arkaik/schema";
import { Canvas, type CanvasPin } from "@/components/graph/Canvas";
import { buildJourneyGraph, type JourneyGraphParams } from "@/lib/utils/journey-graph";
import { estimateJourneyCardSize } from "@/lib/utils/journey-card-size";
import { blockBounds, findBlock, layoutJourney, type JourneyDirection, type Size } from "@/lib/utils/journey-layout";
import type { ProductScope } from "@/lib/utils/product-scope";

export interface JourneyCanvasProps extends JourneyGraphParams {
  /** The product scope the cards read platforms from. */
  scope: ProductScope;
  /** Increment to re-frame the viewport (see `Canvas`). */
  fitSignal?: number;
  /** What a minimap node's fill encodes (docs/spec/maps.md § Display Options). */
  minimapColor?: MapMinimapColorMode;
  /**
   * Show only: no connect, drag, select, controls or minimap. Disables
   * canvas-level editing only — card-level affordances (add child, insert
   * between) come from `handlers`, so a read-only caller should pass none or
   * only the reading handlers (`onToggleFlow`, `onOpenDetails`).
   */
  readOnly?: boolean;
  /** Reading direction; `DOWN` unless a map asks otherwise. */
  direction?: JourneyDirection;
  /**
   * The flow card last toggled, by visual id, with a version that changes per
   * toggle: the canvas keeps that card where it is on screen while the graph
   * re-lays around it, then pans just enough to reveal what opened under it.
   */
  toggled?: { nodeId: string; version: number } | null;
  onNodeClick?: NodeMouseHandler;
  onConnect?: OnConnect;
  onEdgeClick?: EdgeMouseHandler;
}

/**
 * The Journey map's presentational half: graph construction → block layout →
 * `Canvas`, driven by plain data. Holds no project hooks, no panel context, no
 * dialogs — `JourneyMap` owns all of that and renders this. The marketing
 * page renders it over a fixture slice of the self-map.
 *
 * The layout is synchronous (`layoutJourney` over the builder's block tree),
 * so the first paint already has positions and a toggle re-lays in the same
 * render. Sizes start as estimates and switch to React Flow's measurements as
 * they arrive.
 *
 * `JourneyGraphParams` is spread straight into `buildJourneyGraph`, so the
 * props here are exactly the builder's inputs plus the canvas's own knobs.
 * `handlers` must be referentially stable (memoised by the caller): it is a
 * `buildJourneyGraph` input, so a fresh object every render rebuilds the graph.
 */
export function JourneyCanvas({
  scope,
  fitSignal,
  minimapColor,
  readOnly = false,
  direction = "DOWN",
  toggled = null,
  onNodeClick,
  onConnect,
  onEdgeClick,
  ...graphParams
}: JourneyCanvasProps) {
  const {
    dataNodes,
    dataEdges,
    nodesById,
    composeParentByChild,
    explicitRootNode,
    composeClosure,
    expandedFlows,
    display,
    viewApiRelationsByViewId,
    nodeFindings,
    handlers,
  } = graphParams;

  // Listed field by field rather than `[graphParams]`: the rest object is a
  // fresh identity every render, and a graph rebuild re-lays everything.
  const graph = useMemo(
    () =>
      buildJourneyGraph({
        dataNodes,
        dataEdges,
        nodesById,
        composeParentByChild,
        explicitRootNode,
        composeClosure,
        expandedFlows,
        display,
        viewApiRelationsByViewId,
        nodeFindings,
        handlers,
      }),
    [
      composeClosure,
      composeParentByChild,
      dataEdges,
      dataNodes,
      display,
      expandedFlows,
      explicitRootNode,
      handlers,
      nodeFindings,
      nodesById,
      viewApiRelationsByViewId,
    ],
  );

  const [measured, setMeasured] = useState<Record<string, Size>>({});

  const sizeOf = useCallback(
    (id: string): Size => {
      const known = measured[id];
      if (known) return known;
      const node = graph.nodes.find((candidate) => candidate.id === id);
      return node ? estimateJourneyCardSize(node) : { width: 0, height: 0 };
    },
    [graph, measured],
  );

  const positions = useMemo(() => layoutJourney(graph.roots, sizeOf, direction), [direction, graph, sizeOf]);

  const nodes = useMemo<Node[]>(
    () => graph.nodes.map((node) => ({ ...node, position: positions.get(node.id) ?? node.position })),
    [graph, positions],
  );

  const pin = useMemo<CanvasPin | null>(() => {
    if (!toggled) return null;
    const reveal = blockBounds(findBlock(graph.roots, toggled.nodeId), positions, sizeOf);
    return { nodeId: toggled.nodeId, version: toggled.version, reveal };
  }, [graph, positions, sizeOf, toggled]);

  return (
    <Canvas
      nodes={nodes}
      edges={graph.edges}
      onNodeClick={onNodeClick}
      onConnect={onConnect}
      onEdgeClick={onEdgeClick}
      onMeasured={setMeasured}
      fitSignal={fitSignal}
      pin={pin}
      scope={scope}
      minimapColor={minimapColor}
      readOnly={readOnly}
    />
  );
}
```

(`CanvasPin` and the `pin` prop are added in Task 10; `tsc` is red until then — ship Tasks 8–10 as one commit if you prefer green intermediate states, see memory "panel kind widening breaks narrowing".)

`sizeOf` does a linear `find` per card; the layout calls it once per card per pass and the Journey has tens of cards, not thousands. If profiling ever shows it, build a `Map` in the `graph` memo.

- [ ] **Step 2: Delete the ELK hook's Journey use.** `lib/hooks/useElkLayout.ts` keeps serving `SystemCanvas`; nothing to delete there. Remove the `useElkLayout` import from nowhere else — grep: `grep -rn useElkLayout components lib` must list only `SystemCanvas.tsx` and the hook.

### Task 9: `JourneyMap` — derived auto-expansion, plain toggle, toggled pin

**Files:**
- Modify: `components/maps/JourneyMap.tsx:78, 199-252, 328-352, 680-707, 805-825`
- Modify: `lib/utils/journey-graph.ts` (`JourneyGraphHandlers.onToggleFlow`, the flow card's `onToggle`)

- [ ] **Step 1: The handler learns the visual id.** In `journey-graph.ts`:

```ts
export interface JourneyGraphHandlers {
  /** `visualNodeId` names the card that was toggled — one of possibly several copies. */
  onToggleFlow?: (flowId: string, visualNodeId: string) => void;
```
and in `addDataNode`'s flow branch:
```ts
      if (handlers.onToggleFlow) baseData.onToggle = () => handlers.onToggleFlow!(node.id, visualNodeId);
```

- [ ] **Step 2: Expansion state becomes "what the user touched".** Replace line 78's `useState<Set<string>>(new Set())` with:

```ts
  // `null` until the first toggle: before that, the first top-level flow is
  // open so a fresh project opens on a real map instead of a bare root.
  // Derived in render, not set in an effect, so the first paint already has it
  // and the first fit frames the expanded map.
  const [touchedFlows, setTouchedFlows] = useState<Set<string> | null>(null);
  const [toggled, setToggled] = useState<{ nodeId: string; version: number } | null>(null);
```
After `topLevelFlowIds` and `allFlowIds` are computed (they are `useMemo`s around lines 168–183), add:
```ts
  const expandedFlows = useMemo(() => {
    if (touchedFlows === null) {
      const [firstTopLevelFlowId] = topLevelFlowIds;
      return firstTopLevelFlowId ? new Set([firstTopLevelFlowId]) : new Set<string>();
    }
    // A flow that no longer exists cannot stay expanded.
    return new Set([...touchedFlows].filter((flowId) => allFlowIds.has(flowId)));
  }, [allFlowIds, topLevelFlowIds, touchedFlows]);
```
Delete: the prune `useEffect` (the one wrapping `setExpandedFlows` over `allFlowIds`), the auto-expand `useEffect`, `autoExpandedRef`, `pendingFitFlowRef`, and `handleLayout`. Keep `fitSignal`/`reframe` for now (part 4 removes them).

- [ ] **Step 3: A plain toggle.** Replace `toggleFlow`:

```ts
  const toggleFlow = useCallback((flowId: string, visualNodeId: string) => {
    setTouchedFlows((prev) => {
      const next = new Set(prev ?? expandedFlows);
      if (!next.delete(flowId)) next.add(flowId);
      return next;
    });
    setToggled((prev) => ({ nodeId: visualNodeId, version: (prev?.version ?? 0) + 1 }));
  }, [expandedFlows]);
```
(`expandedFlows` in the deps is correct: the first toggle starts from the derived default.)

- [ ] **Step 4: Wire the canvas.** In the `<JourneyCanvas … />` element: replace `onLayout={handleLayout}` with `toggled={toggled}`. Remove `getBaseNodeId`-only imports that became unused (`npm run lint` lists them). `expandedFlows={expandedFlows}` stays.

- [ ] **Step 5: Check the marketing preview still compiles.** `grep -rn "JourneyCanvas" components app` — any caller passing `onLayout` must drop it (the landing preview passes nothing per the old doc comment; verify).

### Task 10: `Canvas` keeps the toggled card in place and reveals its block

**Files:**
- Modify: `components/graph/Canvas.tsx`

- [ ] **Step 1: The prop and type.** Export next to `CanvasProps`:

```ts
import type { Rect } from "@/lib/utils/journey-layout";

/** See `CanvasProps.pin`. */
export interface CanvasPin {
  nodeId: string;
  /** Changes once per toggle; the canvas handles each version once. */
  version: number;
  /** The toggled card and everything under it, in flow coordinates. */
  reveal: Rect | null;
}
```
In `CanvasProps`:
```ts
  /**
   * Keep one card where it is on screen while the graph re-lays around it —
   * the Journey's toggled flow — then pan just enough to reveal `reveal`,
   * keeping the card's top 24px inside the canvas. Collapsing reveals nothing
   * new, so a block already in view pans nothing.
   */
  pin?: CanvasPin | null;
```
Destructure `pin = null`.

- [ ] **Step 2: The effect.** Add a container ref on the wrapper `<div className="h-full w-full">` → `<div ref={containerRef} className="h-full w-full">` with `const containerRef = useRef<HTMLDivElement | null>(null);`, then after the `fitSignal` effect:

```ts
  /** Where every card was on the previous render — the delta a pin cancels. */
  const lastPositions = useRef<Map<string, { x: number; y: number }>>(new Map());
  const handledPin = useRef(0);

  useLayoutEffect(() => {
    const previous = lastPositions.current;
    lastPositions.current = new Map(nodes.map((node) => [node.id, node.position]));

    const reactFlow = reactFlowRef.current;
    const container = containerRef.current;
    if (!pin || !reactFlow || !container || pin.version === handledPin.current) return;
    const before = previous.get(pin.nodeId);
    const after = lastPositions.current.get(pin.nodeId);
    if (!before || !after) return;
    handledPin.current = pin.version;

    const viewport = reactFlow.getViewport();
    const { zoom } = viewport;
    // 1. Cancel the card's own move, instantly: it stays under the pointer.
    let x = viewport.x - (after.x - before.x) * zoom;
    let y = viewport.y - (after.y - before.y) * zoom;
    if (x !== viewport.x || y !== viewport.y) void reactFlow.setViewport({ x, y, zoom });

    // 2. Reveal the block, without pushing the card's top out of view.
    if (!pin.reveal) return;
    const margin = 24;
    const cardTop = { x: after.x * zoom + x, y: after.y * zoom + y };
    const overflow = {
      x: (pin.reveal.x + pin.reveal.width) * zoom + x + margin - container.clientWidth,
      y: (pin.reveal.y + pin.reveal.height) * zoom + y + margin - container.clientHeight,
    };
    const panX = Math.min(Math.max(overflow.x, 0), Math.max(cardTop.x - margin, 0));
    const panY = Math.min(Math.max(overflow.y, 0), Math.max(cardTop.y - margin, 0));
    if (panX === 0 && panY === 0) return;
    x -= panX;
    y -= panY;
    void reactFlow.setViewport({ x, y, zoom }, { duration: 250 });
  }, [nodes, pin]);
```
Add `useLayoutEffect` to the React import.

- [ ] **Step 3: Gate**

Run: `npx tsc --noEmit && npm run lint && npm run test:journey-graph && npm run test:product-scope`
Expected: clean.

- [ ] **Step 4: Visual check with Playwright** (scratchpad `pw/`, profile already holds Pebbles). Write `probe-part2.mjs` reusing `probe3.mjs`'s `grab`/`timeline` helpers, then:
  - fresh load of `/project/pebbles/maps/journey`: the viewport transform at 0ms and 1500ms differs by at most the initial fit — there must be **no** `scale(2)` sample; nodes never read `(0,0)`.
  - click the fold target (still the card body until part 3) on `F-manage-collections`: its screen position (`x*zoom+vp.x`) before and 300ms after is equal within 1px; `F-record-pebble` is **still expanded**; the new cards are within the canvas's bottom edge or the viewport has panned.
  - screenshot `part2-expanded.png` and look at it.

- [ ] **Step 5: Commit** (one commit for Tasks 8–10 if you kept them together):

```bash
git add components/graph/Canvas.tsx components/graph/JourneyCanvas.tsx components/maps/JourneyMap.tsx lib/utils/journey-graph.ts
git commit -m "feat(journey): lay the map out synchronously, keep the toggled card in place

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 11: Spec text and PR 2

**Files:**
- Modify: `docs/spec/maps.md:294`

- [ ] **Step 1: Update the non-goal line:**

```markdown
- **Per-map layout persistence** — positions are computed, not stored: the Journey by its own block layout (`lib/utils/journey-layout.ts`, synchronous, from the builder's block tree), the System map by ELK. Card *rendering* is per-map and stored (§ Display Options); card *placement* is not.
```

- [ ] **Step 2: Gate, commit, PR** (same five commands as Task 6; `gh stack` on top of part 1). Lab Note:

```yaml
en:
  title: "Unfold a flow without the whole map jumping"
  summary: "Opening or closing a flow on the Journey map now moves only what sits under it. The card you clicked stays put, several flows can be open at once, and the map opens already framed."
fr:
  title: "Déplie un flow sans que toute la carte saute"
  summary: "Ouvrir ou refermer un flow sur la carte Journey ne bouge plus que ce qui est en dessous. La carte reste sous ta souris, tu peux garder plusieurs flows ouverts, et la carte s'ouvre déjà cadrée."
suggested:
  molecule: arkaik
  type: improvement
  tags: [journey]
```

---

## Part 3 — the fold handle

Branch `journey-layout-3-fold-handle`, stacked on part 2.

### Task 12: `FlowNode` — handle under the card, click opens the panel

**Files:**
- Modify: `components/graph/nodes/FlowNode.tsx`
- Modify: `lib/utils/journey-graph.ts` (`playlistCount` on flow card data)
- Test: `tests/app/journey-graph.test.js`

- [ ] **Step 1: Failing test** — append:

```js
// --- The fold handle's count (spec § Flow card) -----------------------------
{
  const graph = buildJourneyGraph({ ...baseParams, expandedFlows: new Set() });
  const flow = graph.nodes.find((node) => node.id === "F-record-pebble");
  assert(flow?.data.playlistCount === 3, `a flow card knows how many distinct nodes its playlist references (got ${flow?.data.playlistCount})`);
  const orphan = graph.nodes.find((node) => node.type === "flow" && node.data.renderVariant !== "branch" && node.data.playlistCount === 0);
  assert(orphan === undefined || orphan.data.playlistCount === 0, "a flow with an empty playlist counts 0 (no handle)");
}
```
Run: `npm run test:journey-graph 2>&1 | grep FAIL` → `FAIL: a flow card knows how many…`.

- [ ] **Step 2: The builder counts.** In `addDataNode`'s flow branch, after `baseData.viewCount = …`:

```ts
      // What the fold handle promises: the distinct nodes an expansion draws.
      baseData.playlistCount = new Set(collectReferencedNodeIds(getPlaylistEntries(nodesById, node.id))).size;
```
Add `collectReferencedNodeIds` to the `@/lib/utils/graph-build` import.

- [ ] **Step 3: The card.** In `FlowNode.tsx`:

Imports: drop `ChevronDown`, `ChevronRight`, `Info` from the lucide import (keep `PlusCircle`, `Split`). Read the count next to `viewCount`:
```ts
  const playlistCount = typeof data.playlistCount === "number" ? data.playlistCount : 0;
```
Replace the non-branch card's wrapper props and the title-row buttons. The wrapper `<div>` becomes:
```tsx
        <div
        role={onOpenDetails ? "button" : "group"}
        tabIndex={onOpenDetails ? 0 : -1}
        aria-label={label}
        className={`relative flex flex-col gap-3 ${isBranch ? "w-56 border-dashed bg-muted/20" : "w-60"} px-4 py-3 rounded-xl bg-background border-2 border-border shadow-sm ${onOpenDetails ? "cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ring" : "cursor-default"} ${ghostClass.wrapper} ${ghostClass.border}`}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpenDetails?.();
          }
        }}
        {...nodeProps}
      >
```
(No `onClick`: the click bubbles to React Flow's `onNodeClick`, which is how a view card opens its panel too — one grammar.) In the title row, delete the `onOpenDetails && !isBranch && (<button …Info…>)` block and the two chevron branches, leaving:
```tsx
          <div className="flex items-center gap-1">
            <FindingBadge summary={findingSummary} />
            {stage && !isBranch && <StageIcon stage={stage} />}
          </div>
```
After the `PlatformAvailability`/branch-summary ternary, still inside the wrapper, add the handle:
```tsx
        {onToggle && !isBranch && playlistCount > 0 && (
          <FoldHandle expanded={expanded} hidden={playlistCount} onToggle={onToggle} />
        )}
```
and define, below the component:
```tsx
/**
 * The fold handle, astride the card's bottom edge where its playlist hangs:
 * "−" folds the playlist away, "+N" says how many nodes are folded and brings
 * them back. `nodrag nopan`, so pressing it never starts moving the card, and
 * the click stops here rather than opening the panel.
 */
function FoldHandle({ expanded, hidden, onToggle }: { expanded: boolean; hidden: number; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={`nodrag nopan absolute left-1/2 -bottom-[11px] -translate-x-1/2 inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full border px-1.5 font-mono text-[10px] font-bold leading-none cursor-pointer transition-colors ${
        expanded
          ? "border-border bg-background text-foreground hover:bg-muted"
          : "border-primary/60 bg-primary/15 text-primary hover:bg-primary/25"
      }`}
      aria-expanded={expanded}
      aria-label={expanded ? "Collapse the nodes under this flow" : `Show the ${hidden} nodes under this flow`}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      {expanded ? "−" : `+${hidden}`}
    </button>
  );
}
```
`aria-expanded` moves off the wrapper (it was `aria-expanded={isInteractive ? expanded : undefined}`): delete that attribute and the `isInteractive` variable.

- [ ] **Step 4: The source-asserting suite.** Run `npm run test:product-scope` — it reads `FlowNode.tsx` for the `flowGaugePlatforms` call, which this task does not touch. If it fails, read its message before touching anything.

- [ ] **Step 5: Gate + visual check.** `npx tsc --noEmit && npm run lint && npm run test:journey-graph && npm run test:product-scope`. Playwright: on `/project/pebbles/maps/journey`, `button[aria-label^="Show the"]` exists on collapsed flows and reads `+N`; clicking it expands (new `.react-flow__node`s appear) and **no panel opens**; clicking the card body at (30, 20) opens a panel (the canvas's bounding box narrows). Screenshot `part3-handle.png` and look at it in both colour schemes (`colorScheme: "dark"`).

- [ ] **Step 6: Commit and PR 3.** Lab Note:

```yaml
en:
  title: "A real handle to unfold a flow"
  summary: "Flow cards on the Journey map now carry a small handle underneath: it shows how many nodes are folded away and opens or closes them. Clicking the card itself opens its details, just like any other card."
fr:
  title: "Une vraie poignée pour déplier un flow"
  summary: "Les cartes de flow de la carte Journey ont maintenant une petite poignée en dessous : elle indique combien de nœuds sont repliés et les ouvre ou les referme. Cliquer sur la carte elle-même ouvre ses détails, comme n'importe quelle autre carte."
suggested:
  molecule: arkaik
  type: improvement
  tags: [journey]
```

---

## Part 4 — the camera follows the click

Branch `journey-layout-4-camera`, stacked on part 3.

### Task 13: `CameraFocus` inside the canvas

**Files:**
- Create: `components/graph/CameraFocus.tsx`
- Modify: `components/graph/Canvas.tsx` (`focus` prop; drop `setCenter` from `handleNodeClick`)

- [ ] **Step 1: Create `components/graph/CameraFocus.tsx`:**

```tsx
"use client";

import { useEffect, useRef } from "react";
import { useReactFlow, useStore } from "@xyflow/react";

export interface CanvasFocus {
  nodeId: string;
  /** Changes once per click; each version centres once. */
  version: number;
}

/**
 * Centres the clicked card in the canvas at the current zoom — once the canvas
 * has its final size. Opening a panel narrows the canvas synchronously after
 * the click; React Flow observes that resize and updates its store, so the
 * centring waits 120ms after the last width/height change and then runs one
 * animation. Rendered inside `<ReactFlow>` because the store hooks need it.
 */
export function CameraFocus({ focus }: { focus: CanvasFocus | null }) {
  const reactFlow = useReactFlow();
  const width = useStore((state) => state.width);
  const height = useStore((state) => state.height);
  const handled = useRef(0);

  useEffect(() => {
    if (!focus || focus.version === handled.current) return;
    const timer = setTimeout(() => {
      handled.current = focus.version;
      const node = reactFlow.getInternalNode(focus.nodeId);
      if (!node) return;
      const { x, y } = node.internals.positionAbsolute;
      const w = node.measured.width ?? 0;
      const h = node.measured.height ?? 0;
      void reactFlow.setCenter(x + w / 2, y + h / 2, { zoom: reactFlow.getZoom(), duration: 300 });
    }, 120);
    return () => clearTimeout(timer);
  }, [focus, height, reactFlow, width]);

  return null;
}
```

- [ ] **Step 2: `Canvas` takes `focus`.** Import `CameraFocus, type CanvasFocus` and re-export the type. In `CanvasProps`:
```ts
  /** The card a click selected: centred in the canvas once it has its final size. */
  focus?: CanvasFocus | null;
```
Render `<CameraFocus focus={focus ?? null} />` as the first child of `<ReactFlow>`. Replace `handleNodeClick` with:
```ts
  const handleNodeClick = useCallback<NodeMouseHandler>((event, node) => {
    onNodeClick?.(event, node);
  }, [onNodeClick]);
```
(then inline it: pass `onNodeClick={onNodeClick}` and delete the callback).

- [ ] **Step 3: Thread it through `JourneyCanvas` and `SystemCanvas`:** both gain `focus?: CanvasFocus | null` in their props and pass it to `<Canvas focus={focus} …>`.

### Task 14: Maps set the focus and stop re-fitting

**Files:**
- Modify: `components/maps/JourneyMap.tsx` (`handleNodeClick`, `fitSignal`/`reframe`, `onLayoutChange`)
- Modify: `components/maps/SystemMap.tsx:171, 178-184, 325`

- [ ] **Step 1: JourneyMap.** Add `const [focus, setFocus] = useState<CanvasFocus | null>(null);` (import the type from `@/components/graph/Canvas`). `handleNodeClick`:
```ts
  const handleNodeClick = useCallback<NodeMouseHandler>((_event, xyNode) => {
    const dataNodeId = getBaseNodeId(xyNode.id);
    const dataNode = dataNodes.find((n) => n.id === dataNodeId);
    if (!dataNode) return;
    openNode({ nodeId: dataNode.id });
    setFocus((prev) => ({ nodeId: xyNode.id, version: (prev?.version ?? 0) + 1 }));
  }, [dataNodes, openNode]);
```
Delete `fitSignal`, `setFitSignal`, `reframe`; remove `onLayoutChange={reframe}` from `<PageShell>` and `fitSignal={fitSignal}` from `<JourneyCanvas>`; pass `focus={focus}`.

- [ ] **Step 2: SystemMap.** Same `focus` state and `setFocus` in its `handleNodeClick` (visual id = data id there); delete `reframe` and the `onLayoutChange={reframe}` prop; keep `fitSignal` + `handleLayoutVersion` (the layout-mode switch still re-fits a *new* graph); pass `focus={focus}` to `<SystemCanvas>`.

- [ ] **Step 3: Gate**

`npx tsc --noEmit && npm run lint && npm run test:journey-graph && npm run test:product-scope && npm run test:spotlight`

- [ ] **Step 4: Visual check (Playwright).** On `/project/pebbles/maps/journey`: read the viewport transform, click a view card body, sample the transform at 0/100/250/400/600/1000ms: the `scale()` value never changes (within 0.001), the transform stops changing by 600ms, and the clicked card's screen centre at 1000ms is within 2px of the canvas's centre (canvas box from `.react-flow`'s bounding rect, which is now narrower). Then press Escape to close the panel: the transform does not change. Repeat once on `/project/pebbles/maps/system`.

- [ ] **Step 5: Commit and PR 4.** Lab Note:

```yaml
en:
  title: "The map stays where you are when you open a card"
  summary: "Opening a card's details now slides that card to the centre of the map next to the panel, at the zoom you were at. No more zooming out to show everything every time a panel opens or closes."
fr:
  title: "La carte reste où tu es quand tu ouvres une fiche"
  summary: "Ouvrir les détails d'une carte la fait maintenant glisser au centre de la carte, à côté du panneau, au zoom où tu étais. Fini le dézoom général à chaque ouverture ou fermeture de panneau."
suggested:
  molecule: arkaik
  type: improvement
  tags: [journey, system-map]
```

---

## Plan self-review

- **Spec coverage:** structure from the builder (T3), `layoutJourney` with `DOWN`/`RIGHT` (T4), card sizes + measured override (T2, T7, T8), sync layout and derived auto-expansion (T8, T9), multiple expansion (T9), keep-in-place + reveal (T10), fold handle + click grammar (T12), camera (T13, T14), visual ids (T1), tests (T1, T3, T4, T12), maps.md (T11), stack + Lab Notes (T6, T11, T12, T14). `RIGHT` stays unexposed, as the spec says.
- **Types:** `JourneyBlock`, `Size`, `Point`, `Rect`, `JourneyDirection` live in `journey-layout.ts` (T2) and are what T3, T8, T10 import. `CanvasPin` is exported from `Canvas.tsx` (T10) and imported by `JourneyCanvas` (T8). `CanvasFocus` is exported from `CameraFocus.tsx` and re-exported from `Canvas.tsx` (T13). `onToggleFlow(flowId, visualNodeId)` is changed in T9 and consumed by `toggleFlow` there; the handle in T12 calls `onToggle()` with no arguments, which the builder's closure supplies.
- **Known intermediate red:** T8 imports `CanvasPin` before T10 defines it — commit T8–T10 together.
