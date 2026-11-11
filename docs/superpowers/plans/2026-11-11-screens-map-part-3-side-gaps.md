# Screens map — Part 3: side by side and gaps only — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the "Side by side" lens (every platform of the scope stacked inside each frame, a mini shot and a one-word state per row) and the "Gaps only" switch (everything but stale shots and live screens with no shot fades; the switch shows the count), both remembered per viewer, with I/W/A driving the lens and the strip headers' counts following it.

**Architecture:** No new module. Part 1's pure helpers already answer every question this part asks (`lensPlatforms`, `cellWord`, `isGapCell`, `isGapFrame`, `gapCount`, `stripCountsLine`, `clampAspect`, the layout constants; `layoutWall` already sizes side frames through `sideGeometry`). This part widens the stored lens to `"side"` and adds `screensGapsOnly` in `useDisplayPreferences`; renders the side box in `WallFrameNode` with a new `WallMiniShot` in `WallShot.tsx`; derives the fading once per (wall, lens, gaps) in `ScreensCanvas` and hands each node its `dimmed`/`dimmedRows`; and replaces `ScreensBar` with the lens + "Side by side" + gaps switch, wired to the controller and to `usePlatformHotkeys`.

**Tech Stack:** Next.js App Router, React 19 (React Compiler lint rules on), React Flow (`@xyflow/react` 12), Tailwind v4, lucide-react, TanStack hotkeys through `useShortcuts`.

**Spec:** `docs/superpowers/specs/2026-11-11-screens-map-design.md`

**Contract:** `docs/superpowers/plans/2026-11-11-screens-map-stack.md` (authoritative; this plan uses its names and signatures).

**Branch:** `feat/screens-side-gaps`, created with `gh stack` on top of `feat/screens-map` (use the `gh-stack` skill; `docs/conventions.md` § Shipping larger work).

**Position in the stack:** part 3 of 5. Below: part 1 `feat/screens-model` (pure wall model and layout), part 2 `feat/screens-map` (the Screens map, single lens). Above: part 4 `feat/screens-inspect` (selection, inspector, chips), part 5 `feat/screens-palette` (views and flows in ⌘K). Not in this part: selection, the inspector, chips, node search in ⌘K, `packages/**`, the palette.

---

## Contract deviations

One term, nothing renamed. The contract's I/W/A call is `usePlatformHotkeys({ enabled: wall.platforms.length >= 2, … })`. This plan uses `enabled: wall !== null && wall.empty !== "nothing" && lensChoices.length >= 2` (`lensChoices = wall?.platforms ?? []`). Why: the hook must run before the controller's loading early return, where `wall` can be `null`; and with `wall.empty === "nothing"` the map shows an empty state and no bar, so a live I/W/A would silently rewrite the stored lens ("a key that cannot act must not be registered as live", `lib/hooks/usePlatformHotkeys.ts`). The keys, rows, `current` and `onSelect` are the contract's.

## What this part builds on

**Part 1 (used, never edited):** from `lib/utils/screen-wall.ts` — `Wall`, `WallLens`, `WallStrip`, `PlatformCell`, `ShotState`, `WallShot` (type), `lensPlatforms`, `cellWord`, `isGapCell`, `isGapFrame`, `gapCount`, `countStrip`, `stripCountsLine`, `resolveLens`; from `lib/utils/screen-wall-layout.ts` — `FRAME_H`, `SIDE_ROW_GAP`, `SIDE_TAG_W`, `SIDE_WORD_W`, `DEFAULT_ASPECT`, `LOD_ZOOM`, `clampAspect`. Part 1 keeps the side box's two inner gaps (6 and 8 px) module-private; `WallFrameNode` restates them as local constants with the same names (`SIDE_TAG_GAP`, `SIDE_WORD_GAP`). `countStrip` counts `live` as any of the three `live-*` states; the frame's side caption uses the same rule, and the scratch check (Task 1) proves the two agree on every screen.

**Part 2 (anchors this plan edits).** You cannot see part 2's final code from this plan. Anchor on what the contract fixes, adapt to what is really there, and change no part 2 behaviour:

- `components/maps/ScreensMap.tsx`: `ScreensMap({ projectId, definition })`; it reads `useDisplayPreferences(projectId)` (this plan calls the tuple `[prefs, updatePrefs]`; use part 2's names), derives `lens` as `resolveLens(prefs.screensLens, wall)`, has a `setLens(next: WallLens)` that writes `screensLens`, renders `<ScreensCanvas …>` and `<ScreensBar …>` (only when `wall.platforms.length >= 2`), and builds the bar's `announcement` string.
- `components/graph/ScreensCanvas.tsx`: `ScreensCanvasProps` as the contract lists minus the (3)/(4) fields; one memo maps `layout.boxes` to React Flow nodes, building one data object per node typed `WallFrameData` / `WallHeaderData` / `WallMarkerData` / `WallJumpData`.
- `components/graph/nodes/wall-node-data.ts`: the contract's types without the (3)/(4) fields.
- `components/graph/nodes/WallFrameNode.tsx`: one `memo` component whose root is the focusable `role="button"` element; inside it, the shot box (a `WallShot` for the lens platform, `data.shotWidth` × `FRAME_H`) and the caption (title line, state line). Part 2 must narrow `data.lens` before indexing `data.screen.cells`, so it has some branch for `"side"` (a fallback platform, `null`, or a guard): this part replaces that branch.
- `components/graph/nodes/WallShot.tsx`: exports the `WallShot` component (one shot or ghost at full size).
- `WallHeaderNode.tsx`, `WallMarkerNode.tsx`, `WallJumpNode.tsx`: one `memo` component each, one root element.
- `components/maps/screens/ScreensBar.tsx`: `ScreensBarProps` = the contract's minus the (3) fields; `role="toolbar" aria-label="Screens display"`; a `SegmentedControl` over `wall.platforms`; a visually hidden `aria-live="polite"` line.
- `lib/hooks/useDisplayPreferences.ts`: `screensLens: WallLens | null` (default `null`) and a validator that accepts `PLATFORMS` ids only.

**Note for part 4.** After this part, every wall node's part 2 root sits inside one dim wrapper `<div className={wallDimClass(…)} data-dimmed=…>` (`h-full w-full`), and part 3 adds no class to part 2's focusable root. Part 4's selection ring, `aria-current`, `data-wall-frame` and arrow keys stay on that root; part 4's hidden `Handle` becomes the last child of the outermost element, which is now the dim wrapper — adding `relative` to it, as part 4's plan says, is compatible.

## Decisions this plan takes (no contract name changes)

1. **Fading.** Gaps only: a frame that is not a gap under the lens → 15% and greyscale; every marker and jump tile → 15% and greyscale (none is ever a gap); a header whose strip holds no gap frame → 40%, colour kept (it still names the strip). Inside a kept side frame, its non-gap rows → 35%. Focus inside a faded node lifts the fade (`focus-within`), so a focus ring is never faded; nothing becomes unclickable.
2. **Side caption.** The caption's second line side by side reads in the header's grammar: `"<live>/<on> live"`, then `" · N stale"`, `" · N without a shot"` when non-zero.
3. **Side aria-label.** `"<title>[, <arm context>]. Web: live. iOS: stale. Android: not on this platform."`; a not-live row says its status (lowercase) or "no status"; a live row with no shot says "live, no shot yet".
4. **Minis.** A mini's width is row height × its own shot's aspect once loaded (clamped, as `sideGeometry`), the platform default before that and for ghosts; capped at the mini column the layout left. A mini ghost has no text (the word sits beside it): absent = solid light border + ban glyph; live no shot = dashed amber border, hatch, dashed-circle glyph; not live = dashed border, hatch, the status glyph; a `path` shot = folder glyph; a load error = image-off glyph. Below `LOD_ZOOM` the image and glyph drop; the row's word stays.
5. **DOM hooks for the browser check:** `data-dimmed="true|false"` on each node's dim wrapper; `data-platform`, `data-word`, `data-row-dimmed` on each side row; `data-counts` on the header's counts line; `data-gap-count` on the switch's badge; `data-side-box`, `data-mini` for inspection; `img[data-wall-shot]` as part 2.
6. **Icons.** Only lucide names already in `lib/wobble/wobble-registry.generated.ts`: `Ban`, `CircleDashed`, `FolderOpen`, `ImageOff`, `Layers` (the "Side by side" option). No regeneration is expected; Task 6 proves it.

## File map

- Modify `lib/hooks/useDisplayPreferences.ts` — `screensLens` accepts `"side"`; new `screensGapsOnly: boolean` (default `false`), validated per key.
- Modify `components/graph/nodes/WallShot.tsx` — add `WallMiniShot` (one platform's mini in a side row).
- Modify `components/graph/nodes/WallFrameNode.tsx` — `wallDimClass` (exported), the side box, side caption and aria-label, the dim wrapper.
- Modify `components/graph/nodes/wall-node-data.ts` — the (3) fields: `WallFrameData.dimmed`, `WallFrameData.dimmedRows`, `WallHeaderData.dimmed`, `WallMarkerData.dimmed`, `WallJumpData.dimmed`.
- Modify `components/graph/nodes/WallHeaderNode.tsx`, `WallMarkerNode.tsx`, `WallJumpNode.tsx` — the dim wrapper; the header's counts line gets `title` and `data-counts`.
- Modify `components/graph/ScreensCanvas.tsx` — `gapsOnly` prop; `keptViews`, `fadedRows`; the (3) fields filled.
- Modify `components/maps/screens/ScreensBar.tsx` — replaced: lens + "Side by side" + gaps switch with its count.
- Modify `components/maps/ScreensMap.tsx` — gap count, gaps setter, announcement, I/W/A, the bar always rendered with the wall, `gapsOnly` to the canvas.
- Modify `lib/utils/keyboard-shortcuts.ts` — the three `filter-*` descriptions name Screens.
- Add `docs/superpowers/plans/2026-11-11-screens-map-part-3-side-gaps.md` (this plan) in the first commit if it is not tracked yet.
- **Not touched:** `package.json` scripts, `.github/workflows/ci.yml`, `.gitignore`, `tests/**` (contract § Test strategy, Part 3: no new suite; `npm run test:screen-wall` and `npm run test:keyboard-shortcuts` already cover what is pure), generated artifacts (unless Task 6's `npm run generate` says otherwise), `lib/utils/screen-wall*.ts`.
- **Outside the repo, never committed:** `$SCRATCH/prepare-bundle.cjs`, `$SCRATCH/check-part3.cjs`, `$SCRATCH/verify-part3.cjs`, `$SCRATCH/pebbles-shots.json`, screenshots.

## Repo traps that apply

Each task names the one it meets and what to run.

- **A new required key or field breaks `tsc` until its consumer lands in the same commit** — Task 2 (`DisplayPreferences.screensGapsOnly` with `DEFAULT_DISPLAY_PREFERENCES` and `read()`), Task 3 (the (3) data fields with the `ScreensCanvas` builder, and `ScreensCanvasProps.gapsOnly` with the controller passing it), Task 5 (`ScreensBarProps` (3) fields with the controller). Run `npx tsc --noEmit` before each commit.
- **React Compiler lint rules are errors** — Task 4: no component chosen by a function call during render (`react-hooks/static-components`; that is why the ghost glyph is a `MiniGhostGlyph` component, found in rehearsal), no `setState` in an effect (load and error state are keyed by the slot value and compared during render). Run `npx eslint <files>`.
- **CI diffs generated artifacts; a new lucide name dirties the wobble registry** — Tasks 4, 5, 6: only registered names are imported. Run `npm run generate && git status --porcelain`.
- **Source-reading suites** — Task 5: `tests/app/keyboard-shortcuts.test.js` forbids hand-rolled `keydown` listeners and checks every literal `useShortcut("id")`; I/W/A go through `usePlatformHotkeys`. Run `npm run test:keyboard-shortcuts`.
- **Hand-maintained alias tables** — no module any loader transpiles gains an `@/` import here (`useDisplayPreferences.ts` and the components are loaded by no suite: `grep -rlE "useDisplayPreferences|ScreensCanvas|WallFrameNode|ScreensBar" tests` prints nothing). Task 6 runs the grep.
- **React Flow sets `pointer-events: none` on a wall node's wrapper** (not selectable, not draggable, no node handlers; `@xyflow/react` `NodeWrapper`). Part 2's root has to turn them back on for itself (its frames are clickable in part 2's own check). Task 3's dim wrapper sets no `pointer-events` class; never add one.
- **Tailwind named groups match any ancestor** — this part adds no `group/*` name.
- **The overscroll wheel trap** — Task 5: the bar never uses `overflow-x-auto`.
- **CI is Node 20** — no test is added; the scratch scripts run locally only.
- **A stale dev server fakes hydration mismatches** — Task 7: restart the dev server after any branch switch, before believing one.

---

### Task 1: The scratch harness and the fixture bundle (outside the repo)

Nothing in this task changes a tracked file in the worktree. `WT` is the worktree, `SCRATCH` a directory outside any checkout (your session scratchpad, for example `<scratchpad>/screens-p3`):

```bash
WT=/Users/alexis/code/arkaik-screen-wall
SCRATCH=<your scratchpad>/screens-p3
mkdir -p "$SCRATCH"
```

The check harness is this part's failing test. It is not committed: the contract gives part 3 no new suite. It runs part 3's pure functions, cut out of the worktree's own files with the TypeScript parser, against part 1's real wall built from the fixture bundle, and pins the numbers the browser check (Task 7) expects.

**Files:**
- Create: `$SCRATCH/prepare-bundle.cjs`
- Create: `$SCRATCH/check-part3.cjs`

- [ ] **Step 1: Write the fixture builder**

Neither seed has a screenshot. This builds a copy of Pebbles in which the wall shows every state the side lens and the gaps switch have to draw. Create `$SCRATCH/prepare-bundle.cjs`:

```js
#!/usr/bin/env node
"use strict";

/**
 * The Screens map part 3 browser fixture: seed/pebbles.json with seven shots
 * and one shipped deliverable, so the wall shows every state the side-by-side
 * lens and the gaps switch have to draw:
 *
 *   V-souls-list    web, iOS, Android shots from CI, newer than every event  → live, current
 *   V-soul-detail   web, iOS, Android shots by hand on 2026-09-01; an iOS
 *                   deliverable naming the view shipped on 2026-10-20         → web, Android current; iOS stale
 *   V-soul-edit     web shot by hand                                          → web current; iOS, Android no shot
 *   V-soul-create, V-quick-pebble-editor (live, no shot), V-pebble-detail
 *                   (live on iOS through its acceptances, no shot)            → no shot
 *
 * Usage: node prepare-bundle.cjs <path to seed/pebbles.json> <out.json>
 */

const fs = require("fs");
const zlib = require("zlib");

const [, , seedPath, outPath] = process.argv;
if (!seedPath || !outPath) {
  console.error("usage: node prepare-bundle.cjs <path to seed/pebbles.json> <out.json>");
  process.exit(2);
}

// --- A minimal PNG encoder (8-bit RGB, no filter): a solid screen with a darker top bar. ---
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
function png(width, height, [r, g, b]) {
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  const bar = Math.round(height * 0.08);
  for (let y = 0; y < height; y++) {
    const shade = y < bar ? 0.55 : 1;
    raw[y * stride] = 0;
    for (let x = 0; x < width; x++) {
      const i = y * stride + 1 + x * 3;
      raw[i] = Math.round(r * shade);
      raw[i + 1] = Math.round(g * shade);
      raw[i + 2] = Math.round(b * shade);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: RGB
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    signature,
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const SIZE = { web: [1440, 900], ios: [390, 844], android: [390, 844] };
const COLOR = { web: [59, 130, 246], ios: [16, 185, 129], android: [234, 88, 12] };
const shotOf = (platform) => `data:image/png;base64,${png(...SIZE[platform], COLOR[platform]).toString("base64")}`;

const CI = { ts: "2026-10-01T10:00:00.000Z", source: "ci", form: "data", commit: "4f1c2ab", order: 412, ci_order: 412 };
const BY_HAND_OLD = { ts: "2026-09-01T10:00:00.000Z", source: "manual", form: "data" };
const BY_HAND = { ts: "2026-10-01T10:00:00.000Z", source: "manual", form: "data" };
const SHOTS = [
  ["V-souls-list", "web", CI],
  ["V-souls-list", "ios", CI],
  ["V-souls-list", "android", CI],
  ["V-soul-detail", "web", BY_HAND_OLD],
  ["V-soul-detail", "ios", BY_HAND_OLD],
  ["V-soul-detail", "android", BY_HAND_OLD],
  ["V-soul-edit", "web", BY_HAND],
];
const SHIPPED = {
  id: "01K0SHOTSEED00000000000001",
  ts: "2026-10-20T09:00:00.000Z",
  actor: "arkaik-cli",
  type: "deliverable.shipped",
  deliverable_id: "pr-133",
  title: "Soul detail shows the pebbles you share",
  summary: "The iOS soul detail now lists the pebbles shared with that soul.",
  url: "https://github.com/example/pebbles/pull/133",
  node_ids: ["V-soul-detail"],
  platform: "ios",
};
const PROJECT_ID = "pebbles-shots";

const bundle = JSON.parse(fs.readFileSync(seedPath, "utf8"));
const latest = bundle.journal.reduce((max, event) => (event.ts > max ? event.ts : max), "");
if (latest >= BY_HAND_OLD.ts) {
  throw new Error(`the seed's journal reaches ${latest}: the shot dates no longer postdate it`);
}

bundle.project.id = PROJECT_ID;
bundle.project.title = "Pebbles (shots)";
for (const node of bundle.nodes) node.project_id = PROJECT_ID;
for (const edge of bundle.edges) edge.project_id = PROJECT_ID;

const byId = new Map(bundle.nodes.map((node) => [node.id, node]));
for (const [viewId, platform, meta] of SHOTS) {
  const view = byId.get(viewId);
  if (!view || view.species !== "view" || view.status !== "live" || !view.platforms.includes(platform)) {
    throw new Error(`${viewId} is no longer a live view on ${platform} in the seed`);
  }
  view.metadata ??= {};
  view.metadata.platformScreenshots = { ...view.metadata.platformScreenshots, [platform]: shotOf(platform) };
  view.metadata.platformScreenshotMeta = { ...view.metadata.platformScreenshotMeta, [platform]: { ...meta } };
}
bundle.journal.push(SHIPPED);

fs.writeFileSync(outPath, JSON.stringify(bundle, null, 2) + "\n");
const kb = Math.round(fs.statSync(outPath).size / 1024);
console.log(`wrote ${outPath} (${kb} KB): ${SHOTS.length} shots on 3 views, 1 shipped deliverable, project "${PROJECT_ID}"`);
```

- [ ] **Step 2: Build and validate the fixture**

Run:

```bash
node "$SCRATCH/prepare-bundle.cjs" "$WT/seed/pebbles.json" "$SCRATCH/pebbles-shots.json"
node "$WT/docs/arkaik-skill/scripts/validate-bundle.js" "$SCRATCH/pebbles-shots.json" | tail -3
```

Expected: `wrote …/pebbles-shots.json (216 KB): 7 shots on 3 views, 1 shipped deliverable, project "pebbles-shots"`, then `Result: VALID`. (Rehearsed: the bundle also passes the app's own import gate, `parseBundle` + `validateBundle`.)

- [ ] **Step 3: Write the check harness**

Create `$SCRATCH/check-part3.cjs`:

```js
#!/usr/bin/env node
"use strict";

/**
 * Screens map part 3 — the throwaway check (NOT committed: the stack contract's
 * test strategy gives part 3 no new suite). It runs part 3's pure functions,
 * cut out of the worktree's own component files with the TypeScript parser,
 * against part 1's real wall built from the prepared Pebbles bundle, and pins
 * the numbers the browser script expects.
 *
 * Usage: node check-part3.cjs <worktree> <pebbles-shots.json>
 */

const fs = require("fs");
const path = require("path");

const [, , worktreeArg, bundleArg] = process.argv;
if (!worktreeArg || !bundleArg) {
  console.error("usage: node check-part3.cjs <worktree> <pebbles-shots.json>");
  process.exit(2);
}
const WORKTREE = path.resolve(worktreeArg);
const ts = require(path.join(WORKTREE, "node_modules", "typescript"));
const BUILD = path.join(__dirname, ".check-part3-build");
fs.rmSync(BUILD, { recursive: true, force: true });
fs.mkdirSync(BUILD, { recursive: true });

let checks = 0;
let failed = 0;
function check(name, fn) {
  checks += 1;
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL ${name}\n     ${String(error.message).split("\n").join("\n     ")}`);
  }
}
function equal(actual, expected, what) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${what}: expected ${e}, got ${a}`);
}
const sorted = (values) => [...values].sort();

// --- Part 1's real model, through its own loader ---
const loaderModule = require(path.join(WORKTREE, "tests", "app", "load-screen-wall.js"));
const loadWall = loaderModule.loadScreenWall ?? Object.values(loaderModule).find((value) => typeof value === "function");
const W = loadWall();

const bundle = JSON.parse(fs.readFileSync(path.resolve(bundleArg), "utf8"));
const STALENESS = new Set(W.STALENESS_EVENT_TYPES ?? ["node.status_changed", "ref.status_changed", "deliverable.shipped"]);
const wall = W.buildWall({
  nodes: bundle.nodes,
  edges: bundle.edges,
  events: bundle.journal.filter((event) => STALENESS.has(event.type)),
  project: bundle.project,
  definition: null,
  scope: W.resolveProductScope(bundle, null),
  graph: W.buildProductGraph(bundle.nodes, bundle.edges),
});
const LENSES = ["web", "ios", "android", "side"];
const P = ["web", "ios", "android"];
const PLATFORM_LABELS = { web: "Web", ios: "iOS", android: "Android" };
const NO_ROWS = [];

// --- Part 3's functions, cut from the worktree ---
function cut(relative, names) {
  const text = fs.readFileSync(path.join(WORKTREE, relative), "utf8");
  const source = ts.createSourceFile(relative, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  return names
    .map((name) => {
      const found = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
      if (!found) throw new Error(`${relative} has no top-level function ${name}() yet`);
      return found.getText(source).replace(/^export\s+/, "");
    })
    .join("\n\n");
}
function compile(relative, names, deps) {
  const { outputText } = ts.transpileModule(cut(relative, names), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
  });
  const make = new Function(...Object.keys(deps), `${outputText}\nreturn { ${names.join(", ")} };`);
  return make(...Object.values(deps));
}
const platformLabel = (platform) => PLATFORM_LABELS[platform] ?? String(platform);
const canvas = () =>
  compile("components/graph/ScreensCanvas.tsx", ["keptViews", "fadedRows"], {
    isGapCell: W.isGapCell, isGapFrame: W.isGapFrame, lensPlatforms: W.lensPlatforms, NO_ROWS,
  });
const frame = () =>
  compile("components/graph/nodes/WallFrameNode.tsx", ["sentence", "sideSpokenWord", "sideAriaLabel", "sideStateLine"], {
    cellWord: W.cellWord, PLATFORM_LABELS,
  });
const controller = () => compile("components/maps/ScreensMap.tsx", ["screensAnnouncement"], { platformLabel });

/** The prefs hook, whole, with read() exposed to this check only. */
function prefsModule() {
  const transpile = (relative, extra = "") =>
    ts.transpileModule(fs.readFileSync(path.join(WORKTREE, relative), "utf8") + extra, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    }).outputText;
  fs.writeFileSync(path.join(BUILD, "config-platforms.js"), transpile("lib/config/platforms.ts"));
  let hook = transpile("lib/hooks/useDisplayPreferences.ts", "\nexport { read as __read };\n");
  const map = {
    react: path.join(WORKTREE, "node_modules", "react"),
    "@/lib/config/platforms": path.join(BUILD, "config-platforms.js"),
  };
  for (const [from, to] of Object.entries(map)) hook = hook.split(`require("${from}")`).join(`require(${JSON.stringify(to)})`);
  const unmapped = /require\("(@\/[^"]+)"\)/.exec(hook);
  if (unmapped) throw new Error(`useDisplayPreferences imports ${unmapped[1]} at runtime; map it in prefsModule()`);
  fs.writeFileSync(path.join(BUILD, "prefs.js"), hook);
  return require(path.join(BUILD, "prefs.js"));
}

// --- Expectations (the browser script asserts the same numbers) ---
const GAPS = { web: 2, ios: 5, android: 3, side: 10 };
const KEPT = {
  web: ["V-quick-pebble-editor", "V-soul-create"],
  ios: ["V-pebble-detail", "V-quick-pebble-editor", "V-soul-create", "V-soul-detail", "V-soul-edit"],
  android: ["V-quick-pebble-editor", "V-soul-create", "V-soul-edit"],
  side: ["V-pebble-detail", "V-quick-pebble-editor", "V-soul-create", "V-soul-detail", "V-soul-edit"],
};
const SIDE_WORDS = {
  "V-souls-list": ["Live", "Live", "Live"],
  "V-soul-detail": ["Live", "Stale", "Live"],
  "V-soul-create": ["No shot", "No shot", "No shot"],
  "V-soul-edit": ["Live", "No shot", "No shot"],
  "V-pebble-detail": ["Backlog", "No shot", "Development"],
  "V-onboarding-intro": ["Absent", "Development", "Absent"],
};
const FADED_ROWS = {
  "V-soul-detail": ["android", "web"],
  "V-pebble-detail": ["android", "web"],
  "V-soul-edit": ["web"],
  "V-soul-create": [],
  "V-quick-pebble-editor": [],
};

console.log("part 1 model on the prepared bundle");
check("the scope offers web, iOS and Android", () => equal(wall.platforms, P, "wall.platforms"));
check("gap counts per lens", () => equal(Object.fromEntries(LENSES.map((lens) => [lens, W.gapCount(wall, lens)])), GAPS, "gapCount"));
check("side-by-side words", () => {
  for (const [viewId, words] of Object.entries(SIDE_WORDS)) {
    equal(P.map((p) => W.cellWord(wall.screens.get(viewId).cells[p])), words, viewId);
  }
});
const souls = wall.strips.find((strip) => strip.id === "strip:F-manage-souls");
check("Manage souls header on Web (the browser script's pattern)", () => {
  const line = W.stripCountsLine(wall, souls, "web");
  if (!/^\d+\/4 live on Web · 1 without a shot$/.test(line)) throw new Error(`got "${line}"`);
});
check("Manage souls header side by side (the browser script's pattern)", () => {
  const line = W.stripCountsLine(wall, souls, "side");
  if (!/^Web \d+\/4 · iOS \d+\/4 · Android \d+\/4 · 1 stale · 5 without a shot$/.test(line)) throw new Error(`got "${line}"`);
});

console.log("\nScreensCanvas — what gaps only keeps");
check("kept views per lens", () => {
  const { keptViews } = canvas();
  for (const lens of LENSES) equal(sorted(keptViews(wall, lens)), KEPT[lens], `keptViews(${lens})`);
});
check("faded rows inside kept side frames", () => {
  const { fadedRows } = canvas();
  for (const [viewId, rows] of Object.entries(FADED_ROWS)) equal(sorted(fadedRows(wall, viewId, "side")), rows, viewId);
  equal(fadedRows(wall, "V-soul-detail", "ios"), [], "a single lens has no rows");
});
check("a header stays lit only when its strip holds a kept view", () => {
  const { keptViews } = canvas();
  const kept = keptViews(wall, "side");
  const lit = wall.strips.filter((strip) => strip.viewIds.some((viewId) => kept.has(viewId))).map((strip) => strip.id);
  equal(sorted(lit), ["strip:F-manage-souls", "strip:F-record-pebble"], "lit headers");
});

console.log("\nWallFrameNode — side by side");
const frameData = (viewId, armContext = null) => ({ screen: wall.screens.get(viewId), platforms: wall.platforms, armContext });
check("side aria label", () => {
  const { sideAriaLabel } = frame();
  const title = wall.screens.get("V-soul-detail").title;
  equal(sideAriaLabel(frameData("V-soul-detail")), `${title}. Web: live. iOS: stale. Android: live.`, "V-soul-detail");
  const intro = wall.screens.get("V-onboarding-intro").title;
  equal(
    sideAriaLabel(frameData("V-onboarding-intro", "in Yes of Has a streak?")),
    `${intro}, in Yes of Has a streak? Web: not on this platform. iOS: development. Android: not on this platform.`,
    "V-onboarding-intro",
  );
});
check("side state line agrees with part 1's counts for every screen", () => {
  const { sideStateLine } = frame();
  for (const [viewId, screen] of wall.screens) {
    const counts = W.countStrip(wall, { id: "check", flowId: null, title: "", items: [], viewIds: [viewId] }, "side");
    const on = P.reduce((sum, p) => sum + (counts.perPlatform[p]?.on ?? 0), 0);
    const live = P.reduce((sum, p) => sum + (counts.perPlatform[p]?.live ?? 0), 0);
    const expected =
      `${live}/${on} live` +
      (counts.stale ? ` · ${counts.stale} stale` : "") +
      (counts.noShot ? ` · ${counts.noShot} without a shot` : "");
    equal(sideStateLine(frameData(viewId)), expected, `${viewId} (${screen.title})`);
  }
});

console.log("\nScreensMap — the live line");
check("announcement", () => {
  const { screensAnnouncement } = controller();
  equal(screensAnnouncement("ios", 4, false), "Showing iOS. 4 gaps.", "iOS");
  equal(screensAnnouncement("side", 1, true), "Showing side by side, gaps only. 1 gap.", "side");
});

console.log("\nuseDisplayPreferences — what survives a reload");
check("read() keeps side and gaps, degrades per key", () => {
  const store = new Map();
  global.window = { localStorage: { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) } };
  const prefs = prefsModule();
  const key = "arkaik:display-prefs:p1";
  store.set(key, JSON.stringify({ screensLens: "side", screensGapsOnly: true }));
  equal(prefs.__read("p1"), { ...prefs.DEFAULT_DISPLAY_PREFERENCES, screensLens: "side", screensGapsOnly: true }, "side + gaps");
  store.set(key, JSON.stringify({ screensLens: "tv", screensGapsOnly: "yes", acceptanceDisplay: "cards" }));
  equal(
    prefs.__read("p1"),
    { ...prefs.DEFAULT_DISPLAY_PREFERENCES, acceptanceDisplay: "cards" },
    "unknown lens and non-boolean gaps fall back",
  );
  equal(prefs.DEFAULT_DISPLAY_PREFERENCES.screensGapsOnly, false, "gaps only defaults off");
});

console.log(`\n${checks - failed}/${checks} part 3 checks pass`);
process.exit(failed ? 1 : 0);
```

- [ ] **Step 4: Run it to see the part 3 checks fail**

Run (on `feat/screens-side-gaps`, parts 1 and 2 below it, nothing of this part written yet):

```bash
node "$SCRATCH/check-part3.cjs" "$WT" "$SCRATCH/pebbles-shots.json"
```

Expected: exit 1, `5/12 part 3 checks pass`. The five "part 1 model on the prepared bundle" checks print `ok`; the seven others print `FAIL` — six with `… has no top-level function keptViews() yet` / `sentence() yet` / `screensAnnouncement() yet`, and the prefs check with `side + gaps: expected {…"screensLens":"side","screensGapsOnly":true}, got {…"screensLens":null}`.

If any of the first five fails, stop: part 1's model disagrees with the spec's truth table on this fixture (the expectations were derived with the real `getEffectivePlatformStatuses` and `isScreenshotStale`). Raise it on part 1; do not edit the expectations to match.

The run writes part 1's gitignored `tests/app/.test-build-screen-wall/` in the worktree (as `npm run test:screen-wall` does) and its own `$SCRATCH/.check-part3-build/`. No commit in this task.

---

### Task 2: Remember "side" and Gaps only per viewer

**Files:**
- Modify: `lib/hooks/useDisplayPreferences.ts`

Trap: a new required `DisplayPreferences` key must land with `DEFAULT_DISPLAY_PREFERENCES` and `read()` in the same commit, or `tsc` fails.

- [ ] **Step 1: The failing check**

The harness's `read() keeps side and gaps, degrades per key` fails (Task 1, Step 4).

- [ ] **Step 2: Widen the interface and the defaults**

Replace part 2's `DisplayPreferences` interface and `DEFAULT_DISPLAY_PREFERENCES` constant with:

```ts
export interface DisplayPreferences {
  acceptanceDisplay: AcceptanceDisplay;
  deliveryCardDisplay: DeliveryCardDisplay;
  /**
   * The Screens map's lens: a platform, or `"side"` (every platform stacked in
   * each frame). `null` until the viewer picks one; the map always renders
   * `resolveLens(screensLens, wall)`, so a stored lens the scope lacks is never drawn.
   */
  screensLens: WallLens | null;
  /** The Screens map's "Gaps only" switch: fade everything but stale shots and live screens with no shot. */
  screensGapsOnly: boolean;
}

export const DEFAULT_DISPLAY_PREFERENCES: DisplayPreferences = {
  acceptanceDisplay: "rows",
  deliveryCardDisplay: "compact",
  screensLens: null,
  screensGapsOnly: false,
};
```

The file keeps part 2's imports (`PLATFORMS` from `@/lib/config/platforms`, `type WallLens` from `@/lib/utils/screen-wall`); if part 2 imported either under another form, keep exactly one import of each.

- [ ] **Step 3: Widen the validator and `read()`**

Replace part 2's screens-lens validator (this plan calls it `isScreensLens`; keep part 2's name if it differs and there is only one) with these two functions, placed directly above `read`:

```ts
/** A lens the Screens map can draw. Whether this scope offers it is `resolveLens`'s call, not the store's. */
function isScreensLens(value: unknown): value is WallLens {
  return value === "side" || PLATFORMS.some((platform) => platform.id === value);
}

function isScreensGapsOnly(value: unknown): value is boolean {
  return typeof value === "boolean";
}
```

Replace `read` with:

```ts
function read(projectId: string): DisplayPreferences {
  if (typeof window === "undefined") return DEFAULT_DISPLAY_PREFERENCES;
  try {
    const stored = window.localStorage.getItem(`${STORAGE_PREFIX}${projectId}`);
    if (!stored) return DEFAULT_DISPLAY_PREFERENCES;
    const parsed: unknown = JSON.parse(stored);
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_DISPLAY_PREFERENCES;
    const { acceptanceDisplay, deliveryCardDisplay, screensLens, screensGapsOnly } =
      parsed as Partial<DisplayPreferences>;
    return {
      acceptanceDisplay: isAcceptanceDisplay(acceptanceDisplay)
        ? acceptanceDisplay
        : DEFAULT_DISPLAY_PREFERENCES.acceptanceDisplay,
      deliveryCardDisplay: isDeliveryCardDisplay(deliveryCardDisplay)
        ? deliveryCardDisplay
        : DEFAULT_DISPLAY_PREFERENCES.deliveryCardDisplay,
      screensLens: isScreensLens(screensLens) ? screensLens : DEFAULT_DISPLAY_PREFERENCES.screensLens,
      screensGapsOnly: isScreensGapsOnly(screensGapsOnly)
        ? screensGapsOnly
        : DEFAULT_DISPLAY_PREFERENCES.screensGapsOnly,
    };
  } catch {
    return DEFAULT_DISPLAY_PREFERENCES;
  }
}
```

The hook (`useDisplayPreferences`), the cache, `getSnapshot`, `subscribe` and the storage key are unchanged.

- [ ] **Step 4: Run the check and the typecheck**

Run: `node "$SCRATCH/check-part3.cjs" "$WT" "$SCRATCH/pebbles-shots.json"; npx tsc --noEmit`
Expected: `6/12 part 3 checks pass` (the prefs check now `ok`; the six function checks still FAIL); `tsc` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add lib/hooks/useDisplayPreferences.ts docs/superpowers/plans/2026-11-11-screens-map-part-3-side-gaps.md
git commit -m "feat(screens): remember side by side and gaps only per viewer"
```

---

### Task 3: Gaps only fades everything that is not a gap

**Files:**
- Modify: `components/graph/nodes/wall-node-data.ts`
- Modify: `components/graph/nodes/WallFrameNode.tsx`
- Modify: `components/graph/nodes/WallHeaderNode.tsx`
- Modify: `components/graph/nodes/WallMarkerNode.tsx`
- Modify: `components/graph/nodes/WallJumpNode.tsx`
- Modify: `components/graph/ScreensCanvas.tsx`
- Modify: `components/maps/ScreensMap.tsx`

Traps: the (3) fields are required, so the builder fills them in this commit, and `ScreensCanvasProps.gapsOnly` lands with the controller passing it; React Flow's `pointer-events: none` on the node wrapper (the dim wrapper sets no pointer-events).

- [ ] **Step 1: The (3) fields**

In `wall-node-data.ts`, add to `WallFrameData`, after `onAspect`:

```ts
  /** Gaps only, and this frame shows no gap under the lens: drawn at 15% and greyscale, still clickable. */
  dimmed: boolean;
  /** Gaps only, side by side, and this frame is a gap: its rows that are not gaps, drawn at 35%. Empty otherwise. */
  dimmedRows: readonly PlatformId[];
```

to `WallHeaderData`, after `onOpenFlow`:

```ts
  /** Gaps only, and no view in the strip is a gap under the lens: the header softens to 40%. */
  dimmed: boolean;
```

to `WallMarkerData`, after `empty`:

```ts
  /** Gaps only: a marker is never a gap, so it fades with everything that is not one. */
  dimmed: boolean;
```

and to `WallJumpData`, after `onJump`:

```ts
  /** Gaps only: a jump tile is never a gap, so it fades with everything that is not one. */
  dimmed: boolean;
```

(If part 2 already declared any of them, keep one declaration with this comment.) `PlatformId` is already imported there for `AspectReport`.

- [ ] **Step 2: The dim wrapper on every wall node**

In `WallFrameNode.tsx`, add `import { cn } from "@/lib/utils";` if it is not imported, and add above the component:

```tsx
/**
 * Gaps only (spec § Parts, part 3): what is not a gap fades — frames, markers
 * and jump tiles to 15% and greyscale, a header whose strip holds no gap to
 * 40%. Nothing becomes unclickable, and focus inside lifts the fade, so a
 * faded node never hides its focus ring.
 */
export function wallDimClass(dimmed: boolean, strength: "strong" | "soft" = "strong"): string {
  return cn(
    "h-full w-full transition-[opacity,filter] duration-200 motion-reduce:transition-none",
    dimmed && (strength === "strong" ? "opacity-15 grayscale" : "opacity-40"),
    dimmed && "focus-within:opacity-100 focus-within:grayscale-0",
  );
}
```

Then, in each of the four node components, wrap the element part 2's component returns — unchanged — in one `div`. `PART_2_ROOT` below is that element, moved inside as is:

`WallFrameNode` (strong):

```tsx
  return (
    <div className={wallDimClass(data.dimmed)} data-dimmed={data.dimmed ? "true" : "false"}>
      {PART_2_ROOT}
    </div>
  );
```

`WallHeaderNode` (soft), with `import { wallDimClass } from "./WallFrameNode";`:

```tsx
  return (
    <div className={wallDimClass(data.dimmed, "soft")} data-dimmed={data.dimmed ? "true" : "false"}>
      {PART_2_ROOT}
    </div>
  );
```

`WallMarkerNode` and `WallJumpNode` (strong), each with `import { wallDimClass } from "./WallFrameNode";`:

```tsx
  return (
    <div className={wallDimClass(data.dimmed)} data-dimmed={data.dimmed ? "true" : "false"}>
      {PART_2_ROOT}
    </div>
  );
```

The wrapper is `h-full w-full`, so part 2's root keeps the node's box. Do not give it `pointer-events-*`, `role`, `tabIndex` or a handler: React Flow already sets `pointer-events: none` on the node wrapper for these nodes, part 2's root turns pointer events back on for itself (if a frame stops taking clicks after this step, part 2's root lacked `pointer-events-auto`: that is part 2's to fix, not the wrapper's), and focus stays on part 2's root.

- [ ] **Step 3: `ScreensCanvas` derives the fading**

Add `isGapCell`, `isGapFrame` and `lensPlatforms` to the file's import from `@/lib/utils/screen-wall`, and `import type { PlatformId } from "@/lib/config/platforms";` if it is not there.

Add to `ScreensCanvasProps`, after `onAspect`:

```ts
  gapsOnly: boolean;
```

Add at module level:

```ts
const NO_ROWS: readonly PlatformId[] = [];

/** Gaps only: the views whose frames stay lit — live on a lens platform with a stale shot or none. */
function keptViews(wall: Wall, lens: WallLens): ReadonlySet<string> {
  const kept = new Set<string>();
  for (const viewId of wall.screens.keys()) {
    if (isGapFrame(wall, viewId, lens)) kept.add(viewId);
  }
  return kept;
}

/** Inside a lit side-by-side frame, the rows that are not gaps themselves (drawn at 35%). */
function fadedRows(wall: Wall, viewId: string, lens: WallLens): readonly PlatformId[] {
  if (lens !== "side") return NO_ROWS;
  const screen = wall.screens.get(viewId);
  if (!screen) return NO_ROWS;
  return lensPlatforms(wall, lens).filter((platform) => {
    const cell = screen.cells[platform];
    return cell === undefined || !isGapCell(cell);
  });
}
```

In the component: destructure `gapsOnly` with the other props, and add, directly above part 2's node-building `useMemo`:

```ts
  const kept = useMemo(() => (gapsOnly ? keptViews(wall, lens) : null), [gapsOnly, lens, wall]);
```

In part 2's node-building memo, add one property to each data object (beside the fields part 2 sets; `item`/`strip` are whatever part 2 names the wall item and its strip there):

```ts
// WallHeaderData (the header box of `strip`)
dimmed: kept !== null && !strip.viewIds.some((viewId) => kept.has(viewId)),

// WallFrameData (a frame item showing item.viewId)
dimmed: kept !== null && !kept.has(item.viewId),
dimmedRows: kept !== null && kept.has(item.viewId) ? fadedRows(wall, item.viewId, lens) : NO_ROWS,

// WallJumpData
dimmed: kept !== null,

// WallMarkerData (arm, end and empty alike)
dimmed: kept !== null,
```

and add `kept` to that memo's dependency array. `stripCountsLine(wall, strip, lens)` stays as part 2 wrote it.

- [ ] **Step 4: The controller passes the stored switch**

In `ScreensMap.tsx`, below the line that derives `lens`:

```ts
  const gapsOnly = prefs.screensGapsOnly;
```

and on the `<ScreensCanvas …>` element add the prop:

```tsx
        gapsOnly={gapsOnly}
```

(Task 5 adds the switch that writes it; until then a value stored by hand in localStorage already fades the wall. `dimmedRows` is filled now and drawn by Task 4's side box.)

- [ ] **Step 5: Check, typecheck, lint, then commit**

Run:

```bash
node "$SCRATCH/check-part3.cjs" "$WT" "$SCRATCH/pebbles-shots.json"
npx tsc --noEmit
npx eslint components/graph/ScreensCanvas.tsx components/graph/nodes components/maps/ScreensMap.tsx
```

Expected: `9/12 part 3 checks pass` (the three ScreensCanvas checks now `ok`; the two WallFrameNode checks and `announcement` still FAIL); no `tsc` output; no ESLint output.

```bash
git add components/graph/nodes/wall-node-data.ts components/graph/nodes/WallFrameNode.tsx components/graph/nodes/WallHeaderNode.tsx components/graph/nodes/WallMarkerNode.tsx components/graph/nodes/WallJumpNode.tsx components/graph/ScreensCanvas.tsx components/maps/ScreensMap.tsx
git commit -m "feat(screens): gaps only fades everything that is not a gap"
```

---

### Task 4: Side by side in every frame

**Files:**
- Modify: `components/graph/nodes/WallShot.tsx`
- Modify: `components/graph/nodes/WallFrameNode.tsx`
- Modify: `components/graph/nodes/WallHeaderNode.tsx`

Traps: React Compiler lint (`react-hooks/static-components`, `react-hooks/set-state-in-effect`); lucide names (all five are already registered).

- [ ] **Step 1: Add `WallMiniShot` to `WallShot.tsx`**

Merge these into the file's imports (keep one import per name; part 2 already imports some of them):

```tsx
import { memo, useState, type CSSProperties } from "react";
import { useStore, type ReactFlowState } from "@xyflow/react";
import { BanIcon, CircleDashedIcon, FolderOpenIcon, ImageOffIcon } from "lucide-react";
import type { PlatformId } from "@/lib/config/platforms";
import type { StatusId } from "@/lib/config/statuses";
import { cn } from "@/lib/utils";
import type { PlatformCell, ShotState, WallShot as WallShotValue } from "@/lib/utils/screen-wall";
import { DEFAULT_ASPECT, LOD_ZOOM, clampAspect } from "@/lib/utils/screen-wall-layout";
import { STATUS_ICONS, STATUS_STYLES } from "./node-styles";
import type { AspectReport } from "./wall-node-data";
```

(`WallShot` the type is aliased `WallShotValue` because the file's component is `WallShot`. If part 2 already imports the type under another alias, use that alias in `miniGhostOf` below.)

Append to the end of the file, after part 2's `WallShot`:

```tsx
/** Below LOD_ZOOM a mini drops its image, like a full shot (spec § Images). Boolean, so a re-render only at the threshold. */
const selectMiniDetailed = (state: ReactFlowState) => state.transform[2] >= LOD_ZOOM;

/** The ghost hatch: `currentColor` stripes, drawn at 10% by the span that carries it. */
const MINI_HATCH: CSSProperties = {
  backgroundImage: "repeating-linear-gradient(135deg, currentColor 0 1px, transparent 1px 6px)",
};

type MiniGhost = "absent" | "no-shot" | "not-live" | "path" | "error";

function miniGhostOf(state: ShotState, shot: WallShotValue | null): MiniGhost {
  if (state === "absent") return "absent";
  if (shot !== null) return shot.form === "path" ? "path" : "error";
  return state === "live-no-shot" ? "no-shot" : "not-live";
}

/** The ghost's glyph; a component, so the icon is chosen in JSX rather than created during render. */
function MiniGhostGlyph({ ghost, status }: { ghost: MiniGhost; status: StatusId | null }) {
  const className = "relative size-3.5";
  switch (ghost) {
    case "absent":
      return <BanIcon aria-hidden className={className} />;
    case "path":
      return <FolderOpenIcon aria-hidden className={className} />;
    case "error":
      return <ImageOffIcon aria-hidden className={className} />;
    case "no-shot":
      return <CircleDashedIcon aria-hidden className={className} />;
    case "not-live": {
      if (status === null) return <CircleDashedIcon aria-hidden className={className} />;
      const StatusIcon = STATUS_ICONS[status];
      return <StatusIcon aria-hidden className={className} />;
    }
  }
}

function miniGhostClass(ghost: MiniGhost, status: StatusId | null): string {
  switch (ghost) {
    case "absent":
      return "border-border/60 text-muted-foreground";
    case "no-shot":
      return "border-dashed border-amber-500 text-amber-700 dark:border-amber-400 dark:text-amber-400";
    case "not-live":
      return cn("border-dashed border-border", status === null ? "text-muted-foreground" : STATUS_STYLES[status].badge);
    case "path":
    case "error":
      return "border-dashed border-border text-muted-foreground";
  }
}

export interface WallMiniShotProps {
  viewId: string;
  platform: PlatformId;
  /** The row's cell; undefined reads as absent. */
  cell: PlatformCell | undefined;
  /** The row height (`sideGeometry`'s `rowHeight`). */
  height: number;
  /** The mini column's width; no mini is drawn wider. */
  maxWidth: number;
  onAspect: AspectReport;
}

/**
 * One platform's picture in a side-by-side frame (spec § Layout, § Images).
 *
 * Width = row height × the shot's own aspect once it has loaded (clamped, as
 * `sideGeometry` does), the platform default before that and for ghosts. The
 * column was sized by the layout from the same measured aspect (through the
 * aspect cache), so a loaded mini fits it; `maxWidth` only guards the frame
 * between the load and the relayout. The state word sits beside the mini, so a
 * ghost here carries no text: only its border, hatch and glyph.
 *
 * Load and error state are keyed by the slot's value and compared during
 * render, never reset in an effect, so a new shot starts clean.
 */
export const WallMiniShot = memo(function WallMiniShot({
  viewId,
  platform,
  cell,
  height,
  maxWidth,
  onAspect,
}: WallMiniShotProps) {
  const detailed = useStore(selectMiniDetailed);
  const [measured, setMeasured] = useState<{ value: string; ratio: number } | null>(null);
  const [failedValue, setFailedValue] = useState<string | null>(null);

  const state: ShotState = cell?.state ?? "absent";
  const status = cell?.status ?? null;
  const shot = state === "absent" ? null : (cell?.shot ?? null);
  const ratio = shot !== null && measured?.value === shot.value ? measured.ratio : null;
  const aspect = ratio === null ? DEFAULT_ASPECT[platform] : clampAspect(ratio);
  const width = Math.max(1, Math.min(maxWidth, Math.round(height * aspect)));

  if (shot !== null && shot.form !== "path" && failedValue !== shot.value) {
    return (
      <div
        className={cn(
          "relative shrink-0 overflow-hidden rounded-sm bg-muted",
          state === "live-stale" && "ring-2 ring-amber-500 dark:ring-amber-400",
          state === "not-live" && "opacity-50",
        )}
        style={{ width, height }}
        data-mini="shot"
      >
        {detailed && (
          // eslint-disable-next-line @next/next/no-img-element -- an arbitrary data:/https: shot; next/image has nothing to optimise
          <img
            src={shot.value}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            referrerPolicy="no-referrer"
            data-wall-shot=""
            className="size-full object-cover object-top"
            onLoad={(event) => {
              const { naturalWidth, naturalHeight } = event.currentTarget;
              if (naturalWidth <= 0 || naturalHeight <= 0) return;
              const next = naturalWidth / naturalHeight;
              setMeasured({ value: shot.value, ratio: next });
              onAspect(viewId, platform, shot.value, next);
            }}
            onError={() => setFailedValue(shot.value)}
          />
        )}
      </div>
    );
  }

  const ghost = miniGhostOf(state, shot);
  return (
    <div
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded-sm border",
        miniGhostClass(ghost, status),
      )}
      style={{ width, height }}
      data-mini={ghost}
    >
      {ghost !== "absent" && (
        <span aria-hidden className="pointer-events-none absolute inset-0 opacity-10" style={MINI_HATCH} />
      )}
      {detailed && <MiniGhostGlyph ghost={ghost} status={status} />}
    </div>
  );
});
```

If part 2's `WallShot.tsx` already exports a selector or hatch style that is byte-for-byte the same as `selectMiniDetailed` / `MINI_HATCH`, reuse it instead of the duplicate; otherwise keep these.

- [ ] **Step 2: The side box in `WallFrameNode.tsx`**

Merge into the imports:

```tsx
import { cn } from "@/lib/utils";
import { cellWord, type PlatformCell } from "@/lib/utils/screen-wall";
import { FRAME_H, SIDE_ROW_GAP, SIDE_TAG_W, SIDE_WORD_W } from "@/lib/utils/screen-wall-layout";
import { PLATFORM_ICONS, PLATFORM_LABELS, STATUS_STYLES } from "./node-styles";
import { WallMiniShot, WallShot } from "./WallShot";
import type { WallFrameData } from "./wall-node-data";
```

Add these declarations at module level, above the component:

```tsx
/** Spec § Layout: box width = SIDE_TAG_W + 6 + mini column + 8 + SIDE_WORD_W (the two gaps are private to screen-wall-layout.ts). */
const SIDE_TAG_GAP = 6;
const SIDE_WORD_GAP = 8;

function sideWordClass(cell: PlatformCell | undefined): string {
  if (!cell) return "text-muted-foreground";
  switch (cell.state) {
    case "live-current":
      return STATUS_STYLES.live.badge;
    case "live-stale":
    case "live-no-shot":
      return "text-amber-700 dark:text-amber-400";
    case "not-live":
      return cell.status === null ? "text-muted-foreground" : STATUS_STYLES[cell.status].badge;
    case "absent":
      return "text-muted-foreground";
  }
}

/** One platform's state as the frame's accessible description reads it. */
function sideSpokenWord(cell: PlatformCell | undefined): string {
  if (!cell || cell.state === "absent") return "not on this platform";
  switch (cell.state) {
    case "live-current":
      return "live";
    case "live-stale":
      return "stale";
    case "live-no-shot":
      return "live, no shot yet";
    case "not-live":
      return cell.status === null ? "no status" : cellWord(cell).toLowerCase();
  }
}

/** Ends a phrase with a full stop unless it already ends a sentence ("…Has a streak?"). */
function sentence(text: string): string {
  return /[.?!]$/.test(text) ? text : `${text}.`;
}

/** "Check-in sheet. Web: stale. iOS: live. Android: not on this platform." (spec § Accessibility). */
function sideAriaLabel(data: WallFrameData): string {
  const subject = sentence(data.armContext ? `${data.screen.title}, ${data.armContext}` : data.screen.title);
  const rows = data.platforms.map(
    (platform) => `${PLATFORM_LABELS[platform]}: ${sideSpokenWord(data.screen.cells[platform])}.`,
  );
  return [subject, ...rows].join(" ");
}

/** The caption's state line side by side, in the strip header's grammar: "2/3 live · 1 stale". */
function sideStateLine(data: WallFrameData): string {
  let on = 0;
  let live = 0;
  let stale = 0;
  let noShot = 0;
  for (const platform of data.platforms) {
    const cell = data.screen.cells[platform];
    if (!cell || cell.state === "absent") continue;
    on += 1;
    if (cell.state === "live-current" || cell.state === "live-stale" || cell.state === "live-no-shot") live += 1;
    if (cell.state === "live-stale") stale += 1;
    if (cell.state === "live-no-shot") noShot += 1;
  }
  return `${live}/${on} live` + (stale > 0 ? ` · ${stale} stale` : "") + (noShot > 0 ? ` · ${noShot} without a shot` : "");
}

/**
 * The side-by-side box (spec § Layout): one row per platform of the scope —
 * platform tag, mini, one-word state. Rows share FRAME_H with SIDE_ROW_GAP
 * between them; the mini column is what the layout left between the tag and
 * the word, so the box is exactly `data.shotWidth` wide.
 */
function WallSideBox({ data }: { data: WallFrameData }) {
  const rows = Math.max(data.platforms.length, 1);
  const rowHeight = (FRAME_H - (rows - 1) * SIDE_ROW_GAP) / rows;
  const column = Math.max(data.shotWidth - SIDE_TAG_W - SIDE_TAG_GAP - SIDE_WORD_GAP - SIDE_WORD_W, 1);

  return (
    <div
      className="flex shrink-0 flex-col"
      style={{ width: data.shotWidth, height: FRAME_H, rowGap: SIDE_ROW_GAP }}
      data-side-box=""
    >
      {data.platforms.map((platform) => {
        const cell = data.screen.cells[platform];
        const word = cell ? cellWord(cell) : "Absent";
        const faded = data.dimmedRows.includes(platform);
        const PlatformIcon = PLATFORM_ICONS[platform];
        return (
          <div
            key={platform}
            className={cn(
              "flex items-center transition-opacity duration-200 motion-reduce:transition-none",
              faded && "opacity-35",
            )}
            style={{ height: rowHeight }}
            data-platform={platform}
            data-word={word}
            data-row-dimmed={faded ? "true" : "false"}
          >
            <span
              className="flex shrink-0 items-center justify-center text-muted-foreground"
              style={{ width: SIDE_TAG_W }}
              title={PLATFORM_LABELS[platform]}
            >
              <PlatformIcon aria-hidden className="size-3.5" />
            </span>
            <div
              className="flex shrink-0 items-center"
              style={{ width: column, height: rowHeight, marginLeft: SIDE_TAG_GAP }}
            >
              <WallMiniShot
                viewId={data.viewId}
                platform={platform}
                cell={cell}
                height={rowHeight}
                maxWidth={column}
                onAspect={data.onAspect}
              />
            </div>
            <span
              className={cn("truncate text-xs font-medium", sideWordClass(cell))}
              style={{ width: SIDE_WORD_W, marginLeft: SIDE_WORD_GAP }}
            >
              {word}
            </span>
          </div>
        );
      })}
    </div>
  );
}
```

`WallSideBox` reads `data.dimmedRows`, which Task 3 added and `ScreensCanvas` already fills.

- [ ] **Step 3: Use the side box, caption and label in the frame component**

Two edits inside part 2's `WallFrameNode` component (inside the Task 3 dim wrapper); nothing else in it changes:

1. **The box.** Find where part 2 renders the shot box for the lens platform (its `<WallShot … width={data.shotWidth} height={FRAME_H} … />` element, possibly inside a wrapper that centres it in the node). Part 2 narrows `data.lens` before indexing `data.screen.cells`; replace whatever it does for `"side"` so the box slot reads:

   ```tsx
   {data.lens === "side" ? <WallSideBox data={data} /> : PART_2_SINGLE_BOX}
   ```

   where `PART_2_SINGLE_BOX` is part 2's single-lens box element, moved here unchanged (with `data.lens` now narrowed to a platform). The side box renders at every zoom: if part 2 swaps the whole box for a tint below `LOD_ZOOM`, keep that swap for the single box only — the minis drop their images and glyphs themselves, and the rows and words stay in the DOM.

2. **The caption's state line and the `aria-label`.** Part 2 derives both from the lens cell. Make each a choice on `side`, with part 2's expression kept, verbatim, as the else-branch:

   ```tsx
   const side = data.lens === "side";
   const stateLine = side ? sideStateLine(data) : PART_2_STATE_LINE;
   const ariaLabel = side ? sideAriaLabel(data) : PART_2_ARIA_LABEL;
   ```

   `PART_2_STATE_LINE` / `PART_2_ARIA_LABEL` stand for part 2's existing expressions; keep part 2's variable names if they differ from `stateLine` / `ariaLabel`. If part 2 computes them in helpers that take the lens cell, call those helpers only in the else-branch.

For orientation, this is the shape the component was rehearsed in, after Tasks 3 and 4 (a stand-in for part 2's body; do not paste it over part 2's real body):

```tsx
export const WallFrameNode = memo(function WallFrameNode({ data }: NodeProps<Node<WallFrameData, "wallFrame">>) {
  const activate = () => data.onActivate(data.frameId, data.viewId, data.stripId);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); activate(); }
  };
  const side = data.lens === "side";
  const stateLine = side ? sideStateLine(data) : singleStateLine(data);
  const ariaLabel = side ? sideAriaLabel(data) : `${data.screen.title}. ${stateLine}`;
  return (
    <div className={wallDimClass(data.dimmed)} data-dimmed={data.dimmed ? "true" : "false"}>
      <div role="button" tabIndex={0} aria-label={ariaLabel} onClick={activate} onKeyDown={onKeyDown} className="flex h-full w-full flex-col items-center">
        {data.lens === "side" ? (
          <WallSideBox data={data} />
        ) : (
          <WallShot viewId={data.viewId} platform={data.lens} cell={data.screen.cells[data.lens]} width={data.shotWidth} height={FRAME_H} onAspect={data.onAspect} />
        )}
        <div className="mt-2 w-full text-xs">
          <p className="truncate font-medium">{data.screen.title}</p>
          <p className="truncate text-muted-foreground">{stateLine}</p>
        </div>
      </div>
    </div>
  );
});
```

- [ ] **Step 4: The header's counts line holds the side text**

Side by side, a header's line grows to `"Web 3/5 · iOS 4/5 · Android 2/4 · 1 stale · 2 without a shot"`. In part 2's `WallHeaderNode`, replace the element that renders `{data.countsLine}` with this one (keep part 2's text classes if they differ; `truncate`, `title` and `data-counts` are this part's):

```tsx
<p className="truncate text-xs text-muted-foreground" title={data.countsLine} data-counts="">
  {data.countsLine}
</p>
```

The text itself already follows the lens: part 2's builder passes `stripCountsLine(wall, strip, lens)`, and part 1 writes the per-platform form for `"side"`.

- [ ] **Step 5: Check, typecheck, lint, then commit**

Run:

```bash
node "$SCRATCH/check-part3.cjs" "$WT" "$SCRATCH/pebbles-shots.json"
npx tsc --noEmit
npx eslint components/graph/nodes/WallShot.tsx components/graph/nodes/WallFrameNode.tsx components/graph/nodes/WallHeaderNode.tsx
npm run generate && git status --porcelain
```

Expected: `11/12 part 3 checks pass` (`side aria label` and `side state line agrees with part 1's counts for every screen` now `ok`; only `announcement` still FAILs); no `tsc` output; no ESLint output; `git status --porcelain` lists only the three files above (no `lib/wobble/` or `app/wobble.generated.css` line — every lucide name used is already registered).

```bash
git add components/graph/nodes/WallShot.tsx components/graph/nodes/WallFrameNode.tsx components/graph/nodes/WallHeaderNode.tsx
git commit -m "feat(screens): side by side — every platform stacked in each frame"
```

---

### Task 5: The bar — Side by side, the gaps switch, I/W/A

**Files:**
- Modify: `components/maps/screens/ScreensBar.tsx`
- Modify: `components/maps/ScreensMap.tsx`
- Modify: `lib/utils/keyboard-shortcuts.ts`

Traps: `ScreensBarProps` gains required (3) fields, so the controller passes them in this commit; the keyboard source-reading suite; the overscroll wheel trap (nothing in the bar scrolls horizontally); lucide names (`Layers`, `CircleDashed` are registered).

- [ ] **Step 1: Replace `ScreensBar.tsx`**

Replace the file with the code below. One adaptation: keep part 2's positioning classes on the root `div` (absolute bottom-centre, its narrow-width gutters and container variants) if they differ from the ones written here; `flex items-center gap-1.5 rounded-xl bg-card p-1.5` and everything inside the root are this part's.

```tsx
"use client";

import { CircleDashedIcon, LayersIcon } from "lucide-react";
import type { PlatformId } from "@/lib/config/platforms";
import { cn } from "@/lib/utils";
import type { WallLens } from "@/lib/utils/screen-wall";
import { Button } from "@/components/ui/button";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { PLATFORM_ICONS, PLATFORM_LABELS } from "@/components/graph/nodes/node-styles";

export interface ScreensBarProps {
  /** `wall.platforms`: the lens options, in PLATFORMS order. */
  platforms: readonly PlatformId[];
  lens: WallLens;
  onLensChange: (lens: WallLens) => void;
  /** Visually hidden, `aria-live="polite"`: "Showing iOS. 4 gaps." */
  announcement: string;
  gapsOnly: boolean;
  /** `gapCount(wall, lens)`: distinct (view, lens platform) pairs live with a stale shot or none. */
  gapCount: number;
  onGapsOnlyChange: (next: boolean) => void;
}

const SIDE_BY_SIDE: SegmentedControlOption<WallLens> = { id: "side", label: "Side by side", icon: LayersIcon };

/**
 * The Screens map's one bar (spec § The bottom bar): the lens — one option
 * per platform of the scope, then "Side by side" — and the gaps switch with
 * its count. The lens is hidden when the scope has fewer than two platforms
 * (the arity rule); the gaps switch is always there. Nothing in it scrolls
 * horizontally (the overscroll wheel trap, app/globals.css).
 */
export function ScreensBar({
  platforms,
  lens,
  onLensChange,
  announcement,
  gapsOnly,
  gapCount,
  onGapsOnlyChange,
}: ScreensBarProps) {
  const lensOptions: SegmentedControlOption<WallLens>[] = [
    ...platforms.map((id) => ({ id, label: PLATFORM_LABELS[id], icon: PLATFORM_ICONS[id] })),
    SIDE_BY_SIDE,
  ];
  const gapsWord = `${gapCount} ${gapCount === 1 ? "gap" : "gaps"}`;

  return (
    <div
      role="toolbar"
      aria-label="Screens display"
      className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-xl bg-card p-1.5"
    >
      {platforms.length >= 2 && (
        <SegmentedControl<WallLens>
          options={lensOptions}
          value={lens}
          onChange={onLensChange}
          ariaLabel="Platform lens"
          collapseLabels
        />
      )}
      <Button
        type="button"
        variant={gapsOnly ? "secondary" : "ghost"}
        size="sm"
        aria-pressed={gapsOnly}
        aria-label={`Gaps only, ${gapsWord}`}
        onClick={() => onGapsOnlyChange(!gapsOnly)}
        className="cursor-pointer"
      >
        <CircleDashedIcon aria-hidden />
        <span>Gaps only</span>
        <span
          data-gap-count=""
          className={cn(
            "min-w-5 rounded-full px-1.5 text-center text-[11px] font-semibold tabular-nums",
            gapCount > 0 ? "bg-amber-500/10 text-amber-700 dark:text-amber-400" : "bg-muted text-muted-foreground",
          )}
        >
          {gapCount}
        </span>
      </Button>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
```

If part 2 gave the `SegmentedControl` an `ariaLabel` other than `"Platform lens"`, use `"Platform lens"` (the browser check finds the group by it).

- [ ] **Step 2: The controller — count, switch, announcement, keys, the bar always**

In `ScreensMap.tsx`, merge into the imports:

```ts
import { useCallback, useMemo } from "react";
import { usePlatformHotkeys } from "@/lib/hooks/usePlatformHotkeys";
import { platformLabel, type PlatformId } from "@/lib/config/platforms";
import { gapCount, resolveLens, type WallLens } from "@/lib/utils/screen-wall";
```

Add at module level:

```ts
const NO_PLATFORMS: readonly PlatformId[] = [];

/** The bar's live line: "Showing iOS. 4 gaps." / "Showing side by side, gaps only. 1 gap." */
function screensAnnouncement(lens: WallLens, gaps: number, gapsOnly: boolean): string {
  const shown = lens === "side" ? "side by side" : platformLabel(lens);
  return `Showing ${shown}${gapsOnly ? ", gaps only" : ""}. ${gaps} ${gaps === 1 ? "gap" : "gaps"}.`;
}
```

In the component, directly below `const gapsOnly = prefs.screensGapsOnly;` (Task 3), add:

```ts
  const gaps = useMemo(() => (wall ? gapCount(wall, lens) : 0), [wall, lens]);
  const setGapsOnly = useCallback((next: boolean) => updatePrefs({ screensGapsOnly: next }), [updatePrefs]);
  // I / W / A over the lens. "all" is side by side: pressing the platform shown goes side by side,
  // pressing a platform from side by side shows it (nextPlatformFilter's toggle).
  const lensChoices = wall?.platforms ?? NO_PLATFORMS;
  usePlatformHotkeys({
    enabled: wall !== null && wall.empty !== "nothing" && lensChoices.length >= 2,
    available: lensChoices.map((id) => ({ id })),
    current: lens === "side" ? "all" : lens,
    onSelect: (next) => setLens(next === "all" ? "side" : next),
  });
```

This block must run on every render, so it sits above the controller's first early return (the loading state). If part 2 derives `lens` or `setLens` below that return, move both derivations up with this block, computing `lens` as `wall ? resolveLens(prefs.screensLens, wall) : "web"` while `wall` is not there yet (the keys are disabled then). If part 2's `wall` is `undefined` rather than `null` while loading, write `wall != null` in `enabled` and keep `wall?.platforms`.

Replace part 2's bar element (and its `wall.platforms.length >= 2 &&` guard, if part 2 put the guard in the controller) with:

```tsx
      <ScreensBar
        platforms={wall.platforms}
        lens={lens}
        onLensChange={setLens}
        announcement={screensAnnouncement(lens, gaps, gapsOnly)}
        gapsOnly={gapsOnly}
        gapCount={gaps}
        onGapsOnlyChange={setGapsOnly}
      />
```

in the same place in the tree (the bar still renders only where part 2 renders the canvas, never in the `wall.empty === "nothing"` empty state). If part 2's `ScreensBar` itself returned `null` below two platforms, that early return is gone with Step 1's replacement.

- [ ] **Step 3: The filter rows name Screens**

In `lib/utils/keyboard-shortcuts.ts`, replace the three rows:

```ts
      { id: "filter-ios", description: "Filter to iOS — again for all platforms (Acceptances, Delivery, Screens)", keys: ["I"], hotkeys: ["I"], scope: "project" },
      { id: "filter-web", description: "Filter to Web — again for all platforms (Acceptances, Delivery, Screens)", keys: ["W"], hotkeys: ["W"], scope: "project" },
      { id: "filter-android", description: "Filter to Android — again for all platforms (Acceptances, Delivery, Screens)", keys: ["A"], hotkeys: ["A"], scope: "project" },
```

Ids, keys, hotkeys and scope are unchanged; `tests/app/keyboard-shortcuts.test.js` asserts no description (contract, Verified fact 11).

- [ ] **Step 4: Check, typecheck, lint, test, then commit**

Run:

```bash
node "$SCRATCH/check-part3.cjs" "$WT" "$SCRATCH/pebbles-shots.json"
npx tsc --noEmit
npx eslint components/maps lib/utils/keyboard-shortcuts.ts
npm run test:keyboard-shortcuts
npm run generate && git status --porcelain
```

Expected: `12/12 part 3 checks pass`, exit 0; no `tsc` output; no ESLint output; `All keyboard shortcut tests passed`; `git status --porcelain` lists only the three files above.

```bash
git add components/maps/screens/ScreensBar.tsx components/maps/ScreensMap.tsx lib/utils/keyboard-shortcuts.ts
git commit -m "feat(screens): the side-by-side lens, the gaps switch and I/W/A in the bar"
```

---

### Task 6: Checks without a browser

**Files:** none changed (if `npm run generate` rewrites anything, commit it as Step 3 says).

- [ ] **Step 1: The part's gates**

Run, from `$WT`, each on its own:

```bash
npm run lint
npx tsc --noEmit
npm run test:screen-wall
npm run test:keyboard-shortcuts
node "$SCRATCH/check-part3.cjs" "$WT" "$SCRATCH/pebbles-shots.json"
grep -rlE "useDisplayPreferences|ScreensCanvas|WallFrameNode|ScreensBar" tests
```

Expected: `npm run lint` reports 0 errors (the warnings it already reports on `main` stay; this part adds none); no `tsc` output; part 1's suite passes unchanged; `All keyboard shortcut tests passed`; `12/12 part 3 checks pass`; the `grep` prints nothing (no test loader reads a file this part changed, so no alias table needs an entry).

- [ ] **Step 2: Generated artifacts**

Run: `npm run generate && git status --porcelain`
Expected: no output. If a wobble file changed, a lucide name outside the registry slipped in: compare with Decision 6; if the import is wanted, commit the regenerated `lib/wobble/wobble-registry.generated.ts` and `app/wobble.generated.css` with message `chore(screens): regenerate the icon registry`.

- [ ] **Step 3: The production build**

Run: `npm run build`
Expected: the build completes (CI typechecks through it).

---

### Task 7: Manual browser verification (headless, not CI)

**Files:**
- Create: `$SCRATCH/verify-part3.cjs` (outside the repo)

Traps: a stale dev server fakes hydration mismatches — restart it after any branch switch; port 4242 may belong to the other checkout.

- [ ] **Step 1: Playwright in the scratch directory**

```bash
cd "$SCRATCH"
npm init -y >/dev/null
npm i playwright
npx playwright install chromium
```

- [ ] **Step 2: Start this worktree's dev server on a free port**

```bash
lsof -nP -iTCP:4343 -sTCP:LISTEN
```

Expected: no output (the port is free; otherwise choose another port and pass it as `BASE_URL=http://localhost:<port>` in Step 4). Then, in the background, from the worktree on `feat/screens-side-gaps`:

```bash
cd "$WT" && PORT=4343 npm run dev
```

Wait for `Ready` in its output.

- [ ] **Step 3: Write the browser script**

Create `$SCRATCH/verify-part3.cjs`:

```js
#!/usr/bin/env node
"use strict";

/**
 * Screens map part 3, checked in a real browser: side by side, gaps only, I/W/A,
 * and memory across a reload. Run by hand against `PORT=4343 npm run dev` in the
 * worktree; not a CI test.
 *
 * Usage: node verify-part3.cjs <pebbles-shots.json> <seed/arkaik-self-map.json>
 * Env:   BASE_URL (default http://localhost:4343)
 */

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const [, , shotsBundle, selfMapSeed] = process.argv;
if (!shotsBundle || !selfMapSeed) {
  console.error("usage: node verify-part3.cjs <pebbles-shots.json> <seed/arkaik-self-map.json>");
  process.exit(2);
}
const BASE = process.env.BASE_URL ?? "http://localhost:4343";
const OUT = path.join(process.cwd(), "shots-part3");
fs.mkdirSync(OUT, { recursive: true });

// --- What the prepared Pebbles bundle must show (prepare-bundle.cjs, All products) ---
const FRAMES = 61;
const MARKERS = 17;
const STRIPS = 11;
const GAPS = { web: 2, ios: 5, android: 3, side: 10 };
const KEPT = {
  web: ["V-quick-pebble-editor", "V-soul-create"],
  ios: ["V-pebble-detail", "V-quick-pebble-editor", "V-soul-create", "V-soul-detail", "V-soul-edit"],
  android: ["V-quick-pebble-editor", "V-soul-create", "V-soul-edit"],
  side: ["V-pebble-detail", "V-quick-pebble-editor", "V-soul-create", "V-soul-detail", "V-soul-edit"],
};
const KEPT_STRIPS = { side: ["strip:F-manage-souls", "strip:F-record-pebble"] };
const SIDE_WORDS = {
  "V-souls-list": { web: "Live", ios: "Live", android: "Live" },
  "V-soul-detail": { web: "Live", ios: "Stale", android: "Live" },
  "V-soul-create": { web: "No shot", ios: "No shot", android: "No shot" },
  "V-soul-edit": { web: "Live", ios: "No shot", android: "No shot" },
  "V-pebble-detail": { web: "Backlog", ios: "No shot", android: "Development" },
  "V-onboarding-intro": { web: "Absent", ios: "Development", android: "Absent" },
};
const FADED_ROWS = {
  "V-soul-detail": ["android", "web"],
  "V-pebble-detail": ["android", "web"],
  "V-soul-edit": ["web"],
  "V-soul-create": [],
  "V-quick-pebble-editor": [],
};
const SHOTS_IN_SIDE = { "V-souls-list": 3, "V-soul-detail": 3, "V-soul-edit": 1 };
const LENS_LABEL = { web: "Web", ios: "iOS", android: "Android", side: "Side by side" };

// --- Bookkeeping ---
let checks = 0;
const failures = [];
function check(ok, message) {
  checks += 1;
  if (ok) {
    console.log(`ok   ${message}`);
  } else {
    failures.push(message);
    console.log(`FAIL ${message}`);
  }
}
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

// --- Page helpers ---
async function importBundle(page, file) {
  await page.goto(`${BASE}/projects`, { waitUntil: "domcontentloaded", timeout: 180_000 });
  await page.locator('input[type="file"][accept="application/json,.json"]').setInputFiles(file);
  await page.waitForURL(/\/project\/[^/?#]+/, { timeout: 180_000 });
  return decodeURIComponent(/\/project\/([^/?#]+)/.exec(page.url())[1]);
}

async function openScreens(page, projectId) {
  await page.goto(`${BASE}/project/${encodeURIComponent(projectId)}/maps/screens`, {
    waitUntil: "domcontentloaded",
    timeout: 180_000,
  });
  await page.locator('[role="toolbar"][aria-label="Screens display"]').waitFor({ timeout: 180_000 });
  await page.locator(".react-flow__node-wallFrame").first().waitFor({ timeout: 60_000 });
}

/** Fit the whole wall (every node mounts under onlyRenderVisibleElements), then wait for the frame count to settle. */
async function fitAll(page) {
  await page.locator(".react-flow__controls-fitview").click();
  let last = -1;
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(150);
    const count = await page.locator(".react-flow__node-wallFrame").count();
    if (count === last) return count;
    last = count;
  }
  return last;
}

async function zoom(page) {
  return page.evaluate(() => {
    const transform = getComputedStyle(document.querySelector(".react-flow__viewport")).transform;
    const match = /matrix\(([^)]+)\)/.exec(transform);
    return match ? Number(match[1].split(",")[0]) : 1;
  });
}

/** Wheel-zoom around a node until the canvas zoom reaches `target` (above LOD_ZOOM, so shots load). */
async function zoomInto(page, selector, target) {
  for (let step = 0; step < 40; step++) {
    if ((await zoom(page)) >= target) break;
    const box = await page.locator(selector).first().boundingBox();
    if (!box) throw new Error(`${selector} is not on screen`);
    await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, 30));
    await page.mouse.wheel(0, -200);
    await page.waitForTimeout(80);
  }
  await page.waitForTimeout(400);
  return zoom(page);
}

const lensButton = (page, lens) =>
  page.locator(`[role="group"][aria-label="Platform lens"] button[aria-label="${LENS_LABEL[lens]}"]`);
const gapsButton = (page) => page.locator('[role="toolbar"][aria-label="Screens display"] button[aria-pressed]').filter({ hasText: "Gaps only" });
const gapCount = async (page) => Number((await page.locator("[data-gap-count]").textContent()).trim());
const announcement = async (page) =>
  (await page.locator('[role="toolbar"][aria-label="Screens display"] [aria-live="polite"]').textContent()).trim();

async function frames(page) {
  return page.$$eval(".react-flow__node-wallFrame", (nodes) =>
    nodes.map((node) => {
      const id = node.getAttribute("data-id");
      const dim = node.querySelector("[data-dimmed]");
      return {
        id,
        viewId: id.split("@")[0],
        width: node.style.width,
        dimmed: dim ? dim.getAttribute("data-dimmed") === "true" : null,
        rows: [...node.querySelectorAll("[data-word]")].map((row) => ({
          platform: row.getAttribute("data-platform"),
          word: row.getAttribute("data-word"),
          faded: row.getAttribute("data-row-dimmed") === "true",
        })),
        shots: node.querySelectorAll("img[data-wall-shot]").length,
      };
    }),
  );
}

async function headers(page) {
  return page.$$eval(".react-flow__node-wallHeader", (nodes) =>
    nodes.map((node) => {
      const dim = node.querySelector("[data-dimmed]");
      const counts = node.querySelector("[data-counts]");
      return {
        id: node.getAttribute("data-id"),
        dimmed: dim ? dim.getAttribute("data-dimmed") === "true" : null,
        counts: counts ? counts.textContent.trim() : null,
      };
    }),
  );
}

async function markers(page) {
  return page.$$eval(".react-flow__node-wallMarker", (nodes) =>
    nodes.map((node) => {
      const dim = node.querySelector("[data-dimmed]");
      return dim ? dim.getAttribute("data-dimmed") === "true" : null;
    }),
  );
}

const byView = (list, viewId) => list.find((frame) => frame.viewId === viewId);

async function expectLens(page, lens, gapsOnly) {
  await page.waitForTimeout(150);
  check((await lensButton(page, lens).getAttribute("aria-pressed")) === "true", `lens ${LENS_LABEL[lens]} is pressed`);
  check((await gapCount(page)) === GAPS[lens], `gap count on ${LENS_LABEL[lens]} is ${GAPS[lens]}`);
  const shown = lens === "side" ? "side by side" : LENS_LABEL[lens];
  const expected = `Showing ${shown}${gapsOnly ? ", gaps only" : ""}. ${GAPS[lens]} gaps.`;
  const said = await announcement(page);
  check(said === expected, `announcement reads "${expected}" (got "${said}")`);
}

async function expectKept(page, lens) {
  await fitAll(page);
  const list = await frames(page);
  const lit = list.filter((frame) => frame.dimmed === false).map((frame) => frame.viewId);
  check(same(lit, KEPT[lens]), `gaps only on ${LENS_LABEL[lens]} keeps ${KEPT[lens].join(", ")} (got ${lit.join(", ")})`);
  check(
    list.filter((frame) => frame.dimmed === true).length === FRAMES - KEPT[lens].length,
    `gaps only on ${LENS_LABEL[lens]} fades the other ${FRAMES - KEPT[lens].length} frames`,
  );
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));

  // 1. Pebbles with shots, single lens first.
  const projectId = await importBundle(page, shotsBundle);
  console.log(`imported Pebbles (shots) as ${projectId}`);
  await openScreens(page, projectId);
  check(await lensButton(page, "side").isVisible(), 'the lens offers "Side by side"');
  check((await gapsButton(page).getAttribute("aria-pressed")) === "false", "Gaps only starts off");
  await expectLens(page, "web", false);

  let count = await fitAll(page);
  check(count === FRAMES, `fit view mounts all ${FRAMES} frames (got ${count})`);
  let list = await frames(page);
  check(list.every((frame) => frame.dimmed === false), "with Gaps only off, no frame is faded");
  check(byView(list, "V-landing")?.width === "448px", `a web ghost frame is 448px wide (got ${byView(list, "V-landing")?.width})`);
  let souls = (await headers(page)).find((header) => header.id === "strip:F-manage-souls");
  check(
    /^\d+\/4 live on Web · 1 without a shot$/.test(souls?.counts ?? ""),
    `Manage souls header on Web: "${souls?.counts}"`,
  );

  // 2. Side by side.
  await lensButton(page, "side").click();
  await page.waitForFunction(
    () => document.querySelector('.react-flow__node-wallFrame[data-id^="V-landing@"]')?.style.width === "257px",
    null,
    { timeout: 10_000 },
  );
  await expectLens(page, "side", false);
  count = await fitAll(page);
  list = await frames(page);
  check(byView(list, "V-landing")?.width === "257px", "a three-platform side frame is 257px wide");
  check(list.every((frame) => frame.rows.length === 3), "every side frame has one row per platform (3)");
  for (const [viewId, words] of Object.entries(SIDE_WORDS)) {
    const frame = byView(list, viewId);
    const got = Object.fromEntries((frame?.rows ?? []).map((row) => [row.platform, row.word]));
    check(JSON.stringify(got) === JSON.stringify(words), `${viewId} side words ${JSON.stringify(got)}`);
  }
  souls = (await headers(page)).find((header) => header.id === "strip:F-manage-souls");
  check(
    /^Web \d+\/4 · iOS \d+\/4 · Android \d+\/4 · 1 stale · 5 without a shot$/.test(souls?.counts ?? ""),
    `Manage souls header side by side: "${souls?.counts}"`,
  );
  await page.screenshot({ path: path.join(OUT, "side-fit-light.png") });

  // 3. Gaps only, side by side.
  await gapsButton(page).click();
  check((await gapsButton(page).getAttribute("aria-pressed")) === "true", "Gaps only is pressed");
  await expectLens(page, "side", true);
  await expectKept(page, "side");
  list = await frames(page);
  for (const [viewId, faded] of Object.entries(FADED_ROWS)) {
    const got = (byView(list, viewId)?.rows ?? []).filter((row) => row.faded).map((row) => row.platform);
    check(same(got, faded), `${viewId} fades rows [${faded.join(", ")}] (got [${got.join(", ")}])`);
  }
  check(
    list.filter((frame) => frame.dimmed === true).every((frame) => frame.rows.every((row) => !row.faded)),
    "a faded frame does not also fade its rows",
  );
  const markerDims = await markers(page);
  check(markerDims.length === MARKERS && markerDims.every(Boolean), `all ${MARKERS} markers fade (${markerDims.length} found)`);
  const headerList = await headers(page);
  const litStrips = headerList.filter((header) => header.dimmed === false).map((header) => header.id);
  check(headerList.length === STRIPS, `${STRIPS} strip headers (got ${headerList.length})`);
  check(same(litStrips, KEPT_STRIPS.side), `only strips holding a gap keep their header lit (got ${litStrips.join(", ")})`);

  // Readable zoom on Manage souls: shots load in the minis.
  const reached = await zoomInto(page, '.react-flow__node[data-id="strip:F-manage-souls"]', 0.8);
  check(reached >= 0.8, `zoomed to ${reached.toFixed(2)} on Manage souls`);
  await page.waitForTimeout(800);
  list = await frames(page);
  for (const [viewId, shots] of Object.entries(SHOTS_IN_SIDE)) {
    check(byView(list, viewId)?.shots === shots, `${viewId} shows ${shots} shot(s) side by side (got ${byView(list, viewId)?.shots})`);
  }
  await page.screenshot({ path: path.join(OUT, "side-gaps-light.png") });

  // A faded frame is still clickable: the hit test at its centre lands inside it.
  const fadedId = byView(list, "V-souls-list")?.id ?? "";
  const hit = await page.evaluate((id) => {
    const node = document.querySelector(`.react-flow__node[data-id="${CSS.escape(id)}"]`);
    if (!node) return false;
    const box = node.getBoundingClientRect();
    const target = document.elementFromPoint(box.x + box.width / 2, box.y + Math.min(box.height / 2, 20));
    return Boolean(target && node.contains(target));
  }, fadedId);
  check(hit, "a faded frame still receives the pointer");

  // 4. I / W / A drive the lens (Gaps only stays on).
  await page.keyboard.press("w");
  await expectLens(page, "web", true);
  await expectKept(page, "web");
  await page.keyboard.press("i");
  await expectLens(page, "ios", true);
  await expectKept(page, "ios");
  await page.keyboard.press("i");
  await expectLens(page, "side", true);
  await page.keyboard.press("a");
  await expectLens(page, "android", true);
  await expectKept(page, "android");
  await page.keyboard.press("w");
  await expectLens(page, "web", true);

  // 5. Both choices survive a reload.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator('[role="toolbar"][aria-label="Screens display"]').waitFor({ timeout: 60_000 });
  await expectLens(page, "web", true);
  check((await gapsButton(page).getAttribute("aria-pressed")) === "true", "Gaps only survives a reload");
  const stored = await page.evaluate((id) => localStorage.getItem(`arkaik:display-prefs:${id}`), projectId);
  const parsed = JSON.parse(stored ?? "{}");
  check(parsed.screensLens === "web" && parsed.screensGapsOnly === true, `stored prefs ${stored}`);
  await lensButton(page, "side").click();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator('[role="toolbar"][aria-label="Screens display"]').waitFor({ timeout: 60_000 });
  await expectLens(page, "side", true);

  // 6. Dark theme, then narrower windows.
  await page.emulateMedia({ colorScheme: "dark" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".react-flow__node-wallFrame").first().waitFor({ timeout: 60_000 });
  await fitAll(page);
  await zoomInto(page, '.react-flow__node[data-id="strip:F-manage-souls"]', 0.8);
  await page.screenshot({ path: path.join(OUT, "side-gaps-dark.png") });
  await page.emulateMedia({ colorScheme: "light" });
  for (const width of [900, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.waitForTimeout(600);
    const bar = await page.locator('[role="toolbar"][aria-label="Screens display"]').boundingBox();
    check(bar !== null && bar.x >= 0 && bar.x + bar.width <= width, `the bar fits a ${width}px window`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(overflow <= 0, `no horizontal page scroll at ${width}px (overflow ${overflow})`);
    await page.screenshot({ path: path.join(OUT, `side-gaps-${width}-light.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 900 });

  // 7. A single-platform project: the gaps switch alone, and I/W/A do nothing.
  const selfMapId = await importBundle(page, selfMapSeed);
  console.log(`imported the self-map as ${selfMapId}`);
  await openScreens(page, selfMapId);
  check((await page.locator('[role="group"][aria-label="Platform lens"]').count()) === 0, "a web-only scope shows no lens control");
  check(await gapsButton(page).isVisible(), "a web-only scope still shows Gaps only");
  const before = await gapCount(page);
  check(Number.isInteger(before) && before >= 0, `the self-map counts ${before} gap(s)`);
  await page.keyboard.press("i");
  check(
    (await page.locator('[role="group"][aria-label="Platform lens"]').count()) === 0 && (await gapCount(page)) === before,
    "I does nothing on a web-only scope",
  );
  await page.screenshot({ path: path.join(OUT, "selfmap-light.png") });

  check(errors.length === 0, `no console errors (${errors.length})`);
  for (const error of errors) console.log(`     console: ${error.split("\n")[0]}`);

  await browser.close();
  if (failures.length > 0) {
    console.log(`\nPART 3 BROWSER CHECK: FAIL — ${failures.length} of ${checks} checks failed`);
    process.exit(1);
  }
  console.log(`\nPART 3 BROWSER CHECK: PASS — ${checks} checks, screenshots in ${OUT}`);
}

main().catch((error) => {
  console.error(error);
  console.log("\nPART 3 BROWSER CHECK: FAIL — the script stopped early");
  process.exit(1);
});
```

What it asserts, against the contract's test strategy for part 3: side rows and their words (six frames, every row, absent rows included) and the side frame width; the strip header's counts on a single lens and side by side; the gaps switch's count on every lens, its fading of frames (exact kept sets), of rows inside kept side frames, of markers and of headers, and that a faded frame still takes the pointer; I/W/A driving the lens with the contract's toggle (W → Web, I → iOS, I again → side by side, A → Android); both choices in `localStorage["arkaik:display-prefs:<id>"]` and on screen after a reload; light and dark at 1440×900, then 900 and 390 wide (the bar fits, no horizontal page scroll); a web-only scope showing the gaps switch alone with I inert; no console errors.

- [ ] **Step 4: Run it**

```bash
cd "$SCRATCH"
node verify-part3.cjs "$SCRATCH/pebbles-shots.json" "$WT/seed/arkaik-self-map.json"
```

Expected: two `imported …` lines, 79 lines starting `ok`, no line starting `FAIL`, and as the last line exactly:

```
PART 3 BROWSER CHECK: PASS — 79 checks, screenshots in <SCRATCH>/shots-part3
```

(`<SCRATCH>` is the absolute scratch path.) Each run imports two new copies of the projects into a fresh browser profile; nothing persists between runs.

If the only failures are `no console errors` with lines that are not about the map (an auth or network fetch with no database configured), open `/project/<id>/maps/journey` on `main`'s dev server with the same import to confirm they pre-exist, and say so in the PR. A hydration warning: restart the dev server, then run again before believing it.

- [ ] **Step 5: Look at the screenshots**

In `$SCRATCH/shots-part3/`: `side-fit-light.png` (the whole wall side by side: three rows per frame), `side-gaps-light.png` and `side-gaps-dark.png` (Manage souls readable: Souls list faded with three green shots; Soul detail lit with an amber-ringed iOS mini and the word "Stale", its web and Android rows at 35%; Soul create and Soul edit lit with dashed amber "No shot" minis), `side-gaps-900-light.png`, `side-gaps-390-light.png` (the bar within the window, the lens collapsed to icons below `md`), `selfmap-light.png` (the gaps switch alone). Check by eye: words are legible in both themes, the amber ring and dashed borders read without colour (word + glyph), nothing is clipped in the bar.

---

## Part done when

- These pass on `feat/screens-side-gaps`, alone, from `$WT`:

  ```bash
  npm run lint
  npx tsc --noEmit
  npm run generate && git status --porcelain     # no output
  npm run test:screen-wall
  npm run test:keyboard-shortcuts
  npm run build
  node "$SCRATCH/check-part3.cjs" "$WT" "$SCRATCH/pebbles-shots.json"   # 12/12 part 3 checks pass
  ```

- Task 7's script prints `PART 3 BROWSER CHECK: PASS — 79 checks, screenshots in <SCRATCH>/shots-part3`, and the screenshots read as Task 7, Step 5 says.
- PR (opened with the `gh-stack` skill on top of part 2), title: `feat(screens): side by side and gaps only (part 3/5)`. Body: what changed (one paragraph), the browser check's last line, then:

  ````markdown
  ## Lab Note

  ```yaml
  en:
    title: "All platforms side by side, and just the gaps"
    summary: "Stack web, iOS and Android inside every frame, or switch on Gaps only to fade everything but stale shots and live screens nobody has captured yet."
  fr:
    title: "Toutes les plateformes côte à côte, et rien que les trous"
    summary: "Empile web, iOS et Android dans chaque cadre, ou active « Gaps only » pour ne garder que les captures périmées et les écrans en ligne encore sans capture."
  nodes: [F-adjust-map-display, V-maps-index]
  suggested:
    molecule: arkaik
    type: improvement
    tags: [maps, screenshots]
  ```
  ````

  After opening the PR, read its comments for the Lab Note reminder's verdict; fix the body, not the code.
