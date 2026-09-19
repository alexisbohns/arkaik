# Playlist as a timeline — design

**Date:** 2026-09-19
**Surface:** the Flow panel's Playlist region (`components/panels/PlaylistEditor.tsx`,
`components/panels/PlaylistEntryRow.tsx`)

## The problem

The playlist editor renders every entry as a bordered card inside the Playlist
`PanelGroup`, which is itself a bordered region of a panel. Each card leads with
`entry.type` as its headline and demotes the node's title to small print, and
carries three always-visible icon buttons on the right — up, down, delete. A
condition or a junction nests whole lists inside that card with no way to shut
them, so one branching flow can push the rest of the panel off the screen.

Three consequences:

- **The order is invisible.** A playlist *is* an ordered sequence, and the only
  thing that says so is a muted `1` glyph with no rule connecting it to the next.
- **Borders inside borders.** The Changelog already removed this exact stack —
  "a bordered row inside a bordered release card inside a bordered section —
  three lids for one fact" (`app/project/[id]/changelog/page.tsx`).
- **Chrome that never rests.** Three buttons per row, on every row, whether or
  not anyone is reordering anything; and a destructive one among them, one
  mis-click from deleting a step.

## The shape

The Changelog's rail, applied to a sequence someone is editing rather than one
that already happened. The Findings board is the same rail's second use; this
is the third.

```
┌ Playlist ─────────────────────────── ⌄ ┐
│                                         │
│  ⟦1⟧  Sign-in screen              view  │
│   │   V-signin                          │
│   │                                     │
│  ⟦2⟧  [∨] [ Has account?   ]  2 branches · 4 entries
│   │       Yes                           │
│   │        ⟦1⟧ Home                app  │
│   │       No                            │
│   │        ⟦1⟧ Sign-up          onboard │
│   │                                     │
│  ⟦3⟧  Checkout                    flow  │
│       F-checkout                        │
│                                         │
│       + Add entry                       │
└─────────────────────────────────────────┘
```

## 1. Layout — the rail

Each `PlaylistEntryList` becomes an `<ol className="flex flex-col">`. Each entry
is an `<li className="group/row relative grid grid-cols-[auto_1fr] gap-x-3">`.

- **Rail column** — `flex flex-col items-center` holding the index tile and,
  below it, a `w-px flex-1 bg-border` connector. The connector is absent on the
  last entry of a list, which would otherwise trail into nothing.
- **Content column** — the row body. It carries the breathing room below each
  entry (`pb-4` on every entry but the last), *never* the `<li>`: a grid child
  stretches to its content box, so padding on the row would end the connector
  above the gap and leave the tiles unlinked. This is the Changelog's rule,
  restated here because it is the one thing that silently breaks the rail.

The per-row card (`rounded-md border border-border bg-card p-3`) is removed. The
rail carries the grouping instead.

The index tile reuses `ICON_TILE` from `components/journal/DeliverableHoverCard.tsx`
— a 24px rounded square — so the mark on the playlist rail cannot drift into a
third size of the same idea. Surface: `bg-muted text-muted-foreground`, plus
`text-xs font-semibold tabular-nums` for the digit.

### Row bodies

- **view / flow** — the node's title on line 1 (`text-sm font-medium`), the id
  muted on line 2, the species word muted and right-aligned on line 1. This
  inverts today's row, which leads with `entry.type` and demotes the title.
  A reference to a node that no longer exists shows `Missing node` in place of
  the title and keeps the id, so the dangling reference stays fixable.
- **condition / junction** — the collapsible bar (§4), then the nested lists.

Nested lists restart numbering at 1 — a branch is its own sequence — and keep
the existing `branchIndentClass` for depth.

`AddEntryControls` moves into the content column at the foot of each list, so it
lines up with the rows' text rather than with the rail.

## 2. The index menu

The index tile is a `Popover` trigger (`components/ui/popover.tsx`), labelled
`Entry 2 of 5 — position and remove`. Its content:

```
Move to position  [ 2 ]   (1–5)
────────────────────────────────
🗑  Remove entry
```

- The number field defaults to the entry's current position, clamps to `1..n`,
  and commits on Enter or on blur, closing the popover. Escape closes without
  moving. Non-numeric input is ignored.
- Position is **within the sibling list only**. Moving an entry inside a
  condition's `Yes` branch renumbers that branch, not the flow.
- `Remove entry` is the destructive item.

The per-row trash button disappears; this is now the only way to remove an
entry. Junction *cases* keep their own trash button: a case is not an entry on
the rail, and its removal has always lived on the case's own bar.

## 3. Reorder controls

`↑` and `↓` are absolutely positioned over the rail column — `↑` centred above
the tile, `↓` centred below it — as `size-5` ghost buttons on a `bg-background`
backdrop so they stay legible over the hairline connector. Because they overlay
the rail rather than sitting in the flow, **revealing them shifts nothing**,
which is the whole point of moving them off the row.

Reveal rules:

- `opacity-0` at rest, `group-hover/row:opacity-100` on pointer hover.
- `group-focus-within/row:opacity-100` — the buttons stay in the DOM and stay
  tabbable, so focus reveals them and the keyboard path comes for free.
- **Touch:** the list holds one `activeIndex` in state; a click anywhere on a
  row sets it, and that row gets the same reveal. Harmless on desktop, where
  hover has already done the job.

The `↑` is **absent** on the first entry and the `↓` on the last — not disabled.
A greyed-out button that only appears on hover is noise announcing its own
uselessness.

## 4. Collapsible branches

Condition and junction rows wrap their nested lists in `Collapsible`
(`components/ui/collapsible.tsx`, the same primitive `PanelGroup` uses),
`defaultOpen` true — nothing that is visible today disappears on first paint.

**The trigger is the chevron and the count, not the whole bar.** The label is an
`Input`, and a control inside a `CollapsibleTrigger` is exactly the
button-inside-a-button that `PanelGroup`'s own doc comment rules out: invalid
HTML, undefined AT behaviour, and an inner control whose clicks the outer
trigger swallows. Keeping the trigger narrow is what lets inline label editing
survive the change.

```
⟦2⟧ [∨] [ Has account?          ]   2 branches · 4 entries
```

The count summarises direct children, summed across branches or cases:

- condition → `2 branches · N entries`
- junction  → `N cases · M entries`

so a shut row still says how much is inside it.

## 5. Structure

`PlaylistEntryRow.tsx` is 540 lines before this change and the change adds four
concerns. Split into `components/panels/playlist/`:

| File | Holds |
| --- | --- |
| `PlaylistEntryList.tsx` | the `<ol>` rail, ordering handlers, `activeIndex` |
| `PlaylistEntryRow.tsx` | the per-species row bodies |
| `PlaylistIndexMenu.tsx` | the tile and its popover |
| `PlaylistReorderControls.tsx` | the two absolute arrows |
| `DebouncedLabelInput.tsx` | moved verbatim, comments included |
| `AddEntryControls.tsx` | moved verbatim |

`DebouncedLabelInput`'s commit/anchor/pending dance travels **intact**. Its
comments document a bug that was fixed once (characters reverting mid-type,
out-of-order remote writes) and they are the reason it will not come back.

### Not doing

No shared `<Rail>` component across Changelog, Findings and Playlist. Three call
sites with different semantics — `ol`/`li` here and on the Changelog, plain
divs on the board; different marks; different hover behaviour — is not yet a
component. Extracting it is a separate call, made when the third use has settled.

## 6. Error handling

Unchanged. Every write still goes through `PlaylistEditor.persistEntries`, which
rebuilds `metadata.playlist` and hands the whole node to the provider, and
toasts on failure. The cycle guard on adding a flow is untouched.

## 7. Testing

Nothing in `tests/` asserts this markup, so there is no source-shape test to
break (`grep -rl PlaylistEntryRow tests/` is empty).

Extract the two pure helpers into `lib/utils/playlist.ts` and unit-test them in
the fast CI job — no database, no DOM:

- `moveEntry(entries, from, to)` — the splice, including the no-op cases
  (out of range, `from === to`).
- `countBranchChildren(entry)` — the `{ branches, entries }` / `{ cases, entries }`
  shape behind the collapsed row's count.

Visual verification through the scratchpad Playwright route, importing a bundle
whose flow has a condition and a junction.
