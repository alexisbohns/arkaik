# Panel Collapsible Sections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the node detail panel two levels — an ungrouped intro block of the fields that say what the record is, and collapsible Platforms / Relations / Playlist / History groups holding everything else — plus a header menu carrying Duplicate, Split and Delete.

**Architecture:** A new `PanelGroup` (Radix `Collapsible`, full-width flush-bordered bar, `h3` disclosure heading) sits above the existing `PanelSection`, which demotes to `h4` when nested inside one via a React context. `NodeDetailPanel` keeps its intro block in a gutter'd column and moves every other section into a gapless column of groups. Nothing about the data layer changes except Part 5's new `onDuplicate` path.

**Tech Stack:** Next.js 15 App Router, React 19 (no React Compiler — `eslint-plugin-react-hooks`' `preserve-manual-memoization` is an **error** and CI gates on lint), Tailwind v4, shadcn/ui on Radix, TypeScript. Tests are plain Node scripts run one-per-CI-step; there is no aggregate `npm test`.

**Spec:** `docs/superpowers/specs/2026-09-19-panel-collapsible-sections-design.md`

---

## Things that will bite you

Read these before Task 1. Each one has already cost someone a CI round-trip in this repo.

1. **CI pins Node 20; your machine is likely Node 26.** Never `require()` a `.ts` file from a test. Every test here transpiles through a loader (`tests/app/load-*.js`) or through `typescript`'s AST API directly.
2. **A loader can only load a module with no *value* imports**, unless the loader rewrites them. `tests/app/load-panel-utils.js` does no rewriting, so anything it loads must import types only. `tests/app/load-quality.js` *does* rewrite `@arkaik/schema`, which is why Task 4 puts its function in `lib/utils/quality.ts`.
3. **CI diffs generated artifacts.** Adding a lucide icon that is not already in the registry dirties `lib/wobble/wobble-registry.generated.ts` and `app/wobble.generated.css`. Run `npm run generate` and commit the result before every PR. This plan adds `ChevronRightIcon` (Part 1), `MoreHorizontalIcon`, `CopyPlusIcon` and `Trash2Icon` (Part 5).
4. **CI gates on lint and `main` lints clean.** `npm run lint` — any error is yours.
5. **A new test file needs three edits**, not one: the file, a `test:<name>` script in `package.json`, and a step in `.github/workflows/ci.yml`. This plan adds no new test files — it extends `tests/app/panel-semantics.test.js`, `tests/app/quality.test.js` and `tests/app/acceptance-intake.test.js`, all three of which already have scripts and CI steps.
6. **Some suites assert on panel SOURCE TEXT, not on behaviour — moving a JSX element between files breaks them silently.** `tests/app/product-scope.test.js` reads `NodeDetailPanel.tsx` and the acceptance's platform section and asserts the `<PlatformVariants>` element builds its strip from `scope.platforms`; its helper returns `""` for a file with no such element, so a stale path fails as a *shape violation* rather than as the relocation it is. Part 3 hit this in CI because its gate named `acceptance-matrix` and `effective-status` but not `product-scope`. **Every part that moves a component or a JSX element must run `npm run test:product-scope` and `npm run test:project-panels`**, and grep `tests/` for the names of anything it moved. The suites that read panel sources today are `product-scope`, `panel-semantics` and `project-panels`.
7. **Every PR here ships something a user sees, so every PR carries a Lab Note** (`CLAUDE.md`). Molecule slug is `arkaik`. Always double-quote titles and summaries.
8. **`PanelSection.tsx` has no `"use client"` today.** Task 1 adds one, because it starts calling `useContext`. It is only ever imported by client components, so this costs nothing.

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `components/panels/panel-group-context.ts` | The one boolean "am I inside a group". Its own module so `PanelGroup` can import `PANEL_GUTTER` from `PanelSection` while `PanelSection` reads the context, with no import cycle. |
| `components/panels/PanelGroup.tsx` | The collapsible bar: `h3` + `CollapsibleTrigger`, `meta` slot, chevron, flush borders, gapless stacking. |
| `components/panels/RelationsGroup.tsx` | Part 2. Computes every cross-reference list for a node, decides whether the group renders at all, derives the header chip, and lays the child sections out in order. |
| `components/panels/AcceptancePlatformsSection.tsx` | Part 3. The acceptance's per-platform editor, lifted out of `AcceptanceEditor`. |
| `lib/utils/node-duplicate.ts` | Part 5. `duplicateNodeDraft` — pure, type-only imports, so `loadUtil` can load it. |

**Modified:**

| File | Change |
|---|---|
| `components/panels/PanelSection.tsx` | Heading demotes to `h4` inside a group; gains `"use client"`. |
| `components/panels/NodeDetailPanel.tsx` | The big one. Body splits into intro column + gapless group column; sections move; header gains the menu. |
| `components/panels/AcceptanceEditor.tsx` | Dismantled across Parts 2–4 until only intro fields remain. |
| `components/panels/PlaylistEditor.tsx` | Renders a `PanelGroup` rather than a `PanelSection`. |
| `components/panels/ProjectPanels.tsx` | Threads `onDuplicate`. |
| `components/layout/PageShell.tsx` | Threads `onDuplicate`. |
| `lib/utils/quality.ts` | Part 2. `worstOpenFindingFor`. |
| `tests/app/panel-semantics.test.js` | The outline it pins gains a rung. |
| `tests/app/quality.test.js` | Covers `worstOpenFindingFor`. |
| `tests/app/acceptance-intake.test.js` | Covers `duplicateNodeDraft`. |

---

# Part 1 — `PanelGroup`

Branch: `panel-group-primitive`. Base: `main`.

### Task 1: The context module

**Files:**
- Create: `components/panels/panel-group-context.ts`

- [ ] **Step 1: Write the module**

```ts
import { createContext, useContext } from "react";

/**
 * Whether the subtree is inside a {@link PanelGroup}.
 *
 * Its own module, and not a `createContext` at the top of `PanelGroup.tsx`,
 * because `PanelGroup` imports `PANEL_GUTTER` from `PanelSection` and
 * `PanelSection` reads this context — as one module that is an import cycle,
 * and Next's client bundler resolves cycles by handing one side an undefined
 * binding at module-evaluation time, which shows up as a heading that is
 * sometimes `h3` and sometimes `h4` depending on which file the bundler
 * reached first.
 *
 * `false` is the honest default: a `PanelSection` rendered outside any group —
 * which is every call site in `CriterionDetailPanel` and `CellDetailPanel` —
 * is a level-three section of the record, exactly as it was before groups
 * existed.
 */
export const PanelGroupContext = createContext(false);

/** True inside a `PanelGroup`, and the reason a nested section heads at `h4`. */
export function useInPanelGroup(): boolean {
  return useContext(PanelGroupContext);
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | head -20`
Expected: no error naming `panel-group-context.ts`. (Pre-existing errors elsewhere, if any, are not yours — compare against `git stash` if unsure.)

- [ ] **Step 3: Commit**

```bash
git add components/panels/panel-group-context.ts
git commit -m "feat(panels): the context a nested section reads to demote its heading"
```

---

### Task 2: `PanelGroup`

**Files:**
- Create: `components/panels/PanelGroup.tsx`
- Test: `tests/app/panel-semantics.test.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/app/panel-semantics.test.js`, immediately before the `// --- the invariant that catches the next one ---` divider:

```js
// --- 4: the group bar, and the rung it adds ---------------------------------

const panelGroup = parse(path.join(PANELS_DIR, "PanelGroup.tsx"));
const groupElements = elements(panelGroup);

// The bar is a disclosure: a heading whose whole content is the button that
// opens it. Either half alone is a different, worse thing — a heading that
// cannot be operated, or a button the outline cannot see.
const groupHeading = groupElements.find((element) => element.tag === "h3");
assert(groupHeading !== undefined, "PanelGroup heads its bar with an h3");

if (groupHeading) {
  const trigger = elements(groupHeading.node).find(
    (element) => element.tag === "CollapsibleTrigger",
  );
  assert(
    trigger !== undefined,
    "the h3's content is the CollapsibleTrigger — the bar is a disclosure",
  );
}

// The panel body has no horizontal padding, so a group is already full width;
// applying the section bleed on top of that would push the bar out of the
// panel. This is the assertion that catches someone "fixing" the gutter.
const groupSource = fs.readFileSync(path.join(PANELS_DIR, "PanelGroup.tsx"), "utf8");
assert(
  !groupSource.includes("PANEL_GUTTER_BLEED"),
  "PanelGroup does not bleed — it is already flush with the panel's edges",
);
assert(
  groupSource.includes("PANEL_GUTTER"),
  "PanelGroup re-applies the panel gutter inside its bar",
);
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm run test:panel-semantics`
Expected: FAIL — the run throws `ENOENT` on `components/panels/PanelGroup.tsx` from `parse`, because the file does not exist yet.

- [ ] **Step 3: Write `PanelGroup`**

```tsx
"use client";

import type { ReactNode } from "react";
import { ChevronRightIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { PanelGroupContext } from "@/components/panels/panel-group-context";
import { PANEL_GUTTER } from "@/components/panels/PanelSection";
import { FIELD_LABEL_CLASS } from "@/components/ui/field";

interface PanelGroupProps {
  title: ReactNode;
  /** Right of the title, left of the chevron — a count, a chip, a ghost action. */
  meta?: ReactNode;
  /** Open on mount. History passes false; everything else takes the default. */
  defaultOpen?: boolean;
  children: ReactNode;
}

/**
 * A named, collapsible region of a panel — the level above `PanelSection`.
 *
 * **The bar is the outline entry and the control at once.** An `h3` whose whole
 * content is the `CollapsibleTrigger`: that is the disclosure pattern, and it is
 * what lets a reader both list a panel's regions and open one without leaving
 * the heading. A heading beside a button would give the outline two entries for
 * one thing; a button with no heading would give it none.
 *
 * **No bleed.** The panel body carries `py` only — the horizontal gutter is
 * per-section, owned by `PANEL_GUTTER` — so a group dropped in the body is
 * already flush with the panel's edges. The bar re-applies the gutter to its own
 * contents so the title lines up with the prose above and below it.
 *
 * **`-mt-px`, and a gapless parent.** Each bar carries `border-y`, so two
 * collapsed groups stacked normally would show a two-pixel rule between them.
 * Pulling each group up a pixel collapses the pair into one hairline, which is
 * what makes a run of shut groups read as a table of contents. The caller must
 * lay groups out in a flex column with no `gap`; the panel body's own `gap-4`
 * would otherwise open a trench between every bar and defeat the whole effect.
 *
 * **Open/closed is per-mount and not stored.** The panel stack keeps hidden
 * panels mounted, so state does survive a trail being unwound and re-walked —
 * but a panel closed and reopened is a panel in its default shape. Remembering
 * it is a real feature and a plausible follow-up; it is not this one, and
 * storing it would mean first deciding whether the memory is the reader's, the
 * project's or the node's.
 */
export function PanelGroup({ title, meta, defaultOpen = true, children }: PanelGroupProps) {
  return (
    <PanelGroupContext.Provider value={true}>
      <Collapsible defaultOpen={defaultOpen} className="-mt-px">
        <h3>
          <CollapsibleTrigger
            className={cn(
              PANEL_GUTTER,
              "group flex w-full items-center gap-2 border-y border-border py-2.5 text-left transition-colors hover:bg-muted/50",
            )}
          >
            <span className={FIELD_LABEL_CLASS}>{title}</span>
            <span className="ml-auto flex shrink-0 items-center gap-2">
              {meta}
              <ChevronRightIcon
                className="size-3.5 text-muted-foreground transition-transform group-data-[state=open]:rotate-90"
                aria-hidden="true"
              />
            </span>
          </CollapsibleTrigger>
        </h3>
        {/* `gap-4` matches the panel body's own spacing between sections, so a
            group's children sit at the same rhythm as the ungrouped blocks
            above them. */}
        <CollapsibleContent className="flex flex-col gap-4 py-4">
          {children}
        </CollapsibleContent>
      </Collapsible>
    </PanelGroupContext.Provider>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:panel-semantics`
Expected: the four new checks PASS. **One pre-existing check now FAILS** — `panel bodies head their sections at h3` will not list `PanelGroup.tsx` (it heads at `h3`), so this should still be green. If it is red, read the failure: it means you typed a heading level other than `h3`.

- [ ] **Step 5: Regenerate — `ChevronRightIcon` is new to the panel modules**

Run: `npm run generate && git status --short`
Expected: either no change, or a diff in `lib/wobble/wobble-registry.generated.ts` / `app/wobble.generated.css`. Commit whatever it produces; CI diffs these.

- [ ] **Step 6: Lint**

Run: `npm run lint`
Expected: 0 errors. (4 warnings on `main` are pre-existing.)

- [ ] **Step 7: Commit**

```bash
git add components/panels/PanelGroup.tsx tests/app/panel-semantics.test.js lib/wobble app/wobble.generated.css
git commit -m "feat(panels): a panel region you can shut"
```

---

### Task 3: `PanelSection` demotes inside a group

**Files:**
- Modify: `components/panels/PanelSection.tsx`
- Test: `tests/app/panel-semantics.test.js:170-176` (the `PanelSection heads both its variants with h3` assertion) and `:180-196` (the stray scan)

- [ ] **Step 1: Rewrite the two failing assertions**

In `tests/app/panel-semantics.test.js`, replace this block:

```js
const panelSection = parse(path.join(PANELS_DIR, "PanelSection.tsx"));
const panelSectionHeadings = elements(panelSection).filter((element) => HEADINGS.has(element.tag));
assert(
  panelSectionHeadings.length === 2 && panelSectionHeadings.every((element) => element.tag === "h3"),
  "PanelSection heads both its variants with h3",
  `found ${panelSectionHeadings.map((element) => element.tag).join(", ") || "none"}`,
);
```

with:

```js
const panelSection = parse(path.join(PANELS_DIR, "PanelSection.tsx"));
const panelSectionHeadings = elements(panelSection).filter((element) => HEADINGS.has(element.tag));
// Exactly one of each, in one ternary: standalone the section is the record's
// own level-three, nested in a group it is the group's level-four. Written as a
// pair of literal tags rather than a computed `<Heading>` so that this check can
// still see which levels exist — a dynamic tag name would make the outline
// unreadable to everything but a browser.
assert(
  panelSectionHeadings.length === 2 &&
    panelSectionHeadings.some((element) => element.tag === "h3") &&
    panelSectionHeadings.some((element) => element.tag === "h4"),
  "PanelSection heads at h3 standalone and h4 inside a group",
  `found ${panelSectionHeadings.map((element) => element.tag).join(", ") || "none"}`,
);
```

And replace the stray scan's predicate:

```js
    if (HEADINGS.has(element.tag) && element.tag !== "h3" && !name.endsWith("Dialog.tsx")) {
```

with:

```js
    // h4 is now legal — it is the rung a `PanelSection` takes inside a
    // `PanelGroup`. h1, h2, h5 and h6 in a panel body still are not: h2 would
    // be a second record where there is only one, and h5 a level nothing in
    // this outline reaches.
    const legal = element.tag === "h3" || element.tag === "h4";
    if (HEADINGS.has(element.tag) && !legal && !name.endsWith("Dialog.tsx")) {
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm run test:panel-semantics`
Expected: FAIL — `PanelSection heads at h3 standalone and h4 inside a group — found h3, h3`.

- [ ] **Step 3: Implement the demotion**

In `components/panels/PanelSection.tsx`, add `"use client";` as the very first line, then add this import beside the others:

```tsx
import { useInPanelGroup } from "@/components/panels/panel-group-context";
```

Add this component just above `export function PanelSection`:

```tsx
/**
 * The section's heading, at whatever rung it is standing on.
 *
 * `h3` on its own — the record's own section, which is what every section in
 * this panel stack was before groups existed and what `CriterionDetailPanel` and
 * `CellDetailPanel` still are. `h4` inside a `PanelGroup`, whose bar took the
 * `h3`.
 *
 * Two literal tags rather than a computed `<Heading>` variable, because the
 * outline is checked statically (`tests/app/panel-semantics.test.js`) and a tag
 * name held in a variable is a level no reader of the source — human or test —
 * can see. The cost is one ternary; the benefit is that the next person to
 * change a heading level here trips a test instead of shipping it.
 */
function SectionHeading({ title }: { title: ReactNode }) {
  return useInPanelGroup() ? (
    <h4 className={FIELD_LABEL_CLASS}>{title}</h4>
  ) : (
    <h3 className={FIELD_LABEL_CLASS}>{title}</h3>
  );
}
```

Then replace both heading sites in `PanelSection`'s body:

```tsx
export function PanelSection({ title, action, children, className }: PanelSectionProps) {
  return (
    <section className={cn(PANEL_GUTTER, "flex flex-col gap-2", className)}>
      {action ? (
        <div className="flex items-center justify-between">
          <SectionHeading title={title} />
          {action}
        </div>
      ) : (
        <SectionHeading title={title} />
      )}
      {children}
    </section>
  );
}
```

Finally, update the module docblock's last paragraph — it currently claims the heading "is an `<h3>`" flatly. Replace that sentence with:

```
 * The heading is an `<h3>` standing alone and an `<h4>` inside a `PanelGroup`,
 * which takes the `h3` for its bar. See `SectionHeading` below for why the two
 * are written out rather than computed.
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:panel-semantics`
Expected: PASS, all checks, ending `All panel-semantics tests passed`.

- [ ] **Step 5: Lint and typecheck**

Run: `npm run lint && npx tsc --noEmit`
Expected: 0 lint errors, no new type errors.

- [ ] **Step 6: Commit**

```bash
git add components/panels/PanelSection.tsx tests/app/panel-semantics.test.js
git commit -m "feat(panels): a section nested in a group takes the rung below it"
```

---

### Task 4: History becomes a collapsed group

**Files:**
- Modify: `components/panels/NodeDetailPanel.tsx:491-527` (`HistorySection`) and `:689` (the body container)
- Test: `tests/app/panel-semantics.test.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/app/panel-semantics.test.js`, after the Task 2 block and before the `// --- the invariant` divider:

```js
// --- 5: History opens shut --------------------------------------------------

const nodePanel = parse(path.join(PANELS_DIR, "NodeDetailPanel.tsx"));
const nodePanelGroups = elements(nodePanel).filter((element) => element.tag === "PanelGroup");

const historyGroup = nodePanelGroups.find((element) => attr(element.opening, "title") === "History");
assert(historyGroup !== undefined, "the node panel wraps History in a PanelGroup");

if (historyGroup) {
  assert(
    attr(historyGroup.opening, "defaultOpen") === "false",
    "the History group opens shut — it fetches the journal to render a feed nobody scrolled to",
    `defaultOpen=${attr(historyGroup.opening, "defaultOpen")}`,
  );
}
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm run test:panel-semantics`
Expected: FAIL — `the node panel wraps History in a PanelGroup`.

- [ ] **Step 3: Move the group inside `HistorySection`**

The section decides its own emptiness from a hook (`useJournal`), so the caller cannot know whether to draw a bar. The section therefore owns its group.

In `components/panels/NodeDetailPanel.tsx`, add to the imports:

```tsx
import { PanelGroup } from "@/components/panels/PanelGroup";
```

Replace the three `return` bodies of `HistorySection` (loading, error, and the list) so each wraps a `PanelGroup` rather than a `PanelSection`, and drop the now-redundant inner section. The whole function becomes:

```tsx
function HistorySection({ node, allNodes }: HistorySectionProps) {
  const projectId = useProjectId();
  const { journal, loading, error } = useJournal(projectId);
  const timeline = useMemo(() => computeNodeTimeline(journal, node.id), [journal, node.id]);
  const nodesById = useMemo(() => new Map(allNodes.map((n) => [n.id, n])), [allNodes]);

  // The group, not the caller, because emptiness is only knowable after the
  // journal has arrived — and a bar over nothing is worse than no bar. The two
  // transient states still draw one: a reader who opened History and saw it
  // vanish mid-fetch would read that as the panel losing its place.
  if (loading) {
    return (
      <PanelGroup title="History" defaultOpen={false}>
        <p className={cn(PANEL_GUTTER, "text-xs text-muted-foreground")}>Loading history…</p>
      </PanelGroup>
    );
  }

  if (error) {
    return (
      <PanelGroup title="History" defaultOpen={false}>
        <p className={cn(PANEL_GUTTER, "text-xs text-muted-foreground")}>{error}</p>
      </PanelGroup>
    );
  }

  if (timeline.length === 0) {
    return null;
  }

  return (
    <PanelGroup title="History" defaultOpen={false}>
      <div className={cn(PANEL_GUTTER, "flex flex-col gap-0.5")}>
        {[...timeline].reverse().map((event) => (
          // No `onOpen`: this list is already inside the node's own panel, so a
          // row that navigated would navigate to where the reader is standing.
          <FeedRow key={event.id} event={event} nodesById={nodesById} />
        ))}
      </div>
    </PanelGroup>
  );
}
```

- [ ] **Step 4: Split the panel body into two columns**

In `NodeDetailPanel`'s returned JSX (`:689`), the outer `div` keeps `gap-4` for the ungrouped sections, and a new gapless `div` holds the groups. For now that column holds only History. Replace the closing of the body — the `{history && (<HistorySection … />)}` block and the outer `</div>` — with:

```tsx
      {/* Groups live in a column of their own. `-space-y-px` overlaps each
          bar's `border-y` with the one above so a run of shut groups reads as
          one ruled list; the body's `gap-4` would open a four-unit trench
          between every pair. Parts 2–4 fill this column; for now it holds
          History alone. */}
      <div className="flex flex-col -space-y-px">
        {history && (
          <HistorySection
            key={`history-${node.id}`}
            node={node}
            allNodes={allNodes ?? NO_NODES}
          />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test:panel-semantics`
Expected: PASS, `All panel-semantics tests passed`.

- [ ] **Step 6: Check it in the running app**

Run: `npm run dev` and open a project's Library, then any node with history.
Expected: a flush bordered bar reading HISTORY at the bottom of the panel, chevron pointing right, no feed. Click it: the chevron rotates down and the feed appears. A node with no history shows no bar at all.

- [ ] **Step 7: Lint**

Run: `npm run lint`
Expected: 0 errors.

- [ ] **Step 8: Commit**

```bash
git add components/panels/NodeDetailPanel.tsx tests/app/panel-semantics.test.js
git commit -m "feat(panels): History opens shut"
```

---

### Task 5: Ship Part 1

- [ ] **Step 1: Verify the whole gate**

Run: `npm run generate && git diff --exit-code -- lib/wobble/wobble-registry.generated.ts app/wobble.generated.css && npm run lint && npm run test:panel-semantics && npm run test:panel-stack && npm run test:project-panels`
Expected: every command exits 0.

- [ ] **Step 2: Open the PR with its Lab Note**

```bash
git push -u origin panel-group-primitive
gh pr create --title "feat(panels): a panel region you can shut" --body "$(cat <<'BODY'
`PanelGroup` — a named, collapsible region of a panel. An `h3` whose whole
content is the disclosure trigger, a flush bar bordered top and bottom, and a
`-mt-px` stack so a run of shut groups reads as one ruled list rather than a
ladder of double lines.

`PanelSection` demotes to `h4` inside one, so the outline gains its fourth rung:
h1 page → h2 record → h3 group → h4 block. Written as two literal tags rather
than a computed heading, so `tests/app/panel-semantics.test.js` can still see
which levels exist.

First consumer: History, which now opens shut on every species panel.

## Lab Note

```yaml
en:
  title: "History stays out of your way"
  summary: "A node's history is now a section you open when you want it, rather than a wall of events between you and everything else on the panel."
fr:
  title: "L'historique se fait discret"
  summary: "L'historique d'un nœud devient une section que tu ouvres quand tu en as besoin, au lieu d'un mur d'événements planté au milieu du panneau."
suggested:
  molecule: arkaik
  type: improvement
  tags: [panels]
```

🤖 Generated with [Claude Code](https://claude.com/claude-code)
BODY
)"
```

- [ ] **Step 3: Read the PR's comments**

Run: `gh pr view --comments`
Expected: the Lab Note reminder either says nothing or names a problem. If it comments, fix the PR body and re-check — it clears its own comment.

---

# Part 2 — the Relations group

Branch: `panel-relations-group`, stacked on `panel-group-primitive` via `gh stack`. Use the `gh-stack` skill for the commands.

### Task 6: `worstOpenFindingFor`

The Relations bar needs a severity chip, and deriving it in the component would be a second opinion on "which finding is worst" alongside `filterFindings`. This is the one piece of Part 2 that is pure logic, so it is the one piece with a real unit test.

**Files:**
- Modify: `lib/utils/quality.ts`
- Test: `tests/app/quality.test.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/app/quality.test.js`, before its final failure-count block. First confirm the file's local helper names by reading its head — it uses the same `assert(cond, message)` shape as the other suites and destructures from `loadQuality()` at the top. Add `worstOpenFindingFor` to that destructuring, then append:

```js
// --- worstOpenFindingFor ----------------------------------------------------

{
  const rows = [
    { id: "F-a", nodeIds: ["V-login"], open: true, severity: "low", title: "a" },
    { id: "F-b", nodeIds: ["V-login"], open: true, severity: "critical", title: "b" },
    { id: "F-c", nodeIds: ["V-login"], open: false, severity: "critical", title: "c" },
    { id: "F-d", nodeIds: ["V-other"], open: true, severity: "critical", title: "d" },
  ];

  const found = worstOpenFindingFor(rows, "V-login");
  assert(found !== null, "worstOpenFindingFor returns a summary when the node has open findings");
  assert(found.count === 2, `it counts only this node's OPEN findings (got ${found && found.count})`);
  assert(
    found.severity === "critical",
    `it reports the worst severity among them (got ${found && found.severity})`,
  );

  assert(
    worstOpenFindingFor(rows, "V-nothing") === null,
    "a node with no findings gets null, not a zero",
  );
  assert(
    worstOpenFindingFor(
      [{ id: "F-e", nodeIds: ["V-x"], open: false, severity: "critical", title: "e" }],
      "V-x",
    ) === null,
    "a node whose every finding is closed gets null — the bar says nothing",
  );
  assert(worstOpenFindingFor([], "V-x") === null, "no rows at all gets null");
}
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm run test:quality-page`
Expected: FAIL — `worstOpenFindingFor is not a function`.

- [ ] **Step 3: Implement it**

Append to `lib/utils/quality.ts`:

```ts
/** What the Relations bar says about a node's open findings. */
export interface OpenFindingSummary {
  severity: FindingSeverity;
  count: number;
}

/**
 * The worst open finding against one node, and how many there are.
 *
 * This is what lets the Relations group's bar carry a severity chip, which is
 * what stops the move into a collapsible group from costing findings their
 * urgency: the panel used to put them high on the argument that an open critical
 * finding is the most pressing thing it can tell a reader, and the chip is that
 * argument surviving the reorganisation. The bar shows it whether the group is
 * open or shut.
 *
 * Open only, and `nodeIds` rather than a single id, matching `FindingsSection`
 * and the canvas badge exactly — all three ask the same two questions, so a node
 * wearing a red "3" opens onto a bar reading "3" and onto three rows.
 *
 * `null`, not a zero-count summary: "no open findings" is the absence of a
 * chip, and a caller handed `{ count: 0 }` would have to know to suppress it.
 *
 * Severity order comes from `FINDING_SEVERITIES` — the schema package's own
 * ordering, worst first — for the reason nothing in this file reimplements a
 * scale: a second ranking here would disagree with the board the first time a
 * pack moved a bucket.
 */
export function worstOpenFindingFor(
  rows: readonly FindingRow[],
  nodeId: string,
): OpenFindingSummary | null {
  const own = rows.filter((row) => row.open && row.nodeIds.includes(nodeId));
  if (own.length === 0) return null;

  let worst = own[0].severity;
  for (const row of own) {
    if (FINDING_SEVERITIES.indexOf(row.severity) < FINDING_SEVERITIES.indexOf(worst)) {
      worst = row.severity;
    }
  }

  return { severity: worst, count: own.length };
}
```

`FINDING_SEVERITIES` is already imported from `@arkaik/schema` in this file's import block (`lib/utils/quality.ts:17`) and is ordered **worst first** — `["critical", "high", "medium", "low", "info"]`, at `packages/schema/src/quality.ts:51`. That is why the comparison is `<`: a lower index is a worse finding.

Those five strings are also the only severities there are. A fixture using any other value (`"minor"`, `"major"`, …) sends `indexOf` to `-1`, which sorts *worse than critical* and fails this test for a reason unrelated to the code.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:quality-page`
Expected: PASS on all five new checks.

- [ ] **Step 5: Commit**

```bash
git add lib/utils/quality.ts tests/app/quality.test.js
git commit -m "feat(quality): the worst open finding against one node"
```

---

### Task 7: `RelationsGroup`

**Files:**
- Create: `components/panels/RelationsGroup.tsx`
- Modify: `components/panels/NodeDetailPanel.tsx` (export the four section components it needs, remove them from the body)
- Modify: `components/panels/AcceptanceEditor.tsx` (its Covers field moves out)

- [ ] **Step 1: Make the existing sections importable**

In `components/panels/NodeDetailPanel.tsx`, add `export` to these four declarations, leaving their bodies untouched:

- `function InvocationSection` (`:296`)
- `function RefsSection` (`:314`)
- `function FindingsSection` (`:346`)
- `function ConnectionsSection` (`:396`)

Also export their props interfaces (`InvocationSectionProps`, `FindingsSectionProps`, `ConnectionsSectionProps`) so `RelationsGroup` can name what it passes.

- [ ] **Step 2: Move the Covers field out of `AcceptanceEditor`**

Cut the whole `<Field label="Covers"> … </Field>` block from `components/panels/AcceptanceEditor.tsx` (it runs from the `Covers` label to the closing `</Field>` after `AttachAnchorRow`) and the `AttachAnchorRow` component with it, into a new exported component in the same file:

```tsx
interface CoversSectionProps {
  node: Node;
  allNodes: Node[];
  allEdges: Edge[];
  scope: ProductScope;
  onNavigate?: (node: Node) => void;
  intake?: AcceptanceIntake;
}

/**
 * What this acceptance covers — and, on a writable surface, the row that
 * attaches it to something more.
 *
 * Lifted out of `AcceptanceEditor` because it is a relation, not a field: it
 * belongs beside References and Connections in the Relations group, and leaving
 * it in the editor would have made the acceptance the one species whose covers
 * list lived somewhere other than with its other cross-references.
 */
export function CoversSection({ node, allNodes, allEdges, scope, onNavigate, intake }: CoversSectionProps) {
  const nodesById = new Map(allNodes.map((n) => [n.id, n]));
  const coveredAnchors = allEdges
    .filter((e) => e.edge_type === "covers" && e.source_id === node.id)
    .map((e) => nodesById.get(e.target_id))
    .filter((n): n is Node => Boolean(n));

  async function run(action: () => Promise<void>, failure: string) {
    try {
      await action();
    } catch (err) {
      toast.error(failure);
      console.error(err);
    }
  }

  return (
    <PanelSection title="Covers">
      {coveredAnchors.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {intake
            ? "Unanchored — an idea in intake. Attach it to a view or a flow below."
            : "Unanchored (covers nothing)."}
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {coveredAnchors.map((anchor) => {
            const Icon = SPECIES_ICONS[anchor.species];
            return (
              <li key={anchor.id} className="flex items-center gap-1">
                <button type="button" className="inline-flex flex-1 items-center gap-2 text-left text-sm hover:underline" onClick={() => onNavigate?.(anchor)}>
                  <Icon className="size-3.5 text-muted-foreground" /> {anchor.title}
                </button>
                {intake && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0"
                    aria-label={`Stop covering ${anchor.title}`}
                    onClick={() => void run(() => intake.detach(node, anchor.id), "Couldn't detach that node.")}
                  >
                    <XIcon className="size-3.5" />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {intake && (
        <AttachAnchorRow
          node={node}
          allNodes={allNodes}
          allEdges={allEdges}
          nodesById={nodesById}
          hasProducts={scope.productsById.size > 0}
          intake={intake}
          run={run}
        />
      )}
    </PanelSection>
  );
}
```

It is now a `PanelSection` rather than a `Field`, because inside a group it is a level-four section with a heading, not a labelled control. `AcceptanceEditor` keeps its own private `run` for the split gesture; the duplication is two try/catch lines and the alternative is exporting a helper that exists to save them.

`AcceptanceEditor` also loses its now-unused `coveredAnchors`/`anchorCount` derivations — except that the Product picker's hint still needs `anchorCount`. Keep the `coveredAnchors` computation in `AcceptanceEditor` for that, and let `CoversSection` compute its own. Two cheap `filter`s over the same edges beats threading a count between two components that will drift.

- [ ] **Step 3: Write `RelationsGroup`**

```tsx
"use client";

import { cn } from "@/lib/utils";
import { PanelGroup } from "@/components/panels/PanelGroup";
import {
  ConnectionsSection,
  FindingsSection,
  InvocationSection,
  RefsSection,
} from "@/components/panels/NodeDetailPanel";
import { CoversSection } from "@/components/panels/AcceptanceEditor";
import { AcceptancesSection } from "@/components/panels/AcceptancesSection";
import { SEVERITY_CHIP, SEVERITY_LABEL } from "@/components/quality/quality-styles";
import { worstOpenFindingFor, type FindingRow } from "@/lib/utils/quality";
import { findWhereUsed, crossLayerConnections } from "@/lib/utils/where-used";
import { acceptancesCovering } from "@arkaik/schema";
import type { Node, Edge } from "@/lib/data/types";
import type { ProductScope } from "@/lib/utils/product-scope";
import type { AcceptanceIntake } from "@/lib/hooks/useAcceptanceIntake";

interface RelationsGroupProps {
  node: Node;
  scope: ProductScope;
  allNodes?: Node[];
  allEdges?: Edge[];
  onNavigate?: (node: Node) => void;
  onCreateAcceptanceForAnchor?: (anchor: Node, title: string) => Promise<Node>;
  intake?: AcceptanceIntake;
  findings?: FindingRow[];
  onOpenCriterion?: (criterionId: string, surface: string) => void;
}

/**
 * Everything this node is attached to, in one region.
 *
 * Covers, Acceptances, Invocation, References, Findings and Connections were six
 * sibling sections in a flat column, indistinguishable in weight from the fields
 * that say what the record *is*. They are all the same kind of thing — the
 * record pointing at other records — and as one named region a reader can shut
 * them all at once and read the record itself.
 *
 * **The bar carries the findings chip.** See `worstOpenFindingFor`: moving
 * Findings into a group costs it the position it held on a stated argument, and
 * the chip is that argument surviving the move. It is on the bar, so it shows
 * whether the group is open or shut.
 *
 * **Renders nothing when every child would.** A bar over six empty sections is
 * worse than no bar — it promises a reader something to open and then opens onto
 * nothing. Each child already returns `null` when it is empty, but a parent
 * cannot see that, so the emptiness test is made here from the same inputs the
 * children use.
 */
export function RelationsGroup({
  node,
  scope,
  allNodes,
  allEdges,
  onNavigate,
  onCreateAcceptanceForAnchor,
  intake,
  findings,
  onOpenCriterion,
}: RelationsGroupProps) {
  const isAnchor = node.species === "view" || node.species === "flow";
  const openFindings = findings && onOpenCriterion ? worstOpenFindingFor(findings, node.id) : null;

  // Every child's emptiness, asked the way the child asks it. Duplicated
  // deliberately: the alternative is each section reporting its own count
  // upward, which means six components that render `null` AND report zero, and
  // two chances each for the two answers to disagree.
  const hasRefs = (node.metadata?.refs ?? []).length > 0;
  const hasFindings = openFindings !== null;
  const hasCovers =
    node.species === "acceptance" &&
    Boolean(allEdges) &&
    (intake !== undefined ||
      (allEdges ?? []).some((e) => e.edge_type === "covers" && e.source_id === node.id));
  const hasAcceptances =
    isAnchor && Boolean(allNodes && allEdges) &&
    (onCreateAcceptanceForAnchor !== undefined ||
      acceptancesCovering(node.id, allNodes ?? [], allEdges ?? []).length > 0);
  const hasInvocation = isAnchor && Boolean(allNodes) && findWhereUsed(node.id, allNodes ?? []).length > 0;
  const hasConnections =
    Boolean(allNodes && allEdges && onNavigate) &&
    connectionsOf(node, allNodes ?? [], allEdges ?? []).length > 0;

  if (
    !hasCovers && !hasAcceptances && !hasInvocation &&
    !hasRefs && !hasFindings && !hasConnections
  ) {
    return null;
  }

  return (
    <PanelGroup
      title="Relations"
      meta={
        openFindings && (
          <span
            className={cn(
              "rounded border px-1.5 py-0.5 text-[11px] font-medium",
              SEVERITY_CHIP[openFindings.severity],
            )}
          >
            {SEVERITY_LABEL[openFindings.severity]} {openFindings.count}
          </span>
        )
      }
    >
      {hasCovers && allNodes && allEdges && (
        <CoversSection
          node={node}
          allNodes={allNodes}
          allEdges={allEdges}
          scope={scope}
          onNavigate={onNavigate}
          intake={intake}
        />
      )}
      {hasAcceptances && allNodes && allEdges && (
        <AcceptancesSection
          node={node}
          scope={scope}
          allNodes={allNodes}
          allEdges={allEdges}
          onNavigate={onNavigate}
          onCreate={onCreateAcceptanceForAnchor}
        />
      )}
      {hasInvocation && allNodes && onNavigate && (
        <InvocationSection node={node} allNodes={allNodes} onNavigate={onNavigate} />
      )}
      <RefsSection node={node} />
      {findings && onOpenCriterion && (
        <FindingsSection node={node} findings={findings} onOpenCriterion={onOpenCriterion} />
      )}
      {allNodes && allEdges && onNavigate && (
        <ConnectionsSection
          node={node}
          allNodes={allNodes}
          allEdges={allEdges}
          onNavigate={onNavigate}
        />
      )}
    </PanelGroup>
  );
}
```

`findWhereUsed` already lives in `lib/utils/where-used.ts` (`NodeDetailPanel.tsx:39`). `crossLayerConnections` does not exist yet — `ConnectionsSection` walks the edges inline (`NodeDetailPanel.tsx:404-415`) — so Step 3a extracts it. Do not restate that walk here: the emptiness test above and the list below have to agree, and two copies are two chances to disagree the day a new edge type appears.

- [ ] **Step 3a: Extract `crossLayerConnections`**

Add to `lib/utils/where-used.ts`:

```ts
/**
 * The data models, API endpoints and decisions this node is wired to — the rows
 * `ConnectionsSection` lists, lifted out of it so `RelationsGroup` can ask
 * whether there are any without walking the edges a second time.
 *
 * `composes` is excluded because it is the playlist's own edge and the playlist
 * has its own region. A decision's own decision-typed edges are excluded for the
 * reason the section always excluded them: `DecisionEditor` lists both
 * directions already, and a decision node would otherwise double-list them.
 */
export function crossLayerConnections(
  node: Node,
  allNodes: readonly Node[],
  allEdges: readonly Edge[],
): Node[] {
  const isDecisionEdge = (e: Edge) =>
    e.edge_type === "supersedes" || e.edge_type === "generates" || e.edge_type === "impacts";

  const reached = allEdges
    .filter((e) => e.edge_type !== "composes" && (e.source_id === node.id || e.target_id === node.id))
    .filter((e) => !(node.species === "decision" && isDecisionEdge(e)))
    .map((e) => {
      const otherId = e.source_id === node.id ? e.target_id : e.source_id;
      return allNodes.find((n) => n.id === otherId);
    })
    .filter((n): n is Node => !!n && (n.species === "data-model" || n.species === "api-endpoint" || n.species === "decision"));

  return [...new Map(reached.map((n) => [n.id, n])).values()];
}
```

Then replace the whole inline derivation in `ConnectionsSection` (`NodeDetailPanel.tsx:404-415`, from `const isDecisionEdge` through `uniqueCrossLayerNodes`) with one call, keeping the explanatory comment above it since it is now the extracted function's docblock too:

```tsx
  const uniqueCrossLayerNodes = crossLayerConnections(node, allNodes, allEdges);
```

`lib/utils/where-used.ts:1` imports types only (`import type { Node, PlaylistEntry }`). Add `Edge` to that same type import — do not add a value import, which would break any loader that transpiles this file without rewriting module resolution.

- [ ] **Step 4: Wire it into the panel body**

In `NodeDetailPanel`'s JSX, delete the standalone `RefsSection`, `FindingsSection`, `AcceptancesSection`, `InvocationSection` and `ConnectionsSection` renders, and add `RelationsGroup` to the gapless group column, above History:

```tsx
      <div className="flex flex-col -space-y-px">
        <RelationsGroup
          key={`relations-${node.id}`}
          node={node}
          scope={scope}
          allNodes={allNodes}
          allEdges={allEdges}
          onNavigate={onNavigate}
          onCreateAcceptanceForAnchor={onCreateAcceptanceForAnchor}
          intake={intake}
          findings={findings}
          onOpenCriterion={onOpenCriterion}
        />
        {history && (
          <HistorySection
            key={`history-${node.id}`}
            node={node}
            allNodes={allNodes ?? NO_NODES}
          />
        )}
      </div>
```

**Circular import warning:** `RelationsGroup` imports from `NodeDetailPanel`, which imports `RelationsGroup`. Next's client bundler tolerates this for function declarations (hoisted), and the four sections are function declarations — but if you hit an "undefined is not a component" at runtime, the fix is to move the four sections into `components/panels/NodeRelationSections.tsx` and have both files import from there. Prefer doing that move up front if the four sections plus their props interfaces come to more than ~120 lines; the cycle is not worth defending.

- [ ] **Step 5: Verify in the running app**

Run: `npm run dev`
Expected, on an acceptance with an anchor and an open finding: a RELATIONS bar carrying a severity chip, open, containing COVERS / REFERENCES / FINDINGS / CONNECTIONS at the smaller nested heading. On a node with no relations at all: no bar. On a view: ACCEPTANCES / INVOCATION / … in that order.

- [ ] **Step 6: Lint, typecheck, test**

Run: `npm run lint && npx tsc --noEmit && npm run test:panel-semantics && npm run test:quality-page`
Expected: all exit 0.

- [ ] **Step 7: Commit**

```bash
git add components/panels/ tests/app/
git commit -m "feat(panels): one region for everything a node is attached to"
```

---

### Task 8: Ship Part 2

- [ ] **Step 1: Pin the group in the semantics test**

Append to `tests/app/panel-semantics.test.js`, in the section-5 block:

```js
const relationsGroup = nodePanelGroups.find(
  (element) => attr(element.opening, "title") === "Relations",
);
// Rendered by RelationsGroup, not inline here — so its absence from this file is
// expected, and what is pinned instead is that the node panel mounts it.
const mountsRelations = elements(nodePanel).some((element) => element.tag === "RelationsGroup");
assert(mountsRelations, "the node panel mounts RelationsGroup");
assert(
  relationsGroup === undefined,
  "Relations is not also opened inline — one component owns that bar",
);
```

- [ ] **Step 2: Run the full gate**

Run: `npm run generate && git diff --exit-code -- lib/wobble/wobble-registry.generated.ts app/wobble.generated.css && npm run lint && npm run test:panel-semantics && npm run test:quality-page && npm run test:acceptance-intake`
Expected: all exit 0.

- [ ] **Step 3: Open the stacked PR with its Lab Note**

Use the `gh-stack` skill to push and open the PR on top of `panel-group-primitive`. Body:

```markdown
Covers, Acceptances, Invocation, References, Findings and Connections were six
sibling sections indistinguishable in weight from the fields that say what the
record is. They are one kind of thing — the record pointing at other records —
and they are now one region a reader can shut.

Findings moves, and does not lose its urgency: `worstOpenFindingFor` puts the
worst open severity and its count on the Relations bar, where it shows whether
the group is open or shut.

## Lab Note

```yaml
en:
  title: "Everything a node is attached to, in one place"
  summary: "What a node covers, what covers it, where it is used, its links and its open findings now sit together in one section you can fold away — with anything urgent still flagged on the outside."
fr:
  title: "Tout ce qui relie un nœud, au même endroit"
  summary: "Ce qu'un nœud couvre, ce qui le couvre, où il est utilisé, ses liens et ses findings ouverts se regroupent dans une section repliable — et ce qui est urgent reste signalé même repliée."
nodes: [V-library, V-graph]
suggested:
  molecule: arkaik
  type: improvement
  tags: [panels]
```
```

Replace the `nodes:` ids with ones that exist in this project's graph — check with `grep -rn "V-library\|V-graph" seed/arkaik-self-map.json` and drop the key entirely if neither does. An id nothing answers to is named back at you in the delivery response.

- [ ] **Step 4: Read the PR's comments**

Run: `gh pr view --comments`

---

# Part 3 — the Platforms group

Branch: `panel-platforms-group`, stacked on `panel-relations-group`.

### Task 9: Lift the acceptance's platform block out of `AcceptanceEditor`

**Files:**
- Create: `components/panels/AcceptancePlatformsSection.tsx`
- Modify: `components/panels/AcceptanceEditor.tsx`

- [ ] **Step 1: Write the new component**

```tsx
"use client";

import type { Node, PlatformStatusMap } from "@/lib/data/types";
import type { PlatformId } from "@/lib/config/platforms";
import type { ProductScope } from "@/lib/utils/product-scope";
import { getEditablePlatformStatuses } from "@/lib/utils/platform-status";
import { PlatformVariants } from "@/components/panels/PlatformVariants";

interface AcceptancePlatformsSectionProps {
  node: Node;
  scope: ProductScope;
  onUpdate: (id: string, patch: Partial<Omit<Node, "id" | "project_id">>) => Promise<void> | void;
}

/**
 * An acceptance's per-platform status, notes and screenshots.
 *
 * Lifted out of `AcceptanceEditor`, where it was a `Field` labelled
 * "Per-platform status" sitting below the Gherkin. It is the same thing a view's
 * panel calls Platform Variants and a flow's calls a rollup, and all three are
 * now one region named Platforms — so a reader walking three panels meets one
 * name for one shelf.
 *
 * No local state, unlike `PlatformVariantsSection`: this one patches straight
 * through, which is what `AcceptanceEditor` always did here.
 */
export function AcceptancePlatformsSection({ node, scope, onUpdate }: AcceptancePlatformsSectionProps) {
  const statuses: PlatformStatusMap = getEditablePlatformStatuses(node);

  function patchMetadata(next: Record<string, unknown>) {
    onUpdate(node.id, { metadata: { ...node.metadata, ...next } });
  }

  return (
    // The scope's MENU, not `scopedPlatforms(node, scope)` — see
    // `PlatformVariantsSection`. Shape decisions read `scope.platforms`;
    // per-node facts read `scopedPlatforms`.
    <PlatformVariants
      platforms={scope.platforms}
      statuses={statuses}
      notes={node.metadata?.platformNotes}
      screenshots={node.metadata?.platformScreenshots}
      onStatusChange={(platform: PlatformId, value) => {
        const next = { ...statuses };
        if (value) next[platform] = value; else delete next[platform];
        patchMetadata({ platformStatuses: next });
      }}
      onNotesChange={(platform: PlatformId, value) =>
        patchMetadata({ platformNotes: { ...node.metadata?.platformNotes, [platform]: value } })
      }
      onScreenshotChange={(platform: PlatformId, value) =>
        patchMetadata({ platformScreenshots: { ...node.metadata?.platformScreenshots, [platform]: value } })
      }
    />
  );
}
```

- [ ] **Step 2: Delete the block it replaces**

Remove the whole `<Field label="Per-platform status"> … </Field>` block from `AcceptanceEditor.tsx`, and the now-unused `PlatformVariants` import and `statuses` local if nothing else in the file uses them (`grep -n "statuses\|PlatformVariants" components/panels/AcceptanceEditor.tsx` — `patchMetadata` stays, the Values picker uses it).

- [ ] **Step 3: Commit**

```bash
git add components/panels/AcceptancePlatformsSection.tsx components/panels/AcceptanceEditor.tsx
git commit -m "refactor(panels): an acceptance's platforms are a section, not a field"
```

---

### Task 10: One Platforms group for three species

**Files:**
- Modify: `components/panels/NodeDetailPanel.tsx` — `PlatformVariantsSection` (`:538`), `ComputedPlatformStatusSection` (`:616`), the body
- Test: `tests/app/panel-semantics.test.js`

- [ ] **Step 1: Write the failing test**

In the section-5 block of `tests/app/panel-semantics.test.js`, append:

```js
// One title across three species: the group is an outline entry, and a reader
// walking an acceptance, a view and a flow should meet one name for one shelf.
const platformTitles = nodePanelGroups
  .map((element) => attr(element.opening, "title"))
  .filter((title) => title !== null && /platform/i.test(title));
assert(
  platformTitles.length > 0 && platformTitles.every((title) => title === "Platforms"),
  "every platform region is titled Platforms",
  `found ${platformTitles.join(", ") || "none"}`,
);
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm run test:panel-semantics`
Expected: FAIL — `every platform region is titled Platforms — found none` (no `PanelGroup` carries a platform title yet).

- [ ] **Step 3: Convert the two existing sections**

In `PlatformVariantsSection`, replace the `<PanelSection title="Platform Variants" className="gap-3">` wrapper and its close with `<PanelGroup title="Platforms">` / `</PanelGroup>`, and wrap the `<PlatformVariants … />` in `<div className={PANEL_GUTTER}>` — the group does not gutter its children, `PanelSection` did.

In `ComputedPlatformStatusSection`, do the same: `<PanelGroup title="Platforms">`, and gutter the `<PlatformGaugeList … />`.

Update the second one's docblock to say why a derived rollup shares the authored editor's title:

```tsx
/**
 * A flow's platform statuses, rolled up from what it plays.
 *
 * Shares the title "Platforms" with the acceptance's and the view's editors,
 * though this one is read-only. The group is an outline entry, and three names
 * for one shelf would make a reader walking three panels learn three words for
 * the same place. That this one is derived is said by its contents — gauges, no
 * controls — rather than by its heading.
 */
```

- [ ] **Step 4: Add the acceptance's**

In `NodeDetailPanel`'s body, in the gapless group column and **above** `RelationsGroup`, add:

```tsx
        {node.species === "acceptance" && onUpdate && (
          <PanelGroup key={`platforms-${node.id}`} title="Platforms">
            <div className={PANEL_GUTTER}>
              <AcceptancePlatformsSection node={node} scope={scope} onUpdate={onUpdate} />
            </div>
          </PanelGroup>
        )}
```

and move the existing `PlatformVariantsSection` (view) and `ComputedPlatformStatusSection` (flow) renders into the same column, also above `RelationsGroup`, keeping their existing `key` and conditions.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test:panel-semantics`
Expected: PASS.

- [ ] **Step 6: Verify in the running app**

Run: `npm run dev`
Expected: on an acceptance, view and flow, the panel now reads PLATFORMS → RELATIONS → HISTORY as three flush bars with single hairlines between them. The view's `initialPlatform` deep link (click a Delivery item) still opens on the right tab — the group is open by default, so nothing is hidden.

- [ ] **Step 7: Lint and commit**

Run: `npm run lint && npx tsc --noEmit`

```bash
git add components/panels/ tests/app/panel-semantics.test.js
git commit -m "feat(panels): one Platforms region, whatever the species"
```

---

### Task 11: Ship Part 3

- [ ] **Step 1: Full gate**

Run: `npm run generate && git diff --exit-code -- lib/wobble/wobble-registry.generated.ts app/wobble.generated.css && npm run lint && npm run test:panel-semantics && npm run test:acceptance-matrix && npm run test:effective-status`
Expected: all exit 0.

- [ ] **Step 2: Stacked PR, with this Lab Note**

```yaml
en:
  title: "Platforms, under one name"
  summary: "Per-platform status now lives in its own foldable section on acceptances, views and flows alike — called the same thing in all three, so you stop relearning where it is."
fr:
  title: "Les plateformes, sous un seul nom"
  summary: "Le statut par plateforme a sa propre section repliable sur les acceptances, les vues et les flows — avec le même nom partout, pour ne plus avoir à le rechercher."
suggested:
  molecule: arkaik
  type: improvement
  tags: [panels, platforms]
```

- [ ] **Step 3:** `gh pr view --comments`

---

# Part 4 — the Playlist group and the intro block

Branch: `panel-intro-block`, stacked on `panel-platforms-group`.

### Task 12: Playlist becomes a group

**Files:**
- Modify: `components/panels/PlaylistEditor.tsx:42-52`
- Modify: `components/panels/NodeDetailPanel.tsx` (move the render into the group column)

- [ ] **Step 1: Swap the wrapper**

In `PlaylistEditor.tsx`, replace the `PanelSection` import with `PanelGroup` and `PANEL_GUTTER`, then:

```tsx
  return (
    <PanelGroup title="Playlist">
      <div className={PANEL_GUTTER}>
        <PlaylistEntryList
          entries={entries}
          onChange={persistEntries}
          flowNodeId={node.id}
          allNodes={allNodes}
          onCycleBlocked={handleCycleBlocked}
          onCreateNode={onCreateNode}
        />
      </div>
    </PanelGroup>
  );
```

- [ ] **Step 2: Move its render**

In `NodeDetailPanel`'s body, move the `{node.species === "flow" && allNodes && (<PlaylistEditor … />)}` block into the gapless group column, **between `RelationsGroup` and `HistorySection`**.

That ordering is the spec's and the original request's — Platforms, Relations, Playlist, History. An earlier draft of this plan said "between the Platforms renders and `RelationsGroup`", which is a different order and wrong; the spec's per-species table is the authority. On a flow the finished column therefore reads PLATFORMS → RELATIONS → PLAYLIST → HISTORY.

- [ ] **Step 3: Verify**

Run: `npm run dev`, open a flow.
Expected: PLATFORMS → RELATIONS → PLAYLIST → HISTORY. Drag-reordering a playlist entry still works inside the open group.

- [ ] **Step 4: Commit**

```bash
git add components/panels/PlaylistEditor.tsx components/panels/NodeDetailPanel.tsx
git commit -m "feat(panels): the playlist is a region you can shut"
```

---

### Task 13: The intro block takes its final order

`AcceptanceEditor` is now Status, Product, Gherkin, Values and the split dialog. Those four fields belong in the intro block beside `NodeFields`' own, in the spec's order: title, description, Status, Product, Blocked by, then the species' authored fields.

**Files:**
- Modify: `components/panels/AcceptanceEditor.tsx`
- Modify: `components/panels/NodeDetailPanel.tsx` — `NodeFields` (`:94-209`), the body

- [ ] **Step 1: Give `NodeFields` the acceptance's Status**

`NodeFields` currently shows a Status select only for `data-model` and `api-endpoint` (`usesSingleStatusField`, `:113`), because the acceptance got its own from `AcceptanceEditor`. Now that the acceptance's belongs here too, widen it:

```tsx
  // Views and flows are absent on purpose: they have no single status. Theirs is
  // per-platform and lives in the Platforms group, and a select here would be a
  // second answer to a question the rollup already answers.
  const usesSingleStatusField =
    node.species === "data-model" ||
    node.species === "api-endpoint" ||
    node.species === "acceptance";
```

`NodeFields` holds `status` in local state and saves through `handleStatusChange` (`:143`). Read that handler before relying on it — if it patches `{ status }` directly it is already correct for an acceptance, and `AcceptanceEditor`'s own select can simply be deleted. Delete it, along with the `StatusSelectItems`, `Select*` and `StatusId` imports if nothing else in that file uses them.

- [ ] **Step 2: Reorder `NodeFields`' body**

The spec's order is Status, Product, Blocked by, then the species' authored fields — so the Product picker lands *between* two things `NodeFields` already renders. That is two slots, not one, which is why these are named props and not `children`. Add to `NodeFieldsProps`:

```tsx
  /**
   * Species-specific intro fields, in the two places a species needs one.
   *
   * They sit in the intro block rather than in a group because they are what the
   * record *is*, not what it is attached to; they were only ever in a separate
   * component because that component also held four sections that have since
   * moved out to Relations and Platforms.
   */
  /** Between Status and Blocked by — the Product picker. */
  membership?: ReactNode;
  /** After Blocked by — the species' own authored fields (Gherkin, Values). */
  authored?: ReactNode;
```

and in the body:

```tsx
      {usesSingleStatusField && (
        <Field label="Status" htmlFor={`${fieldId}-status`}>
          {/* unchanged */}
        </Field>
      )}
      {membership}
      {node.species !== "decision" && (
        <BlockedByField node={node} onUpdate={onUpdate} allNodes={allNodes} onNavigate={onNavigate} />
      )}
      {authored}
```

- [ ] **Step 3: Reduce `AcceptanceEditor` to two exports**

`AcceptanceEditor` becomes two small components — `AcceptanceMembershipField` (the `ProductPicker` block with its whole `anchorCount` / `derivedLabels` / `staleProductId` derivation and every one of its comments preserved verbatim) and `AcceptanceAuthoredFields` (the Gherkin textarea with its debounce effect, and the Values picker). The split dialog is gone from this file in Part 5; until then, leave the `Decompose` field where it is, at the end of `AcceptanceAuthoredFields`.

Keep `CoversSection` (Part 2) in the file. Do not delete a single explanatory comment in the moves — the § D5 derivation reasoning and the `htmlFor`/`shadcn-4` note are the record of two decisions, not commentary.

- [ ] **Step 4: Wire the panel body**

```tsx
      <NodeFields
        key={node.id}
        node={node}
        onUpdate={onUpdate}
        allNodes={allNodes}
        onNavigate={onNavigate}
        membership={
          node.species === "acceptance" && allNodes && allEdges && onUpdate ? (
            <AcceptanceMembershipField node={node} scope={scope} allNodes={allNodes} allEdges={allEdges} onUpdate={onUpdate} />
          ) : undefined
        }
        authored={
          node.species === "acceptance" && onUpdate ? (
            <AcceptanceAuthoredFields node={node} onUpdate={onUpdate} intake={intake} />
          ) : undefined
        }
      />
```

and delete the standalone `<AcceptanceEditor … />` render.

- [ ] **Step 5: Verify the order in the running app**

Run: `npm run dev`, open an acceptance in a project that declares products.
Expected, top to bottom: title, description, STATUS, PRODUCT (+ its hint), BLOCKED BY, GHERKIN, VALUES, DECOMPOSE — then the PLATFORMS, RELATIONS and HISTORY bars. In a project with no products, PRODUCT is absent entirely and everything else is unchanged.

- [ ] **Step 6: Lint, typecheck, test, commit**

Run: `npm run lint && npx tsc --noEmit && npm run test:panel-semantics && npm run test:acceptance-intake && npm run test:product-scope && npm run test:product-editing`

```bash
git add components/panels/
git commit -m "feat(panels): an acceptance reads in the order you write one"
```

---

### Task 13a: The decision's links join Relations

The spec's Part 2 table lists a decision's four link lists inside Relations.
Part 2 did not move them — the plan's Task 7 omitted them, so the
implementation was plan-faithful and spec-incomplete. This is where that is
paid, and it is the same extraction `CoversSection` already went through.

**Files:**
- Modify: `components/panels/DecisionEditor.tsx:233` (the `<Field label="Decision links">` block)
- Modify: `components/panels/NodeRelationSections.tsx`
- Modify: `components/panels/RelationsGroup.tsx`

- [ ] **Step 1: Extract `DecisionLinksSection`**

Cut the whole `<Field label="Decision links" className="gap-3"> … </Field>`
block out of `DecisionEditor.tsx` into an exported `DecisionLinksSection` in
`NodeRelationSections.tsx` — not in `DecisionEditor.tsx`, for the reason Part 2
learned the hard way: `RelationsGroup` importing from a panel-body editor is a
cycle waiting for one import, and every relation section now lives in one place.

It becomes a `PanelSection title="Decision links"` rather than a `Field`, because
inside a group it is a level-four section with a heading, not a labelled control.
Carry its props (whatever the block reads — the node, `allNodes`, `allEdges`,
`onNavigate`) and every comment with it.

- [ ] **Step 2: Render it first among a decision's relations**

In `RelationsGroup`, add `hasDecisionLinks` and render `DecisionLinksSection`
ahead of References, matching the spec's order (its four link lists · References
· Findings · Connections).

Follow the rule the other flags now follow: if the section always renders
something — check whether it has an empty-state sentence the way `CoversSection`
and `AcceptancesSection` do — the flag asks only whether it can render at all.
If it genuinely returns `null` when there are no links, the flag asks for
content. Read the block before deciding, and say which it was.

The flag must include every prop the render guard requires. `hasInvocation`
shipped in Part 2 missing `onNavigate` from its flag while its guard required it,
which could open an empty bar; do not repeat it.

- [ ] **Step 3: Verify**

`ConnectionsSection` deliberately excludes a decision's own decision-typed edges
because `DecisionEditor` already listed both directions. That reasoning now lives
in `crossLayerConnections`' docblock in `lib/utils/where-used.ts` and still
holds — the lists moved, they did not disappear — but **confirm on screen** that
a decision panel does not now list the same edge twice, once under Decision links
and once under Connections.

- [ ] **Step 4: Gates and commit**

`npm run lint`, `npx tsc --noEmit`, `npm run test:panel-semantics`,
`npm run test:decision-utils`.

Commit: `feat(panels): a decision's links are relations too`

---

### Task 14: Ship Part 4

- [ ] **Step 1: Full gate** — same command set as Task 11, plus `npm run test:product-editing`.

- [ ] **Step 2: Stacked PR, with this Lab Note**

```yaml
en:
  title: "An acceptance reads in the order you write one"
  summary: "Name, status, what blocks it, then the Given/When/Then and the values it serves — the acceptance panel now runs in the order you'd actually think one through, with everything else folded into sections below."
fr:
  title: "Une acceptance se lit dans l'ordre où tu l'écris"
  summary: "Le nom, le statut, ce qui la bloque, puis le Given/When/Then et les valeurs qu'elle sert : le panneau suit enfin l'ordre dans lequel tu la penses, le reste étant replié en sections."
suggested:
  molecule: arkaik
  type: improvement
  tags: [panels, acceptances]
```

- [ ] **Step 3:** `gh pr view --comments`

---

# Part 5 — the header menu

Branch: `panel-header-menu`, stacked on `panel-intro-block`. Independent of Parts 2–4 in substance; last because it touches the data layer.

### Task 15: `duplicateNodeDraft`

**Files:**
- Create: `lib/utils/node-duplicate.ts`
- Test: `tests/app/acceptance-intake.test.js`

- [ ] **Step 1: Write the failing test**

`tests/app/acceptance-intake.test.js` loads through `tests/app/load-panel-utils.js`'s generic `loadUtil`. Add to its requires:

```js
const { loadUtil } = require("./load-panel-utils");
const { duplicateNodeDraft } = loadUtil("node-duplicate");
```

and append, before the file's failure-count block:

```js
// --- duplicateNodeDraft -----------------------------------------------------

{
  const original = {
    id: "AC-login-fails",
    project_id: "p1",
    species: "acceptance",
    title: "Login fails loudly",
    description: "A wrong password says so",
    status: "done",
    platforms: ["web"],
    metadata: { gherkin: "When …, Then …", values: ["trust"], product: "app" },
  };

  const copy = duplicateNodeDraft(original, "AC-login-fails-2");

  assert(copy.id === "AC-login-fails-2", "the copy takes the id it was given");
  assert(copy.title === "Login fails loudly (copy)", `the title is marked (got ${copy.title})`);
  assert(copy.project_id === "p1", "the copy stays in the project");
  assert(copy.species === "acceptance", "the copy keeps its species");
  assert(copy.status === "done", "the copy keeps its status");
  assert(copy.description === "A wrong password says so", "the copy keeps its description");
  assert(copy.metadata.gherkin === "When …, Then …", "the copy keeps its metadata");

  // The deep copy is the point: the panel patches metadata by spreading it, and
  // a shared array would let an edit to the copy's values rewrite the original's.
  copy.metadata.values.push("speed");
  assert(
    original.metadata.values.length === 1,
    "the copy's metadata is its own — editing it does not reach the original",
  );

  const untitled = duplicateNodeDraft({ ...original, title: "" }, "AC-x");
  assert(untitled.title === "(copy)", `an empty title still marks (got "${untitled.title}")`);
}
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm run test:acceptance-intake`
Expected: FAIL — `Cannot find module` for `node-duplicate`, from `loadUtil`.

- [ ] **Step 3: Implement it**

```ts
import type { Node } from "@/lib/data/types";

/**
 * A new node carrying everything this one says about itself, under a new id.
 *
 * **It copies no edges**, and the caller writes none. A duplicated acceptance
 * therefore covers nothing and lands unanchored in intake, which is the honest
 * state for a record whose anchors have not been chosen — and the panel the copy
 * opens into is the one place to choose them. Copying the `covers` edges would
 * assert that the copy belongs exactly where the original does, which is the one
 * thing "duplicate this" cannot know.
 *
 * `structuredClone` on the metadata, not a spread: the panel patches metadata by
 * spreading it and every value editor writes arrays in place, so a shallow copy
 * would leave the two nodes sharing a `values` array and let an edit to one
 * silently rewrite the other.
 *
 * The id is a parameter rather than minted here. Minting needs
 * `generateNodeId`, which imports `@arkaik/schema`, and this module is loaded in
 * tests by `loadUtil` — which rewrites nothing, so a value import here would
 * fail at `require` with a resolution error pointing nowhere near the cause. The
 * caller has the existing ids anyway; it is the only one that does.
 */
export function duplicateNodeDraft(node: Node, newId: string): Node {
  return {
    ...node,
    id: newId,
    title: `${node.title} (copy)`.trim(),
    metadata: node.metadata ? structuredClone(node.metadata) : node.metadata,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:acceptance-intake`
Expected: PASS on all nine new checks. If `loadUtil` throws on the `@/lib/data/types` import, confirm it is `import type` — a plain `import` would not transpile away.

- [ ] **Step 5: Commit**

```bash
git add lib/utils/node-duplicate.ts tests/app/acceptance-intake.test.js
git commit -m "feat(graph): a node's copy, under a new id and attached to nothing"
```

---

### Task 16: The `onDuplicate` path

**Files:**
- Modify: `components/layout/PageShell.tsx:45` (beside `onDelete`)
- Modify: `components/panels/ProjectPanels.tsx:51,111,309`
- Modify: `components/panels/NodeDetailPanel.tsx:58`
- Modify: whichever page owns node creation — find it with `grep -rn "onCreateNode=" app components | grep -v node_modules`

- [ ] **Step 1: Add the prop to the three panel layers**

In `NodeDetailPanelProps`, `ProjectPanelsProps` and `PageShellProps`, beside the existing `onDelete`:

```tsx
  /**
   * Duplicate this node and open the copy. Absent on read-only surfaces, which
   * is what hides the menu item — see `duplicateNodeDraft` for what a copy is
   * and, more to the point, what it is not (it carries no edges).
   */
  onDuplicate?: (node: Node) => Promise<void> | void;
```

Thread it through `ProjectPanels`' destructuring and down to `<NodeDetailPanel … onDuplicate={onDuplicate} />` at `:309`.

- [ ] **Step 2: Implement it at the page level**

In the same place `onCreateNode` is implemented, add:

```tsx
  const handleDuplicate = useCallback(
    async (node: Node) => {
      const newId = generateNodeId(node.species, node.title, nodes.map((n) => n.id));
      try {
        const created = await addNode(duplicateNodeDraft(node, newId));
        toast.success(`Duplicated as "${created.title}".`);
        openNode({ nodeId: created.id });
      } catch (err) {
        toast.error("Couldn't duplicate that node.");
        console.error(err);
      }
    },
    [nodes, addNode, openNode],
  );
```

Read the surrounding file first: `addNode` comes from `useNodes`, `openNode` from the panel hook, and both may be named differently at that call site. Match what is there. `generateNodeId` already disambiguates against existing ids with `-2`, `-3`, … suffixes, which is exactly what a second duplicate needs.

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit && npm run lint`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add components/layout/PageShell.tsx components/panels/ProjectPanels.tsx components/panels/NodeDetailPanel.tsx app/
git commit -m "feat(panels): the path a duplicated node takes to the page"
```

---

### Task 17: The menu

**Files:**
- Modify: `components/panels/NodeDetailPanel.tsx` — `NodeDetailPanelHeader` (`:644`)
- Modify: `components/panels/ProjectPanels.tsx` — the `renderHeader` call
- Modify: `components/panels/AcceptanceEditor.tsx` — remove the Decompose field
- Test: `tests/app/panel-semantics.test.js`

- [ ] **Step 1: Write the failing test**

Append to the section-5 block:

```js
// The menu is the record's, not the stack's — the close button belongs to
// PanelStack and this must not end up beside it in that file.
const stackSource = fs.readFileSync(path.join(PANELS_DIR, "PanelStack.tsx"), "utf8");
assert(
  !stackSource.includes("DropdownMenu"),
  "PanelStack does not grow a per-record menu — it owns the frame, not the record",
);

const headerSource = fs.readFileSync(path.join(PANELS_DIR, "NodeDetailPanel.tsx"), "utf8");
assert(
  headerSource.includes("DropdownMenu"),
  "the node panel's header carries the record's own menu",
);
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm run test:panel-semantics`
Expected: FAIL — `the node panel's header carries the record's own menu`.

- [ ] **Step 3: Rewrite the header**

```tsx
interface NodeDetailPanelHeaderProps {
  node: Node;
  onDuplicate?: (node: Node) => Promise<void> | void;
  onDelete?: (nodeId: string) => void;
  /** Present only on a writable surface with an acceptance open. */
  onSplit?: () => void;
}

/**
 * What identifies the panel, for the stack's per-panel header — species badge,
 * entity id, and the record's own menu. The close button belongs to
 * `PanelStack`, which owns every panel's frame; this menu does not, because
 * every item on it acts on the record rather than on the column.
 *
 * **No button when no item applies.** A published panel passes neither
 * `onDuplicate` nor `onDelete`, and a menu that opened onto nothing — or onto
 * three disabled rows — would be chrome advertising capabilities the surface
 * does not have.
 */
export function NodeDetailPanelHeader({ node, onDuplicate, onDelete, onSplit }: NodeDetailPanelHeaderProps) {
  const speciesConfig = SPECIES.find((s) => s.id === node.species);
  const speciesLabel = speciesConfig?.label ?? node.species;
  const hasMenu = Boolean(onDuplicate || onDelete || onSplit);

  return (
    <>
      <SpeciesBadge
        species={node.species}
        label={speciesLabel}
        description={speciesConfig?.description}
        showLabel
      />
      <PanelHeaderEntityId id={node.id} />
      {hasMenu && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="ml-auto size-7 shrink-0"
              aria-label={`Actions for ${node.title}`}
            >
              <MoreHorizontalIcon className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {onDuplicate && (
              <DropdownMenuItem onSelect={() => void onDuplicate(node)}>
                <CopyPlusIcon className="size-4" /> Duplicate
              </DropdownMenuItem>
            )}
            {onSplit && (
              // Decompose is an operation on the record, not a field of it. As a
              // `Field` labelled "Decompose" with a hint sentence it was spending
              // a section's worth of panel on one button.
              <DropdownMenuItem onSelect={onSplit}>
                <SplitIcon className="size-4" /> Split into several…
              </DropdownMenuItem>
            )}
            {onDelete && (
              <DropdownMenuItem variant="destructive" onSelect={() => onDelete(node.id)}>
                <Trash2Icon className="size-4" /> Delete
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </>
  );
}
```

Add to the imports: `CopyPlusIcon, MoreHorizontalIcon, SplitIcon, Trash2Icon` from `lucide-react`, `Button` from `@/components/ui/button`, and the four `DropdownMenu*` from `@/components/ui/dropdown-menu`. Check that `DropdownMenuItem` in this repo's copy supports `variant="destructive"` (`grep -n "destructive" components/ui/dropdown-menu.tsx`); if it does not, use `className="text-destructive focus:text-destructive"` instead.

- [ ] **Step 4: Move the split dialog**

The trigger is now in the header and the dialog is in the body, and `PanelStack` renders those through two separate render props — so neither half can hold the state. `ProjectPanels` owns it, because it is the one component that renders both.

```tsx
const [splitTarget, setSplitTarget] = useState<Node | null>(null);
```

`renderHeader` passes `onSplit={intake && node.species === "acceptance" ? () => setSplitTarget(node) : undefined}`, and `ProjectPanels` renders one `SplitAcceptanceDialog` outside the stack, driven by `splitTarget`. One dialog for the whole stack rather than one per panel, which is also what stops two open acceptance panels from mounting two.

Then delete the `Decompose` `Field`, the `splitOpen` state and the `SplitAcceptanceDialog` render from `AcceptanceEditor`/`AcceptanceAuthoredFields`, keeping the `onSubmit` error handling verbatim in its new home.

- [ ] **Step 5: Run the test and check the app**

Run: `npm run test:panel-semantics && npm run lint && npx tsc --noEmit`

Run: `npm run dev`
Expected: a `⋯` button in the panel header, left of the close button. On an acceptance in an editable project: Duplicate / Split into several… / Delete. On a data model: Duplicate / Delete. On a published (read-only) surface: no button at all. Duplicate opens the copy in a new panel, titled `… (copy)`, covering nothing.

- [ ] **Step 6: Regenerate — four new icons**

Run: `npm run generate && git status --short`
Expected: a diff in the wobble registry and CSS. Commit it.

- [ ] **Step 7: Commit**

```bash
git add components/panels/ tests/app/panel-semantics.test.js lib/wobble app/wobble.generated.css
git commit -m "feat(panels): the things you do to a record, in the record's own menu"
```

---

### Task 18: Ship Part 5

- [ ] **Step 1: Full gate**

Run: `npm run generate && git diff --exit-code -- lib/wobble/wobble-registry.generated.ts app/wobble.generated.css && npm run lint && npx tsc --noEmit && npm run test:panel-semantics && npm run test:panel-stack && npm run test:project-panels && npm run test:acceptance-intake && npm run test:quality-page`
Expected: all exit 0.

- [ ] **Step 2: Stacked PR, with this Lab Note**

```yaml
en:
  title: "Duplicate, split, delete — from the panel itself"
  summary: "Every panel now has a menu next to its close button: duplicate what you're looking at, split an acceptance that has grown into several, or delete it, without hunting for the gesture somewhere else."
fr:
  title: "Dupliquer, scinder, supprimer — depuis le panneau"
  summary: "Chaque panneau a maintenant un menu à côté du bouton de fermeture : duplique ce que tu regardes, scinde une acceptance devenue trop large, ou supprime-la, sans chercher le geste ailleurs."
suggested:
  molecule: arkaik
  type: feature
  tags: [panels]
```

- [ ] **Step 3:** `gh pr view --comments`

- [ ] **Step 4: Merge the stack** — use the `gh-stack` skill; land bottom-up.

---

## Spec coverage

| Spec section | Task |
|---|---|
| Part 1 — `PanelGroup`, full-bleed bar, `-mt-px`, `h3` disclosure | 2 |
| Part 1 — `PanelSection` demotes to `h4` via context | 1, 3 |
| Part 1 — no persistence | 2 (docblock states it; nothing stores) |
| Part 1 — History collapsed on every species | 4 |
| Part 2 — Relations per-species ordering table | 7 |
| Part 2 — empty group renders nothing | 7 (the `hasX` emptiness test) |
| Part 2 — findings chip in the `meta` slot | 6, 7 |
| Part 2 — Acceptances create action stays on its section | 7 (`AcceptancesSection` unchanged) |
| Part 3 — one "Platforms" title across three species | 9, 10 |
| Part 4 — Playlist group | 12 |
| Part 2 — decision link lists inside Relations | 13a (deferred from Part 2; see the task) |
| Part 4 — intro block order, Status rule, Product placement | 13 |
| Part 4 — `AcceptanceEditor` dismantled | 7 (Covers), 9 (Platforms), 13 (the rest) |
| Part 5 — Duplicate, no edges copied | 15, 16, 17 |
| Part 5 — Split moved to the menu | 17 |
| Part 5 — Delete uses the discarded `onDelete` | 17 |
| Part 5 — no button when no item applies | 17 (`hasMenu`) |
| Shipping — five branches, five PRs, `gh stack`, a Lab Note each | 5, 8, 11, 14, 18 |
| Verification — lint, regenerate, per-species visual check, heading list | every "full gate" step |
