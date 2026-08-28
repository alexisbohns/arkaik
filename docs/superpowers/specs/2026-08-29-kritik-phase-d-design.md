# Kritik phase D — the Quality page, the findings board, and node decoration

**Date:** 2026-08-29
**Status:** approved, implementing
**Issue:** [#382](https://github.com/alexisbohns/arkaik/issues/382) phase D
**Follows:** #383 (schema), #384 (plugin), #385 (CLI/MCP), #386 (release)
**RFC:** [`docs/rfcs/kritik.md`](../../rfcs/kritik.md) § 4.3

## Problem

Kritik can score a product and it can store the result, but nobody can *look* at
it. Phases A–C built the whole write half — `deriveQualityMatrix` in
`@arkaik/schema`, the `arkaik kritik` verbs, nine `kritik_*` MCP tools — and
stopped at the point where a reader would arrive. A project with a `quality`
section today renders exactly nothing.

Phase D is the read half, and it is deliberately the smallest possible one: the
projection already exists and is already tested against the Pebbles pilot. This
phase renders it.

## What is already true

Four facts, each verified against the code, that remove work this phase might
otherwise have carried:

1. **The matrix needs no new computation.** `deriveQualityMatrix(bundle)`
   returns the exact shape the pilot's `dashboard.html` renders, cap flags and
   severity tallies included. The page renders it; it does not recompute it.
2. **The data already reaches the app.** `createProject` stores
   `const { journal = [], ...snapshot } = bundle`, so `quality` rides into
   Postgres inside the snapshot, and `readProjectBundle` spreads it back out.
   Import → storage → `useProject` works today with no storage change.
   `SnapshotShape` does not *declare* `quality`, which costs nothing at runtime
   and is worth a comment rather than a migration.
3. **Node decoration is testable.** 29 of the pilot's 246 findings carry
   `node_ids`. The badge is not a feature we have to invent data for.
4. **Severity, priority and grade are settled.** `severityOf`, `priorityOf`,
   `gradeOf`, `capGrade` and `isOpenFinding` are all exported from
   `@arkaik/schema`. Nothing in this phase reimplements a scale.

## Decisions taken before the design

| Question | Decision |
| --- | --- |
| PR slicing | **One PR, all four deliverables** — matches "one PR per phase" and how A/B/C landed. |
| Demo data | **None.** No seed gains a `quality` section; a project without one gets an empty state. |
| Route shape | **One `/quality` route, two sections** — matrix above, findings board below. |
| Nav slot | **Project group, after Changelog** — with the other whole-product read-outs. |
| Projection home | **`lib/utils/quality.ts`, app-side** — the repo's own precedent. |
| Criterion drill-down | **The shared panel stack**, with the address caveat in § 2. |
| Board layout | **Vertical priority sections**, not kanban lanes. |

### Why the projections are app-side

`coverage.ts`, `delivery.ts`, `acceptance-matrix.ts` and `pyramid.ts` all live in
`lib/utils/` and are tested DB-free in `tests/app/`. `deriveQualityMatrix` lives
in `@arkaik/schema` because `arkaik kritik matrix` and `kritik_matrix` both call
it — it has a second consumer. Nothing in this phase does. Putting UI-shaped
joins into a published 639-line module to serve a consumer that does not exist
would be speculative, and the schema package is npm-published surface area.

This does not contradict "three entry points, one implementation": that rule
governs *mutation* paths. The app is a read-only consumer here and adds no
fourth write path.

## Design

### 1. Projections — `lib/utils/quality.ts`

Pure functions, no React, no fs, no network. Every one reads
`bundle.quality` plus the library that `resolveKritikLibrary(section)` returns.

| Function | Returns | Feeds |
| --- | --- | --- |
| `buildFindingRows(section, library)` | findings denormalized with severity, priority, domain code, criterion name, cost, verification | the board |
| `filterFindings(rows, filters)` | the narrowed rows | the board + result count |
| `groupByPriority(rows)` | `P0`–`P3` groups, empty ones retained | the board's sections |
| `buildCellCriteria(section, library, domain, surface)` | criterion rows with maturity levels and evidence | the active-cell strip |
| `buildNodeFindingIndex(section, library)` | `Map<nodeId, { counts, worst }>` | node badges |
| `buildSurfaceGauges(matrix, library)` | per-surface score + grade | the overview card |

`buildFindingRows` is the single place a finding is denormalized. The board,
the node index and the criterion panel all consume its output rather than
walking `section.findings` again, so severity is computed once per finding per
render and the three surfaces cannot disagree about what a finding is.

### 2. The criterion panel, and the address it does not take

The RFC asks for "the same panel-stack pattern as node details". The stack takes
a third `kind`; it does **not** take a second address.

`useProjectPanels` is built around one address: `reconcileArrival` rebuilds the
stack around a single key and `commitEntries` recomputes a single `?node=`. Two
independent reconcilers over one stack have no defined answer for
`?node=V-home&criterion=SEC-01` — which panel is on top, and which one wins when
Back changes both. Generalizing that contract is a redesign of shared chrome
used by all eleven project pages, inside a PR that already carries four
deliverables.

`project-panels.ts` also already states the principle: Raw is addressless
because it is *"a tool rather than a location"*. A criterion is library content,
identical in every project that pins the same pack. It is not a location in
*this* graph.

**So:**

- `PanelDescriptor` gains
  `{ kind: "criterion"; criterionId: string; surface?: string }`.
- Entries are keyed `criterion:<id>@<surface>` — namespaced, so a criterion key
  can never be mistaken for a node id and two criteria can stack while the same
  criterion refreshes in place.
- `openCriterion(criterionId, surface, fromDepth?)` appends through `openFrom`,
  exactly as `openRaw` does.
- `topNodeKey` needs no change: it already returns only node entries, so
  `?node=` is untouched **by construction** rather than by care.
- `pruneNodeEntries` needs no change: it already spares non-node entries.

**Deep links come from the page, not the stack.** The Quality page owns
`?criterion=SEC-03&csurface=web`, reads them on mount to open the panel, and
writes them when a criterion opens or closes. Shared links work, Back works, and
because exactly one page participates the two-reconciler problem never arises.

This is the documented `?product=` precedent: a param owned by a page,
deliberately outside the filter hook's `KEYS` so that "Clear filters" cannot
close a panel.

### 3. The route

`app/project/[id]/quality/page.tsx` — `PageShell` → `PageSurface fill` →
`QualityFilterBar` in the toolbar slot, then two sections in one scrollport.

The page memoizes three things and derives everything else from them:
`section = project?.quality`, `library = resolveKritikLibrary(section)`,
`matrix = deriveQualityMatrix(project, library)`.

**`QualityMatrix`** — rows are `matrix.domains`, columns `matrix.surfaces`,
each cell the score, the grade, a `*` when `capped`, and dots counting open
findings by severity. `null` renders `N/A` and is not clickable. A final
`OVERALL` row renders `matrix.overall`. Clicking a cell sets the active
`(domain × surface)`, which rings the cell and narrows the board below; the
active cell also reveals a criteria strip between the two sections, listing that
cell's criteria with their maturity levels. A criterion in the strip opens the
panel.

Grade bands drive cell color through the existing token set; the legend states
the caps in words, as the pilot's does, because a letter worse than its number
is otherwise unexplainable.

**`FindingsBoard`** — one section per priority, `P0` first, stacked down the
page with sticky headings following `AcceptanceMatrix`'s anchor-group pattern.
Not kanban lanes: the matrix above is already wide, and four columns beneath it
would give the page a second horizontal scroller while squeezing finding titles
that routinely run past a hundred characters.

`FindingCard` collapsed shows the severity chip, `impact × likelihood`, cost,
surface, criterion, and verification verdict when present. Expanded it adds
detail, evidence, linked nodes and the issue ref. Linked nodes call the existing
`openNode` — no new machinery, and following a finding into the graph works from
day one. A finding with `status: "accepted-risk"` renders its note in the
decision-log style, because an accepted risk is a decision and reads as one.

**`useQualityFilters`** mirrors `useAcceptanceFilters` exactly: URL-persisted,
`writeQuery`-based, `KEYS = ["search", "severity", "surface", "priority",
"domain", "status", "cell", "sort"]`. `criterion` and `csurface` are absent from
`KEYS`, for the `?product=` reason above.

### 4. Degradation

`resolveKritikLibrary` synthesizes a minimal library when no pack is embedded:
domain codes become domain names, every weight is 1, and there are **no
questions, anchors, references or checklists**. That is a supported state, not a
bug, and the UI has to be honest about it.

- **No `quality` section at all** → `EmptyState`: install `kritik@arkaik`, run
  an audit, import the bundle. The matrix does not render as a grid of `N/A`.
- **Quality present, library synthesized** → matrix and board render on codes.
  The criterion panel renders only the fields that exist and says the pack is
  not embedded, rather than drawing five empty prose headings.
- **A finding whose `criterion_id` resolves to no domain** belongs to no cell —
  `deriveQualityMatrix` already drops it deliberately. The board still lists it,
  so it is never invisible; only the matrix cannot place it.

The distinction that matters throughout: **an empty result and a failed read are
different screens** (`PageError`, audit `quality-frontend-2` / #362). The page
takes `error` from `useProject` and renders `PageError` with a retry, before any
empty state is considered.

### 5. Node decoration

`FindingBadge` sits with the existing badges on `ViewNode`, `FlowNode` and
`SystemLayerNode`: worst open severity as its color, the open count as its
label, absent entirely at zero. `NodeDetailPanel` gains a Findings section
listing that node's open findings, each opening the criterion panel.

Both read one `buildNodeFindingIndex` map built once per page, so a node with no
findings costs a single lookup and the canvas does not walk the findings array
per node.

`QualityCard` in `components/overview/` renders `buildSurfaceGauges` beside
`PlatformGaugesCard`, registered in both the rows and grid layouts. Absent when
the project has no `quality` section — a silenced section is absent, not a row
spent explaining its own absence.

## Files

**New (12 files)**

```
app/project/[id]/quality/page.tsx
components/quality/QualityMatrix.tsx
components/quality/FindingsBoard.tsx
components/quality/FindingCard.tsx
components/quality/QualityFilterBar.tsx
components/quality/quality-filters.ts        # useQualityFilters
components/panels/CriterionDetailPanel.tsx   # + CriterionDetailPanelHeader
components/overview/QualityCard.tsx
components/graph/nodes/FindingBadge.tsx
lib/utils/quality.ts
tests/app/load-quality.js + tests/app/quality.test.js
```

**Edited (8)**

```
lib/utils/project-panels.ts        # union, criterion key helper, isCriterionEntry
lib/hooks/useProjectPanels.tsx     # openCriterion
components/panels/ProjectPanels.tsx     # render branch, labelOf, renderHeader
components/layout/ProjectSwitcher.tsx  # ProjectView + PROJECT_VIEW_SEGMENTS
components/layout/ProjectSidebar.tsx   # nav entry, Project group, after Changelog
lib/utils/command-palette.ts       # "quality" entry (test:command-palette asserts the list)
package.json                       # test:quality-page
.github/workflows/ci.yml           # run it
```

`test:quality` and `test:quality-ops` are already taken by the schema suites, so
the new script is `test:quality-page`. Reusing either name would silently
replace a suite CI currently runs.

The Quality page must pass `allNodes` and `allEdges` to `PageShell`. It does not
render nodes itself, but `ProjectPanels` resolves node entries against that data
— without it, following a finding into its linked node opens a panel that cannot
find its node.

## Testing

`tests/app/quality.test.js` with a `load-quality.js` loader, following the
`load-coverage.js` pattern, driven by the committed
`tests/fixtures/quality/pilot-2026-08.json` — 338 assessments, 246 findings, 29
carrying `node_ids`, scored against `packages/kritik-library/framework.json`.
Real data for every projection, and the same fixture that already guards
`deriveQualityMatrix`.

Covered:

- `buildFindingRows` — severity and priority match `severityOf` / `priorityOf`
  for all 246; a finding whose criterion resolves to no domain still produces a
  row.
- `filterFindings` — each filter alone, and severity + surface together;
  `cell` narrows to exactly the findings `deriveQualityMatrix` counted in that
  cell.
- `groupByPriority` — every row lands in exactly one group; empty groups are
  retained so the board can render a heading over "none at this priority".
- `buildCellCriteria` — criterion count matches the cell's `criteria` field.
- `buildNodeFindingIndex` — 29 nodes present, `worst` is the max severity, a
  resolved finding never appears.
- `buildSurfaceGauges` — scores equal `matrix.overall`; a `null` overall renders
  as absent, not as zero.
- Degradation — a section with no `library` produces rows and an index without
  throwing.

`tests/app/project-panels.test.js` gains the criterion kind: it survives a node
prune, it never becomes `?node=`, and opening the same criterion twice refreshes
in place rather than stacking.

**No visual verification is possible in this environment** (memory:
`no-browser-driver-for-ui-verification`). The PR hands over a written checklist
for the visual pass.

## Non-goals

- No seed gains a `quality` section. Demo data is a separate decision.
- No write path. The page is read-only; scores and findings are written by the
  CLI, MCP and plugin, which is phase C's settled contract.
- No trend arrows. RFC § 4.3 wants deltas versus the previous
  `quality.audit.completed`; that needs journal projection work and belongs with
  phase E, which is where the events become a time series.
- No criteria browser or audit-history route. One route, as decided.
- No Publik exposure. `stripQuality` stays default-on; § 8.3 is unchanged.

## Risks

| Risk | Mitigation |
| --- | --- |
| The panel-stack edit regresses `?node=` on eleven pages | The criterion kind is addressless, so `topNodeKey` and `pruneNodeEntries` need no edit at all. `test:project-panels` extended before the union changes. |
| 246 findings render slowly | Rows are built once and memoized; filtering is a pass over a flat array. `AcceptanceMatrix` renders comparable volume without virtualization. If it drags, the fix is collapsing sections, not a rewrite. |
| Grade colors drift from the pilot's | Bands come from `gradeOf`, and the golden fixture already fails CI when a band moves. Colors map from the grade, never from the score. |
| Lab Note | Phase D is user-facing. The PR body carries one. |
