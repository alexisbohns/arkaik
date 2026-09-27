# A panel reads as an outline, not as a scroll

The node detail panel is a flat column of ten sections, each one a micro-label
over a block, all the same weight and all always open. It reads as a list of
everything known about a node, in an order that accreted rather than one anybody
chose. On an acceptance — the species with the most to say — the order is
actively wrong: References and Findings sit above the Gherkin, the acceptance's
central sentence; the Status select is stranded inside `AcceptanceEditor` a
whole section below the title it belongs to; and the per-platform status, which
is most of what acceptance work *is*, sits below a Covers list.

#449 gave the panel a real outline — `h1` page → `h2` record → `h3` section — and
the outline immediately exposed that the panel has no structure for the outline
to describe. Ten sibling `h3`s under one `h2` is a wall with headings on it.

This design gives the panel two levels: an **intro block** of the fields that say
what the record *is*, and a small number of named, collapsible **groups** —
Platforms, Relations, Playlist, History — that hold everything else.

## Scope

Every species panel, not the acceptance alone. The acceptance is what prompted
this and is the sharpest case, but a structure that applied to one panel would
make it the one panel that looks different — which is the problem #448 and #449
were both closing.

Out of scope: the criterion panel (`CriterionDetailPanel`) and the cell panel
(`CellDetailPanel`). They are not node panels, they carry no intro block, and
their sections are already ordered by an argument. They keep today's flat
`PanelSection`s, which continue to work unchanged.

## Part 1 — `PanelGroup`

A new `components/panels/PanelGroup.tsx`, built on the shadcn `Collapsible`
already in `components/ui/collapsible.tsx`.

**The header is a full-bleed bar.** The panel body has no horizontal padding of
its own — the gutter is per-section, owned by `PANEL_GUTTER` — so a group placed
directly in the body already spans the panel's full width, and needs no bleed.
The bar re-applies `PANEL_GUTTER` inside itself and carries `border-y`.
Consecutive bars must collapse their two adjacent hairlines into one — that is
what makes a run of shut groups read as a table of contents rather than as a
ladder of double rules. The overlap belongs to the **container**, which applies
`flex flex-col -space-y-px`, rather than to each group pulling itself up with
`-mt-px`. A sibling relationship is the parent's to own: a container cannot be
given a `gap` and the overlap at once, the first group does not pull itself into
whatever precedes it, and a group used alone is not one pixel off. The body's
own `gap-4` would otherwise open a four-unit trench between every pair of bars,
which is why the groups need a column of their own either way.

**The trigger is the heading.** `<h3><CollapsibleTrigger>…</CollapsibleTrigger></h3>`
— the disclosure pattern, so the group is both an outline entry and a control.
The bar holds, left to right: the title, an optional `meta` slot, and a chevron
that rotates on `data-state="open"`.

```tsx
interface PanelGroupProps {
  title: ReactNode;
  /** Right of the title, left of the chevron. Display only — see below. */
  meta?: ReactNode;
  /** Open on mount. History passes false; everything else takes the default. */
  defaultOpen?: boolean;
  children: ReactNode;
}
```

**`PanelSection` demotes inside a group.** `PanelGroup` provides a context; the
section reads it and renders `h4` rather than `h3`. Nothing else about
`PanelSection` changes, so its ~10 existing call sites — including the two
non-node panels — are untouched and keep rendering `h3`. The outline after this
change is `h1` page → `h2` record → `h3` group → `h4` block.

**No persistence.** Open/closed state is per-mount. A panel reopened is a panel
in its default shape. Persisting it per section name is a real feature and a
plausible follow-up; it is not this one, and storing it would mean deciding
whether the memory is per-reader, per-project or per-node before anybody has
asked for it.

Part 1 ships the primitive and its first consumer: **History becomes a collapsed
group on every species panel.** It is the one section every species has, it is
the one you named as collapsed by default, and it is the section whose always-open
state costs the most — it fetches the journal and renders a feed nobody scrolled
to.

## Part 2 — the Relations group

Every cross-reference of a node moves into one group, in this order, each still
its own `PanelSection` (now `h4`):

| | inner blocks, in order |
|---|---|
| acceptance | Covers · References · Findings · Connections |
| view, flow | Acceptances · Invocation · References · Findings · Connections |
| decision | its four link lists · References · Findings · Connections |
| data-model, api-endpoint | References · Findings · Connections |

A block with nothing to show renders nothing, as today. A group whose every child
renders nothing renders nothing — no empty bar, no "no relations".

**Findings loses its position and must not lose its urgency.** Today
`FindingsSection` sits high in the panel on a stated argument: an open critical
finding is the most urgent thing the panel can say, the canvas badge sends a
reader here to find it, and under the playlist editor it would be a promise the
panel does not keep. Folding it into a group weakens that. The compensation is
the `meta` slot: whenever the node has open findings, the **Relations header
carries the severity chip and the count** — `SEVERITY_CHIP` / `SEVERITY_LABEL`,
the same vocabulary `FindingsSection` already uses — and the chip is on the bar,
so it is visible whether the group is open or shut. Relations is open by default,
so the common case is strictly additive: the chip *and* the list.

**The slot is display-only — chips and counts, never a control.** The bar's
whole content is the `CollapsibleTrigger`, which Radix renders as a real
`<button>`, so anything interactive in `meta` would be a button inside a button:
invalid HTML, undefined AT behaviour, and an inner control the outer trigger
swallows the clicks of. The Acceptances create action (`+`) therefore stays
exactly where it is today, on `PanelSection`'s own `action` prop, one level down
— the group's chip and the section's button never collide because they are on
different bars.

Note the consequence for the outline: `meta` sits inside the trigger, so it
joins the button's accessible name and the `h3`'s text. The Relations entry
reads "Relations critical 3", which is what we want a reader jumping by heading
to hear.

## Part 3 — the Platforms group

Three sections become one group titled **Platforms** on every species that has
platforms at all:

- **acceptance** — the `PlatformVariants` block currently rendered as a `Field`
  inside `AcceptanceEditor`: the platform tab strip, the status select, notes and
  screenshot per platform.
- **view** — today's `PlatformVariantsSection` ("Platform Variants").
- **flow** — today's `ComputedPlatformStatusSection` ("Computed Platform
  Statuses"), the read-only rollup.

Absent on decision, data-model and api-endpoint.

One title across the three, because the group is an outline entry and a reader
walking three panels should not meet three names for the same shelf. That the
flow's is derived rather than authored is said by its contents — a gauge list
with no controls — and by the copy inside it, not by a different heading.

This part extracts the acceptance's platform block out of `AcceptanceEditor` into
its own section component — the second cut in dismantling that file, after Part 2
takes its Covers list into Relations.

## Part 4 — the Playlist group and the acceptance reorder

**Playlist** becomes a group on a flow, holding `PlaylistEditor`'s composer
unchanged.

**The intro block** takes its final shape. Ungrouped, no heading, `PANEL_GUTTER`,
and in this order:

1. title (contenteditable)
2. description (contenteditable)
3. Status — only where the species has a single status *in the shared
   vocabulary*: acceptance, data-model, api-endpoint. Views and flows have no
   single status at all; theirs is per-platform and lives in the Platforms
   group. A decision is the third case: it has one status, but drawn from its
   own vocabulary and written through its own patch, paired with "Decided on" —
   so it keeps the field its editor already renders, and a generic status select
   here would be a second and wrong answer to the same question.
4. Product — flow, view and acceptance, and only in a project that declares
   products. Directly under Status because membership is an identity fact about
   the record, of a piece with its status, and because on an acceptance the
   control carries a paragraph of hint text that reads as a footnote to the
   fields above it rather than as an interruption to the ones below.
5. Blocked by — every species but decision, which renders its own under
   "Context — why".
6. the species' authored fields — on an acceptance, **Gherkin** then **Values**.

`AcceptanceEditor` finishes being dismantled here. Part 2 took its Covers list
into Relations and Part 3 took its platform block into Platforms; what remains is
the Status select, the Product picker, the Gherkin textarea and the Values picker,
which are intro-block fields and belong beside `NodeFields`' own. The file stops
being a 400-line second panel body living inside the first.

## Part 5 — the header menu

`NodeDetailPanelHeader` gains a trailing ghost icon button (`MoreHorizontalIcon`)
opening a `DropdownMenu`, sitting left of the close button that `PanelStack`
owns. Each item renders only when its handler is present; with no applicable
items, no button.

- **Duplicate.** Opens a dialog that names the copy before anything is written,
  then creates it and opens its panel.

  **The dialog names the thing.** A node's id is minted from its title and never
  changes afterwards — it lives in urls, chips, bundles and Lab Notes — so a
  duplicate that silently inherits a derived name is a permanent decision taken
  on the reader's behalf at the one moment naming is cheapest. The dialog asks
  instead. The **name** field starts *empty*, with the original's title as its
  placeholder, so a copy cannot reach the graph under a name nobody chose; the
  confirm is disabled until something is typed. The **id** follows the name
  through `generateNodeId` and is shown as it will be created — the first place
  in the app an id is visible before the record exists — and can be taken over
  and typed directly. An overridden id is validated: it must carry its species'
  prefix and must not already be in use.

  **It writes no edges of its own** — but it is not true that a copy has none.
  `applyOps` folds synthesized `composes` edges on every `create_node`, so a
  duplicated *flow* arrives composing everything its playlist names. That is
  correct and not incidental: a flow carrying a playlist with no `composes`
  edges would fail `playlist-composes-coherence`, and the synthesis is what
  keeps a copied playlist a real one. It does mean duplicating a flow changes
  the graph's shape — every view it plays gains a second parent — which is worth
  knowing before reaching for it on a Journey map.

  A duplicated **acceptance** genuinely covers nothing: `covers` edges are not
  synthesized from anything, so the copy lands unanchored in intake, which is the
  honest state for a record whose anchors have not been chosen — and the panel it
  opens into is the one place to choose them.

  The copy carries the original's `status`, `refs` and `platformScreenshots`
  along with the rest of its metadata. That is deliberate — a duplicate is a
  starting point, not a blank — but it is the opposite of what Split does, which
  starts every piece as an idea.

  **`ProjectPanels` owns the gesture**, as it owns the split dialog and for the
  same reason: the trigger is in the header and the dialog is not, and the stack
  renders those through two separate render props. One dialog serves every open
  panel. Availability follows `onUpdate` — a surface whose panels can write can
  duplicate — so no page wires anything, and no page can be forgotten.

- **Split into several…** — acceptance only, and only with `intake`. The existing
  `SplitAcceptanceDialog`, moved out of the body. Decompose is an operation on the
  record, not a field of it, and as a `Field` labelled "Decompose" with a hint
  sentence it was taking a section's worth of panel to hold one button.
- **Delete** — destructive item, guarded by the caller's own confirm as today.
  This finally uses the `onDelete` prop that `NodeDetailPanel` currently accepts
  and discards on line 683 with `void onDelete;`.

## Shipping

Five parts, one branch and one PR each, chained with `gh stack` per
`docs/conventions.md § "Shipping larger work"`. Every part changes something a
reader sees, so every PR carries a Lab Note.

The order is load-bearing: Part 1 is the only part that introduces a component,
and Parts 2–4 each move one family of sections into it, so a part that has to be
dropped leaves the panel coherent rather than half-grouped. Part 5 touches the
header and the data layer and depends on none of the others, so it sits last and
could be lifted out of the stack entirely if the `onDuplicate` path proves larger
than it looks.

## Verification

- `npm run lint` clean on every part — CI gates on it and main lints clean.
- Regenerate generated artifacts before each PR; a new lucide icon
  (`MoreHorizontalIcon`, `ChevronRightIcon`) dirties the wobble registry, which
  CI diffs.
- Visually: each part checked in the running app against an acceptance, a view, a
  flow and a decision panel, with and without products declared, and on a
  read-only surface (no `onUpdate`, no `onDelete`) to confirm the header button
  disappears rather than showing a dead menu.
- The outline itself: a screen-reader heading list on an open acceptance panel
  must read `h2` title → `h3` Platforms → `h3` Relations → `h4` Covers,
  References, Findings, Connections → `h3` History.
