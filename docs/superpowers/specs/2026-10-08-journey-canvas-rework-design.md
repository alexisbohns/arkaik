# Journey canvas rework — design

**Status:** approved in principle 2026-10-08 ("do what's best"); ships as a
four-part stack. Modelled on the Support routes graph in the local `sandbox`
project (`src/app/support/{treeLayout.ts,RouteNode.tsx,SupportRoutesPage.tsx}`).

## Problem

Measured with Playwright against the dev server on the self-map and the
Pebbles seed (2026-10-08):

1. **Every expand/collapse re-lays out the whole map.** ELK layered runs from
   scratch on each toggle and re-centres every parent over its children. On
   Pebbles, expanding *Manage Collections* moved all 25 cards; *Home* jumped
   476px; expanding *Onboarding* slid the flow itself 320px. Nothing is
   anchored, so the map wobbles under the cursor.
2. **Top-level flows are mutually exclusive.** `toggleFlow` collapses the
   open one when another opens, often far off-screen.
3. **The viewport never follows an expansion**, so the new cards land below
   the fold and the only feedback is a chevron flip.
4. **Opening a panel fires two camera moves that fight.** A node click runs
   `setCenter` (250ms); the panel's grid resize then fires
   `onLayoutChange → fitSignal → fitView` (after 150ms, for 300ms). Measured
   zoom: 0.32 → 0.34 → 0.29 → 0.17. The map ends fitted to everything, at
   an illegible scale. Same on the System map, and again on panel close.
5. **Every page load fits twice.** Nodes render at `{0,0}` until ELK answers,
   so the initial `fitView` frames a point at zoom 2, then the layout lands and
   a second fit animates down to 0.34.
6. **Two click grammars.** A flow card's body is the expand toggle (and stops
   propagation, so React Flow's `onNodeClick` never fires for flows), the
   chevron is a decorative icon and the panel is the small ⓘ. A view card's
   body opens the panel.
7. **Layout is async and estimate-driven.** `elk-layout.ts` hand-sums card
   heights ("keep in sync with components"); `Canvas` separately echoes
   measured sizes for the minimap only.
8. **Visual ids collide across branch arms.** `createVisualNodeId(node,
   parentFlow, entryIndex)` carries no branch context, so the same flow at the
   same index in two arms is one card with two incoming edges. The self-map's
   *Create Project* is fed by both the signed-in and signed-out junctions
   (7 references → 4 cards), and the case labels pile up on it. The builder's
   own doc promises "visual node duplication for reuse".

The vertical "drop" of a flow Alexis saw on Pebbles was not reproduced with
the stock seed; in the top-down direction the self-drift is horizontal. The
redesign removes the whole class rather than that one symptom.

## Decisions

1. **The Journey is laid out by a pure, synchronous block layout**, not ELK.
   ELK stays for the System map (organic / tiered), untouched.
2. **Several flows may be expanded at once.** The exclusivity rule goes.
3. **One click grammar on every card: click = open the panel.** Folding is a
   dedicated handle under the flow card.
4. **The camera follows the click, never the panel.** Opening or closing a
   panel re-fits nothing; the clicked node is centred in whatever canvas is
   left, at the current zoom. `fitView` happens on first paint, on the
   Controls button, and when a map replaces its graph (the System map's
   layout-mode switch) — never because the canvas changed size.
5. **An expansion keeps the toggled card where it is on screen** and pans only
   to reveal its new subtree.
6. **Visual ids carry the whole entry context**, so arms never merge.

## The layout

### Structure comes from the builder

`buildJourneyGraph` already walks the journey in the right order; it now also
returns the structure it walked, as a block tree, so the layout never has to
re-infer sequences and arms from the edge list:

```ts
export type JourneyBlock =
  /** A card; `children` are the blocks hung under it (compose children of a
      closure node, or the playlist sequence of an expanded flow). */
  | { kind: "node"; id: string; children: JourneyBlock[] }
  /** Playlist entries one after the other. */
  | { kind: "sequence"; items: JourneyBlock[] }
  /** The synthetic branch card, its arms side by side. */
  | { kind: "branch"; id: string; arms: JourneyBlock[] };

export interface JourneyGraph {
  nodes: Node[]; edges: Edge[];
  /** One root block per journey root (one with an explicit anchor). */
  roots: JourneyBlock[];
}
```

Rules, matching the walk that exists today:

- A closure node's children are its compose children in BFS discovery order
  (views chain onward; flows are cards). A node reached a second time belongs
  to its first parent; the second compose edge is drawn, not laid out.
- An expanded flow's single child block is its playlist `sequence`.
- A `view` or collapsed `flow` entry is a `node` leaf. An expanded `flow`
  entry is a `node` whose child is its own sequence.
- A condition/junction entry is a `branch` whose arms are sequences (an empty
  arm is an empty sequence). The entry after the branch is simply the next
  item of the enclosing sequence; the join edges from the arm ends are drawn,
  not laid out.

### `layoutJourney` — `lib/utils/journey-layout.ts`

Pure. Input: `roots`, a `sizeOf(id) → {width,height}`, `direction` (`DOWN`
default, `RIGHT` by axis swap — kept in the module, not yet exposed in the UI).
Output: `Map<id, {x,y}>`.

Computed in abstract (main, cross) axes — main is the reading direction:

- **node**: its card, then its child blocks in a row along the cross axis
  (`GAP_CROSS = 40` apart), `GAP_MAIN = 48` below the card. Block cross-size
  = max(card, row); the card is centred over the row.
- **sequence**: items stacked along the main axis, `GAP_MAIN` apart, each
  centred on the sequence's cross-centre. Cross-size = widest item.
- **branch**: the branch card, then its arms as a row (as a node's children);
  the card centred over the arms.

Every card is 240 wide, so a sequence of cards is a straight line; the only
things that move on a toggle are the items after the toggled flow in its own
sequence (down, by the subtree's height) and the siblings of its enclosing rows
when its cross-size changes (re-centring, by half the delta). Nothing else.

Sizes: `lib/utils/journey-card-size.ts` holds today's flow/view/branch
estimates (moved out of `elk-layout.ts`, which imports them for the System
map's view cards). `Canvas` already collects React Flow's dimension changes for the
minimap; it reports them upward through a new `onMeasured(sizes)` prop, and
`JourneyCanvas` lays out with `measured[id] ?? estimate`, re-running
synchronously when a measurement differs — so a wrong estimate costs one
frame, never an overlap.

### Where the layout runs

`JourneyCanvas`: `useMemo(() => layoutJourney(graph.roots, sizeOf), [graph,
measured])`. No worker, no `ready` flag, no placeholder pass, no `onLayout`.
The first paint already has positions, so React Flow's `fitView` prop frames
the right thing once.

The auto-expansion of the first top-level flow becomes render-derived in
`JourneyMap`: `expandedFlows = touched ?? defaultExpansion(topLevelFlowIds)`,
where `touched` is `null` until the first toggle. The prune effect and the
auto-expand effect go with it. This is also what makes decision 2 trivial:
`toggleFlow` is a plain set toggle.

## Interaction

### Flow card (`FlowNode`)

- Body: `role="button"`, click and Enter/Space → `onOpenDetails`. No
  `stopPropagation`, so React Flow's `onNodeClick` fires as it does for views.
  The chevron and the ⓘ button are removed. `cursor-pointer`.
- **Fold handle**, a `<button class="nodrag nopan">` straddling the card's
  bottom edge, centred, 22px tall: `−` when expanded, `+N` when collapsed,
  where N is the number of distinct nodes the playlist references
  (`collectReferencedNodeIds`). A flow with an empty playlist has no handle.
  `aria-expanded`, `aria-label` ("Show the N nodes under this flow" /
  "Collapse the nodes under this flow"); click stops propagation and calls
  `onToggle`. Folded, it is tinted like the sandbox's: the count must read as
  "something is hidden here".
- Branch cards and view cards: unchanged.

### Camera (`Canvas`, both maps)

- `Canvas` gains `focus?: { nodeId: string; version: number }`. When it
  changes, the canvas waits for the React Flow store's `width/height` to settle
  (120ms after the last change — the panel grid resizes synchronously on open)
  and runs one `setCenter(node centre, { zoom: getZoom(), duration: 300 })`.
  `handleNodeClick`'s own `setCenter` is removed.
- `JourneyMap` and `SystemMap` set `focus` from their `handleNodeClick` (the
  same place they call `openNode`) and stop passing `onLayoutChange={reframe}`.
  `fitSignal` stays on `Canvas` for the System map's layout-mode change and
  for anything else that genuinely changes the graph.
- Opening a node from anywhere else (a panel relation, the palette) does not
  move the camera.

### Expansion keeps its place (`JourneyCanvas`)

When `expandedFlows` changes, the canvas records the toggled flow's position
before and after the new layout and shifts the viewport by the delta
instantly, so the card stays under the pointer. Then, if the flow's block
(card + subtree) overflows the visible canvas along the main axis, it pans by
`min(overflow, distance that keeps the card's top 24px inside)` over 250ms.
Collapsing never pans.

## Visual ids

`createVisualNodeId(nodeId, contextKey)` → `${nodeId}@${contextKey}`, where
`contextKey` is the entry context the builder already threads
(`root:F-a:0:1:0`, `…:flow:1`). `getBaseNodeId` is unchanged; nothing else
parses the suffix once `JourneyMap.handleLayout`'s marker goes.

## Tests

- `tests/app/journey-layout.test.js` (new, in the journey-graph loader's
  module table): over Pebbles and the self-map, collapsed and with every flow
  expanded — no two cards overlap; a child row sits `GAP_MAIN` below its
  parent and its parent is centred over it; a sequence is a straight line;
  toggling a leaf flow leaves every node outside its sequence and its
  enclosing rows at the same position; `RIGHT` over transposed cards is
  the transpose of `DOWN` (cards are not square, so the direction only swaps
  which axis is which).
- `journey-graph.test.js`: golden counts re-pinned; the self-map's
  *Projects Actions Routing* arms produce distinct cards (no card has compose
  parents in two arms); `roots` reflects the walk (one root with an anchor,
  the branch's arms in authored order).
- Visual pass with Playwright in the scratchpad (profile already carries the
  Pebbles import): expand/collapse keeps the toggled card fixed on screen;
  a click centres the node once, at the same zoom, with the panel open;
  one fit on load.

## Stack

1. **`journey-layout-1-block-tree`** — builder emits `roots` and
   context-keyed visual ids; `journey-card-size.ts`; `journey-layout.ts`;
   tests. The canvas still runs ELK. Lab note: *fix* (arms no longer merge).
2. **`journey-layout-2-sync-canvas`** — `JourneyCanvas` lays out with the
   block layout, measured sizes override, derived auto-expansion, multiple
   expansion, keep-in-place + reveal. `docs/spec/maps.md` § layout updated.
3. **`journey-layout-3-fold-handle`** — `FlowNode` handle and click grammar.
4. **`journey-layout-4-camera`** — `Canvas.focus`, no re-fit on panel
   layout changes, both maps.

Out of scope, noted for later: animating card moves (the sandbox has none —
its smoothness is the locality this restores), exposing `RIGHT` journeys in
the UI, and the System map's layout.
