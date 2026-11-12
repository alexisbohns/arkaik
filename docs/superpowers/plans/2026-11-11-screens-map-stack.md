# Screens map — stack contract

**Spec:** `docs/superpowers/specs/2026-11-11-screens-map-design.md` (decided; its five open questions are settled on their defaults).
**Base:** `main` at `2f697cd`. **Stack:** five parts, one branch and one PR each, chained with `gh stack` (`docs/conventions.md` § Shipping larger work).

This document fixes what more than one part shares: names, files, signatures, data shapes, tests and the order things land in. Each part's plan is written against it. Where this contract and the spec differ, this contract wins and § Verified facts says why. A plan that needs to change a name below changes it here first, in the part that owns it.

## Parts

| # | Branch | Goal | Must NOT touch |
|---|---|---|---|
| 1 | `feat/screens-model` | Pure wall model + layout, and the shared staleness rule that counts covering acceptances. Not user-visible. | `packages/**`, generated artifacts, any component, `Canvas.tsx`, the palette, `NodeDetailPanel.tsx`, `AcceptancePlatformsSection.tsx` |
| 2 | `feat/screens-map` | The `screens` kind and built-in map with its renderer (canvas, frames, headers, markers, jump tiles, single-platform lens, bottom bar), the `map-screens` palette command, and the node panel adopting the new staleness rule. | Journey map/canvas/graph builder, `PlatformVariants.tsx`, `ViewNode.tsx`, `FlowNode.tsx`, `MapEditorDialog.tsx`, panel descriptor kinds, `components/ui/**` |
| 3 | `feat/screens-side-gaps` | "Side by side" lens, per-platform header counts, the gaps switch with its count and fading, I/W/A on the lens. | selection, inspector, chips, the palette, `packages/**` |
| 4 | `feat/screens-inspect` | Selection, quick inspector, touch chips and edges, Escape, arrow navigation, `wall-move` row, `?node=` cold-load framing. | `lib/utils/panel-stack.ts`, the panel descriptor union, the palette, `packages/**` |
| 5 | `feat/screens-palette` | Views and flows as search-only rows in ⌘K; a page node handler; the Screens map flies to them. | the wall model (`lib/utils/screen-wall*.ts`), `Canvas.tsx`, `packages/**` |

**The cut holds.** Checked against the code: each part compiles and ships a whole surface without the parts above it (part 1 adds nothing the app imports; part 2 lands the kind, built-in entry and renderer together, as spec F1 requires). Two adjustments, no boundary moves:

- Part 1 also exports the small pure helpers later parts would otherwise add to the model (`stalenessRelatedIds`, `stripIdOf`, `LOOSE_STRIP_ID`, `frameIdsOf`, `lensPlatforms`, `cellWord`, `stripCountsLine`, `clampAspect`, `sideGeometry`, `WallBox.shotWidth`), so parts 2–5 never edit `screen-wall*.ts`.
- Part 2's stored-lens reader accepts platform ids only; part 3 widens it to `"side"`, so part 2 can never render a lens it cannot draw.

## Shared names and signatures

### Part 1 — `lib/utils/screenshot-staleness.ts` (modified)

Imports stay `@arkaik/schema` only (types, plus `resolvePlatformStatus` at runtime). No `@/` import, or `tests/app/load-screenshot-staleness.js` (which rewrites only `@arkaik/schema`) breaks.

```ts
/** Moved from useScreenshotStaleness.ts:11, exported; the hook imports it. Same value, still a module constant. */
export const STALENESS_EVENT_TYPES = ["node.status_changed", "ref.status_changed", "deliverable.shipped"] as const;

/** The events that make the shot stale, newest first (ts descending, then id descending). */
export function staleReasons(
  meta: PlatformScreenshotMeta | undefined, events: readonly JournalEvent[],
  nodeId: string, platform: PlatformId, relatedIds?: readonly string[],
): JournalEvent[];

/** SIGNATURE CHANGE: a 5th optional parameter. = staleReasons(...).length > 0.
 *  relatedIds omitted or empty → exactly today's behaviour. */
export function isScreenshotStale(
  meta: PlatformScreenshotMeta | undefined, events: readonly JournalEvent[],
  nodeId: string, platform: PlatformId, relatedIds?: readonly string[],
): boolean;

/** The covering acceptances that speak to `platform`: resolvePlatformStatus(ac, platform) !== undefined, in input order.
 *  Callers get `covering` from @arkaik/schema's acceptancesCovering (or an index built the same way). */
export function stalenessRelatedIds(
  covering: readonly Pick<Node, "id" | "status" | "platforms" | "metadata">[], platform: PlatformId,
): string[];
```

A related id counts under the same three rules as the node itself: `node.status_changed` on `platform` or with no platform; `ref.status_changed` to `merged`; `deliverable.shipped` whose `node_ids` include it and whose `platform` is absent or equal.

**Callers.** `isScreenshotStale` has one runtime caller, `lib/hooks/useScreenshotStaleness.ts:34`; nothing changes there in part 1 (the parameter is optional). The hook has two callers: `components/panels/NodeDetailPanel.tsx:465` (changed in part 2, below) and `components/panels/AcceptancePlatformsSection.tsx:38` (never changed: an acceptance is its own subject). Part 1 edits the hook only to import the moved constant.

### Part 2 — the panel's adoption (`lib/hooks/useScreenshotStaleness.ts`, `components/panels/NodeDetailPanel.tsx`)

```ts
export function useScreenshotStaleness(
  nodeId: string, platforms: readonly PlatformId[], screenshotMeta: PlatformScreenshotMetaMap,
  relatedIds?: Partial<Record<PlatformId, readonly string[]>>,   // new, per platform; passed to isScreenshotStale
): Partial<Record<PlatformId, boolean>>;
```

`NodeDetailPanel` computes with `useMemo` (deps `node.id`, `node.species`, `scope.platforms`, `allNodes`, `allEdges`): for a view with both `allNodes` and `allEdges`, `{ [p]: stalenessRelatedIds(acceptancesCovering(node.id, allNodes, allEdges), p) }` for each `p` in `scope.platforms`; otherwise `undefined`. It passes that to `PlatformVariantsSection` through a new optional prop `staleRelatedIds?: Partial<Record<PlatformId, readonly string[]>>`, which hands it to the hook. The `<PlatformVariants …>` element's props (`:529`) are not touched.

### Part 1 — `lib/utils/screen-wall.ts` (new)

Types exactly as the spec writes them (§ The wall model › Input, Output, Counts and gaps): `WallInput`, `WallLens`, `ShotState`, `ShotForm`, `WallShot`, `StaleReason`, `LiveProof`, `PlatformCell`, `WallTouch`, `WallScreen`, `WallItem`, `WallStrip`, `Wall`, `StripCounts`. Allowed imports: `@arkaik/schema`, `@/lib/config/platforms`, `@/lib/config/statuses`, `@/lib/data/types` (types), `@/lib/utils/graph-build`, `@/lib/utils/platform-status`, `@/lib/utils/product-scope`, `@/lib/utils/journey-graph`, `@/lib/utils/screenshot-staleness`. Nothing from `components/`, no React, no `lucide-react` (so not `STATUS_LABELS`: use the `STATUSES` and `PLATFORMS` labels).

```ts
export function buildWall(input: WallInput): Wall;

export const LOOSE_STRIP_ID = "loose-strip";            // outside `strip:<flowId>`: a flow id `loose` keeps its own strip
export function stripIdOf(flowId: string): string;                 // `strip:${flowId}`
/** Every frame id showing the view, strip order then item order; [] if none. */
export function frameIdsOf(wall: Wall, viewId: string): string[];
/** [lens] for a platform lens; wall.platforms for "side". */
export function lensPlatforms(wall: Wall, lens: WallLens): PlatformId[];

export function countStrip(wall: Wall, strip: WallStrip, lens: WallLens): StripCounts;
export function isGapCell(cell: PlatformCell): boolean;            // live-stale | live-no-shot
export function isGapFrame(wall: Wall, viewId: string, lens: WallLens): boolean;
export function gapCount(wall: Wall, lens: WallLens): number;      // distinct (view, lens platform) pairs
export function resolveLens(stored: WallLens | null, wall: Wall): WallLens;

/** The truth table's side-by-side word: "Live" | "Stale" | "No shot" | "Unset" | "Absent" | a status label. */
export function cellWord(cell: PlatformCell): string;
/** R9 header text: "3/5 live on iOS · 1 stale · 2 without a shot", or "Web 3/5 · iOS 4/5 · …" for "side". */
export function stripCountsLine(wall: Wall, strip: WallStrip, lens: WallLens): string;
```

Ids (spec § Output): frame `createVisualNodeId(viewId, "<flowId>:<path>")`, loose frame `<viewId>@loose`, `arm:<flowId>:<path>.<armIndex>`, `end:<flowId>:<path>`, `jump:<flowId>:<path>`, `empty:<flowId>`; strips `strip:<flowId>` / `loose-strip` (`LOOSE_STRIP_ID`; every user goes through the constant). **A strip header's box id and React Flow node id is the strip id.** `StaleReason.label` is built in the model from ids, `STATUSES`/`PLATFORMS` labels and a shipped event's own `title`; the model never formats a date.

### Part 1 — `lib/utils/screen-wall-layout.ts` (new)

```ts
export type { Rect } from "@/lib/utils/journey-layout";   // one Rect in the repo: { x, y, width, height }
export type WallBoxKind = "header" | "frame" | "arm" | "end" | "jump" | "empty";
export interface WallBox extends Rect {
  id: string; kind: WallBoxKind; stripId: string; row: number;
  /** Frames only: the shot box width (≤ width, centred in it); null for every other kind. */
  shotWidth: number | null;
}
export interface WallLayout { boxes: WallBox[]; strips: ReadonlyMap<string, Rect>; bounds: Rect }
export type AspectOf = (viewId: string, platform: PlatformId) => number | undefined;

export function layoutWall(wall: Wall, lens: WallLens, aspectOf: AspectOf): WallLayout;
export function clampAspect(aspect: number): number;              // into [ASPECT_MIN, ASPECT_MAX]
/** Side-by-side geometry of one frame, n = wall.platforms.length (spec § Layout). */
export function sideGeometry(wall: Wall, viewId: string, aspectOf: AspectOf):
  { rowHeight: number; miniWidths: Partial<Record<PlatformId, number>>; shotWidth: number };
export function frameViewport(rect: Rect, viewport: { width: number; height: number },
  options: { padding: number; bottomInset: number; minZoom: number; maxZoom: number }): { x: number; y: number; zoom: number };
/** The map's first viewport: the first strip's header at the top-left of the canvas less `insets`, 32px in,
 *  at the zoom that fits the strip's full width, clamped to [0.7, 1]; wider at 0.7 → left-aligned, overflowing
 *  right. Height never sets the zoom. No strip → { x: 0, y: 0, zoom: 1 }. */
export function openingViewport(layout: WallLayout, viewport: { width: number; height: number },
  insets?: { top?: number; right?: number; bottom?: number; left?: number }): { x: number; y: number; zoom: number };
/** The strip whose rect is nearest the viewport's vertical centre (0 inside; ties → first); null with no strip. */
export function stripNearViewport(layout: WallLayout, viewport: { x: number; y: number; zoom: number },
  size: { width: number; height: number }): string | null;
/** After a lens change: if the viewport's horizontal centre is outside `stripId`'s extent in `layout`, the same zoom
 *  and y, panned so the strip's start sits `padding` in from the left; else (or no such strip) null. */
export function keepStripViewport(layout: WallLayout, stripId: string, viewport: { x: number; y: number; zoom: number },
  size: { width: number; height: number }, padding: number): { x: number; y: number; zoom: number } | null;
export function neighbourFrame(layout: WallLayout, frameId: string, dir: "left" | "right" | "up" | "down"): string | null;
export function chipRects(frame: WallBox, count: number): Rect[];
```

Constants, all exported, values and meanings as the spec's table: `FRAME_H` 280, `CAPTION_GAP` 8, `CAPTION_H` 36, `FRAME_NODE_H` 324, `FRAME_MIN_W` 144, `DEFAULT_ASPECT: Record<PlatformId, number>` = `{ web: 1.6, ios: 0.4615, android: 0.45 }`, `ASPECT_MIN` 0.3, `ASPECT_MAX` 2.4, `ITEM_GAP` 24, `ARM_W` 24, `END_W` 12, `JUMP_W` 144, `JUMP_H` 96, `JUMP_Y` 92 (the tile's y offset), `EMPTY_W` 280, `HEADER_H` 44, `HEADER_GAP` 12, `HEADER_MIN_W` 360, `STRIP_GAP` 72, `LOOSE_PER_ROW` 8, `ROW_GAP` 40, `SIDE_ROW_GAP` 6, `SIDE_TAG_W` 28, `SIDE_WORD_W` 72, `SIDE_TAG_GAP` 6 (after the tag column), `SIDE_WORD_GAP` 8 (before the word column; with `SIDE_TAG_GAP`, the two inner gaps `sideGeometry` adds, so a side frame drawn from them matches it), `CHIP_W` 220, `CHIP_H` 28, `CHIP_GAP` 6, `CHIP_MAX` 8, `CHIP_OFFSET` 16, `LOD_ZOOM` 0.35.

### Part 2 — schema (`packages/schema/src/maps.ts`, `bundle.ts`)

```ts
export type MapKind = "journey" | "system" | "screens";
export const MAP_KINDS: readonly MapKind[] = ["journey", "system", "screens"];
// KIND_DEFAULTS is Record<MapKind, …>: this entry lands in the same commit or tsc fails.
//   screens: { species: ["flow", "view"], edge_types: [] }
export const BUILT_IN_MAP_IDS = ["journey", "system", "screens"] as const;
// BUILT_IN_MAPS, third entry:
//   { id: "screens", title: "Screens", kind: "screens",
//     description: "What is live, screen by screen — every flow as a strip of its screenshots." }
// computeMapSubgraph step 3 (maps.ts:382): `if (rootId === undefined || definition.kind === "screens")`
//   returns the filtered selection unbounded; a stored screens map's root_node_id/depth are ignored.
```

`bundle.ts:281`, `:287`, `:290`, `:293`: the descriptions name the third id, kind and defaults.

### Part 2 — `components/graph/Canvas.tsx` (new optional props; defaults keep today's behaviour)

```ts
onPaneClick?: (event: React.MouseEvent) => void;  // forwarded to <ReactFlow onPaneClick>
onlyRenderVisibleElements?: boolean;              // default false
initialFit?: boolean;                             // default true; false drops `fitView`
children?: ReactNode;                             // inside <ReactFlow>, after <CameraFocus>
```

`nodeTypes` gains `wallFrame: WallFrameNode`, `wallHeader: WallHeaderNode`, `wallMarker: WallMarkerNode`, `wallJump: WallJumpNode` (part 2) and `wallChip: WallChipNode` (part 4). Every wall node is built with `width`/`height` from its `WallBox` and `draggable: false, connectable: false, selectable: false, focusable: false`; focus lives on the element inside. `readOnly` is not used.

### Part 2 — node data (`components/graph/nodes/wall-node-data.ts`, new, types only)

`type` aliases, not interfaces, so they satisfy React Flow's `Record<string, unknown>` data constraint. Fields tagged (3)/(4) are added by that part as required fields, in the same commit as the builder (`ScreensCanvas`) that fills them.

```ts
export type AspectReport = (viewId: string, platform: PlatformId, value: string, ratio: number) => void;
export interface WallSelection { frameId: string; viewId: string; stripId: string }      // (4)

export type WallFrameData = {
  frameId: string; viewId: string; stripId: string; stripTitle: string;
  screen: WallScreen; lens: WallLens; platforms: readonly PlatformId[];   // wall.platforms
  shotWidth: number;                       // WallBox.shotWidth
  armContext: string | null;               // "in Yes of Has a streak?" when the frame starts an arm
  status?: StatusId;                       // Minimap fill: lens status; side → highest in getRollupDisplayStatus order
  onActivate: (frameId: string, viewId: string, stripId: string) => void;
  onAspect: AspectReport;
  dimmed: boolean;                         // (3) gaps only and not a gap: 15% + greyscale, still clickable; (4) never the selected frame
  dimmedRows: readonly PlatformId[];       // (3) non-gap rows inside a kept side frame: 35%
  selected: boolean;                       // (4)
  onMove: (frameId: string, dir: "left" | "right" | "up" | "down") => void;   // (4)
};
export type WallHeaderData = {
  stripId: string; flowId: string | null; title: string;
  countsLine: string;                      // stripCountsLine(wall, strip, lens)
  note: "no-flows" | null;                 // the Journey pointer line above "Not in a flow"
  ringVersion: number;                     // a change rings the header for 2s
  onOpenFlow: ((flowId: string) => void) | null;
  dimmed: boolean;                         // (3)
};
export type WallMarkerData = {
  variant: "arm" | "end" | "empty";
  branch: "condition" | "junction" | null; label: string; arm: string; empty: boolean;
  dimmed: boolean;                         // (3)
};
export type WallJumpData = { flowId: string; title: string; screenCount: number; onJump: (flowId: string) => void; dimmed: boolean /* (3) */ };
export type WallChipData =                 // (4) rendered aria-hidden, tabIndex -1
  | { kind: "touch"; frameId: string; touch: WallTouch; onOpen: (nodeId: string) => void }
  | { kind: "more"; frameId: string; viewId: string; count: number; onOpen: (nodeId: string) => void };
```

Node `type` strings: `wallFrame`, `wallHeader`, `wallMarker` (arm, end and empty), `wallJump`, `wallChip`. Chip ids `chip:<frameId>:<nodeId>` and `chip:<frameId>:more`, `zIndex: 1000`. Touch edges (part 4): id `touch:<frameId>:<nodeId>`, React Flow's built-in `smoothstep` type with `pathOptions: { offset: 0, borderRadius: 6 }`, from a hidden `source` handle on the frame's bottom edge `TOUCH_TRUNK_X` (16px) in from its left corner to a hidden `target` handle at the chip's left; `planChips` moves `chipRects`' column right by `TOUCH_TRUNK_X + TOUCH_STUB` (16 + 12), so the edges share one vertical trunk and each chip gets a 12px stub.

### Part 2 — controller, canvas, camera, bar

```ts
// components/maps/ScreensMap.tsx
export function ScreensMap(props: { projectId: string; definition: MapDefinition }): JSX.Element;

// components/graph/WallCamera.tsx — rendered as a Canvas child
export type WallViewportFor = (size: { width: number; height: number }) => { x: number; y: number; zoom: number };
export type WallCameraRequest =
  | { version: number; rect: Rect; minZoom: number; maxZoom: number }   // frameViewport: jumps, frame clicks, a flow's ?node=
  | { version: number; viewport: WallViewportFor };                     // a viewport for the settled size: the opening camera, lens keeping, selection, a view's ?node=
export const WALL_CAMERA_PADDING = 32;   // frameViewport padding, px
export const WALL_BAR_INSET = 72;        // frameViewport bottomInset, px (bar + gap)
export function WallCamera(props: { request: WallCameraRequest | null }): null;
// Each version applies once, 120ms after the last store width/height change (as CameraFocus), via
// setViewport(frameViewport(…) — or request.viewport({ width, height }) —, { duration: prefersReducedMotion ? 0 : 300, interpolate: "linear" }).

// components/graph/ScreensCanvas.tsx
export interface ScreensCanvasProps {
  wall: Wall; layout: WallLayout; lens: WallLens; scope: ProductScope;
  focus: CanvasFocus | null;               // part 2 frame click centres through CameraFocus
  camera: WallCameraRequest | null;
  ring: { stripId: string; version: number } | null;
  onFrameActivate: (frameId: string, viewId: string, stripId: string) => void;
  onOpenNode: (nodeId: string) => void;    // header → flow panel; chips in (4)
  onJump: (flowId: string) => void;
  onAspect: AspectReport;
  gapsOnly: boolean;                       // (3)
  selection: WallSelection | null;         // (4)
  onPaneClick: () => void;                 // (4)
  onFrameMove: (frameId: string, dir: "left" | "right" | "up" | "down") => void;   // (4)
}
// Renders <Canvas nodes edges scope minimapColor="status" initialFit={false} onlyRenderVisibleElements
//   focus={focus} onPaneClick={…}><WallCamera request={camera} /></Canvas>, inside an `@container` wrapper.
// No onNodeClick/onConnect/onEdgeClick; spotlight off. Wall nodes activate from their own element
// (onClick; onKeyDown Enter/Space), never through Canvas onNodeClick.

// components/maps/screens/ScreensBar.tsx — role="toolbar" aria-label="Screens display"
export interface ScreensBarProps {
  platforms: readonly PlatformId[];        // wall.platforms
  lens: WallLens; onLensChange: (lens: WallLens) => void;
  announcement: string;                    // visually hidden aria-live="polite" line
  gapsOnly: boolean; gapCount: number; onGapsOnlyChange: (next: boolean) => void;   // (3)
}
```

Controller rules fixed here because parts 3–5 extend them:

- The rendered lens is always `resolveLens(prefs.screensLens, wall)`; nothing is written until the viewer chooses. In part 2 the bar renders nothing when `wall.platforms.length < 2`; from part 3 it always shows the gaps switch.
- On the first render with a non-empty layout (and, while the top pills are up, once their bottom edge is measured) the controller issues one opening request, `{ version: 1, viewport: (size) => openingViewport(layout, size, { top: <pills' bottom, or 0>, bottom: WALL_BAR_INSET }) }`: the first strip's header at the top-left of the canvas, zoom in [0.7, 1]. Only the first camera opens this way; part 4 replaces it with a `frameViewport` request for the `?node=` target when one is on the wall, and keeps the opening request otherwise. A jump tile requests its target strip with the same zooms and bumps `ring`. Part 4's selection request frames the frame box plus its chip column with `minZoom` 0.6, `maxZoom` 1, as a `viewport` request (`selectionViewport(selectionBounds(…), size, …)`) because the room it keeps depends on the settled canvas size: at least `INSPECTOR_SHEET_BELOW` (40rem, the inspector's own container query) wide, the rect is framed in the canvas less the inspector card and its gap (336 screen px, so the card sits beside the frame at any zoom); narrower, nothing widens and the sheet's maximum height (`INSPECTOR_SHEET_MAX_H` of the cell, above `WALL_BAR_INSET`) is kept clear at the bottom; with a panel open (no inspector), neither, and the rect is the frame box alone, centred in the canvas the panel leaves (its chips stay drawn under it). Whether the inspector is up is read when the camera runs, not when it is requested. Whenever the canvas's width changes while a frame is selected (a panel opening or closing, a window resize), the controller issues the selection request again — the probe reports the width, WallCamera runs the last request once the size has settled. A `?node=` cold load on a view frames it the same way. "Also in …" (only) adds the target strip's title area (`stripTitleRect`) to that rect when the joined rect still fits at `minZoom`.
- A lens change keeps the reader's strip: `handleLensChange` reads the React Flow store (the controller wraps `ScreensCanvas` in a `ReactFlowProvider`, with a probe beside it that hands up the store and the strip nearest the viewport's centre), takes `stripNearViewport` under the old layout and, when `keepStripViewport` under the new one says so, issues `{ version, viewport: () => kept }` — same zoom and y, the strip's start `WALL_CAMERA_PADDING` in from the left. Part 4: with a frame selected, `handleLensChange` instead issues the selection request again on the new layout (in the handler, never an effect); that replaces the strip-keeping move for that case only. A product-scope change issues the opening request again only when the reader's strip is no longer on the wall, checked during render against the probe's last answer.
- Part 2 frame activation = `openNode({ nodeId: viewId })` + `focus` on the frame (System map grammar). Part 4 replaces it with selection; a second activation of the selected frame opens the panel.
- The aspect cache is module-level in `components/maps/screens/aspect-cache.ts`: keyed `viewId|platform`, stores `{ key, ratio }` where `key` is the shot's fingerprint (`shotKey(shot)`: length, `meta.ts` when present, first and last 64 characters — never the multi-megabyte value), `aspectOf` answers only while `key` is the slot's current shot's; reports (`onAspect`'s `value` argument carries the key) are batched per animation frame. Load failures live there too (`reportShotFailure` / `hasShotFailed`, same slot and key, applied at once), so a broken shot is requested once per tab.
- A strip header's counts line follows its title directly, 8px after it; the rest of the header (which spans the strip) is empty. Nothing in a header sits at its far end, which is off screen on arrival for any strip wider than the canvas.
- One icon for the Screens map in the sidebar, the Overview card and ⌘K: lucide `GalleryHorizontalEndIcon`; palette icon id `"screens"`.

### Persistence (`lib/hooks/useDisplayPreferences.ts`)

Storage key unchanged: `localStorage["arkaik:display-prefs:<projectId>"]`, one JSON object. `DisplayPreferences` gains `screensLens: WallLens | null` (part 2; default `null`; `read()` accepts a `PLATFORMS` id; part 3 also accepts `"side"`) and `screensGapsOnly: boolean` (part 3; default `false`). An invalid value degrades per key. Hook unchanged: `useDisplayPreferences(projectId): [DisplayPreferences, (patch: Partial<DisplayPreferences>) => void]`. The Screens map writes nothing to `project.metadata.map_display` and shows no Display popover.

### Part 2 — palette command (`lib/utils/command-palette.ts`, `components/layout/CommandPalette.tsx`)

`CommandIconId` gains `"screens"`; the closed `COMMAND_ICONS` record gains `screens: GalleryHorizontalEndIcon` in the same commit. After `map-system`: `{ id: "map-screens", label: "Screens", group: "maps", icon: "screens", keywords: ["screens map", "screenshots", "wall", "shots"], hint: "What is live, screen by screen", target: { kind: "href", href: \`${base}/maps/screens\` } }`.

### Part 3 — keys

`usePlatformHotkeys({ enabled: wall.platforms.length >= 2, available: wall.platforms.map((id) => ({ id })), current: lens === "side" ? "all" : lens, onSelect: (next) => setLens(next === "all" ? "side" : next) })`. Rows `filter-ios`, `filter-web`, `filter-android` keep ids and keys; their descriptions become "… (Acceptances, Delivery, Screens)".

### Part 4 — keys and inspector

Registry row in group `map` of `lib/utils/keyboard-shortcuts.ts`: `{ id: "wall-move", description: "Move between screens (Screens map)", keys: ["←", "↑", "→", "↓"], scope: "map" }`, no `hotkeys` (documentation only; handled by the frame's `onKeyDown`, never passed to `useShortcut`). Escape: the `close` row through `useShortcuts`, options `{ ...GUARDED_HOTKEY, enabled: selection !== null && entries.length === 0, conflictBehavior: "allow" }`, `entries` from `useProjectPanels()`; while a panel is open, Escape stays `PanelStack`'s (`PanelStack.tsx:169-183`). The two handlers are mutually exclusive through `entries`, and TanStack warns on a second registration of a key unless that registration allows the overlap, so the map's is registered only once the wall's cell is attached (a ref callback sets state): always after PanelStack's, StrictMode's replay included.

The inspector renders only while `selection !== null && entries.length === 0`: with any panel open it is not rendered at all (the panel says the same, and the narrowed canvas would make it a bottom sheet over the frame); the ring and chips stay, and closing the panel brings it back. A panel opened from inside the inspector unmounts the focused element, so focus moves to the selected frame rather than the body.

```ts
// components/maps/screens/ScreenInspector.tsx — <section aria-label={`${title} on the wall`}>, outside React Flow
export interface ScreenInspectorProps {
  wall: Wall;
  selection: WallSelection;
  onOpenPanel: (nodeId: string) => void;   // "Open panel" and the Touches list
  onGoToStrip: (stripId: string) => void;  // "Also in …"
}
```

Shot dates in the inspector go through `formatShotDate` (`lib/utils/screenshot-ops.ts:23`).

### Part 5 — palette nodes

`lib/utils/command-palette.ts` stays import-free.

```ts
export type CommandGroupId = "create" | "pages" | "maps" | "flows" | "views" | "library" | "project" | "actions";
// COMMAND_GROUPS: { id: "flows", label: "Flows" }, { id: "views", label: "Views" } inserted after "maps".
export type CommandTarget = /* the existing three */ | { kind: "node"; nodeId: string };
export interface PaletteCommand { /* existing fields */ searchOnly?: boolean }
export const NODE_PENALTY = 500;
export const SEARCH_ONLY_PER_GROUP = 6;

/** Structural and import-free: walks playlist entries (view, flow, condition, junction), never into sub-flows. */
export function summarizePaletteNodes(nodes: readonly {
  id: string; species: string; title: string; metadata?: { playlist?: { entries?: unknown } } | null;
}[]): {
  flows: { id: string; title: string; screenCount: number }[];            // distinct views listed by the flow
  views: { id: string; title: string; firstFlowTitle: string | null }[];  // first listing flow, snapshot order
};
export function buildNodeCommands(input: ReturnType<typeof summarizePaletteNodes>): PaletteCommand[];
// id "node:<id>", label = title, group and icon "flows" | "views", keywords [id without its species prefix] ("V-home" → "home"),
// hint "N screens" ("1 screen") | firstFlowTitle | "Not in a flow", searchOnly: true, target { kind: "node", nodeId }
export function limitSearchOnly(matches: readonly CommandMatch[], perGroup?: number): CommandMatch[];
/** limitSearchOnly(rankCommands(commands, query), perGroup) — what the overlay lists, and what its test checks. */
export function paletteMatches(commands: readonly PaletteCommand[], query: string, perGroup?: number): CommandMatch[];
```

`rankCommands`: an empty query drops `searchOnly` commands (the idle palette is unchanged); a search-only command's best score is lowered by `NODE_PENALTY`. A query containing a hyphen also scores (and completes) a node row's full id, read from its `node` target, as a keyword — so a pasted `V-home` finds its view, while a bare "v" or "f" matches no row by its species prefix. The overlay lists `paletteMatches(commands, query)`: `limitSearchOnly` after `rankCommands`.

```ts
// components/layout/CommandPalette.tsx
interface CommandPaletteProps { /* existing */ onNode?: (nodeId: string) => void }
// runCommand: `if (target.kind === "node") { onNode?.(target.nodeId); return; }` BEFORE the href branch.

// lib/hooks/usePageCommands.tsx
export type PageNodeHandler = (nodeId: string) => void;
export function usePageNodeHandler(handler: PageNodeHandler | undefined): void;   // latest handler read through a ref
/** "This page can show a node panel" while mounted with `enabled`; one token per host, each unmount removes its own. */
export function usePageNodePanelHost(enabled: boolean): void;
export function PageCommandsProvider(props: {
  children: (commands: PaletteCommand[], nodeHandler: PageNodeHandler | null, nodePanelHost: boolean) => ReactNode;
}): JSX.Element;
// components/panels/ProjectPanels.tsx — the one place node panels resolve — calls
// `usePageNodePanelHost(allNodes !== NO_NODES)`: a page that hands it nodes is a host.
```

Layout (`app/project/[id]/layout.tsx`): adds `useNodes(id)` and `useEffectiveProduct(id, project)`; rows from flows and views passing `nodeInScope(node, scope)` (stored membership suffices for these species), memoised on nodes and scope, appended after the catalogue. `onNode(nodeId)`: the page handler if one is registered; else, when a panel host is registered (`nodePanelHost`), `openNode({ nodeId })`; else `router.push(\`/project/${id}/library?node=${encodeURIComponent(nodeId)}\`)`. No page list: Overview and Settings go to the Library because their `PageShell` gets no nodes and so registers no host, and so does every page state that renders no `PageShell` (loading, load error, "No map named X", an unrecognised kind). The Screens map's handler: a flow with a strip → camera to `stripIdOf(flowId)`'s rect + ring; a view with frames → select `frameIdsOf(wall, id)[0]` and frame it; anything else → `openNode({ nodeId })`.

## File map

**Part 1.** Create `lib/utils/screen-wall.ts`, `lib/utils/screen-wall-layout.ts`, `tests/app/load-screen-wall.js`, `tests/app/screen-wall.test.js`. Modify `lib/utils/screenshot-staleness.ts`, `lib/hooks/useScreenshotStaleness.ts` (imports the moved constant; nothing else), `tests/app/screenshot-staleness.test.js`, `package.json` (`"test:screen-wall": "node tests/app/screen-wall.test.js"`), `.github/workflows/ci.yml` (build job, after "Journey layout tests": `- name: Screens wall model tests (strips, states, layout, seed census)` / `run: npm run test:screen-wall`), `.gitignore` (`/tests/app/.test-build-screen-wall/`). No generated artifact changes.

**Part 2.** Create `components/maps/ScreensMap.tsx`, `components/maps/screens/ScreensBar.tsx`, `components/maps/screens/aspect-cache.ts`, `components/graph/ScreensCanvas.tsx`, `components/graph/WallCamera.tsx`, and in `components/graph/nodes/`: `wall-node-data.ts`, `WallFrameNode.tsx`, `WallShot.tsx`, `WallHeaderNode.tsx`, `WallMarkerNode.tsx`, `WallJumpNode.tsx`. Modify `packages/schema/src/maps.ts`, `packages/schema/src/bundle.ts`, `docs/spec/maps.md` (kind union, defaults row, reserved ids, Built-in Maps row, step 3 exception, Display/Storage note that Screens' choices are per viewer), `app/project/[id]/maps/[mapId]/page.tsx` (`kind === "screens"` → `<ScreensMap>`), `app/project/[id]/maps/page.tsx` (`builtIn = isBuiltInMapId(definition.id)`), `components/overview/MapsCard.tsx`, `components/layout/ProjectSidebar.tsx` (after System, no hotkey), `lib/utils/command-palette.ts`, `components/layout/CommandPalette.tsx`, `components/graph/Canvas.tsx`, `lib/hooks/useDisplayPreferences.ts`, `lib/hooks/useScreenshotStaleness.ts`, `components/panels/NodeDetailPanel.tsx`. Tests: `tests/schema/maps.test.js`, `tests/mcp/run-mcp-tests.js`, `tests/app/command-palette.test.js`, `tests/app/screen-wall.test.js`. Regenerated and committed: whatever `npm run generate` rewrites; expect `public/schema/project-bundle.json`, `docs/arkaik-skill/scripts/validate-bundle.js`, `docs/arkaik-skill/references/schema.md`, `lib/prompts/generated/schema.ts`, `plugin/skills/arkaik/**`, and `lib/wobble/wobble-registry.generated.ts` + `app/wobble.generated.css` for new lucide names.

**Part 3.** Modify `components/maps/ScreensMap.tsx`, `components/maps/screens/ScreensBar.tsx`, `components/graph/ScreensCanvas.tsx`, and in `components/graph/nodes/`: `wall-node-data.ts`, `WallFrameNode.tsx`, `WallShot.tsx`, `WallHeaderNode.tsx`, `WallMarkerNode.tsx`, `WallJumpNode.tsx`; `lib/hooks/useDisplayPreferences.ts`, `lib/utils/keyboard-shortcuts.ts` (three descriptions). Regenerate if a new lucide name is imported.

**Part 4.** Create `components/maps/screens/ScreenInspector.tsx`, `components/graph/nodes/WallChipNode.tsx`, `components/graph/nodes/wall-inspector.ts` (the inspector region's id, `WallInspectorContext` — its id while no panel is open, else null — and the focusable selector the Tab path uses). Modify `components/graph/Canvas.tsx` (`wallChip`), `components/maps/ScreensMap.tsx`, `components/graph/ScreensCanvas.tsx`, `components/graph/nodes/wall-node-data.ts`, `components/graph/nodes/WallFrameNode.tsx`, `lib/utils/keyboard-shortcuts.ts` (`wall-move`), `tests/app/keyboard-shortcuts.test.js`. Regenerate if a new lucide name is imported.

**Part 5.** Modify `lib/utils/command-palette.ts`, `components/layout/CommandPalette.tsx`, `lib/hooks/usePageCommands.tsx`, `app/project/[id]/layout.tsx`, `components/maps/ScreensMap.tsx` (the handler only), `components/panels/ProjectPanels.tsx` (registers the panel host), `app/project/[id]/maps/page.tsx` (passes its nodes to `PageShell`), `tests/app/command-palette.test.js`.

## Verified facts

Read in the worktree at `2f697cd`. The spec's line references in F1, F2, F3, F5, F7, F9 and F10 hold, and its seed census (F11, and the strip/frame/marker/jump counts in § Ordering rules) was re-run from `seed/*.json` and matches. Where the spec and the code differ:

1. **The panel adoption is not "one call line"** (spec § Files, `NodeDetailPanel.tsx:465`). The hook is called inside `PlatformVariantsSection` (`NodeDetailPanel.tsx:443-465`), whose props are `node, scope, initialPlatform, onUpdate, onScreenshot, onZoomShot` — no nodes, no edges. `allNodes`/`allEdges` are optional props of `NodeDetailPanel` (`:75-76`); the section is rendered at `:836-844`. Decision: § Part 2 — the panel's adoption (a memo, a prop, a fourth hook argument).
2. **The hook has two callers**, not one: `AcceptancePlatformsSection.tsx:38` too. It keeps today's behaviour.
3. **`relatedIds` in the spec's file table is a parameter, not a function.** One shared helper is needed so the wall and the panel pick the same acceptances: `stalenessRelatedIds`.
4. **`STATUS_LABELS` and `PLATFORM_ICONS` live in `components/graph/nodes/node-styles.ts:44-58`**, which imports `lucide-react`. The pure model uses `STATUSES` (`lib/config/statuses.ts:3`) and `PLATFORMS` (`lib/config/platforms.ts:3`) labels; components may use `node-styles`.
5. **`formatShotDate` renders `toLocaleDateString()`** (`lib/utils/screenshot-ops.ts:23-26`), not "3 Nov" as the spec's examples read. The wall uses it, so a date reads the same in the panel and on the wall; no test pins a date string.
6. **`SegmentedControl` collapses labels below the viewport `md` breakpoint** (`components/ui/segmented-control.tsx:69-71`), not a container width, and `components/ui/` is not edited by hand (`docs/conventions.md` § Styling). The bar passes `collapseLabels` and overrides it from outside with container queries on its label spans: below a 33rem canvas (where the labelled bar stops fitting on one line) the lens shows icons only and the bar spans the width with its gutters; the 40rem container rule governs the Controls and the inspector sheet. Per-option `title`s, which the control takes no prop for, are copied from each option's accessible name by the bar.
7. **Overview and Settings host no node panels**: their `PageShell` gets no `allNodes` (`app/project/[id]/overview/page.tsx:237`, `app/project/[id]/settings/page.tsx:92`), so `openNode` there resolves nothing (`components/panels/ProjectPanels.tsx:323`). Every other project page with a `PageShell` passes `allNodes`. Decision: ⌘K on those two pages goes to the Library with `?node=`, which `useProjectPanels.tsx:197-228` opens on arrival. (Review: the rule is "no registered panel host", not a list of two pages — see § Part 5.)
8. **`CommandPalette` is shared with the docs search** (`components/docs/DocsSearch.tsx:83`), so `onNode` is optional; and `runCommand` (`CommandPalette.tsx:209-228`) falls through to `target.external`/`target.href`, so the `node` branch must land with the union change or `tsc` fails.
9. **No `typecheck` script exists**; CI typechecks through `npm run build` (`ci.yml:44-45`). Locally: `npx tsc --noEmit`.
10. **No browser test runs in CI**, and Playwright is not a dependency. The visual and performance checks are manual.
11. **`tests/app/keyboard-shortcuts.test.js` asserts no row descriptions**, so part 3's description edit needs no test change (spec § Part 3 implies one).
12. **Reserving the id `screens`** hides any stored custom map with that id (`listMaps` skips shadowing ids, `maps.ts:441`; the validator warns, `validate.ts:458`). Neither seed has one.
13. **The MCP server serves the new built-in** (`packages/mcp/src/tools.ts:358-401` reads `listMaps`): its fixture lists five maps, and `get_map screens` returns flows and views with no edges. The npm packages are published by hand; this stack bumps no version.
14. **Per-viewer storage** is `arkaik:display-prefs:<projectId>` (`useDisplayPreferences.ts:33`), as F8 says.
15. **Every Lab Note id in the spec exists** in `seed/arkaik-self-map.json`: `V-maps-index`, `F-browse-maps`, `F-adjust-map-display`, `V-node-detail-panel`, `V-command-palette`, `F-navigate-by-keyboard`.

## Test strategy

All suites are plain Node scripts. App modules are transpiled with `ts.transpileModule` by a loader and required as CommonJS from a gitignored `.test-build-*` directory; nothing `require`s a `.ts` file. Every part, alone on its branch, runs `npm run lint`, `npx tsc --noEmit`, `npm run generate` then `git status --porcelain` (clean apart from the part's own files), the commands below, and `npm run build` once before opening the PR.

**Part 1.** New `tests/app/load-screen-wall.js`, modelled on `tests/app/load-journey-graph.js`: `loadSchema()` first; its own `BUILD_DIR` (`tests/app/.test-build-screen-wall`); `MODULES` = config-platforms, config-statuses, blocked, platform-status, graph-build, product-scope, quality, journey-layout, journey-card-size, journey-graph, screenshot-staleness, screen-wall, screen-wall-layout; `SPECIFIER_MAP` = the journey loader's table plus `@/lib/utils/journey-graph`, `@/lib/utils/screenshot-staleness`, `@/lib/utils/screen-wall`; `@arkaik/schema` rewritten to the schema test build. It returns both wall modules' exports plus `computeMapCounts`, `resolveProductScope`, `getBaseNodeId` and the schema's `buildProductGraph` and `acceptancesCovering`. New `tests/app/screen-wall.test.js` covers everything the spec's § Parts lists for part 1 — ordering rules 1–6 (skipped and out-of-scope entries, nested branches, empty arms, self-referencing sub-flows), ids and `getBaseNodeId`, every truth-table row (including a covered view whose acceptances omit a platform, and an Admin view under All products), proof (deploy by actor, deploy by `detail`, hand, unknown, mixed, project-wide event; only covering acceptances whose resolved status on the platform is `live` decide it, so an archived one never does), stale reasons through a covering acceptance, counts and gaps on distinct views, `resolveLens`, every layout rule and constant, `frameViewport`, `neighbourFrame`, `chipRects`, the seed census (All products: Pebbles 11 strips, 61 frames, 17 markers, 0 jump tiles; self-map 39, 56, 67, 14) — plus this contract's helpers (`frameIdsOf`, `lensPlatforms`, `cellWord`, `stripCountsLine`, `sideGeometry`, `clampAspect`) and the time budget (mean `buildWall` + `layoutWall` over 20 runs per seed under 25 ms). Extend `tests/app/screenshot-staleness.test.js` through its unchanged loader: each rule through a related id, an unrelated id, `staleReasons` order, `stalenessRelatedIds`; every existing assertion untouched. Commands: `npm run test:screen-wall`, `npm run test:screenshot-staleness`, `npm run test:journey-graph`.

**Part 2.** Extend `tests/schema/maps.test.js` (three built-ins in order, `listMaps({})` ids, a stored `screens` id skipped, `resolveMapDefaults({ kind: "screens" })`, a screens definition with a `root_node_id` returning the unbounded selection); `tests/mcp/run-mcp-tests.js` (`maps.length === 5`; `get_map screens` returns the fixture's flows and views and 0 edges); `tests/app/command-palette.test.js` (catalogue reaches `/maps/screens`; `"screens"` → Screens; the probes at `:97`, `:126-130`, `:136-139` move to `"pages"` → Views, its keyword hit highlighting nothing, and `"page"` completing with `"s"`); `tests/app/screen-wall.test.js` (`computeMapCounts` of the screens definition equals the wall's distinct flows + views, 0 edges, under All, `admin` and `app` on Pebbles). Commands: `npm run test:maps`, `npm run test:mcp`, `npm run test:schema`, `npm run validate:seeds`, `npm run test:command-palette`, `npm run test:screen-wall`, `npm run test:screenshot-staleness`, `npm run test:journey-graph`, `npm run test:product-scope`, `npm run test:panel-semantics`, `npm run test:platform-variants-gates`, `npm run test:keyboard-shortcuts`.

**Part 3.** No new test: side layout, `cellWord`, gaps and counts are covered since part 1. Commands: `npm run test:screen-wall`, `npm run test:keyboard-shortcuts`.

**Part 4.** `tests/app/keyboard-shortcuts.test.js` asserts the `wall-move` row exists in group `map` with scope `map` and no hotkeys. Commands: `npm run test:keyboard-shortcuts`, `npm run test:screen-wall`, `npm run test:project-panels`, `npm run test:panel-stack`, `npm run test:panel-semantics`.

**Part 5.** `tests/app/command-palette.test.js`, through its unchanged single-file loader: `summarizePaletteNodes` on a small fixture (screen counts, first flow, loose views); the idle list excludes search-only rows; "settings" ranks the page above a view titled Settings; an exact view title beats a page prefix and an exact keyword; an id finds its node; `limitSearchOnly` keeps at most six per group and leaves other groups whole; hints. Commands: `npm run test:command-palette`, `npm run test:keyboard-shortcuts`.

**Manual browser check (parts 2–5; not a CI test).** A Playwright script run by hand from a scratch directory outside the repo (`npm i playwright` and `npx playwright install chromium` there). Start this worktree's dev server on its own port, `PORT=4343 npm run dev` (4242 may belong to the other checkout), and restart it after every branch switch. Import a seed through the `/projects` page's file input, open `/project/<id>/maps/screens`, check light and dark at 1440×900, 900 and 390 wide, and record console errors.

- Part 2: the map is listed (sidebar, Overview card, maps index without Edit/Delete, ⌘K "screens"); both seeds render ghost walls with the no-shots pill; a frame click opens the panel and centres; a jump tile flies and rings; Pebbles' Admin scope shows "Not in a flow" under its line; a covered view's panel caption reads "may be stale" after its acceptance moves. Performance (spec § Performance 2) on a scratch copy of Pebbles with data-URI shots: `img[data-wall-shot]` ≤ visible frames + 4 after load; 0 after the Controls' fit-view; 20 wheel steps record no long task over 200 ms.
- Part 3: side rows and words; the gaps switch fades and counts; I/W/A drive the lens; both choices survive a reload.
- Part 4: select, inspector, chips; Enter or a second click opens the panel; Escape clears only with no panel open; arrows move and pan; a `?node=` cold load frames; repeat with a panel open and at 390 wide (bottom sheet).
- Part 5: ⌘K finds a view and a flow; on the Screens map it flies, on the Journey map it opens the panel, on Overview it lands in the Library with the panel open; the idle palette is unchanged.

## Known traps (each checked here)

- **CI is Node 20, local is newer** (`ci.yml:29`; local v26). Never `require` a `.ts` file in a test. `tsconfig.json` has `lib: ["esnext"]`, so `tsc` accepts `Object.groupBy`, `Map.groupBy` and the new `Set` methods, which Node 20 lacks: none of them in a tested module.
- **Hand-maintained alias tables, several of them** (`SPECIFIER_MAP` in `tests/app/load-journey-graph.js:40-53` and 25+ other loaders under `tests/`). A new `@/…` import in a module some loader transpiles breaks that loader silently, and fixing one table fixes no other. Here: `screenshot-staleness.ts` keeps only `@arkaik/schema` imports; `command-palette.ts` stays import-free; no existing tested module imports `screen-wall*.ts`; the new loader lists every `@/` specifier its modules use.
- **CI fails on ESLint and actionlint** (`ci.yml:21-24`, `:41-42`); ESLint ignores `tests/**`. The React Compiler rules are errors: `react-hooks/set-state-in-effect` (derive during render instead, as `useProjectPanels.tsx:205-211` does) and `react-hooks/refs` (no ref reads during render). Keep the new CI step plain YAML.
- **CI diffs generated artifacts** (`ci.yml:35-39`). Run `npm run generate` and commit its output whenever a generator input changes: part 2 (schema descriptions, `MapKind`, the validator bundle) and any part that imports a lucide name not yet in `lib/wobble/wobble-registry.generated.ts`.
- **Source-reading suites.** `tests/app/product-scope.test.js:555-620` reads the first `<PlatformVariants` element's props in `NodeDetailPanel.tsx`, plus `AcceptancePlatformsSection.tsx`, `PlatformVariants.tsx`, `ViewNode.tsx`, `FlowNode.tsx`; `panel-semantics.test.js` sweeps `components/panels/` headings and `PageShell`'s single `h1`; `platform-variants-gates.test.js` reads `PlatformVariants.tsx`; `keyboard-shortcuts.test.js:186-214` forbids `window`/`document` `keydown` listeners in `app`, `components`, `lib`, `hooks`, and requires every literal `useShortcut("id")` to name a row with hotkeys — so never `useShortcut("wall-move")`. The inspector lives in `components/maps/screens/`, outside the panels sweep.
- **A widened closed union breaks `tsc` until its consumer lands in the same commit**: `MapKind` with `KIND_DEFAULTS`; `CommandIconId` with `COMMAND_ICONS`; `CommandTarget` with `runCommand`; a new required `DisplayPreferences` key with `DEFAULT_DISPLAY_PREFERENCES` and `read()`. The panel descriptor union is not widened by this stack (the inspector is not a panel).
- **Tailwind named groups match any ancestor**: name each `group/<name>` for the element that owns it; never reuse a name inside a frame, header or the inspector.
- **The overscroll wheel trap**: `app/globals.css:125-133` sets `overscroll-behavior: contain` on every `.overflow-x-auto`; the bar, chips and inspector never scroll horizontally.
- **A stale dev server fakes hydration mismatches**: restart before believing one.
- **The surface keeps its box while panels open** (`docs/conventions.md` § Panel Stack): the canvas narrows, so `WallCamera` waits for the size to settle, as `CameraFocus.tsx:19-41` does.

## Lab Notes

Molecule `arkaik`. After opening each PR, read its comments for the reminder's verdict, and fix the body, not the code.

**Part 1** — no note; add the label `no-lab-note`.

**Part 2**

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

**Part 3**

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

**Part 4**

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

**Part 5**

```yaml
en:
  title: "Jump to any view or flow from ⌘K"
  summary: "Type a view or flow name in the command palette: on the Screens map it flies you straight there, anywhere else it opens it."
fr:
  title: "Saute vers n'importe quelle vue ou flow avec ⌘K"
  summary: "Tape le nom d'une vue ou d'un flow dans la palette de commandes : sur la carte Screens, tu y files directement ; ailleurs, sa fiche s'ouvre."
nodes: [V-command-palette, F-navigate-by-keyboard]
suggested:
  molecule: arkaik
  type: improvement
  tags: [command-palette, navigation]
```

## Open risks

None blocks the stack. Three consequences the owner may want to see before part 2 or part 5 merges; each already has a decision above, and none needs an answer to start:

1. **⌘K on Overview and Settings** cannot open a panel in place (Verified fact 7); the contract sends those two pages to the Library with the panel open.
2. **`screens` becomes a reserved map id** (fact 12): a hosted project that already stores a custom map with id `screens` would stop listing it. Not checkable from here.
3. **The published MCP server and CLI change their output** once released (fact 13); the version bump and the publish stay with the owner.
