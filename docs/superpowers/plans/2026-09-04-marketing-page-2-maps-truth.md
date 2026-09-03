# Marketing Page — Part 2: Landing Scaffold, Maps and Truth Chapters

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Below the untouched hero, render the first two chapters of the marketing page ("Read your product", "Track truth, not fields") as data-driven sections whose previews are real app components over the two shipped seeds, with the content model, fixtures, frame and tests that Parts 3 and 4 will extend.

**Architecture:** `components/landing/content.ts` holds parts, sections and copy; `previews/ids.ts` holds the preview catalogue (id → seed source, frame height, breadcrumb); `previews/registry.tsx` maps ids to components and is type-checked for coverage. `LandingPage` (server) loads both seed JSONs once and loops parts → sections; each section is title → why → `PreviewFrame` (app chrome) → what/how. Previews receive one `ProjectBundle` and derive everything through pure functions (`resolveJourneySelection`, `resolveProductScope`, `resolveMapDisplay`, `computeDeliveryItems`, `computePyramidAggregation`, `computeNodeTimeline`, `computeChangelog`, …). No preview uses a project hook or the data provider.

**Tech Stack:** Next.js 16 App Router (server components plus client leaves), React 19, Tailwind 4 + shadcn tokens, `@xyflow/react` via `JourneyCanvas`/`SystemCanvas` (Part 1), plain-node test loaders (`tests/app/load-*.js` pattern), Playwright in the scratchpad for the smoke run.

**Spec:** `docs/superpowers/specs/2026-09-03-marketing-page-design.md` (§ Page structure, § Visual design, § Architecture, § Preview contract, § Testing). Amended in Task 2 for the two-seed rule.

**Shipping shape:** **PR 2 of the 4-part `gh stack`**, branch `marketing-2-maps-truth` on top of `marketing-1-canvas-split` (PR #413). User-visible, but the page is incomplete until Part 4, so the **Lab Note ships with Part 4**; add the `no-lab-note` label here.

**Data reality that shapes this part (from the seed audit):**
- `seed/arkaik-self-map.json` (231 nodes, 809 events) is **web-only**: no `metadata.platformStatuses` anywhere, no parity gaps, no `supersedes` edges, every acceptance `live`. `PlatformGaugesCard` returns `null` under two platforms.
- `seed/pebbles.json` (152 nodes, 183 events, project id `pebbles`) has three platforms, `V-pebble-detail` with `{ios: live, web: idea, android: idea}`, parity gaps on `AC-pebble-draw-in-animation` and `AC-emotion-palette-on-read`, and `DEC-adopt-glyph-wobble` superseding `DEC-linear-glyph-fade`.
- Therefore every preview declares its **source**: `self-map` for Journey, System, Pyramid, Journal; `pebbles` for Delivery (every self-map view is `live`, so the board would have one column), Overview gauges, Platform statuses, Acceptances, Decisions. The frame caption names the source.

**Repo rails every task must respect:**
- **CI gates on lint.** `npm run lint` must show 0 errors. React Compiler rules are on (`react-hooks/set-state-in-effect`, `react-hooks/refs`).
- **No React render harness exists.** Pure modules get plain-node tests through a loader; components are verified by `tsc`, `build` and the Playwright smoke run.
- **New `@/…` imports silently break test loaders.** `tests/landing/load-landing.js` (Task 3) lists every module and specifier it transpiles; when you add an import to a loaded module, extend the loader's tables. Verify with the **npm script**, never the file.
- **Regenerate before the PR** (`npm run generate`); a new lucide icon dirties generated CSS.
- **Never edit the hero JSX** in `app/page.tsx`; only append a sibling.
- Commit messages end with a blank line then `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

## File structure

| File | Responsibility |
|---|---|
| `components/landing/previews/ids.ts` | `PREVIEW_IDS`, `PreviewId`, `PreviewSource`, `PREVIEW_META` (source, frame height, breadcrumb) — pure |
| `components/landing/content.ts` | `PARTS`, `SECTIONS`, copy — pure |
| `components/landing/fixtures.ts` | node/edge/event ids per preview, keyed by source — pure |
| `lib/landing/slice.ts` | `sliceBundle(bundle, nodeIds)` induced sub-bundle — pure |
| `lib/landing/seeds.ts` | `loadLandingSeeds()` — the two JSON imports typed as `ProjectBundle` |
| `components/landing/fonts.ts` | `gochiHand` (next/font) for the chapter title |
| `components/landing/PreviewFrame.tsx` | app-chrome frame: bar, breadcrumb, LIVE pill, fixed height, caption, error boundary |
| `components/landing/PreviewErrorBoundary.tsx` | client error boundary used by the frame |
| `components/landing/ChapterIndex.tsx` | client: section index that tracks the section in view |
| `components/landing/LandingSection.tsx` | title → why → frame → what/how |
| `components/landing/LandingPart.tsx` | chapter grid: sticky column + sections |
| `components/landing/LandingPage.tsx` | loads seeds, loops parts |
| `components/landing/previews/registry.tsx` | `Record<PreviewId, ComponentType<PreviewProps>>` |
| `components/landing/previews/*Preview.tsx` | nine previews (Task 6–9) |
| `tests/landing/load-landing.js`, `tests/landing/landing.test.js` | loader + suite; `npm run test:landing`; CI step |
| `app/page.tsx` | append `<LandingPage />` after the hero |

---

### Task 1: Branch

- [ ] **Step 1: Add the branch on top of the stack**

```bash
git checkout marketing-1-canvas-split && git status --short   # only package-lock.json may show
gh stack add marketing-2-maps-truth
```

Expected: on `marketing-2-maps-truth`, tracking the stack above `marketing-1-canvas-split`.

---

### Task 2: Spec amendment — two seeds

**Files:** Modify `docs/superpowers/specs/2026-09-03-marketing-page-design.md`

- [ ] **Step 1: Replace settled decision 3**

Find the paragraph starting `3. **The data is Arkaik's own map.**` and replace the whole numbered item with:

```markdown
3. **The data is the two shipped seeds.** Previews read
   `seed/arkaik-self-map.json` (Arkaik's own map) wherever it can carry the
   point, and `seed/pebbles.json` (the built-in example project) where the
   self-map structurally cannot: it is web-only, so it has no per-platform
   statuses, no parity gaps, and no superseded decisions. Each preview
   declares its source and the frame caption names it. Neither seed has a
   `quality` section, so the two Kritik previews read a small hand-authored
   quality fixture typed by `@arkaik/schema`'s quality types and parsed
   through it in a test.
```

- [ ] **Step 2: Update the preview table rows that change source**

In § Preview per section, append ` (Pebbles)` to the Renders cell of rows A4, B1, B2 and B4, and change A4's Renders cell to `PlatformGaugesCard` and `ReleasePulseCard` side by side (Pebbles: the gauges need two platforms).

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-09-03-marketing-page-design.md
git commit -m "docs(spec): previews read both shipped seeds, each declaring its source"
```

---

### Task 3: Preview catalogue, content model, fixtures, tests

**Files:**
- Create: `components/landing/previews/ids.ts`, `components/landing/content.ts`, `components/landing/fixtures.ts`
- Create: `tests/landing/load-landing.js`, `tests/landing/landing.test.js`
- Modify: `package.json` (script), `.github/workflows/ci.yml` (step)

- [ ] **Step 1: Write the loader**

`tests/landing/load-landing.js`:

```js
/**
 * Loads the landing page's pure modules — the preview catalogue, the content
 * model, the fixtures and the slice — into Node without a bundler, the
 * transpile-on-the-fly approach of tests/app/load-delivery.js. Everything here
 * is data or a pure function; the React components that consume them are
 * checked by tsc (registry coverage) and the Playwright smoke run.
 */
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, ".test-build-landing");

// Source path (repo-relative) → build output basename.
const MODULES = [
  ["components/landing/previews/ids.ts", "ids"],
  ["components/landing/content.ts", "content"],
  ["components/landing/fixtures.ts", "fixtures"],
  ["lib/landing/slice.ts", "slice"],
];

// `@/…` specifier → build output basename. Type-only imports are erased by
// transpileModule and need no entry; runtime imports MUST be listed here.
const SPECIFIER_MAP = {
  "@/components/landing/previews/ids": "./ids",
  "@/components/landing/content": "./content",
};

function loadLanding() {
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));

  for (const [srcRel, outName] of MODULES) {
    const source = fs.readFileSync(path.join(ROOT, srcRel), "utf8");
    const { outputText } = ts.transpileModule(source, {
      fileName: path.basename(srcRel),
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    });
    let rewritten = outputText;
    for (const [specifier, target] of Object.entries(SPECIFIER_MAP)) {
      rewritten = rewritten.split(`require("${specifier}")`).join(`require("${target}")`);
    }
    if (/require\("@\//.test(rewritten)) {
      throw new Error(`${srcRel} has an unmapped @/ import — extend SPECIFIER_MAP and MODULES`);
    }
    fs.writeFileSync(path.join(BUILD_DIR, `${outName}.js`), rewritten);
  }
  for (const [, outName] of MODULES) delete require.cache[path.join(BUILD_DIR, `${outName}.js`)];

  return {
    ...require(path.join(BUILD_DIR, "ids.js")),
    ...require(path.join(BUILD_DIR, "content.js")),
    ...require(path.join(BUILD_DIR, "fixtures.js")),
    ...require(path.join(BUILD_DIR, "slice.js")),
  };
}

module.exports = { loadLanding, BUILD_DIR };
```

- [ ] **Step 2: Write the failing test**

`tests/landing/landing.test.js`:

```js
#!/usr/bin/env node
/**
 * The landing page's gates: every fixture id resolves in the seed it names,
 * every section's preview is in the catalogue, every part has sections, copy
 * is non-empty, and the slice is the induced sub-bundle it claims to be.
 */
const fs = require("fs");
const path = require("path");
const { loadLanding } = require("./load-landing");

const { PREVIEW_IDS, PREVIEW_META, PARTS, SECTIONS, FIXTURES, sliceBundle } = loadLanding();

let failures = 0;
function assert(cond, message) {
  if (cond) console.log(`PASS: ${message}`);
  else { failures++; console.log(`FAIL: ${message}`); }
}

const ROOT = path.join(__dirname, "..", "..");
const SEEDS = {
  "self-map": JSON.parse(fs.readFileSync(path.join(ROOT, "seed", "arkaik-self-map.json"), "utf8")),
  pebbles: JSON.parse(fs.readFileSync(path.join(ROOT, "seed", "pebbles.json"), "utf8")),
};
const nodeIds = Object.fromEntries(Object.entries(SEEDS).map(([k, b]) => [k, new Set(b.nodes.map((n) => n.id))]));
const versions = Object.fromEntries(
  Object.entries(SEEDS).map(([k, b]) => [k, new Set((b.journal ?? []).filter((e) => e.type === "release.tagged").map((e) => e.version))]),
);

// Catalogue
assert(PREVIEW_IDS.length > 0, "catalogue is non-empty");
for (const id of PREVIEW_IDS) {
  const meta = PREVIEW_META[id];
  assert(meta && (meta.source === "self-map" || meta.source === "pebbles"), `${id}: names a seed source`);
  assert(meta && Number.isInteger(meta.height) && meta.height >= 160, `${id}: fixed frame height`);
  assert(meta && typeof meta.breadcrumb === "string" && meta.breadcrumb.length > 0, `${id}: breadcrumb`);
}

// Content
assert(PARTS.length > 0, "parts are non-empty");
for (const part of PARTS) {
  const sections = SECTIONS.filter((s) => s.part === part.id);
  assert(sections.length > 0, `part ${part.id}: has sections`);
  assert(part.title && part.intro, `part ${part.id}: title and intro`);
}
for (const s of SECTIONS) {
  assert(PARTS.some((p) => p.id === s.part), `${s.id}: known part`);
  assert(s.title && s.why && s.what && s.how, `${s.id}: why/what/how present`);
  assert(s.preview === "none" || PREVIEW_IDS.includes(s.preview), `${s.id}: preview in catalogue`);
}

// Fixtures: every id exists in the seed the fixture names
for (const [previewId, fixture] of Object.entries(FIXTURES)) {
  const ids = nodeIds[fixture.source];
  assert(ids, `${previewId}: fixture source known`);
  if (!ids) continue;
  for (const id of fixture.nodeIds ?? []) assert(ids.has(id), `${previewId}: node ${id} exists in ${fixture.source}`);
  for (const v of fixture.versions ?? []) assert(versions[fixture.source].has(v), `${previewId}: release ${v} exists in ${fixture.source}`);
  assert(PREVIEW_META[previewId] && PREVIEW_META[previewId].source === fixture.source, `${previewId}: fixture source matches catalogue`);
}

// Slice: induced sub-bundle
{
  const b = SEEDS["self-map"];
  const edge = b.edges.find((e) => e.edge_type === "covers");
  const keep = [edge.source_id, edge.target_id];
  const s = sliceBundle(b, keep);
  assert(s.nodes.length === 2 && s.nodes.every((n) => keep.includes(n.id)), "slice keeps exactly the requested nodes");
  assert(s.edges.every((e) => keep.includes(e.source_id) && keep.includes(e.target_id)), "slice keeps only induced edges");
  assert(s.edges.some((e) => e.id === edge.id), "slice keeps the inducing edge");
  const stray = (s.journal ?? []).find((e) => e.node_id && !keep.includes(e.node_id));
  assert(!stray, "slice keeps only events about kept nodes (plus node-less events)");
  assert((s.journal ?? []).some((e) => e.type === "release.tagged"), "slice keeps release.tagged events");
  assert(s.project === b.project, "slice reuses the project record");
}

if (failures > 0) { console.log(`\n${failures} failure(s)`); process.exit(1); }
console.log("\nAll landing tests passed.");
```

- [ ] **Step 3: Wire the script and CI step**

`package.json` scripts, after `"test:journey-graph"`: `"test:landing": "node tests/landing/landing.test.js",`.

`.github/workflows/ci.yml`, after the "Journey graph golden parity tests" step:

```yaml
      - name: Landing page catalogue, fixtures and slice tests
        run: npm run test:landing
```

- [ ] **Step 4: Run to see it fail**

Run: `npm run test:landing`
Expected: fails with `Cannot find module` for `components/landing/previews/ids.ts` (the loader reads the source file).

- [ ] **Step 5: Write `previews/ids.ts`**

```ts
/**
 * The preview catalogue: every preview the landing page can mount, with the
 * seed it renders and the frame it sits in. Pure data — the React side is
 * `registry.tsx`, whose `Record<PreviewId, …>` makes tsc refuse an id with no
 * component, and this file is what the plain-node test reads.
 */
export type PreviewSource = "self-map" | "pebbles";

export const PREVIEW_IDS = [
  "journey-map",
  "system-map",
  "delivery-board",
  "overview-cards",
  "platform-statuses",
  "acceptance-matrix",
  "value-pyramid",
  "decision-chain",
  "journal-changelog",
] as const;

export type PreviewId = (typeof PREVIEW_IDS)[number];

export interface PreviewMeta {
  source: PreviewSource;
  /** Frame height in px, fixed so canvases mounting never shift the page. */
  height: number;
  /** The in-app path shown in the frame's title bar, e.g. "Project › Delivery". */
  breadcrumb: string;
}

export const PREVIEW_META: Record<PreviewId, PreviewMeta> = {
  "journey-map":       { source: "self-map", height: 420, breadcrumb: "Maps › Journey" },
  "system-map":        { source: "self-map", height: 420, breadcrumb: "Maps › System" },
  "delivery-board":    { source: "self-map", height: 360, breadcrumb: "Project › Delivery" },
  "overview-cards":    { source: "pebbles",  height: 300, breadcrumb: "Project › Overview" },
  "platform-statuses": { source: "pebbles",  height: 200, breadcrumb: "Library › Views" },
  "acceptance-matrix": { source: "pebbles",  height: 340, breadcrumb: "Project › Acceptances" },
  "value-pyramid":     { source: "self-map", height: 320, breadcrumb: "Project › Pyramid" },
  "decision-chain":    { source: "pebbles",  height: 280, breadcrumb: "Project › Decisions" },
  "journal-changelog": { source: "self-map", height: 360, breadcrumb: "Project › Changelog" },
};

export const SOURCE_CAPTION: Record<PreviewSource, string> = {
  "self-map": "Rendered from Arkaik's own map, right now.",
  pebbles: "Rendered from the built-in Pebbles example, right now.",
};
```

- [ ] **Step 6: Write `content.ts`**

Copy comes from the spec's appendix, tightened to one or two sentences each.

```ts
import type { PreviewId } from "@/components/landing/previews/ids";

export type PartId = "maps" | "truth" | "quality" | "agents" | "run";

export interface Part {
  id: PartId;
  title: string;
  intro: string;
}

export interface Section {
  id: string;
  part: PartId;
  title: string;
  why: string;
  what: string;
  how: string;
  preview: PreviewId | "none";
}

/** Page order of chapters. Reordering the page is reordering this array. */
export const PARTS: Part[] = [
  { id: "maps",  title: "Read your product",        intro: "One graph, four maps. A strategist zooms out, an operator zooms in, an agent queries. Same data." },
  { id: "truth", title: "Track truth, not fields",  intro: "Status is a history with a platform, not a dropdown. Every claim on the map can be checked." },
];

/** Page order within each chapter. */
export const SECTIONS: Section[] = [
  {
    id: "journey-map", part: "maps", title: "Journey map", preview: "journey-map",
    why: "Navigation is how people experience a product, so it is the first reading of the map.",
    what: "Flows are ordered playlists of views and sub-flows, with conditions and junctions. Drill from a top-level flow down to a screen.",
    how: "The compose edges are synthesized from the playlist, so a flow cannot lie about its own screens.",
  },
  {
    id: "system-map", part: "maps", title: "System map", preview: "system-map",
    why: "Every backend change starts with the same question: which screens render this, and what does this endpoint feed?",
    what: "Views, API endpoints and data models as tiers, with the cross-layer edges drawn between them.",
    how: "Scoped by a root anchor and laid out by species tier. A custom map is a saved JSON definition, not a feature.",
  },
  {
    id: "delivery-board", part: "maps", title: "Delivery board", preview: "delivery-board",
    why: "\"What is in flight on Android?\" has no answer in a task tracker, because tasks are not screens.",
    what: "A board of (node × platform) items grouped by status. A view live on iOS and in backlog on Android sits in both columns, by design.",
    how: "The rows are the same projection the MCP tool serves, so the board and the agent never disagree.",
  },
  {
    id: "overview-cards", part: "maps", title: "Overview", preview: "overview-cards",
    why: "A strategist wants one screen that says where the product stands.",
    what: "Per-platform delivery gauges, the release pulse, backlog, inventory, parity and quality grade.",
    how: "Every card is a pure projection over the snapshot and the journal. No card computes its own numbers.",
  },
  {
    id: "platform-statuses", part: "truth", title: "Platform statuses", preview: "platform-statuses",
    why: "One status per feature hides that Web shipped and iOS did not.",
    what: "Seven lifecycle statuses, stored per platform, plus a blocked-by flag that keeps the status and names the dependency.",
    how: "Acceptances carry the stored values; views and flows roll them up through one function shared by the app, the CLI and the MCP server.",
  },
  {
    id: "acceptance-matrix", part: "truth", title: "Acceptances and parity", preview: "acceptance-matrix",
    why: "\"Live\" is a claim. An acceptance is a testable promise.",
    what: "Given / When / Then per acceptance, linked to the views it proves, one status column per platform. Parity gaps in one click.",
    how: "Merged pull requests promote acceptances through the GitHub App, scoped per platform.",
  },
  {
    id: "value-pyramid", part: "truth", title: "Value pyramid", preview: "value-pyramid",
    why: "Features should answer \"what value does this create\", not only \"is it done\".",
    what: "Thirty value elements in four tiers, each with a delivery gauge and an acceptance count.",
    how: "Acceptances are tagged with values; the pyramid aggregates them and links back to the matrix.",
  },
  {
    id: "decision-chain", part: "truth", title: "Decisions", preview: "decision-chain",
    why: "A map without its reasons is archaeology.",
    what: "ADR-style decisions with their own status, and three edges: supersedes, generates an acceptance, impacts a node.",
    how: "Decision status maps onto lifecycle status at write time, and the validator flags any mismatch.",
  },
  {
    id: "journal-changelog", part: "truth", title: "Journal and changelog", preview: "journal-changelog",
    why: "\"What changed between versions\" needs history, and history must never bloat the snapshot.",
    what: "An append-only event log; node timelines, changelogs per release, release notes and the backlog are derived from it.",
    how: "The snapshot is authoritative for now, the journal for history, and the validator cross-checks them by value.",
  },
];
```

- [ ] **Step 7: Write `fixtures.ts`**

Ids known from the seed audit are given. Where the list says *pick*, choose with the one-liner below, and paste literal ids — the test pins them.

```bash
node -e 'const b=require("./seed/arkaik-self-map.json");const j=b.journal;const c={};for(const e of j)if(e.type==="node.status_changed")c[e.node_id]=(c[e.node_id]||0)+1;const views=b.nodes.filter(n=>n.species==="view").map(n=>[n.id,c[n.id]||0]).sort((a,b)=>b[1]-a[1]);console.log("timeline candidates",views.slice(0,5));console.log("views",b.nodes.filter(n=>n.species==="view").slice(0,12).map(n=>n.id))'
```

```ts
import type { PreviewId, PreviewSource } from "@/components/landing/previews/ids";

export interface PreviewFixture {
  source: PreviewSource;
  /** Every id here must exist in `source`; the test pins it. */
  nodeIds?: string[];
  /** Release versions that must exist in `source`'s journal. */
  versions?: string[];
}

/**
 * What each preview points at inside its seed. Literal ids, pinned by
 * tests/landing/landing.test.js: a renamed node fails the suite, never renders
 * an empty frame in production.
 */
export const FIXTURES: Record<PreviewId, PreviewFixture> = {
  "journey-map": { source: "self-map", nodeIds: ["F-audit-value-coverage"] },
  "system-map": { source: "self-map", nodeIds: ["DM-node"] },
  // Eight views for three columns — pick ids whose statuses spread across
  // backlog / development / live (the seed is mostly live; take what exists).
  "delivery-board": { source: "self-map", nodeIds: [/* pick 8 view ids */] },
  "overview-cards": { source: "pebbles", versions: ["0.3.0", "0.4.0"] },
  "platform-statuses": { source: "pebbles", nodeIds: ["V-pebble-detail"] },
  "acceptance-matrix": { source: "pebbles", nodeIds: ["AC-pebble-draw-in-animation", "AC-emotion-palette-on-read"] },
  "value-pyramid": { source: "self-map" }, // aggregates every acceptance; no ids to pin
  "decision-chain": { source: "pebbles", nodeIds: ["DEC-adopt-glyph-wobble", "DEC-linear-glyph-fade"] },
  "journal-changelog": {
    source: "self-map",
    nodeIds: [/* pick the view with the most node.status_changed events */],
    versions: ["going-multi-product", "the-self-map"],
  },
};
```

Replace both `/* pick … */` comments with literal ids before committing.

- [ ] **Step 8: Run the test**

Run: `npm run test:landing`
Expected: catalogue, content and fixture assertions `PASS`; the slice block fails with `sliceBundle is not a function` (Task 4).

- [ ] **Step 9: Commit**

```bash
git add components/landing/previews/ids.ts components/landing/content.ts components/landing/fixtures.ts tests/landing package.json .github/workflows/ci.yml
git commit -m "landing: preview catalogue, content model, fixtures and their test"
```

---

### Task 4: `sliceBundle`

**Files:** Create `lib/landing/slice.ts`

- [ ] **Step 1: Write it**

```ts
import type { ProjectBundle, JournalEvent } from "@/lib/data/types";

/**
 * The induced sub-bundle over `nodeIds`: those nodes, every edge with both ends
 * inside, and the journal events that speak about them — plus every event
 * that names no node at all (`release.tagged`, `idea.proposed` without a
 * node), because a changelog excerpt needs its release boundaries. The
 * project record is reused, not cloned: a preview reads it, never writes.
 */
export function sliceBundle(bundle: ProjectBundle, nodeIds: readonly string[]): ProjectBundle {
  const keep = new Set(nodeIds);
  const nodes = bundle.nodes.filter((node) => keep.has(node.id));
  const edges = bundle.edges.filter((edge) => keep.has(edge.source_id) && keep.has(edge.target_id));
  const journal = (bundle.journal ?? []).filter((event) => {
    const nodeId = (event as JournalEvent & { node_id?: unknown }).node_id;
    return typeof nodeId !== "string" || keep.has(nodeId);
  });
  return { ...bundle, nodes, edges, journal };
}
```

If `JournalEvent` already exposes `node_id?: string` on the union, drop the cast.

- [ ] **Step 2: Run the test**

Run: `npm run test:landing`
Expected: `All landing tests passed.`

- [ ] **Step 3: Commit**

```bash
git add lib/landing/slice.ts
git commit -m "landing: sliceBundle, the induced sub-bundle a preview reads"
```

---

### Task 5: Seeds, fonts, frame, chapter shell, page

**Files:** Create `lib/landing/seeds.ts`, `components/landing/fonts.ts`, `components/landing/PreviewErrorBoundary.tsx`, `components/landing/PreviewFrame.tsx`, `components/landing/ChapterIndex.tsx`, `components/landing/LandingSection.tsx`, `components/landing/LandingPart.tsx`, `components/landing/LandingPage.tsx`, `components/landing/previews/registry.tsx` (with the nine components stubbed as `null`-returning placeholders **is forbidden** — instead the registry is created in Task 10; until then `LandingSection` is written against the registry's type and the page is not mounted). Modify `app/page.tsx` in Task 11.

- [ ] **Step 1: `lib/landing/seeds.ts`**

```ts
import arkaikSelfMap from "@/seed/arkaik-self-map.json";
import pebbles from "@/seed/pebbles.json";
import type { ProjectBundle } from "@/lib/data/types";
import type { PreviewSource } from "@/components/landing/previews/ids";

/**
 * The two shipped seeds, as the landing page reads them: build-time JSON
 * imports, typed through the same cast `lib/data/arkaik-seed.ts` uses. Not the
 * seed provider — that module drags the client data layer into a server tree.
 */
export function loadLandingSeeds(): Record<PreviewSource, ProjectBundle> {
  return {
    "self-map": arkaikSelfMap as unknown as ProjectBundle,
    pebbles: pebbles as unknown as ProjectBundle,
  };
}
```

- [ ] **Step 2: `components/landing/fonts.ts`**

```ts
import { Gochi_Hand } from "next/font/google";

/** The hero's handwritten accent, reused for chapter titles (spec § Chapter column). */
export const gochiHand = Gochi_Hand({ subsets: ["latin"], weight: "400" });
```

- [ ] **Step 3: `PreviewErrorBoundary.tsx`**

```tsx
"use client";

import { Component, type ReactNode } from "react";

interface Props { children: ReactNode }
interface State { failed: boolean }

/**
 * Production safety net only: a preview that throws renders an empty frame
 * with one line, never a broken page. The real gate is tests/landing — a
 * fixture id that stops resolving fails CI, it does not reach this boundary.
 */
export class PreviewErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };
  static getDerivedStateFromError(): State { return { failed: true }; }
  render() {
    if (this.state.failed) {
      return <p className="flex h-full items-center justify-center text-sm text-muted-foreground">Preview unavailable.</p>;
    }
    return this.props.children;
  }
}
```

- [ ] **Step 4: `PreviewFrame.tsx`**

```tsx
import type { ReactNode } from "react";
import { PreviewErrorBoundary } from "./PreviewErrorBoundary";

interface PreviewFrameProps {
  /** In-app path shown in the bar, e.g. "Project › Delivery"; from the catalogue. */
  breadcrumb: string;
  /** Fixed body height in px, from the catalogue. */
  height: number;
  /** The one-line source line under the frame. */
  caption: string;
  children: ReactNode;
}

/**
 * The app-chrome frame every preview sits in (spec § Preview frame): two muted
 * dots, the breadcrumb, a LIVE pill; body at the app radius plus 2px with a
 * soft shadow; a caption line beneath. The frame owns height and overflow so
 * previews never set their own outer size, and it holds no copy of its own —
 * breadcrumb and caption arrive as props.
 */
export function PreviewFrame({ breadcrumb, height, caption, children }: PreviewFrameProps) {
  const [root, ...rest] = breadcrumb.split(" › ");
  return (
    <figure className="m-0">
      <div className="overflow-hidden rounded-[calc(var(--radius)+2px)] border bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.12)]">
        <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
          <span aria-hidden className="size-2 rounded-full bg-border" />
          <span aria-hidden className="size-2 rounded-full bg-border" />
          <span className="ml-1.5">
            Arkaik <span aria-hidden>›</span> {root}
            {rest.map((crumb, i) => (
              <span key={crumb}>
                {" "}<span aria-hidden>›</span>{" "}
                <span className={i === rest.length - 1 ? "font-medium text-foreground" : undefined}>{crumb}</span>
              </span>
            ))}
          </span>
          <span className="ml-auto rounded-full bg-foreground px-2 py-0.5 font-mono text-[10px] tracking-[0.12em] text-background">LIVE</span>
        </div>
        <div className="relative overflow-hidden" style={{ height }}>
          <PreviewErrorBoundary>{children}</PreviewErrorBoundary>
        </div>
      </div>
      <figcaption className="mt-2 text-xs text-muted-foreground">{caption}</figcaption>
    </figure>
  );
}
```

- [ ] **Step 5: `ChapterIndex.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";

interface ChapterIndexProps {
  items: { id: string; title: string }[];
}

/**
 * The chapter column's section index: one line per section, the one in view
 * drawn in the foreground with a longer rule (spec § Chapter column). Driven by
 * an IntersectionObserver over the section elements, which the sections mount
 * with `id={section.id}`; each line is an anchor to its section.
 */
export function ChapterIndex({ items }: ChapterIndexProps) {
  const [activeId, setActiveId] = useState<string | null>(items[0]?.id ?? null);

  useEffect(() => {
    const elements = items
      .map((item) => document.getElementById(item.id))
      .filter((el): el is HTMLElement => el !== null);
    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      { rootMargin: "-20% 0px -60% 0px", threshold: 0 },
    );
    for (const el of elements) observer.observe(el);
    return () => observer.disconnect();
  }, [items]);

  return (
    <nav aria-label="Sections" className="mt-6 text-sm leading-8">
      {items.map((item) => {
        const active = item.id === activeId;
        return (
          <a
            key={item.id}
            href={`#${item.id}`}
            aria-current={active ? "true" : undefined}
            className={active ? "flex items-center gap-2 text-foreground" : "flex items-center gap-2 text-muted-foreground hover:text-foreground"}
          >
            <span aria-hidden className={active ? "h-px w-6 bg-foreground transition-all" : "h-px w-3.5 bg-border transition-all"} />
            {item.title}
          </a>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 6: `LandingSection.tsx`**

```tsx
import type { ReactNode } from "react";
import type { Section } from "@/components/landing/content";
import { PreviewFrame } from "@/components/landing/PreviewFrame";
import { PREVIEW_META, SOURCE_CAPTION } from "@/components/landing/previews/ids";

interface LandingSectionProps {
  section: Section;
  /** The preview element for this section, or null for `preview: "none"`. */
  preview: ReactNode;
}

/**
 * One feature, in the approved reading order (spec § Section unit): title,
 * the why in foreground colour, the preview as proof, then what and how as
 * two labelled columns. Copy arrives in `section`; nothing here is literal
 * marketing text.
 */
export function LandingSection({ section, preview }: LandingSectionProps) {
  const meta = section.preview === "none" ? null : PREVIEW_META[section.preview];
  return (
    <section id={section.id} className="scroll-mt-24">
      <h3 className="text-xl font-semibold tracking-tight">{section.title}</h3>
      <p className="mt-2 max-w-prose text-[15px] leading-relaxed text-foreground">{section.why}</p>
      {meta && preview !== null && (
        <div className="mt-5">
          <PreviewFrame breadcrumb={meta.breadcrumb} height={meta.height} caption={SOURCE_CAPTION[meta.source]}>
            {preview}
          </PreviewFrame>
        </div>
      )}
      <dl className="mt-5 grid gap-6 sm:grid-cols-2">
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">What</dt>
          <dd className="mt-1 text-sm leading-relaxed text-muted-foreground">{section.what}</dd>
        </div>
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">How</dt>
          <dd className="mt-1 text-sm leading-relaxed text-muted-foreground">{section.how}</dd>
        </div>
      </dl>
    </section>
  );
}
```

- [ ] **Step 7: `LandingPart.tsx`**

```tsx
import type { ReactNode } from "react";
import type { Part, Section } from "@/components/landing/content";
import { ChapterIndex } from "@/components/landing/ChapterIndex";
import { gochiHand } from "@/components/landing/fonts";

interface LandingPartProps {
  part: Part;
  /** 1-based position and total, for the kicker. */
  number: number;
  total: number;
  sections: Section[];
  children: ReactNode;
}

/**
 * A chapter (spec § Rhythm): the sticky chapter column on the left — mono
 * kicker, handwritten title, one-line intro, the section index — and the
 * sections scrolling on the right. Below 900px the column becomes a header.
 */
export function LandingPart({ part, number, total, sections, children }: LandingPartProps) {
  const kicker = `PART ${String(number).padStart(2, "0")} · OF ${String(total).padStart(2, "0")}`;
  return (
    <section aria-labelledby={`part-${part.id}`} className="grid gap-10 py-20 lg:grid-cols-[1fr_1.7fr] lg:gap-16">
      <div>
        <div className="lg:sticky lg:top-24">
          <p className="font-mono text-[11px] tracking-[0.14em] text-muted-foreground">{kicker}</p>
          <h2 id={`part-${part.id}`} className={`${gochiHand.className} mt-2 text-[40px] leading-none text-foreground`}>{part.title}</h2>
          <p className="mt-3 max-w-[260px] text-sm leading-relaxed text-muted-foreground">{part.intro}</p>
          <div className="hidden lg:block">
            <ChapterIndex items={sections.map((s) => ({ id: s.id, title: s.title }))} />
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-16">{children}</div>
    </section>
  );
}
```

- [ ] **Step 8: `LandingPage.tsx`**

```tsx
import { PARTS, SECTIONS } from "@/components/landing/content";
import { LandingPart } from "@/components/landing/LandingPart";
import { LandingSection } from "@/components/landing/LandingSection";
import { PREVIEW_META } from "@/components/landing/previews/ids";
import { PREVIEW_REGISTRY } from "@/components/landing/previews/registry";
import { loadLandingSeeds } from "@/lib/landing/seeds";

/**
 * Everything below the hero. A loop over `PARTS` → `SECTIONS`: this component
 * holds no copy and no data logic. Seeds load once here and reach each preview
 * as the one bundle its catalogue entry names.
 */
export function LandingPage() {
  const seeds = loadLandingSeeds();
  return (
    <div className="mx-auto w-full max-w-[1200px] px-6">
      {PARTS.map((part, index) => {
        const sections = SECTIONS.filter((section) => section.part === part.id);
        return (
          <LandingPart key={part.id} part={part} number={index + 1} total={PARTS.length} sections={sections}>
            {sections.map((section) => {
              if (section.preview === "none") return <LandingSection key={section.id} section={section} preview={null} />;
              const Preview = PREVIEW_REGISTRY[section.preview];
              const bundle = seeds[PREVIEW_META[section.preview].source];
              return <LandingSection key={section.id} section={section} preview={<Preview bundle={bundle} />} />;
            })}
          </LandingPart>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 9: Typecheck**

Run: `npx tsc --noEmit`
Expected: exactly one error — `@/components/landing/previews/registry` not found. That module is Task 10. Commit anyway; the page is not mounted until Task 11.

- [ ] **Step 10: Commit**

```bash
git add lib/landing/seeds.ts components/landing
git commit -m "landing: seeds, frame, chapter shell and page loop"
```

---

### Task 6: Preview contract and the two canvas previews

**Files:** Create `components/landing/previews/types.ts`, `JourneyMapPreview.tsx`, `SystemMapPreview.tsx`

- [ ] **Step 1: `types.ts`**

```ts
import type { ProjectBundle } from "@/lib/data/types";

/** What every preview receives: the one bundle its catalogue entry names. */
export interface PreviewProps {
  bundle: ProjectBundle;
}
```

- [ ] **Step 2: `JourneyMapPreview.tsx`**

```tsx
"use client";

import { useMemo } from "react";
import { resolveMapDisplay, type MapDefinition } from "@arkaik/schema";
import { JourneyCanvas } from "@/components/graph/JourneyCanvas";
import { FIXTURES } from "@/components/landing/fixtures";
import type { PreviewProps } from "@/components/landing/previews/types";
import { buildProductUsageIndex } from "@/lib/utils/graph-build";
import { computeViewApiRelations, resolveJourneySelection } from "@/lib/utils/journey-graph";
import { resolveProductScope, type ProductGraph } from "@/lib/utils/product-scope";

const [ROOT_FLOW_ID] = FIXTURES["journey-map"].nodeIds!;

const DEFINITION: MapDefinition = { id: "landing-journey", kind: "journey", title: "Journey", root_node_id: ROOT_FLOW_ID };

/**
 * One flow of Arkaik's own journey, expanded, read-only. Every input is a pure
 * function over the bundle — the same ones `JourneyMap` calls through hooks.
 */
export function JourneyMapPreview({ bundle }: PreviewProps) {
  const props = useMemo(() => {
    const dataNodes = bundle.nodes;
    const dataEdges = bundle.edges;
    const nodesById = new Map(dataNodes.map((node) => [node.id, node]));
    const scope = resolveProductScope(bundle, null);
    const graph: ProductGraph = { edges: dataEdges, nodesById, usageIndex: buildProductUsageIndex(dataNodes, dataEdges) };
    const selection = resolveJourneySelection({ definition: DEFINITION, dataNodes, dataEdges, project: bundle.project, scope, graph });
    return {
      scope,
      selection,
      display: resolveMapDisplay(DEFINITION, bundle.project),
      viewApiRelationsByViewId: computeViewApiRelations(dataEdges, nodesById),
      expandedFlows: new Set([ROOT_FLOW_ID]),
      dataEdges,
    };
  }, [bundle]);

  if (props.selection.emptyReason !== null) return null;

  return (
    <JourneyCanvas
      dataNodes={props.selection.nodes}
      dataEdges={props.dataEdges}
      nodesById={props.selection.nodesById}
      composeParentByChild={props.selection.composeParentByChild}
      explicitRootNode={props.selection.anchorNode}
      composeClosure={props.selection.composeClosure}
      expandedFlows={props.expandedFlows}
      display={props.display}
      viewApiRelationsByViewId={props.viewApiRelationsByViewId}
      scope={props.scope}
      minimapColor={props.display.minimap_color}
      readOnly
    />
  );
}
```

Check `MapDefinition`'s required fields in `packages/schema/src/maps.ts:97-115` and `buildProductUsageIndex`'s home (`lib/utils/graph-build.ts` or `@arkaik/schema`; `tests/app/load-delivery.js` imports it from the schema). Adjust the import, not the design.

- [ ] **Step 3: `SystemMapPreview.tsx`**

```tsx
"use client";

import { useMemo } from "react";
import { resolveMapDisplay, type MapDefinition } from "@arkaik/schema";
import { SystemCanvas } from "@/components/graph/SystemCanvas";
import { FIXTURES } from "@/components/landing/fixtures";
import type { PreviewProps } from "@/components/landing/previews/types";
import { buildProductUsageIndex } from "@/lib/utils/graph-build";
import { resolveProductScope, type ProductGraph } from "@/lib/utils/product-scope";

const [ANCHOR_ID] = FIXTURES["system-map"].nodeIds!;

const DEFINITION: MapDefinition = {
  id: "landing-system",
  kind: "system",
  title: "System",
  root_node_id: ANCHOR_ID,
  layout: { algorithm: "layered" },
};

/** The system tiers around one data model of Arkaik's own map, tiered, read-only. */
export function SystemMapPreview({ bundle }: PreviewProps) {
  const props = useMemo(() => {
    const nodesById = new Map(bundle.nodes.map((node) => [node.id, node]));
    const scope = resolveProductScope(bundle, null);
    const graph: ProductGraph = { edges: bundle.edges, nodesById, usageIndex: buildProductUsageIndex(bundle.nodes, bundle.edges) };
    return { scope, productScope: { scope, graph }, display: resolveMapDisplay(DEFINITION, bundle.project) };
  }, [bundle]);

  return (
    <SystemCanvas
      definition={DEFINITION}
      dataNodes={bundle.nodes}
      dataEdges={bundle.edges}
      display={props.display}
      productScope={props.productScope}
      layoutMode="tiered"
      minimapColor={props.display.minimap_color}
      readOnly
    />
  );
}
```

If `computeMapSubgraph` with a `root_node_id` on a system map draws the whole product rather than a neighbourhood, check `packages/schema/src/maps.ts` § Subgraph Algorithm rule 3 (undirected BFS from the root) and, if a depth option exists, pass it; otherwise report the node count in the smoke run and we scope by a `product` in Part 3 if it is too dense.

- [ ] **Step 4: Typecheck and lint**

Run: `npx tsc --noEmit 2>&1 | grep -v registry; npm run lint`
Expected: no errors other than the missing registry.

- [ ] **Step 5: Commit**

```bash
git add components/landing/previews/types.ts components/landing/previews/JourneyMapPreview.tsx components/landing/previews/SystemMapPreview.tsx
git commit -m "landing: journey and system map previews over the self-map"
```

---

### Task 7: Delivery board and Overview previews

**Files:** Create `DeliveryBoardPreview.tsx`, `OverviewCardsPreview.tsx` under `components/landing/previews/`

- [ ] **Step 1: `DeliveryBoardPreview.tsx`**

```tsx
"use client";

import { useMemo } from "react";
import { DeliveryBoard } from "@/components/delivery/DeliveryBoard";
import { FIXTURES } from "@/components/landing/fixtures";
import type { PreviewProps } from "@/components/landing/previews/types";
import { SPECIES } from "@/lib/config/species";
import { STATUSES, type StatusId } from "@/lib/config/statuses";
import { sliceBundle } from "@/lib/landing/slice";
import { computeDeliveryItems, groupItemsByStatus } from "@/lib/utils/delivery";

const COLUMNS: StatusId[] = ["idea", "development", "live"];
const STATUS_LABEL = Object.fromEntries(STATUSES.map((s) => [s.id, s.label])) as Record<StatusId, string>;
const SPECIES_LABEL = Object.fromEntries(SPECIES.map((s) => [s.id, s.label]));
const SPECIES_DESCRIPTION = Object.fromEntries(SPECIES.map((s) => [s.id, s.description]));

/** Three columns of the real board over five Pebbles views; one of them sits in two columns. */
export function DeliveryBoardPreview({ bundle }: PreviewProps) {
  const columns = useMemo(() => {
    const slice = sliceBundle(bundle, FIXTURES["delivery-board"].nodeIds!);
    const grouped = groupItemsByStatus(computeDeliveryItems(slice.nodes, ["view"]), COLUMNS);
    return COLUMNS.map((status) => ({ status, label: STATUS_LABEL[status], items: grouped.get(status) ?? [] }));
  }, [bundle]);

  return (
    <div className="h-full overflow-x-auto p-3">
      <DeliveryBoard columns={columns} speciesLabelById={SPECIES_LABEL} speciesDescriptionById={SPECIES_DESCRIPTION} onSelectItem={() => {}} />
    </div>
  );
}
```

- [ ] **Step 2: `OverviewCardsPreview.tsx`**

```tsx
"use client";

import { useMemo } from "react";
import { PlatformGaugesCard } from "@/components/overview/PlatformGaugesCard";
import { ReleasePulseCard } from "@/components/overview/ReleasePulseCard";
import type { PreviewProps } from "@/components/landing/previews/types";
import { computeProductRollup, computeReleasePulse } from "@/lib/utils/coverage";
import { getRollupPlatforms } from "@/lib/utils/platform-status";

/**
 * The gauges row and the release pulse, from the Pebbles example: the gauges
 * need two platforms to draw rings and the self-map is web-only.
 */
export function OverviewCardsPreview({ bundle }: PreviewProps) {
  const props = useMemo(() => {
    const rollup = computeProductRollup(bundle.nodes, bundle.edges);
    const nodesById = new Map(bundle.nodes.map((node) => [node.id, node]));
    return { rollup, platforms: getRollupPlatforms(rollup), releases: computeReleasePulse(bundle.journal ?? [], { nodesById }) };
  }, [bundle]);

  return (
    <div className="grid h-full gap-4 overflow-hidden p-4 lg:grid-cols-2">
      <PlatformGaugesCard rollup={props.rollup} platforms={props.platforms} projectId={bundle.project.id} />
      <ReleasePulseCard releases={props.releases.slice(0, 3)} projectId={bundle.project.id} />
    </div>
  );
}
```

Both cards link into `/project/{projectId}/…`; for `pebbles` that route exists only after the example is imported. Acceptable for this part; Part 4 decides whether to point at the public seed instead.

- [ ] **Step 3: Typecheck, lint, commit**

Run: `npx tsc --noEmit 2>&1 | grep -v registry; npm run lint`

```bash
git add components/landing/previews/DeliveryBoardPreview.tsx components/landing/previews/OverviewCardsPreview.tsx
git commit -m "landing: delivery board and overview previews"
```

---

### Task 8: Platform statuses, acceptance matrix, pyramid previews

**Files:** Create `PlatformStatusesPreview.tsx`, `AcceptanceMatrixPreview.tsx`, `ValuePyramidPreview.tsx`

- [ ] **Step 1: `PlatformStatusesPreview.tsx`** (tailored, composed from the real leaf primitives)

```tsx
"use client";

import { useMemo } from "react";
import { PlatformList } from "@/components/graph/nodes/PlatformList";
import { StatusBadge } from "@/components/layout/StatusBadge";
import { FIXTURES } from "@/components/landing/fixtures";
import type { PreviewProps } from "@/components/landing/previews/types";
import { addNodeToRollup, createEmptyRollup, getEffectivePlatformStatuses, getRollupDisplayStatus } from "@/lib/utils/platform-status";

const [VIEW_ID] = FIXTURES["platform-statuses"].nodeIds!;

/**
 * One view of the Pebbles example: its rollup badge above, its per-platform
 * marks below — the same primitives the node cards and the detail panel draw.
 */
export function PlatformStatusesPreview({ bundle }: PreviewProps) {
  const view = useMemo(() => {
    const node = bundle.nodes.find((n) => n.id === VIEW_ID);
    if (!node) return null;
    const platformStatuses = getEffectivePlatformStatuses(node, bundle.nodes, bundle.edges);
    const rollup = addNodeToRollup(createEmptyRollup(), node);
    return { node, platformStatuses, displayStatus: getRollupDisplayStatus(rollup, node.status) };
  }, [bundle]);

  if (!view) return null;
  const blockedBy = typeof view.node.metadata?.blocked_by === "string" ? view.node.metadata.blocked_by : undefined;

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
      <div className="flex items-center gap-3">
        <span className="text-base font-medium">{view.node.title}</span>
        <StatusBadge status={view.displayStatus} blockedBy={blockedBy} />
      </div>
      <PlatformList platforms={view.node.platforms} platformStatuses={view.platformStatuses} />
    </div>
  );
}
```

Confirm `PlatformList` renders one `StatusMark` per platform with its label (read `components/graph/nodes/PlatformList.tsx`); if it renders icons only, add the platform label beside each mark inside this preview using `PLATFORMS` from `lib/config/platforms`.

- [ ] **Step 2: `AcceptanceMatrixPreview.tsx`** (real component; it calls `useEffectiveProduct`, which reads `useSearchParams`, so it mounts inside `Suspense`)

```tsx
"use client";

import { Suspense, useMemo } from "react";
import { AcceptanceMatrix } from "@/components/acceptances/AcceptanceMatrix";
import { FIXTURES } from "@/components/landing/fixtures";
import type { PreviewProps } from "@/components/landing/previews/types";

/**
 * The real matrix over the Pebbles acceptances, all groups expanded, so the
 * parity-gap rows the fixture pins are on screen. `AcceptanceMatrix` reads the
 * product override from the URL, hence the Suspense boundary.
 */
export function AcceptanceMatrixPreview({ bundle }: PreviewProps) {
  const props = useMemo(() => {
    const nodesById = new Map(bundle.nodes.map((node) => [node.id, node]));
    const pinned = new Set(FIXTURES["acceptance-matrix"].nodeIds!);
    const acceptances = bundle.nodes.filter((node) => node.species === "acceptance");
    // Pinned rows first, so the gap the copy talks about is the first thing seen.
    acceptances.sort((a, b) => Number(pinned.has(b.id)) - Number(pinned.has(a.id)));
    return { acceptances, nodesById };
  }, [bundle]);

  return (
    <div className="h-full overflow-auto p-3">
      <Suspense fallback={null}>
        <AcceptanceMatrix
          acceptances={props.acceptances}
          edges={bundle.edges}
          nodesById={props.nodesById}
          onSelect={() => {}}
          projectId={bundle.project.id}
          project={bundle}
          allExpanded
        />
      </Suspense>
    </div>
  );
}
```

If `useEffectiveProduct` → `useProductScope(projectId)` touches the data provider or localStorage and throws outside the project shell, report it: the fallback is to render `groupAcceptancesByAnchor` rows with the matrix's own row primitives, and that is a decision for the controller, not a silent switch.

- [ ] **Step 3: `ValuePyramidPreview.tsx`**

```tsx
"use client";

import { useMemo } from "react";
import { PyramidElementCard } from "@/components/pyramid/PyramidElementCard";
import { PyramidTierGroup } from "@/components/pyramid/PyramidTierGroup";
import type { PreviewProps } from "@/components/landing/previews/types";
import { VALUES, VALUE_TIERS_CONFIG } from "@/lib/config/values";
import { SEED_PROJECT_ID } from "@/lib/data/seed-project-id";
import { computePyramidAggregation } from "@/lib/utils/pyramid";

const VALUE_LABEL = Object.fromEntries(VALUES.map((v) => [v.id, v.label]));
const VALUE_DESCRIPTION = Object.fromEntries(VALUES.map((v) => [v.id, v.description]));

/**
 * One tier of the pyramid over every acceptance of Arkaik's own map: the tier
 * with the most addressed elements, its three most-covered elements as cards.
 * Cards link into the public self-map's acceptance matrix, pre-filtered.
 */
export function ValuePyramidPreview({ bundle }: PreviewProps) {
  const tier = useMemo(() => {
    const acceptances = bundle.nodes.filter((node) => node.species === "acceptance");
    const tiers = computePyramidAggregation(acceptances);
    const scored = tiers.map((t) => ({ ...t, addressed: t.elements.filter((e) => e.acceptanceCount > 0).length }));
    scored.sort((a, b) => b.addressed - a.addressed);
    const best = scored[0];
    if (!best) return null;
    const elements = [...best.elements].sort((a, b) => b.acceptanceCount - a.acceptanceCount).slice(0, 3);
    const config = VALUE_TIERS_CONFIG.find((c) => c.id === best.tier);
    return { ...best, elements, label: config?.label ?? best.tier, color: config?.color ?? "#94a3b8" };
  }, [bundle]);

  if (!tier) return null;

  return (
    <div className="h-full overflow-hidden p-4">
      <PyramidTierGroup label={tier.label} color={tier.color} elementCount={tier.elements.length} addressedCount={tier.addressed}>
        {tier.elements.map((element) => (
          <PyramidElementCard
            key={element.value}
            element={element}
            label={VALUE_LABEL[element.value]}
            description={VALUE_DESCRIPTION[element.value]}
            href={`/project/${SEED_PROJECT_ID}/acceptances?value=${element.value}`}
            platforms={["web"]}
          />
        ))}
      </PyramidTierGroup>
    </div>
  );
}
```

Check `VALUE_TIERS_CONFIG`'s element shape in `lib/config/values.ts:4-9` (`id`/`label`/`color`) and adjust the property names, not the design.

- [ ] **Step 4: Typecheck, lint, commit**

Run: `npx tsc --noEmit 2>&1 | grep -v registry; npm run lint`

```bash
git add components/landing/previews/PlatformStatusesPreview.tsx components/landing/previews/AcceptanceMatrixPreview.tsx components/landing/previews/ValuePyramidPreview.tsx
git commit -m "landing: platform statuses, acceptance matrix and pyramid previews"
```

---

### Task 9: Decisions and journal previews

**Files:** Create `DecisionChainPreview.tsx`, `JournalChangelogPreview.tsx`

- [ ] **Step 1: `DecisionChainPreview.tsx`** (the real log over the two pinned decisions; its supersession chain is computed inside the component)

```tsx
"use client";

import { useMemo } from "react";
import { DecisionLog } from "@/components/decisions/DecisionLog";
import { FIXTURES } from "@/components/landing/fixtures";
import type { PreviewProps } from "@/components/landing/previews/types";
import { sliceBundle } from "@/lib/landing/slice";

/** Two Pebbles decisions, one superseding the other, as the real log draws them. */
export function DecisionChainPreview({ bundle }: PreviewProps) {
  const slice = useMemo(() => sliceBundle(bundle, FIXTURES["decision-chain"].nodeIds!), [bundle]);
  return (
    <div className="h-full overflow-hidden p-3">
      <DecisionLog decisions={slice.nodes} allEdges={slice.edges} journal={slice.journal} onSelect={() => {}} statusFilter="all" />
    </div>
  );
}
```

Confirm `DecisionStatusFilter` accepts `"all"` (read `components/decisions/DecisionFilterBar.tsx` or the log's import).

- [ ] **Step 2: `JournalChangelogPreview.tsx`** (timeline left, changelog excerpt right, both from `FeedRow`)

```tsx
"use client";

import { useMemo } from "react";
import { FeedRow } from "@/components/journal/FeedRow";
import { FIXTURES } from "@/components/landing/fixtures";
import type { PreviewProps } from "@/components/landing/previews/types";
import { computeChangelog, computeNodeTimeline } from "@/lib/utils/journal";

const [TIMELINE_NODE_ID] = FIXTURES["journal-changelog"].nodeIds!;
const [FROM_VERSION, TO_VERSION] = FIXTURES["journal-changelog"].versions!;

/**
 * Left: one view's timeline. Right: what changed between Arkaik's last two
 * releases. Both are projections over the self-map's own journal.
 */
export function JournalChangelogPreview({ bundle }: PreviewProps) {
  const props = useMemo(() => {
    const journal = bundle.journal ?? [];
    const nodesById = new Map(bundle.nodes.map((node) => [node.id, node]));
    const timeline = computeNodeTimeline(journal, TIMELINE_NODE_ID).slice(-5);
    const changelog = computeChangelog(journal, TO_VERSION, { fromVersion: FROM_VERSION, nodesById });
    return { nodesById, timeline, changelog, title: nodesById.get(TIMELINE_NODE_ID)?.title ?? TIMELINE_NODE_ID };
  }, [bundle]);

  return (
    <div className="grid h-full gap-4 overflow-hidden p-4 lg:grid-cols-2">
      <div className="min-w-0">
        <p className="mb-2 truncate text-xs font-medium text-muted-foreground">{props.title}</p>
        <ul className="divide-y">
          {props.timeline.map((event) => <li key={event.id}><FeedRow event={event} nodesById={props.nodesById} /></li>)}
        </ul>
      </div>
      <div className="min-w-0">
        <p className="mb-2 text-xs font-medium text-muted-foreground">{FROM_VERSION} → {TO_VERSION}</p>
        <ul className="divide-y">
          {props.changelog.events.slice(0, 5).map((event) => <li key={event.id}><FeedRow event={event} nodesById={props.nodesById} /></li>)}
        </ul>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck, lint, commit**

```bash
git add components/landing/previews/DecisionChainPreview.tsx components/landing/previews/JournalChangelogPreview.tsx
git commit -m "landing: decisions and journal previews"
```

---

### Task 10: Registry

**Files:** Create `components/landing/previews/registry.tsx`

- [ ] **Step 1: Write it**

```tsx
import type { ComponentType } from "react";
import type { PreviewId } from "@/components/landing/previews/ids";
import type { PreviewProps } from "@/components/landing/previews/types";
import { AcceptanceMatrixPreview } from "./AcceptanceMatrixPreview";
import { DecisionChainPreview } from "./DecisionChainPreview";
import { DeliveryBoardPreview } from "./DeliveryBoardPreview";
import { JournalChangelogPreview } from "./JournalChangelogPreview";
import { JourneyMapPreview } from "./JourneyMapPreview";
import { OverviewCardsPreview } from "./OverviewCardsPreview";
import { PlatformStatusesPreview } from "./PlatformStatusesPreview";
import { SystemMapPreview } from "./SystemMapPreview";
import { ValuePyramidPreview } from "./ValuePyramidPreview";

/**
 * Id → component. `Record<PreviewId, …>` is the coverage gate: an id added to
 * the catalogue without a component here is a type error, not an empty frame.
 */
export const PREVIEW_REGISTRY: Record<PreviewId, ComponentType<PreviewProps>> = {
  "journey-map": JourneyMapPreview,
  "system-map": SystemMapPreview,
  "delivery-board": DeliveryBoardPreview,
  "overview-cards": OverviewCardsPreview,
  "platform-statuses": PlatformStatusesPreview,
  "acceptance-matrix": AcceptanceMatrixPreview,
  "value-pyramid": ValuePyramidPreview,
  "decision-chain": DecisionChainPreview,
  "journal-changelog": JournalChangelogPreview,
};
```

- [ ] **Step 2: Typecheck fully clean, lint, tests**

Run: `npx tsc --noEmit && npm run lint && npm run test:landing`
Expected: all clean.

- [ ] **Step 3: Commit**

```bash
git add components/landing/previews/registry.tsx
git commit -m "landing: preview registry, type-checked for catalogue coverage"
```

---

### Task 11: Mount below the hero

**Files:** Modify `app/page.tsx`

- [ ] **Step 1: Append a sibling, hero untouched**

Wrap the returned JSX in a fragment: keep the existing `<div className="relative flex min-h-screen …">…</div>` byte-for-byte, and add after its closing tag:

```tsx
      <LandingPage />
```

Import: `import { LandingPage } from "@/components/landing/LandingPage";`. The hero's outer div keeps `min-h-screen`, `overflow-hidden` and its absolute background, so the terrain stays confined to the hero (spec § Rhythm).

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: compiles; `/` remains dynamic (`force-dynamic` unchanged).

- [ ] **Step 3: Commit**

```bash
git add app/page.tsx
git commit -m "Landing chapters mount below the hero"
```

---

### Task 12: Smoke run and visual check

Uses the scratchpad Playwright already installed for Part 1 (`$SCRATCHPAD/node_modules/playwright`, Chromium cached). A dev server on 4242 must be running (`npm run dev`, or reuse a running one).

- [ ] **Step 1: Write `$SCRATCHPAD/smoke-landing.mjs`**

```js
import { chromium } from "playwright";

const base = "http://localhost:4242";
const browser = await chromium.launch();
const errors = [];
for (const [name, viewport, scheme] of [["desktop-light", { width: 1280, height: 900 }, "light"], ["desktop-dark", { width: 1280, height: 900 }, "dark"], ["mobile-light", { width: 390, height: 844 }, "light"]]) {
  const page = await browser.newPage({ viewport, colorScheme: scheme });
  page.on("pageerror", (e) => errors.push(`${name}: ${e}`));
  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  const frames = await page.locator("figure").count();
  const canvases = await page.locator(".react-flow__node").count();
  const unavailable = await page.getByText("Preview unavailable.").count();
  const bodyWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  console.log(`${name}: frames=${frames} canvasNodes=${canvases} unavailable=${unavailable} scrollWidth=${bodyWidth}`);
  await page.screenshot({ path: `landing-${name}.png`, fullPage: true });
  await page.close();
}
console.log(`page errors: ${errors.length}`); for (const e of errors) console.log("  " + e);
await browser.close();
process.exit(errors.length === 0 ? 0 : 1);
```

- [ ] **Step 2: Run it**

Run: `cd "$SCRATCHPAD" && node smoke-landing.mjs`
Expected: `frames=9`, `canvasNodes ≥ 5`, `unavailable=0`, `scrollWidth` equal to the viewport width on all three, `page errors: 0`.

- [ ] **Step 3: Look at the screenshots**

Open the three PNGs with the Read tool. Check: the hero is unchanged; chapter column sticks while sections scroll (desktop); Gochi Hand title; every frame shows real content, not an empty body; dark mode has no white patches inside frames; mobile stacks the column above sections with no horizontal scroll. Fix anything wrong in the component it belongs to, re-run, and note in the report what changed.

---

### Task 13: Regenerate, PR

- [ ] **Step 1: Regenerate and check**

Run: `npm run generate && git status --short`
Expected: clean or only generated files (commit them).

- [ ] **Step 2: Submit the stack**

```bash
gh stack submit --auto --open
gh pr edit <new PR number> --title "marketing 2: landing chapters — maps and truth" --add-label no-lab-note --body "$(cat <<'EOF'
Part 2 of 4 for the marketing page (spec: docs/superpowers/specs/2026-09-03-marketing-page-design.md). Stacked on #413.

Below the untouched hero: the first two chapters, "Read your product" and "Track truth, not fields", as data-driven sections with nine live previews — real app components over the two shipped seeds (self-map where it can carry the point, Pebbles where the self-map is structurally web-only).

- `components/landing/content.ts` — parts, sections, copy (the page is data)
- `previews/ids.ts` + `registry.tsx` — catalogue and type-checked coverage
- `fixtures.ts` + `tests/landing` — every pinned id must exist in its seed (`npm run test:landing`, in CI)
- `PreviewFrame` app chrome, sticky chapter column with a tracking index
- `lib/landing/slice.ts` — induced sub-bundle a preview reads

Page is incomplete until Part 4, which carries the Lab Note.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Read the PR comments and checks**

Run: `gh pr view <n> --comments` and `gh pr checks <n> --watch`. Expected: reminder silenced by the label; build, services and the new landing step green.

---

## Self-review

**Spec coverage:** § Page structure A1–A4, B1–B5 (Tasks 6–9); § Visual design chapter column, section unit, frame, theme/responsive (Task 5, verified Task 12); § Architecture file list (all files except `quality-fixture.ts`, the generated samples and the Part 3/4 previews, which are theirs); § Preview contract (types.ts, no hooks, frame-owned size, no copy); § Error handling (boundary + test); § Testing (`test:landing`, slice unit assertions, smoke). Settled decision 3 amended (Task 2).

**Type consistency:** `PreviewProps { bundle }` (Task 6) is what `LandingPage` passes (Task 5) and what every preview and the registry (Task 10) use. `PREVIEW_META[id].source` keys `loadLandingSeeds()` (both `Record<PreviewSource, …>`). `FIXTURES` is `Record<PreviewId, PreviewFixture>` and every preview indexes it by its own id. `LandingSection` receives `preview: ReactNode` and reads `PREVIEW_META` itself, so the page never has to know frame heights.

**Placeholders:** the two `/* pick … */` markers in fixtures are explicit instructions with the script that resolves them and a test that fails until they are literal ids. The registry is deliberately last so no stub components ever exist.
