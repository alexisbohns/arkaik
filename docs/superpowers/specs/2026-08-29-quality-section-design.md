# Quality, as a section

*2026-08-29*

The Quality page tried to be two pages at once: a comparative matrix you scan,
and a findings board you work. Stacked in one scrollport they fought — the
matrix is wide enough to need its own horizontal scrollport, the board is long
enough to bury it, and clicking a cell filtered a list you had already scrolled
past. This splits them into a sidebar section of two pages, and replaces the
table with stacked domain sections whose cells are cards.

## 1. Routes and navigation

| Path | Page |
| --- | --- |
| `/project/:id/quality` | redirects to `./matrix`, query preserved |
| `/project/:id/quality/matrix` | the stacked matrix |
| `/project/:id/quality/findings` | the findings board and its filters |

`ProjectSidebar` drops Quality from the **Project** group and gains a **Quality**
`SidebarGroup` between Project and Maps:

```
Quality
  Matrix     GemIcon         /project/:id/quality/matrix
  Findings   ListChecksIcon  /project/:id/quality/findings
```

`ProjectLayout` already resolves `currentView` with `pathname.startsWith`, so
`/quality/matrix` still reads as `quality`. It gains `currentQualityView:
"matrix" | "findings" | null`, derived from the path exactly as `currentMapId`
is, and passes it to the sidebar for the active state.

`buildProjectCommands` replaces its single Quality entry with two.

The redirect keeps every link ever shared — `?cell=`, `?criterion=`, `?node=` —
working: it is a client page that `replace`s to `./matrix` with the live query
string appended.

## 2. The Matrix page

`PageShell` → `PageSurface fill`, no filter bar. The page's filter is the card
you click; a bar that narrowed the cards would narrow the very comparison the
page exists to make.

The body is a `divide-y` stack, one section per library domain, preceded by an
**Overall** section carrying `matrix.overall` — the old `tfoot` promoted to the
top, where a roll-up reads as a summary rather than as a twelfth domain.

Each section is a full-width heading above a full-width gallery:

```
+------------------------------------------------------------+
| (icon)  Security . SEC                        avg 69 . 4    |
|         Authn, secrets, data at rest                        |
+------------------------------------------------------------+
| [ 62 ] [ 78 ] [ 55 ] [ 81 ]   ...  scrolls horizontally ->  |
|   C*     B      D      A                                    |
|  Web    iOS    API    Data                                  |
+------------------------------------------------------------+
```

The heading is **above**, not beside. `SectionRow`'s two-column shape would
leave the gallery a `1fr` remainder of an already narrow column once a panel
opens, and every gallery would be a stub scrolling two cards at a time. Full
width means the scrollport is the surface's width and degrades gracefully as
the panel takes space.

Each gallery owns its own `overflow-x-auto`; the page never scrolls
horizontally as a whole.

The legend — grade bands read off `gradeOf`, the severity dot key, the `*` cap
note — moves unchanged to the bottom of the surface as `QualityLegend`.

### Domain identity

`KritikDomain` carries `code`, `name` and an optional `description`; it has no
icon. `lib/config/quality-domain-icons.ts` maps known pack codes to lucide
glyphs — `SEC` shield, `A11Y` accessibility, `PERF` gauge, `ARC` network, and
the rest of the pack — with `CircleDotIcon` as the fallback for a project's own
overlay domains. A map rather than a schema field: the icon is a presentation
choice about a code, and a pack should not have to name a React component.

The heading's meta line is the domain's average across its scored surfaces and
how many were scored.

### The card

`SurfaceScoreCard` is the old table cell as a card: score, grade with its `*`
when capped, the severity dots (`MAX_DOTS` cap intact), and the surface title
underneath. Tinted by `GRADE_TINT`, `aria-pressed` when it is the open cell,
ringed when active. Its accessible name is `cellLabel`'s sentence, unchanged —
which is still where the true finding counts live past the four-dot cap.

An unscored cell renders the same card shape reading `N/A`, not a button: there
is nothing to open.

## 3. The cell panel

A third panel kind joins `node`, `criterion` and `raw`.

```ts
{ kind: "cell", domain: string, surface: string }
```

keyed `cell:SEC@web` by `cellPanelKey` — namespaced for the reason
`criterionPanelKey` is: a domain code is not guaranteed to avoid colliding with
a species prefix or with `raw`.

`useProjectPanels` gains `openCell(domain, surface, fromDepth?)`, mirroring
`openCriterion`. `ProjectPanels` renders `CellDetailPanel` and
`CellDetailPanelHeader` from the `qualitySection` and `qualityLibrary` props it
already accepts, and from `qualityFindings`, which it already derives once per
stack.

The panel body, top to bottom:

1. **The cell.** Domain x surface, score, grade, the cap note when capped, and
   how many criteria were scored.
2. **Criteria.** `CriteriaList`, extracted from today's `CriteriaStrip` — the
   id, the level meter, the name, the open count, each row opening the
   criterion panel.
3. **Findings.** `FindingsBoard`, the identical component the Findings page
   renders, fed `groupByPriority(filterFindings(rows, { ...EMPTY, cell }))`.

A criterion opened from the list mounts at `index + 1` — above the cell panel,
never in place of it — which is the rule every other panel in the stack
follows. A finding's linked node likewise.

A footer link leaves for `../findings?cell=SEC@web`, the full-width filterable
view of the same set.

Clicking a different card refreshes the panel in place at depth 0. Clicking the
active card closes it. This is the whole reason the panel exists rather than a
navigation: switching cells is what the matrix page is *for*, and a page
transition per cell would make the comparison unaffordable.

`CriteriaStrip` — the inline strip between matrix and board — is deleted. Its
list is now the panel's middle section.

## 4. `?cell=`, and the address sync

`?cell=` keeps its encoding (`cellKey` / `parseCellKey`) and takes a second
reading:

- On **Findings** it is a filter, as today: a dismissible chip in the bar,
  cleared by "Clear filters", in `KEYS`.
- On **Matrix** it is the cell panel's address, owned by the page and outside
  `KEYS` — the same standing `?criterion=` has today.

Both readings are "the selected cell", so a link from one page to the other
carries the selection intact.

Today's `?criterion=` reconciliation on the Quality page is about a hundred
lines of genuinely subtle logic: distinguishing a panel the reader closed from
a panel `reconcileArrival` wiped, restoring only into an empty stack, refusing
to act on a stale address for one frame after a click. It moves verbatim into

```ts
lib/hooks/useAddressedBottomPanel.ts
```

parameterised by the param's value, the key it addresses, an `open` callback
and a `clear` callback. The Findings page uses it for `?criterion=`; the Matrix
page uses it for `?cell=`. One implementation of the part that rots silently.

## 5. The Findings page

Today's lower half, unchanged in substance: `QualityFilterBar` in the toolbar,
`FindingsBoard` in the scrollport, `?criterion=` opening a criterion panel at
depth 0, and the distinction the page alone can draw — "this audit raised no
findings at all" versus "no findings match these filters" — preserved exactly.

It is `PageSurface fill`, so `FindingsBoard`'s sticky `0px` fallback keeps
pinning its priority headings against the toolbar's hairline.

## 6. Shared components

Nothing is written twice. The panel *is* the board with a preset filter and a
criteria list above it.

| Module | Origin | Used by |
| --- | --- | --- |
| `components/quality/FindingsBoard.tsx` | unchanged | Findings page, cell panel |
| `components/quality/CriteriaList.tsx` | extracted from `CriteriaStrip` | cell panel |
| `components/quality/SurfaceScoreCard.tsx` | extracted from the table cell | domain galleries, Overall section |
| `components/quality/FindingDots.tsx` | lifted out of `QualityMatrix` | cards |
| `components/quality/LevelMeter.tsx` | lifted out of `QualityMatrix` | criteria list |
| `components/quality/QualityLegend.tsx` | extracted from `QualityMatrix` | Matrix page |
| `components/quality/QualityMatrixSections.tsx` | new | Matrix page |
| `components/layout/SectionHeading.tsx` | extracted from `SectionRow`'s left column | `SectionRow`, Matrix page |
| `lib/hooks/useQualityData.ts` | extracted from the page | both pages |
| `lib/hooks/useAddressedBottomPanel.ts` | extracted from the page | both pages |
| `lib/config/quality-domain-icons.ts` | new | Matrix page |

`components/quality/QualityMatrix.tsx` is deleted.

`SectionHeading` takes the icon, title, description, subtitle and optional
link, and lays them out in a column. `SectionRow` renders it in its left column
— so the Overview and Changelog rows are untouched — and the Matrix page
renders it stacked above the gallery, with `orientation="horizontal"` putting
the icon beside the title and the meta at the end of the line.

`useQualityData(projectId)` returns `{ section, library, matrix, rows,
surfaces, domains, surfaceTitles }`, keeping the split memoisation the page has
today (`react-hooks/preserve-manual-memoization` refuses a single memo over the
build-narrow-group chain).

## 7. Error, loading and empty states

Unchanged and shared by both pages, via `useQualityData`:

- `PageLoading` while nodes or edges load.
- `PageError` before the empty state, never after — a bundle that failed to
  read has no `quality` section either, and must not be told to go install a
  plugin (#362, audit `quality-frontend-2`).
- The "no audit yet" `EmptyState` naming the three steps to a matrix.

## 8. Testing

- `tests/app/quality.test.js` and its `load-quality.js` harness split to cover
  both routes. Note the alias-rewrite constraint: any new `@/...` import must be
  taught to the loader or the suite silently stops building.
- New pure helpers get direct tests: the domain icon fallback, the domain
  average in the heading meta, `cellPanelKey` round-tripping.
- `useAddressedBottomPanel` is exercised through both pages rather than in
  isolation; its behaviour is unchanged from the code it was extracted from, so
  the existing `?criterion=` assertions are the regression net.
- No DB is available locally; everything here is client-side and runs in the
  fast build job.

## 9. Out of scope

- Any change to how findings, scores, grades or caps are *derived*. Every
  number on both pages still comes from `deriveQualityMatrix`, `gradeOf`,
  `buildFindingRows`.
- The criterion panel's contents.
- Node decoration and the regression loop.
