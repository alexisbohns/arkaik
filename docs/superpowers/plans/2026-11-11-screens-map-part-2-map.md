# Screens map — Part 2: the map, single lens — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A third built-in map, Screens, lays every flow in scope out as a strip of its screens and shows each screen's real screenshot for one platform at a time, with ghost frames that say why a shot is missing — listed in the sidebar, the Overview, the maps index and ⌘K — and the node panel's "may be stale" caption starts counting moves on the acceptances that cover a view.

**Architecture:** The `screens` kind and its built-in definition land in `@arkaik/schema` (selection: every scoped flow and view, no edge, root ignored). The app draws it with the Journey/System split: `ScreensMap` (controller: data hooks, part 1's `buildWall` + `layoutWall`, the lens from `useDisplayPreferences`, camera requests, panel wiring, empty and notice states) renders `ScreensCanvas` (layout boxes → React Flow nodes → `Canvas`), which hosts `WallCamera` as a `Canvas` child. `Canvas` gains four optional props whose defaults keep today's behaviour, and four node types (`wallFrame`, `wallHeader`, `wallMarker`, `wallJump`). Measured shot proportions live in a module-level cache read through `useSyncExternalStore`. The panel's staleness caption passes `stalenessRelatedIds` per platform through a fourth hook argument.

**Tech Stack:** TypeScript, Next.js 16 App Router, React 19 (React Compiler lint rules), `@xyflow/react` 12.10, Tailwind v4 (container queries), lucide-react, plain Node test scripts; Playwright for the manual check only.

**Spec:** `docs/superpowers/specs/2026-11-11-screens-map-design.md`

**Contract:** `docs/superpowers/plans/2026-11-11-screens-map-stack.md` (authoritative where it and the spec differ)

**Branch:** `feat/screens-map`, created with the `gh-stack` skill on top of `feat/screens-model`.

**Position in the stack:** part 2 of 5. Part 1 (`feat/screens-model`) is below: this plan calls its `buildWall`, `resolveLens`, `stripIdOf`, `stripCountsLine`, `cellWord`, `layoutWall`, `frameViewport`, the layout constants, `STALENESS_EVENT_TYPES` and `stalenessRelatedIds` by the contract's names and never edits `lib/utils/screen-wall*.ts` or `lib/utils/screenshot-staleness.ts`. Parts 3 (`feat/screens-side-gaps`), 4 (`feat/screens-inspect`) and 5 (`feat/screens-palette`) stack on top and extend the files created here.

---

## Contract deviations

None changes a shared name or signature. Five things the other parts should know:

1. **`components/maps/MapCard.tsx` is modified** (one icon entry), though the contract's part 2 file map does not list it. The maps index card picks its glyph from a `KIND_ICONS` record keyed by kind; without a `screens` entry the index would show the generic map glyph while the sidebar, the Overview and ⌘K show `GalleryHorizontalEndIcon`. No other part touches this file.
2. **Fields the contract tags (3) or (4) are absent in part 2** — in `ScreensBarProps` (`gapsOnly`, `gapCount`, `onGapsOnlyChange`), `ScreensCanvasProps` (`gapsOnly`, `selection`, `onPaneClick`, `onFrameMove`), the node data types (`dimmed`, `dimmedRows`, `selected`, `onMove`) and `WallSelection`. This applies the contract's own node-data rule ("added by that part as required fields, in the same commit as the builder that fills them") to the two props interfaces as well: a prop nothing passes would compile and do nothing. Every part-2 field is present with the contract's name and type, so parts 3 and 4 only add.
3. **`jumpToFlow(flowId: string): void`** (the coordinator's addition, needed by part 5) is the controller's jump-tile behaviour, declared as `const jumpToFlow = useCallback(…)` in `ScreensMap`, above every early return, and passed as `ScreensCanvas`'s `onJump`. `selectFrame` is left to part 4.
4. **The bar's visibility rule** is written `platformAvailabilityShape(wall.platforms) === "rings"` rather than `wall.platforms.length >= 2`: the same boundary, asked of the one function the repo keeps it in (`tests/app/product-scope.test.js` pins that habit for the panel).
5. **The manual check's "20 wheel steps from the first strip to the last"** cannot pan: the canvas zooms on the wheel (`zoomOnScroll`, `Canvas`'s default) and the contract fixes `Canvas`'s new props. The script therefore travels with 10 zoom-out steps anchored on the first strip and 10 zoom-in steps anchored on the wall's lowest row — first strip to last, by the wheel — and asserts it ends on "Not in a flow".

## Repo facts this plan relies on (checked at `2f697cd` and rehearsed)

- **React Flow switches pointer events off** on a node that is not selectable, not draggable and has no node handler (`node_modules/@xyflow/react/dist/esm/index.mjs:2135`, `:2231`). Every wall node is built that way, so the frame's root, the header's button and link and the jump tile carry `pointer-events-auto`; without it no click reaches them. Markers keep `none`, so a drag over them pans.
- **Tailwind reads `_` as a space inside an arbitrary variant**: `[&_.react-flow__minimap]` compiles to `.react-flow  minimap` and matches nothing. The narrow-canvas rules use `[class*=minimap]` and `[class*=controls]`, with the important modifier (`hidden!`), because React Flow's stylesheet is unlayered and its `display: flex` on the controls beats any layered utility.
- **An element cannot query itself** as a container: `ScreensCanvas`'s wrapper is `@container` for whatever later nests in it, and its own `@max-[…]` rules resolve against the controller's `@container`, the same box.
- `MapEditorDialog` does not read `MAP_KINDS` (`components/maps/MapEditorDialog.tsx:57`, `:67`), so widening the kinds keeps the editor on journey and system with no edit there.
- `computeMapCounts` sends every non-journey kind through `computeMapSubgraph` (`lib/utils/journey-graph.ts:757-762`), so the maps index and the Overview count Screens correctly once `KIND_DEFAULTS.screens` exists — no change in `journey-graph.ts`.
- `npm run generate` after the schema change rewrites exactly six files; after a new lucide import, exactly two (listed per task below, observed in the rehearsal).
- No new test script, CI step or `.gitignore` line: part 2 extends existing suites only (part 1 owns `test:screen-wall`, its CI step and its build-dir entry).

---

## File map

**Created**

- `components/maps/ScreensMap.tsx` — the controller.
- `components/maps/screens/ScreensBar.tsx` — the bottom bar (platform lens).
- `components/maps/screens/aspect-cache.ts` — measured shot proportions, per tab.
- `components/graph/ScreensCanvas.tsx` — boxes → React Flow nodes → `Canvas`.
- `components/graph/WallCamera.tsx` — applies camera requests inside `<ReactFlow>`.
- `components/graph/nodes/wall-node-data.ts` — node data types.
- `components/graph/nodes/WallShot.tsx` — one shot or ghost; `useWallDetail` (LOD).
- `components/graph/nodes/WallFrameNode.tsx`, `WallHeaderNode.tsx`, `WallMarkerNode.tsx`, `WallJumpNode.tsx`.

**Modified**

- `packages/schema/src/maps.ts` — `MapKind`, `MAP_KINDS`, `KIND_DEFAULTS.screens`, `BUILT_IN_MAP_IDS`, `BUILT_IN_MAPS[2]`, step 3 exception.
- `packages/schema/src/bundle.ts` — the four `MapDefinitionSchema` descriptions (`:281`, `:287`, `:290`, `:293`).
- `docs/spec/maps.md` — kind union, defaults row, reserved ids, Storage note, counts sentence, step 3 exception, Built-in Maps row.
- `app/project/[id]/maps/[mapId]/page.tsx` — `kind === "screens"` → `<ScreensMap>`.
- `app/project/[id]/maps/page.tsx` — `builtIn = isBuiltInMapId(definition.id)`.
- `components/maps/MapCard.tsx` — `screens` kind icon (Contract deviation 1).
- `components/overview/MapsCard.tsx`, `components/layout/ProjectSidebar.tsx` — the Screens icon and sidebar item (after System, no hotkey).
- `lib/utils/command-palette.ts`, `components/layout/CommandPalette.tsx` — `map-screens`, icon id `"screens"`.
- `components/graph/Canvas.tsx` — four optional props, four node types.
- `lib/hooks/useDisplayPreferences.ts` — `screensLens`.
- `lib/hooks/useScreenshotStaleness.ts` — fourth argument `relatedIds`.
- `components/panels/NodeDetailPanel.tsx` — the memo, the section prop, the hook call.

**Tests modified:** `tests/schema/maps.test.js`, `tests/mcp/run-mcp-tests.js`, `tests/app/command-palette.test.js`, `tests/app/screen-wall.test.js` (a section appended to part 1's suite).

**`package.json`, `.github/workflows/ci.yml`, `.gitignore`:** unchanged.

**Regenerated and committed** (`npm run generate`; CI's "Fail on generated-artifact drift" diffs them):

- Task 1 (schema): `public/schema/project-bundle.json`, `docs/arkaik-skill/scripts/validate-bundle.js`, `docs/arkaik-skill/references/schema.md`, `lib/prompts/generated/schema.ts`, `plugin/skills/arkaik/references/schema.md`, `plugin/skills/arkaik/scripts/validate-bundle.js`. Nothing under `plugin-kritik/` or `lib/landing/generated/` changes.
- Task 3 (`GalleryHorizontalEndIcon`, new to the registry): `lib/wobble/wobble-registry.generated.ts`, `app/wobble.generated.css` (one line each, `gallery-horizontal-end`).
- Task 8 (`ClockIcon`, new to the registry): the same two files (one line each, `clock`). Every other icon this part imports (`CircleDashedIcon`, `FolderTreeIcon`, `ImageOffIcon`, `ChevronRightIcon`, `TriangleAlertIcon`, the platform and species glyphs) is already registered.

---

### Task 1: The `screens` kind and the built-in Screens map

**Files:**
- Modify: `packages/schema/src/maps.ts`, `packages/schema/src/bundle.ts`
- Test: `tests/schema/maps.test.js`, `tests/mcp/run-mcp-tests.js`, `tests/app/screen-wall.test.js`
- Generated: the six schema artifacts (File map)

**Traps:** `MapKind` is a closed union and `KIND_DEFAULTS` is a `Record<MapKind, …>`: the kind and its defaults land in the same edit or `tsc` fails. The schema feeds generated artifacts: run `npm run generate` and commit its output in this task. Never `require` a `.ts` file in a test (CI is Node 20).

- [ ] **Step 1: Write the failing tests**

In `tests/schema/maps.test.js`, inside the `// --- resolveMapDefaults` block, insert directly before `  const explicit = resolveMapDefaults({ id: "x", title: "X", kind: "system", species: ["view"] });`:

```js
  const screens = resolveMapDefaults({ id: "screens", title: "Screens", kind: "screens" });
  assert(
    JSON.stringify(screens.species) === JSON.stringify(["flow", "view"]) && screens.edge_types.length === 0,
    "resolveMapDefaults: screens defaults to flow+view and no edge type",
  );

```

Insert this block directly before the line `// --- computeMapSubgraph: generic passthrough --------------------------------`:

```js
// --- computeMapSubgraph: the screens kind -----------------------------------
// A wall lists every flow and view in scope; it has no anchor to walk from, so
// step 3 never runs for it — not for the built-in, not for a stored definition
// that carries a root anyway.
{
  const screens = computeMapSubgraph({ id: "screens", title: "Screens", kind: "screens" }, nodes, edges);
  assert(
    JSON.stringify(ids(screens.nodes)) === JSON.stringify(["F-a", "V-b", "V-c"]) && screens.edges.length === 0,
    "screens subgraph keeps flows and views, and no edge",
  );

  const anchored = computeMapSubgraph(
    { id: "screens-anchored", title: "S", kind: "screens", root_node_id: "V-c", depth: 0 },
    nodes,
    edges,
  );
  assert(
    JSON.stringify(ids(anchored.nodes)) === JSON.stringify(["F-a", "V-b", "V-c"]) && anchored.edges.length === 0,
    "a screens definition ignores root_node_id and depth — the selection stays unbounded",
  );

  const dangling = computeMapSubgraph(
    { id: "screens-dangling", title: "S", kind: "screens", root_node_id: "V-nope" },
    nodes,
    edges,
  );
  assert(
    JSON.stringify(ids(dangling.nodes)) === JSON.stringify(["F-a", "V-b", "V-c"]),
    "…and an unresolvable root on a screens definition empties nothing",
  );
}

```

In the `// --- listMaps` block, make four replacements.

Replace:

```js
  assert(isBuiltInMapId("journey") && isBuiltInMapId("system") && !isBuiltInMapId("custom"), "isBuiltInMapId");
```

with:

```js
  assert(
    isBuiltInMapId("journey") && isBuiltInMapId("system") && isBuiltInMapId("screens") && !isBuiltInMapId("custom"),
    "isBuiltInMapId",
  );
```

Replace:

```js
        { id: "journey", title: "Shadow", kind: "journey" }, // reserved — skipped
```

with:

```js
        { id: "journey", title: "Shadow", kind: "journey" }, // reserved — skipped
        { id: "screens", title: "Shadow screens", kind: "journey" }, // reserved — skipped
```

Replace `JSON.stringify(["journey", "system", "custom", "weird"])` with `JSON.stringify(["journey", "system", "screens", "custom", "weird"])`, and `JSON.stringify(["journey", "system"])` with `JSON.stringify(["journey", "system", "screens"])`.

Replace:

```js
  assert(BUILT_IN_MAPS.length === 2, "two built-in maps");
```

with:

```js
  assert(BUILT_IN_MAPS.length === 3, "three built-in maps");
  const screensMap = BUILT_IN_MAPS[2];
  assert(
    screensMap?.id === "screens" &&
      screensMap?.title === "Screens" &&
      screensMap?.kind === "screens" &&
      screensMap?.description === "What is live, screen by screen — every flow as a strip of its screenshots." &&
      screensMap?.root_node_id === undefined,
    "the third built-in is Screens, kind screens, with no anchor",
  );
```

In `tests/mcp/run-mcp-tests.js`, replace:

```js
    maps.body?.maps.length === 4 && maps.body.maps.some((entry) => entry.definition.id === "onboarding"),
```

with:

```js
    maps.body?.maps.length === 5 &&
      maps.body.maps.some((entry) => entry.definition.id === "onboarding") &&
      maps.body.maps.some((entry) => entry.definition.id === "screens"),
```

and insert directly before the line `  // Audience symmetry (issue #319): a product-scoped map answers the same`:

```js
  // The Screens map's subgraph is every flow and view, and no edge: the wall
  // model that draws strips is app-side, `get_map` serves the kind's selection.
  const screensMap = await callTool("get_map", { map_id: "screens" });
  check(
    "get_map screens returns the flows and views and no edge",
    JSON.stringify((screensMap.body?.nodes ?? []).map((node) => node.id).sort()) ===
      JSON.stringify(["F-onboard", "V-profile", "V-welcome"]) && screensMap.body?.edges.length === 0,
    `screens map: ${JSON.stringify((screensMap.body?.nodes ?? []).map((node) => node.id))} / ${screensMap.body?.edges.length} edges`,
  );

```

Append to the **end** of `tests/app/screen-wall.test.js` (part 1's suite reads its verdict in an `exit` listener, so sections append; this one uses part 1's top-level `check(name, cond, detail)`, `readSeed(name)`, `wallModule`, `buildWall`, `resolveProductScope` and `buildProductGraph`, and part 1's loader already returns `computeMapCounts`):

```js

// --- Map counts: the index and the Overview count what the wall draws ------
// (Screens map stack, part 2.) The screens kind selects every scoped flow and
// view and no edge, so its card count is exactly the wall's flow strips plus
// its screens — under every scope, including Pebbles' Admin product, which has
// views and no flow.
{
  const SCREENS = { id: "screens", title: "Screens", kind: "screens" };
  const bundle = readSeed("pebbles.json");
  const graph = buildProductGraph(bundle.nodes, bundle.edges);
  for (const productId of [null, "admin", "app"]) {
    const scope = resolveProductScope(bundle, productId);
    const wall = buildWall({
      nodes: bundle.nodes,
      edges: bundle.edges,
      events: [],
      project: bundle.project,
      definition: SCREENS,
      scope,
      graph,
    });
    const flows = wall.strips.filter((strip) => strip.flowId !== null).length;
    const counts = wallModule.computeMapCounts(SCREENS, {
      dataNodes: bundle.nodes,
      dataEdges: bundle.edges,
      project: bundle.project,
      scope,
      graph,
    });
    check(
      `computeMapCounts(screens) under ${productId ?? "All products"} = the wall's flows + views, 0 edges`,
      counts.nodes === flows + wall.screens.size && counts.edges === 0,
      `${counts.nodes} nodes / ${counts.edges} edges vs ${flows} flows + ${wall.screens.size} views`,
    );
  }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:maps`
Expected: FAIL, exit 1, nine `FAIL:` lines — `resolveMapDefaults: screens defaults…`, the three `screens subgraph`/`screens definition` lines, `isBuiltInMapId`, both `listMaps` lines, `three built-in maps`, `the third built-in is Screens…` — and `9 maps test(s) failed.`

Run: `npm run test:screen-wall`
Expected: FAIL, exit 1, three lines `FAIL: computeMapCounts(screens) under … — 0 nodes / 0 edges vs …` (All products: `vs 10 flows + 58 views`; admin: `vs 0 flows + 4 views`; app: `vs 10 flows + 54 views`).

Run: `npm run test:mcp`
Expected: FAIL on `list_maps returns built-ins + stored definitions with counts` (4 maps) and `get_map screens returns the flows and views and no edge`.

- [ ] **Step 3: Write the kind, the defaults and the built-in**

In `packages/schema/src/maps.ts`, replace:

```ts
/** Known renderer kinds (docs/spec/maps.md § MapDefinition). */
export type MapKind = "journey" | "system";

export const MAP_KINDS: readonly MapKind[] = ["journey", "system"];
```

with:

```ts
/** Known renderer kinds (docs/spec/maps.md § MapDefinition). */
export type MapKind = "journey" | "system" | "screens";

export const MAP_KINDS: readonly MapKind[] = ["journey", "system", "screens"];
```

Replace:

```ts
  system: { species: ["view", "api-endpoint", "data-model"], edge_types: ["calls", "displays", "queries"] },
};
```

with:

```ts
  system: { species: ["view", "api-endpoint", "data-model"], edge_types: ["calls", "displays", "queries"] },
  // A wall of screens: every flow gets a strip and every view a frame; no edge
  // is drawn (the strips are the playlists, read app-side by the wall model).
  screens: { species: ["flow", "view"], edge_types: [] },
};
```

Replace `export const BUILT_IN_MAP_IDS = ["journey", "system"] as const;` with `export const BUILT_IN_MAP_IDS = ["journey", "system", "screens"] as const;`.

Replace:

```ts
    layout: { algorithm: "organic" },
  },
];
```

with:

```ts
    layout: { algorithm: "organic" },
  },
  {
    id: "screens",
    title: "Screens",
    description: "What is live, screen by screen — every flow as a strip of its screenshots.",
    kind: "screens",
  },
];
```

In `computeMapSubgraph`'s doc comment, replace:

```ts
 * 3. When `root_node_id` resolves to a surviving node: undirected BFS from it
 *    through the surviving edges, bounded by `depth` when present; keep the
 *    visited nodes and the surviving edges among them.
```

with:

```ts
 * 3. When `root_node_id` resolves to a surviving node: undirected BFS from it
 *    through the surviving edges, bounded by `depth` when present; keep the
 *    visited nodes and the surviving edges among them. A `screens` definition
 *    skips this step: a wall has no anchor and no edges to walk, so its
 *    `root_node_id` and `depth` are ignored and the selection stays unbounded.
```

and in its body replace:

```ts
  const rootId = definition.root_node_id;
  if (rootId === undefined) {
```

with:

```ts
  const rootId = definition.root_node_id;
  if (rootId === undefined || definition.kind === "screens") {
```

In `packages/schema/src/bundle.ts` (`MapDefinitionSchema`), make four replacements:

- `"Kebab-case, unique within the project; built-in ids (journey, system) are reserved."` → `"Kebab-case, unique within the project; built-in ids (journey, system, screens) are reserved."`
- `"Map kind: journey | system. Selects the renderer and selection defaults; unrecognized kinds are preserved and listed as unrenderable."` → `"Map kind: journey | system | screens. Selects the renderer and selection defaults; unrecognized kinds are preserved and listed as unrenderable."`
- `"Node filter; defaults by kind (journey: flow+view; system: view+api-endpoint+data-model)."` → `"Node filter; defaults by kind (journey: flow+view; system: view+api-endpoint+data-model; screens: flow+view)."`
- `"Edge filter; defaults by kind (journey: composes; system: calls+displays+queries)."` → `"Edge filter; defaults by kind (journey: composes; system: calls+displays+queries; screens: none)."`

- [ ] **Step 4: Run the tests, regenerate, check the drift set**

Run: `npm run test:maps && npm run test:screen-wall && npm run test:mcp && npm run test:schema && npm run validate:seeds && npx tsc --noEmit`
Expected: `All maps tests passed.`; every screen-wall line `PASS` (the three counts lines included), exit 0; the MCP harness prints `PASS: list_maps returns built-ins + stored definitions with counts` and `PASS: get_map screens returns the flows and views and no edge`, exit 0; `All 15 parity tests passed.`; three `Result: VALID`; no type errors (`MapEditorDialog` still compiles: it never reads `MAP_KINDS`).

Run: `npm run generate && git status --porcelain`
Expected: modified, and nothing else beyond this task's own source and test files: `docs/arkaik-skill/references/schema.md`, `docs/arkaik-skill/scripts/validate-bundle.js`, `lib/prompts/generated/schema.ts`, `plugin/skills/arkaik/references/schema.md`, `plugin/skills/arkaik/scripts/validate-bundle.js`, `public/schema/project-bundle.json`. The type blocks now read `type MapKind = "journey" | "system" | "screens";`.

Between this task and Task 12 a Screens map is listed but opens on the "unrecognized kind" card, and until Task 4 the index offers it Edit and Delete. Both close inside this branch; nothing ships before the PR.

- [ ] **Step 5: Commit**

```bash
git add packages/schema/src/maps.ts packages/schema/src/bundle.ts tests/schema/maps.test.js tests/mcp/run-mcp-tests.js tests/app/screen-wall.test.js public/schema/project-bundle.json docs/arkaik-skill/scripts/validate-bundle.js docs/arkaik-skill/references/schema.md lib/prompts/generated/schema.ts plugin/skills/arkaik/references/schema.md plugin/skills/arkaik/scripts/validate-bundle.js
git commit -m "feat(schema): the screens kind and the built-in Screens map"
```

---

### Task 2: The maps spec names the third kind

**Files:**
- Modify: `docs/spec/maps.md`

- [ ] **Step 1: Edit the spec**

Replace:

```ts
  kind: "journey" | "system";    // selects the renderer and the defaults below
```

with:

```ts
  kind: "journey" | "system" | "screens"; // selects the renderer and the defaults below
```

In the "Defaults by kind" row, replace the row's tail:

```markdown
`system`: `species: ["view","api-endpoint","data-model"]`, `edge_types: ["calls","displays","queries"]` |
```

with:

```markdown
`system`: `species: ["view","api-endpoint","data-model"]`, `edge_types: ["calls","displays","queries"]`. `screens`: `species: ["flow","view"]`, `edge_types: []` |
```

In the "Reserved ids" row, replace:

```markdown
| Reserved ids | `journey` and `system` name the built-in maps every project has implicitly.
```

with:

```markdown
| Reserved ids | `journey`, `system` and `screens` name the built-in maps every project has implicitly.
```

In § Storage, replace:

```markdown
keyed by map id — built-in ids included, since `journey` and `system` have no
stored definition to carry a `display`.
```

with:

```markdown
keyed by map id — built-in ids included, since `journey` and `system` have no
stored definition to carry a `display`.

The Screens map stores nothing in either place. Its display choice — the
platform lens — belongs to the person reading, not to the product, so it is kept
per viewer in the browser (`localStorage["arkaik:display-prefs:<projectId>"]`,
read through `useDisplayPreferences`) and never written to the bundle or its
exports. It has no Display popover, and `map_display.screens` is never read.
```

In § Product Scope, replace:

```markdown
count each map through its own renderer — `computeMapSubgraph` for `system`, and for `journey` the
```

with:

```markdown
count each map through its own renderer — `computeMapSubgraph` for `system` and `screens` (whose
selection is exactly the flows and views the wall draws), and for `journey` the
```

In § Subgraph Algorithm, at the end of rule 3, replace:

```markdown
(A directed variant was considered and rejected for v1; a `direction` knob MAY be added later without breaking this contract.)
```

with:

```markdown
(A directed variant was considered and rejected for v1; a `direction` knob MAY be added later without breaking this contract.) **A `screens` definition skips this step:** a wall has no anchor and no edges to walk, so its `root_node_id` and `depth` are ignored and the selection is every flow and view step 0 kept — rule 4 never applies to it either.
```

In § Built-in Maps, add this row directly under the **System** row:

```markdown
| **Screens** | `screens` | "What is actually live, screen by screen?" | The app-side wall model (`lib/utils/screen-wall.ts`) over the kind's selection: one strip per flow in scope — the flows the Journey reaches first, in its order, then the rest in bundle order — each a row of frames in playlist order showing the lens platform's screenshot, or a ghost frame saying why there is none; sub-flows are jump tiles, branches thin markers, and views in no flow a final "Not in a flow" strip. Read-only: a frame opens the node panel. `get_map` serves the selection itself (every scoped flow and view, no edge) |
```

- [ ] **Step 2: Check and commit**

Run: `npm run test:docs-visibility && npm run test:docs-icons`
Expected: `All docs-visibility tests passed` and `All docs-icons tests passed` (the page keeps its front matter).

```bash
git add docs/spec/maps.md
git commit -m "docs(maps): the Screens kind, its defaults, and where its lens lives"
```

---

### Task 3: "Screens" in ⌘K

**Files:**
- Modify: `lib/utils/command-palette.ts`, `components/layout/CommandPalette.tsx`
- Test: `tests/app/command-palette.test.js`
- Generated: `lib/wobble/wobble-registry.generated.ts`, `app/wobble.generated.css`

**Traps:** `CommandIconId` is closed and `COMMAND_ICONS` is a `Record<CommandIconId, …>`: both change in this commit or `tsc` fails. `command-palette.ts` stays import-free (its loader transpiles that one file). `GalleryHorizontalEndIcon` is new to the wobble registry: regenerate.

- [ ] **Step 1: Write the failing test**

In `tests/app/command-palette.test.js`, add `  "/project/proj-1/maps/screens",` to `expectedHrefs` directly after `  "/project/proj-1/maps/system",`.

Replace:

```js
// Keyword hits: a synonym finds the page even though no label contains it.
assert(topLabel("screens") === "Views", `"screens" → Views (got ${topLabel("screens")})`);
```

with:

```js
// The Screens map owns its own name: an exact label (10000) outranks the
// Library Views command's "screens" keyword (9000).
assert(topLabel("screens") === "Screens", `"screens" → Screens (got ${topLabel("screens")})`);
assert(topLabel("screenshots") === "Screens", `"screenshots" → Screens (got ${topLabel("screenshots")})`);
assert(
  commandById("map-screens")?.target.href === "/project/proj-1/maps/screens" &&
    commandById("map-screens")?.icon === "screens" &&
    commandById("map-screens")?.group === "maps",
  "map-screens is a Maps command with its own icon, landing on /maps/screens",
);
assert(
  commands.findIndex((command) => command.id === "map-screens") ===
    commands.findIndex((command) => command.id === "map-system") + 1,
  "Screens sits right after System, as in the sidebar",
);

// Keyword hits: a synonym finds the page even though no label contains it.
assert(topLabel("pages") === "Views", `"pages" → Views (got ${topLabel("pages")})`);
```

Replace:

```js
const viaKeyword = rankCommands(commands, "screens")[0];
assert(
  viaKeyword.highlight.length === 0,
```

with:

```js
const viaKeyword = rankCommands(commands, "pages")[0];
assert(
  viaKeyword.command.id === "library-view" && viaKeyword.highlight.length === 0,
```

Replace `  completionSuffix("screen", rankCommands(commands, "screen")[0]) === "s",` with `  completionSuffix("page", rankCommands(commands, "page")[0]) === "s",`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:command-palette`
Expected: FAIL, exit 1 — `FAIL: catalogue reaches /project/proj-1/maps/screens`, `FAIL: "screens" → Screens (got Views)`, `FAIL: "screenshots" → Screens (got undefined)`, `FAIL: map-screens is a Maps command…`, `FAIL: Screens sits right after System…`, then `5 test(s) failed`. The three moved probes (`"pages"`, the keyword highlight, `"page"` → `s`) already pass.

- [ ] **Step 3: Add the command and its icon**

In `lib/utils/command-palette.ts`:

- In the header comment replace `(its label, or the synonym the user is actually typing — "screens" → Views).` with `(its label, or the synonym the user is actually typing — "pages" → Views).`
- In `CommandIconId` insert `  | "screens"` directly after `  | "system"`.
- In `PaletteCommand.keywords`' comment replace `so "screens" completes to "screens". */` with `so "page" completes to "pages". */`.
- In `buildProjectCommands`, directly after the `map-system` entry's closing `},`, insert:

```ts
    {
      id: "map-screens",
      label: "Screens",
      group: "maps",
      icon: "screens",
      keywords: ["screens map", "screenshots", "wall", "shots"],
      hint: "What is live, screen by screen",
      target: { kind: "href", href: `${base}/maps/screens` },
    },
```

In `components/layout/CommandPalette.tsx`, add `  GalleryHorizontalEndIcon,` to the `lucide-react` import directly after `  FolderOpenIcon,`, and in `COMMAND_ICONS` insert `  screens: GalleryHorizontalEndIcon,` directly after `  system: NetworkIcon,`.

- [ ] **Step 4: Run the test, typecheck, regenerate**

Run: `npm run test:command-palette && npx tsc --noEmit && npx eslint lib/utils/command-palette.ts components/layout/CommandPalette.tsx`
Expected: `All command palette tests passed`, no type errors, no lint output.

Run: `npm run generate && git status --porcelain`
Expected: besides the three files above, exactly `app/wobble.generated.css` (`+.lucide-gallery-horizontal-end { filter: url(#wob-gallery-horizontal-end); }`) and `lib/wobble/wobble-registry.generated.ts` (`+  { name: "gallery-horizontal-end", seed: 12 },`).

- [ ] **Step 5: Commit**

```bash
git add lib/utils/command-palette.ts components/layout/CommandPalette.tsx tests/app/command-palette.test.js lib/wobble/wobble-registry.generated.ts app/wobble.generated.css
git commit -m "feat(palette): Screens in the Maps group"
```

---

### Task 4: The maps index, the Overview card and the sidebar

**Files:**
- Modify: `app/project/[id]/maps/page.tsx`, `components/maps/MapCard.tsx`, `components/overview/MapsCard.tsx`, `components/layout/ProjectSidebar.tsx`

- [ ] **Step 1: The index decides "built-in" from the schema**

In `app/project/[id]/maps/page.tsx`, replace:

```tsx
import { buildProductUsageIndex, listMaps, MAP_KINDS, type MapDefinition } from "@arkaik/schema";
```

with:

```tsx
import { buildProductUsageIndex, isBuiltInMapId, listMaps, MAP_KINDS, type MapDefinition } from "@arkaik/schema";
```

and replace:

```tsx
            const builtIn = definition.id === "journey" || definition.id === "system";
```

with:

```tsx
            // The schema's reserved set, not a list of names here: a third
            // built-in once got Edit and Delete from a hard-coded pair.
            const builtIn = isBuiltInMapId(definition.id);
```

- [ ] **Step 2: One icon everywhere**

In `components/maps/MapCard.tsx`, replace:

```tsx
import { NetworkIcon, PencilIcon, RouteIcon, Trash2Icon, MapIcon } from "lucide-react";
```

with:

```tsx
import { GalleryHorizontalEndIcon, NetworkIcon, PencilIcon, RouteIcon, Trash2Icon, MapIcon } from "lucide-react";
```

and in `KIND_ICONS` insert `  screens: GalleryHorizontalEndIcon,` directly after `  system: NetworkIcon,`.

In `components/overview/MapsCard.tsx`, replace:

```tsx
import { MapIcon, MapPinnedIcon, NetworkIcon, RouteIcon, type LucideIcon } from "lucide-react";
```

with:

```tsx
import { GalleryHorizontalEndIcon, MapIcon, MapPinnedIcon, NetworkIcon, RouteIcon, type LucideIcon } from "lucide-react";
```

and in `mapIcon` insert `  if (definition.id === "screens") return GalleryHorizontalEndIcon;` directly after `  if (definition.id === "system") return NetworkIcon;`.

In `components/layout/ProjectSidebar.tsx`, add `  GalleryHorizontalEndIcon,` to the `lucide-react` import directly after `  BookOpenIcon,`, then directly after the System item — the `</SidebarMenuItem>` that closes the block containing `<span>System</span>` — insert:

```tsx
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                isActive={currentView === "maps" && currentMapId === "screens"}
                tooltip="Screens map"
              >
                <Link href={`${mapsHref}/screens`}>
                  <GalleryHorizontalEndIcon />
                  <span>Screens</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
```

No `ShortcutHint` and no `followOptionClick`: the System item has neither, and no `nav-*` route names this map (`tests/app/keyboard-shortcuts.test.js:227-245` stays as it is).

- [ ] **Step 3: Check**

Run: `npx tsc --noEmit && npx eslint "app/project/[id]/maps/page.tsx" components/maps/MapCard.tsx components/overview/MapsCard.tsx components/layout/ProjectSidebar.tsx && npm run test:keyboard-shortcuts`
Expected: no type errors, no lint output, `All keyboard shortcut tests passed`, exit 0.

Run: `npm run generate && git status --porcelain`
Expected: only the four files above (the icon was registered in Task 3).

- [ ] **Step 4: Commit**

```bash
git add "app/project/[id]/maps/page.tsx" components/maps/MapCard.tsx components/overview/MapsCard.tsx components/layout/ProjectSidebar.tsx
git commit -m "feat(maps): list Screens in the sidebar, the Overview and the index, as a built-in"
```

---

### Task 5: The lens is remembered per viewer

**Files:**
- Modify: `lib/hooks/useDisplayPreferences.ts`

**Trap:** a new required `DisplayPreferences` key lands with `DEFAULT_DISPLAY_PREFERENCES` and `read()` in the same edit, or `tsc` fails. No test loader transpiles this hook (checked with `git grep useDisplayPreferences -- tests`), so the new imports break nothing.

- [ ] **Step 1: Add `screensLens`**

Replace:

```ts
import { useCallback, useSyncExternalStore } from "react";
```

with:

```ts
import { useCallback, useSyncExternalStore } from "react";
import { PLATFORMS } from "@/lib/config/platforms";
import type { WallLens } from "@/lib/utils/screen-wall";
```

Replace:

```ts
export interface DisplayPreferences {
  acceptanceDisplay: AcceptanceDisplay;
  deliveryCardDisplay: DeliveryCardDisplay;
}

export const DEFAULT_DISPLAY_PREFERENCES: DisplayPreferences = {
  acceptanceDisplay: "rows",
  deliveryCardDisplay: "compact",
};
```

with:

```ts
export interface DisplayPreferences {
  acceptanceDisplay: AcceptanceDisplay;
  deliveryCardDisplay: DeliveryCardDisplay;
  /**
   * The Screens map's platform lens, as this reader last chose it; `null` until
   * they choose. Never rendered as-is: the map renders `resolveLens(stored,
   * wall)`, so a lens the current scope does not offer falls back without
   * anything being written back.
   */
  screensLens: WallLens | null;
}

export const DEFAULT_DISPLAY_PREFERENCES: DisplayPreferences = {
  acceptanceDisplay: "rows",
  deliveryCardDisplay: "compact",
  screensLens: null,
};
```

Directly after the `isDeliveryCardDisplay` function, insert:

```ts

/** A platform id only: "Side by side" is not a lens this build can draw. */
function isScreensLens(value: unknown): value is WallLens {
  return PLATFORMS.some((platform) => platform.id === value);
}
```

Replace `    const { acceptanceDisplay, deliveryCardDisplay } = parsed as Partial<DisplayPreferences>;` with `    const { acceptanceDisplay, deliveryCardDisplay, screensLens } = parsed as Partial<DisplayPreferences>;`, and replace:

```ts
      deliveryCardDisplay: isDeliveryCardDisplay(deliveryCardDisplay)
        ? deliveryCardDisplay
        : DEFAULT_DISPLAY_PREFERENCES.deliveryCardDisplay,
    };
```

with:

```ts
      deliveryCardDisplay: isDeliveryCardDisplay(deliveryCardDisplay)
        ? deliveryCardDisplay
        : DEFAULT_DISPLAY_PREFERENCES.deliveryCardDisplay,
      screensLens: isScreensLens(screensLens) ? screensLens : DEFAULT_DISPLAY_PREFERENCES.screensLens,
    };
```

- [ ] **Step 2: Check and commit**

Run: `npx tsc --noEmit && npx eslint lib/hooks/useDisplayPreferences.ts`
Expected: no output.

```bash
git add lib/hooks/useDisplayPreferences.ts
git commit -m "feat(prefs): remember the Screens lens per viewer"
```

---

### Task 6: The panel's caption counts covering acceptances

**Files:**
- Modify: `lib/hooks/useScreenshotStaleness.ts`, `components/panels/NodeDetailPanel.tsx`

**Traps:** source-asserting suites read `NodeDetailPanel.tsx`: `product-scope.test.js:555-620` reads the props of the first `<PlatformVariants` element (not touched here — the new prop goes on `<PlatformVariantsSection`), `panel-semantics` and `project-panels` read headings, groups and the History journal key (not touched). `lib/utils/screenshot-staleness.ts` is not edited (its loader rewrites only `@arkaik/schema`). `AcceptancePlatformsSection.tsx` keeps calling the hook with three arguments.

- [ ] **Step 1: The hook takes related ids per platform**

In `lib/hooks/useScreenshotStaleness.ts` (as part 1 left it: it imports `STALENESS_EVENT_TYPES` from `@/lib/utils/screenshot-staleness`), replace:

```ts
 * every open panel shares one cached fetch with any other reader of the same
 * projection.
 */
export function useScreenshotStaleness(
  nodeId: string,
  platforms: readonly PlatformId[],
  screenshotMeta: PlatformScreenshotMetaMap,
): Partial<Record<PlatformId, boolean>> {
```

with:

```ts
 * every open panel shares one cached fetch with any other reader of the same
 * projection.
 *
 * `relatedIds` names, per platform, the other nodes whose moves stale this
 * node's shot — for a view, the covering acceptances that speak to that
 * platform (`stalenessRelatedIds`), which is how a deploy or a merge recorded
 * on an acceptance reaches the view it covers. Omitted, the rule reads the
 * node's own events only, as the acceptance's Platforms section wants. It must
 * be referentially stable (memoised by the caller): it is a memo dependency.
 */
export function useScreenshotStaleness(
  nodeId: string,
  platforms: readonly PlatformId[],
  screenshotMeta: PlatformScreenshotMetaMap,
  relatedIds?: Partial<Record<PlatformId, readonly string[]>>,
): Partial<Record<PlatformId, boolean>> {
```

and replace:

```ts
      out[platform] = isScreenshotStale(screenshotMeta[platform], journal, nodeId, platform);
    }
    return out;
  }, [journal, nodeId, platforms, screenshotMeta]);
```

with:

```ts
      out[platform] = isScreenshotStale(
        screenshotMeta[platform],
        journal,
        nodeId,
        platform,
        relatedIds?.[platform],
      );
    }
    return out;
  }, [journal, nodeId, platforms, relatedIds, screenshotMeta]);
```

- [ ] **Step 2: The panel passes them**

In `components/panels/NodeDetailPanel.tsx`:

Replace `import { productOf } from "@arkaik/schema";` with `import { acceptancesCovering, productOf } from "@arkaik/schema";`.

Replace `import { useScreenshotStaleness } from "@/lib/hooks/useScreenshotStaleness";` with:

```tsx
import { useScreenshotStaleness } from "@/lib/hooks/useScreenshotStaleness";
import { stalenessRelatedIds } from "@/lib/utils/screenshot-staleness";
```

Replace:

```tsx
  onZoomShot?: (platform: PlatformId) => void;
}

function PlatformVariantsSection({ node, scope, initialPlatform, onUpdate, onScreenshot, onZoomShot }: PlatformVariantsSectionProps) {
```

with:

```tsx
  onZoomShot?: (platform: PlatformId) => void;
  /**
   * Per platform, the covering acceptances whose moves stale this view's shot
   * (`stalenessRelatedIds`) — the same rule the Screens map applies, so the
   * caption and the wall never disagree. Absent when the surface passes no
   * graph: the caption then reads the view's own events only.
   */
  staleRelatedIds?: Partial<Record<PlatformId, readonly string[]>>;
}

function PlatformVariantsSection({
  node,
  scope,
  initialPlatform,
  onUpdate,
  onScreenshot,
  onZoomShot,
  staleRelatedIds,
}: PlatformVariantsSectionProps) {
```

Replace `  const stale = useScreenshotStaleness(node.id, scope.platforms, screenshotMeta);` with `  const stale = useScreenshotStaleness(node.id, scope.platforms, screenshotMeta, staleRelatedIds);`.

In `NodeDetailPanel`, replace:

```tsx
  useEffect(() => {
    metadataRef.current = node.metadata;
  }, [node.metadata]);

  return (
```

with:

```tsx
  useEffect(() => {
    metadataRef.current = node.metadata;
  }, [node.metadata]);

  // A view's shot is also staled by moves on the acceptances covering it — a
  // deploy or a merge lands on those, never on the view — so the caption asks
  // the same question the Screens map does (`stalenessRelatedIds`). Only for a
  // view, and only with the whole graph: `acceptancesCovering` reads every
  // `covers` edge, and a surface that passes no graph keeps today's caption.
  const staleRelatedIds = useMemo(() => {
    if (node.species !== "view" || !allNodes || !allEdges) return undefined;
    const covering = acceptancesCovering(node.id, allNodes, allEdges);
    const byPlatform: Partial<Record<PlatformId, readonly string[]>> = {};
    for (const platform of scope.platforms) {
      byPlatform[platform] = stalenessRelatedIds(covering, platform);
    }
    return byPlatform;
  }, [allEdges, allNodes, node.id, node.species, scope.platforms]);

  return (
```

And on the `<PlatformVariantsSection` element, replace:

```tsx
            onZoomShot={onZoomShot ? (platform) => onZoomShot(node, platform) : undefined}
          />
        )}
        {node.species === "flow" && allNodes && allEdges && (
```

with:

```tsx
            onZoomShot={onZoomShot ? (platform) => onZoomShot(node, platform) : undefined}
            staleRelatedIds={staleRelatedIds}
          />
        )}
        {node.species === "flow" && allNodes && allEdges && (
```

- [ ] **Step 3: Check**

Run: `npx tsc --noEmit && npx eslint components/panels/NodeDetailPanel.tsx lib/hooks/useScreenshotStaleness.ts && npm run test:product-scope && npm run test:panel-semantics && npm run test:project-panels && npm run test:screenshot-staleness && npm run test:platform-variants-gates`
Expected: no type or lint output; `All product-scope tests passed`, `All panel-semantics tests passed`, `All project-panels tests passed`; `test:screenshot-staleness` and `test:platform-variants-gates` print only `PASS:` lines and exit 0. The browser half of this (a covered view's caption turning "may be stale") is Task 14's check.

- [ ] **Step 4: Commit**

```bash
git add lib/hooks/useScreenshotStaleness.ts components/panels/NodeDetailPanel.tsx
git commit -m "feat(panel): a view's shot goes stale when a covering acceptance moves"
```

---

### Task 7: `Canvas` hosts a wall, and `WallCamera` frames a rectangle

**Files:**
- Modify: `components/graph/Canvas.tsx`
- Create: `components/graph/WallCamera.tsx`

**Trap:** the surface keeps its box while panels open — the canvas narrows — so `WallCamera` waits 120ms after the last store width/height change, as `CameraFocus.tsx:19-41` does.

- [ ] **Step 1: Four optional props, defaults unchanged**

In `components/graph/Canvas.tsx`:

Replace `import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";` with `import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";`.

Replace:

```tsx
  /** The card a click selected: centred in the canvas once it has its final size. */
  focus?: CanvasFocus | null;
}
```

with:

```tsx
  /** The card a click selected: centred in the canvas once it has its final size. */
  focus?: CanvasFocus | null;
  /** A click on the empty pane, forwarded to React Flow. */
  onPaneClick?: (event: React.MouseEvent) => void;
  /**
   * Mount only the nodes and edges inside the viewport. Off by default; the
   * Screens map turns it on so an off-screen screenshot never makes a request.
   * Nodes then need `width`/`height` up front, or React Flow cannot tell
   * whether they are visible before it has measured them.
   */
  onlyRenderVisibleElements?: boolean;
  /**
   * Frame the whole graph on mount (React Flow's `fitView`). On by default; a
   * map that places its own first camera — the Screens map frames its first
   * strip — turns it off, or the whole wall would flash at unreadable zoom.
   */
  initialFit?: boolean;
  /**
   * Rendered inside `<ReactFlow>`, after `CameraFocus`: the slot for a camera
   * or overlay that needs React Flow's store (`WallCamera`).
   */
  children?: ReactNode;
}
```

Replace:

```tsx
  pin = null,
  focus = null,
}: CanvasProps) {
```

with:

```tsx
  pin = null,
  focus = null,
  onPaneClick,
  onlyRenderVisibleElements = false,
  initialFit = true,
  children,
}: CanvasProps) {
```

Replace:

```tsx
          style={flowStyle}
          fitView
          minZoom={0.05}
```

with:

```tsx
          style={flowStyle}
          fitView={initialFit}
          onlyRenderVisibleElements={onlyRenderVisibleElements}
          minZoom={0.05}
```

Replace `          onEdgeClick={readOnly ? undefined : onEdgeClick}` with:

```tsx
          onEdgeClick={readOnly ? undefined : onEdgeClick}
          onPaneClick={onPaneClick}
```

Replace `          <CameraFocus focus={focus} />` with:

```tsx
          <CameraFocus focus={focus} />
          {children}
```

- [ ] **Step 2: Write `WallCamera`**

Create `components/graph/WallCamera.tsx`:

```tsx
"use client";

import { useEffect, useRef } from "react";
import { useReactFlow, useStore } from "@xyflow/react";
import { frameViewport, type Rect } from "@/lib/utils/screen-wall-layout";

/** One camera move on the Screens map: show `rect`, zoom kept within [minZoom, maxZoom]. */
export interface WallCameraRequest {
  /** Changes once per request; each version applies once. */
  version: number;
  /** In flow coordinates: a strip, or a frame with its chip column. */
  rect: Rect;
  minZoom: number;
  maxZoom: number;
}

/** Space kept around the framed rect, in screen px (`frameViewport`'s `padding`). */
export const WALL_CAMERA_PADDING = 32;
/** The bottom bar's height plus its gap, kept clear under the rect (`frameViewport`'s `bottomInset`). */
export const WALL_BAR_INSET = 72;

/**
 * Applies the Screens map's camera requests: frames a rectangle — a strip, a
 * selected frame — where `CameraFocus` can only centre a node at the current
 * zoom. `CameraFocus`'s twin in timing: opening a panel narrows the canvas
 * right after the click, so each request waits 120ms after the last store
 * width/height change and then runs one animation, linear (d3's default
 * interpolation dips the zoom mid-flight). Under reduced motion it jumps.
 * Rendered inside `<ReactFlow>` (as a `Canvas` child) because the store hooks
 * need it.
 */
export function WallCamera({ request }: { request: WallCameraRequest | null }) {
  const reactFlow = useReactFlow();
  const width = useStore((state) => state.width);
  const height = useStore((state) => state.height);
  const handled = useRef(0);

  useEffect(() => {
    if (!request || request.version === handled.current || width === 0 || height === 0) return;
    const timer = setTimeout(() => {
      handled.current = request.version;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const viewport = frameViewport(
        request.rect,
        { width, height },
        {
          padding: WALL_CAMERA_PADDING,
          bottomInset: WALL_BAR_INSET,
          minZoom: request.minZoom,
          maxZoom: request.maxZoom,
        },
      );
      void reactFlow.setViewport(viewport, { duration: reduce ? 0 : 300, interpolate: "linear" });
    }, 120);
    return () => clearTimeout(timer);
  }, [height, reactFlow, request, width]);

  return null;
}
```

- [ ] **Step 3: Check**

Run: `npx tsc --noEmit && npx eslint components/graph/Canvas.tsx components/graph/WallCamera.tsx && npm run test:landing && npm run test:spotlight`
Expected: no type or lint output; `All landing tests passed.` and `All graph-spotlight tests passed` (the Journey, System and landing canvases pass none of the new props, so they keep `fitView` and render everything).

- [ ] **Step 4: Commit**

```bash
git add components/graph/Canvas.tsx components/graph/WallCamera.tsx
git commit -m "feat(canvas): optional pane click, visible-only rendering, no initial fit, and a child slot"
```

---

### Task 8: The frame and its shot

**Files:**
- Create: `components/graph/nodes/wall-node-data.ts`, `components/graph/nodes/WallShot.tsx`, `components/graph/nodes/WallFrameNode.tsx`
- Generated: `lib/wobble/wobble-registry.generated.ts`, `app/wobble.generated.css` (`clock`)

**Traps:** React Flow gives these nodes' wrappers `pointer-events: none` (Repo facts; the canvas passes no `onNodeClick`, no spotlight hover, and builds every wall node non-selectable and non-draggable). Mechanism used: the `pointer-events-auto` class on the frame's single root element (the `role="button"` div) — not a wrapper-level style and not `nopan`, so a dimming wrapper part 3 puts around the content needs no pointer-events class of its own, and part 4's ring and `data-wall-frame` go on that same root. Named groups match any ancestor: the frame owns `group/wall-frame`, a name nothing nested reuses. The frame handles its keys in its own `onKeyDown` — never a `window`/`document` listener (`tests/app/keyboard-shortcuts.test.js:186-201`). `ClockIcon` is new to the wobble registry: regenerate.

- [ ] **Step 1: The node data types**

Create `components/graph/nodes/wall-node-data.ts`:

```ts
import type { PlatformId } from "@/lib/config/platforms";
import type { StatusId } from "@/lib/config/statuses";
import type { WallLens, WallScreen } from "@/lib/utils/screen-wall";

/**
 * The `data` of the Screens map's React Flow nodes (`ScreensCanvas` builds
 * them). `type` aliases, not interfaces: React Flow constrains node data to
 * `Record<string, unknown>`, which an interface does not satisfy.
 *
 * Fields later parts need (dimming, selection, keyboard moves) are added by
 * those parts as required fields, in the same commit as the builder that fills
 * them — a field nothing fills would be a lie the type checker cannot see.
 */

/** A loaded shot's measured width / height, reported for the slot's current value. */
export type AspectReport = (viewId: string, platform: PlatformId, value: string, ratio: number) => void;

export type WallFrameData = {
  frameId: string;
  viewId: string;
  stripId: string;
  stripTitle: string;
  /** The view's states, shared by every frame that shows it. */
  screen: WallScreen;
  lens: WallLens;
  /** `wall.platforms`: the scope's menu, in `PLATFORMS` order. */
  platforms: readonly PlatformId[];
  /** `WallBox.shotWidth`: the shot box, centred in the node. */
  shotWidth: number;
  /** "in Yes of Has a streak?" when the frame is the first item of an arm, else null. */
  armContext: string | null;
  /** The Minimap's fill: the lens platform's status (side by side: the highest in `getRollupDisplayStatus` order). */
  status?: StatusId;
  onActivate: (frameId: string, viewId: string, stripId: string) => void;
  onAspect: AspectReport;
};

export type WallHeaderData = {
  stripId: string;
  flowId: string | null;
  title: string;
  /** `stripCountsLine(wall, strip, lens)`. */
  countsLine: string;
  /** "no-flows": the Journey pointer line above "Not in a flow", for a scope with views and no flow. */
  note: "no-flows" | null;
  /** A change rings the header for 2s (a jump tile landed here); 0 = never rung. */
  ringVersion: number;
  onOpenFlow: ((flowId: string) => void) | null;
};

export type WallMarkerData = {
  variant: "arm" | "end" | "empty";
  branch: "condition" | "junction" | null;
  /** The branch's own label ("Has a streak?"); "" for an empty-flow marker. */
  label: string;
  /** The arm's label ("Yes", "No", a junction case); "" for end and empty markers. */
  arm: string;
  /** An arm with no items, or the empty-flow ghost. */
  empty: boolean;
};

export type WallJumpData = {
  flowId: string;
  title: string;
  screenCount: number;
  onJump: (flowId: string) => void;
};
```

- [ ] **Step 2: One shot or its ghost**

Create `components/graph/nodes/WallShot.tsx`:

```tsx
"use client";

import { useState, type CSSProperties } from "react";
import { useStore } from "@xyflow/react";
import { CircleDashedIcon, ClockIcon, FolderTreeIcon, ImageOffIcon, type LucideIcon } from "lucide-react";
import type { PlatformId } from "@/lib/config/platforms";
import type { PlatformCell, WallShot as WallShotValue } from "@/lib/utils/screen-wall";
import { LOD_ZOOM } from "@/lib/utils/screen-wall-layout";
import { cn } from "@/lib/utils";
import { PLATFORM_ICONS, PLATFORM_LABELS, STATUS_ICONS, STATUS_LABELS, STATUS_STYLES } from "./node-styles";
import type { AspectReport } from "./wall-node-data";

/** The ghost's faint hatch: `currentColor`, drawn at 10% by the layer that carries it. */
const HATCH: CSSProperties = {
  backgroundImage: "repeating-linear-gradient(135deg, currentColor 0 1px, transparent 1px 8px)",
};

/**
 * Whether the camera is close enough to draw images and captions. A boolean
 * selector, so a frame re-renders only when the zoom crosses `LOD_ZOOM`, never
 * on every wheel step.
 */
export function useWallDetail(): boolean {
  return useStore((state) => state.transform[2] >= LOD_ZOOM);
}

interface Ghost {
  icon: LucideIcon;
  iconClass: string;
  title: string;
  detail: string | null;
  /** `absent`: solid light border, no hatch. `gap`: dashed amber (a live screen with no shot). */
  tone: "plain" | "gap" | "absent";
}

function hostOf(shot: WallShotValue): string {
  if (shot.form === "data") return "An inline image";
  try {
    return new URL(shot.value).host;
  } catch {
    return shot.value;
  }
}

function absentGhost(platform: PlatformId): Ghost {
  return {
    icon: PLATFORM_ICONS[platform],
    iconClass: "text-muted-foreground",
    title: `Not on ${PLATFORM_LABELS[platform]}`,
    detail: null,
    tone: "absent",
  };
}

/**
 * What a frame says when it cannot show a picture — the spec's ghost column,
 * word for word — or null when there is a picture to show.
 */
function ghostFor(cell: PlatformCell | undefined, platform: PlatformId, failed: boolean): Ghost | null {
  const label = PLATFORM_LABELS[platform];
  if (!cell || cell.state === "absent") return absentGhost(platform);
  const shot = cell.shot;
  if (shot && shot.form === "path") {
    return {
      icon: FolderTreeIcon,
      iconClass: "text-muted-foreground",
      title: "Shot in the repo",
      detail: "Paths open from the bundle's folder, not in the app",
      tone: "plain",
    };
  }
  if (shot && failed) {
    return { icon: ImageOffIcon, iconClass: "text-muted-foreground", title: "Shot didn't load", detail: hostOf(shot), tone: "plain" };
  }
  if (shot) return null;
  if (cell.state === "live-no-shot") {
    return {
      icon: ImageOffIcon,
      iconClass: "text-amber-500 dark:text-amber-400",
      title: "No shot yet",
      detail: `Live on ${label}`,
      tone: "gap",
    };
  }
  if (cell.status === null) {
    return {
      icon: CircleDashedIcon,
      iconClass: "text-muted-foreground",
      title: "No status",
      detail: `Nothing says where this stands on ${label}`,
      tone: "plain",
    };
  }
  return {
    icon: STATUS_ICONS[cell.status],
    iconClass: STATUS_STYLES[cell.status].badge,
    title: STATUS_LABELS[cell.status],
    detail: `Not live on ${label} yet`,
    tone: "plain",
  };
}

interface WallShotProps {
  viewId: string;
  platform: PlatformId;
  /** Undefined when the platform is outside the wall's menu: drawn as absent. */
  cell: PlatformCell | undefined;
  width: number;
  height: number;
  onAspect: AspectReport;
}

/**
 * One platform's picture inside a frame: the screenshot, or a ghost that says
 * why there is none. The image is decorative (`alt=""`) — the frame's
 * `aria-label` carries the meaning — and is only ever mounted while the frame
 * is on screen (`onlyRenderVisibleElements`) and the camera is above
 * `LOD_ZOOM`; below it the box keeps the state's tint and glyph. A path is
 * never requested: it resolves against the page's own URL and would 404.
 */
export function WallShot({ viewId, platform, cell, width, height, onAspect }: WallShotProps) {
  const detailed = useWallDetail();
  // The value that failed, not a flag: a new value for the slot gets a fresh
  // try without an effect resetting anything.
  const [failedValue, setFailedValue] = useState<string | null>(null);
  const shot = cell?.shot ?? null;
  const failed = shot !== null && failedValue === shot.value;
  const ghost = ghostFor(cell, platform, failed);

  if (ghost !== null || shot === null || cell === undefined) {
    const shown = ghost ?? absentGhost(platform);
    const Icon = shown.icon;
    return (
      <div
        className={cn(
          "relative flex flex-col items-center justify-center gap-1.5 overflow-hidden rounded-md px-3 text-center",
          shown.tone === "absent" && "border border-border/60 bg-muted/20",
          shown.tone === "plain" && "border-2 border-dashed border-border bg-card",
          shown.tone === "gap" && "border-2 border-dashed border-amber-500 bg-card dark:border-amber-400",
        )}
        style={{ width, height }}
      >
        {shown.tone !== "absent" && (
          <span aria-hidden="true" className="pointer-events-none absolute inset-0 text-foreground opacity-10" style={HATCH} />
        )}
        <Icon className={cn("relative size-5 shrink-0", shown.iconClass)} aria-hidden="true" />
        {detailed && (
          <>
            <span className="relative text-xs font-medium leading-tight">{shown.title}</span>
            {shown.detail && (
              <span className="relative line-clamp-3 text-[11px] leading-snug text-muted-foreground">{shown.detail}</span>
            )}
          </>
        )}
      </div>
    );
  }

  const stale = cell.state === "live-stale";
  const notLive = cell.state === "not-live";

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-md border border-border bg-muted",
        stale && "ring-2 ring-amber-500 ring-offset-2 ring-offset-card dark:ring-amber-400",
      )}
      style={{ width, height }}
    >
      {detailed ? (
        // eslint-disable-next-line @next/next/no-img-element -- an arbitrary data: or absolute-URL screenshot, not an optimisable asset
        <img
          src={shot.value}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          referrerPolicy="no-referrer"
          data-wall-shot=""
          className={cn("h-full w-full object-cover object-top", notLive && "opacity-50")}
          onLoad={(event) => {
            const image = event.currentTarget;
            if (image.naturalWidth > 0 && image.naturalHeight > 0) {
              onAspect(viewId, platform, shot.value, image.naturalWidth / image.naturalHeight);
            }
          }}
          onError={() => setFailedValue(shot.value)}
        />
      ) : (
        <div
          aria-hidden="true"
          className={cn(
            "h-full w-full",
            stale ? "bg-amber-500/10" : notLive ? "bg-muted" : STATUS_STYLES.live.surface,
          )}
        />
      )}
      {detailed && stale && (
        <span className="absolute top-1.5 left-1.5 inline-flex items-center gap-1 rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-semibold text-white dark:bg-amber-400 dark:text-black">
          <ClockIcon className="size-3" aria-hidden="true" />
          Stale
        </span>
      )}
      {detailed && notLive && (
        <span className="absolute top-1.5 left-1.5 rounded-full border bg-card px-2 py-0.5 text-[10px] font-semibold">
          {cell.status === null ? "No status" : STATUS_LABELS[cell.status]}
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 3: The frame**

Create `components/graph/nodes/WallFrameNode.tsx`:

```tsx
"use client";

import { memo, type KeyboardEvent } from "react";
import type { Node, NodeProps } from "@xyflow/react";
import type { PlatformId } from "@/lib/config/platforms";
import { cellWord, type PlatformCell } from "@/lib/utils/screen-wall";
import { CAPTION_GAP, CAPTION_H, FRAME_H } from "@/lib/utils/screen-wall-layout";
import { formatShotDate } from "@/lib/utils/screenshot-ops";
import { PLATFORM_LABELS, STATUS_LABELS } from "./node-styles";
import type { WallFrameData } from "./wall-node-data";
import { WallShot, useWallDetail } from "./WallShot";

/** "live, shot current, 11/3/2026" — one platform's reading, for the frame's accessible name. */
function cellPhrase(cell: PlatformCell | undefined): string {
  if (!cell || cell.state === "absent") return "not on this platform";
  const date = cell.shot?.ts ? formatShotDate(cell.shot.ts) : undefined;
  const dated = (text: string) => (date ? `${text}, ${date}` : text);
  if (cell.state === "live-current") return dated("live, shot current");
  if (cell.state === "live-stale") return dated("live, shot may be stale");
  if (cell.state === "live-no-shot") return "live, no shot yet";
  const status = cell.status === null ? "no status" : STATUS_LABELS[cell.status].toLowerCase();
  return cell.shot ? `${status}, has a shot` : status;
}

/** Ends a clause with a full stop unless it already ends in punctuation ("Has a streak?"). */
function sentence(text: string): string {
  return /[.?!]$/.test(text) ? text : `${text}.`;
}

/**
 * One screen on the wall: the lens platform's shot (or its ghost) at the
 * frame's own proportions, captioned with the view's title and the state word.
 *
 * The whole frame is the control — `role="button"`, in the layout's reading
 * order — and it activates from its own element (click, Enter, Space), never
 * through `Canvas`'s `onNodeClick`: the React Flow node is built non-focusable
 * and non-selectable, so focus lives here. The image is decorative; this
 * element's `aria-label` says what the frame shows.
 *
 * `pointer-events-auto` is load-bearing: React Flow gives a node that is not
 * selectable, not draggable and has no node handlers `pointer-events: none`,
 * so without it no click would ever reach this element.
 */
function WallFrameNodeComponent({ data }: NodeProps<Node<WallFrameData, "wallFrame">>) {
  const { frameId, viewId, stripId, stripTitle, screen, lens, platforms, shotWidth, armContext, onActivate, onAspect } =
    data;
  const detailed = useWallDetail();
  // Part 2 draws one platform per frame. The lens is never "side" here — the
  // stored-lens reader accepts platform ids only — and the fallback keeps the
  // type total rather than asserting it.
  const platform: PlatformId = lens === "side" ? (platforms[0] ?? "web") : lens;
  const cell = screen.cells[platform];
  const date = cell?.shot?.ts ? formatShotDate(cell.shot.ts) : undefined;
  const word = cell ? cellWord(cell) : "Absent";

  const where = sentence(armContext ? `${screen.title}, ${stripTitle}, ${armContext}` : `${screen.title}, ${stripTitle}`);
  const label = `${where} ${sentence(`${PLATFORM_LABELS[platform]}: ${cellPhrase(cell)}`)}`;

  const activate = () => onActivate(frameId, viewId, stripId);
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    activate();
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={label}
      onClick={activate}
      onKeyDown={handleKeyDown}
      className="group/wall-frame pointer-events-auto flex h-full w-full cursor-pointer flex-col items-center rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background"
    >
      <div className="shrink-0 rounded-md shadow-sm transition-shadow group-hover/wall-frame:shadow-md">
        <WallShot
          viewId={viewId}
          platform={platform}
          cell={cell}
          width={shotWidth}
          height={FRAME_H}
          onAspect={onAspect}
        />
      </div>
      <div
        className="flex w-full min-w-0 flex-col justify-center gap-0.5 px-1"
        style={{ marginTop: CAPTION_GAP, height: CAPTION_H }}
      >
        {detailed && (
          <>
            <span className="truncate text-xs font-medium leading-tight" title={screen.title}>
              {screen.title}
            </span>
            <span className="truncate text-[11px] leading-tight text-muted-foreground">
              {date && cell?.shot ? `${word} · ${date}` : word}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

/** Memoized: a camera move re-renders the canvas, never an unchanged frame. */
export const WallFrameNode = memo(WallFrameNodeComponent);
```

- [ ] **Step 4: Check and regenerate**

Run: `npx tsc --noEmit && npx eslint components/graph/nodes/wall-node-data.ts components/graph/nodes/WallShot.tsx components/graph/nodes/WallFrameNode.tsx`
Expected: no output (the `<img>` carries its own `no-img-element` disable with a reason, so no warning either).

Run: `npm run generate && git status --porcelain`
Expected: the three new files plus `app/wobble.generated.css` (`+.lucide-clock { filter: url(#wob-clock); }`) and `lib/wobble/wobble-registry.generated.ts` (`+  { name: "clock", seed: 13 },`).

- [ ] **Step 5: Commit**

```bash
git add components/graph/nodes/wall-node-data.ts components/graph/nodes/WallShot.tsx components/graph/nodes/WallFrameNode.tsx lib/wobble/wobble-registry.generated.ts app/wobble.generated.css
git commit -m "feat(screens): the frame, its shot and its ghost"
```

---

### Task 9: Headers, markers, jump tiles, and the node types

**Files:**
- Create: `components/graph/nodes/WallHeaderNode.tsx`, `components/graph/nodes/WallMarkerNode.tsx`, `components/graph/nodes/WallJumpNode.tsx`
- Modify: `components/graph/Canvas.tsx`

**Traps:** the pointer-events rule again, same mechanism: `pointer-events-auto` on the jump tile's root (`<button>`), and on the header's flow button and Journey link — the header's root `div` keeps `none`, so a drag that starts on a header pans the canvas. `group/wall-jump` is the tile's own name. The header is an `h2` under `PageShell`'s single `h1`; it lives in `components/graph/nodes/`, outside the `panel-semantics` sweep of `components/panels/`.

- [ ] **Step 1: The strip header**

Create `components/graph/nodes/WallHeaderNode.tsx`:

```tsx
"use client";

import { memo } from "react";
import Link from "next/link";
import type { Node, NodeProps } from "@xyflow/react";
import { SPECIES_GRAPH_ICONS } from "@/lib/config/species-icons";
import { useProjectId } from "@/lib/hooks/useProjectId";
import type { WallHeaderData } from "./wall-node-data";

/**
 * A strip's header: the flow's name as the strip's `h2` (the page's `h1` is
 * `PageShell`'s), a button on it that opens the flow's panel, and the R9
 * counts line. "Not in a flow" has no flow to open, so its title is plain
 * text; with no flow in scope at all it also carries the pointer to the
 * Journey map, drawn just above the header.
 *
 * A jump tile that lands here rings the header: an outline for as long as
 * `ringVersion` is non-zero (the controller clears it after 2s), pulsing only
 * when motion is allowed.
 *
 * The button and the link carry `pointer-events-auto`: React Flow turns
 * pointer events off on a node with nothing selectable, draggable or handled
 * (see `WallFrameNode`), and the rest of the header lets the pane take a drag.
 */
function WallHeaderNodeComponent({ data }: NodeProps<Node<WallHeaderData, "wallHeader">>) {
  const { flowId, title, countsLine, note, ringVersion, onOpenFlow } = data;
  const projectId = useProjectId();
  const Icon = flowId === null ? SPECIES_GRAPH_ICONS.view : SPECIES_GRAPH_ICONS.flow;

  return (
    <div className="relative h-full w-full">
      {note === "no-flows" && (
        <p className="absolute bottom-full left-0 mb-2 w-full text-xs text-muted-foreground">
          No flows yet, so these screens aren&apos;t lined up.{" "}
          <Link
            href={`/project/${projectId}/maps/journey`}
            className="pointer-events-auto font-medium text-foreground underline underline-offset-2"
          >
            Put them in order on the Journey map.
          </Link>
        </p>
      )}
      {ringVersion > 0 && (
        <span
          key={ringVersion}
          aria-hidden="true"
          className="pointer-events-none absolute -inset-1 rounded-xl ring-2 ring-primary motion-safe:animate-pulse"
        />
      )}
      <div className="flex h-full w-full items-center gap-3 rounded-lg border bg-card px-3 shadow-sm">
        <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <h2 className="min-w-0 truncate text-sm font-semibold">
          {flowId !== null && onOpenFlow ? (
            <button
              type="button"
              onClick={() => onOpenFlow(flowId)}
              className="pointer-events-auto max-w-full cursor-pointer truncate rounded-sm text-left underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            >
              {title}
            </button>
          ) : (
            title
          )}
        </h2>
        <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">{countsLine}</span>
      </div>
    </div>
  );
}

export const WallHeaderNode = memo(WallHeaderNodeComponent);
```

- [ ] **Step 2: Arm, end and empty markers**

Create `components/graph/nodes/WallMarkerNode.tsx`:

```tsx
"use client";

import { memo } from "react";
import type { Node, NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";
import type { WallMarkerData } from "./wall-node-data";

/**
 * The thin things between frames, all `aria-hidden` (a frame that starts an
 * arm names the arm in its own label):
 *
 * - `arm` — a branch's arm begins: a rule with the arm and the branch written
 *   up its side ("Yes · Has a streak?"); dashed when the arm lists nothing.
 * - `end` — the branch closes: a short bracket.
 * - `empty` — a flow whose playlist lists nothing: one ghost the width of a
 *   frame, so the strip is not a bare header.
 */
function WallMarkerNodeComponent({ data }: NodeProps<Node<WallMarkerData, "wallMarker">>) {
  const { variant, label, arm, empty } = data;

  if (variant === "empty") {
    return (
      <div
        aria-hidden="true"
        className="flex h-full w-full items-center justify-center rounded-md border-2 border-dashed border-border px-4 text-center text-xs text-muted-foreground"
      >
        No screens in this flow yet
      </div>
    );
  }

  if (variant === "end") {
    return (
      <div aria-hidden="true" className="flex h-full w-full items-stretch justify-center py-8">
        <span className="w-1.5 rounded-r-sm border-y-2 border-r-2 border-muted-foreground/40" />
      </div>
    );
  }

  return (
    <div aria-hidden="true" className="flex h-full w-full items-stretch justify-center gap-1">
      <span
        className={cn(
          "w-0 border-l-2",
          empty ? "border-dashed border-muted-foreground/40" : "border-muted-foreground/60",
        )}
      />
      <span
        className="truncate text-[10px] font-medium text-muted-foreground [writing-mode:vertical-rl]"
        title={`${arm} · ${label}`}
      >
        {arm} · {label}
      </span>
    </div>
  );
}

export const WallMarkerNode = memo(WallMarkerNodeComponent);
```

- [ ] **Step 3: The jump tile**

Create `components/graph/nodes/WallJumpNode.tsx`:

```tsx
"use client";

import { memo } from "react";
import type { Node, NodeProps } from "@xyflow/react";
import { ChevronRightIcon } from "lucide-react";
import { SPECIES_GRAPH_ICONS } from "@/lib/config/species-icons";
import type { WallJumpData } from "./wall-node-data";

const FlowIcon = SPECIES_GRAPH_ICONS.flow;

/**
 * A sub-flow entry: the sub-flow's views are not inlined into this strip — the
 * tile flies the camera to the sub-flow's own strip and rings its header.
 * `pointer-events-auto` for the reason given in `WallFrameNode`.
 */
function WallJumpNodeComponent({ data }: NodeProps<Node<WallJumpData, "wallJump">>) {
  const { flowId, title, screenCount, onJump } = data;
  const screens = `${screenCount} screen${screenCount === 1 ? "" : "s"}`;

  return (
    <button
      type="button"
      onClick={() => onJump(flowId)}
      aria-label={`Go to ${title}, ${screens}`}
      className="group/wall-jump pointer-events-auto flex h-full w-full cursor-pointer flex-col justify-between rounded-lg border bg-card p-3 text-left shadow-sm transition-colors outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <FlowIcon className="size-3.5 shrink-0" aria-hidden="true" />
        {screens}
      </span>
      <span className="flex items-end justify-between gap-1">
        <span className="line-clamp-2 text-xs font-medium leading-tight">{title}</span>
        <ChevronRightIcon
          className="size-4 shrink-0 text-muted-foreground transition-transform group-hover/wall-jump:translate-x-0.5"
          aria-hidden="true"
        />
      </span>
    </button>
  );
}

export const WallJumpNode = memo(WallJumpNodeComponent);
```

- [ ] **Step 4: Register the four node types**

In `components/graph/Canvas.tsx`, replace `import { ApiEndpointNode, DataModelNode } from "./nodes/SystemLayerNode";` with:

```tsx
import { ApiEndpointNode, DataModelNode } from "./nodes/SystemLayerNode";
import { WallFrameNode } from "./nodes/WallFrameNode";
import { WallHeaderNode } from "./nodes/WallHeaderNode";
import { WallJumpNode } from "./nodes/WallJumpNode";
import { WallMarkerNode } from "./nodes/WallMarkerNode";
```

and replace:

```tsx
  apiEndpoint: ApiEndpointNode,
};
```

with:

```tsx
  apiEndpoint: ApiEndpointNode,
  // The Screens map (ScreensCanvas). Arm, end and empty markers share one type.
  wallFrame: WallFrameNode,
  wallHeader: WallHeaderNode,
  wallMarker: WallMarkerNode,
  wallJump: WallJumpNode,
};
```

- [ ] **Step 5: Check and commit**

Run: `npx tsc --noEmit && npx eslint components/graph && npm run generate && git status --porcelain`
Expected: no type or lint output; `git status` lists only the four files of this task (`ChevronRightIcon` and the species glyphs are registered).

```bash
git add components/graph/nodes/WallHeaderNode.tsx components/graph/nodes/WallMarkerNode.tsx components/graph/nodes/WallJumpNode.tsx components/graph/Canvas.tsx
git commit -m "feat(screens): strip headers, branch markers and jump tiles"
```

---

### Task 10: Measured proportions and the bottom bar

**Files:**
- Create: `components/maps/screens/aspect-cache.ts`, `components/maps/screens/ScreensBar.tsx`

**Traps:** `components/ui/` is not edited by hand — the bar passes `collapseLabels` to the existing `SegmentedControl`. The overscroll trap: nothing here scrolls sideways. The cache is module state touched only from `onLoad` reports and a `requestAnimationFrame` flush, never during render.

- [ ] **Step 1: The aspect cache**

Create `components/maps/screens/aspect-cache.ts`:

```ts
import type { PlatformId } from "@/lib/config/platforms";

/**
 * Measured proportions of the Screens map's shots, for the tab's lifetime.
 *
 * Nothing records an image's dimensions, so a frame starts at its platform's
 * default shape and takes the shot's own once it has loaded (spec § Images).
 * Kept at module level, keyed `viewId|platform`, so leaving the map and coming
 * back keeps every proportion already learned: a frame changes width at most
 * once per shot per tab. Each entry remembers the slot value it was measured
 * from and answers only while that is still the slot's value — a new shot
 * starts from the default again rather than wearing the old one's shape.
 *
 * Reports arrive one `onLoad` at a time; they are applied together once per
 * animation frame, so a screenful of loading shots re-lays the wall once, not
 * once per image. The store is copy-on-write — each applied batch is a new
 * map — so it reads through `useSyncExternalStore` with no version counter.
 */

export interface AspectEntry {
  value: string;
  ratio: number;
}

const EMPTY: ReadonlyMap<string, AspectEntry> = new Map();

let snapshot: ReadonlyMap<string, AspectEntry> = EMPTY;
let pending = new Map<string, AspectEntry>();
let frame: number | null = null;
const listeners = new Set<() => void>();

const keyOf = (viewId: string, platform: PlatformId) => `${viewId}|${platform}`;

function flush(): void {
  frame = null;
  let next: Map<string, AspectEntry> | null = null;
  for (const [key, entry] of pending) {
    const known = snapshot.get(key);
    if (known && known.value === entry.value && known.ratio === entry.ratio) continue;
    next ??= new Map(snapshot);
    next.set(key, entry);
  }
  pending = new Map();
  if (next === null) return;
  snapshot = next;
  for (const listener of listeners) listener();
}

/** A shot loaded: `ratio` = naturalWidth / naturalHeight of `value`. Applied on the next animation frame. */
export function reportAspect(viewId: string, platform: PlatformId, value: string, ratio: number): void {
  if (!Number.isFinite(ratio) || ratio <= 0) return;
  pending.set(keyOf(viewId, platform), { value, ratio });
  if (frame === null) frame = window.requestAnimationFrame(flush);
}

export function subscribeAspects(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getAspectSnapshot(): ReadonlyMap<string, AspectEntry> {
  return snapshot;
}

/** The server has measured nothing. */
export function getServerAspectSnapshot(): ReadonlyMap<string, AspectEntry> {
  return EMPTY;
}

/** The slot's measured ratio, or undefined unless it was measured from `value` itself. */
export function aspectFrom(
  aspects: ReadonlyMap<string, AspectEntry>,
  viewId: string,
  platform: PlatformId,
  value: string,
): number | undefined {
  const entry = aspects.get(keyOf(viewId, platform));
  return entry && entry.value === value ? entry.ratio : undefined;
}
```

- [ ] **Step 2: The bar**

Create `components/maps/screens/ScreensBar.tsx`:

```tsx
"use client";

import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { PLATFORM_ICONS, PLATFORM_LABELS } from "@/components/graph/nodes/node-styles";
import type { PlatformId } from "@/lib/config/platforms";
import type { WallLens } from "@/lib/utils/screen-wall";

export interface ScreensBarProps {
  /** `wall.platforms`: one lens option each, in `PLATFORMS` order. */
  platforms: readonly PlatformId[];
  lens: WallLens;
  onLensChange: (lens: WallLens) => void;
  /** Read by a visually hidden `aria-live="polite"` line ("Showing iOS."). */
  announcement: string;
}

/**
 * The Screens map's one piece of chrome: a small bar at the bottom centre of
 * the canvas holding the platform lens. The controller renders it only when
 * the scope offers two platforms or more (the arity rule): with one there is
 * nothing to choose.
 *
 * A `bg-card` segment in the Toolbar skin. Below a 40rem canvas it spans the
 * width (the controller's `@container` gives it 12px gutters) and the lens
 * collapses to icons below `md` — the segmented control's own breakpoint,
 * which `components/ui/` keeps as it is. It never scrolls sideways: every
 * `.overflow-x-auto` traps the vertical wheel (app/globals.css).
 */
export function ScreensBar({ platforms, lens, onLensChange, announcement }: ScreensBarProps) {
  const options: SegmentedControlOption<WallLens>[] = platforms.map((platform) => ({
    id: platform,
    label: PLATFORM_LABELS[platform],
    icon: PLATFORM_ICONS[platform],
  }));

  return (
    <div
      role="toolbar"
      aria-label="Screens display"
      className="pointer-events-auto flex items-center gap-2 rounded-xl border bg-card p-1.5 shadow-md @max-[40rem]:w-full"
    >
      <SegmentedControl<WallLens>
        options={options}
        value={lens}
        onChange={onLensChange}
        ariaLabel="Platform lens"
        collapseLabels
        className="@max-[40rem]:flex @max-[40rem]:w-full @max-[40rem]:[&>button]:flex-1 @max-[40rem]:[&>button]:justify-center"
      />
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
    </div>
  );
}
```

- [ ] **Step 3: Check and commit**

Run: `npx tsc --noEmit && npx eslint components/maps/screens`
Expected: no output.

```bash
git add components/maps/screens/aspect-cache.ts components/maps/screens/ScreensBar.tsx
git commit -m "feat(screens): the lens bar, and shot proportions remembered per tab"
```

---

### Task 11: `ScreensCanvas`

**Files:**
- Create: `components/graph/ScreensCanvas.tsx`

**Traps:** the narrow rules use attribute selectors with `!` (Repo facts: `_` is a space in an arbitrary variant; React Flow's CSS is unlayered). Every node carries `width`/`height` from its `WallBox` and the four inert flags; no `onNodeClick`, `onConnect` or `onEdgeClick`; spotlight off.

- [ ] **Step 1: Write the canvas**

Create `components/graph/ScreensCanvas.tsx`:

```tsx
"use client";

import { useMemo } from "react";
import type { Edge, Node } from "@xyflow/react";
import { Canvas, type CanvasFocus } from "@/components/graph/Canvas";
import { WallCamera, type WallCameraRequest } from "@/components/graph/WallCamera";
import type {
  AspectReport,
  WallFrameData,
  WallHeaderData,
  WallJumpData,
  WallMarkerData,
} from "@/components/graph/nodes/wall-node-data";
import type { PlatformId } from "@/lib/config/platforms";
import type { StatusId } from "@/lib/config/statuses";
import { getRollupDisplayStatus, type PlatformStatusCounts } from "@/lib/utils/platform-status";
import type { ProductScope } from "@/lib/utils/product-scope";
import { stripCountsLine, type Wall, type WallItem, type WallLens, type WallScreen } from "@/lib/utils/screen-wall";
import type { WallBox, WallLayout } from "@/lib/utils/screen-wall-layout";

export interface ScreensCanvasProps {
  wall: Wall;
  layout: WallLayout;
  lens: WallLens;
  scope: ProductScope;
  /** A frame click centres the frame through `CameraFocus` (the System map's grammar). */
  focus: CanvasFocus | null;
  camera: WallCameraRequest | null;
  /** The strip a jump tile just landed on: its header rings while this is set. */
  ring: { stripId: string; version: number } | null;
  onFrameActivate: (frameId: string, viewId: string, stripId: string) => void;
  /** A header's flow panel. */
  onOpenNode: (nodeId: string) => void;
  onJump: (flowId: string) => void;
  onAspect: AspectReport;
}

/** Every wall node is inert to React Flow: focus and activation live on the element inside. */
const INERT = { draggable: false, connectable: false, selectable: false, focusable: false } as const;

const NO_EDGES: Edge[] = [];

/**
 * The frame's Minimap fill: the lens platform's status; side by side, the
 * status `getRollupDisplayStatus` would report over the frame's rows.
 */
function frameStatus(screen: WallScreen, lens: WallLens, platforms: readonly PlatformId[]): StatusId | undefined {
  if (lens !== "side") return screen.cells[lens]?.status ?? undefined;
  const counts: PlatformStatusCounts = {};
  let fallback: StatusId | undefined;
  for (const platform of platforms) {
    const status = screen.cells[platform]?.status;
    if (!status) continue;
    counts[platform] = { [status]: 1 };
    fallback ??= status;
  }
  return fallback === undefined ? undefined : getRollupDisplayStatus({ counts, totals: {} }, fallback);
}

/**
 * The Screens map's presentational half — `SystemCanvas`'s twin: the wall
 * model and its layout in, React Flow nodes out, drawn by `Canvas`. Every
 * position and size comes from the layout (`WallBox`), so React Flow and the
 * Minimap know each node's box before measuring it, which is what lets
 * `onlyRenderVisibleElements` keep off-screen shots unmounted.
 *
 * No edges, no connect, no drag, no spotlight, and no `onNodeClick`: frames,
 * headers and jump tiles activate from their own elements. The first camera is
 * the controller's (`initialFit={false}`), so the whole wall never flashes at
 * an unreadable zoom.
 *
 * The wrapper is an `@container`: below 60rem of canvas the Minimap goes,
 * below 40rem the Controls too (the queries resolve against the controller's
 * own `@container`, the same box — an element cannot query itself).
 */
export function ScreensCanvas({
  wall,
  layout,
  lens,
  scope,
  focus,
  camera,
  ring,
  onFrameActivate,
  onOpenNode,
  onJump,
  onAspect,
}: ScreensCanvasProps) {
  const itemsById = useMemo(() => {
    const byId = new Map<string, { item: WallItem; previous: WallItem | undefined; armOf: WallItem | undefined }>();
    for (const strip of wall.strips) {
      let lastArm: WallItem | undefined;
      strip.items.forEach((item, index) => {
        if (item.kind === "arm") lastArm = item;
        byId.set(item.id, { item, previous: strip.items[index - 1], armOf: lastArm });
      });
    }
    return byId;
  }, [wall]);

  const stripsById = useMemo(() => new Map(wall.strips.map((strip) => [strip.id, strip])), [wall]);

  // Static per wall, lens and layout; the ring is merged below so a jump does
  // not rebuild every frame's data.
  const baseNodes = useMemo(() => {
    const nodes: Node[] = [];
    const place = (box: WallBox) => ({
      id: box.id,
      position: { x: box.x, y: box.y },
      width: box.width,
      height: box.height,
      ...INERT,
    });

    for (const box of layout.boxes) {
      const strip = stripsById.get(box.stripId);
      if (!strip) continue;

      if (box.kind === "header") {
        const data: WallHeaderData = {
          stripId: strip.id,
          flowId: strip.flowId,
          title: strip.title,
          countsLine: stripCountsLine(wall, strip, lens),
          note: strip.flowId === null && wall.empty === "no-flows" ? "no-flows" : null,
          ringVersion: 0,
          onOpenFlow: strip.flowId === null ? null : onOpenNode,
        };
        nodes.push({ ...place(box), type: "wallHeader", data });
        continue;
      }

      const entry = itemsById.get(box.id);
      if (!entry) continue;
      const { item, previous, armOf } = entry;

      if (item.kind === "frame") {
        const screen = wall.screens.get(item.viewId);
        if (!screen) continue;
        const data: WallFrameData = {
          frameId: item.id,
          viewId: item.viewId,
          stripId: strip.id,
          stripTitle: strip.title,
          screen,
          lens,
          platforms: wall.platforms,
          shotWidth: box.shotWidth ?? box.width,
          armContext: previous?.kind === "arm" ? `in ${previous.arm} of ${previous.label}` : null,
          status: frameStatus(screen, lens, wall.platforms),
          onActivate: onFrameActivate,
          onAspect,
        };
        nodes.push({ ...place(box), type: "wallFrame", data });
      } else if (item.kind === "jump") {
        const data: WallJumpData = {
          flowId: item.flowId,
          title: item.title,
          screenCount: item.screenCount,
          onJump,
        };
        nodes.push({ ...place(box), type: "wallJump", data });
      } else if (item.kind === "arm") {
        const data: WallMarkerData = {
          variant: "arm",
          branch: item.branch,
          label: item.label,
          arm: item.arm,
          empty: item.empty,
        };
        nodes.push({ ...place(box), type: "wallMarker", data });
      } else if (item.kind === "end") {
        const arm = armOf?.kind === "arm" ? armOf : undefined;
        const data: WallMarkerData = {
          variant: "end",
          branch: arm?.branch ?? null,
          label: arm?.label ?? "",
          arm: "",
          empty: false,
        };
        nodes.push({ ...place(box), type: "wallMarker", data });
      } else {
        const data: WallMarkerData = { variant: "empty", branch: null, label: "", arm: "", empty: true };
        nodes.push({ ...place(box), type: "wallMarker", data });
      }
    }
    return nodes;
  }, [itemsById, layout, lens, onAspect, onFrameActivate, onJump, onOpenNode, stripsById, wall]);

  const nodes = useMemo(() => {
    if (!ring) return baseNodes;
    return baseNodes.map((node) =>
      node.type === "wallHeader" && node.id === ring.stripId
        ? { ...node, data: { ...(node.data as WallHeaderData), ringVersion: ring.version } }
        : node,
    );
  }, [baseNodes, ring]);

  return (
    // Attribute selectors, not `.react-flow__minimap`: inside an arbitrary
    // variant Tailwind reads `_` as a space, so the class name would never
    // match. Important (`!`), because React Flow's stylesheet is unlayered and
    // its `display: flex` on the controls beats any utility in a layer.
    <div className="@container h-full w-full @max-[60rem]:[&_[class*=minimap]]:hidden! @max-[40rem]:[&_[class*=controls]]:hidden!">
      <Canvas
        nodes={nodes}
        edges={NO_EDGES}
        scope={scope}
        minimapColor="status"
        initialFit={false}
        onlyRenderVisibleElements
        focus={focus}
      >
        <WallCamera request={camera} />
      </Canvas>
    </div>
  );
}
```

- [ ] **Step 2: Check and commit**

Run: `npx tsc --noEmit && npx eslint components/graph/ScreensCanvas.tsx`
Expected: no output.

```bash
git add components/graph/ScreensCanvas.tsx
git commit -m "feat(screens): the wall on the shared canvas"
```

---

### Task 12: `ScreensMap`, and the route renders it

**Files:**
- Create: `components/maps/ScreensMap.tsx`
- Modify: `app/project/[id]/maps/[mapId]/page.tsx`

**Traps:** React Compiler rules are errors. The first camera is adjusted during render (`react-hooks/set-state-in-effect`), the derived-state shape `useProjectPanels.tsx:205-211` uses; the ring's sequence ref is read and written only in `jumpToFlow`, never during render (`react-hooks/refs`). Every hook sits above the first early return, so part 5's `usePageNodeHandler` call can join them there. A stale dev server fakes hydration mismatches: restart it before believing one.

- [ ] **Step 1: Write the controller**

Create `components/maps/ScreensMap.tsx`:

```tsx
"use client";

import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ImageOffIcon, TriangleAlertIcon } from "lucide-react";
import { buildProductUsageIndex, type MapDefinition } from "@arkaik/schema";
import type { CanvasFocus } from "@/components/graph/Canvas";
import { ScreensCanvas } from "@/components/graph/ScreensCanvas";
import type { WallCameraRequest } from "@/components/graph/WallCamera";
import { PLATFORM_LABELS } from "@/components/graph/nodes/node-styles";
import { PageError } from "@/components/layout/PageError";
import { PageLoading } from "@/components/layout/PageLoading";
import { PageShell } from "@/components/layout/PageShell";
import { ScreensBar } from "@/components/maps/screens/ScreensBar";
import {
  aspectFrom,
  getAspectSnapshot,
  getServerAspectSnapshot,
  reportAspect,
  subscribeAspects,
} from "@/components/maps/screens/aspect-cache";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import type { JournalEvent, Node as DataNode } from "@/lib/data/types";
import { useAcceptanceIntake } from "@/lib/hooks/useAcceptanceIntake";
import { useDisplayPreferences } from "@/lib/hooks/useDisplayPreferences";
import { useEdges } from "@/lib/hooks/useEdges";
import { useJournal } from "@/lib/hooks/useJournal";
import { useNodeRelations } from "@/lib/hooks/useNodeRelations";
import { useNodes } from "@/lib/hooks/useNodes";
import { useProject } from "@/lib/hooks/useProject";
import { useEffectiveProduct } from "@/lib/hooks/useProductScope";
import { useProjectPanels } from "@/lib/hooks/useProjectPanels";
import { generateNodeId } from "@/lib/utils/id";
import { platformAvailabilityShape, type ProductGraph } from "@/lib/utils/product-scope";
import { buildWall, resolveLens, stripIdOf, type WallLens } from "@/lib/utils/screen-wall";
import { layoutWall, type AspectOf } from "@/lib/utils/screen-wall-layout";
import { STALENESS_EVENT_TYPES } from "@/lib/utils/screenshot-staleness";

interface ScreensMapProps {
  projectId: string;
  definition: MapDefinition;
}

/** A failed journal read draws the wall with no events: nothing stale, no proof. */
const NO_EVENTS: readonly JournalEvent[] = [];

/** The zoom range for framing a whole strip — the first one on arrival, a jump tile's target after. */
const STRIP_ZOOM = { minZoom: 0.4, maxZoom: 1 } as const;

/** How long a jumped-to strip's header stays rung. */
const RING_MS = 2000;

/**
 * The Screens map's controller (docs/spec/maps.md § Built-in Maps): every flow
 * as a strip of its screens, each frame showing what is live on the chosen
 * platform. `SystemMap`'s twin in shape — data hooks, the wall model, the
 * camera and the panel wiring here; drawing in `ScreensCanvas`.
 *
 * Read-only: nothing on the wall writes. A frame opens the view's panel and
 * centres itself (the System map's grammar), a header opens its flow's panel,
 * and the panel is where editing already works — which is why the shell gets
 * the same write props the other maps pass it.
 *
 * The lens is a preference of the person reading (`useDisplayPreferences`),
 * not of the product: nothing is written to the bundle and there is no Display
 * popover. The rendered lens is always `resolveLens(stored, wall)`, so a scope
 * change never shows a lens the scope lacks, and nothing is written back until
 * the reader chooses.
 */
export function ScreensMap({ projectId, definition }: ScreensMapProps) {
  const { openNode } = useProjectPanels();
  const {
    nodes: dataNodes,
    loading: nodesLoading,
    error: nodesError,
    reload: reloadNodes,
    updateNode,
    addNode,
    applyMutations,
  } = useNodes(projectId);
  const { edges: dataEdges, loading: edgesLoading, error: edgesError, reload: reloadEdges, syncEdges } =
    useEdges(projectId);
  const { project: projectBundle, loading: projectLoading, error: projectError, reload: reloadProject } =
    useProject(projectId);
  // Projected to the three types the staleness rule reads: the same cached
  // entry every open panel's caption shares.
  const {
    journal,
    loading: journalLoading,
    error: journalError,
    reload: reloadJournal,
  } = useJournal(projectId, { types: STALENESS_EVENT_TYPES });
  const intake = useAcceptanceIntake({ projectId, nodes: dataNodes, edges: dataEdges, applyMutations, syncEdges });
  const relations = useNodeRelations({ projectId, nodes: dataNodes, edges: dataEdges, applyMutations, syncEdges });
  const scope = useEffectiveProduct(projectId, projectBundle);
  const [preferences, setPreferences] = useDisplayPreferences(projectId);

  const nodesById = useMemo(() => new Map(dataNodes.map((node) => [node.id, node])), [dataNodes]);
  // Built once per snapshot — a graph traversal, never per node.
  const usageIndex = useMemo(() => buildProductUsageIndex(dataNodes, dataEdges), [dataEdges, dataNodes]);
  const productGraph = useMemo<ProductGraph>(
    () => ({ edges: dataEdges, nodesById, usageIndex }),
    [dataEdges, nodesById, usageIndex],
  );

  const events = journalError ? NO_EVENTS : journal;
  const wall = useMemo(
    () =>
      buildWall({
        nodes: dataNodes,
        edges: dataEdges,
        events,
        project: projectBundle?.project,
        definition,
        scope,
        graph: productGraph,
      }),
    [dataEdges, dataNodes, definition, events, productGraph, projectBundle?.project, scope],
  );
  const lens = resolveLens(preferences.screensLens, wall);

  // Measured proportions, shared by every visit in this tab. `aspectOf`
  // answers only for the slot's current value (see aspect-cache).
  const aspects = useSyncExternalStore(subscribeAspects, getAspectSnapshot, getServerAspectSnapshot);
  const aspectOf = useMemo<AspectOf>(
    () => (viewId, platform) => {
      const value = wall.screens.get(viewId)?.cells[platform]?.shot?.value;
      return value === undefined ? undefined : aspectFrom(aspects, viewId, platform, value);
    },
    [aspects, wall],
  );
  const layout = useMemo(() => layoutWall(wall, lens, aspectOf), [aspectOf, lens, wall]);

  const ready = !nodesLoading && !edgesLoading && !projectLoading && !journalLoading;

  // The first camera: the first strip, once, as soon as there is one to show.
  // Adjusted during render rather than in an effect (the derived-state shape
  // `useProjectPanels` uses): React discards this pass and re-renders with the
  // request, so the canvas never paints a frame without it.
  const [camera, setCamera] = useState<WallCameraRequest | null>(null);
  const firstStripRect = wall.strips.length > 0 ? layout.strips.get(wall.strips[0].id) : undefined;
  if (ready && camera === null && firstStripRect !== undefined) {
    setCamera({ version: 1, rect: firstStripRect, ...STRIP_ZOOM });
  }

  // The frame a click activated, centred in whatever canvas the panel leaves.
  const [focus, setFocus] = useState<CanvasFocus | null>(null);
  const handleFrameActivate = useCallback(
    (frameId: string, viewId: string) => {
      openNode({ nodeId: viewId });
      setFocus((previous) => ({ nodeId: frameId, version: (previous?.version ?? 0) + 1 }));
    },
    [openNode],
  );

  const handleOpenNode = useCallback((nodeId: string) => openNode({ nodeId }), [openNode]);

  // A jump tile flies to its target strip and rings the header for 2s. Named,
  // and kept a plain controller function, because later parts call it from
  // inside this controller too (⌘K flies to a flow through it). The ring
  // clears itself from a timer started here — never from an effect — and only
  // if no later jump replaced it. Part 4 adds `selectFrame` beside it.
  const [ring, setRing] = useState<{ stripId: string; version: number } | null>(null);
  const ringSequence = useRef(0);
  const jumpToFlow = useCallback(
    (flowId: string): void => {
      const stripId = stripIdOf(flowId);
      const rect = layout.strips.get(stripId);
      if (!rect) return;
      setCamera((previous) => ({ version: (previous?.version ?? 0) + 1, rect, ...STRIP_ZOOM }));
      ringSequence.current += 1;
      const version = ringSequence.current;
      setRing({ stripId, version });
      window.setTimeout(() => {
        setRing((current) => (current?.version === version ? null : current));
      }, RING_MS);
    },
    [layout],
  );

  const handleLensChange = useCallback(
    (next: WallLens) => setPreferences({ screensLens: next }),
    [setPreferences],
  );

  const handleNodeUpdate = useCallback(
    async (nodeId: string, patch: Partial<Omit<DataNode, "id" | "project_id">>) => {
      await updateNode(nodeId, patch);
    },
    [updateNode],
  );

  const handleCreateNodeFromPanel = useCallback(
    async (species: "flow" | "view", title: string) =>
      addNode({
        id: generateNodeId(species, title, nodesById.keys()),
        project_id: projectId,
        title,
        species,
        status: "idea",
        platforms: [],
      }),
    [addNode, nodesById, projectId],
  );

  if (!ready) {
    return <PageLoading label="screens" />;
  }

  // A blank wall would read as "nothing has screens" — the one thing a failed
  // read must never say (#362). The journal is the exception: without it the
  // wall still draws, and a notice says what it cannot know.
  const loadError = nodesError ?? edgesError ?? projectError;
  if (loadError) {
    return (
      <PageError
        label="screens"
        message={loadError}
        onRetry={() => {
          void reloadNodes();
          void reloadEdges();
          void reloadProject();
        }}
      />
    );
  }

  const showBar = platformAvailabilityShape(wall.platforms) === "rings";
  const announcement =
    lens === "side" ? "Showing every platform side by side." : `Showing ${PLATFORM_LABELS[lens]}.`;

  return (
    <PageShell
      title={definition.title}
      surfaceCard
      allNodes={dataNodes}
      allEdges={dataEdges}
      scope={scope}
      history
      onUpdate={handleNodeUpdate}
      onScreenshot={async (op) => {
        await applyMutations([op]);
      }}
      onCreateNode={handleCreateNodeFromPanel}
      intake={intake}
      relations={relations}
    >
      {wall.empty === "nothing" ? (
        <div className="h-full w-full flex items-center justify-center p-6">
          <EmptyState
            message="Nothing to put on the wall yet. Screens line up by flow — sketch one on the Journey map."
            action={
              <Button asChild size="sm" variant="outline" className="cursor-pointer">
                <Link href={`/project/${projectId}/maps/journey`}>Open the Journey map</Link>
              </Button>
            }
          />
        </div>
      ) : (
        <div className="@container relative h-full w-full">
          <ScreensCanvas
            wall={wall}
            layout={layout}
            lens={lens}
            scope={scope}
            focus={focus}
            camera={camera}
            ring={ring}
            onFrameActivate={handleFrameActivate}
            onOpenNode={handleOpenNode}
            onJump={jumpToFlow}
            onAspect={reportAspect}
          />
          {(journalError !== null || !wall.anyShot) && (
            <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex flex-col items-center gap-2 px-3">
              {journalError !== null && (
                <div
                  role="status"
                  className="pointer-events-auto flex max-w-full items-center gap-2 rounded-full border bg-card py-1 pr-1 pl-3 text-xs shadow-sm"
                >
                  <TriangleAlertIcon className="size-3.5 shrink-0 text-amber-500 dark:text-amber-400" aria-hidden="true" />
                  <span>Couldn&apos;t read the journal, so stale shots and deploy proof are unknown.</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 cursor-pointer rounded-full px-2 text-xs"
                    onClick={() => void reloadJournal()}
                  >
                    Retry
                  </Button>
                </div>
              )}
              {!wall.anyShot && (
                <div
                  role="status"
                  className="pointer-events-auto flex max-w-full items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-xs shadow-sm"
                >
                  <ImageOffIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span>
                    No screenshots yet. CI records them with <code className="font-mono">arkaik shot</code>, and
                    anyone can add one from a view&apos;s panel.
                  </span>
                </div>
              )}
            </div>
          )}
          {showBar && (
            <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center px-3">
              <ScreensBar
                platforms={wall.platforms}
                lens={lens}
                onLensChange={handleLensChange}
                announcement={announcement}
              />
            </div>
          )}
        </div>
      )}
    </PageShell>
  );
}
```

- [ ] **Step 2: Route the kind**

In `app/project/[id]/maps/[mapId]/page.tsx`, replace `import { JourneyMap } from "@/components/maps/JourneyMap";` with:

```tsx
import { JourneyMap } from "@/components/maps/JourneyMap";
import { ScreensMap } from "@/components/maps/ScreensMap";
```

and replace:

```tsx
    return <SystemMap projectId={id} definition={definition} />;
  }
```

with:

```tsx
    return <SystemMap projectId={id} definition={definition} />;
  }

  if (definition.kind === "screens") {
    return <ScreensMap projectId={id} definition={definition} />;
  }
```

- [ ] **Step 3: Check**

Run: `npx tsc --noEmit && npm run lint && npm run test:keyboard-shortcuts`
Expected: no type errors; `npm run lint` reports no errors (the three existing `no-img-element` warnings in `PlatformVariants.tsx`/`ShotPreviewDialog.tsx` stay, none in a file of this part); `All keyboard shortcut tests passed` (no hand-rolled `keydown` listener, no new `useShortcut`).

Run: `grep -nE "const jumpToFlow = useCallback|const \{ openNode \} = useProjectPanels\(\)" components/maps/ScreensMap.tsx`
Expected: both lines found (part 5 relies on them).

- [ ] **Step 4: Commit**

```bash
git add components/maps/ScreensMap.tsx "app/project/[id]/maps/[mapId]/page.tsx"
git commit -m "feat(screens): the Screens map — every screen, flow by flow"
```

---

### Task 13: The whole part, alone on its branch

- [ ] **Step 1: Generated artifacts are committed**

Run: `npm run generate && git status --porcelain`
Expected: empty output.

- [ ] **Step 2: Lint, types, every suite this part touches or could reach**

Run:

```bash
npm run lint && npx tsc --noEmit && npm run test:maps && npm run test:mcp && npm run test:schema && npm run validate:seeds && npm run test:command-palette && npm run test:screen-wall && npm run test:screenshot-staleness && npm run test:journey-graph && npm run test:journey-layout && npm run test:product-scope && npm run test:panel-semantics && npm run test:platform-variants-gates && npm run test:keyboard-shortcuts && npm run test:project-panels && npm run test:landing && npm run test:spotlight && npm run test:docs-visibility && npm run test:docs-icons && npm run test:cli
```

Expected: exit 0, and no `FAIL` line in any suite's output. (Rehearsed: all 76 suites of CI's build job passed with this part applied over a stand-in for part 1.)

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: the build succeeds and lists `ƒ /project/[id]/maps/[mapId]`.

---

### Task 14: Manual browser verification (Playwright, not CI)

Run from a scratch directory **outside the repo**; nothing in it is committed. It needs the worktree's dev server: `PORT=4343 npm run dev` in the worktree (4242 may belong to the other checkout; restart the server after every branch switch).

- [ ] **Step 1: Prepare the scratch directory**

```bash
mkdir -p ~/screens-check && cd ~/screens-check
npm init -y >/dev/null && npm i playwright && npx playwright install chromium
```

- [ ] **Step 2: Write the bundle maker**

Create `~/screens-check/make-bundles.js`:

```js
#!/usr/bin/env node
/**
 * Writes the three bundles the Screens map check imports, into this directory:
 *   pebbles.json        — seed/pebbles.json, unchanged (ghost wall, Admin scope)
 *   self-map.json       — seed/arkaik-self-map.json, unchanged (ghost wall, jump tiles)
 *   pebbles-shots.json  — Pebbles with a data-URI PNG in every (view, platform) slot
 *                         (390×844 for iOS and Android, 1440×900 for web), plus a shot
 *                         on V-pebble-detail's iOS slot recorded after all of its own
 *                         events and a later move on a covering acceptance — so only the
 *                         covering-acceptance rule can call that shot stale.
 * Usage: node make-bundles.js <worktree>
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const worktree = process.argv[2];
if (!worktree) {
  console.error("usage: node make-bundles.js <worktree>");
  process.exit(2);
}
const read = (rel) => JSON.parse(fs.readFileSync(path.join(worktree, rel), "utf8"));

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}
/** A solid-colour RGB PNG: deflates to a few kilobytes at any size. */
function png(width, height, [r, g, b]) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) row.set([r, g, b], 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const SIZE = { web: [1440, 900], ios: [390, 844], android: [390, 844] };
const cache = new Map();
function dataUri(platform, index) {
  const colour = [60 + ((index * 37) % 160), 80 + ((index * 59) % 140), 100 + ((index * 83) % 120)];
  const key = `${platform}:${colour.join(",")}`;
  if (!cache.has(key)) {
    const [w, h] = SIZE[platform];
    cache.set(key, `data:image/png;base64,${png(w, h, colour).toString("base64")}`);
  }
  return cache.get(key);
}

const pebbles = read("seed/pebbles.json");
fs.writeFileSync(path.join(__dirname, "pebbles.json"), JSON.stringify(pebbles));
fs.writeFileSync(path.join(__dirname, "self-map.json"), JSON.stringify(read("seed/arkaik-self-map.json")));

const shots = JSON.parse(JSON.stringify(pebbles));
shots.project.title = "Pebbles (shots)";
let slots = 0;
shots.nodes
  .filter((node) => node.species === "view")
  .forEach((view, index) => {
    view.metadata = view.metadata ?? {};
    view.metadata.platformScreenshots = {};
    for (const platform of view.platforms) {
      view.metadata.platformScreenshots[platform] = dataUri(platform, index);
      slots += 1;
    }
  });
const detail = shots.nodes.find((node) => node.id === "V-pebble-detail");
detail.metadata.platformScreenshotMeta = { ios: { ts: "2026-09-01T00:00:00.000Z", source: "manual", form: "data" } };
shots.journal.push({
  id: "01KZSCREENS0STALE000000001",
  ts: "2026-09-02T00:00:00.000Z",
  actor: "claude-code",
  type: "node.status_changed",
  node_id: "AC-emotion-palette-on-read",
  platform: "ios",
  from: "releasing",
  to: "live",
});
const out = JSON.stringify(shots);
fs.writeFileSync(path.join(__dirname, "pebbles-shots.json"), out);
console.log(`pebbles-shots.json: ${slots} shots, ${(out.length / 1024 / 1024).toFixed(2)} MB`);
```

Run: `node make-bundles.js <absolute path of the worktree>`
Expected: `pebbles-shots.json: 146 shots, 0.74 MB` (under the `/projects` page's 5 MB import cap), and three JSON files beside the script. Optional: `node <worktree>/docs/arkaik-skill/scripts/validate-bundle.js pebbles-shots.json` ends `Result: VALID`.

- [ ] **Step 3: Write the check**

Create `~/screens-check/screens-check.js`:

```js
#!/usr/bin/env node
/**
 * Manual browser check for the Screens map, part 2 (not a CI test).
 * Needs: the worktree's dev server on BASE_URL, and the three bundles written
 * by make-bundles.js beside this file. Screenshots land beside this file.
 * Prints one PASS/FAIL line per check and ends with "SCREENS PART 2: ALL CHECKS PASSED".
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const BASE = process.env.BASE_URL ?? "http://localhost:4343";
const OUT = __dirname;
const LOD_ZOOM = 0.35;
const failures = [];
const consoleErrors = [];

function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(name);
}

async function open(browser, { width = 1440, height = 900, colorScheme = "light" } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme });
  await context.addInitScript(() => {
    window.__longTasks = [];
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) window.__longTasks.push(entry.duration);
      }).observe({ type: "longtask", buffered: true });
    } catch {
      // No long-task support: the array stays empty and the check says so.
    }
  });
  const page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(`${page.url()} :: ${message.text()}`);
  });
  page.on("pageerror", (error) => consoleErrors.push(`${page.url()} :: pageerror: ${error.message}`));
  return { context, page };
}

/** Imports a bundle through the /projects file input; returns the new project id. */
async function importBundle(page, file) {
  await page.goto(`${BASE}/projects`);
  await page.locator('input[type="file"]').setInputFiles(path.join(OUT, file));
  await page.waitForURL(/\/project\/[^/?#]+\//, { timeout: 90_000 });
  return decodeURIComponent(page.url().match(/\/project\/([^/?#]+)/)[1]);
}

/** Opens the Screens map and waits for the first strip's camera to settle. */
async function openScreens(page, projectId, query = "") {
  await page.goto(`${BASE}/project/${encodeURIComponent(projectId)}/maps/screens${query}`);
  await page.locator(".react-flow__node-wallHeader").first().waitFor({ timeout: 90_000 });
  await page.waitForTimeout(1200);
}

async function zoom(page) {
  const transform = await page.locator(".react-flow__viewport").evaluate((element) => element.style.transform);
  const match = /scale\(([\d.]+)\)/.exec(transform);
  return match ? Number(match[1]) : NaN;
}

async function paneBox(page) {
  return page.locator(".react-flow").first().boundingBox();
}

/** Frames whose box intersects the canvas — what the camera actually shows. */
async function visibleFrames(page) {
  const pane = await paneBox(page);
  const boxes = await page
    .locator(".react-flow__node-wallFrame")
    .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().toJSON()));
  return boxes.filter(
    (box) =>
      box.right > pane.x && box.left < pane.x + pane.width && box.bottom > pane.y && box.top < pane.y + pane.height,
  ).length;
}

async function shots(page) {
  return page.locator("img[data-wall-shot]").count();
}

async function snap(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

(async () => {
  for (const file of ["pebbles.json", "self-map.json", "pebbles-shots.json"]) {
    if (!fs.existsSync(path.join(OUT, file))) throw new Error(`missing ${file}: run make-bundles.js first`);
  }
  const browser = await chromium.launch();

  // --- 1. Pebbles: listed everywhere, ghost wall, frame click, Admin scope ---
  {
    const { context, page } = await open(browser);
    const id = await importBundle(page, "pebbles.json");

    await page.goto(`${BASE}/project/${encodeURIComponent(id)}/overview`);
    const screensLinks = page.locator(`a[href="/project/${id}/maps/screens"]`);
    const overviewCard = screensLinks.filter({ hasText: "nodes ·" });
    await overviewCard.first().waitFor({ timeout: 60_000 });
    check("the sidebar links to Screens", (await screensLinks.filter({ hasNotText: "nodes ·" }).count()) === 1);
    check("the Overview's Maps card lists Screens: 10 flows + 58 views, no edge",
      /68 nodes · 0 edges/.test(await overviewCard.first().innerText()),
      (await overviewCard.first().innerText()).replace(/\s+/g, " "));

    await page.goto(`${BASE}/project/${encodeURIComponent(id)}/maps`);
    await page.getByText("What is live, screen by screen — every flow as a strip of its screenshots.").waitFor();
    check(
      "the maps index lists Screens with no Edit or Delete",
      (await page.getByRole("button", { name: "Edit Screens" }).count()) === 0 &&
        (await page.getByRole("button", { name: "Delete Screens" }).count()) === 0,
    );

    await page.keyboard.press("ControlOrMeta+k");
    await page.getByRole("combobox").fill("screens");
    const firstOption = page.getByRole("option").first();
    await firstOption.waitFor();
    check("⌘K \"screens\" puts the Screens map first", /Screens/.test(await firstOption.innerText()),
      (await firstOption.innerText()).replace(/\s+/g, " "));
    await page.keyboard.press("Enter");
    await page.waitForURL(/\/maps\/screens/);
    await page.locator(".react-flow__node-wallHeader").first().waitFor({ timeout: 90_000 });
    await page.waitForTimeout(1200);

    check("Pebbles draws a ghost wall: frames, no image", (await visibleFrames(page)) > 0 && (await shots(page)) === 0,
      `${await visibleFrames(page)} visible frames, ${await shots(page)} images`);
    check("the no-shots pill is up", await page.getByText("No screenshots yet.").isVisible());
    check("the lens bar offers three platforms", (await page.getByRole("toolbar", { name: "Screens display" }).getByRole("button").count()) === 3);
    check("the first camera frames the first strip at a readable zoom", (await zoom(page)) >= 0.4 && (await zoom(page)) <= 1,
      `zoom ${await zoom(page)}`);
    await snap(page, "pebbles-1440-light");

    const frame = page.locator(".react-flow__node-wallFrame [role=button]").first();
    const label = await frame.getAttribute("aria-label");
    await frame.click();
    await page.waitForURL(/[?&]node=/);
    await page.waitForTimeout(900);
    const pane = await paneBox(page);
    const box = await frame.boundingBox();
    const dx = Math.abs(box.x + box.width / 2 - (pane.x + pane.width / 2));
    const dy = Math.abs(box.y + box.height / 2 - (pane.y + pane.height / 2));
    check("a frame click opens its view's panel", /[?&]node=V-/.test(page.url()), label ?? "");
    check("…and centres the frame in the narrowed canvas", dx < 40 && dy < 40, `off by ${Math.round(dx)}, ${Math.round(dy)}`);
    await snap(page, "pebbles-panel-open");

    await openScreens(page, id, "?product=admin");
    check("Admin scope: the Journey pointer line", await page.getByText("No flows yet, so these screens aren't lined up.").isVisible());
    check("…above the \"Not in a flow\" strip", await page.getByRole("heading", { name: "Not in a flow" }).isVisible());
    check("…and no lens bar (Admin is web-only)", (await page.getByRole("toolbar", { name: "Screens display" }).count()) === 0);
    await snap(page, "pebbles-admin");

    // Themes and widths.
    for (const colorScheme of ["light", "dark"]) {
      for (const width of [1440, 900, 390]) {
        await page.emulateMedia({ colorScheme });
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        await openScreens(page, id);
        await snap(page, `pebbles-${width}-${colorScheme}`);
        const bar = await page.getByRole("toolbar", { name: "Screens display" }).boundingBox();
        const canvas = await paneBox(page);
        check(`${colorScheme} ${width}: the bar sits inside the canvas`, Boolean(bar) &&
          bar.x >= canvas.x - 1 && bar.x + bar.width <= canvas.x + canvas.width + 1);
        const minimapShown = await page.locator(".react-flow__minimap").isVisible();
        const controlsShown = await page.locator(".react-flow__controls").isVisible();
        check(`${colorScheme} ${width}: Minimap ${canvas.width >= 960 ? "shown" : "hidden"}, Controls ${canvas.width >= 640 ? "shown" : "hidden"}`,
          minimapShown === canvas.width >= 960 && controlsShown === canvas.width >= 640,
          `canvas ${Math.round(canvas.width)}px`);
      }
    }
    await context.close();
  }

  // --- 2. Self-map: ghost wall, single platform, jump tile flies and rings ---
  {
    const { context, page } = await open(browser);
    const id = await importBundle(page, "self-map.json");
    await openScreens(page, id);
    check("the self-map draws a ghost wall with the pill", (await shots(page)) === 0 && (await page.getByText("No screenshots yet.").isVisible()));
    check("…and no lens bar (one platform)", (await page.getByRole("toolbar", { name: "Screens display" }).count()) === 0);
    await snap(page, "self-map-1440-light");

    await page.locator(".react-flow__controls-fitview").click();
    await page.waitForTimeout(800);
    const tile = page.locator(".react-flow__node-wallJump button").first();
    const tileLabel = (await tile.getAttribute("aria-label")) ?? "";
    const target = /^Go to (.*), \d+ screens?$/.exec(tileLabel)?.[1];
    await tile.click();
    await page.waitForTimeout(700);
    const rung = page.locator(".react-flow__node-wallHeader", { has: page.locator("span.ring-2") });
    check("a jump tile rings one header", (await rung.count()) === 1, tileLabel);
    check("…the target strip's", (await rung.first().locator("h2").innerText()).trim() === target, target ?? "");
    check("…flown to at a readable zoom", (await zoom(page)) >= 0.4, `zoom ${await zoom(page)}`);
    await snap(page, "self-map-jump");
    await page.waitForTimeout(2300);
    check("…and the ring clears after 2s", (await page.locator(".react-flow__node-wallHeader span.ring-2").count()) === 0);
    await context.close();
  }

  // --- 3. Pebbles with shots: covering-acceptance staleness, then performance ---
  {
    const { context, page } = await open(browser);
    const id = await importBundle(page, "pebbles-shots.json");

    await openScreens(page, id, "?node=V-pebble-detail");
    await page.getByRole("tab", { name: "iOS" }).first().click();
    await page.waitForTimeout(300);
    check("a covered view's caption reads \"may be stale\" after its acceptance moved",
      await page.getByText(/· may be stale/).first().isVisible());
    await snap(page, "shots-stale-caption");

    await openScreens(page, id);
    await page.waitForTimeout(2000);
    const visible = await visibleFrames(page);
    const images = await shots(page);
    check("after load, images ≤ visible frames + 4", images <= visible + 4 && images > 0, `${images} images, ${visible} visible frames`);
    await snap(page, "shots-1440-light");

    const pane = await paneBox(page);
    await page.evaluate(() => {
      window.__longTasks.length = 0;
    });
    await page.mouse.move(pane.x + 60, pane.y + 60);
    for (let step = 0; step < 10; step += 1) {
      await page.mouse.wheel(0, 200);
      await page.waitForTimeout(120);
    }
    const bottoms = await page
      .locator(".react-flow__node-wallFrame")
      .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().toJSON()));
    const last = bottoms.reduce((lowest, box) => (box.bottom > lowest.bottom ? box : lowest), bottoms[0]);
    await page.mouse.move(last.left + 10, Math.min(last.bottom - 4, pane.y + pane.height - 4));
    for (let step = 0; step < 10; step += 1) {
      await page.mouse.wheel(0, -200);
      await page.waitForTimeout(120);
    }
    await page.waitForTimeout(500);
    const longest = await page.evaluate(() => Math.max(0, ...window.__longTasks));
    check("20 wheel steps, first strip to the last: no long task over 200 ms", longest <= 200, `longest ${Math.round(longest)} ms`);
    check("…ending on the last strip (\"Not in a flow\")",
      (await page.locator('.react-flow__node-wallFrame[data-id$="@loose"]').count()) > 0);

    await page.locator(".react-flow__controls-fitview").click();
    await page.waitForTimeout(800);
    const fitZoom = await zoom(page);
    check("the Controls' fit-view zooms below LOD_ZOOM", fitZoom < LOD_ZOOM, `zoom ${fitZoom}`);
    check("…and no image is mounted there", (await shots(page)) === 0, `${await shots(page)} images`);
    await snap(page, "shots-fit-view");
    await context.close();
  }

  await browser.close();

  fs.writeFileSync(path.join(OUT, "console-errors.txt"), consoleErrors.join("\n"));
  const blocking = consoleErrors.filter((text) =>
    /pageerror|hydrat|Maximum update depth|same key|unique "key"|Cannot update a component/i.test(text),
  );
  check("no page error, hydration or render-loop error in the console", blocking.length === 0, blocking.slice(0, 3).join(" | "));
  console.log(`console errors recorded: ${consoleErrors.length} (console-errors.txt)`);

  if (failures.length > 0) {
    console.log(`\nSCREENS PART 2: ${failures.length} CHECK(S) FAILED`);
    process.exit(1);
  }
  console.log("\nSCREENS PART 2: ALL CHECKS PASSED");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 4: Run it**

With the dev server up in the worktree: `BASE_URL=http://localhost:4343 node screens-check.js`

Expected: 38 `PASS:` lines, no `FAIL:`, then `console errors recorded: N (console-errors.txt)` and, last, exactly:

```
SCREENS PART 2: ALL CHECKS PASSED
```

exit 0. Screenshots land beside the script: `pebbles-{1440,900,390}-{light,dark}.png`, `pebbles-1440-light.png`, `pebbles-panel-open.png`, `pebbles-admin.png`, `self-map-1440-light.png`, `self-map-jump.png`, `shots-stale-caption.png`, `shots-1440-light.png`, `shots-fit-view.png`. Open them: ghosts read their words in both themes; the bar spans the canvas at 390; no token is hard-coded beyond the amber quality styles.

What it covers, against the contract's test strategy: the map is listed (sidebar, the Overview card with `68 nodes · 0 edges`, the index without Edit/Delete, ⌘K "screens" first); both seeds draw ghost walls with the no-shots pill; a frame click opens the view's panel (`?node=V-…`) and centres the frame; a self-map jump tile flies to its strip at zoom ≥ 0.4 and rings that header, which clears after 2s; Pebbles' Admin scope shows the Journey pointer above "Not in a flow" and no bar; a covered view (`V-pebble-detail`, iOS) reads "may be stale" after `AC-emotion-palette-on-read` moved; light and dark at 1440, 900 and 390 (bar inside the canvas; Minimap and Controls follow the 60rem/40rem canvas rules); and the performance check — images ≤ visible frames + 4 after load, no long task over 200 ms across the 20 wheel steps (Contract deviation 5), the walk ending on the last strip, and 0 images after the Controls' fit-view below `LOD_ZOOM`.

If a check fails on a hydration warning, restart the dev server and rerun before investigating.

---

## Part done when

- These pass on `feat/screens-map` alone (part 1 below it, nothing above):
  - `npm run lint` (0 errors), `npx tsc --noEmit`, `npm run build`
  - `npm run generate && git status --porcelain` → empty
  - `npm run test:maps`, `npm run test:mcp`, `npm run test:schema`, `npm run validate:seeds`, `npm run test:command-palette`, `npm run test:screen-wall`, `npm run test:screenshot-staleness`, `npm run test:journey-graph`, `npm run test:product-scope`, `npm run test:panel-semantics`, `npm run test:platform-variants-gates`, `npm run test:keyboard-shortcuts`
- Task 14's script prints `SCREENS PART 2: ALL CHECKS PASSED`, and its screenshots have been looked at in both themes.
- PR (opened with the `gh-stack` skill on top of part 1's), title **`feat(maps): the Screens map — every screen, flow by flow (part 2/5)`**, with this Lab Note in the body. After opening it, read the PR's comments for the reminder's verdict and fix the body, not the code.

````markdown
## Lab Note

```yaml
en:
  title: "Screens: every screen, flow by flow"
  summary: "A new Screens map lines up each flow's real screenshots, one platform at a time, so you can see what is actually live. Missing shots show up as ghost frames that say why."
fr:
  title: "Screens : tous tes écrans, flow par flow"
  summary: "Nouvelle carte Screens : chaque flow devient une bande de vraies captures, plateforme par plateforme, pour voir ce qui est vraiment en ligne. Une capture manque ? Un cadre fantôme te dit pourquoi."
nodes: [V-maps-index, F-browse-maps, V-node-detail-panel]
suggested:
  molecule: arkaik
  type: feature
  tags: [maps, screenshots]
```
````
