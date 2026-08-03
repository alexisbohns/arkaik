# Decisions Species Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 6th species `decision` (ADR-style records with their own status enum), three edge types (`supersedes`, `generates`, `impacts`), one journal event (`decision.status_changed`), and working surfaces (library, detail-panel editor, Decision Log page).

**Architecture:** Everything is additive — no `schema_version` bump, no migration. The schema package gains a zod-free `decision.ts` module (ids + lifecycle-sync helper, the `acceptance.ts` precedent); the edge grammar extends `VALID_EDGE_SEMANTICS` so validator and connect dialog pick it up from one table; the journal event is derived in `diffNodeUpdate` so app/MCP/CLI dual-writers all emit it for free. UI follows the acceptance playbook: species config drives the library, a species-gated editor joins `NodeDetailPanel`, and a Decision Log page mirrors the Acceptances page. Maps exclude decisions by default (kind defaults list species explicitly — zero map changes).

**Tech Stack:** TypeScript, Next.js App Router, zod 4, plain-Node test scripts (`tests/schema/*.test.js` via `load-schema.js`), lucide-react, Tailwind.

**Spec:** `docs/superpowers/specs/2026-08-03-decisions-species-design.md`

**Conventions that bind every task:**
- Tests are DB-free plain Node scripts (no Postgres on this machine). Schema tests load TS via `tests/schema/load-schema.js` (`loadSchema()` transpiles `packages/schema/src/*` — new modules are auto-discovered, nothing to register).
- CI lints: no new eslint error in any file you touch (`npx eslint <file>` before committing).
- CI diffs generated artifacts: any schema change requires `npm run generate` in the same PR (Task 12).
- Work on branch `feat/decisions-species` (already exists, carries the spec commit).

---

### Task 1: Schema — `decision` species id, `DEC-` prefix, decision-status module

**Files:**
- Modify: `packages/schema/src/ids.ts` (SPECIES_IDS, line 8)
- Modify: `packages/schema/src/id-gen.ts` (SPECIES_PREFIXES, ~line 21)
- Create: `packages/schema/src/decision.ts`
- Modify: `packages/schema/src/index.ts` (add export)
- Create: `tests/schema/decision.test.js`
- Modify: `package.json` (add `test:decision` script)

- [ ] **Step 1: Write the failing test**

Create `tests/schema/decision.test.js` (copy the header style of `tests/schema/edge-semantics.test.js` — same `loadSchema`/`assert` scaffolding):

```js
#!/usr/bin/env node

/**
 * The decision species and its status enum (cycle 2 of the self-map program,
 * docs/superpowers/specs/2026-08-03-decisions-species-design.md). Decision
 * statuses are NOT lifecycle statuses — they live in metadata.decision_status
 * and sync to the global lifecycle via lifecycleStatusForDecision.
 */

const { loadSchema } = require("./load-schema");

const {
  SPECIES_IDS,
  SPECIES_PREFIXES,
  DECISION_STATUS_IDS,
  lifecycleStatusForDecision,
  decisionStatusOf,
} = loadSchema();

let failures = 0;
function assert(cond, message) {
  if (cond) console.log(`PASS: ${message}`);
  else {
    failures++;
    console.log(`FAIL: ${message}`);
  }
}

// --- Species registration ---------------------------------------------------
assert(SPECIES_IDS.includes("decision"), "decision is a species id");
assert(SPECIES_PREFIXES.decision === "DEC-", "decision nodes get the DEC- prefix");

// --- The decision-status vocabulary -----------------------------------------
assert(
  JSON.stringify(DECISION_STATUS_IDS) ===
    JSON.stringify(["proposed", "approved", "enacted", "rejected", "deprecated", "superseded"]),
  "six decision statuses in path order (actual renamed enacted)",
);

// --- Lifecycle sync mapping (spec §2) ---------------------------------------
assert(lifecycleStatusForDecision("proposed") === "discovery", "proposed syncs to discovery");
assert(lifecycleStatusForDecision("approved") === "backlog", "approved syncs to backlog (agreed, not yet reality)");
assert(lifecycleStatusForDecision("enacted") === "live", "enacted syncs to live");
assert(lifecycleStatusForDecision("rejected") === "archived", "rejected syncs to archived");
assert(lifecycleStatusForDecision("deprecated") === "archived", "deprecated syncs to archived");
assert(lifecycleStatusForDecision("superseded") === "archived", "superseded syncs to archived");

// --- Reading a node's decision status ---------------------------------------
assert(
  decisionStatusOf({ metadata: { decision_status: "approved" } }) === "approved",
  "decisionStatusOf reads metadata.decision_status",
);
assert(
  decisionStatusOf({ metadata: {} }) === "proposed",
  "a decision without decision_status reads as proposed (spec §9)",
);
assert(decisionStatusOf({}) === "proposed", "missing metadata reads as proposed");
assert(
  decisionStatusOf({ metadata: { decision_status: "not-a-status" } }) === "proposed",
  "an unknown stored value falls back to proposed — render, never crash",
);

process.exit(failures > 0 ? 1 : 0);
```

Add to `package.json` scripts (next to `test:edge-semantics`):

```json
"test:decision": "node tests/schema/decision.test.js",
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:decision`
Expected: FAIL — `DECISION_STATUS_IDS` is undefined (and `SPECIES_IDS.includes("decision")` is false).

- [ ] **Step 3: Implement**

In `packages/schema/src/ids.ts` line 8:

```ts
export const SPECIES_IDS = ["flow", "view", "data-model", "api-endpoint", "acceptance", "decision"] as const;
```

In `packages/schema/src/id-gen.ts`, `SPECIES_PREFIXES`:

```ts
export const SPECIES_PREFIXES: Record<SpeciesId, string> = {
  flow: "F-",
  view: "V-",
  "data-model": "DM-",
  "api-endpoint": "API-",
  acceptance: "AC-",
  decision: "DEC-",
};
```

Create `packages/schema/src/decision.ts`:

```ts
/**
 * The decision species — ADR-style records (cycle 2,
 * docs/superpowers/specs/2026-08-03-decisions-species-design.md).
 *
 * Decision statuses are NOT node lifecycle statuses: they live in
 * `metadata.decision_status` (the acceptance precedent — platformStatuses),
 * and the node's global `status` is kept in sync at write time via
 * {@link lifecycleStatusForDecision}. Like acceptance.ts, this module is
 * deliberately zod-free (type-only imports) so it bundles into standalone
 * tools and stays browser-safe; enums.ts wraps the id list in zod.
 */

import type { StatusId } from "./ids";
import type { Node } from "./bundle";

/** Decision statuses, in the usual path order; the last three are terminal. */
export const DECISION_STATUS_IDS = [
  "proposed",
  "approved",
  "enacted",
  "rejected",
  "deprecated",
  "superseded",
] as const;
export type DecisionStatusId = (typeof DECISION_STATUS_IDS)[number];

/**
 * The lifecycle status a decision node's global `status` field should carry
 * for a given decision status (spec §2). Applied by writers (the app's
 * decision editor, agents, the CLI); the validator cross-checks it as a
 * warning, never an error.
 *
 * `approved → backlog` is the load-bearing row: agreed but not yet reality is
 * exactly what `backlog` ("ready to be delivered") means.
 */
export function lifecycleStatusForDecision(decisionStatus: DecisionStatusId): StatusId {
  switch (decisionStatus) {
    case "proposed":
      return "discovery";
    case "approved":
      return "backlog";
    case "enacted":
      return "live";
    case "rejected":
    case "deprecated":
    case "superseded":
      return "archived";
  }
}

/**
 * A node's decision status as it should be read: the stored value when it is
 * in the vocabulary, else `proposed` — a decision missing the field, or
 * carrying an unknown value, renders as proposed rather than crashing
 * (spec §9).
 */
export function decisionStatusOf(node: Pick<Node, "metadata">): DecisionStatusId {
  const raw = node.metadata?.decision_status;
  return (DECISION_STATUS_IDS as readonly string[]).includes(raw as string)
    ? (raw as DecisionStatusId)
    : "proposed";
}
```

In `packages/schema/src/index.ts`, add after `export * from "./acceptance";`:

```ts
export * from "./decision";
```

**Note:** `bundle.ts` doesn't know `decision_status` yet (Task 3) — `node.metadata?.decision_status` types as `unknown` via the metadata catchall, which the code above already handles. If `tsc` complains before Task 3 lands, it is fine to run Tasks 1–3 as one commit train; each still gets its own commit.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:decision`
Expected: all PASS, exit 0.

- [ ] **Step 5: Check nothing else broke**

Run: `npm run test:schema && npm run test:id-gen`
Expected: PASS. (`SPECIES_ICONS`/`SPECIES_MINIMAP_FILL` etc. are app-side exhaustive maps — they break `next build`, not these node suites; Task 6 fixes them. Do not run `npm run build` until Task 6.)

- [ ] **Step 6: Commit**

```bash
git add packages/schema/src/ids.ts packages/schema/src/id-gen.ts packages/schema/src/decision.ts packages/schema/src/index.ts tests/schema/decision.test.js package.json
git commit -m "feat(schema): decision species — id, DEC- prefix, status enum, lifecycle sync"
```

---

### Task 2: Schema — edge grammar (`supersedes`, `generates`, `impacts`)

**Files:**
- Modify: `packages/schema/src/ids.ts` (EDGE_TYPE_IDS line 25, VALID_EDGE_SEMANTICS line 34)
- Modify: `tests/schema/edge-semantics.test.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/schema/edge-semantics.test.js`, before the final `process.exit` / summary lines (match the file's existing assertion style):

```js
// --- Decision edges (cycle 2): supersedes / generates / impacts -------------
assert(isValidEdgeSemantic("supersedes", "decision", "decision"), "supersedes decision → decision is admitted");
assert(!isValidEdgeSemantic("supersedes", "decision", "view"), "supersedes only connects decisions");

assert(isValidEdgeSemantic("generates", "decision", "acceptance"), "generates decision → acceptance is admitted");
assert(!isValidEdgeSemantic("generates", "acceptance", "decision"), "generates is one-directional");
assert(!isValidEdgeSemantic("generates", "decision", "view"), "generates only targets acceptances");

for (const target of ["flow", "view", "data-model", "api-endpoint"]) {
  assert(isValidEdgeSemantic("impacts", "decision", target), `impacts decision → ${target} is admitted`);
}
// generates and impacts are deliberately disjoint: an acceptance is generated,
// never merely impacted (spec §3).
assert(!isValidEdgeSemantic("impacts", "decision", "acceptance"), "impacts decision → acceptance stays rejected");
assert(!isValidEdgeSemantic("impacts", "decision", "decision"), "impacts decision → decision stays rejected (that's supersedes)");
assert(!isValidEdgeSemantic("impacts", "view", "decision"), "impacts is one-directional out of the decision");

assert(
  JSON.stringify(edgeTypesForSpeciesPair("decision", "decision")) === JSON.stringify(["supersedes"]),
  "connect dialog offers exactly supersedes for decision → decision",
);
assert(
  JSON.stringify(edgeTypesForSpeciesPair("decision", "acceptance")) === JSON.stringify(["generates"]),
  "connect dialog offers exactly generates for decision → acceptance",
);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:edge-semantics`
Expected: the new assertions FAIL (`supersedes` unknown), the pre-existing ones still PASS.

- [ ] **Step 3: Implement**

In `packages/schema/src/ids.ts`:

```ts
export const EDGE_TYPE_IDS = ["composes", "calls", "displays", "queries", "covers", "supersedes", "generates", "impacts"] as const;
```

Extend `VALID_EDGE_SEMANTICS` (after the `covers` entry):

```ts
  // Decision edges (cycle 2). `generates` and `impacts` are deliberately
  // disjoint: an acceptance is *generated* by a decision, never merely
  // impacted, so `impacts` does not admit an acceptance target
  // (docs/superpowers/specs/2026-08-03-decisions-species-design.md §3).
  supersedes: [["decision", "decision"]],
  generates: [["decision", "acceptance"]],
  impacts: [
    ["decision", "flow"],
    ["decision", "view"],
    ["decision", "data-model"],
    ["decision", "api-endpoint"],
  ],
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:edge-semantics && npm run test:decision`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/schema/src/ids.ts tests/schema/edge-semantics.test.js
git commit -m "feat(schema): decision edge grammar — supersedes, generates, impacts"
```

---

### Task 3: Schema — metadata fields + zod enum

**Files:**
- Modify: `packages/schema/src/enums.ts`
- Modify: `packages/schema/src/bundle.ts` (NodeMetadata interface ~line 106 and NodeMetadataSchema ~line 123)
- Modify: `tests/schema/decision.test.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/schema/decision.test.js` before `process.exit`. The test parses a minimal bundle through the real parse path (mirror how `tests/schema/parity.test.js` builds one — reuse its minimal-bundle shape if present; otherwise this stands alone using `parseBundle`, which `loadSchema()` exports):

```js
// --- Metadata fields parse and round-trip ------------------------------------
const { parseBundle, DecisionStatusSchema } = loadSchema();

const decisionNode = {
  id: "DEC-two-axes-stay",
  project_id: "p1",
  species: "decision",
  title: "Two axes stay",
  status: "live",
  platforms: [],
  metadata: {
    decision_status: "enacted",
    context: "Exposure and delivery lifecycle kept getting conflated.",
    consequences: "The stage axis keeps expressing exposure; statuses stay a pure delivery lifecycle.",
    decided_at: "2026-08-03",
  },
};

const bundle = {
  schema_version: 3,
  project: { id: "p1", title: "P" },
  nodes: [decisionNode],
  edges: [],
};

const parsed = parseBundle(bundle);
assert(parsed.nodes[0].metadata.decision_status === "enacted", "decision_status survives parse");
assert(parsed.nodes[0].metadata.decided_at === "2026-08-03", "decided_at survives parse");

assert(DecisionStatusSchema.safeParse("enacted").success, "DecisionStatusSchema accepts enacted");
assert(!DecisionStatusSchema.safeParse("actual").success, "DecisionStatusSchema rejects actual (renamed enacted)");

const badStatus = JSON.parse(JSON.stringify(bundle));
badStatus.nodes[0].metadata.decision_status = "actual";
let rejected = false;
try {
  parseBundle(badStatus);
} catch {
  rejected = true;
}
assert(rejected, "an unknown decision_status is a parse error (spec §7 — same posture as unknown lifecycle status)");
```

**Adaptation note:** `loadSchema()` returns the package's public exports; if the parse entry point is named differently (check `packages/schema/src/parse.ts` for the exported function — e.g. `parseBundle` vs `parseProjectBundle`), use the real name, and if it returns a result object (`{ ok, bundle, ... }`) instead of throwing, assert on that shape instead of try/catch. Keep the assertions' *meaning* identical.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:decision`
Expected: FAIL — `DecisionStatusSchema` undefined; the unknown-value assertion fails because the catchall currently accepts anything.

- [ ] **Step 3: Implement**

In `packages/schema/src/enums.ts` — import and wrap:

```ts
import { DECISION_STATUS_IDS } from "./decision";

export { DECISION_STATUS_IDS, lifecycleStatusForDecision, decisionStatusOf } from "./decision";
export type { DecisionStatusId } from "./decision";

export const DecisionStatusSchema = z.enum(DECISION_STATUS_IDS).meta({
  id: "DecisionStatus",
  description:
    "Decision nodes only: proposed → approved (agreed, not yet reality) → enacted (in effect); terminal: rejected, deprecated, superseded. Not a lifecycle status — the node's status field is kept in sync (proposed→discovery, approved→backlog, enacted→live, terminals→archived).",
});
```

(If `index.ts` re-exporting both `./enums` and `./decision` makes the re-export lines above redundant duplicates, drop them from enums.ts and keep only the zod schema — mirror however `VALUE_IDS`/`ValueSchema` is handled.)

In `packages/schema/src/bundle.ts`, extend the `NodeMetadata` interface (after `product`):

```ts
  /** Decision nodes: the decision's own status (spec §2). Not a lifecycle status. */
  decision_status?: DecisionStatusId;
  /** Decision nodes: Context — the Why (markdown). */
  context?: string;
  /** Decision nodes: Consequences — the How (markdown). */
  consequences?: string;
  /** Decision nodes: ISO 8601 date the decision was actually made (backfill-friendly; node.created events carry the write date, not this). */
  decided_at?: string;
```

…and `NodeMetadataSchema` (after `product`), importing `DecisionStatusSchema` from `./enums` and `DecisionStatusId` type from `./decision`:

```ts
    decision_status: DecisionStatusSchema.optional().meta({
      description:
        "Decision nodes only: proposed | approved | enacted | rejected | deprecated | superseded. The node's lifecycle status is kept in sync (spec §2).",
    }),
    context: z.string().optional().meta({
      description: "Decision nodes only: Context — the Why (markdown).",
    }),
    consequences: z.string().optional().meta({
      description: "Decision nodes only: Consequences — the How (markdown).",
    }),
    decided_at: z.string().optional().meta({
      description: "Decision nodes only: ISO 8601 date the decision was made.",
    }),
```

**Circular-import check:** `decision.ts` imports `type { Node } from "./bundle"` and `bundle.ts` now imports `type { DecisionStatusId } from "./decision"` — both type-only, so no runtime cycle. `bundle.ts` imports the runtime `DecisionStatusSchema` from `./enums`, which imports the runtime `DECISION_STATUS_IDS` from `./decision`, which imports nothing runtime — acyclic. If `bundle.ts` conventionally imports schemas from `./enums` already (it imports `AnyStatusSchema` etc. — it does), follow that exact pattern.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:decision && npm run test:schema && npm run test:serialize`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/schema/src/enums.ts packages/schema/src/bundle.ts tests/schema/decision.test.js
git commit -m "feat(schema): decision metadata — decision_status enum, context, consequences, decided_at"
```

---

### Task 4: Schema — journal event `decision.status_changed` + derivation

**Files:**
- Modify: `packages/schema/src/journal.ts` (JOURNAL_EVENT_TYPES line 26, event interfaces ~line 80, KnownJournalEvent union ~line 165, the type→id-fields map ~line 292, crossCheckJournal ~line 353)
- Modify: `packages/schema/src/journal-events.ts` (new per-type schema, JOURNAL_EVENT_SCHEMAS, KnownJournalEventSchema)
- Modify: `packages/schema/src/derive.ts` (diffNodeUpdate metadata loop ~line 223)
- Modify: `tests/schema/decision.test.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/schema/decision.test.js`:

```js
// --- decision.status_changed: event schema + derivation ----------------------
const { KnownJournalEventSchema, diffNodeUpdate, toJournalEvents, crossCheckJournal } = loadSchema();

const evt = {
  id: "01J0000000000000000000TEST",
  ts: "2026-08-03T12:00:00.000Z",
  type: "decision.status_changed",
  node_id: "DEC-two-axes-stay",
  from: "approved",
  to: "enacted",
};
assert(KnownJournalEventSchema.safeParse(evt).success, "decision.status_changed validates strictly");
assert(
  !KnownJournalEventSchema.safeParse({ ...evt, to: "live" }).success,
  "from/to must be decision statuses, not lifecycle statuses",
);

// diffNodeUpdate derives it from a metadata.decision_status delta — one
// derivation shared by app, MCP and CLI dual-writers.
const current = {
  id: "DEC-two-axes-stay",
  project_id: "p1",
  species: "decision",
  title: "Two axes stay",
  status: "backlog",
  platforms: [],
  metadata: { decision_status: "approved", context: "ctx" },
};
const events = diffNodeUpdate(current, {
  status: "live",
  metadata: { decision_status: "enacted", context: "ctx" },
});
const decisionEvents = events.filter((e) => e.type === "decision.status_changed");
const statusEvents = events.filter((e) => e.type === "node.status_changed");
const updatedEvents = events.filter((e) => e.type === "node.updated");
assert(decisionEvents.length === 1, "one decision.status_changed derived");
assert(
  decisionEvents[0].payload.from === "approved" && decisionEvents[0].payload.to === "enacted",
  "decision.status_changed carries from/to",
);
assert(statusEvents.length === 1, "the synced lifecycle move still emits node.status_changed");
assert(updatedEvents.length === 0, "decision_status does NOT also appear as a node.updated field path");

// First-ever assignment: prev side defaults to proposed (a decision without
// the field reads as proposed), keeping both endpoints valid enum members.
const fresh = { ...current, metadata: { context: "ctx" } };
const firstAssign = diffNodeUpdate(fresh, { metadata: { context: "ctx", decision_status: "proposed" } });
assert(
  firstAssign.filter((e) => e.type === "decision.status_changed").length === 0,
  "writing proposed onto an implicit proposed derives nothing",
);
const firstReal = diffNodeUpdate(fresh, { metadata: { context: "ctx", decision_status: "approved" } });
const firstEvt = firstReal.find((e) => e.type === "decision.status_changed");
assert(firstEvt && firstEvt.payload.from === "proposed", "first assignment's from defaults to proposed");

// makeEvent path: the stamped event validates against the strict schema.
const stamped = toJournalEvents([{ type: "decision.status_changed", payload: { node_id: "DEC-x", from: "proposed", to: "approved" } }], "test");
assert(stamped.length === 1 && stamped[0].actor === "test", "toJournalEvents stamps the envelope");

// crossCheckJournal: last decision.status_changed.to must agree with the
// snapshot's decision_status (by value, the journal's rule 3).
const ccBundle = JSON.parse(JSON.stringify(bundle));
ccBundle.journal = [
  { id: "01J0000000000000000000AAAA", ts: "2026-08-01T00:00:00.000Z", type: "node.created", node_id: "DEC-two-axes-stay", species: "decision", title: "Two axes stay" },
  { id: "01J0000000000000000000BBBB", ts: "2026-08-02T00:00:00.000Z", type: "decision.status_changed", node_id: "DEC-two-axes-stay", from: "proposed", to: "approved" },
];
const findings = crossCheckJournal(ccBundle);
assert(
  findings.some((f) => String(f.message).includes("decision")),
  "journal saying approved vs snapshot enacted is a cross-check finding",
);
ccBundle.journal.push({ id: "01J0000000000000000000CCCC", ts: "2026-08-03T00:00:00.000Z", type: "decision.status_changed", node_id: "DEC-two-axes-stay", from: "approved", to: "enacted" });
assert(
  !crossCheckJournal(ccBundle).some((f) => String(f.message).includes("decision")),
  "agreeing journal produces no decision finding",
);
```

**Adaptation note:** read `crossCheckJournal`'s finding shape in `packages/schema/src/journal.ts` (~line 353 onward) before asserting — match how the existing status-agreement finding (~line 489) is produced (severity, message wording). If cross-check findings for status agreement are errors, make the decision one an error too, same wording pattern.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:decision`
Expected: FAIL — strict schema rejects the unknown type; `diffNodeUpdate` emits `node.updated` with `metadata.decision_status` instead.

- [ ] **Step 3: Implement**

`packages/schema/src/journal.ts`:

1. Add `"decision.status_changed",` to `JOURNAL_EVENT_TYPES` (after `"node.status_changed"`).
2. Add the event interface (near `NodeStatusChangedEvent`), importing `DecisionStatusId` type from `./decision`:

```ts
/** A decision moved between decision states (metadata.decision_status). */
export interface DecisionStatusChangedEvent extends JournalEvent {
  type: "decision.status_changed";
  node_id: string;
  from: DecisionStatusId;
  to: DecisionStatusId;
}
```

3. Add `| DecisionStatusChangedEvent` to the `KnownJournalEvent` union.
4. In the type→required-id-fields map (~line 292, the one with `"node.status_changed": ["node_id"]`), add `"decision.status_changed": ["node_id"],` — this gives referential checking (event must name an existing node) for free.
5. In `crossCheckJournal` (~line 436, next to the `node.status_changed` branch): track the last `decision.status_changed.to` per node (ordered by ts/id like the existing status tracking), and after the walk compare against each decision node's snapshot value using the same read the app uses — stored `metadata.decision_status`, defaulting to `"proposed"` when absent. Emit a finding in the same shape/severity as the existing status-agreement finding (~line 489), with message:

```
Node "<id>": journal's last decision.status_changed.to "<last>" disagrees with snapshot decision_status "<current>".
```

Only compare nodes that have at least one `decision.status_changed` event (a decision with no decision events is legal — it may predate the vocabulary).

`packages/schema/src/journal-events.ts` — add (importing `DecisionStatusSchema` from `./enums`):

```ts
export const DecisionStatusChangedEventSchema = z
  .object({
    ...envelope,
    type: z.literal("decision.status_changed"),
    node_id: z.string(),
    from: DecisionStatusSchema,
    to: DecisionStatusSchema,
  })
  .catchall(z.unknown());
```

Register `"decision.status_changed": DecisionStatusChangedEventSchema,` in `JOURNAL_EVENT_SCHEMAS` and add the schema to the `KnownJournalEventSchema` union.

`packages/schema/src/derive.ts` — in `diffNodeUpdate`'s metadata loop (~line 223), add a branch before the generic `else if` and update the module-header op→event mapping comment to mention it:

```ts
      } else if (key === "decision_status") {
        // A decision transition gets its own event (cycle 2); it is never a
        // node.updated field path. Absent reads as "proposed" on both sides so
        // from/to stay valid enum members (spec §4).
        const from = prevMeta[key] ?? "proposed";
        const to = nextMeta[key] ?? "proposed";
        if (!valueEqual(from, to)) {
          events.push({ type: "decision.status_changed", payload: { node_id: nodeId, from, to } });
        }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:decision && npm run test:journal && npm run test:emit && npm run test:emit-events && npm run test:journal-projections`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/schema/src/journal.ts packages/schema/src/journal-events.ts packages/schema/src/derive.ts tests/schema/decision.test.js
git commit -m "feat(schema): decision.status_changed journal event, derived from metadata diffs"
```

---

### Task 5: Schema — validator rules

**Files:**
- Modify: `packages/schema/src/validate.ts`
- Modify: `tests/schema/decision.test.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/schema/decision.test.js`:

```js
// --- Validator rules (spec §7) — warnings, never bricks ----------------------
const { validateBundle } = loadSchema();

const wrongSpecies = JSON.parse(JSON.stringify(bundle));
wrongSpecies.nodes.push({
  id: "V-settings",
  project_id: "p1",
  species: "view",
  title: "Settings",
  status: "live",
  platforms: ["web"],
  metadata: { decision_status: "approved" },
});
const wsResult = validateBundle(wrongSpecies);
assert(wsResult.valid, "decision_status on a view is not an error");
assert(
  wsResult.warnings.some((f) => f.rule === "decision-status-wrong-species"),
  "…but it is a decision-status-wrong-species warning",
);

const mismatch = JSON.parse(JSON.stringify(bundle));
mismatch.nodes[0].status = "idea"; // enacted should sync to live
const mmResult = validateBundle(mismatch);
assert(mmResult.valid, "a lifecycle/decision-status mismatch is not an error");
assert(
  mmResult.warnings.some((f) => f.rule === "decision-lifecycle-mismatch"),
  "…but it is a decision-lifecycle-mismatch warning",
);

const clean = validateBundle(bundle);
assert(
  !clean.warnings.some((f) => f.rule.startsWith("decision-")),
  "a well-formed decision produces no decision warnings",
);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:decision`
Expected: the two `warnings.some` assertions FAIL.

- [ ] **Step 3: Implement**

In `packages/schema/src/validate.ts`, inside the per-node validation walk (find where per-node metadata rules run — e.g. near the acceptance gherkin warning around line 285), using the file's existing error/warning helper functions (defined ~line 96) and `lifecycleStatusForDecision` imported from `./decision`:

```ts
    // Decision rules (spec §7). Warnings only: hand-edited bundles must not brick.
    const decisionStatus = node.metadata?.decision_status;
    if (decisionStatus !== undefined && node.species !== "decision") {
      warn(
        `${nodePath}.metadata.decision_status`,
        "decision-status-wrong-species",
        `decision_status is meaningful on decision nodes only; "${node.id}" is a ${node.species}.`,
      );
    }
    if (node.species === "decision") {
      const effective = (DECISION_STATUS_IDS as readonly string[]).includes(decisionStatus as string)
        ? (decisionStatus as DecisionStatusId)
        : "proposed";
      const expected = lifecycleStatusForDecision(effective);
      if (node.status !== expected) {
        warn(
          `${nodePath}.status`,
          "decision-lifecycle-mismatch",
          `Decision "${node.id}" is ${effective}, whose lifecycle status should be "${expected}", but status is "${node.status}" (spec §2).`,
        );
      }
    }
```

**Adaptation note:** match the file's actual helper names and path-building style (read a neighboring rule first — e.g. the acceptance warning at ~line 285 — and mirror it exactly). Missing `decision_status` on a decision node is NOT warned here — absent legitimately reads as `proposed`; the mismatch rule (against `proposed → discovery`) already flags a decision whose status contradicts that reading.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:decision && npm run test:schema && npm run test:fixtures`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/schema/src/validate.ts tests/schema/decision.test.js
git commit -m "feat(schema): decision validator warnings — wrong species, lifecycle mismatch"
```

---

### Task 6: App config, styles, badge, and metadata helper

**Files:**
- Modify: `lib/config/species.ts`
- Modify: `lib/config/edge-types.ts`
- Create: `lib/config/decision-statuses.ts`
- Modify: `components/graph/nodes/node-styles.ts`
- Create: `components/layout/DecisionStatusBadge.tsx`
- Create: `lib/utils/decision.ts`
- Create: `tests/app/decision-utils.test.js`
- Modify: `package.json` (script), `lib/utils/graph-build.ts` (species → React Flow type map)

- [ ] **Step 1: Write the failing test**

Create `tests/app/decision-utils.test.js`. First check how existing `tests/app/*.test.js` suites load app modules (open `tests/app/product-scope.test.js` and copy its loader scaffolding exactly — app tests have their own transpile-or-require convention). The assertions:

```js
// withDecisionStatus carries sibling metadata through and never blanks:
const meta = { context: "why", refs: [{ id: "r1" }] };
const next = withDecisionStatus(meta, "approved");
assert(next.decision_status === "approved", "sets decision_status");
assert(next.context === "why" && Array.isArray(next.refs), "carries the rest of the metadata through");

// decisionUpdatePatch bundles the metadata write with the lifecycle sync:
const node = { id: "DEC-x", status: "discovery", metadata: { decision_status: "proposed", context: "why" } };
const patch = decisionUpdatePatch(node, "approved");
assert(patch.status === "backlog", "patch syncs lifecycle status (approved → backlog)");
assert(patch.metadata.decision_status === "approved", "patch writes decision_status");
assert(patch.metadata.context === "why", "patch keeps sibling metadata");
```

Add `"test:decision-utils": "node tests/app/decision-utils.test.js",` to `package.json`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:decision-utils`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the helper**

Create `lib/utils/decision.ts` (the `blocked.ts` pattern — React-free):

```ts
/**
 * Decision-status editing helpers, as pure functions over plain data — the
 * `blocked.ts` pattern. The one write path for a decision transition: the
 * metadata write and the lifecycle sync travel in the same patch, so the
 * journal derivation (diffNodeUpdate) sees both and emits
 * decision.status_changed + node.status_changed together (spec §4).
 */

import { lifecycleStatusForDecision, type DecisionStatusId } from "@arkaik/schema";
import type { Node, NodeMetadata } from "@/lib/data/types";

export { decisionStatusOf, DECISION_STATUS_IDS, type DecisionStatusId } from "@arkaik/schema";

/** This node's metadata with `decision_status` set; the rest carried through untouched. */
export function withDecisionStatus(
  metadata: NodeMetadata | undefined,
  decisionStatus: DecisionStatusId,
): NodeMetadata {
  return { ...(metadata ?? {}), decision_status: decisionStatus } as NodeMetadata;
}

/**
 * The full update patch for a decision transition: the new decision_status
 * plus the synced lifecycle status, in one `updateNode` call.
 */
export function decisionUpdatePatch(
  node: Pick<Node, "metadata">,
  decisionStatus: DecisionStatusId,
): { status: ReturnType<typeof lifecycleStatusForDecision>; metadata: NodeMetadata } {
  return {
    status: lifecycleStatusForDecision(decisionStatus),
    metadata: withDecisionStatus(node.metadata, decisionStatus),
  };
}
```

(Check `lib/data/types.ts` re-exports `NodeMetadata` — `blocked.ts` imports it from there, so it does.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:decision-utils`
Expected: PASS.

- [ ] **Step 5: Config + styles (compile-gated, no unit test)**

`lib/config/species.ts` — append to `SPECIES`:

```ts
  { id: "decision",   level: null, label: "Decision",     description: "an ADR-style decision record: Context (why), Decision (what), Consequences (how), with its own decision status" },
```

`lib/config/edge-types.ts` — append to `EDGE_TYPES`:

```ts
  { id: "supersedes", label: "Supersedes" },
  { id: "generates",  label: "Generates" },
  { id: "impacts",    label: "Impacts" },
```

Create `lib/config/decision-statuses.ts` (the `statuses.ts` pattern):

```ts
import type { DecisionStatusId } from "@arkaik/schema";

export const DECISION_STATUSES = [
  { id: "proposed",   label: "Proposed",   order: 0 },
  { id: "approved",   label: "Approved",   order: 1 },
  { id: "enacted",    label: "Enacted",    order: 2 },
  { id: "rejected",   label: "Rejected",   order: 3 },
  { id: "deprecated", label: "Deprecated", order: 4 },
  { id: "superseded", label: "Superseded", order: 5 },
] as const satisfies readonly { id: DecisionStatusId; label: string; order: number }[];

export type { DecisionStatusId };
```

`components/graph/nodes/node-styles.ts` — the exhaustive `Record<SpeciesId, …>` maps are the compile gate; `tsc`/`next build` now enumerates every site missing a `decision` entry. Add:

```ts
// in SPECIES_ICONS (import Scale from lucide-react):
  decision: Scale,

// in SPECIES_MINIMAP_FILL:
  decision: "#f43f5e", // rose-500 — unclaimed by any existing species identity
```

…and the decision-status maps (import `CircleDashed` is already imported; add `ThumbsUp`, `CircleX`, `Replace` — `CircleSlash`, `CircleCheckBig` already imported; import `DecisionStatusId` from `@/lib/config/decision-statuses`):

```ts
// One row per decision status — badge text color, dot fill. The exhaustive
// Record is the compile-time gate for future vocabulary edits, exactly like
// STATUS_STYLES above.
export const DECISION_STATUS_STYLES: Record<DecisionStatusId, { badge: string; dot: string }> = {
  proposed:   { badge: "text-gray-400",   dot: "bg-gray-400"   },
  approved:   { badge: "text-blue-400",   dot: "bg-blue-400"   },
  enacted:    { badge: "text-green-500",  dot: "bg-green-500"  },
  rejected:   { badge: "text-red-400",    dot: "bg-red-400"    },
  deprecated: { badge: "text-amber-500",  dot: "bg-amber-500"  },
  superseded: { badge: "text-violet-400", dot: "bg-violet-400" },
};

export const DECISION_STATUS_ICONS: Record<DecisionStatusId, LucideIcon> = {
  proposed:   CircleDashed,
  approved:   ThumbsUp,
  enacted:    CircleCheckBig,
  rejected:   CircleX,
  deprecated: CircleSlash,
  superseded: Replace,
};

export const DECISION_STATUS_LABELS: Record<DecisionStatusId, string> = {
  proposed:   "Proposed",
  approved:   "Approved",
  enacted:    "Enacted",
  rejected:   "Rejected",
  deprecated: "Deprecated",
  superseded: "Superseded",
};
```

Create `components/layout/DecisionStatusBadge.tsx` (the `StatusBadge` pattern, no blocked overlay):

```tsx
import type { DecisionStatusId } from "@/lib/config/decision-statuses";
import { cn } from "@/lib/utils";
import {
  DECISION_STATUS_STYLES,
  DECISION_STATUS_ICONS,
  DECISION_STATUS_LABELS,
} from "@/components/graph/nodes/node-styles";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface DecisionStatusBadgeProps {
  status: DecisionStatusId;
  /** Show the label text next to the icon (the log page does; table cells don't). */
  showLabel?: boolean;
  className?: string;
}

export function DecisionStatusBadge({ status, showLabel = false, className }: DecisionStatusBadgeProps) {
  const { badge } = DECISION_STATUS_STYLES[status] ?? DECISION_STATUS_STYLES.proposed;
  const Icon = DECISION_STATUS_ICONS[status] ?? DECISION_STATUS_ICONS.proposed;
  const label = DECISION_STATUS_LABELS[status] ?? status;

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={cn("inline-flex items-center gap-1.5", className)}>
            <Icon className={cn("w-4 h-4", badge)} aria-hidden="true" />
            {showLabel ? <span className={cn("text-xs font-medium", badge)}>{label}</span> : <span className="sr-only">{label}</span>}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
```

`lib/utils/graph-build.ts`: find the species → React Flow node type mapping (the one that maps `acceptance` → `"acceptance"` as a forward-fix placeholder) and add `decision` → `"decision"` the same way.

- [ ] **Step 6: Sweep the compile gate**

Run: `npx tsc --noEmit`
Expected: errors listing every remaining exhaustive-map/switch site missing a `decision` entry (there may be more `Record<SpeciesId, …>` maps — species icons in EntityBadges, library labels, etc.). Fix each by adding the `decision` entry using the values above (label "Decision", icon `Scale`, rose color family). Re-run until clean. **Also grep for species unions:** `grep -rn '"acceptance"' lib components app --include='*.ts*' | grep -v test` and check each site for whether `decision` needs the same handling — most read from `SPECIES` config and need nothing; note in the commit message any deliberately skipped site.

- [ ] **Step 7: Lint + commit**

```bash
npx eslint lib/config/species.ts lib/config/edge-types.ts lib/config/decision-statuses.ts components/graph/nodes/node-styles.ts components/layout/DecisionStatusBadge.tsx lib/utils/decision.ts lib/utils/graph-build.ts
git add -A lib/config components/graph/nodes/node-styles.ts components/layout/DecisionStatusBadge.tsx lib/utils/decision.ts lib/utils/graph-build.ts tests/app/decision-utils.test.js package.json
git commit -m "feat(app): decision config, styles, DecisionStatusBadge, decision-status write helper"
```

---

### Task 7: Changelog/history rendering — `describe-event.ts`

**Files:**
- Modify: `components/journal/describe-event.ts`

- [ ] **Step 1: Implement (presentation-only; verified by the manual checklist)**

In `components/journal/describe-event.ts`:

1. Import `DECISION_STATUSES` from `@/lib/config/decision-statuses` and `Scale` from lucide-react; build a label map next to the existing ones (line 32):

```ts
const DECISION_STATUS_LABEL: Record<string, string> = Object.fromEntries(
  DECISION_STATUSES.map((s) => [s.id, s.label]),
);
```

2. Add to `EVENT_ICONS`: `"decision.status_changed": Scale,`
3. Add a case in `describeJournalEvent` (next to `node.status_changed`):

```ts
    case "decision.status_changed": {
      const from = str(event.from);
      const to = str(event.to);
      return {
        icon,
        text: `${resolveTitle(event.node_id, nodesById)}: ${from ? DECISION_STATUS_LABEL[from] ?? from : "?"} → ${to ? DECISION_STATUS_LABEL[to] ?? to : "?"}`,
        meta: "Decision",
      };
    }
```

- [ ] **Step 2: Verify + commit**

Run: `npx tsc --noEmit && npx eslint components/journal/describe-event.ts`
Expected: clean.

```bash
git add components/journal/describe-event.ts
git commit -m "feat(app): render decision.status_changed in history and changelog"
```

---

### Task 8: Node detail panel — DecisionEditor + decision connections

**Files:**
- Create: `components/panels/DecisionEditor.tsx`
- Modify: `components/panels/NodeDetailPanel.tsx`

- [ ] **Step 1: Create the editor**

`components/panels/DecisionEditor.tsx`. Species-gated section rendered by `NodeDetailPanel` (the `AcceptanceEditor` slot pattern). Autosave textareas copy the debounce discipline of `NodeFields` (350 ms, compare against a last-saved ref, metadata patches replace `metadata` wholesale so always spread `node.metadata`):

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Node, Edge } from "@/lib/data/types";
import { DECISION_STATUSES, type DecisionStatusId } from "@/lib/config/decision-statuses";
import {
  DECISION_STATUS_ICONS,
  DECISION_STATUS_STYLES,
} from "@/components/graph/nodes/node-styles";
import { decisionStatusOf, decisionUpdatePatch } from "@/lib/utils/decision";

const AUTOSAVE_DELAY_MS = 350;

interface DecisionEditorProps {
  node: Node;
  allNodes: Node[];
  allEdges: Edge[];
  onUpdate: (id: string, patch: Partial<Omit<Node, "id" | "project_id">>) => Promise<void> | void;
  onNavigate?: (node: Node) => void;
}

/** One debounced metadata text field (context / consequences). */
function useDebouncedMetadataField(
  node: Node,
  key: "context" | "consequences" | "decided_at",
  onUpdate: DecisionEditorProps["onUpdate"],
) {
  const stored = typeof node.metadata?.[key] === "string" ? (node.metadata?.[key] as string) : "";
  const [value, setValue] = useState(stored);
  const lastSavedRef = useRef(stored);

  useEffect(() => {
    const trimmed = value.trim();
    if (trimmed === lastSavedRef.current) return;
    const timeout = setTimeout(() => {
      lastSavedRef.current = trimmed;
      const next: Record<string, unknown> = { ...(node.metadata ?? {}) };
      if (trimmed === "") delete next[key];
      else next[key] = trimmed;
      void onUpdate(node.id, { metadata: next });
    }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timeout);
  }, [value, key, node.id, node.metadata, onUpdate]);

  return [value, setValue] as const;
}

/** The decision → node lists the three edge types define (spec §5). */
function decisionConnections(node: Node, allNodes: Node[], allEdges: Edge[]) {
  const byId = new Map(allNodes.map((n) => [n.id, n]));
  const resolve = (ids: string[]) => ids.map((id) => byId.get(id)).filter((n): n is Node => !!n);
  return {
    supersedes: resolve(
      allEdges.filter((e) => e.edge_type === "supersedes" && e.source_id === node.id).map((e) => e.target_id),
    ),
    supersededBy: resolve(
      allEdges.filter((e) => e.edge_type === "supersedes" && e.target_id === node.id).map((e) => e.source_id),
    ),
    generates: resolve(
      allEdges.filter((e) => e.edge_type === "generates" && e.source_id === node.id).map((e) => e.target_id),
    ),
    impacts: resolve(
      allEdges.filter((e) => e.edge_type === "impacts" && e.source_id === node.id).map((e) => e.target_id),
    ),
  };
}

function LinkedNodeList({
  label,
  nodes,
  onNavigate,
}: { label: string; nodes: Node[]; onNavigate?: (node: Node) => void }) {
  if (nodes.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex flex-col gap-0.5">
        {nodes.map((n) =>
          onNavigate ? (
            <button
              key={n.id}
              type="button"
              onClick={() => onNavigate(n)}
              className="flex items-center gap-2 text-sm text-left rounded-md px-2 py-1.5 hover:bg-muted transition-colors w-full"
            >
              <span className="text-xs text-muted-foreground shrink-0 w-24 truncate">{n.id}</span>
              <span className="flex-1 truncate">{n.title}</span>
            </button>
          ) : (
            <span key={n.id} className="px-2 py-1.5 text-sm truncate">{n.title}</span>
          ),
        )}
      </div>
    </div>
  );
}

export function DecisionEditor({ node, allNodes, allEdges, onUpdate, onNavigate }: DecisionEditorProps) {
  const decisionStatus = decisionStatusOf(node);
  const [context, setContext] = useDebouncedMetadataField(node, "context", onUpdate);
  const [consequences, setConsequences] = useDebouncedMetadataField(node, "consequences", onUpdate);
  const [decidedAt, setDecidedAt] = useDebouncedMetadataField(node, "decided_at", onUpdate);
  const connections = decisionConnections(node, allNodes, allEdges);

  // One write path for a transition: decisionUpdatePatch bundles the metadata
  // write with the lifecycle sync so diffNodeUpdate derives both events.
  function handleStatusChange(value: DecisionStatusId) {
    void onUpdate(node.id, decisionUpdatePatch(node, value));
  }

  return (
    <div className="px-6 flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Decision status</span>
        <Select value={decisionStatus} onValueChange={(v) => handleStatusChange(v as DecisionStatusId)}>
          <SelectTrigger aria-label="Decision status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DECISION_STATUSES.map((s) => {
              const Icon = DECISION_STATUS_ICONS[s.id];
              return (
                <SelectItem key={s.id} value={s.id}>
                  <span className="inline-flex items-center gap-2">
                    <Icon className={`size-3.5 ${DECISION_STATUS_STYLES[s.id].badge}`} />
                    {s.label}
                  </span>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Context — why</span>
        <Textarea
          value={context}
          onChange={(e) => setContext(e.target.value)}
          placeholder="What made this decision necessary?"
          aria-label="Context"
          rows={4}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Consequences — how</span>
        <Textarea
          value={consequences}
          onChange={(e) => setConsequences(e.target.value)}
          placeholder="What follows from it — trade-offs, obligations, follow-ups?"
          aria-label="Consequences"
          rows={4}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Decided on</span>
        <Input
          type="date"
          value={decidedAt}
          onChange={(e) => setDecidedAt(e.target.value)}
          aria-label="Decided on"
        />
      </div>
      {(connections.supersedes.length > 0 ||
        connections.supersededBy.length > 0 ||
        connections.generates.length > 0 ||
        connections.impacts.length > 0) && (
        <div className="flex flex-col gap-3">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Decision links</span>
          <LinkedNodeList label="Supersedes" nodes={connections.supersedes} onNavigate={onNavigate} />
          <LinkedNodeList label="Superseded by" nodes={connections.supersededBy} onNavigate={onNavigate} />
          <LinkedNodeList label="Generated acceptances" nodes={connections.generates} onNavigate={onNavigate} />
          <LinkedNodeList label="Impacts" nodes={connections.impacts} onNavigate={onNavigate} />
        </div>
      )}
    </div>
  );
}
```

**Adaptation notes:** if `components/ui/textarea.tsx` doesn't exist, check `components/ui/` for the textarea primitive the repo uses (AcceptanceEditor edits Gherkin — copy whatever it uses). The `useDebouncedMetadataField` hook returns a tuple used with array destructuring — eslint's rules-of-hooks accepts custom hooks called at top level, which these are. `decided_at` through a debounced field is fine (a date input fires one change per pick).

- [ ] **Step 2: Wire into NodeDetailPanel**

In `components/panels/NodeDetailPanel.tsx`, after the `AcceptanceEditor` block (line 630–641), add:

```tsx
      {node.species === "decision" && allNodes && allEdges && onUpdate && (
        <DecisionEditor
          key={`decision-${node.id}`}
          node={node}
          allNodes={allNodes}
          allEdges={allEdges}
          onUpdate={onUpdate}
          onNavigate={onNavigate}
        />
      )}
```

…with the import added at the top. Nothing else changes: `NodeFields`' plain status select only renders for `data-model`/`api-endpoint` (`usesSingleStatusField`, line 92), so a decision's lifecycle status is written *only* through the sync — exactly what the spec wants. `ConnectionsSection` (line 368) filters to `data-model`/`api-endpoint` targets, so it won't duplicate the decision links.

Also update `ConnectionsSection`'s cross-layer filter so a *non-decision* node shows the decisions that impact/generate it (the reverse direction — "decided by"): in the `.filter` at line 375, extend the species check:

```tsx
    .filter((n): n is Node => !!n && (n.species === "data-model" || n.species === "api-endpoint" || n.species === "decision"));
```

(The edge scan at line 370 already includes any non-`composes` edge touching the node, so incoming `impacts`/`generates` edges surface here for views, flows, data models, endpoints, and acceptances, labeled "Decision" via the SPECIES lookup.)

- [ ] **Step 3: Verify + commit**

Run: `npx tsc --noEmit && npx eslint components/panels/DecisionEditor.tsx components/panels/NodeDetailPanel.tsx && npm run test:project-panels && npm run test:panel-stack`
Expected: clean; existing panel suites still pass.

```bash
git add components/panels/DecisionEditor.tsx components/panels/NodeDetailPanel.tsx
git commit -m "feat(app): decision editor in the node detail panel; decisions surface in Connections"
```

---

### Task 9: Decision Log page + sidebar + routing

**Files:**
- Create: `app/project/[id]/decisions/page.tsx`
- Create: `components/decisions/DecisionLog.tsx`
- Modify: `components/layout/ProjectSwitcher.tsx` (the `ProjectView` union, line 45)
- Modify: `app/project/[id]/layout.tsx` (view detection, ~line 61–70)
- Modify: `components/layout/ProjectSidebar.tsx` (Library group, after the Acceptances item at line 232–239)

- [ ] **Step 1: The log component**

Create `components/decisions/DecisionLog.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import type { Node, Edge, JournalEvent } from "@/lib/data/types";
import { DECISION_STATUSES, type DecisionStatusId } from "@/lib/config/decision-statuses";
import { decisionStatusOf } from "@/lib/utils/decision";
import { DecisionStatusBadge } from "@/components/layout/DecisionStatusBadge";
import { EntityId } from "@/components/graph/nodes/EntityBadges";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface DecisionLogProps {
  decisions: Node[];
  allEdges: Edge[];
  journal?: JournalEvent[];
  onSelect: (node: Node) => void;
}

/**
 * When a decision was made, for ordering: `decided_at` when present, else the
 * node's `node.created` journal ts, else empty (sorts last). Backfilled
 * history carries decided_at precisely because created-events all carry the
 * backfill date (spec §1).
 */
function decidedInstant(node: Node, createdTs: Map<string, string>): string {
  const decidedAt = typeof node.metadata?.decided_at === "string" ? node.metadata.decided_at : undefined;
  return decidedAt ?? createdTs.get(node.id) ?? "";
}

export function DecisionLog({ decisions, allEdges, journal, onSelect }: DecisionLogProps) {
  const [statusFilter, setStatusFilter] = useState<DecisionStatusId | "all">("all");

  const createdTs = useMemo(() => {
    const map = new Map<string, string>();
    for (const event of journal ?? []) {
      if (event.type === "node.created" && typeof event.node_id === "string" && !map.has(event.node_id)) {
        map.set(event.node_id, event.ts);
      }
    }
    return map;
  }, [journal]);

  // The supersession chain (spec §5): a decision with an incoming `supersedes`
  // edge collapses under its successor rather than cluttering the top level.
  const supersededBy = useMemo(() => {
    const map = new Map<string, string>();
    for (const edge of allEdges) {
      if (edge.edge_type === "supersedes") map.set(edge.target_id, edge.source_id);
    }
    return map;
  }, [allEdges]);

  const supersedes = useMemo(() => {
    const map = new Map<string, Node[]>();
    const byId = new Map(decisions.map((d) => [d.id, d]));
    for (const [oldId, newId] of supersededBy) {
      const oldNode = byId.get(oldId);
      if (!oldNode) continue;
      map.set(newId, [...(map.get(newId) ?? []), oldNode]);
    }
    return map;
  }, [decisions, supersededBy]);

  const topLevel = useMemo(() => {
    const filtered =
      statusFilter === "all" ? decisions : decisions.filter((d) => decisionStatusOf(d) === statusFilter);
    return filtered
      .filter((d) => statusFilter !== "all" || !supersededBy.has(d.id))
      .sort((a, b) => decidedInstant(b, createdTs).localeCompare(decidedInstant(a, createdTs)));
  }, [decisions, statusFilter, supersededBy, createdTs]);

  const counts = useMemo(() => {
    const map = new Map<DecisionStatusId, number>();
    for (const d of decisions) {
      const s = decisionStatusOf(d);
      map.set(s, (map.get(s) ?? 0) + 1);
    }
    return map;
  }, [decisions]);

  function DecisionRow({ node, dimmed }: { node: Node; dimmed?: boolean }) {
    return (
      <button
        type="button"
        onClick={() => onSelect(node)}
        className={cn(
          "flex w-full items-start gap-3 rounded-lg border bg-card px-4 py-3 text-left transition-colors hover:bg-muted",
          dimmed && "opacity-60",
        )}
      >
        <DecisionStatusBadge status={decisionStatusOf(node)} className="mt-0.5 shrink-0" />
        <span className="flex-1 min-w-0 flex flex-col gap-0.5">
          <span className="font-medium truncate">{node.title}</span>
          {node.description && (
            <span className="text-sm text-muted-foreground line-clamp-2">{node.description}</span>
          )}
        </span>
        <span className="flex flex-col items-end gap-1 shrink-0">
          <EntityId id={node.id} />
          {decidedInstant(node, createdTs) && (
            <span className="text-xs text-muted-foreground">
              {decidedInstant(node, createdTs).slice(0, 10)}
            </span>
          )}
        </span>
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-1.5">
        <Badge
          variant={statusFilter === "all" ? "default" : "outline"}
          className="cursor-pointer"
          onClick={() => setStatusFilter("all")}
        >
          All · {decisions.length}
        </Badge>
        {DECISION_STATUSES.map((s) => (
          <Badge
            key={s.id}
            variant={statusFilter === s.id ? "default" : "outline"}
            className="cursor-pointer"
            onClick={() => setStatusFilter(statusFilter === s.id ? "all" : s.id)}
          >
            {s.label} · {counts.get(s.id) ?? 0}
          </Badge>
        ))}
      </div>
      {topLevel.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          No decisions yet. Decisions record the why, what, and how of the choices that shaped this product.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {topLevel.map((node) => (
            <div key={node.id} className="flex flex-col gap-1.5">
              <DecisionRow node={node} />
              {statusFilter === "all" &&
                (supersedes.get(node.id) ?? []).map((old) => (
                  <div key={old.id} className="pl-8">
                    <DecisionRow node={old} dimmed />
                  </div>
                ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

**Adaptation note:** check `components/ui/badge.tsx` for the `variant` prop values (`default`/`outline`); if the filter-chip idiom elsewhere (e.g. `LibraryFilterBar`) uses a different primitive, copy that idiom instead — the behavior (toggle chips with counts) is what's specified, not the exact primitive.

- [ ] **Step 2: The page**

Create `app/project/[id]/decisions/page.tsx`, modeled line-for-line on `app/project/[id]/acceptances/page.tsx` (hooks, PageShell, panel opening) minus the intake/matrix machinery:

```tsx
"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { PlusIcon } from "lucide-react";
import { toast } from "sonner";
import type { Node as DataNode } from "@/lib/data/types";
import { useNodes } from "@/lib/hooks/useNodes";
import { useEdges } from "@/lib/hooks/useEdges";
import { useProjectPanels } from "@/lib/hooks/useProjectPanels";
import { useProject } from "@/lib/hooks/useProject";
import { useJournal } from "@/lib/hooks/useJournal";
import { useEffectiveProduct } from "@/lib/hooks/useProductScope";
import { DecisionLog } from "@/components/decisions/DecisionLog";
import { PageShell } from "@/components/layout/PageShell";
import { generateNodeId } from "@/lib/utils/id";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default function ProjectDecisionsPage() {
  const params = useParams();
  const id = Array.isArray(params.id) ? params.id[0] : params.id ?? "";

  const { openNode } = useProjectPanels();
  const { nodes: dataNodes, loading: nodesLoading, updateNode, addNode } = useNodes(id);
  const { edges: dataEdges, loading: edgesLoading } = useEdges(id);
  const { project: projectBundle } = useProject(id);
  const { journal } = useJournal(id);
  const scope = useEffectiveProduct(id, projectBundle);

  const [newOpen, setNewOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");

  const decisions = useMemo(
    () => dataNodes.filter((node) => node.species === "decision"),
    [dataNodes],
  );
  const nodesById = useMemo(() => new Map(dataNodes.map((n) => [n.id, n])), [dataNodes]);

  function handleSelectNode(node: DataNode) {
    openNode({ nodeId: node.id });
  }

  async function handleNodeUpdate(nodeId: string, patch: Partial<Omit<DataNode, "id" | "project_id">>) {
    await updateNode(nodeId, patch);
  }

  // A new decision is born proposed; the lifecycle status carries the synced
  // value from day one (proposed → discovery, spec §2). Decisions carry no
  // platforms — availability is not a tracked dimension for them.
  async function handleCreateDecision() {
    const title = newTitle.trim();
    if (title === "") return;
    setNewOpen(false);
    setNewTitle("");
    try {
      const created = await addNode({
        id: generateNodeId("decision", title, nodesById.keys()),
        project_id: id,
        species: "decision",
        title,
        status: "discovery",
        platforms: [],
        metadata: { decision_status: "proposed" },
      });
      handleSelectNode(created);
    } catch (err) {
      toast.error("Couldn't create the decision.");
      console.error(err);
    }
  }

  if (nodesLoading || edgesLoading) {
    return (
      <div className="h-full w-full flex items-center justify-center">
        <span className="text-muted-foreground text-sm">Loading decisions...</span>
      </div>
    );
  }

  return (
    <>
      <PageShell
        title="Decisions"
        meta={`${decisions.length} total`}
        action={{ label: "New decision", icon: PlusIcon, onClick: () => setNewOpen(true) }}
        allNodes={dataNodes}
        allEdges={dataEdges}
        scope={scope}
        journal={journal}
        onUpdate={handleNodeUpdate}
      >
        <div className="h-full overflow-auto p-4 md:p-6">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
            <DecisionLog
              decisions={decisions}
              allEdges={dataEdges}
              journal={journal}
              onSelect={handleSelectNode}
            />
          </div>
        </div>
      </PageShell>
      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New decision</DialogTitle>
          </DialogHeader>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void handleCreateDecision();
            }}
          >
            <Input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Short decision statement — the What"
              aria-label="Decision title"
              autoFocus
            />
            <Button type="submit" disabled={newTitle.trim() === ""}>
              Create
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
```

**Adaptation note:** mirror the acceptances page for `PageShell` props exactly as they exist (it may require props not shown in this sketch, or reject unknown ones). If `NewAcceptanceForm` exists as a generic-enough dialog pattern, matching its structure for the dialog is preferred over the inline `Dialog` above — same fields (title only), same submit discipline.

- [ ] **Step 3: Routing + sidebar**

`components/layout/ProjectSwitcher.tsx` line 45: add `"decisions"` to the `ProjectView` union (read the union first; add the member in the same style).

`app/project/[id]/layout.tsx` (~line 61–70): the `currentView` ternary chain has a branch per path — add, next to the acceptances branch:

```ts
          : pathname.startsWith(`/project/${id}/decisions`)
            ? "decisions"
```

`components/layout/ProjectSidebar.tsx`: import `ScaleIcon` from lucide-react; in the Library group, after the Acceptances item (line 232–239), add:

```tsx
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={currentView === "decisions"} tooltip="Decisions">
                <Link href={`/project/${projectId}/decisions`}>
                  <ScaleIcon />
                  <span>Decisions</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
```

The library `?species=decision` deep link needs **no change**: `parseSpeciesFilter` in `app/project/[id]/library/page.tsx` (line 78) validates against the `SPECIES` config, which now contains `decision` — the acceptance precedent (no `LIBRARY_ITEMS` entry; the dedicated page is the sidebar surface).

- [ ] **Step 4: Verify + commit**

Run: `npx tsc --noEmit && npx eslint app/project/\[id\]/decisions/page.tsx components/decisions/DecisionLog.tsx components/layout/ProjectSidebar.tsx components/layout/ProjectSwitcher.tsx app/project/\[id\]/layout.tsx && npm run test:root-redirect && npm run test:project-panels`
Expected: clean.

```bash
git add app/project/\[id\]/decisions components/decisions components/layout/ProjectSidebar.tsx components/layout/ProjectSwitcher.tsx app/project/\[id\]/layout.tsx
git commit -m "feat(app): Decision Log page with status filters and supersession chain"
```

---

### Task 10: Library rendering for decisions

**Files:**
- Modify: `components/library/NodeCard.tsx`
- Modify: `components/library/NodeTable.tsx` (only if its status cell needs the branch — check first)

- [ ] **Step 1: Gallery card**

In `components/library/NodeCard.tsx`: read the component and find where per-species content renders (platform gauges/lists, acceptance values). Add a decision branch that renders `DecisionStatusBadge` with `showLabel` (import from `@/components/layout/DecisionStatusBadge`, plus `decisionStatusOf` from `@/lib/utils/decision`) in place of the platform list/gauge content — a decision has `platforms: []`, so the platform affordances would render empty anyway; the decision badge is the species' one meaningful signal:

```tsx
{node.species === "decision" && (
  <DecisionStatusBadge status={decisionStatusOf(node)} showLabel />
)}
```

…and guard the platform-bearing sections with `node.species !== "decision"` **only where they would otherwise render an empty-but-visible shell** (verify by reading what each section does with an empty `platforms` array — if it already collapses to nothing, leave it untouched).

- [ ] **Step 2: Directory table**

In `components/library/NodeTable.tsx`: the status cell renders the lifecycle `StatusBadge` — leave it (the synced lifecycle status is deliberately meaningful there). No decision column; `used in` (flow playlist count) is naturally 0. Only change something if reading the file reveals a decision row would crash or render wrongly; otherwise this step is a verification, not an edit.

- [ ] **Step 3: Keep decisions off the Delivery board (spec §1)**

The board's species filter defaults to `["view"]` (`app/project/[id]/delivery/page.tsx:54`) and species are opt-in chips (`handleToggleSpecies`, line 115; the chip row is the component receiving `species={speciesFilter}` at line 183). Find where that chip component enumerates its options — if it iterates the `SPECIES` config, exclude `decision` from the offered chips with a comment:

```ts
// Decisions are excluded from delivery rollups (spec §1): their lifecycle
// status is synced bookkeeping, not delivery-board state — the Decision Log
// is their surface.
```

If the chips are a hardcoded list that doesn't include `decision`, nothing to do — note that in the commit message.

- [ ] **Step 4: Verify + commit**

Run: `npx tsc --noEmit && npx eslint components/library/NodeCard.tsx && npm run test:delivery && npm run test:coverage`
Expected: clean; delivery/coverage suites still pass.

```bash
git add components/library app/project/\[id\]/delivery lib/utils/delivery.ts
git commit -m "feat(app): decision cards in the library gallery; decisions stay off the Delivery board"
```

---

### Task 11: Seeds — pebbles example + real self-map decisions

**Files:**
- Modify: `seed/pebbles.json`
- Modify: `seed/arkaik-self-map.json`

- [ ] **Step 1: Pebbles — one worked example**

Add to `seed/pebbles.json` `nodes[]` (match the file's existing node shape — check whether nodes carry `metadata` and follow suit). Two decisions exercising the full grammar (supersession, generation, impact). The edge targets below are real ids from the seed (`AC-pebble-draw-in-animation`, `V-record-celebration`) — verify they still exist before writing:

```json
{
  "id": "DEC-adopt-glyph-wobble",
  "project_id": "pebbles",
  "species": "decision",
  "title": "Adopt the wobble animation for glyphs",
  "description": "Glyph state changes animate with the wobble easing curve rather than a linear fade.",
  "status": "live",
  "platforms": [],
  "metadata": {
    "decision_status": "enacted",
    "context": "Linear fades made state changes easy to miss in usability tests.",
    "consequences": "All glyph transitions route through the shared wobble easing; bespoke per-view animations are retired.",
    "decided_at": "2026-06-15"
  }
},
{
  "id": "DEC-linear-glyph-fade",
  "project_id": "pebbles",
  "species": "decision",
  "title": "Linear fade for glyph transitions",
  "description": "Glyph state changes use a simple linear fade.",
  "status": "archived",
  "platforms": [],
  "metadata": {
    "decision_status": "superseded",
    "context": "First pass — simplest possible transition.",
    "consequences": "Cheap to implement; proved too subtle in testing.",
    "decided_at": "2026-05-01"
  }
}
```

…and to `edges[]` (again: replace the view/acceptance targets with real ids from the seed):

```json
{ "id": "e-DEC-adopt-glyph-wobble-DEC-linear-glyph-fade", "project_id": "pebbles", "source_id": "DEC-adopt-glyph-wobble", "target_id": "DEC-linear-glyph-fade", "edge_type": "supersedes" },
{ "id": "e-DEC-adopt-glyph-wobble-AC-pebble-draw-in-animation", "project_id": "pebbles", "source_id": "DEC-adopt-glyph-wobble", "target_id": "AC-pebble-draw-in-animation", "edge_type": "generates" },
{ "id": "e-DEC-adopt-glyph-wobble-V-record-celebration", "project_id": "pebbles", "source_id": "DEC-adopt-glyph-wobble", "target_id": "V-record-celebration", "edge_type": "impacts" }
```

(The seed's project id is `pebbles` — verified. Match the edge shape of the seed's existing edges, including any `metadata` conventions.)

- [ ] **Step 2: Self-map — the real standing decisions**

Add to `seed/arkaik-self-map.json` `nodes[]` (project_id `arkaik-self-map`) — cycle 1's standing decisions become the first inhabitants (the self-map program working as intended). Three decisions, all `enacted`/`live`, `decided_at: "2026-08-03"`:

1. `DEC-two-axes-stay` — "Two axes: status is delivery, stage is exposure" — context: proposed `limited`/`deprecated` statuses would have conflated exposure with delivery lifecycle; consequences: `stage` keeps expressing exposure, the status list stays a pure delivery lifecycle, `limited`/`deprecated` rejected as statuses.
2. `DEC-blocked-is-a-flag` — "Blocked is a flag, not a status" — context: a blocked node parked in a `blocked` status lost its lifecycle position; consequences: `metadata.blocked_by` carries the dependency; a blocked node keeps its status; the library filters on the flag.
3. `DEC-migration-hard-cutover` — "Status migrations: hard cutover + permanent aliases" — context: soft-deprecation would leave 10 ids in every consumer forever; consequences: one-time version-gated remap, parse-time aliases accepted forever, journal history never rewritten.

Add `impacts` edges from each decision to the self-map nodes they actually touched — read the seed's node list first (12 nodes: 5 flows, 4 api-endpoints, 2 data-models, 1 view) and target the ones that plausibly carry status (e.g. the flows). At minimum one `impacts` edge per decision so the grammar is exercised; use the `e-{source}-{target}` id rule.

- [ ] **Step 3: Validate**

Run: `npm run validate:seeds`
Expected: both seeds valid (warnings are acceptable only if pre-existing; a `decision-lifecycle-mismatch` here means your `status` doesn't match the sync table — fix the seed).

Run: `npm run test:migrate`
Expected: PASS (seed-import round-trips).

- [ ] **Step 4: Commit**

```bash
git add seed/pebbles.json seed/arkaik-self-map.json
git commit -m "feat(seeds): decision examples in pebbles; cycle-1 standing decisions in the self-map"
```

---

### Task 12: Generated artifacts + docs

**Files:**
- Regenerate: `lib/prompts/generated/schema.ts`, `public/schema/project-bundle.json` (via `npm run generate`)
- Modify: `docs/graph-model.md`, `docs/spec/journal.md`, `docs/spec/bundle-format.md`

- [ ] **Step 1: Regenerate**

Run: `npm run generate`
Expected: the generated prompt schema and published JSON Schema pick up the species, edge types, metadata fields, and event type. `git diff --stat` shows only generated files changing. CI diffs these — they must be committed in this PR.

- [ ] **Step 2: Docs**

`docs/graph-model.md`:
- § Species table: add the `decision` row — level `—`, role "an ADR-style decision record: Context (why), Decision (what), Consequences (how), with its own decision status (`metadata.decision_status`). Id prefix `DEC-`."; React Flow type `decision` (no custom registration yet, like acceptance).
- § Edge Types table: add `supersedes` (decision → decision), `generates` (decision → acceptance), `impacts` (decision → flow | view | data-model | api-endpoint), each with a one-line meaning; note that `generates`/`impacts` are disjoint by design.
- New § Decisions section after § Status Model: the six decision statuses with meanings, the lifecycle-sync table (proposed→discovery, approved→backlog, enacted→live, terminals→archived), "documented, never enforced", the `decided_at` backfill rationale, and pointers to `packages/schema/src/decision.ts` and the Decision Log page.
- § Taxonomy Update Checklist: add a dated note (2026-08-03 — decisions) recording which steps were done where, mirroring the 2026-07-19 acceptance note's format: steps 1–2, 4–6 done; step 3 (Canvas registration) deferred like acceptance, maps exclude the species by kind defaults.

`docs/spec/journal.md`:
- § Event Vocabulary: add the row — `decision.status_changed` | `node_id`, `from`, `to` | A decision moved between decision states (`metadata.decision_status`); `from`/`to` are decision-status ids, not lifecycle ids.
- § Authority & Consistency Model rule 3: add that the last `decision.status_changed.to` for a node must equal its current `metadata.decision_status` (absent reads as `proposed`).

`docs/spec/bundle-format.md`: document the four metadata fields (decision nodes only), the decision-status enum with the sync table, the three edge semantics, and that all of it is **additive — no `schema_version` bump** (the products precedent).

- [ ] **Step 3: Commit**

```bash
git add lib/prompts/generated public/schema docs/graph-model.md docs/spec/journal.md docs/spec/bundle-format.md
git commit -m "docs+generate: decision species in generated schema, graph model, journal and bundle specs"
```

---

### Task 13: Full verification + PR

- [ ] **Step 1: Full DB-free test sweep**

Run every suite the change plausibly touches:

```bash
npm run test:decision && npm run test:decision-utils && npm run test:edge-semantics && \
npm run test:schema && npm run test:journal && npm run test:emit && npm run test:emit-events && \
npm run test:journal-projections && npm run test:serialize && npm run test:id-gen && \
npm run test:fixtures && npm run test:migrate && npm run test:project-panels && \
npm run test:panel-stack && npm run validate:seeds
```

Expected: all PASS. (`test:mcp`/`test:cli` build workspaces — run them too if time allows: `npm run test:mcp && npm run test:cli`.)

- [ ] **Step 2: Build + lint gate**

```bash
npx tsc --noEmit && npm run build
```

Expected: clean build. For lint, CI's bar is *no new error in a file you touched*: run `npx eslint` over every file in `git diff --name-only main --diff-filter=ACM | grep -E '\.(ts|tsx)$'` and fix anything new.

- [ ] **Step 3: Push and open the PR**

The PR is user-facing → **Lab Note required** (CLAUDE.md contract: heading starts with `## Lab Note`, one yaml fence, quoted titles/summaries). PR body must include:

- Summary of the model change (species, edges, event, no migration needed) and the surfaces (editor, Decision Log).
- The manual visual checklist for Alexis (no browser driver — hand off verification):
  1. Library → a decision card shows the Decision badge (not empty platform chrome); `?species=decision` filters.
  2. Detail panel on a decision: Context/Consequences/Decided-on round-trip; changing decision status moves the lifecycle badge too (check the Library card after).
  3. Decisions page: chips filter by status; a superseded decision renders dimmed+indented under its successor; "New decision" creates and opens the panel.
  4. Changelog/History: a decision transition renders as "Title: Approved → Enacted · Decision".
  5. Maps: decisions do NOT appear on Journey or System maps.
  6. Seeds: import `seed/pebbles.json` fresh; the two decisions appear with their links in the panel.

```bash
git push -u origin feat/decisions-species
gh pr create --title "Decisions species: ADR records, supersedes/generates/impacts edges, decision journal (#cycle-2)" --body "<as above, with Lab Note>"
```

Lab Note skeleton for the PR body:

```markdown
## Lab Note

​```yaml
en:
  title: "Your product's decisions, on the map"
  summary: "Arkaik now records decisions — the why, the what, and the consequences — right next to the flows and screens they shaped. Browse them in the new Decisions log, and see when one decision replaced another."
fr:
  title: "Les décisions de ton produit, sur la carte"
  summary: "Arkaik enregistre maintenant les décisions — le pourquoi, le quoi et les conséquences — juste à côté des écrans et parcours qu'elles ont façonnés. Explore-les dans le nouveau journal des décisions, et vois quand une décision en a remplacé une autre."
suggested:
  molecule: arkaik
  type: feature
  tags: [changelog]
​```
```

(Remove the zero-width characters around the yaml fence when pasting — they exist here only so this plan's own fence doesn't close.)

- [ ] **Step 4: After opening the PR, read its comments**

The Lab Note advisory reminder comments on the PR when the note is malformed; fix by editing the PR body. Do not assume the note is fine.

---

## Out of scope (do not build)

Canvas/map rendering of decisions or their edges; Milestones; Deliverables/Releases; the changelog Design|Delivery split; an Idea entity; edge-authoring UI for decision links (agents/MCP author them; the connect dialog will offer the types wherever it already lets both endpoints meet); product membership for decisions; transition enforcement.
