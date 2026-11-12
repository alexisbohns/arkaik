# Screens map — Part 1: the wall model — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Screens map's pure wall model and layout, and the shared staleness rule that counts a view's covering acceptances, with their tests. Nothing the app imports yet; nothing a user sees.

**Architecture:** `lib/utils/screenshot-staleness.ts` gains `staleReasons` (the events that stale a shot, newest first), an optional `relatedIds` parameter on `isScreenshotStale`, `stalenessRelatedIds`, and the exported `STALENESS_EVENT_TYPES` the hook used to own. `lib/utils/screen-wall.ts` turns the snapshot and the projected journal into strips (every scoped flow, Journey-reached ones first, then "Not in a flow"), frames, markers, jump tiles and one screen per view with a cell per platform (state, shot, stale reasons, live proof), plus counts, gaps and the lens. `lib/utils/screen-wall-layout.ts` turns a wall and a lens into boxes, strip rects and bounds, and holds the camera, neighbour and chip maths. Both are pure: no React, no DOM, no `components/` import.

**Tech Stack:** TypeScript (strict, `tsc --noEmit`), plain Node test scripts that transpile app modules with `ts.transpileModule` into a gitignored build directory, GitHub Actions on Node 20.

**Spec:** `docs/superpowers/specs/2026-11-11-screens-map-design.md`

**Contract:** `docs/superpowers/plans/2026-11-11-screens-map-stack.md` (authoritative where it and the spec differ)

**Branch:** `feat/screens-model`, from an up-to-date `main` (`2f697cd`).

**Position in the stack:** part 1 of 5, the bottom. Parts 2 (`feat/screens-map`), 3 (`feat/screens-side-gaps`), 4 (`feat/screens-inspect`) and 5 (`feat/screens-palette`) stack on top and never edit `lib/utils/screen-wall*.ts`; every helper they call is exported here.

---

## Contract deviations

None. Every name, signature, file and constant below is the contract's, and the contract worked as written against `main` at `2f697cd`. One addition that renames nothing: `tests/app/load-screen-wall.js` also returns `STALENESS_EVENT_TYPES`, so the seed census and the time budget project the seed journals exactly as the app does.

## Readings the contract leaves open (parts 2–4 rely on these)

The contract fixes names and shapes; these are the behaviours the code below settles where neither the contract nor the spec spells them out. The suite pins the main case of each from 2 to 10.

1. **Index paths are raw playlist indices.** A skipped entry (another product's, or a missing node) leaves its index unused instead of renumbering the entries after it, so a frame keeps its id when the scope changes: `V-admin@F-a:4` under All products, nothing at index 4 under `app`.
2. **Every scoped view has a screen and is on the wall**: in a flow strip, or in "Not in a flow". `gapCount` therefore iterates `wall.screens`.
3. **An `absent` cell** keeps the effective status if one exists (`S ?? null`) and the shot if the slot holds one; it has no proof and no stale reasons. A `not-live` cell has no proof and no stale reasons either: stale reasons are computed only for a live cell with a shot.
4. **`LiveProof` for `unknown`** carries `ts`, `actor` and `detail` as `null` (no event decided it). For `hand` they come from the newest hand event; for `deploy` from the newest of the acceptances' events. A `detail` counts as deploy evidence when it is a non-blank string.
5. **`StaleReason.label`**: `"<nodeId> moved to <Status> on <Platform>"` (no `" on …"` for a project-wide move; an unknown status id is echoed), `"Pull request merged"` for the view's own ref, `"Pull request merged on <acceptance id>"` for a related one, `"Shipped: <title>"` (the deliverable id when the title is blank). `nodeId` of a shipped reason is the view when the event names it, else the first related id it names.
6. **`countStrip(…).perPlatform`** has an entry for each lens platform only. `on` counts views whose cell is not `absent`; `live` counts the three live states.
7. **Measured aspects** are used only while the cell holds a shot and is not `absent`; a non-finite or non-positive measurement is ignored (the platform default applies), anything else is clamped.
8. **`frameViewport`** works axis by axis: centred in the area above `bottomInset`, or start-aligned at `padding` when the rect overflows `viewport − 2·padding (− bottomInset)` at the chosen zoom.
9. **`neighbourFrame`** skips rows without a frame (a strip of jump tiles, an empty flow); on a tie of centre distance it keeps the leftmost.
10. **`chipRects(frame, count)`** returns exactly `count` rects; the caller passes `min(touches, CHIP_MAX)` plus one for a "+N more" chip.
11. **`wall.platforms`** is the shell scope's menu (`scope.platforms`, in `PLATFORMS` order); a definition's `product` narrows the nodes only. The built-in Screens map carries no `product`, so the two never disagree in this stack.

## Repo traps that apply

- **CI is Node 20, local is newer.** No test `require`s a `.ts` file; both suites go through loaders. No `Object.groupBy`, `Map.groupBy`, `toSorted`, or `Set` methods in a tested module. Node 20 is not installed on the machine this plan was rehearsed on; the code avoids every API newer than Node 20.
- **Hand-maintained alias tables.** `screenshot-staleness.ts` keeps `@arkaik/schema` as its only import, so `tests/app/load-screenshot-staleness.js` (which rewrites only that specifier) keeps working unchanged. The new loader lists every `@/` specifier its modules use. No existing tested module imports `screen-wall*.ts`.
- **CI fails on ESLint and actionlint.** ESLint ignores `tests/**`. The new CI step is plain YAML.
- **CI diffs generated artifacts.** This part touches no generator input and imports no lucide icon; `npm run generate` must leave the tree clean.

---

## File map

- Create `lib/utils/screen-wall.ts` — wall types, `buildWall`, `LOOSE_STRIP_ID`, `stripIdOf`, `frameIdsOf`, `lensPlatforms`, `countStrip`, `isGapCell`, `isGapFrame`, `gapCount`, `resolveLens`, `cellWord`, `stripCountsLine`.
- Create `lib/utils/screen-wall-layout.ts` — the layout constants, `Rect` (re-exported), `WallBoxKind`, `WallBox`, `WallLayout`, `AspectOf`, `layoutWall`, `clampAspect`, `sideGeometry`, `frameViewport`, `neighbourFrame`, `chipRects`.
- Modify `lib/utils/screenshot-staleness.ts` — `STALENESS_EVENT_TYPES`, `staleReasons`, `isScreenshotStale(…, relatedIds?)`, `stalenessRelatedIds`.
- Modify `lib/hooks/useScreenshotStaleness.ts` — import the moved constant; nothing else.
- Create `tests/app/load-screen-wall.js` — the wall's loader.
- Create `tests/app/screen-wall.test.js` — the wall suite.
- Modify `tests/app/screenshot-staleness.test.js` — related ids, `staleReasons` order, `stalenessRelatedIds`; existing assertions untouched.
- Modify `package.json` — `"test:screen-wall": "node tests/app/screen-wall.test.js"`.
- Modify `.gitignore` — `/tests/app/.test-build-screen-wall/`.
- Modify `.github/workflows/ci.yml` — a build-job step after "Journey layout tests".
- Commit (Task 1): `docs/superpowers/specs/2026-11-11-screens-map-design.md`, `docs/superpowers/plans/2026-11-11-screens-map-stack.md` and the five part plans.
- No generated artifact changes. No component, no `packages/**`, no `Canvas.tsx`, no palette, no `NodeDetailPanel.tsx`, no `AcceptancePlatformsSection.tsx`.

---

### Task 1: Commit the spec, the contract and the part plans

**Files:**
- Add: `docs/superpowers/specs/2026-11-11-screens-map-design.md`
- Add: `docs/superpowers/plans/2026-11-11-screens-map-stack.md`
- Add: the five part plans, `docs/superpowers/plans/2026-11-11-screens-map-part-*.md` (this file is part 1)

- [ ] **Step 1: Check the plans are all there**

Run: `ls docs/superpowers/plans/2026-11-11-screens-map-*.md`
Expected: the contract and five part plans, six files. If a part plan is missing, stop and ask; the stack's first commit carries all of them.

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-11-11-screens-map-design.md docs/superpowers/plans/2026-11-11-screens-map-*.md
git commit -m "docs(screens): the Screens map spec, stack contract and part plans"
```

Expected: `git show --stat HEAD` lists seven files under `docs/superpowers/`.

---

### Task 2: The shared staleness rule names its reasons and counts related ids

**Files:**
- Modify: `lib/utils/screenshot-staleness.ts`
- Modify: `lib/hooks/useScreenshotStaleness.ts`
- Test: `tests/app/screenshot-staleness.test.js`

**Trap:** the alias tables. `screenshot-staleness.ts` imports only `@arkaik/schema` (now `resolvePlatformStatus` at runtime as well as types); its loader rewrites only that specifier and is not changed. Adding any `@/` import here breaks `npm run test:screenshot-staleness` silently.

- [ ] **Step 1: Write the failing tests**

In `tests/app/screenshot-staleness.test.js`, replace the line

```js
const { isScreenshotStale } = loadScreenshotStaleness();
```

with

```js
const { isScreenshotStale, staleReasons, stalenessRelatedIds, STALENESS_EVENT_TYPES } = loadScreenshotStaleness();
```

Then insert the block below directly above the file's last line, `process.exit(failures > 0 ? 1 : 0);`, with one blank line before the block and one after it. Every existing check stays as it is.

```js
// --- Related ids: a view's covering acceptances (screens map spec F4) -------
// A deploy moves the acceptance, never the view, so the view's shot has to
// stale on the acceptance's events under the same three rules as its own.
const acStatus = (ts, platform, to = "live") => ({ id: `a${ts}`, ts, type: "node.status_changed", node_id: "AC-home", from: "releasing", to, ...(platform ? { platform } : {}) });
const acMerged = (ts) => ({ ...merged(ts), id: `m${ts}`, node_id: "AC-home" });

check("the event types are the three the rule reads, in order",
  JSON.stringify(STALENESS_EVENT_TYPES) === JSON.stringify(["node.status_changed", "ref.status_changed", "deliverable.shipped"]));
check("related: a later status change on this platform stales the shot", isScreenshotStale(meta, [acStatus(after, "ios")], "V-home", "ios", ["AC-home"]) === true);
check("related: a later project-wide status change stales the shot", isScreenshotStale(meta, [acStatus(after)], "V-home", "ios", ["AC-home"]) === true);
check("related: a status change on another platform does not", isScreenshotStale(meta, [acStatus(after, "web")], "V-home", "ios", ["AC-home"]) === false);
check("related: a later merged ref stales the shot", isScreenshotStale(meta, [acMerged(after)], "V-home", "ios", ["AC-home"]) === true);
check("related: a later shipped deliverable naming it stales the shot", isScreenshotStale(meta, [shipped(after, ["AC-home"])], "V-home", "ios", ["AC-home"]) === true);
check("related: a shipped deliverable on another platform does not", isScreenshotStale(meta, [shipped(after, ["AC-home"], "web")], "V-home", "ios", ["AC-home"]) === false);
check("related: an event before the shot does not", isScreenshotStale(meta, [acStatus(before, "ios")], "V-home", "ios", ["AC-home"]) === false);
check("an id that is not related does not stale the shot", isScreenshotStale(meta, [acStatus(after, "ios")], "V-home", "ios", ["AC-other"]) === false);
check("no related ids: an acceptance's event is ignored, as before", isScreenshotStale(meta, [acStatus(after, "ios")], "V-home", "ios") === false);
check("an empty related list reads as no related ids", isScreenshotStale(meta, [acStatus(after, "ios")], "V-home", "ios", []) === false);

const T1 = "2026-11-01T12:00:00.000Z";
const reasons = staleReasons(
  meta,
  [
    status(after, "ios"),
    acStatus(T1, "ios"),
    { ...status(T1, "ios"), id: "z-same-ts" },
    status(before, "ios"),
    { ...acStatus(after, "web"), id: "other-platform" },
  ],
  "V-home",
  "ios",
  ["AC-home"],
);
check("staleReasons: every counting event, newest first, id descending on a tie",
  JSON.stringify(reasons.map((ev) => ev.id)) === JSON.stringify(["z-same-ts", `a${T1}`, after]),
  JSON.stringify(reasons.map((ev) => ev.id)));
check("staleReasons: none for a legacy shot", staleReasons(undefined, [status(after, "ios")], "V-home", "ios").length === 0);
check("staleReasons: none when nothing came after", staleReasons(meta, [status(before, "ios")], "V-home", "ios").length === 0);

const ac = (id, platforms, platformStatuses) => ({ id, species: "acceptance", status: "live", platforms, metadata: platformStatuses ? { platformStatuses } : {} });
check("stalenessRelatedIds: the acceptances that list the platform, in input order",
  JSON.stringify(stalenessRelatedIds([ac("AC-b", ["web", "ios"]), ac("AC-a", ["web"]), ac("AC-c", ["ios"], { ios: "development" })], "ios")) === JSON.stringify(["AC-b", "AC-c"]));
check("stalenessRelatedIds: none for a platform no acceptance lists", stalenessRelatedIds([ac("AC-a", ["web"])], "android").length === 0);
check("stalenessRelatedIds: none for no acceptances", stalenessRelatedIds([], "web").length === 0);
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:screenshot-staleness`
Expected: the twelve existing checks PASS; `FAIL: the event types are the three the rule reads, in order` and four `FAIL: related: …` lines; then `TypeError: staleReasons is not a function`, exit 1.

- [ ] **Step 3: Write the implementation**

Replace the whole of `lib/utils/screenshot-staleness.ts` with:

```ts
import {
  resolvePlatformStatus,
  type JournalEvent,
  type Node,
  type PlatformId,
  type PlatformScreenshotMeta,
} from "@arkaik/schema";

/**
 * The journal event types the rule below consults. One stable array, so every
 * reader that projects the journal to it (the panel's hook, the Screens map)
 * shares one query key and so one cached fetch.
 */
export const STALENESS_EVENT_TYPES = ["node.status_changed", "ref.status_changed", "deliverable.shipped"] as const;

/**
 * The events that make a slot's screenshot *possibly* stale (spec 2026-11-01
 * § 5), newest first: the node moved on that platform (or project-wide), or a
 * pull request on it merged, after the shot was taken, or a deliverable naming
 * it shipped. Derived from the journal on every read and never stored — a
 * derived flag costs nothing to be wrong about and nothing to repair.
 *
 * `relatedIds` widens "the node" to nodes whose events speak for it under the
 * same three rules: a view's covering acceptances, since the deploy door and
 * the GitHub App move the acceptance and never the view
 * (docs/superpowers/specs/2026-11-11-screens-map-design.md F4). Omitted or
 * empty, the answer is exactly the node's own.
 *
 * Merge signals: in hosted mode the GitHub App mirrors a merge by patching
 * `metadata.refs` in place (no `ref.status_changed` is derived) and emits
 * `deliverable.shipped` on merge; `ref.status_changed` stays as the repo-mode
 * (`arkaik sync`) signal. A shot with no meta (a legacy slot) is never flagged.
 */
export function staleReasons(
  meta: PlatformScreenshotMeta | undefined,
  events: readonly JournalEvent[],
  nodeId: string,
  platform: PlatformId,
  relatedIds: readonly string[] = [],
): JournalEvent[] {
  const since = meta?.ts;
  if (!since) return [];
  const ids = new Set<string>([nodeId, ...relatedIds]);
  const reasons = events.filter((ev) => {
    // Lexicographic like `orderEvents`: safe because every writer emits
    // `toISOString()` (UTC, Z-suffixed); a caller-supplied `op.ts` must keep that form.
    if (typeof ev.ts !== "string" || ev.ts <= since) return false;
    if (ev.type === "deliverable.shipped") {
      return (
        Array.isArray(ev.node_ids) &&
        ev.node_ids.some((id) => typeof id === "string" && ids.has(id)) &&
        (ev.platform === undefined || ev.platform === platform)
      );
    }
    if (typeof ev.node_id !== "string" || !ids.has(ev.node_id)) return false;
    if (ev.type === "node.status_changed") return ev.platform === undefined || ev.platform === platform;
    if (ev.type === "ref.status_changed") return ev.to === "merged";
    return false;
  });
  return reasons.sort((a, b) => (a.ts === b.ts ? compareDesc(a.id, b.id) : compareDesc(a.ts, b.ts)));
}

/** Whether a slot's screenshot may be stale: {@link staleReasons} found any. */
export function isScreenshotStale(
  meta: PlatformScreenshotMeta | undefined,
  events: readonly JournalEvent[],
  nodeId: string,
  platform: PlatformId,
  relatedIds?: readonly string[],
): boolean {
  return staleReasons(meta, events, nodeId, platform, relatedIds).length > 0;
}

/**
 * The related ids for a view's shot on `platform`: the covering acceptances
 * that speak to the platform (`resolvePlatformStatus` is defined), in input
 * order. Callers get `covering` from `acceptancesCovering` (or an index built
 * the same way), so the wall and the panel pick the same acceptances.
 */
export function stalenessRelatedIds(
  covering: readonly Pick<Node, "id" | "status" | "platforms" | "metadata">[],
  platform: PlatformId,
): string[] {
  return covering.filter((ac) => resolvePlatformStatus(ac, platform) !== undefined).map((ac) => ac.id);
}

function compareDesc(left: string, right: string): number {
  return left < right ? 1 : left > right ? -1 : 0;
}
```

In `lib/hooks/useScreenshotStaleness.ts`, replace

```ts
import { isScreenshotStale } from "@/lib/utils/screenshot-staleness";

/** A stable array, so the query key does not change identity on every render. */
const STALENESS_EVENT_TYPES = ["node.status_changed", "ref.status_changed", "deliverable.shipped"] as const;
```

with

```ts
import { isScreenshotStale, STALENESS_EVENT_TYPES } from "@/lib/utils/screenshot-staleness";
```

Nothing else in the hook changes: it passes no related ids, so the panel behaves exactly as today until part 2.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:screenshot-staleness && npx tsc --noEmit && npx eslint lib/utils/screenshot-staleness.ts lib/hooks/useScreenshotStaleness.ts`
Expected: 29 PASS lines and no FAIL, exit 0; no type errors; no lint output.

- [ ] **Step 5: Commit**

```bash
git add lib/utils/screenshot-staleness.ts lib/hooks/useScreenshotStaleness.ts tests/app/screenshot-staleness.test.js
git commit -m "feat(staleness): stale reasons, and a view's covering acceptances as related ids"
```

---

### Task 3: The wall's strips, in Journey order

**Files:**
- Create: `lib/utils/screen-wall.ts`
- Create: `tests/app/load-screen-wall.js`
- Create: `tests/app/screen-wall.test.js`
- Modify: `package.json`, `.gitignore`, `.github/workflows/ci.yml`

This task writes every wall type (they are the contract) and the strips: ordering rules 1–6, ids, jump tiles, markers, "Not in a flow", `empty`, screens with their touches and strip ids. Cells stay `{}` until Task 4.

**Traps:** Node 20 (the suite loads the module through its own loader; it never `require`s a `.ts` file) and the alias tables (the loader below lists every `@/` specifier the transpiled graph uses; `@arkaik/schema` points at the schema's test build). Run `actionlint` on the workflow if it is installed; CI runs it on every workflow file.

- [ ] **Step 1: Write the loader, the failing suite and the wiring**

Create `tests/app/load-screen-wall.js`:

```js
/**
 * Loads the Screens map's pure wall model (lib/utils/screen-wall*.ts) into
 * Node without a bundler — the load-journey-graph.js technique over the wall's
 * runtime graph. The wall reads the Journey's selection (`journey-graph.ts`),
 * so that module's whole graph rides along, plus the shared staleness rule.
 *
 * Its own BUILD_DIR and its own SPECIFIER_MAP: a new `@/` import in any module
 * listed here must be added to the table below, and to no other loader.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const { loadSchema, BUILD_DIR: SCHEMA_BUILD_DIR } = require("../schema/load-schema");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, ".test-build-screen-wall");

// Source path (repo-relative) → build output basename.
const MODULES = [
  ["lib/config/platforms.ts", "config-platforms"],
  ["lib/config/statuses.ts", "config-statuses"],
  ["lib/utils/blocked.ts", "blocked"],
  ["lib/utils/platform-status.ts", "platform-status"],
  ["lib/utils/graph-build.ts", "graph-build"],
  ["lib/utils/product-scope.ts", "product-scope"],
  ["lib/utils/quality.ts", "quality"],
  ["lib/utils/journey-layout.ts", "journey-layout"],
  ["lib/utils/journey-card-size.ts", "journey-card-size"],
  ["lib/utils/journey-graph.ts", "journey-graph"],
  ["lib/utils/screenshot-staleness.ts", "screenshot-staleness"],
  ["lib/utils/screen-wall.ts", "screen-wall"],
];

// `@/lib/...` specifier → build output basename.
const SPECIFIER_MAP = {
  "@/lib/config/platforms": "./config-platforms",
  "@/lib/config/species": "./config-species", // type-only in this graph
  "@/lib/config/statuses": "./config-statuses",
  "@/lib/config/edge-types": "./config-edge-types", // type-only in this graph
  "@/lib/data/types": "./types", // type-only in this graph
  "@/lib/utils/blocked": "./blocked",
  "@/lib/utils/platform-status": "./platform-status",
  "@/lib/utils/graph-build": "./graph-build",
  "@/lib/utils/product-scope": "./product-scope",
  "@/lib/utils/quality": "./quality", // type-only in both graph builders
  "@/lib/utils/journey-layout": "./journey-layout",
  "@/lib/utils/journey-card-size": "./journey-card-size",
  "@/lib/utils/journey-graph": "./journey-graph",
  "@/lib/utils/screenshot-staleness": "./screenshot-staleness",
  "@/lib/utils/screen-wall": "./screen-wall",
};

function loadScreenWall() {
  loadSchema();

  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));

  const schemaIndex = path.join(SCHEMA_BUILD_DIR, "index.js");

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

    let rewritten = outputText.replace(
      /require\((['"])@arkaik\/schema\1\)/g,
      `require(${JSON.stringify(schemaIndex)})`,
    );
    for (const [specifier, target] of Object.entries(SPECIFIER_MAP)) {
      rewritten = rewritten.split(`require("${specifier}")`).join(`require("${target}")`);
    }
    fs.writeFileSync(path.join(BUILD_DIR, `${outName}.js`), rewritten);
  }

  for (const [, outName] of MODULES) {
    delete require.cache[path.join(BUILD_DIR, `${outName}.js`)];
  }
  const schema = require(schemaIndex);
  return {
    ...require(path.join(BUILD_DIR, "screen-wall.js")),
    // Part 2 pins the Screens map's advertised counts against the wall.
    computeMapCounts: require(path.join(BUILD_DIR, "journey-graph.js")).computeMapCounts,
    resolveProductScope: require(path.join(BUILD_DIR, "product-scope.js")).resolveProductScope,
    // The visual-id decoder, so a frame id is checked against the data node it shows.
    getBaseNodeId: require(path.join(BUILD_DIR, "graph-build.js")).getBaseNodeId,
    // The journal projection the app reads the wall's events through.
    STALENESS_EVENT_TYPES: require(path.join(BUILD_DIR, "screenshot-staleness.js")).STALENESS_EVENT_TYPES,
    buildProductGraph: schema.buildProductGraph,
    acceptancesCovering: schema.acceptancesCovering,
  };
}

module.exports = { loadScreenWall, BUILD_DIR };
```

Create `tests/app/screen-wall.test.js`. Later tasks append sections to the end of this file; the verdict is read in the `exit` listener, so nothing has to stay last.

```js
#!/usr/bin/env node

/**
 * The Screens map's wall model (docs/superpowers/specs/2026-11-11-screens-map-design.md
 * § The wall model): strips, frames, markers and jump tiles in Journey order;
 * per-platform states, stale reasons and live proof; counts and gaps; the
 * layout and its helpers; and the seed census the spec quotes.
 */

const fs = require("fs");
const path = require("path");
const { loadScreenWall } = require("./load-screen-wall");

const wallModule = loadScreenWall();
const { buildWall, resolveProductScope, buildProductGraph, getBaseNodeId } = wallModule;

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`PASS: ${name}`);
  else {
    failures++;
    console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
// Sections below append checks; the verdict is read once, as the process exits.
process.on("exit", () => {
  if (failures > 0) {
    console.log(`\n${failures} failing`);
    process.exitCode = 1;
  }
});

const same = (actual, expected) => JSON.stringify(actual) === JSON.stringify(expected);
const show = (value) => JSON.stringify(value);

const ROOT = path.join(__dirname, "..", "..");
const readSeed = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, "seed", name), "utf8"));

const PRODUCTS = [
  { id: "app", title: "App", platforms: ["web", "ios", "android"], root_node_id: "V-home" },
  { id: "admin", title: "Admin", platforms: ["web"] },
];

const view = (id, title, extra = {}) => ({
  id,
  project_id: "p",
  species: "view",
  title,
  status: "live",
  platforms: ["web", "ios", "android"],
  ...extra,
  metadata: { product: "app", ...(extra.metadata ?? {}) },
});
const flow = (id, title, entries, product = "app") => ({
  id,
  project_id: "p",
  species: "flow",
  title,
  status: "development",
  platforms: ["web", "ios", "android"],
  metadata: { product, playlist: { entries } },
});
const node = (id, species, title, extra = {}) => ({ id, project_id: "p", species, title, status: "live", platforms: ["web"], ...extra });
const edge = (source_id, edge_type, target_id) => ({ id: `${source_id}-${edge_type}-${target_id}`, project_id: "p", source_id, target_id, edge_type });
const V = (view_id) => ({ type: "view", view_id });
const F = (flow_id) => ({ type: "flow", flow_id });

/** A wall over a hand-made snapshot. `root` is the project's front door. */
function wallOf({ nodes, edges = [], events = [], products = PRODUCTS, productId = null, root = "V-home", definition = null }) {
  const project = { root_node_id: root, metadata: { products } };
  const scope = resolveProductScope({ project }, productId);
  const graph = buildProductGraph(nodes, edges);
  return buildWall({ nodes, edges, events, project, definition, scope, graph });
}

// --- Strips: ordering rules 1–6, ids, jump tiles, markers ------------------

const ORDER_NODES = [
  view("V-home", "Home"),
  flow("F-zeta", "Zeta", [V("V-c")]),
  flow("F-a", "Onboard", [
    V("V-a"),
    F("F-c"),
    {
      type: "condition",
      label: "Has a streak?",
      if_true: [
        V("V-b"),
        { type: "junction", label: "Which?", cases: [{ label: "One", entries: [V("V-c")] }, { label: "Two", entries: [] }] },
      ],
      if_false: [F("F-e")],
    },
    V("V-a"),
    V("V-admin"),
    V("V-missing"),
  ]),
  flow("F-b", "Browse", [F("F-b"), V("V-d")]),
  flow("F-c", "Settle", [F("F-d")]),
  flow("F-d", "Drift", []),
  flow("F-e", "Explore", [V("V-d")]),
  flow("F-adm", "Moderate", [V("V-admin")], "admin"),
  view("V-a", "Alpha"),
  view("V-b", "Bravo"),
  view("V-c", "Charlie"),
  view("V-d", "Delta"),
  view("V-e", "apple"),
  view("V-f", "Banana"),
  view("V-g", "Apple"),
  view("V-admin", "Admin home", { platforms: ["web", "ios"], metadata: { product: "admin" } }),
  node("API-z", "api-endpoint", "Zed"),
  node("API-a", "api-endpoint", "Alpha endpoint"),
  node("DM-m", "data-model", "Model"),
];
const ORDER_EDGES = [
  edge("V-home", "composes", "F-a"),
  edge("V-home", "composes", "F-b"),
  edge("V-a", "calls", "API-z"),
  edge("V-a", "displays", "DM-m"),
  edge("V-a", "calls", "API-a"),
  edge("V-a", "calls", "API-a"),
  edge("API-z", "calls", "V-b"),
];

{
  const wall = wallOf({ nodes: ORDER_NODES, edges: ORDER_EDGES, productId: "app" });
  const stripIds = wall.strips.map((strip) => strip.id);
  check("app scope: anchor's compose children, their sub-flows depth first, then the rest, then loose views",
    same(stripIds, ["strip:F-a", "strip:F-c", "strip:F-d", "strip:F-e", "strip:F-b", "strip:F-zeta", "strip:loose"]), show(stripIds));
  check("platforms: the scope's menu, in PLATFORMS order", same(wall.platforms, ["web", "ios", "android"]), show(wall.platforms));
  check("a wall with flows is not empty", wall.empty === null);

  const onboard = wall.strips[0];
  check("a strip carries its flow id and title", onboard.flowId === "F-a" && onboard.title === "Onboard");
  const items = onboard.items.map((item) => item.id);
  check("strip items follow the playlist: frames, jump tiles, arm and end markers; other products and missing nodes skipped",
    same(items, [
      "V-a@F-a:0",
      "jump:F-a:1",
      "arm:F-a:2.0",
      "V-b@F-a:2.0.0",
      "arm:F-a:2.0.1.0",
      "V-c@F-a:2.0.1.0.0",
      "arm:F-a:2.0.1.1",
      "end:F-a:2.0.1",
      "arm:F-a:2.1",
      "jump:F-a:2.1.0",
      "end:F-a:2",
      "V-a@F-a:3",
    ]), show(items));
  const arms = onboard.items.filter((item) => item.kind === "arm");
  check("arm markers: branch kind, label, arm label, first, empty",
    same(arms.map((a) => [a.branch, a.label, a.arm, a.first, a.empty]), [
      ["condition", "Has a streak?", "Yes", true, false],
      ["junction", "Which?", "One", true, false],
      ["junction", "Which?", "Two", false, true],
      ["condition", "Has a streak?", "No", false, false],
    ]), show(arms));
  const jumps = onboard.items.filter((item) => item.kind === "jump");
  check("jump tiles name their flow and count the distinct views of its own strip",
    same(jumps.map((j) => [j.flowId, j.title, j.screenCount]), [["F-c", "Settle", 0], ["F-e", "Explore", 1]]), show(jumps));
  check("viewIds: distinct views in first-appearance order", same(onboard.viewIds, ["V-a", "V-b", "V-c"]), show(onboard.viewIds));

  const browse = wall.strips.find((strip) => strip.id === "strip:F-b");
  check("a flow that lists itself is a jump tile to its own strip",
    same(browse.items.map((i) => [i.kind, i.id, i.flowId ?? null, i.screenCount ?? null]), [["jump", "jump:F-b:0", "F-b", 1], ["frame", "V-d@F-b:1", null, null]]),
    show(browse.items));
  const drift = wall.strips.find((strip) => strip.id === "strip:F-d");
  check("a flow with nothing to show gets one empty item", same(drift.items, [{ kind: "empty", id: "empty:F-d" }]), show(drift.items));

  const loose = wall.strips[wall.strips.length - 1];
  check("Not in a flow: unlisted views by title (case-insensitive), then id",
    loose.flowId === null && loose.title === "Not in a flow" && same(loose.items.map((i) => i.id), ["V-e@loose", "V-g@loose", "V-f@loose", "V-home@loose"]),
    show(loose.items));

  const ids = [...wall.strips.map((s) => s.id), ...wall.strips.flatMap((s) => s.items.map((i) => i.id))];
  check("every id on the wall is unique", new Set(ids).size === ids.length);
  const frames = wall.strips.flatMap((s) => s.items).filter((i) => i.kind === "frame");
  check("every frame id decodes to its view", frames.every((f) => getBaseNodeId(f.id) === f.viewId));

  check("one screen per view in scope, in snapshot order",
    same([...wall.screens.keys()], ["V-home", "V-a", "V-b", "V-c", "V-d", "V-e", "V-f", "V-g"]), show([...wall.screens.keys()]));
  check("a screen lists the strips it appears in, in strip order",
    same(wall.screens.get("V-c").stripIds, ["strip:F-a", "strip:F-zeta"]) && same(wall.screens.get("V-d").stripIds, ["strip:F-e", "strip:F-b"]));
  check("touches: endpoints then models, each by title, outbound only, once each",
    same(wall.screens.get("V-a").touches.map((t) => [t.nodeId, t.species, t.title, t.status]), [
      ["API-a", "api-endpoint", "Alpha endpoint", "live"],
      ["API-z", "api-endpoint", "Zed", "live"],
      ["DM-m", "data-model", "Model", "live"],
    ]) && wall.screens.get("V-b").touches.length === 0,
    show(wall.screens.get("V-a").touches));

  check("frameIdsOf: every frame of a view, strip order then item order",
    same(wallModule.frameIdsOf(wall, "V-a"), ["V-a@F-a:0", "V-a@F-a:3"]) && same(wallModule.frameIdsOf(wall, "V-d"), ["V-d@F-e:0", "V-d@F-b:1"]));
  check("frameIdsOf: none for a view not on the wall", same(wallModule.frameIdsOf(wall, "V-admin"), []));
  check("stripIdOf and LOOSE_STRIP_ID", wallModule.stripIdOf("F-a") === "strip:F-a" && wallModule.LOOSE_STRIP_ID === "strip:loose");
}

{
  const wall = wallOf({ nodes: ORDER_NODES, edges: ORDER_EDGES, productId: null });
  check("All products: every product's flows, another product's view listed where its flow puts it",
    same(wall.strips.map((s) => s.id), ["strip:F-a", "strip:F-c", "strip:F-d", "strip:F-e", "strip:F-b", "strip:F-zeta", "strip:F-adm", "strip:loose"]) &&
      wall.strips[0].items.some((i) => i.id === "V-admin@F-a:4"),
    show(wall.strips.map((s) => s.id)));
}

{
  const wall = wallOf({ nodes: ORDER_NODES, edges: ORDER_EDGES, productId: null, root: null });
  check("no anchor and no product named: parentless flows in snapshot order, each with its sub-flows, then the rest",
    same(wall.strips.map((s) => s.id), ["strip:F-zeta", "strip:F-c", "strip:F-d", "strip:F-e", "strip:F-adm", "strip:F-a", "strip:F-b", "strip:loose"]),
    show(wall.strips.map((s) => s.id)));
}

{
  const wall = wallOf({ nodes: ORDER_NODES, edges: ORDER_EDGES, productId: "admin" });
  check("admin scope (no anchor): its own flows only, one platform",
    same(wall.strips.map((s) => s.id), ["strip:F-adm"]) && same(wall.platforms, ["web"]), show(wall.strips.map((s) => s.id)));
  const viaDefinition = wallOf({ nodes: ORDER_NODES, edges: ORDER_EDGES, productId: null, definition: { product: "admin" } });
  check("the definition's product narrows like the scope's", same(viaDefinition.strips.map((s) => s.id), ["strip:F-adm"]));
}

{
  const noFlows = wallOf({ nodes: [view("V-x", "X"), view("V-y", "Y")], productId: "app" });
  check("views but no flow: empty is no-flows, and the loose strip holds them",
    noFlows.empty === "no-flows" && same(noFlows.strips.map((s) => s.id), ["strip:loose"]) && noFlows.strips[0].items.length === 2);
  const nothing = wallOf({ nodes: [], productId: null });
  check("no flow and no view: empty is nothing, no strips", nothing.empty === "nothing" && nothing.strips.length === 0 && nothing.screens.size === 0);
}

// --- Seed census (spec § Ordering rules), All products ---------------------

function seedWall(name) {
  const bundle = readSeed(name);
  const scope = resolveProductScope(bundle, null);
  const graph = buildProductGraph(bundle.nodes, bundle.edges);
  const events = (bundle.journal ?? []).filter((ev) => wallModule.STALENESS_EVENT_TYPES.includes(ev.type));
  const input = { nodes: bundle.nodes, edges: bundle.edges, events, project: bundle.project, definition: null, scope, graph };
  return { input, wall: buildWall(input) };
}

function census(wall) {
  const items = wall.strips.flatMap((strip) => strip.items.map((item) => ({ ...item, loose: strip.flowId === null })));
  const kind = (k) => items.filter((item) => item.kind === k).length;
  return {
    strips: wall.strips.length,
    frames: kind("frame"),
    loose: items.filter((item) => item.kind === "frame" && item.loose).length,
    arms: kind("arm"),
    ends: kind("end"),
    jumps: kind("jump"),
    empties: kind("empty"),
  };
}

{
  const pebbles = census(seedWall("pebbles.json").wall);
  check("Pebbles census: 11 strips, 61 frames (28 loose), 13 arm + 4 end markers, 0 jump tiles",
    same(pebbles, { strips: 11, frames: 61, loose: 28, arms: 13, ends: 4, jumps: 0, empties: 0 }), show(pebbles));
  const selfMap = census(seedWall("arkaik-self-map.json").wall);
  check("Self-map census: 39 strips, 56 frames (2 loose), 46 arm + 21 end markers, 14 jump tiles",
    same(selfMap, { strips: 39, frames: 56, loose: 2, arms: 46, ends: 21, jumps: 14, empties: 0 }), show(selfMap));
}
```

In `package.json`, directly after the `"test:journey-layout"` line, add:

```json
    "test:screen-wall": "node tests/app/screen-wall.test.js",
```

In `.gitignore`, directly after `/tests/app/.test-build-screenshot-staleness/`, add:

```
/tests/app/.test-build-screen-wall/
```

In `.github/workflows/ci.yml`, in the `build` job, directly after the step

```yaml
      - name: Journey layout tests
        run: npm run test:journey-layout
```

add, with one blank line before it:

```yaml
      - name: Screens wall model tests (strips, states, layout, seed census)
        run: npm run test:screen-wall
```

- [ ] **Step 2: Run the suite to verify it fails**

Run: `npm run test:screen-wall`
Expected: `Error: ENOENT: no such file or directory, open '…/lib/utils/screen-wall.ts'` from `loadScreenWall`, exit 1.

- [ ] **Step 3: Write the strips**

Create `lib/utils/screen-wall.ts`:

```ts
import type { MapDefinition } from "@arkaik/schema";
import { PLATFORMS, type PlatformId } from "@/lib/config/platforms";
import type { StatusId } from "@/lib/config/statuses";
import type { Edge as DataEdge, JournalEvent, Node as DataNode, PlaylistEntry, Project } from "@/lib/data/types";
import { createVisualNodeId } from "@/lib/utils/graph-build";
import { resolveJourneySelection } from "@/lib/utils/journey-graph";
import type { ProductGraph, ProductScope } from "@/lib/utils/product-scope";

/**
 * The Screens map's wall model (docs/superpowers/specs/2026-11-11-screens-map-design.md
 * § The wall model): every flow in scope as a strip of its screens, in the
 * Journey's order, then the views no flow lists. Pure — no React, no DOM — so
 * the map's renderer and its tests read the same answer.
 */

export interface WallInput {
  /** The whole snapshot: effective statuses and membership read every node. */
  nodes: readonly DataNode[];
  edges: readonly DataEdge[];
  /** The journal projected to STALENESS_EVENT_TYPES; any order. */
  events: readonly JournalEvent[];
  project: Pick<Project, "root_node_id"> | null | undefined;
  /** The Screens definition; only `product` is read. */
  definition?: Pick<MapDefinition, "product"> | null;
  scope: ProductScope;
  graph: ProductGraph;
}

export type WallLens = PlatformId | "side";

export type ShotState =
  | "live-current" // live, a shot, not stale
  | "live-stale" // live, a shot, stale            (a gap)
  | "live-no-shot" // live, no shot                  (a gap)
  | "not-live" // on the platform, status is not live (or none)
  | "absent"; // not on this platform

export type ShotForm = "url" | "data" | "path";

export interface WallShot {
  value: string;
  /** From meta.form, else detected from the value. */
  form: ShotForm;
  /** null = legacy slot with no provenance. */
  source: "ci" | "manual" | null;
  ts: string | null;
  commit: string | null;
}

export interface StaleReason {
  eventId: string;
  ts: string;
  kind: "status" | "merge" | "shipped";
  /** The node the event is about: the view, or one of its covering acceptances. */
  nodeId: string;
  /** e.g. "AC-checkin-live moved to Live on iOS", "Pull request merged", "Shipped: Weekly wrap" */
  label: string;
}

export interface LiveProof {
  kind: "deploy" | "hand" | "unknown";
  /** The latest move to live that decided it. */
  ts: string | null;
  actor: string | null;
  detail: string | null;
}

export interface PlatformCell {
  platform: PlatformId;
  state: ShotState;
  /** Effective status; null when the platform is listed but nothing gives it one. */
  status: StatusId | null;
  /** Present whenever the slot holds a value, whatever the state. */
  shot: WallShot | null;
  /** Newest first; empty unless the shot is stale. */
  staleBecause: StaleReason[];
  /** Only for the two live-with-shot states and live-no-shot. */
  proof: LiveProof | null;
}

export interface WallTouch {
  nodeId: string;
  species: "api-endpoint" | "data-model";
  title: string;
  status: StatusId;
}

/** One per view in scope, shared by every frame that shows it. */
export interface WallScreen {
  viewId: string;
  title: string;
  /** One per platform in wall.platforms. */
  cells: Partial<Record<PlatformId, PlatformCell>>;
  /** Endpoints first, then models; each by title. */
  touches: WallTouch[];
  /** Strip ids the view appears in, in strip order. */
  stripIds: string[];
}

export type WallItem =
  | { kind: "frame"; id: string; viewId: string }
  | { kind: "jump"; id: string; flowId: string; title: string; screenCount: number }
  | { kind: "arm"; id: string; branch: "condition" | "junction"; label: string; arm: string; first: boolean; empty: boolean }
  | { kind: "end"; id: string }
  | { kind: "empty"; id: string };

export interface WallStrip {
  /** `strip:<flowId>`, or `strip:loose`. */
  id: string;
  flowId: string | null;
  title: string;
  items: WallItem[];
  /** Distinct views in the strip, in first-appearance order. */
  viewIds: string[];
}

export interface Wall {
  strips: WallStrip[];
  screens: ReadonlyMap<string, WallScreen>;
  /** The scope's menu, in PLATFORMS order: the lens options and the side-by-side rows. */
  platforms: PlatformId[];
  /** "nothing": no flow and no view in scope. "no-flows": views but no flow. */
  empty: "nothing" | "no-flows" | null;
  /** True when any screen has any shot on any platform. */
  anyShot: boolean;
}

export interface StripCounts {
  /** Distinct views in the strip. */
  views: number;
  perPlatform: Partial<Record<PlatformId, { on: number; live: number }>>;
  /** Distinct (view, lens platform) pairs. */
  stale: number;
  noShot: number;
}

export const LOOSE_STRIP_ID = "strip:loose";

/** The strip id of a flow's strip; also its header's box id and React Flow node id. */
export function stripIdOf(flowId: string): string {
  return `strip:${flowId}`;
}

const LOOSE_TITLE = "Not in a flow";

type ArmItem = Extract<WallItem, { kind: "arm" }>;
type JumpItem = Extract<WallItem, { kind: "jump" }>;

export function buildWall(input: WallInput): Wall {
  const { nodes, edges, project, definition, scope, graph } = input;

  // Rule 1: the candidates are the map's scoped nodes. The Journey's
  // selection computes exactly `mapScopedNodes(definition, nodes,
  // scope.productId, graph)` as its `nodes`, so it is read from there.
  const selection = resolveJourneySelection({
    definition: { product: definition?.product },
    dataNodes: nodes,
    dataEdges: edges,
    project,
    scope,
    graph,
  });
  const candidates = selection.nodes;
  const flowsById = new Map<string, DataNode>();
  const viewsById = new Map<string, DataNode>();
  for (const candidate of candidates) {
    if (candidate.species === "flow") flowsById.set(candidate.id, candidate);
    else if (candidate.species === "view") viewsById.set(candidate.id, candidate);
  }

  const platforms = PLATFORMS.map((platform) => platform.id).filter((id) => scope.platforms.includes(id));
  const empty = flowsById.size === 0 ? (viewsById.size === 0 ? "nothing" : "no-flows") : null;

  const strips: WallStrip[] = [];
  for (const flowId of orderFlows(selection, flowsById)) {
    const flowNode = flowsById.get(flowId)!;
    const items = stripItems(flowNode, flowsById, viewsById);
    strips.push({ id: stripIdOf(flowId), flowId, title: flowNode.title, items, viewIds: viewIdsOf(items) });
  }

  // Jump tiles count the distinct views of their target's own strip, which
  // exists for every candidate flow (rules 2 and 3 visit all of them).
  const viewCountByFlow = new Map(strips.map((strip) => [strip.flowId, strip.viewIds.length]));
  for (const strip of strips) {
    for (const item of strip.items) {
      if (item.kind === "jump") item.screenCount = viewCountByFlow.get(item.flowId) ?? 0;
    }
  }

  // Rule 4: the scoped views no strip lists, by title then id.
  const listed = new Set(strips.flatMap((strip) => strip.viewIds));
  const loose = [...viewsById.values()]
    .filter((candidate) => !listed.has(candidate.id))
    .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }) || compareIds(a.id, b.id));
  if (loose.length > 0) {
    const items: WallItem[] = loose.map((candidate) => ({ kind: "frame", id: `${candidate.id}@loose`, viewId: candidate.id }));
    strips.push({ id: LOOSE_STRIP_ID, flowId: null, title: LOOSE_TITLE, items, viewIds: loose.map((candidate) => candidate.id) });
  }

  const screens = buildScreens(input, viewsById, strips);
  return { strips, screens, platforms, empty, anyShot: false };
}

/** Every frame id showing the view, strip order then item order; [] if none. */
export function frameIdsOf(wall: Wall, viewId: string): string[] {
  const ids: string[] = [];
  for (const strip of wall.strips) {
    for (const item of strip.items) {
      if (item.kind === "frame" && item.viewId === viewId) ids.push(item.id);
    }
  }
  return ids;
}

/**
 * Rules 2 and 3: the Journey's flows first, in the order the Journey lays them
 * out with everything expanded, then every other candidate flow in snapshot
 * order. Visiting a flow appends it once, then visits the sub-flows its
 * playlist reaches, depth first, arms in order.
 */
function orderFlows(selection: ReturnType<typeof resolveJourneySelection>, flowsById: ReadonlyMap<string, DataNode>): string[] {
  const order: string[] = [];
  const seen = new Set<string>();
  const visit = (flowId: string) => {
    const flowNode = flowsById.get(flowId);
    if (!flowNode || seen.has(flowId)) return;
    seen.add(flowId);
    order.push(flowId);
    for (const subFlowId of subFlowIds(entriesOf(flowNode))) visit(subFlowId);
  };

  if (selection.anchorNode?.species === "flow") visit(selection.anchorNode.id);
  for (const { child } of selection.composeClosure.pairs) {
    if (child.species === "flow") visit(child.id);
  }
  if (selection.anchorNode === null && selection.productId === null) {
    for (const candidate of selection.nodes) {
      if (candidate.species === "flow" && !selection.composeParentByChild.has(candidate.id)) visit(candidate.id);
    }
  }

  for (const flowId of flowsById.keys()) {
    if (!seen.has(flowId)) {
      seen.add(flowId);
      order.push(flowId);
    }
  }
  return order;
}

/** The sub-flow ids a playlist lists, in entry order, arms in order. */
function subFlowIds(entries: readonly PlaylistEntry[]): string[] {
  const ids: string[] = [];
  for (const entry of entries) {
    if (!entry) continue;
    if (entry.type === "flow") ids.push(entry.flow_id);
    else if (entry.type === "condition" || entry.type === "junction") {
      for (const arm of armsOf(entry)) ids.push(...subFlowIds(arm.entries));
    }
  }
  return ids;
}

/** Rule 5: a flow's playlist as strip items; ids carry the entry's index path. */
function stripItems(
  flowNode: DataNode,
  flowsById: ReadonlyMap<string, DataNode>,
  viewsById: ReadonlyMap<string, DataNode>,
): WallItem[] {
  const flowId = flowNode.id;
  const items: WallItem[] = [];

  const walk = (entries: readonly PlaylistEntry[], prefix: string) => {
    entries.forEach((entry, index) => {
      if (!entry) return;
      const path = prefix === "" ? String(index) : `${prefix}.${index}`;
      if (entry.type === "view") {
        if (viewsById.has(entry.view_id)) {
          items.push({ kind: "frame", id: createVisualNodeId(entry.view_id, `${flowId}:${path}`), viewId: entry.view_id });
        }
        return;
      }
      if (entry.type === "flow") {
        const target = flowsById.get(entry.flow_id);
        if (target) {
          const jump: JumpItem = { kind: "jump", id: `jump:${flowId}:${path}`, flowId: target.id, title: target.title, screenCount: 0 };
          items.push(jump);
        }
        return;
      }
      if (entry.type !== "condition" && entry.type !== "junction") return;
      armsOf(entry).forEach((arm, armIndex) => {
        const marker: ArmItem = {
          kind: "arm",
          id: `arm:${flowId}:${path}.${armIndex}`,
          branch: entry.type,
          label: entry.label,
          arm: arm.label,
          first: armIndex === 0,
          empty: false,
        };
        items.push(marker);
        const before = items.length;
        walk(arm.entries, `${path}.${armIndex}`);
        marker.empty = items.length === before;
      });
      items.push({ kind: "end", id: `end:${flowId}:${path}` });
    });
  };

  walk(entriesOf(flowNode), "");
  if (items.length === 0) items.push({ kind: "empty", id: `empty:${flowId}` });
  return items;
}

function armsOf(entry: Extract<PlaylistEntry, { type: "condition" | "junction" }>): { label: string; entries: readonly PlaylistEntry[] }[] {
  if (entry.type === "condition") {
    return [
      { label: "Yes", entries: Array.isArray(entry.if_true) ? entry.if_true : [] },
      { label: "No", entries: Array.isArray(entry.if_false) ? entry.if_false : [] },
    ];
  }
  return (Array.isArray(entry.cases) ? entry.cases : []).map((playlistCase) => ({
    label: playlistCase.label,
    entries: Array.isArray(playlistCase.entries) ? playlistCase.entries : [],
  }));
}

function entriesOf(flowNode: DataNode): readonly PlaylistEntry[] {
  const entries = flowNode.metadata?.playlist?.entries;
  return Array.isArray(entries) ? entries : [];
}

function viewIdsOf(items: readonly WallItem[]): string[] {
  const ids: string[] = [];
  for (const item of items) {
    if (item.kind === "frame" && !ids.includes(item.viewId)) ids.push(item.viewId);
  }
  return ids;
}

/** One screen per scoped view, in snapshot order. */
function buildScreens(
  input: WallInput,
  viewsById: ReadonlyMap<string, DataNode>,
  strips: readonly WallStrip[],
): Map<string, WallScreen> {
  const touchesByView = indexTouches(input.nodes, input.edges);
  const screens = new Map<string, WallScreen>();
  for (const viewNode of viewsById.values()) {
    screens.set(viewNode.id, {
      viewId: viewNode.id,
      title: viewNode.title,
      cells: {},
      touches: touchesByView.get(viewNode.id) ?? [],
      stripIds: strips.filter((strip) => strip.viewIds.includes(viewNode.id)).map((strip) => strip.id),
    });
  }
  return screens;
}

/** What each view touches: outbound `calls` to endpoints, `displays` to models (spec F5). */
function indexTouches(nodes: readonly DataNode[], edges: readonly DataEdge[]): Map<string, WallTouch[]> {
  const nodesById = new Map(nodes.map((candidate) => [candidate.id, candidate]));
  const byView = new Map<string, WallTouch[]>();
  for (const edge of edges) {
    const wanted = edge.edge_type === "calls" ? "api-endpoint" : edge.edge_type === "displays" ? "data-model" : null;
    if (wanted === null) continue;
    const source = nodesById.get(edge.source_id);
    const target = nodesById.get(edge.target_id);
    if (source?.species !== "view" || target?.species !== wanted) continue;
    const touches = byView.get(source.id) ?? [];
    if (touches.some((touch) => touch.nodeId === target.id)) continue;
    touches.push({ nodeId: target.id, species: wanted, title: target.title, status: target.status });
    byView.set(source.id, touches);
  }
  for (const touches of byView.values()) {
    touches.sort(
      (a, b) =>
        (a.species === b.species ? 0 : a.species === "api-endpoint" ? -1 : 1) ||
        a.title.localeCompare(b.title, undefined, { sensitivity: "base" }) ||
        compareIds(a.nodeId, b.nodeId),
    );
  }
  return byView;
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
```

- [ ] **Step 4: Run the suite to verify it passes**

Run: `npm run test:screen-wall && npx tsc --noEmit && npx eslint lib/utils/screen-wall.ts && git check-ignore tests/app/.test-build-screen-wall/x.js`
Expected: 27 PASS lines and no FAIL, including `Pebbles census: 11 strips, 61 frames (28 loose), 13 arm + 4 end markers, 0 jump tiles` and `Self-map census: 39 strips, 56 frames (2 loose), 46 arm + 21 end markers, 14 jump tiles`, exit 0; no type errors; no lint output; `git check-ignore` prints the path.

Run (if installed): `actionlint .github/workflows/ci.yml`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add lib/utils/screen-wall.ts tests/app/load-screen-wall.js tests/app/screen-wall.test.js package.json .gitignore .github/workflows/ci.yml
git commit -m "feat(screens): the wall's strips — flows in Journey order, frames, markers, jump tiles"
```

---

### Task 4: Cells — the truth table, stale reasons and live proof

**Files:**
- Modify: `lib/utils/screen-wall.ts`
- Test: `tests/app/screen-wall.test.js`

**Trap:** Node 20 — the event bucketing and covering index below use plain `Map`s and arrays; keep it that way (no `Map.groupBy`).

- [ ] **Step 1: Write the failing tests**

Append to the end of `tests/app/screen-wall.test.js`, after one blank line:

```js
// --- Cells: the state truth table, shots, stale reasons, live proof --------

const T0 = "2026-11-01T10:00:00.000Z";
const T1 = "2026-11-01T11:00:00.000Z";
const T2 = "2026-11-01T12:00:00.000Z";
const T3 = "2026-11-01T13:00:00.000Z";
const ac = (id, platforms, status = "live", platformStatuses) =>
  node(id, "acceptance", id, { status, platforms, metadata: platformStatuses ? { platformStatuses } : {} });
const toLive = (id, node_id, ts, extra = {}) => ({ id, ts, type: "node.status_changed", node_id, from: "releasing", to: "live", ...extra });
const iosView = (id) => view(id, id, { status: "idea", platforms: ["ios"] });

const CELL_NODES = [
  view("V-live", "Live", {
    metadata: {
      platformScreenshots: { web: "https://x/web.png", ios: "data:image/png;base64,AAAA" },
      platformScreenshotMeta: { web: { ts: T0, source: "ci", form: "url", commit: "abc" } },
    },
  }),
  view("V-mixed", "Mixed", {
    status: "development",
    metadata: {
      platformStatuses: { web: "live" },
      platformScreenshots: { ios: "shots/ios.png" },
      platformScreenshotMeta: { ios: { ts: T0, source: "manual" } },
    },
  }),
  view("V-covered", "Covered", { status: "idea", metadata: { platformScreenshots: { ios: "http://cdn/x.png" } } }),
  view("V-admin", "Admin home", { platforms: ["web", "ios"], metadata: { product: "admin" } }),
  view("V-arch", "Archived", { status: "archived", platforms: ["web"] }),
  ac("AC-c1", ["web", "ios"]),
  ac("AC-c2", ["web"], "development"),
  iosView("V-p-actor"),
  iosView("V-p-detail"),
  iosView("V-p-hand"),
  iosView("V-p-unknown"),
  iosView("V-p-mixed"),
  iosView("V-p-partial"),
  iosView("V-p-both"),
  ac("AC-pa", ["ios"]),
  ac("AC-pd", ["ios"]),
  ac("AC-ph", ["ios"]),
  ac("AC-pu", ["ios"]),
  view("V-s", "Stale through", {
    status: "idea",
    platforms: ["ios"],
    metadata: { platformScreenshots: { ios: "https://x/s.png" }, platformScreenshotMeta: { ios: { ts: T0, source: "ci", form: "url" } } },
  }),
  ac("AC-s", ["ios"]),
  ac("AC-other", ["ios"]),
];
const CELL_EDGES = [
  edge("AC-c1", "covers", "V-covered"),
  edge("AC-c2", "covers", "V-covered"),
  edge("AC-pa", "covers", "V-p-actor"),
  edge("AC-pd", "covers", "V-p-detail"),
  edge("AC-ph", "covers", "V-p-hand"),
  edge("AC-pu", "covers", "V-p-unknown"),
  edge("AC-pa", "covers", "V-p-mixed"),
  edge("AC-ph", "covers", "V-p-mixed"),
  edge("AC-pa", "covers", "V-p-partial"),
  edge("AC-pu", "covers", "V-p-partial"),
  edge("AC-pa", "covers", "V-p-both"),
  edge("AC-pd", "covers", "V-p-both"),
  edge("AC-s", "covers", "V-s"),
];
const CELL_EVENTS = [
  toLive("e-live-web", "V-live", T1, { platform: "web", actor: "alexis" }),
  toLive("e-pa", "AC-pa", T1, { platform: "ios", actor: "arkaik-ci" }),
  toLive("e-pd", "AC-pd", T2, { actor: "arkaik-app", detail: "build 42" }),
  toLive("e-ph-old", "AC-ph", T0, { platform: "ios", actor: "arkaik-ci" }),
  toLive("e-ph", "AC-ph", T1, { platform: "ios", actor: "claude-code" }),
  toLive("e-pu-web", "AC-pu", T2, { platform: "web", actor: "arkaik-ci" }),
  { id: "e-s-merge", ts: T3, type: "ref.status_changed", node_id: "AC-s", ref_id: "gh-9", to: "merged", synced_at: T3 },
  toLive("e-s-status", "AC-s", T2, { platform: "ios", actor: "arkaik-ci", detail: "build 7" }),
  { id: "e-s-ship", ts: T1, type: "deliverable.shipped", deliverable_id: "d-1", title: "Weekly wrap", node_ids: ["V-s"] },
  toLive("e-other", "AC-other", T3, { platform: "ios", actor: "claude-code" }),
];

{
  const wall = wallOf({ nodes: CELL_NODES, edges: CELL_EDGES, events: CELL_EVENTS, productId: null });
  const cell = (viewId, platform) => wall.screens.get(viewId).cells[platform];
  const row = (viewId, platform) => {
    const c = cell(viewId, platform);
    return [c.state, c.status];
  };

  check("every screen has one cell per wall platform",
    [...wall.screens.values()].every((screen) => same(Object.keys(screen.cells), ["web", "ios", "android"])));
  check("live, a shot, a later event: live-stale", same(row("V-live", "web"), ["live-stale", "live"]));
  check("live, a legacy shot: live-current (never stale)", same(row("V-live", "ios"), ["live-current", "live"]));
  check("live, no shot: live-no-shot", same(row("V-live", "android"), ["live-no-shot", "live"]));
  check("not live, with a shot: not-live, shot kept", same(row("V-mixed", "ios"), ["not-live", "development"]) && cell("V-mixed", "ios").shot !== null);
  check("not live, no shot: not-live with its status", same(row("V-mixed", "android"), ["not-live", "development"]));
  check("a per-platform override makes one platform live", same(row("V-mixed", "web"), ["live-no-shot", "live"]));
  check("covered: the weakest covering status on a platform", same(row("V-covered", "web"), ["not-live", "development"]));
  check("covered: a platform no covering acceptance lists has no status", same(row("V-covered", "android"), ["not-live", null]));
  check("covered: live through its acceptance, unproven shot current", same(row("V-covered", "ios"), ["live-current", "live"]));
  check("an Admin view under All products is absent where its product does not ship", row("V-admin", "ios")[0] === "absent" && row("V-admin", "android")[0] === "absent");
  check("an Admin view under All products is live on web", same(row("V-admin", "web"), ["live-no-shot", "live"]));
  check("archived is not live", same(row("V-arch", "web"), ["not-live", "archived"]));
  check("absent and not-live cells carry no proof and no reasons",
    [cell("V-admin", "ios"), cell("V-mixed", "ios"), cell("V-covered", "android")].every((c) => c.proof === null && c.staleBecause.length === 0));

  check("shot: meta's form, source, ts and commit",
    same(cell("V-live", "web").shot, { value: "https://x/web.png", form: "url", source: "ci", ts: T0, commit: "abc" }), show(cell("V-live", "web").shot));
  check("shot: a data URI with no meta is data, unattributed",
    same(cell("V-live", "ios").shot, { value: "data:image/png;base64,AAAA", form: "data", source: null, ts: null, commit: null }));
  check("shot: anything else is a path", same(cell("V-mixed", "ios").shot, { value: "shots/ios.png", form: "path", source: "manual", ts: T0, commit: null }));
  check("shot: http is a url", cell("V-covered", "ios").shot.form === "url");
  check("no shot: null", cell("V-live", "android").shot === null);
  check("anyShot: true when any slot holds a value", wall.anyShot === true);

  check("stale reason from the view's own move", same(cell("V-live", "web").staleBecause, [
    { eventId: "e-live-web", ts: T1, kind: "status", nodeId: "V-live", label: "V-live moved to Live on Web" },
  ]), show(cell("V-live", "web").staleBecause));
  check("stale reasons through a covering acceptance, newest first; an unrelated acceptance ignored",
    same(cell("V-s", "ios").staleBecause, [
      { eventId: "e-s-merge", ts: T3, kind: "merge", nodeId: "AC-s", label: "Pull request merged on AC-s" },
      { eventId: "e-s-status", ts: T2, kind: "status", nodeId: "AC-s", label: "AC-s moved to Live on iOS" },
      { eventId: "e-s-ship", ts: T1, kind: "shipped", nodeId: "V-s", label: "Shipped: Weekly wrap" },
    ]) && cell("V-s", "ios").state === "live-stale",
    show(cell("V-s", "ios").staleBecause));

  const proof = (viewId, platform = "ios") => cell(viewId, platform).proof;
  check("proof: uncovered is by hand, from the view's latest move to live on the platform",
    same(proof("V-live", "web"), { kind: "hand", ts: T1, actor: "alexis", detail: null }));
  check("proof: uncovered with no matching move is by hand, undated", same(proof("V-live", "ios"), { kind: "hand", ts: null, actor: null, detail: null }));
  check("proof: deploy by actor", same(proof("V-p-actor"), { kind: "deploy", ts: T1, actor: "arkaik-ci", detail: null }), show(proof("V-p-actor")));
  check("proof: deploy by detail, from a project-wide move", same(proof("V-p-detail"), { kind: "deploy", ts: T2, actor: "arkaik-app", detail: "build 42" }));
  check("proof: the latest move decides (a person after CI is by hand)", same(proof("V-p-hand"), { kind: "hand", ts: T1, actor: "claude-code", detail: null }));
  check("proof: no move to live on the platform is unknown", same(proof("V-p-unknown"), { kind: "unknown", ts: null, actor: null, detail: null }));
  check("proof: deploy and hand mixed is by hand", same(proof("V-p-mixed"), { kind: "hand", ts: T1, actor: "claude-code", detail: null }));
  check("proof: deploy and unknown mixed is unknown", proof("V-p-partial").kind === "unknown");
  check("proof: deploy only if every acceptance is, dated by the newest", same(proof("V-p-both"), { kind: "deploy", ts: T2, actor: "arkaik-app", detail: "build 42" }));
  check("proof: on live-stale too", same(proof("V-s"), { kind: "deploy", ts: T2, actor: "arkaik-ci", detail: "build 7" }));
}

{
  const wall = wallOf({ nodes: ORDER_NODES, edges: ORDER_EDGES, productId: "app" });
  check("anyShot: false when no slot holds a value", wall.anyShot === false);
}
```

- [ ] **Step 2: Run the suite to verify it fails**

Run: `npm run test:screen-wall`
Expected: the 27 strip checks PASS, then `FAIL: every screen has one cell per wall platform` and `TypeError: Cannot read properties of undefined (reading 'state')`, exit 1.

- [ ] **Step 3: Write the cells**

In `lib/utils/screen-wall.ts`, make four edits.

(a) Replace the import block (every line above the doc comment whose first line is ` * The Screens map's wall model …`) with:

```ts
import type { MapDefinition } from "@arkaik/schema";
import { PLATFORMS, platformLabel, type PlatformId } from "@/lib/config/platforms";
import { STATUSES, type StatusId } from "@/lib/config/statuses";
import type { Edge as DataEdge, JournalEvent, Node as DataNode, PlaylistEntry, Project } from "@/lib/data/types";
import { createVisualNodeId } from "@/lib/utils/graph-build";
import { resolveJourneySelection } from "@/lib/utils/journey-graph";
import { getEffectivePlatformStatuses } from "@/lib/utils/platform-status";
import { scopedPlatforms, type ProductGraph, type ProductScope } from "@/lib/utils/product-scope";
import { staleReasons, stalenessRelatedIds } from "@/lib/utils/screenshot-staleness";
```

(b) In `buildWall`, replace

```ts
  const screens = buildScreens(input, viewsById, strips);
  return { strips, screens, platforms, empty, anyShot: false };
```

with

```ts
  const screens = buildScreens(input, viewsById, strips, platforms);
  const anyShot = [...screens.values()].some((screen) => Object.values(screen.cells).some((cell) => cell?.shot));
  return { strips, screens, platforms, empty, anyShot };
```

(c) Replace the whole `buildScreens` function, from its doc comment `/** One screen per scoped view, in snapshot order. */` to its closing brace, with:

```ts
/** One screen per scoped view, in snapshot order, with a cell per wall platform. */
function buildScreens(
  input: WallInput,
  viewsById: ReadonlyMap<string, DataNode>,
  strips: readonly WallStrip[],
  platforms: readonly PlatformId[],
): Map<string, WallScreen> {
  const touchesByView = indexTouches(input.nodes, input.edges);
  const coveringByView = indexCovering(input.nodes, input.edges);
  const journal = indexEvents(input.events);
  const screens = new Map<string, WallScreen>();
  for (const viewNode of viewsById.values()) {
    const covering = coveringByView.get(viewNode.id) ?? [];
    const statuses = getEffectivePlatformStatuses(viewNode, input.nodes, input.edges);
    const onPlatforms = scopedPlatforms(viewNode, input.scope);
    const cells: Partial<Record<PlatformId, PlatformCell>> = {};
    for (const platform of platforms) {
      cells[platform] = cellOf(viewNode, platform, {
        on: onPlatforms.includes(platform),
        status: statuses[platform] ?? null,
        related: stalenessRelatedIds(covering, platform),
        journal,
      });
    }
    screens.set(viewNode.id, {
      viewId: viewNode.id,
      title: viewNode.title,
      cells,
      touches: touchesByView.get(viewNode.id) ?? [],
      stripIds: strips.filter((strip) => strip.viewIds.includes(viewNode.id)).map((strip) => strip.id),
    });
  }
  return screens;
}
```

(d) Append to the end of the file, after one blank line:

```ts
/** The journal bucketed once: events by the node they name, plus every shipped deliverable. */
interface JournalIndex {
  byNode: ReadonlyMap<string, JournalEvent[]>;
  shipped: readonly JournalEvent[];
}

function indexEvents(events: readonly JournalEvent[]): JournalIndex {
  const byNode = new Map<string, JournalEvent[]>();
  const shipped: JournalEvent[] = [];
  for (const ev of events) {
    if (ev.type === "deliverable.shipped") {
      shipped.push(ev);
      continue;
    }
    if (typeof ev.node_id !== "string") continue;
    const bucket = byNode.get(ev.node_id) ?? [];
    bucket.push(ev);
    byNode.set(ev.node_id, bucket);
  }
  return { byNode, shipped };
}

/** The acceptances covering each anchor, in snapshot order — `acceptancesCovering`, indexed once. */
function indexCovering(nodes: readonly DataNode[], edges: readonly DataEdge[]): Map<string, DataNode[]> {
  const anchorsBySource = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.edge_type !== "covers") continue;
    const anchors = anchorsBySource.get(edge.source_id) ?? [];
    if (!anchors.includes(edge.target_id)) anchors.push(edge.target_id);
    anchorsBySource.set(edge.source_id, anchors);
  }
  const byAnchor = new Map<string, DataNode[]>();
  for (const candidate of nodes) {
    if (candidate.species !== "acceptance") continue;
    for (const anchorId of anchorsBySource.get(candidate.id) ?? []) {
      const covering = byAnchor.get(anchorId) ?? [];
      covering.push(candidate);
      byAnchor.set(anchorId, covering);
    }
  }
  return byAnchor;
}

interface CellContext {
  /** The platform is in `scopedPlatforms(view, scope)`. */
  on: boolean;
  status: StatusId | null;
  /** The covering acceptances that list the platform. */
  related: readonly string[];
  journal: JournalIndex;
}

/** The state truth table (spec § State truth table) for one view on one platform. */
function cellOf(viewNode: DataNode, platform: PlatformId, context: CellContext): PlatformCell {
  const { on, status, related, journal } = context;
  const value = viewNode.metadata?.platformScreenshots?.[platform];
  const meta = viewNode.metadata?.platformScreenshotMeta?.[platform];
  const shot = typeof value === "string" && value !== "" ? shotOf(value, meta) : null;
  const base = { platform, status, shot, staleBecause: [] as StaleReason[], proof: null };

  if (!on) return { ...base, state: "absent" };
  if (status !== "live") return { ...base, state: "not-live" };

  const proof = proofOf(viewNode.id, related, platform, journal);
  if (!shot) return { ...base, state: "live-no-shot", proof };

  const events = [
    ...(journal.byNode.get(viewNode.id) ?? []),
    ...related.flatMap((id) => journal.byNode.get(id) ?? []),
    ...journal.shipped,
  ];
  const ids = new Set([viewNode.id, ...related]);
  const staleBecause = staleReasons(meta, events, viewNode.id, platform, related).map((ev) => reasonOf(ev, viewNode.id, ids));
  return { ...base, state: staleBecause.length > 0 ? "live-stale" : "live-current", staleBecause, proof };
}

function shotOf(value: string, meta: { ts?: string; source?: string; form?: string; commit?: string } | undefined): WallShot {
  const form: ShotForm =
    meta?.form === "url" || meta?.form === "data" || meta?.form === "path"
      ? meta.form
      : value.startsWith("data:image/")
        ? "data"
        : /^https?:\/\//i.test(value)
          ? "url"
          : "path";
  return {
    value,
    form,
    source: meta?.source === "ci" || meta?.source === "manual" ? meta.source : null,
    ts: typeof meta?.ts === "string" ? meta.ts : null,
    commit: typeof meta?.commit === "string" ? meta.commit : null,
  };
}

/** A stale event, in words built from ids, status and platform labels, and a deliverable's own title. */
function reasonOf(ev: JournalEvent, viewId: string, ids: ReadonlySet<string>): StaleReason {
  if (ev.type === "deliverable.shipped") {
    const named = Array.isArray(ev.node_ids) ? ev.node_ids.filter((id): id is string => typeof id === "string") : [];
    const nodeId = named.includes(viewId) ? viewId : named.find((id) => ids.has(id)) ?? viewId;
    const title =
      typeof ev.title === "string" && ev.title.trim() !== ""
        ? ev.title
        : typeof ev.deliverable_id === "string"
          ? ev.deliverable_id
          : "a deliverable";
    return { eventId: ev.id, ts: ev.ts, kind: "shipped", nodeId, label: `Shipped: ${title}` };
  }
  const nodeId = String(ev.node_id);
  if (ev.type === "ref.status_changed") {
    return {
      eventId: ev.id,
      ts: ev.ts,
      kind: "merge",
      nodeId,
      label: nodeId === viewId ? "Pull request merged" : `Pull request merged on ${nodeId}`,
    };
  }
  const to = STATUSES.find((entry) => entry.id === ev.to)?.label ?? String(ev.to);
  const on = ev.platform === undefined ? "" : ` on ${platformLabel(ev.platform)}`;
  return { eventId: ev.id, ts: ev.ts, kind: "status", nodeId, label: `${nodeId} moved to ${to}${on}` };
}

/**
 * How a live cell went live (spec § Live proof). Uncovered: by hand, since the
 * deploy door refuses views. Covered: each listing acceptance's latest move
 * to live on the platform (or project-wide) is a deploy when CI wrote it or it
 * carries `detail`; the cell is a deploy only if every acceptance's is.
 */
function proofOf(viewId: string, related: readonly string[], platform: PlatformId, journal: JournalIndex): LiveProof {
  if (related.length === 0) {
    return { kind: "hand", ...evidenceOf(latestMoveToLive(journal.byNode.get(viewId) ?? [], platform)) };
  }
  const deploys: JournalEvent[] = [];
  const hands: JournalEvent[] = [];
  let unproven = false;
  for (const id of related) {
    const ev = latestMoveToLive(journal.byNode.get(id) ?? [], platform);
    if (!ev) unproven = true;
    else if (ev.actor === "arkaik-ci" || (typeof ev.detail === "string" && ev.detail.trim() !== "")) deploys.push(ev);
    else hands.push(ev);
  }
  if (hands.length > 0) return { kind: "hand", ...evidenceOf(newest(hands)) };
  if (!unproven) return { kind: "deploy", ...evidenceOf(newest(deploys)) };
  return { kind: "unknown", ts: null, actor: null, detail: null };
}

function latestMoveToLive(events: readonly JournalEvent[], platform: PlatformId): JournalEvent | null {
  return newest(
    events.filter(
      (ev) =>
        ev.type === "node.status_changed" &&
        ev.to === "live" &&
        typeof ev.ts === "string" &&
        (ev.platform === undefined || ev.platform === platform),
    ),
  );
}

function newest(events: readonly JournalEvent[]): JournalEvent | null {
  let best: JournalEvent | null = null;
  for (const ev of events) {
    if (best === null || ev.ts > best.ts || (ev.ts === best.ts && ev.id > best.id)) best = ev;
  }
  return best;
}

function evidenceOf(ev: JournalEvent | null): Omit<LiveProof, "kind"> {
  return {
    ts: ev?.ts ?? null,
    actor: typeof ev?.actor === "string" ? ev.actor : null,
    detail: typeof ev?.detail === "string" && ev.detail !== "" ? ev.detail : null,
  };
}
```

- [ ] **Step 4: Run the suite to verify it passes**

Run: `npm run test:screen-wall && npx tsc --noEmit && npx eslint lib/utils/screen-wall.ts`
Expected: 60 PASS lines and no FAIL, exit 0; no type errors; no lint output.

- [ ] **Step 5: Commit**

```bash
git add lib/utils/screen-wall.ts tests/app/screen-wall.test.js
git commit -m "feat(screens): each screen's state per platform, why a shot is stale, how it went live"
```

---

### Task 5: Counts, gaps, the lens and each cell's word

**Files:**
- Modify: `lib/utils/screen-wall.ts`
- Test: `tests/app/screen-wall.test.js`

- [ ] **Step 1: Write the failing tests**

Append to the end of `tests/app/screen-wall.test.js`, after one blank line:

```js
// --- Counts, gaps, lens and words (spec § Counts and gaps) -----------------

const shotAt = (ts) => ({ ts, source: "ci", form: "url" });
const COUNT_NODES = [
  flow("F-count", "Count", [V("V-1"), V("V-2"), V("V-1"), V("V-3"), V("V-4")]),
  view("V-1", "One", {
    metadata: {
      platformScreenshots: { web: "https://x/1w.png", android: "https://x/1a.png" },
      platformScreenshotMeta: { web: shotAt(T0) },
    },
  }),
  view("V-2", "Two", { platforms: ["web", "ios"], metadata: { platformScreenshots: { web: "https://x/2w.png" }, platformScreenshotMeta: { web: shotAt(T2) } } }),
  view("V-3", "Three", { status: "development" }),
  view("V-4", "Four", { platforms: ["web"] }),
];
const COUNT_EVENTS = [toLive("e-1-web", "V-1", T1, { platform: "web", actor: "alexis" })];

{
  const {
    countStrip, isGapCell, isGapFrame, gapCount, resolveLens, lensPlatforms, cellWord, stripCountsLine,
  } = wallModule;
  const wall = wallOf({ nodes: COUNT_NODES, events: COUNT_EVENTS, productId: "app" });
  const strip = wall.strips[0];
  const states = (viewId) => wall.platforms.map((p) => wall.screens.get(viewId).cells[p].state);
  check("count fixture: the states the counts below read",
    same(states("V-1"), ["live-stale", "live-no-shot", "live-current"]) &&
      same(states("V-2"), ["live-current", "live-no-shot", "absent"]) &&
      same(states("V-3"), ["not-live", "not-live", "not-live"]) &&
      same(states("V-4"), ["live-no-shot", "absent", "absent"]),
    show(["V-1", "V-2", "V-3", "V-4"].map(states)));

  check("countStrip on one platform: distinct views; on excludes absent; stale and no-shot pairs",
    same(countStrip(wall, strip, "web"), { views: 4, perPlatform: { web: { on: 4, live: 3 } }, stale: 1, noShot: 1 }),
    show(countStrip(wall, strip, "web")));
  check("countStrip side by side: every platform, pairs summed",
    same(countStrip(wall, strip, "side"), {
      views: 4,
      perPlatform: { web: { on: 4, live: 3 }, ios: { on: 3, live: 2 }, android: { on: 2, live: 1 } },
      stale: 1,
      noShot: 3,
    }),
    show(countStrip(wall, strip, "side")));

  check("stripCountsLine: live over on, then the non-zero stale and no-shot counts",
    stripCountsLine(wall, strip, "web") === "3/4 live on Web · 1 stale · 1 without a shot" &&
      stripCountsLine(wall, strip, "ios") === "2/3 live on iOS · 2 without a shot" &&
      stripCountsLine(wall, strip, "android") === "1/2 live on Android",
    show(["web", "ios", "android"].map((lens) => stripCountsLine(wall, strip, lens))));
  check("stripCountsLine side by side: per platform, then the totals",
    stripCountsLine(wall, strip, "side") === "Web 3/4 · iOS 2/3 · Android 1/2 · 1 stale · 3 without a shot",
    stripCountsLine(wall, strip, "side"));

  check("isGapCell: live-stale and live-no-shot only",
    ["live-stale", "live-no-shot"].every((state) => isGapCell({ state })) &&
      ["live-current", "not-live", "absent"].every((state) => !isGapCell({ state })));
  check("isGapFrame: a gap on any lens platform",
    isGapFrame(wall, "V-1", "web") && !isGapFrame(wall, "V-1", "android") && isGapFrame(wall, "V-2", "side") && !isGapFrame(wall, "V-3", "side"));
  check("isGapFrame: false for a view not on the wall", !isGapFrame(wall, "V-missing", "side"));
  check("gapCount: distinct (view, lens platform) pairs, a repeated view once",
    gapCount(wall, "web") === 2 && gapCount(wall, "ios") === 2 && gapCount(wall, "android") === 0 && gapCount(wall, "side") === 4,
    show(["web", "ios", "android", "side"].map((lens) => gapCount(wall, lens))));

  check("lensPlatforms: the lens, or every wall platform side by side",
    same(lensPlatforms(wall, "ios"), ["ios"]) && same(lensPlatforms(wall, "side"), ["web", "ios", "android"]));

  check("resolveLens: a stored platform or side is kept when the wall has it",
    resolveLens("ios", wall) === "ios" && resolveLens("side", wall) === "side");
  check("resolveLens: nothing stored is the first platform", resolveLens(null, wall) === "web");
  const twoPlatforms = wallOf({ nodes: COUNT_NODES, products: [{ id: "app", platforms: ["ios", "android"] }], productId: "app" });
  check("resolveLens: a platform the scope lacks falls back to the first",
    same(twoPlatforms.platforms, ["ios", "android"]) && resolveLens("web", twoPlatforms) === "ios");
  const onePlatform = wallOf({ nodes: COUNT_NODES, products: [{ id: "app", platforms: ["ios"] }], productId: "app" });
  check("resolveLens: one platform is that platform, whatever is stored",
    resolveLens("side", onePlatform) === "ios" && resolveLens("web", onePlatform) === "ios");
  const noPlatforms = wallOf({ nodes: COUNT_NODES, products: [{ id: "app", platforms: [] }], productId: "app" });
  check("resolveLens: an empty menu reads as web", same(noPlatforms.platforms, []) && resolveLens(null, noPlatforms) === "web");

  check("cellWord: the side-by-side word for every state",
    cellWord({ state: "live-current", status: "live" }) === "Live" &&
      cellWord({ state: "live-stale", status: "live" }) === "Stale" &&
      cellWord({ state: "live-no-shot", status: "live" }) === "No shot" &&
      cellWord({ state: "not-live", status: null }) === "Unset" &&
      cellWord({ state: "not-live", status: "releasing" }) === "Releasing" &&
      cellWord({ state: "not-live", status: "archived" }) === "Archived" &&
      cellWord({ state: "absent", status: "live" }) === "Absent");
}
```

- [ ] **Step 2: Run the suite to verify it fails**

Run: `npm run test:screen-wall`
Expected: 61 PASS lines (the 60 before and the count fixture's states), then `TypeError: countStrip is not a function`, exit 1.

- [ ] **Step 3: Write the counts**

Append to the end of `lib/utils/screen-wall.ts`, after one blank line:

```ts
/* --- Counts, gaps, lens (spec § Counts and gaps) -------------------------- */

/** [lens] for a platform lens; wall.platforms for "side". */
export function lensPlatforms(wall: Wall, lens: WallLens): PlatformId[] {
  return lens === "side" ? [...wall.platforms] : [lens];
}

/** A gap: live with a stale shot, or live with no shot. */
export function isGapCell(cell: PlatformCell): boolean {
  return cell.state === "live-stale" || cell.state === "live-no-shot";
}

export function isGapFrame(wall: Wall, viewId: string, lens: WallLens): boolean {
  const screen = wall.screens.get(viewId);
  if (!screen) return false;
  return lensPlatforms(wall, lens).some((platform) => {
    const cell = screen.cells[platform];
    return cell !== undefined && isGapCell(cell);
  });
}

/** Distinct (view, lens platform) pairs that are gaps, over the whole wall. */
export function gapCount(wall: Wall, lens: WallLens): number {
  let count = 0;
  for (const screen of wall.screens.values()) {
    for (const platform of lensPlatforms(wall, lens)) {
      const cell = screen.cells[platform];
      if (cell !== undefined && isGapCell(cell)) count += 1;
    }
  }
  return count;
}

export function countStrip(wall: Wall, strip: WallStrip, lens: WallLens): StripCounts {
  const counts: StripCounts = { views: strip.viewIds.length, perPlatform: {}, stale: 0, noShot: 0 };
  for (const platform of lensPlatforms(wall, lens)) {
    const tally = { on: 0, live: 0 };
    for (const viewId of strip.viewIds) {
      const cell = wall.screens.get(viewId)?.cells[platform];
      if (!cell || cell.state === "absent") continue;
      tally.on += 1;
      if (cell.state === "not-live") continue;
      tally.live += 1;
      if (cell.state === "live-stale") counts.stale += 1;
      if (cell.state === "live-no-shot") counts.noShot += 1;
    }
    counts.perPlatform[platform] = tally;
  }
  return counts;
}

/**
 * The lens to render: with fewer than two platforms, the only one (web for an
 * empty menu); otherwise the stored lens when the wall has it, else the first.
 */
export function resolveLens(stored: WallLens | null, wall: Wall): WallLens {
  if (wall.platforms.length < 2) return wall.platforms[0] ?? "web";
  if (stored === "side" || (stored !== null && wall.platforms.includes(stored))) return stored;
  return wall.platforms[0];
}

/** The truth table's side-by-side word: "Live" | "Stale" | "No shot" | "Unset" | "Absent" | a status label. */
export function cellWord(cell: PlatformCell): string {
  switch (cell.state) {
    case "live-current":
      return "Live";
    case "live-stale":
      return "Stale";
    case "live-no-shot":
      return "No shot";
    case "absent":
      return "Absent";
    case "not-live":
      return cell.status === null ? "Unset" : STATUSES.find((entry) => entry.id === cell.status)?.label ?? cell.status;
  }
}

/** R9 header text: "3/5 live on iOS · 1 stale · 2 without a shot", or "Web 3/5 · iOS 4/5 · …" for "side". */
export function stripCountsLine(wall: Wall, strip: WallStrip, lens: WallLens): string {
  const counts = countStrip(wall, strip, lens);
  const tally = (platform: PlatformId) => counts.perPlatform[platform] ?? { on: 0, live: 0 };
  const parts =
    lens === "side"
      ? lensPlatforms(wall, lens).map((platform) => `${platformLabel(platform)} ${tally(platform).live}/${tally(platform).on}`)
      : [`${tally(lens).live}/${tally(lens).on} live on ${platformLabel(lens)}`];
  if (counts.stale > 0) parts.push(`${counts.stale} stale`);
  if (counts.noShot > 0) parts.push(`${counts.noShot} without a shot`);
  return parts.join(" · ");
}
```

- [ ] **Step 4: Run the suite to verify it passes**

Run: `npm run test:screen-wall && npx tsc --noEmit && npx eslint lib/utils/screen-wall.ts`
Expected: 76 PASS lines and no FAIL, exit 0; no type errors; no lint output.

- [ ] **Step 5: Commit**

```bash
git add lib/utils/screen-wall.ts tests/app/screen-wall.test.js
git commit -m "feat(screens): strip counts, gaps, the lens and each cell's word"
```

---

### Task 6: The layout, and the time budget

**Files:**
- Create: `lib/utils/screen-wall-layout.ts`
- Modify: `tests/app/load-screen-wall.js`
- Test: `tests/app/screen-wall.test.js`

**Trap:** the alias table. The layout imports `@/lib/config/platforms`, `@/lib/utils/journey-layout` and `@/lib/utils/screen-wall` (all type-only, erased by the transpiler); all three are already in the loader's `SPECIFIER_MAP`. The module is added to `MODULES` here, and its exports to the loader's return value.

- [ ] **Step 1: Load the layout and write the failing tests**

In `tests/app/load-screen-wall.js`, replace

```js
  ["lib/utils/screen-wall.ts", "screen-wall"],
```

with

```js
  ["lib/utils/screen-wall.ts", "screen-wall"],
  ["lib/utils/screen-wall-layout.ts", "screen-wall-layout"],
```

and replace

```js
    ...require(path.join(BUILD_DIR, "screen-wall.js")),
```

with

```js
    ...require(path.join(BUILD_DIR, "screen-wall.js")),
    ...require(path.join(BUILD_DIR, "screen-wall-layout.js")),
```

Append to the end of `tests/app/screen-wall.test.js`, after one blank line:

```js
// --- Layout (spec § Layout) -------------------------------------------------

{
  const L = wallModule;
  check("layout constants",
    same(
      [L.FRAME_H, L.CAPTION_GAP, L.CAPTION_H, L.FRAME_NODE_H, L.FRAME_MIN_W, L.ASPECT_MIN, L.ASPECT_MAX, L.ITEM_GAP, L.ARM_W, L.END_W,
        L.JUMP_W, L.JUMP_H, L.JUMP_Y, L.EMPTY_W, L.HEADER_H, L.HEADER_GAP, L.HEADER_MIN_W, L.STRIP_GAP, L.LOOSE_PER_ROW, L.ROW_GAP,
        L.SIDE_ROW_GAP, L.SIDE_TAG_W, L.SIDE_WORD_W, L.CHIP_W, L.CHIP_H, L.CHIP_GAP, L.CHIP_MAX, L.CHIP_OFFSET, L.LOD_ZOOM],
      [280, 8, 36, 324, 144, 0.3, 2.4, 24, 24, 12, 144, 96, 92, 280, 44, 12, 360, 72, 8, 40, 6, 28, 72, 220, 28, 6, 8, 16, 0.35],
    ) && same(L.DEFAULT_ASPECT, { web: 1.6, ios: 0.4615, android: 0.45 }));
  check("clampAspect: into [ASPECT_MIN, ASPECT_MAX]", L.clampAspect(0.1) === 0.3 && L.clampAspect(3) === 2.4 && L.clampAspect(1) === 1);

  const noAspect = () => undefined;
  const wall = wallOf({ nodes: ORDER_NODES, edges: ORDER_EDGES, productId: "app" });
  const web = L.layoutWall(wall, "web", noAspect);
  const box = (layout, id) => layout.boxes.find((b) => b.id === id);
  const pick = (b) => [b.kind, b.x, b.y, b.width, b.height, b.row, b.shotWidth];

  check("boxes: each strip's header, then its items, strip by strip",
    same(web.boxes.map((b) => b.id), wall.strips.flatMap((strip) => [strip.id, ...strip.items.map((item) => item.id)])));
  check("a header box is the strip id, at the strip's y, as wide as the strip",
    same(pick(box(web, "strip:F-a")), ["header", 0, 0, 2464, 44, 0, null]), show(box(web, "strip:F-a")));
  check("web frame: 448 box, items under the header",
    same(pick(box(web, "V-a@F-a:0")), ["frame", 0, 56, 448, 324, 0, 448]), show(box(web, "V-a@F-a:0")));
  check("jump tile: 144 × 96, centred on the box",
    same(pick(box(web, "jump:F-a:1")), ["jump", 472, 148, 144, 96, 0, null]), show(box(web, "jump:F-a:1")));
  check("arm and end markers: FRAME_H tall, top-aligned",
    same(pick(box(web, "arm:F-a:2.0")), ["arm", 640, 56, 24, 280, 0, null]) &&
      same(pick(box(web, "end:F-a:2.0.1")), ["end", box(web, "end:F-a:2.0.1").x, 56, 12, 280, 0, null]));
  check("strip rect: content width, one row tall",
    same(web.strips.get("strip:F-a"), { x: 0, y: 0, width: 2464, height: 380 }), show(web.strips.get("strip:F-a")));
  check("one-row pitch is 452", web.strips.get("strip:F-c").y === 452 && web.strips.get("strip:F-d").y === 904);
  check("a header is at least HEADER_MIN_W", box(web, "strip:F-c").width === 360 && web.strips.get("strip:F-c").width === 360);
  check("the empty item: 280 wide, FRAME_H tall", same(pick(box(web, "empty:F-d")), ["empty", 0, 960, 280, 280, 0, null]));

  const ios = L.layoutWall(wall, "ios", noAspect);
  const android = L.layoutWall(wall, "android", noAspect);
  check("iOS and Android defaults: 129 and 126 boxes in 144 nodes",
    same(pick(box(ios, "V-a@F-a:0")), ["frame", 0, 56, 144, 324, 0, 129]) && same(pick(box(android, "V-a@F-a:0")), ["frame", 0, 56, 144, 324, 0, 126]));
  const side = L.layoutWall(wall, "side", noAspect);
  check("side by side, three platforms: 257", same(pick(box(side, "V-a@F-a:0")), ["frame", 0, 56, 257, 324, 0, 257]));
  check("the lens changes widths, never the vertical rhythm",
    [ios, android, side].every((layout) => same(layout.boxes.map((b) => [b.y, b.height]), web.boxes.map((b) => [b.y, b.height]))) &&
      [...ios.strips.values()].every((rect, i) => rect.y === [...web.strips.values()][i].y));
  const last = [...web.strips.values()].pop();
  check("bounds: the widest strip, down to the last strip's bottom",
    same(web.bounds, { x: 0, y: 0, width: Math.max(...[...web.strips.values()].map((r) => r.width)), height: last.y + last.height }));

  const twoWall = wallOf({ nodes: ORDER_NODES, edges: ORDER_EDGES, products: [{ id: "app", platforms: ["web", "ios"], root_node_id: "V-home" }], productId: "app" });
  check("side by side, web + iOS: 333", box(L.layoutWall(twoWall, "side", noAspect), "V-a@F-a:0").width === 333);
  check("sideGeometry: row height and minis at n = 2 and n = 3",
    same(L.sideGeometry(twoWall, "V-a", noAspect), { rowHeight: 137, miniWidths: { web: 219, ios: 63 }, shotWidth: 333 }) &&
      L.sideGeometry(wall, "V-a", noAspect).rowHeight === 268 / 3 &&
      same(L.sideGeometry(wall, "V-a", noAspect).miniWidths, { web: 143, ios: 41, android: 40 }),
    show([L.sideGeometry(twoWall, "V-a", noAspect), L.sideGeometry(wall, "V-a", noAspect)]));

  const looseWall = wallOf({ nodes: Array.from({ length: 10 }, (_, i) => view(`V-${String(i).padStart(2, "0")}`, `View ${i}`)), productId: "app" });
  const loose = L.layoutWall(looseWall, "web", noAspect);
  check("Not in a flow wraps after eight frames",
    same(pick(box(loose, "V-07@loose")), ["frame", 7 * 472, 56, 448, 324, 0, 448]) &&
      same(pick(box(loose, "V-08@loose")), ["frame", 0, 420, 448, 324, 1, 448]) &&
      same(loose.strips.get("strip:loose"), { x: 0, y: 0, width: 8 * 448 + 7 * 24, height: 744 }),
    show(loose.strips.get("strip:loose")));

  const counted = wallOf({ nodes: COUNT_NODES, events: COUNT_EVENTS, productId: "app" });
  const measured = (viewId, platform) =>
    ({ "V-1|web": 5, "V-1|android": 0.5, "V-2|web": 1, "V-3|web": 0.5, "V-4|web": 0.5 })[`${viewId}|${platform}`];
  const sized = L.layoutWall(counted, "web", measured);
  check("a measured aspect sizes a frame with a shot; clamped; ignored without a shot",
    box(sized, "V-2@F-count:1").shotWidth === 280 && box(sized, "V-1@F-count:0").shotWidth === 672 &&
      box(sized, "V-3@F-count:3").shotWidth === 448 && box(sized, "V-4@F-count:4").shotWidth === 448);
  const tiny = L.layoutWall(counted, "web", () => 0.1);
  check("a clamped narrow shot stays centred in a FRAME_MIN_W node",
    box(tiny, "V-2@F-count:1").shotWidth === 84 && box(tiny, "V-2@F-count:1").width === 144);
  check("side by side: each mini keeps its own aspect, the widest sets the box",
    same(L.sideGeometry(counted, "V-1", measured).miniWidths, { web: 214, ios: 41, android: 45 }) &&
      L.sideGeometry(counted, "V-1", measured).shotWidth === 328);

  const empty = L.layoutWall(wallOf({ nodes: [], productId: null }), "web", noAspect);
  check("an empty wall lays out nothing", empty.boxes.length === 0 && empty.strips.size === 0 && same(empty.bounds, { x: 0, y: 0, width: 0, height: 0 }));
}

// --- Time budget (spec § Performance 1) -------------------------------------

{
  for (const name of ["pebbles.json", "arkaik-self-map.json"]) {
    const { input } = seedWall(name);
    const lens = "web";
    wallModule.layoutWall(buildWall(input), lens, () => undefined); // warm-up, not timed
    const runs = 20;
    const start = performance.now();
    for (let i = 0; i < runs; i += 1) wallModule.layoutWall(buildWall(input), lens, () => undefined);
    const mean = (performance.now() - start) / runs;
    check(`${name}: buildWall + layoutWall under 25 ms on average (${mean.toFixed(2)} ms)`, mean < 25);
  }
}
```

- [ ] **Step 2: Run the suite to verify it fails**

Run: `npm run test:screen-wall`
Expected: `Error: ENOENT: no such file or directory, open '…/lib/utils/screen-wall-layout.ts'` from `loadScreenWall`, exit 1.

- [ ] **Step 3: Write the layout**

Create `lib/utils/screen-wall-layout.ts`:

```ts
import type { PlatformId } from "@/lib/config/platforms";
import type { Rect } from "@/lib/utils/journey-layout";
import type { Wall, WallItem, WallLens } from "@/lib/utils/screen-wall";

/**
 * The Screens map's layout (docs/superpowers/specs/2026-11-11-screens-map-design.md
 * § Layout): strips stacked top to bottom, each a header over one row of items
 * left to right ("Not in a flow" wraps). Computed directly — no ELK — and
 * synchronously, so a lens change or a measured shot re-lays the wall in one
 * pass. All values are px in flow coordinates.
 */

export type { Rect } from "@/lib/utils/journey-layout";

/** Height of every frame's shot box. */
export const FRAME_H = 280;
/** Caption under the box: title line + state line. */
export const CAPTION_GAP = 8;
export const CAPTION_H = 36;
/** Box + caption: 324. */
export const FRAME_NODE_H = FRAME_H + CAPTION_GAP + CAPTION_H;
/** A frame node is never narrower; the box centres in it. */
export const FRAME_MIN_W = 144;
/** Width / height before a shot loads, and for ghosts. */
export const DEFAULT_ASPECT: Record<PlatformId, number> = { web: 1.6, ios: 0.4615, android: 0.45 };
/** Clamp on measured aspects. */
export const ASPECT_MIN = 0.3;
export const ASPECT_MAX = 2.4;
/** Between consecutive items in a strip. */
export const ITEM_GAP = 24;
/** Marker widths; both are FRAME_H tall, top-aligned with boxes. */
export const ARM_W = 24;
export const END_W = 12;
/** Jump tile, centred on the box: (FRAME_H − JUMP_H) / 2 = JUMP_Y. */
export const JUMP_W = 144;
export const JUMP_H = 96;
export const JUMP_Y = 92;
/** The empty-flow ghost, FRAME_H tall. */
export const EMPTY_W = 280;
/** Strip header and the space under it. */
export const HEADER_H = 44;
export const HEADER_GAP = 12;
/** A header is as wide as its strip, at least this. */
export const HEADER_MIN_W = 360;
/** Between one strip's last row and the next header. */
export const STRIP_GAP = 72;
/** Only "Not in a flow" wraps. */
export const LOOSE_PER_ROW = 8;
export const ROW_GAP = 40;
/** Between platform rows in a side-by-side frame. */
export const SIDE_ROW_GAP = 6;
/** Platform tag column, state word column. */
export const SIDE_TAG_W = 28;
export const SIDE_WORD_W = 72;
/** Touch chips. */
export const CHIP_W = 220;
export const CHIP_H = 28;
export const CHIP_GAP = 6;
export const CHIP_MAX = 8;
/** Chips start this far below the selected frame node. */
export const CHIP_OFFSET = 16;
/** Below this zoom, frames drop images and captions. */
export const LOD_ZOOM = 0.35;

/** The gaps around a side-by-side mini: after the tag column, before the word column. */
const SIDE_TAG_GAP = 6;
const SIDE_WORD_GAP = 8;

export type WallBoxKind = "header" | "frame" | "arm" | "end" | "jump" | "empty";

export interface WallBox extends Rect {
  id: string;
  kind: WallBoxKind;
  stripId: string;
  row: number;
  /** Frames only: the shot box width (≤ width, centred in it); null for every other kind. */
  shotWidth: number | null;
}

export interface WallLayout {
  /** Strip by strip, item by item: the DOM and Tab order. */
  boxes: WallBox[];
  strips: ReadonlyMap<string, Rect>;
  bounds: Rect;
}

/** Measured width / height of a loaded shot, or undefined. */
export type AspectOf = (viewId: string, platform: PlatformId) => number | undefined;

export function clampAspect(aspect: number): number {
  return Math.min(ASPECT_MAX, Math.max(ASPECT_MIN, aspect));
}

/** The aspect a mini or a box is drawn at: the measured one while the cell shows a shot, else the platform default. */
function aspectFor(wall: Wall, viewId: string, platform: PlatformId, aspectOf: AspectOf): number {
  const cell = wall.screens.get(viewId)?.cells[platform];
  if (cell?.shot && cell.state !== "absent") {
    const measured = aspectOf(viewId, platform);
    if (measured !== undefined && Number.isFinite(measured) && measured > 0) return clampAspect(measured);
  }
  return DEFAULT_ASPECT[platform];
}

/** Side-by-side geometry of one frame, n = wall.platforms.length (spec § Layout). */
export function sideGeometry(
  wall: Wall,
  viewId: string,
  aspectOf: AspectOf,
): { rowHeight: number; miniWidths: Partial<Record<PlatformId, number>>; shotWidth: number } {
  const n = Math.max(1, wall.platforms.length);
  const rowHeight = (FRAME_H - (n - 1) * SIDE_ROW_GAP) / n;
  const miniWidths: Partial<Record<PlatformId, number>> = {};
  let widest = 0;
  for (const platform of wall.platforms) {
    const width = Math.round(rowHeight * aspectFor(wall, viewId, platform, aspectOf));
    miniWidths[platform] = width;
    widest = Math.max(widest, width);
  }
  return { rowHeight, miniWidths, shotWidth: SIDE_TAG_W + SIDE_TAG_GAP + widest + SIDE_WORD_GAP + SIDE_WORD_W };
}

function frameShotWidth(wall: Wall, viewId: string, lens: WallLens, aspectOf: AspectOf): number {
  if (lens === "side") return sideGeometry(wall, viewId, aspectOf).shotWidth;
  return Math.round(FRAME_H * aspectFor(wall, viewId, lens, aspectOf));
}

/** An item's size and its offset from the top of its row. */
function itemBox(
  item: WallItem,
  wall: Wall,
  lens: WallLens,
  aspectOf: AspectOf,
): { width: number; height: number; dy: number; shotWidth: number | null } {
  switch (item.kind) {
    case "frame": {
      const shotWidth = frameShotWidth(wall, item.viewId, lens, aspectOf);
      return { width: Math.max(shotWidth, FRAME_MIN_W), height: FRAME_NODE_H, dy: 0, shotWidth };
    }
    case "jump":
      return { width: JUMP_W, height: JUMP_H, dy: JUMP_Y, shotWidth: null };
    case "arm":
      return { width: ARM_W, height: FRAME_H, dy: 0, shotWidth: null };
    case "end":
      return { width: END_W, height: FRAME_H, dy: 0, shotWidth: null };
    case "empty":
      return { width: EMPTY_W, height: FRAME_H, dy: 0, shotWidth: null };
  }
}

/**
 * Positions for every header and item. Strips start at x = 0; the header sits
 * at the strip's y, items `HEADER_H + HEADER_GAP` below it, advancing by width
 * + `ITEM_GAP`. The lens changes widths, never the vertical rhythm.
 */
export function layoutWall(wall: Wall, lens: WallLens, aspectOf: AspectOf): WallLayout {
  const boxes: WallBox[] = [];
  const strips = new Map<string, Rect>();
  let y = 0;
  let maxWidth = 0;

  wall.strips.forEach((strip, index) => {
    if (index > 0) y += STRIP_GAP;
    const top = y;
    const itemsTop = top + HEADER_H + HEADER_GAP;
    const wraps = strip.flowId === null;
    const header: WallBox = { id: strip.id, kind: "header", stripId: strip.id, row: 0, x: 0, y: top, width: HEADER_MIN_W, height: HEADER_H, shotWidth: null };
    boxes.push(header);

    let x = 0;
    let row = 0;
    let inRow = 0;
    let contentWidth = 0;
    for (const item of strip.items) {
      if (wraps && inRow === LOOSE_PER_ROW) {
        row += 1;
        inRow = 0;
        x = 0;
      }
      const rowTop = itemsTop + row * (FRAME_NODE_H + ROW_GAP);
      const { width, height, dy, shotWidth } = itemBox(item, wall, lens, aspectOf);
      boxes.push({ id: item.id, kind: item.kind, stripId: strip.id, row, x, y: rowTop + dy, width, height, shotWidth });
      contentWidth = Math.max(contentWidth, x + width);
      x += width + ITEM_GAP;
      inRow += 1;
    }

    const rows = row + 1;
    const width = Math.max(contentWidth, HEADER_MIN_W);
    const height = HEADER_H + HEADER_GAP + rows * FRAME_NODE_H + (rows - 1) * ROW_GAP;
    header.width = width;
    strips.set(strip.id, { x: 0, y: top, width, height });
    maxWidth = Math.max(maxWidth, width);
    y = top + height;
  });

  return { boxes, strips, bounds: { x: 0, y: 0, width: maxWidth, height: y } };
}
```

- [ ] **Step 4: Run the suite to verify it passes**

Run: `npm run test:screen-wall && npx tsc --noEmit && npx eslint lib/utils/screen-wall-layout.ts`
Expected: 100 PASS lines and no FAIL, ending with the two time-budget lines (`pebbles.json: buildWall + layoutWall under 25 ms on average (… ms)`; about 1 ms each on a laptop), exit 0; no type errors; no lint output.

- [ ] **Step 5: Commit**

```bash
git add lib/utils/screen-wall-layout.ts tests/app/load-screen-wall.js tests/app/screen-wall.test.js
git commit -m "feat(screens): lay the wall out — strip rows, frame widths per lens, side-by-side geometry"
```

---

### Task 7: The camera, the next screen, the touch chips

**Files:**
- Modify: `lib/utils/screen-wall-layout.ts`
- Test: `tests/app/screen-wall.test.js`

- [ ] **Step 1: Write the failing tests**

Append to the end of `tests/app/screen-wall.test.js`, after one blank line:

```js
// --- Camera, keyboard neighbours, chips (spec § Layout helpers) -----------

{
  const L = wallModule;
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  const nearView = (actual, expected) => ["x", "y", "zoom"].every((key) => near(actual[key], expected[key]));
  const viewport = { width: 1000, height: 800 };
  const options = { padding: 32, bottomInset: 72, minZoom: 0.4, maxZoom: 1 };

  const fits = L.frameViewport({ x: 100, y: 200, width: 400, height: 300 }, viewport, options);
  check("frameViewport: a rect that fits is centred above the bottom inset, at maxZoom", nearView(fits, { x: 200, y: 14, zoom: 1 }), show(fits));
  const between = L.frameViewport({ x: 0, y: 0, width: 1200, height: 400 }, viewport, options);
  check("frameViewport: zoom is the tighter of the two fits", nearView(between, { x: 32, y: (728 - 400 * 0.78) / 2, zoom: 0.78 }), show(between));
  const wide = L.frameViewport({ x: 0, y: 452, width: 5000, height: 380 }, viewport, options);
  check("frameViewport: a strip wider than the view starts at the left edge, at minZoom",
    nearView(wide, { x: 32, y: (728 - 380 * 0.4) / 2 - 452 * 0.4, zoom: 0.4 }), show(wide));
  const tall = L.frameViewport({ x: 10, y: 100, width: 300, height: 2000 }, viewport, options);
  check("frameViewport: a rect taller than the view starts at the top edge",
    nearView(tall, { x: (1000 - 300 * 0.4) / 2 - 10 * 0.4, y: 32 - 100 * 0.4, zoom: 0.4 }), show(tall));

  const wall = wallOf({ nodes: ORDER_NODES, edges: ORDER_EDGES, productId: "app" });
  const layout = L.layoutWall(wall, "web", () => undefined);
  const move = (id, dir) => L.neighbourFrame(layout, id, dir);
  check("neighbourFrame: right and left skip markers and jump tiles",
    move("V-a@F-a:0", "right") === "V-b@F-a:2.0.0" && move("V-b@F-a:2.0.0", "left") === "V-a@F-a:0");
  check("neighbourFrame: null at a row's ends", move("V-a@F-a:0", "left") === null && move("V-a@F-a:3", "right") === null);
  check("neighbourFrame: down skips strips with no frames, to the nearest centre", move("V-a@F-a:0", "down") === "V-d@F-e:0");
  check("neighbourFrame: up to the nearest centre in the previous row", move("V-d@F-e:0", "up") === "V-a@F-a:0");
  check("neighbourFrame: null above the first row and below the last",
    move("V-a@F-a:0", "up") === null && move("V-home@loose", "down") === null);
  check("neighbourFrame: null for anything but a frame", move("jump:F-a:1", "right") === null && move("nope", "down") === null);

  const looseWall = wallOf({ nodes: Array.from({ length: 10 }, (_, i) => view(`V-${String(i).padStart(2, "0")}`, `View ${i}`)), productId: "app" });
  const looseLayout = L.layoutWall(looseWall, "web", () => undefined);
  check("neighbourFrame: wrapped rows are rows",
    L.neighbourFrame(looseLayout, "V-02@loose", "down") === "V-09@loose" && L.neighbourFrame(looseLayout, "V-09@loose", "up") === "V-01@loose");

  const frame = { id: "V-a@F-a:0", kind: "frame", stripId: "strip:F-a", row: 0, x: 100, y: 56, width: 448, height: 324, shotWidth: 448 };
  check("chipRects: a column at the frame's x, CHIP_OFFSET below it",
    same(L.chipRects(frame, 3), [
      { x: 100, y: 396, width: 220, height: 28 },
      { x: 100, y: 430, width: 220, height: 28 },
      { x: 100, y: 464, width: 220, height: 28 },
    ]) && same(L.chipRects(frame, 0), []),
    show(L.chipRects(frame, 3)));
}
```

- [ ] **Step 2: Run the suite to verify it fails**

Run: `npm run test:screen-wall`
Expected: 100 PASS lines, then `TypeError: L.frameViewport is not a function`, exit 1.

- [ ] **Step 3: Write the helpers**

Append to the end of `lib/utils/screen-wall-layout.ts`, after one blank line:

```ts
/* --- Camera, keyboard neighbours, chips ------------------------------------ */

/**
 * The viewport that shows `rect`: zoom = clamp(min((W − 2p) / w, (H − 2p −
 * bottomInset) / h), minZoom, maxZoom). On each axis the rect is centred in
 * the space above the bottom inset, or start-aligned (left, top) at the
 * padding when it overflows that space at this zoom.
 */
export function frameViewport(
  rect: Rect,
  viewport: { width: number; height: number },
  options: { padding: number; bottomInset: number; minZoom: number; maxZoom: number },
): { x: number; y: number; zoom: number } {
  const { padding, bottomInset, minZoom, maxZoom } = options;
  const roomW = viewport.width - 2 * padding;
  const roomH = viewport.height - 2 * padding - bottomInset;
  const fit = Math.min(roomW / rect.width, roomH / rect.height);
  const zoom = Math.min(maxZoom, Math.max(minZoom, fit));
  const w = rect.width * zoom;
  const h = rect.height * zoom;
  const x = w > roomW ? padding - rect.x * zoom : (viewport.width - w) / 2 - rect.x * zoom;
  const y = h > roomH ? padding - rect.y * zoom : (viewport.height - bottomInset - h) / 2 - rect.y * zoom;
  return { x, y, zoom };
}

/**
 * The arrow-key neighbour among frames only: left/right within the row;
 * up/down to the frame in the previous/next row (or strip) whose centre x is
 * nearest, skipping rows with no frame. null at the edges, and for an id that
 * is not a frame.
 */
export function neighbourFrame(layout: WallLayout, frameId: string, dir: "left" | "right" | "up" | "down"): string | null {
  const rows: WallBox[][] = [];
  let rowKey: string | null = null;
  for (const box of layout.boxes) {
    if (box.kind !== "frame") continue;
    const key = `${box.stripId}\u0000${box.row}`;
    if (key !== rowKey) {
      rows.push([]);
      rowKey = key;
    }
    rows[rows.length - 1].push(box);
  }

  const rowIndex = rows.findIndex((row) => row.some((box) => box.id === frameId));
  if (rowIndex < 0) return null;
  const row = rows[rowIndex];
  const current = row.find((box) => box.id === frameId)!;

  if (dir === "left" || dir === "right") {
    const index = row.indexOf(current);
    return row[dir === "left" ? index - 1 : index + 1]?.id ?? null;
  }

  const target = rows[dir === "up" ? rowIndex - 1 : rowIndex + 1];
  if (!target) return null;
  const centre = current.x + current.width / 2;
  let best = target[0];
  for (const box of target) {
    if (Math.abs(box.x + box.width / 2 - centre) < Math.abs(best.x + best.width / 2 - centre)) best = box;
  }
  return best.id;
}

/** Chip rects under a frame node: a column at the frame's x, `CHIP_OFFSET` below it. */
export function chipRects(frame: WallBox, count: number): Rect[] {
  const rects: Rect[] = [];
  for (let index = 0; index < count; index += 1) {
    rects.push({
      x: frame.x,
      y: frame.y + frame.height + CHIP_OFFSET + index * (CHIP_H + CHIP_GAP),
      width: CHIP_W,
      height: CHIP_H,
    });
  }
  return rects;
}
```

- [ ] **Step 4: Run the suite to verify it passes**

Run: `npm run test:screen-wall && npx tsc --noEmit && npx eslint lib/utils/screen-wall-layout.ts`
Expected: 112 PASS lines and no FAIL, exit 0; no type errors; no lint output.

- [ ] **Step 5: Commit**

```bash
git add lib/utils/screen-wall-layout.ts tests/app/screen-wall.test.js
git commit -m "feat(screens): frame the camera, find the next screen, place touch chips"
```

---

## Part done when

On `feat/screens-model`, alone (no part above it checked out), each of these passes:

```bash
npm run lint                         # 0 errors (main's 3 warnings in PlatformVariants.tsx / ShotPreviewDialog.tsx stay)
npx tsc --noEmit                     # no output
npm run generate && git status --porcelain   # prints nothing: no generator input changed
npm run test:screen-wall             # 112 PASS, exit 0
npm run test:screenshot-staleness    # 29 PASS, exit 0
npm run test:journey-graph           # unchanged, exit 0
actionlint                           # if installed; no output
npm run build                        # CI's typecheck; succeeds
```

`git diff --stat main...HEAD` lists the spec, the contract, the five part plans and exactly these ten files: `.github/workflows/ci.yml`, `.gitignore`, `package.json`, `lib/hooks/useScreenshotStaleness.ts`, `lib/utils/screenshot-staleness.ts`, `lib/utils/screen-wall.ts`, `lib/utils/screen-wall-layout.ts`, `tests/app/load-screen-wall.js`, `tests/app/screen-wall.test.js`, `tests/app/screenshot-staleness.test.js`.

**PR:** open it as the bottom of the stack with `gh stack` (the `gh-stack` skill drives the commands).

- Title: `feat(screens): the wall model and the shared staleness rule (part 1/5)`
- Body: what the part adds (the three modules and their tests), that nothing imports the wall yet, and that the staleness hook's behaviour is unchanged until part 2 passes related ids. **No `## Lab Note` section.**
- Label: `no-lab-note` (nothing a user sees changes).
- After opening, read the PR's comments: the Lab Note reminder must be satisfied by the label, and CI must be green on the new "Screens wall model tests" step.
