# Acceptance & Value Model — Surfaces Part 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the Acceptance & Value surfaces — make view/flow/product rollups acceptance-aware (the rollup seam), ship the value Pyramid page, add `acceptance` to the Delivery board, and add Parity + Pyramid cards to the Overview.

**Architecture:** A single seam — `getEffectivePlatformStatuses(node, nodes, edges)` in `lib/utils/platform-status.ts` — computes a view's per-platform status from the acceptances covering it (weakest-link per platform), falling back to the view's stored `metadata.platformStatuses` when nothing covers it (spec §3.4 computed-with-fallback). Existing call sites opt in one at a time by threading `edges` through; each keeps its current shape (dots or gauge). A parallel pure util `computePyramidAggregation` powers the Pyramid page and Overview mini-card. Everything stays pure/deterministic and node-harness testable; UI is verified in the running app against the seeded Pebbles acceptances.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Tailwind v4, shadcn/ui, lucide-react 0.577; `@arkaik/schema` workspace package (already exports the parity/coverage projections from Foundation); plain-Node test harness under `tests/app/` with `load-*.js` transpile companions.

---

## Architecture notes (read before Task 1)

**The seam and its two shapes.** A view's per-platform status is rendered two ways today, and both must keep working:
- **Dots** (one status per platform) — `PlatformList`, used by the library view card and the journey `ViewNode`. Fed by a `PlatformStatusMap`.
- **Gauge** (a distribution) — `PlatformGaugeList`, used by flow cards and the Overview "Platform delivery" card. Fed by a `PlatformStatusRollup`.

So the seam has two entry points, both in `lib/utils/platform-status.ts`:
- `getEffectivePlatformStatuses(node, nodes, edges): PlatformStatusMap` — for a **view**: the covering acceptances' resolved statuses collapsed to the **weakest** (least-advanced by `STATUS_ORDER`) status per platform; else stored fallback. Non-views return their stored statuses unchanged.
- `addEffectiveNodeToRollup(rollup, node, nodes, edges, preset?)` and `computeFlowPlatformRollup(flowNode, nodesById, nodes, edges)` — the rollup/gauge path, built on the same covering-acceptance logic.

**Weakest-link reduction.** A view is only as shipped on a platform as its laggiest covering acceptance, so the single-dot summary uses the minimum `STATUS_ORDER`. Example — `V-pebble-detail` (seed) covered by `AC-pebble-draw-in-animation` (android `development`) and `AC-emotion-palette-on-read` (android `live`) → android effective = `development`. Its full seed effective map is `{web: "backlog", ios: "live", android: "development"}` (stored was `{web: "idea", ios: "live", android: "idea"}`).

**Why `computeProductRollup` stays views-based (not "all acceptances").** Spec §3.4 says "Product (computed): all acceptances drives Overview gauges," and §9.3 adds an Overview Pyramid mini-card. We realize these together: the existing **Platform delivery** card keeps summarizing the 58 views but now with *effective* (acceptance-aware) statuses for covered views — this is the seam site the program brief names (`computeProductRollup`) — while the new **Pyramid mini-card** is the acceptance/value product gauge (§3.4's "all acceptances," sliced by value). This keeps the delivery gauge meaningful while acceptance coverage is still sparse (3 seeded), and it converges on acceptance-truth as retro-population fills coverage in.

**Delivery stays stored; `acceptance` is its own species.** The Delivery board's atomic unit becomes the acceptance (spec §9.3), added as a toggle species. View/api/data-model cards keep their stored per-platform status — making covered-view delivery cards *also* acceptance-derived would double-count the same promise when both toggles are on. So the delivery change is additive (a new toggle option), not a seam opt-in.

**Golden impact summary** (only two suites move numbers):
- `test:coverage` — seed `computeProductRollup` gains android `development` +1 from `V-pebble-detail` (totals android 17→18; counts android `{development:13, live:5}`). Nothing else changes (V-pebble-detail is the only covered view; web/ios unaffected because `idea`→`backlog` and `live`→`live` are both no-ops for the counted preset).
- `test:effective-status` (new) — pins the seam directly.
- `test:pyramid` (new) — pins the value aggregation.
- `test:journey-graph` — **unchanged**: it asserts structure (21 pairs / 8 flows / node+edge counts), not rollup values. The seam changes `data.status`/`data.platformStatuses`/`data.platformRollup` values only, so it stays green. Verify, don't edit.
- `test:delivery` — existing assertions unchanged; one new assertion for the `acceptance` species.

The counted preset (`"delivery"`) is `["prioritized","development","releasing","live","blocked"]`; `idea`/`backlog`/`archived` never count. `STATUS_ORDER`: idea 0, backlog 1, prioritized 2, development 3, releasing 4, live 5, archived 6, blocked 7.

---

## File Structure

**Created:**
- `lib/utils/pyramid.ts` — `computePyramidAggregation` + types (value-element → status distribution, grouped by tier).
- `app/project/[id]/pyramid/page.tsx` — the Pyramid route (element gauge grid, layout B).
- `components/overview/ParityCard.tsx` — Overview parity-gap card.
- `components/overview/PyramidCard.tsx` — Overview pyramid mini-card (four tier gauges).
- `tests/app/effective-status.test.js` + `tests/app/load-effective-status.js` — seam unit test.
- `tests/app/pyramid.test.js` + `tests/app/load-pyramid.js` — pyramid aggregation unit test.

**Modified:**
- `lib/utils/platform-status.ts` — seam functions (`coveringAcceptances`, `getEffectivePlatformStatuses`, `addEffectiveNodeToRollup`, `computeFlowPlatformRollup`; `computePlaylistRollup` gains optional `nodes`/`edges`).
- `lib/utils/coverage.ts` — `computeProductRollup(nodes, edges, presetId?)` becomes effective.
- `lib/utils/journey-graph.ts` — view nodes + flow rollup opt into the seam.
- `app/project/[id]/overview/page.tsx` — thread edges into `computeProductRollup`; render the two new cards.
- `app/project/[id]/library/page.tsx` — effective view-card dots + effective flow rollup.
- `components/delivery/DeliveryFilterBar.tsx` — `acceptance` toggle option.
- `app/project/[id]/layout.tsx` — `pyramid` branch in the `currentView` ladder.
- `components/layout/ProjectSidebar.tsx` — Pyramid entry in the Project group.
- `tests/app/coverage.test.js` — updated `computeProductRollup` call sites + seed golden.
- `tests/app/delivery.test.js` — acceptance-species assertion.
- `docs/graph-model.md` — note the `/pyramid` route.
- `package.json` — `test:effective-status`, `test:pyramid` scripts.

---

## Task 1: Rollup seam primitives

**Files:**
- Modify: `lib/utils/platform-status.ts`
- Create: `tests/app/load-effective-status.js`
- Create: `tests/app/effective-status.test.js`
- Modify: `package.json`

- [ ] **Step 1: Write the failing test harness companion**

Create `tests/app/load-effective-status.js` (copy of `load-coverage.js`'s structure, trimmed to the platform-status graph):

```js
/**
 * Loads lib/utils/platform-status.ts (the rollup seam) into Node without a
 * bundler — same transpile approach as load-coverage.js. platform-status.ts is
 * self-contained over @/lib/config/* + @/lib/data/types (type-only), so no
 * @arkaik/schema runtime dependency is needed here.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, ".test-build-effective-status");

const MODULES = [
  ["lib/config/platforms.ts", "config-platforms"],
  ["lib/config/statuses.ts", "config-statuses"],
  ["lib/utils/platform-status.ts", "platform-status"],
];

const SPECIFIER_MAP = {
  "@/lib/config/platforms": "./config-platforms",
  "@/lib/config/statuses": "./config-statuses",
  "@/lib/data/types": "./types", // type-only in this graph
};

function loadEffectiveStatus() {
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));

  for (const [srcRel, outName] of MODULES) {
    const source = fs.readFileSync(path.join(ROOT, srcRel), "utf8");
    const { outputText } = ts.transpileModule(source, {
      fileName: path.basename(srcRel),
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
      },
    });

    let rewritten = outputText;
    for (const [specifier, target] of Object.entries(SPECIFIER_MAP)) {
      rewritten = rewritten.split(`require("${specifier}")`).join(`require("${target}")`);
    }
    fs.writeFileSync(path.join(BUILD_DIR, `${outName}.js`), rewritten);
  }

  for (const [, outName] of MODULES) {
    delete require.cache[path.join(BUILD_DIR, `${outName}.js`)];
  }
  return require(path.join(BUILD_DIR, "platform-status.js"));
}

module.exports = { loadEffectiveStatus, BUILD_DIR };
```

- [ ] **Step 2: Write the failing test**

Create `tests/app/effective-status.test.js`:

```js
#!/usr/bin/env node

/**
 * Rollup seam (lib/utils/platform-status.ts) — a view's effective per-platform
 * status from covering acceptances, with stored fallback; the flow rollup
 * extended by directly-covering acceptances (spec §3.4).
 */

const fs = require("fs");
const path = require("path");
const { loadEffectiveStatus, BUILD_DIR } = require("./load-effective-status");

const {
  getEffectivePlatformStatuses,
  getNodePlatformStatuses,
  computePlaylistRollup,
  computeFlowPlatformRollup,
} = loadEffectiveStatus();

let failures = 0;
function assert(cond, message) {
  if (cond) console.log(`PASS: ${message}`);
  else {
    failures++;
    console.log(`FAIL: ${message}`);
  }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// =========================== Hand fixtures ===================================

const view = { id: "V-x", species: "view", status: "idea", platforms: ["web", "ios", "android"], metadata: { platformStatuses: { ios: "live" } } };
const accA = { id: "AC-a", species: "acceptance", status: "backlog", platforms: ["web", "ios", "android"], metadata: { platformStatuses: { ios: "live", android: "development" } } };
const accB = { id: "AC-b", species: "acceptance", status: "backlog", platforms: ["web", "ios", "android"], metadata: { platformStatuses: { ios: "live", android: "live" } } };
const coverA = { id: "e-a", edge_type: "covers", source_id: "AC-a", target_id: "V-x" };
const coverB = { id: "e-b", edge_type: "covers", source_id: "AC-b", target_id: "V-x" };

// Uncovered view → stored fallback (identical to getNodePlatformStatuses).
assert(
  eq(getEffectivePlatformStatuses(view, [view], []), getNodePlatformStatuses(view)),
  "uncovered view falls back to its stored platform statuses",
);

// Covered view → weakest-link per platform.
assert(
  eq(getEffectivePlatformStatuses(view, [view, accA, accB], [coverA, coverB]), { web: "backlog", ios: "live", android: "development" }),
  "covered view collapses covering acceptances to the weakest status per platform",
);

// A view platform no covering acceptance speaks to is omitted (honest empty).
const narrowAcc = { id: "AC-n", species: "acceptance", status: "live", platforms: ["web"], metadata: {} };
const coverN = { id: "e-n", edge_type: "covers", source_id: "AC-n", target_id: "V-x" };
assert(
  eq(getEffectivePlatformStatuses(view, [view, narrowAcc], [coverN]), { web: "live" }),
  "platforms no covering acceptance applies to are omitted from the effective map",
);

// Non-view species keep their stored statuses regardless of edges.
assert(
  eq(getEffectivePlatformStatuses(accA, [accA], []), getNodePlatformStatuses(accA)),
  "non-view species return stored statuses (acceptances resolve their own overrides)",
);

// Flow rollup: playlist views (effective) + acceptances covering the flow directly.
const flow = { id: "F-x", species: "flow", status: "development", platforms: ["web"], metadata: { playlist: { entries: [{ type: "view", view_id: "V-x" }] } } };
const flowAcc = { id: "AC-f", species: "acceptance", status: "development", platforms: ["web"], metadata: { platformStatuses: { web: "live" } } };
const coverFlow = { id: "e-f", edge_type: "covers", source_id: "AC-f", target_id: "F-x" };
const flowNodes = [view, accA, accB, flow, flowAcc];
const flowEdges = [coverA, coverB, coverFlow];
const flowNodesById = new Map(flowNodes.map((n) => [n.id, n]));
const flowRollup = computeFlowPlatformRollup(flow, flowNodesById, flowNodes, flowEdges);
assert(
  (flowRollup.counts.web?.live ?? 0) === 1,
  "flow rollup includes web:live from the acceptance covering the flow directly",
);
assert(
  (flowRollup.counts.android?.development ?? 0) === 1,
  "flow rollup counts the effective (weakest) status of a covered descendant view",
);

// =========================== Seed goldens ====================================

const ROOT = path.join(__dirname, "..", "..");
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "seed", "pebbles.json"), "utf8"));
const nodesById = new Map(bundle.nodes.map((node) => [node.id, node]));
const byId = (id) => bundle.nodes.find((n) => n.id === id);

assert(
  eq(getEffectivePlatformStatuses(byId("V-pebble-detail"), bundle.nodes, bundle.edges), { web: "backlog", ios: "live", android: "development" }),
  "seed: V-pebble-detail effective statuses derive from its two covering acceptances",
);
assert(
  eq(getEffectivePlatformStatuses(byId("V-glyphs-list"), bundle.nodes, bundle.edges), getNodePlatformStatuses(byId("V-glyphs-list"))),
  "seed: an uncovered view keeps its stored statuses",
);

// F-swap-glyph gains web:live from AC-buy-community-glyph vs the stored playlist rollup.
const swapEntries = byId("F-swap-glyph").metadata.playlist.entries;
const swapBase = computePlaylistRollup(swapEntries, nodesById);
const swapEff = computeFlowPlatformRollup(byId("F-swap-glyph"), nodesById, bundle.nodes, bundle.edges);
assert(
  (swapEff.counts.web?.live ?? 0) === (swapBase.counts.web?.live ?? 0) + 1,
  "seed: F-swap-glyph flow rollup gains one web:live from AC-buy-community-glyph",
);

fs.rmSync(BUILD_DIR, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll effective-status tests passed");
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node tests/app/effective-status.test.js`
Expected: FAIL — `getEffectivePlatformStatuses`/`computeFlowPlatformRollup` are `undefined` (not yet exported).

- [ ] **Step 4: Implement the seam in `lib/utils/platform-status.ts`**

Add `Edge` to the types import at the top:

```ts
import type { Edge, Node, PlaylistEntry, PlatformStatusMap } from "@/lib/data/types";
```

Add these functions after `getEditablePlatformStatuses` (around line 53):

```ts
/** Acceptance nodes whose `covers` edge targets `anchorId` (incoming covers). */
function coveringAcceptances(
  anchorId: string,
  nodes: readonly Node[],
  edges: readonly Edge[],
): Node[] {
  const coveringIds = new Set(
    edges
      .filter((edge) => edge.edge_type === "covers" && edge.target_id === anchorId)
      .map((edge) => edge.source_id),
  );
  return nodes.filter((node) => node.species === "acceptance" && coveringIds.has(node.id));
}

/** The less-advanced of two statuses, by lifecycle order (STATUS_ORDER). */
function weakerStatus(left: StatusId, right: StatusId): StatusId {
  return STATUS_ORDER[left] <= STATUS_ORDER[right] ? left : right;
}

/**
 * A view's **effective** per-platform statuses (spec §3.4): when acceptances
 * cover the view, each platform's status is the *weakest* (least-advanced)
 * resolved status among the covering acceptances applicable to it — a view is
 * only as shipped on a platform as its laggiest promise. A view no acceptance
 * covers falls back to its stored `platformStatuses`. Non-view species always
 * use their stored statuses (acceptances resolve their own overrides).
 *
 * A view platform that no covering acceptance speaks to is omitted — an honest
 * empty rather than an invented status.
 */
export function getEffectivePlatformStatuses(
  node: Pick<Node, "id" | "species" | "status" | "platforms" | "metadata">,
  nodes: readonly Node[],
  edges: readonly Edge[],
): PlatformStatusMap {
  if (node.species !== "view") {
    return getNodePlatformStatuses(node);
  }

  const covering = coveringAcceptances(node.id, nodes, edges);
  if (covering.length === 0) {
    return getNodePlatformStatuses(node);
  }

  const byPlatform: Partial<Record<PlatformId, StatusId>> = {};
  for (const acceptance of covering) {
    const resolved = getNodePlatformStatuses(acceptance);
    for (const platformId of Object.keys(resolved) as PlatformId[]) {
      const status = resolved[platformId];
      if (!status) continue;
      const current = byPlatform[platformId];
      byPlatform[platformId] = current ? weakerStatus(current, status) : status;
    }
  }

  const effective: PlatformStatusMap = {};
  for (const platformId of node.platforms) {
    const status = byPlatform[platformId];
    if (status) effective[platformId] = status;
  }
  return effective;
}

/**
 * Add a node's **effective** per-platform statuses to a rollup — the seam-aware
 * twin of `addNodeToRollup`. For views this reflects covering acceptances; for
 * every other species it matches `addNodeToRollup` (stored statuses).
 */
export function addEffectiveNodeToRollup(
  rollup: PlatformStatusRollup,
  node: Pick<Node, "id" | "species" | "status" | "platforms" | "metadata">,
  nodes: readonly Node[],
  edges: readonly Edge[],
  presetId: CountedStatusPresetId = DEFAULT_COUNTED_STATUS_PRESET_ID,
): PlatformStatusRollup {
  const statuses = getEffectivePlatformStatuses(node, nodes, edges);

  return Object.entries(statuses).reduce((currentRollup, [platformId, status]) => {
    if (!status) {
      return currentRollup;
    }
    return addPlatformStatusToRollup(currentRollup, platformId as PlatformId, status, presetId);
  }, rollup);
}
```

Now make `computePlaylistRollup` acceptance-aware. Widen the `nodesById` value type to include `"id"`, thread `nodes`/`edges` (default `[]` — an empty pair reproduces today's stored behavior since no acceptance can be found), and switch the view branch to `addEffectiveNodeToRollup`. Replace the existing `computePlaylistRollupRecursive` + `computePlaylistRollup` (lines 164–218) with:

```ts
function computePlaylistRollupRecursive(
  entries: PlaylistEntry[],
  nodesById: ReadonlyMap<string, Pick<Node, "id" | "species" | "status" | "platforms" | "metadata">>,
  visited: Set<string>,
  nodes: readonly Node[],
  edges: readonly Edge[],
): PlatformStatusRollup {
  let rollup = createEmptyRollup();

  for (const entry of entries) {
    if (entry.type === "view") {
      const viewNode = nodesById.get(entry.view_id);
      if (viewNode) {
        rollup = addEffectiveNodeToRollup(rollup, viewNode, nodes, edges);
      }
      continue;
    }

    if (entry.type === "flow") {
      if (!visited.has(entry.flow_id)) {
        visited.add(entry.flow_id);
        const flowNode = nodesById.get(entry.flow_id);
        const subEntries = flowNode?.metadata?.playlist?.entries;
        if (Array.isArray(subEntries)) {
          rollup = mergeRollups(rollup, computePlaylistRollupRecursive(subEntries, nodesById, visited, nodes, edges));
        }
        visited.delete(entry.flow_id);
      }
      continue;
    }

    if (entry.type === "condition") {
      rollup = mergeRollups(
        rollup,
        computePlaylistRollupRecursive(entry.if_true, nodesById, visited, nodes, edges),
        computePlaylistRollupRecursive(entry.if_false, nodesById, visited, nodes, edges),
      );
      continue;
    }

    if (entry.type === "junction") {
      rollup = mergeRollups(
        rollup,
        ...entry.cases.map((c) => computePlaylistRollupRecursive(c.entries, nodesById, visited, nodes, edges)),
      );
    }
  }

  return rollup;
}

export function computePlaylistRollup(
  entries: PlaylistEntry[],
  nodesById: ReadonlyMap<string, Pick<Node, "id" | "species" | "status" | "platforms" | "metadata">>,
  nodes: readonly Node[] = [],
  edges: readonly Edge[] = [],
): PlatformStatusRollup {
  return computePlaylistRollupRecursive(entries, nodesById, new Set(), nodes, edges);
}

/**
 * A flow's effective platform rollup (spec §3.4, flow extended): its playlist's
 * (effective) view rollup **plus** the resolved statuses of acceptances covering
 * the flow directly. Directly-covering acceptances are distinct from the ones
 * covering descendant views, so this is purely additive — no double counting.
 */
export function computeFlowPlatformRollup(
  flowNode: Pick<Node, "id" | "metadata">,
  nodesById: ReadonlyMap<string, Pick<Node, "id" | "species" | "status" | "platforms" | "metadata">>,
  nodes: readonly Node[],
  edges: readonly Edge[],
): PlatformStatusRollup {
  const entries = Array.isArray(flowNode.metadata?.playlist?.entries) ? flowNode.metadata.playlist.entries : [];
  let rollup = computePlaylistRollup(entries, nodesById, nodes, edges);

  for (const acceptance of coveringAcceptances(flowNode.id, nodes, edges)) {
    const resolved = getNodePlatformStatuses(acceptance);
    for (const platformId of Object.keys(resolved) as PlatformId[]) {
      const status = resolved[platformId];
      if (status) {
        rollup = addPlatformStatusToRollup(rollup, platformId, status);
      }
    }
  }

  return rollup;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node tests/app/effective-status.test.js`
Expected: PASS — all assertions, ending "All effective-status tests passed".

- [ ] **Step 6: Wire the npm script**

In `package.json`, add after the `test:coverage` line:

```json
    "test:effective-status": "node tests/app/effective-status.test.js",
```

- [ ] **Step 7: Confirm the rest of the suite still compiles/passes**

Run: `npm run test:coverage && npm run test:journey-graph && npm run test:delivery`
Expected: PASS (these callers still pass `computePlaylistRollup(entries, nodesById)` with no `nodes`/`edges`, so behavior is unchanged this task).

- [ ] **Step 8: Commit**

```bash
git add lib/utils/platform-status.ts tests/app/effective-status.test.js tests/app/load-effective-status.js package.json
git commit -m "feat(rollup): add effective platform-status seam from covering acceptances"
```

---

## Task 2: Overview product rollup opts into the seam

**Files:**
- Modify: `lib/utils/coverage.ts:73-83`
- Modify: `app/project/[id]/overview/page.tsx:55`
- Modify: `tests/app/coverage.test.js:64,198-207`

- [ ] **Step 1: Update the seed golden test first (expect it to fail)**

In `tests/app/coverage.test.js`, update the hand fixture call (line 64) to pass an edges array (no `covers` edges → unchanged behavior):

```js
const rollup = computeProductRollup([
```
becomes
```js
const rollup = computeProductRollup(
  [
```
…and close it with the new `edges` argument. Concretely, replace the fixture block (lines 64–79) with:

```js
const rollup = computeProductRollup(
  [
    {
      species: "view",
      status: "development",
      platforms: ["web", "ios"],
      metadata: { platformStatuses: { ios: "live" } },
    },
    { species: "api-endpoint", status: "live", platforms: ["web"] }, // not a view — ignored
    { species: "view", status: "idea", platforms: ["web"] }, // idea is uncounted
    { species: "flow", status: "development", platforms: ["web"] }, // rollup, not deliverable
  ],
  [], // no covers edges → views fall back to stored statuses
);
assert(eq(rollup.totals, { web: 1, ios: 1 }), `rollup counts views only (totals ${JSON.stringify(rollup.totals)})`);
assert(
  eq(rollup.counts, { web: { development: 1 }, ios: { live: 1 } }),
  "platformStatuses override wins per platform; uncounted statuses excluded",
);
```

Then update the seed golden (lines 198–207) to thread edges and pin the effective numbers:

```js
const seedRollup = computeProductRollup(bundle.nodes, bundle.edges);
assert(eq(seedRollup.totals, { web: 30, ios: 31, android: 18 }), `seed rollup totals web 30 / ios 31 / android 18 (got ${JSON.stringify(seedRollup.totals)})`);
assert(
  eq(seedRollup.counts, {
    web: { development: 25, live: 5 },
    ios: { development: 25, live: 6 },
    android: { development: 13, live: 5 },
  }),
  "seed rollup counts: V-pebble-detail now contributes android:development from its covering acceptances",
);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tests/app/coverage.test.js`
Expected: FAIL — `computeProductRollup` still ignores `edges` (a second positional arg is now `presetId`), so android is still 17.

- [ ] **Step 3: Make `computeProductRollup` effective**

In `lib/utils/coverage.ts`, update the import from `platform-status` (line 6) to add `addEffectiveNodeToRollup`:

```ts
import { addEffectiveNodeToRollup, createEmptyRollup, type PlatformStatusRollup } from "@/lib/utils/platform-status";
```

Add `Edge` to the types import (line 3):

```ts
import type { Edge, JournalEvent, Node, ReleaseTaggedEvent } from "@/lib/data/types";
```

Replace `computeProductRollup` (lines 73–83) with the effective, edge-threaded version:

```ts
export function computeProductRollup(
  nodes: readonly Node[],
  edges: readonly Edge[],
  presetId?: CountedStatusPresetId,
): PlatformStatusRollup {
  return nodes
    .filter((node) => node.species === "view")
    .reduce(
      (rollup, node) =>
        presetId === undefined
          ? addEffectiveNodeToRollup(rollup, node, nodes, edges)
          : addEffectiveNodeToRollup(rollup, node, nodes, edges, presetId),
      createEmptyRollup(),
    );
}
```

Update the doc comment above it to say the covered views now contribute their acceptance-derived statuses (drop the "Part 2's rollup seam will extend this" sentence — it's done). The `Pick<...>` param type widens to `readonly Node[]` because `addEffectiveNodeToRollup` needs the full node set and edges anyway.

- [ ] **Step 4: Thread edges at the Overview call site**

In `app/project/[id]/overview/page.tsx`, update line 55:

```ts
  const rollup = useMemo(() => computeProductRollup(dataNodes, dataEdges), [dataNodes, dataEdges]);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node tests/app/coverage.test.js`
Expected: PASS — seed rollup android now 18.

- [ ] **Step 6: Typecheck the app**

Run: `npx tsc --noEmit` (the repo has no standalone `typecheck` script; `tsconfig.json` is present, and `npm run build` also typechecks if you prefer the full pass).
Expected: no errors (the only other `computeProductRollup` caller is the Overview page, now updated).

- [ ] **Step 7: Commit**

```bash
git add lib/utils/coverage.ts app/project/[id]/overview/page.tsx tests/app/coverage.test.js
git commit -m "feat(overview): product delivery gauge reflects covering acceptances"
```

---

## Task 3: Journey graph opts into the seam

**Files:**
- Modify: `lib/utils/journey-graph.ts:201-209,232,244`

- [ ] **Step 1: Update the imports**

In `lib/utils/journey-graph.ts`, find the import from `@/lib/utils/platform-status` and add `addEffectiveNodeToRollup`, `getEffectivePlatformStatuses`, and `computeFlowPlatformRollup`; you can drop `getEditablePlatformStatuses` and `computePlaylistRollup` from the import if they become unused after this task (verify with the typecheck in Step 4). The import should include at least:

```ts
import {
  addEffectiveNodeToRollup,
  computeFlowPlatformRollup,
  createEmptyRollup,
  getEffectivePlatformStatuses,
  getRollupDisplayStatus,
  type PlatformStatusRollup,
} from "@/lib/utils/platform-status";
```

- [ ] **Step 2: Make the flow rollup acceptance-aware**

Replace the `computeFlowRollup` closure (lines 201–209) with:

```ts
  const computeFlowRollup = (flowNodeId: string): PlatformStatusRollup => {
    const cached = flowRollupCache.get(flowNodeId);
    if (cached) return cached;

    const flowNode = nodesById.get(flowNodeId);
    const rollup = flowNode
      ? computeFlowPlatformRollup(flowNode, nodesById, dataNodes, dataEdges)
      : createEmptyRollup();
    flowRollupCache.set(flowNodeId, rollup);
    return rollup;
  };
```

- [ ] **Step 3: Make the view node status/dots effective**

In the `node.species === "view"` block, replace line 232:

```ts
      const viewRollup = addNodeToRollup(createEmptyRollup(), node);
```
with
```ts
      const viewRollup = addEffectiveNodeToRollup(createEmptyRollup(), node, dataNodes, dataEdges);
```

and replace line 244:

```ts
      baseData.platformStatuses = getEditablePlatformStatuses(node);
```
with
```ts
      baseData.platformStatuses = getEffectivePlatformStatuses(node, dataNodes, dataEdges);
```

(If `addNodeToRollup` is now unused in this file, remove it from the import; the typecheck in Step 4 will flag it.)

- [ ] **Step 4: Verify structure is unchanged and typecheck**

Run: `npm run test:journey-graph && npx tsc --noEmit`
Expected: PASS — the golden pins node/edge structure (21 pairs, 8 flows, counts), not rollup values, so it stays green; typecheck clean.

- [ ] **Step 5: Verify in the running app**

Run the dev server (`npm run dev`), open the Journey map for the Pebbles project, expand `F-record-pebble`.
Expected: `V-pebble-detail` shows web=backlog / ios=live / android=development (its covering acceptances), not the stored idea/live/idea; `F-swap-glyph` and `F-record-pebble` flow gauges include the acceptance contributions. No crashes.

- [ ] **Step 6: Commit**

```bash
git add lib/utils/journey-graph.ts
git commit -m "feat(journey): view/flow rollups reflect covering acceptances"
```

---

## Task 4: Library view-card dots + flow rollup opt into the seam

**Files:**
- Modify: `app/project/[id]/library/page.tsx:25-29,184-196,302-303`

- [ ] **Step 1: Update the platform-status import**

In `app/project/[id]/library/page.tsx`, replace the import block (lines 25–29):

```ts
import {
  computeFlowPlatformRollup,
  createEmptyRollup,
  getEffectivePlatformStatuses,
} from "@/lib/utils/platform-status";
```

- [ ] **Step 2: Make the flow rollup effective**

Replace the `flowRollupByNodeId` memo body (lines 184–196) so each flow uses `computeFlowPlatformRollup` (threading `dataNodes`/`dataEdges`):

```ts
  const flowRollupByNodeId = useMemo(
    () => Object.fromEntries(
      dataNodes
        .filter((node) => node.species === "flow")
        .map((flowNode) => [flowNode.id, computeFlowPlatformRollup(flowNode, nodesById, dataNodes, dataEdges)]),
    ) as Record<string, ReturnType<typeof createEmptyRollup>>,
    [dataNodes, dataEdges, nodesById],
  );
```

- [ ] **Step 3: Make the view-card dots effective**

Update the `NodeCard` `viewPlatformStatuses` prop (line 302):

```ts
                    viewPlatformStatuses={node.species === "view" ? getEffectivePlatformStatuses(node, dataNodes, dataEdges) : undefined}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean. (`getNodePlatformStatuses` may now be unused here — remove it from the import if so.)

- [ ] **Step 5: Verify in the running app**

Open the Library, filter to Views. `V-pebble-detail`'s card dots show web=backlog / ios=live / android=development. Filter to Flows: `F-swap-glyph`'s gauge includes the web:live from its covering acceptance. Uncovered views/flows look exactly as before.

- [ ] **Step 6: Commit**

```bash
git add app/project/[id]/library/page.tsx
git commit -m "feat(library): view cards and flow gauges reflect covering acceptances"
```

---

## Task 5: Delivery board admits the `acceptance` species

**Files:**
- Modify: `components/delivery/DeliveryFilterBar.tsx:22-28`
- Modify: `tests/app/delivery.test.js`

- [ ] **Step 1: Add the acceptance-species assertion (expect the toggle change, not a util change)**

The delivery util is already species-generic (`computeDeliveryItems` uses `getNodePlatformStatuses` for any non-flow species), so this only pins that acceptances expand correctly. In `tests/app/delivery.test.js`, add an acceptance node to the `nodes` fixture (after `DM-y`, before the closing `]` at line 69):

```js
  {
    // Acceptances carry their own per-platform statuses — one item per platform.
    id: "AC-z",
    project_id: "p",
    species: "acceptance",
    title: "Z",
    status: "backlog",
    platforms: ["web", "ios"],
    metadata: { platformStatuses: { web: "live" } },
  },
```

Then add this assertion inside the `computeDeliveryItems` block (after the `apiAndDm` assertion, around line 102):

```js
  const acceptances = computeDeliveryItems(nodes, ["acceptance"]).map(key).sort();
  assert(
    JSON.stringify(acceptances) === JSON.stringify(["AC-z:ios=backlog", "AC-z:web=live"]),
    "acceptances expand to one item per platform (override where present, node.status fallback elsewhere)",
  );
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `node tests/app/delivery.test.js`
Expected: PASS (the util already supports acceptances; the new assertion documents it).

- [ ] **Step 3: Add the toggle option**

In `components/delivery/DeliveryFilterBar.tsx`, update the comment + `SPECIES_OPTIONS` (lines 22–28):

```ts
// Flows are not deliverables (their status is a rollup of their views), so the
// board offers the item-bearing species. Views are the default lens;
// acceptances are the atomic parity unit (spec §9.3).
const SPECIES_OPTIONS: { id: SpeciesId; label: string }[] = [
  { id: "view", label: "Views" },
  { id: "acceptance", label: "Acceptances" },
  { id: "api-endpoint", label: "API Endpoints" },
  { id: "data-model", label: "Data Models" },
];
```

- [ ] **Step 4: Verify in the running app**

Open the Delivery board. Toggle **Acceptances** on. The three seeded acceptances appear as (acceptance × platform) cards in their status columns (e.g. `AC-buy-community-glyph` on web lands in **Live**; its iOS `backlog` is hidden under the counted preset but appears under "All statuses"). The default view (Views only) is unchanged.

- [ ] **Step 5: Commit**

```bash
git add components/delivery/DeliveryFilterBar.tsx tests/app/delivery.test.js
git commit -m "feat(delivery): admit acceptances as a board species"
```

---

## Task 6: Pyramid aggregation util

**Files:**
- Create: `lib/utils/pyramid.ts`
- Create: `tests/app/load-pyramid.js`
- Create: `tests/app/pyramid.test.js`
- Modify: `package.json`

- [ ] **Step 1: Write the failing test harness companion**

Create `tests/app/load-pyramid.js`. `pyramid.ts` imports `@/lib/config/values` (which imports `@arkaik/schema` for `VALUE_IDS`/`VALUE_TIERS`) and `@/lib/utils/platform-status`, so the schema package must be built and the bare specifier rewritten (same as `load-coverage.js`):

```js
const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const { loadSchema, BUILD_DIR: SCHEMA_BUILD_DIR } = require("../schema/load-schema");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, ".test-build-pyramid");

const MODULES = [
  ["lib/config/platforms.ts", "config-platforms"],
  ["lib/config/statuses.ts", "config-statuses"],
  ["lib/config/values.ts", "config-values"],
  ["lib/utils/platform-status.ts", "platform-status"],
  ["lib/utils/pyramid.ts", "pyramid"],
];

const SPECIFIER_MAP = {
  "@/lib/config/platforms": "./config-platforms",
  "@/lib/config/statuses": "./config-statuses",
  "@/lib/config/values": "./config-values",
  "@/lib/data/types": "./types", // type-only in this graph
  "@/lib/utils/platform-status": "./platform-status",
};

function loadPyramid() {
  loadSchema();

  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));

  const schemaIndex = path.join(SCHEMA_BUILD_DIR, "index.js");

  for (const [srcRel, outName] of MODULES) {
    const source = fs.readFileSync(path.join(ROOT, srcRel), "utf8");
    const { outputText } = ts.transpileModule(source, {
      fileName: path.basename(srcRel),
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    });

    let rewritten = outputText;
    for (const [specifier, target] of Object.entries(SPECIFIER_MAP)) {
      rewritten = rewritten.split(`require("${specifier}")`).join(`require("${target}")`);
    }
    rewritten = rewritten.replace(/require\((['"])@arkaik\/schema\1\)/g, `require(${JSON.stringify(schemaIndex)})`);
    fs.writeFileSync(path.join(BUILD_DIR, `${outName}.js`), rewritten);
  }

  for (const [, outName] of MODULES) {
    delete require.cache[path.join(BUILD_DIR, `${outName}.js`)];
  }
  return require(path.join(BUILD_DIR, "pyramid.js"));
}

module.exports = { loadPyramid, BUILD_DIR };
```

- [ ] **Step 2: Write the failing test**

Create `tests/app/pyramid.test.js`:

```js
#!/usr/bin/env node

/**
 * Pyramid aggregation (lib/utils/pyramid.ts) — value element → per-platform
 * status distribution, grouped by tier, over the seeded acceptances.
 */

const fs = require("fs");
const path = require("path");
const { loadPyramid, BUILD_DIR } = require("./load-pyramid");

const { computePyramidAggregation } = loadPyramid();

let failures = 0;
function assert(cond, message) {
  if (cond) console.log(`PASS: ${message}`);
  else {
    failures++;
    console.log(`FAIL: ${message}`);
  }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const ROOT = path.join(__dirname, "..", "..");
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "seed", "pebbles.json"), "utf8"));
const acceptances = bundle.nodes.filter((n) => n.species === "acceptance");

const tiers = computePyramidAggregation(acceptances);
assert(
  eq(tiers.map((t) => t.tier), ["functional", "emotional", "life-changing", "social-impact"]),
  "tiers come back in pyramid order",
);

const elementsById = new Map();
for (const tier of tiers) for (const element of tier.elements) elementsById.set(element.value, element);

assert(elementsById.size === 30, "every one of the 30 value elements is represented");

const designAesthetics = elementsById.get("design-aesthetics");
assert(designAesthetics.tier === "emotional", "design-aesthetics is emotional");
assert(designAesthetics.acceptanceCount === 2, `design-aesthetics counts its two acceptances (got ${designAesthetics.acceptanceCount})`);
assert(
  eq(designAesthetics.rollup.counts, { ios: { live: 2 }, android: { development: 1, live: 1 } }),
  "design-aesthetics distribution: ios live×2, android dev+live (web backlog uncounted)",
);

const funEntertainment = elementsById.get("fun-entertainment");
assert(funEntertainment.acceptanceCount === 1, "fun-entertainment counts one acceptance");

const savesTime = elementsById.get("saves-time");
assert(
  savesTime.acceptanceCount === 0 && eq(savesTime.rollup, { counts: {}, totals: {} }),
  "an unserved value element has zero acceptances and an empty rollup",
);

// Platform filter narrows the distribution but not the count.
const iosTiers = computePyramidAggregation(acceptances, "ios");
const iosDesign = iosTiers.flatMap((t) => t.elements).find((e) => e.value === "design-aesthetics");
assert(
  iosDesign.acceptanceCount === 2 && eq(iosDesign.rollup.counts, { ios: { live: 2 } }),
  "platform filter keeps only the ios distribution; count is platform-independent",
);

fs.rmSync(BUILD_DIR, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll pyramid tests passed");
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node tests/app/pyramid.test.js`
Expected: FAIL — `computePyramidAggregation` is not defined.

- [ ] **Step 4: Implement `lib/utils/pyramid.ts`**

```ts
import type { PlatformId } from "@/lib/config/platforms";
import type { StatusId } from "@/lib/config/statuses";
import { VALUES, VALUE_TIERS_CONFIG, type ValueId, type ValueTierId } from "@/lib/config/values";
import type { Node } from "@/lib/data/types";
import {
  addPlatformStatusToRollup,
  createEmptyRollup,
  getNodePlatformStatuses,
  type PlatformStatusRollup,
} from "@/lib/utils/platform-status";

/**
 * Pyramid aggregation — the value-delivery radar (spec §9.2). For each of the
 * 30 Bain elements: how many acceptances carry it, and the per-platform
 * distribution of their resolved statuses. Grouped by tier in pyramid order;
 * unserved elements come back with a zero count and an empty rollup so the
 * "what's missing" grid stays visible. Pure and deterministic — the app renders
 * it, and the MCP/CLI can serve the identical numbers.
 */

export interface PyramidElement {
  value: ValueId;
  tier: ValueTierId;
  /** Acceptances whose metadata.values includes this element (platform-independent). */
  acceptanceCount: number;
  /** Per-platform status distribution of those acceptances' resolved statuses. */
  rollup: PlatformStatusRollup;
}

export interface PyramidTier {
  tier: ValueTierId;
  elements: PyramidElement[];
}

/**
 * @param acceptances acceptance nodes (caller filters `species === "acceptance"`).
 * @param platform when set, the distribution counts only that platform.
 */
export function computePyramidAggregation(
  acceptances: readonly Node[],
  platform?: PlatformId,
): PyramidTier[] {
  const byValue = new Map<ValueId, { count: number; rollup: PlatformStatusRollup }>(
    VALUES.map((value) => [value.id, { count: 0, rollup: createEmptyRollup() }]),
  );

  for (const acceptance of acceptances) {
    const values = (acceptance.metadata?.values ?? []) as ValueId[];
    const resolved = getNodePlatformStatuses(acceptance);

    for (const valueId of values) {
      const entry = byValue.get(valueId);
      if (!entry) continue; // an unknown id is a validation error elsewhere; ignore here
      entry.count += 1;
      for (const platformId of Object.keys(resolved) as PlatformId[]) {
        if (platform !== undefined && platformId !== platform) continue;
        const status = resolved[platformId] as StatusId | undefined;
        if (status) {
          entry.rollup = addPlatformStatusToRollup(entry.rollup, platformId, status);
        }
      }
    }
  }

  return VALUE_TIERS_CONFIG.map((tierConfig) => ({
    tier: tierConfig.id,
    elements: VALUES.filter((value) => value.tier === tierConfig.id).map((value) => {
      const entry = byValue.get(value.id)!;
      return { value: value.id, tier: value.tier, acceptanceCount: entry.count, rollup: entry.rollup };
    }),
  }));
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node tests/app/pyramid.test.js`
Expected: PASS — "All pyramid tests passed".

- [ ] **Step 6: Wire the npm script**

In `package.json`, add after `test:effective-status`:

```json
    "test:pyramid": "node tests/app/pyramid.test.js",
```

- [ ] **Step 7: Commit**

```bash
git add lib/utils/pyramid.ts tests/app/pyramid.test.js tests/app/load-pyramid.js package.json
git commit -m "feat(pyramid): value-element status aggregation over acceptances"
```

---

## Task 7: Pyramid page + navigation

**Files:**
- Create: `app/project/[id]/pyramid/page.tsx`
- Modify: `app/project/[id]/layout.tsx:28-30`
- Modify: `components/layout/ProjectSidebar.tsx:5-21,183-211`

- [ ] **Step 1: Create the Pyramid page**

Create `app/project/[id]/pyramid/page.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { PlatformGaugeList } from "@/components/graph/nodes/PlatformGaugeList";
import { ValueIcon } from "@/components/values/ValueBadge";
import { PLATFORMS, type PlatformId } from "@/lib/config/platforms";
import { VALUES, VALUE_TIERS_CONFIG } from "@/lib/config/values";
import { computePyramidAggregation } from "@/lib/utils/pyramid";
import { useNodes } from "@/lib/hooks/useNodes";
import { useProject } from "@/lib/hooks/useProject";

const VALUE_LABEL = new Map(VALUES.map((v) => [v.id, v.label]));
const TIER_LABEL = new Map(VALUE_TIERS_CONFIG.map((t) => [t.id, t.label]));

/**
 * The Pyramid: "How well is each value element delivered?" — the value-delivery
 * radar (spec §9.2). Element gauge grid (layout B): four tier sections, each a
 * grid of element cards (icon + label + per-platform gauge + acceptance count).
 * A platform chip row recomputes the gauges; an element links to the Acceptance
 * matrix pre-filtered on that value.
 */
export default function PyramidPage() {
  const params = useParams();
  const id = Array.isArray(params.id) ? params.id[0] : params.id ?? "";

  const [platform, setPlatform] = useState<PlatformId | "all">("all");
  const { nodes: dataNodes, loading } = useNodes(id);
  const { project: projectBundle } = useProject(id);

  const acceptances = useMemo(() => dataNodes.filter((node) => node.species === "acceptance"), [dataNodes]);
  const tiers = useMemo(
    () => computePyramidAggregation(acceptances, platform === "all" ? undefined : platform),
    [acceptances, platform],
  );

  if (loading) {
    return (
      <div className="h-full w-full flex items-center justify-center">
        <span className="text-muted-foreground text-sm">Loading pyramid...</span>
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <SidebarTrigger className="-ml-1 cursor-pointer" />
        <Separator orientation="vertical" className="mx-1 h-4" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{projectBundle?.project.title ?? "Untitled project"}</p>
          <p className="truncate text-xs text-muted-foreground">Value pyramid</p>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-4 md:p-6">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Platform</span>
            <Button type="button" size="sm" variant={platform === "all" ? "default" : "outline"} onClick={() => setPlatform("all")}>
              All
            </Button>
            {PLATFORMS.map((option) => (
              <Button
                key={option.id}
                type="button"
                size="sm"
                variant={platform === option.id ? "default" : "outline"}
                onClick={() => setPlatform(option.id)}
              >
                {option.label}
              </Button>
            ))}
          </div>

          {tiers.map((tier) => (
            <section key={tier.tier} className="flex flex-col gap-3">
              <h2 className="text-sm font-medium">{TIER_LABEL.get(tier.tier)}</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {tier.elements.map((element) => {
                  const served = element.acceptanceCount > 0;
                  return (
                    <Link
                      key={element.value}
                      href={`/project/${id}/acceptances?value=${element.value}`}
                      className={`flex flex-col gap-2 rounded-xl border bg-card p-3 transition-colors hover:bg-muted/40 ${served ? "" : "opacity-50"}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 text-sm">
                          <ValueIcon valueId={element.value} className="size-4 text-muted-foreground" />
                          <span className="truncate">{VALUE_LABEL.get(element.value)}</span>
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">{element.acceptanceCount}</span>
                      </div>
                      <PlatformGaugeList rollup={element.rollup} platforms={PLATFORMS.map((p) => p.id)} compact />
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add the `pyramid` branch to the layout `currentView` ladder**

In `app/project/[id]/layout.tsx`, extend the ternary (lines 28–30). Replace:

```ts
          : pathname.startsWith(`/project/${id}/acceptances`)
            ? "acceptances"
            : "maps";
```
with
```ts
          : pathname.startsWith(`/project/${id}/acceptances`)
            ? "acceptances"
            : pathname.startsWith(`/project/${id}/pyramid`)
              ? "pyramid"
              : "maps";
```

- [ ] **Step 3: Add the Pyramid sidebar entry**

In `components/layout/ProjectSidebar.tsx`, add `PyramidIcon` to the lucide import (keep the list alphabetical-ish; insert near the others):

```ts
  MonitorIcon,
  NetworkIcon,
  PyramidIcon,
  RouteIcon,
```

Add a `pyramidHref` const next to the other hrefs (after line 72):

```ts
  const pyramidHref = `/project/${projectId}/pyramid`;
```

Add a Pyramid menu item in the **Project** group, right after the Overview item (after line 193, before the Delivery item):

```tsx
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={currentView === "pyramid"} tooltip="Value pyramid">
                <Link href={pyramidHref}>
                  <PyramidIcon />
                  <span>Pyramid</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean. (`currentView` already admits `"pyramid"` in both `ProjectSidebar` and `ProjectSwitcher` from Part 1.)

- [ ] **Step 5: Verify in the running app**

Open the project. The sidebar Project group shows **Pyramid**; clicking it lands on `/project/<id>/pyramid`, active-highlighted. Four tier sections render; **Emotional** shows served cards for design-aesthetics (ios full-live gauge, android split), fun-entertainment, reduces-anxiety, rewards-me; **Life-changing** shows affiliation-belonging served; **Functional** and **Social impact** render muted/empty. The platform chips (All/Web/iOS/Android) recompute the gauges. Clicking an element opens `/acceptances?value=<id>` pre-filtered.

- [ ] **Step 6: Commit**

```bash
git add app/project/[id]/pyramid/page.tsx app/project/[id]/layout.tsx components/layout/ProjectSidebar.tsx
git commit -m "feat(pyramid): value pyramid page + sidebar/route plumbing"
```

---

## Task 8: Overview Parity + Pyramid cards

**Files:**
- Create: `components/overview/ParityCard.tsx`
- Create: `components/overview/PyramidCard.tsx`
- Modify: `app/project/[id]/overview/page.tsx`

- [ ] **Step 1: Create the Parity card**

Create `components/overview/ParityCard.tsx`. It takes the parity gaps (computed on the page via the already-exported `computeParityGaps`) and shows the count plus the widest gaps:

```tsx
"use client";

import { TriangleAlertIcon } from "lucide-react";
import type { AcceptanceParityGap } from "@arkaik/schema";
import { PLATFORM_LABELS } from "@/components/graph/nodes/node-styles";
import { OverviewSection } from "./OverviewSection";

interface ParityCardProps {
  gaps: AcceptanceParityGap[];
  projectId: string;
}

/** Where platforms disagree — acceptances shipped on some platforms, not others (spec §3.5). */
export function ParityCard({ gaps, projectId }: ParityCardProps) {
  return (
    <OverviewSection title="Platform parity" href={`/project/${projectId}/acceptances?parity_gap=1`} linkLabel="Acceptances">
      {gaps.length === 0 ? (
        <p className="text-sm text-muted-foreground">No parity gaps — every acceptance ships evenly across its platforms.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-sm">
            <TriangleAlertIcon className="size-4 text-amber-500" />
            <span className="font-medium">{gaps.length}</span>
            <span className="text-muted-foreground">acceptance{gaps.length === 1 ? "" : "s"} with a parity gap</span>
          </div>
          <ul className="flex flex-col gap-2 text-xs">
            {gaps.slice(0, 4).map((gap) => (
              <li key={gap.node_id} className="flex flex-col gap-1">
                <span className="truncate font-medium">{gap.title}</span>
                <span className="text-muted-foreground">
                  {gap.delivered.map((p) => PLATFORM_LABELS[p]).join(", ")} shipped ·{" "}
                  {Object.keys(gap.missing).map((p) => PLATFORM_LABELS[p as keyof typeof PLATFORM_LABELS]).join(", ")} lagging
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </OverviewSection>
  );
}
```

- [ ] **Step 2: Create the Pyramid mini-card**

Create `components/overview/PyramidCard.tsx`. It merges each tier's element rollups into one tier gauge:

```tsx
"use client";

import { PlatformGaugeList } from "@/components/graph/nodes/PlatformGaugeList";
import { VALUE_TIERS_CONFIG } from "@/lib/config/values";
import { PLATFORMS } from "@/lib/config/platforms";
import { mergeRollups } from "@/lib/utils/platform-status";
import type { PyramidTier } from "@/lib/utils/pyramid";
import { OverviewSection } from "./OverviewSection";

const TIER_LABEL = new Map(VALUE_TIERS_CONFIG.map((t) => [t.id, t.label]));
const ALL_PLATFORMS = PLATFORMS.map((p) => p.id);

interface PyramidCardProps {
  tiers: PyramidTier[];
  projectId: string;
}

/** Value delivery at a glance — four tier gauges (spec §9.3). */
export function PyramidCard({ tiers, projectId }: PyramidCardProps) {
  return (
    <OverviewSection title="Value pyramid" href={`/project/${projectId}/pyramid`} linkLabel="Pyramid">
      <div className="flex flex-col gap-3">
        {tiers.map((tier) => {
          const rollup = mergeRollups(...tier.elements.map((element) => element.rollup));
          const served = tier.elements.reduce((sum, element) => sum + element.acceptanceCount, 0);
          return (
            <div key={tier.tier} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{TIER_LABEL.get(tier.tier)}</span>
                <span>{served}</span>
              </div>
              <PlatformGaugeList rollup={rollup} platforms={ALL_PLATFORMS} compact />
            </div>
          );
        })}
      </div>
    </OverviewSection>
  );
}
```

- [ ] **Step 3: Wire both cards into the Overview page**

In `app/project/[id]/overview/page.tsx`, add imports:

```ts
import { computeParityGaps } from "@arkaik/schema";
import { ParityCard } from "@/components/overview/ParityCard";
import { PyramidCard } from "@/components/overview/PyramidCard";
import { computePyramidAggregation } from "@/lib/utils/pyramid";
```

Add two memos after the `snapshot` memo (line 68):

```ts
  const parityGaps = useMemo(() => computeParityGaps(dataNodes), [dataNodes]);
  const pyramidTiers = useMemo(
    () => computePyramidAggregation(dataNodes.filter((node) => node.species === "acceptance")),
    [dataNodes],
  );
```

Render the two cards inside the non-empty fragment (after `<PlatformGaugesCard .../>` at line 126):

```tsx
              <ParityCard gaps={parityGaps} projectId={id} />
              <PyramidCard tiers={pyramidTiers} projectId={id} />
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean. (`computeParityGaps` and `AcceptanceParityGap` are exported from `@arkaik/schema`; `PLATFORM_LABELS` is keyed by `PlatformId`.)

- [ ] **Step 5: Verify in the running app**

Open the Overview. A **Platform parity** card shows "3 acceptances with a parity gap" and lists the widest (e.g. "Pebble draw-in animation — iOS shipped · web, android lagging"), linking to `/acceptances?parity_gap=1`. A **Value pyramid** card shows four tier gauges (Emotional and Life-changing populated), linking to `/pyramid`. The existing Platform delivery gauge now reflects `V-pebble-detail`'s effective android status.

- [ ] **Step 6: Commit**

```bash
git add components/overview/ParityCard.tsx components/overview/PyramidCard.tsx app/project/[id]/overview/page.tsx
git commit -m "feat(overview): parity and value-pyramid cards"
```

---

## Task 9: Docs, generated artifacts, and full suite

**Files:**
- Modify: `docs/graph-model.md`
- Possibly regenerated: `lib/wobble/wobble-registry.generated.ts`, `app/wobble.generated.css` (if `PyramidIcon` is newly used)

- [ ] **Step 1: Note the `/pyramid` route in docs**

In `docs/graph-model.md`, find where the `/acceptances` route is documented (added in Part 1) and add a sibling line describing the Pyramid route — the value-element gauge grid at `/project/[id]/pyramid`, grouped by Bain tier, with a platform chip filter and element→acceptance-matrix links. Match the surrounding prose style.

- [ ] **Step 2: Regenerate and check the drift gate**

Run: `npm run generate && git status --porcelain`
Expected: the only changes are generated files that legitimately follow from this work. Adding `PyramidIcon` to the sidebar may add one wobble entry (`.lucide-pyramid`) to `lib/wobble/wobble-registry.generated.ts` and `app/wobble.generated.css`. If so, that is correct — stage them. If `git status` shows unexpected generated changes (e.g. schema/plugin/skill outputs), stop and investigate: this feature adds no schema/enums, so those must not move.

- [ ] **Step 3: Run every affected test suite**

Run:
```bash
npm run test:effective-status && \
npm run test:pyramid && \
npm run test:coverage && \
npm run test:delivery && \
npm run test:journey-graph && \
npm run test:acceptance && \
npm run test:acceptance-matrix && \
npm run test:value-icons
```
Expected: all PASS.

- [ ] **Step 4: Typecheck + lint the app**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add docs/graph-model.md lib/wobble/wobble-registry.generated.ts app/wobble.generated.css
git commit -m "docs: note the /pyramid route; regenerate wobble registry"
```

(If Step 2 produced no wobble changes, drop those paths from the `git add`.)

---

## Self-review notes (author)

- **Spec coverage.** §9.2 Pyramid page → Tasks 6/7. §9.3 delivery board → Task 5; Overview Parity + Pyramid cards → Task 8; the node-panel Acceptances section + Library acceptance species shipped in Part 1. §3.4 rollups (view/flow/product computed-with-fallback) → Tasks 1–4. §3.5 parity gap on Overview → Task 8 (via already-tested `computeParityGaps`). The `computeUncoveredViews` "uncovered views" health indicator from the Part-1 brief (line 1511, "optional") is **not** included — it is a small additive follow-up, not part of the parity/value core; note it for a later pass rather than expanding scope here.
- **Type consistency.** `getEffectivePlatformStatuses`/`addEffectiveNodeToRollup`/`computeFlowPlatformRollup`/`computePlaylistRollup` are defined in Task 1 and consumed unchanged in Tasks 2 (`coverage.ts`), 3 (`journey-graph.ts`), 4 (`library/page.tsx`). `computeProductRollup(nodes, edges, presetId?)` — the reordered signature — has exactly two callers (Overview page + coverage.test), both updated in Task 2. `computePyramidAggregation`/`PyramidTier`/`PyramidElement` defined in Task 6, consumed in Tasks 7/8. `mergeRollups` (Task 8's PyramidCard) and `AcceptanceParityGap`/`computeParityGaps` (Task 8) already exist (platform-status.ts / `@arkaik/schema`).
- **Backward compatibility.** `computePlaylistRollup`'s new `nodes`/`edges` params default to `[]`, so Task 1 lands without touching its callers; Tasks 3/4 opt them in. This keeps every commit building and green.
- **Golden discipline.** Only `test:coverage` changes existing numbers (android 17→18, traced entirely to `V-pebble-detail`). `test:journey-graph` is verified-unchanged (structural). New goldens (`test:effective-status`, `test:pyramid`) are hand-derived from the three seeded acceptances and pinned. Every rollup delta in the app must be traceable to `V-pebble-detail`, `F-swap-glyph`, or `F-record-pebble` (the only covered anchors) — any other movement is a bug.
- **No placeholders.** Every new file has complete code with correct imports (`Edge`/`Node`/`PlatformStatusMap` from `@/lib/data/types`; `PlatformId` from `@/lib/config/platforms`; `StatusId`/`STATUS_ORDER` from `@/lib/config/statuses`; `ValueId`/`ValueTierId`/`VALUES`/`VALUE_TIERS_CONFIG` from `@/lib/config/values`; `computeParityGaps`/`AcceptanceParityGap` from `@arkaik/schema`).
- **Verification.** Pure utils (seam, pyramid) are node-harness unit-tested (Tasks 1/6); the rollup opt-ins and all new UI (journey, library, delivery, pyramid page, overview cards) are driven in the running app against the seeded acceptances (Tasks 3/4/5/7/8) since React components aren't unit-tested in this repo.
