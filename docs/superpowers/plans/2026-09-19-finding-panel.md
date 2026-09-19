# Finding Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A finding opens in its own panel, everywhere a finding is rendered, instead of expanding a row in place.

**Architecture:** A fifth panel kind (`finding`) joins the project panel stack's descriptor union alongside `node`, `raw`, `criterion` and `cell`. It is addressless in the stack — `?node=` stays the stack's one address — and the Findings page owns `?finding=`, sharing depth 0 with the `?criterion=` it already owns. `FindingCard` sheds its disclosure and everything behind it, which lets `FindingsBoard` drop `nodesById` and `onOpenNode` entirely.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Tailwind v4, shadcn/ui. Tests are plain Node scripts under `tests/`, run through `npm run test:<name>`; there is no component render rig, so panel invariants are asserted statically over the TypeScript AST.

**Spec:** `docs/superpowers/specs/2026-09-19-finding-panel-design.md`

**Branch:** `finding-panel` (already created, already carries the spec commit).

## Correction, found while executing Task 1

The tasks below are numbered in their original order, but **Tasks 2 and 6 are done together, after Task 5.** Extending `PanelDescriptor` with `FindingPanelDescriptor` (Task 1) immediately breaks `components/panels/ProjectPanels.tsx`:

```
ProjectPanels.tsx(383,46): error TS2339: Property 'initialPlatform' does not exist
  on type 'NodePanelDescriptor | FindingPanelDescriptor'.
```

`renderBody` narrows the union by early-returning on `raw`, `cell` and `criterion`, then reads `entry.payload.initialPlatform` from what is left — an assumption that a fifth kind invalidates. Only Task 6's `finding` branch restores the narrowing. Nothing in Tasks 2–5 fixes it, so their `npx tsc --noEmit` steps are expected to report **exactly this one error and no other**; treat a second error as yours.

**Execution order: 1 → 3 → 4 → 5 → (2 + 6 as one commit) → 7 → 8 → 9 → 10.** Tasks 3, 4 and 5 touch none of the affected files, and merging 2 with 6 is what closes the window — `openFinding` has no caller until `ProjectPanels` has one.

---

## File Structure

**Created:**

- `components/quality/FindingMark.tsx` — the rail's square, as one component. Today it is built inline in `FindingsBoard`; the panel header needs the identical mark, and two copies would drift the first time a status tile changes.
- `components/panels/FindingDetailPanel.tsx` — the panel and its header, the two-export shape `CellDetailPanel` and `CriterionDetailPanel` already use.

**Modified:**

- `lib/utils/project-panels.ts` — the descriptor union, the key, the guard, and a shared entry-label function.
- `lib/hooks/useProjectPanels.tsx` — `openFinding`.
- `components/quality/quality-styles.ts` — `VERDICT_LABEL` moves here from `FindingCard`; two components need it now.
- `components/quality/FindingCard.tsx` — loses its disclosure and everything behind it.
- `components/quality/FindingsBoard.tsx` — loses `nodesById`/`onOpenNode`, gains `onOpenFinding`, uses `FindingMark`.
- `components/panels/ProjectPanels.tsx` — renders the new kind, threads `openFinding`.
- `components/panels/CellDetailPanel.tsx` — swaps `nodesById`/`onOpenNode` for `onOpenFinding`.
- `components/panels/CriterionDetailPanel.tsx` — the same.
- `components/panels/NodeRelationSections.tsx` — `FindingsSection` opens the finding, not the criterion.
- `components/panels/RelationsGroup.tsx`, `components/panels/NodeDetailPanel.tsx` — thread `onOpenFinding`.
- `components/landing/previews/FindingsBoardPreview.tsx`, `components/landing/previews/client/ReadOnlyFindingsBoard.tsx` — follow the board's prop change.
- `app/project/[id]/quality/findings/page.tsx` — `?finding=`, sharing depth 0 with `?criterion=`.
- `tests/app/project-panels.test.js` — the fifth kind.

---

## Task 1: The `finding` descriptor

**Files:**
- Modify: `lib/utils/project-panels.ts`
- Test: `tests/app/project-panels.test.js`

This module is loaded into Node without a bundler by `tests/app/load-panel-utils.js`, which only works because the module has **no value imports** — `import type` only. Do not add one.

- [ ] **Step 1: Write the failing test**

In `tests/app/project-panels.test.js`, add `findingPanelKey` and `isFindingEntry` to the destructure from `loadProjectPanels()` at the top of the file:

```js
const {
  RAW_PANEL_KEY,
  cellPanelKey,
  criterionPanelKey,
  findingPanelKey,
  isCellEntry,
  isCriterionEntry,
  isFindingEntry,
  isNodeEntry,
  topNodeKey,
  pruneNodeEntries,
  buildPanelCrumbs,
} = loadProjectPanels();
```

Then append this block immediately after the `cellCrumbs` assertion (the end of the `--- cell entries ---` section, before the `--- the History section reads the journal ---` comment):

```js
// --- finding entries: the fifth kind, addressless for the same reason -------
const findingEntry = {
  key: findingPanelKey("F-2026-08-SEC-web-01"),
  instanceId: "i-find",
  payload: {
    kind: "finding",
    findingId: "F-2026-08-SEC-web-01",
    title: "Session cookie is readable from JS",
  },
};

assert(
  findingPanelKey("F-2026-08-SEC-web-01") === "finding:F-2026-08-SEC-web-01",
  "a finding key is namespaced — a finding id is a word the project picks freely",
);
assert(
  isFindingEntry(findingEntry) &&
    !isFindingEntry(cellEntry) &&
    !isFindingEntry(criterionEntry) &&
    !isFindingEntry(rawEntry) &&
    !isNodeEntry(findingEntry),
  "the four non-node kinds are told apart by kind, never by key",
);
assert(
  topNodeKey([homeEntry, findingEntry]) === "V-home",
  "a finding panel above a node does not displace what ?node= names",
);

const findingPruned = pruneNodeEntries([homeEntry, findingEntry], new Set());
assert(
  findingPruned.length === 1 && isFindingEntry(findingPruned[0]),
  "a node prune never evicts a finding panel",
);

const findingCrumbs = buildPanelCrumbs([findingEntry], "Findings", () => undefined);
assert(
  findingCrumbs[findingCrumbs.length - 1].label === "Session cookie is readable from JS",
  "a finding crumb reads as its title, not as its id or its namespaced key",
);

const untitledFinding = {
  key: findingPanelKey("F-x"),
  instanceId: "i-untitled",
  payload: { kind: "finding", findingId: "F-x", title: "" },
};
assert(
  buildPanelCrumbs([untitledFinding], "Findings", () => undefined)[1].label === "F-x",
  "a finding with no title falls back to its id — a crumb is never blank",
);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:project-panels`

Expected: FAIL. `findingPanelKey` is not a function, so the run throws a `TypeError` before reaching the assertions.

- [ ] **Step 3: Add the key, the descriptor and the guard**

In `lib/utils/project-panels.ts`, extend the file's head docblock. Replace this sentence:

```
 * A cell panel is the third: a domain crossed with a surface is a
 * *reading* of this project's audit rather than a node in its graph, and the
 * Matrix page addresses it with `?cell=`. The stack still has exactly one
 * address, and it is still `?node=`.
```

with:

```
 * A cell panel is the third: a domain crossed with a surface is a
 * *reading* of this project's audit rather than a node in its graph, and the
 * Matrix page addresses it with `?cell=`. A finding panel is the fourth, for
 * the same reason the cell is — a finding is something the audit says about
 * this project, not a node in its graph — and the Findings page addresses it
 * with `?finding=`. The stack still has exactly one address, and it is still
 * `?node=`.
```

Add, immediately after `cellPanelKey`:

```ts
/**
 * A finding panel's key.
 *
 * Namespaced for `criterionPanelKey`'s reason and with the same force: a
 * finding id is project-authored. The pilot writes `F-2026-08-SEC-web-01`, but
 * nothing in the schema stops a project choosing a bare word, so the namespace
 * removes the collision question instead of trusting a convention to hold.
 *
 * The id alone, unlike a criterion's: a finding belongs to exactly one surface
 * already, so there is no second axis to key on.
 */
export function findingPanelKey(findingId: string): string {
  return `finding:${findingId}`;
}
```

Add, immediately after `CellPanelDescriptor`:

```ts
/**
 * One finding's detail. Addressless in the stack for the reason stated at the
 * top of this file; the Findings page owns `?finding=`.
 */
export interface FindingPanelDescriptor {
  kind: "finding";
  findingId: string;
  /**
   * The finding's title, so the crumb and the close label read as prose rather
   * than as `F-2026-08-SEC-web-01`.
   *
   * The one piece of denormalized display data in this union, against the
   * stack's usual rule of resolving by id so an edit reaches every panel. It is
   * safe here on two counts: findings are read-only in this app — they are
   * written by the CLI and the MCP server — and `openFrom` refreshes an entry's
   * payload whenever the same key lands back in the same slot, so re-opening a
   * finding picks up a new title. The alternative was threading every page's
   * findings through `PageHeader` and `usePanelBreadcrumbs` for the three pages
   * that never open one.
   *
   * May be `""` — see `panelEntryLabel`, which falls back to the id rather than
   * rendering a blank crumb.
   */
  title: string;
}
```

Extend the union:

```ts
export type PanelDescriptor =
  | NodePanelDescriptor
  | CriterionPanelDescriptor
  | CellPanelDescriptor
  | FindingPanelDescriptor
  | { kind: "raw" };
```

Add the guard, after `isCellEntry`:

```ts
export function isFindingEntry(
  entry: ProjectPanelEntry,
): entry is PanelEntry<FindingPanelDescriptor> {
  return entry.payload.kind === "finding";
}
```

- [ ] **Step 4: Extract the shared entry label and use it in the crumbs**

`buildPanelCrumbs` and `ProjectPanels`' `labelOf` answer the same question — what do you call this entry — and a fifth kind would make that a five-branch ternary in two places that already disagree about how they spot a raw entry (one tests the key, the other the kind). One function, branching on `kind`, settles both.

Add above `buildPanelCrumbs` in `lib/utils/project-panels.ts`:

```ts
/**
 * What to call one entry: the label the breadcrumb shows, the close button
 * announces, and the collapsed rail prints.
 *
 * One function because those are one question, and they were answered in two
 * places that had already drifted — `buildPanelCrumbs` spotted a raw entry by
 * its key while `ProjectPanels` spotted it by its kind. Branching on `kind`
 * throughout is the honest test: the key/kind equivalence is an invariant the
 * union does not enforce, so a second test of it is a second thing that can rot.
 *
 * Only a node entry's key is a node id, which is why only a node entry is put
 * to `titleOf` — a criterion falling through to it would read as its whole
 * namespaced key, `criterion:SEC-03@web`, in a breadcrumb.
 */
export function panelEntryLabel(
  entry: ProjectPanelEntry,
  titleOf: (nodeId: string) => string | undefined,
): string {
  switch (entry.payload.kind) {
    case "raw":
      return "Raw bundle";
    case "criterion":
      return entry.payload.criterionId;
    case "cell":
      return `${entry.payload.domain} × ${entry.payload.surface}`;
    // A finding carries its own title, and falls back to its id when a caller
    // had none to give: a crumb is never blank.
    case "finding":
      return entry.payload.title === "" ? entry.payload.findingId : entry.payload.title;
    case "node":
      return titleOf(entry.key) ?? entry.key;
  }
}
```

Then replace the body of `buildPanelCrumbs`' map — the whole `label:` ternary, including the comment above it — with the call:

```ts
export function buildPanelCrumbs(
  entries: ProjectPanelEntry[],
  rootLabel: string,
  titleOf: (nodeId: string) => string | undefined,
): PanelCrumbSpec[] {
  if (entries.length === 0) return [];

  return [
    { label: rootLabel, id: "root", depth: 0 },
    ...entries.map((entry, index) => ({
      label: panelEntryLabel(entry, titleOf),
      id: entry.instanceId,
      depth: index === entries.length - 1 ? null : index + 1,
    })),
  ];
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test:project-panels`

Expected: PASS, ending in `All project-panels tests passed`. The pre-existing assertions must all still pass — in particular `crumbs[3].label === "Raw bundle"`, which now resolves through `kind` rather than through `RAW_PANEL_KEY`.

- [ ] **Step 6: Commit**

```bash
git add lib/utils/project-panels.ts tests/app/project-panels.test.js
git commit -m "feat(panels): a finding is a panel kind

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: `openFinding` on the panel stack

**Files:**
- Modify: `lib/hooks/useProjectPanels.tsx`

No test: this hook is a React context provider with no bundler-free load path, which is why `openCriterion` and `openCell` have none either. What is testable — the descriptor and the transitions — is pinned in Task 1 and in `tests/app/panel-stack.test.js`.

- [ ] **Step 1: Import what the new opener needs**

Add to the existing `@/lib/utils/project-panels` import block, keeping it alphabetical:

```ts
import {
  cellPanelKey,
  criterionPanelKey,
  findingPanelKey,
  isNodeEntry,
  pruneNodeEntries,
  topNodeKey,
  RAW_PANEL_KEY,
  type NodePanelDescriptor,
  type PanelDescriptor,
  type ProjectPanelEntry,
} from "@/lib/utils/project-panels";
```

And add a type-only import for the row, after the `project-panels` import:

```ts
import type { FindingRow } from "@/lib/utils/quality";
```

- [ ] **Step 2: Declare it on the context value**

In `interface ProjectPanelsValue`, immediately after the `openCell` member:

```ts
  /**
   * Open one finding's detail — or refresh the one already in that slot.
   * Publishes nothing, exactly like `openCriterion` and `openCell` and for the
   * identical reason: the stack has one address and it is `?node=`. The
   * Findings page owns `?finding=`.
   *
   * `fromDepth` carries the same warning as `openCriterion`'s. **A caller
   * opening a finding from the surface passes `0`** — on the default
   * (`previous.length`) working down a board would leave one panel per card.
   *
   * Takes the row rather than an id because the descriptor carries the title,
   * and every caller has the row in hand already: a finding is only ever opened
   * from something that just rendered it.
   */
  openFinding: (row: FindingRow, fromDepth?: number) => void;
```

- [ ] **Step 3: Implement it**

Immediately after the `openCell` callback:

```ts
  /**
   * Open one finding. Addressless, `fromDepth`-sensitive — see the interface.
   */
  const openFinding = useCallback((row: FindingRow, fromDepth?: number) => {
    setEntries((previous) =>
      openFrom<PanelDescriptor>(previous, fromDepth ?? previous.length, findingPanelKey(row.id), {
        kind: "finding",
        findingId: row.id,
        title: row.title,
      }),
    );
  }, []);
```

- [ ] **Step 4: Publish it**

In the `useMemo` that builds the context value, add `openFinding,` after `openCell,` in the returned object, and add `openFinding` to the dependency array (it is alphabetical: between `openCell` and `openNode`).

- [ ] **Step 5: Verify it compiles and lints**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

Run: `npm run lint`
Expected: no errors. Warnings are tolerated — `main` lints at 0 errors / 4 warnings, so any *error* is yours.

- [ ] **Step 6: Commit**

```bash
git add lib/hooks/useProjectPanels.tsx
git commit -m "feat(panels): openFinding

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: `FindingMark` — one mark for the rail and the panel header

**Files:**
- Create: `components/quality/FindingMark.tsx`
- Modify: `components/quality/FindingsBoard.tsx`

- [ ] **Step 1: Create the component**

Create `components/quality/FindingMark.tsx` with exactly this content. Every constant in it is moved verbatim out of `FindingsBoard`, including its docblocks:

```tsx
"use client";

import type { ReactNode } from "react";
import { CheckIcon, ShieldIcon, XIcon } from "lucide-react";
import type { FindingStatus } from "@arkaik/schema";
import type { FindingRow } from "@/lib/utils/quality";
import { ScaleChip } from "@/components/quality/ScaleChip";
import {
  FINDING_STATUS_GLOSS,
  FINDING_STATUS_LABEL,
  FINDING_STATUS_TILE,
  PRIORITY_GLOSS,
  PRIORITY_TERM,
  PRIORITY_TILE,
} from "@/components/quality/quality-styles";
import { iconChipVariants } from "@/components/layout/IconChip";
import { cn } from "@/lib/utils";

/** Every status other than `open` — the ones that get a verdict mark. */
type DecidedStatus = Exclude<FindingStatus, "open">;

/**
 * The mark's square. `bare` because the mark brings its own lane or verdict
 * colour, which is the whole point of it.
 */
const MARK_CLASS = iconChipVariants({ variant: "bare" });

/**
 * The verdict, as a glyph. A tick for the fix, a cross for the defect that was
 * not one, a shield for the risk somebody chose to carry — three different
 * answers, and three different marks, because "not open" is not one state.
 */
const STATUS_ICON: Record<DecidedStatus, ReactNode> = {
  resolved: <CheckIcon className="size-3.5" aria-hidden="true" />,
  refuted: <XIcon className="size-3.5" aria-hidden="true" />,
  "accepted-risk": <ShieldIcon className="size-3.5" aria-hidden="true" />,
};

/**
 * One finding, as a square you can scan.
 *
 * On an open finding it is the priority and nothing else: the digit alone,
 * because `P` repeated down a column of squares is a letter nobody reads twice.
 * The chip's own gloss says what the lane means.
 *
 * On a decided one the priority gives way to the verdict — a green tick reads
 * down the rail as "answered" at the same glance the red squares read as
 * "owed", and the lane it was filed in moves into the gloss.
 *
 * A component rather than two blocks inlined in the board, because the finding
 * panel's header wears the identical mark: it is how the panel says it is the
 * thing the reader clicked. Two copies would part company the first time a
 * status tile changed.
 */
export function FindingMark({ row, className }: { row: FindingRow; className?: string }) {
  if (row.open) {
    return (
      <ScaleChip
        term={PRIORITY_TERM[row.priority]}
        hint={PRIORITY_GLOSS[row.priority]}
        className={cn(
          MARK_CLASS,
          "text-xs font-semibold tabular-nums",
          PRIORITY_TILE[row.priority],
          className,
        )}
      >
        {row.priority.slice(1)}
      </ScaleChip>
    );
  }

  const status = row.status as DecidedStatus;

  return (
    <ScaleChip
      term={`${FINDING_STATUS_LABEL[status]} — filed ${row.priority}`}
      hint={FINDING_STATUS_GLOSS[status]}
      className={cn(MARK_CLASS, FINDING_STATUS_TILE[status], className)}
    >
      {STATUS_ICON[status]}
    </ScaleChip>
  );
}
```

- [ ] **Step 2: Use it in the board**

In `components/quality/FindingsBoard.tsx`:

Delete the `CheckIcon, ShieldIcon, XIcon` import, the `FindingStatus` type import, the `ScaleChip` import, the `iconChipVariants` import, the `cn` import if nothing else uses it (the board still uses `cn` on the content column — keep it), the whole `quality-styles` import block, and the `DecidedStatus`, `MARK_CLASS` and `STATUS_ICON` declarations with their docblocks. They now live in `FindingMark.tsx`.

Add:

```tsx
import { FindingMark } from "@/components/quality/FindingMark";
```

Replace the whole `row.open ? (…) : (…)` ternary inside the rail column — and the long comment above it, which has moved into `FindingMark`'s docblock — with:

```tsx
              <FindingMark row={row} />
```

The rail column then reads:

```tsx
            <div className="flex flex-col items-center">
              <FindingMark row={row} />
              {!last && <span className="w-px flex-1 bg-border" aria-hidden="true" />}
            </div>
```

Leave the comment above that `<div>` — the one explaining the `flex-1` connector — exactly where it is.

- [ ] **Step 3: Verify nothing moved on screen**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

Run: `npm run lint`
Expected: no new errors. In particular no `no-unused-vars` for an import left behind in `FindingsBoard.tsx`.

- [ ] **Step 4: Commit**

```bash
git add components/quality/FindingMark.tsx components/quality/FindingsBoard.tsx
git commit -m "refactor(quality): the rail's mark is a component

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: `VERDICT_LABEL` moves to `quality-styles`

**Files:**
- Modify: `components/quality/quality-styles.ts`
- Modify: `components/quality/FindingCard.tsx`

The card keeps its verdict word on the meta line and the panel needs the same word; a second table would be a second vocabulary.

- [ ] **Step 1: Add it to the shared table module**

In `components/quality/quality-styles.ts`, append at the end of the file:

```ts
/**
 * The refutation pass's verdict in prose (SPEC §6.5). `DOWNGRADED` is the one
 * that has to be spelled out: a finding the pass argued *down* still stands,
 * and a reader who takes it for a refusal will skip a real defect.
 *
 * Here rather than in the card that first needed it, because the finding panel
 * says the same word — and two tables would be two vocabularies for one verdict.
 */
export const VERDICT_LABEL: Record<NonNullable<QualityFinding["verification"]>["verdict"], string> = {
  CONFIRMED: "Confirmed",
  REFUTED: "Refuted",
  DOWNGRADED: "Downgraded",
};
```

Extend the module's existing `@arkaik/schema` type import at the top of the file:

```ts
import type {
  FindingPriority,
  RemediationCost,
  FindingSeverity,
  FindingStatus,
  QualityFinding,
  QualityGrade,
} from "@arkaik/schema";
```

- [ ] **Step 2: Drop the card's copy**

In `components/quality/FindingCard.tsx`, delete the local `VERDICT_LABEL` declaration and its docblock, and delete `QualityFinding` from the `@arkaik/schema` import if nothing else in the file uses it (the file still imports `CROSS_SURFACE_ID` — keep that). Add `VERDICT_LABEL` to the existing `quality-styles` import block.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add components/quality/quality-styles.ts components/quality/FindingCard.tsx
git commit -m "refactor(quality): VERDICT_LABEL joins the shared tables

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: `FindingDetailPanel`

**Files:**
- Create: `components/panels/FindingDetailPanel.tsx`

Nothing renders it yet — that is Task 6. The file must satisfy `tests/app/panel-semantics.test.js`, which walks every `.tsx` in `components/panels/` and rejects any heading that is not `h3` or `h4`. Using `PanelSection` for every section satisfies that for free; do not hand-write a heading tag.

- [ ] **Step 1: Create the file**

Create `components/panels/FindingDetailPanel.tsx`:

```tsx
"use client";

import { ExternalLinkIcon } from "lucide-react";
import { CROSS_SURFACE_ID, type QualitySection } from "@arkaik/schema";
import { PanelSection, PANEL_GUTTER } from "@/components/panels/PanelSection";
import { FindingMark } from "@/components/quality/FindingMark";
import { ScaleChip } from "@/components/quality/ScaleChip";
import { SeverityPill } from "@/components/quality/SeverityPill";
import {
  COST_CHIP,
  COST_HINT,
  COST_TERM,
  FINDING_STATUS_LABEL,
  VERDICT_LABEL,
} from "@/components/quality/quality-styles";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import type { Node } from "@/lib/data/types";
import type { FindingRow } from "@/lib/utils/quality";
import { cn } from "@/lib/utils";

interface FindingDetailPanelProps {
  findingId: string;
  /**
   * The title the descriptor carried. Only ever shown when the id resolves to
   * nothing — a live row's own title is the truth, and it is what the panel
   * renders.
   */
  title: string;
  /**
   * Every finding in the section, denormalized once by `ProjectPanels`. The
   * panel picks its own out by id rather than being handed a row, so an audit
   * arriving under an open panel reaches it.
   */
  findings: FindingRow[];
  /** The audit profile, for naming the surface the way the matrix names it. */
  section?: QualitySection;
  /** The graph, so a linked node reads as a title rather than as an id. */
  nodesById: ReadonlyMap<string, Node>;
  onOpenNode: (nodeId: string) => void;
  onOpenCriterion: (criterionId: string, surface: string) => void;
}

/**
 * A surface id as the profile titles it.
 *
 * `cross-surface` is a findings-only lens no profile declares, so it is named
 * here rather than left to print its raw slug — the rule `FindingCard` follows,
 * and the reason a reader scoped to one surface cannot mistake it for theirs.
 */
function surfaceTitleOf(surface: string, section?: QualitySection): string {
  if (surface === CROSS_SURFACE_ID) return "Cross-surface";
  return section?.profile?.surfaces?.find((candidate) => candidate?.id === surface)?.title ?? surface;
}

/**
 * What identifies the panel in the stack's header: the finding's own mark, its
 * title, and the surface it was filed on. The close button belongs to
 * `PanelStack`, which owns every panel's frame.
 *
 * The mark is the same component the board draws down its rail, which is how
 * the panel says it is the row the reader just clicked.
 */
export function FindingDetailPanelHeader({
  findingId,
  title,
  findings,
  section,
}: Pick<FindingDetailPanelProps, "findingId" | "title" | "findings" | "section">) {
  const row = findings.find((candidate) => candidate.id === findingId);

  return (
    <>
      {row && <FindingMark row={row} />}
      <span className="truncate text-sm font-medium">{row?.title ?? title}</span>
      {row && (
        <span className="shrink-0 text-xs text-muted-foreground">
          {surfaceTitleOf(row.surface, section)}
        </span>
      )}
    </>
  );
}

/**
 * One finding, in full.
 *
 * A finding is an entity, so it is read the way every other entity in this app
 * is read — in a panel. It used to be read by expanding a row in place, which
 * cost the board its scannability exactly when a reader needed it: detail,
 * evidence, a verification note, the linked nodes and two identifiers is
 * several screens, and the rows under it went off the bottom.
 *
 * Addressless in the stack — see the head of `lib/utils/project-panels.ts`. The
 * Findings page owns `?finding=`.
 *
 * Read-only, like the criterion and cell panels beside it. Resolving a finding
 * and accepting a risk are journal writes the CLI and the MCP server make
 * (`quality.finding.resolved`, `quality.finding.accepted`); this app has no
 * write path for either, and inventing one here would be inventing it in the
 * wrong place.
 *
 * Every section is conditional on having something to say, the rule
 * `CriterionDetailPanel` states: a heading over nothing reads as a panel that
 * failed to load rather than as a finding nobody wrote evidence for.
 */
export function FindingDetailPanel({
  findingId,
  title,
  findings,
  section,
  nodesById,
  onOpenNode,
  onOpenCriterion,
}: FindingDetailPanelProps) {
  const row = findings.find((candidate) => candidate.id === findingId);

  // Say so rather than rendering nothing. This is where a stale `?finding=`
  // link lands, and where a re-imported bundle that dropped the finding leaves
  // an open panel — and in both cases a blank body would read as a bug.
  if (!row) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto p-5 lg:p-6">
        <EmptyState
          message={
            <>
              This audit carries no finding with the id{" "}
              <span className="font-mono">{findingId}</span>
              {title !== "" ? ` (“${title}”)` : ""}. A later import may have dropped it, or the link
              may be out of date.
            </>
          }
        />
      </div>
    );
  }

  const verdict = row.verification?.verdict;
  const acceptedRisk = row.status === "accepted-risk";
  // The guard that keeps one sentence from appearing twice: a finding carries
  // no dedicated note field, so an accepted risk's rationale is the refutation
  // pass's note when it wrote one and the filed detail otherwise — and the
  // detail is also what the Detail section renders.
  //
  // `||` rather than `??`, because `""` is not a note somebody wrote.
  const acceptedNote = acceptedRisk ? row.verification?.note || row.detail : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto py-4">
      {/* The identity block. The header states the same three things in one
          truncating row; here the title gets to wrap, and the parameters a
          reader triages from get a line each. */}
      <div className={cn(PANEL_GUTTER, "flex flex-col gap-2")}>
        <p className="text-sm font-medium leading-relaxed">{row.title}</p>

        {/* Which criterion this answers to, and on which surface — what
            somebody quotes when they argue it. Its own line rather than
            fighting five numbers for space. */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <button
            type="button"
            onClick={() => onOpenCriterion(row.criterionId, row.surface)}
            className="rounded bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] transition-colors hover:bg-muted hover:text-foreground"
            title={`Open ${row.criterionName}`}
          >
            {row.criterionId}
          </button>
          {row.criterionName !== row.criterionId && <span>{row.criterionName}</span>}
          {row.surface === CROSS_SURFACE_ID ? (
            <Badge variant="outline" className="font-normal">
              Cross-surface
            </Badge>
          ) : (
            <span title={row.surface}>· {surfaceTitleOf(row.surface, section)}</span>
          )}
        </div>

        {/* The scales. The priority is not repeated: it is the mark in the
            header, the same square the rail carried. */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <SeverityPill
            impact={row.impact}
            likelihood={row.likelihood}
            risk={row.risk}
            severity={row.severity}
          />
          <span>· cost</span>
          <ScaleChip
            term={COST_TERM[row.cost]}
            hint={COST_HINT[row.cost]}
            className={cn("rounded border px-1 font-medium", COST_CHIP[row.cost])}
          >
            {row.cost}
          </ScaleChip>
          {verdict && <span>· {VERDICT_LABEL[verdict]}</span>}
          {!row.open && !acceptedRisk && (
            <Badge
              variant="outline"
              className={cn(
                "ms-auto",
                row.status === "resolved" && "border-green-500/40 text-green-700 dark:text-green-400",
              )}
            >
              {FINDING_STATUS_LABEL[row.status]}
            </Badge>
          )}
        </div>
      </div>

      {/* An accepted risk is a decision, so it reads as one — the decision
          log's bordered row with its status stated, first thing under the
          identity block. Somebody already weighed this and said "not now", and
          burying that invites the next reader to re-litigate it. */}
      {acceptedRisk && (
        <div className={PANEL_GUTTER}>
          <div className="rounded-lg border bg-muted/30 px-3 py-2.5">
            <Badge variant="outline" className="mb-1.5">
              {FINDING_STATUS_LABEL["accepted-risk"]}
            </Badge>
            <p className="text-sm leading-relaxed text-muted-foreground">{acceptedNote}</p>
          </div>
        </div>
      )}

      {row.detail !== "" && row.detail !== acceptedNote && (
        <PanelSection title="Detail">
          <p className="text-sm leading-relaxed">{row.detail}</p>
        </PanelSection>
      )}

      {row.evidence !== "" && (
        <PanelSection title="Evidence">
          {/* Monospace and preserved line breaks: this field is where
              `file:line` citations live, and a citation reflowed into prose is
              a citation nobody can paste into an editor. */}
          <p className="whitespace-pre-wrap break-words rounded-md bg-muted/50 p-3 font-mono text-xs leading-relaxed text-muted-foreground">
            {row.evidence}
          </p>
        </PanelSection>
      )}

      {verdict && row.verification?.note && row.verification.note !== acceptedNote && (
        <PanelSection title="Verification">
          <p className="text-sm leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">{VERDICT_LABEL[verdict]}</span> —{" "}
            {row.verification.note}
          </p>
        </PanelSection>
      )}

      {row.nodeIds.length > 0 && (
        <PanelSection title="In the graph">
          <div className="flex flex-wrap gap-1.5">
            {row.nodeIds.map((nodeId) => {
              const node = nodesById.get(nodeId);
              return (
                <button
                  key={nodeId}
                  type="button"
                  onClick={() => onOpenNode(nodeId)}
                  // Still a button when the id resolves to nothing: a finding
                  // filed against a node that has since been deleted is a fact
                  // about the audit, and a silently dropped chip would hide it.
                  // The panel it opens says so.
                  title={node ? nodeId : `${nodeId} — not in this project's graph`}
                  className={cn(
                    "max-w-full truncate rounded border px-1.5 py-0.5 text-xs transition-colors hover:bg-muted",
                    node ? "text-foreground" : "border-dashed font-mono text-muted-foreground",
                  )}
                >
                  {node?.title ?? nodeId}
                </button>
              );
            })}
          </div>
        </PanelSection>
      )}

      <PanelSection title="Reference">
        <div className="flex flex-col gap-1.5 text-xs text-muted-foreground">
          {/* What somebody pastes into an issue or hands to `arkaik kritik`. */}
          <span className="select-all font-mono">{row.id}</span>
          {row.issueUrl && (
            // `break-all` on the text and `shrink-0` on the icon: a GitHub
            // issue URL is long enough to be cut off mid-path rather than
            // wrapped.
            <a
              href={row.issueUrl}
              target="_blank"
              rel="nofollow noreferrer"
              className="inline-flex min-w-0 max-w-full items-start gap-1.5 underline underline-offset-4 hover:text-foreground"
            >
              <ExternalLinkIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 break-all">{row.issueUrl}</span>
            </a>
          )}
        </div>
      </PanelSection>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles and keeps the outline**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

Run: `npm run test:panel-semantics`
Expected: PASS, including `panel bodies head their sections at h3 or h4` — the new file contributes no heading of its own, so it cannot stray.

- [ ] **Step 3: Commit**

```bash
git add components/panels/FindingDetailPanel.tsx
git commit -m "feat(panels): the finding panel

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: `ProjectPanels` renders the finding kind

**Files:**
- Modify: `components/panels/ProjectPanels.tsx`

- [ ] **Step 1: Import the panel and take `openFinding` from the stack**

Add to the imports, after the `CriterionDetailPanel` block:

```tsx
import {
  FindingDetailPanel,
  FindingDetailPanelHeader,
} from "@/components/panels/FindingDetailPanel";
```

Change the `useProjectPanels()` destructure to include `openFinding`:

```tsx
  const { entries, openNode, openCriterion, openFinding, closeAt, unwindTo, pruneMissingNodes, panelStates } =
    useProjectPanels();
```

- [ ] **Step 2: Simplify `labelOf` onto the shared function**

Replace the whole `labelOf` callback — including its comment, whose point about branching on `kind` now lives in `panelEntryLabel`'s docblock — with:

```tsx
  // One label function for the crumbs, the close button and the collapsed rail.
  // See `panelEntryLabel`: only a node entry's key is a node id, which is why
  // only a node entry is put to the title lookup.
  const labelOf = useCallback(
    (entry: PanelEntry<PanelDescriptor>) => panelEntryLabel(entry, (id) => nodesById.get(id)?.title),
    [nodesById],
  );
```

Add `panelEntryLabel` to the existing `@/lib/utils/project-panels` import (it currently imports `type PanelDescriptor` only, so it becomes a mixed import):

```tsx
import { panelEntryLabel, type PanelDescriptor } from "@/lib/utils/project-panels";
```

- [ ] **Step 3: Render the header**

In `renderHeader`, immediately after the `cell` branch and before the `criterion` branch:

```tsx
          if (entry.payload.kind === "finding")
            return (
              <FindingDetailPanelHeader
                findingId={entry.payload.findingId}
                title={entry.payload.title}
                findings={qualityFindings}
                section={qualitySection}
              />
            );
```

- [ ] **Step 4: Render the body**

In `renderBody`, immediately after the `cell` branch and before the `criterion` branch:

```tsx
          if (entry.payload.kind === "finding") {
            return (
              <FindingDetailPanel
                findingId={entry.payload.findingId}
                title={entry.payload.title}
                findings={qualityFindings}
                section={qualitySection}
                nodesById={nodesById}
                // Above this panel, never in place of it — the rule every other
                // navigation in the stack follows, so the trail still reads back
                // to the finding the reader came from.
                onOpenNode={(nodeId) => openNode({ nodeId }, index + 1)}
                onOpenCriterion={(criterionId, criterionSurface) =>
                  openCriterion(criterionId, criterionSurface, index + 1)
                }
              />
            );
          }
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

Run: `npm run test:panel-semantics && npm run test:project-panels`
Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add components/panels/ProjectPanels.tsx
git commit -m "feat(panels): the stack renders a finding

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7: The card loses its disclosure

**Files:**
- Modify: `components/quality/FindingCard.tsx`
- Modify: `components/quality/FindingsBoard.tsx`
- Modify: `components/panels/CellDetailPanel.tsx`
- Modify: `components/panels/CriterionDetailPanel.tsx`
- Modify: `components/panels/ProjectPanels.tsx`
- Modify: `app/project/[id]/quality/findings/page.tsx`
- Modify: `components/landing/previews/client/ReadOnlyFindingsBoard.tsx`
- Modify: `components/landing/previews/FindingsBoardPreview.tsx`

**This is one commit on purpose.** `onOpenFinding` is required and `nodesById`/`onOpenNode` go away in the same breath, so the tree does not compile between the card and its last call site. Do all eight files, then verify.

- [ ] **Step 1: Rewrite `FindingCard`**

Replace the entire contents of `components/quality/FindingCard.tsx` with:

```tsx
"use client";

import { CROSS_SURFACE_ID } from "@arkaik/schema";
import type { FindingRow } from "@/lib/utils/quality";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  COST_CHIP,
  COST_HINT,
  COST_TERM,
  FINDING_STATUS_LABEL,
  VERDICT_LABEL,
} from "@/components/quality/quality-styles";
import { ScaleChip } from "@/components/quality/ScaleChip";
import { SeverityPill } from "@/components/quality/SeverityPill";

interface FindingCardProps {
  row: FindingRow;
  /**
   * `surface id -> title`, built once on the page. The card names the surface
   * the way the matrix's column header and the Surface menu name it; the id
   * itself stays one hover away, and is the fallback for a surface the profile
   * never titled.
   */
  surfaceTitles: ReadonlyMap<string, string>;
  /** Opens the finding's own panel. The card's whole reason to be a control. */
  onOpenFinding: (row: FindingRow) => void;
  /**
   * Opens the criterion this finding answers to — and, by its absence, says the
   * reader is already inside it.
   *
   * The criterion chip is a control, not a label: in the criterion panel it
   * would re-open the panel it is drawn in, under a heading that already names
   * the same criterion. So an omitted handler drops the chip and the name with
   * it, rather than leaving a dead button behind.
   */
  onOpenCriterion?: (criterionId: string, surface: string) => void;
}

/**
 * One finding, as a line you can triage from.
 *
 * It used to expand in place to everything the audit recorded, and that was the
 * one entity in this app read without a panel. Several screens of detail,
 * evidence and identifiers pushed the rest of the board off the bottom exactly
 * when a reader was working down it. All of that now lives in
 * `FindingDetailPanel`, and the title is the control that opens it.
 *
 * What stays on the card is what a reader triages from without opening
 * anything: the title, the criterion and surface it answers to, and the scales.
 *
 * The severity treatment comes from `row.severity`, never from `row.risk`. They
 * agree today, and the day a pack moves a bucket they would stop agreeing —
 * with the colour saying one thing and the lane the board sorted it into saying
 * another. `severityOf` is the pack's answer; this only paints it.
 *
 * No card chrome. The entry sits on the timeline's rail, and a bordered box per
 * entry inside a rail that is already the grouping is the second lid the
 * Changelog dropped for the same reason.
 */
export function FindingCard({ row, surfaceTitles, onOpenFinding, onOpenCriterion }: FindingCardProps) {
  const verdict = row.verification?.verdict;
  const acceptedRisk = row.status === "accepted-risk";
  // What the accepted-risk callout shows: a finding carries no dedicated note
  // field, so the rationale is the refutation pass's note when it wrote one and
  // the filed detail otherwise. `||` rather than `??`, because `""` is not a
  // note somebody wrote — a verification carrying an empty one would otherwise
  // draw the bordered callout around an empty paragraph.
  const acceptedNote = acceptedRisk ? row.verification?.note || row.detail : undefined;

  return (
    <article
      className={cn(
        "flex min-w-0 flex-col gap-1",
        // Resolved and refuted findings are history, not work. Dimmed rather
        // than dropped, because the board is also where somebody checks what
        // was already answered — and the status filter is how you hide them.
        !row.open && "opacity-70",
      )}
    >
      {/* The name first, on the line the rail's square centres against, and the
          control that opens the finding. */}
      <button
        type="button"
        onClick={() => onOpenFinding(row)}
        className="flex w-full items-start text-left"
      >
        <span className="flex-1 text-sm font-medium leading-relaxed hover:underline hover:underline-offset-4">
          {row.title}
        </span>
      </button>

      {/* The reference, on its own line: which criterion this finding answers
          to, and on which surface. It is what somebody quotes when they file it
          or argue it, so it is not left to fight for space in a meta line with
          five numbers in it.

          Outside the title button, because the criterion in it is a control of
          its own and a button inside a button is not markup a browser will
          honour. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        {onOpenCriterion && (
          <>
            <button
              type="button"
              onClick={() => onOpenCriterion(row.criterionId, row.surface)}
              className="rounded bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] transition-colors hover:bg-muted hover:text-foreground"
              title={`Open ${row.criterionName}`}
            >
              {row.criterionId}
            </button>
            {row.criterionName !== row.criterionId && (
              <span className="max-w-[24rem] truncate">{row.criterionName}</span>
            )}
          </>
        )}
        {/* A finding that belongs to no single surface is called that, in a
            badge, rather than left to read as a surface id nobody titled —
            `cross-surface` is a findings-only lens and no profile declares it,
            so the fallback below would print the raw slug. It is also the row a
            reader is most likely to mistake for the surface they are scoped to.

            Everywhere else: the profile's title, the same word the matrix
            column header and the Surface menu use. The id is on the hover. */}
        {row.surface === CROSS_SURFACE_ID ? (
          <Badge variant="outline" className="font-normal">
            Cross-surface
          </Badge>
        ) : (
          <span title={row.surface}>
            {onOpenCriterion && "· "}
            {surfaceTitles.get(row.surface) ?? row.surface}
          </span>
        )}
      </div>

      {/* The scales, on the third line: severity and cost as chips that gloss
          themselves, with the numbers severity is read from between them.

          The priority is not repeated here: it is the square on the rail. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <SeverityPill
          impact={row.impact}
          likelihood={row.likelihood}
          risk={row.risk}
          severity={row.severity}
        />
        <span>· cost</span>
        <ScaleChip
          term={COST_TERM[row.cost]}
          hint={COST_HINT[row.cost]}
          className={cn("rounded border px-1 font-medium", COST_CHIP[row.cost])}
        >
          {row.cost}
        </ScaleChip>
        {verdict && <span>· {VERDICT_LABEL[verdict]}</span>}
        {/* The accepted-risk callout below states the status in its own badge,
            in the treatment that says it is a decision; a second badge up here
            would say it twice and more quietly. */}
        {/* The rail's mark is a glyph; this is the word for it, and the only
            copy of it a screen reader meets. Tinted to match the tick for
            `resolved` alone — the same rule the rail follows, and the reason
            the badge did not simply give way to the mark. */}
        {!row.open && !acceptedRisk && (
          <Badge
            variant="outline"
            className={cn(
              "ms-auto",
              row.status === "resolved" && "border-green-500/40 text-green-700 dark:text-green-400",
            )}
          >
            {FINDING_STATUS_LABEL[row.status]}
          </Badge>
        )}
      </div>

      {/*
        An accepted risk is a decision, so it reads as one — the decision log's
        bordered row with its status stated. It stays on the card rather than
        moving to the panel with everything else: the whole point of the status
        is that somebody already weighed this and said "not now", and a reader
        scanning the board must not have to open a panel to learn it.
      */}
      {acceptedRisk && (
        <div className="mt-1 rounded-lg border bg-muted/30 px-3 py-2.5">
          <Badge variant="outline" className="mb-1.5">
            {FINDING_STATUS_LABEL["accepted-risk"]}
          </Badge>
          <p className="text-sm leading-relaxed text-muted-foreground">{acceptedNote}</p>
        </div>
      )}
    </article>
  );
}
```

- [ ] **Step 2: Change the board's props**

In `components/quality/FindingsBoard.tsx`:

Delete the `import type { Node } from "@/lib/data/types";` line — nothing in the board names a node any more.

Replace the `nodesById` and `onOpenNode` members of `FindingsBoardProps` with `onOpenFinding`:

```tsx
interface FindingsBoardProps {
  /** Every finding to show, already filtered and sorted — worst first. */
  rows: FindingRow[];
  /** `surface id -> title`, built once on the page and handed to every entry. */
  surfaceTitles: ReadonlyMap<string, string>;
  /**
   * Opens one finding's own panel. Required: a board whose rows do nothing is
   * a list of headlines, which is what this board was before findings had a
   * panel — and the disclosure it replaced could not be optional either.
   */
  onOpenFinding: (row: FindingRow) => void;
  /** Passed straight through; omitted inside the criterion panel — see `FindingCard`. */
  onOpenCriterion?: (criterionId: string, surface: string) => void;
}
```

Update the destructure and the `<FindingCard>` call to match:

```tsx
export function FindingsBoard({
  rows,
  surfaceTitles,
  onOpenFinding,
  onOpenCriterion,
}: FindingsBoardProps) {
```

```tsx
              <FindingCard
                row={row}
                surfaceTitles={surfaceTitles}
                onOpenFinding={onOpenFinding}
                onOpenCriterion={onOpenCriterion}
              />
```

Leave the component's docblock as it is, and add one paragraph to the end of it, just above the closing `*/`:

```
 * A row opens the finding's own panel. It used to expand in place, which is
 * the gesture this rail was built to replace everywhere else on the page —
 * which is also why the board no longer needs the graph: the linked-node chips
 * went to the panel with everything else behind the disclosure.
```

- [ ] **Step 3: `CellDetailPanel`**

Replace the `findings` / `nodesById` / `onOpenNode` prop trio's node half. In `CellDetailPanelProps`, delete the `nodesById` member and replace `onOpenNode: (nodeId: string) => void;` with:

```ts
  onOpenFinding: (row: FindingRow) => void;
```

Delete the `import type { Node } from "@/lib/data/types";` line. Update the destructure: remove `nodesById` and `onOpenNode`, add `onOpenFinding`. Update the board call:

```tsx
          <FindingsBoard
            rows={narrowed}
            surfaceTitles={surfaceTitles}
            onOpenFinding={onOpenFinding}
            onOpenCriterion={onOpenCriterion}
          />
```

- [ ] **Step 4: `CriterionDetailPanel`**

In `CriterionDetailPanelProps`, delete the `nodesById` member and its docblock, and replace `onOpenNode: (nodeId: string) => void;` with:

```ts
  onOpenFinding: (row: FindingRow) => void;
```

Delete the `import type { Node } from "@/lib/data/types";` line.

Update the header component's `Omit` — it lists the props the header does not take:

```tsx
}: Omit<CriterionDetailPanelProps, "onOpenFinding" | "findings">) {
```

Update the body's destructure: remove `nodesById` and `onOpenNode`, add `onOpenFinding`. Update the board call and the comment above it — the paragraph beginning "No `onOpenCriterion`" stays exactly as it is:

```tsx
            <FindingsBoard
              rows={criterionFindings}
              surfaceTitles={surfaceTitles}
              onOpenFinding={onOpenFinding}
            />
```

- [ ] **Step 5: `ProjectPanels` — feed both panels the new handler**

In the `cell` branch of `renderBody`, delete the `nodesById={nodesById}` and `onOpenNode={…}` props and add, keeping the "above this panel" comment:

```tsx
                // Above this panel, never in place of it — the rule every other
                // navigation in the stack follows, and the reason the trail still
                // reads back to the cell the reader came from.
                onOpenFinding={(row) => openFinding(row, index + 1)}
```

In the `criterion` branch of `renderBody`, delete `nodesById={nodesById}` and the whole `onOpenNode={…}` prop *with* its long comment about `?node=` and `reconcileArrival` — that comment was about opening a node from inside the criterion panel, which no longer happens from there. Add:

```tsx
                // From this panel's own depth, like every other navigation in
                // the stack: following a finding opens its panel ABOVE the
                // criterion rather than in place of it, which is what depth 0
                // would do.
                onOpenFinding={(row) => openFinding(row, index + 1)}
```

- [ ] **Step 6: The Findings page**

In `app/project/[id]/quality/findings/page.tsx`:

Change the panels destructure — `openNode` is no longer used by this page, and leaving it would be a lint error:

```tsx
  const { entries, openCriterion, openFinding } = useProjectPanels();
```

Delete the `handleOpenNode` callback and its comment. Add in its place:

```tsx
  // Depth 0: a finding card is on the surface, so opening it is a surface click
  // and leaves exactly one panel open — the same rule the criterion chip
  // follows. Anything opened from inside the panel is that panel's business and
  // opens above it.
  const handleOpenFinding = useCallback((row: FindingRow) => openFinding(row, 0), [openFinding]);
```

Add the type import:

```tsx
import { filterFindings, type FindingRow } from "@/lib/utils/quality";
```

Update the board call — `nodesById` goes with `onOpenNode`:

```tsx
        <FindingsBoard
          rows={filtered}
          surfaceTitles={data.surfaceTitles}
          onOpenFinding={handleOpenFinding}
          onOpenCriterion={handleOpenCriterion}
        />
```

- [ ] **Step 7: The landing preview**

Replace `components/landing/previews/client/ReadOnlyFindingsBoard.tsx` with:

```tsx
"use client";

import type { ComponentProps } from "react";
import { FindingsBoard } from "@/components/quality/FindingsBoard";

/**
 * The board, inert.
 *
 * `FindingsBoard` requires `onOpenFinding`, and a function cannot cross the RSC
 * boundary. `onOpenCriterion` stays omitted on purpose: without it `FindingCard`
 * drops the criterion chip's button, which is the right shape for a preview
 * nobody can click into.
 */
export function ReadOnlyFindingsBoard(
  props: Omit<ComponentProps<typeof FindingsBoard>, "onOpenFinding" | "onOpenCriterion">,
) {
  return <FindingsBoard {...props} onOpenFinding={() => {}} />;
}
```

In `components/landing/previews/FindingsBoardPreview.tsx`, drop the board's `nodesById` prop — the `referenced` map stays, because `FeedRow` below still takes it:

```tsx
        <ReadOnlyFindingsBoard rows={rows} surfaceTitles={surfaceTitles} />
```

- [ ] **Step 8: Verify the whole tree compiles**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors. A `Property 'nodesById' does not exist` here means a call site was missed.

Run: `npm run lint`
Expected: no errors. An unused `openNode`, `Node` import or `useState` left behind shows up here.

Run: `npm run test:landing && npm run test:panel-semantics && npm run test:project-panels`
Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add components/quality/FindingCard.tsx components/quality/FindingsBoard.tsx \
  components/panels/CellDetailPanel.tsx components/panels/CriterionDetailPanel.tsx \
  components/panels/ProjectPanels.tsx "app/project/[id]/quality/findings/page.tsx" \
  components/landing/previews/client/ReadOnlyFindingsBoard.tsx \
  components/landing/previews/FindingsBoardPreview.tsx
git commit -m "feat(quality): a finding card opens its panel

The disclosure goes, and the board stops needing the graph.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7b: Stop the card and the panel saying it twice

Added during execution, from the Task 5 review. The panel reproduces two blocks
of the card verbatim, and the branch has already set the precedent for what to
do about that: `FindingMark` exists because "two copies would part company the
first time a status tile changed", and the same sentence applies here.

**Files:**
- Create: `components/quality/FindingScales.tsx`
- Create: `components/quality/AcceptedRiskCallout.tsx`
- Modify: `components/quality/FindingCard.tsx`, `components/panels/FindingDetailPanel.tsx`

**Extract, because they are byte-identical:**

1. **The scales line** — `FindingCard`'s third meta line and the panel's, identical modulo comments: the same wrapper classes, the same `· cost`, the same `COST_TERM`/`COST_HINT`/`COST_CHIP` triple, the same verdict span, the same `ms-auto` status badge with the same green-for-`resolved` tint. Becomes `FindingScales({ row })`.
2. **The accepted-risk callout** — identical but for its wrapper (`mt-1` on the card, `PANEL_GUTTER` on the panel). Becomes `AcceptedRiskCallout({ note, className })`.

**Do not extract the criterion line.** It looks like a third candidate and is not: the card's chip is optional (`onOpenCriterion?`, and its absence is how the criterion panel says "you are already inside it") and truncates the name at `max-w-[24rem]`; the panel's is mandatory and wraps. That is two components' worth of difference wearing one shape.

**Fix while in there**, all from the same review:

- `FindingDetailPanel`'s `!row` body hardcodes `p-5 lg:p-6` while the file already imports `PANEL_GUTTER` and uses it twice below. `PanelSection` exports that constant so a gutter change stays one edit; use `cn(PANEL_GUTTER, "min-h-0 flex-1 overflow-y-auto py-5 lg:py-6")`.
- The panel's docblock claims "Every section is conditional on having something to say"; Reference renders unconditionally. True behaviour — `row.id` always exists — but the sentence contradicts the code. Add the clause.
- `acceptedNote` can still be `""`: the `||` guards an empty verification note, then falls through to `row.detail`, which may also be empty, drawing a bordered callout around nothing. Carried over from the card, so fix it in the shared component — which is the argument for extracting it.
- The panel drops the card's `opacity-70` dimming of decided findings. Right — a focused single-record read should not be greyed — but nothing says so, in a file that comments smaller decisions. One line.
- Note at the two `findings.find(...)` calls that the double scan is deliberate: it is how `CriterionDetailPanel` resolves its own subject, over ~250 rows, and the prop docblock already says why the panel takes an id rather than a row. Otherwise the next reader "fixes" it with a context.

---

## Task 8: The node panel opens findings

**Files:**
- Modify: `components/panels/NodeRelationSections.tsx`
- Modify: `components/panels/RelationsGroup.tsx`
- Modify: `components/panels/NodeDetailPanel.tsx`
- Modify: `components/panels/ProjectPanels.tsx`

`tests/app/product-scope.test.js` reads source text out of `NodeDetailPanel.tsx`, and `tests/app/project-panels.test.js` reads source text out of both `NodeDetailPanel.tsx` and `RelationsGroup.tsx`. Neither reads the findings wiring, but run both at the end of this task rather than at the end of the branch.

- [ ] **Step 1: `FindingsSection` opens the finding**

In `components/panels/NodeRelationSections.tsx`, replace the `FindingsSectionProps` interface and the `FindingsSection` component with:

```tsx
export interface FindingsSectionProps {
  node: Node;
  findings: FindingRow[];
  onOpenFinding: (row: FindingRow) => void;
}

/**
 * The audit's open findings against this node, worst first.
 *
 * Open only, matching the canvas badge exactly: both ask `row.open`, so a node
 * wearing a red "3" opens onto three rows and never onto a resolved fourth the
 * reader has to work out is history.
 *
 * The order is `filterFindings`' own — the board's comparator, run with the
 * filter set that narrows nothing. A `sort` written here would be a second
 * opinion on which finding is worse than which, and the two lists would read
 * differently the day a pack moved a bucket.
 */
export function FindingsSection({ node, findings, onOpenFinding }: FindingsSectionProps) {
  const own = filterFindings(
    findings.filter((row) => row.open && row.nodeIds.includes(node.id)),
    EMPTY_QUALITY_FILTERS,
  );

  if (own.length === 0) {
    return null;
  }

  return (
    <PanelSection title="Findings">
      <div className="flex flex-col gap-0.5">
        {own.map((row) => (
          // Into the finding. This used to open the *criterion*, because a
          // finding had no panel of its own; it has one now, and a reader who
          // clicked a finding asked about the finding. The criterion is one
          // more click from inside it.
          <button
            key={row.id}
            type="button"
            onClick={() => onOpenFinding(row)}
            className="flex items-center gap-2 text-sm text-left rounded-md px-2 py-1.5 hover:bg-muted transition-colors w-full"
            title={row.title}
          >
            <span
              className={cn(
                "shrink-0 rounded border px-1.5 py-0.5 text-[11px] font-medium",
                SEVERITY_CHIP[row.severity],
              )}
            >
              {SEVERITY_LABEL[row.severity]}
            </span>
            <span className="flex-1 truncate">{row.title}</span>
            <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">
              {row.criterionId}
            </span>
          </button>
        ))}
      </div>
    </PanelSection>
  );
}
```

- [ ] **Step 2: `RelationsGroup` threads it**

In `components/panels/RelationsGroup.tsx`, replace the `onOpenCriterion` prop with `onOpenFinding`:

```ts
  findings?: FindingRow[];
  onOpenFinding?: (row: FindingRow) => void;
```

Update the destructure (`onOpenCriterion,` → `onOpenFinding,`), the chip gate:

```ts
  const openFindings = findings && onOpenFinding ? worstOpenFindingFor(findings, node.id) : null;
```

and the section render:

```tsx
      {hasFindings && findings && onOpenFinding && (
        <FindingsSection node={node} findings={findings} onOpenFinding={onOpenFinding} />
      )}
```

- [ ] **Step 3: `NodeDetailPanel` threads it**

In `components/panels/NodeDetailPanel.tsx`, replace the `onOpenCriterion` prop declaration and fix the docblock above `findings`, which names it:

```ts
  /**
   * Every finding in the project, denormalized once by `buildFindingRows` — the
   * Findings section picks out this node's own. The whole list rather than a
   * pre-filtered one because the caller builds it once for a whole panel stack,
   * and re-filtering it per open panel is what a panel is for.
   *
   * Optional with `onOpenFinding`, and the section is absent without both: a
   * list of findings nothing can open is a dead end.
   */
  findings?: FindingRow[];
  onOpenFinding?: (row: FindingRow) => void;
```

Update the destructure (`onOpenCriterion,` → `onOpenFinding,`) and the `RelationsGroup` call (`onOpenCriterion={onOpenCriterion}` → `onOpenFinding={onOpenFinding}`).

If `NodeDetailPanel` does not already import `FindingRow`, it does — it types `findings` with it. Leave the import alone.

- [ ] **Step 4: `ProjectPanels` feeds it**

In the node branch of `renderBody`, replace the `onOpenCriterion` prop and its comment with:

```tsx
              // From this panel's own depth, the rule every navigation in the
              // stack follows: a finding opened out of a node sits ABOVE that
              // node rather than replacing it, so the trail still reads back to
              // the node the reader came from.
              onOpenFinding={(row) => openFinding(row, index + 1)}
```

`openCriterion` is still used by the cell branch, so it stays in the destructure.

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

Run: `npm run lint`
Expected: no errors.

Run: `npm run test:project-panels && npm run test:product-scope && npm run test:panel-semantics`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add components/panels/NodeRelationSections.tsx components/panels/RelationsGroup.tsx \
  components/panels/NodeDetailPanel.tsx components/panels/ProjectPanels.tsx
git commit -m "feat(panels): a node's findings open as findings

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 9: `?finding=` on the Findings page

**Files:**
- Modify: `app/project/[id]/quality/findings/page.tsx`

Depth 0 on this page becomes "a finding **or** a criterion, exclusively", owned by one `useAddressedBottomPanel` call. Two calls would be two syncs racing for the same slot, and `useAddressedBottomPanel`'s restore branch (`stackDepth === 0`) would let whichever ran second reopen over the first.

- [ ] **Step 1: Declare the param**

Replace the `CRITERION_PARAM` / `CRITERION_SURFACE_PARAM` block's docblock heading and add the third param:

```tsx
/**
 * The two panels this page can open at depth 0, and the surface a criterion is
 * read on.
 *
 * Owned by this page and deliberately outside `useQualityFilters`' `KEYS`, for
 * the reason `?product=` is outside `useAcceptanceFilters`': "Clear filters"
 * deletes every key in `KEYS`, and reading a finding is not a filter. Emptying
 * a search box must not shut the document you were searching in.
 *
 * They are also not the panel *stack's* address — `?node=` is, and it stays the
 * only one. See `lib/utils/project-panels.ts` for why neither a criterion nor a
 * finding is a location in this graph.
 *
 * `?finding=` and `?criterion=` are mutually exclusive: both name the panel at
 * depth 0, so opening either deletes the other. A URL carrying both is
 * hand-typed, and the finding wins — stated once, in `addressed` below, rather
 * than left for two syncs to fight over.
 */
const FINDING_PARAM = "finding";
const CRITERION_PARAM = "criterion";
const CRITERION_SURFACE_PARAM = "csurface";
```

- [ ] **Step 2: Compute the address across both kinds**

Replace the block from `const criterionParam = …` down to and including the `useAddressedBottomPanel({…})` call with:

```tsx
  const findingParam = searchParams.get(FINDING_PARAM);
  const criterionParam = searchParams.get(CRITERION_PARAM);
  const surfaceParam = searchParams.get(CRITERION_SURFACE_PARAM);

  /**
   * The panel the URL names, keyed the way the stack keys it. A finding first:
   * the two params are written mutually exclusive, and this is the one place
   * that settles a URL carrying both.
   */
  const addressed = findingParam
    ? findingPanelKey(findingParam)
    : criterionParam
      ? criterionPanelKey(criterionParam, surfaceParam ?? undefined)
      : null;

  /**
   * The panel this page owns: the one at the *bottom* of the stack, whichever
   * of the two kinds it is.
   *
   * Only depth 0 is addressed, because only a click on this surface opens one
   * there. A criterion or a finding opened from inside another panel sits
   * higher and is not this param's business — the same way a node panel below
   * the top is not `?node=`'s.
   */
  const bottom = entries[0];
  const openKey =
    bottom && (isFindingEntry(bottom) || isCriterionEntry(bottom)) ? bottom.key : null;

  /**
   * The row `?finding=` names. Resolved from the page's own rows rather than
   * carried in the URL: the address is an id, and the descriptor wants the
   * title. A `?finding=` naming nothing opens nothing here — the panel's own
   * "no finding with that id" body is for a finding that disappears *under* an
   * open panel, not for an address that never resolved.
   *
   * `null` on a cold load too, for as long as the project is in flight, and
   * `useAddressedBottomPanel` survives that on its own: its restore branch
   * re-fires while `seen.current !== addressed`, so the pass on which the rows
   * land is the pass that opens the panel, and the branch that would clear a
   * stale address never runs because nothing was ever seen open.
   */
  const addressedRow = findingParam
    ? data.rows.find((row) => row.id === findingParam) ?? null
    : null;

  const open = useCallback(() => {
    // Depth 0, explicitly. Both openers default to `previous.length`, which
    // appends — right for Raw, invoked from the header, wrong for a board that
    // lives on this surface. On the default, clicking A then B leaves `[A, B]`
    // and the stack grows with every click.
    if (addressedRow) openFinding(addressedRow, 0);
    else if (!findingParam && criterionParam) openCriterion(criterionParam, surfaceParam ?? undefined, 0);
  }, [addressedRow, criterionParam, findingParam, openCriterion, openFinding, surfaceParam]);

  useAddressedBottomPanel({
    params: [FINDING_PARAM, CRITERION_PARAM, CRITERION_SURFACE_PARAM],
    addressed,
    open,
    openKey,
  });
```

- [ ] **Step 3: Make both handlers write exclusively**

Replace `handleOpenCriterion` and `handleOpenFinding` with:

```tsx
  const handleOpenCriterion = useCallback(
    (criterionId: string, surface: string) => {
      // Opened *and* addressed in one gesture. The open is not left to the sync
      // effect, which would put a router transition between the click and the
      // panel; the write is what makes the panel survive a Back.
      openCriterion(criterionId, surface, 0);
      writeQuery((params) => {
        params.set(CRITERION_PARAM, criterionId);
        if (surface) params.set(CRITERION_SURFACE_PARAM, surface);
        else params.delete(CRITERION_SURFACE_PARAM);
        // The other half of depth 0 goes with it: one slot, one address.
        params.delete(FINDING_PARAM);
      });
    },
    [openCriterion, writeQuery],
  );

  // Depth 0: a finding card is on the surface, so opening it is a surface click
  // and leaves exactly one panel open. Anything opened from inside the panel is
  // that panel's business and opens above it.
  const handleOpenFinding = useCallback(
    (row: FindingRow) => {
      openFinding(row, 0);
      writeQuery((params) => {
        params.set(FINDING_PARAM, row.id);
        params.delete(CRITERION_PARAM);
        params.delete(CRITERION_SURFACE_PARAM);
      });
    },
    [openFinding, writeQuery],
  );
```

- [ ] **Step 4: Fix the imports**

```tsx
import {
  criterionPanelKey,
  findingPanelKey,
  isCriterionEntry,
  isFindingEntry,
} from "@/lib/utils/project-panels";
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

Run: `npm run lint`
Expected: no errors. Watch for `react-hooks/exhaustive-deps` on `open` and the two handlers — the dependency lists above are complete, so a warning here means a line was mistyped.

- [ ] **Step 6: Commit**

```bash
git add "app/project/[id]/quality/findings/page.tsx"
git commit -m "feat(quality): a finding has an address

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 10: Full verification and the PR

**Files:** none changed unless a check fails.

- [ ] **Step 1: Regenerate the generated artifacts**

CI diffs them, and a newly imported lucide icon dirties them just as a schema edit does — this branch adds none, but run it rather than assume.

Run: `npm run generate`
Then: `git status --short`
Expected: no changes. If there are any, commit them as `chore: regenerate`.

- [ ] **Step 2: Run the app test suites this branch touches**

```bash
npm run test:project-panels
npm run test:panel-stack
npm run test:panel-semantics
npm run test:product-scope
npm run test:quality-page
npm run test:relation-lines
npm run test:landing
npm run test:query-url
```

Expected: every one ends in its own `All … tests passed` line and exits 0.

- [ ] **Step 3: Lint and build**

Run: `npm run lint`
Expected: 0 errors. `main` lints at 0 errors / 4 warnings; any error is yours.

Run: `npm run build`
Expected: a successful Next.js production build.

- [ ] **Step 4: Look at it in the browser**

There is no component render rig, so this is the only check that the panel actually reads well. Start the dev server, open a project with a recorded audit, go to Quality → Findings, and confirm:

1. Clicking a finding's title opens a panel; the board does not expand.
2. The panel's header wears the same square the row's rail shows.
3. The URL carries `?finding=…`; a reload reopens the panel; Back closes it.
4. Clicking the criterion chip on a card swaps the panel and the URL to `?criterion=…` — `?finding=` is gone.
5. In the panel, the criterion chip and a linked node chip each open *above* the finding, and the breadcrumb reads back to it.
6. On Quality → Matrix, a cell panel's finding opens above the cell.
7. On a node panel, the Findings section opens the finding, not the criterion.

Run: `npm run dev`

If a dev server is already running from an earlier session, kill it first — a stale one serves the old bundle and will make a working change look broken.

- [ ] **Step 5: Open the PR**

```bash
git push -u origin finding-panel
```

Then open a PR whose body includes a Lab Note — this is a user-facing change, so the note is required:

````markdown
## Lab Note

```yaml
en:
  title: "Findings open like everything else"
  summary: "A finding now opens in its own panel instead of unfolding inside the list, so the board stays readable while you read one — and you can link straight to it."
fr:
  title: "Les constats s'ouvrent comme le reste"
  summary: "Un constat s'ouvre maintenant dans son propre panneau au lieu de se déplier dans la liste : tu gardes la vue d'ensemble pendant que tu en lis un, et tu peux envoyer le lien direct."
suggested:
  molecule: arkaik
  type: improvement
  tags: [quality, findings]
```
````

No `nodes:` key: this change touched no node in the graph.

- [ ] **Step 6: Read the PR's comments**

The advisory reminder comments on the PR at open time if the note is malformed, and clears its own comment once the body is fixed. Read the comments rather than assuming the note parsed.

```bash
gh pr view --comments
```

---

## Notes for the implementer

**The board has no render test.** Nothing in `tests/` asserts `FindingsBoard`'s props, so the compiler and `npm run lint` are the entire safety net for Task 7's prop removal. That is why Task 7 is one commit across eight files: half-done, it does not compile, and there is no test that would tell you which half.

**`lib/utils/project-panels.ts` must stay value-import-free.** `tests/app/load-panel-utils.js` transpiles it and `require`s the output with nothing resolving modules for it. A value import there fails at `require` with a resolution error that points nowhere near the cause.

**Every navigation out of a panel opens above it.** `index + 1`, never `0`. Depth 0 is reserved for a click on the surface itself, and it truncates the stack.
