# Relations as lines — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn every relation in the node panel's Relations group into a line — label, a `+` on that same line, rows underneath — so an empty relation costs one line instead of a labelled empty control, and so a panel can author every edge the graph model admits except `composes`.

**Architecture:** One module derives the relation lines a species has from `VALID_EDGE_SEMANTICS` (`lib/utils/relation-lines.ts`), so the panel and the canvas connect-dialog read one grammar. One component renders a line by wrapping `PanelSection`, whose `action` slot is already the heading-row control (`components/panels/RelationLine.tsx`). One capability object writes edges (`lib/utils/node-relations.ts` + `lib/hooks/useNodeRelations.ts`), threaded exactly as `AcceptanceIntake` is, so read-only pages pass none and no `+` appears. `covers` keeps its existing intake write path — that boundary is deliberate and documented.

**Tech Stack:** Next.js 15 / React 19, TypeScript, Tailwind v4, shadcn-style primitives. Tests are plain `node:assert/strict` scripts under `tests/`, run by `npm run test:<name>`; there is no component runner, so UI is verified by lint + typecheck + source-shape assertions, and all logic worth asserting lives in `lib/utils/*.ts`.

**Spec:** `docs/superpowers/specs/2026-09-19-panel-relation-lines-design.md`

---

## Read this before Task 1

Six facts about this repo that will otherwise cost you an hour each.

1. **Tests are scripts, not a framework.** Each file is `#!/usr/bin/env node`, requires `node:assert/strict`, runs top to bottom, and is wired into `package.json` as `"test:<name>": "node tests/app/<name>.test.js"`. There is no `describe`/`it`. A test "fails" by throwing.
2. **A `lib/utils` module with *value* imports needs its own loader.** `tests/app/load-panel-utils.js`'s `loadUtil()` transpiles a single file and rewrites nothing, so it only works for modules whose imports are all `import type`. A module importing `@arkaik/schema` for a *value* (like `VALID_EDGE_SEMANTICS`) needs a dedicated loader modelled on `tests/app/load-acceptance-intake.js`, which rewrites each `require()` by hand. **These alias tables are hand-maintained and there are several; fixing one does not fix the others.** Every new `@/…` value import you add to a module under test means another line in that module's loader.
3. **CI pins Node 20, local is newer.** Do not `require()` a `.ts` file directly in a test; always go through a loader that transpiles.
4. **Lint is a CI gate.** `npm run lint` must report 0 errors. `main` is clean, so any error is yours.
5. **Regenerate before opening a PR.** `npm run generate` — CI diffs generated artifacts, and a newly imported lucide icon dirties them just like a schema edit.
6. **Some suites assert panel *source text*.** `tests/app/product-scope.test.js` and `tests/app/panel-semantics.test.js` read `.tsx` files as strings/ASTs. Moving JSX fails them as a *shape violation*, not as a relocation. Read the assertion's comment before touching it — several say explicitly what property must survive the move.

**Branching.** Four parts, one branch per part, chained with `gh stack` (see the `gh-stack` skill). Base the first part on `main`. Every part must lint, typecheck and pass the suite on its own.

---

## File structure

**Created**

| File | Responsibility |
|---|---|
| `lib/utils/relation-lines.ts` | Which relation lines a species has, their labels and order, and which edges fill one. Pure; derived from `VALID_EDGE_SEMANTICS`. |
| `lib/utils/node-relations.ts` | Plans (`MutationOp[]`) for linking, unlinking and link-a-new-node. Pure. |
| `lib/hooks/useNodeRelations.ts` | Binds those plans to a surface's state. React. |
| `components/panels/RelationLine.tsx` | One relation line: heading, `+`, combobox, rows. |
| `tests/app/load-relation-lines.js` | Loader for the two pure modules above. |
| `tests/app/relation-lines.test.js` | Assertions for both pure modules. |

**Modified**

| File | Change |
|---|---|
| `components/panels/NodeSearchCombobox.tsx` | `species: SpeciesId[]`; `onCreate(species, title)`; one create row per species. |
| `components/panels/NodeRelationSections.tsx` | `CoversSection` adopts `RelationLine` and loses `AttachAnchorRow`'s `Select`; `ConnectionsSection` and `DecisionLinksSection` are replaced by grammar-driven lines. |
| `components/panels/AcceptancesSection.tsx` | Adopts `RelationLine`; loses `window.prompt`; gains attach-existing. |
| `components/panels/RelationsGroup.tsx` | Renders the line list; emptiness rule restated. |
| `components/panels/BlockedByField.tsx` | Becomes a `RelationLine`. |
| `components/panels/NodeDetailPanel.tsx` | `NodeFields` drops `BlockedByField`; panel takes and forwards `relations`. |
| `components/panels/DecisionEditor.tsx` | Drops its `BlockedByField` and `metadataRef`. |
| `components/panels/ProjectPanels.tsx` | Takes and forwards `relations`. |
| `components/layout/PageShell.tsx` | Passes `relations` through (it spreads `...panelProps`, so this may be types only — check). |
| `app/project/[id]/{library,delivery,acceptances}/page.tsx`, `components/maps/{JourneyMap,SystemMap}.tsx` | Construct `useNodeRelations` beside `useAcceptanceIntake` and pass it. |
| `lib/utils/where-used.ts` | `crossLayerConnections` deleted. |
| `tests/app/project-panels.test.js` | Its `crossLayerConnections` assertions deleted. |
| `tests/app/panel-semantics.test.js` | Heading-outline expectations updated. |
| `package.json` | `test:relation-lines` script. |
| `docs/graph-model.md` | A sentence on panel-side edge authoring. |

---

# PART 1 — The grammar table

Branch: `relation-lines-1-grammar`. Pure logic. Nothing imports it yet.

### Task 1.1: The loader

**Files:**
- Create: `tests/app/load-relation-lines.js`

- [ ] **Step 1: Write the loader**

Modelled on `tests/app/load-acceptance-intake.js`. Read that file first — this is the same technique with a shorter module list.

```js
/**
 * Loads lib/utils/relation-lines.ts and lib/utils/node-relations.ts into a
 * plain Node process, following the tests/app/load-*.js idiom: transpile to
 * CommonJS, rewrite each `@/` alias by hand, and point `@arkaik/schema` at the
 * schema package's own test build.
 *
 * Both modules take VALID_EDGE_SEMANTICS as a *value*, so `loadUtil` in
 * load-panel-utils.js cannot take them — it rewrites nothing, and the require
 * would fail at resolution with an error pointing nowhere near the cause.
 *
 * MODULES is in dependency order, and the rewrite table below has one line per
 * `@/` import in those files. Adding an import to either module means adding a
 * line here; there is no resolver doing it for you.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const { loadSchema, BUILD_DIR: SCHEMA_BUILD_DIR } = require("../schema/load-schema");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, ".test-build-relation-lines");

const MODULES = [
  ["lib/utils/relation-lines.ts", "relation-lines"],
  ["lib/utils/node-relations.ts", "node-relations"],
];

function loadRelationLines() {
  loadSchema();

  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));

  const schemaIndex = path.join(SCHEMA_BUILD_DIR, "index.js");

  for (const [srcRel, outName] of MODULES) {
    const source = fs.readFileSync(path.join(ROOT, srcRel), "utf8");
    const { outputText } = ts.transpileModule(source, {
      fileName: path.basename(srcRel),
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    });

    // `@/lib/data/types` is imported type-only and is elided by the
    // transpiler; `@/lib/utils/relation-lines` is a real require from
    // node-relations.ts and is pointed at its sibling output here.
    const rewritten = outputText
      .replace(/require\((['"])@arkaik\/schema\1\)/g, `require(${JSON.stringify(schemaIndex)})`)
      .replace(/require\((['"])@\/lib\/utils\/relation-lines\1\)/g, `require("./relation-lines.js")`);
    fs.writeFileSync(path.join(BUILD_DIR, `${outName}.js`), rewritten);
  }

  for (const [, outName] of MODULES) {
    delete require.cache[path.join(BUILD_DIR, `${outName}.js`)];
  }

  const schema = require(schemaIndex);

  return {
    ...require(path.join(BUILD_DIR, "relation-lines.js")),
    ...require(path.join(BUILD_DIR, "node-relations.js")),
    // The authority every assertion in the suite is written against. Handed
    // back from here rather than re-loaded in the suite: `loadSchema()` wipes
    // and rebuilds its build dir, so a second call mid-suite re-transpiles the
    // package under modules that are already required.
    VALID_EDGE_SEMANTICS: schema.VALID_EDGE_SEMANTICS,
    // The real op interpreter — a plan is only correct if the graph it produces
    // is, and reimplementing "apply these ops" in the suite would hide exactly
    // the mistakes worth catching.
    applyOps: schema.applyOps,
  };
}

module.exports = { loadRelationLines, BUILD_DIR };
```

Note: `node-relations.ts` does not exist until Part 3. Until then the loader's `MODULES` list must contain only the first entry. **Add the second entry in Part 3, Task 3.1** — until then, delete that line and the `relation-lines` rewrite line.

- [ ] **Step 2: Commit**

```bash
git add tests/app/load-relation-lines.js
git commit -m "test: loader for the relation-lines module"
```

### Task 1.2: `relationLinesFor` — the line table

**Files:**
- Create: `lib/utils/relation-lines.ts`
- Create: `tests/app/relation-lines.test.js`
- Modify: `package.json`

- [ ] **Step 1: Write the failing test**

Create `tests/app/relation-lines.test.js`:

```js
#!/usr/bin/env node

/**
 * The panel's relation grammar (lib/utils/relation-lines.ts).
 *
 * The claim: the panel and the canvas connect dialog read ONE grammar. Every
 * assertion here is therefore written against `VALID_EDGE_SEMANTICS` rather
 * than against a hand-copied expectation, except the per-species snapshots —
 * which are hand-written on purpose, because they are the thing a reader of a
 * panel sees and a silent change to them is a UI regression this suite exists
 * to catch.
 */

const assert = require("node:assert/strict");
const fs = require("fs");
const { loadRelationLines, BUILD_DIR } = require("./load-relation-lines");

const {
  relationLinesFor,
  relationRows,
  RELATION_LINE_ORDER,
  RELATION_LINE_LABELS,
  PANEL_EXCLUDED_EDGE_TYPES,
  VALID_EDGE_SEMANTICS,
  applyOps,
  // Added in part 3 — absent until then, which is fine: § 7 is added in the
  // same task that creates them.
  planRelationLink,
  planRelationUnlink,
  planRelationNew,
} = loadRelationLines();

const labelsOf = (species) => relationLinesFor(species).map((line) => line.label);

// --- 1: the per-species snapshot -------------------------------------------

assert.deepEqual(labelsOf("view"), [
  "Acceptances", "Calls", "Called by", "Displays", "Impacted by",
], "a view's lines, in order");

assert.deepEqual(labelsOf("flow"), [
  "Acceptances", "Calls", "Impacted by",
], "a flow's lines, in order");

assert.deepEqual(labelsOf("data-model"), [
  "Displayed by", "Queried by", "Impacted by",
], "a data model's lines, in order");

assert.deepEqual(labelsOf("api-endpoint"), [
  "Calls", "Called by", "Queries", "Impacted by",
], "an api endpoint's lines, in order");

assert.deepEqual(labelsOf("acceptance"), [
  "Covers", "Generated by",
], "an acceptance's lines, in order");

assert.deepEqual(labelsOf("decision"), [
  "Supersedes", "Superseded by", "Generated acceptances", "Impacts",
], "a decision's lines, in order");

// --- 2: composes is excluded outright --------------------------------------

// A `composes` edge is half of a relationship whose other half is
// `metadata.playlist.entries`. Writing one without the other leaves the flow's
// order to journey-graph's "append the missing children" fallback, which is a
// silent reorder. PlaylistEditor owns that write.
assert.deepEqual([...PANEL_EXCLUDED_EDGE_TYPES], ["composes"]);
for (const species of ["view", "flow", "data-model", "api-endpoint", "acceptance", "decision"]) {
  assert(
    relationLinesFor(species).every((line) => line.edgeType !== "composes"),
    `no composes line on a ${species}`,
  );
}

// --- 3: every line is the grammar's, not a restatement ----------------------

for (const species of ["view", "flow", "data-model", "api-endpoint", "acceptance", "decision"]) {
  for (const line of relationLinesFor(species)) {
    const pairs = VALID_EDGE_SEMANTICS[line.edgeType];
    for (const counterpart of line.counterpartSpecies) {
      const [source, target] =
        line.direction === "out" ? [species, counterpart] : [counterpart, species];
      assert(
        pairs.some(([s, t]) => s === source && t === target),
        `${species} ${line.id} admits ${counterpart} per the grammar`,
      );
    }
    assert(line.counterpartSpecies.length > 0, `${species} ${line.id} has somewhere to point`);
    assert.equal(new Set(line.counterpartSpecies).size, line.counterpartSpecies.length,
      `${species} ${line.id} lists each counterpart species once`);
  }
}

// The converse: no admissible pair is missing a line. This is what catches an
// edge type added to the enum and forgotten here.
for (const [edgeType, pairs] of Object.entries(VALID_EDGE_SEMANTICS)) {
  if (PANEL_EXCLUDED_EDGE_TYPES.includes(edgeType)) continue;
  for (const [source, target] of pairs) {
    const out = relationLinesFor(source).find((line) => line.id === `${edgeType}:out`);
    assert(out && out.counterpartSpecies.includes(target),
      `${source} has an outbound ${edgeType} line reaching ${target}`);
    const inbound = relationLinesFor(target).find((line) => line.id === `${edgeType}:in`);
    assert(inbound && inbound.counterpartSpecies.includes(source),
      `${target} has an inbound ${edgeType} line reached from ${source}`);
  }
}

// --- 4: every edge type has both labels ------------------------------------

// Without this, appending an edge type to EDGE_TYPE_IDS renders `undefined` as
// a panel heading rather than failing anywhere.
for (const edgeType of Object.keys(VALID_EDGE_SEMANTICS)) {
  const labels = RELATION_LINE_LABELS[edgeType];
  assert(labels && labels.out && labels.in, `${edgeType} has an outbound and an inbound label`);
}

// --- 5: the order is explicit, not the enum's ------------------------------

// Sorting by EDGE_TYPE_IDS index would silently reorder every panel the day an
// edge type is appended to that enum, so the order is its own list — and every
// line a species can have must be in it.
for (const species of ["view", "flow", "data-model", "api-endpoint", "acceptance", "decision"]) {
  for (const line of relationLinesFor(species)) {
    assert(RELATION_LINE_ORDER.includes(line.id), `${line.id} has a place in the order`);
  }
}
assert.equal(new Set(RELATION_LINE_ORDER).size, RELATION_LINE_ORDER.length,
  "no line id appears twice in the order");

console.log("relation-lines: ok");
fs.rmSync(BUILD_DIR, { recursive: true, force: true });
```

- [ ] **Step 2: Wire the script and run it to verify it fails**

Add to `package.json` scripts, after `"test:playlist-utils"`:

```json
"test:relation-lines": "node tests/app/relation-lines.test.js",
```

Run: `npm run test:relation-lines`
Expected: FAIL — `Cannot find module` / ENOENT on `lib/utils/relation-lines.ts`.

- [ ] **Step 3: Write the implementation**

Create `lib/utils/relation-lines.ts`:

```ts
/**
 * Which relation lines a node panel shows for a species, derived from the graph
 * model's own grammar.
 *
 * Derived, not restated. `VALID_EDGE_SEMANTICS` is the table `validateBundle()`
 * and the canvas connect dialog (`EdgeTypeDialog`) already read, and a second
 * hand-written list of what may attach to what is a second chance for the panel
 * and the canvas to disagree about the model. What this module adds on top of
 * the grammar is only what the grammar does not say: what to call each
 * direction, what order to show them in, and which edge type the panel does not
 * author at all.
 *
 * Deliberately React-free and provider-free — the panel resolves ids to nodes,
 * this decides what to resolve.
 */

import {
  VALID_EDGE_SEMANTICS,
  type EdgeTypeId,
  type SpeciesId,
} from "@arkaik/schema";
import type { Edge } from "@/lib/data/types";

/** Which way the edge runs, relative to the node whose panel is open. */
export type RelationDirection = "out" | "in";

export type RelationLineId = `${EdgeTypeId}:${RelationDirection}`;

export interface RelationLineSpec {
  id: RelationLineId;
  edgeType: EdgeTypeId;
  direction: RelationDirection;
  /** The heading. See {@link RELATION_LINE_LABELS}. */
  label: string;
  /** What a new counterpart may be, from the grammar. Never empty. */
  counterpartSpecies: SpeciesId[];
}

/**
 * What each direction of each edge type is called on a panel.
 *
 * All mechanical but one: `covers:in` is **Acceptances**, not "Covered by".
 * That is the heading the section has carried since it existed and the word a
 * reader of a view panel is looking for, and it is written down here rather
 * than special-cased at the call site so that one table answers "what is this
 * line called".
 */
export const RELATION_LINE_LABELS: Record<EdgeTypeId, { out: string; in: string }> = {
  composes: { out: "Composes", in: "Composed by" },
  calls: { out: "Calls", in: "Called by" },
  displays: { out: "Displays", in: "Displayed by" },
  queries: { out: "Queries", in: "Queried by" },
  covers: { out: "Covers", in: "Acceptances" },
  supersedes: { out: "Supersedes", in: "Superseded by" },
  generates: { out: "Generated acceptances", in: "Generated by" },
  impacts: { out: "Impacts", in: "Impacted by" },
};

/**
 * Edge types no panel line covers.
 *
 * `composes` only. A `composes` edge is half of a relationship whose other half
 * is `metadata.playlist.entries`; writing one without the other leaves the
 * flow's order to `journey-graph`'s "append the missing children" fallback,
 * which is a silent reorder nobody asked for. `PlaylistEditor` owns that write,
 * and the panel's read of it — the Invocation section — stays read-only for the
 * same reason.
 */
export const PANEL_EXCLUDED_EDGE_TYPES: readonly EdgeTypeId[] = ["composes"];

/**
 * The order lines appear in, as an explicit list.
 *
 * Not `EDGE_TYPE_IDS`' order: sorting by that enum's index would silently
 * reorder every panel the day an edge type is appended to it. Covers lines
 * first (the per-species spec order), then cross-layer, then decision links.
 */
export const RELATION_LINE_ORDER: readonly RelationLineId[] = [
  "covers:out",
  "covers:in",
  "calls:out",
  "calls:in",
  "displays:out",
  "displays:in",
  "queries:out",
  "queries:in",
  "supersedes:out",
  "supersedes:in",
  "generates:out",
  "generates:in",
  "impacts:out",
  "impacts:in",
];

/** The relation lines a node of this species has, in {@link RELATION_LINE_ORDER}. */
export function relationLinesFor(species: SpeciesId): RelationLineSpec[] {
  const lines: RelationLineSpec[] = [];

  for (const [edgeType, pairs] of Object.entries(VALID_EDGE_SEMANTICS) as [
    EdgeTypeId,
    ReadonlyArray<[SpeciesId, SpeciesId]>,
  ][]) {
    if (PANEL_EXCLUDED_EDGE_TYPES.includes(edgeType)) continue;

    for (const direction of ["out", "in"] as const) {
      const counterpartSpecies = [
        ...new Set(
          pairs
            .filter(([source, target]) => (direction === "out" ? source : target) === species)
            .map(([source, target]) => (direction === "out" ? target : source)),
        ),
      ];
      if (counterpartSpecies.length === 0) continue;

      lines.push({
        id: `${edgeType}:${direction}`,
        edgeType,
        direction,
        label: RELATION_LINE_LABELS[edgeType][direction],
        counterpartSpecies,
      });
    }
  }

  return lines.sort(
    (a, b) => RELATION_LINE_ORDER.indexOf(a.id) - RELATION_LINE_ORDER.indexOf(b.id),
  );
}

/** One row of a line: the counterpart's id, and the edge that put it there. */
export interface RelationRow {
  edgeId: string;
  counterpartId: string;
}

/**
 * The edges filling one line for one node, in edge order.
 *
 * Ids, not nodes: the caller resolves them and drops what this snapshot cannot
 * see, the same way `coveredAnchorsOf` does — a row naming an id the panel
 * cannot show is worse than no row.
 *
 * De-duplicated on the counterpart, keeping the first edge. `e-{source}-{target}`
 * makes a duplicate pair impossible to mint through the app, but a hand-edited
 * or half-synced bundle can carry two edges with the same endpoints and
 * different ids, and listing the same node twice is a bug a reader would report
 * as a data-loss scare.
 */
export function relationRows(
  nodeId: string,
  line: RelationLineSpec,
  edges: readonly Edge[],
): RelationRow[] {
  const rows = edges
    .filter((edge) => edge.edge_type === line.edgeType)
    .filter((edge) => (line.direction === "out" ? edge.source_id : edge.target_id) === nodeId)
    .map((edge) => ({
      edgeId: edge.id,
      counterpartId: line.direction === "out" ? edge.target_id : edge.source_id,
    }));

  return [...new Map(rows.map((row) => [row.counterpartId, row])).values()];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:relation-lines`
Expected: `relation-lines: ok`

If the per-species snapshots disagree with the implementation, **check the grammar table before changing the snapshot** — the snapshot is transcribed from `VALID_EDGE_SEMANTICS` in the spec and is the thing a reader sees.

- [ ] **Step 5: Add `relationRows` assertions**

Append to `tests/app/relation-lines.test.js`, before the `console.log`:

```js
// --- 6: relationRows reads the edges the line names -------------------------

const PROJECT = "p1";
const edge = (source, target, edge_type, id) => ({
  id: id ?? `e-${source}-${target}`,
  project_id: PROJECT,
  source_id: source,
  target_id: target,
  edge_type,
});

const viewLines = relationLinesFor("view");
const calls = viewLines.find((line) => line.id === "calls:out");
const calledBy = viewLines.find((line) => line.id === "calls:in");

const world = [
  edge("V-home", "API-orders", "calls"),
  edge("API-push", "V-home", "calls"),
  edge("V-home", "DM-user", "displays"),
  edge("V-other", "API-orders", "calls"),
];

assert.deepEqual(
  relationRows("V-home", calls, world).map((row) => row.counterpartId),
  ["API-orders"],
  "an outbound line reads edges leaving this node",
);
assert.deepEqual(
  relationRows("V-home", calledBy, world).map((row) => row.counterpartId),
  ["API-push"],
  "an inbound line reads edges arriving at it — the same edge type, the other direction",
);
assert.deepEqual(
  relationRows("V-home", calls, world)[0].edgeId,
  "e-V-home-API-orders",
  "the row carries its edge id",
);

// A hand-edited bundle can hold two edges with the same endpoints and different
// ids. Listing the counterpart twice would read as data loss to the user.
assert.equal(
  relationRows("V-home", calls, [
    edge("V-home", "API-orders", "calls"),
    edge("V-home", "API-orders", "calls", "e-duplicate"),
  ]).length,
  1,
  "a duplicated pair is one row",
);

assert.deepEqual(relationRows("V-home", calls, []), [], "no edges, no rows");
```

- [ ] **Step 6: Run and commit**

Run: `npm run test:relation-lines`
Expected: `relation-lines: ok`

```bash
npm run lint
git add lib/utils/relation-lines.ts tests/app/relation-lines.test.js tests/app/load-relation-lines.js package.json
git commit -m "feat(panels): derive the panel's relation lines from the edge grammar"
```

### Task 1.3: Part 1 gate

- [ ] **Step 1: Verify the part stands alone**

Run, and paste the output into the PR body rather than summarising it:

```bash
npx tsc --noEmit
npm run lint
npm run test:relation-lines
npm run test:edge-semantics
```

Expected: no type errors, 0 lint errors, both suites print `ok`.

- [ ] **Step 2: Open the PR**

No Lab Note — this part ships nothing a user can see. Add the **`no-lab-note`** label if the advisory reminder comments.

---

# PART 2 — The line primitive

Branch: `relation-lines-2-primitive`, stacked on part 1. A reshape of what exists: no new writable relation. What changes on screen is that Covers' permanent attach row and Acceptances' `window.prompt` both become a `+`.

### Task 2.1: Generalise `NodeSearchCombobox` to several species

**Files:**
- Modify: `components/panels/NodeSearchCombobox.tsx`
- Modify: `components/panels/NodeRelationSections.tsx` (the one call site, `AttachAnchorRow`)

- [ ] **Step 1: Read the current component**

`components/panels/NodeSearchCombobox.tsx`. Note its docblock: the create affordance rides in the same array as the matches because a footer `<Button>` had no keyboard route. That property must survive.

- [ ] **Step 2: Change the props and the row type**

Replace the props interface and the `Row` type:

```tsx
interface NodeSearchComboboxProps {
  /** The species this list may offer, from the grammar. One or several. */
  species: readonly SpeciesId[];
  allNodes: DataNode[];
  /** Ids this list must not offer — already related, or the node itself. */
  excludeIds?: readonly string[];
  onSelect: (nodeId: string) => void;
  /**
   * Create a node of this species with this title, and relate it.
   *
   * The species is a parameter because a line may admit more than one (an api
   * endpoint's `calls` reaches both endpoints and views), and the list then
   * offers one create row apiece — the caller cannot infer which was chosen.
   */
  onCreate?: (species: SpeciesId, title: string) => Promise<void> | void;
  /**
   * An extra last row for a value that is not a node at all — Blocked by's free
   * text. `render` draws it, `onCommit` takes the trimmed query.
   */
  freeText?: { render: (query: string) => React.ReactNode; onCommit: (text: string) => void };
  placeholder?: string;
  disabled?: boolean;
}

type Row =
  | { kind: "node"; id: string; title: string }
  | { kind: "create"; species: SpeciesId; title: string }
  | { kind: "free-text"; title: string };
```

Import `SPECIES` from `@/lib/config/species` for the human label of a species, and `type SpeciesId` from `@arkaik/schema`.

- [ ] **Step 3: Change the candidate filter and the rows**

```tsx
const candidates = useMemo(() => {
  const scoped = allNodes
    .filter((node) => species.includes(node.species))
    .filter((node) => !excludeIds?.includes(node.id))
    .map((node) => ({
      id: node.id,
      title: node.title,
      score: fuzzyScore(query, `${node.id} ${node.title}`),
    } satisfies Candidate))
    .filter((candidate) => candidate.score >= 0)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));

  return scoped.slice(0, 8);
}, [allNodes, excludeIds, query, species]);

const trimmed = query.trim();
// Per species, not across the list: "Login" existing as a view must not
// suppress the offer to create a flow by that name.
const canCreateIn = (candidate: SpeciesId) =>
  Boolean(trimmed) &&
  Boolean(onCreate) &&
  !allNodes.some(
    (node) => node.species === candidate && node.title.toLowerCase() === trimmed.toLowerCase(),
  );

const rows = useMemo<Row[]>(() => {
  const matches: Row[] = candidates.map((candidate) => ({
    kind: "node",
    id: candidate.id,
    title: candidate.title,
  }));
  const creates: Row[] = species
    .filter(canCreateIn)
    .map((candidate) => ({ kind: "create", species: candidate, title: trimmed }));
  const free: Row[] = freeText && trimmed ? [{ kind: "free-text", title: trimmed }] : [];
  return [...matches, ...creates, ...free];
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [candidates, species, trimmed, onCreate, allNodes, freeText]);
```

`itemKey` becomes:

```tsx
itemKey={(row) =>
  row.kind === "node" ? row.id : row.kind === "create" ? `create:${row.species}` : "free-text"
}
```

`renderItem` gains the two new kinds. A single admissible species keeps today's wording exactly; several name the species:

```tsx
renderItem={(row) =>
  row.kind === "create" ? (
    species.length > 1 ? (
      <>Create {speciesLabel(row.species).toLowerCase()} &quot;{row.title}&quot;</>
    ) : (
      <>Create &quot;{row.title}&quot;</>
    )
  ) : row.kind === "free-text" ? (
    freeText?.render(row.title)
  ) : (
    <>
      <span className="font-medium">{row.title}</span>
      <span className="ml-2 text-xs text-muted-foreground">{row.id}</span>
    </>
  )
}
```

with, above the component:

```tsx
const speciesLabel = (id: SpeciesId) => SPECIES.find((s) => s.id === id)?.label ?? id;
```

`itemClassName` gives `create` and `free-text` the same ghost-button treatment `create` has today — extract the existing branch's `cn(...)` into a local `const actionRowClass = (active: boolean) => …` and use it for both, so the separator rule above the first action row is drawn once. Guard it: only the **first** action row carries the `before:` rule, or two stacked creates draw two lines.

```tsx
itemClassName={(row, active) =>
  row.kind === "node"
    ? cn("w-full rounded-sm px-2 py-1.5 text-left text-sm", active && "bg-muted")
    : actionRowClass(active, rows.indexOf(row) === firstActionIndex)
}
```

where `const firstActionIndex = rows.findIndex((row) => row.kind !== "node");`.

`handleCreate` takes the species; `onSelect` in the `Combobox` routes the third kind:

```tsx
async function handleCreate(candidate: SpeciesId) {
  if (!onCreate || !trimmed || busy) return;
  setBusy(true);
  try {
    await onCreate(candidate, trimmed);
    setQuery("");
  } finally {
    setBusy(false);
  }
}

onSelect={(row) => {
  if (row.kind === "create") void handleCreate(row.species);
  else if (row.kind === "free-text") { freeText?.onCommit(row.title); setQuery(""); }
  else handleSelect(row.id);
}}
```

Placeholder and `aria-label` take the prop when given, else name the species set:

```tsx
const speciesPhrase = species.map((id) => `${speciesLabel(id).toLowerCase()}s`).join(" or ");
…
placeholder={placeholder ?? `Search ${speciesPhrase}...`}
aria-label={`Search existing ${speciesPhrase} or create one`}
```

- [ ] **Step 4: Update `AttachAnchorRow` — and delete its `Select`**

In `components/panels/NodeRelationSections.tsx`, `AttachAnchorRow` becomes:

```tsx
function AttachAnchorRow({ node, allNodes, allEdges, nodesById, hasProducts, intake, run }: AttachAnchorRowProps) {
  // The View/Flow `Select` is gone. It existed only because the combobox could
  // search one species at a time; with both in one list it is a control asking
  // a question the search result already answers — the conclusion the playlist
  // editor's Add-step popover reached first.
  function announceTriage(anchor: Pick<Node, "id" | "species" | "title" | "metadata">) {
    if (!hasProducts) return;
    if (!attachEmptiesMembership(node, anchor, allEdges, nodesById)) return;
    toast.warning(`"${anchor.title}" has no product, so this acceptance now appears under All products only.`);
  }

  return (
    <NodeSearchCombobox
      species={["view", "flow"]}
      allNodes={allNodes}
      excludeIds={coveredAnchorsOf(node, allNodes, allEdges).map((anchor) => anchor.id)}
      onSelect={(anchorId) => {
        const anchor = nodesById.get(anchorId);
        if (!anchor) return;
        void run(async () => {
          await intake.attach(node, anchor);
          announceTriage(anchor);
        }, "Couldn't attach that node.");
      }}
      onCreate={(species, title) =>
        run(async () => {
          // `intake.createAnchor` takes the narrow anchor species; the grammar
          // admits nothing else on this line, so the cast is the type system
          // catching up with `species={["view", "flow"]}` above.
          const created = await intake.createAnchor(node, species as "view" | "flow", title);
          if (created) toast.success(`Created "${created.title}" and attached it.`);
        }, `Couldn't create the ${species}.`)
      }
    />
  );
}
```

Remove the now-unused `useState` and `Select*` imports from that file if nothing else uses them. **Check before deleting** — `grep -n "Select\|useState" components/panels/NodeRelationSections.tsx`.

- [ ] **Step 5: Verify**

```bash
npx tsc --noEmit
npm run lint
```

Expected: clean. A `SpeciesId` import missing from `NodeSearchCombobox.tsx` is the likely first error.

- [ ] **Step 6: Commit**

```bash
git add components/panels/NodeSearchCombobox.tsx components/panels/NodeRelationSections.tsx
git commit -m "refactor(panels): the node combobox searches several species at once"
```

### Task 2.2: The `RelationLine` component

**Files:**
- Create: `components/panels/RelationLine.tsx`

- [ ] **Step 1: Write it**

```tsx
"use client";

import { useId, useState, type ReactNode } from "react";
import { PlusIcon, XIcon } from "lucide-react";

import { PanelSection } from "@/components/panels/PanelSection";
import { NodeSearchCombobox } from "@/components/panels/NodeSearchCombobox";
import { EntityRow } from "@/components/graph/nodes/EntityRow";
import { Button } from "@/components/ui/button";
import type { Node } from "@/lib/data/types";
import type { SpeciesId } from "@arkaik/schema";

/**
 * One relation of a record: its label, a `+` on that same line, its rows below.
 *
 * A `PanelSection`, not a hand-rolled heading row. That component's `action`
 * slot is already "a ghost Button pushed to the right of the heading … hoisted
 * here so the next section that needs one does not re-derive the
 * `justify-between` row", which is exactly what the `+` is — so the panel
 * gutter, the `h4`-inside-a-`PanelGroup` heading semantics and the section
 * spacing all come from one place and keep agreeing with every other section.
 *
 * **An empty writable line is one line.** No em-dash, no "None yet", no input:
 * the heading and the `+`, and nothing under them. That is the whole point of
 * the shape — a relation that has nothing in it costs a line rather than a
 * labelled empty control — and it is also why a caller with no `add` must drop
 * an empty line entirely rather than render it. A bare label over nothing is an
 * empty state; a label with a `+` is an invitation.
 *
 * The combobox is `inline`, not a popover: the panel body scrolls, and a
 * floated list inside it needs portalling to escape the scroll container —
 * a second problem to solve for no gain in a column this narrow.
 */
interface RelationLineProps {
  label: string;
  /** The rows. Absent means the line is heading-and-`+` only. */
  children?: ReactNode;
  /** Absent means read-only: no `+`, and the caller drops the line when empty. */
  add?: {
    counterpartSpecies: readonly SpeciesId[];
    allNodes: Node[];
    /** Ids already on this line, plus the record itself. Never offered. */
    excludeIds: readonly string[];
    onSelect: (nodeId: string) => void;
    onCreate?: (species: SpeciesId, title: string) => Promise<void> | void;
    freeText?: { render: (query: string) => ReactNode; onCommit: (text: string) => void };
    placeholder?: string;
  };
}

export function RelationLine({ label, children, add }: RelationLineProps) {
  // Per-mount: the panel stack keeps hidden panels mounted, so two open records
  // mean two "Calls" lines in one document.
  const controlsId = useId();
  const [open, setOpen] = useState(false);

  return (
    <PanelSection
      title={label}
      action={
        add && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6 shrink-0"
            aria-label={open ? `Close ${label} search` : `Add to ${label}`}
            aria-expanded={open}
            aria-controls={controlsId}
            onClick={() => setOpen((wasOpen) => !wasOpen)}
          >
            {open ? <XIcon className="size-3.5" /> : <PlusIcon className="size-3.5" />}
          </Button>
        )
      }
    >
      {add && open && (
        <div id={controlsId}>
          <NodeSearchCombobox
            species={add.counterpartSpecies}
            allNodes={add.allNodes}
            excludeIds={add.excludeIds}
            placeholder={add.placeholder}
            freeText={add.freeText}
            onSelect={(nodeId) => {
              add.onSelect(nodeId);
              setOpen(false);
            }}
            onCreate={
              add.onCreate &&
              (async (species, title) => {
                await add.onCreate?.(species, title);
                setOpen(false);
              })
            }
          />
        </div>
      )}
      {children}
    </PanelSection>
  );
}

/**
 * One row of a relation line: the entity, and — where the surface can write —
 * the `×` that removes the edge.
 *
 * `EntityRow` supplies the chip and the hover card, so a relation row copies its
 * own id and opens its own panel like every other cross-reference in a panel.
 * The trailing slot is for whatever the line has to say beyond the title (the
 * counterpart's species, an acceptance's platform glyphs).
 */
export function RelationRowItem({
  node,
  onNavigate,
  onRemove,
  removeLabel,
  children,
}: {
  node: Node;
  onNavigate?: (node: Node) => void;
  onRemove?: () => void;
  /** Names the gesture for a screen reader — "Stop covering Checkout". */
  removeLabel?: string;
  children?: ReactNode;
}) {
  return (
    <li className="flex items-center gap-1">
      <EntityRow node={node} onOpen={onNavigate && (() => onNavigate(node))} className="min-w-0 flex-1">
        <span className="min-w-0 flex-1 truncate">{node.title}</span>
        {children}
      </EntityRow>
      {onRemove && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          aria-label={removeLabel ?? `Remove ${node.title}`}
          onClick={onRemove}
        >
          <XIcon className="size-3.5" />
        </Button>
      )}
    </li>
  );
}
```

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit && npm run lint
```

- [ ] **Step 3: Commit**

```bash
git add components/panels/RelationLine.tsx
git commit -m "feat(panels): a relation line — label, a plus on that line, rows below"
```

### Task 2.3: Covers and Acceptances adopt the line

**Files:**
- Modify: `components/panels/NodeRelationSections.tsx` (`CoversSection`)
- Modify: `components/panels/AcceptancesSection.tsx`

- [ ] **Step 1: `CoversSection`**

Replace its `PanelSection` with `RelationLine`, move `AttachAnchorRow`'s combobox into the line's `add`, and keep every sentence it says about an empty list. `AttachAnchorRow` stops being a rendered row and becomes the `add` config — but its triage announcement must survive, so keep the function and have it return the config object:

```tsx
export function CoversSection({ node, allNodes, allEdges, hasProducts, onNavigate, intake }: CoversSectionProps) {
  const nodesById = new Map(allNodes.map((n) => [n.id, n]));
  const coveredAnchors = coveredAnchorsOf(node, allNodes, allEdges);

  // Unchanged from today: every intake gesture is a write to a store the panel
  // does not own, and a rejected batch otherwise leaves the list looking
  // unchanged with nothing saying why.
  async function run(action: () => Promise<void>, failure: string) {
    try {
      await action();
    } catch (err) {
      toast.error(failure);
      console.error(err);
    }
  }

  return (
    <RelationLine
      label="Covers"
      add={intake && attachAnchorConfig({ node, allNodes, allEdges, nodesById, hasProducts, intake, run, coveredAnchors })}
    >
      {coveredAnchors.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {intake
            ? "Unanchored — an idea in intake. Attach it to a view or a flow above."
            : "Unanchored (covers nothing)."}
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {coveredAnchors.map((anchor) => (
            <RelationRowItem
              key={anchor.id}
              node={anchor}
              onNavigate={onNavigate}
              onRemove={intake && (() => void run(() => intake.detach(node, anchor.id), "Couldn't detach that node."))}
              removeLabel={`Stop covering ${anchor.title}`}
            />
          ))}
        </ul>
      )}
    </RelationLine>
  );
}
```

Note "below" became **"above"** in the intake sentence — the combobox is now over the list, not under it. Missing that leaves the panel pointing at nothing.

Note also that the anchor rows become `EntityRow`s (chip, hover card, id-copy) where they were a bare icon-plus-title button. That is the same treatment every other relation row in the group already gets; the `SPECIES_ICONS` import may become unused here — check.

- [ ] **Step 2: `AcceptancesSection`**

Replace `PanelSection` + the `action` Button with `RelationLine`, and replace `window.prompt` with the combobox's create row. The section keeps both displays and its `scopedPlatforms(acc, scope)` call — `tests/app/product-scope.test.js` asserts that exact text, and it is asserting the right thing.

```tsx
<RelationLine
  label="Acceptances"
  add={
    (onCreate || relations) && {
      counterpartSpecies: ["acceptance"],
      allNodes,
      excludeIds: [node.id, ...covering.map((acc) => acc.id)],
      placeholder: "Search acceptances or name a new one...",
      onSelect: (acceptanceId) => { /* attach: see Part 3 */ },
      onCreate: onCreate && (async (_species, title) => {
        try {
          await onCreate(node, title);
        } catch (err) {
          toast.error("Couldn't add the acceptance.");
          console.error(err);
        }
      }),
    }
  }
>
```

**In this part `onSelect` has no write path yet** — attaching an *existing* acceptance to an anchor is a `covers` edge written from the anchor's side, which arrives in Part 3. Until then, pass `add` only when `onCreate` is present and make `onSelect` a no-op that does nothing visible:

```tsx
onSelect: () => {
  // Attaching an existing acceptance lands in part 3 with the `relations`
  // capability; until then the list offers only the create row, so this is
  // unreachable rather than a silent failure.
},
```

and set `excludeIds` to exclude **every** acceptance, so the list can only ever reach the create row:

```tsx
excludeIds: [node.id, ...allNodes.filter((n) => n.species === "acceptance").map((n) => n.id)],
```

Delete that line in Part 3 — it is a scaffold, and Task 3.5 says so.

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit
npm run lint
npm run test:product-scope
npm run test:panel-semantics
```

Expected: clean, and both suites print `ok`. If `panel-semantics` fails on a `<section>` that "neither names itself nor heads itself", you have rendered a `RelationLine` with an empty `title` — it must always have a label.

- [ ] **Step 4: Commit**

```bash
git add components/panels/NodeRelationSections.tsx components/panels/AcceptancesSection.tsx
git commit -m "refactor(panels): Covers and Acceptances become relation lines"
```

### Task 2.4: Part 2 gate

- [ ] **Step 1: Run the app and look at it**

```bash
npm run dev
```

Open a project, open an acceptance panel, and check: Covers shows one line with a `+`; the `+` opens a search over views *and* flows with no species select; picking one attaches; creating one still toasts. Open a view panel: Acceptances shows a `+` that creates without a `window.prompt`.

Use the `run` skill if the dev server is already up on another port — a stale server showing old code has cost this repo a debugging session before.

- [ ] **Step 2: Full gate, then PR**

```bash
npx tsc --noEmit && npm run lint && npm run generate && git status --short
npm run test:relation-lines && npm run test:product-scope && npm run test:panel-semantics && npm run test:project-panels
```

`git status --short` must be empty after `npm run generate`.

This part **is** user-visible, so the PR body needs a Lab Note (see `CLAUDE.md`; molecule `arkaik`, type `improvement`). Read the PR's comments after opening it.

---

# PART 3 — Edge authoring

Branch: `relation-lines-3-authoring`, stacked on part 2. The panel gains the ability to write every edge the grammar admits except `covers` (intake's) and `composes` (the playlist's).

### Task 3.1: `node-relations.ts` — the plans

**Files:**
- Create: `lib/utils/node-relations.ts`
- Modify: `tests/app/load-relation-lines.js` (add the second `MODULES` entry and the rewrite line held back in Task 1.1)
- Modify: `tests/app/relation-lines.test.js`

- [ ] **Step 1: Restore the loader's second module**

In `tests/app/load-relation-lines.js`, `MODULES` becomes both entries and the `@/lib/utils/relation-lines` rewrite line goes back in, exactly as written in Task 1.1.

- [ ] **Step 2: Write the failing test**

The top-of-file destructure in `tests/app/relation-lines.test.js` already names
`planRelationLink`, `planRelationUnlink` and `planRelationNew` (Task 1.2 wrote
them in as `undefined`-until-part-3). They resolve now that the loader builds
`node-relations.js`. Append, before the `console.log`:

```js
// --- 7: the write plans -----------------------------------------------------

// `planRelation*` and `applyOps` come from the destructure at the top of this
// file — a second `loadRelationLines()` here would wipe and rebuild the build
// directory under the modules already required from it.

const n = (id, species, extra = {}) => ({
  id, project_id: PROJECT, species, title: id, status: "idea", platforms: [], ...extra,
});

const V = n("V-home", "view");
const API = n("API-orders", "api-endpoint");
const DEC = n("DEC-vendor", "decision");

// Outbound: the edge leaves the panel's node.
assert.deepEqual(planRelationLink(V, API, calls, PROJECT, []), [
  {
    op: "create_edge",
    edge: {
      id: "e-V-home-API-orders",
      project_id: PROJECT,
      source_id: "V-home",
      target_id: "API-orders",
      edge_type: "calls",
    },
  },
]);

// Inbound: the SAME line kind, the endpoints swapped. Getting this backwards
// writes an edge the importer rejects, so it is asserted rather than assumed.
assert.deepEqual(
  planRelationLink(V, API, calledBy, PROJECT, []).map((op) => [op.edge.source_id, op.edge.target_id]),
  [["API-orders", "V-home"]],
);

// The grammar is the authority, here as on the canvas. A decision does not
// `calls` anything, and a plan that emitted it would be an `edge-semantics`
// error on the next import.
assert.throws(
  () => planRelationLink(V, DEC, calls, PROJECT, []),
  /edge-semantics|grammar/i,
  "an edge the grammar forbids is refused, not written",
);

// Three no-ops that are not errors: already linked, and pointed at itself.
assert.deepEqual(
  planRelationLink(V, API, calls, PROJECT, [edge("V-home", "API-orders", "calls")]),
  [],
  "already linked is a no-op",
);
assert.deepEqual(planRelationLink(V, V, calls, PROJECT, []), [], "a node cannot relate to itself");

// Unlink deletes EVERY matching edge, not the first — a hand-edited bundle can
// carry two with the same endpoints, and deleting one leaves the row on screen
// after the user removed it, with no way to tell why.
assert.deepEqual(
  planRelationUnlink("V-home", "API-orders", calls, [
    edge("V-home", "API-orders", "calls"),
    edge("V-home", "API-orders", "calls", "e-duplicate"),
    edge("V-home", "DM-user", "displays"),
  ]).map((op) => op.edge_id),
  ["e-V-home-API-orders", "e-duplicate"],
);

// linkNew mints the node and the edge as one batch.
const plan = planRelationNew(V, calls, "api-endpoint", "POST /refunds", PROJECT, [], new Map([["V-home", V]]));
assert.equal(plan.node.species, "api-endpoint");
assert.equal(plan.node.title, "POST /refunds");
assert.equal(plan.node.status, "idea");
assert.deepEqual(plan.node.platforms, [], "a node minted mid-gesture claims no platform it was not asked about");
assert.equal(plan.ops.length, 2, "the node and its edge commit together");
assert.equal(plan.ops[0].op, "create_node");
assert.equal(plan.ops[1].op, "create_edge");

// A whitespace title is a mis-click, not an intent to mint a hash-suffixed id.
assert.equal(planRelationNew(V, calls, "api-endpoint", "   ", PROJECT, [], new Map()), null);

// The plan is judged by the graph it produces, through the real interpreter.
{
  const applied = applyOps({ nodes: [V], edges: [] }, plan.ops);
  assert.equal(applied.nodes.length, 2);
  assert.equal(applied.edges.length, 1);
  assert.equal(applied.edges[0].source_id, "V-home");
  assert.equal(applied.edges[0].target_id, plan.node.id);
}
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm run test:relation-lines`
Expected: FAIL — `planRelationLink is not a function`.

- [ ] **Step 4: Write the implementation**

Create `lib/utils/node-relations.ts`:

```ts
/**
 * Writing a node's relations from its panel, as pure functions over plain data.
 *
 * Every operation returns **mutation ops** rather than performing itself, for
 * the reason `acceptance-intake.ts` and `product-editing.ts` do: creating a
 * counterpart and linking it in the same gesture is two writes that must commit
 * as one, and a rule living inside a component is a rule this repo has no
 * runner to assert.
 *
 * **`covers` does not come through here.** Both covers lines keep the intake
 * write path (`useAcceptanceIntake`), because a covers edge is not just an
 * edge: attaching one can empty an acceptance's derived product membership —
 * which the surface has to announce — and a node created in that gesture
 * inherits the acceptance's product. A generic edge write knows none of that,
 * and two writers for one edge type is two chances to disagree about what
 * attaching means. The boundary: **covers edges are intake's, every other edge
 * is this module's.**
 *
 * `composes` does not come through here either; see `PANEL_EXCLUDED_EDGE_TYPES`.
 *
 * Deliberately React-free and provider-free.
 */

import {
  deriveNodeId,
  edgeId,
  isValidEdgeSemantic,
  type MutationOp,
  type SpeciesId,
} from "@arkaik/schema";
import type { Edge, Node } from "@/lib/data/types";
import { relationRows, type RelationLineSpec } from "@/lib/utils/relation-lines";

/** The minimum shape these rules need of a node — never the whole thing. */
type NodeLike = Pick<Node, "id" | "species">;

/**
 * Which way round the edge goes.
 *
 * The one piece of arithmetic in this module and the one worth naming: an
 * inbound line writes `counterpart → node`, and getting it backwards produces
 * an edge that renders on the wrong line and fails the next import.
 */
export function relationEndpoints(
  node: NodeLike,
  counterpart: NodeLike,
  line: RelationLineSpec,
): { source: NodeLike; target: NodeLike } {
  return line.direction === "out"
    ? { source: node, target: counterpart }
    : { source: counterpart, target: node };
}

/**
 * Link this node to a counterpart along one line.
 *
 * Empty is a real answer twice over, and neither is an error worth surfacing: a
 * node pointed at itself, and an edge that already exists (a second click, or a
 * combobox selection racing a sync).
 *
 * An edge the grammar forbids **throws**, because it cannot come from the user:
 * the combobox only offers `line.counterpartSpecies`, so a forbidden pair
 * reaching here is a bug in the caller, and writing it would plant an
 * `edge-semantics` failure that only surfaces on the next import.
 */
export function planRelationLink(
  node: NodeLike,
  counterpart: NodeLike,
  line: RelationLineSpec,
  projectId: string,
  edges: readonly Edge[],
): MutationOp[] {
  if (counterpart.id === node.id) return [];

  const { source, target } = relationEndpoints(node, counterpart, line);
  if (!isValidEdgeSemantic(line.edgeType, source.species, target.species)) {
    throw new Error(
      `edge-semantics: ${line.edgeType} does not admit ${source.species} → ${target.species}`,
    );
  }

  const linked = relationRows(node.id, line, edges).some((row) => row.counterpartId === counterpart.id);
  if (linked) return [];

  return [
    {
      op: "create_edge",
      edge: {
        id: edgeId(source.id, target.id),
        project_id: projectId,
        source_id: source.id,
        target_id: target.id,
        edge_type: line.edgeType,
      },
    },
  ];
}

/**
 * Unlink this node from one counterpart along one line.
 *
 * **Every** matching edge, not the first: `e-{source}-{target}` makes a
 * duplicate pair impossible to mint through the app, but a hand-edited or
 * half-synced bundle can carry two edges with different ids and the same
 * endpoints. Deleting one leaves the row on screen after the user removed it,
 * with no way to tell why. (The same rule, and the same reason, as
 * `planAcceptanceDetach`.)
 */
export function planRelationUnlink(
  nodeId: string,
  counterpartId: string,
  line: RelationLineSpec,
  edges: readonly Edge[],
): MutationOp[] {
  return edges
    .filter((edge) => edge.edge_type === line.edgeType)
    .filter((edge) => {
      const [from, to] =
        line.direction === "out" ? [edge.source_id, edge.target_id] : [edge.target_id, edge.source_id];
      return from === nodeId && to === counterpartId;
    })
    .map((edge) => ({ op: "delete_edge", edge_id: edge.id }));
}

/** A new counterpart and the edge linking it — the node is returned so a caller can navigate to it. */
export interface RelationCreationPlan {
  node: Node;
  ops: MutationOp[];
}

/**
 * Create the counterpart and link it, as one write.
 *
 * `status: "idea"` and `platforms: []` match the other create-from-a-panel
 * paths (`onCreateNode`, `planAnchorForAcceptance`): a node minted mid-gesture
 * states no availability it has not been asked about, and the panel that opens
 * next is where that gets said.
 *
 * **No product is inherited**, unlike `planAnchorForAcceptance`. That rule
 * exists because anchors govern an acceptance's membership, so a view created
 * for an acceptance must carry the product or the idea falls back into triage.
 * Nothing on these lines governs membership that way, and guessing a product
 * for an endpoint because the view calling it has one would be inventing an
 * assignment the user was not asked about.
 *
 * `null` for a blank title rather than a hash-suffixed id for an untitled node:
 * the combobox only offers the action once something is typed, so whitespace
 * reaching here is a mis-click.
 */
export function planRelationNew(
  node: Node,
  line: RelationLineSpec,
  species: SpeciesId,
  title: string,
  projectId: string,
  edges: readonly Edge[],
  nodesById: ReadonlyMap<string, Node>,
): RelationCreationPlan | null {
  const trimmed = title.trim();
  if (!trimmed) return null;
  if (!line.counterpartSpecies.includes(species)) {
    throw new Error(`${line.id} does not admit a ${species} counterpart`);
  }

  const created: Node = {
    id: deriveNodeId(species, trimmed, nodesById.keys()),
    project_id: projectId,
    species,
    title: trimmed,
    status: "idea",
    platforms: [],
  };

  return {
    node: created,
    ops: [
      { op: "create_node", node: created },
      ...planRelationLink(node, created, line, projectId, edges),
    ],
  };
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm run test:relation-lines`
Expected: `relation-lines: ok`

- [ ] **Step 6: Commit**

```bash
npm run lint
git add lib/utils/node-relations.ts tests/app/load-relation-lines.js tests/app/relation-lines.test.js
git commit -m "feat(panels): plans for writing a node's relations"
```

### Task 3.2: `useNodeRelations`

**Files:**
- Create: `lib/hooks/useNodeRelations.ts`

- [ ] **Step 1: Write it**

Modelled line for line on `lib/hooks/useAcceptanceIntake.ts` — read that first.

```ts
"use client";

import { useMemo } from "react";
import type { MutationOp, SpeciesId } from "@arkaik/schema";
import type { Edge, Node } from "@/lib/data/types";
import type { RelationLineSpec } from "@/lib/utils/relation-lines";
import {
  planRelationLink,
  planRelationNew,
  planRelationUnlink,
} from "@/lib/utils/node-relations";

/**
 * Writing a node's relations, bound to one surface's data.
 *
 * A single object rather than three props, for the reason `AcceptanceIntake`
 * gives: it is one capability. A panel either can author relations or it
 * cannot, and threading three callbacks through the shell, the panel grid and
 * the detail panel would be three chances for a surface to end up half-wired —
 * a line that can link but not unlink is worse than one that does neither.
 *
 * Every page that lets a panel *edit* passes one of these; pages whose panels
 * are read-only pass none, and every relation line renders exactly as it did
 * before — read-only, and empty ones not at all.
 */
export interface NodeRelations {
  /** Link a counterpart along one line. A no-op if it is already linked. */
  link(node: Node, counterpart: Node, line: RelationLineSpec): Promise<void>;
  /** Unlink one counterpart. The counterpart itself is untouched. */
  unlink(node: Node, counterpartId: string, line: RelationLineSpec): Promise<void>;
  /**
   * Create the counterpart *and* link it, as one write. Resolves to the new
   * node so the caller can open it, or to `null` when the title was blank.
   */
  linkNew(node: Node, line: RelationLineSpec, species: SpeciesId, title: string): Promise<Node | null>;
}

interface NodeRelationsParams {
  projectId: string;
  nodes: readonly Node[];
  edges: readonly Edge[];
  /** `useNodes`'s atomic batch — `linkNew` is more than one write. */
  applyMutations: (ops: MutationOp[]) => Promise<{ nodes: Node[]; edges: Edge[]; version?: string }>;
  /** `useEdges`'s adopt-the-batch-result, since `applyMutations` owns only nodes. */
  syncEdges: (edges: Edge[], version?: string) => void;
}

export function useNodeRelations({
  projectId,
  nodes,
  edges,
  applyMutations,
  syncEdges,
}: NodeRelationsParams): NodeRelations {
  const nodesById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);

  return useMemo(() => {
    async function commit(ops: MutationOp[]): Promise<void> {
      // A plan with no ops is not written at all — every gesture here has a
      // legitimate no-op case, and an empty batch would still be a round trip
      // and a journal read.
      if (ops.length === 0) return;
      const result = await applyMutations(ops);
      syncEdges(result.edges, result.version);
    }

    return {
      async link(node, counterpart, line) {
        await commit(planRelationLink(node, counterpart, line, projectId, edges));
      },
      async unlink(node, counterpartId, line) {
        await commit(planRelationUnlink(node.id, counterpartId, line, edges));
      },
      async linkNew(node, line, species, title) {
        const plan = planRelationNew(node, line, species, title, projectId, edges, nodesById);
        if (!plan) return null;
        await commit(plan.ops);
        return plan.node;
      },
    };
  }, [projectId, edges, nodesById, applyMutations, syncEdges]);
}
```

- [ ] **Step 2: Verify and commit**

```bash
npx tsc --noEmit && npm run lint
git add lib/hooks/useNodeRelations.ts
git commit -m "feat(panels): bind the relation plans to a surface"
```

### Task 3.3: Thread `relations` through the five surfaces

**Files:**
- Modify: `components/panels/ProjectPanels.tsx`
- Modify: `components/layout/PageShell.tsx` (check — it spreads `...panelProps`, so this may be nothing)
- Modify: `components/panels/NodeDetailPanel.tsx`
- Modify: `app/project/[id]/library/page.tsx`
- Modify: `app/project/[id]/delivery/page.tsx`
- Modify: `app/project/[id]/acceptances/page.tsx`
- Modify: `components/maps/JourneyMap.tsx`
- Modify: `components/maps/SystemMap.tsx`

- [ ] **Step 1: Add the prop to `ProjectPanels`**

Beside the existing `intake?: AcceptanceIntake;`:

```tsx
/**
 * Writing a node's relations (`useNodeRelations`), forwarded to the detail
 * panel's Relations group. Absent on a read-only surface, which is what makes
 * every line there read-only and drops the empty ones.
 */
relations?: NodeRelations;
```

Destructure it beside `intake`, and pass `relations={relations}` to `<NodeDetailPanel …>` beside `intake={intake}`.

- [ ] **Step 2: `NodeDetailPanel`**

Add `relations?: NodeRelations;` to its props with the same docblock, destructure it, and pass it to `<RelationsGroup …>`.

- [ ] **Step 3: The five construction sites**

At each of the five files where `useAcceptanceIntake({...})` is called, add directly below it, with the **same argument object**:

```tsx
const relations = useNodeRelations({ projectId, nodes: dataNodes, edges: dataEdges, applyMutations, syncEdges });
```

The variable names differ per file — read each call to `useAcceptanceIntake` and copy its arguments exactly rather than trusting the names above. Then add `relations={relations}` beside the existing `intake={intake}` prop on that file's `<PageShell …>` / `<ProjectPanels …>`.

For each file, run `grep -n "useAcceptanceIntake" -A 8 <file>` to see the argument object.

- [ ] **Step 4: Verify**

```bash
npx tsc --noEmit && npm run lint
```

Expected: clean. `PageShell` spreads `...panelProps` into `ProjectPanels`, so if its own props type is `ProjectPanelsProps`-derived, nothing changes there — confirm by reading `PageShellProps`.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(panels): every writable surface passes the relations capability"
```

### Task 3.4: `RelationsGroup` renders the line list

**Imports** `NodeRelationSections.tsx` gains, since the snippet below uses them:

```tsx
import { RelationLine, RelationRowItem } from "@/components/panels/RelationLine";
import { relationRows, type RelationLineSpec, type RelationRow } from "@/lib/utils/relation-lines";
import type { NodeRelations } from "@/lib/hooks/useNodeRelations";
```

The domain type is `RelationLineSpec`, not `RelationLine` — the component owns
that name. It is a *descriptor*: what a line is, not the line itself.

**Files:**
- Modify: `components/panels/RelationsGroup.tsx`
- Modify: `components/panels/NodeRelationSections.tsx`
- Modify: `lib/utils/where-used.ts`
- Modify: `tests/app/project-panels.test.js`

- [ ] **Step 1: Add the generic line renderer**

In `components/panels/NodeRelationSections.tsx`, replace `ConnectionsSection`, `DecisionLinksSection`, `decisionConnections`, `hasDecisionLinkRows`, `LinkedNodeList` and `ConnectionItem` with one component:

```tsx
export interface EdgeRelationLineProps {
  node: Node;
  line: RelationLineSpec;
  allNodes: Node[];
  allEdges: Edge[];
  onNavigate?: (node: Node) => void;
  relations?: NodeRelations;
}

/**
 * One grammar-derived relation line, with its rows resolved.
 *
 * This is what `ConnectionsSection` and `DecisionLinksSection` both became. The
 * first flattened `calls`, `displays` and `queries` into one list and named the
 * counterpart's *species* on the right — which is not the relation, so a view
 * that calls an endpoint and a view an endpoint calls back read identically.
 * The second spelled its four lists out by hand. Both are this, given a
 * different line.
 *
 * Rows resolve through `allNodes` and unresolvable ids are dropped, as
 * `coveredAnchorsOf` does: a row naming an id the panel cannot show is worse
 * than no row.
 */
export function EdgeRelationLine({ node, line, allNodes, allEdges, onNavigate, relations }: EdgeRelationLineProps) {
  const byId = new Map(allNodes.map((n) => [n.id, n]));
  const rows = relationRows(node.id, line, allEdges)
    .map((row) => ({ row, counterpart: byId.get(row.counterpartId) }))
    .filter((entry): entry is { row: RelationRow; counterpart: Node } => Boolean(entry.counterpart));

  // A read-only line with nothing in it is a bare label over nothing — an empty
  // state, which is what the group's flags exist to avoid. With a `+` on it, it
  // is an invitation, so it stays.
  if (rows.length === 0 && !relations) return null;

  async function run(action: () => Promise<void>, failure: string) {
    try {
      await action();
    } catch (err) {
      toast.error(failure);
      console.error(err);
    }
  }

  return (
    <RelationLine
      label={line.label}
      add={
        relations && {
          counterpartSpecies: line.counterpartSpecies,
          allNodes,
          excludeIds: [node.id, ...rows.map((entry) => entry.counterpart.id)],
          onSelect: (counterpartId) => {
            const counterpart = byId.get(counterpartId);
            if (!counterpart) return;
            void run(() => relations.link(node, counterpart, line), "Couldn't link that node.");
          },
          onCreate: (species, title) =>
            run(async () => {
              const created = await relations.linkNew(node, line, species, title);
              if (created) toast.success(`Created "${created.title}" and linked it.`);
            }, "Couldn't create that node."),
        }
      }
    >
      {rows.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {rows.map(({ counterpart }) => (
            <RelationRowItem
              key={counterpart.id}
              node={counterpart}
              onNavigate={onNavigate}
              onRemove={
                relations &&
                (() => void run(() => relations.unlink(node, counterpart.id, line), "Couldn't unlink that node."))
              }
              removeLabel={`Remove ${counterpart.title} from ${line.label}`}
            />
          ))}
        </ul>
      )}
    </RelationLine>
  );
}
```

The trailing species label that `ConnectionItem` showed is **gone**: the line's heading now says what the relation is, and `EntityChip` already says what species the counterpart is. Do not reintroduce it.

- [ ] **Step 2: Rewrite `RelationsGroup`**

The seven `has*` flags become one pass. Keep the docblock's argument, restate the rule:

```tsx
const lines = relationLinesFor(node.species);
// The `covers` lines keep their own components — one has the intake write path
// and its triage announcement, the other has platform chips and a display
// preference — so they are matched out of the generic list by id rather than
// rendered by `EdgeRelationLine`. See `node-relations.ts` for why covers is not
// a generic edge.
const edgeLines = lines.filter((line) => line.edgeType !== "covers");
const coversOut = lines.find((line) => line.id === "covers:out");
const coversIn = lines.find((line) => line.id === "covers:in");

const resolvedEdgeLines = allNodes && allEdges
  ? edgeLines.filter(
      (line) => relations || relationRows(node.id, line, allEdges).length > 0,
    )
  : [];

const hasRefs = (node.metadata?.refs ?? []).length > 0;
const hasFindings = openFindings !== null;
const hasCovers = Boolean(coversOut) && Boolean(allNodes && allEdges);
const hasAcceptances = Boolean(coversIn) && Boolean(allNodes && allEdges);
const hasInvocation =
  Boolean(allNodes && onNavigate) && findWhereUsed(node.id, allNodes ?? []).length > 0;
// Blocked by is a line whenever anything can be said or done about it: a value
// to show, or a way to set one.
const hasBlockedBy = Boolean(normalizeBlockedBy(node.metadata?.blocked_by)) || Boolean(onUpdate);

if (
  !hasBlockedBy && !hasCovers && !hasAcceptances && !hasInvocation &&
  resolvedEdgeLines.length === 0 && !hasRefs && !hasFindings
) {
  return null;
}
```

**Do not delete the docblock.** Rewrite its "Renders nothing when every child would" paragraph to say the new rule, keeping the reason: *the group renders when any line has rows, or when the surface can write; and on a read-only surface an empty line is dropped, because a bare label over nothing is an empty state.* The paragraphs about the findings chip and about Covers/Acceptances always having a sentence are still true and stay.

Render order, per the spec: Blocked by (Part 4 — leave a comment where it goes), Covers, Acceptances, Invocation, the edge lines in `relationLinesFor` order, References, Findings.

- [ ] **Step 3: Delete `crossLayerConnections`**

It has exactly two callers and both are gone. Confirm, then delete it from `lib/utils/where-used.ts`:

```bash
grep -rn "crossLayerConnections" app components lib | grep -v "/dist/"
```

Expected after the rewrite: only `lib/utils/where-used.ts` and `tests/app/project-panels.test.js`. Delete the function, and delete its assertions (the block around `tests/app/project-panels.test.js:254-330`) — what replaces them is `tests/app/relation-lines.test.js` § 6. Leave `findWhereUsed` and `coveredAnchorsOf` alone; that file's other users need them.

- [ ] **Step 4: Verify**

```bash
npx tsc --noEmit
npm run lint
npm run test:relation-lines
npm run test:project-panels
npm run test:panel-semantics
```

Expected: all `ok`. `panel-semantics` may fail on the heading outline — read the failure, and update the expectation only where the change is the intended one.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(panels): Connections and Decision links become grammar-driven lines"
```

### Task 3.5: Acceptances attaches an existing acceptance

**Files:**
- Modify: `components/panels/AcceptancesSection.tsx`

- [ ] **Step 1: Remove the Part 2 scaffold**

Task 2.2's `excludeIds` scaffold (which excluded every acceptance so the list could only reach the create row) comes out, and `onSelect` gets its write. Attaching an existing acceptance to this anchor is a `covers` edge, so it goes through **intake**, not `relations`:

```tsx
add={
  (onCreate || intake) && {
    counterpartSpecies: ["acceptance"],
    allNodes,
    excludeIds: [node.id, ...covering.map((acc) => acc.id)],
    placeholder: "Search acceptances or name a new one...",
    // `intake.attach` takes (acceptance, anchor) — this line is the inbound
    // direction, so the node whose panel is open is the ANCHOR.
    onSelect: intake
      ? (acceptanceId) => {
          const acceptance = allNodes.find((n) => n.id === acceptanceId);
          if (!acceptance) return;
          void intake.attach(acceptance, node).catch((err) => {
            toast.error("Couldn't attach that acceptance.");
            console.error(err);
          });
        }
      : () => {},
    onCreate:
      onCreate &&
      (async (_species, title) => {
        try {
          await onCreate(node, title);
        } catch (err) {
          toast.error("Couldn't add the acceptance.");
          console.error(err);
        }
      }),
  }
}
```

`AcceptancesSection` needs `intake?: AcceptanceIntake` added to its props and forwarded from `RelationsGroup` (which already has it).

- [ ] **Step 2: Verify and commit**

```bash
npx tsc --noEmit && npm run lint && npm run test:product-scope
git commit -am "feat(panels): an anchor can attach an acceptance that already exists"
```

### Task 3.6: Part 3 gate

- [ ] **Step 1: Exercise it in the app**

`npm run dev`, then on a **view** panel: Calls, Called by, Displays and Impacted by each show a `+`; adding an endpoint under Calls makes it appear, and the same edge shows on that endpoint's panel under "Called by"; `×` removes it from both. On a **decision** panel, Supersedes / Superseded by / Generated acceptances / Impacts behave the same. On a read-only surface (the quality pages), no `+` and no empty lines.

Then reload the page: every edge you wrote must still be there. If it is not, `syncEdges` is not receiving the batch result — check the `commit` in `useNodeRelations` against `useAcceptanceIntake`'s.

- [ ] **Step 2: Full gate, then PR with a Lab Note**

```bash
npx tsc --noEmit && npm run lint && npm run generate && git status --short
npm run test:relation-lines && npm run test:project-panels && npm run test:panel-semantics && npm run test:product-scope && npm run test:edge-semantics
```

---

# PART 4 — Blocked by moves

Branch: `relation-lines-4-blocked-by`, stacked on part 3.

### Task 4.1: `BlockedByField` becomes a line

**Files:**
- Modify: `components/panels/BlockedByField.tsx`
- Modify: `components/panels/RelationsGroup.tsx`

- [ ] **Step 1: Rewrite the component**

It stops being a debounced `<Input>` and becomes a `RelationLine`. The debounce, the `lastSavedRef` and the `metadataRef` all go: a combobox selection is a discrete commit, not typing, so there is nothing to debounce and no race with a sibling field to join.

```tsx
"use client";

import { XIcon } from "lucide-react";

import { RelationLine, RelationRowItem } from "@/components/panels/RelationLine";
import { Button } from "@/components/ui/button";
import { SPECIES_IDS } from "@arkaik/schema";
import type { Node } from "@/lib/data/types";
import { normalizeBlockedBy, withBlockedBy } from "@/lib/utils/blocked";

interface BlockedByFieldProps {
  node: Node;
  onUpdate?: (id: string, patch: Partial<Omit<Node, "id" | "project_id">>) => Promise<void> | void;
  allNodes?: Node[];
  onNavigate?: (node: Node) => void;
}

/**
 * What blocks this node — a relation line like any other, and the group's first.
 *
 * It is the relation that changes how the rest of the record reads: a status
 * means something different when something blocks it. It used to sit in
 * `NodeFields`' intro column among the fields that say what the record *is*,
 * and on a decision somewhere else again — `DecisionEditor` rendered its own
 * copy under "Context — why". Both are gone; there is one renderer and one
 * position.
 *
 * **Single-valued, so the `+` is there only while it is empty.** And it is the
 * only line whose combobox offers something that is not a node: `blocked_by` is
 * a free string, so a query no node answers to can be committed as itself
 * ("waiting on legal"). Nothing a bundle holds today stops being authorable.
 *
 * `withBlockedBy` still owns the "empty means *absent*, never `blocked_by: ""`"
 * rule and carries the rest of the metadata through untouched — a patch
 * replaces `metadata` wholesale.
 */
export function BlockedByField({ node, onUpdate, allNodes, onNavigate }: BlockedByFieldProps) {
  const value = normalizeBlockedBy(node.metadata?.blocked_by) ?? "";
  const blockedNode = value ? allNodes?.find((n) => n.id === value) : undefined;

  function commit(next: string | null) {
    void onUpdate?.(node.id, { metadata: withBlockedBy(node.metadata, next) });
  }

  return (
    <RelationLine
      label="Blocked by"
      add={
        onUpdate && !value
          ? {
              counterpartSpecies: SPECIES_IDS,
              allNodes: allNodes ?? [],
              excludeIds: [node.id],
              placeholder: "Search nodes, or type a reason...",
              onSelect: (nodeId) => commit(nodeId),
              freeText: {
                render: (query) => <>Blocked by &quot;{query}&quot;</>,
                onCommit: (text) => commit(text),
              },
            }
          : undefined
      }
    >
      {value && (
        <ul className="flex flex-col gap-0.5">
          {blockedNode ? (
            <RelationRowItem
              node={blockedNode}
              onNavigate={onNavigate}
              onRemove={onUpdate && (() => commit(null))}
              removeLabel={`No longer blocked by ${blockedNode.title}`}
            />
          ) : (
            // Free text, or an id this snapshot cannot resolve. Both are the
            // value as written; neither is a node, so neither gets a chip.
            <li className="flex items-center gap-1">
              <span className="min-w-0 flex-1 truncate px-2 py-1.5 text-sm">{value}</span>
              {onUpdate && (
                <Button type="button" variant="ghost" size="icon" className="size-7 shrink-0"
                  aria-label="Clear what blocks this" onClick={() => commit(null)}>
                  <XIcon className="size-3.5" />
                </Button>
              )}
            </li>
          )}
        </ul>
      )}
    </RelationLine>
  );
}
```

`SPECIES_IDS` is `["flow", "view", "data-model", "api-endpoint", "acceptance", "decision"]`, exported from `packages/schema/src/ids.ts` — verified. Use it rather than writing six strings here: `blocked_by` may name any node, and a hand-written list is one that stops being true the day a species is added.

- [ ] **Step 2: Render it first in the group**

In `RelationsGroup`, at the comment left by Task 3.4:

```tsx
{hasBlockedBy && (
  <BlockedByField node={node} onUpdate={onUpdate} allNodes={allNodes} onNavigate={onNavigate} />
)}
```

`RelationsGroup` does not take `onUpdate` today — add it to its props and forward it from `NodeDetailPanel`.

- [ ] **Step 3: Verify and commit**

```bash
npx tsc --noEmit && npm run lint
git commit -am "feat(panels): blocked_by is a relation line, and the group's first"
```

### Task 4.2: Remove the two old renderers

**Files:**
- Modify: `components/panels/NodeDetailPanel.tsx`
- Modify: `components/panels/DecisionEditor.tsx`

- [ ] **Step 1: `NodeFields`**

Delete the `BlockedByField` render and its comment, and the now-unused import. Its `allNodes` and `onNavigate` props exist partly for this — check whether anything else in `NodeFields` still uses them (`grep -n "allNodes\|onNavigate" components/panels/NodeDetailPanel.tsx`) and remove them from `NodeFieldsProps` if not. Update the `/** For resolving `blocked_by` … */` docblock on whatever survives.

- [ ] **Step 2: `DecisionEditor`**

Delete its `BlockedByField` render, its import, and **`metadataRef`** — the shared write base existed only because this field was a fourth writer racing its siblings over `node.metadata`, and with the field gone there is nothing to join. Remove the `metadataRef` prop from `BlockedByFieldProps` too (Task 4.1's rewrite already drops it; confirm no other caller passes it).

Read `DecisionEditor`'s docblock at line ~78 — it mentions `allNodes` staying "because `BlockedByField` resolves"; that reason is gone, so either the prop goes or the comment does.

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit
npm run lint
npm run test:panel-semantics
npm run test:project-panels
npm run test:product-scope
npm run test:decision-utils
```

- [ ] **Step 4: Commit**

```bash
git commit -am "refactor(panels): one renderer for blocked_by, in one position"
```

### Task 4.3: Docs

**Files:**
- Modify: `docs/graph-model.md`

- [ ] **Step 1: Add the sentence**

In § Edge Types (find it with `grep -n "Edge Types" docs/graph-model.md`), after the existing description:

```markdown
Edges are authored in two places, both constrained by the same
`VALID_EDGE_SEMANTICS` table: by drawing a connection on a map, and from a node
panel's Relations group, where each admissible relation is its own line with its
own add control ([lib/utils/relation-lines.ts](../lib/utils/relation-lines.ts)).
The exception is `composes`, which only the playlist editor writes — its order
lives in `metadata.playlist.entries`, and an edge written without an entry
leaves that order to a fallback.
```

- [ ] **Step 2: Commit**

```bash
git commit -am "docs(graph-model): edges are authored from panels too"
```

### Task 4.4: Part 4 gate and the stack

- [ ] **Step 1: Look at every species**

`npm run dev`, then open one panel of each of the six species and confirm against the spec's per-species table that the lines present, their order, and their labels all match. Blocked by is first everywhere, including on a decision — where it is no longer under "Context — why".

Set `blocked_by` to a node from the combobox, reload, confirm it resolved to a row with a chip. Set it to free text, reload, confirm the plain row. Clear it with `×`, reload, confirm `blocked_by` is **absent** from the bundle rather than `""` — check via the raw bundle panel.

- [ ] **Step 2: Whole-repo gate**

```bash
npx tsc --noEmit
npm run lint
npm run generate && git status --short
npm run validate:seeds
```

Then every suite this work touches:

```bash
npm run test:relation-lines
npm run test:panel-semantics
npm run test:project-panels
npm run test:product-scope
npm run test:acceptance-intake
npm run test:edge-semantics
npm run test:decision-utils
npm run test:journey-graph
```

- [ ] **Step 3: PR with a Lab Note**

This is the user-visible one. Lab Note in the PR body per `CLAUDE.md` — molecule `arkaik`, type `improvement`, and `nodes:` listing what the change actually touched. Read the PR's comments after opening it; the advisory reminder clears its own comment once the body is fixed.

---

## Verification summary

Every part must satisfy all of:

| Check | Command | Expected |
|---|---|---|
| Types | `npx tsc --noEmit` | no output |
| Lint | `npm run lint` | 0 errors |
| Generated artifacts clean | `npm run generate && git status --short` | empty |
| The new suite | `npm run test:relation-lines` | `relation-lines: ok` |
| Panel outline | `npm run test:panel-semantics` | `ok` |
| Panel shape | `npm run test:project-panels` | `ok` |
| Product rules | `npm run test:product-scope` | `ok` |
| Grammar | `npm run test:edge-semantics` | `ok` |

Never claim a part is done without pasting the actual output of these. A part that only compiles once a later part lands is not a part.
