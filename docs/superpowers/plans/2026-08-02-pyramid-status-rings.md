# Pyramid Status Rings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Pyramid page's stacked per-platform status bars with four radial status rings per value element (global + Web + Android + iOS), behind a card/list view switcher and a three-step empty/all/addressed filter.

**Architecture:** A hand-rolled SVG `StatusRing` primitive (circle at `r = 15.9155`, circumference exactly 100, so `strokeDasharray` takes literal percentages — no chart library). `PlatformRingSet` composes four of them and attaches a Radix `HoverCard` breakdown popover to each. Status color and arc order stay single-sourced in `STATUS_STYLES` and one new comparator in `platform-status.ts`. The Pyramid page becomes composition over small components in `components/pyramid/`.

**Tech Stack:** Next.js 15 (App Router, client components), React 19, TypeScript, Tailwind CSS v4, Radix UI (`@radix-ui/react-hover-card`, already a dependency), lucide-react. Tests are plain Node scripts run via `npm run test:*` — there is **no** React test runner in this repo, so component tasks are verified with `npx tsc --noEmit`, `npm run lint`, and running the page.

**Spec:** [`docs/superpowers/specs/2026-08-02-pyramid-status-rings-design.md`](../specs/2026-08-02-pyramid-status-rings-design.md)

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `lib/utils/platform-status.ts` | Display-order comparator, `StatusSegment` type, `getRollupTotalSegments` | Modify |
| `components/graph/nodes/node-styles.ts` | `STATUS_STYLES` gains a `stroke` key | Modify |
| `components/graph/nodes/StatusRing.tsx` | The SVG ring primitive | Create |
| `components/graph/nodes/StatusBreakdownPopover.tsx` | Hover breakdown body | Create |
| `components/graph/nodes/PlatformRingSet.tsx` | Global + 3 platform rings, each with a hover card | Create |
| `components/ui/segmented-control.tsx` | Shared segmented control | Create |
| `components/library/LibraryFilterBar.tsx` | Adopts `SegmentedControl` | Modify |
| `components/pyramid/PyramidElementCard.tsx` | Grid card for one value element | Create |
| `components/pyramid/PyramidElementRow.tsx` | List row for one value element | Create |
| `components/pyramid/PyramidToolbar.tsx` | View switcher + three-step filter | Create |
| `components/pyramid/PyramidTierGroup.tsx` | Tier header + either view | Create |
| `app/project/[id]/pyramid/page.tsx` | Composition only | Modify |
| `components/overview/PyramidCard.tsx` | Overview mini-card adopts rings | Modify |
| `tests/app/pyramid.test.js` | New pure-logic assertions | Modify |

**Do not delete `components/graph/nodes/PlatformGaugeList.tsx`.** Four call sites keep it: `FlowNode`, `NodeDetailPanel`, `NodeCard`, `PlatformGaugesCard`.

---

### Task 1: Display order and the global segment sum

Two pure additions to `platform-status.ts`, driven by tests.

**Files:**
- Modify: `lib/utils/platform-status.ts:20-22` (the comparator) and `:213-232` (`getPlatformRollupSegments`)
- Test: `tests/app/pyramid.test.js`

**Background you need:** `STATUS_ORDER` is `{idea:0, backlog:1, prioritized:2, development:3, releasing:4, live:5, archived:6, blocked:7}`. The `delivery` preset counts five of them: `prioritized`, `development`, `releasing`, `live`, `blocked`. The existing module-local `sortStatusesDescending` sorts by `STATUS_ORDER` descending, so it leads with `blocked` (7). **That is correct for `getRollupDisplayStatus`** — it means "if anything is blocked, the node reports blocked", and that value drives graph node color via `system-graph.ts` and `journey-graph.ts`. Do **not** repoint it. Add a second, separate comparator for display.

- [ ] **Step 1: Write the failing tests**

In `tests/app/pyramid.test.js`, insert this block immediately **before** the `fs.rmSync(BUILD_DIR, ...)` line near the end of the file:

```js
// --- Display order (rings and bars) and the global all-platform segment sum ---

const {
  compareStatusesForDisplay,
  createEmptyRollup,
  addPlatformStatusToRollup,
  getPlatformRollupSegments,
  getRollupTotalSegments,
} = require(path.join(BUILD_DIR, "platform-status.js"));
const { getCountedStatuses, STATUS_ORDER } = require(path.join(BUILD_DIR, "config-statuses.js"));

assert(
  eq(
    [...getCountedStatuses()].sort(compareStatusesForDisplay),
    ["live", "releasing", "development", "prioritized", "blocked"],
  ),
  "display order is lifecycle-descending with blocked pinned last",
);
assert(
  STATUS_ORDER.blocked > STATUS_ORDER.live,
  "blocked outranks live in STATUS_ORDER, so pinning it last is real work, not a no-op",
);

let ringRollup = createEmptyRollup();
ringRollup = addPlatformStatusToRollup(ringRollup, "web", "live");
ringRollup = addPlatformStatusToRollup(ringRollup, "web", "live");
ringRollup = addPlatformStatusToRollup(ringRollup, "web", "blocked");
ringRollup = addPlatformStatusToRollup(ringRollup, "ios", "live");
ringRollup = addPlatformStatusToRollup(ringRollup, "android", "development");

const totalSegments = getRollupTotalSegments(ringRollup);
assert(
  eq(totalSegments.map((s) => s.status), ["live", "releasing", "development", "prioritized", "blocked"]),
  "global segments come back in display order, one entry per counted status",
);

const totalByStatus = Object.fromEntries(totalSegments.map((s) => [s.status, s]));
assert(totalByStatus.live.count === 3, `global ring sums live across platforms (got ${totalByStatus.live.count})`);
assert(
  totalByStatus.development.count === 1 && totalByStatus.blocked.count === 1,
  "global ring sums the single-platform statuses too",
);
assert(
  totalSegments.reduce((sum, s) => sum + s.count, 0) === 5,
  "global counts equal the sum of the per-platform totals",
);
assert(
  totalByStatus.live.percentage === 60,
  `global percentages divide by the grand total, not one platform (got ${totalByStatus.live.percentage})`,
);
assert(
  totalByStatus.releasing.count === 0 && totalByStatus.releasing.ratio === 0,
  "an absent status is still present, with a zero count and ratio",
);

const webSegments = getPlatformRollupSegments(ringRollup, "web");
assert(
  eq(webSegments.map((s) => s.status), ["live", "releasing", "development", "prioritized", "blocked"]),
  "per-platform segments use the same display order as the global ring",
);
assert(
  webSegments.find((s) => s.status === "live").percentage === 67,
  "per-platform percentages divide by that platform's own total",
);

const emptySegments = getRollupTotalSegments(createEmptyRollup());
assert(
  emptySegments.length === 5 && emptySegments.every((s) => s.count === 0 && s.ratio === 0 && s.percentage === 0),
  "an empty rollup yields all-zero segments and never divides by zero",
);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:pyramid`
Expected: FAIL — `compareStatusesForDisplay is not a function` (or `getRollupTotalSegments is not a function`), thrown before the assertions run.

- [ ] **Step 3: Add the comparator and document the existing one**

In `lib/utils/platform-status.ts`, replace this:

```ts
function sortStatusesDescending(left: StatusId, right: StatusId) {
  return STATUS_ORDER[right] - STATUS_ORDER[left];
}
```

with this:

```ts
/**
 * Severity precedence for `getRollupDisplayStatus` — highest `STATUS_ORDER`
 * first, which deliberately puts `blocked` (7) ahead of `live` (5) so a rollup
 * containing anything blocked reports blocked. That value colors graph nodes
 * (`system-graph.ts`, `journey-graph.ts`). This is **not** a display order —
 * rings and bars use `compareStatusesForDisplay`.
 */
function sortStatusesDescending(left: StatusId, right: StatusId) {
  return STATUS_ORDER[right] - STATUS_ORDER[left];
}

/**
 * Display order for status segments — lifecycle-descending with `blocked`
 * pinned last, so a ring reads Live → Releasing → Development → Prioritized →
 * Blocked and never opens on a red arc at 12 o'clock. Shared by the rings and
 * the `PlatformGaugeList` bars so the two can never disagree.
 */
export function compareStatusesForDisplay(left: StatusId, right: StatusId) {
  const leftIsLast = left === "blocked";
  const rightIsLast = right === "blocked";
  if (leftIsLast !== rightIsLast) return leftIsLast ? 1 : -1;
  return STATUS_ORDER[right] - STATUS_ORDER[left];
}
```

- [ ] **Step 4: Replace `getPlatformRollupSegments` with a shared builder plus the new total variant**

In the same file, replace this whole function:

```ts
export function getPlatformRollupSegments(
  rollup: PlatformStatusRollup,
  platformId: PlatformId,
  presetId: CountedStatusPresetId = DEFAULT_COUNTED_STATUS_PRESET_ID,
) {
  const total = rollup.totals[platformId] ?? 0;
  const countedStatuses = getCountedStatuses(presetId);

  return [...countedStatuses].sort(sortStatusesDescending).map((status) => {
    const count = rollup.counts[platformId]?.[status] ?? 0;
    const ratio = total === 0 ? 0 : count / total;

    return {
      status,
      count,
      ratio,
      percentage: Math.round(ratio * 100),
    };
  });
}
```

with this:

```ts
/** One counted status's share of a ring or bar. Always one entry per counted status, zeros included. */
export interface StatusSegment {
  status: StatusId;
  count: number;
  ratio: number;
  percentage: number;
}

function buildSegments(
  countFor: (status: StatusId) => number,
  total: number,
  presetId: CountedStatusPresetId,
): StatusSegment[] {
  return [...getCountedStatuses(presetId)].sort(compareStatusesForDisplay).map((status) => {
    const count = countFor(status);
    const ratio = total === 0 ? 0 : count / total;

    return { status, count, ratio, percentage: Math.round(ratio * 100) };
  });
}

export function getPlatformRollupSegments(
  rollup: PlatformStatusRollup,
  platformId: PlatformId,
  presetId: CountedStatusPresetId = DEFAULT_COUNTED_STATUS_PRESET_ID,
): StatusSegment[] {
  return buildSegments(
    (status) => rollup.counts[platformId]?.[status] ?? 0,
    rollup.totals[platformId] ?? 0,
    presetId,
  );
}

/**
 * The same segments, summed across every platform — the global ring. Percentages
 * divide by the grand total, so one acceptance live on three platforms counts
 * three times here, exactly as it does across the three platform rings.
 */
export function getRollupTotalSegments(
  rollup: PlatformStatusRollup,
  presetId: CountedStatusPresetId = DEFAULT_COUNTED_STATUS_PRESET_ID,
): StatusSegment[] {
  const total = Object.values(rollup.totals).reduce((sum, value) => sum + (value ?? 0), 0);

  return buildSegments(
    (status) =>
      Object.values(rollup.counts).reduce((sum, platformCounts) => sum + (platformCounts?.[status] ?? 0), 0),
    total,
    presetId,
  );
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test:pyramid`
Expected: PASS on every assertion, ending with `All pyramid tests passed`.

- [ ] **Step 6: Verify nothing else regressed**

Run: `npm run test:effective-status && npm run test:journey-graph && npm run test:coverage && npm run test:delivery && npm run test:spotlight`
Expected: all PASS. These exercise `getRollupDisplayStatus` and the rollup helpers; if any fails, the severity comparator was repointed by mistake — revert Step 3's second function and re-read the Background note.

- [ ] **Step 7: Type-check and commit**

```bash
npx tsc --noEmit
git add lib/utils/platform-status.ts tests/app/pyramid.test.js
git commit -m "feat: shared status display order and all-platform segment sum"
```

---

### Task 2: A stroke color per status

**Files:**
- Modify: `components/graph/nodes/node-styles.ts:20-29`

- [ ] **Step 1: Add the `stroke` key**

Replace:

```ts
export const STATUS_STYLES: Record<StatusId, { badge: string; dot: string }> = {
  idea:        { badge: "text-gray-400",    dot: "bg-gray-400"    },
  backlog:     { badge: "text-gray-500",    dot: "bg-gray-500"    },
  prioritized: { badge: "text-blue-400",    dot: "bg-blue-400"    },
  development: { badge: "text-blue-500",    dot: "bg-blue-500"    },
  releasing:   { badge: "text-purple-500",  dot: "bg-purple-500"  },
  live:        { badge: "text-green-500",   dot: "bg-green-500"   },
  archived:    { badge: "text-gray-400",    dot: "bg-gray-400"    },
  blocked:     { badge: "text-red-500",     dot: "bg-red-500"     },
};
```

with:

```ts
// One row per status: text color, dot fill, and SVG arc stroke. A ring, a bar
// and a badge therefore can never drift apart on color.
export const STATUS_STYLES: Record<StatusId, { badge: string; dot: string; stroke: string }> = {
  idea:        { badge: "text-gray-400",    dot: "bg-gray-400",    stroke: "stroke-gray-400"   },
  backlog:     { badge: "text-gray-500",    dot: "bg-gray-500",    stroke: "stroke-gray-500"   },
  prioritized: { badge: "text-blue-400",    dot: "bg-blue-400",    stroke: "stroke-blue-400"   },
  development: { badge: "text-blue-500",    dot: "bg-blue-500",    stroke: "stroke-blue-500"   },
  releasing:   { badge: "text-purple-500",  dot: "bg-purple-500",  stroke: "stroke-purple-500" },
  live:        { badge: "text-green-500",   dot: "bg-green-500",   stroke: "stroke-green-500"  },
  archived:    { badge: "text-gray-400",    dot: "bg-gray-400",    stroke: "stroke-gray-400"   },
  blocked:     { badge: "text-red-500",     dot: "bg-red-500",     stroke: "stroke-red-500"    },
};
```

- [ ] **Step 2: Verify the type is exhaustive**

Run: `npx tsc --noEmit`
Expected: clean. `Record<StatusId, …>` makes a missing status a compile error, which is the check.

- [ ] **Step 3: Commit**

```bash
git add components/graph/nodes/node-styles.ts
git commit -m "feat: add a stroke color per status to STATUS_STYLES"
```

---

### Task 3: The `StatusRing` primitive

**Files:**
- Create: `components/graph/nodes/StatusRing.tsx`

**Why `r = 15.9155`:** its circumference is `2πr ≈ 100`, so a `strokeDasharray` of `"60 40"` is literally "60% of the ring". No arc math anywhere else. Arc **geometry** uses `segment.ratio * 100` (unrounded) so arcs never overshoot; the rounded `segment.percentage` is only ever shown as text.

- [ ] **Step 1: Create the component**

```tsx
"use client";

import type { ReactNode } from "react";
import type { StatusSegment } from "@/lib/utils/platform-status";
import { STATUS_STYLES } from "./node-styles";

/** Circumference is 2πr ≈ 100, so stroke-dasharray takes literal percentages. */
const RADIUS = 15.9155;
const CIRCUMFERENCE = 100;
/** Percentage points shaved off each arc so neighbouring statuses stay distinguishable. */
const ARC_GAP = 1.6;

const SIZE_STYLES = {
  sm: { box: "size-[30px]", stroke: 4.5 },
  lg: { box: "size-[46px]", stroke: 4 },
} as const;

export type StatusRingSize = keyof typeof SIZE_STYLES;

interface StatusRingProps {
  segments: readonly StatusSegment[];
  size?: StatusRingSize;
  /** Accessible name for the ring — the platform, or "All platforms". */
  label: string;
  /** Center content: an acceptance count or a platform icon. */
  children?: ReactNode;
}

/**
 * A stacked donut of delivery statuses. Segments arrive in display order
 * (`compareStatusesForDisplay`) and are drawn clockwise from 12 o'clock; an
 * all-zero list renders the muted track alone, which is how an unserved value
 * element reads.
 */
export function StatusRing({ segments, size = "lg", label, children }: StatusRingProps) {
  const { box, stroke } = SIZE_STYLES[size];

  const arcs: { status: string; length: number; offset: number; className: string }[] = [];
  let consumed = 0;
  for (const segment of segments) {
    if (segment.count === 0) continue;
    const span = segment.ratio * CIRCUMFERENCE;
    arcs.push({
      status: segment.status,
      length: Math.max(span - ARC_GAP, 0.5),
      offset: consumed,
      className: STATUS_STYLES[segment.status].stroke,
    });
    consumed += span;
  }

  return (
    <div className={`relative shrink-0 ${box}`}>
      <svg viewBox="0 0 36 36" className="size-full -rotate-90" role="img" aria-label={label}>
        <circle
          cx="18"
          cy="18"
          r={RADIUS}
          fill="none"
          strokeWidth={stroke}
          className="stroke-muted-foreground/20"
        />
        {arcs.map((arc) => (
          <circle
            key={arc.status}
            cx="18"
            cy="18"
            r={RADIUS}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${arc.length} ${CIRCUMFERENCE - arc.length}`}
            strokeDashoffset={-arc.offset}
            className={arc.className}
          />
        ))}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add components/graph/nodes/StatusRing.tsx
git commit -m "feat: add the StatusRing SVG primitive"
```

---

### Task 4: The breakdown popover body

**Files:**
- Create: `components/graph/nodes/StatusBreakdownPopover.tsx`

- [ ] **Step 1: Create the component**

```tsx
"use client";

import type { LucideIcon } from "lucide-react";
import type { StatusSegment } from "@/lib/utils/platform-status";
import { STATUS_ICONS, STATUS_LABELS, STATUS_STYLES } from "./node-styles";

interface StatusBreakdownPopoverProps {
  /** "Android", or "All platforms" for the global ring. */
  title: string;
  icon?: LucideIcon;
  segments: readonly StatusSegment[];
  footer: string;
}

/** The body of a status ring's hover card: one line per status actually present. */
export function StatusBreakdownPopover({ title, icon: Icon, segments, footer }: StatusBreakdownPopoverProps) {
  const present = segments.filter((segment) => segment.count > 0);

  return (
    <div className="flex flex-col gap-2">
      <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
        {Icon && <Icon className="size-3.5 text-muted-foreground" />}
        {title}
      </p>

      {present.length === 0 ? (
        <p className="text-xs text-muted-foreground">No delivery statuses yet.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {present.map((segment) => {
            const StatusIcon = STATUS_ICONS[segment.status];
            return (
              <li key={segment.status} className="flex items-center gap-2 text-xs">
                <StatusIcon className={`size-3.5 shrink-0 ${STATUS_STYLES[segment.status].badge}`} />
                <span className="flex-1 truncate text-muted-foreground">{STATUS_LABELS[segment.status]}</span>
                <span className="font-medium tabular-nums text-foreground">{segment.count}</span>
                <span className="w-9 text-right tabular-nums text-muted-foreground">{segment.percentage}%</span>
              </li>
            );
          })}
        </ul>
      )}

      <p className="border-t pt-1.5 text-[11px] text-muted-foreground">{footer}</p>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add components/graph/nodes/StatusBreakdownPopover.tsx
git commit -m "feat: add the status breakdown popover body"
```

---

### Task 5: `PlatformRingSet` — four rings with hover cards

**Files:**
- Create: `components/graph/nodes/PlatformRingSet.tsx`

**Two traps, both load-bearing:**

1. **The hover trigger must be a `<span tabIndex={0}>`, never a `<button>`.** `PyramidElementCard` wraps its whole body in a Next `<Link>`, and a `<button>` inside an `<a>` is invalid HTML that React will warn about at runtime. A focusable `<span>` matches the existing `<abbr tabIndex={0}>` idiom in `EntityBadges.tsx` and lets a click still follow the card's link.
2. **Ring order is Web → Android → iOS**, which is *not* `PLATFORMS` config order (`web, ios, android`). Sort explicitly rather than reordering `PLATFORMS`, because that array's order drives the bar stacking in four other components.

- [ ] **Step 1: Create the component**

```tsx
"use client";

import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { PLATFORMS, type PlatformId } from "@/lib/config/platforms";
import type { PlatformStatusRollup } from "@/lib/utils/platform-status";
import { getPlatformRollupSegments, getRollupTotalSegments } from "@/lib/utils/platform-status";
import { PLATFORM_ICONS, PLATFORM_LABELS } from "./node-styles";
import { StatusBreakdownPopover } from "./StatusBreakdownPopover";
import { StatusRing, type StatusRingSize } from "./StatusRing";

// Rings read Web → Android → iOS. PLATFORMS' own order (web, ios, android) drives
// the bar stacking in PlatformGaugeList's four remaining call sites, so it stays put.
const RING_ORDER: readonly PlatformId[] = ["web", "android", "ios"];
const rank = (id: PlatformId) => {
  const index = RING_ORDER.indexOf(id);
  return index === -1 ? RING_ORDER.length : index;
};
const RING_PLATFORMS = [...PLATFORMS].sort((left, right) => rank(left.id) - rank(right.id));

interface PlatformRingSetProps {
  rollup: PlatformStatusRollup;
  /** Center of the global ring — the count the caller already computed. */
  count: number;
  size?: StatusRingSize;
  /** Names what `count` counts, for the popover footers. */
  countLabel?: string;
}

/**
 * Global + one ring per platform, each hover-revealing its status breakdown.
 * The global ring's arcs count platform *statuses* (one acceptance live on three
 * platforms contributes three), while its center shows the acceptance count —
 * the footer says both so the two numbers never look like a contradiction.
 */
export function PlatformRingSet({ rollup, count, size = "lg", countLabel = "acceptances" }: PlatformRingSetProps) {
  const totalSegments = getRollupTotalSegments(rollup);
  const statusTotal = totalSegments.reduce((sum, segment) => sum + segment.count, 0);
  const centerText = size === "lg" ? "text-sm" : "text-[11px]";
  const centerIcon = size === "lg" ? "size-4" : "size-3";

  return (
    <div className={`flex ${size === "lg" ? "gap-2.5" : "gap-2"}`}>
      <HoverCard openDelay={150}>
        <HoverCardTrigger asChild>
          <span tabIndex={0} className="cursor-help rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <StatusRing segments={totalSegments} size={size} label="All platforms">
              <span className={`font-semibold tabular-nums ${centerText}`}>{count}</span>
            </StatusRing>
          </span>
        </HoverCardTrigger>
        <HoverCardContent className="w-60 p-3" align="center">
          <StatusBreakdownPopover
            title="All platforms"
            segments={totalSegments}
            footer={`${count} ${countLabel} · ${statusTotal} platform statuses`}
          />
        </HoverCardContent>
      </HoverCard>

      {RING_PLATFORMS.map((platform) => {
        const segments = getPlatformRollupSegments(rollup, platform.id);
        const platformTotal = rollup.totals[platform.id] ?? 0;
        const Icon = PLATFORM_ICONS[platform.id];
        const label = PLATFORM_LABELS[platform.id];

        return (
          <HoverCard key={platform.id} openDelay={150}>
            <HoverCardTrigger asChild>
              <span tabIndex={0} className="cursor-help rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <StatusRing segments={segments} size={size} label={label}>
                  <Icon className={`${centerIcon} text-muted-foreground`} />
                </StatusRing>
              </span>
            </HoverCardTrigger>
            <HoverCardContent className="w-60 p-3" align="center">
              <StatusBreakdownPopover
                title={label}
                icon={Icon}
                segments={segments}
                footer={`${platformTotal} ${countLabel} on ${label}`}
              />
            </HoverCardContent>
          </HoverCard>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add components/graph/nodes/PlatformRingSet.tsx
git commit -m "feat: add PlatformRingSet with per-ring status breakdown hover cards"
```

---

### Task 6: Extract `SegmentedControl`

**Files:**
- Create: `components/ui/segmented-control.tsx`
- Modify: `components/library/LibraryFilterBar.tsx`

The extraction is only worth doing if the original adopts it, so both halves are in this task.

- [ ] **Step 1: Create the shared control**

```tsx
"use client";

import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SegmentedControlOption<T extends string> {
  id: T;
  label: string;
  icon?: LucideIcon;
}

interface SegmentedControlProps<T extends string> {
  options: readonly SegmentedControlOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name for the group, e.g. "Display mode". */
  ariaLabel: string;
  className?: string;
}

/** The repo's segmented toggle: a bordered strip of mutually exclusive options. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn("inline-flex items-center rounded-md border bg-background p-1", className)}
    >
      {options.map((option) => {
        const Icon = option.icon;
        const active = option.id === value;

        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.id)}
            className={cn(
              "inline-flex cursor-pointer items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            {Icon && <Icon className="size-3.5" />}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Rewrite `LibraryFilterBar` on top of it**

Replace the entire contents of `components/library/LibraryFilterBar.tsx` with:

```tsx
"use client";

import { SearchIcon, Grid3X3Icon, Table2Icon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { type SpeciesId } from "@/lib/config/species";

// Species selection is owned by the sidebar (?species= deep links); this bar
// only carries search and the display-mode toggle.
export type LibrarySpeciesFilter = "all" | SpeciesId;
export type LibraryDisplayMode = "gallery" | "directory";

const DISPLAY_MODES: readonly SegmentedControlOption<LibraryDisplayMode>[] = [
  { id: "gallery", label: "Grid", icon: Grid3X3Icon },
  { id: "directory", label: "Table", icon: Table2Icon },
];

interface LibraryFilterBarProps {
  search: string;
  displayMode: LibraryDisplayMode;
  onSearchChange: (query: string) => void;
  onDisplayModeChange: (mode: LibraryDisplayMode) => void;
}

export function LibraryFilterBar({
  search,
  displayMode,
  onSearchChange,
  onDisplayModeChange,
}: LibraryFilterBarProps) {
  return (
    <div className="rounded-xl border bg-card/70 p-3 md:p-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="relative w-full md:max-w-md">
          <SearchIcon className="pointer-events-none absolute left-2 top-2.5 size-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search title or description"
            className="pl-8"
            aria-label="Search nodes"
          />
        </div>

        <SegmentedControl
          options={DISPLAY_MODES}
          value={displayMode}
          onChange={onDisplayModeChange}
          ariaLabel="Display mode"
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify the Library page still compiles and lints**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean. `app/project/[id]/library/page.tsx` imports `LibraryFilterBar`, `LibraryDisplayMode` and `LibrarySpeciesFilter` from this module — all three are still exported, so no change is needed there.

- [ ] **Step 4: Commit**

```bash
git add components/ui/segmented-control.tsx components/library/LibraryFilterBar.tsx
git commit -m "refactor: extract SegmentedControl and adopt it in LibraryFilterBar"
```

---

### Task 7: The two element components

**Files:**
- Create: `components/pyramid/PyramidElementCard.tsx`
- Create: `components/pyramid/PyramidElementRow.tsx`

Both take the same props and link to the same place; they differ only in layout.

- [ ] **Step 1: Create the card**

```tsx
"use client";

import Link from "next/link";
import { PlatformRingSet } from "@/components/graph/nodes/PlatformRingSet";
import { ValueIcon } from "@/components/values/ValueBadge";
import type { PyramidElement } from "@/lib/utils/pyramid";

export interface PyramidElementViewProps {
  element: PyramidElement;
  label: string;
  description: string;
  href: string;
}

/** Grid card: a large value icon over the label, its definition, and the ring set. */
export function PyramidElementCard({ element, label, description, href }: PyramidElementViewProps) {
  const served = element.acceptanceCount > 0;

  return (
    <Link
      href={href}
      className={`flex flex-col gap-3 rounded-xl border bg-card p-4 transition-colors hover:bg-muted/40 ${served ? "" : "opacity-55"}`}
    >
      <ValueIcon valueId={element.value} className="size-7 text-muted-foreground" />
      <div className="flex flex-col gap-1">
        <h3 className="text-base font-semibold leading-tight">{label}</h3>
        <p className="line-clamp-2 text-xs text-muted-foreground">{description}</p>
      </div>
      <PlatformRingSet rollup={element.rollup} count={element.acceptanceCount} size="lg" />
    </Link>
  );
}
```

- [ ] **Step 2: Create the row**

```tsx
"use client";

import Link from "next/link";
import { PlatformRingSet } from "@/components/graph/nodes/PlatformRingSet";
import { ValueIcon } from "@/components/values/ValueBadge";
import type { PyramidElementViewProps } from "./PyramidElementCard";

/** List row: the same content on one line, rings right-aligned. */
export function PyramidElementRow({ element, label, description, href }: PyramidElementViewProps) {
  const served = element.acceptanceCount > 0;

  return (
    <Link
      href={href}
      className={`flex items-center gap-3 border-b px-4 py-2.5 transition-colors last:border-b-0 hover:bg-muted/40 ${served ? "" : "opacity-55"}`}
    >
      <ValueIcon valueId={element.value} className="size-5 shrink-0 text-muted-foreground" />
      <div className="flex min-w-0 flex-1 items-baseline gap-2.5">
        <span className="shrink-0 text-sm font-medium">{label}</span>
        <span className="truncate text-xs text-muted-foreground">{description}</span>
      </div>
      <PlatformRingSet rollup={element.rollup} count={element.acceptanceCount} size="sm" />
    </Link>
  );
}
```

- [ ] **Step 3: Type-check and commit**

Run: `npx tsc --noEmit`
Expected: clean.

```bash
git add components/pyramid/PyramidElementCard.tsx components/pyramid/PyramidElementRow.tsx
git commit -m "feat: add the Pyramid element card and row views"
```

---

### Task 8: Toolbar and tier group

**Files:**
- Create: `components/pyramid/PyramidToolbar.tsx`
- Create: `components/pyramid/PyramidTierGroup.tsx`

- [ ] **Step 1: Create the toolbar**

```tsx
"use client";

import { CircleCheckBigIcon, CircleDashedIcon, LayersIcon, LayoutGridIcon, ListIcon } from "lucide-react";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";

export type PyramidViewMode = "cards" | "list";
/** Which slice of the 30 elements to show. Most are unserved most of the time. */
export type PyramidFilterStep = "empty" | "all" | "addressed";

const VIEW_MODES: readonly SegmentedControlOption<PyramidViewMode>[] = [
  { id: "cards", label: "Cards", icon: LayoutGridIcon },
  { id: "list", label: "List", icon: ListIcon },
];

// CircleCheckBig is STATUS_ICONS.live in node-styles.ts — the repo's existing
// "delivered" mark, reused here so "addressed" reads the same way.
const FILTER_STEPS: readonly SegmentedControlOption<PyramidFilterStep>[] = [
  { id: "empty", label: "Empty only", icon: CircleDashedIcon },
  { id: "all", label: "All values", icon: LayersIcon },
  { id: "addressed", label: "Addressed only", icon: CircleCheckBigIcon },
];

interface PyramidToolbarProps {
  viewMode: PyramidViewMode;
  filterStep: PyramidFilterStep;
  onViewModeChange: (mode: PyramidViewMode) => void;
  onFilterStepChange: (step: PyramidFilterStep) => void;
}

export function PyramidToolbar({
  viewMode,
  filterStep,
  onViewModeChange,
  onFilterStepChange,
}: PyramidToolbarProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card/70 p-3">
      <SegmentedControl
        options={FILTER_STEPS}
        value={filterStep}
        onChange={onFilterStepChange}
        ariaLabel="Which value elements to show"
      />
      <SegmentedControl
        options={VIEW_MODES}
        value={viewMode}
        onChange={onViewModeChange}
        ariaLabel="Display mode"
      />
    </div>
  );
}
```

- [ ] **Step 2: Create the tier group**

```tsx
"use client";

import type { ReactNode } from "react";

interface PyramidTierGroupProps {
  label: string;
  /** Tier accent from VALUE_TIERS_CONFIG — a raw hex, not a Tailwind class. */
  color: string;
  elementCount: number;
  addressedCount: number;
  children: ReactNode;
}

/** A titled tier section wrapping whichever view is active. */
export function PyramidTierGroup({
  label,
  color,
  elementCount,
  addressedCount,
  children,
}: PyramidTierGroupProps) {
  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <span className="h-3.5 w-[3px] shrink-0 rounded-full" style={{ backgroundColor: color }} />
        {label}
        <span className="font-normal normal-case tracking-normal opacity-70">
          · {elementCount} {elementCount === 1 ? "element" : "elements"} · {addressedCount} addressed
        </span>
      </h2>
      {children}
    </section>
  );
}
```

- [ ] **Step 3: Type-check and commit**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

```bash
git add components/pyramid/PyramidToolbar.tsx components/pyramid/PyramidTierGroup.tsx
git commit -m "feat: add the Pyramid toolbar and tier group"
```

---

### Task 9: Rewire the Pyramid page

**Files:**
- Modify: `app/project/[id]/pyramid/page.tsx` (full rewrite of the component body)

- [ ] **Step 1: Replace the file contents**

```tsx
"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { PyramidElementCard } from "@/components/pyramid/PyramidElementCard";
import { PyramidElementRow } from "@/components/pyramid/PyramidElementRow";
import { PyramidTierGroup } from "@/components/pyramid/PyramidTierGroup";
import {
  PyramidToolbar,
  type PyramidFilterStep,
  type PyramidViewMode,
} from "@/components/pyramid/PyramidToolbar";
import { VALUES, VALUE_TIERS_CONFIG } from "@/lib/config/values";
import type { PyramidElement } from "@/lib/utils/pyramid";
import { computePyramidAggregation } from "@/lib/utils/pyramid";
import { useNodes } from "@/lib/hooks/useNodes";
import { useProject } from "@/lib/hooks/useProject";

const VALUE_LABEL = new Map(VALUES.map((v) => [v.id, v.label]));
const VALUE_DESCRIPTION = new Map(VALUES.map((v) => [v.id, v.description]));
const TIER_CONFIG = new Map(VALUE_TIERS_CONFIG.map((t) => [t.id, t]));

function matchesStep(element: PyramidElement, step: PyramidFilterStep) {
  if (step === "addressed") return element.acceptanceCount > 0;
  if (step === "empty") return element.acceptanceCount === 0;
  return true;
}

/**
 * The Pyramid: "How well is each value element delivered?" — the value-delivery
 * radar (spec §9.2). Each element carries four status rings (global + one per
 * platform); a three-step filter picks the slice worth looking at, and the view
 * switcher trades the icon-led cards for one-line rows.
 */
export default function PyramidPage() {
  const params = useParams();
  const id = Array.isArray(params.id) ? params.id[0] : params.id ?? "";

  const [viewMode, setViewMode] = useState<PyramidViewMode>("cards");
  const [filterStep, setFilterStep] = useState<PyramidFilterStep>("all");

  const { nodes: dataNodes, loading } = useNodes(id);
  const { project: projectBundle } = useProject(id);

  const acceptances = useMemo(
    () => dataNodes.filter((node) => node.species === "acceptance"),
    [dataNodes],
  );
  const tiers = useMemo(() => computePyramidAggregation(acceptances), [acceptances]);

  const visibleTiers = useMemo(
    () =>
      tiers
        .map((tier) => ({
          ...tier,
          addressedCount: tier.elements.filter((element) => element.acceptanceCount > 0).length,
          visible: tier.elements.filter((element) => matchesStep(element, filterStep)),
        }))
        .filter((tier) => tier.visible.length > 0),
    [tiers, filterStep],
  );

  if (loading) {
    return (
      <div className="h-full w-full flex items-center justify-center">
        <span className="text-muted-foreground text-sm">Loading pyramid...</span>
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <SidebarTrigger className="-ml-1 cursor-pointer" />
        <Separator orientation="vertical" className="mx-1 h-4" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{projectBundle?.project.title ?? "Untitled project"}</p>
          <p className="truncate text-xs text-muted-foreground">Value pyramid</p>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-4 md:p-6">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
          <PyramidToolbar
            viewMode={viewMode}
            filterStep={filterStep}
            onViewModeChange={setViewMode}
            onFilterStepChange={setFilterStep}
          />

          {visibleTiers.length === 0 ? (
            <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
              No value element matches this filter.
            </p>
          ) : (
            visibleTiers.map((tier) => {
              const config = TIER_CONFIG.get(tier.tier);
              return (
                <PyramidTierGroup
                  key={tier.tier}
                  label={config?.label ?? tier.tier}
                  color={config?.color ?? "#94a3b8"}
                  elementCount={tier.visible.length}
                  addressedCount={tier.addressedCount}
                >
                  {viewMode === "cards" ? (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {tier.visible.map((element) => (
                        <PyramidElementCard
                          key={element.value}
                          element={element}
                          label={VALUE_LABEL.get(element.value) ?? element.value}
                          description={VALUE_DESCRIPTION.get(element.value) ?? ""}
                          href={`/project/${id}/acceptances?value=${element.value}`}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="overflow-hidden rounded-xl border bg-card">
                      {tier.visible.map((element) => (
                        <PyramidElementRow
                          key={element.value}
                          element={element}
                          label={VALUE_LABEL.get(element.value) ?? element.value}
                          description={VALUE_DESCRIPTION.get(element.value) ?? ""}
                          href={`/project/${id}/acceptances?value=${element.value}`}
                        />
                      ))}
                    </div>
                  )}
                </PyramidTierGroup>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
```

Note what left: the `platform` state, the `PLATFORMS`/`PlatformGaugeList`/`Button`/`Link`/`ValueIcon` imports, and the `All · Web · iOS · Android` chip row. `computePyramidAggregation` is now called without its optional `platform` argument — the parameter stays in `lib/utils/pyramid.ts` and its test stays green.

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean, with no "unused import" errors — if you see one, an import from the old file survived the rewrite.

- [ ] **Step 3: Commit**

```bash
git add "app/project/[id]/pyramid/page.tsx"
git commit -m "feat: rebuild the Pyramid page on status rings with card and list views"
```

---

### Task 10: The Overview mini-card

**Files:**
- Modify: `components/overview/PyramidCard.tsx`

- [ ] **Step 1: Replace the file contents**

```tsx
"use client";

import { PlatformRingSet } from "@/components/graph/nodes/PlatformRingSet";
import { VALUE_TIERS_CONFIG } from "@/lib/config/values";
import { mergeRollups } from "@/lib/utils/platform-status";
import type { PyramidTier } from "@/lib/utils/pyramid";
import { OverviewSection } from "./OverviewSection";

const TIER_LABEL = new Map(VALUE_TIERS_CONFIG.map((t) => [t.id, t.label]));

interface PyramidCardProps {
  tiers: PyramidTier[];
  projectId: string;
}

/** Value delivery at a glance — one ring set per tier (spec §9.3). */
export function PyramidCard({ tiers, projectId }: PyramidCardProps) {
  return (
    <OverviewSection title="Value pyramid" href={`/project/${projectId}/pyramid`} linkLabel="Pyramid">
      <div className="flex flex-col gap-2.5">
        {tiers.map((tier) => {
          const rollup = mergeRollups(...tier.elements.map((element) => element.rollup));
          const acceptanceCount = tier.elements.reduce((sum, element) => sum + element.acceptanceCount, 0);

          return (
            <div key={tier.tier} className="flex items-center justify-between gap-3">
              <span className="truncate text-xs text-muted-foreground">{TIER_LABEL.get(tier.tier)}</span>
              <PlatformRingSet rollup={rollup} count={acceptanceCount} size="sm" />
            </div>
          );
        })}
      </div>
    </OverviewSection>
  );
}
```

Note the `served/total` text is gone — the global ring's center number replaces it, and it now counts acceptances rather than served elements. `PLATFORMS` and `PlatformGaugeList` imports are dropped.

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add components/overview/PyramidCard.tsx
git commit -m "feat: put status rings on the Overview value pyramid card"
```

---

### Task 11: Full verification

**Files:** none — this task only runs things.

- [ ] **Step 1: Run the full app test suite**

Run:

```bash
npm run test:pyramid && npm run test:coverage && npm run test:effective-status && \
npm run test:acceptance-matrix && npm run test:delivery && npm run test:journey-graph && \
npm run test:spotlight && npm run test:value-icons
```

Expected: every script ends in its "All … tests passed" line, exit code 0.

- [ ] **Step 2: Type-check, lint and build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: all clean. The build is the real check that no client component imported something server-only.

- [ ] **Step 3: Verify in the browser**

Run: `npm run dev`, then open a project's `/pyramid` route.

Confirm, and report anything that does not hold:
1. Cards view shows a large value icon, label, description and four rings per element.
2. The ring arcs start at 12 o'clock and run clockwise, green first; a blocked element shows red **last**.
3. Hovering any ring opens a breakdown listing colored status icon, label, count and percentage.
4. Hovering the global ring says "All platforms" and its footer names both the acceptance count and the platform-status total.
5. Switching to List shows one row per element with small rings, still grouped by tier.
6. The three filter steps each change the population; "Empty only" shows the unserved elements, "Addressed only" hides them.
7. A tier with no matching elements disappears rather than rendering an empty header.
8. Clicking an element opens the Acceptances page filtered to that value.
9. The Overview page's "Value pyramid" card shows four ring sets.
10. No React console warning about invalid DOM nesting (that would mean a `<button>` slipped inside the card's `<Link>`).

- [ ] **Step 4: Commit anything outstanding**

```bash
git status --short
```

Expected: clean tree. If not, commit the remainder with a descriptive message.

---

## Notes for the implementer

- **No chart library.** Do not add Recharts, TanStack Charts, or anything else. The ring is 40 lines of SVG on purpose; the repo has zero chart dependencies and keeps it that way.
- **There is no React test runner here.** Do not scaffold Jest or Vitest. Component correctness is verified by `tsc`, `lint`, `build`, and Step 3 of Task 11.
- **Tailwind is v4.** `stroke-*` utilities exist for the core palette and for theme colors like `stroke-muted-foreground/20`.
- **This repo requires a Lab Note in the PR body** (see `CLAUDE.md`) — this change is user-facing, so it needs one. Molecule slug is `arkaik`. Always double-quote every title and summary.
