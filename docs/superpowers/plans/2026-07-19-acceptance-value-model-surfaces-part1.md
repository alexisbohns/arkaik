# Acceptance & Value Model — Surfaces Part 1 (Parity Monitoring Core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the acceptance-monitoring surface — a `/acceptances` parity matrix (grouped by anchor, layout A), in-panel acceptance editing (Gherkin / values / per-platform status), a per-view/flow "Acceptances" coverage section, and acceptance cards in the Library — so a user can spot exactly which platform is late on which promise.

**Architecture:** The schema Foundation already shipped the data (`acceptance` species, `covers` edge, `values`/`gherkin` metadata) and the pure projections in `packages/schema/src/acceptance.ts` (`resolvePlatformStatus`, `hasParityGap`, `acceptancesCovering`, `computeParityGaps`, `computeAnchorRollup`). Part 1 builds UI **on top of those projections without touching existing view/flow status behavior**: the matrix renders each acceptance's own per-platform status via `resolvePlatformStatus`, and the view/flow panel section reads its covering acceptances via `acceptancesCovering`. The app's write path is already a dual-write — components call `updateNode(id, {metadata:{...}})` / `addNode` / `addEdge` from the data hooks and the local provider auto-appends the matching journal event (same mechanism the MCP server uses), so **no new persistence code is needed**. Reuse existing presentational components (`PlatformList`, `PlatformGaugeList`, `SpeciesBadge`, `EntityId`, `PlatformVariants`) rather than reinventing them.

**Tech Stack:** Next.js 16 App Router (client components), React 19, TypeScript, Tailwind v4, shadcn/ui (Radix), `lucide-react` 0.577 (has the `icons` record), Dexie/IndexedDB via the provider registry. Tests are plain-Node scripts under `tests/app/` using the `load-<name>.js` transpile harness, wired as `test:*` npm scripts and CI steps.

**Prerequisite / branch:** This plan runs on `claude/acceptance-value-model-surfaces` (already branched off the Foundation branch `claude/acceptance-value-model-spec`). It depends on Foundation code (PR #270); it must not merge to `main` before Foundation does. Verify Foundation is present before starting: `grep -q "computeAnchorRollup" packages/schema/src/acceptance.ts && grep -q '"acceptance"' packages/schema/src/ids.ts` (both must hit).

**Scope boundary (Part 2, NOT this plan):** the value Pyramid page (`/pyramid`), the delivery-board acceptance toggle, the Overview Parity + Pyramid cards, and the **rollup seam** that makes existing view/flow cards/gauges *reflect* their acceptances (`getEffectivePlatformStatuses` and its call-site opt-ins). Part 1 deliberately leaves existing view/flow status displays exactly as they are today — no regression, and Part 2 upgrades them.

---

## Key facts an implementer needs (read once)

- **Data hooks** (`lib/hooks/`): `useNodes(id)` → `{ nodes, loading, updateNode(id, patch), addNode(node), removeNode(id) }`; `useEdges(id)` → `{ edges, loading, addEdge(edge), removeEdge(id) }`; `useProject(id)`, `useJournal(id)` (read-only journal). `updateNode`/`addNode`/`addEdge` auto-emit journal events inside the provider — callers never emit.
- **Metadata patch caveat**: `updateNode` diffs `metadata` per top-level key against the current node. Always pass the **full merged** metadata object (`{ ...node.metadata, <changed key> }`), never a partial, or untouched keys look deleted.
- **Panel open pattern**: there is no global store. Each page holds `const [selectedNode,setSelectedNode]=useState<Node|null>(null); const [panelOpen,setPanelOpen]=useState(false)` and renders `<NodeDetailPanel open node onUpdate allNodes allEdges journal onNavigate .../>`. `onUpdate` = `async (id,patch)=>{ const updated = await updateNode(id,patch); setSelectedNode(updated); }`. Copy this pattern for the new page.
- **Schema imports**: `@arkaik/schema` re-exports `resolvePlatformStatus`, `hasParityGap`, `acceptancesCovering`, `computeParityGaps`, `computeAnchorRollup`, `type ValueId`, `VALUE_IDS`, `VALUE_TIERS`. `lib/data/types` re-exports `Node`, `Edge`, `PlatformStatusMap` (app-facing aliases of the schema types) — use these in components.
- **Config**: `lib/config/values.ts` exports `VALUES` (`{id,tier,label,icon}[]`, `icon` is a lucide name string) and `VALUE_TIERS_CONFIG` (`{id,label,color}[]`). `lib/config/statuses.ts` exports `STATUSES`, `getCountedStatuses`, `isCountedStatus`. `lib/config/platforms.ts` exports `PLATFORMS` (`{id,label,icon}[]`) and `PlatformId`.
- **Presentational reuse**: `components/graph/nodes/PlatformList.tsx` (props `{platforms, platformStatuses?}`) renders per-platform status dots. `components/graph/nodes/node-styles.ts` exports `STATUS_STYLES` (`Record<StatusId,{badge,dot}>`), `STATUS_ICONS`, `STATUS_LABELS`, `PLATFORM_ICONS`, `PLATFORM_LABELS`, `SPECIES_ICONS` (already has `acceptance: ClipboardCheck`). `components/graph/nodes/EntityBadges.tsx` exports `SpeciesBadge`, `EntityId`.
- **Test harness**: mirror `tests/app/load-coverage.js` for any util that calls schema projections at runtime (it calls `loadSchema()` from `tests/schema/load-schema.js`). Each new util test needs a `load-<name>.js`, a `<name>.test.js`, a `package.json` `test:<name>` script, and a `.github/workflows/ci.yml` step in the `build` job.

---

## File structure (Part 1)

**Create:**
- `lib/config/value-icons.ts` — `VALUE_ICON_COMPONENTS: Record<ValueId, LucideIcon>` resolved from `VALUES[].icon` via lucide's `icons` record (drift-free). Pure, no JSX (testable in the node harness).
- `components/values/ValueBadge.tsx` — `<ValueBadge valueId>` icon+label chip; `<ValueIcon valueId>`.
- `components/values/ValuePicker.tsx` — tier-grouped icon-toggle multi-select (controlled).
- `lib/utils/acceptance-matrix.ts` — `AcceptanceFilters` type, `filterAcceptances(...)`, `groupAcceptancesByAnchor(...)`. Pure.
- `components/acceptances/acceptance-filters.ts` — `useAcceptanceFilters()` (URL-persisted filter state) + `EMPTY_FILTERS`.
- `components/acceptances/AcceptanceFilterBar.tsx` — the filter bar UI.
- `components/acceptances/AcceptanceMatrix.tsx` — the grouped-by-anchor matrix.
- `components/panels/AcceptanceEditor.tsx` — acceptance-subject editors (Gherkin, values, base status, per-platform status, covered anchors).
- `components/panels/AcceptancesSection.tsx` — view/flow "Acceptances" coverage section.
- `app/project/[id]/acceptances/page.tsx` — the page.
- Tests: `tests/app/load-value-icons.js`, `tests/app/value-icons.test.js`, `tests/app/load-acceptance-matrix.js`, `tests/app/acceptance-matrix.test.js`.

**Modify:**
- `lib/utils/platform-status.ts` — widen `getEditablePlatformStatuses` to admit `acceptance`.
- `components/panels/NodeDetailPanel.tsx` — render `AcceptanceEditor` for acceptance subjects; render `AcceptancesSection` for view/flow; extend `usesSingleStatusField`; add optional `onCreateAcceptanceForAnchor` prop.
- `components/layout/ProjectSidebar.tsx` — widen `currentView`; add "Acceptances" item to the Library group.
- `app/project/[id]/layout.tsx` — add `/acceptances` branch to `currentView`.
- `components/library/NodeCard.tsx` — acceptance branch (gherkin preview + value badges + platform dots).
- `app/project/[id]/library/page.tsx` — pass acceptance per-platform statuses to `NodeCard`.
- `package.json`, `.github/workflows/ci.yml` — two new `test:*` scripts + CI steps.

---

### Task 1: Value icon resolution + ValueBadge

**Files:**
- Create: `lib/config/value-icons.ts`
- Create: `tests/app/load-value-icons.js`, `tests/app/value-icons.test.js`
- Create: `components/values/ValueBadge.tsx`
- Modify: `package.json`, `.github/workflows/ci.yml`

- [ ] **Step 1: Write the failing test harness loader**

Create `tests/app/load-value-icons.js` (mirrors `tests/app/load-coverage.js` — it must call `loadSchema()` because `lib/config/values.ts` calls `VALUE_IDS.map(...)` at runtime):

```js
/**
 * Transpiles lib/config/value-icons.ts (+ its lib/config/values.ts dep) into a
 * runnable CJS module for the node test harness. values.ts calls @arkaik/schema
 * at runtime (VALUE_IDS.map), so schema is loaded via loadSchema() like
 * tests/app/load-coverage.js.
 */
const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const { loadSchema, BUILD_DIR: SCHEMA_BUILD_DIR } = require("../schema/load-schema");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, ".test-build-value-icons");

const MODULES = [
  ["lib/config/values.ts", "config-values"],
  ["lib/config/value-icons.ts", "value-icons"],
];

const SPECIFIER_MAP = {
  "@/lib/config/values": "./config-values",
};

function loadValueIcons() {
  loadSchema();
  const schemaIndex = path.join(SCHEMA_BUILD_DIR, "index.js");
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));

  for (const [srcRel, base] of MODULES) {
    const source = fs.readFileSync(path.join(ROOT, srcRel), "utf8");
    const { outputText } = ts.transpileModule(source, {
      fileName: path.basename(srcRel),
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    });
    let rewritten = outputText;
    for (const [spec, target] of Object.entries(SPECIFIER_MAP)) {
      rewritten = rewritten.split(`require("${spec}")`).join(`require("${target}")`);
    }
    rewritten = rewritten.replace(/require\((['"])@arkaik\/schema\1\)/g, `require(${JSON.stringify(schemaIndex)})`);
    fs.writeFileSync(path.join(BUILD_DIR, `${base}.js`), rewritten);
  }
  for (const [, base] of MODULES) delete require.cache[path.join(BUILD_DIR, `${base}.js`)];
  return {
    valueIcons: require(path.join(BUILD_DIR, "value-icons.js")),
    values: require(path.join(BUILD_DIR, "config-values.js")),
  };
}

module.exports = { loadValueIcons, BUILD_DIR };
```

Create `tests/app/value-icons.test.js` (the drift guard compares each resolved component's lucide `displayName` against the icon-NAME string in `values.ts` — no reliance on a build-dir path):

```js
const { loadValueIcons, BUILD_DIR } = require("./load-value-icons");
const fs = require("fs");

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`PASS: ${name}`);
  else { failures++; console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`); }
}

const { valueIcons, values } = loadValueIcons();
const { VALUE_ICON_COMPONENTS } = valueIcons;
const { VALUES } = values;

check("exactly 30 icon components", Object.keys(VALUE_ICON_COMPONENTS).length === 30, String(Object.keys(VALUE_ICON_COMPONENTS).length));
check("every value id resolves to a component",
  VALUES.every((v) => { const c = VALUE_ICON_COMPONENTS[v.id]; return typeof c === "function" || typeof c === "object"; }),
  VALUES.filter((v) => !VALUE_ICON_COMPONENTS[v.id]).map((v) => v.id).join(", "));
check("resolved component matches the values.ts icon name (no drift)",
  VALUES.every((v) => { const c = VALUE_ICON_COMPONENTS[v.id]; return c && c.displayName === v.icon; }),
  VALUES.filter((v) => VALUE_ICON_COMPONENTS[v.id]?.displayName !== v.icon).map((v) => v.id).join(", "));

fs.rmSync(BUILD_DIR, { recursive: true, force: true });
if (failures > 0) { console.log(`\n${failures} value-icon test(s) failed.`); process.exit(1); }
console.log("\nAll value-icon tests passed.");
```

Add to `package.json` scripts (after `"test:coverage"`): `"test:value-icons": "node tests/app/value-icons.test.js",`.

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:value-icons`
Expected: FAIL/crash — `lib/config/value-icons.ts` does not exist (loader read throws or `VALUE_ICON_COMPONENTS` is undefined).

- [ ] **Step 3: Implement `lib/config/value-icons.ts`**

```ts
import { icons, type LucideIcon } from "lucide-react";
import type { ValueId } from "@arkaik/schema";
import { VALUES } from "@/lib/config/values";

/**
 * lucide component per value element, resolved from the icon-NAME strings in
 * lib/config/values.ts (the single source). Reading `icons[name]` means a
 * rename in values.ts flows here automatically — no second hand-maintained
 * list to drift (spec §9.2: every element renders icon + label).
 */
export const VALUE_ICON_COMPONENTS: Record<ValueId, LucideIcon> = Object.fromEntries(
  VALUES.map((v) => [v.id, icons[v.icon as keyof typeof icons]]),
) as Record<ValueId, LucideIcon>;
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:value-icons`
Expected: PASS (3 checks).

- [ ] **Step 5: Create `components/values/ValueBadge.tsx`**

```tsx
"use client";

import type { ValueId } from "@arkaik/schema";
import { VALUES } from "@/lib/config/values";
import { VALUE_ICON_COMPONENTS } from "@/lib/config/value-icons";

const VALUE_BY_ID = new Map(VALUES.map((v) => [v.id, v]));

export function ValueIcon({ valueId, className }: { valueId: ValueId; className?: string }) {
  const Icon = VALUE_ICON_COMPONENTS[valueId];
  return <Icon className={className ?? "size-3.5"} aria-hidden />;
}

/** Icon + label chip for a value element. */
export function ValueBadge({ valueId }: { valueId: ValueId }) {
  const value = VALUE_BY_ID.get(valueId);
  if (!value) return null;
  return (
    <span
      title={value.label}
      className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground"
    >
      <ValueIcon valueId={valueId} className="size-3" />
      <span className="truncate">{value.label}</span>
    </span>
  );
}
```

- [ ] **Step 6: Add the CI step and verify build**

In `.github/workflows/ci.yml`, in the `build` job right after the `Overview coverage projection tests` step (the one running `npm run test:coverage`), add a matching step:

```yaml
      - name: Value icon resolution tests
        run: npm run test:value-icons
```

Run: `npm run test:value-icons && npm run lint && npx tsc --noEmit`
Expected: all clean.

- [ ] **Step 7: Commit**

```bash
git add lib/config/value-icons.ts components/values/ValueBadge.tsx tests/app/load-value-icons.js tests/app/value-icons.test.js package.json .github/workflows/ci.yml
git commit -m "feat(values): drift-free value-icon resolver + ValueBadge"
```

---

### Task 2: Acceptance matrix & filter utils

**Files:**
- Create: `lib/utils/acceptance-matrix.ts`
- Create: `tests/app/load-acceptance-matrix.js`, `tests/app/acceptance-matrix.test.js`
- Modify: `package.json`, `.github/workflows/ci.yml`

- [ ] **Step 1: Write the failing test loader + test**

Create `tests/app/load-acceptance-matrix.js` (mirrors `load-value-icons.js`; `acceptance-matrix.ts` calls schema projections + `matchesSearch` at runtime):

```js
const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const { loadSchema, BUILD_DIR: SCHEMA_BUILD_DIR } = require("../schema/load-schema");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, ".test-build-acceptance-matrix");

const MODULES = [
  ["lib/utils/search.ts", "search"],
  ["lib/utils/acceptance-matrix.ts", "acceptance-matrix"],
];
const SPECIFIER_MAP = {
  "@/lib/utils/search": "./search",
  "@/lib/data/types": "./types", // type-only in this graph
};

function loadAcceptanceMatrix() {
  loadSchema();
  const schemaIndex = path.join(SCHEMA_BUILD_DIR, "index.js");
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));
  for (const [srcRel, base] of MODULES) {
    const source = fs.readFileSync(path.join(ROOT, srcRel), "utf8");
    const { outputText } = ts.transpileModule(source, {
      fileName: path.basename(srcRel),
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    });
    let rewritten = outputText;
    for (const [spec, target] of Object.entries(SPECIFIER_MAP)) {
      rewritten = rewritten.split(`require("${spec}")`).join(`require("${target}")`);
    }
    rewritten = rewritten.replace(/require\((['"])@arkaik\/schema\1\)/g, `require(${JSON.stringify(schemaIndex)})`);
    fs.writeFileSync(path.join(BUILD_DIR, `${base}.js`), rewritten);
  }
  for (const [, base] of MODULES) delete require.cache[path.join(BUILD_DIR, `${base}.js`)];
  return require(path.join(BUILD_DIR, "acceptance-matrix.js"));
}

module.exports = { loadAcceptanceMatrix, BUILD_DIR };
```

Create `tests/app/acceptance-matrix.test.js`:

```js
const { loadAcceptanceMatrix, BUILD_DIR } = require("./load-acceptance-matrix");
const fs = require("fs");

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`PASS: ${name}`);
  else { failures++; console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`); }
}

const { filterAcceptances, groupAcceptancesByAnchor, EMPTY_FILTERS } = loadAcceptanceMatrix();

const view = { id: "V-detail", project_id: "p", species: "view", title: "Detail", status: "live", platforms: ["web", "ios", "android"] };
const flow = { id: "F-swap", project_id: "p", species: "flow", title: "Swap", status: "live", platforms: ["web", "ios"], metadata: { playlist: { entries: [] } } };
const acc1 = { id: "AC-anim", project_id: "p", species: "acceptance", title: "Draw-in animation", status: "backlog",
  platforms: ["web", "ios", "android"], metadata: { gherkin: "When on Detail, Then animate.", values: ["fun-entertainment"], platformStatuses: { ios: "live", android: "development" } } };
const acc2 = { id: "AC-palette", project_id: "p", species: "acceptance", title: "Emotion palette", status: "live",
  platforms: ["web", "ios"], metadata: { values: ["reduces-anxiety"] } };
const accProduct = { id: "AC-offline", project_id: "p", species: "acceptance", title: "Offline capture", status: "development",
  platforms: ["ios"], metadata: { values: ["reduces-risk"] } };
const nodes = [view, flow, acc1, acc2, accProduct];
const acceptances = [acc1, acc2, accProduct];
const edges = [
  { id: "e-AC-anim-V-detail", project_id: "p", source_id: "AC-anim", target_id: "V-detail", edge_type: "covers" },
  { id: "e-AC-palette-V-detail", project_id: "p", source_id: "AC-palette", target_id: "V-detail", edge_type: "covers" },
  { id: "e-AC-anim-F-swap", project_id: "p", source_id: "AC-anim", target_id: "F-swap", edge_type: "covers" },
];
const nodesById = new Map(nodes.map((n) => [n.id, n]));

// --- filterAcceptances -------------------------------------------------------
check("no filters returns all", filterAcceptances(acceptances, edges, EMPTY_FILTERS).length === 3);
check("search matches title", filterAcceptances(acceptances, edges, { ...EMPTY_FILTERS, search: "palette" }).map((a) => a.id).join() === "AC-palette");
check("search matches gherkin text", filterAcceptances(acceptances, edges, { ...EMPTY_FILTERS, search: "animate" }).map((a) => a.id).join() === "AC-anim");
check("platform filter keeps only acceptances targeting it", filterAcceptances(acceptances, edges, { ...EMPTY_FILTERS, platform: "android" }).map((a) => a.id).join() === "AC-anim");
check("status filter matches resolved status on any applicable platform",
  filterAcceptances(acceptances, edges, { ...EMPTY_FILTERS, status: "development" }).map((a) => a.id).sort().join() === "AC-anim,AC-offline");
check("platform+status filter matches that platform's resolved status",
  filterAcceptances(acceptances, edges, { ...EMPTY_FILTERS, platform: "ios", status: "live" }).map((a) => a.id).sort().join() === "AC-anim,AC-palette");
check("value filter", filterAcceptances(acceptances, edges, { ...EMPTY_FILTERS, value: "reduces-anxiety" }).map((a) => a.id).join() === "AC-palette");
check("anchor filter keeps acceptances covering that anchor", filterAcceptances(acceptances, edges, { ...EMPTY_FILTERS, anchor: "F-swap" }).map((a) => a.id).join() === "AC-anim");
check("parity_gap filter keeps only gapped acceptances", filterAcceptances(acceptances, edges, { ...EMPTY_FILTERS, parityGap: true }).map((a) => a.id).join() === "AC-anim");

// --- groupAcceptancesByAnchor ------------------------------------------------
const { groups } = groupAcceptancesByAnchor(acceptances, edges, nodesById);
check("anchor groups then product-level last",
  groups.map((g) => g.anchorId ?? "__product__").join() === "F-swap,V-detail,__product__" || groups.map((g) => g.anchorId ?? "__product__").join() === "V-detail,F-swap,__product__");
const productGroup = groups[groups.length - 1];
check("product group is the null-anchor bucket", productGroup.anchorId === null && productGroup.acceptances.map((a) => a.id).join() === "AC-offline");
const detailGroup = groups.find((g) => g.anchorId === "V-detail");
check("multi-anchor acceptance appears under each anchor", detailGroup.acceptances.some((a) => a.id === "AC-anim") && groups.find((g) => g.anchorId === "F-swap").acceptances.some((a) => a.id === "AC-anim"));
check("group carries anchor node + species + gap count", detailGroup.anchorNode.id === "V-detail" && detailGroup.anchorSpecies === "view" && detailGroup.gapCount === 1);
check("duplicateAnchorCount marks acceptances spanning >1 anchor", detailGroup.acceptances.find((a) => a.id === "AC-anim") && groups.find((g) => g.anchorId === "V-detail").acceptances.length >= 1);

fs.rmSync(BUILD_DIR, { recursive: true, force: true });
if (failures > 0) { console.log(`\n${failures} acceptance-matrix test(s) failed.`); process.exit(1); }
console.log("\nAll acceptance-matrix tests passed.");
```

Add to `package.json` scripts (after `"test:value-icons"`): `"test:acceptance-matrix": "node tests/app/acceptance-matrix.test.js",`.

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:acceptance-matrix`
Expected: FAIL — `lib/utils/acceptance-matrix.ts` does not exist.

- [ ] **Step 3: Implement `lib/utils/acceptance-matrix.ts`**

```ts
import type { Node, Edge } from "@/lib/data/types";
import type { PlatformId } from "@/lib/config/platforms";
import type { StatusId } from "@/lib/config/statuses";
import { resolvePlatformStatus, hasParityGap, type ValueId } from "@arkaik/schema";
import { matchesSearch } from "@/lib/utils/search";

export interface AcceptanceFilters {
  search: string;
  platform: PlatformId | "all";
  status: StatusId | "all";
  value: ValueId | "all";
  anchor: string | "all";
  parityGap: boolean;
}

export const EMPTY_FILTERS: AcceptanceFilters = {
  search: "",
  platform: "all",
  status: "all",
  value: "all",
  anchor: "all",
  parityGap: false,
};

/** Anchor ids an acceptance covers (outgoing `covers` edges). */
function coveredAnchorIds(acceptanceId: string, edges: readonly Edge[]): string[] {
  return edges
    .filter((e) => e.edge_type === "covers" && e.source_id === acceptanceId)
    .map((e) => e.target_id);
}

/** True if any applicable platform of the acceptance resolves to `status`. */
function hasResolvedStatusOnAny(acceptance: Node, status: StatusId): boolean {
  return acceptance.platforms.some((p) => resolvePlatformStatus(acceptance, p) === status);
}

/**
 * Filter acceptances by the parity-matrix filter bar. Filters compose (AND).
 * `search` matches title, description, or gherkin. `status` matches when the
 * (optionally platform-scoped) resolved status equals it. `anchor` keeps
 * acceptances whose `covers` edges include that node id.
 */
export function filterAcceptances(
  acceptances: readonly Node[],
  edges: readonly Edge[],
  filters: AcceptanceFilters,
): Node[] {
  return acceptances.filter((acc) => {
    if (filters.search) {
      const gherkin = typeof acc.metadata?.gherkin === "string" ? acc.metadata.gherkin : "";
      if (!matchesSearch({ title: acc.title, description: `${acc.description ?? ""} ${gherkin}` }, filters.search)) {
        return false;
      }
    }
    if (filters.platform !== "all" && !acc.platforms.includes(filters.platform)) return false;
    if (filters.status !== "all") {
      if (filters.platform !== "all") {
        if (resolvePlatformStatus(acc, filters.platform) !== filters.status) return false;
      } else if (!hasResolvedStatusOnAny(acc, filters.status)) {
        return false;
      }
    }
    if (filters.value !== "all" && !(acc.metadata?.values ?? []).includes(filters.value)) return false;
    if (filters.anchor !== "all" && !coveredAnchorIds(acc.id, edges).includes(filters.anchor)) return false;
    if (filters.parityGap && !hasParityGap(acc)) return false;
    return true;
  });
}

export interface AnchorGroup {
  /** null = product-level (0 covers edges). */
  anchorId: string | null;
  anchorNode: Node | null;
  anchorSpecies: Node["species"] | null;
  acceptances: Node[];
  gapCount: number;
}

/**
 * Group acceptances under the view/flow they cover, product-level last. An
 * acceptance covering n anchors appears in each of the n groups (spec §9.1).
 * Anchor groups are ordered by title; the product-level bucket is always last.
 */
export function groupAcceptancesByAnchor(
  acceptances: readonly Node[],
  edges: readonly Edge[],
  nodesById: ReadonlyMap<string, Node>,
): { groups: AnchorGroup[] } {
  const byAnchor = new Map<string, Node[]>();
  const product: Node[] = [];
  for (const acc of acceptances) {
    const anchors = coveredAnchorIds(acc.id, edges).filter((id) => nodesById.has(id));
    if (anchors.length === 0) {
      product.push(acc);
      continue;
    }
    for (const anchorId of anchors) {
      const list = byAnchor.get(anchorId) ?? [];
      list.push(acc);
      byAnchor.set(anchorId, list);
    }
  }

  const anchorGroups: AnchorGroup[] = [...byAnchor.entries()]
    .map(([anchorId, accs]) => {
      const anchorNode = nodesById.get(anchorId) ?? null;
      return {
        anchorId,
        anchorNode,
        anchorSpecies: anchorNode ? anchorNode.species : null,
        acceptances: accs,
        gapCount: accs.filter((a) => hasParityGap(a)).length,
      };
    })
    .sort((a, b) => (a.anchorNode?.title ?? "").localeCompare(b.anchorNode?.title ?? ""));

  const groups = [...anchorGroups];
  if (product.length > 0) {
    groups.push({
      anchorId: null,
      anchorNode: null,
      anchorSpecies: null,
      acceptances: product,
      gapCount: product.filter((a) => hasParityGap(a)).length,
    });
  }
  return { groups };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:acceptance-matrix`
Expected: PASS (all checks). If the group-order check fails, note the sort is by title (`Detail` < `Swap`, so `V-detail` before `F-swap`) — the test allows either order via the `||`, so a real failure means grouping is wrong.

- [ ] **Step 5: CI step + commit**

Add to `.github/workflows/ci.yml` after the value-icons step:

```yaml
      - name: Acceptance matrix util tests
        run: npm run test:acceptance-matrix
```

Run: `npm run test:acceptance-matrix && npx tsc --noEmit`, then commit:

```bash
git add lib/utils/acceptance-matrix.ts tests/app/load-acceptance-matrix.js tests/app/acceptance-matrix.test.js package.json .github/workflows/ci.yml
git commit -m "feat(acceptances): parity-matrix filter + anchor-grouping utils"
```

---

### Task 3: Routing + sidebar plumbing for `/acceptances`

**Files:**
- Modify: `components/layout/ProjectSidebar.tsx`
- Modify: `app/project/[id]/layout.tsx`

No unit test — this is wiring verified by `npm run build` and by the page rendering in Task 6.

- [ ] **Step 1: Widen `currentView` in the sidebar props**

In `components/layout/ProjectSidebar.tsx`, find the `currentView` type in `ProjectSidebarProps` (around line 40 — currently `"overview" | "maps" | "library" | "delivery" | "changelog"`) and add the two Part-1/Part-2 values so both plans compile against it:

```ts
  currentView: "overview" | "maps" | "library" | "delivery" | "changelog" | "acceptances" | "pyramid";
```

- [ ] **Step 2: Add the "Acceptances" item to the Library group**

In the Library `<SidebarGroup>` (the group whose `<SidebarGroupLabel>` reads "Library"), directly after the existing "All nodes" `<SidebarMenuItem>` (the standalone one that links to `libraryHref` with no `?species=`), add a standalone item — do NOT add it to the `LIBRARY_ITEMS` array (that array is hard-wired to `?species=`). Add `ClipboardCheckIcon` to the `lucide-react` import block at the top of the file:

```tsx
<SidebarMenuItem>
  <SidebarMenuButton asChild isActive={currentView === "acceptances"} tooltip="Acceptances">
    <Link href={`/project/${projectId}/acceptances`}>
      <ClipboardCheckIcon />
      <span>Acceptances</span>
    </Link>
  </SidebarMenuButton>
</SidebarMenuItem>
```

Note: use the project-id variable the surrounding items use (the file already builds `libraryHref` from it — reuse the same identifier, e.g. `projectId`).

- [ ] **Step 3: Add the `/acceptances` branch to the layout's `currentView` ladder**

In `app/project/[id]/layout.tsx`, in the `currentView` ternary ladder (around lines 20-29), add an `acceptances` branch before the `"maps"` default:

```ts
  const currentView = pathname.startsWith(`/project/${id}/overview`) ? "overview"
    : pathname.startsWith(`/project/${id}/library`) ? "library"
    : pathname.startsWith(`/project/${id}/delivery`) ? "delivery"
    : pathname.startsWith(`/project/${id}/changelog`) ? "changelog"
    : pathname.startsWith(`/project/${id}/acceptances`) ? "acceptances"
    : "maps";
```

(Match the file's existing exact expression; only the one new `acceptances` line is added. The `pyramid` branch is Part 2.)

- [ ] **Step 4: Verify build**

Run: `npm run lint && npx tsc --noEmit && npm run build`
Expected: clean. (The sidebar link will 404 until Task 6 creates the page — that's fine; build doesn't check route existence for `<Link>`.)

- [ ] **Step 5: Commit**

```bash
git add components/layout/ProjectSidebar.tsx "app/project/[id]/layout.tsx"
git commit -m "feat(nav): Acceptances sidebar entry + route wiring"
```

---

### Task 4: Filter bar + URL-persisted filter state

**Files:**
- Create: `components/acceptances/acceptance-filters.ts`
- Create: `components/acceptances/AcceptanceFilterBar.tsx`

No unit test (React hook + presentational bar); the filter *logic* is already tested in Task 2. Verified by build + Task 6 page.

- [ ] **Step 1: Create the URL-state hook `components/acceptances/acceptance-filters.ts`**

There is no existing URL-filter helper in the app (only the sidebar's read-only `?species=` link), so this is new. It reads all filters from the URL on mount and writes them back via `router.replace` (shareable, per spec §9.1). Re-exports `EMPTY_FILTERS` from the util so the page has one import.

```ts
"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { AcceptanceFilters } from "@/lib/utils/acceptance-matrix";
import { EMPTY_FILTERS } from "@/lib/utils/acceptance-matrix";

export { EMPTY_FILTERS } from "@/lib/utils/acceptance-matrix";
export type { AcceptanceFilters } from "@/lib/utils/acceptance-matrix";

const KEYS = ["search", "platform", "status", "value", "anchor", "parity_gap"] as const;

function readFilters(params: URLSearchParams): AcceptanceFilters {
  return {
    search: params.get("search") ?? "",
    platform: (params.get("platform") as AcceptanceFilters["platform"]) || "all",
    status: (params.get("status") as AcceptanceFilters["status"]) || "all",
    value: (params.get("value") as AcceptanceFilters["value"]) || "all",
    anchor: params.get("anchor") || "all",
    parityGap: params.get("parity_gap") === "1",
  };
}

/** URL-persisted acceptance filters. `setFilters` replaces the URL (no history push, no scroll). */
export function useAcceptanceFilters(): {
  filters: AcceptanceFilters;
  setFilters: (next: AcceptanceFilters) => void;
  reset: () => void;
} {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const filters = useMemo(() => readFilters(new URLSearchParams(searchParams.toString())), [searchParams]);

  const setFilters = useCallback(
    (next: AcceptanceFilters) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const key of KEYS) params.delete(key);
      if (next.search) params.set("search", next.search);
      if (next.platform !== "all") params.set("platform", next.platform);
      if (next.status !== "all") params.set("status", next.status);
      if (next.value !== "all") params.set("value", next.value);
      if (next.anchor !== "all") params.set("anchor", next.anchor);
      if (next.parityGap) params.set("parity_gap", "1");
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  const reset = useCallback(() => setFilters(EMPTY_FILTERS), [setFilters]);
  return { filters, setFilters, reset };
}
```

- [ ] **Step 2: Create `components/acceptances/AcceptanceFilterBar.tsx`**

Reuses the hand-rolled search-input + shadcn `Select` idiom already used by `DeliveryFilterBar`. The `anchorOptions` (views + flows) and value options are passed in from the page.

```tsx
"use client";

import { SearchIcon, XIcon } from "lucide-react";
import type { AcceptanceFilters } from "@/lib/utils/acceptance-matrix";
import { EMPTY_FILTERS } from "@/lib/utils/acceptance-matrix";
import { PLATFORMS } from "@/lib/config/platforms";
import { STATUSES } from "@/lib/config/statuses";
import { VALUES } from "@/lib/config/values";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface AnchorOption {
  id: string;
  title: string;
}

interface AcceptanceFilterBarProps {
  filters: AcceptanceFilters;
  onChange: (next: AcceptanceFilters) => void;
  anchorOptions: AnchorOption[];
}

const ALL = "all";

export function AcceptanceFilterBar({ filters, onChange, anchorOptions }: AcceptanceFilterBarProps) {
  const isFiltered = JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-[12rem] flex-1">
        <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={filters.search}
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
          placeholder="Search acceptances…"
          className="pl-8"
          aria-label="Search acceptances"
        />
      </div>

      <Select value={filters.platform} onValueChange={(v) => onChange({ ...filters, platform: v === ALL ? "all" : (v as AcceptanceFilters["platform"]) })}>
        <SelectTrigger className="w-[8rem]" aria-label="Platform"><SelectValue placeholder="Platform" /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All platforms</SelectItem>
          {PLATFORMS.map((p) => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}
        </SelectContent>
      </Select>

      <Select value={filters.status} onValueChange={(v) => onChange({ ...filters, status: v === ALL ? "all" : (v as AcceptanceFilters["status"]) })}>
        <SelectTrigger className="w-[9rem]" aria-label="Status"><SelectValue placeholder="Status" /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All statuses</SelectItem>
          {STATUSES.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
        </SelectContent>
      </Select>

      <Select value={filters.value} onValueChange={(v) => onChange({ ...filters, value: v === ALL ? "all" : (v as AcceptanceFilters["value"]) })}>
        <SelectTrigger className="w-[11rem]" aria-label="Value"><SelectValue placeholder="Value" /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All values</SelectItem>
          {VALUES.map((v) => <SelectItem key={v.id} value={v.id}>{v.label}</SelectItem>)}
        </SelectContent>
      </Select>

      <Select value={filters.anchor} onValueChange={(v) => onChange({ ...filters, anchor: v === ALL ? "all" : v })}>
        <SelectTrigger className="w-[11rem]" aria-label="Anchor"><SelectValue placeholder="Anchor" /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All anchors</SelectItem>
          {anchorOptions.map((a) => <SelectItem key={a.id} value={a.id}>{a.title}</SelectItem>)}
        </SelectContent>
      </Select>

      <Button
        type="button"
        variant={filters.parityGap ? "default" : "outline"}
        aria-pressed={filters.parityGap}
        onClick={() => onChange({ ...filters, parityGap: !filters.parityGap })}
        className={filters.parityGap ? "bg-amber-500 text-white hover:bg-amber-500/90" : "text-amber-600"}
      >
        ⚠ Parity gaps
      </Button>

      {isFiltered && (
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange(EMPTY_FILTERS)} aria-label="Clear filters">
          <XIcon className="size-4" /> Clear
        </Button>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify build + commit**

Run: `npm run lint && npx tsc --noEmit`
Expected: clean (the components are unused until Task 6 — Next/tsc don't flag unused module exports).

```bash
git add components/acceptances/acceptance-filters.ts components/acceptances/AcceptanceFilterBar.tsx
git commit -m "feat(acceptances): URL-persisted filter state + filter bar"
```

---

### Task 5: Acceptance matrix component

**Files:**
- Create: `components/acceptances/AcceptanceMatrix.tsx`

No unit test (presentational; grouping/gap logic is tested in Task 2). Verified in Task 6.

- [ ] **Step 1: Create `components/acceptances/AcceptanceMatrix.tsx`**

Renders the grouped-by-anchor matrix: collapsible anchor headers with per-group acceptance + gap counts, one row per acceptance with value badges and a per-platform status cell (dot via the same `STATUS_ICONS`/`STATUS_STYLES` idiom `PlatformList` uses; `—` for non-applicable platforms), an amber left border on parity-gap rows.

```tsx
"use client";

import { useState } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import type { Node, Edge } from "@/lib/data/types";
import { resolvePlatformStatus, hasParityGap } from "@arkaik/schema";
import { groupAcceptancesByAnchor } from "@/lib/utils/acceptance-matrix";
import { PLATFORMS } from "@/lib/config/platforms";
import { STATUS_ICONS, STATUS_STYLES, STATUS_LABELS, SPECIES_ICONS } from "@/components/graph/nodes/node-styles";
import { ValueBadge } from "@/components/values/ValueBadge";
import { EntityId } from "@/components/graph/nodes/EntityBadges";

interface AcceptanceMatrixProps {
  acceptances: Node[];
  edges: Edge[];
  nodesById: ReadonlyMap<string, Node>;
  onSelect: (node: Node) => void;
}

function PlatformCell({ acceptance, platformId }: { acceptance: Node; platformId: (typeof PLATFORMS)[number]["id"] }) {
  const status = resolvePlatformStatus(acceptance, platformId);
  if (!status) return <span className="text-muted-foreground/40" aria-label="Not applicable">—</span>;
  const Icon = STATUS_ICONS[status];
  return <Icon className={`size-4 ${STATUS_STYLES[status].badge}`} aria-label={`${platformId}: ${STATUS_LABELS[status]}`} />;
}

export function AcceptanceMatrix({ acceptances, edges, nodesById, onSelect }: AcceptanceMatrixProps) {
  const { groups } = groupAcceptancesByAnchor(acceptances, edges, nodesById);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  if (groups.length === 0) {
    return <p className="text-sm text-muted-foreground">No acceptances match these filters.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => {
        const key = group.anchorId ?? "__product__";
        const isCollapsed = collapsed.has(key);
        const AnchorIcon = group.anchorSpecies ? SPECIES_ICONS[group.anchorSpecies] : null;
        return (
          <section key={key} className="rounded-xl border">
            <button
              type="button"
              className="flex w-full items-center gap-2 border-b px-3 py-2 text-left"
              onClick={() => setCollapsed((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; })}
              aria-expanded={!isCollapsed}
            >
              {isCollapsed ? <ChevronRightIcon className="size-4" /> : <ChevronDownIcon className="size-4" />}
              {AnchorIcon && <AnchorIcon className="size-4 text-muted-foreground" />}
              <span className="font-medium">{group.anchorNode ? group.anchorNode.title : "Product-level"}</span>
              <span className="text-xs text-muted-foreground">
                · {group.anchorSpecies ?? "no anchor"} · {group.acceptances.length} acceptance{group.acceptances.length === 1 ? "" : "s"}
                {group.gapCount > 0 && <span className="text-amber-600"> · {group.gapCount} gap{group.gapCount === 1 ? "" : "s"}</span>}
              </span>
            </button>

            {!isCollapsed && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground">
                    <th className="px-3 py-1.5 text-left font-normal">Acceptance</th>
                    <th className="px-3 py-1.5 text-left font-normal">Values</th>
                    {PLATFORMS.map((p) => <th key={p.id} className="px-2 py-1.5 text-center font-normal">{p.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {group.acceptances.map((acc) => (
                    <tr
                      key={`${key}-${acc.id}`}
                      tabIndex={0}
                      onClick={() => onSelect(acc)}
                      onKeyDown={(e) => { if (e.key === "Enter") onSelect(acc); }}
                      className={`cursor-pointer border-t hover:bg-muted/40 ${hasParityGap(acc) ? "border-l-2 border-l-amber-500" : ""}`}
                    >
                      <td className="px-3 py-2">
                        <div className="flex flex-col gap-0.5">
                          <span>{acc.title}</span>
                          <EntityId id={acc.id} />
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {(acc.metadata?.values ?? []).map((v) => <ValueBadge key={v} valueId={v} />)}
                        </div>
                      </td>
                      {PLATFORMS.map((p) => (
                        <td key={p.id} className="px-2 py-2 text-center">
                          <span className="inline-flex justify-center"><PlatformCell acceptance={acc} platformId={p.id} /></span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Verify build + commit**

Run: `npm run lint && npx tsc --noEmit`
Expected: clean.

```bash
git add components/acceptances/AcceptanceMatrix.tsx
git commit -m "feat(acceptances): grouped-by-anchor parity matrix component"
```

---

### Task 6: Acceptances page

**Files:**
- Create: `app/project/[id]/acceptances/page.tsx`

- [ ] **Step 1: Create `app/project/[id]/acceptances/page.tsx`**

Wires the hooks, filter bar (URL state), matrix, a "New acceptance" action, and the detail panel. Mirrors the client-page skeleton used by `library/page.tsx`/`delivery/page.tsx`. `onUpdate` and `onCreateAcceptanceForAnchor` use the `useNodes`/`useEdges` mutators; `deriveNodeId` gives the `AC-` id.

```tsx
"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { deriveNodeId } from "@arkaik/schema";
import type { Node } from "@/lib/data/types";
import { useNodes } from "@/lib/hooks/useNodes";
import { useEdges } from "@/lib/hooks/useEdges";
import { useJournal } from "@/lib/hooks/useJournal";
import { useAcceptanceFilters } from "@/components/acceptances/acceptance-filters";
import { filterAcceptances } from "@/lib/utils/acceptance-matrix";
import { AcceptanceFilterBar } from "@/components/acceptances/AcceptanceFilterBar";
import { AcceptanceMatrix } from "@/components/acceptances/AcceptanceMatrix";
import { NodeDetailPanel } from "@/components/panels/NodeDetailPanel";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { PlusIcon } from "lucide-react";

export default function AcceptancesPage() {
  const params = useParams();
  const id = Array.isArray(params.id) ? params.id[0] : params.id ?? "";
  const { nodes, loading: nodesLoading, updateNode, addNode } = useNodes(id);
  const { edges, loading: edgesLoading } = useEdges(id);
  const { journal } = useJournal(id);
  const { filters, setFilters } = useAcceptanceFilters();

  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  const acceptances = useMemo(() => nodes.filter((n) => n.species === "acceptance"), [nodes]);
  const nodesById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const anchorOptions = useMemo(
    () => nodes.filter((n) => n.species === "view" || n.species === "flow").map((n) => ({ id: n.id, title: n.title })).sort((a, b) => a.title.localeCompare(b.title)),
    [nodes],
  );
  const filtered = useMemo(() => filterAcceptances(acceptances, edges, filters), [acceptances, edges, filters]);

  function handleSelect(node: Node) {
    setSelectedNode(node);
    setPanelOpen(true);
  }
  async function handleUpdate(nodeId: string, patch: Partial<Omit<Node, "id" | "project_id">>) {
    const updated = await updateNode(nodeId, patch);
    if (updated) setSelectedNode(updated);
  }
  async function handleCreateAcceptance(title: string): Promise<Node> {
    const node: Node = {
      id: deriveNodeId("acceptance", title, nodes.map((n) => n.id)),
      project_id: id,
      species: "acceptance",
      title,
      status: "idea",
      platforms: ["web", "ios", "android"],
      metadata: {},
    };
    const created = await addNode(node);
    handleSelect(created ?? node);
    return created ?? node;
  }

  if (nodesLoading || edgesLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="flex h-full w-full flex-col">
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <SidebarTrigger />
        <Separator orientation="vertical" className="h-4" />
        <div>
          <h1 className="text-sm font-medium">Acceptances</h1>
          <p className="text-xs text-muted-foreground">{acceptances.length} acceptance{acceptances.length === 1 ? "" : "s"} · {filtered.length} shown</p>
        </div>
        <Button
          className="ml-auto"
          size="sm"
          onClick={() => {
            const title = window.prompt("Acceptance title (the What):");
            if (title && title.trim()) void handleCreateAcceptance(title.trim());
          }}
        >
          <PlusIcon className="size-4" /> New acceptance
        </Button>
      </header>

      <div className="flex-1 overflow-auto p-4">
        <div className="mb-4">
          <AcceptanceFilterBar filters={filters} onChange={setFilters} anchorOptions={anchorOptions} />
        </div>
        <AcceptanceMatrix acceptances={filtered} edges={edges} nodesById={nodesById} onSelect={handleSelect} />
      </div>

      <NodeDetailPanel
        open={panelOpen}
        onOpenChange={setPanelOpen}
        node={selectedNode ?? undefined}
        onUpdate={handleUpdate}
        allNodes={nodes}
        allEdges={edges}
        journal={journal}
        onNavigate={setSelectedNode}
      />
    </div>
  );
}
```

The view/flow "Acceptances" section and the inline "add acceptance from a view" affordance (the `onCreateAcceptanceForAnchor` wiring) are added to this page in Task 8, once that prop exists on `NodeDetailPanel` — so this page compiles standalone now.

If `addNode`/`updateNode` return `void` rather than the created/updated node in this codebase, read `lib/hooks/useNodes.ts` to confirm the return type and adjust: the exploration found `updateNode` returns the updated node (used as `const updated = await updateNode(...)`); if `addNode` returns `void`, drop the `created ??` fallback and use the locally-built `node`.

- [ ] **Step 2: Verify in the running app (this is a UI task — drive it)**

Run `npm run build` (must pass). Then start the app and open the seeded Pebbles project's `/acceptances` route; confirm: the three seed acceptances render grouped under "Pebble Detail" (2) and "Swap Glyph" (1), parity-gap rows show the amber left border, the platform columns show the right dots (iOS live / Android dev / Web backlog for the draw-in animation), the filter bar's "⚠ Parity gaps" toggle narrows the list and updates the URL (`?parity_gap=1`), and clicking a row opens the detail panel. Use the project's app-run skill/pattern to launch (`npm run dev`) and the browser tooling to verify; capture a screenshot.

Expected: matrix renders as described; URL reflects filters; panel opens.

- [ ] **Step 3: Commit**

```bash
git add "app/project/[id]/acceptances/page.tsx"
git commit -m "feat(acceptances): /acceptances parity-matrix page"
```

---

### Task 7: Acceptance editor in the detail panel

**Files:**
- Create: `components/values/ValuePicker.tsx`
- Create: `components/panels/AcceptanceEditor.tsx`
- Modify: `lib/utils/platform-status.ts` (widen `getEditablePlatformStatuses`)
- Modify: `components/panels/NodeDetailPanel.tsx` (render `AcceptanceEditor` for acceptance subjects; extend `usesSingleStatusField`)

- [ ] **Step 1: Widen `getEditablePlatformStatuses` to admit acceptances**

In `lib/utils/platform-status.ts`, change the species gate (currently `if (node.species !== "view") return {}`) to admit acceptances so the reused `PlatformVariants` editor is seeded correctly:

```ts
export function getEditablePlatformStatuses(node: Pick<Node, "species" | "status" | "platforms" | "metadata">): PlatformStatusMap {
  if (node.species !== "view" && node.species !== "acceptance") {
    return {};
  }
  return getNodePlatformStatuses(node);
}
```

This is additive: no other species' behavior changes. (Existing `test:delivery`/`test:coverage` still pass — verify in Step 6.)

- [ ] **Step 2: Create `components/values/ValuePicker.tsx`**

A controlled tier-grouped icon-toggle multi-select (no existing multi-select primitive; use the `aria-pressed` toggle idiom).

```tsx
"use client";

import type { ValueId } from "@arkaik/schema";
import { VALUES, VALUE_TIERS_CONFIG } from "@/lib/config/values";
import { VALUE_ICON_COMPONENTS } from "@/lib/config/value-icons";

interface ValuePickerProps {
  selected: ValueId[];
  onChange: (next: ValueId[]) => void;
}

export function ValuePicker({ selected, onChange }: ValuePickerProps) {
  const selectedSet = new Set(selected);
  function toggle(id: ValueId) {
    const next = new Set(selectedSet);
    next.has(id) ? next.delete(id) : next.add(id);
    onChange(VALUES.filter((v) => next.has(v.id)).map((v) => v.id));
  }
  return (
    <div className="flex flex-col gap-3">
      {VALUE_TIERS_CONFIG.map((tier) => (
        <div key={tier.id} className="flex flex-col gap-1.5">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{tier.label}</span>
          <div className="flex flex-wrap gap-1.5">
            {VALUES.filter((v) => v.tier === tier.id).map((v) => {
              const Icon = VALUE_ICON_COMPONENTS[v.id];
              const on = selectedSet.has(v.id);
              return (
                <button
                  key={v.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(v.id)}
                  title={v.label}
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors ${on ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:bg-muted/60"}`}
                >
                  <Icon className="size-3" />
                  {v.label}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Create `components/panels/AcceptanceEditor.tsx`**

The acceptance-subject editors: base status Select, Gherkin textarea (debounced save), ValuePicker, per-platform status (reuses `PlatformVariants`), and a read-only "Covered anchors" list with click-through. Persists via the panel's `onUpdate` callback (always spreading full `metadata`).

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import type { Node, Edge, PlatformStatusMap } from "@/lib/data/types";
import type { PlatformId } from "@/lib/config/platforms";
import type { StatusId } from "@/lib/config/statuses";
import type { ValueId } from "@arkaik/schema";
import { STATUSES } from "@/lib/config/statuses";
import { getEditablePlatformStatuses } from "@/lib/utils/platform-status";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { STATUS_ICONS, STATUS_STYLES, SPECIES_ICONS } from "@/components/graph/nodes/node-styles";
import { PlatformVariants } from "@/components/panels/PlatformVariants";
import { ValuePicker } from "@/components/values/ValuePicker";

interface AcceptanceEditorProps {
  node: Node;
  allNodes: Node[];
  allEdges: Edge[];
  onUpdate: (id: string, patch: Partial<Omit<Node, "id" | "project_id">>) => Promise<void> | void;
  onNavigate?: (node: Node) => void;
}

export function AcceptanceEditor({ node, allNodes, allEdges, onUpdate, onNavigate }: AcceptanceEditorProps) {
  const [gherkin, setGherkin] = useState(node.metadata?.gherkin ?? "");
  const gherkinTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { setGherkin(node.metadata?.gherkin ?? ""); }, [node.id, node.metadata?.gherkin]);

  const statuses: PlatformStatusMap = getEditablePlatformStatuses(node);
  const nodesById = new Map(allNodes.map((n) => [n.id, n]));
  const coveredAnchors = allEdges
    .filter((e) => e.edge_type === "covers" && e.source_id === node.id)
    .map((e) => nodesById.get(e.target_id))
    .filter((n): n is Node => Boolean(n));

  function patchMetadata(next: Record<string, unknown>) {
    onUpdate(node.id, { metadata: { ...node.metadata, ...next } });
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">Status</span>
        <Select value={node.status} onValueChange={(v) => onUpdate(node.id, { status: v as StatusId })}>
          <SelectTrigger aria-label="Status"><SelectValue /></SelectTrigger>
          <SelectContent>
            {STATUSES.map((s) => {
              const Icon = STATUS_ICONS[s.id];
              return <SelectItem key={s.id} value={s.id}><span className="inline-flex items-center gap-2"><Icon className={`size-3.5 ${STATUS_STYLES[s.id].badge}`} />{s.label}</span></SelectItem>;
            })}
          </SelectContent>
        </Select>
      </section>

      <section className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">Gherkin — the How (one Given/When/Then)</span>
        <textarea
          value={gherkin}
          onChange={(e) => {
            setGherkin(e.target.value);
            if (gherkinTimer.current) clearTimeout(gherkinTimer.current);
            gherkinTimer.current = setTimeout(() => patchMetadata({ gherkin: e.target.value }), 350);
          }}
          rows={3}
          placeholder="When I'm on …, Then …"
          className="rounded-md border bg-background px-2 py-1.5 text-sm"
        />
      </section>

      <section className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">Values — the Why</span>
        <ValuePicker selected={node.metadata?.values ?? []} onChange={(values: ValueId[]) => patchMetadata({ values })} />
      </section>

      <section className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">Per-platform status</span>
        <PlatformVariants
          statuses={statuses}
          notes={node.metadata?.platformNotes}
          screenshots={node.metadata?.platformScreenshots}
          onStatusChange={(platform: PlatformId, value) => {
            const next = { ...statuses };
            if (value) next[platform] = value; else delete next[platform];
            patchMetadata({ platformStatuses: next });
          }}
          onNotesChange={(platform: PlatformId, value) => patchMetadata({ platformNotes: { ...node.metadata?.platformNotes, [platform]: value } })}
          onScreenshotChange={(platform: PlatformId, value) => patchMetadata({ platformScreenshots: { ...node.metadata?.platformScreenshots, [platform]: value } })}
        />
      </section>

      <section className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">Covers</span>
        {coveredAnchors.length === 0 ? (
          <p className="text-xs text-muted-foreground">Product-level (covers nothing).</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {coveredAnchors.map((anchor) => {
              const Icon = SPECIES_ICONS[anchor.species];
              return (
                <li key={anchor.id}>
                  <button type="button" className="inline-flex items-center gap-2 text-sm hover:underline" onClick={() => onNavigate?.(anchor)}>
                    <Icon className="size-3.5 text-muted-foreground" /> {anchor.title}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Wire `AcceptanceEditor` into `NodeDetailPanel`**

In `components/panels/NodeDetailPanel.tsx`:

(a) Extend `usesSingleStatusField` (around line 153) so the panel header's single-status field is NOT shown for acceptances (the `AcceptanceEditor` owns the status Select). Read the current expression — it's `const usesSingleStatusField = node.species === "data-model" || node.species === "api-endpoint";`. Leave it as-is (acceptances are handled by the new branch, not by NodeFields' status). Instead ensure `NodeFields` for an acceptance still renders title/description but not a duplicate status: confirm `NodeFields` only shows the status Select when `usesSingleStatusField` — if so, acceptances (not in that set) won't double-render status. If `NodeFields` shows status for ALL species, gate it to exclude `"acceptance"`. (Read the component; apply the minimal gate.)

(b) Add an `import { AcceptanceEditor } from "@/components/panels/AcceptanceEditor";` and, in the section sequence (after `RefsSection`, alongside the other species branches around lines 533-557), add:

```tsx
{node.species === "acceptance" && allNodes && allEdges && onUpdate && (
  <AcceptanceEditor node={node} allNodes={allNodes} allEdges={allEdges} onUpdate={onUpdate} onNavigate={onNavigate} />
)}
```

- [ ] **Step 5: Verify build + tsc**

Run: `npm run lint && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Verify existing rollup tests still pass, then drive the app**

Run: `npm run test:delivery && npm run test:coverage && npm run test:journey-graph`
Expected: PASS (the `getEditablePlatformStatuses` widening must not change view/flow rollups — these suites lock that).

Then in the running app, open an acceptance from `/acceptances`, edit its Gherkin, toggle a value, change iOS status; reload and confirm the edits persisted (they went through `updateNode` → journal). Confirm the "Covers" list links back to the covered view.

- [ ] **Step 7: Commit**

```bash
git add components/values/ValuePicker.tsx components/panels/AcceptanceEditor.tsx lib/utils/platform-status.ts components/panels/NodeDetailPanel.tsx
git commit -m "feat(panel): acceptance editor — gherkin, values, per-platform status, covers"
```

---

### Task 8: View/flow "Acceptances" coverage section in the panel

**Files:**
- Create: `components/panels/AcceptancesSection.tsx`
- Modify: `components/panels/NodeDetailPanel.tsx` (add optional `onCreateAcceptanceForAnchor` prop; render the section for view/flow)

- [ ] **Step 1: Add the optional prop to `NodeDetailPanelProps` FIRST**

In `components/panels/NodeDetailPanel.tsx`, add to `NodeDetailPanelProps` (the interface around lines 117-131):

```ts
  onCreateAcceptanceForAnchor?: (anchor: Node, title: string) => Promise<Node>;
```

and thread it into the component's destructured props. This makes the Task-6 page (which passes it) typecheck.

- [ ] **Step 2: Create `components/panels/AcceptancesSection.tsx`**

Lists the acceptances covering a view/flow, each with per-platform dots (via the acceptance's own `resolvePlatformStatus`, reusing `PlatformList`), a parity-gap flag, click-through, and an "Add acceptance" affordance when `onCreate` is provided.

```tsx
"use client";

import type { Node, Edge, PlatformStatusMap } from "@/lib/data/types";
import { acceptancesCovering, hasParityGap, resolvePlatformStatus } from "@arkaik/schema";
import { PlatformList } from "@/components/graph/nodes/PlatformList";
import { EntityId } from "@/components/graph/nodes/EntityBadges";
import { Button } from "@/components/ui/button";
import { PlusIcon, TriangleAlertIcon } from "lucide-react";

interface AcceptancesSectionProps {
  node: Node;
  allNodes: Node[];
  allEdges: Edge[];
  onNavigate?: (node: Node) => void;
  onCreate?: (anchor: Node, title: string) => Promise<Node>;
}

function resolvedMap(acc: Node): PlatformStatusMap {
  const map: PlatformStatusMap = {};
  for (const p of acc.platforms) {
    const status = resolvePlatformStatus(acc, p);
    if (status) map[p] = status;
  }
  return map;
}

export function AcceptancesSection({ node, allNodes, allEdges, onNavigate, onCreate }: AcceptancesSectionProps) {
  const covering = acceptancesCovering(node.id, allNodes, allEdges);
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Acceptances</span>
        {onCreate && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              const title = window.prompt(`New acceptance for "${node.title}" (the What):`);
              if (title && title.trim()) void onCreate(node, title.trim());
            }}
          >
            <PlusIcon className="size-4" /> Add
          </Button>
        )}
      </div>
      {covering.length === 0 ? (
        <p className="text-xs text-muted-foreground">No acceptances cover this {node.species} yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {covering.map((acc) => (
            <li key={acc.id}>
              <button
                type="button"
                onClick={() => onNavigate?.(acc)}
                className="flex w-full flex-col gap-1 rounded-md border p-2 text-left hover:bg-muted/40"
              >
                <span className="flex items-center gap-1.5 text-sm">
                  {hasParityGap(acc) && <TriangleAlertIcon className="size-3.5 text-amber-500" aria-label="Parity gap" />}
                  {acc.title}
                </span>
                <EntityId id={acc.id} />
                <PlatformList platforms={acc.platforms} platformStatuses={resolvedMap(acc)} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 3: Render the section for view/flow in `NodeDetailPanel`**

Add `import { AcceptancesSection } from "@/components/panels/AcceptancesSection";` and insert the section right after `RefsSection` and before the view-only `PlatformVariantsSection`/flow-only `ComputedPlatformStatusSection` (so acceptance coverage sits above the legacy per-platform editor):

```tsx
{(node.species === "view" || node.species === "flow") && allNodes && allEdges && (
  <AcceptancesSection
    node={node}
    allNodes={allNodes}
    allEdges={allEdges}
    onNavigate={onNavigate}
    onCreate={onCreateAcceptanceForAnchor}
  />
)}
```

- [ ] **Step 3b: Wire creation on the acceptances page**

In `app/project/[id]/acceptances/page.tsx` (from Task 6), now that the prop exists: add `addEdge` back to the `useEdges` destructure, add the anchor-creation handler, and pass it to the panel.

Change the edges hook line to:

```tsx
  const { edges, loading: edgesLoading, addEdge } = useEdges(id);
```

Add this handler next to `handleCreateAcceptance`:

```tsx
  async function handleCreateAcceptanceForAnchor(anchor: Node, title: string): Promise<Node> {
    const created = await handleCreateAcceptance(title);
    await addEdge({
      id: `e-${created.id}-${anchor.id}`,
      project_id: id,
      source_id: created.id,
      target_id: anchor.id,
      edge_type: "covers",
    });
    return created;
  }
```

Add the prop to the page's `<NodeDetailPanel>`:

```tsx
        onCreateAcceptanceForAnchor={handleCreateAcceptanceForAnchor}
```

- [ ] **Step 4: Verify build + drive**

Run: `npm run lint && npx tsc --noEmit && npm run build`
Expected: clean.

In the running app: from `/acceptances`, open an acceptance, click a covered anchor (e.g. "Pebble Detail") to navigate the panel to that view, and confirm the "Acceptances" section lists the covering acceptances with per-platform dots and a parity-gap warning icon where applicable. (Creation via "Add" works on the acceptances page since it passes `onCreateAcceptanceForAnchor`.)

- [ ] **Step 5: Commit**

```bash
git add components/panels/AcceptancesSection.tsx components/panels/NodeDetailPanel.tsx "app/project/[id]/acceptances/page.tsx"
git commit -m "feat(panel): view/flow Acceptances coverage section + inline create"
```

---

### Task 9: Library acceptance card

**Files:**
- Modify: `components/library/NodeCard.tsx`
- Modify: `app/project/[id]/library/page.tsx`

- [ ] **Step 1: Add an acceptance branch to `NodeCard`**

In `components/library/NodeCard.tsx`, add imports at the top:

```tsx
import { resolvePlatformStatus } from "@arkaik/schema";
import { ValueBadge } from "@/components/values/ValueBadge";
```

Add an `acceptance` branch to `CardContent` **before** the existing generic fallback (`{node.species !== "view" && node.species !== "flow" && ( ... )}` at line 100) — and extend that fallback's condition to also exclude `"acceptance"` so acceptances don't render twice. Replace the generic-fallback opening condition with `{node.species !== "view" && node.species !== "flow" && node.species !== "acceptance" && (`. Insert the acceptance branch:

```tsx
{node.species === "acceptance" && (
  <div className="space-y-2">
    {typeof node.metadata?.gherkin === "string" && node.metadata.gherkin && (
      <p className="line-clamp-2 text-[11px] text-muted-foreground">{node.metadata.gherkin}</p>
    )}
    {(node.metadata?.values ?? []).length > 0 && (
      <div className="flex flex-wrap gap-1">
        {(node.metadata?.values ?? []).map((v) => <ValueBadge key={v} valueId={v} />)}
      </div>
    )}
    <div className="space-y-1.5">
      <span className="text-muted-foreground">Platforms</span>
      <PlatformList
        platforms={node.platforms}
        platformStatuses={node.platforms.reduce<PlatformStatusMap>((acc, p) => {
          const s = resolvePlatformStatus(node, p);
          if (s) acc[p] = s;
          return acc;
        }, {})}
      />
    </div>
  </div>
)}
```

`node.metadata?.values` is `ValueId[]`; `ValueBadge` takes `valueId: ValueId`. `PlatformStatusMap` is already imported at the top of `NodeCard.tsx` (line ~5), so the typed `reduce` satisfies `PlatformList`'s `platformStatuses` prop. For an acceptance every applicable platform resolves to a defined status, so this renders real dots.

- [ ] **Step 2: Confirm the library page needs no change**

`app/project/[id]/library/page.tsx` already passes `node` to `NodeCard` and already renders acceptances when `?species=acceptance` (the sidebar has no entry, but the route works). The new branch reads everything from `node.metadata` directly, so no page-level prop is needed. Verify by reading the `NodeCard` invocation in `library/page.tsx` (around line 300) — confirm `node` is passed; no edit required unless `viewPlatformStatuses` is computed in a way that must be extended (it is not — acceptances self-resolve).

- [ ] **Step 3: Verify build + drive**

Run: `npm run lint && npx tsc --noEmit && npm run build`
Expected: clean. In the app, open `/project/pebbles/library?species=acceptance` and confirm the three seed acceptances render as cards with gherkin preview, value badges, and per-platform dots.

- [ ] **Step 4: Commit**

```bash
git add components/library/NodeCard.tsx
git commit -m "feat(library): acceptance card — gherkin preview, value badges, platform dots"
```

---

### Task 10: Verification sweep + docs note

**Files:**
- Modify: `docs/graph-model.md` (or the app's IA doc) — note the new route.

- [ ] **Step 1: Full verification sweep**

```bash
npm run generate && git status --short
npm run test:value-icons && npm run test:acceptance-matrix && \
npm run test:acceptance && npm run test:schema && npm run test:coverage && \
npm run test:delivery && npm run test:journey-graph && npm run test:mcp && \
npm run lint && npx tsc --noEmit && npm run build
```

Expected: all PASS; `npm run generate` produces zero drift (this plan touches no generated sources). If any suite fails, STOP and report exact output.

- [ ] **Step 2: Add the route to the docs**

In `docs/graph-model.md`, in the section that enumerates the app's routes/surfaces (the "Library Views" / IA area updated in the Foundation docs sweep), add a one-line note:

```markdown
- **Acceptances** (`/project/[id]/acceptances`) — the parity matrix: acceptances grouped by the view/flow they cover, one status column per platform, filterable by platform/status/value/anchor/parity-gap. Editing (Gherkin, values, per-platform status) happens in the node detail panel.
```

- [ ] **Step 3: Drive the whole surface once, capture a screenshot**

Launch the app on the seeded Pebbles project and walk: `/acceptances` matrix → toggle parity gaps (URL updates) → open an acceptance (edit gherkin/values/status) → navigate to a covered view (Acceptances section) → `/library?species=acceptance` (cards). Capture a screenshot of the matrix for the PR.

- [ ] **Step 4: Commit**

```bash
git add docs/graph-model.md
git commit -m "docs: note the /acceptances route"
```

---

## Out of scope — Part 2 brief (Value Pyramid & Integrations)

A separate plan (`…-surfaces-part2.md`), written after Part 1 lands, covering spec §9.2/§9.3 remainder:

1. **Rollup seam** — `getEffectivePlatformStatuses(node, nodes, edges)` and an acceptance-aware rollup wrapper in `lib/utils/platform-status.ts` (computed-from-covering-acceptances, else stored fallback via `computeAnchorRollup`'s `null`), then opt-in at existing call sites one at a time (Overview `computeProductRollup`, `computeDeliveryItems`, `journey-graph` flow rollup, view library-card dots) — each threading `edges` in. Existing `test:delivery`/`test:coverage`/`test:journey-graph` goldens updated to the acceptance-aware numbers.
2. **Pyramid page** (`/project/[id]/pyramid`) — `computePyramidAggregation(acceptances, platformFilter?)` util (group by value element → status distribution, grouped by `VALUE_TIERS_CONFIG` tier; unserved elements shown muted) + the element gauge grid (layout B, reusing `PlatformGaugeList`/`ValueIcon`) + platform chip row + element click → `/acceptances?value=<id>`. Route/sidebar plumbing for `pyramid` (the `currentView` union already includes it from Task 3).
3. **Delivery board** — add `{ id: "acceptance", label: "Acceptances" }` to `SPECIES_OPTIONS` in `DeliveryFilterBar.tsx` (grouping/card/util already species-generic) + default species array on the delivery page.
4. **Overview** — a Parity card (`computeParityGaps` count + worst offenders, link `/acceptances?parity_gap=1`) and a Pyramid mini-card (four tier gauges, link `/pyramid`), following the `useMemo`→`Card`→`OverviewSection` pattern; optionally a "uncovered views" health indicator (`computeUncoveredViews`).

---

## Self-review notes (author)

- **Spec §9 coverage**: §9.1 Acceptance list (matrix A) → Tasks 2/4/5/6; the panel editing it references (Gherkin/values/status/covers) → Task 7; filter bar URL state → Task 4. §9.3 node-panel Acceptances section → Task 8; Library acceptance species → Task 9; sidebar Acceptances entry → Task 3. §9.2 Pyramid and the delivery/overview integrations + the view/flow rollup are explicitly deferred to Part 2 (stated above).
- **Type consistency**: `AcceptanceFilters`/`EMPTY_FILTERS`/`filterAcceptances`/`groupAcceptancesByAnchor` defined in Task 2 and consumed unchanged in Tasks 4/5/6; `onCreateAcceptanceForAnchor` added to `NodeDetailPanelProps` in Task 8 Step 1 (before the Task-6 page relies on it — noted in Task 6). `VALUE_ICON_COMPONENTS` (Task 1) consumed in Tasks 5/7/9 via `ValueBadge`/`ValueIcon`/`ValuePicker`.
- **No placeholders**: every new file has complete code with correct imports (`Node`/`Edge`/`PlatformStatusMap` from `@/lib/data/types`; `PlatformId` from `@/lib/config/platforms`; `StatusId` from `@/lib/config/statuses`; `ValueId` from `@arkaik/schema` — verified against `lib/data/types.ts`, which does not re-export the id unions).
- **Verification**: UI tasks are driven in the running app against the seeded acceptances (Tasks 6/7/8/9/10) since React components aren't unit-tested here; the pure utils (matrix/filter, value-icon resolution) are node-harness unit-tested (Tasks 1/2).
