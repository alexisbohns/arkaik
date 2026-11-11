# Screens map — Part 5: views and flows in ⌘K — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Typing a view or flow name in ⌘K finds it. Flows and views are search-only rows (never on the idle palette), ranked below a page of the same shape, at most six per group. Choosing one flies the Screens map to its strip or frame, opens its panel in place on every page that hosts panels, and lands on the Library with its panel open from Overview and Settings.

**Architecture:** The palette brain (`lib/utils/command-palette.ts`, import-free) gains two groups, a `node` target, a `searchOnly` flag with `NODE_PENALTY`, a per-group cap (`limitSearchOnly`), and two builders (`summarizePaletteNodes` walks playlists structurally; `buildNodeCommands` makes the rows). The overlay applies the cap after ranking and hands a node target to a new optional `onNode` prop. `usePageCommands.tsx` gains a page node handler beside the page actions. The project layout lists the scope's flows and views and routes a chosen node: the page's handler, else the Library on Overview and Settings, else `openNode`. The Screens map registers a handler that reuses part 2's strip jump and part 4's frame selection.

**Tech Stack:** TypeScript, React 19 with the React Compiler lint rules, Next.js App Router, TanStack Query (the cached bundle), plain Node test scripts with `ts.transpileModule` loaders.

**Spec:** `docs/superpowers/specs/2026-11-11-screens-map-design.md` (§ The palette change (part 5), § F7)

**Contract:** `docs/superpowers/plans/2026-11-11-screens-map-stack.md` (§ Part 5 — palette nodes; it wins over the spec)

**Branch:** `feat/screens-palette`, created with the `gh-stack` skill on top of `feat/screens-inspect`.

**Position in the stack:** part 5 of 5, the top. Parts 1–4 (`feat/screens-model`, `feat/screens-map`, `feat/screens-side-gaps`, `feat/screens-inspect`) are below it. This part calls `frameIdsOf` (part 1), `ScreensMap` and its `wall`, `layout`, `openNode` (part 2) and the selection (part 4); it redefines none of them, and touches neither the wall model (`lib/utils/screen-wall*.ts`), `Canvas.tsx` nor `packages/**`.

---

## Contract deviations

One, and it adds names only.

1. **Two controller functions in `components/maps/ScreensMap.tsx` are named.** The contract fixes what the Screens map's node handler does ("a flow with a strip → camera to `stripIdOf(flowId)`'s rect + ring; a view with frames → select `frameIdsOf(wall, id)[0]` and frame it") but names none of the controller locals that do it, and part 5 may only add the handler to that file. Rewriting the camera and selection maths in the handler would duplicate part 2's jump and part 4's selection framing (frame box plus chip column) in a second place. So this plan calls two functions the controller already needs, under fixed names:
   - `jumpToFlow(flowId: string): void` — part 2's jump-tile behaviour: one camera request for `layout.strips.get(stripIdOf(flowId))` with `minZoom` 0.4 and `maxZoom` 1, and a `ring` bump for that strip.
   - `selectFrame(frameId: string, viewId: string, stripId: string): void` — part 4's first activation: sets `selection` to `{ frameId, viewId, stripId }` and issues the selection camera request (`minZoom` 0.6, `maxZoom` 1). It never opens a panel, even when that frame is already selected (the panel-on-second-activation branch stays in the frame's activation handler).

   Both are `useCallback`s declared before the controller's first early return. The contract should carry these two names in § "Controller rules fixed here because parts 3–5 extend them" (part 2 owns the first, part 4 the second). If they are absent when this plan runs, Task 5 Step 1 extracts them in the parts that own them, as `docs/conventions.md` § Shipping larger work requires (never patched from the top).

### Decisions taken inside the contract (not deviations)

- `summarizePaletteNodes` counts a flow's screens over views present in its input, so a dangling or out-of-scope `view_id` counts nothing (the wall skips such entries too). A blank title falls back to the id, so no row is blank. Rows are flows first, then views, each in snapshot order (the tie-break order after score and label length).
- `PaletteNodeInput` and `PaletteNodeSummary` are module-private interfaces; the exported signatures are exactly the contract's (`buildNodeCommands(input: ReturnType<typeof summarizePaletteNodes>)`).
- The layout always passes `[...pageCommands, ...commands, ...nodeCommands]` (the `pageCommands.length > 0` shortcut goes). That array is rebuilt on each `ProjectChrome` render, as the page-commands branch already was; ranking about 100 rows per keystroke is the cost the spec accepts.
- On Screens, a flow is matched through `wall.strips.find((strip) => strip.flowId === nodeId)` rather than `layout.strips.has(stripIdOf(nodeId))` alone: the loose strip is `strip:loose`, so a node whose id is `loose` must not fly there.

---

## File map

- Modify `lib/utils/command-palette.ts` — groups `flows`/`views`, `searchOnly`, `NODE_PENALTY`, `SEARCH_ONLY_PER_GROUP`, the idle filter and penalty in `rankCommands`, `limitSearchOnly` (Task 1); the `node` target, `summarizePaletteNodes`, `buildNodeCommands` (Task 2). Stays import-free.
- Modify `tests/app/command-palette.test.js` — block A (Task 1) and block B (Task 2), both inserted above the final `fs.rmSync(BUILD_DIR, …)` line. Its loader `tests/app/load-command-palette.js` is unchanged.
- Modify `components/layout/CommandPalette.tsx` — `onNode` prop, the `node` branch in `runCommand`, the cap after ranking (Task 2).
- Modify `lib/hooks/usePageCommands.tsx` — `PageNodeHandler`, `usePageNodeHandler`, the provider's second render-prop argument (Task 3).
- Modify `app/project/[id]/layout.tsx` — node rows from `useNodes` + `useEffectiveProduct`, and `goToNode` routing (Task 4).
- Modify `components/maps/ScreensMap.tsx` — two imports and the `usePageNodeHandler` call only (Task 5).
- `package.json`: no change. `test:command-palette` (`package.json:52`) and `test:keyboard-shortcuts` (`:51`) exist.
- `.github/workflows/ci.yml`: no change. "Command palette ranking tests" (`ci.yml:245-246`) and the keyboard-shortcut step (`:273`) already run both suites on Node 20.
- `.gitignore`: no change. The suite deletes `tests/app/.test-build-command-palette/` on success; a failing run leaves it untracked — delete it before reading `git status`.
- Generated artifacts: none. No new lucide name is imported (`flows` and `views` already have glyphs in `COMMAND_ICONS`), so `npm run generate` must leave the tree clean.

---

## Ranking: what changes and what is pinned

Scores, from `command-palette.ts`: exact 10000, prefix `8000 − remainder`, word prefix `6000 − start`, substring `4000 − at`, subsequence `2000 − span`; a keyword hit is 1000 lower than the same-shaped label hit; a search-only row is a further `NODE_PENALTY` (500) lower. Ties: shorter label, then catalogue order (catalogue, then flows, then views, as the layout composes them). An empty or blank query returns the catalogue minus every search-only row. The overlay then keeps at most six search-only rows per group (`limitSearchOnly`), in ranked order, and every non-search-only row.

**Existing assertions: none changes in part 5.** Every assertion in `tests/app/command-palette.test.js` up to the docs catalogue ranks `buildProjectCommands(…)` alone, which has no search-only row, so its ranks, highlights, completions and idle order are untouched. `COMMAND_GROUPS` grows by two, which keeps "every command belongs to a declared group" true. Part 2 already moved the three synonym probes the spec named (`:97`, `:126-130`, `:136-139`) from `"screens"`/`"screen"` to `"pages"`/`"page"`; this part keeps them and pins, below, that they still hold with node rows present (`"pages"` and `"page"` rows). Two first rows change **in the real palette only**, by the contract's rule that an exact node title (9500) beats a page prefix (≤ 8000) and a page's exact keyword (9000): `"onboarding"` leads with the Onboarding flow over the custom map "Onboarding audit" (the existing assertion still holds on the catalogue alone), and `"home"` leads with the Home view over Overview (no existing assertion pins `"home"`).

**Pinned against the Pebbles seed** (All products: 10 flows + 58 views = 68 rows, the spec's count; the self-map gives 73), with the test's catalogue: `buildProjectCommands({ projectId: "proj-1", customMaps: [{ id: "onboarding", title: "Onboarding audit" }] })` as it stands after part 2 (including `map-screens`). Order is what `limitSearchOnly(rankCommands(…))` returns; the overlay draws the same rows, sectioned by group in order of each group's best row.

| Query | Expected rows, in order — label (group, score) | What it pins |
|---|---|---|
| `settings` | Settings (project, 10000) · Settings (views, 9500) | A page beats a node title of the same shape. |
| `home` | Home (views, 9500) · Overview (project, 9000) · All projects (actions, 9000) · Onboarding — Drop a pebble, keep the moment (views, 1494) | An exact node title beats a page's exact keyword. |
| `onboarding` | Onboarding (flows, 9500) · Onboarding audit (maps, 7994) · Onboarding — Get your pebble (views, 7482) · Onboarding — Qualify and relate (views, 7479) · Onboarding — Your life is a path (views, 7478) · Onboarding — Drop a pebble, keep the moment (views, 7467) | An exact node title beats a page's prefix. |
| `onboard` | Onboarding audit (maps, 7991) · Onboarding (flows, 7497) · Onboarding — Get your pebble (views, 7479) · Onboarding — Qualify and relate (views, 7476) · Onboarding — Your life is a path (views, 7475) · Onboarding — Drop a pebble, keep the moment (views, 7464) | Prefix against prefix, the page leads. |
| `path` | Path (views, 9500) · Onboarding — Your life is a path (views, 5472) · Onboarding — Drop a pebble, keep the moment (views, 1482) · Attach Glyph (views, 492) | A title the catalogue does not have. |
| `V-timeline` | Path (views, 8500) | An id finds its node (exact keyword). |
| `F-onboarding` | Onboarding (flows, 8500) | Same, for a flow. |
| `record` | Record Pebble (flows, 7493) · Record Pebble (views, 7493) · Record Celebration (views, 7488) | Equal scores and lengths: flows before views. |
| `docs` | Documentation (actions, 9000) · Docs Page (views, 7495) · Docs Index (views, 7494) · Legal Notice (views, 4498) · Privacy Policy (views, 4498) · Terms of Service (views, 4498) · Keyboard shortcuts (actions, 1990) | A page's exact keyword beats node prefixes; ids are keywords with word starts (`V-docs-legal-notice` → "docs" at 2). |
| `set` | Settings (project, 7995) · Settings (views, 7495) · Set Intensity & Valence (views, 7480) · Legal Consent (flows, 1497) · Mechanic Sheet (views, 1496) · Soul Detail (views, 1493) · Shape Emotion Pearl (views, 1491) · Souls Directory (views, 1489) · Keyboard shortcuts (actions, 996) · Findings (project, 994) · Screens (maps, 991) · All projects (actions, 987) | Nine views match, six are kept (Edit Soul, Add Soul, Legal Notice dropped); every page kept. |
| `glyph` | Glyphs (views, 7499) · Glyph Detail (views, 7493) · Glyph Swap Drawer (views, 7488) · Swap Glyph (flows, 5495) · Carve Glyph (views, 5494) · Attach Glyph (views, 5493) · Manage Glyphs (flows, 5493) · Admin · Glyph moderation (views, 5492) | Seven views match, six kept (Admin · Upload glyph dropped); the flows group is whole. |
| `acc` | Acceptances (library, 7992) · Agent tokens (actions, 6996) · Privacy Policy (views, 1492) · Create Collection (views, 1491) · Manage Collections (flows, 1489) · System (maps, 993) · Onboarding — Drop a pebble, keep the moment (views, 490) | Existing probe: first row unchanged. |
| `jour` | Journey (maps, 7997) · Changelog (project, 6997) · Flows (library, 6996) | Existing probe: no node row. |
| `deliv` | Delivery (project, 7997) | Existing probe. |
| `Journey` | Journey (maps, 10000) · Flows (library, 6999) | Existing probe. |
| `views` | Views (library, 10000) · All maps (maps, 6987) | Existing probe. |
| `screens` | Screens (maps, 10000) · Views (library, 9000) | Part 2's probe. |
| `pages` | Views (library, 9000) | Part 2's moved probe: still keyword-only, still highlights nothing. |
| `page` | Views (library, 6999) · Docs Page (views, 5495) | Part 2's moved completion probe: Views stays first, so Tab still completes "s". |
| `kanban` | Delivery (project, 9000) | Existing probe. |
| `dark mode` | Toggle theme (actions, 9000) | Existing probe. |
| `chang` | Changelog (project, 7996) | Existing probe. |
| `cept` | Acceptances (library, 3998) · Onboarding — Drop a pebble, keep the moment (views, 2484) | Existing highlight probe: first row unchanged. |
| `dmo` | Data Models (library, 1994) · Documentation (actions, 1989) · Admin · Domains (views, 1492) · Admin · Upload glyph (views, 1490) · Admin · Glyph moderation (views, 1486) · Onboarding — Drop a pebble, keep the moment (views, 1468) · System (maps, 994) · Toggle theme (actions, 994) | Existing subsequence probe: first row unchanged. |
| `zzzqq` | (no row) | Still nothing. |

The `screens`, `set` (Screens at 991, through the keyword "screenshots") and `pages` rows depend on part 2's `map-screens` entry being exactly the contract's (§ Part 2 — palette command). If they fail on that alone, the fix belongs in part 2, not in this table.

---

### Task 1: Search-only ranking and the per-group cap

Brain only. No union is widened here (`CommandGroupId` is not a closed record anywhere), so `tsc` stays green without the overlay.

**Files:**
- Modify: `lib/utils/command-palette.ts`
- Test: `tests/app/command-palette.test.js`

**Trap:** `command-palette.ts` must stay import-free — its loader transpiles the single file (`tests/app/load-command-palette.js:19-31`), and CI runs Node 20 (no `Object.groupBy`, `Map.groupBy` or new `Set` methods). Check in Step 4.

- [ ] **Step 1: Write the failing test (block A)**

In `tests/app/command-palette.test.js`, insert this block immediately above the line `fs.rmSync(BUILD_DIR, { recursive: true, force: true });` (the third line from the end):

```js
// --- search-only rows: ranking and the per-group cap (Screens map stack, part 5) ---
// Read off the module the loader already required at the top of this file: the
// require cache holds it, so this is the same instance, not a second build.
const nodePath = require("path");
const nodePalette = require(nodePath.join(BUILD_DIR, "command-palette.js"));
const { limitSearchOnly, NODE_PENALTY, SEARCH_ONLY_PER_GROUP } = nodePalette;

assert(NODE_PENALTY === 500, `NODE_PENALTY is 500 (got ${NODE_PENALTY})`);
assert(SEARCH_ONLY_PER_GROUP === 6, `SEARCH_ONLY_PER_GROUP is 6 (got ${SEARCH_ONLY_PER_GROUP})`);
assert(
  COMMAND_GROUPS.map((group) => group.id).join(",") === "create,pages,maps,flows,views,library,project,actions",
  `Flows and Views sit right after Maps (got ${COMMAND_GROUPS.map((group) => group.id).join(",")})`,
);
assert(
  COMMAND_GROUPS.find((group) => group.id === "flows")?.label === "Flows" &&
    COMMAND_GROUPS.find((group) => group.id === "views")?.label === "Views",
  "the two new groups read Flows and Views",
);

/** A search-only row by hand: the shape a node row has, with an href target. */
function searchRow(nodeId, label, group = "views") {
  return {
    id: `test:${nodeId}`,
    label,
    group,
    icon: group,
    keywords: [nodeId],
    hint: "test row",
    searchOnly: true,
    target: { kind: "href", href: `/test/${nodeId}` },
  };
}
const handRows = [
  searchRow("V-settings", "Settings"),
  searchRow("V-change", "Change"),
  searchRow("V-home", "Home"),
  searchRow("F-checkin", "Check in", "flows"),
];
const withHandRows = [...commands, ...handRows];
function ranked(query) {
  return rankCommands(withHandRows, query).map((match) => `${match.command.id}@${match.score}`);
}

// The idle palette is unchanged: search-only rows never show on an empty query.
const idleWithRows = rankCommands(withHandRows, "");
assert(
  idleWithRows.length === commands.length &&
    idleWithRows.every((match, index) => match.command.id === commands[index].id),
  "an empty query drops every search-only row and keeps the catalogue's order",
);
assert(
  rankCommands(withHandRows, "   ").every((match) => !match.command.searchOnly),
  "a blank query is an empty one",
);

// NODE_PENALTY: a page beats a node title of the same shape…
assert(
  ranked("settings").slice(0, 2).join(" ") === "settings@10000 test:V-settings@9500",
  `"settings": the page (10000) above a view titled Settings (9500) (got ${ranked("settings").slice(0, 2).join(" ")})`,
);
// …but a node's exact title beats a page's prefix and a page's exact keyword.
assert(
  ranked("change").slice(0, 2).join(" ") === "test:V-change@9500 changelog@7997",
  `"change": an exact view title (9500) above the Changelog prefix (7997) (got ${ranked("change").slice(0, 2).join(" ")})`,
);
assert(
  ranked("home").slice(0, 3).join(" ") === "test:V-home@9500 overview@9000 projects@9000",
  `"home": an exact view title (9500) above two exact page keywords (9000) (got ${ranked("home").slice(0, 3).join(" ")})`,
);
// An id is a keyword: exact at 10000 − 1000 − 500.
assert(
  ranked("v-home").join(" ") === "test:V-home@8500",
  `an id finds its node at 8500 (got ${ranked("v-home").join(" ")})`,
);
assert(
  rankCommands(withHandRows, "v-home")[0].highlight.length === 0,
  "an id hit highlights nothing — the id is a keyword",
);

// limitSearchOnly: at most six search-only rows per group, every other row kept.
const crowd = [
  ...commands,
  ...Array.from({ length: 9 }, (_, index) => searchRow(`V-screen-${index}`, `Screen ${index}`)),
  searchRow("F-screen-a", "Screen flow a", "flows"),
  searchRow("F-screen-b", "Screen flow b", "flows"),
];
const countIn = (matches, group) => matches.filter((match) => match.command.group === group).length;
const crowdRanked = rankCommands(crowd, "screen");
const crowdLimited = limitSearchOnly(crowdRanked);
assert(countIn(crowdRanked, "views") === 9, `nine views match before the cap (got ${countIn(crowdRanked, "views")})`);
assert(countIn(crowdLimited, "views") === 6, `six views remain after it (got ${countIn(crowdLimited, "views")})`);
assert(countIn(crowdLimited, "flows") === 2, `a group under the cap is whole (got ${countIn(crowdLimited, "flows")})`);
assert(
  crowdRanked.filter((match) => !match.command.searchOnly).every((match) => crowdLimited.includes(match)),
  "the cap never drops a page or an action",
);
assert(
  crowdLimited.length === crowdRanked.length - 3 &&
    crowdLimited.every((match, index) => crowdRanked.filter((kept) => crowdLimited.includes(kept))[index] === match),
  "the cap drops only the surplus and keeps the ranked order",
);
assert(
  crowdLimited.filter((match) => match.command.group === "views").map((match) => match.command.label).join(",") ===
    "Screen 0,Screen 1,Screen 2,Screen 3,Screen 4,Screen 5",
  "the six kept are the group's six best",
);
const capTwo = limitSearchOnly(crowdRanked, 2);
assert(
  countIn(capTwo, "views") === 2 && countIn(capTwo, "flows") === 2,
  `an explicit cap applies per group (got views ${countIn(capTwo, "views")}, flows ${countIn(capTwo, "flows")})`,
);
const catalogueA = rankCommands(commands, "a");
assert(limitSearchOnly(catalogueA).length === catalogueA.length, "a catalogue with no search-only rows passes through whole");
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm run test:command-palette`
Expected: FAIL. Among the output, exactly these failing lines from block A:

```
FAIL: NODE_PENALTY is 500 (got undefined)
FAIL: SEARCH_ONLY_PER_GROUP is 6 (got undefined)
FAIL: Flows and Views sit right after Maps (got create,pages,maps,library,project,actions)
FAIL: the two new groups read Flows and Views
FAIL: an empty query drops every search-only row and keeps the catalogue's order
FAIL: a blank query is an empty one
FAIL: "settings": the page (10000) above a view titled Settings (9500) (got settings@10000 test:V-settings@10000)
FAIL: "change": an exact view title (9500) above the Changelog prefix (7997) (got test:V-change@10000 changelog@7997)
FAIL: "home": an exact view title (9500) above two exact page keywords (9000) (got test:V-home@10000 overview@9000 projects@9000)
FAIL: an id finds its node at 8500 (got test:V-home@9000)
```

then the run stops with `TypeError: limitSearchOnly is not a function`. Every assertion above block A still prints `PASS`. Delete the leftover build directory: `rm -rf tests/app/.test-build-command-palette`.

- [ ] **Step 3: Implement**

In `lib/utils/command-palette.ts`, make these six replacements.

Replace:

```ts
export type CommandGroupId = "create" | "pages" | "maps" | "library" | "project" | "actions";
```

with:

```ts
export type CommandGroupId = "create" | "pages" | "maps" | "flows" | "views" | "library" | "project" | "actions";
```

Replace:

```ts
  { id: "maps", label: "Maps" },
  { id: "library", label: "Library" },
```

with:

```ts
  { id: "maps", label: "Maps" },
  // Search-only rows (`buildNodeCommands`): one per flow and per view in scope.
  // They never show on an empty query, so these two headings only ever appear
  // once something is typed.
  { id: "flows", label: "Flows" },
  { id: "views", label: "Views" },
  { id: "library", label: "Library" },
```

Replace (the end of `PaletteCommand`):

```ts
  hint?: string;
  target: CommandTarget;
}
```

with:

```ts
  hint?: string;
  target: CommandTarget;
  /** Offered only once something is typed: an empty query drops it, and a
   * typed one ranks it `NODE_PENALTY` below a page of the same shape. */
  searchOnly?: boolean;
}
```

Replace:

```ts
/** Keyword hits sit one tier below the same-shaped label hit. */
const KEYWORD_PENALTY = 1_000;
```

with:

```ts
/** Keyword hits sit one tier below the same-shaped label hit. */
const KEYWORD_PENALTY = 1_000;
/**
 * What a search-only row (a flow or a view) gives up against a page. Half a
 * keyword step: a page beats a node title of the same shape ("Settings" the
 * page, 10000, over a view titled "Settings", 9500), but a node's exact title
 * still beats a page's prefix (at most 8000) or a page's exact keyword (9000).
 * An exact node id, a keyword, lands at 8500.
 */
export const NODE_PENALTY = 500;
/** How many search-only rows one group shows (`limitSearchOnly`). */
export const SEARCH_ONLY_PER_GROUP = 6;
```

Replace the head of `rankCommands`, from its docblock to the empty-query branch:

```ts
/**
 * Rank the catalogue against what has been typed. An empty query keeps every
 * command in declaration order, which is what the palette shows on open.
 */
export function rankCommands(
  commands: readonly PaletteCommand[],
  query: string,
): CommandMatch[] {
  const trimmed = query.trim();

  // Nothing typed: the catalogue as authored, so the palette opens on the same
  // reading order as the sidebar instead of an arbitrary tie-break.
  if (!trimmed) {
    return commands.map((command) => ({ command, score: 0, highlight: [], completion: null }));
  }
```

with:

```ts
/**
 * Rank the catalogue against what has been typed. An empty query keeps every
 * command in declaration order, which is what the palette shows on open —
 * minus the search-only rows, so the idle palette never lists seventy nodes.
 */
export function rankCommands(
  commands: readonly PaletteCommand[],
  query: string,
): CommandMatch[] {
  const trimmed = query.trim();

  // Nothing typed: the catalogue as authored, so the palette opens on the same
  // reading order as the sidebar instead of an arbitrary tie-break.
  if (!trimmed) {
    return commands
      .filter((command) => !command.searchOnly)
      .map((command) => ({ command, score: 0, highlight: [], completion: null }));
  }
```

Replace (inside `rankCommands`):

```ts
    matches.push({
      command,
      score: best.score,
```

with:

```ts
    matches.push({
      command,
      score: command.searchOnly ? best.score - NODE_PENALTY : best.score,
```

Then insert this function directly above the docblock `/** The ghost suffix drawn after the caret — …` of `completionSuffix`:

```ts
/**
 * At most `perGroup` search-only rows per group, in ranked order; every other
 * row is kept. Applied by the overlay after `rankCommands`: "pe" matches
 * dozens of views, and a list that long buries the pages under them.
 */
export function limitSearchOnly(
  matches: readonly CommandMatch[],
  perGroup: number = SEARCH_ONLY_PER_GROUP,
): CommandMatch[] {
  const kept = new Map<CommandGroupId, number>();
  return matches.filter((match) => {
    if (!match.command.searchOnly) return true;
    const count = kept.get(match.command.group) ?? 0;
    if (count >= perGroup) return false;
    kept.set(match.command.group, count + 1);
    return true;
  });
}

```

- [ ] **Step 4: Run it to see it pass**

Run: `npm run test:command-palette`
Expected: every line `PASS` (block A adds 19), last line `All command palette tests passed`, exit 0.

Run: `grep -nE "^import|require\(" lib/utils/command-palette.ts; grep -nE "groupBy|\.union\(|\.intersection\(|\.difference\(" lib/utils/command-palette.ts`
Expected: no output (still import-free; nothing Node 20 lacks).

Run: `npx tsc --noEmit && npx eslint lib/utils/command-palette.ts`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add lib/utils/command-palette.ts tests/app/command-palette.test.js
git commit -m "feat(palette): search-only rows rank below pages and cap at six a group"
```

---

### Task 2: Flows and views as rows, with a node target

**Files:**
- Modify: `lib/utils/command-palette.ts`
- Modify: `components/layout/CommandPalette.tsx`
- Test: `tests/app/command-palette.test.js`

**Trap:** `CommandTarget` is a closed union. Widening it makes `runCommand` (`CommandPalette.tsx:209-228`, before part 2's icon lines shift it) read `target.external`/`target.href` on a `node` target and `tsc` fails — the overlay's `node` branch lands in this same commit (contract, Known traps). Run `npx tsc --noEmit` in Step 4. `CommandPalette` is shared with the docs search (`components/docs/DocsSearch.tsx:83`), so `onNode` is optional and the docs search passes nothing.

- [ ] **Step 1: Write the failing test (block B)**

In `tests/app/command-palette.test.js`, insert this block immediately above the line `fs.rmSync(BUILD_DIR, { recursive: true, force: true });` — that is, directly after block A, which it reads (`nodePalette`, `nodePath`, `countIn`):

```js
// --- flows and views as rows: summary, rows, and the Pebbles ranking (part 5) ---
const { summarizePaletteNodes, buildNodeCommands } = nodePalette;

// summarizePaletteNodes: a small snapshot with every playlist shape.
const fixtureNodes = [
  {
    id: "F-a",
    species: "flow",
    title: "Check in",
    metadata: {
      playlist: {
        entries: [
          { type: "view", view_id: "V-1" },
          {
            type: "condition",
            label: "Has a streak?",
            if_true: [{ type: "view", view_id: "V-2" }],
            if_false: [{ type: "view", view_id: "V-1" }],
          },
          {
            type: "junction",
            label: "Mood",
            cases: [
              { label: "Calm", entries: [{ type: "view", view_id: "V-3" }] },
              { label: "Busy", entries: [] },
            ],
          },
          { type: "flow", flow_id: "F-b" },
          { type: "view", view_id: "V-missing" },
        ],
      },
    },
  },
  {
    id: "F-b",
    species: "flow",
    title: "Streaks",
    metadata: {
      playlist: {
        entries: [
          { type: "view", view_id: "V-5" },
          { type: "flow", flow_id: "F-b" },
        ],
      },
    },
  },
  { id: "F-c", species: "flow", title: "  ", metadata: null },
  {
    id: "F-d",
    species: "flow",
    title: "Broken",
    metadata: {
      playlist: {
        entries: [null, 42, { type: "view" }, { type: "junction", label: "x", cases: "nope" }, { type: "condition" }],
      },
    },
  },
  { id: "V-1", species: "view", title: "Check-in sheet" },
  { id: "V-2", species: "view", title: "Streak" },
  { id: "V-3", species: "view", title: "Calm mode" },
  { id: "V-4", species: "view", title: "Loose screen" },
  { id: "V-5", species: "view", title: "Streak calendar", metadata: {} },
  { id: "DM-1", species: "data-model", title: "Mood" },
];
const summary = summarizePaletteNodes(fixtureNodes);

assert(
  JSON.stringify(summary.flows) ===
    JSON.stringify([
      { id: "F-a", title: "Check in", screenCount: 3 },
      { id: "F-b", title: "Streaks", screenCount: 1 },
      { id: "F-c", title: "F-c", screenCount: 0 },
      { id: "F-d", title: "Broken", screenCount: 0 },
    ]),
  `flows: distinct views through arms, sub-flows never inlined, dangling ids and malformed entries skipped, a blank title falls back to the id (got ${JSON.stringify(summary.flows)})`,
);
assert(
  JSON.stringify(summary.views) ===
    JSON.stringify([
      { id: "V-1", title: "Check-in sheet", firstFlowTitle: "Check in" },
      { id: "V-2", title: "Streak", firstFlowTitle: "Check in" },
      { id: "V-3", title: "Calm mode", firstFlowTitle: "Check in" },
      { id: "V-4", title: "Loose screen", firstFlowTitle: null },
      { id: "V-5", title: "Streak calendar", firstFlowTitle: "Streaks" },
    ]),
  `views: the first listing flow in snapshot order, null when no flow lists it, other species ignored (got ${JSON.stringify(summary.views)})`,
);

// buildNodeCommands: one search-only row per flow and per view, flows first.
const fixtureRows = buildNodeCommands(summary);
assert(
  fixtureRows.map((row) => row.id).join(",") ===
    "node:F-a,node:F-b,node:F-c,node:F-d,node:V-1,node:V-2,node:V-3,node:V-4,node:V-5",
  "rows are node:<id>, flows then views, snapshot order",
);
const rowA = fixtureRows[0];
assert(
  rowA.label === "Check in" &&
    rowA.group === "flows" &&
    rowA.icon === "flows" &&
    JSON.stringify(rowA.keywords) === JSON.stringify(["F-a"]) &&
    rowA.searchOnly === true &&
    rowA.target.kind === "node" &&
    rowA.target.nodeId === "F-a",
  "a flow row: its title, the Flows group and icon, its id as the keyword, search-only, a node target",
);
const rowV1 = fixtureRows.find((row) => row.id === "node:V-1");
assert(
  rowV1.group === "views" && rowV1.icon === "views" && rowV1.target.nodeId === "V-1" && rowV1.searchOnly === true,
  "a view row: the Views group and icon, a node target, search-only",
);
const hints = Object.fromEntries(fixtureRows.map((row) => [row.id, row.hint]));
assert(hints["node:F-a"] === "3 screens", `a flow's hint counts its screens (got ${hints["node:F-a"]})`);
assert(hints["node:F-b"] === "1 screen", `one screen is singular (got ${hints["node:F-b"]})`);
assert(hints["node:F-c"] === "0 screens", `an empty flow says 0 screens (got ${hints["node:F-c"]})`);
assert(hints["node:V-2"] === "Check in", `a view's hint is its first flow (got ${hints["node:V-2"]})`);
assert(hints["node:V-4"] === "Not in a flow", `a view no flow lists says so (got ${hints["node:V-4"]})`);

// The Pebbles seed, All products: what the layout lists for that project.
const pebbles = JSON.parse(fs.readFileSync(nodePath.join(__dirname, "..", "..", "seed", "pebbles.json"), "utf8"));
const pebbleRows = buildNodeCommands(
  summarizePaletteNodes(pebbles.nodes.filter((node) => node.species === "flow" || node.species === "view")),
);
assert(pebbleRows.length === 68, `Pebbles lists 10 flows and 58 views (got ${pebbleRows.length})`);
const pebbleCatalogue = [...commands, ...pebbleRows];
assert(
  pebbleCatalogue.every((command) => groupIds.has(command.group)),
  "every node row belongs to a declared group",
);
assert(
  new Set(pebbleCatalogue.map((command) => command.id)).size === pebbleCatalogue.length,
  "node row ids never collide with the catalogue's",
);

const pebbleHints = Object.fromEntries(pebbleRows.map((row) => [row.id, row.hint]));
assert(pebbleHints["node:F-onboarding"] === "5 screens", `Onboarding: 5 screens (got ${pebbleHints["node:F-onboarding"]})`);
assert(pebbleHints["node:F-legal-consent"] === "1 screen", `Legal Consent: 1 screen (got ${pebbleHints["node:F-legal-consent"]})`);
assert(pebbleHints["node:V-home"] === "Onboarding", `Home sits first in Onboarding (got ${pebbleHints["node:V-home"]})`);
assert(
  pebbleHints["node:V-admin-analytics"] === "Not in a flow",
  `an Admin view is in no flow (got ${pebbleHints["node:V-admin-analytics"]})`,
);

/** What the overlay ranks: `limitSearchOnly` after `rankCommands`. */
function pebbleRanked(query) {
  return limitSearchOnly(rankCommands(pebbleCatalogue, query));
}
function shown(query) {
  return pebbleRanked(query)
    .map((match) => `${match.command.label} (${match.command.group}, ${match.score})`)
    .join(" · ");
}
const PEBBLES_RANKING = [
  ["settings", "Settings (project, 10000) · Settings (views, 9500)"],
  ["home", "Home (views, 9500) · Overview (project, 9000) · All projects (actions, 9000) · Onboarding — Drop a pebble, keep the moment (views, 1494)"],
  ["onboarding", "Onboarding (flows, 9500) · Onboarding audit (maps, 7994) · Onboarding — Get your pebble (views, 7482) · Onboarding — Qualify and relate (views, 7479) · Onboarding — Your life is a path (views, 7478) · Onboarding — Drop a pebble, keep the moment (views, 7467)"],
  ["onboard", "Onboarding audit (maps, 7991) · Onboarding (flows, 7497) · Onboarding — Get your pebble (views, 7479) · Onboarding — Qualify and relate (views, 7476) · Onboarding — Your life is a path (views, 7475) · Onboarding — Drop a pebble, keep the moment (views, 7464)"],
  ["path", "Path (views, 9500) · Onboarding — Your life is a path (views, 5472) · Onboarding — Drop a pebble, keep the moment (views, 1482) · Attach Glyph (views, 492)"],
  ["V-timeline", "Path (views, 8500)"],
  ["F-onboarding", "Onboarding (flows, 8500)"],
  ["record", "Record Pebble (flows, 7493) · Record Pebble (views, 7493) · Record Celebration (views, 7488)"],
  ["docs", "Documentation (actions, 9000) · Docs Page (views, 7495) · Docs Index (views, 7494) · Legal Notice (views, 4498) · Privacy Policy (views, 4498) · Terms of Service (views, 4498) · Keyboard shortcuts (actions, 1990)"],
  ["set", "Settings (project, 7995) · Settings (views, 7495) · Set Intensity & Valence (views, 7480) · Legal Consent (flows, 1497) · Mechanic Sheet (views, 1496) · Soul Detail (views, 1493) · Shape Emotion Pearl (views, 1491) · Souls Directory (views, 1489) · Keyboard shortcuts (actions, 996) · Findings (project, 994) · Screens (maps, 991) · All projects (actions, 987)"],
  ["glyph", "Glyphs (views, 7499) · Glyph Detail (views, 7493) · Glyph Swap Drawer (views, 7488) · Swap Glyph (flows, 5495) · Carve Glyph (views, 5494) · Attach Glyph (views, 5493) · Manage Glyphs (flows, 5493) · Admin · Glyph moderation (views, 5492)"],
  // The queries the catalogue assertions above pin: node rows join some of
  // them, and change the first row of none.
  ["acc", "Acceptances (library, 7992) · Agent tokens (actions, 6996) · Privacy Policy (views, 1492) · Create Collection (views, 1491) · Manage Collections (flows, 1489) · System (maps, 993) · Onboarding — Drop a pebble, keep the moment (views, 490)"],
  ["jour", "Journey (maps, 7997) · Changelog (project, 6997) · Flows (library, 6996)"],
  ["deliv", "Delivery (project, 7997)"],
  ["Journey", "Journey (maps, 10000) · Flows (library, 6999)"],
  ["views", "Views (library, 10000) · All maps (maps, 6987)"],
  ["screens", "Screens (maps, 10000) · Views (library, 9000)"],
  ["pages", "Views (library, 9000)"],
  ["page", "Views (library, 6999) · Docs Page (views, 5495)"],
  ["kanban", "Delivery (project, 9000)"],
  ["dark mode", "Toggle theme (actions, 9000)"],
  ["chang", "Changelog (project, 7996)"],
  ["cept", "Acceptances (library, 3998) · Onboarding — Drop a pebble, keep the moment (views, 2484)"],
  ["dmo", "Data Models (library, 1994) · Documentation (actions, 1989) · Admin · Domains (views, 1492) · Admin · Upload glyph (views, 1490) · Admin · Glyph moderation (views, 1486) · Onboarding — Drop a pebble, keep the moment (views, 1468) · System (maps, 994) · Toggle theme (actions, 994)"],
  ["zzzqq", ""],
];
for (const [query, expected] of PEBBLES_RANKING) {
  const actual = shown(query);
  assert(actual === expected, `Pebbles "${query}" ranks as pinned${actual === expected ? "" : `\n    expected: ${expected}\n    got:      ${actual}`}`);
}

// Highlight and completion on node rows follow the same rules as pages.
const pathRow = pebbleRanked("path")[0];
assert(pathRow.highlight.join(",") === "0,1,2,3", `a title hit highlights the title (got ${pathRow.highlight.join(",")})`);
assert(
  completionSuffix("V-tim", pebbleRanked("V-tim")[0]) === "eline",
  "Tab completes a node id being typed",
);
assert(
  completionSuffix("page", pebbleRanked("page")[0]) === "s",
  "with node rows present, the synonym probe still completes page → pages",
);
assert(
  completionSuffix("onboard", pebbleRanked("onboard")[0]) === "ing audit",
  "a page's prefix still leads, and completes, over a node's prefix",
);

// The cap on real data: "set" matches nine Pebbles views and shows six.
const setUnlimited = rankCommands(pebbleCatalogue, "set");
assert(countIn(setUnlimited, "views") === 9, `"set" matches nine views before the cap (got ${countIn(setUnlimited, "views")})`);
assert(countIn(pebbleRanked("set"), "views") === 6, `"set" shows six after it (got ${countIn(pebbleRanked("set"), "views")})`);
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm run test:command-palette`
Expected: FAIL — every assertion through block A prints `PASS`, then the run stops at `const summary = summarizePaletteNodes(fixtureNodes);` with `TypeError: summarizePaletteNodes is not a function`. Then `rm -rf tests/app/.test-build-command-palette`.

- [ ] **Step 3: Implement the brain and the overlay**

In `lib/utils/command-palette.ts`, replace:

```ts
  /** A page-registered command (`usePageAction`): the page runs it itself. */
  | { kind: "run"; run: () => void };
```

with:

```ts
  /** A page-registered command (`usePageAction`): the page runs it itself. */
  | { kind: "run"; run: () => void }
  /** A flow or view of the project (`buildNodeCommands`): the overlay hands the
   * id to its `onNode` prop, and the page on screen decides what "go to it"
   * means — fly to it, open its panel, or leave for the Library. */
  | { kind: "node"; nodeId: string };
```

Then insert this block directly above the docblock `/** One page of the documentation, as the docs shell knows it. Plain data on` (before `export interface DocsPage`):

```ts
/** The node shape `summarizePaletteNodes` reads — structural on purpose, so this
 * file keeps no imports (its test loader transpiles it alone). */
interface PaletteNodeInput {
  id: string;
  species: string;
  title: string;
  metadata?: { playlist?: { entries?: unknown } } | null;
}

interface PaletteNodeSummary {
  /** Snapshot order. `screenCount` = distinct views the flow lists. */
  flows: { id: string; title: string; screenCount: number }[];
  /** Snapshot order. `firstFlowTitle` = the first flow, in snapshot order, that lists the view. */
  views: { id: string; title: string; firstFlowTitle: string | null }[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * The view ids a playlist lists, in order, duplicates kept. Walks `view`
 * entries and the arms of `condition` and `junction`; a `flow` entry is a
 * sub-flow with its own row, so its views are never counted here (and a flow
 * that lists itself cannot loop). Anything malformed is skipped, not thrown:
 * the palette must open on a bundle the validator would warn about.
 */
function playlistViewIds(entries: unknown, out: string[] = []): string[] {
  if (!Array.isArray(entries)) return out;
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    if (entry.type === "view" && typeof entry.view_id === "string") {
      out.push(entry.view_id);
    } else if (entry.type === "condition") {
      playlistViewIds(entry.if_true, out);
      playlistViewIds(entry.if_false, out);
    } else if (entry.type === "junction" && Array.isArray(entry.cases)) {
      for (const branch of entry.cases) {
        if (isRecord(branch)) playlistViewIds(branch.entries, out);
      }
    }
  }
  return out;
}

/** A row needs words: a blank title falls back to the id, which always exists. */
function rowTitle(node: PaletteNodeInput): string {
  return typeof node.title === "string" && node.title.trim() !== "" ? node.title : node.id;
}

/**
 * The flows and views of a snapshot, as the palette lists them. The caller
 * scopes `nodes` first: a view listed only by a flow outside the scope reads
 * "Not in a flow", as it does on the Screens map. Only views present in
 * `nodes` are counted, so a dangling or out-of-scope reference counts nothing.
 */
export function summarizePaletteNodes(nodes: readonly PaletteNodeInput[]): PaletteNodeSummary {
  const viewIds = new Set(nodes.filter((node) => node.species === "view").map((node) => node.id));
  const firstFlowTitle = new Map<string, string>();
  const flows: PaletteNodeSummary["flows"] = [];

  for (const node of nodes) {
    if (node.species !== "flow") continue;
    const title = rowTitle(node);
    const listed = new Set(playlistViewIds(node.metadata?.playlist?.entries).filter((id) => viewIds.has(id)));
    for (const viewId of listed) {
      if (!firstFlowTitle.has(viewId)) firstFlowTitle.set(viewId, title);
    }
    flows.push({ id: node.id, title, screenCount: listed.size });
  }

  const views = nodes
    .filter((node) => node.species === "view")
    .map((node) => ({ id: node.id, title: rowTitle(node), firstFlowTitle: firstFlowTitle.get(node.id) ?? null }));

  return { flows, views };
}

/**
 * One search-only row per flow and per view. The id is a keyword, so a
 * pasted `V-home` finds its view; the hint says where the row sits — a flow's
 * size, a view's first flow.
 */
export function buildNodeCommands(input: ReturnType<typeof summarizePaletteNodes>): PaletteCommand[] {
  return [
    ...input.flows.map<PaletteCommand>((flow) => ({
      id: `node:${flow.id}`,
      label: flow.title,
      group: "flows",
      icon: "flows",
      keywords: [flow.id],
      hint: flow.screenCount === 1 ? "1 screen" : `${flow.screenCount} screens`,
      searchOnly: true,
      target: { kind: "node", nodeId: flow.id },
    })),
    ...input.views.map<PaletteCommand>((view) => ({
      id: `node:${view.id}`,
      label: view.title,
      group: "views",
      icon: "views",
      keywords: [view.id],
      hint: view.firstFlowTitle ?? "Not in a flow",
      searchOnly: true,
      target: { kind: "node", nodeId: view.id },
    })),
  ];
}
```

In `components/layout/CommandPalette.tsx`, make these replacements (anchored on code parts 2–4 do not change; part 2 only adds an icon import and the `screens` entry of `COMMAND_ICONS`).

Replace:

```tsx
  COMMAND_GROUPS,
  completionSuffix,
  rankCommands,
```

with:

```tsx
  COMMAND_GROUPS,
  completionSuffix,
  limitSearchOnly,
  rankCommands,
```

Replace (the end of `CommandPaletteProps`):

```tsx
  /** Read to screen readers on open; says what this palette searches. */
  description?: string;
}

interface PaletteSection {
```

with:

```tsx
  /** Read to screen readers on open; says what this palette searches. */
  description?: string;
  /**
   * Runs a flow or view row (`target.kind === "node"`). Optional: the docs
   * search shares this overlay and lists no nodes. The project layout decides
   * what "go to it" means on the page on screen.
   */
  onNode?: (nodeId: string) => void;
}

interface PaletteSection {
```

Replace:

```tsx
  placeholder = "Jump to a map, a library, a setting…",
  description = "Search every page and action of this project, then press Enter to go there.",
}: CommandPaletteProps) {
```

with:

```tsx
  placeholder = "Jump to a map, a library, a setting…",
  description = "Search every page and action of this project, then press Enter to go there.",
  onNode,
}: CommandPaletteProps) {
```

Replace:

```tsx
        <PaletteBody
          commands={commands}
          onAction={onAction}
          onClose={() => onOpenChange(false)}
          placeholder={placeholder}
        />
```

with:

```tsx
        <PaletteBody
          commands={commands}
          onAction={onAction}
          onNode={onNode}
          onClose={() => onOpenChange(false)}
          placeholder={placeholder}
        />
```

Replace:

```tsx
interface PaletteBodyProps {
  commands: readonly PaletteCommand[];
  onAction: (action: CommandActionId) => void;
  onClose: () => void;
  placeholder: string;
}

function PaletteBody({ commands, onAction, onClose, placeholder }: PaletteBodyProps) {
```

with:

```tsx
interface PaletteBodyProps {
  commands: readonly PaletteCommand[];
  onAction: (action: CommandActionId) => void;
  onNode?: (nodeId: string) => void;
  onClose: () => void;
  placeholder: string;
}

function PaletteBody({ commands, onAction, onNode, onClose, placeholder }: PaletteBodyProps) {
```

Replace:

```tsx
  const matches = useMemo(() => rankCommands(commands, query), [commands, query]);
```

with:

```tsx
  // Capped after ranking, not before: the cap keeps each group's best rows, so
  // it has to see the order first.
  const matches = useMemo(() => limitSearchOnly(rankCommands(commands, query)), [commands, query]);
```

Replace the whole `runCommand`:

```tsx
  const runCommand = useCallback(
    (match: CommandMatch) => {
      onClose();
      const { target } = match.command;
      if (target.kind === "action") {
        onAction(target.action);
        return;
      }
      if (target.kind === "run") {
        target.run();
        return;
      }
      if (target.external) {
        window.open(target.href, "_blank", "noopener,noreferrer");
        return;
      }
      router.push(target.href);
    },
    [onAction, onClose, router],
  );
```

with:

```tsx
  const runCommand = useCallback(
    (match: CommandMatch) => {
      onClose();
      const { target } = match.command;
      if (target.kind === "action") {
        onAction(target.action);
        return;
      }
      if (target.kind === "run") {
        target.run();
        return;
      }
      // Before the href branch: `CommandTarget` is a closed union, and what is
      // left after this is the href target alone.
      if (target.kind === "node") {
        onNode?.(target.nodeId);
        return;
      }
      if (target.external) {
        window.open(target.href, "_blank", "noopener,noreferrer");
        return;
      }
      router.push(target.href);
    },
    [onAction, onClose, onNode, router],
  );
```

- [ ] **Step 4: Run it to see it pass**

Run: `npm run test:command-palette`
Expected: every line `PASS` (block B adds 48 more), last line `All command palette tests passed`, exit 0.

Run: `npx tsc --noEmit && npx eslint lib/utils/command-palette.ts components/layout/CommandPalette.tsx`
Expected: no output.

Run: `grep -nE "^import|require\(" lib/utils/command-palette.ts`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add lib/utils/command-palette.ts components/layout/CommandPalette.tsx tests/app/command-palette.test.js
git commit -m "feat(palette): flows and views as search-only rows with a node target"
```

---

### Task 3: A page can handle a chosen flow or view

No Node test loads a React hook here (the repo has no React test runner); the contract's checks for this file are `tsc`, the lint and the keyboard suite's source sweep.

**Files:**
- Modify: `lib/hooks/usePageCommands.tsx`

**Traps:** the React Compiler lint rules are errors — `react-hooks/refs` (no ref read during render: the ref is written in an effect and read only when a row runs, as `usePageAction` does) and `react-hooks/set-state-in-effect` (the effect calls the provider's `register`, never a setter of its own). A bare function in state would be taken for an updater, so the provider boxes it. Run `npm run lint`. `tests/app/keyboard-shortcuts.test.js:186-214` sweeps `lib` for `keydown` listeners: none is added; run `npm run test:keyboard-shortcuts`. No loader under `tests/` transpiles this file (`grep -rn "usePageCommands" tests/` prints nothing), so no alias table changes.

- [ ] **Step 1: Replace the file**

Replace the whole of `lib/hooks/usePageCommands.tsx` with:

```tsx
"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import type { PaletteCommand } from "@/lib/utils/command-palette";

/** A page's own action — "New node", "New map" — offered in the ⌘K palette. */
export interface PageAction {
  label: string;
  /** Kept for callers; the palette draws every page action with the create glyph. */
  icon?: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
}

/**
 * What the page on screen does with a flow or view chosen in the palette —
 * the Screens map flies to it. A page that registers none gets the layout's
 * default: the node's panel, or the Library where no panel can open.
 */
export type PageNodeHandler = (nodeId: string) => void;

type Register = (command: PaletteCommand) => () => void;
type RegisterNodeHandler = (handler: PageNodeHandler) => () => void;

const PageCommandsContext = createContext<Register | null>(null);
const PageNodeHandlerContext = createContext<RegisterNodeHandler | null>(null);

/**
 * Holds the commands the current page contributes to the palette, beside the
 * project-wide catalogue the layout builds, and the page's node handler. A
 * page registers on mount and is gone on unmount, so the palette only ever
 * offers what the page on screen can actually do.
 */
export function PageCommandsProvider({
  children,
}: {
  children: (commands: PaletteCommand[], nodeHandler: PageNodeHandler | null) => ReactNode;
}) {
  const [commands, setCommands] = useState<PaletteCommand[]>([]);
  // Boxed: a bare function in state would be taken for an updater and called.
  const [nodeHandler, setNodeHandler] = useState<{ run: PageNodeHandler } | null>(null);

  const register = useCallback<Register>((command) => {
    setCommands((previous) => [...previous.filter((entry) => entry.id !== command.id), command]);
    return () => setCommands((previous) => previous.filter((entry) => entry !== command));
  }, []);

  const registerNodeHandler = useCallback<RegisterNodeHandler>((handler) => {
    const entry = { run: handler };
    setNodeHandler(entry);
    // Only the entry this call installed is removed: a page that registered
    // after it keeps its own.
    return () => setNodeHandler((current) => (current === entry ? null : current));
  }, []);

  return (
    <PageCommandsContext.Provider value={register}>
      <PageNodeHandlerContext.Provider value={registerNodeHandler}>
        {children(commands, nodeHandler?.run ?? null)}
      </PageNodeHandlerContext.Provider>
    </PageCommandsContext.Provider>
  );
}

/**
 * Offer a page's action in the palette's Create group for as long as the page
 * is mounted — the home the header's create button moved to.
 *
 * Registered on what the row *shows* (label, disabled), never on the action's
 * identity: callers pass an inline object whose `onClick` is a fresh closure
 * every render, and re-registering on each one would churn the palette's list.
 * The latest `onClick` is read through a ref at the moment the command runs.
 */
export function usePageAction(action: PageAction | undefined) {
  const register = useContext(PageCommandsContext);
  const latest = useRef(action);
  useEffect(() => {
    latest.current = action;
  });

  const label = action?.label;
  const disabled = action?.disabled ?? false;

  useEffect(() => {
    if (!register || !label || disabled) return;
    return register({
      id: `page-action:${label}`,
      label,
      group: "create",
      icon: "create",
      keywords: ["create", "new", "add"],
      hint: "On this page",
      target: { kind: "run", run: () => latest.current?.onClick() },
    });
  }, [register, label, disabled]);
}

/**
 * Handle the palette's flow and view rows on this page for as long as it is
 * mounted. Registered once, on whether a handler is given, never on its
 * identity — callers pass a closure over their render's state — and the latest
 * handler is read through a ref when a row runs, exactly as `usePageAction`
 * reads its `onClick`.
 */
export function usePageNodeHandler(handler: PageNodeHandler | undefined) {
  const register = useContext(PageNodeHandlerContext);
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });

  const enabled = handler !== undefined;

  useEffect(() => {
    if (!register || !enabled) return;
    return register((nodeId) => latest.current?.(nodeId));
  }, [register, enabled]);
}
```

The layout's existing render prop `(pageCommands) => …` still type-checks against the two-argument signature, so this task commits alone.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit && npx eslint lib/hooks/usePageCommands.tsx && npm run test:keyboard-shortcuts`
Expected: no `tsc` or ESLint output; last line `All keyboard shortcut tests passed`.

- [ ] **Step 3: Commit**

```bash
git add lib/hooks/usePageCommands.tsx
git commit -m "feat(palette): a page can handle a chosen flow or view"
```

---

### Task 4: The layout lists the scope's flows and views and routes them

**Files:**
- Modify: `app/project/[id]/layout.tsx`

**Facts this relies on (verified at `2f697cd`):** `useNodes(id)` is a `select` over the same cached bundle query as `useProject(id)` (`lib/hooks/useNodes.ts:30`, `lib/hooks/useProject.ts:24`), so no second fetch. `useEffectiveProduct(id, project)` is what every surface reads (`lib/hooks/useProductScope.ts:85-94`). `nodeInScope(node, scope)` without a graph answers stored membership (`lib/utils/product-scope.ts:351-359`), which the contract says suffices for flows and views. Overview and Settings pass no `allNodes` to `PageShell` (`app/project/[id]/overview/page.tsx:237`, `app/project/[id]/settings/page.tsx:92`); every other project page does, and the maps render theirs inside `JourneyMap`/`SystemMap`/`ScreensMap`. `?node=` opens the panel on arrival on any route (`lib/hooks/useProjectPanels.tsx:197-228`).

**Traps:** `react-hooks/exhaustive-deps` and the compiler rules — `goToNode` is a `useCallback` in `ProjectChrome`, never a hook inside the render prop (that function runs during `PageCommandsProvider`'s render). No loader transpiles the layout.

- [ ] **Step 1: Edit the imports**

Replace:

```tsx
import { usePathname, useSearchParams } from "next/navigation";
```

with:

```tsx
import { usePathname, useRouter, useSearchParams } from "next/navigation";
```

Replace:

```tsx
import { PageCommandsProvider } from "@/lib/hooks/usePageCommands";
```

with:

```tsx
import { PageCommandsProvider, type PageNodeHandler } from "@/lib/hooks/usePageCommands";
```

Replace:

```tsx
import { useProject } from "@/lib/hooks/useProject";
import { useProjectId } from "@/lib/hooks/useProjectId";
import { useProjectExport } from "@/lib/hooks/useProjectExport";
import { buildProjectCommands, type CommandActionId } from "@/lib/utils/command-palette";
```

with:

```tsx
import { useNodes } from "@/lib/hooks/useNodes";
import { useEffectiveProduct } from "@/lib/hooks/useProductScope";
import { useProject } from "@/lib/hooks/useProject";
import { useProjectId } from "@/lib/hooks/useProjectId";
import { useProjectExport } from "@/lib/hooks/useProjectExport";
import {
  buildNodeCommands,
  buildProjectCommands,
  summarizePaletteNodes,
  type CommandActionId,
} from "@/lib/utils/command-palette";
import { nodeInScope } from "@/lib/utils/product-scope";
```

- [ ] **Step 2: Read the nodes and the scope; build the rows; route a choice**

Replace:

```tsx
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const id = useProjectId();
  const { project, error: projectError, reload: reloadProject } = useProject(id);
  const { openRaw } = useProjectPanels();
```

with:

```tsx
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const id = useProjectId();
  const { project, error: projectError, reload: reloadProject } = useProject(id);
  // The same cached bundle `useProject` reads — no second fetch. The palette
  // lists the flows and views of the scope the sidebar shows.
  const { nodes } = useNodes(id);
  const scope = useEffectiveProduct(id, project);
  const { openRaw, openNode } = useProjectPanels();
```

Replace:

```tsx
  const commands = useMemo(
    () => buildProjectCommands({ projectId: id, customMaps }),
    [id, customMaps],
  );
```

with:

```tsx
  const commands = useMemo(
    () => buildProjectCommands({ projectId: id, customMaps }),
    [id, customMaps],
  );

  // Search-only rows: they appear once something is typed, never on open.
  // Stored membership is the whole answer for flows and views, so no graph.
  const nodeCommands = useMemo(
    () =>
      buildNodeCommands(
        summarizePaletteNodes(
          nodes.filter(
            (node) => (node.species === "flow" || node.species === "view") && nodeInScope(node, scope),
          ),
        ),
      ),
    [nodes, scope],
  );

  // A flow or view chosen in the palette. The page's own handler first (the
  // Screens map flies to it). Overview and Settings host no node panel — their
  // PageShell gets no nodes — so they hand off to the Library, which opens the
  // panel from `?node=` on arrival. Everywhere else the panel opens in place.
  const goToNode = useCallback(
    (nodeId: string, pageHandler: PageNodeHandler | null) => {
      if (pageHandler) {
        pageHandler(nodeId);
        return;
      }
      if (currentView === "overview" || currentView === "settings") {
        router.push(`/project/${id}/library?${NODE_PANEL_PARAM}=${encodeURIComponent(nodeId)}`);
        return;
      }
      openNode({ nodeId });
    },
    [currentView, id, openNode, router],
  );
```

(`NODE_PANEL_PARAM` is `"node"` and is already imported from `@/lib/hooks/useProjectPanels`; `currentView` is declared above `commands`.)

- [ ] **Step 3: Hand the rows and the router to the palette**

Replace:

```tsx
    <PageCommandsProvider>
      {(pageCommands) => (
```

with:

```tsx
    <PageCommandsProvider>
      {(pageCommands, nodeHandler) => (
```

Replace:

```tsx
            commands={pageCommands.length > 0 ? [...pageCommands, ...commands] : commands}
            onAction={handleCommandAction}
          />
```

with:

```tsx
            // Node rows last: they are search-only, so the idle list is unchanged,
            // and on a tie the page outranks a node through authored order too.
            commands={[...pageCommands, ...commands, ...nodeCommands]}
            onAction={handleCommandAction}
            onNode={(nodeId) => goToNode(nodeId, nodeHandler)}
          />
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npx eslint "app/project/[id]/layout.tsx" && npm run test:keyboard-shortcuts && npm run test:command-palette`
Expected: no `tsc` or ESLint output; `All keyboard shortcut tests passed`; `All command palette tests passed`.

Run: `grep -rn "project/\[id\]/layout" tests/`
Expected: no output (no source-reading suite pins the layout).

- [ ] **Step 5: Commit**

```bash
git add "app/project/[id]/layout.tsx"
git commit -m "feat(palette): list the scope's flows and views and route them by page"
```

---

### Task 5: The Screens map flies to a chosen flow or view

**Files:**
- Modify: `components/maps/ScreensMap.tsx` (two imports and one hook call; nothing else)

**Trap:** rules of hooks — the call sits with the controller's other hooks, above its first early return (the `PageLoading`, `PageError` and empty-state returns). The closure reads `wall`, `layout`, `jumpToFlow`, `selectFrame` and `openNode` only when a row runs, never during render, so `react-hooks/refs` is not involved; run `npm run lint`. A stale dev server fakes hydration mismatches: restart it before believing one in Task 7.

- [ ] **Step 1: Confirm the two controller functions exist (Contract deviation 1)**

Run: `grep -nE "const (jumpToFlow|selectFrame) = useCallback|useProjectPanels\(\)|from \"@/lib/utils/screen-wall\"" components/maps/ScreensMap.tsx`
Expected, at least: `const jumpToFlow = useCallback(`, `const selectFrame = useCallback(`, and the `useProjectPanels()` destructuring that yields `openNode`; plus the line closing the named import from `"@/lib/utils/screen-wall"` when the controller has one.

If `jumpToFlow` or `selectFrame` is missing: the behaviour exists (part 2's `onJump` handler; part 4's first frame activation), only its name or shape differs. Do not rewrite it here. With the `gh-stack` skill, go down to the part that owns it (`feat/screens-map` for `jumpToFlow`, `feat/screens-inspect` for `selectFrame`), extract it as a pure refactor under the exact signature in § Contract deviations — `jumpToFlow(flowId: string): void`; `selectFrame(frameId: string, viewId: string, stripId: string): void`, which sets the selection and issues the selection camera request but never opens a panel — wire the canvas callback through it, run that part's `npx tsc --noEmit` and `npm run lint`, commit `refactor(screens): name the strip jump and the frame selection`, rebase the stack upstack, and return to `feat/screens-palette`. Rerun the grep until it prints the `jumpToFlow`, `selectFrame` and `useProjectPanels()` lines.

- [ ] **Step 2: Add the handler**

Add to the imports of `components/maps/ScreensMap.tsx`:

```tsx
import { usePageNodeHandler } from "@/lib/hooks/usePageCommands";
```

and add `frameIdsOf` to the existing named import from `"@/lib/utils/screen-wall"` (keep the names already there, add this one); if the file has no such import, add:

```tsx
import { frameIdsOf } from "@/lib/utils/screen-wall";
```

Then insert this block directly after the `selectFrame` declaration (both functions and `openNode` are in scope there, and it is above every early return):

```tsx
  // ⌘K on the Screens map (part 5): a flow flies to its strip and rings its
  // header; a view selects its first frame in strip order and frames it.
  // Anything the wall does not show — outside the map's scope, or the wall not
  // built yet — opens its panel, as on every other page that hosts panels.
  usePageNodeHandler((nodeId) => {
    if (wall && layout) {
      const strip = wall.strips.find((candidate) => candidate.flowId === nodeId);
      if (strip && layout.strips.has(strip.id)) {
        jumpToFlow(nodeId);
        return;
      }
      const frameId = frameIdsOf(wall, nodeId)[0];
      const box = frameId === undefined ? undefined : layout.boxes.find((candidate) => candidate.id === frameId);
      if (frameId !== undefined && box) {
        selectFrame(frameId, nodeId, box.stripId);
        return;
      }
    }
    openNode({ nodeId });
  });
```

`wall` and `layout` are the controller's `Wall` and `WallLayout` (the values it passes to `<ScreensCanvas wall layout>`). The `if (wall && layout)` guard is a no-op when they are never null and the fallback when they are null while loading. `frameIdsOf` returns frame ids in strip order (contract § Part 1), and every frame's `WallBox` carries its `stripId`.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npx eslint components/maps/ScreensMap.tsx && npm run test:screen-wall && npm run test:command-palette`
Expected: no `tsc` or ESLint output; both suites end on their "passed" line (`test:screen-wall` proves the wall model is untouched).

Run: `git diff --stat HEAD -- lib/utils/screen-wall.ts lib/utils/screen-wall-layout.ts components/graph/Canvas.tsx packages`
Expected: no output (part 5 must not touch them).

- [ ] **Step 4: Commit**

```bash
git add components/maps/ScreensMap.tsx
git commit -m "feat(screens): ⌘K flies to a flow's strip or a view's frame"
```

---

### Task 6: Checks that run without a browser

**Files:** none changed.

- [ ] **Step 1: The part's suites, lint and types**

Run:

```bash
npm run test:command-palette
npm run test:keyboard-shortcuts
npx tsc --noEmit
npm run lint
```

Expected: `All command palette tests passed`; `All keyboard shortcut tests passed`; no `tsc` output; ESLint reports `0 errors` (the warnings it prints today are `@next/next/no-img-element` in `components/panels/PlatformVariants.tsx` and `components/panels/ShotPreviewDialog.tsx`, untouched here).

- [ ] **Step 2: Generated artifacts (CI diffs them)**

Run: `rm -rf tests/app/.test-build-command-palette && npm run generate && git status --porcelain`
Expected: no output. This part imports no new lucide name, so `lib/wobble/wobble-registry.generated.ts` and `app/wobble.generated.css` do not move. If they do, a lucide import slipped in: remove it, or commit the regenerated files with the change that needs them.

- [ ] **Step 3: Build once (CI typechecks through it)**

Run: `npm run build`
Expected: exit 0, the route table printed, no type error.

---

### Task 7: Manual verification in a headless browser (not CI)

Playwright is not a dependency of the repo and must never be installed into it. Everything below happens in a scratch directory outside the worktree, called `$SCRATCH` (your session's scratchpad, e.g. `$SCRATCH=/private/tmp/…/scratchpad/screens-p5-check`).

- [ ] **Step 1: Set up the scratch directory**

```bash
mkdir -p "$SCRATCH" && cd "$SCRATCH"
npm init -y
npm i playwright
npx playwright install chromium
```

- [ ] **Step 2: Start this worktree's dev server on its own port**

Port 4242 may belong to the other checkout (`/Users/alexis/code/arkaik`, never touched). In `/Users/alexis/code/arkaik-screen-wall`, on `feat/screens-palette`:

```bash
lsof -iTCP:4343 -sTCP:LISTEN -P   # must print nothing; if it prints, pick another port and pass BASE_URL
PORT=4343 npm run dev
```

Wait for `✓ Ready`. Restart it after every branch switch (a stale dev server fakes hydration mismatches).

- [ ] **Step 3: Write the script**

Create `$SCRATCH/palette-check.js`:

```js
#!/usr/bin/env node
/**
 * Manual check for the Screens map stack, part 5 (views and flows in ⌘K).
 * Not a CI test. Run from a scratch directory that has `playwright` installed,
 * against this worktree's dev server: `PORT=4343 npm run dev`.
 *
 *   BASE_URL   default http://localhost:4343
 *   WORKTREE   default /Users/alexis/code/arkaik-screen-wall (the seed is read from it)
 *   ONLY       optional comma list of steps: idle,overview,settings,journey,library,delivery,screens
 *
 * Screenshots land next to this script. Exit code 0 only when every check passed.
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const BASE = process.env.BASE_URL ?? "http://localhost:4343";
const WORKTREE = process.env.WORKTREE ?? "/Users/alexis/code/arkaik-screen-wall";
const SEED = path.join(WORKTREE, "seed", "pebbles.json");
const OUT = __dirname;
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : null;
const runs = (step) => ONLY === null || ONLY.has(step);

let passed = 0;
let failed = 0;
function check(name, ok, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`PASS ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function waitFor(probe, timeout = 10_000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await probe();
    if (last) return last;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return last;
}

async function shot(page, name) {
  // A panel slides in; let it finish before a "landed" picture.
  if (name.endsWith("landed")) await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, `p5-${name}.png`) });
}

/** Open ⌘K and return the dialog. */
async function openPalette(page) {
  await page.keyboard.press("ControlOrMeta+k");
  const dialog = page.getByRole("dialog", { name: "Command palette" });
  await dialog.waitFor({ state: "visible" });
  return dialog;
}

/** Section headings (textContent, so CSS `uppercase` does not apply) and rows. */
async function readPalette(dialog) {
  return dialog.getByRole("listbox").evaluate((listbox) =>
    [...listbox.children].map((section) => ({
      heading: section.firstElementChild?.textContent ?? "",
      rows: [...section.querySelectorAll('[role="option"]')].map((option) => ({
        label: option.querySelector(".truncate")?.textContent ?? "",
        hint: option.querySelector(".text-xs")?.textContent ?? null,
      })),
    })),
  );
}

/** Type `query`, wait for `label` (with `hint`) to be the first row, take a shot, press Enter. */
async function choose(page, query, label, hint, shotName) {
  const dialog = await openPalette(page);
  await dialog.getByRole("combobox").fill(query);
  const first = await waitFor(async () => {
    const sections = await readPalette(dialog);
    const row = sections[0]?.rows[0];
    return row && row.label === label ? { row, sections } : null;
  });
  check(`"${query}" puts ${label} first`, Boolean(first), first ? "" : "first row never matched");
  if (first) {
    check(`"${query}" → ${label} hints "${hint}"`, first.row.hint === hint, `got ${first.row.hint}`);
  }
  await shot(page, shotName);
  await page.keyboard.press("Enter");
  await dialog.waitFor({ state: "hidden" });
  return first;
}

async function panelOpen(page, title) {
  const close = page.getByRole("button", { name: `Close ${title}`, exact: true });
  return close
    .waitFor({ state: "visible", timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
}

/** The React Flow node's box lies inside the canvas box (1px tolerance). */
async function insideCanvas(page, nodeId) {
  const node = page.locator(`.react-flow__node[data-id="${nodeId}"]`);
  if ((await node.count()) === 0) return false;
  const [box, canvas] = await Promise.all([node.boundingBox(), page.locator(".react-flow").first().boundingBox()]);
  if (!box || !canvas) return false;
  return (
    box.x >= canvas.x - 1 &&
    box.y >= canvas.y - 1 &&
    box.x + box.width <= canvas.x + canvas.width + 1 &&
    box.y + box.height <= canvas.y + canvas.height + 1
  );
}

async function viewportTransform(page) {
  return page.locator(".react-flow__viewport").first().evaluate((element) => element.style.transform);
}

(async () => {
  const seed = JSON.parse(fs.readFileSync(SEED, "utf8"));
  const catalogueLabels = new Set(["Settings"]);
  const nodeTitles = seed.nodes
    .filter((node) => node.species === "flow" || node.species === "view")
    .map((node) => node.title)
    .filter((title) => !catalogueLabels.has(title));

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  // Import Pebbles through the /projects file input; the app lands on the Overview.
  await page.goto(`${BASE}/projects`);
  await page.locator('input[type="file"]').setInputFiles(SEED);
  await page.waitForURL(/\/project\/[^/]+\/overview/, { timeout: 60_000 });
  const projectId = new URL(page.url()).pathname.split("/")[2];
  const base = `${BASE}/project/${projectId}`;
  console.log(`imported Pebbles as ${projectId}`);

  async function visit(route, ready) {
    await page.goto(`${base}${route}`);
    await page.locator(ready).first().waitFor({ state: "visible", timeout: 60_000 });
  }

  async function idleCheck(where) {
    const dialog = await openPalette(page);
    const sections = await readPalette(dialog);
    const headings = sections.map((section) => section.heading);
    const labels = sections.flatMap((section) => section.rows.map((row) => row.label));
    check(`idle palette on ${where} has no Flows or Views group`, !headings.includes("Flows") && !headings.includes("Views"), headings.join(", "));
    const leaked = labels.filter((label) => nodeTitles.includes(label));
    check(`idle palette on ${where} lists no node row`, leaked.length === 0, leaked.join(", "));
    await shot(page, `idle-${where}`);
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
  }

  const searchOf = () => new URL(page.url()).searchParams;
  const pathOf = () => new URL(page.url()).pathname;
  // The panel opens first; `?node=` follows through a router push.
  const addressed = async (nodeId) => Boolean(await waitFor(async () => searchOf().get("node") === nodeId));

  if (runs("idle")) {
    await visit("/overview", "h1");
    await idleCheck("overview");
  }

  if (runs("overview")) {
    await visit("/overview", "h1");
    await choose(page, "Path", "Path", "Not in a flow", "overview-view");
    await page.waitForURL((url) => url.pathname === `/project/${projectId}/library`, { timeout: 15_000 }).catch(() => {});
    check("Overview + view → the Library", pathOf() === `/project/${projectId}/library`, pathOf());
    check("Overview + view → ?node=V-timeline", await addressed("V-timeline"), page.url());
    check("Overview + view → its panel opens", await panelOpen(page, "Path"));
    await shot(page, "overview-view-landed");

    await visit("/overview", "h1");
    await choose(page, "Swap Glyph", "Swap Glyph", "2 screens", "overview-flow");
    await page.waitForURL((url) => url.pathname === `/project/${projectId}/library`, { timeout: 15_000 }).catch(() => {});
    check("Overview + flow → the Library", pathOf() === `/project/${projectId}/library`, pathOf());
    check("Overview + flow → ?node=F-swap-glyph", await addressed("F-swap-glyph"), page.url());
    check("Overview + flow → its panel opens", await panelOpen(page, "Swap Glyph"));
    await shot(page, "overview-flow-landed");
  }

  if (runs("settings")) {
    await visit("/settings", "h1");
    await choose(page, "home", "Home", "Onboarding", "settings-view");
    await page.waitForURL((url) => url.pathname === `/project/${projectId}/library`, { timeout: 15_000 }).catch(() => {});
    check("Settings + view → the Library", pathOf() === `/project/${projectId}/library`, pathOf());
    check("Settings + view → ?node=V-home", await addressed("V-home"), page.url());
    check("Settings + view → its panel opens", await panelOpen(page, "Home"));
    await shot(page, "settings-view-landed");
  }

  if (runs("journey")) {
    await visit("/maps/journey", ".react-flow__node");
    await idleCheck("journey");
    await choose(page, "Weekly Cairn", "Weekly Cairn", "Weekly Wrap", "journey-view");
    check("Journey + view → its panel opens in place", await panelOpen(page, "Weekly Cairn"));
    check("Journey + view → stays on the Journey map", pathOf() === `/project/${projectId}/maps/journey`, pathOf());
    check("Journey + view → ?node=V-weekly-cairn", await addressed("V-weekly-cairn"), page.url());
    await shot(page, "journey-view-landed");

    await choose(page, "Onboarding", "Onboarding", "5 screens", "journey-flow");
    check("Journey + flow → its panel opens in place", await panelOpen(page, "Onboarding"));
    check("Journey + flow → ?node=F-onboarding", await addressed("F-onboarding"), page.url());
    await shot(page, "journey-flow-landed");
  }

  if (runs("library")) {
    await visit("/library", "h1");
    await choose(page, "Glyphs", "Glyphs", "Manage Glyphs", "library-view");
    check("Library + view → its panel opens in place", await panelOpen(page, "Glyphs"));
    check("Library + view → ?node=V-glyphs-list", await addressed("V-glyphs-list"), page.url());
    await shot(page, "library-view-landed");
  }

  if (runs("delivery")) {
    await visit("/delivery", "h1");
    await choose(page, "Manage Souls", "Manage Souls", "4 screens", "delivery-flow");
    check("Delivery + flow → its panel opens in place", await panelOpen(page, "Manage Souls"));
    check("Delivery + flow → ?node=F-manage-souls", await addressed("F-manage-souls"), page.url());
    await shot(page, "delivery-flow-landed");
  }

  if (runs("screens")) {
    await visit("/maps/screens", '.react-flow__node[data-id^="strip:"]');
    await idleCheck("screens");
    // Let the first-strip camera request settle before measuring.
    await page.waitForTimeout(1_000);

    const before = await viewportTransform(page);
    await choose(page, "Swap Glyph", "Swap Glyph", "2 screens", "screens-flow");
    const header = await waitFor(() => insideCanvas(page, "strip:F-swap-glyph"));
    check("Screens + flow → the camera moved", (await viewportTransform(page)) !== before);
    check("Screens + flow → the Swap Glyph strip header is in view", Boolean(header));
    check("Screens + flow → no panel, no ?node=", !searchOf().has("node") && (await page.getByRole("button", { name: "Close Swap Glyph", exact: true }).count()) === 0, page.url());
    await shot(page, "screens-flow-landed");

    const beforeView = await viewportTransform(page);
    await choose(page, "Register", "Register", "Legal Consent", "screens-view");
    const frame = await waitFor(() => insideCanvas(page, "V-register@F-legal-consent:0"));
    check("Screens + view → the camera moved", (await viewportTransform(page)) !== beforeView);
    check("Screens + view → its first frame is in view", Boolean(frame));
    const inspector = page.locator('section[aria-label="Register on the wall"]');
    check(
      "Screens + view → the frame is selected (inspector shown)",
      await inspector.waitFor({ state: "visible", timeout: 10_000 }).then(() => true).catch(() => false),
    );
    check("Screens + view → no ?node=", !searchOf().has("node"), page.url());
    await shot(page, "screens-view-landed");
  }

  check("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));
  console.log(`console errors: ${consoleErrors.length}`);
  for (const message of consoleErrors) console.log(`  console.error: ${message.slice(0, 200)}`);

  await browser.close();
  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

It imports Pebbles through the `/projects` file input into a fresh browser context (so the project id is `pebbles`), then, at 1440×900:

- **idle**: ⌘K on Overview, Journey and Screens lists no Flows or Views group and no node row;
- **Overview / Settings** (cannot host a panel): a view (`Path`, `home` → Home) and a flow (`Swap Glyph`) land on `/library?node=<id>` with that node's panel open;
- **Journey, Library, Delivery** (host panels): a view and a flow open the panel in place, the route unchanged, `?node=<id>` published;
- **Screens**: a flow (`Swap Glyph`, a late strip) moves the camera until `strip:F-swap-glyph`'s header node is inside the canvas, with no panel and no `?node=`; a view (`Register`) moves the camera until its first frame `V-register@F-legal-consent:0` (the contract's frame id: `createVisualNodeId(viewId, "<flowId>:<path>")`) is inside the canvas, part 4's inspector `section[aria-label="Register on the wall"]` shows, and no `?node=` is published.

Screenshots `p5-*.png` land in `$SCRATCH` (one per typed query, one per landing, one per idle check).

- [ ] **Step 4: Run it**

```bash
cd "$SCRATCH" && node palette-check.js
```

On success it prints exactly these lines, in this order, and exits 0:

```
imported Pebbles as pebbles
PASS idle palette on overview has no Flows or Views group
PASS idle palette on overview lists no node row
PASS "Path" puts Path first
PASS "Path" → Path hints "Not in a flow"
PASS Overview + view → the Library
PASS Overview + view → ?node=V-timeline
PASS Overview + view → its panel opens
PASS "Swap Glyph" puts Swap Glyph first
PASS "Swap Glyph" → Swap Glyph hints "2 screens"
PASS Overview + flow → the Library
PASS Overview + flow → ?node=F-swap-glyph
PASS Overview + flow → its panel opens
PASS "home" puts Home first
PASS "home" → Home hints "Onboarding"
PASS Settings + view → the Library
PASS Settings + view → ?node=V-home
PASS Settings + view → its panel opens
PASS idle palette on journey has no Flows or Views group
PASS idle palette on journey lists no node row
PASS "Weekly Cairn" puts Weekly Cairn first
PASS "Weekly Cairn" → Weekly Cairn hints "Weekly Wrap"
PASS Journey + view → its panel opens in place
PASS Journey + view → stays on the Journey map
PASS Journey + view → ?node=V-weekly-cairn
PASS "Onboarding" puts Onboarding first
PASS "Onboarding" → Onboarding hints "5 screens"
PASS Journey + flow → its panel opens in place
PASS Journey + flow → ?node=F-onboarding
PASS "Glyphs" puts Glyphs first
PASS "Glyphs" → Glyphs hints "Manage Glyphs"
PASS Library + view → its panel opens in place
PASS Library + view → ?node=V-glyphs-list
PASS "Manage Souls" puts Manage Souls first
PASS "Manage Souls" → Manage Souls hints "4 screens"
PASS Delivery + flow → its panel opens in place
PASS Delivery + flow → ?node=F-manage-souls
PASS idle palette on screens has no Flows or Views group
PASS idle palette on screens lists no node row
PASS "Swap Glyph" puts Swap Glyph first
PASS "Swap Glyph" → Swap Glyph hints "2 screens"
PASS Screens + flow → the camera moved
PASS Screens + flow → the Swap Glyph strip header is in view
PASS Screens + flow → no panel, no ?node=
PASS "Register" puts Register first
PASS "Register" → Register hints "Legal Consent"
PASS Screens + view → the camera moved
PASS Screens + view → its first frame is in view
PASS Screens + view → the frame is selected (inspector shown)
PASS Screens + view → no ?node=
PASS no uncaught page errors
console errors: 0
RESULT: 50 passed, 0 failed
```

Any `FAIL` line names the check and what it saw. A `console.error` line is printed under `console errors:`; restart the dev server and rerun before treating one as real, and do not call the part done while one remains. `ONLY=screens node palette-check.js` reruns a single step (it still imports first).

- [ ] **Step 5: Look at the screenshots**

Open `p5-screens-flow-landed.png` (the Swap Glyph strip framed), `p5-screens-view-landed.png` (the Register frame selected, inspector at top right), `p5-overview-view-landed.png` (Library with the Path panel), and one typed palette (`p5-journey-view.png`: a Views group under the typed query, hints at the right). Stop the dev server.

---

## Part done when

- These pass on `feat/screens-palette` alone, in the worktree:

  ```bash
  npm run test:command-palette
  npm run test:keyboard-shortcuts
  npm run test:screen-wall
  npx tsc --noEmit
  npm run lint
  rm -rf tests/app/.test-build-command-palette && npm run generate && git status --porcelain   # prints nothing
  npm run build
  ```

- Task 7's script prints `RESULT: 50 passed, 0 failed` with `console errors: 0`, and the four screenshots in Task 7 Step 5 show what they name.
- `git diff --stat feat/screens-inspect..HEAD` lists only `lib/utils/command-palette.ts`, `components/layout/CommandPalette.tsx`, `lib/hooks/usePageCommands.tsx`, `app/project/[id]/layout.tsx`, `components/maps/ScreensMap.tsx`, `tests/app/command-palette.test.js`.
- PR title: `feat(palette): jump to any view or flow from ⌘K (part 5/5)`. PR body section, ready to paste:

  ````markdown
  ## Lab Note

  ```yaml
  en:
    title: "Jump to any view or flow from ⌘K"
    summary: "Type a view or flow name in the command palette: on the Screens map it flies you straight there, anywhere else it opens it."
  fr:
    title: "Saute vers n'importe quelle vue ou flow avec ⌘K"
    summary: "Tape le nom d'une vue ou d'un flow dans la palette de commandes : sur la carte Screens, tu y files directement ; ailleurs, sa fiche s'ouvre."
  nodes: [V-command-palette, F-navigate-by-keyboard]
  suggested:
    molecule: arkaik
    type: improvement
    tags: [command-palette, navigation]
  ```
  ````

  After opening the PR, read its comments for the Lab Note reminder's verdict and fix the body, not the code.
