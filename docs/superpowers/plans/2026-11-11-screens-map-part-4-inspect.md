# Screens map — Part 4: quick inspector and touch reveal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Selecting a frame on the Screens map shows a quick inspector beside it (each platform's state, shot date, CI or by hand, why a shot is stale, how it went live where the journal can tell, the endpoints and data models it touches, and "Open panel"), and fans the view's endpoints and data models out under the frame as chips connected to it, each opening its node's panel. Escape and a pane click clear the selection; arrow keys move between frames; a cold load with `?node=` frames its view or flow.

**Architecture:** The wall model (part 1) already decides every state, stale reason and live proof. A new pure module, `lib/utils/screen-inspector.ts`, words them for the inspector, places the chips (`planChips`, on part 1's `chipRects`), and says what a selection or a cold load frames; it is tested in Node like the other app utilities. The controller `ScreensMap` owns the selection (`selectFrame`), the camera requests and Escape; `ScreensCanvas` turns the selection into the frame's `selected` flag, chip nodes (`wallChip`) and touch edges (React Flow's `default` type between hidden handles), and follows arrow-key moves; `ScreenInspector` is an overlay in the canvas cell, outside React Flow. The inspector is not a panel kind: the panel descriptor union is not touched.

**Tech Stack:** Next.js App Router, React 19, `@xyflow/react` 12.10, Tailwind v4 (container queries), TanStack hotkeys through `useShortcut`, plain Node test scripts with `ts.transpileModule` loaders.

**Spec:** `docs/superpowers/specs/2026-11-11-screens-map-design.md` (§ Interaction, § Accessibility, keyboard, motion, themes, narrow screens, § Parts › Part 4).

**Contract:** `docs/superpowers/plans/2026-11-11-screens-map-stack.md` (authoritative where it and the spec differ), plus the coordinator's addition: `ScreensMap.tsx` exposes `selectFrame(frameId: string, viewId: string, stripId: string): void`.

**Branch:** `feat/screens-inspect`, created with `gh stack` on top of `feat/screens-side-gaps` (part 3).

**Position in the stack:** part 4 of 5. Below: part 1 `feat/screens-model` (wall model and layout), part 2 `feat/screens-map` (the map, canvas, frames, camera, bar), part 3 `feat/screens-side-gaps` (side by side, gaps). Above: part 5 `feat/screens-palette` (⌘K rows; its handler calls this part's `selectFrame`).

---

## Contract deviations

Each is additive or local to a file part 4 owns; no shared name or signature changes.

1. **A pure module and its suite, not in the contract's file map.** The contract gives part 4 no pure module and no test beyond `keyboard-shortcuts`. The inspector's wording (shot line, stale line, proof line, status rule), the chip plan (how many chips, ids, edges, bounds), the selection rect and the cold-load target are logic a Node test can check, and CI has no browser test, so left inside components they would be untested. Part 4 adds `lib/utils/screen-inspector.ts`, `tests/app/load-screen-inspector.js`, `tests/app/screen-inspector.test.js`, the script `test:screen-inspector`, one CI step and one `.gitignore` line. No other part imports or edits them. The module is not named `screen-wall*` so part 5's "must not touch `lib/utils/screen-wall*.ts`" stays unambiguous.
2. **`ScreensCanvas`'s `focus` prop now carries arrow-key moves, and no longer reaches `<Canvas focus>`.** Part 2 used it to centre a clicked frame through `CameraFocus`; part 4 replaces clicks with selection (camera requests). The spec (§ Keys) says an arrow key pans "if it is off-screen"; `CameraFocus` always centres. So `ScreensCanvas` passes `focus={null}` to `Canvas` and hands `focus` to an internal, non-exported `FrameFocusFollower` that pans only when the target frame is not wholly visible, then focuses it. The prop's name and type are unchanged.
3. **The selection camera rect reserves the inspector's width.** The contract says the selection request frames "the frame box plus its chip column". `selectionRect` widens that rect on the right by `INSPECTOR_W + INSPECTOR_GAP` (336px) so the 320px card sits beside the frame at zoom 1 instead of over it. Zoom bounds stay `minZoom` 0.6, `maxZoom` 1.

Readings of the contract (not deviations, stated so parts 2, 3 and 5 can rely on them):

- The "+N more" chip is connected like the others; its edge id is `touch:<frameId>:more`, matching its chip id `chip:<frameId>:more`.
- Arrow keys move focus only. Enter or Space on the focused frame selects it; Enter again opens the panel (spec § Keys).
- "Also in …" moves the selection to the view's first frame in that strip (through `selectFrame`) and rings that strip's header. It does not call part 2's `jumpToFlow`, which takes a flow id and so cannot reach "Not in a flow".
- A cold `?node=` naming a flow frames its strip (`minZoom` 0.4, `maxZoom` 1) without a ring; naming a view selects its first frame in strip order.
- The pure module types a selection structurally (`InspectorSelection`); `WallSelection` stays in `components/graph/nodes/wall-node-data.ts`, so `lib/` imports nothing from `components/`.

---

## Before you start

- [ ] Confirm the stack below you: `git log --oneline main..HEAD` lists parts 1, 2 and 3, and these exist: `lib/utils/screen-wall.ts`, `lib/utils/screen-wall-layout.ts`, `tests/app/load-screen-wall.js`, `components/maps/ScreensMap.tsx`, `components/graph/ScreensCanvas.tsx`, `components/graph/WallCamera.tsx`, `components/graph/nodes/wall-node-data.ts`, `components/graph/nodes/WallFrameNode.tsx`.
- [ ] Read those five component files once. This plan was written without seeing parts 2 and 3; it anchors on the names the contract fixes (`ScreensCanvasProps`, `WallFrameData`, `onActivate`, `onFrameActivate`, `onOpenNode`, `camera`, `ring`, `focus`, `layout`, `wall`, `WallCamera`, `WALL_BAR_INSET`). Where the real code names a local differently (the camera setter, the ring setter, the frame's keydown handler), use the real name and keep the behaviour this plan describes. Do not rename anything parts 2 or 3 export.
- [ ] Note in `ScreensMap.tsx`: where `wall` and `layout` are computed, where part 2 issues its first camera request, the setters for `camera`, `ring` and `focus`, part 2's `jumpToFlow`, and the element that wraps `<ScreensCanvas>` and `<ScreensBar>`.

## File map

- Create `lib/utils/screen-inspector.ts` — inspector wording, strip links, chip plan, selection rect, cold-load target (pure).
- Create `tests/app/load-screen-inspector.js` — the loader (own build dir, part 1's tables plus this module's).
- Create `tests/app/screen-inspector.test.js` — the suite.
- Modify `package.json` — `"test:screen-inspector": "node tests/app/screen-inspector.test.js"`, directly after `"test:screen-wall"`.
- Modify `.github/workflows/ci.yml` — one step directly after "Screens wall model tests (strips, states, layout, seed census)".
- Modify `.gitignore` — `/tests/app/.test-build-screen-inspector/`, directly after `/tests/app/.test-build-screen-wall/`.
- Modify `lib/utils/keyboard-shortcuts.ts` — the `wall-move` row.
- Modify `tests/app/keyboard-shortcuts.test.js` — the `wall-move` assertions.
- Modify `components/graph/nodes/wall-node-data.ts` — `WallSelection`, `WallChipData`, `WallFrameData.selected`, `WallFrameData.onMove`.
- Create `components/graph/nodes/WallChipNode.tsx` — the touch chip.
- Modify `components/graph/Canvas.tsx` — `wallChip: WallChipNode` in `nodeTypes`.
- Modify `components/graph/nodes/WallFrameNode.tsx` — selected ring, `aria-current`, `data-wall-frame`, arrow keys, hidden bottom source handle.
- Modify `components/graph/ScreensCanvas.tsx` — `selection`, `onPaneClick`, `onFrameMove` props; chips and touch edges; `FrameFocusFollower`.
- Create `components/maps/screens/ScreenInspector.tsx` — the inspector.
- Modify `components/maps/ScreensMap.tsx` — selection, `selectFrame`, activation, pane click, arrows, Escape, "Also in", inspector, cold load.
- Generated artifacts: none expected. Every lucide icon used here (`ExternalLinkIcon`, `HistoryIcon`, and the species and platform icons through `node-styles`) is already in `lib/wobble/wobble-registry.generated.ts`; Task 8 checks it.

Not touched: `lib/utils/panel-stack.ts`, `lib/utils/project-panels.ts` (the descriptor union), `components/panels/**`, the palette (`lib/utils/command-palette.ts`, `components/layout/CommandPalette.tsx`), `packages/**`, `lib/utils/screen-wall*.ts`, `WallCamera.tsx`.

---

### Task 1: Inspector wording, test first

**Files:**
- Create: `tests/app/load-screen-inspector.js`, `tests/app/screen-inspector.test.js`, `lib/utils/screen-inspector.ts`
- Modify: `package.json`, `.github/workflows/ci.yml`, `.gitignore`

Traps: **CI is Node 20** — the suite never `require`s a `.ts` file; the loader transpiles. **Hand-maintained alias tables** — the loader restates part 1's `MODULES` and `SPECIFIER_MAP` (contract § Test strategy) and adds `screen-wall-layout`, `screenshot-ops` and `screen-inspector`; it throws by name on any `@/` require it does not map, so a later import cannot break it silently. No existing loader transpiles the new module.

- [ ] **Step 1: Write the loader, the failing test and the script**

Create `tests/app/load-screen-inspector.js`:

```js
/**
 * Loads lib/utils/screen-inspector.ts (the Screens map's inspector wording and
 * chip placement) into Node without a bundler, the load-journey-graph.js way,
 * together with the wall model it reads.
 *
 * MODULES and SPECIFIER_MAP restate tests/app/load-screen-wall.js's tables (the
 * stack contract fixes them: docs/superpowers/plans/2026-11-11-screens-map-stack.md
 * § Test strategy, part 1) plus this suite's own: screenshot-ops for the shot
 * date, the layout module, which the inspector imports by alias, and the
 * inspector itself. Hand-maintained tables fail silently when a module gains an
 * `@/` import, so this one refuses to: any `@/` require left after the rewrite
 * throws, naming the module and the specifier.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const { loadSchema, BUILD_DIR: SCHEMA_BUILD_DIR } = require("../schema/load-schema");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, ".test-build-screen-inspector");

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
  ["lib/utils/screen-wall-layout.ts", "screen-wall-layout"],
  ["lib/utils/screenshot-ops.ts", "screenshot-ops"],
  ["lib/utils/screen-inspector.ts", "screen-inspector"],
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
  "@/lib/utils/quality": "./quality",
  "@/lib/utils/journey-layout": "./journey-layout",
  "@/lib/utils/journey-card-size": "./journey-card-size",
  "@/lib/utils/journey-graph": "./journey-graph",
  "@/lib/utils/screenshot-staleness": "./screenshot-staleness",
  "@/lib/utils/screen-wall": "./screen-wall",
  "@/lib/utils/screen-wall-layout": "./screen-wall-layout",
  "@/lib/utils/screenshot-ops": "./screenshot-ops",
};

function loadScreenInspector() {
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
    const unmapped = rewritten.match(/require\("(@\/[^"]+)"\)/);
    if (unmapped) {
      throw new Error(`${srcRel} requires ${unmapped[1]}, which tests/app/load-screen-inspector.js does not map`);
    }
    fs.writeFileSync(path.join(BUILD_DIR, `${outName}.js`), rewritten);
  }

  for (const [, outName] of MODULES) {
    delete require.cache[path.join(BUILD_DIR, `${outName}.js`)];
  }
  const layout = require(path.join(BUILD_DIR, "screen-wall-layout.js"));
  return {
    ...require(path.join(BUILD_DIR, "screen-inspector.js")),
    // The model's own word and the layout's own chip column, so the suite
    // checks the inspector against them rather than restating them.
    cellWord: require(path.join(BUILD_DIR, "screen-wall.js")).cellWord,
    chipRects: layout.chipRects,
    CHIP_MAX: layout.CHIP_MAX,
    formatShotDate: require(path.join(BUILD_DIR, "screenshot-ops.js")).formatShotDate,
  };
}

module.exports = { loadScreenInspector, BUILD_DIR };
```

Create `tests/app/screen-inspector.test.js` (Task 2 replaces the destructuring and the marker comment near the end):

```js
#!/usr/bin/env node

/**
 * The Screens map's quick inspector and touch reveal
 * (docs/superpowers/specs/2026-11-11-screens-map-design.md § Interaction):
 * how lib/utils/screen-inspector.ts words a screen's platform cells, which
 * strips it links to, where the touch chips go, and what a selection or a cold
 * `?node=` load frames. The wall is built by hand here: buildWall's own rules
 * are tests/app/screen-wall.test.js's job.
 *
 * Dates go through formatShotDate (toLocaleDateString), so every expected date
 * is computed the same way rather than pinned.
 */

const assert = require("node:assert/strict");
const { loadScreenInspector } = require("./load-screen-inspector");

const {
  shotLine,
  staleLine,
  proofLine,
  inspectorRows,
  stripLinks,
  frameInStrip,
  cellWord,
  formatShotDate,
} = loadScreenInspector();

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures++;
    console.error(`  ✗ ${name}\n    ${error.message}`);
  }
}

const day = (ts) => formatShotDate(ts);

function cell(platform, state, overrides = {}) {
  return { platform, state, status: null, shot: null, staleBecause: [], proof: null, ...overrides };
}
function shot(source, ts, overrides = {}) {
  return { value: "data:image/png;base64,AA==", form: "data", source, ts, commit: null, ...overrides };
}
function reason(id, ts, label) {
  return { eventId: id, ts, kind: "status", nodeId: "V-a", label };
}

const T1 = "2026-10-01T10:00:00.000Z";
const T2 = "2026-10-05T10:00:00.000Z";
const T3 = "2026-10-15T09:00:00.000Z";

const screenA = {
  viewId: "V-a",
  title: "Check-in sheet",
  cells: {
    web: cell("web", "live-current", { status: "live", shot: shot("ci", T1, { commit: "a1b2c3d" }), proof: { kind: "hand", ts: T1, actor: "alexis", detail: null } }),
    ios: cell("ios", "live-stale", {
      status: "live",
      shot: shot("manual", T1),
      staleBecause: [reason("e3", T3, "AC-x moved to Live on iOS"), reason("e2", T2, "Pull request merged"), reason("e1", T1, "Shipped: Weekly wrap")],
      proof: { kind: "deploy", ts: T3, actor: "arkaik-ci", detail: "TestFlight build 412" },
    }),
    android: cell("android", "not-live", { status: "development", shot: shot(null, null) }),
  },
  touches: [],
  stripIds: ["strip:F-checkin", "strip:F-weekly", "strip:loose"],
};

const wall = {
  strips: [
    { id: "strip:F-checkin", flowId: "F-checkin", title: "Daily check-in", items: [{ kind: "frame", id: "V-a@F-checkin:0", viewId: "V-a" }], viewIds: ["V-a"] },
    {
      id: "strip:F-weekly",
      flowId: "F-weekly",
      title: "Weekly wrap",
      items: [
        { kind: "arm", id: "arm:F-weekly:0.0", branch: "condition", label: "Has a streak?", arm: "Yes", first: true, empty: false },
        { kind: "frame", id: "V-a@F-weekly:0.0.0", viewId: "V-a" },
        { kind: "frame", id: "V-a@F-weekly:1", viewId: "V-a" },
      ],
      viewIds: ["V-a"],
    },
    { id: "strip:loose", flowId: null, title: "Not in a flow", items: [{ kind: "frame", id: "V-a@loose", viewId: "V-a" }], viewIds: ["V-a"] },
  ],
  screens: new Map([["V-a", screenA]]),
  platforms: ["web", "ios", "android"],
  empty: null,
  anyShot: true,
};

console.log("screen inspector: wording");

test("a CI shot reads its date and From CI", () => {
  assert.equal(shotLine(screenA.cells.web), `Shot ${day(T1)} · From CI`);
});

test("a manual shot reads Recorded by hand", () => {
  assert.equal(shotLine(screenA.cells.ios), `Shot ${day(T1)} · Recorded by hand`);
});

test("a slot with no provenance reads Legacy shot, with no date to give", () => {
  assert.equal(shotLine(screenA.cells.android), "Legacy shot");
});

test("an empty slot has no shot line, and a malformed date is left out rather than printed", () => {
  assert.equal(shotLine(cell("web", "live-no-shot", { status: "live" })), null);
  assert.equal(shotLine(cell("web", "live-current", { shot: shot("ci", "not a date") })), "From CI");
});

test("the stale line is the newest reason, its date, and how many more", () => {
  assert.equal(staleLine(screenA.cells.ios), `AC-x moved to Live on iOS · ${day(T3)} · and 2 more`);
  assert.equal(
    staleLine(cell("ios", "live-stale", { staleBecause: [reason("e9", T2, "Pull request merged")] })),
    `Pull request merged · ${day(T2)}`,
  );
  assert.equal(staleLine(screenA.cells.web), null);
});

test("proof: a deploy names its date and its evidence", () => {
  assert.equal(proofLine(screenA.cells.ios), `Live from a deploy · ${day(T3)} · TestFlight build 412`);
  assert.equal(
    proofLine(cell("ios", "live-current", { proof: { kind: "deploy", ts: T3, actor: "arkaik-ci", detail: null } })),
    `Live from a deploy · ${day(T3)}`,
  );
});

test("proof: by hand, with or without a recorded move", () => {
  assert.equal(proofLine(screenA.cells.web), `Live, set by hand · ${day(T1)}`);
  assert.equal(proofLine(cell("web", "live-current", { proof: { kind: "hand", ts: null, actor: null, detail: null } })), "Live, set by hand");
});

test("proof: unknown says so, and a cell that is not live has no proof line", () => {
  assert.equal(
    proofLine(cell("web", "live-no-shot", { proof: { kind: "unknown", ts: null, actor: null, detail: null } })),
    "No record of how this went live",
  );
  assert.equal(proofLine(screenA.cells.android), null);
});

test("one row per platform of the wall, in the wall's order, worded by the model's cellWord", () => {
  const rows = inspectorRows(wall, screenA);
  assert.deepEqual(rows.map((row) => row.platform), ["web", "ios", "android"]);
  assert.deepEqual(rows.map((row) => row.platformLabel), ["Web", "iOS", "Android"]);
  assert.deepEqual(rows.map((row) => row.word), [screenA.cells.web, screenA.cells.ios, screenA.cells.android].map(cellWord));
  assert.deepEqual(rows.map((row) => row.tone), ["live", "gap", "quiet"]);
  assert.deepEqual(rows.map((row) => row.state), ["live-current", "live-stale", "not-live"]);
});

test("a row names the status only when its word does not already say it", () => {
  const rows = inspectorRows(wall, screenA);
  assert.equal(rows[0].status, null, "Live says Live");
  assert.equal(rows[1].status, "Live", "Stale is still Live");
  assert.equal(rows[2].status, null, "a not-live word is the status label itself");
  const absent = inspectorRows({ ...wall, platforms: ["web"] }, { ...screenA, cells: { web: cell("web", "absent", { status: "live" }) } });
  assert.equal(absent[0].status, null, "an absent platform names no status");
});

test("rows carry the shot, stale and proof lines; a platform with no cell is left out", () => {
  const rows = inspectorRows(wall, screenA);
  assert.equal(rows[1].shot, shotLine(screenA.cells.ios));
  assert.equal(rows[1].stale, staleLine(screenA.cells.ios));
  assert.equal(rows[1].proof, proofLine(screenA.cells.ios));
  const partial = inspectorRows(wall, { ...screenA, cells: { ios: screenA.cells.ios } });
  assert.deepEqual(partial.map((row) => row.platform), ["ios"]);
});

test("strip links: the strip it was selected in, then the others in strip order", () => {
  const { current, also } = stripLinks(wall, screenA, "strip:F-weekly");
  assert.deepEqual(current, { stripId: "strip:F-weekly", title: "Weekly wrap" });
  assert.deepEqual(also, [
    { stripId: "strip:F-checkin", title: "Daily check-in" },
    { stripId: "strip:loose", title: "Not in a flow" },
  ]);
});

test("strip links skip an id the wall does not have", () => {
  const { current, also } = stripLinks(wall, { ...screenA, stripIds: ["strip:F-checkin", "strip:gone"] }, "strip:F-gone");
  assert.equal(current, null);
  assert.deepEqual(also, [{ stripId: "strip:F-checkin", title: "Daily check-in" }]);
});

test("frameInStrip finds the view's first frame in that strip, past markers", () => {
  assert.equal(frameInStrip(wall, "strip:F-weekly", "V-a"), "V-a@F-weekly:0.0.0");
  assert.equal(frameInStrip(wall, "strip:loose", "V-a"), "V-a@loose");
  assert.equal(frameInStrip(wall, "strip:F-weekly", "V-b"), null);
  assert.equal(frameInStrip(wall, "strip:nope", "V-a"), null);
});

// --- chips, selection and cold load (Task 2) ---

if (failures) {
  console.error(`\n${failures} failing`);
  process.exit(1);
}
console.log("\nAll screen inspector tests passed");
```

Add the script to `package.json`, directly after the `"test:screen-wall"` line:

```json
    "test:screen-inspector": "node tests/app/screen-inspector.test.js",
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:screen-inspector`
Expected: FAIL — `Error: ENOENT: no such file or directory, open '…/lib/utils/screen-inspector.ts'`, exit 1.

- [ ] **Step 3: Write the wording half of the module**

Create `lib/utils/screen-inspector.ts`:

```ts
/**
 * The Screens map's quick inspector and touch reveal, as plain data
 * (docs/superpowers/specs/2026-11-11-screens-map-design.md § Interaction).
 *
 * Pure: no React, no DOM. The wall model (`screen-wall.ts`) has already
 * decided every state, stale reason and live proof; this module only words
 * them for the inspector, places the touch chips under a selected frame, and
 * says what a selection or a cold `?node=` load should put on screen.
 *
 * Every `@/` import here is listed in tests/app/load-screen-inspector.js. Add
 * one and that loader throws by name until its table learns it.
 */

import { platformLabel, type PlatformId } from "@/lib/config/platforms";
import { STATUSES, type StatusId } from "@/lib/config/statuses";
import { formatShotDate } from "@/lib/utils/screenshot-ops";
import {
  cellWord,
  type PlatformCell,
  type ShotState,
  type Wall,
  type WallItem,
  type WallScreen,
} from "@/lib/utils/screen-wall";

/** How a row reads at a glance: a current live shot, a gap to fix, or nothing to act on. */
export type InspectorTone = "live" | "gap" | "quiet";

/** One platform's line in the inspector. Every string is ready to render; null means "leave the line out". */
export interface InspectorRow {
  platform: PlatformId;
  platformLabel: string;
  state: ShotState;
  /** The side-by-side word (`cellWord`): "Live", "Stale", "No shot", "Unset", "Absent" or a status label. */
  word: string;
  tone: InspectorTone;
  /** The status label, only when the word does not already say it ("Stale" and "No shot" are both Live). */
  status: string | null;
  /** "Shot 03/11/2026 · From CI", "Shot … · Recorded by hand", "Legacy shot". */
  shot: string | null;
  /** The newest stale reason, its date, and "and N more". */
  stale: string | null;
  /** "Live from a deploy · <date> · <detail>", "Live, set by hand · <date>", "No record of how this went live". */
  proof: string | null;
}

const TONES: Record<ShotState, InspectorTone> = {
  "live-current": "live",
  "live-stale": "gap",
  "live-no-shot": "gap",
  "not-live": "quiet",
  absent: "quiet",
};

const SOURCE_WORDS: Record<"ci" | "manual" | "legacy", string> = {
  ci: "From CI",
  manual: "Recorded by hand",
  legacy: "Legacy shot",
};

function dateOf(ts: string | null | undefined): string | undefined {
  return ts ? formatShotDate(ts) : undefined;
}

function statusLabel(status: StatusId): string {
  return STATUSES.find((entry) => entry.id === status)?.label ?? status;
}

/** Who recorded the slot's shot and when; null when the slot is empty. */
export function shotLine(cell: PlatformCell): string | null {
  const shot = cell.shot;
  if (!shot) return null;
  const who = SOURCE_WORDS[shot.source ?? "legacy"];
  const date = dateOf(shot.ts);
  return date ? `Shot ${date} · ${who}` : who;
}

/** Why the shot may be stale: the newest reason (the model orders them newest first) and how many more. */
export function staleLine(cell: PlatformCell): string | null {
  const [newest, ...rest] = cell.staleBecause;
  if (!newest) return null;
  const date = dateOf(newest.ts);
  const head = date ? `${newest.label} · ${date}` : newest.label;
  return rest.length > 0 ? `${head} · and ${rest.length} more` : head;
}

/** How the platform went live, as far as the journal can tell; null when the cell is not live. */
export function proofLine(cell: PlatformCell): string | null {
  const proof = cell.proof;
  if (!proof) return null;
  if (proof.kind === "unknown") return "No record of how this went live";
  const date = dateOf(proof.ts);
  const parts = proof.kind === "deploy" ? ["Live from a deploy", date, proof.detail] : ["Live, set by hand", date];
  return parts.filter((part): part is string => typeof part === "string" && part.length > 0).join(" · ");
}

/** One row per platform of the wall's menu, in `wall.platforms` order; a platform with no cell is left out. */
export function inspectorRows(wall: Wall, screen: WallScreen): InspectorRow[] {
  const rows: InspectorRow[] = [];
  for (const platform of wall.platforms) {
    const cell = screen.cells[platform];
    if (!cell) continue;
    const word = cellWord(cell);
    const label = cell.status ? statusLabel(cell.status) : null;
    rows.push({
      platform,
      platformLabel: platformLabel(platform),
      state: cell.state,
      word,
      tone: TONES[cell.state],
      status: cell.state !== "absent" && label !== null && label !== word ? label : null,
      shot: shotLine(cell),
      stale: staleLine(cell),
      proof: proofLine(cell),
    });
  }
  return rows;
}

export interface StripLink {
  stripId: string;
  title: string;
}

/** The strip the frame was selected in, and the view's other strips in strip order ("Also in …"). */
export function stripLinks(wall: Wall, screen: WallScreen, stripId: string): { current: StripLink | null; also: StripLink[] } {
  const titles = new Map(wall.strips.map((strip) => [strip.id, strip.title]));
  const link = (id: string): StripLink | null => {
    const title = titles.get(id);
    return title === undefined ? null : { stripId: id, title };
  };
  return {
    current: link(stripId),
    also: screen.stripIds
      .filter((id) => id !== stripId)
      .map(link)
      .filter((entry): entry is StripLink => entry !== null),
  };
}

/** The view's first frame in a strip, or null when the strip does not list it. */
export function frameInStrip(wall: Wall, stripId: string, viewId: string): string | null {
  const strip = wall.strips.find((entry) => entry.id === stripId);
  const frame = strip?.items.find(
    (item): item is Extract<WallItem, { kind: "frame" }> => item.kind === "frame" && item.viewId === viewId,
  );
  return frame ? frame.id : null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:screen-inspector`
Expected: `screen inspector: wording`, 14 `✓` lines, `All screen inspector tests passed`, exit 0.

If the loader throws `… requires @/…, which tests/app/load-screen-inspector.js does not map`, part 1's modules import something the contract did not list: add that specifier to `SPECIFIER_MAP` (and its source to `MODULES` if it is a runtime import), nothing else.

- [ ] **Step 5: Wire CI and the ignore file, then commit**

In `.github/workflows/ci.yml`, directly after the step `- name: Screens wall model tests (strips, states, layout, seed census)` and its `run:` line, add (plain YAML, same indentation as its neighbours):

```yaml

      - name: Screens inspector tests (wording, chips, cold-load target)
        run: npm run test:screen-inspector
```

In `.gitignore`, directly after `/tests/app/.test-build-screen-wall/`, add:

```
/tests/app/.test-build-screen-inspector/
```

Run: `actionlint .github/workflows/ci.yml` (installed locally at `/opt/homebrew/bin/actionlint`; CI runs it on every workflow) and `git status --porcelain`.
Expected: actionlint prints nothing; `git status` shows no `.test-build-screen-inspector` entry.

```bash
git add lib/utils/screen-inspector.ts tests/app/load-screen-inspector.js tests/app/screen-inspector.test.js package.json .github/workflows/ci.yml .gitignore
git commit -m "feat(screens): the inspector's wording for a screen's platforms, as plain data"
```

---

### Task 2: Chips, the selection rect and the cold-load target, test first

**Files:**
- Modify: `tests/app/screen-inspector.test.js`, `lib/utils/screen-inspector.ts`

- [ ] **Step 1: Write the failing tests**

In `tests/app/screen-inspector.test.js`, replace the destructuring at the top:

```js
const {
  shotLine,
  staleLine,
  proofLine,
  inspectorRows,
  stripLinks,
  frameInStrip,
  cellWord,
  formatShotDate,
} = loadScreenInspector();
```

with:

```js
const {
  shotLine,
  staleLine,
  proofLine,
  inspectorRows,
  stripLinks,
  frameInStrip,
  frameBoxOf,
  planChips,
  chipIdOf,
  touchEdgeIdOf,
  MORE_CHIP_KEY,
  selectionRect,
  coldLoadTarget,
  INSPECTOR_W,
  INSPECTOR_GAP,
  cellWord,
  formatShotDate,
  chipRects,
  CHIP_MAX,
} = loadScreenInspector();
```

Then replace the line `// --- chips, selection and cold load (Task 2) ---` and the blank line after it with:

```js
// --- chips, selection and cold load (Task 2) ---

console.log("screen inspector: chips, selection, cold load");

function touch(n, species = n % 2 ? "data-model" : "api-endpoint") {
  return { nodeId: `${species === "api-endpoint" ? "API" : "DM"}-${n}`, species, title: `Touch ${n}`, status: "live" };
}
const touches = (count) => Array.from({ length: count }, (_, i) => touch(i + 1));

function box(id, kind, stripId, x, y, width, height) {
  return { id, kind, stripId, row: 0, x, y, width, height, shotWidth: kind === "frame" ? width : null };
}
const FRAME = box("V-a@F-checkin:0", "frame", "strip:F-checkin", 0, 56, 448, 324);
const layout = {
  boxes: [
    box("strip:F-checkin", "header", "strip:F-checkin", 0, 0, 448, 44),
    FRAME,
    box("strip:F-weekly", "header", "strip:F-weekly", 0, 452, 1000, 44),
    box("arm:F-weekly:0.0", "arm", "strip:F-weekly", 0, 508, 24, 280),
    box("V-a@F-weekly:0.0.0", "frame", "strip:F-weekly", 48, 508, 144, 324),
  ],
  strips: new Map([
    ["strip:F-checkin", { x: 0, y: 0, width: 448, height: 380 }],
    ["strip:F-weekly", { x: 0, y: 452, width: 1000, height: 380 }],
  ]),
  bounds: { x: 0, y: 0, width: 1000, height: 832 },
};
const wallWithTouches = {
  ...wall,
  screens: new Map([["V-a", { ...screenA, touches: touches(14) }]]),
};

test("chip and edge ids follow the contract", () => {
  assert.equal(chipIdOf("V-a@F-checkin:0", "API-1"), "chip:V-a@F-checkin:0:API-1");
  assert.equal(touchEdgeIdOf("V-a@F-checkin:0", "API-1"), "touch:V-a@F-checkin:0:API-1");
  assert.equal(chipIdOf("V-a@F-checkin:0", MORE_CHIP_KEY), "chip:V-a@F-checkin:0:more");
});

test("a few touches: one chip each, in the model's order, on the layout's chip rects", () => {
  const plan = planChips(FRAME, touches(3));
  assert.deepEqual(plan.chips.map((chip) => chip.kind), ["touch", "touch", "touch"]);
  assert.deepEqual(plan.chips.map((chip) => chip.touch.nodeId), ["DM-1", "API-2", "DM-3"]);
  assert.deepEqual(plan.chips.map((chip) => chip.rect), chipRects(FRAME, 3));
  assert.deepEqual(plan.chips.map((chip) => chip.id), ["DM-1", "API-2", "DM-3"].map((id) => chipIdOf(FRAME.id, id)));
});

test("every chip has one edge from the frame", () => {
  const plan = planChips(FRAME, touches(3));
  assert.deepEqual(
    plan.edges,
    plan.chips.map((chip) => ({ id: touchEdgeIdOf(FRAME.id, chip.touch.nodeId), source: FRAME.id, target: chip.id })),
  );
});

test("exactly CHIP_MAX touches: no more chip", () => {
  const plan = planChips(FRAME, touches(CHIP_MAX));
  assert.equal(plan.chips.length, CHIP_MAX);
  assert.ok(plan.chips.every((chip) => chip.kind === "touch"));
});

test("past CHIP_MAX: the first CHIP_MAX, then one +N more chip with its own edge", () => {
  const plan = planChips(FRAME, touches(14));
  assert.equal(plan.chips.length, CHIP_MAX + 1);
  const more = plan.chips[CHIP_MAX];
  assert.equal(more.kind, "more");
  assert.equal(more.count, 14 - CHIP_MAX);
  assert.equal(more.id, chipIdOf(FRAME.id, MORE_CHIP_KEY));
  assert.deepEqual(more.rect, chipRects(FRAME, CHIP_MAX + 1)[CHIP_MAX]);
  assert.deepEqual(plan.edges[CHIP_MAX], { id: touchEdgeIdOf(FRAME.id, MORE_CHIP_KEY), source: FRAME.id, target: more.id });
});

test("the plan's bounds cover the frame and every chip", () => {
  const plan = planChips(FRAME, touches(14));
  const rects = [FRAME, ...plan.chips.map((chip) => chip.rect)];
  const left = Math.min(...rects.map((r) => r.x));
  const top = Math.min(...rects.map((r) => r.y));
  assert.deepEqual(plan.bounds, {
    x: left,
    y: top,
    width: Math.max(...rects.map((r) => r.x + r.width)) - left,
    height: Math.max(...rects.map((r) => r.y + r.height)) - top,
  });
});

test("no touches: no chips, no edges, the frame alone", () => {
  const plan = planChips(FRAME, []);
  assert.deepEqual(plan.chips, []);
  assert.deepEqual(plan.edges, []);
  assert.deepEqual(plan.bounds, { x: FRAME.x, y: FRAME.y, width: FRAME.width, height: FRAME.height });
});

test("frameBoxOf finds frames only", () => {
  assert.equal(frameBoxOf(layout, FRAME.id), FRAME);
  assert.equal(frameBoxOf(layout, "strip:F-checkin"), null, "a header is not a frame");
  assert.equal(frameBoxOf(layout, "V-z@nowhere"), null);
});

test("a selection frames the frame, its chips, and room for the inspector on the right", () => {
  const rect = selectionRect(wallWithTouches, layout, FRAME.id, "V-a");
  const { bounds } = planChips(FRAME, touches(14));
  assert.deepEqual(rect, { ...bounds, width: bounds.width + INSPECTOR_GAP + INSPECTOR_W });
  assert.equal(selectionRect(wallWithTouches, layout, "V-z@nowhere", "V-a"), null);
});

test("cold load on a view: its first frame in strip order, selected in that frame's strip", () => {
  const target = coldLoadTarget(wallWithTouches, layout, "V-a");
  assert.equal(target.kind, "frame");
  assert.deepEqual(target.selection, { frameId: "V-a@F-checkin:0", viewId: "V-a", stripId: "strip:F-checkin" });
  assert.deepEqual(target.rect, selectionRect(wallWithTouches, layout, "V-a@F-checkin:0", "V-a"));
});

test("cold load on a flow: its strip", () => {
  assert.deepEqual(coldLoadTarget(wallWithTouches, layout, "F-weekly"), {
    kind: "strip",
    stripId: "strip:F-weekly",
    rect: layout.strips.get("strip:F-weekly"),
  });
});

test("cold load on nothing, or on a node not on the wall: no target", () => {
  assert.equal(coldLoadTarget(wallWithTouches, layout, null), null);
  assert.equal(coldLoadTarget(wallWithTouches, layout, "API-1"), null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:screen-inspector`
Expected: FAIL — the 14 wording tests pass, then 12 `✗` lines such as `chipIdOf is not a function` and `coldLoadTarget is not a function`, `12 failing`, exit 1.

- [ ] **Step 3: Write the chip, selection and cold-load half**

In `lib/utils/screen-inspector.ts`, replace the import block:

```ts
import { platformLabel, type PlatformId } from "@/lib/config/platforms";
import { STATUSES, type StatusId } from "@/lib/config/statuses";
import { formatShotDate } from "@/lib/utils/screenshot-ops";
import {
  cellWord,
  type PlatformCell,
  type ShotState,
  type Wall,
  type WallItem,
  type WallScreen,
} from "@/lib/utils/screen-wall";
```

with:

```ts
import { platformLabel, type PlatformId } from "@/lib/config/platforms";
import { STATUSES, type StatusId } from "@/lib/config/statuses";
import { formatShotDate } from "@/lib/utils/screenshot-ops";
import {
  cellWord,
  frameIdsOf,
  stripIdOf,
  type PlatformCell,
  type ShotState,
  type Wall,
  type WallItem,
  type WallScreen,
  type WallTouch,
} from "@/lib/utils/screen-wall";
import { CHIP_MAX, chipRects, type Rect, type WallBox, type WallLayout } from "@/lib/utils/screen-wall-layout";
```

Append to the end of the file:

```ts
/** A selection, structurally. `WallSelection` (components/graph/nodes/wall-node-data.ts) satisfies it. */
export interface InspectorSelection {
  frameId: string;
  viewId: string;
  stripId: string;
}

/** The layout box of a frame, or null when the id is not a frame on this layout. */
export function frameBoxOf(layout: WallLayout, frameId: string): WallBox | null {
  return layout.boxes.find((box) => box.kind === "frame" && box.id === frameId) ?? null;
}

/** The key of the "+N more" chip and its edge, in place of a node id. */
export const MORE_CHIP_KEY = "more";

/** `chip:<frameId>:<nodeId>`, or `chip:<frameId>:more`. */
export function chipIdOf(frameId: string, key: string): string {
  return `chip:${frameId}:${key}`;
}

/** `touch:<frameId>:<nodeId>`, or `touch:<frameId>:more`. */
export function touchEdgeIdOf(frameId: string, key: string): string {
  return `touch:${frameId}:${key}`;
}

export type PlannedChip =
  | { id: string; kind: "touch"; rect: Rect; touch: WallTouch }
  | { id: string; kind: "more"; rect: Rect; count: number };

export interface PlannedTouchEdge {
  id: string;
  /** The frame. */
  source: string;
  /** The chip. */
  target: string;
}

export interface ChipPlan {
  chips: PlannedChip[];
  edges: PlannedTouchEdge[];
  /** The frame box and every chip: what a selection frames. */
  bounds: Rect;
}

function unionRects(rects: readonly Rect[]): Rect {
  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * The touch chips under a selected frame: the first `CHIP_MAX` touches in the
 * model's order (endpoints, then models, each by title), then one "+N more"
 * chip when there are more. Rects come from `chipRects`; one edge per chip.
 */
export function planChips(frame: WallBox, touches: readonly WallTouch[]): ChipPlan {
  const overflow = touches.length > CHIP_MAX;
  const shown = overflow ? touches.slice(0, CHIP_MAX) : touches;
  const rects = chipRects(frame, shown.length + (overflow ? 1 : 0));
  const chips: PlannedChip[] = shown.map((touch, index) => ({
    id: chipIdOf(frame.id, touch.nodeId),
    kind: "touch",
    rect: rects[index],
    touch,
  }));
  if (overflow) {
    chips.push({ id: chipIdOf(frame.id, MORE_CHIP_KEY), kind: "more", rect: rects[shown.length], count: touches.length - CHIP_MAX });
  }
  const edges = chips.map((chip) => ({
    id: touchEdgeIdOf(frame.id, chip.kind === "touch" ? chip.touch.nodeId : MORE_CHIP_KEY),
    source: frame.id,
    target: chip.id,
  }));
  return { chips, edges, bounds: unionRects([frame, ...rects]) };
}

/** The inspector card's width and its gap to the canvas edge, in px (`w-80`, `right-3` plus a margin). */
export const INSPECTOR_W = 320;
export const INSPECTOR_GAP = 16;

/**
 * What a selection's camera request frames: the frame box and its chip column,
 * widened on the right by the inspector's width so that, at zoom 1, the card
 * sits beside the frame instead of over it. Null when the frame is not laid out.
 */
export function selectionRect(wall: Wall, layout: WallLayout, frameId: string, viewId: string): Rect | null {
  const frame = frameBoxOf(layout, frameId);
  if (!frame) return null;
  const { bounds } = planChips(frame, wall.screens.get(viewId)?.touches ?? []);
  return { ...bounds, width: bounds.width + INSPECTOR_GAP + INSPECTOR_W };
}

export type ColdLoadTarget =
  | { kind: "frame"; selection: InspectorSelection; rect: Rect }
  | { kind: "strip"; stripId: string; rect: Rect };

/**
 * What a cold load addressing `?node=` frames: a view's first frame in strip
 * order (selected), or a flow's strip. Null when the id is absent or not on
 * the wall, and the controller keeps its default (the first strip).
 */
export function coldLoadTarget(wall: Wall, layout: WallLayout, nodeId: string | null): ColdLoadTarget | null {
  if (!nodeId) return null;
  const [frameId] = frameIdsOf(wall, nodeId);
  if (frameId !== undefined) {
    const frame = frameBoxOf(layout, frameId);
    const rect = selectionRect(wall, layout, frameId, nodeId);
    if (frame && rect) return { kind: "frame", selection: { frameId, viewId: nodeId, stripId: frame.stripId }, rect };
  }
  const stripId = stripIdOf(nodeId);
  const rect = layout.strips.get(stripId);
  return rect ? { kind: "strip", stripId, rect } : null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:screen-inspector && npx tsc --noEmit && npx eslint lib/utils/screen-inspector.ts`
Expected: 26 `✓` lines, `All screen inspector tests passed`; no type errors; no lint output.

- [ ] **Step 5: Commit**

```bash
git add lib/utils/screen-inspector.ts tests/app/screen-inspector.test.js
git commit -m "feat(screens): plan the touch chips, the selection's frame and the cold-load target"
```

---

### Task 3: The `wall-move` row, test first

**Files:**
- Modify: `tests/app/keyboard-shortcuts.test.js`, `lib/utils/keyboard-shortcuts.ts`

Trap: **source-reading suite.** `keyboard-shortcuts.test.js` requires every literal `useShortcut("id")` to name a row with hotkeys, and forbids `window`/`document` keydown listeners. `wall-move` has no hotkeys, so nothing may ever call `useShortcut("wall-move")`; the arrows live in the frame's `onKeyDown` (Task 5). Part 3 edited the three filter rows' descriptions in the same file; this task touches only the `map` group.

- [ ] **Step 1: Write the failing assertions**

In `tests/app/keyboard-shortcuts.test.js`, directly before the line `  // --- rendering ---`, add:

```js
  // --- the Screens map's arrow keys ---
  // Documentation only: the focused frame's own onKeyDown moves between
  // screens, so the row registers nothing and `useShortcut` refuses it.
  const mapRows = (projectGroups.find((group) => group.id === "map") ?? { shortcuts: [] }).shortcuts;
  const wallMove = mapRows.find((s) => s.id === "wall-move");
  assert(Boolean(wallMove), "the Maps group documents moving between screens (wall-move)");
  assert(wallMove?.scope === "map", "wall-move is scoped to maps");
  assert(wallMove !== undefined && wallMove.hotkeys === undefined, "wall-move registers no hotkeys");
  assert(wallMove?.keys.join(" ") === "← ↑ → ↓", "wall-move shows the four arrows");
  assert(!docsIds.includes("wall-move"), "wall-move stays out of the docs sheet");
  threw = false;
  try {
    getShortcut("wall-move");
  } catch {
    threw = true;
  }
  assert(threw, "getShortcut refuses wall-move (nothing to register)");
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:keyboard-shortcuts`
Expected: FAIL — `FAIL: the Maps group documents moving between screens (wall-move)`, `FAIL: wall-move is scoped to maps`, `FAIL: wall-move registers no hotkeys`, `FAIL: wall-move shows the four arrows`, then `4 test(s) failed`, exit 1.

- [ ] **Step 3: Add the row**

In `lib/utils/keyboard-shortcuts.ts`, in the `map` group, directly after the `open-node` row (`altKeys: ["Space"], scope: "map", },`), add:

```ts
      {
        // Documentation only: the focused frame's own onKeyDown moves between
        // screens (components/graph/nodes/WallFrameNode.tsx), never a hotkey.
        id: "wall-move",
        description: "Move between screens (Screens map)",
        keys: ["←", "↑", "→", "↓"],
        scope: "map",
      },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:keyboard-shortcuts`
Expected: six `PASS: …wall-move…` lines, `All keyboard shortcut tests passed`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add lib/utils/keyboard-shortcuts.ts tests/app/keyboard-shortcuts.test.js
git commit -m "feat(shortcuts): document the Screens map's arrow keys"
```

---

### Task 4: The touch chip node

**Files:**
- Modify: `components/graph/nodes/wall-node-data.ts`, `components/graph/Canvas.tsx`
- Create: `components/graph/nodes/WallChipNode.tsx`

Trap: **a widened type breaks `tsc` until its consumer lands.** This task adds only new types (`WallSelection`, `WallChipData`), which nothing else must satisfy yet. The two required `WallFrameData` fields (`selected`, `onMove`) land in Task 5 with the builder that fills them; adding them here reds `tsc` in `ScreensCanvas` (rehearsed: `TS2739 … missing the following properties from type 'WallFrameData': selected, onMove`).

- [ ] **Step 1: Add the types**

In `components/graph/nodes/wall-node-data.ts`, add `WallTouch` to the type import from `@/lib/utils/screen-wall` (keep what part 2 imports there; the line becomes, for example, `import type { WallLens, WallScreen, WallTouch } from "@/lib/utils/screen-wall";`). Directly before `export type WallFrameData = {`, add:

```ts
/** The selected frame (part 4): the frame, the view it shows, and the strip it sits in. */
export interface WallSelection {
  frameId: string;
  viewId: string;
  stripId: string;
}
```

At the end of the file, add:

```ts
/**
 * A touch chip under the selected frame (part 4): an endpoint or data model the
 * view touches, or "+N more" (which opens the view's own panel). Rendered
 * aria-hidden with tabIndex -1: the inspector's Touches list is its accessible twin.
 */
export type WallChipData =
  | { kind: "touch"; frameId: string; touch: WallTouch; onOpen: (nodeId: string) => void }
  | { kind: "more"; frameId: string; viewId: string; count: number; onOpen: (nodeId: string) => void };
```

- [ ] **Step 2: Write the chip**

Create `components/graph/nodes/WallChipNode.tsx`:

```tsx
"use client";

import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";
import { SPECIES_ICONS, STATUS_LABELS, STATUS_STYLES, SYSTEM_LAYER_STYLES } from "./node-styles";
import type { WallChipData } from "./wall-node-data";

const CHIP_CLASS =
  "nodrag nopan flex h-full w-full cursor-pointer items-center gap-2 rounded-md border bg-card px-2 text-left text-xs shadow-sm hover:bg-accent motion-safe:animate-[arkaik-panel-in_180ms_ease-out]";

/**
 * One touch chip under the selected frame on the Screens map
 * (docs/superpowers/specs/2026-11-11-screens-map-design.md § Interaction): an
 * API endpoint or data model the view touches, or "+N more". A click opens that
 * node's panel; "+N more" opens the view's.
 *
 * A canvas node, so it moves with the camera; ScreensCanvas gives it
 * `zIndex: 1000` so the column draws over the next strip. Hidden from assistive
 * technology and out of the tab order: the inspector's Touches list holds the
 * same nodes as buttons. The fan-in plays only without a reduced-motion
 * preference (`motion-safe:`). The hidden handle on its left is where the touch
 * edge from the frame lands.
 */
function WallChipNodeComponent({ data }: NodeProps<Node<WallChipData, "wallChip">>) {
  const target = <Handle type="target" position={Position.Left} id="touch" isConnectable={false} className="opacity-0" />;

  if (data.kind === "more") {
    return (
      <div className="relative h-full w-full">
        {target}
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          className={cn(CHIP_CLASS, "justify-center font-medium text-muted-foreground")}
          onClick={() => data.onOpen(data.viewId)}
        >
          +{data.count} more
        </button>
      </div>
    );
  }

  const { touch } = data;
  const Icon = SPECIES_ICONS[touch.species];
  return (
    <div className="relative h-full w-full">
      {target}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        title={`${touch.title} · ${STATUS_LABELS[touch.status]}`}
        className={CHIP_CLASS}
        onClick={() => data.onOpen(touch.nodeId)}
      >
        <Icon className={cn("size-3.5 shrink-0", SYSTEM_LAYER_STYLES[touch.species].icon)} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{touch.title}</span>
        <span className={cn("size-2 shrink-0 rounded-full", STATUS_STYLES[touch.status].dot)} aria-hidden="true" />
      </button>
    </div>
  );
}

export const WallChipNode = memo(WallChipNodeComponent);
```

The fan-in reuses the `arkaik-panel-in` keyframes already in `app/globals.css` (no `tw-animate-css` here), behind `motion-safe:` so a reduced-motion preference shows the chips without animating.

- [ ] **Step 3: Register it**

In `components/graph/Canvas.tsx`, beside part 2's wall node imports, add:

```ts
import { WallChipNode } from "./nodes/WallChipNode";
```

and in `nodeTypes`, directly after part 2's `wallJump: WallJumpNode,` entry, add:

```ts
  wallChip: WallChipNode,
```

- [ ] **Step 4: Verify and commit**

Run: `npx tsc --noEmit && npx eslint components/graph/nodes/WallChipNode.tsx components/graph/nodes/wall-node-data.ts components/graph/Canvas.tsx`
Expected: no type errors, no lint output.

```bash
git add components/graph/nodes/wall-node-data.ts components/graph/nodes/WallChipNode.tsx components/graph/Canvas.tsx
git commit -m "feat(screens): a touch chip node for the selected frame's endpoints and models"
```

---

### Task 5: Selection and touch reveal on the canvas

**Files:**
- Modify: `components/graph/nodes/wall-node-data.ts`, `components/graph/nodes/WallFrameNode.tsx`, `components/graph/ScreensCanvas.tsx`, `components/maps/ScreensMap.tsx`

Traps: **widened type** — `WallFrameData.selected`/`onMove` and the three required `ScreensCanvasProps` fields force the frame builder and the controller into this same commit; run `npx tsc --noEmit` before committing. **React Compiler lint rules are errors** (`react-hooks/set-state-in-effect`, `react-hooks/refs`): the selection is derived in a `useMemo` (never reset in an effect), refs are read only in effects and event handlers. **Tailwind named groups** — none are introduced. **The surface keeps its box while panels open** — every camera move goes through `WallCamera` (which waits for the size to settle) or, for arrow moves, through `FrameFocusFollower`, which reads the store at the moment it runs.

- [ ] **Step 1: The frame's two new fields, and the frame node**

In `components/graph/nodes/wall-node-data.ts`, add to `WallFrameData`, after part 3's `dimmedRows` field:

```ts
  /** This frame is the selection: the ring and `aria-current`; the touch chips hang off it. */
  selected: boolean;
  /** An arrow key on the focused frame; the controller picks the neighbour and moves focus there. */
  onMove: (frameId: string, dir: "left" | "right" | "up" | "down") => void;
```

In `components/graph/nodes/WallFrameNode.tsx`, five edits:

1. Import `Handle` and `Position` from `@xyflow/react` (merge into part 2's existing import from that package, e.g. `import { Handle, Position, useStore, type Node, type NodeProps } from "@xyflow/react";`).
2. After the imports, add:

```tsx
/** Arrow keys on a focused frame → the neighbour direction (spec § Keys). */
const ARROW_DIRECTIONS: Readonly<Record<string, "left" | "right" | "up" | "down">> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
};
```

3. At the top of the focusable element's keydown handler (part 2 handles Enter and Space there and calls `data.onActivate`), before the Enter/Space branch, add:

```tsx
    const direction = ARROW_DIRECTIONS[event.key];
    if (direction && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      data.onMove(data.frameId, direction);
      return;
    }
```

If part 2 wrote the handler inline in JSX, move it into a `const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => { … }` inside the component first (import `type KeyboardEvent` from `react`), keeping its Enter/Space behaviour.

4. On the focusable element (the one with `role="button"` and `tabIndex={0}`), add these attributes and this class entry (inside part 2's `cn(…)`, after part 3's dimming entries):

```tsx
      aria-current={data.selected ? "true" : undefined}
      data-wall-frame={data.frameId}
```

```tsx
        data.selected && "ring-2 ring-primary ring-offset-4 ring-offset-background",
```

5. As the last child of the outermost element the component returns, add the hidden handle the touch edges start from:

```tsx
      <Handle type="source" position={Position.Bottom} id="touch" isConnectable={false} className="opacity-0" />
```

That outermost element must fill the node box (`h-full w-full`) and be positioned; if it lacks `relative`, add it, so the handle sits at the bottom of the whole frame node (box and caption), where `chipRects` starts the column `CHIP_OFFSET` below.

- [ ] **Step 2: The canvas — props, frame flags, chips, edges, the focus follower**

In `components/graph/ScreensCanvas.tsx`:

Imports — make sure these are present (merge with part 2's lines; `useEffect` and `useRef` are new; `useReactFlow`, `useStoreApi`, `Edge` may be new):

```ts
import { useEffect, useMemo, useRef } from "react";
import { useReactFlow, useStoreApi, type Edge, type Node } from "@xyflow/react";
import { WALL_BAR_INSET, WallCamera, type WallCameraRequest } from "@/components/graph/WallCamera";
import type { WallChipData, WallSelection } from "@/components/graph/nodes/wall-node-data";
import { frameBoxOf, planChips } from "@/lib/utils/screen-inspector";
```

In `ScreensCanvasProps`, after part 3's `gapsOnly`, add the contract's three fields:

```ts
  selection: WallSelection | null;
  onPaneClick: () => void;
  onFrameMove: (frameId: string, dir: "left" | "right" | "up" | "down") => void;
```

and destructure `selection`, `onPaneClick`, `onFrameMove` (and `onOpenNode`, if part 2 did not) in the component's parameters.

In the frame node builder, add to each frame's `WallFrameData` (after `dimmedRows`):

```ts
        selected: selection?.frameId === box.id,
        onMove: onFrameMove,
```

where `box` is the frame's `WallBox` in part 2's loop (use part 2's variable name), and add `onFrameMove` and `selection` to that `useMemo`'s dependency list.

Above `export function ScreensCanvas(`, add:

```tsx
/** The touch chips and edges of the selected frame (part 4). */
interface TouchLayer {
  nodes: Node[];
  edges: Edge[];
}
const NO_TOUCHES: TouchLayer = { nodes: [], edges: [] };

/**
 * Follows an arrow-key move (`focus`): pans to the frame only when it is not
 * wholly inside the canvas above the bar, at the current zoom, then focuses it
 * once React Flow has mounted it (`onlyRenderVisibleElements` mounts nothing
 * off-screen), retrying over up to five animation frames. Rendered inside
 * <ReactFlow> because it needs the instance and the store. The work starts in
 * a timeout and marks the version handled there, as CameraFocus does, so
 * StrictMode's effect replay cannot swallow a move.
 */
function FrameFocusFollower({ target, layout }: { target: CanvasFocus | null; layout: WallLayout }) {
  const reactFlow = useReactFlow();
  const store = useStoreApi();
  const layoutRef = useRef(layout);
  const handled = useRef(0);

  useEffect(() => {
    layoutRef.current = layout;
  }, [layout]);

  useEffect(() => {
    if (!target || target.version === handled.current) return;
    let cancelled = false;
    let frame = 0;
    let settle: ReturnType<typeof setTimeout> | undefined;

    const start = setTimeout(() => {
      handled.current = target.version;
      const box = layoutRef.current.boxes.find((candidate) => candidate.id === target.nodeId);
      if (!box) return;

      const { width, height, transform } = store.getState();
      const [tx, ty, zoom] = transform;
      const left = box.x * zoom + tx;
      const top = box.y * zoom + ty;
      const visible =
        left >= 0 && top >= 0 && left + box.width * zoom <= width && top + box.height * zoom <= height - WALL_BAR_INSET;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const duration = visible || reduce ? 0 : 300;
      if (!visible) {
        void reactFlow.setCenter(box.x + box.width / 2, box.y + box.height / 2, { zoom, duration, interpolate: "linear" });
      }

      let attempts = 0;
      const focusWhenMounted = () => {
        if (cancelled) return;
        const element = document.querySelector<HTMLElement>(`[data-wall-frame="${CSS.escape(target.nodeId)}"]`);
        if (element) {
          element.focus({ preventScroll: true });
          return;
        }
        attempts += 1;
        if (attempts < 5) frame = requestAnimationFrame(focusWhenMounted);
      };
      settle = setTimeout(() => {
        frame = requestAnimationFrame(focusWhenMounted);
      }, duration);
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(start);
      if (settle !== undefined) clearTimeout(settle);
      cancelAnimationFrame(frame);
    };
  }, [reactFlow, store, target]);

  return null;
}
```

Inside the component, after part 2's node builder memo (here called `nodes`; use its real name), add:

```tsx
  const touchLayer = useMemo<TouchLayer>(() => {
    if (!selection) return NO_TOUCHES;
    const frame = frameBoxOf(layout, selection.frameId);
    const screen = wall.screens.get(selection.viewId);
    if (!frame || !screen || screen.touches.length === 0) return NO_TOUCHES;

    const plan = planChips(frame, screen.touches);
    return {
      nodes: plan.chips.map((chip): Node => {
        const data: WallChipData =
          chip.kind === "touch"
            ? { kind: "touch", frameId: frame.id, touch: chip.touch, onOpen: onOpenNode }
            : { kind: "more", frameId: frame.id, viewId: selection.viewId, count: chip.count, onOpen: onOpenNode };
        return {
          id: chip.id,
          type: "wallChip",
          position: { x: chip.rect.x, y: chip.rect.y },
          width: chip.rect.width,
          height: chip.rect.height,
          zIndex: 1000,
          draggable: false,
          connectable: false,
          selectable: false,
          focusable: false,
          domAttributes: { "aria-hidden": true },
          data,
        };
      }),
      edges: plan.edges.map(
        (edge): Edge => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          sourceHandle: "touch",
          targetHandle: "touch",
          type: "default",
          zIndex: 1000,
          focusable: false,
          selectable: false,
          deletable: false,
          domAttributes: { "aria-hidden": true },
          style: { stroke: "hsl(var(--muted-foreground))", strokeWidth: 1.25 },
        }),
      ),
    };
  }, [layout, onOpenNode, selection, wall]);

  const shownNodes = useMemo(
    () => (touchLayer.nodes.length > 0 ? [...nodes, ...touchLayer.nodes] : nodes),
    [nodes, touchLayer],
  );
```

Then change the `<Canvas …>` element: `nodes={shownNodes}`, `edges={touchLayer.edges}` (part 2 passes an empty edge array; replace it), `focus={null}`, add `onPaneClick={onPaneClick}`, and add the follower after `<WallCamera …/>`:

```tsx
        <WallCamera request={camera} />
        <FrameFocusFollower target={focus} layout={layout} />
```

Keep every other prop part 2 and 3 pass. Edges are drawn over the next strip (their `zIndex` 1000, the same as the chips, which are later in the DOM and so on top); `focusable: false` keeps them out of the tab order, which React Flow otherwise gives every edge.

- [ ] **Step 3: The controller — selection, `selectFrame`, activation, pane click, arrows**

In `components/maps/ScreensMap.tsx`:

Imports to add (merge with part 2's):

```ts
import type { WallSelection } from "@/components/graph/nodes/wall-node-data";
import { frameBoxOf, selectionRect } from "@/lib/utils/screen-inspector";
import { neighbourFrame, type Rect } from "@/lib/utils/screen-wall-layout";
```

`useProjectPanels()` must also give `entries` and `addressedNodeId` (used in Tasks 6 and 7); change part 2's destructuring to include them, e.g. `const { openNode, entries, addressedNodeId } = useProjectPanels();`.

If part 2 has no function that bumps the camera request, add this beside its `camera` state (otherwise use part 2's, under its name, wherever this plan says `requestCamera`):

```ts
  const requestCamera = useCallback((rect: Rect, minZoom: number, maxZoom: number) => {
    setCamera((previous) => ({ version: (previous?.version ?? 0) + 1, rect, minZoom, maxZoom }));
  }, []);
```

After the `wall` and `layout` memos and the `camera`/`ring`/`focus` state, before any early return, add (if part 2 holds `wall` or `layout` as nullable while loading, guard the memo and `selectFrame` with `wall && layout &&` / an early `return`):

```tsx
  // --- part 4: selection ---
  // Held as `picked`, read as `selection`: a frame that leaves the layout (a
  // scope or lens change) drops out here, during render, never in an effect.
  const [picked, setPicked] = useState<WallSelection | null>(null);
  const selection = useMemo(
    () => (picked && frameBoxOf(layout, picked.frameId) && wall.screens.has(picked.viewId) ? picked : null),
    [layout, picked, wall],
  );

  // The one way to select (contract: part 5's ⌘K handler calls it too): select
  // the frame, frame it and its chips with the camera, and so show the
  // inspector. It never opens a panel.
  const selectFrame = useCallback(
    (frameId: string, viewId: string, stripId: string) => {
      setPicked({ frameId, viewId, stripId });
      const rect = selectionRect(wall, layout, frameId, viewId);
      if (rect) requestCamera(rect, 0.6, 1);
    },
    [layout, requestCamera, wall],
  );

  const handleOpenPanel = useCallback((nodeId: string) => openNode({ nodeId }), [openNode]);
  const handlePaneClick = useCallback(() => setPicked(null), []);

  // Arrow keys move focus only (spec § Keys); the canvas pans if the frame is off-screen.
  const handleFrameMove = useCallback(
    (frameId: string, dir: "left" | "right" | "up" | "down") => {
      const next = neighbourFrame(layout, frameId, dir);
      if (next) setFocus((previous) => ({ nodeId: next, version: (previous?.version ?? 0) + 1 }));
    },
    [layout],
  );
```

Replace part 2's frame activation handler (the one passed as `onFrameActivate`, which calls `openNode({ nodeId: viewId })` and bumps `focus`) with:

```tsx
  // Part 4 replaces part 2's click grammar: the first activation selects, a
  // second activation of the selected frame (click, Enter or Space) opens the panel.
  const handleFrameActivate = useCallback(
    (frameId: string, viewId: string, stripId: string) => {
      if (selection?.frameId === frameId) {
        openNode({ nodeId: viewId });
        return;
      }
      selectFrame(frameId, viewId, stripId);
    },
    [openNode, selectFrame, selection],
  );
```

Keep part 2's handler name if it differs, and keep passing it as `onFrameActivate`. `setFocus` is now called only by `handleFrameMove`. On `<ScreensCanvas>`, add:

```tsx
          selection={selection}
          onPaneClick={handlePaneClick}
          onFrameMove={handleFrameMove}
```

Chips call `onOpenNode`; part 2 already passes it (the header opens the flow's panel through it), so a chip opens `openNode({ nodeId })` with no further change. If part 2 passes an inline function there, it may be replaced by `handleOpenPanel`.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npm run lint && npm run test:keyboard-shortcuts && npm run test:screen-wall && npm run test:screen-inspector`
Expected: no type errors; no lint errors; all three suites pass.

- [ ] **Step 5: Commit**

```bash
git add components/graph/nodes/wall-node-data.ts components/graph/nodes/WallFrameNode.tsx components/graph/ScreensCanvas.tsx components/maps/ScreensMap.tsx
git commit -m "feat(screens): select a frame to fan out the endpoints and models it touches"
```

---

### Task 6: The quick inspector, Escape and "Also in"

**Files:**
- Create: `components/maps/screens/ScreenInspector.tsx`
- Modify: `components/maps/ScreensMap.tsx`

Traps: **source-reading suites** — the inspector lives in `components/maps/screens/`, outside `panel-semantics`'s `components/panels/` sweep; Escape goes through `useShortcut("close", …)` (a row with hotkeys), never a keydown listener. **The overscroll wheel trap** — the inspector scrolls vertically only (`overflow-y-auto`) and never uses `.overflow-x-auto`. **CI diffs generated artifacts** — `ExternalLinkIcon` and `HistoryIcon` are already in the wobble registry; Task 8 runs `npm run generate` to confirm.

- [ ] **Step 1: Write the inspector**

Create `components/maps/screens/ScreenInspector.tsx`:

```tsx
"use client";

import { ExternalLinkIcon, HistoryIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  PLATFORM_ICONS,
  SPECIES_ICONS,
  STATUS_LABELS,
  STATUS_STYLES,
  SYSTEM_LAYER_STYLES,
} from "@/components/graph/nodes/node-styles";
import type { WallSelection } from "@/components/graph/nodes/wall-node-data";
import { cn } from "@/lib/utils";
import { inspectorRows, stripLinks, type InspectorTone } from "@/lib/utils/screen-inspector";
import type { Wall } from "@/lib/utils/screen-wall";

export interface ScreenInspectorProps {
  wall: Wall;
  selection: WallSelection;
  /** "Open panel" and the Touches list. */
  onOpenPanel: (nodeId: string) => void;
  /** "Also in …". */
  onGoToStrip: (stripId: string) => void;
}

/** The state word's badge: green for a current live shot, amber for a gap, muted otherwise. Colour is never alone: the word says it. */
const TONE_STYLES: Record<InspectorTone, string> = {
  live: "border-green-500/40 text-green-600 dark:text-green-400",
  gap: "border-amber-500/50 text-amber-600 dark:text-amber-400",
  quiet: "border-border text-muted-foreground",
};

const TOUCH_KINDS: Record<"api-endpoint" | "data-model", string> = {
  "api-endpoint": "Endpoint",
  "data-model": "Data model",
};

/**
 * The Screens map's quick inspector (docs/superpowers/specs/2026-11-11-screens-map-design.md
 * § Interaction): for the selected frame's view, one row per platform of the
 * wall (state, shot date, who recorded it, why it may be stale, how it went
 * live where the journal can tell), the strips it appears in, the endpoints and
 * data models it touches (the keyboard twin of the chips), and "Open panel".
 *
 * Not a panel kind: an overlay in the canvas cell, outside React Flow, so the
 * wheel scrolls it instead of zooming the wall. Top-right and 320px wide; in a
 * container narrower than 40rem, a bottom sheet above the bar, at most half the
 * cell tall. It scrolls vertically only (the overscroll trap in globals.css
 * catches `.overflow-x-auto`). Its wording comes from lib/utils/screen-inspector.ts.
 */
export function ScreenInspector({ wall, selection, onOpenPanel, onGoToStrip }: ScreenInspectorProps) {
  const screen = wall.screens.get(selection.viewId);
  if (!screen) return null;
  const rows = inspectorRows(wall, screen);
  const { current, also } = stripLinks(wall, screen, selection.stripId);

  return (
    <section
      aria-label={`${screen.title} on the wall`}
      className={cn(
        "absolute top-3 right-3 z-20 flex max-h-[calc(100%-6rem)] w-80 flex-col gap-3 overflow-y-auto rounded-xl border bg-card p-4 text-sm shadow-lg",
        "@max-[40rem]:top-auto @max-[40rem]:bottom-[72px] @max-[40rem]:left-3 @max-[40rem]:max-h-[50%] @max-[40rem]:w-auto",
      )}
    >
      <header className="flex flex-col gap-1">
        <h2 className="text-base leading-tight font-semibold break-words">{screen.title}</h2>
        {current && <p className="text-xs text-muted-foreground">In {current.title}</p>}
        {also.length > 0 && (
          <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span>Also in</span>
            {also.map((link) => (
              <Button
                key={link.stripId}
                type="button"
                variant="link"
                size="sm"
                className="h-auto cursor-pointer p-0 text-xs"
                onClick={() => onGoToStrip(link.stripId)}
              >
                {link.title}
              </Button>
            ))}
          </p>
        )}
      </header>

      <ul aria-label="Platforms" className="flex flex-col gap-2">
        {rows.map((row) => {
          const PlatformIcon = PLATFORM_ICONS[row.platform];
          return (
            <li key={row.platform} data-platform={row.platform} className="flex flex-col gap-1 rounded-lg border p-2">
              <div className="flex items-center gap-2">
                <PlatformIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="font-medium">{row.platformLabel}</span>
                {row.status && <span className="text-xs text-muted-foreground">{row.status}</span>}
                <span className={cn("ml-auto rounded-md border px-1.5 py-0.5 text-xs font-medium", TONE_STYLES[row.tone])}>
                  {row.word}
                </span>
              </div>
              {row.shot && <p className="text-xs text-muted-foreground">{row.shot}</p>}
              {row.stale && (
                <p className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                  <HistoryIcon className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 break-words">{row.stale}</span>
                </p>
              )}
              {row.proof && <p className="text-xs break-words text-muted-foreground">{row.proof}</p>}
            </li>
          );
        })}
      </ul>

      {screen.touches.length > 0 && (
        <div className="flex flex-col gap-1">
          <h3 className="text-xs font-medium text-muted-foreground">Touches</h3>
          <ul className="flex flex-col gap-0.5">
            {screen.touches.map((touch) => {
              const Icon = SPECIES_ICONS[touch.species];
              return (
                <li key={touch.nodeId}>
                  <button
                    type="button"
                    data-touch={touch.nodeId}
                    className="flex w-full cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => onOpenPanel(touch.nodeId)}
                  >
                    <Icon className={cn("size-3.5 shrink-0", SYSTEM_LAYER_STYLES[touch.species].icon)} aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">{touch.title}</span>
                    <span className="sr-only">
                      , {TOUCH_KINDS[touch.species]}, {STATUS_LABELS[touch.status]}
                    </span>
                    <span className={cn("size-2 shrink-0 rounded-full", STATUS_STYLES[touch.status].dot)} aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="cursor-pointer self-start"
        onClick={() => onOpenPanel(screen.viewId)}
      >
        <ExternalLinkIcon aria-hidden="true" />
        Open panel
      </Button>
    </section>
  );
}
```

The `@max-[40rem]:` classes are container queries: they apply against the nearest `@container` ancestor. Step 3 makes sure that ancestor is the canvas cell's wrapper.

- [ ] **Step 2: Escape, "Also in", focus return**

In `components/maps/ScreensMap.tsx`, add imports (merge with part 2's):

```ts
import { ScreenInspector } from "@/components/maps/screens/ScreenInspector";
import { GUARDED_HOTKEY, useShortcut } from "@/lib/hooks/useShortcut";
import { isEditableElement, OPEN_OVERLAY_SELECTOR } from "@/lib/utils/keyboard";
import { frameInStrip } from "@/lib/utils/screen-inspector";
```

(`frameInStrip` joins Task 5's import from `@/lib/utils/screen-inspector`.) If part 2 has no function that bumps the ring, add beside its `ring` state (otherwise use part 2's under its name):

```ts
  const ringStrip = useCallback((stripId: string) => {
    setRing((previous) => ({ stripId, version: (previous?.version ?? 0) + 1 }));
  }, []);
```

After Task 5's `handleFrameMove`, before any early return, add:

```tsx
  const inspectorRef = useRef<HTMLDivElement | null>(null);

  // "Also in …": the same view, selected in another strip, whose header rings.
  const handleGoToStrip = useCallback(
    (stripId: string) => {
      if (!selection) return;
      const frameId = frameInStrip(wall, stripId, selection.viewId);
      if (!frameId) return;
      selectFrame(frameId, selection.viewId, stripId);
      ringStrip(stripId);
    },
    [ringStrip, selectFrame, selection, wall],
  );

  const clearSelection = useCallback(() => {
    if (!selection) return;
    const focusWasInInspector = inspectorRef.current?.contains(document.activeElement) ?? false;
    setPicked(null);
    if (focusWasInInspector) {
      document
        .querySelector<HTMLElement>(`[data-wall-frame="${CSS.escape(selection.frameId)}"]`)
        ?.focus({ preventScroll: true });
    }
  }, [selection]);

  useShortcut(
    "close",
    (event) => {
      if (event.defaultPrevented || event.repeat) return;
      if (isEditableElement(event.target)) return;
      if (document.querySelector(OPEN_OVERLAY_SELECTOR)) return;
      event.preventDefault();
      clearSelection();
    },
    { ...GUARDED_HOTKEY, enabled: selection !== null && entries.length === 0 },
  );
```

`useRef` joins the `react` import. While any panel is open, `enabled` is false and Escape stays `PanelStack`'s (`PanelStack.tsx:169-183`), which closes the top panel; the next Escape clears the selection. The guards mirror `PanelStack`'s, so Escape in a field, an open menu or the ⌘K dialog is theirs.

- [ ] **Step 3: Render the inspector**

Render the inspector as a sibling of `<ScreensBar>`, inside the element that wraps `<ScreensCanvas>` and `<ScreensBar>`:

```tsx
        {selection && (
          <div ref={inspectorRef} className="contents">
            <ScreenInspector
              wall={wall}
              selection={selection}
              onOpenPanel={handleOpenPanel}
              onGoToStrip={handleGoToStrip}
            />
          </div>
        )}
```

The `contents` wrapper only carries the ref (focus return); it draws no box, so the section positions against the canvas cell. That wrapping element must be an `@container` (part 2's bar already uses the 40rem container rule) and positioned; if it lacks either class, add `@container` and `relative` to it — no other change. If part 2 renders `<ScreensBar>` inside `ScreensCanvas`'s own `@container` wrapper instead, render the inspector in `ScreensMap` beside `<ScreensCanvas>` within an element that has `@container relative h-full w-full`.

- [ ] **Step 4: Verify and commit**

Run: `npx tsc --noEmit && npm run lint && npm run test:keyboard-shortcuts && npm run test:panel-semantics && npm run test:project-panels && npm run test:panel-stack`
Expected: no type errors, no lint errors, all four suites pass.

```bash
git add components/maps/screens/ScreenInspector.tsx components/maps/ScreensMap.tsx
git commit -m "feat(screens): a quick inspector for the selected screen, with Escape and Also in"
```

---

### Task 7: Cold load with `?node=`

**Files:**
- Modify: `components/maps/ScreensMap.tsx`

Trap: **`react-hooks/set-state-in-effect`** — part 2 issues its first camera request when the layout first has boxes; keep that in the same place and the same shape (adjusted during render, guarded by its once-flag, as `useProjectPanels.tsx:205-211` does). It sets state directly rather than calling `selectFrame`, because it runs during render.

- [ ] **Step 1: Replace the first request's target**

Add `coldLoadTarget` to the import from `@/lib/utils/screen-inspector`. Find part 2's first camera request (contract: first render with a non-empty layout → the first strip's rect, `minZoom` 0.4, `maxZoom` 1). Keep its once-flag and its condition; replace its body (everything after the flag is set) with:

```tsx
    const target = coldLoadTarget(wall, layout, addressedNodeId);
    const firstStrip = wall.strips[0];
    const rect = target?.rect ?? (firstStrip ? layout.strips.get(firstStrip.id) : undefined);
    if (target?.kind === "frame") setPicked(target.selection);
    if (rect) {
      const minZoom = target?.kind === "frame" ? 0.6 : 0.4;
      setCamera((previous) => ({ version: (previous?.version ?? 0) + 1, rect, minZoom, maxZoom: 1 }));
    }
```

For reference, the rehearsed shape of the whole block (part 2's flag name may differ):

```tsx
  const [framedOnce, setFramedOnce] = useState(false);
  if (!framedOnce && layout.boxes.length > 0) {
    setFramedOnce(true);
    const target = coldLoadTarget(wall, layout, addressedNodeId);
    const firstStrip = wall.strips[0];
    const rect = target?.rect ?? (firstStrip ? layout.strips.get(firstStrip.id) : undefined);
    if (target?.kind === "frame") setPicked(target.selection);
    if (rect) {
      const minZoom = target?.kind === "frame" ? 0.6 : 0.4;
      setCamera((previous) => ({ version: (previous?.version ?? 0) + 1, rect, minZoom, maxZoom: 1 }));
    }
  }
```

The block must come after `picked`'s `useState` (Task 5). `addressedNodeId` is the node `?node=` names: on a cold load `ProjectPanelsProvider` has already reconciled it during render (`useProjectPanels.tsx:197-228`), so the panel is open and the view is selected and framed together; with a panel open, Escape closes the panel first.

If part 2 issues the first request somewhere other than render (a layout callback, say), put this body there instead and replace `setPicked`/`setCamera` with `selectFrame(target.selection.frameId, target.selection.viewId, target.selection.stripId)` for a frame target and `requestCamera(rect, 0.4, 1)` otherwise.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: no type errors, no lint errors.

- [ ] **Step 3: Commit**

```bash
git add components/maps/ScreensMap.tsx
git commit -m "feat(screens): a cold load with ?node= frames its screen or strip"
```

---

### Task 8: Checks without a browser

- [ ] **Step 1: Every suite this part touches or could break**

Run:

```bash
npm run test:screen-inspector && npm run test:keyboard-shortcuts && npm run test:screen-wall && npm run test:project-panels && npm run test:panel-stack && npm run test:panel-semantics && npm run test:product-scope && npm run test:platform-variants-gates
```

Expected: each suite ends with its pass line (`All screen inspector tests passed`, `All keyboard shortcut tests passed`, …), exit 0.

- [ ] **Step 2: Lint, types, generated artifacts**

Run: `npm run lint && npx tsc --noEmit && actionlint .github/workflows/ci.yml && npm run generate && git status --porcelain`
Expected: no lint errors, no type errors, no actionlint output; `git status --porcelain` prints nothing (every change committed; the generator rewrote nothing — in particular `lib/wobble/wobble-registry.generated.ts` and `app/wobble.generated.css` are unchanged). If the generator changed a file, a lucide name new to the registry was imported: commit the regenerated files with message `chore(generate): wobble registry for the Screens inspector`.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: build succeeds (CI typechecks through it).

---

### Task 9: Manual headless-browser verification

Not a CI test (Playwright is not a dependency). Work in a scratch directory outside the repo: `export SCRATCH=<an absolute path outside the worktree>` (your session's scratchpad, for example) and `export WORKTREE=<this worktree's absolute path>`; nothing in `$SCRATCH` is committed. Trap: **a stale dev server fakes hydration mismatches** — restart the server after every branch switch and before believing a console error.

The bundle: neither seed has a screenshot or a deploy event, so `prepare-bundle.js` derives one from `seed/pebbles.json` (All products, platforms web · iOS · Android):

- `V-quick-pebble-editor` (live everywhere, not covered by an acceptance, 14 touches, so 8 chips and "+6 more"): web has a CI shot from 2026-10-10, current; iOS has a manual shot from 2026-10-01 made stale by a person's move to Live on iOS on 2026-10-05; Android has no shot.
- `V-pebble-detail` (covered by `AC-pebble-draw-in-animation` and `AC-emotion-palette-on-read`): iOS has a CI shot from 2026-10-20, current, and reads "Live from a deploy" because both acceptances last moved to Live on iOS by `arkaik-ci` with detail "TestFlight build 412"; web has a legacy shot (no provenance) on a not-live platform.

Rehearsed: the prepared bundle passes the schema's `parseBundle` and `validateBundle` with no errors (what `/projects`' import runs), is 190,989 bytes (under the 5 MB import limit), and the app's own `getEffectivePlatformStatuses` gives `V-quick-pebble-editor` web/iOS/Android `live` and `V-pebble-detail` iOS `live`, web `backlog`, Android `development`.

- [ ] **Step 1: Prepare the scratch directory**

```bash
mkdir -p "$SCRATCH" && cd "$SCRATCH"
npm init -y >/dev/null
npm i playwright
npx playwright install chromium
```

Create `$SCRATCH/prepare-bundle.js`:

```js
#!/usr/bin/env node
/**
 * Screens map part 4, manual check: a Pebbles bundle with shots, a stale shot,
 * and a deploy-proven live view. Neither seed has a screenshot or a deploy event.
 *
 *   node prepare-bundle.js <worktree> <out.json>
 *
 * Reads <worktree>/seed/pebbles.json; writes <out.json>. Touches nothing else.
 *
 * What it sets up (Pebbles, All products, wall platforms web · iOS · Android):
 * - V-quick-pebble-editor (live everywhere, uncovered, 14 touches → 8 chips + "+6 more"):
 *   web: CI shot 2026-10-10, current, "Live, set by hand" (its 2026-04-28 move);
 *   iOS: manual shot 2026-10-01, stale because a person moved it to Live on iOS on 2026-10-05;
 *   Android: no shot (a gap).
 * - V-pebble-detail (covered by AC-pebble-draw-in-animation and AC-emotion-palette-on-read):
 *   iOS: CI shot 2026-10-20, current, "Live from a deploy · … · TestFlight build 412",
 *   because both acceptances last moved to Live on iOS by arkaik-ci with that detail;
 *   web: a legacy shot (no provenance) on a not-live platform.
 */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const [worktree, outFile] = process.argv.slice(2);
if (!worktree || !outFile) {
  console.error("usage: node prepare-bundle.js <worktree> <out.json>");
  process.exit(2);
}

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
/** A solid-colour RGB PNG as a data URI: its own proportions, so the frame takes them. */
function pngDataUri(width, height, [r, g, b]) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) row.set([r, g, b], 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString("base64")}`;
}

const WEB_SHOT = pngDataUri(160, 100, [59, 130, 246]);
const IOS_SHOT = pngDataUri(39, 84, [34, 197, 94]);
const PROJECT_ID = "screens-p4-check";

const bundle = JSON.parse(fs.readFileSync(path.join(worktree, "seed", "pebbles.json"), "utf8"));
bundle.project = { ...bundle.project, id: PROJECT_ID, title: "Screens part 4 check" };
for (const node of bundle.nodes) node.project_id = PROJECT_ID;
for (const edge of bundle.edges) edge.project_id = PROJECT_ID;

function node(id) {
  const found = bundle.nodes.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`${id} is not in seed/pebbles.json`);
  found.metadata = found.metadata ?? {};
  return found;
}

const editor = node("V-quick-pebble-editor");
editor.metadata.platformScreenshots = { web: WEB_SHOT, ios: IOS_SHOT };
editor.metadata.platformScreenshotMeta = {
  web: { ts: "2026-10-10T09:00:00.000Z", source: "ci", form: "data", commit: "a1b2c3d", order: 7, ci_order: 7 },
  ios: { ts: "2026-10-01T09:00:00.000Z", source: "manual", form: "data" },
};

const detail = node("V-pebble-detail");
detail.metadata.platformScreenshots = { web: WEB_SHOT, ios: IOS_SHOT };
detail.metadata.platformScreenshotMeta = {
  ios: { ts: "2026-10-20T09:00:00.000Z", source: "ci", form: "data", commit: "d4e5f6a", order: 9, ci_order: 9 },
};

bundle.journal = [
  ...(bundle.journal ?? []),
  {
    id: "01KSP4CHECK000000000000001",
    ts: "2026-10-05T10:00:00.000Z",
    actor: "alexis",
    type: "node.status_changed",
    node_id: "V-quick-pebble-editor",
    platform: "ios",
    from: "releasing",
    to: "live",
  },
  {
    id: "01KSP4CHECK000000000000002",
    ts: "2026-10-15T09:00:00.000Z",
    actor: "arkaik-ci",
    type: "node.status_changed",
    node_id: "AC-pebble-draw-in-animation",
    platform: "ios",
    from: "releasing",
    to: "live",
    detail: "TestFlight build 412",
  },
  {
    id: "01KSP4CHECK000000000000003",
    ts: "2026-10-15T09:00:01.000Z",
    actor: "arkaik-ci",
    type: "node.status_changed",
    node_id: "AC-emotion-palette-on-read",
    platform: "ios",
    from: "releasing",
    to: "live",
    detail: "TestFlight build 412",
  },
];

fs.writeFileSync(outFile, `${JSON.stringify(bundle, null, 2)}\n`);
console.log(`wrote ${outFile} (${fs.statSync(outFile).size} bytes, project ${PROJECT_ID})`);
```

Create `$SCRATCH/check-part4.js`:

```js
#!/usr/bin/env node
/**
 * Screens map part 4, manual headless check: selection, quick inspector, touch
 * chips and edges, Escape, keyboard reach, arrows, reduced motion, 390px sheet.
 *
 *   node check-part4.js <baseUrl> <bundle.json> <outDir>
 *
 * Run from a scratch directory where `npm i playwright` and
 * `npx playwright install chromium` were run, against this worktree's
 * `PORT=4371 npm run dev` (any free port). Prints one `ok N - …` line per check and stops at
 * the first `not ok`. Screenshots go to <outDir>.
 */

const path = require("path");
const { chromium } = require("playwright");

const [baseUrl = "http://localhost:4343", bundlePath, outDir = process.cwd()] = process.argv.slice(2);
if (!bundlePath) {
  console.error("usage: node check-part4.js <baseUrl> <bundle.json> <outDir>");
  process.exit(2);
}

let count = 0;
function ok(condition, message) {
  count += 1;
  if (!condition) throw new Error(`not ok ${count} - ${message}`);
  console.log(`ok ${count} - ${message}`);
}

const EDITOR = "V-quick-pebble-editor";
const DETAIL = "V-pebble-detail";

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: "light",
    reducedMotion: "no-preference",
  });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  try {
    await run(page, consoleErrors);
  } catch (error) {
    await finish(browser, page, consoleErrors, error);
    return;
  }
  await finish(browser, page, consoleErrors, null);
}

async function run(page, consoleErrors) {
  const shot = (name) => page.screenshot({ path: path.join(outDir, name) });
  const nodeParam = () => new URL(page.url()).searchParams.get("node");
  const waitForNode = (id) =>
    page.waitForFunction((expected) => new URL(location.href).searchParams.get("node") === expected, id, { timeout: 15000 });
  const waitForNoNode = () =>
    page.waitForFunction(() => !new URL(location.href).searchParams.has("node"), null, { timeout: 15000 });
  const settle = () => page.waitForTimeout(800);
  const activeFrame = () => page.evaluate(() => document.activeElement?.getAttribute("data-wall-frame") ?? null);
  const flat = (text) => text.replace(/\s+/g, " ").trim();

  // --- import the prepared bundle ---
  await page.goto(`${baseUrl}/projects`, { timeout: 120000 });
  await page.setInputFiles('input[type="file"][accept*="json"]', bundlePath);
  await page.waitForURL(/\/project\/[^/?]+/, { timeout: 120000 });
  const projectId = new URL(page.url()).pathname.split("/")[2];
  ok(Boolean(projectId), `imported the bundle as project ${projectId}`);

  // --- cold load with ?node= on a view: selected, framed, panel open ---
  await page.goto(`${baseUrl}/project/${projectId}/maps/screens?node=${EDITOR}`, { timeout: 120000 });
  const editorInspector = page.locator('section[aria-label="Quick Pebble Editor on the wall"]');
  // T13: with the ?node= panel open the inspector is not rendered; the selection, its ring and its chips are.
  await page.locator(`[data-wall-frame^="${EDITOR}@"][aria-current="true"]`).waitFor({ timeout: 120000 });
  ok(true, "a cold load with ?node= selects the view");
  ok(
    nodeParam() === EDITOR && (await page.locator('section[aria-labelledby$="-heading"]').count()) >= 1,
    "…and its node panel is open",
  );
  const frameId = await page.locator(`[data-wall-frame^="${EDITOR}@"]`).first().getAttribute("data-wall-frame");
  const frame = page.locator(`[data-wall-frame="${frameId}"]`);
  ok((await frame.getAttribute("aria-current")) === "true", `the selected frame ${frameId} carries aria-current`);
  await settle();
  ok((await page.locator('section[aria-label$=" on the wall"]').count()) === 0, "T13: …with the panel open, no inspector is rendered");
  ok((await page.locator(`[data-testid^="rf__node-chip:${frameId}:"]`).count()) === 9, "T13: …while the selection's chips stay");
  const coldPane = await page.locator(".react-flow").first().boundingBox();
  const coldFrame = await frame.boundingBox();
  ok(
    coldFrame.x >= coldPane.x - 1 && coldFrame.x + coldFrame.width <= coldPane.x + coldPane.width + 1 &&
      coldFrame.y >= coldPane.y - 1 && coldFrame.y + coldFrame.height <= coldPane.y + coldPane.height + 1,
    `T13: …and the frame is wholly in the canvas the panel leaves (${JSON.stringify({ coldFrame, coldPane })})`,
  );
  await shot("01-cold-load-1440-light.png");

  // --- Escape with a panel open closes the panel only ---
  await page.keyboard.press("Escape");
  await waitForNoNode();
  await settle();
  ok(await editorInspector.isVisible(), "Escape with a panel open closes the panel and keeps the selection");

  // --- inspector content ---
  const surface = page.locator('section[aria-label="Screens"]').first();
  const card = await editorInspector.boundingBox();
  const cell = await surface.boundingBox();
  ok(
    Math.abs(card.width - 320) <= 1 && Math.abs(card.x + card.width - (cell.x + cell.width - 12)) <= 4 && Math.abs(card.y - (cell.y + 12)) <= 4,
    "the inspector is a 320px card in the canvas cell's top-right corner",
  );
  const rows = editorInspector.locator("li[data-platform]");
  ok(
    JSON.stringify(await rows.evaluateAll((items) => items.map((item) => item.getAttribute("data-platform")))) ===
      JSON.stringify(["web", "ios", "android"]),
    "one inspector row per wall platform: web, ios, android",
  );
  const rowText = async (inspector, platform) => flat(await inspector.locator(`li[data-platform="${platform}"]`).innerText());
  const editorWeb = await rowText(editorInspector, "web");
  ok(/Live/.test(editorWeb) && /From CI/.test(editorWeb) && /Live, set by hand/.test(editorWeb), `web row: live, CI shot, set by hand (${editorWeb})`);
  const editorIos = await rowText(editorInspector, "ios");
  ok(
    /Stale/.test(editorIos) && /Recorded by hand/.test(editorIos) && /V-quick-pebble-editor moved to Live on iOS/.test(editorIos),
    `iOS row: stale, recorded by hand, and why (${editorIos})`,
  );
  const editorAndroid = await rowText(editorInspector, "android");
  ok(/No shot/.test(editorAndroid), `Android row: no shot (${editorAndroid})`);
  const touchIds = await editorInspector.locator("button[data-touch]").evaluateAll((buttons) => buttons.map((b) => b.getAttribute("data-touch")));
  ok(touchIds.length === 14, "the Touches list holds all 14 endpoints and models");
  ok((await editorInspector.getByRole("button", { name: "Open panel" }).count()) === 1, "the inspector has an Open panel button");

  // --- chips and touch edges ---
  const chipPrefix = `rf__node-chip:${frameId}:`;
  const chips = page.locator(`[data-testid^="${chipPrefix}"]`);
  ok((await chips.count()) === 9, "8 touch chips and one more chip fan out under the frame");
  ok((await page.locator(`[data-testid="${chipPrefix}more"]`).innerText()).includes("+6 more"), "the last chip reads +6 more");
  const chipKeys = await chips.evaluateAll(
    (nodes, prefix) => nodes.map((node) => node.getAttribute("data-testid").slice(prefix.length)),
    chipPrefix,
  );
  ok(JSON.stringify(chipKeys.slice(0, 8)) === JSON.stringify(touchIds.slice(0, 8)), "the chips list the inspector's first 8 touches, in order");
  // T12: a tidy tree — one trunk from the frame's bottom edge 16px in from its left
  // corner, straight down, and a short stub right into each chip (12px at zoom 1).
  const geometry = await page.evaluate(
    ({ frame: id, keys }) => {
      const frameRect = document.querySelector(`[data-testid="rf__node-${id}"]`).getBoundingClientRect();
      const zoom = Number(/scale\(([\d.]+)\)/.exec(document.querySelector(".react-flow__viewport").style.transform)[1]);
      const trunkX = frameRect.left + 16 * zoom;
      return {
        zoom,
        edges: keys.map((key) => {
          const edge = document.querySelector(`[data-testid="rf__edge-touch:${id}:${key}"] path.react-flow__edge-path`);
          const chip = document.querySelector(`[data-testid="rf__node-chip:${id}:${key}"]`).getBoundingClientRect();
          if (!edge) return { key, missing: true };
          const ctm = edge.getScreenCTM();
          const total = edge.getTotalLength();
          const at = (length) => {
            const point = edge.getPointAtLength(length);
            return new DOMPoint(point.x, point.y).matrixTransform(ctm);
          };
          const start = at(0);
          const end = at(total);
          const chipMid = chip.top + chip.height / 2;
          // Every point lies on the trunk or on the chip's stub, give or take the 6px corner.
          let offTree = 0;
          for (let i = 0; i <= 40; i += 1) {
            const p = at((total * i) / 40);
            const off = Math.min(Math.abs(p.x - trunkX), Math.abs(p.y - chipMid));
            if (off > 6 * zoom + 1 || p.x < trunkX - 1 || p.x > chip.left + 1) offTree += 1;
          }
          return {
            key,
            fromTrunk: Math.hypot(start.x - trunkX, start.y - frameRect.bottom),
            toChip: Math.hypot(end.x - chip.left, end.y - chipMid),
            stub: (chip.left - trunkX) / zoom,
            offTree,
            stroke: getComputedStyle(edge).stroke,
          };
        }),
      };
    },
    { frame: frameId, keys: chipKeys },
  );
  const edges = geometry.edges;
  ok(
    edges.every((edge) => !edge.missing && edge.fromTrunk <= 4 && edge.toChip <= 4),
    `every chip has a touch edge from the trunk on the frame's bottom edge, 16px in, to the chip's left (${JSON.stringify(edges.filter((e) => e.missing || e.fromTrunk > 4 || e.toChip > 4))})`,
  );
  ok(
    edges.every((edge) => edge.offTree === 0),
    `T12: every edge runs down the shared trunk and turns right into its chip (${JSON.stringify(edges.filter((e) => e.offTree > 0))})`,
  );
  ok(
    edges.every((edge) => Math.abs(edge.stub - 12) <= 0.5),
    `T12: the trunk sits 12px clear of the chip column (${JSON.stringify(edges.map((e) => Math.round(e.stub * 10) / 10))})`,
  );
  ok(new Set(edges.map((edge) => edge.stroke)).size === 1, `T12: one stroke colour for every edge (${edges[0].stroke})`);
  ok(
    await chips.evaluateAll((nodes) =>
      nodes.every((node) => {
        const button = node.querySelector("button");
        return button !== null && button.tabIndex === -1 && button.closest('[aria-hidden="true"]') !== null;
      }),
    ),
    "chips are aria-hidden and out of the tab order",
  );
  ok(
    (await chips.first().locator("button").evaluate((button) => getComputedStyle(button).animationName)) === "arkaik-panel-in",
    "chips fan in when motion is allowed",
  );

  // --- a second Escape clears the selection ---
  await page.keyboard.press("Escape");
  await editorInspector.waitFor({ state: "detached", timeout: 5000 });
  ok((await chips.count()) === 0, "a second Escape clears the selection and its chips");

  // --- pointer: select, then open ---
  await frame.click();
  await editorInspector.waitFor({ timeout: 5000 });
  ok(nodeParam() === null, "a click selects the frame without opening a panel");
  await settle();
  await frame.click();
  await waitForNode(EDITOR);
  ok(true, "a second click on the selected frame opens its panel");
  await settle();
  ok(
    (await editorInspector.count()) === 0 &&
      (await frame.getAttribute("aria-current")) === "true" &&
      (await page.locator(`[data-testid^="rf__node-chip:${frameId}:"]`).count()) === 9,
    "T13: while the panel is open the inspector is gone, the ring and the chips stay",
  );
  await page.keyboard.press("Escape");
  await waitForNoNode();
  await editorInspector.waitFor({ timeout: 5000 });
  ok(true, "T13: closing the panel brings the inspector back for the selected frame");

  await editorInspector.getByRole("button", { name: "Open panel" }).click();
  await waitForNode(EDITOR);
  ok(true, "Open panel opens the view's panel");
  await page.keyboard.press("Escape");
  await waitForNoNode();
  await settle();

  await page.locator(`[data-testid="${chipPrefix}${chipKeys[0]}"] button`).click();
  await waitForNode(chipKeys[0]);
  ok(true, `a chip opens its node's panel (${chipKeys[0]})`);
  await page.keyboard.press("Escape");
  await waitForNoNode();

  await page.locator(`[data-testid="${chipPrefix}more"] button`).click();
  await waitForNode(EDITOR);
  ok(true, "the +6 more chip opens the view's panel");
  await page.keyboard.press("Escape");
  await waitForNoNode();
  await shot("02-selected-1440-light.png");

  // --- keyboard: from the frame, Tab reaches the Touches list, never a chip ---
  await frame.focus();
  let reached = null;
  let chipFocused = false;
  for (let press = 0; press < 150 && !reached; press++) {
    await page.keyboard.press("Tab");
    const state = await page.evaluate(() => ({
      touch: document.activeElement?.getAttribute("data-touch") ?? null,
      chip: Boolean(document.activeElement?.closest('[data-testid^="rf__node-chip:"]')),
    }));
    if (state.chip) chipFocused = true;
    reached = state.touch;
  }
  ok(Boolean(reached) && !chipFocused, `Tab from the frame reaches the inspector's Touches (${reached}) and never a chip`);
  await page.keyboard.press("Enter");
  await waitForNode(reached);
  ok(true, "Enter on a Touches entry opens that node's panel");
  await page.keyboard.press("Escape");
  await waitForNoNode();
  await page.keyboard.press("Escape");
  await editorInspector.waitFor({ state: "detached", timeout: 5000 });
  ok((await activeFrame()) === frameId, "Escape from the inspector clears the selection and puts focus back on the frame");

  // --- arrows move focus; Enter selects; Enter again opens ---
  await page.keyboard.press("ArrowRight");
  await settle();
  const right = await activeFrame();
  ok(Boolean(right) && right.startsWith(`${DETAIL}@`), `→ moves focus to the next screen (${right})`);
  ok(nodeParam() === null && (await page.locator('section[aria-label$=" on the wall"]').count()) === 0, "…without selecting it or opening anything");
  await page.keyboard.press("Enter");
  const detailInspector = page.locator('section[aria-label="Pebble Detail on the wall"]');
  await detailInspector.waitFor({ timeout: 5000 });
  ok(true, "Enter selects the focused frame");
  const detailIos = await rowText(detailInspector, "ios");
  ok(
    /Live from a deploy/.test(detailIos) && /TestFlight build 412/.test(detailIos) && /From CI/.test(detailIos),
    `a deploy-proven view reads Live from a deploy, with its evidence (${detailIos})`,
  );
  const detailWeb = await rowText(detailInspector, "web");
  ok(/Legacy shot/.test(detailWeb) && /Backlog/.test(detailWeb), `a legacy shot on a not-live platform reads so (${detailWeb})`);
  await settle();
  await shot("03-deploy-proof-1440-light.png");
  await page.keyboard.press("Enter");
  await waitForNode(DETAIL);
  ok(true, "Enter on the selected frame opens its panel");
  await page.keyboard.press("Escape");
  await waitForNoNode();
  await page.keyboard.press("ArrowLeft");
  await settle();
  ok((await activeFrame()) === frameId, "← moves focus back");

  // --- reduced motion: the chips appear without animating ---
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.keyboard.press("Enter");
  await editorInspector.waitFor({ timeout: 5000 });
  ok(
    (await page.locator(`[data-testid^="${chipPrefix}"] button`).first().evaluate((button) => getComputedStyle(button).animationName)) === "none",
    "under reduced motion the chips do not animate",
  );
  await page.emulateMedia({ reducedMotion: "no-preference", colorScheme: "dark" });
  await settle();
  await shot("04-selected-1440-dark.png");

  // --- T11: gaps only never fades the selected frame, even with focus in the inspector ---
  await page.emulateMedia({ colorScheme: "light" });
  const gapsSwitch = page.getByRole("button", { name: /^Gaps only/ });
  await gapsSwitch.click();
  await settle();
  await editorInspector.locator("button[data-touch]").first().focus();
  await settle();
  const dim = await page.evaluate((id) => {
    const wrap = document.querySelector(`[data-wall-frame="${id}"]`).parentElement;
    return {
      selectedDimmed: wrap.getAttribute("data-dimmed"),
      opacity: getComputedStyle(wrap).opacity,
      filter: getComputedStyle(wrap).filter,
      othersDimmed: document.querySelectorAll('[data-dimmed="true"] [data-wall-frame]').length,
      focusInInspector: Boolean(document.activeElement?.closest('section[aria-label$=" on the wall"]')),
    };
  }, frameId);
  ok(
    dim.focusInInspector && dim.othersDimmed > 0 && dim.selectedDimmed === "false" && dim.opacity === "1" && dim.filter === "none",
    `T11: under gaps only the selected (non-gap) frame stays lit while focus is in the inspector (${JSON.stringify(dim)})`,
  );
  await shot("08-gaps-selected-inspector-focus-1440-light.png");
  await gapsSwitch.click();
  await page.emulateMedia({ colorScheme: "dark" });
  await settle();

  // --- 390px: a bottom sheet above the bar ---
  await page.setViewportSize({ width: 390, height: 844 });
  await settle();
  // T14: select again at this width — the camera keeps the frame above the sheet, not beside a card.
  await page.keyboard.press("Escape");
  await editorInspector.waitFor({ state: "detached", timeout: 5000 });
  await frame.focus();
  await page.keyboard.press("Enter");
  await editorInspector.waitFor({ timeout: 5000 });
  await settle();
  const narrowFrame = await frame.boundingBox();
  const narrowSheet = await editorInspector.boundingBox();
  const narrowPane = await page.locator(".react-flow").first().boundingBox();
  ok(
    narrowFrame.x >= narrowPane.x - 1 && narrowFrame.x + narrowFrame.width <= narrowPane.x + narrowPane.width + 1 &&
      narrowFrame.y >= narrowPane.y - 1 && narrowFrame.y + narrowFrame.height <= narrowSheet.y + 1,
    `T14: at 390px a selection frames the frame wholly above the sheet (${JSON.stringify({ narrowFrame, narrowSheet, narrowPane })})`,
  );
  const sheet = await editorInspector.boundingBox();
  const bar = await page.getByRole("toolbar", { name: "Screens display" }).boundingBox();
  const narrowCell = await surface.boundingBox();
  ok(
    Boolean(sheet && bar && narrowCell) &&
      sheet.y + sheet.height <= bar.y + 1 &&
      sheet.height <= narrowCell.height * 0.5 + 2 &&
      sheet.width >= narrowCell.width - 26,
    `at 390px the inspector is a full-width bottom sheet above the bar, at most half the cell (${JSON.stringify({ sheet, bar, narrowCell })})`,
  );
  ok(await editorInspector.evaluate((element) => element.scrollWidth <= element.clientWidth), "the sheet never scrolls sideways");
  await shot("05-sheet-390-dark.png");
  await page.emulateMedia({ colorScheme: "light" });
  await settle();
  await shot("06-sheet-390-light.png");
  await editorInspector.getByRole("button", { name: "Open panel" }).click();
  await waitForNode(EDITOR);
  ok(true, "at 390px Open panel still opens the panel");
  await settle();
  ok((await editorInspector.count()) === 0, "T13: at 390px, with the panel open, no inspector sheet is rendered");
  await shot("07-panel-390-light.png");
  await page.keyboard.press("Escape");
  await waitForNoNode();
  await settle();
  ok(await editorInspector.isVisible(), "closing that panel at 390px returns to the wall with the selection kept");

  ok(consoleErrors.length === 0, `no console errors${consoleErrors.length ? `: ${consoleErrors.join(" | ")}` : ""}`);
}

async function finish(browser, page, consoleErrors, error) {
  if (error) {
    await page.screenshot({ path: path.join(outDir, "99-failure.png") }).catch(() => {});
    console.error(error.message);
    if (consoleErrors.length) console.error(`console errors:\n  ${consoleErrors.join("\n  ")}`);
    await browser.close();
    process.exit(1);
  }
  await browser.close();
  console.log(`PASS screens-part-4: ${count} checks, 0 console errors`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 2: Prepare the bundle**

Run (from `$SCRATCH`, with `$WORKTREE` the absolute path of this worktree): `node prepare-bundle.js "$WORKTREE" "$SCRATCH/screens-p4-bundle.json"`
Expected: `wrote …/screens-p4-bundle.json (190989 bytes, project screens-p4-check)`.

- [ ] **Step 3: Start this worktree's dev server on its own port**

Run, in the worktree, in a separate terminal (4242 may belong to the other checkout): `PORT=4343 npm run dev`
Expected: Next reports `Local: http://localhost:4343`. Leave it running.

- [ ] **Step 4: Run the check**

Run, from `$SCRATCH`: `node check-part4.js http://localhost:4343 "$SCRATCH/screens-p4-bundle.json" "$SCRATCH"`
Expected on success: 40 lines `ok 1 - …` to `ok 40 - …`, the last being `ok 40 - no console errors`, then exactly:

```
PASS screens-part-4: 51 checks, 0 console errors
```

(51 since the review fixes — T11 gaps only, T12 the touch tree, T13 no inspector while a panel is open, T14 the narrow camera; the script above is the version last run, on `feat/screens-inspect`.)

and exit 0. On failure it prints `not ok N - <check>` with what it saw, any console errors, saves `99-failure.png`, and exits 1.

It covers, in order: import; cold load `?node=` (selected, framed, panel open, `aria-current`); Escape closing the panel first and keeping the selection; the card's place and width; inspector rows (states, shot provenance, the stale reason `V-quick-pebble-editor moved to Live on iOS`, by-hand proof, no shot); the Touches list and Open panel; 9 chips (8 + "+6 more") in the Touches order, each joined by a touch edge from the frame's bottom to its left; chips aria-hidden and untabbable; fan-in with motion allowed; the second Escape; click to select, second click to open; Open panel; a chip and "+6 more" opening their panels; Tab from the frame reaching the Touches list without stopping on a chip, Enter opening a touch; Escape returning focus to the frame; → moving focus only, Enter selecting, the deploy proof with its evidence and the legacy shot, Enter again opening, ← moving back; no chip animation under reduced motion; at 390px a full-width bottom sheet above the bar, at most half the cell, never scrolling sideways; Open panel at 390px and back; no console errors.

- [ ] **Step 5: Look at the screenshots, then stop the server**

Open in `$SCRATCH`: `01-cold-load-1440-light.png` (panel open beside the wall, selected frame ringed, chips under it, card top-right), `02-selected-1440-light.png`, `03-deploy-proof-1440-light.png`, `04-selected-1440-dark.png`, `05-sheet-390-dark.png`, `06-sheet-390-light.png`, `07-panel-390-light.png`. Check by eye: the card never covers the selected frame at 1440; the chips draw over the next strip on a card background and their edges are visible in both themes; the stale word is amber and the live word green, each with its word; no text overflows the card. Stop the dev server.

---

## Part done when

- These pass on `feat/screens-inspect` alone:

```bash
npm run test:screen-inspector
npm run test:keyboard-shortcuts
npm run test:screen-wall
npm run test:project-panels
npm run test:panel-stack
npm run test:panel-semantics
npm run lint
npx tsc --noEmit
actionlint .github/workflows/ci.yml
npm run generate && git status --porcelain   # prints nothing
npm run build
```

- Task 9's script prints `PASS screens-part-4: 51 checks, 0 console errors`, and the screenshots were looked at.
- The PR is opened with the `gh-stack` skill on top of part 3. Title:

```
feat(screens): click a screen for its quick inspector and touches (part 4/5)
```

Body: what changed, the three contract deviations above, the Task 9 result line, and this Lab Note:

````markdown
## Lab Note

```yaml
en:
  title: "Click a screen to see where it stands"
  summary: "Select a frame for a quick card: each platform's state, when the shot was taken and by whom, why it may be stale, and whether a deploy put it live. The endpoints and data it uses fan out beside it."
fr:
  title: "Clique sur un écran pour voir où il en est"
  summary: "Sélectionne un cadre : une petite fiche te montre l'état sur chaque plateforme, la date et l'auteur de la capture, pourquoi elle est peut-être périmée et si c'est un déploiement qui l'a mise en ligne. Les endpoints et modèles qu'il utilise s'affichent à côté."
nodes: [F-browse-maps, V-node-detail-panel]
suggested:
  molecule: arkaik
  type: improvement
  tags: [maps, screenshots]
```
````

End the body with the attribution line the session gives. After opening the PR, read its comments for the Lab Note reminder's verdict; fix the body, not the code.
