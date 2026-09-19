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

- **view / flow** — one line: the node's title (`text-sm font-medium`), a
  copy-id chip beside it, and the step's per-platform status at the right. This
  inverts today's row, which leads with `entry.type` and demotes the title.

  **The id is not written out.** A column of `V-…` slugs under a column of
  titles is the same fact twice, and the only thing anyone ever did with the id
  was copy it — so it lives on a `CopyIdChip` (the hash chip extracted out of
  `PanelHeaderEntityId`, since the two must not drift) revealed by the row on
  exactly the triggers the reorder arrows use. A reference to a node that is no
  longer in the graph is the one exception: there the id is the only identity
  there is, so it is spelled out beside `Missing node`.

  **The trailing slot is status, not species.** The word "view" or "flow"
  restated what the panel's own heading already implied; `PlatformStatusIcons`
  puts the platform's glyph in the status colour there instead — the mark the
  Library card and the acceptance rows already use — so a playlist read top to
  bottom says how far each step has got, and on which platform. It needs the
  surface's `ProductScope`, threaded `NodeDetailPanel` → `PlaylistEditor` →
  list → row, and optional the whole way down: a playlist handed no scope shows
  titles without marks rather than nothing.
- **condition / junction** — the collapsible bar (§4), then the nested lists.

Nested lists restart numbering at 1 — a branch is its own sequence.
`branchIndentClass`'s margin steps go away with the cards they were built for: a
margin inside a grid whose first column is the rail pushes the nested rail away
from whatever should be carrying it.

A **junction's cases are a rail of their own** — the same grid as the entry
rail, because a case is a thing the junction holds in exactly the way a step is
a thing the playlist holds, and drawing one as a rail and the other as a stack
of bordered boxes made a junction read as a different kind of object every time
you opened one.

```
⟦2⟧ Collection action?                    ⌄
    4 cases · 5 entries
    ◈ View collection               ← blue tile, mouse-pointer-click
    ┊   ⟦1⟧ Collection Detail          ▤  
    ┊   ⟦+⟧
    ◈ Create collection
    ┊   ⟦1⟧ Create Collection          ▤  
    ┊   ⟦+⟧
    ◈ Add case (dashed, blue)
```

- **The mark is a pointer clicking**, in blue at a tenth strength behind a
  full-strength glyph (`CASE_TILE`), the way the Changelog's ship and forge marks
  are built. Deliberately not the junction's own `SplitIcon`: the junction is the
  fork, a case is one road out of it, and repeating the fork on every road says
  "junction" five times and "which road" never.
- **Delete moved behind the mark.** A case's red trash can was the only
  destructive control left on the surface once the playlist's own moved into the
  index menu, and the loudest thing in the region by some distance. A gesture
  made once in the life of a case should not sit one stray click away for its
  whole life.
- **The connector is dashed**, and here that earns the ink the entry rail's last
  segment did not: a playlist is a sequence, a junction's cases are alternatives,
  and a solid line down them would claim an order that does not exist.
- **Add case is the rail's next position**, dashed like the entry rail's add tile
  and blue like the marks above it, so "add a case" and "add a step" are never
  the same button twice on one screen.
- **No rule around a case's entries.** They are a rail, the case rail is a second
  line beside them, and a `border-l` between the two would be a third. `NESTED`
  is gone.

A **condition's two branches** are a rail too — the case rail's twin, and for
the same reason:

```
⟦4⟧ Publish, or keep it as a draft?        ⌄
    2 branches · 1 entry
    ◈ YES                       ← ticket-check on a blue tile
    ┊   ⟦+⟧ No entries yet.
    ◈ NO                        ← ticket-x on a yellow tile
        ⟦1⟧ Pebble Drafts          ▤  
        ⟦+⟧
```

Dashed like the cases and unlike the steps: Yes and No are alternatives, and a
solid line down them would claim an order. **Only the first carries a
connector** — there is no third mark and no add tile, because a condition has
exactly two branches, always, so there is nothing here to grow. For the same
reason the mark is a `<span>` and not a `<button>`: it has no menu to open and
must not look as though it has.

Colour rides on the **tile**; the word beside it stays foreground. That is the
rule `DeliverableHoverCard` already states for its own marks — a blue word
beside a blue mark says it twice and reads worse doing it. `No` needs two shades
of yellow, light and dark, because yellow is the one hue in this palette whose
mid shades wash out on white.

The three rails are therefore one idea with three settings: **steps** numbered
and solid, **cases** blue and dashed, **branches** blue/yellow and dashed. What
changes between them is what the line claims — a sequence, or a set of ways out.

## 2. The index menu

The index tile is a `Popover` trigger (`components/ui/popover.tsx`), labelled
`Entry 2 of 5 — position and remove`. Its content:

```
Move to position  [ 2 ]   (1–5)
────────────────────────────────
🗑  Remove entry
```

- The number field defaults to the entry's current position, clamps to `1..n`,
  and commits on Enter or on the Move button, closing the popover. Non-numeric
  input is ignored. **Not on blur:** Radix closes on Escape by unmounting the
  input, so a blur commit would turn "never mind" into a move — the one outcome
  Escape exists to prevent. Reopening reads the entry's current position, never
  the last thing typed.
- Position is **within the sibling list only**. Moving an entry inside a
  condition's `Yes` branch renumbers that branch, not the flow.
- `Remove entry` is the destructive item.

The per-row trash button disappears; this is now the only way to remove an
entry. Junction *cases* keep their own trash button: a case is not an entry on
the rail, and its removal has always lived on the case's own bar.

## 2b. Adding a step

The old composer was a dashed box holding a species `Select` beside either a
node search or a label field — three controls, permanently open at the foot of
**every** list, including every branch of every branch. In a flow with one
junction and four cases that is five open composers for a playlist of six steps.

It collapses to the rail's add tile (§1) opening a popover with one `Combobox`:

```
┌────────────────────────────────┐
│ ⌕ check                        │
│────────────────────────────────│
│ ▤ Checkout          V-checkout │
│ ⛬ Checkout flow     F-checkout │
│ ＋ Create view "check"       ▤ │
│ ＋ Create flow "check"       ⛬ │
│────────────────────────────────│
│ ⑂ Condition   Yes / No branches│
│ ⑃ Junction  One branch per case│
└────────────────────────────────┘
```

**There is no species selector.** It was asking a question the search result
already answers: a row reading "Checkout · F-checkout" has said which species it
is. Views and flows are searched together — a playlist plays both — and the
species rides along as the icon `NodeCard` already uses for it.

**Everything is a row in the one list.** The matches, the create rows (one per
species, each appearing under `NodeSearchCombobox`'s existing rule: only once
something is typed that no node of that species answers to), and the two
branching shapes fixed at the bottom. A footer `<Button>` is precisely where the
arrow keys cannot reach — audit `shadcn-6`, the same finding that moved
`NodeSearchCombobox`'s own create affordance into its array — and because the
combobox wraps, one ArrowUp from the field lands on Junction.

**Nothing is offered until something is typed.** An unfiltered shortlist of six
out of a graph's several hundred views reads as a menu while behaving like a
coincidence, so the resting popover is the two branching rows and an invitation
to search. The rule above them is drawn only while there is something above to
separate.

**A branch takes the query as its label** when one was typed, and "Condition" /
"Junction" otherwise — you typed a name for a thing you did not find, and naming
it is the next thing you would have done. The row stays renameable in place.

A flow that would make the playlist eat itself still reports through
`onCycleBlocked` rather than vanishing from the list: a step you expected to
find and cannot is a worse puzzle than one that says why it refused.

`fuzzyScore` moves from `NodeSearchCombobox` to `lib/utils/search.ts`, since two
pickers now rank the same graph and a second copy would drift into a second idea
of what "best match" means.

## 3. Reorder controls

`↑` and `↓` are absolutely positioned over the rail column — `↑` centred above
the tile, `↓` centred below it — as `size-5` ghost buttons on a `bg-background`
backdrop so they stay legible over the hairline connector. Because they overlay
the rail rather than sitting in the flow, **revealing them shifts nothing**,
which is the whole point of moving them off the row.

Reveal rules — **exactly one row at a time**:

- `opacity-0` at rest, lit by hover and by `data-active`. Both are single-valued
  by construction: the pointer is over one row, and a tap moves the marked row
  rather than adding one.
- **Touch:** the list holds one `activeIndex`; a *touch or pen* press on a row
  sets it. A **mouse** press clears it instead — a mouse already has hover and
  has never needed the latch, and latching on any click left the row you last
  clicked lit while you hovered another.
- **Nothing reveals on focus inside the row.** It is the obvious third trigger
  and it is the wrong one: the index tile lives in the row, so clicking it and
  pressing Escape parks Radix's restored focus there and that row stays lit
  while the pointer lights another. `focus-within` does it; so does
  `:has(:focus-visible)`, because Chrome reads focus restored after a keypress
  as keyboard focus.
- The keyboard keeps its path regardless: the buttons stay in the DOM and stay
  tabbable, and each reveals *itself* on `focus-visible`.

**The group name is per depth — `group/row0` … `group/row3`, not one
`group/row`.** `group-hover/row:` compiles to `.group\/row:hover &`, a plain
descendant selector, so it matches *every* ancestor carrying the name rather
than the nearest. Rows nest inside rows here, so one shared name lit up the
arrows on every row inside a hovered one at once. Four names, written out in
full because Tailwind cannot see an interpolated one, then the name repeats:
a playlist five branches deep would bleed again, and nothing comes near it.

The `↑` is **absent** on the first entry and the `↓` on the last — not disabled.
A greyed-out button that only appears on hover is noise announcing its own
uselessness.

## 4. Collapsible branches

Condition and junction rows wrap their nested lists in `Collapsible`
(`components/ui/collapsible.tsx`, the same primitive `PanelGroup` uses),
`defaultOpen` true — nothing that is visible today disappears on first paint.

**The label is a `contentEditable` span, not an `Input`.** A bordered 36px field
made every branch row a head taller than the steps above and below it, with its
text starting a border and a padding to the right of theirs — the rail's whole
job is that a playlist reads as one column of steps, and a control announcing
"form field" on three of them broke the column into kinds. So all three labels
(condition, junction, and a junction case) are the same `text-sm font-medium` as
a step's title, lit on hover and focus rather than boxed all the time: the
editable-in-place pattern `NodeFields` already uses for the node title and
description, down to the `execCommand` paste.

`EditableLabel` keeps every line of the old debounce: the `draft` /`anchor` /
`committed` / `pending` machine, the adopt-from-outside rule that runs during
render, the commit-on-unmount. What changes is only that **React no longer owns
the text node** — a controlled `contentEditable` rewrites its child on every
keystroke and drops the caret to the start, so the DOM holds the text, `draft`
mirrors it, and the single effect that writes back fires only when `value`
forces a change from outside.

Two things this shape gets wrong if written the obvious way, both found in the
browser and both commented at the site:

- **Escape must update `draftRef` synchronously.** `blur()` fires `onBlur` in
  the same tick and `flush` reads the ref, which the mirroring effect has not
  run yet. Through `setDraft` alone, Escape reverted the text on screen and
  committed the abandoned edit anyway.
- **`:empty` never matches.** Chrome leaves a `<br>` in an emptied
  `contentEditable`, so the placeholder is driven by a `data-empty` attribute
  off the mirror rather than by `empty:before:`. (`NodeFields` carries the same
  `empty:before:` rule and the same silence — unfixed here, out of scope.)

**The trigger is the chevron alone, not the whole bar.** A control inside a
`CollapsibleTrigger` is exactly the button-inside-a-button that `PanelGroup`'s
own doc comment rules out: invalid HTML, undefined AT behaviour, and an inner
control whose clicks the outer trigger swallows. Keeping the trigger narrow is
what lets inline label editing survive at all.

**One caveat, on coarse pointers only.** `app/globals.css` bumps every
`contentEditable` to 16px below `pointer: coarse` so Safari does not zoom on
focus, and the label is `text-sm`. On a phone a branch label therefore sits 2px
larger than a step title beside it. Opting out with `.arkaik-keep-font-size`
would buy back the alignment and reintroduce the zoom; every other field in the
app takes the bump, and so does this one.

**The chevron sits at the END of the row**, where every other disclosure in the
app puts it — `PanelGroup`'s bars, the panel's own regions — and in the same
right-hand gutter as a ref row's species word and a case's delete. Leading with
it pushed the label a step right of every other row's text and left the rail's
numbers lining up with nothing.

```
⟦2⟧ [ Has account?                    ]  ∨
    2 branches · 4 entries
```

Nothing under the bar is indented past it: the label starts at the row's own
left edge, so the count and the branches start there too. The nesting is carried
by the rule down each nested list, not by a step that would now align with
nothing.

The count summarises direct children, summed across branches or cases:

- condition → `2 branches · N entries`
- junction  → `N cases · M entries`

so a shut row still says how much is inside it.

## 5. Structure

`PlaylistEntryRow.tsx` is 540 lines before this change and the change adds four
concerns. Split into `components/panels/playlist/`:

| File | Holds |
| --- | --- |
| `PlaylistEntryList.tsx` | the `<ol>` rail, the row bodies, ordering, `activeIndex` |
| `PlaylistIndexMenu.tsx` | the tile and its popover |
| `PlaylistReorderControls.tsx` | the two absolute arrows and the depth group names |
| `EditableLabel.tsx` | the inline-edited label: the debounce machine, now over a `contentEditable` |
| `AddEntryButton.tsx` | the Add step button and its one-list popover (§2b) |

The list and the row stay in **one** file: they are mutually recursive — a
condition holds two lists, a junction case holds one, and each holds rows — so
splitting them would buy nothing but an import cycle. The files that got their
own module are the ones that are *not* recursive.

`EditableLabel`'s commit/anchor/pending dance is the old `DebouncedLabelInput`'s,
**intact**. Its comments document a bug that was fixed once (characters
reverting mid-type, out-of-order remote writes) and they are the reason it will
not come back.

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

And `tests/app/search-score.test.js` for `fuzzyScore`, now that it ranks two
pickers rather than one: the `-1` miss signal both call sites filter on, order
sensitivity, and the four weights (exact wins, start beats middle, a consecutive
run beats scattered letters, a short candidate beats a long one containing it).

Visual verification through the scratchpad Playwright route, importing a bundle
whose flow has a condition and a junction.
