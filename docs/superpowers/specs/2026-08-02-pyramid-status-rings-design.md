# Pyramid status rings — card & list views

**Date:** 2026-08-02
**Status:** Approved, ready for planning

## Problem

The Pyramid page (`/project/[id]/pyramid`) renders 30 value-element cards, each carrying a
three-row stack of per-platform status bars. That is 90 bars on one page, plus a platform chip
row that re-renders all of them. The page reads as a wall of horizontal lines: the per-platform
status line is too heavy to scan, and the value element — the thing the page is *about* — is a
`size-4` icon next to a label.

The Overview dashboard's "Value pyramid" mini-card has the same problem in miniature: four tier
rows × three platform bars = twelve bars.

## Intent

Make an element's delivery legible **at a glance**: a large value icon, and four radial rings —
global, Web, Android, iOS — replacing the bar stack. Give the page two densities (cards and list)
and a filter that admits the page's real shape: most of the 30 elements are unserved most of the
time.

## Decisions record

| Question | Decision |
|---|---|
| Chart library | **None.** Hand-rolled SVG. TanStack Charts is pre-alpha (0.3.1, "not ready for production"); TanStack React Charts is beta and X/Y-only, no radial. shadcn charts means adding Recharts (~500KB) for four 46px rings, into a repo with zero chart dependencies. A ring is ~40 lines of SVG. |
| Page density | **Two views** — card grid and list rows — behind a view switcher, matching the idiom already used for other entity kinds. |
| The 30-element problem | **Three-step filter**: `empty only` · `all values` · `addressed only`. Default `all`. |
| Tier grouping | **Kept** in both views. |
| Platform chip row | **Removed.** All three platforms are permanently visible, so the filter has nothing left to do. |
| Overview mini-card | **Also gets rings** — four tier rows, each with the four-ring set. |
| Arc order | **Rings win.** The shared segment sort becomes lifecycle-descending with `blocked` pinned last; existing bars adopt it. One order everywhere, and no ring opens on a red arc at 12 o'clock. |
| Ring colors | The existing `STATUS_STYLES` table, extended with a `stroke` key. No new palette. |

## Design

### 1. Shared foundation

Both changes exist so status color and status order are single-sourced.

**`lib/utils/platform-status.ts`** — the module-local `sortStatusesDescending` (which sorts by
`STATUS_ORDER` descending, and therefore leads with `blocked` at order 7) is replaced by an
exported display comparator: lifecycle-descending with `blocked` pinned last.

```text
Live → Releasing → Development → Prioritized → Blocked
```

`getPlatformRollupSegments` uses it. That function's only consumer is `PlatformGaugeList`, so the
new order reaches all six of its call sites — Pyramid, Overview ×2, FlowNode, NodeDetailPanel,
NodeCard — from a single edit. Existing bars visibly re-order; nothing breaks, and no current test
asserts the old order.

**`components/graph/nodes/node-styles.ts`** — `STATUS_STYLES` gains a `stroke` key
(`stroke-green-500`, `stroke-red-500`, …) beside the existing `badge` and `dot`. One table drives
text color, dot color, and arc color.

**New pure helper** in `platform-status.ts`:

```ts
getRollupTotalSegments(rollup, presetId?): StatusSegment[]
```

Same shape as `getPlatformRollupSegments`, summed across every platform. This feeds the global
ring. Both functions return the segment type, which is extracted and exported so ring and bar
share it.

### 2. `StatusRing` — the primitive

`components/graph/nodes/StatusRing.tsx`.

An SVG circle at `r = 15.9155`, whose circumference is `2πr ≈ 100`. `strokeDasharray` therefore
takes **literal percentages** — no arc math at the call site. A muted track circle underneath, one
arc per non-zero segment, `strokeLinecap="round"` and a small dash gap so adjacent statuses stay
distinguishable. The group is rotated -90° so the first arc starts at 12 o'clock.

```text
props: { segments, size: "sm" | "lg", label, children }
```

`children` is the center content — a number or an icon. An all-zero segment list renders the track
alone, muted, which is how an unserved element reads.

Sizes: `sm` ≈ 30px (list rows, Overview), `lg` ≈ 46px (cards).

### 3. `PlatformRingSet` — the four rings

`components/graph/nodes/PlatformRingSet.tsx` — beside `PlatformGaugeList`, the idiom it mirrors,
because both the Pyramid page and the Overview card consume it. Global · Web · Android · iOS, in
that order.

```text
props: { rollup, count, size, label }
```

- **Global ring** — segments from `getRollupTotalSegments(rollup)`; center is `count`. The Pyramid
  passes `element.acceptanceCount`, which the aggregation already computes; the Overview passes
  its tier total.
- **Platform rings** — segments from `getPlatformRollupSegments(rollup, id)`; center is
  `PLATFORM_ICONS[id]`.

Each ring is the trigger of a Radix `HoverCard` (`components/ui/hover-card.tsx`, already present
and already used by `EntityBadges` / `RefBadges`) wrapping a shared popover.

### 4. `StatusBreakdownPopover`

`components/graph/nodes/StatusBreakdownPopover.tsx`. One component, two data sources.

- **Header** — platform icon + platform label, or "All platforms" for the global ring.
- **Body** — one line per counted status, in the shared display order: `STATUS_ICONS[status]`
  tinted with `STATUS_STYLES[status].badge`, the status label, the count, and the percentage of
  the ring. Zero-count statuses are omitted.
- **Footer** — platform rings: "N acceptances on Android". Global ring: "N acceptances ·
  M platform statuses", since one acceptance contributes one status per applicable platform and
  the global arcs count statuses, not acceptances.
- **Empty ring** — a single muted line instead of a body.

### 5. The two views

`app/project/[id]/pyramid/page.tsx` becomes composition. New components under
`components/pyramid/`:

| Component | Role |
|---|---|
| `PyramidToolbar` | Three-step filter + view switcher. |
| `PyramidTierGroup` | Tier header (color bar, label, element/addressed counts) wrapping either view. |
| `PyramidElementCard` | Grid card: large `ValueIcon`, label, description, ring set. |
| `PyramidElementRow` | List row: icon, label, inline description, right-aligned ring set. |

Both element components link to `/project/[id]/acceptances?value=<id>`, preserving today's
click-through. Unserved elements render dimmed in both views.

The tier color bar uses `VALUE_TIERS_CONFIG[].color`, which already exists and is currently unused
by the Pyramid page.

### 6. Filter semantics

| Step | Predicate |
|---|---|
| `empty` | `acceptanceCount === 0` |
| `all` (default) | — |
| `addressed` | `acceptanceCount > 0` |

Applied within each tier. A tier whose elements all filter out hides its group entirely rather
than rendering an empty shell.

View mode and filter step live in `useState` on the page, matching the Library page. Not URL
state — the Pyramid page has none today, and adding it is a separate concern.

### 7. `SegmentedControl`

`components/ui/segmented-control.tsx`, extracted from the inline control at
`components/library/LibraryFilterBar.tsx:40-69`. Generic over an option id, rendering an
`aria-pressed` button per option with icon + label.

Three consumers: the Pyramid view switcher, the Pyramid three-step filter, and `LibraryFilterBar`
refactored onto it — the extraction is only worth doing if the original adopts it.

### 8. Overview mini-card

`components/overview/PyramidCard.tsx` keeps its four tier rows and its `mergeRollups` aggregation,
but swaps `PlatformGaugeList` for `PlatformRingSet` at `sm`. The center number becomes the tier's
acceptance total, replacing today's `served/total` text. Twelve bars stacked three-deep per tier
become sixteen rings on one line per tier.

### 9. Removals

- The `All · Web · iOS · Android` chip row and the page's `platform` state.
- `PlatformGaugeList` is **not** deleted. Of its six call sites, this work replaces two (the
  Pyramid page and the Overview `PyramidCard`); the remaining four — `FlowNode`,
  `NodeDetailPanel`, `NodeCard`, `PlatformGaugesCard` — keep it.
- `computePyramidAggregation`'s optional `platform` parameter **stays**. The page stops passing
  it, but it is a tested pure API the MCP/CLI can serve.

## Testing

Every interesting behavior here is pure logic. `tests/app/pyramid.test.js` already runs in CI's
fast build job (`.github/workflows/ci.yml:107`) and its harness (`tests/app/load-pyramid.js`)
already transpiles `platform-status.ts`, so the assertions go there — no new npm script, no CI
wiring, and no database, which means they run locally.

New assertions:

1. The display comparator orders `[live, releasing, development, prioritized, blocked]`, with
   `blocked` last despite holding the highest `STATUS_ORDER`.
2. `getRollupTotalSegments` sums counts across platforms; totals equal the sum of per-platform
   totals.
3. Percentages are computed against the *total* for the global ring, not against any one platform.
4. An empty rollup yields all-zero segments with `ratio === 0` (and no division by zero).
5. `getPlatformRollupSegments` still returns one entry per counted status, including zeros, so
   ring and popover agree on what to skip.

Presentation — ring geometry, hover behavior, the filter predicates — is verified by running the
page.

## Out of scope

- URL/shareable state for the Pyramid view mode and filter.
- Any change to the acceptance matrix, delivery board, or graph nodes beyond the arc-order shift
  they inherit.
- Retro-populating values onto acceptances (tracked separately).
