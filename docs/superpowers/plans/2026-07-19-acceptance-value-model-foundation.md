# Acceptance & Value Model — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the `acceptance` species (What/How/Why + per-platform status), the `covers` edge, the Bain value enum, parity/coverage projections, MCP extensions, and skill v3 — everything in spec §Foundation (`docs/superpowers/specs/2026-07-19-acceptance-value-model-design.md`).

**Architecture:** All enums live in `packages/schema/src/ids.ts` and flow outward: zod wrappers (`enums.ts`), validator rules (`validate.ts` → esbuild-bundled standalone validator via `npm run generate`), MCP tool schemas (`packages/mcp/src/tools.ts` splices the id lists), UI config mirrors (`lib/config/*`), generated JSON Schema/skill docs. New projection logic goes in a new zod-free `packages/schema/src/acceptance.ts`. No `schema_version` bump — everything is additive.

**Tech Stack:** TypeScript, zod (schema half only), Node test scripts (no test framework — `node tests/...` scripts with PASS/FAIL output), esbuild-generated artifacts gated by CI `git diff --exit-code`.

**Branch:** work on `claude/acceptance-value-model-spec` (already contains the spec) or a child branch.

**Key invariants (read before any task):**
- `packages/schema/src/ids.ts` is the single source of truth for id lists. `SPECIES_PREFIXES` in `id-gen.ts` is typed `Record<SpeciesId, string>` — adding a species without a prefix is a compile error (good: TypeScript walks you to every required site).
- After ANY change to `packages/schema/src/`, run `npm run generate` and commit the regenerated artifacts (`docs/arkaik-skill/**`, `plugin/**`, `public/schema/project-bundle.json`); CI fails on drift.
- The standalone validator `docs/arkaik-skill/scripts/validate-bundle.js` is **generated** from `validate.ts` (`scripts/generate/build-validator.js`). Never hand-edit it.
- Tests are plain Node scripts wired as `test:*` npm scripts AND as individual steps in `.github/workflows/ci.yml` (grep for `npm run test:` there — every new script needs a CI step).
- Existing rule `platform-statuses-subset` (validate.ts:263) is a **warning** and already applies to every species. The spec §4 table says "error" for acceptances; the spec prose ("same rule views obey today") wins: it stays a **warning**. This deviation is deliberate — record it in the PR description.

---

### Task 1: Enums, prefixes, zod wrappers

**Files:**
- Modify: `packages/schema/src/ids.ts`
- Modify: `packages/schema/src/id-gen.ts:20-25`
- Modify: `packages/schema/src/enums.ts`
- Create: `tests/schema/acceptance.test.js`
- Modify: `package.json` (scripts), `.github/workflows/ci.yml`

- [ ] **Step 1: Write the failing test**

Create `tests/schema/acceptance.test.js`:

```js
#!/usr/bin/env node

/**
 * Foundation tests for the acceptance & value model
 * (docs/superpowers/specs/2026-07-19-acceptance-value-model-design.md):
 * enums, id derivation, metadata fields, validator rules, projections,
 * backdated-journal ordering, and per-platform event diffing.
 */

const { loadSchema, BUILD_DIR } = require("./load-schema");
const fs = require("fs");

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`PASS: ${name}`);
  else {
    failures++;
    console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const schema = loadSchema();
const {
  SPECIES_IDS, EDGE_TYPE_IDS, VALUE_IDS, VALUE_TIER_IDS, VALUE_TIERS,
  SPECIES_PREFIXES, deriveNodeId,
} = schema;

// --- Task 1: enums & prefixes ------------------------------------------------
check("acceptance is a species", SPECIES_IDS.includes("acceptance"));
check("covers is an edge type", EDGE_TYPE_IDS.includes("covers"));
check("VALUE_IDS has the 30 Bain B2C elements", VALUE_IDS.length === 30, `got ${VALUE_IDS.length}`);
check("VALUE_TIER_IDS has 4 tiers", VALUE_TIER_IDS.length === 4);
check(
  "every value maps to a valid tier",
  VALUE_IDS.every((v) => VALUE_TIER_IDS.includes(VALUE_TIERS[v])),
);
check(
  "tier distribution is 14/10/5/1",
  ["functional", "emotional", "life-changing", "social-impact"]
    .map((t) => VALUE_IDS.filter((v) => VALUE_TIERS[v] === t).length)
    .join("/") === "14/10/5/1",
);
check("acceptance id prefix is AC-", SPECIES_PREFIXES.acceptance === "AC-");
check(
  "deriveNodeId prefixes acceptances",
  deriveNodeId("acceptance", "Pebble draw-in animation") === "AC-pebble-draw-in-animation",
);

// (later tasks append their sections here)

fs.rmSync(BUILD_DIR, { recursive: true, force: true });
if (failures > 0) {
  console.log(`\n${failures} acceptance test(s) failed.`);
  process.exit(1);
}
console.log("\nAll acceptance tests passed.");
```

Note: `tests/schema/load-schema.js` transpiles a fixed `MODULES` list — the new `acceptance.ts` module is added to it in Task 5; nothing needed yet.

- [ ] **Step 2: Wire the script and run it to verify it fails**

Add to `package.json` scripts (after `"test:schema"`):

```json
    "test:acceptance": "node tests/schema/acceptance.test.js",
```

Add to `.github/workflows/ci.yml`, right after the `npm run test:schema` step (match the surrounding step format exactly — a `- name:` + `run:` pair like its neighbors):

```yaml
      - name: Acceptance model tests
        run: npm run test:acceptance
```

Run: `npm run test:acceptance`
Expected: FAIL — `acceptance is a species`, `covers is an edge type`, `VALUE_IDS has the 30…` all fail (VALUE_IDS is undefined).

- [ ] **Step 3: Implement `ids.ts`**

In `packages/schema/src/ids.ts`, replace the `SPECIES_IDS` and `EDGE_TYPE_IDS` lines and append the value enum:

```ts
export const SPECIES_IDS = ["flow", "view", "data-model", "api-endpoint", "acceptance"] as const;
```

```ts
export const EDGE_TYPE_IDS = ["composes", "calls", "displays", "queries", "covers"] as const;
```

Append at the end of the file:

```ts
export const VALUE_TIER_IDS = ["functional", "emotional", "life-changing", "social-impact"] as const;
export type ValueTierId = (typeof VALUE_TIER_IDS)[number];

/**
 * The Bain & Company B2C "Elements of Value" pyramid — 30 elements in 4 tiers.
 * An Arkaik core enum (not project-specific), spec §3.2. Additive extensions
 * only; never renumber or rename.
 */
export const VALUE_IDS = [
  // functional (14)
  "saves-time", "simplifies", "makes-money", "reduces-risk", "organizes",
  "integrates", "connects", "reduces-effort", "avoids-hassles", "reduces-cost",
  "quality", "variety", "sensory-appeal", "informs",
  // emotional (10)
  "reduces-anxiety", "rewards-me", "nostalgia", "design-aesthetics", "badge-value",
  "wellness", "therapeutic-value", "fun-entertainment", "attractiveness", "provides-access",
  // life-changing (5)
  "provides-hope", "self-actualization", "motivation", "heirloom", "affiliation-belonging",
  // social-impact (1)
  "self-transcendence",
] as const;
export type ValueId = (typeof VALUE_IDS)[number];

export const VALUE_TIERS: Record<ValueId, ValueTierId> = {
  "saves-time": "functional", simplifies: "functional", "makes-money": "functional",
  "reduces-risk": "functional", organizes: "functional", integrates: "functional",
  connects: "functional", "reduces-effort": "functional", "avoids-hassles": "functional",
  "reduces-cost": "functional", quality: "functional", variety: "functional",
  "sensory-appeal": "functional", informs: "functional",
  "reduces-anxiety": "emotional", "rewards-me": "emotional", nostalgia: "emotional",
  "design-aesthetics": "emotional", "badge-value": "emotional", wellness: "emotional",
  "therapeutic-value": "emotional", "fun-entertainment": "emotional",
  attractiveness: "emotional", "provides-access": "emotional",
  "provides-hope": "life-changing", "self-actualization": "life-changing",
  motivation: "life-changing", heirloom: "life-changing", "affiliation-belonging": "life-changing",
  "self-transcendence": "social-impact",
};
```

- [ ] **Step 4: Implement `id-gen.ts` and `enums.ts`**

`id-gen.ts` — add the prefix (TypeScript now requires it):

```ts
export const SPECIES_PREFIXES: Record<SpeciesId, string> = {
  flow: "F-",
  view: "V-",
  "data-model": "DM-",
  "api-endpoint": "API-",
  acceptance: "AC-",
};
```

`enums.ts` — extend the imports/re-exports and add the two schemas; update the two descriptions:

```ts
import { SPECIES_IDS, STATUS_IDS, PLATFORM_IDS, EDGE_TYPE_IDS, VALUE_IDS, VALUE_TIER_IDS } from "./ids";

export { SPECIES_IDS, STATUS_IDS, PLATFORM_IDS, EDGE_TYPE_IDS, VALUE_IDS, VALUE_TIER_IDS, VALUE_TIERS } from "./ids";
export type { SpeciesId, StatusId, PlatformId, EdgeTypeId, ValueId, ValueTierId } from "./ids";
```

Update `SpeciesSchema`'s description to:

```ts
    "The species of a node. flow = ordered sequence of views/sub-flows. view = reusable page or screen. data-model = data entity/table. api-endpoint = API endpoint. acceptance = a testable promise (one Given/When/Then) with per-platform status.",
```

Update `EdgeTypeSchema`'s description to:

```ts
    "composes = structural hierarchy (flow↔view). calls = view/flow → api-endpoint, or api-endpoint → api-endpoint (endpoint fan-out to internal/external APIs). displays = view → data-model. queries = api-endpoint → data-model. covers = acceptance → view/flow (which surface the acceptance is proven on).",
```

Append at the end of `enums.ts`:

```ts
export const ValueTierSchema = z.enum(VALUE_TIER_IDS).meta({
  id: "ValueTier",
  description: "Bain value pyramid tier.",
});

export const ValueSchema = z.enum(VALUE_IDS).meta({
  id: "Value",
  description: "A Bain B2C Elements-of-Value element served by an acceptance (spec §3.2).",
});
```

- [ ] **Step 5: Run test to verify Task-1 checks pass**

Run: `npm run test:acceptance`
Expected: PASS on all 8 checks.

- [ ] **Step 6: Regenerate + existing suites**

Run: `npm run generate && npm run test:schema && npm run test:id-gen && npm run validate:seeds`
Expected: all PASS; `git status` shows regenerated `docs/arkaik-skill/**`, `plugin/**`, `public/schema/project-bundle.json`.

- [ ] **Step 7: Commit**

```bash
git add packages/schema/src/ids.ts packages/schema/src/id-gen.ts packages/schema/src/enums.ts \
  tests/schema/acceptance.test.js package.json .github/workflows/ci.yml \
  docs/arkaik-skill plugin public/schema
git commit -m "feat(schema): acceptance species, covers edge, Bain value enum"
```

---

### Task 2: NodeMetadata typed fields (`gherkin`, `values`)

**Files:**
- Modify: `packages/schema/src/bundle.ts:100-119`
- Test: `tests/schema/acceptance.test.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/schema/acceptance.test.js` (before the `fs.rmSync` line; every later task appends in the same place):

```js
// --- Task 2: NodeMetadata fields --------------------------------------------
const { parseBundle } = schema;
const NOW = "2026-07-19T00:00:00.000Z";
function makeBundle(nodes, edges = [], extra = {}) {
  return {
    schema_version: 2,
    project: { id: "p", title: "P", created_at: NOW, updated_at: NOW },
    nodes,
    edges,
    ...extra,
  };
}
const acc = {
  id: "AC-pebble-draw-in-animation",
  project_id: "p",
  species: "acceptance",
  title: "Pebble draw-in animation",
  status: "backlog",
  platforms: ["web", "ios", "android"],
  metadata: {
    gherkin: "When I'm on the Pebble Detail, Then I see the Pebble appearing in a drawing animation.",
    values: ["fun-entertainment", "design-aesthetics"],
    platformStatuses: { ios: "live", android: "development" },
  },
};
const view = {
  id: "V-pebble-detail", project_id: "p", species: "view", title: "Pebble Detail",
  status: "live", platforms: ["web", "ios", "android"],
};
const covers = {
  id: "e-AC-pebble-draw-in-animation-V-pebble-detail", project_id: "p",
  source_id: "AC-pebble-draw-in-animation", target_id: "V-pebble-detail", edge_type: "covers",
};

const parsed = parseBundle(makeBundle([acc, view], [covers]));
check("parseBundle accepts gherkin/values/covers", parsed.success, JSON.stringify(parsed.success ? "" : parsed.error.issues[0]));

const badValue = JSON.parse(JSON.stringify(acc));
badValue.metadata.values = ["synergy"];
check("parseBundle rejects unknown value ids", !parseBundle(makeBundle([badValue, view], [covers])).success);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:acceptance`
Expected: FAIL — `parseBundle rejects unknown value ids` fails (the open `.catchall(z.unknown())` currently accepts any `values`).

- [ ] **Step 3: Implement**

In `packages/schema/src/bundle.ts`, extend the enums import to include `ValueSchema` and the type import to include `ValueId`:

```ts
import {
  EdgeTypeSchema,
  PlatformSchema,
  SpeciesSchema,
  StatusSchema,
  ValueSchema,
  type EdgeTypeId,
  type PlatformId,
  type SpeciesId,
  type StatusId,
  type ValueId,
} from "./enums";
```

In the `NodeMetadata` interface, after `refs?: Ref[];`:

```ts
  /** Acceptance nodes: one Given/When/Then scenario — the How (spec §3.1). */
  gherkin?: string;
  /** Acceptance nodes: value elements served — the Why (spec §3.2). */
  values?: ValueId[];
```

In `NodeMetadataSchema`'s object, after the `refs:` line:

```ts
    gherkin: z.string().optional().meta({
      description: "Acceptance nodes only: exactly one Given/When/Then scenario (the How). A second scenario is a second acceptance node.",
    }),
    values: z.array(ValueSchema).optional().meta({
      description: "Acceptance nodes only: 1..n Bain value elements served (the Why).",
    }),
```

- [ ] **Step 4: Run tests, regenerate, commit**

Run: `npm run test:acceptance && npm run test:schema && npm run generate`
Expected: PASS.

```bash
git add packages/schema/src/bundle.ts tests/schema/acceptance.test.js docs/arkaik-skill plugin public/schema
git commit -m "feat(schema): gherkin + values metadata fields on nodes"
```

---

### Task 3: Validator rules

**Files:**
- Modify: `packages/schema/src/validate.ts` (imports, `VALID_EDGE_SEMANTICS:74-88`, node loop after the `platformScreenshots` block ~`:293`)
- Test: `tests/schema/acceptance.test.js`

- [ ] **Step 1: Write the failing test**

Append:

```js
// --- Task 3: validator rules -------------------------------------------------
const { validateBundle } = schema;
const rules = (result) => result.findings.map((f) => `${f.severity}:${f.rule}`);

const okResult = validateBundle(makeBundle([acc, view], [covers]));
check("valid acceptance bundle has no findings", okResult.valid && okResult.findings.length === 0, JSON.stringify(rules(okResult)));

const flowNode = {
  id: "F-record", project_id: "p", species: "flow", title: "Record",
  status: "live", platforms: ["web"],
  metadata: { playlist: { entries: [{ type: "view", view_id: "V-pebble-detail" }] } },
};
const composesEdge = {
  id: "e-F-record-V-pebble-detail", project_id: "p",
  source_id: "F-record", target_id: "V-pebble-detail", edge_type: "composes",
};
const coversFlow = {
  id: "e-AC-pebble-draw-in-animation-F-record", project_id: "p",
  source_id: "AC-pebble-draw-in-animation", target_id: "F-record", edge_type: "covers",
};
const flowOk = validateBundle(makeBundle([acc, view, flowNode], [covers, composesEdge, coversFlow]));
check("covers acceptance→flow is admitted", flowOk.valid, JSON.stringify(flowOk.errors));

const badCovers = validateBundle(makeBundle([acc, view], [
  { id: "e-V-pebble-detail-AC-pebble-draw-in-animation", project_id: "p",
    source_id: "V-pebble-detail", target_id: "AC-pebble-draw-in-animation", edge_type: "covers" },
]));
check("covers view→acceptance is rejected", rules(badCovers).includes("error:edge-semantics"), JSON.stringify(rules(badCovers)));

const badVal = JSON.parse(JSON.stringify(acc));
badVal.metadata.values = ["synergy"];
check("unknown value element is an error",
  rules(validateBundle(makeBundle([badVal, view], [covers]))).includes("error:valid-value"));

const draft = { id: "AC-draft", project_id: "p", species: "acceptance", title: "Draft", status: "idea", platforms: ["web"] };
const draftResult = validateBundle(makeBundle([draft]));
check("title-only acceptance draft: two warnings, still valid",
  draftResult.valid &&
  rules(draftResult).includes("warning:acceptance-gherkin-missing") &&
  rules(draftResult).includes("warning:acceptance-values-missing"),
  JSON.stringify(rules(draftResult)));

const viewWithGherkin = JSON.parse(JSON.stringify(view));
viewWithGherkin.metadata = { gherkin: "When…", values: ["informs"] };
const misplaced = validateBundle(makeBundle([viewWithGherkin]));
check("gherkin/values on a view are warnings",
  misplaced.valid &&
  rules(misplaced).includes("warning:gherkin-species") &&
  rules(misplaced).includes("warning:values-species"),
  JSON.stringify(rules(misplaced)));

const accBadSubset = JSON.parse(JSON.stringify(acc));
accBadSubset.platforms = ["ios"];
accBadSubset.metadata.platformStatuses = { web: "live", ios: "live" };
check("platformStatuses outside platforms stays a warning on acceptances (spec deviation note)",
  rules(validateBundle(makeBundle([accBadSubset, view], [covers]))).includes("warning:platform-statuses-subset"));

const uncovered = validateBundle(makeBundle([draft]));
check("acceptance with zero covers edges is NOT an orphan finding",
  !rules(uncovered).some((r) => r.includes("orphan")));
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:acceptance`
Expected: FAIL — `covers acceptance→flow is admitted` fails today only if semantics row missing (it is: `VALID_EDGE_SEMANTICS` has no `covers` key → TypeScript won't even compile after Task 1 until this row exists; if the build already forced you to add a stub row, the rule-specific checks (`valid-value`, `acceptance-gherkin-missing`, …) fail instead).

Note: after Task 1, `VALID_EDGE_SEMANTICS: Record<EdgeTypeId, …>` fails to compile without a `covers` entry — if you had to add it as an empty array `covers: []` to keep Task 1 green, this task replaces it.

- [ ] **Step 3: Implement**

In `validate.ts`, extend the ids import:

```ts
import {
  EDGE_TYPE_IDS,
  PLATFORM_IDS,
  SPECIES_IDS,
  STATUS_IDS,
  VALUE_IDS,
  type EdgeTypeId,
  type SpeciesId,
  type ValueId,
} from "./ids";
```

Add to `VALID_EDGE_SEMANTICS` (after `queries`):

```ts
  covers: [
    ["acceptance", "view"],
    ["acceptance", "flow"],
  ],
```

In the node loop, insert after the `platformScreenshots` block (line ~293, before the `// Refs` comment):

```ts
    // Acceptance fields (spec §3.1/§4). gherkin/values are the acceptance's
    // How/Why; on any other species they are almost certainly a mistake.
    // Missing on an acceptance is a warning — title-only drafts are legal.
    const gherkin = md.gherkin;
    const values = md.values;
    if (species === "acceptance") {
      if (typeof gherkin !== "string" || !gherkin.trim()) {
        warn(
          `${base}.metadata.gherkin`,
          "acceptance-gherkin-missing",
          `Acceptance ${nodeId}: metadata.gherkin is missing or empty (one Given/When/Then scenario expected)`,
        );
      }
      if (!Array.isArray(values) || values.length === 0) {
        warn(
          `${base}.metadata.values`,
          "acceptance-values-missing",
          `Acceptance ${nodeId}: metadata.values is missing or empty (assign 1-3 value elements)`,
        );
      }
    } else {
      if (gherkin !== undefined) {
        warn(`${base}.metadata.gherkin`, "gherkin-species", `Node ${nodeId}: metadata.gherkin is only meaningful on acceptance nodes`);
      }
      if (values !== undefined) {
        warn(`${base}.metadata.values`, "values-species", `Node ${nodeId}: metadata.values is only meaningful on acceptance nodes`);
      }
    }
    if (Array.isArray(values)) {
      for (const v of values) {
        if (!VALUE_IDS.includes(v as ValueId)) {
          error(`${base}.metadata.values`, "valid-value", `Node ${nodeId}: invalid value element "${v}"`);
        }
      }
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:acceptance`
Expected: PASS. (Don't run `test:schema` yet — the parity oracle is regenerated in Step 5.)

- [ ] **Step 5: Regenerate the standalone validator, re-run parity, commit**

Run: `npm run generate && npm run test:schema && npm run validate:seeds`
Expected: PASS.

```bash
git add packages/schema/src/validate.ts tests/schema/acceptance.test.js docs/arkaik-skill plugin public/schema
git commit -m "feat(schema): covers edge semantics + acceptance validation rules"
```

---

### Task 4: Parity fixtures

**Files:**
- Create: `tests/fixtures/acceptance-valid.json`, `tests/fixtures/acceptance-invalid.json`
- Modify: `tests/schema/parity.test.js:22-35` (FIXTURES list)

- [ ] **Step 1: Create the fixtures**

`tests/fixtures/acceptance-valid.json` — exercises acceptance + covers + values + per-platform status, expected: valid, 0 errors, 0 warnings:

```json
{
  "schema_version": 2,
  "project": {
    "id": "fixture",
    "title": "Acceptance Fixture",
    "created_at": "2026-07-19T00:00:00.000Z",
    "updated_at": "2026-07-19T00:00:00.000Z"
  },
  "nodes": [
    {
      "id": "V-pebble-detail",
      "project_id": "fixture",
      "species": "view",
      "title": "Pebble Detail",
      "status": "live",
      "platforms": ["web", "ios", "android"]
    },
    {
      "id": "AC-pebble-draw-in-animation",
      "project_id": "fixture",
      "species": "acceptance",
      "title": "Pebble draw-in animation",
      "status": "backlog",
      "platforms": ["web", "ios", "android"],
      "metadata": {
        "gherkin": "When I'm on the Pebble Detail, Then I see the Pebble appearing in a drawing animation.",
        "values": ["fun-entertainment", "design-aesthetics"],
        "platformStatuses": { "ios": "live", "android": "development" }
      }
    }
  ],
  "edges": [
    {
      "id": "e-AC-pebble-draw-in-animation-V-pebble-detail",
      "project_id": "fixture",
      "source_id": "AC-pebble-draw-in-animation",
      "target_id": "V-pebble-detail",
      "edge_type": "covers"
    }
  ]
}
```

`tests/fixtures/acceptance-invalid.json` — expected: invalid (1 error: `valid-value`; 1 error: `edge-semantics`; 2 warnings: missing gherkin/values on the draft):

```json
{
  "schema_version": 2,
  "project": {
    "id": "fixture",
    "title": "Acceptance Invalid Fixture",
    "created_at": "2026-07-19T00:00:00.000Z",
    "updated_at": "2026-07-19T00:00:00.000Z"
  },
  "nodes": [
    {
      "id": "V-home",
      "project_id": "fixture",
      "species": "view",
      "title": "Home",
      "status": "live",
      "platforms": ["web"]
    },
    {
      "id": "AC-bad-value",
      "project_id": "fixture",
      "species": "acceptance",
      "title": "Bad value",
      "status": "idea",
      "platforms": ["web"],
      "metadata": { "gherkin": "When…, Then….", "values": ["synergy"] }
    },
    {
      "id": "AC-draft",
      "project_id": "fixture",
      "species": "acceptance",
      "title": "Draft",
      "status": "idea",
      "platforms": ["web"]
    }
  ],
  "edges": [
    {
      "id": "e-V-home-AC-draft",
      "project_id": "fixture",
      "source_id": "V-home",
      "target_id": "AC-draft",
      "edge_type": "covers"
    }
  ]
}
```

- [ ] **Step 2: Add both to the parity FIXTURES list**

In `tests/schema/parity.test.js`, append inside `FIXTURES`:

```js
  "tests/fixtures/acceptance-valid.json",
  "tests/fixtures/acceptance-invalid.json",
```

- [ ] **Step 3: Run parity to verify agreement**

Run: `npm run test:schema`
Expected: PASS with the new lines `PASS: tests/fixtures/acceptance-valid.json (valid, 0 errors, 0 warnings)` and `PASS: tests/fixtures/acceptance-invalid.json (invalid, 2 errors, 2 warnings)`. If counts disagree, the zod validator and the regenerated standalone validator have drifted — fix `validate.ts`, re-run `npm run generate`, never patch the generated file.

- [ ] **Step 4: Commit**

```bash
git add tests/fixtures/acceptance-valid.json tests/fixtures/acceptance-invalid.json tests/schema/parity.test.js
git commit -m "test(schema): acceptance parity fixtures"
```

---

### Task 5: Projections module (`acceptance.ts`)

**Files:**
- Create: `packages/schema/src/acceptance.ts`
- Modify: `packages/schema/src/index.ts`, `tests/schema/load-schema.js:19` (MODULES)
- Test: `tests/schema/acceptance.test.js`

- [ ] **Step 1: Write the failing test**

Append:

```js
// --- Task 5: projections -----------------------------------------------------
const {
  resolvePlatformStatus, hasParityGap, computeParityGaps,
  acceptancesCovering, computeUncoveredViews, computeAnchorRollup,
} = schema;

check("resolvePlatformStatus: override wins", resolvePlatformStatus(acc, "ios") === "live");
check("resolvePlatformStatus: base fallback", resolvePlatformStatus(acc, "web") === "backlog");
check("resolvePlatformStatus: non-applicable platform is undefined",
  resolvePlatformStatus({ ...acc, platforms: ["ios"] }, "web") === undefined);

check("hasParityGap: live on ios, not on web/android", hasParityGap(acc) === true);
const allLive = { ...acc, status: "live", metadata: { ...acc.metadata, platformStatuses: {} } };
check("hasParityGap: uniformly live is no gap", hasParityGap(allLive) === false);
const noneLive = { ...acc, metadata: { ...acc.metadata, platformStatuses: { ios: "development", android: "development" } } };
check("hasParityGap: nothing delivered is no gap", hasParityGap(noneLive) === false);
check("hasParityGap: archived acceptances are excluded", hasParityGap({ ...acc, status: "archived" }) === false);
check("hasParityGap: threshold parameter", hasParityGap(noneLive, ["live", "development"]) === true);

const gaps = computeParityGaps([acc, view, allLive]);
check("computeParityGaps returns only gapped acceptances",
  gaps.length === 1 && gaps[0].node_id === "AC-pebble-draw-in-animation" &&
  gaps[0].delivered.includes("ios") && gaps[0].missing.web === "backlog" && gaps[0].missing.android === "development",
  JSON.stringify(gaps));

check("acceptancesCovering finds the acceptance",
  acceptancesCovering("V-pebble-detail", [acc, view], [covers]).map((n) => n.id).join() === "AC-pebble-draw-in-animation");

const orphanView = { id: "V-orphan", project_id: "p", species: "view", title: "Orphan", status: "idea", platforms: ["web"] };
check("computeUncoveredViews lists views without covers",
  computeUncoveredViews([acc, view, orphanView], [covers]).map((n) => n.id).join() === "V-orphan");

const rollup = computeAnchorRollup("V-pebble-detail", [acc, view], [covers]);
check("computeAnchorRollup counts resolved statuses per platform",
  rollup !== null && rollup.ios.live === 1 && rollup.android.development === 1 && rollup.web.backlog === 1,
  JSON.stringify(rollup));
check("computeAnchorRollup is null when nothing covers (fallback signal)",
  computeAnchorRollup("V-orphan", [acc, view, orphanView], [covers]) === null);
```

- [ ] **Step 2: Add `"acceptance"` to `MODULES` in `tests/schema/load-schema.js` and run to verify it fails**

In `tests/schema/load-schema.js:19`, insert `"acceptance"` into the MODULES array after `"validate"`.

Run: `npm run test:acceptance`
Expected: FAIL — module `acceptance.ts` does not exist yet (transpile read throws) or the destructured functions are undefined.

- [ ] **Step 3: Implement `packages/schema/src/acceptance.ts`**

```ts
/**
 * Acceptance projections — parity gaps, coverage, and per-anchor rollups
 * (docs/superpowers/specs/2026-07-19-acceptance-value-model-design.md §3.4–3.5).
 *
 * Deliberately zod-free (type-only imports) like validate.ts/journal.ts, so
 * the logic can bundle into standalone tools and stays browser-safe. These are
 * pure functions over nodes/edges; nothing here is stored state.
 */

import type { PlatformId, StatusId } from "./ids";
import type { Edge, Node } from "./bundle";

type StatusCarrier = Pick<Node, "status" | "platforms" | "metadata">;

/** Default "delivered" bucket for parity: shipped means live (spec §3.5). */
export const DEFAULT_DELIVERED_STATUSES: readonly StatusId[] = ["live"];

/**
 * Resolved status of a node for one platform: the platformStatuses override,
 * else the node's base status. Undefined when the platform is not applicable.
 */
export function resolvePlatformStatus(node: StatusCarrier, platform: PlatformId): StatusId | undefined {
  if (!node.platforms.includes(platform)) return undefined;
  return node.metadata?.platformStatuses?.[platform] ?? node.status;
}

/**
 * A parity gap: delivered on at least one applicable platform, not on at least
 * one other (spec §3.5). Archived acceptances never gap.
 */
export function hasParityGap(
  node: StatusCarrier,
  deliveredStatuses: readonly StatusId[] = DEFAULT_DELIVERED_STATUSES,
): boolean {
  if (node.status === "archived") return false;
  const resolved = node.platforms
    .map((platform) => resolvePlatformStatus(node, platform))
    .filter((status): status is StatusId => status !== undefined);
  const delivered = resolved.filter((status) => deliveredStatuses.includes(status));
  return delivered.length > 0 && delivered.length < resolved.length;
}

export interface AcceptanceParityGap {
  node_id: string;
  title: string;
  /** Platforms where the acceptance is delivered. */
  delivered: PlatformId[];
  /** Lagging platforms → their resolved (non-delivered) status. */
  missing: Partial<Record<PlatformId, StatusId>>;
}

/** Every acceptance node with a parity gap, in node order. */
export function computeParityGaps(
  nodes: readonly Node[],
  deliveredStatuses: readonly StatusId[] = DEFAULT_DELIVERED_STATUSES,
): AcceptanceParityGap[] {
  const gaps: AcceptanceParityGap[] = [];
  for (const node of nodes) {
    if (node.species !== "acceptance") continue;
    if (!hasParityGap(node, deliveredStatuses)) continue;
    const delivered: PlatformId[] = [];
    const missing: Partial<Record<PlatformId, StatusId>> = {};
    for (const platform of node.platforms) {
      const status = resolvePlatformStatus(node, platform);
      if (status === undefined) continue;
      if (deliveredStatuses.includes(status)) delivered.push(platform);
      else missing[platform] = status;
    }
    gaps.push({ node_id: node.id, title: node.title, delivered, missing });
  }
  return gaps;
}

/** The acceptance nodes covering `anchorId` (incoming covers edges). */
export function acceptancesCovering(
  anchorId: string,
  nodes: readonly Node[],
  edges: readonly Edge[],
): Node[] {
  const coveringIds = new Set(
    edges
      .filter((edge) => edge.edge_type === "covers" && edge.target_id === anchorId)
      .map((edge) => edge.source_id),
  );
  return nodes.filter((node) => node.species === "acceptance" && coveringIds.has(node.id));
}

/** Views no acceptance covers — the "what's missing" coverage radar (spec §4). */
export function computeUncoveredViews(nodes: readonly Node[], edges: readonly Edge[]): Node[] {
  const coveredIds = new Set(
    edges.filter((edge) => edge.edge_type === "covers").map((edge) => edge.target_id),
  );
  return nodes.filter((node) => node.species === "view" && !coveredIds.has(node.id));
}

export type AnchorRollup = Partial<Record<PlatformId, Partial<Record<StatusId, number>>>>;

/**
 * Per-platform status counts of the acceptances covering an anchor, or null
 * when nothing covers it — the caller's signal to fall back to the anchor's
 * own stored platformStatuses (spec §3.4 computed-with-fallback).
 */
export function computeAnchorRollup(
  anchorId: string,
  nodes: readonly Node[],
  edges: readonly Edge[],
): AnchorRollup | null {
  const covering = acceptancesCovering(anchorId, nodes, edges);
  if (covering.length === 0) return null;
  const rollup: AnchorRollup = {};
  for (const acceptance of covering) {
    for (const platform of acceptance.platforms) {
      const status = resolvePlatformStatus(acceptance, platform);
      if (status === undefined) continue;
      const platformCounts = (rollup[platform] ??= {});
      platformCounts[status] = (platformCounts[status] ?? 0) + 1;
    }
  }
  return rollup;
}
```

Add to `packages/schema/src/index.ts` (after `export * from "./validate";`):

```ts
export * from "./acceptance";
```

- [ ] **Step 4: Run tests, regenerate, commit**

Run: `npm run test:acceptance && npm run test:schema && npm run generate`
Expected: PASS.

```bash
git add packages/schema/src/acceptance.ts packages/schema/src/index.ts \
  tests/schema/load-schema.js tests/schema/acceptance.test.js docs/arkaik-skill plugin public/schema
git commit -m "feat(schema): acceptance projections — parity gaps, coverage, anchor rollups"
```

---

### Task 6: Backdated-journal ordering proof + per-platform event diffing

`orderEvents` (journal.ts:184) already sorts by `ts` with `id` tiebreak, and `diffPlatformStatuses` (derive.ts:129) is species-agnostic. This task *proves* both survive the retro-population scenario so a regression can't sneak in.

**Files:**
- Test: `tests/schema/acceptance.test.js`

- [ ] **Step 1: Write the test**

Append:

```js
// --- Task 6: backdated journal + event diffing -------------------------------
const { orderEvents, computeNodeTimeline, diffNodeUpdate } = schema;

// Retro-population appends events NOW with historical ts (spec §5): file order
// is newest-first here; projections must still read chronologically.
const backdated = [
  { id: "01K0ZZZZZZZZZZZZZZZZZZZZZZ", ts: "2026-07-19T00:00:00.000Z", type: "node.status_changed", node_id: "AC-x", from: "development", to: "live", platform: "ios" },
  { id: "01K0AAAAAAAAAAAAAAAAAAAAAA", ts: "2025-11-02T00:00:00.000Z", type: "node.created", node_id: "AC-x", species: "acceptance", title: "X", actor: "backfill-agent" },
  { id: "01K0BBBBBBBBBBBBBBBBBBBBBB", ts: "2026-02-14T00:00:00.000Z", type: "node.status_changed", node_id: "AC-x", from: "backlog", to: "development", platform: "ios", actor: "backfill-agent" },
];
const ordered = orderEvents(backdated);
check("orderEvents sorts backdated appends by ts",
  ordered[0].ts.startsWith("2025-11") && ordered[1].ts.startsWith("2026-02") && ordered[2].ts.startsWith("2026-07"),
  ordered.map((e) => e.ts).join(", "));
const timeline = computeNodeTimeline(backdated, "AC-x");
check("computeNodeTimeline reads backdated events chronologically",
  Array.isArray(timeline) ? timeline[0]?.type === "node.created" : true,
  JSON.stringify(timeline).slice(0, 200));

// diffNodeUpdate emits node.status_changed + platform for an acceptance's
// platformStatuses delta — same mechanism views use (derive.ts:125).
const patchInputs = diffNodeUpdate(acc, {
  metadata: { ...acc.metadata, platformStatuses: { ...acc.metadata.platformStatuses, android: "live" } },
});
const platformEvents = patchInputs.filter((input) => input.type === "node.status_changed");
check("diffNodeUpdate emits per-platform status_changed for acceptances",
  platformEvents.length === 1 &&
  platformEvents[0].payload.platform === "android" &&
  platformEvents[0].payload.from === "development" &&
  platformEvents[0].payload.to === "live",
  JSON.stringify(patchInputs));
```

- [ ] **Step 2: Run, adjust the timeline assertion to reality, commit**

Run: `npm run test:acceptance`
Expected: PASS. If `computeNodeTimeline` returns an object (not an array), open `packages/schema/src/projections.ts:80` to see its exact return shape and tighten the assertion to it — the invariant under test is "first item chronologically is the 2025 node.created despite being second in file order".

```bash
git add tests/schema/acceptance.test.js
git commit -m "test(schema): backdated journal ordering + acceptance platform-status diffing"
```

---

### Task 7: MCP extensions

**Files:**
- Modify: `packages/mcp/src/tools.ts` (imports, `nodeSummary:82-84`, `list_nodes:164-200`, `get_node:202-253`)
- Modify: `tests/mcp/run-mcp-tests.js` (append before the final failures summary in `main()`)
- Modify: `docs/spec/mcp.md` (Tool Catalog)

- [ ] **Step 1: Write the failing tests**

In `tests/mcp/run-mcp-tests.js`, find the end of `main()` (the final failure-count summary / `process.exit` block) and insert immediately before it. The fixture bundle (`tests/mcp/fixtures/bundle.json`) contains a view `V-profile` — these tests build on it via the write path so the fixture files need no edits:

```js
  // --- Acceptance layer (spec Foundation) ------------------------------------
  const createdAcc = await callTool("create_node", {
    species: "acceptance",
    title: "Profile shows avatar",
    status: "backlog",
    platforms: ["web", "ios"],
    metadata: {
      gherkin: "When I open my Profile, Then I see my avatar.",
      values: ["design-aesthetics"],
      platformStatuses: { web: "live" },
    },
  });
  check(
    "create_node accepts an acceptance (AC- id derived)",
    !createdAcc.isError && createdAcc.body?.node?.id === "AC-profile-shows-avatar",
    JSON.stringify(createdAcc.body).slice(0, 200),
  );

  const coversEdge = await callTool("add_edge", {
    source_id: "AC-profile-shows-avatar",
    target_id: "V-profile",
    edge_type: "covers",
  });
  check("add_edge accepts covers acceptance→view", !coversEdge.isError, JSON.stringify(coversEdge.body).slice(0, 200));

  const accList = await callTool("list_nodes", { species: "acceptance" });
  const accSummary = accList.body?.nodes?.find((n) => n.id === "AC-profile-shows-avatar");
  check(
    "acceptance summaries carry platform_statuses + values",
    accSummary?.platform_statuses?.web === "live" &&
      accSummary?.platform_statuses?.ios === "backlog" &&
      accSummary?.values?.[0] === "design-aesthetics",
    JSON.stringify(accSummary),
  );

  const gapList = await callTool("list_nodes", { parity_gap: true });
  check(
    "list_nodes parity_gap filter finds the gapped acceptance",
    gapList.body?.total === 1 && gapList.body.nodes[0].id === "AC-profile-shows-avatar",
    JSON.stringify(gapList.body).slice(0, 160),
  );

  const valueList = await callTool("list_nodes", { value: "design-aesthetics" });
  check("list_nodes value filter", valueList.body?.total === 1 && valueList.body.nodes[0].id === "AC-profile-shows-avatar");

  const anchorList = await callTool("list_nodes", { anchor: "V-profile" });
  check("list_nodes anchor filter", anchorList.body?.total === 1 && anchorList.body.nodes[0].id === "AC-profile-shows-avatar");

  const coveredView = await callTool("get_node", { node_id: "V-profile" });
  check(
    "get_node exposes covered_by on views",
    coveredView.body?.covered_by?.some((s) => s.id === "AC-profile-shows-avatar"),
    JSON.stringify(coveredView.body?.covered_by),
  );
```

Caution: if any existing check between the write-path tests and the summary asserts an exact journal line count or an exact `list_nodes` total, place this block AFTER those checks (it appends 2 journal events and 1 node) — "immediately before the final summary" satisfies this.

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:mcp`
Expected: FAIL on `acceptance summaries carry platform_statuses + values`, the three filter checks, and `covered_by` (the write-path checks may already pass — enums flow from Task 1).

- [ ] **Step 3: Implement in `packages/mcp/src/tools.ts`**

Extend the `@arkaik/schema` import (first import block) with:

```ts
  VALUE_IDS,
  acceptancesCovering,
  hasParityGap,
  resolvePlatformStatus,
  type ValueId,
```

Replace `nodeSummary` (lines 82–84):

```ts
function nodeSummary(node: Node) {
  const base = { id: node.id, title: node.title, species: node.species, status: node.status, platforms: node.platforms };
  if (node.species !== "acceptance") return base;
  // Acceptances are the parity unit — without resolved per-platform statuses
  // and values in the summary, reading parity costs one get_node per node.
  const platform_statuses = Object.fromEntries(
    node.platforms.map((platform) => [platform, resolvePlatformStatus(node, platform)]),
  );
  return { ...base, platform_statuses, values: node.metadata?.values ?? [] };
}
```

In the `list_nodes` tool definition, extend `properties` (after `platform`):

```ts
          value: {
            type: "string",
            enum: [...VALUE_IDS],
            description: "Only acceptances tagged with this value element.",
          },
          anchor: {
            type: "string",
            description: "Node id — only acceptances covering it via a covers edge.",
          },
          parity_gap: {
            type: "boolean",
            description: "Only acceptances delivered (live) on ≥1 applicable platform but not all.",
          },
```

Update the `list_nodes` description to:

```ts
        "List nodes in the product graph, filtered by species, status, platform, value element, covers-anchor, parity gap, and/or a case-insensitive title/description substring. Returns summaries (acceptances include platform_statuses + values).",
```

In the `list_nodes` handler, change the destructuring to `const { nodes, edges } = load(ctx);` and add before `const matches = ...`:

```ts
      const anchorCoveringIds =
        typeof args.anchor === "string"
          ? new Set(acceptancesCovering(args.anchor, nodes, edges).map((node) => node.id))
          : undefined;
```

and add inside the filter callback (after the `platform` check, before `query`):

```ts
        if (typeof args.value === "string" && !(node.metadata?.values ?? []).includes(args.value as ValueId)) return false;
        if (anchorCoveringIds !== undefined && !anchorCoveringIds.has(node.id)) return false;
        if (args.parity_gap === true && !hasParityGap(node)) return false;
```

In the `get_node` handler, change the final return to include coverage for views/flows:

```ts
      const covered_by =
        node.species === "view" || node.species === "flow"
          ? acceptancesCovering(nodeId, nodes, edges).map(nodeSummary)
          : undefined;

      return {
        node,
        edges: relatedEdges,
        whereUsedFlows,
        timeline: computeNodeTimeline(journal, nodeId),
        ...(covered_by !== undefined ? { covered_by } : {}),
      };
```

Also update the `get_node` description to:

```ts
        "Fetch one node in full: fields, its edges with neighbor titles, the flows that use it, its journal timeline, and (views/flows) the acceptances covering it.",
```

- [ ] **Step 4: Update `docs/spec/mcp.md`**

In the Tool Catalog section, update the `list_nodes` row/entry to mention the three new filters and the enriched acceptance summaries, and the `get_node` entry to mention `covered_by`. Add under the list_nodes parameter documentation (matching the doc's existing parameter-list style):

```markdown
- `value` — only acceptances tagged with this value element (enum: the 30 `VALUE_IDS`).
- `anchor` — a node id; only acceptances covering it via a `covers` edge.
- `parity_gap` — boolean; only acceptances delivered (`live`) on ≥1 applicable platform but not all (spec §3.5).

Acceptance summaries additionally carry `platform_statuses` (resolved per applicable platform) and `values`. `get_node` on a view or flow includes `covered_by`: summaries of the acceptances covering it.
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:mcp`
Expected: PASS including the seven new checks (the catalog stays 14 tools — the existing `tools/list exposes the 14-tool catalog` check must still pass).

- [ ] **Step 6: Commit**

```bash
git add packages/mcp/src/tools.ts tests/mcp/run-mcp-tests.js docs/spec/mcp.md
git commit -m "feat(mcp): acceptance-aware list_nodes filters, enriched summaries, covered_by"
```

---

### Task 8: UI config mirrors

**Files:**
- Create: `lib/config/values.ts`
- Modify: `lib/config/species.ts`, `lib/config/edge-types.ts`

No new test file. `species.ts`/`edge-types.ts` stay `as const satisfies` config arrays whose shape TypeScript enforces against the schema types. `values.ts` keeps label/icon in `Record<ValueId, string>` maps — TypeScript's exhaustiveness check makes a missing or typo'd id a compile error — and derives each element's `tier` directly from the schema's `VALUE_TIERS` map (`@arkaik/schema`) rather than duplicating it, so tier can never drift out of sync with the schema. Surfaces (next plan) consumes them.

Note: the app's hand-written `Record<SpeciesId, …>` / `Record<EdgeTypeId, …>` exhaustive-map sites (`app/project/[id]/library/page.tsx`, `components/graph/nodes/node-styles.ts`, `components/overview/InventoryCard.tsx`, `lib/utils/graph-build.ts`, `app/project/[id]/delivery/page.tsx`) were already forward-fixed with `acceptance`/`covers` entries in Task 1's follow-up commit (`fix(app): exhaustive species/edge records for acceptance + covers`), so Task 8's `npm run build` expectation below already holds going in.

- [ ] **Step 1: Create `lib/config/values.ts`**

```ts
import type { ValueId, ValueTierId } from "@arkaik/schema";

/** UI mirror for the value tiers (spec §3.2) — label + tier color. */
export const VALUE_TIERS_CONFIG = [
  { id: "functional",    label: "Functional",    color: "#94a3b8" },
  { id: "emotional",     label: "Emotional",     color: "#fb7185" },
  { id: "life-changing", label: "Life-changing", color: "#a78bfa" },
  { id: "social-impact", label: "Social impact", color: "#10b981" },
] as const satisfies readonly { id: ValueTierId; label: string; color: string }[];

/**
 * UI mirror for the 30 Bain B2C value elements — label + lucide icon name per
 * element (spec §9.2: every element renders icon + label everywhere).
 */
export const VALUES = [
  // functional
  { id: "saves-time",       tier: "functional", label: "Saves time",       icon: "Timer" },
  { id: "simplifies",       tier: "functional", label: "Simplifies",       icon: "Wand2" },
  { id: "makes-money",      tier: "functional", label: "Makes money",      icon: "Banknote" },
  { id: "reduces-risk",     tier: "functional", label: "Reduces risk",     icon: "ShieldCheck" },
  { id: "organizes",        tier: "functional", label: "Organizes",        icon: "FolderKanban" },
  { id: "integrates",       tier: "functional", label: "Integrates",       icon: "Blocks" },
  { id: "connects",         tier: "functional", label: "Connects",         icon: "Link2" },
  { id: "reduces-effort",   tier: "functional", label: "Reduces effort",   icon: "Feather" },
  { id: "avoids-hassles",   tier: "functional", label: "Avoids hassles",   icon: "Umbrella" },
  { id: "reduces-cost",     tier: "functional", label: "Reduces cost",     icon: "PiggyBank" },
  { id: "quality",          tier: "functional", label: "Quality",          icon: "Gem" },
  { id: "variety",          tier: "functional", label: "Variety",          icon: "Shapes" },
  { id: "sensory-appeal",   tier: "functional", label: "Sensory appeal",   icon: "Sparkles" },
  { id: "informs",          tier: "functional", label: "Informs",          icon: "Info" },
  // emotional
  { id: "reduces-anxiety",   tier: "emotional", label: "Reduces anxiety",   icon: "Leaf" },
  { id: "rewards-me",        tier: "emotional", label: "Rewards me",        icon: "Gift" },
  { id: "nostalgia",         tier: "emotional", label: "Nostalgia",         icon: "Hourglass" },
  { id: "design-aesthetics", tier: "emotional", label: "Design / aesthetics", icon: "Palette" },
  { id: "badge-value",       tier: "emotional", label: "Badge value",       icon: "BadgeCheck" },
  { id: "wellness",          tier: "emotional", label: "Wellness",          icon: "HeartPulse" },
  { id: "therapeutic-value", tier: "emotional", label: "Therapeutic value", icon: "Stethoscope" },
  { id: "fun-entertainment", tier: "emotional", label: "Fun / entertainment", icon: "PartyPopper" },
  { id: "attractiveness",    tier: "emotional", label: "Attractiveness",    icon: "Star" },
  { id: "provides-access",   tier: "emotional", label: "Provides access",   icon: "KeyRound" },
  // life-changing
  { id: "provides-hope",        tier: "life-changing", label: "Provides hope",        icon: "Sunrise" },
  { id: "self-actualization",   tier: "life-changing", label: "Self-actualization",   icon: "Mountain" },
  { id: "motivation",           tier: "life-changing", label: "Motivation",           icon: "Flame" },
  { id: "heirloom",             tier: "life-changing", label: "Heirloom",             icon: "Landmark" },
  { id: "affiliation-belonging", tier: "life-changing", label: "Affiliation & belonging", icon: "Users" },
  // social-impact
  { id: "self-transcendence", tier: "social-impact", label: "Self-transcendence", icon: "Globe" },
] as const satisfies readonly { id: ValueId; tier: ValueTierId; label: string; icon: string }[];

export type { ValueId, ValueTierId };
```

Verify each `icon` is a real `lucide-react` export: `node -e "const l=require('lucide-react'); for (const i of ['Timer','Wand2','Banknote','ShieldCheck','FolderKanban','Blocks','Link2','Feather','Umbrella','PiggyBank','Gem','Shapes','Sparkles','Info','Leaf','Gift','Hourglass','Palette','BadgeCheck','HeartPulse','Stethoscope','PartyPopper','Star','KeyRound','Sunrise','Mountain','Flame','Landmark','Users','Globe']) if(!l[i]) console.log('MISSING', i)"` — replace any MISSING icon with a valid lucide name of your choice.

- [ ] **Step 2: Extend `species.ts` and `edge-types.ts`**

`lib/config/species.ts` — append to `SPECIES`:

```ts
  { id: "acceptance", level: null, label: "Acceptance", description: "a testable promise: What (title), How (gherkin), Why (values), status per platform" },
```

`lib/config/edge-types.ts` — append to `EDGE_TYPES`:

```ts
  { id: "covers",   label: "Covers" },
```

- [ ] **Step 3: Verify build and lint**

Run: `npm run lint && npm run build`
Expected: clean. The generic Library/sidebar will now list acceptances with default rendering — acceptable until the Surfaces plan lands (Journey/System maps exclude them by their species-filter defaults).

Also run `grep -rn "Record<SpeciesId" app components lib` to confirm no site was missed.

- [ ] **Step 4: Commit**

```bash
git add lib/config/values.ts lib/config/species.ts lib/config/edge-types.ts
git commit -m "feat(config): value/tier/icon mirrors + acceptance species + covers edge configs"
```

---

### Task 9: Skill v3.0.0 + values reference + init `--no-values`

**Files:**
- Modify: `docs/arkaik-skill/skill.md` (frontmatter `version: 2.0.0` → `3.0.0`; new sections)
- Create: `docs/arkaik-skill/references/values.md`
- Modify: `scripts/generate/generate-plugin.js:42-49`, `packages/cli/build.js`, `packages/cli/src/commands/init.ts`
- Test: `tests/cli/init.test.js`

- [ ] **Step 1: Bump the version and add the Acceptances section to `docs/arkaik-skill/skill.md`**

Change frontmatter `version: 2.0.0` → `version: 3.0.0`.

Insert a new section immediately before `## Full Schema Reference` (line ~225):

```markdown
## Acceptances — the parity layer

An **acceptance** is a testable promise: a short `title` (the What), exactly one
Given/When/Then scenario in `metadata.gherkin` (the How), 1–3 value elements in
`metadata.values` (the Why), and a status per applicable platform. Acceptances
are where per-platform truth lives; views and flows are computed aggregates.

**Discipline — when you ship user-visible behavior on a platform:**

1. Find the acceptance covering that behavior (`covers` edge into the view or
   flow). If none exists, create one (`species: "acceptance"`, id prefix `AC-`).
2. Set `metadata.platformStatuses.<platform>` on the **acceptance** — never on
   the view. View `platformStatuses` is legacy fallback for views no acceptance
   covers yet; do not write it on covered views.
3. Append the matching `node.status_changed` event with the `platform` field.

**Rules:**

- One Given/When/Then per acceptance — a second scenario is a second acceptance.
- `Given` encodes render variants ("Given the pebble has a picture attached…").
- `platforms` lists only the platforms where the behavior is *expected* — a
  mobile-only behavior is `["ios", "android"]`, not backlog-on-web.
- `covers` edges: acceptance → view or acceptance → flow. Zero edges = a
  product-level acceptance (legal). Several = the behavior spans surfaces.
- Statuses reuse the standard lifecycle; "shipped" = `live`.

**Example** — iOS ships the draw-in animation:

```json
{
  "id": "AC-pebble-draw-in-animation",
  "project_id": "{{PRODUCT_NAME}}",
  "species": "acceptance",
  "title": "Pebble draw-in animation",
  "status": "backlog",
  "platforms": ["web", "ios", "android"],
  "metadata": {
    "gherkin": "When I'm on the Pebble Detail, Then I see the Pebble appearing in a drawing animation.",
    "values": ["fun-entertainment", "design-aesthetics"],
    "platformStatuses": { "ios": "live" }
  }
}
```

plus `{"type": "node.status_changed", "node_id": "AC-pebble-draw-in-animation", "from": "backlog", "to": "live", "platform": "ios"}` in the journal.

<!-- values:start -->
### Value mapping

Assign 1–3 `metadata.values` from the 30-element Bain pyramid when creating an
acceptance. **If unsure, omit them** — enrichment passes exist; a wrong value is
worse than a missing one. Consult `references/values.md` (one-line definitions
per element) only when actually mapping — do not load it otherwise.
<!-- values:end -->
```

Note: the `{{PRODUCT_NAME}}` placeholder is correct here — `arkaik init` renders it; the plugin channel ships the file unrendered by design.

- [ ] **Step 2: Create `docs/arkaik-skill/references/values.md`**

```markdown
# Value Elements — Bain B2C Pyramid (30)

One-line definitions for `metadata.values`. Assign 1–3 per acceptance; prefer
the most specific element; when torn between tiers, pick the higher tier only
if the acceptance genuinely operates there.

## Functional

- `saves-time` — completes the user's task in less time.
- `simplifies` — reduces steps, choices, or cognitive load.
- `makes-money` — helps the user earn.
- `reduces-risk` — protects against loss, error, or uncertainty.
- `organizes` — brings order to the user's things or life.
- `integrates` — ties different tools/parts of life together.
- `connects` — brings the user together with other people.
- `reduces-effort` — same outcome, less work.
- `avoids-hassles` — prevents friction and annoyance before it happens.
- `reduces-cost` — saves the user money.
- `quality` — superior craft or performance the user can feel.
- `variety` — meaningful choice and breadth.
- `sensory-appeal` — looks, sounds, or feels good in the moment.
- `informs` — tells the user something they want to know.

## Emotional

- `reduces-anxiety` — calms; makes the user feel safe.
- `rewards-me` — tangible perks for engagement (e.g. Karma).
- `nostalgia` — positive memory of the past (Pebbles' home turf).
- `design-aesthetics` — beauty as an experienced value, beyond function.
- `badge-value` — signals identity or status to others.
- `wellness` — improves physical or mental well-being.
- `therapeutic-value` — actively supports emotional processing or healing.
- `fun-entertainment` — enjoyable, playful, delightful.
- `attractiveness` — makes the user feel attractive.
- `provides-access` — grants entry to something otherwise out of reach.

## Life-changing

- `provides-hope` — reason to believe things can improve.
- `self-actualization` — helps the user become who they want to be.
- `motivation` — energizes the user toward their goals.
- `heirloom` — something worth passing on (memory capsules, legacies).
- `affiliation-belonging` — makes the user part of a group that matters.

## Social impact

- `self-transcendence` — helps beyond the user themselves.
```

- [ ] **Step 3: Ship the reference through both channels**

`scripts/generate/generate-plugin.js` — in `copySkillAssets()`, after the `schema.md` copy line:

```js
  fs.copyFileSync(path.join(SKILL_SRC_DIR, "references", "values.md"), path.join(SKILL_DEST_DIR, "references", "values.md"));
```

`packages/cli/build.js` — find where `references/schema.md` is copied into `dist/assets/skill/references/` and add the identical line for `references/values.md` (same pattern, same destination directory).

- [ ] **Step 4: Add `--no-values` to `arkaik init`**

In `packages/cli/src/commands/init.ts`:

Add to `InitOptions`:

```ts
  noValues: boolean;
```

Initialize it in `parseArgs`: `const opts: InitOptions = { update: false, noValues: false };` and add the branch:

```ts
    } else if (arg === "--no-values") {
      opts.noValues = true;
```

Add to the `Options:` block of `USAGE`:

```
  --no-values           Render the skill without the value-mapping guidance
                        (and skip references/values.md).
```

Replace `renderAndWriteSkill` with:

```ts
/** Strip the value-mapping guidance block (marker-delimited in skill.md). */
function stripValuesSection(content: string): string {
  return content.replace(/<!-- values:start -->[\s\S]*?<!-- values:end -->\n?/g, "");
}

/** Render the packaged skill template + copy its generated siblings into `skillsDirPath`. */
function renderAndWriteSkill(skillsDirPath: string, vars: Record<string, string>, noValues: boolean): string {
  const rawSkill = readFileSync(join(ASSET_DIR, "skill.md"), "utf8");
  const template = noValues ? stripValuesSection(rawSkill) : rawSkill;

  mkdirSync(join(skillsDirPath, "references"), { recursive: true });
  mkdirSync(join(skillsDirPath, "scripts"), { recursive: true });

  writeFileSync(join(skillsDirPath, "SKILL.md"), renderTemplate(template, vars));
  copyFileSync(join(ASSET_DIR, "references", "schema.md"), join(skillsDirPath, "references", "schema.md"));
  if (!noValues) {
    copyFileSync(join(ASSET_DIR, "references", "values.md"), join(skillsDirPath, "references", "values.md"));
  }
  copyFileSync(join(ASSET_DIR, "scripts", "validate-bundle.js"), join(skillsDirPath, "scripts", "validate-bundle.js"));

  return extractVersion(rawSkill) ?? "unknown";
}
```

Thread the flag through the two callers: `installSkill(skillsDirPath, vars, noValues)` and `updateSkill(skillsDirPath, vars, noValues)` — each gains a `noValues: boolean` parameter passed to `renderAndWriteSkill`, and `runInit` passes `opts.noValues` to both call sites.

- [ ] **Step 5: Extend `tests/cli/init.test.js`**

Open `tests/cli/init.test.js` and follow its existing pattern (it scaffolds a tmpdir and runs the built CLI) to add three assertions:

1. Plain `arkaik init` installs `references/values.md` and the rendered `SKILL.md` contains the string `## Acceptances — the parity layer` and `### Value mapping`.
2. `arkaik init --no-values` (fresh tmpdir): `SKILL.md` does NOT contain `### Value mapping` or `<!-- values:start -->`, and `references/values.md` does not exist.
3. The rendered skill frontmatter version is `3.0.0`.

- [ ] **Step 6: Regenerate, run, commit**

Run: `npm run generate && npm run test:cli`
Expected: PASS; `plugin/skills/arkaik/references/values.md` now exists; `plugin/.claude-plugin/plugin.json` version is `3.0.0`.

```bash
git add docs/arkaik-skill plugin scripts/generate/generate-plugin.js \
  packages/cli/build.js packages/cli/src/commands/init.ts tests/cli/init.test.js
git commit -m "feat(skill): v3.0.0 — acceptance discipline, values reference, init --no-values"
```

---

### Task 10: Seed showcase acceptances

**Files:**
- Modify: `seed/pebbles.json`

- [ ] **Step 1: Verify the anchor ids exist**

Run: `grep -o '"id": "V-pebble-detail"' seed/pebbles.json | head -1` and `grep -o '"id": "F-[a-z-]*"' seed/pebbles.json | sort -u | head -15`
Expected: `V-pebble-detail` exists; note a glyph-related flow id (expected: `F-swap-glyph` or similar from: Record Pebble, Onboarding, Manage Glyphs, Swap Glyph…). If `V-pebble-detail` is absent, pick two real view ids from `grep -o '"id": "V-[a-z-]*"' seed/pebbles.json | sort -u` and adapt the ids below consistently (node ids, edge ids, and edge endpoints).

- [ ] **Step 2: Add three acceptance nodes + covers edges**

Append to the `nodes` array of `seed/pebbles.json` (project_id must match the seed's `project.id` — verify with `grep '"id":' seed/pebbles.json | head -3`; expected `"pebbles"`):

```json
{
  "id": "AC-pebble-draw-in-animation",
  "project_id": "pebbles",
  "species": "acceptance",
  "title": "Pebble draw-in animation",
  "status": "backlog",
  "platforms": ["web", "ios", "android"],
  "metadata": {
    "gherkin": "When I'm on the Pebble Detail, Then I see the Pebble appearing in a drawing animation.",
    "values": ["fun-entertainment", "design-aesthetics"],
    "platformStatuses": { "ios": "live", "android": "development" }
  }
},
{
  "id": "AC-emotion-palette-on-read",
  "project_id": "pebbles",
  "species": "acceptance",
  "title": "Emotion palette on read view",
  "status": "backlog",
  "platforms": ["web", "ios", "android"],
  "metadata": {
    "gherkin": "When I read a pebble, Then its emotion is shown with the emotion category's palette.",
    "values": ["reduces-anxiety", "design-aesthetics"],
    "platformStatuses": { "ios": "live", "android": "live" }
  }
},
{
  "id": "AC-buy-community-glyph",
  "project_id": "pebbles",
  "species": "acceptance",
  "title": "Buy a community glyph (30 Karma)",
  "status": "development",
  "platforms": ["web", "ios", "android"],
  "metadata": {
    "gherkin": "Given I have 30 Karma, When I'm on the Community glyphs, Then I can buy a Glyph.",
    "values": ["rewards-me", "affiliation-belonging"],
    "platformStatuses": { "web": "live", "android": "live", "ios": "backlog" }
  }
}
```

Append to `edges` (adapt the third target to the real glyph flow/view id found in Step 1):

```json
{
  "id": "e-AC-pebble-draw-in-animation-V-pebble-detail",
  "project_id": "pebbles",
  "source_id": "AC-pebble-draw-in-animation",
  "target_id": "V-pebble-detail",
  "edge_type": "covers"
},
{
  "id": "e-AC-emotion-palette-on-read-V-pebble-detail",
  "project_id": "pebbles",
  "source_id": "AC-emotion-palette-on-read",
  "target_id": "V-pebble-detail",
  "edge_type": "covers"
},
{
  "id": "e-AC-buy-community-glyph-F-swap-glyph",
  "project_id": "pebbles",
  "source_id": "AC-buy-community-glyph",
  "target_id": "F-swap-glyph",
  "edge_type": "covers"
}
```

- [ ] **Step 3: Validate; append journal events if the cross-check demands them**

Run: `npm run validate:seeds`
Expected: PASS. The pebbles seed is Level 2 (embedded journal) — if the snapshot↔journal cross-check reports findings for the three new nodes/edges, append matching events to the seed's `journal` array (adapting the third `node_id`/`edge_id` if you changed anchors — ULIDs below are hand-authored valid Crockford base32):

```json
{ "id": "01K0ACCEPTANCESEED00000001", "ts": "2026-07-19T12:00:00.000Z", "actor": "claude-code", "type": "node.created", "node_id": "AC-pebble-draw-in-animation", "species": "acceptance", "title": "Pebble draw-in animation" },
{ "id": "01K0ACCEPTANCESEED00000002", "ts": "2026-07-19T12:00:01.000Z", "actor": "claude-code", "type": "node.created", "node_id": "AC-emotion-palette-on-read", "species": "acceptance", "title": "Emotion palette on read view" },
{ "id": "01K0ACCEPTANCESEED00000003", "ts": "2026-07-19T12:00:02.000Z", "actor": "claude-code", "type": "node.created", "node_id": "AC-buy-community-glyph", "species": "acceptance", "title": "Buy a community glyph (30 Karma)" },
{ "id": "01K0ACCEPTANCESEED00000004", "ts": "2026-07-19T12:00:03.000Z", "actor": "claude-code", "type": "edge.added", "edge_id": "e-AC-pebble-draw-in-animation-V-pebble-detail", "source_id": "AC-pebble-draw-in-animation", "target_id": "V-pebble-detail", "edge_type": "covers" },
{ "id": "01K0ACCEPTANCESEED00000005", "ts": "2026-07-19T12:00:04.000Z", "actor": "claude-code", "type": "edge.added", "edge_id": "e-AC-emotion-palette-on-read-V-pebble-detail", "source_id": "AC-emotion-palette-on-read", "target_id": "V-pebble-detail", "edge_type": "covers" },
{ "id": "01K0ACCEPTANCESEED00000006", "ts": "2026-07-19T12:00:05.000Z", "actor": "claude-code", "type": "edge.added", "edge_id": "e-AC-buy-community-glyph-F-swap-glyph", "source_id": "AC-buy-community-glyph", "target_id": "F-swap-glyph", "edge_type": "covers" }
```

Re-run: `npm run validate:seeds` → PASS. Also run `npm run test:migrate` (the seed-import test consumes this file).

- [ ] **Step 4: Commit**

```bash
git add seed/pebbles.json
git commit -m "feat(seed): three showcase acceptances on the Pebbles bundle"
```

---

### Task 11: Docs + final verification

**Files:**
- Modify: `docs/graph-model.md`, `docs/spec/bundle-format.md`

- [ ] **Step 1: `docs/graph-model.md`**

Add `acceptance` to the species table/description (same style as the existing four): *"acceptance — a testable promise: What (`title`), How (`metadata.gherkin`, one Given/When/Then), Why (`metadata.values`, Bain elements), with per-platform status in `metadata.platformStatuses`. Id prefix `AC-`."*

Add `covers` to the edge-semantics documentation (near the `calls` fan-out note at line ~150): *"covers — acceptance → view | flow. Zero covers edges = product-level acceptance (legal, not an orphan). Stored per-platform status lives on acceptances; a covered view's per-platform status is computed from its covering acceptances, falling back to the view's stored `platformStatuses` when uncovered (spec §3.4)."*

Confirm every step of the `## Taxonomy Update Checklist` (line 173) is either done or deliberately deferred: config arrays ✓ (Task 8); journey/system graph builders — no change needed (their species defaults exclude `acceptance`; verify with `grep -n "acceptance" lib/utils/journey-graph.ts lib/utils/system-graph.ts` returning nothing and note it); Canvas registrations — deferred to Surfaces plan (generic rendering acceptable); forms/panels branching by species — deferred to Surfaces plan; seed ✓ (Task 10); this document ✓.

- [ ] **Step 2: `docs/spec/bundle-format.md`**

Add an `### Acceptance Nodes` subsection (place it near the References/Asset sections, matching heading style):

```markdown
### Acceptance Nodes

An `acceptance` node (id prefix `AC-`) is a testable promise: `title` is the
What, `metadata.gherkin` holds exactly one Given/When/Then scenario (the How),
`metadata.values` holds 1..n elements of the core value enum (the Why — Bain
B2C pyramid, see the generated JSON Schema `Value` enum). Per-platform status
uses the same `metadata.platformStatuses` mechanic as views; `platforms` lists
the platforms where the behavior is expected ("availability").

`covers` edges (acceptance → view | flow) anchor the promise to surfaces. Zero
covers edges is legal (a product-level acceptance). Stored per-platform status
lives on acceptances; covered views compute theirs (validator: missing
`gherkin`/`values` on an acceptance are warnings; unknown value ids are errors;
`gherkin`/`values` on other species are warnings).
```

- [ ] **Step 3: Full verification sweep**

Run:

```bash
npm run generate && git status --short && \
npm run test:schema && npm run test:acceptance && npm run test:id-gen && \
npm run test:emit && npm run test:journal && npm run test:journal-projections && \
npm run test:migrate && npm run validate:seeds && npm run test:mcp && npm run test:cli && \
npm run lint && npm run build
```

Expected: everything PASS, `git status` shows no unstaged generated drift.

- [ ] **Step 4: Commit**

```bash
git add docs/graph-model.md docs/spec/bundle-format.md
git commit -m "docs: acceptance & value model — graph model + bundle format"
```

---

## Out of scope for this plan (per spec §14)

- **Surfaces plan** (next, after this lands): `/acceptances` parity matrix, `/pyramid` element grid with icons, node-panel Acceptances section, delivery-board acceptance cards, Library/sidebar/Overview integrations, and the app-side computed-with-fallback wiring (`lib/utils/platform-status.ts` consuming `computeAnchorRollup`).
- **Retro-population issue briefs** (pbbls repo): skill v3 rollout via `arkaik init --update`, ~13–15 seeding issues, ~6–10 history-mining issues, enrichment, verification — drafted as GitHub issues once this plan's MCP/skill surface is frozen.
- **Follow-up briefs**: objectives/time-series brainstorm; navigation remediation brainstorm.
