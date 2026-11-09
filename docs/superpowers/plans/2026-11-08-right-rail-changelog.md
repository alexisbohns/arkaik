# Right Rail + Changelog Master-Detail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give project pages a Material-style right rail (first used on the Changelog to carry its filters), then turn the Changelog into a master-detail view: releases on the left, the selected release on the right.

**Architecture:** `PageShell` gains a `rail` slot rendered as a column after the panel grid, at the window's right edge. A new `RightRail` primitive (rail / group / button, ported from Krabs onto Radix) hosts the Changelog's Year/Month menus, Reset and the details toggle. Part 2 adds a pure selection helper, splits the Changelog into `ReleaseList` / `ReleasePicker` / `ReleaseDetail`, and drives the selection from `?release=` through `useQueryWriter`. Container queries (`@container` / `@3xl:`) swap the list for a picker when the surface is narrow.

**Tech Stack:** Next.js 16 (App Router, client components), React, Tailwind v4 (built-in container queries), Radix Select/Tooltip via shadcn wrappers, lucide-react icons. Tests are plain Node scripts that transpile a TS module with `typescript.transpileModule`.

**Spec:** `docs/superpowers/specs/2026-11-08-right-rail-changelog-design.md`

**Ships as a two-part stack.** Part 1 = Tasks 1–3 on branch `feat/right-rail` (already created; the spec is committed on it). Part 2 = Tasks 4–7 on branch `feat/changelog-master-detail`, stacked on Part 1. The controller (not a task subagent) creates the Part 2 branch, runs visual verification and opens the PRs.

**Repo rules every task must respect:**
- Run `npx tsc --noEmit` and `npm run lint` before committing; CI fails on any lint error and main lints clean, so any error is yours.
- Run `npm run generate` before the last commit of each part: a newly used lucide icon changes `app/wobble.generated.css`, and CI diffs generated files. Commit whatever it changes.
- Commit messages end with a blank line then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Comments in this codebase explain *why* (see the existing files); match that voice, but keep new comments short.

---

## File map

| File | Part | Responsibility |
| --- | --- | --- |
| `components/layout/RightRail.tsx` (new) | 1 | `RightRail`, `RailGroup`, `RailButton`, `railItemClass` |
| `components/layout/FilterSelectTrigger.tsx` | 1 | add `variant` (`band`/`rail`) and `tooltipSide` to `FilterSelectTrigger` |
| `components/layout/PageShell.tsx` | 1 | add `rail?: ReactNode` slot |
| `components/journal/ChangelogRail.tsx` (new) | 1 | the Changelog's rail contents |
| `components/journal/ChangelogFilterBar.tsx` | 1 | deleted |
| `app/project/[id]/changelog/page.tsx` | 1, 2 | wire the rail (1); master-detail (2) |
| `lib/utils/changelog-releases.ts` (new) | 2 | `UNRELEASED_KEY`, `RELEASE_PARAM`, `resolveSelectedRelease` |
| `tests/app/changelog-releases.test.js` (new) | 2 | tests for the above |
| `package.json`, `.github/workflows/ci.yml` | 2 | register `test:changelog-releases` |
| `components/journal/DeliverableTimeline.tsx` (new) | 2 | moved verbatim out of the page |
| `components/journal/release-entry.ts` (new) | 2 | the `ReleaseEntry` type shared by list/picker/detail |
| `components/journal/ReleaseList.tsx` (new) | 2 | the left column |
| `components/journal/ReleasePicker.tsx` (new) | 2 | the narrow-surface fallback |
| `components/journal/ReleaseDetail.tsx` (new) | 2 | the right column |

---

# Part 1 — the rail (branch `feat/right-rail`)

### Task 1: `RightRail` primitive + rail variant on `FilterSelectTrigger`

**Files:**
- Create: `components/layout/RightRail.tsx`
- Modify: `components/layout/FilterSelectTrigger.tsx`

No unit test: these are presentational components with no logic; the repo has no DOM test harness. Verification is `tsc` + `lint` here and the visual pass at the end of Part 1.

- [ ] **Step 1: Create `components/layout/RightRail.tsx`**

```tsx
"use client";

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * The skin every control on the rail wears — a plain button or a menu trigger.
 *
 * Ported from Krabs' `chromeItemClass`. "On" is a filled tonal surface, the
 * Material rail's active indicator; idle is a bare glyph that tints on hover.
 * Exported so `FilterSelectTrigger`'s `rail` variant can wear the same skin.
 */
export function railItemClass(active = false, className?: string): string {
  return cn(
    "inline-flex size-9 shrink-0 items-center justify-center rounded-xl outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 [&_svg:not([class*='size-'])]:size-4",
    active
      ? "bg-secondary text-secondary-foreground"
      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
    className,
  );
}

/**
 * A page's right rail: a narrow column at the window's right edge, after the
 * panel grid, holding the page's filters and view toggles.
 *
 * In the layout flow on purpose. Krabs' rail is a `fixed` floating pill, which
 * needs a translate hack to dodge its own side panel; here panels open to the
 * rail's left, so the rail never has to move. `PageShell` mounts it via its
 * `rail` prop.
 *
 * `pr-3 py-3` matches the panel grid's own `p-3` gutter, and `w-15` (60px)
 * leaves exactly the 48px a `RailGroup` needs.
 */
export function RightRail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <nav
      aria-label={label}
      className="flex w-15 shrink-0 flex-col items-center gap-3 overflow-y-auto py-3 pr-3"
    >
      {children}
    </nav>
  );
}

/**
 * One cluster of related rail controls — the rounded pills of the Material
 * rail. A rail of several groups reads as several questions ("when?", "how
 * much?"), not one long column of buttons.
 */
export function RailGroup({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div
      role={label ? "group" : undefined}
      aria-label={label}
      className="flex flex-col items-center gap-1 rounded-2xl bg-card p-1.5"
    >
      {children}
    </div>
  );
}

interface RailButtonProps {
  icon: LucideIcon;
  /** Accessible name and tooltip. */
  label: string;
  /** Draw the filled "on" surface — for a filter that is set. */
  active?: boolean;
  /** `aria-pressed` for a toggle; leave unset for a plain action. */
  pressed?: boolean;
  onClick: () => void;
}

/** A square icon button on the rail, its tooltip opening away from the edge. */
export function RailButton({ icon: Icon, label, active = false, pressed, onClick }: RailButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={pressed}
          onClick={onClick}
          className={railItemClass(active)}
        >
          <Icon className="size-4" aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="left" sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
```

- [ ] **Step 2: Add `variant` and `tooltipSide` to `FilterSelectTrigger`**

In `components/layout/FilterSelectTrigger.tsx`:

Add the import after the tooltip import:

```tsx
import { railItemClass } from "@/components/layout/RightRail";
```

Add two optional props to `FilterSelectTriggerProps` (after `forceValueLabel`):

```tsx
  /**
   * `band` (default) is the bordered square of the toolbar bands; `rail` is the
   * borderless rounded button of `RightRail`, where "set" is a filled surface.
   */
  variant?: "band" | "rail";
  /** Which side the tooltip opens on — `left` on the right rail. */
  tooltipSide?: "top" | "right" | "bottom" | "left";
```

In `FilterSelectTrigger`'s parameter list add `variant = "band",` and `tooltipSide,` (before `className`). Replace the trigger's `className={filterTriggerClassName(active, className)}` with:

```tsx
          className={variant === "rail" ? railItemClass(active, className) : filterTriggerClassName(active, className)}
```

and replace its `<TooltipContent>` opening tag with:

```tsx
      <TooltipContent side={tooltipSide} sideOffset={tooltipSide === "left" ? 8 : undefined}>
```

Leave `FilterMenuTrigger` untouched (no rail user yet).

- [ ] **Step 3: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add components/layout/RightRail.tsx components/layout/FilterSelectTrigger.tsx
git commit -m "feat(rail): a right rail primitive, and a rail skin for filter menus

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `PageShell` rail slot

**Files:**
- Modify: `components/layout/PageShell.tsx`

- [ ] **Step 1: Add the prop**

In `PageShellProps`, after `children`, add:

```tsx
  /**
   * The page's right rail (`RightRail`) — drawn after the panel grid, at the
   * window's right edge, so open panels sit to its left and it never moves.
   */
  rail?: ReactNode;
```

- [ ] **Step 2: Render it**

Destructure `rail` in `PageShell`'s parameters (after `children`). Replace the returned JSX with:

```tsx
  const panels = (
    <ProjectPanels
      surfaceLabel={title}
      surfaceCard={surfaceCard}
      surfaceBare={surfaceBare}
      onLayoutChange={onLayoutChange}
      {...panelProps}
    >
      {children}
    </ProjectPanels>
  );

  // No rail → exactly the markup every other page already has. With one, the
  // grid gets its own column box: `PanelStack` is `flex-1` and expects a
  // column parent to grow into.
  if (!rail) {
    return (
      <div className="flex h-full w-full flex-col">
        <h1 className="sr-only">{title}</h1>
        {panels}
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-row">
      <h1 className="sr-only">{title}</h1>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{panels}</div>
      {rail}
    </div>
  );
```

- [ ] **Step 3: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add components/layout/PageShell.tsx
git commit -m "feat(shell): PageShell takes a right rail

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The Changelog's filters move to the rail

**Files:**
- Create: `components/journal/ChangelogRail.tsx`
- Delete: `components/journal/ChangelogFilterBar.tsx`
- Modify: `app/project/[id]/changelog/page.tsx`

- [ ] **Step 1: Create `components/journal/ChangelogRail.tsx`**

```tsx
"use client";

import {
  CalendarIcon,
  CalendarRangeIcon,
  FilterXIcon,
  ListChevronsDownUpIcon,
  ListChevronsUpDownIcon,
} from "lucide-react";
import { Select, SelectContent, SelectItem } from "@/components/ui/select";
import { FilterSelectTrigger } from "@/components/layout/FilterSelectTrigger";
import { RailButton, RailGroup, RightRail } from "@/components/layout/RightRail";
import { GUARDED_HOTKEY, toolbarKey, useShortcut } from "@/lib/hooks/useShortcut";
import { MONTH_LABELS } from "@/lib/utils/changelog-period";

/** The "no filter" sentinel — Radix's Select cannot hold an empty string value. */
const ALL = "__all__";

interface ChangelogRailProps {
  /** Years present in the timeline, newest first. */
  years: readonly number[];
  year: number | null;
  month: number | null;
  /** True while every deliverable shows its summary and touched-node chips. */
  detailed: boolean;
  onYearChange: (year: number | null) => void;
  onMonthChange: (month: number | null) => void;
  onDetailedChange: (detailed: boolean) => void;
  /** Clear both period filters at once. */
  onReset: () => void;
}

/**
 * The Changelog's right rail: when am I looking at, and how much of it.
 *
 * Two groups because they are two questions. "When" holds the Year and Month
 * menus — they narrow independently, "every March" being a fair question of a
 * release cadence — and a Reset that only exists while one is set. "View"
 * holds the details toggle, whose state is carried by its glyph and
 * `aria-pressed`, never the filled surface: on this rail, filled means "a
 * filter is set", and a toggle that is on is a different thing.
 */
export function ChangelogRail({
  years,
  year,
  month,
  detailed,
  onYearChange,
  onMonthChange,
  onDetailedChange,
  onReset,
}: ChangelogRailProps) {
  useShortcut("toggle-expand", toolbarKey(() => onDetailedChange(!detailed)), GUARDED_HOTKEY);

  const filtered = year !== null || month !== null;
  const detailLabel = detailed ? "Collapse deliverable details" : "Expand deliverable details";

  return (
    <RightRail label="Changelog filters">
      <RailGroup label="When">
        <Select
          value={year === null ? ALL : String(year)}
          onValueChange={(value) => onYearChange(value === ALL ? null : Number(value))}
        >
          <FilterSelectTrigger
            variant="rail"
            tooltipSide="left"
            icon={<CalendarRangeIcon />}
            label="Year"
            active={year !== null}
            valueLabel={year === null ? undefined : String(year)}
          />
          <SelectContent side="left" align="start">
            <SelectItem value={ALL}>All years</SelectItem>
            {years.map((entry) => (
              <SelectItem key={entry} value={String(entry)}>
                {entry}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={month === null ? ALL : String(month)}
          onValueChange={(value) => onMonthChange(value === ALL ? null : Number(value))}
        >
          <FilterSelectTrigger
            variant="rail"
            tooltipSide="left"
            icon={<CalendarIcon />}
            label="Month"
            active={month !== null}
            valueLabel={month === null ? undefined : MONTH_LABELS[month]}
          />
          <SelectContent side="left" align="start">
            <SelectItem value={ALL}>All months</SelectItem>
            {MONTH_LABELS.map((label, index) => (
              <SelectItem key={label} value={String(index)}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {filtered && <RailButton icon={FilterXIcon} label="Reset filters" onClick={onReset} />}
      </RailGroup>

      <RailGroup label="View">
        <RailButton
          icon={detailed ? ListChevronsDownUpIcon : ListChevronsUpDownIcon}
          label={detailLabel}
          pressed={detailed}
          onClick={() => onDetailedChange(!detailed)}
        />
      </RailGroup>
    </RightRail>
  );
}
```

- [ ] **Step 2: Delete the old band**

```bash
git rm components/journal/ChangelogFilterBar.tsx
```

- [ ] **Step 3: Wire the page**

In `app/project/[id]/changelog/page.tsx`:

1. Replace the import
   `import { ChangelogFilterBar } from "@/components/journal/ChangelogFilterBar";`
   with
   `import { ChangelogRail } from "@/components/journal/ChangelogRail";`
2. Change the period import to also bring `ALL_PERIODS`:
   `import { ALL_PERIODS, listYears, matchesPeriod, type Period } from "@/lib/utils/changelog-period";`
3. Add a `rail` prop to `<PageShell …>` (after `history`):

```tsx
      rail={
        isEmpty ? undefined : (
          <ChangelogRail
            years={years}
            year={period.year}
            month={period.month}
            detailed={detailed}
            onYearChange={(year) => setPeriod((previous) => ({ ...previous, year }))}
            onMonthChange={(month) => setPeriod((previous) => ({ ...previous, month }))}
            onDetailedChange={setDetailed}
            onReset={() => setPeriod(ALL_PERIODS)}
          />
        )
      }
```

4. Remove the whole `toolbar={…}` prop from `<PageSurface>` (the `isEmpty ? undefined : (<ChangelogFilterBar … />)` block). `PageSurface` keeps `contentClassName="flex flex-col divide-y"`. Nothing else on the page changes in Part 1 — the `SectionRow` sticky headings now pin at `top: 0` because `--surface-sticky-top` falls back to `0px` without a toolbar.

- [ ] **Step 4: Typecheck, lint, generate**

Run: `npx tsc --noEmit && npm run lint && npm run generate && git status --short`
Expected: tsc and lint clean. `generate` may modify `app/wobble.generated.css` (new `filter-x` icon) — that is expected and gets committed.

- [ ] **Step 5: Run the existing tests that touch this area**

Run: `npm run test:keyboard-shortcuts && npm run test:changelog-period`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add -A components/journal app/project/\[id\]/changelog/page.tsx app/wobble.generated.css
git commit -m "feat(changelog): the filters move to the right rail

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(If `git status` shows other generated files changed by `npm run generate`, add them too.)

### Part 1 close-out (controller)

- Visual pass with Playwright in the scratchpad (import a bundle via the `/projects` file input): changelog at 1440px, 1440px with a node panel open, and 390px. Check the rail sits at the window edge, tooltips and menus open left, Reset appears only when filtered.
- `gh stack` the branch and open the Part 1 PR with a Lab Note (use the `gh-stack` skill).

---

# Part 2 — master-detail (branch `feat/changelog-master-detail`, stacked on Part 1)

### Task 4: Selection helper (TDD)

**Files:**
- Create: `lib/utils/changelog-releases.ts`
- Create: `tests/app/changelog-releases.test.js`
- Modify: `package.json` (scripts), `.github/workflows/ci.yml`

- [ ] **Step 1: Write the failing test** — `tests/app/changelog-releases.test.js`

```js
#!/usr/bin/env node

/**
 * The Changelog's selected release (lib/utils/changelog-releases.ts): which
 * release the detail column shows, given what the URL asks for and what the
 * filters left in the list. Transpiled like changelog-period.test.js — the
 * module has no imports, so no bundler and no alias table.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, ".test-build-changelog-releases");

function load() {
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));

  const source = fs.readFileSync(path.join(ROOT, "lib", "utils", "changelog-releases.ts"), "utf8");
  const { outputText } = ts.transpileModule(source, {
    fileName: "changelog-releases.ts",
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });
  fs.writeFileSync(path.join(BUILD_DIR, "changelog-releases.js"), outputText);
  return require(path.join(BUILD_DIR, "changelog-releases.js"));
}

const { UNRELEASED_KEY, RELEASE_PARAM, resolveSelectedRelease } = load();

let failures = 0;
function assert(cond, message) {
  if (cond) console.log(`PASS: ${message}`);
  else {
    failures++;
    console.error(`FAIL: ${message}`);
  }
}

assert(UNRELEASED_KEY === "unreleased", "the unreleased entry's key is 'unreleased'");
assert(RELEASE_PARAM === "release", "the selection lives in ?release=");

const keys = [UNRELEASED_KEY, "v1.4.0", "v1.3.2"];

assert(resolveSelectedRelease(keys, "v1.3.2") === "v1.3.2", "a requested key that is listed is selected");
assert(resolveSelectedRelease(keys, null) === UNRELEASED_KEY, "no request selects the first row");
assert(
  resolveSelectedRelease(keys, "v0.9.0") === UNRELEASED_KEY,
  "a request the filters hid (or a stale link) falls back to the first row",
);
assert(resolveSelectedRelease([], "v1.4.0") === null, "an empty list selects nothing");
assert(resolveSelectedRelease([], null) === null, "an empty list with no request selects nothing");
assert(resolveSelectedRelease(["v2.0.0"], "") === "v2.0.0", "an empty ?release= is treated as no request");

fs.rmSync(BUILD_DIR, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nAll changelog-releases tests passed.");
```

- [ ] **Step 2: Register the script**

In `package.json` `scripts`, directly after the `"test:changelog-period"` line, add:

```json
    "test:changelog-releases": "node tests/app/changelog-releases.test.js",
```

In `.github/workflows/ci.yml`, directly after the step

```yaml
      - name: Changelog period filter tests
        run: npm run test:changelog-period
```

add:

```yaml

      - name: Changelog selected-release tests
        run: npm run test:changelog-releases
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm run test:changelog-releases`
Expected: FAIL — `ENOENT … lib/utils/changelog-releases.ts`.

- [ ] **Step 4: Implement** — `lib/utils/changelog-releases.ts`

```ts
/**
 * Which release the Changelog's detail column shows.
 *
 * Pure and import-free so it is testable without a browser (see
 * `tests/app/changelog-releases.test.js`).
 */

/** The key of the "Unreleased" entry — shipped work not under any tag yet. */
export const UNRELEASED_KEY = "unreleased";

/** The query param that names the selected release. */
export const RELEASE_PARAM = "release";

/**
 * The key to select, given the keys the list currently shows (in display
 * order) and what `?release=` asks for.
 *
 * A request the list does not hold — a stale link, or a release the period
 * filters just hid — falls back to the first row rather than to nothing: the
 * detail column should always show something while the list does.
 */
export function resolveSelectedRelease(keys: readonly string[], requested: string | null): string | null {
  if (keys.length === 0) return null;
  if (requested && keys.includes(requested)) return requested;
  return keys[0];
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npm run test:changelog-releases`
Expected: every line PASS, "All changelog-releases tests passed."

- [ ] **Step 6: Lint and commit** (lint covers actionlint on the workflow)

```bash
npm run lint
git add lib/utils/changelog-releases.ts tests/app/changelog-releases.test.js package.json .github/workflows/ci.yml
git commit -m "feat(changelog): resolve the selected release from ?release=

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Move `DeliverableTimeline` out of the page (pure move)

**Files:**
- Create: `components/journal/DeliverableTimeline.tsx`
- Modify: `app/project/[id]/changelog/page.tsx`

- [ ] **Step 1: Create the file with the moved code**

Create `components/journal/DeliverableTimeline.tsx` with this header, then the `SHIP_MARK` constant (and its doc comment) and the whole `DeliverableTimeline` function (and its doc comment, and all inner comments) cut **verbatim** from `app/project/[id]/changelog/page.tsx`. The only edit to the moved code is `function DeliverableTimeline` → `export function DeliverableTimeline`.

```tsx
"use client";

import { PackageIcon } from "lucide-react";
import { DeliverableChips, DeliverableHoverCard } from "@/components/journal/DeliverableHoverCard";
import { formatEventDate } from "@/components/journal/describe-event";
import { iconChipVariants } from "@/components/layout/IconChip";
import type { Node } from "@/lib/data/types";
import type { Deliverable } from "@/lib/utils/journal";
```

- [ ] **Step 2: Update the page's imports**

In `app/project/[id]/changelog/page.tsx`: delete the moved code; add
`import { DeliverableTimeline } from "@/components/journal/DeliverableTimeline";`;
remove the imports the page no longer uses — `DeliverableChips, DeliverableHoverCard`, `iconChipVariants`, and `type Deliverable` from `@/lib/utils/journal` (keep `computeDeliverables`). Keep `PackageIcon` (the Unreleased row uses it) and `Node`.

- [ ] **Step 3: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors, no unused-import warnings.

- [ ] **Step 4: Commit**

```bash
git add components/journal/DeliverableTimeline.tsx app/project/\[id\]/changelog/page.tsx
git commit -m "refactor(changelog): DeliverableTimeline gets its own file

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `ReleaseEntry`, `ReleaseList`, `ReleasePicker`, `ReleaseDetail`

**Files:**
- Create: `components/journal/release-entry.ts`
- Create: `components/journal/ReleaseList.tsx`
- Create: `components/journal/ReleasePicker.tsx`
- Create: `components/journal/ReleaseDetail.tsx`

- [ ] **Step 1: `components/journal/release-entry.ts`**

```ts
import type { LucideIcon } from "lucide-react";
import type { Deliverable } from "@/lib/utils/journal";

/**
 * One row of the Changelog's release list — the Unreleased bucket or a tagged
 * milestone — carrying everything the list, the picker and the detail column
 * draw, so the three cannot disagree about what a release is called.
 */
export interface ReleaseEntry {
  /** `UNRELEASED_KEY` or the version — also the `?release=` value. */
  key: string;
  title: string;
  icon: LucideIcon;
  /** The date · platform · count line. */
  subtitle: string;
  /** The release notes, or what the Unreleased bucket means. */
  description?: string;
  deliverables: readonly Deliverable[];
}
```

- [ ] **Step 2: `components/journal/ReleaseList.tsx`**

```tsx
"use client";

import { cn } from "@/lib/utils";
import type { ReleaseEntry } from "@/components/journal/release-entry";

interface ReleaseListProps {
  entries: readonly ReleaseEntry[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  className?: string;
}

/**
 * The Changelog's left column: every release the filters left, newest first,
 * Unreleased on top. Selecting one fills the detail column beside it.
 */
export function ReleaseList({ entries, selectedKey, onSelect, className }: ReleaseListProps) {
  return (
    <nav aria-label="Releases" className={cn("flex-col", className)}>
      <ol className="flex flex-col gap-0.5 p-2">
        {entries.map((entry) => {
          const selected = entry.key === selectedKey;
          const Icon = entry.icon;
          return (
            <li key={entry.key}>
              <button
                type="button"
                aria-current={selected ? "true" : undefined}
                onClick={() => onSelect(entry.key)}
                className={cn(
                  "flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  selected
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
              >
                <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-sm font-medium">{entry.title}</span>
                  <span className="truncate text-xs text-muted-foreground">{entry.subtitle}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
```

- [ ] **Step 3: `components/journal/ReleasePicker.tsx`**

```tsx
"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ReleaseEntry } from "@/components/journal/release-entry";

interface ReleasePickerProps {
  entries: readonly ReleaseEntry[];
  value: string | null;
  onChange: (key: string) => void;
}

/**
 * The release list folded into a menu, for a surface too narrow for two
 * columns — an open node panel, or a phone.
 */
export function ReleasePicker({ entries, value, onChange }: ReleasePickerProps) {
  return (
    <Select value={value ?? undefined} onValueChange={onChange}>
      <SelectTrigger aria-label="Release" className="w-full">
        <SelectValue placeholder="Pick a release" />
      </SelectTrigger>
      <SelectContent>
        {entries.map((entry) => (
          <SelectItem key={entry.key} value={entry.key}>
            {entry.title}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
```

- [ ] **Step 4: `components/journal/ReleaseDetail.tsx`**

```tsx
"use client";

import { SectionHeading } from "@/components/layout/SectionHeading";
import { DeliverableTimeline } from "@/components/journal/DeliverableTimeline";
import type { ReleaseEntry } from "@/components/journal/release-entry";
import type { Node } from "@/lib/data/types";

interface ReleaseDetailProps {
  entry: ReleaseEntry;
  nodesById: Map<string, Node>;
  detailed: boolean;
}

/**
 * The Changelog's right column: one release — the same heading its row used to
 * carry, above its deliverables. Capped in width: a timeline line running the
 * full width of a wide surface is a line nobody reads to the end.
 */
export function ReleaseDetail({ entry, nodesById, detailed }: ReleaseDetailProps) {
  return (
    <section aria-label={entry.title} className="flex max-w-3xl flex-col gap-6">
      <SectionHeading
        title={entry.title}
        icon={entry.icon}
        subtitle={entry.subtitle}
        description={entry.description}
      />
      {entry.deliverables.length === 0 ? (
        <p className="text-sm text-muted-foreground">No deliverables recorded for this release.</p>
      ) : (
        <DeliverableTimeline deliverables={entry.deliverables} nodesById={nodesById} detailed={detailed} />
      )}
    </section>
  );
}
```

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors. (The components are unused until Task 7; that is fine for tsc and eslint.)

- [ ] **Step 6: Commit**

```bash
git add components/journal/release-entry.ts components/journal/ReleaseList.tsx components/journal/ReleasePicker.tsx components/journal/ReleaseDetail.tsx
git commit -m "feat(changelog): release list, picker and detail components

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The Changelog becomes master-detail

**Files:**
- Modify: `app/project/[id]/changelog/page.tsx`

- [ ] **Step 1: Imports**

Add:

```tsx
import { useSearchParams } from "next/navigation";
import { ReleaseDetail } from "@/components/journal/ReleaseDetail";
import { ReleaseList } from "@/components/journal/ReleaseList";
import { ReleasePicker } from "@/components/journal/ReleasePicker";
import type { ReleaseEntry } from "@/components/journal/release-entry";
import { useQueryWriter } from "@/lib/hooks/useQueryWriter";
import { RELEASE_PARAM, UNRELEASED_KEY, resolveSelectedRelease } from "@/lib/utils/changelog-releases";
```

Remove `import { SectionRow } from "@/components/layout/SectionRow";` (no longer used after Step 3).

- [ ] **Step 2: Build the entries and the selection — before the early returns**

Directly after the `milestones` `useMemo` (and before `if (projectLoading || …)`), add:

```tsx
  // One list for the three views of it — the column, the picker, the detail —
  // so a release reads the same wherever it is drawn. Unreleased first: it is
  // the milestone that has not happened yet, and it sits where the next one
  // will.
  const entries = useMemo<ReleaseEntry[]>(
    () => [
      ...(unreleased.length > 0
        ? [
            {
              key: UNRELEASED_KEY,
              title: "Unreleased",
              icon: PackageIcon,
              subtitle: countLabel(unreleased.length),
              description: "Shipped since the last tag, not yet in a release.",
              deliverables: unreleased,
            },
          ]
        : []),
      ...milestones.map(({ tag, deliverables: shipped }) => ({
        key: tag.version,
        title: tag.version,
        icon: MilestoneIcon,
        subtitle: [
          formatEventDate(tag.ts),
          tag.platform ? (PLATFORM_LABELS[tag.platform] ?? tag.platform) : null,
          countLabel(shipped.length),
        ]
          .filter(Boolean)
          .join(" · "),
        description: tag.notes,
        deliverables: shipped,
      })),
    ],
    [milestones, unreleased],
  );

  const searchParams = useSearchParams();
  const writeQuery = useQueryWriter();
  const selectedKey = resolveSelectedRelease(
    entries.map((entry) => entry.key),
    searchParams.get(RELEASE_PARAM),
  );
  const selected = entries.find((entry) => entry.key === selectedKey) ?? null;
  // Written even when it equals the default row: a link should say what it
  // shows. `replace`, not `push` — picking a release is not a navigation.
  const selectRelease = (key: string) => writeQuery((params) => params.set(RELEASE_PARAM, key));
```

`nothingInPeriod` (computed after the early returns) is now equivalent to `entries.length === 0`; replace its definition with `const nothingInPeriod = entries.length === 0;`.

- [ ] **Step 3: Replace the surface's contents**

Replace the whole `<PageSurface …>…</PageSurface>` element with:

```tsx
      <PageSurface fill contentClassName="flex flex-col">
        {isEmpty || nothingInPeriod ? (
          <div className="p-4 md:p-6">
            <EmptyState
              message={
                !isEmpty && isFiltered
                  ? "Nothing shipped in that period. Widen the year or month filter."
                  : "No releases tagged yet, and nothing shipped since."
              }
            />
          </div>
        ) : (
          // The surface, not the viewport, decides the layout: a node panel
          // halves the surface on a wide screen too. Under 48rem of surface the
          // list folds into a picker above the release.
          <div className="@container flex min-h-0 flex-1 flex-col">
            <div className="border-b p-3 @3xl:hidden">
              <ReleasePicker entries={entries} value={selectedKey} onChange={selectRelease} />
            </div>
            <div className="flex min-h-0 flex-1">
              <ReleaseList
                entries={entries}
                selectedKey={selectedKey}
                onSelect={selectRelease}
                className="hidden w-64 shrink-0 overflow-y-auto border-r @3xl:flex"
              />
              <div className="min-w-0 flex-1 overflow-y-auto p-4 md:p-6">
                {selected && <ReleaseDetail entry={selected} nodesById={nodesById} detailed={detailed} />}
              </div>
            </div>
          </div>
        )}
      </PageSurface>
```

Update the page's top doc comment (the one starting "The Changelog: what shipped, milestone by milestone.") to say: releases on the left, the selected one on the right, the selection in `?release=`; under 48rem of surface the list folds into a picker.

- [ ] **Step 4: Typecheck, lint, generate, tests**

Run: `npx tsc --noEmit && npm run lint && npm run generate && git status --short && npm run test:changelog-releases && npm run test:changelog-period && npm run test:keyboard-shortcuts`
Expected: all clean / PASS. Commit any file `generate` changed.

- [ ] **Step 5: Commit**

```bash
git add -A app/project/\[id\]/changelog/page.tsx app/wobble.generated.css
git commit -m "feat(changelog): releases on the left, the release on the right

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Part 2 close-out (controller)

- Visual pass at 1440px, 1440px with a node panel open, 390px. Check: two columns when wide; picker when a panel is open and on a phone; `?release=` survives a reload; setting a Year that hides the selected release falls back to the first visible one; the details toggle still works.
- `gh stack` push and open the Part 2 PR with its Lab Note.
