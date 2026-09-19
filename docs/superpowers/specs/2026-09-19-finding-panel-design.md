# The finding panel

**Date:** 2026-09-19
**Status:** implemented, with one decision reversed — see below

## Correction: the descriptor carries no title

§1 below designs `FindingPanelDescriptor` with a denormalized `title`, so the
breadcrumb and the panel header would read as prose. **That was wrong and is
not what shipped.**

A panel header in Arkaik never carries a title. A node's header is its species
badge and its id; a criterion's is its domain and its id. The title is body
content — on a node it is an editable field down there, which is precisely why
it cannot also be the identity up top, and why the stack's own `h2` is
`sr-only`. Half the justification for the field was therefore never real, and
the argument in §1 should not have been written without checking the
convention first.

What shipped: the header is a `Finding` type chip, the finding's id, and the
surface. The crumb and the close label read the id too, exactly as the
criterion's read `SEC-03`. `FindingPanelDescriptor` is `{ kind, findingId }`
with no display data in it at all, and `openFinding` and every `onOpenFinding`
take an id, matching `onOpenNode` and `onOpenCriterion` beside them. The rail's
mark is not in the header either — it is a status, and no header in the stack
carries one — it leads the title in the body instead.

Read §1's "The title in the descriptor" as a rejected alternative, not as the
design.

## The problem

A finding is an entity. Every other entity in the project — a node, a
criterion, a matrix cell — is read in a panel. A finding is read by expanding a
row in place.

That inconsistency costs three things:

1. **The board stops being scannable while you read.** A card expanded to its
   detail, evidence, verification note, linked nodes, id and issue URL is
   several screens tall, and the rows under it are pushed off. Working through
   a board means expanding and re-collapsing, which is the gesture the Matrix
   page already abandoned when it moved its findings into a cell panel.
2. **A finding is not linkable.** `?criterion=` and `?cell=` address their
   panels; a finding has no address, so you cannot send anyone to one.
3. **Every route into a finding lands somewhere else.** The node panel's
   Findings list opens the *criterion*, because — as its own comment says — "a
   finding has no panel of its own". The reader asked about the finding and got
   the standard it answers to.

## What ships

A `finding` panel kind in the project panel stack, opened by clicking a finding
anywhere one is rendered: the Findings page board, the cell panel, the
criterion panel, and the node panel's Findings list. The card's inline
disclosure goes away.

Read-only. Resolve and accept-risk are CLI and MCP writes today
(`quality.finding.resolved`, `quality.finding.accepted`); no UI write path
exists, and this change does not introduce one.

## 1. The stack: a fourth panel kind

`lib/utils/project-panels.ts`:

```ts
export interface FindingPanelDescriptor {
  kind: "finding";
  findingId: string;
  /** The finding's title, for the crumb and the close label. See below. */
  title: string;
}

export function findingPanelKey(findingId: string): string {
  return `finding:${findingId}`;
}

export function isFindingEntry(entry: ProjectPanelEntry): entry is PanelEntry<FindingPanelDescriptor>;
```

Added to the `PanelDescriptor` union, and to that file's head comment as the
fourth exception to "the stack was built for nodes": a finding is a *reading of
this project's audit*, not a location in its graph, so it is addressless in the
stack and the Findings page owns `?finding=`. The stack still has exactly one
address and it is `?node=`.

Namespaced key, for the reason `criterionPanelKey` and `cellPanelKey` are
namespaced: finding ids are project-authored (`F-2026-08-SEC-web-01` in the
pilot's convention, but a project chooses), and nothing guarantees one never
collides with a node's species prefix or with `raw`.

`pruneNodeEntries` needs no change — it drops only node entries, so a finding
panel survives a node deleted under the stack by construction.

`useProjectPanels` gains:

```ts
openFinding: (row: FindingRow, fromDepth?: number) => void;
```

Publishing nothing, exactly like `openCriterion` and `openCell`, and carrying
the same `fromDepth` warning: **a caller opening a finding from the surface
passes `0`.** On the default (`previous.length`) sweeping five cards on the
board would leave five panels.

### The title in the descriptor

The descriptor carries the finding's `title`, so `buildPanelCrumbs` and
`ProjectPanels`' `labelOf` both read it from the payload — no lookup, no
threading. The crumb reads "Session cookie is readable from JS" rather than
`F-2026-08-SEC-web-01`.

This is the one place the design holds denormalized display data in the stack,
against the codebase's usual "resolve by id so an edit reaches every panel".
The exception is deliberate and bounded:

- Findings are read-only in the UI. Nothing in a session can rename one.
- `openFrom` refreshes an entry's payload when the same key lands back in the
  same slot, so re-opening a finding picks up a new title.
- The only staleness window is a crumb label between a bundle re-import that
  changed a title and the next re-open of that panel.

The alternative considered and rejected: keep the descriptor id-only and thread
`findings` through `PageHeader` → `usePanelBreadcrumbs` → `buildPanelCrumbs`,
for three pages that never open a finding panel. A third alternative — label
from the id, as the criterion panel labels from `SEC-03` — was rejected because
a four-segment finding id in a truncated crumb tells the reader nothing, and
the crumb is the one place they get no other context.

## 2. `FindingDetailPanel`

New file, `components/panels/FindingDetailPanel.tsx`, exporting
`FindingDetailPanel` and `FindingDetailPanelHeader` — the two-export shape
`CellDetailPanel` and `CriterionDetailPanel` already use, because `PanelStack`
renders header and body through separate render props.

**Header.** The rail's own mark, so the panel is recognisably the thing the
reader clicked: the priority square when the finding is open, the verdict glyph
when it is decided — the same `ScaleChip` + `iconChipVariants` treatment
`FindingsBoard` draws down the rail. Then the title, then the surface title
(the profile's word, or the `Cross-surface` badge).

**Body**, top to bottom:

| Section | Content |
| --- | --- |
| Meta band | `SeverityPill` (impact × likelihood → risk → severity), the cost chip, the criterion chip (opens the criterion above), the status badge, the verdict |
| Accepted risk | The bordered decision-log callout, when `status === "accepted-risk"` |
| Detail | `row.detail` as prose |
| Evidence | `row.evidence`, monospace with preserved line breaks — `file:line` citations must stay pasteable |
| Verification | The verdict word and the refutation pass's note, when it wrote one distinct from the detail |
| In the graph | Linked-node chips → `onOpenNode` above; an id that resolves to nothing stays a dashed chip, because a finding filed against a deleted node is a fact about the audit |
| Reference | The select-all monospace finding id, and the issue URL when there is one |

Every section is conditional on having content, following
`CriterionDetailPanel`'s rule: a heading over nothing reads as a broken panel.

The panel resolves its row out of the `findings: FindingRow[]` array
`ProjectPanels` already denormalizes once per stack — it does not walk
`section.findings` again, so it cannot disagree with the board about what a
finding is. When the id names nothing it renders an `EmptyState` saying so,
rather than nothing at all: that is the state a stale `?finding=` link or a
re-import that dropped the finding lands in, and the same rule the missing-node
body follows.

The file must satisfy `tests/app/panel-semantics.test.js`, which asserts the
h2 → h3 → h4 outline statically over every file in `components/panels/`.

## 3. `FindingCard` loses its disclosure

- No `useState`, no chevron. The title row becomes the button, calling
  `onOpenFinding(row)`.
- The two meta lines stay: they are what the reader triages from without
  opening anything.
- The accepted-risk callout stays on the card. The argument for showing it
  collapsed — a recorded decision must not be hidden, or the next reader
  re-litigates it — still holds when there is no longer a collapsed state.
- Detail, evidence, the verification note, the linked-node chips and the
  id/issue block all move to the panel.

Consequently **`FindingsBoard` and `FindingCard` drop `nodesById` and
`onOpenNode` entirely** — the node chips were their only consumer. That
simplifies four call sites (the Findings page, `CellDetailPanel`,
`CriterionDetailPanel`, and the landing preview's `ReadOnlyFindingsBoard` /
`FindingsBoardPreview`).

`onOpenFinding` is required on both components. `ReadOnlyFindingsBoard` passes
a no-op, as it already does for `onOpenNode` — a function cannot cross the RSC
boundary, and the landing preview is not interactive.

`onOpenCriterion` keeps its current contract: optional, and its absence drops
the criterion chip. That is still how the criterion panel says "you are already
inside it".

## 4. Wiring — above, never in place of

`ProjectPanels` renders the new kind in `renderHeader` and `renderBody`, and
hands `openFinding(row, index + 1)` to every panel that renders a board, so a
finding clicked inside a panel opens *above* it and the trail still reads back
to where the reader came from. The same rule every other navigation in the
stack follows.

- `CellDetailPanel`: takes `onOpenFinding`, passes it to `FindingsBoard`, drops
  `nodesById` and its board's `onOpenNode`.
- `CriterionDetailPanel`: the same; `nodesById` was only ever passed through to
  the board.
- `NodeRelationSections.FindingsSection`: rows call `onOpenFinding(row)`
  instead of `onOpenCriterion`. The comment explaining "a finding has no panel
  of its own, and the criterion is where its question lives" is deleted with
  the behaviour it explained.
- `NodeDetailPanel` threads `onOpenFinding` through to `RelationsGroup` →
  `FindingsSection`, alongside the `onOpenCriterion` it already threads.

`onOpenNode` survives on the panels themselves (the finding panel needs it for
its node chips); it is only the *board* that stops needing one.

## 5. `?finding=` on the Findings page

Depth 0 on the Findings page becomes "a finding **or** a criterion,
exclusively". One `useAddressedBottomPanel` call owns it:

```ts
useAddressedBottomPanel({
  params: ["finding", "criterion", "csurface"],
  addressed,   // finding key when ?finding= is set, else the criterion key
  open,        // opens whichever kind is addressed, at depth 0
  openKey,     // bottom entry's key when it is a finding OR a criterion entry
});
```

Finding takes precedence over criterion in `addressed`, which also settles a
hand-typed URL carrying both rather than letting two syncs fight over depth 0.

- `handleOpenFinding` opens at depth 0 *and* writes `?finding=`, deleting
  `criterion` and `csurface` in the same write. Opened and addressed in one
  gesture, for the reason the existing handlers are: leaving the open to the
  sync effect puts a router transition between the click and the panel, and the
  write is what makes the panel survive a Back.
- `handleOpenCriterion` gains the inverse deletion of `finding`.
- `?finding=` stays outside `useQualityFilters`' `KEYS`, like `?criterion=`:
  "Clear filters" must not shut the document you were reading.

The Matrix page is unchanged. A finding opened from its cell panel sits above
that panel and is not addressed — exactly as a criterion opened from there is
not.

## Testing

- `tests/app/project-panels.test.js`: the new kind's crumb label (from the
  payload title), and that a node prune leaves a finding entry standing.
- `tests/app/panel-semantics.test.js` covers the new panel file automatically;
  it must pass without the test being relaxed.
- `tests/app/product-scope.test.js` asserts source text inside
  `components/panels/NodeDetailPanel.tsx`; threading `onOpenFinding` through it
  must not disturb what that test reads.
- No existing test asserts the board's props: `tests/app/quality.test.js` is a
  pure replay of `lib/utils/quality.ts` projections, and
  `tests/landing/landing.test.js` does not reach into `FindingsBoard`. The
  compiler and `next lint` are what catch the dropped props, so the prop
  removal has to be completed in the same change rather than left half-done.

## Shipping

One PR. The card cannot lose its disclosure before the panel exists, and the
board's prop removal touches every call site in the same breath — cutting this
into stacked parts would mean a middle commit in which a finding is unreadable.

User-facing, so the PR body carries a Lab Note.
