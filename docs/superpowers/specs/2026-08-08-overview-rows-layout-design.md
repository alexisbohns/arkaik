# Overview: a second display — one row per section

**Date:** 2026-08-08
**Status:** approved, implementing

## Problem

The Overview is a two-column grid of nine cards. Each card is a small box with a
header and a cramped body, and the two richest readings — platform delivery and
the value pyramid — are squeezed into that box as stacked bars and four tier
rows. A wider row, heading on the left and content on the right, gives those two
readings the horizontal room to draw what they actually mean.

This is a *second* display, not a replacement: the grid stays, and the reader
picks.

## Design

### 1. The switch

`useOverviewLayout()` (lib/hooks) reads and writes `localStorage`
`arkaik:overview-layout`, values `"grid" | "rows"`, **default `"rows"`** — the
rows display leads the toggle and is what a reader with no stored preference
gets. It is a
global preference, not per project — a reader who prefers rows prefers them
everywhere. The stored value is read in an effect so the server render and the
first client render agree; the toggle is a `SegmentedControl` (the repo's
existing icon-segmented control) in `PageShell`'s `headerExtra`, beside the
version chip.

### 2. One shell contract, two shells

`OverviewLayoutContext` wraps the section list with the current layout.
`OverviewSection` becomes the dispatcher: it reads the context and renders
either today's card or the new `OverviewRow`. The seven cards whose body does
not change need no edit beyond a new `description` prop.

`OverviewRow` is `grid md:grid-cols-[minmax(0,18rem)_1fr] gap-6 py-6`, with rows
separated by `divide-y` inside one `PageSurface` and no per-row card chrome.
Left column: icon, title, description, the stats subtitle, and the jump-off
link. Right column: the body.

`PyramidCard` and `PlatformGaugesCard` read the same context to choose their
*body*, which is the only reason a card ever inspects the layout.

### 3. Platform wheel tiles

`PlatformWheelTiles` (components/overview) replaces the stacked gauge bars in
rows mode: one bordered tile per platform, holding that platform's status wheel
with the platform icon centred, the platform name, and its counted total.

To build the tile without re-deriving the hover card and the accessible name, a
single ring is extracted out of `PlatformRings` as an exported `PlatformRing`;
`PlatformRings` maps over it and the tile wraps it in its own chrome. Nothing
about either rendering changes.

**Below two platforms the section is absent**, in both displays, on
`platformAvailabilityShape`'s threshold — the same one that silences
`ParityCard`. This section exists to break delivery down *by platform*; with one
platform the breakdown is the total, which the Delivery snapshot already gives
in more useful detail. And `ParityCard`'s single-platform branch stops rendering
a heading over "nothing to compare": a silenced section is absent, not a row
spent explaining its own absence.

### 4. The 90° value pyramid

`ValuePyramidWheels` (components/overview) draws one wheel per value element,
fed by the `pyramidTiers` the page already computes.

Columns are **derived, not hardcoded**: a tier of `n` elements splits into
`ceil(n/2)` and `floor(n/2)`, or one column when `n === 1`. For today's
14/10/5/1 taxonomy that is 7+7 / 5+5 / 3+2 / 1 — the shape asked for — and it
survives a change to the taxonomy rather than silently mis-chunking. The split
lives in `lib/utils/pyramid.ts` as `splitTierColumns()` so a plain Node test can
pin it.

The wheels lay out as a `flex items-center` row, widest tier first and each
column vertically centred — a triangle pointing right. A tier's columns group
under a small label in the tier's colour. Each wheel is a `StatusRing` over the
element's aggregate segments (`getRollupTotalSegments`) with the value icon
centred, dimmed at `acceptanceCount === 0`, linked to the element's acceptances
and hover-carding its status breakdown.

The row scrolls horizontally, and its container pins `overflow-y: hidden`:
`overflow-x: auto` computes the cross axis to `auto` as well, which turns the
pyramid into a vertical scroll container that swallows every wheel event over
it — the page freezes under the cursor.

### 5. Copy

Nine one-line descriptions, one per section, saying what the section answers.
They live with their cards.

## Testing

`splitTierColumns` gets a unit test in `tests/app/pyramid.test.js` (the existing
DB-free harness). The layout components are verified statically and by a visual
checklist handed to Alexis — there is no browser driver in this environment.

## Out of scope

- Any change to what the Overview computes. Every number is the same projection.
- Row layouts for other pages.
- Server-persisted layout preference.
