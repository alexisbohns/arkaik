# Right rail + Changelog master-detail — design

**Date:** 2026-11-08
**Status:** approved in conversation, ready for a plan

## Why

The Changelog's filters sit in a toolbar band across the top of its surface, and
its milestones are a long stack of rows. Two changes, inspired by Material 3's
navigation rail:

1. A **right rail** — a narrow column at the window's right edge that carries a
   page's filters and view toggles, built as a reusable primitive so other
   pages can adopt it later. The Changelog is the first adopter.
2. A **master-detail Changelog** — the list of releases on the left, the
   selected release's content on the right.

The reference implementation for the rail's *contents* is Krabs
(`~/code/krabs/src/components/filter-rail.tsx`, `chrome.tsx`). Its *placement*
is not ported: Krabs' rail is a `position: fixed` floating pill, and Arkaik's
panel stack opens on the right — exactly where a floating rail would sit. Krabs
needs a `body:has([data-panel-open])` translate hack to dodge its own panel;
Arkaik's rail is in the layout flow instead, so it never collides.

## Decisions taken

| Question | Decision |
| --- | --- |
| Where the rail sits | **Window edge**: a column to the right of the panel grid, outside the surface *and* the panels. Panels open to its left; it never moves. |
| Rail look | Strip on the page background (no fill of its own, like the panel grid's gutters); controls clustered in `RailGroup` pills — `bg-card rounded-2xl p-1.5`. |
| Filter controls | Year/Month keep their Select menus (`FilterSelectTrigger`, content opening `side="left"`). The details toggle stays a toggle. Krabs' popover-per-filter isn't needed — Krabs has no single-select menus. |
| Narrow master-detail | Below a **container** width the left list is replaced by a **release picker** (a Select) on top of the content. Container query, not viewport: an open node panel halves the surface on a wide screen too. |
| Selected release | `?release=<version>`, or `?release=unreleased`. Absent → the first row. A selection the filters hid → the first visible row. |
| Shipping | A two-part stack (`gh stack`), one Lab Note per part. |

## Part 1 — the rail, and the Changelog's filters in it

### `components/layout/RightRail.tsx` (new)

Three exports, ported from Krabs' `Chrome` / `ChromeItem` / `chromeItemClass`
onto Radix (`asChild` instead of Base UI's `render`):

- **`RightRail({ label, children })`** — a `<nav aria-label={label}>`,
  `flex w-15 shrink-0 flex-col items-center gap-3 py-3 pr-3` (it sits after
  the panel grid, whose own `p-3` already gives the left gutter). Buttons
  anchor at the top. Provides a `RailSideContext` with `"left"` so every
  tooltip and menu inside opens away from the window edge.
- **`RailGroup({ label?, children })`** — `flex flex-col gap-1 rounded-2xl
  bg-card p-1.5`; a `role="group"` with `aria-label` when labelled.
- **`RailButton({ icon, label, active?, pressed?, onClick })`** — a 36px
  `rounded-xl` icon button wrapped in a `Tooltip` whose content opens
  `side="left"`. Skin: `railItemClass(active)` — active is
  `bg-secondary text-secondary-foreground`, idle is
  `text-muted-foreground hover:bg-accent/50 hover:text-foreground`. `pressed`
  sets `aria-pressed` (toggles); a plain action (Reset) omits it.
- **`railItemClass(active)`** — exported so a Select trigger can wear the same
  skin.

### `FilterSelectTrigger` gains `tooltipSide`

The trigger's tooltip currently opens on Radix's default side (top). Add an
optional `tooltipSide?: "top" | "right" | "bottom" | "left"` forwarded to
`TooltipContent side`, and an optional `variant?: "band" | "rail"` — `"rail"`
swaps the bordered band skin for `railItemClass(active)`. Default behaviour is
unchanged for every existing band.

### `PageShell` gains `rail?: ReactNode`

When set, the shell's root becomes `flex h-full w-full flex-row`: the
`ProjectPanels` grid (`flex-1 min-w-0`), then the rail. No rail → the markup is
exactly today's. The rail lives in `PageShell` rather than the project layout
because a page already owns its shell; a portal or context registry would be a
second mechanism for the same thing.

### `components/journal/ChangelogRail.tsx` (replaces `ChangelogFilterBar.tsx`)

Same props as `ChangelogFilterBar`, plus `onReset`. Renders:

- **"When" group** — Year menu, Month menu (both `FilterSelectTrigger
  variant="rail" tooltipSide="left"`, `SelectContent side="left"`), and a
  **Reset filters** `RailButton` (`FilterXIcon`) only while a period is set.
- **"View" group** — the details toggle as a `RailButton` with `pressed`, the
  same glyphs and labels as today, and the same `toggle-expand` shortcut
  registration (`useShortcut("toggle-expand", …, GUARDED_HOTKEY)`).

`ChangelogFilterBar.tsx` is deleted; nothing else imports it.

### Changelog page wiring

`PageShell rail={isEmpty ? undefined : <ChangelogRail … />}`; `PageSurface`
loses its `toolbar`. The content (rows of `SectionRow`) is otherwise unchanged
in Part 1. A project with an empty journal gets no rail — the same rule that
hides the toolbar today.

### Part 1 verification

- `npx tsc --noEmit`, `npm run lint`, `npm run generate` (clean tree after),
  `npm run test:keyboard-shortcuts` (the `toggle-expand` registration moved
  file).
- Visual: wide, with a node panel open, and at phone width (Playwright in the
  scratchpad, bundle imported through `/projects`).

## Part 2 — releases on the left, the release on the right

### Pure logic: `lib/utils/changelog-releases.ts` (new)

DOM-free, tested by `tests/app/changelog-releases.test.js` (transpiled like
`changelog-period.test.js`; the module takes no `@/` imports so no alias table
needs touching).

- `UNRELEASED_KEY = "unreleased"`.
- `releaseKeyOf(entry)` — `"unreleased"` for the unreleased entry, the version
  otherwise.
- `resolveSelectedRelease(keys: readonly string[], requested: string | null):
  string | null` — `requested` if it is in `keys`; otherwise `keys[0]`; `null`
  when `keys` is empty.

### `components/journal/ReleaseList.tsx` (new)

The left column. One button per entry — "Unreleased" first when present, then
milestones newest first — showing the label (version or "Unreleased"), the
date line (`formatEventDate` + platform), and the deliverable count. The
selected row gets `bg-accent text-foreground` and `aria-current="true"`. A
`<nav aria-label="Releases">` with an `<ol>`.

### `components/journal/ReleasePicker.tsx` (new)

The narrow fallback: a `Select` whose items are the same entries, labelled
"Unreleased" / version, value = release key.

### `components/journal/ReleaseDetail.tsx` (new)

The right column: a `SectionHeading` (title, icon, subtitle, description — the
same values the `SectionRow` heading carries today) above the
`DeliverableTimeline`. `DeliverableTimeline` moves out of the page file into
`components/journal/DeliverableTimeline.tsx` unchanged.

### Changelog page

- Entries = `[unreleased?, ...milestones]`, each `{ key, title, icon, subtitle,
  description, deliverables }`, all built from the existing memos.
- Selected key = `resolveSelectedRelease(keys, searchParams.get("release"))`.
  Selecting writes `?release=` through `useQueryWriter` (replace, no scroll).
  A selection that equals the first key still writes it — a link should say
  what it shows.
- Layout (inside `PageSurface fill`):

  ```
  <div class="@container flex h-full min-h-0 flex-col">
    <div class="@3xl:hidden border-b p-3"><ReleasePicker/></div>
    <div class="flex min-h-0 flex-1">
      <ReleaseList class="hidden @3xl:flex w-64 shrink-0 overflow-y-auto border-r"/>
      <ReleaseDetail class="min-w-0 flex-1 overflow-y-auto p-4 md:p-6"/>
    </div>
  </div>
  ```

  `@3xl` = 48rem of *surface* width: a lone surface on a laptop is two-column;
  with a node panel open it falls back to the picker.
- Empty / nothing-in-period states keep their current sentences and render in
  place of the two columns.

### Part 2 verification

- `npm run test:changelog-releases` (new script) plus everything from Part 1.
- Visual: the same three widths; `?release=` survives a reload; a filter that
  hides the selected release falls back to the first visible one.

## Out of scope

- Adopting the rail on any other page (Delivery, Library, Acceptances…).
- Persisting the Changelog's filters across visits.
- A phone layout for the rail beyond "it stays, 60px wide".
- The phone sidebar regression noted on #552.
