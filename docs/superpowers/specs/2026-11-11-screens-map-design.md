# Screens map — design

**Date:** 2026-11-11
**Status:** decisions taken with the product owner; this document checks them
against `main` at `2f697cd` and is ready for a plan once the open questions at
the end are answered (each has a default, so nothing is blocked).
**Prototype:** the "Screen Wall" playground artifact
(`https://claude.ai/artifact/Y4zwXHakTdKdQpY81SbRxJ`). It pictures the intent.
Its own canvas, chrome (rail, command bar, theme toggle) and sample data are
not carried over; where it differs from the requirements below — it sits on
the Journey map, searches in its own bar, and invents deploy numbers — the
requirements win.

## Goal

Show what is actually live on each platform, screen by screen. Today a view
card on the Journey map shows only the first declared platform's screenshot,
cropped to a 112px strip (`components/graph/nodes/ViewNode.tsx:157-164`,
`:205-212`), and screenshot staleness is computed but only ever shown as a
caption inside the node panel (`components/panels/PlatformVariants.tsx:240-246`).
The Screens map lays every flow out as a strip of its screens, shows each
screen's real screenshot for the chosen platform, says plainly when a shot is
stale or missing, and makes the gaps countable.

## Non-goals

- Any editing on the wall: no reordering, no creating nodes, no setting
  statuses, no uploading shots. Editing stays in the node panel.
- Any change to the Journey map (`components/maps/JourneyMap.tsx`,
  `components/graph/JourneyCanvas.tsx`, `lib/utils/journey-graph.ts`'s
  behaviour), or removing anything.
- Work in other repositories; a schema change to record image dimensions.
- The second proposition, "Flow Stage".
- An agent twin of the wall (an MCP tool returning per-platform states). The
  wall model lives app-side, like the Journey's graph builder
  (`lib/utils/journey-graph.ts:36-42`); `get_map` keeps serving the kind's
  subgraph (§ Verified facts F1).
- Custom stored maps of kind `screens` through the map editor. The kind is
  built-in only in v1; `MapEditorDialog` keeps offering journey and system.

## Requirements

The owner's decisions, restated. "Must" is binding; where the code forces a
change, the change is in § Verified facts and the open questions, not here.

- **R1 Placement.** A third built-in map beside Journey and System: id
  `screens`, kind `screens`, title "Screens". The Journey map is not changed.
- **R2 Read-only.** Selecting things may open the existing node panel, where
  all editing already works. Nothing on the wall writes.
- **R3 Flow shape.** One horizontal strip per flow, screens left to right in
  playlist order. A sub-flow entry is a small jump tile that moves the camera
  to that flow's strip. A condition or junction is a thin marker between
  screens; branches are shown in sequence, not drawn as lanes. A view used in
  several flows appears in each. Views in no flow go in a final "Not in a flow"
  strip. Strip order follows the Journey map's order for flows.
- **R4 Data.** Built from the data that exists. A missing screenshot is a ghost
  frame that says why.
- **R5 Chrome.** The normal project shell. One small bottom bar holding only
  the platform lens and the gaps switch. Jumping to a view or flow goes through
  the existing ⌘K palette, extended to list views and flows.
- **R6 Lens.** One platform of the scope, or "Side by side", which stacks every
  platform inside each frame with a one-word state beside it.
- **R7 States** per view and platform, derived on every read, never stored:
  live with a current shot; live with a stale shot; live with no shot; not live
  yet (showing its status); not on this platform. Whether "live from a deploy"
  differs from "live set by hand" is answered in F6; it is shown.
- **R8 Gaps only.** A switch that fades everything except stale shots and live
  screens with no shot, with a count.
- **R9 Flow headers** show how many screens are live on the lens and how many
  are stale or missing a shot.
- **R10 Quick inspector.** Selecting a frame shows a small card: each
  platform's state, shot date, whether CI or a person recorded it, why a shot
  is stale, how it went live, and a button that opens the node panel.
- **R11 Touch reveal.** Selecting a frame fans out the API endpoints and data
  models the view touches, as chips connected to the frame. A chip opens that
  node's panel.
- **R12 Proportions.** A frame keeps its screenshot's own proportions; a frame
  with no shot uses a default shape per platform.
- **R13 Memory.** Lens and gaps are remembered per viewer.
- **R14 Canvas.** Built on `components/graph/Canvas.tsx` in the
  controller/canvas split the Journey and System maps use, with a strip layout
  computed directly (no ELK). A pure wall model (no React) turns the snapshot
  and journal into strips, frames, markers and states, and is tested directly.
- **R15 Edge cases.** No shots at all: a wall of ghost frames and one line on
  how shots arrive. No flows: an empty state pointing to the Journey map.
- **R16 Delivery.** A stack of five parts, each one branch and PR that lints,
  typechecks and passes its tests alone (cut in § Parts).
- **R17 Out of scope:** see Non-goals.

## Verified facts

Every claim below was read in the worktree at `2f697cd`. **Contradiction**
marks a place where a decision cannot work as stated; each comes with the
smallest change, which this spec then uses, pending the owner (§ Open
questions).

### F1 — How a built-in map is declared, and what a new kind touches

- `packages/schema/src/maps.ts:27` `MapKind = "journey" | "system"`; `:29`
  `MAP_KINDS`; `:120-123` `KIND_DEFAULTS` (a `Record<MapKind, …>`, so a new
  kind will not compile without its defaults); `:126` `BUILT_IN_MAP_IDS`;
  `:133-146` `BUILT_IN_MAPS`; `:433-446` `listMaps` = built-ins then stored,
  skipping stored ids that shadow a built-in.
- The route `app/project/[id]/maps/[mapId]/page.tsx:58-64` switches on `kind`;
  any other kind renders the "unrecognized kind" card (`:66-83`).
- The maps index decides "built-in" with a hard-coded pair, not
  `isBuiltInMapId`: `app/project/[id]/maps/page.tsx:144`. A third built-in
  would get Edit and Delete buttons there. `:145` uses `MAP_KINDS` for
  `renderable`.
- Counts: `computeMapCounts` (`lib/utils/journey-graph.ts:751-783`) sends every
  non-journey kind through `computeMapSubgraph` with the kind's defaults. The
  MCP server's `list_maps`/`get_map` do the same (`packages/mcp/src/tools.ts:358-401`).
- Hard-coded built-in ids elsewhere: sidebar items
  (`components/layout/ProjectSidebar.tsx:303-326`), the Overview's map icons
  (`components/overview/MapsCard.tsx:15-19`), the palette's map commands
  (`lib/utils/command-palette.ts:309-326`).
- Schema descriptions name the two kinds: `packages/schema/src/bundle.ts:281`,
  `:287`, `:290`, `:293`. They flow into `public/schema/project-bundle.json`.
  `MapKind` is copied into `lib/prompts/generated/schema.ts:112`,
  `docs/arkaik-skill/references/schema.md:111` and
  `plugin/skills/arkaik/references/schema.md:111`
  (`scripts/generate/build-types-block.js:61`). The standalone validator
  bundles `isBuiltInMapId` (`packages/schema/src/validate.ts:17`, `:458`). CI
  fails on drift in all of these (`.github/workflows/ci.yml`, "Fail on
  generated-artifact drift").
- Tests asserting on the built-in set: `tests/schema/maps.test.js:287-296`
  (ids `["journey","system",…]`, `BUILT_IN_MAPS.length === 2`),
  `tests/mcp/run-mcp-tests.js:190-194` (`maps.length === 4`),
  `tests/app/keyboard-shortcuts.test.js:227-245` (only if a `nav-*` route names
  a map; this design adds none).
- **Contradiction (R16, part 1).** If part 1 adds the kind to `BUILT_IN_MAPS`,
  every project lists a Screens map that opens on "unrecognized kind" and shows
  Edit/Delete on the index until part 2 lands. **Change:** part 1 ships only the
  pure model; the kind, the built-in entry and the renderer ship together in
  part 2.

### F2 — The controller/canvas split and what `Canvas` allows

- Journey and System each split into a controller holding hooks, dialogs and
  panel wiring (`components/maps/JourneyMap.tsx`, `SystemMap.tsx`) and a
  presentational canvas taking plain data (`components/graph/JourneyCanvas.tsx`,
  `SystemCanvas.tsx`) that renders `Canvas`.
- `Canvas.tsx:23-28`: `nodeTypes` is a module constant; node components must be
  registered there (`docs/conventions.md` § Components). `:269` `fitView` is
  unconditional. `:271-278`: `readOnly` turns off dragging, connecting,
  selecting, zoom-on-scroll, the Controls and the Minimap together. There is no
  `onPaneClick` and no slot for children inside `<ReactFlow>`.
- `CameraFocus.tsx:19-41` centres a clicked node at the current zoom, 120ms
  after the canvas stops resizing (a panel opening narrows it). It cannot frame
  a rectangle (a strip).
- Selection opens a panel through `useProjectPanels().openNode({ nodeId })`
  and sets `focus` (`SystemMap.tsx:180-188`, `JourneyMap.tsx:547-553`).
- The Minimap skips nodes without dimensions (`Canvas.tsx:130-139`) and colours
  by `data.status` (`components/layout/Minimap.tsx`).
- **Contradiction (R14).** `Canvas` cannot host the wall unchanged: `readOnly`
  would also kill wheel zoom and the controls, the initial `fitView` would
  frame the whole wall at unreadable zoom, and nothing can frame a strip or
  clear a selection on a pane click. **Change:** four optional props with
  defaults that keep today's behaviour (`onPaneClick`,
  `onlyRenderVisibleElements`, `initialFit`, `children`), the wall's node types
  registered in `nodeTypes`, and per-node `draggable/connectable/selectable/
  focusable: false` flags instead of a canvas-wide mode.

### F3 — Flow order and the playlist walk

- The Journey's selection is `resolveJourneySelection`
  (`lib/utils/journey-graph.ts:681-726`): membership-restricted nodes, the anchor
  chain (map → product → project root, the last only under All products), and
  `computeComposeClosure` (`:115-153`), a BFS over `composes` edges from the
  anchor whose flow children are top-level flows. Without an anchor and with no
  product named, the Journey draws parentless flow/view roots (`:566-586`); with
  a product named and no anchor, it draws nothing (`emptyReason`).
- A flow's playlist is walked by `buildJourneyGraph.renderSequence`
  (`:366-516`): `view` and `flow` entries in order; a `condition` as arms
  "Yes"/"No" (`if_true`, `if_false`); a `junction` as one arm per case. Entries
  whose node is not in the selection are skipped (`:386-387`, `:400-401`).
  Reuse is drawn with visual ids `nodeId@context` (`lib/utils/graph-build.ts:34-44`).
- Running that walk over the seeds (scratch census, All products):
  Pebbles' Journey reaches 8 of 10 flows (unreached: `F-legal-consent`,
  `F-swap-glyph`); the self-map's reaches 5 of 38 (from `V-projects`, one
  compose pair). Pebbles' Admin product has no anchor (`root_node_id: null`), so
  its Journey is an empty state.
- **Contradiction (R3, strip order).** "The order the Journey uses" exists only
  for the flows the Journey draws: 8/10 and 5/38 on the seeds, none under an
  unanchored product. Showing only those would hide 33 of the self-map's flows
  from a monitoring surface. **Change:** every flow in scope gets a strip;
  Journey-reached flows first, in Journey order; then the rest in bundle order.

### F4 — View data: statuses, screenshots, assets, staleness

- Per-platform status: `getEffectivePlatformStatuses`
  (`lib/utils/platform-status.ts:120-158`). A view covered by acceptances takes,
  per platform, the weakest status of the covering acceptances that list that
  platform; **a platform no covering acceptance speaks to is omitted** (no
  status at all). An uncovered view uses `metadata.platformStatuses[p] ??
  node.status` for each `p` in `node.platforms`. `archived` (order 6) ranks
  above `live` (5) (`lib/config/statuses.ts:3-21`).
- Which platforms a view is on, under a scope: `scopedPlatforms(node, scope)`
  (`lib/utils/product-scope.ts:371-378`), clamped to the node's own product.
  The scope's menu (`scope.platforms`) is the arity input
  (`platformAvailabilityShape`, `:71`).
- Screenshots: `metadata.platformScreenshots[p]` is a string in one of three
  forms (`docs/spec/bundle-format.md:184-194`): relative path, `https://` URL,
  `data:image/…` URI. Provenance is `metadata.platformScreenshotMeta[p] = { ts,
  source: "ci"|"manual", form, commit, order, ci_order }`
  (`packages/schema/src/bundle.ts:55-85`).
- **No surface resolves a value**: the raw string goes into `src` or
  `background-image` (`ViewNode.tsx:210`, `PlatformVariants.tsx:219`,
  `ShotPreviewDialog.tsx:210`). A relative path therefore loads from the page's
  own URL and breaks, in local and hosted mode alike. The format requires a
  placeholder for an unresolvable form (`bundle-format.md:194`).
- Nothing records image dimensions. **Constraint on R12:** a frame's
  proportions are only known once its image has loaded; the layout takes
  measured aspect ratios as an input and starts from the platform default.
- Staleness: `isScreenshotStale(meta, events, nodeId, platform)`
  (`lib/utils/screenshot-staleness.ts:15-38`) flags a shot when, after
  `meta.ts`, the **same node** had a `node.status_changed` on that platform or
  project-wide, a `ref.status_changed` to `merged`, or a `deliverable.shipped`
  naming it. A shot with no `meta.ts` is never stale. The panel reads it through
  `useScreenshotStaleness` (`lib/hooks/useScreenshotStaleness.ts:11-41`), which
  projects the journal to those three types.
- **Contradiction (R7, "stale").** A view's live status is moved through its
  covering acceptances: the deploy door only moves acceptances (F6), and the
  GitHub App attaches a PR's ref to the acceptances the PR names
  (`lib/services/github/pull-request.ts:36-43`). None of those events carry the
  view's id, so the shared rule never stales a covered view's shot after a
  deploy or a merge. All 35 self-map views are covered. **Change:** the rule
  takes the view's covering acceptances that list the platform as related ids,
  in the one shared function, so the wall and the panel caption agree.

### F5 — What a view touches

- Edge grammar: `calls` = view/flow → api-endpoint (or endpoint → endpoint);
  `displays` = view → data-model (`packages/schema/src/enums.ts:43`). The seeds
  agree: Pebbles has 57 `calls` view→endpoint and 70 `displays` view→model; the
  self-map 55 and 40. No endpoint→view edge exists in either.
- Per view, Pebbles' maximum is 14 touched nodes (90th percentile 6); the
  self-map's maximum is 7.
- `computeViewApiRelations` (`journey-graph.ts:59-101`) also accepts an
  endpoint→view `calls` edge as "inbound"; the grammar does not allow it, so the
  wall reads outbound edges only.
- Touches are scoped like the strips: a touch is an endpoint or model in the
  wall's scope (`mapScopedNodes` over the scope's `ProductGraph`, the set the
  views and flows come from). Under a product scope a chip never names a node
  that scope hides; under All products every reached node is a touch.

### F6 — The journal, and whether "live from a deploy" can be told apart

- The deploy door `POST /api/graph/projects/{id}/live` moves **only
  acceptances**, only to `live`, only on a named platform
  (`lib/services/graph/live.ts:15-36`). It writes an ordinary `update_node`, so
  the journal gets a `node.status_changed` with `platform`, plus the optional
  `detail` evidence (deploy URL, build number) stamped by the store
  (`packages/schema/src/journal.ts:96-108`; `lib/services/graph/store.ts:142-153`).
- Its actor is `arkaik-ci` for a token and `arkaik-app` for a session
  (`app/api/graph/projects/[projectId]/live/route.ts:75`). Other writers:
  the app `arkaik-app` (`lib/data/emit-events.ts:26`), the mutations route with
  a token `arkaik-agent` (`mutations/route.ts:111`), the GitHub App
  `github-app` (`lib/services/github/pull-request.ts:2132`), which never moves
  anything to `live` (merged → `releasing`, `packages/schema/src/promote.ts:59-60`).
  `arkaik live` is only a client of the door (`packages/cli/src/commands/live.ts`).
- `detail` is written only by the door (`journal.ts:101-106`).
- **Answer: yes, for acceptance-covered views in hosted projects.** A view is
  live on `p` from a deploy when every covering acceptance that lists `p` had
  its latest move to `live` on `p` written by `arkaik-ci` or carrying `detail`.
  Limits, all shown honestly rather than guessed: an uncovered view is never
  deploy-proven (the door refuses views); a person pressing the door from a
  session is recorded as `arkaik-app`, so reads as by hand; local projects have
  no door; a live status with no matching event (seeded, baselined) is
  "unknown". Neither seed has a deploy event: every move to `live` in both is by
  `claude-code`.

### F7 — The ⌘K palette

- Brain: `lib/utils/command-palette.ts` — import-free by contract (its loader
  transpiles the single file, `tests/app/load-command-palette.js`). Score tiers
  `:102-108`; an empty query returns every command in authored order
  (`:207-209`); `buildProjectCommands` takes only `projectId` and `customMaps`
  (`:284-296`).
- The overlay (`components/layout/CommandPalette.tsx`) runs `href`, `action` and
  page `run` targets (`:209-228`). The project layout builds the catalogue from
  the project only — it holds no nodes (`app/project/[id]/layout.tsx:94-97`,
  `:187-193`). Pages add commands through `usePageAction`
  (`lib/hooks/usePageCommands.tsx`).
- The Library "Views" command carries the keyword `screens`
  (`command-palette.ts:359`), and `tests/app/command-palette.test.js:97` and
  `:126-130` pin `"screens" → Views` with no highlight. `:136-139` ("screen"
  completes with "s" through the synonym) still passes, but through the new
  label, so it no longer tests what its message says. A map command labelled
  "Screens" outranks it (exact label 10000 > keyword 9000), so those two
  assertions must change in the part that adds it.
- Listing every view and flow as ordinary commands would make the idle palette
  (empty query) show ~70 node rows above Project and Actions, and break
  `tests/app/command-palette.test.js:113-118` (idle list = catalogue). Node rows
  must be search-only.

### F8 — How display choices are remembered

- The Journey's and System's display choices are written into the **bundle**,
  at `project.metadata.map_display[mapId]` (`JourneyMap.tsx:560-583`,
  `SystemMap.tsx:129-152`, `docs/spec/maps.md` § Storage). They are shared by
  every viewer of a hosted project and travel in exports.
- The per-viewer store is `useDisplayPreferences`
  (`lib/hooks/useDisplayPreferences.ts`): localStorage per project, read through
  `useSyncExternalStore`, and its own comment says why: "a preference of the
  person reading, not a fact about the product" (`:35-46`).
- **Contradiction (R13).** "Per viewer, the way the other maps' display choices
  are" is two different things. **Change:** keep "per viewer" (the intent) and
  store lens and gaps in `useDisplayPreferences`; the Screens map writes nothing
  to `map_display` and shows no Display popover.

### F9 — Tests, loaders and CI

- App logic is tested without a browser by loaders that `ts.transpileModule`
  each source and rewrite `@/…` and `@arkaik/schema` requires through a
  hand-maintained table (`tests/app/load-journey-graph.js:22-52`). CI runs
  Node 20 (`ci.yml`), so a test may never `require` a `.ts` file. A new `@/`
  import in a module that an existing loader transpiles breaks that loader
  silently; the wall gets its own loader and adds no `@/` import to modules
  other loaders read.
- Every suite is a named `npm run test:*` script and an explicit CI step; a new
  test needs both, plus a `.gitignore` line for its `.test-build-*` directory
  (`.gitignore:40-54`). ESLint ignores `tests/**`.
- Source-reading suites: `tests/app/panel-semantics.test.js` (headings in
  `components/panels/*.tsx`, one `h1` in `PageShell`),
  `tests/app/product-scope.test.js:555-620` (reads `NodeDetailPanel.tsx`,
  `AcceptancePlatformsSection.tsx`, `PlatformVariants.tsx`, `ViewNode.tsx`,
  `FlowNode.tsx`), `tests/app/keyboard-shortcuts.test.js:186-201` (no
  `window`/`document` `keydown` listener anywhere in `app`, `components`,
  `lib`, `hooks`).

### F10 — Known traps that apply

- `app/globals.css:125-133` sets `overscroll-behavior: contain` on every
  `.overflow-x-auto`, trapping the vertical wheel. The wall's bar and inspector
  must not use horizontal scrolling.
- Tailwind named groups match any ancestor; wall components name each group
  for the element that owns it and never reuse a name in a nested element.
- Widening the panel descriptor union breaks narrowing in `ProjectPanels`. The
  inspector is **not** a panel kind; no descriptor is added.
- `npm run generate` must run and its output be committed in every part that
  changes the schema or adds a lucide icon import
  (`scripts/generate/generate-icon-wobble.js` scans `app`, `components`, `lib`).
- CI fails on ESLint and on actionlint over every workflow.

### F11 — Seed shapes (scratch census over `seed/*.json`)

| | Pebbles | Self-map |
|---|---|---|
| Flows / views | 10 / 58 | 38 / 35 |
| View entries in playlists | 33 | 54 |
| Sub-flow entries | 0 | 14 |
| Conditions / junctions | 0 / 4 (13 arms) | 10 / 11 (46 arms) |
| Views per flow, max / median | 5 / 3 | 3 / 1 |
| Views in no flow | 28 (4 of them Admin) | 2 |
| Views appearing more than once | 3 (max 2) | 10 (max 8) |
| Views with any screenshot | 0 | 0 |
| Views with explicit `platformStatuses` | 1 | 0 |
| Views covered by acceptances | 1 | 35 |
| View platforms | 40 on all three, 5 iOS-only, 8 web+iOS, 5 web-only | 35 web-only |
| Products | `app` (web, iOS, Android; root `V-landing`), `admin` (web; no root) | `studio`, `platform`, `toolchain` (all web) |

Consequences: both seeds render as walls of ghost frames today (R15's "no
shots" case); the self-map is single-platform, so it gets no lens control (the
arity rule) and a gaps switch only; Pebbles' Admin scope has views and no flow.

- **Contradiction (R15, "no flows").** Under Pebbles' Admin scope an empty
  state would hide four views that exist. **Change:** with no flows and no
  views, the empty state; with no flows but some views, the "Not in a flow"
  strip with the Journey pointer as a line above it.

## The wall model

Two pure modules, no React, no DOM:

- `lib/utils/screen-wall.ts` — strips, frames, markers, states, proof, counts.
- `lib/utils/screen-wall-layout.ts` — positions, camera maths, keyboard
  neighbours, chip placement.

### Input

```ts
import type { MapDefinition } from "@arkaik/schema";
import type { Edge as DataEdge, JournalEvent, Node as DataNode, Project } from "@/lib/data/types";
import type { PlatformId } from "@/lib/config/platforms";
import type { StatusId } from "@/lib/config/statuses";
import type { ProductGraph, ProductScope } from "@/lib/utils/product-scope";

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
```

`STALENESS_EVENT_TYPES` moves from `useScreenshotStaleness.ts:11` into
`lib/utils/screenshot-staleness.ts` and is exported, so the wall and the panel
share one cached journal projection.

### Output

```ts
export type WallLens = PlatformId | "side";

export type ShotState =
  | "live-current"   // live, a shot, not stale
  | "live-stale"     // live, a shot, stale            (a gap)
  | "live-no-shot"   // live, no shot                  (a gap)
  | "not-live"       // on the platform, status is not live (or none)
  | "absent";        // not on this platform

export type ShotForm = "url" | "data" | "path";

export interface WallShot {
  value: string;
  form: ShotForm;                 // from meta.form, else detected from the value
  source: "ci" | "manual" | null; // null = legacy slot with no provenance
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
  cells: Partial<Record<PlatformId, PlatformCell>>; // one per platform in wall.platforms
  touches: WallTouch[];                              // in scope only (F5); endpoints first, then models; each by title
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
  /** `strip:<flowId>`, or `loose-strip` (outside that space, so a flow id `loose` cannot collide). */
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

export function buildWall(input: WallInput): Wall;
```

Ids: a frame is `createVisualNodeId(viewId, "<flowId>:<path>")`, where `path`
is the entry's index path joined by dots (`"2.1.0"` = entry 2, arm 1, entry 0),
so `getBaseNodeId` returns the view id; a loose frame is `<viewId>@loose`. Arm
markers `arm:<flowId>:<path>.<armIndex>`, end markers `end:<flowId>:<path>`,
jump tiles `jump:<flowId>:<path>`, the empty item `empty:<flowId>`. Every id is
unique on the wall.

### Ordering rules

1. **Scope.** Candidate nodes are `mapScopedNodes(definition, nodes,
   scope.productId, graph)`. A playlist entry whose view or flow is not a
   candidate (missing, or another product's) is skipped, as on the Journey.
2. **Journey order.** `resolveJourneySelection({ definition: { product },
   dataNodes: nodes, dataEdges: edges, project, scope, graph })` gives the
   Journey's anchor and compose closure. Visit, in order: the anchor if it is a
   flow; then each flow child of `composeClosure.pairs` in BFS order; with no
   anchor and no product named, each parentless flow in snapshot order. Visiting
   a flow appends it once, then visits the sub-flows its playlist reaches,
   depth first, arms in order. This is the order the Journey lays flows out in
   with everything expanded.
3. **The rest** of the scoped flows follow, in snapshot (bundle) order.
4. **"Not in a flow"** comes last: scoped views that no strip lists, ordered by
   title (`localeCompare`, sensitivity `base`), then id. Omitted when empty.
5. **Inside a strip**, items follow the playlist: a `view` entry is a frame; a
   `flow` entry is a jump tile (its views are not inlined; `screenCount` is the
   number of distinct views in that flow's own strip); a branch is, for each
   arm in order (condition: "Yes" then "No"; junction: its cases), an `arm`
   marker followed by the arm's items, then one `end` marker. An arm with no
   items still gets its marker (`empty: true`). A flow with no items gets one
   `empty` item.
6. A view listed twice appears twice. A flow that lists itself as a sub-flow
   is a jump tile to its own strip; nothing recurses, so cycles are harmless.

On the seeds (All products) this yields: Pebbles 11 strips, 61 frames (33 in
flows, 28 loose), 17 markers (13 arm, 4 end), 0 jump tiles; self-map 39 strips,
56 frames (54 + 2 loose), 67 markers (46 + 21), 14 jump tiles. Part 1's tests
assert these numbers.

### State truth table

Per view `v` and platform `p` in `wall.platforms`. `A` = `p ∈ scopedPlatforms(v,
scope)`; `S` = `getEffectivePlatformStatuses(v, nodes, edges)[p]` (may be
undefined); `H` = `platformScreenshots[p]` is a non-empty string; `T` =
`staleReasons(…)` is non-empty.

| A | S | H | T | State | Ghost says (single lens) | Side-by-side word |
|---|---|---|---|---|---|---|
| no | any | any | any | `absent` | "Not on iOS" | "Absent" |
| yes | undefined | no | – | `not-live` (status null) | "No status" / "Nothing says where this stands on iOS" | "Unset" |
| yes | not `live` | no | – | `not-live` | status label / "Not live on iOS yet" | status label |
| yes | not `live` or undefined | yes | – | `not-live` | shot shown at 50% with the status label on it | status label |
| yes | `live` | no | – | `live-no-shot` | "No shot yet" / "Live on iOS" | "No shot" |
| yes | `live` | yes | yes | `live-stale` | shot with an amber ring and a "Stale" badge | "Stale" |
| yes | `live` | yes | no | `live-current` | the shot | "Live" |

Status labels are `STATUS_LABELS` (one word each); `archived` falls under
`not-live`. A legacy shot (no `meta.ts`) is never stale, by the shared rule.

`T` is `staleReasons(meta, events, v.id, p, related)` with `related` = the ids
of `acceptancesCovering(v.id, nodes, edges)` for which `resolvePlatformStatus(ac,
p)` is defined (F4 change). In `lib/utils/screenshot-staleness.ts`:

```ts
export function staleReasons(
  meta: PlatformScreenshotMeta | undefined,
  events: readonly JournalEvent[],
  nodeId: string,
  platform: PlatformId,
  relatedIds?: readonly string[],
): JournalEvent[]; // newest first

export function isScreenshotStale(meta, events, nodeId, platform, relatedIds?): boolean;
// = staleReasons(...).length > 0; with relatedIds omitted, today's behaviour exactly
```

An event about a related acceptance counts under the same three rules as one
about the view (status change on `p` or project-wide; ref merged;
`deliverable.shipped` whose `node_ids` include it). The module keeps importing
only `@arkaik/schema` types, so its loader needs no change. The wall buckets
events by node id once, and `deliverable.shipped` events by each id in their
`node_ids`, and passes each view only the buckets of its own id and its
related ids (a shipped event naming several of them once).

### Live proof

For a live cell on `p`:

1. If `v` has no covering acceptance listing `p` → `hand` (only a person, an
   agent or the CLI can set a view's own status; the door refuses views). `ts`,
   `actor`: the view's latest `node.status_changed` to `live` on `p` or
   project-wide, if any.
2. Otherwise, for each such acceptance whose resolved status on `p` is `live`
   (an archived one leaves the view live but never decides how it went live),
   take its latest `node.status_changed`
   with `to: "live"` and (`platform === p` or no platform). None → `unknown`;
   `actor === "arkaik-ci"` or a non-empty `detail` → `deploy`; anything else →
   `hand`.
3. The cell is `deploy` only if every acceptance is `deploy`; `hand` if any is
   `hand`; otherwise `unknown`. `ts`, `actor` and `detail` come from the newest
   deciding event.

### Counts and gaps

```ts
export interface StripCounts {
  views: number;                                   // distinct views in the strip
  perPlatform: Partial<Record<PlatformId, { on: number; live: number }>>;
  stale: number;                                   // distinct (view, lens platform) pairs
  noShot: number;
}
export function countStrip(wall: Wall, strip: WallStrip, lens: WallLens): StripCounts;
export function isGapCell(cell: PlatformCell): boolean;            // live-stale | live-no-shot
export function isGapFrame(wall: Wall, viewId: string, lens: WallLens): boolean;
export function gapCount(wall: Wall, lens: WallLens): number;       // distinct (view, lens platform) pairs
export function resolveLens(stored: WallLens | null, wall: Wall): WallLens;
```

Lens platforms are `[lens]`, or all of `wall.platforms` for `"side"`.
`resolveLens`: with fewer than two platforms, the only platform (or `"web"`
when the menu is empty); otherwise the stored value if it is `"side"` or in
`wall.platforms`, else `wall.platforms[0]`.

Header text (R9), single lens: `"3/5 live on iOS"`, then `" · 1 stale"` and
`" · 2 without a shot"` when non-zero; `on` is the denominator (views absent on
the platform are not counted). Side by side: `"Web 3/5 · iOS 4/5 · Android
2/4"`, then the stale and no-shot totals over all pairs.

### Layout

```ts
export interface Rect { x: number; y: number; width: number; height: number }
export type WallBoxKind = "header" | "frame" | "arm" | "end" | "jump" | "empty";
export interface WallBox extends Rect { id: string; kind: WallBoxKind; stripId: string; row: number }
export interface WallLayout {
  boxes: WallBox[];                 // strip by strip, item by item: the DOM and Tab order
  strips: ReadonlyMap<string, Rect>;
  bounds: Rect;
}
/** Measured width / height of a loaded shot, or undefined. */
export type AspectOf = (viewId: string, platform: PlatformId) => number | undefined;
export function layoutWall(wall: Wall, lens: WallLens, aspectOf: AspectOf): WallLayout;
```

Constants (px, flow coordinates), exported for the components:

| Name | Value | Meaning |
|---|---|---|
| `FRAME_H` | 280 | Height of every frame's shot box |
| `CAPTION_GAP`, `CAPTION_H` | 8, 36 | Caption under the box: title line + state line |
| `FRAME_NODE_H` | 324 | Box + caption |
| `FRAME_MIN_W` | 144 | A frame node is never narrower; the box centres in it |
| `DEFAULT_ASPECT` | web 1.6, ios 0.4615, android 0.45 | Width / height before a shot loads, and for ghosts |
| `ASPECT_MIN`, `ASPECT_MAX` | 0.3, 2.4 | Clamp on measured aspects |
| `ITEM_GAP` | 24 | Between consecutive items in a strip |
| `ARM_W`, `END_W` | 24, 12 | Marker widths; both are `FRAME_H` tall, top-aligned with boxes |
| `JUMP_W`, `JUMP_H` | 144, 96 | Jump tile, centred on the box (y offset 92) |
| `EMPTY_W` | 280 | The empty-flow ghost, `FRAME_H` tall |
| `HEADER_H`, `HEADER_GAP` | 44, 12 | Strip header and the space under it |
| `HEADER_MIN_W` | 360 | A header is as wide as its strip, at least this |
| `STRIP_GAP` | 72 | Between one strip's last row and the next header |
| `LOOSE_PER_ROW`, `ROW_GAP` | 8, 40 | Only "Not in a flow" wraps |
| `SIDE_ROW_GAP` | 6 | Between platform rows in a side-by-side frame |
| `SIDE_TAG_W`, `SIDE_WORD_W` | 28, 72 | Platform tag column, state word column |
| `CHIP_W`, `CHIP_H`, `CHIP_GAP`, `CHIP_MAX` | 220, 28, 6, 8 | Touch chips |
| `CHIP_OFFSET` | 16 | Chips start this far below the selected frame node |
| `LOD_ZOOM` | 0.35 | Below this zoom, frames drop images and captions |

Rules:

- **Single lens, frame box width** = `round(FRAME_H × a)`, `a` = clamp(measured
  aspect for (view, lens) if the cell has a loaded shot, else
  `DEFAULT_ASPECT[lens]`). Defaults: web 448, iOS 129, Android 126. Node width =
  `max(box, FRAME_MIN_W)`.
- **Side by side**, `n = wall.platforms.length` (2 or 3): row height `r = (FRAME_H
  − (n−1) × SIDE_ROW_GAP) / n` (n=3: 89.33; n=2: 137); mini width `m = max over
  platforms of round(r × a_p)`; box width = `SIDE_TAG_W + 6 + m + 8 +
  SIDE_WORD_W` (defaults: n=3 → 257; n=2 web+iOS → 333). Each mini keeps its own
  aspect and is left-aligned in the column.
- **Strips** start at x = 0. Header at the strip's y; items at y + `HEADER_H +
  HEADER_GAP`, advancing x by item width + `ITEM_GAP`. Strip height = `HEADER_H
  + HEADER_GAP + rows × FRAME_NODE_H + (rows − 1) × ROW_GAP`; the next strip
  starts `STRIP_GAP` below. One-row pitch: 452.
- The lens changes widths, never the vertical rhythm.

Helpers, same module:

```ts
/** Viewport that shows `rect`: zoom = clamp(min((W−2p)/w, (H−2p−bottomInset)/h), minZoom, maxZoom);
 *  start-aligned (left, top) when the rect overflows, centred otherwise. */
export function frameViewport(
  rect: Rect,
  viewport: { width: number; height: number },
  options: { padding: number; bottomInset: number; minZoom: number; maxZoom: number },
): { x: number; y: number; zoom: number };

/** The map's first viewport: the first strip's header at the top-left of the canvas less `insets`
 *  (32px padding), at the zoom that fits the strip's full width, clamped to [0.7, 1]. A strip too
 *  wide at 0.7 stays left-aligned and overflows right. No strip: the identity viewport. */
export function openingViewport(
  layout: WallLayout,
  viewport: { width: number; height: number },
  insets?: { top?: number; right?: number; bottom?: number; left?: number },
): { x: number; y: number; zoom: number };

/** Arrow-key neighbour among frames only: left/right within the row; up/down to the frame
 *  in the previous/next row or strip whose centre x is nearest. null at the edges. */
export function neighbourFrame(layout: WallLayout, frameId: string, dir: "left" | "right" | "up" | "down"): string | null;

/** Chip rects under a frame node: a column at the frame's x, `CHIP_OFFSET` below it. */
export function chipRects(frame: WallBox, count: number): Rect[];
```

## Components

### Files

| File | Part | Responsibility |
|---|---|---|
| `lib/utils/screen-wall.ts` (new) | 1 | `buildWall`, states, proof, counts, gaps, `resolveLens` |
| `lib/utils/screen-wall-layout.ts` (new) | 1 | `layoutWall`, constants, `frameViewport`, `neighbourFrame`, `chipRects` |
| `lib/utils/screenshot-staleness.ts` | 1 | `staleReasons`, `relatedIds`, exported `STALENESS_EVENT_TYPES` |
| `packages/schema/src/maps.ts` | 2 | `MapKind` + `"screens"`; `MAP_KINDS`; `KIND_DEFAULTS.screens = { species: ["flow","view"], edge_types: [] }`; `BUILT_IN_MAP_IDS`; the built-in entry; `computeMapSubgraph` ignores `root_node_id`/`depth` for `screens` (`:381`) |
| `packages/schema/src/bundle.ts` | 2 | The four descriptions name the third kind |
| generated artifacts | 2–5 | `npm run generate`, committed |
| `docs/spec/maps.md` | 2 | Kind union, defaults row, reserved ids, Built-in Maps row, step 3 exception, Display/Storage note that Screens' choices are per viewer |
| `app/project/[id]/maps/[mapId]/page.tsx` | 2 | `kind === "screens"` → `<ScreensMap>` |
| `app/project/[id]/maps/page.tsx` | 2 | `builtIn = isBuiltInMapId(definition.id)` |
| `components/overview/MapsCard.tsx`, `components/layout/ProjectSidebar.tsx` | 2 | Screens icon and sidebar item (after System, no hotkey) |
| `lib/utils/command-palette.ts`, `components/layout/CommandPalette.tsx` | 2 | `map-screens` command, `"screens"` icon id |
| `components/maps/ScreensMap.tsx` (new) | 2 | Controller: data hooks, model, lens/gaps, selection, camera requests, panel wiring, empty states |
| `components/graph/ScreensCanvas.tsx` (new) | 2 | Layout boxes → React Flow nodes/edges → `Canvas` |
| `components/graph/Canvas.tsx` | 2 | Four optional props; wall node types |
| `components/graph/WallCamera.tsx` (new) | 2 | Inside `<ReactFlow>`: applies a camera request with `frameViewport` |
| `components/graph/nodes/WallFrameNode.tsx` (new) | 2 | One frame: box (single or side), caption, focus and keys |
| `components/graph/nodes/WallShot.tsx` (new) | 2 | One shot or ghost: image, load/error, aspect report, LOD |
| `components/graph/nodes/WallHeaderNode.tsx` (new) | 2 | Strip header (`h2`) and counts |
| `components/graph/nodes/WallMarkerNode.tsx` (new) | 2 | Arm and end markers |
| `components/graph/nodes/WallJumpNode.tsx` (new) | 2 | Jump tile |
| `components/maps/screens/ScreensBar.tsx` (new) | 2 | Bottom bar: lens (2), side + gaps (3) |
| `lib/hooks/useDisplayPreferences.ts` | 2–3 | `screensLens`, `screensGapsOnly` |
| `lib/hooks/useScreenshotStaleness.ts`, `components/panels/NodeDetailPanel.tsx:465` | 2 | The panel passes covering-acceptance ids (one call line) |
| `lib/utils/keyboard-shortcuts.ts` | 3–4 | Filter rows name Screens; `wall-move` row |
| `components/maps/screens/ScreenInspector.tsx` (new) | 4 | The quick inspector |
| `components/graph/nodes/WallChipNode.tsx` (new) | 4 | Touch chip |
| `lib/hooks/usePageCommands.tsx`, `app/project/[id]/layout.tsx` | 5 | Node rows and the page's node handler |

### `Canvas` changes (part 2)

```ts
onPaneClick?: (event: React.MouseEvent) => void;   // forwarded to ReactFlow
onlyRenderVisibleElements?: boolean;               // default false
initialFit?: boolean;                              // default true; false drops `fitView`
children?: ReactNode;                              // rendered inside <ReactFlow>, after CameraFocus
```

`nodeTypes` gains `wallFrame`, `wallHeader`, `wallMarker` (arm, end and empty
share it, by `data.variant`), `wallJump`, and in part 4 `wallChip`. Every wall
node carries `width` and `height` from the layout (so the Minimap and
`onlyRenderVisibleElements` know its size before it is measured) and
`draggable: false, connectable: false, selectable: false, focusable: false`;
focus lives on the element inside. `ScreensCanvas` passes no `onConnect` or
`onEdgeClick`, `spotlight` off, `minimapColor: "status"`, and `data.status` on
each frame = the lens status (side by side: the highest-ranked status across
rows, `getRollupDisplayStatus` order). Touch edges (part 4) use React Flow's
built-in `default` edge between a hidden bottom handle on the frame and a
hidden left handle on each chip.

### Interaction

- **Arrival.** The first camera puts the first strip's header at the top-left
  of the canvas, below the top pills and clear of the bottom bar, at the zoom
  that fits the strip's width within [0.7, 1] (`openingViewport`); a wider
  strip runs off to the right. Every later move frames with `frameViewport`.
- **Part 2.** Click or Enter/Space on a frame → `openNode({ nodeId: viewId })`
  and `focus` on that frame (the System map's grammar). Header click → the
  flow's panel. Jump tile → camera to the target strip, `maxZoom` 1, `minZoom`
  0.4, and the target header gets a 2s ring.
- **Part 4 replaces the frame click** with selection: `{ frameId, viewId }`.
  Selecting centres the frame and its chip column (`frameViewport`, zoom kept
  within [0.6, 1]), shows the inspector and the chips. Clicking the selected
  frame again, or Enter on it, opens the panel. The inspector's "Open panel"
  does the same. A chip → `openNode({ nodeId })`. Pane click or Escape clears
  the selection. Escape is `useShortcut("close", …, { ...GUARDED_HOTKEY,
  enabled: selection !== null && entries.length === 0 })`: while any panel is
  open, Escape stays the panel stack's (`PanelStack.tsx:169-183`).
- The panel stack and the wall stay independent: opening a panel narrows the
  canvas, and `WallCamera` waits for the size to settle (120ms, as
  `CameraFocus`). A cold load with `?node=` naming a view or flow on the wall
  frames it (part 4; a view is also selected).
- The inspector (part 4) is a `<section aria-label="<view> on the wall">`
  absolutely positioned in the canvas cell, top-right, 320px wide, outside
  React Flow (so the wheel scrolls it, not the canvas). Contents: title, the
  strip it was selected in and its other strips as buttons ("Also in …"), one
  row per platform in `wall.platforms` (state word, status, shot date via
  `formatShotDate`, "From CI" / "Recorded by hand" / "Legacy shot", the newest
  stale reason plus "and N more", the proof line: "Live from a deploy · 3 Nov ·
  <detail>", "Live, set by hand · 3 Nov", or "No record of how this went live"),
  a "Touches" list of the same endpoints and models as the chips (buttons; the
  keyboard path to them), and "Open panel".
- Chips: up to `CHIP_MAX` (8), then one "+N more" chip that opens the view's
  panel. They are canvas nodes (they move with the camera), `zIndex` 1000 over
  the next strip, on a card background, and `aria-hidden` with `tabIndex={-1}`:
  the inspector's list is their accessible twin.

### The bottom bar

`ScreensBar`, absolutely positioned bottom-centre of the canvas cell, a
`bg-card` segment (`rounded-xl p-1.5`, the Toolbar skin) with
`role="toolbar" aria-label="Screens display"`:

- Lens: the repo's `SegmentedControl` (`components/ui/segmented-control.tsx`),
  one option per platform in `wall.platforms` with `PLATFORM_ICONS`, plus "Side
  by side" (part 3). Hidden when the scope has fewer than two platforms.
- Gaps (part 3): a toggle `Button` with `aria-pressed`, label "Gaps only" and a
  count badge.
- A visually hidden `aria-live="polite"` line announces changes ("Showing iOS.
  4 gaps.").
- I/W/A (part 3) drive the lens through `usePlatformHotkeys`, mapping `"all"`
  to `"side"`; the three filter rows' descriptions gain "Screens".

### Persistence

`DisplayPreferences` gains `screensLens: WallLens | null` (part 2 writes
platforms, part 3 also `"side"`) and `screensGapsOnly: boolean` (part 3).
`read()` validates each key and degrades to `null` / `false`. The rendered lens
is always `resolveLens(stored, wall)`, so a scope change never shows a lens the
scope does not have, and nothing is written back until the viewer chooses.

### Empty and notice states

- `wall.empty === "nothing"`: `EmptyState` — "Nothing to put on the wall yet.
  Screens line up by flow — sketch one on the Journey map." Button "Open the
  Journey map".
- `wall.empty === "no-flows"`: the "Not in a flow" strip, with a line above it:
  "No flows yet, so these screens aren't lined up. Put them in order on the
  Journey map." (link).
- `!wall.anyShot`: a pill at the top centre of the canvas: "No screenshots yet.
  CI records them with `arkaik shot`, and anyone can add one from a view's
  panel."
- Journal read failed: the wall still renders with `events: []`, and the pill
  reads "Couldn't read the journal, so stale shots and deploy proof are
  unknown." with Retry.
- Loading: `PageLoading label="screens"` until nodes, edges, project and the
  projected journal have loaded.

## The palette change (part 5)

- **What is listed:** every flow and view in the shell's scope
  (`nodeInScope(node, scope)`; stored membership suffices for these species).
  Built in the layout from `useNodes(id)` (a projection of the cached bundle)
  by a new import-free builder:

  ```ts
  export function buildNodeCommands(input: {
    flows: readonly { id: string; title: string; screenCount: number }[];
    views: readonly { id: string; title: string; firstFlowTitle: string | null }[];
  }): PaletteCommand[];
  // id "node:<id>", label = title, group "flows" | "views", icon "flows" | "views",
  // keywords [id], hint "5 screens" | first flow title | "Not in a flow",
  // searchOnly: true, target { kind: "node", nodeId }
  ```

- **Groups:** `COMMAND_GROUPS` gains `{ id: "flows", label: "Flows" }` and
  `{ id: "views", label: "Views" }` after `maps`.
- **Ranking:** `PaletteCommand.searchOnly?: boolean`. An empty query skips
  search-only commands, so the idle palette is unchanged. A search-only
  command's score is lowered by `NODE_PENALTY = 500`: a page beats a node title
  of the same shape ("Settings" page 10000 over a view titled "Settings" 9500),
  but a node's exact title (9500) beats a page's prefix (≤ 8000) or exact
  keyword (9000). Ids match as keywords (exact id: 8500).
  `limitSearchOnly(matches, 6)` keeps at most six node rows per group, applied
  by the overlay after ranking.
- **Choosing:** `CommandTarget` gains `{ kind: "node"; nodeId: string }`; the
  overlay calls a new `onNode(nodeId)` prop. The layout routes it to the page's
  handler if one is registered (`usePageNodeHandler(handler)` beside
  `usePageAction`), else to `openNode({ nodeId })` — the node's panel opens on
  the current page. The Screens map registers a handler: a flow flies to its
  strip and rings the header; a view selects its first frame in strip order
  and flies to it; an id not on the wall falls back to `openNode`.
- **Count:** Pebbles adds 68 search-only rows, the self-map 73. Ranking stays
  one pass over about 100 commands per keystroke.
- **The "Screens" map command** (part 2): `map-screens`, label "Screens",
  keywords `["screens map", "screenshots", "wall", "shots"]`, hint "What is live,
  screen by screen", icon `"screens"`.

## Images

- **One element per visible shot:** `<img src alt="" loading="lazy"
  decoding="async" draggable={false} referrerPolicy="no-referrer"
  data-wall-shot>`, `object-fit: cover`. Within the aspect clamp the box has
  the image's own proportions, so nothing is cropped; outside it, `cover` with
  `object-position: top` shows the top of a very tall or wide capture. The frame
  carries the meaning in its `aria-label`, so the image is decorative.
- **Not loaded needlessly:** `onlyRenderVisibleElements` mounts only frames in
  the viewport, so an off-screen shot never makes a request; below `LOD_ZOOM`
  the `img` is unmounted and the box shows the state's tint and glyph
  (`useStore((s) => s.transform[2] >= LOD_ZOOM)`, a boolean selector that
  re-renders only when the threshold is crossed). Data URIs are already in
  memory with the bundle; they cost a decode, not a request. No resizing proxy
  exists (no image config in `next.config.ts`) and arbitrary hosts cannot be
  optimised, so none is added.
- **Proportions:** `onLoad` reports `naturalWidth / naturalHeight` through
  `data.onAspect(viewId, platform, value, ratio)`, where `value` is the shot's
  fingerprint (`shotKey`: the value's length, its `meta.ts` when present, and
  its first and last 64 characters), never the shot itself — a data URI can be
  megabytes, and the cache is read on every re-layout and kept for the tab. The
  controller batches reports per animation frame into a module-level cache
  keyed by `viewId|platform` that stores `{ key, ratio }`; `aspectOf` returns
  the ratio only while the stored key is the slot's current shot's. The cache lives for
  the tab, so returning to the map keeps proportions. A frame therefore changes
  width at most once per shot per tab.
- **Forms:** `form` = `meta.form`, else `data:image/` → data, `http(s)://` →
  url, anything else → path. A path is never requested; its ghost says "Shot in
  the repo" / "Paths open from the bundle's folder, not in the app". A load
  error shows "Shot didn't load" / the URL's host.
- **Ghost frames** (dashed border, faint hatch in `currentColor` at 10%): the
  table in § State truth table, plus the path and error cases above. An
  `absent` ghost has a solid light border and no hatch.

## Accessibility, keyboard, motion, themes, narrow screens

- **Frames** are `role="button"`, `tabIndex={0}`, with an `aria-label` such as
  "Check-in sheet, Daily check-in. iOS: live, shot current, 3 Nov." or, side by
  side, "Check-in sheet. Web: stale. iOS: live. Android: not on this platform."
  Jump tiles: "Go to Streaks, 4 screens". Headers are `h2` (the page's `h1` is
  `PageShell`'s), with a button for the flow's panel. Markers are
  `aria-hidden`; the arm label is in the next frame's description when it
  starts an arm ("…, in Yes of Has a streak?").
- **Keys:** Tab walks visible nodes in reading order (the layout's box order).
  Enter/Space selects (part 4; opens the panel in part 2), Enter again opens
  the panel. Arrow keys on a focused frame move to `neighbourFrame` (part 4),
  pan the camera to it if it is off-screen, and focus it once mounted (retry
  over up to five animation frames). Handled by the element's `onKeyDown`, never
  a window listener; documented by a new registry row `wall-move` ("Move between
  screens (Screens map)", keys ← ↑ → ↓, scope `map`, no `hotkeys`). Escape and
  I/W/A as above.
- **Colour is never alone:** every state has a word or glyph; stale is an amber
  ring plus a "Stale" badge with a clock glyph; no-shot is a dashed amber border
  plus its words.
- **Reduced motion:** `matchMedia("(prefers-reduced-motion: reduce)")` sets every
  `WallCamera` duration to 0; chip fan-in and header rings use `motion-safe:`
  variants and become static outlines that last 2s.
- **Themes and stones:** only tokens (`bg-card`, `border`,
  `text-muted-foreground`, `STATUS_STYLES` from
  `components/graph/nodes/node-styles.ts`) plus `amber-500` /
  `dark:amber-400` as quality styles already use; screenshots are never
  recoloured.
- **Narrow:** the canvas wrapper is an `@container`. Below 60rem of container
  width the Minimap is hidden; below 40rem the Controls are hidden too, the bar
  spans the width with 12px gutters, the `SegmentedControl` collapses to icons,
  and the inspector becomes a bottom sheet above the bar (max 50% of the cell
  height, scrolling vertically). Touch: tap selects, pinch zooms (React Flow).
  Below 768px the panel stack shows one column, as everywhere.

## Performance

Expected React Flow nodes, All products, from the census:

| | Pebbles | Self-map |
|---|---|---|
| Headers | 11 | 39 |
| Frames | 61 | 56 |
| Markers | 17 | 67 |
| Jump tiles | 0 | 14 |
| Total nodes | 89 | 176 |
| Chips when selected | ≤ 9 | ≤ 7 |
| Images today | 0 (no shots) | 0 |
| Images if every slot had a shot | 61 single lens, at most 183 side by side | 56 |

Measurable check that must pass before part 2 is called done:

1. **Model budget (CI).** `tests/app/screen-wall.test.js` builds and lays out
   each seed 20 times and asserts the mean `buildWall` + `layoutWall` time is
   under 25 ms on Node 20.
2. **Browser (Playwright, scratchpad, bundle imported through `/projects`).**
   A scratch script copies Pebbles and gives every (view, platform) slot a data
   URI (390×844 PNG for iOS and Android, 1440×900 for web). At 1440×900, on the
   Screens map, web lens:
   - after load, `img[data-wall-shot]` count ≤ the number of layout frames
     intersecting the viewport + 4;
   - after the Controls' fit-view (zoom below `LOD_ZOOM`), that count is 0;
   - 20 wheel steps from the first strip to the last, observed by a
     `PerformanceObserver({ type: "longtask" })`, record no task over 200 ms.

## Parts, tests and boundaries

One branch and PR per part, chained with `gh stack`. Each part runs `npm run
lint`, `npx tsc --noEmit`, `npm run generate` (clean tree after), and its own
tests plus every suite named below, alone.

**Part 1 — the pure wall model.** `screen-wall.ts`, `screen-wall-layout.ts`,
`staleReasons`/`relatedIds`/exported `STALENESS_EVENT_TYPES`.
Tests: `tests/app/load-screen-wall.js` (own `MODULES` and `SPECIFIER_MAP`:
config-platforms, config-statuses, blocked, platform-status, graph-build,
product-scope, quality, journey-layout, journey-card-size, journey-graph,
screenshot-staleness, screen-wall, screen-wall-layout; `@arkaik/schema` →
the schema test build), `tests/app/screen-wall.test.js` (`npm run
test:screen-wall`, CI step, `.gitignore` entry): ordering rules 1–6 including
skipped and out-of-scope entries, nested branches, empty arms, self-referencing
sub-flows; id uniqueness and `getBaseNodeId`; every truth-table row, including a
covered view whose acceptances omit a platform and an Admin view under All
products; proof (deploy by actor, deploy by `detail`, hand, unknown, mixed,
project-wide event); stale reasons through a covering acceptance; counts and
gap counts on distinct views; `resolveLens`; every layout constant through
widths (single and side, n=2 and 3, measured and clamped aspects), strip pitch,
loose wrap and header minimum; `frameViewport`, `neighbourFrame`, `chipRects`;
the seed census numbers above; the time budget. `tests/app/screenshot-staleness.test.js`
gains `relatedIds` and `staleReasons` order cases; existing cases unchanged.
Must not touch: `packages/**`, generated artifacts, any component, `Canvas`,
the palette, `useScreenshotStaleness` callers. No user-facing change.

**Part 2 — the map, single lens.** The kind and built-in (F1), docs, route,
index fix, icon, sidebar, the `map-screens` palette command, `Canvas` props
and node types, `ScreensMap`, `ScreensCanvas`, `WallCamera`, frame/shot/
header/marker/jump nodes, the bar with platform lens only, `screensLens`
persistence, empty and notice states, frame click → panel, the panel adopting
covering-acceptance staleness. Tests: `tests/schema/maps.test.js` (three
built-ins, listing order, `KIND_DEFAULTS.screens`, root ignored for
`screens`), `tests/mcp/run-mcp-tests.js` (5 maps; `get_map screens` returns
flows and views and no edges), `tests/app/command-palette.test.js` (catalogue
reaches `/maps/screens`; `"screens"` → Screens; the synonym probes at `:97`,
`:126-130` and `:136-139` move to `"pages"`/`"page"` → Views), `tests/app/screen-wall.test.js` (+
`computeMapCounts(SCREENS)` equals flows + views drawn, 0 edges, under All,
Admin and Pebbles scopes). Visual check (Playwright) at 1440, 900 and 390
widths, both themes, and the performance check. Must not touch: the Journey map
and canvas, `PlatformVariants.tsx`, `ViewNode.tsx`, `FlowNode.tsx`,
`MapEditorDialog.tsx`, panel descriptor kinds.

**Part 3 — side by side and gaps only.** Side-by-side frame rendering, the
"Side by side" option, per-platform header counts, the gaps switch, count and
fading (non-gap frames, markers and tiles at 15% opacity and greyscale, still
clickable; inside a kept side-by-side frame, non-gap rows at 35%),
`screensGapsOnly`, I/W/A. Tests: `test:keyboard-shortcuts` (row text), the wall
suite (already covers side layout and gaps). Must not touch: selection, the
inspector, the palette.

**Part 4 — inspector and touch reveal.** Selection, `ScreenInspector`,
`WallChipNode` and touch edges, Escape, arrow navigation and the `wall-move`
row, `?node=` cold-load framing. Tests: `test:keyboard-shortcuts`; the wall
suite already covers chips and neighbours. Visual check of selection with a
panel open and at 390px. Must not touch: `lib/utils/panel-stack.ts`, the panel
descriptor union, the palette.

**Part 5 — views and flows in ⌘K.** `buildNodeCommands`, `searchOnly`,
`NODE_PENALTY`, `limitSearchOnly`, the `node` target, `onNode`,
`usePageNodeHandler`, the layout's node rows, the Screens map's handler.
Tests: `tests/app/command-palette.test.js` — idle list excludes node rows;
"settings" ranks the page above a view titled Settings; an exact view title
beats a page prefix; an id finds its node; six rows per group at most; hints.
Must not touch: the wall model, `Canvas`.

## Lab Notes

Molecule `arkaik`. Part 1 changes nothing a user sees: no note, label
`no-lab-note`. The self-map has no node for the Screens map itself; adding one
is a separate seed change, so `nodes:` lists only ids that exist today in
`seed/arkaik-self-map.json`. After opening each PR, read its comments for the
reminder's verdict.

Part 2:

```yaml
en:
  title: "Screens: every screen, flow by flow"
  summary: "A new Screens map lines up each flow's real screenshots, one platform at a time, so you can see what is actually live. Missing shots show up as ghost frames that say why."
fr:
  title: "Screens : tous tes écrans, flow par flow"
  summary: "Nouvelle carte Screens : chaque flow devient une bande de vraies captures, plateforme par plateforme, pour voir ce qui est vraiment en ligne. Une capture manque ? Un cadre fantôme te dit pourquoi."
nodes: [V-maps-index, F-browse-maps]
suggested:
  molecule: arkaik
  type: feature
  tags: [maps, screenshots]
```

Part 3:

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

Part 4:

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

Part 5:

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

## Open questions

Each has a default this spec already uses, so work can start.

1. **Which flows get a strip (F3).** The Journey's order covers 8 of 10
   Pebbles flows and 5 of 38 self-map flows. *Default:* every flow in scope;
   Journey-reached ones first in Journey order, then the rest in bundle order.
2. **Staleness through covering acceptances (F4).** Without it, a deploy or a
   merge never marks a covered view's shot stale, on the wall or in the panel.
   *Default:* extend the one shared rule (part 1), and have the panel use it
   too (part 2).
3. **Where lens and gaps are remembered (F8).** The other maps store display
   in the bundle, shared by every viewer. *Default:* per viewer, in the browser,
   through `useDisplayPreferences`; nothing written to `map_display`.
4. **A scope with views but no flows (F11).** *Default:* show the "Not in a
   flow" strip with a line pointing to the Journey map; the empty state only
   when there are no views either.
5. **Choosing a view or flow in ⌘K outside the Screens map.** *Default:* open
   its panel on the current page; on the Screens map, fly to it.
