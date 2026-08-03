# Status Lifecycle Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 8-status lifecycle (idea, backlog, prioritized, development, releasing, live, archived, blocked) with the 7-status lifecycle (idea, discovery, backlog, development, releasing, live, archived) plus an orthogonal `metadata.blocked_by` flag, with permanent legacy aliases and a one-time versioned migration.

**Architecture:** The vocabulary lives in `packages/schema/src/ids.ts` and fans out through exhaustive `Record<StatusId, …>` maps that make `tsc` enumerate every consumer. A new pure `migrateStatusVocabulary()` in the schema package performs the remap (old `backlog→idea` first, then `prioritized→backlog`, `blocked→development`+`blocked_by`), gated on `schema_version < 3` and stamping `schema_version: 3` — this is critical because the existing migration chain never stamps versions, and an unstamped bundle would get the `backlog→idea` remap re-applied to new-vocabulary data. Zod schemas for *persisted* fields tolerate the two dead ids so old bundles parse before migration runs; journal history is never rewritten.

**Tech Stack:** TypeScript, zod 4 (`packages/schema`), Next.js app in `app/`+`lib/`+`components/`, plain-node test scripts in `tests/` (run via `npm run test:<name>`), generated artifacts via `npm run generate` (CI diffs them).

**Spec:** `docs/superpowers/specs/2026-08-03-status-lifecycle-overhaul-design.md`

**Verification baseline:** `npx tsc --noEmit` and `npm run lint` must end no worse than they started (main carries pre-existing lint errors; the bar is no NEW error in touched files). There is no local Postgres — never write a test that needs one.

---

### Task 1: Schema — legacy aliases + pure vocabulary migration (TDD)

**Files:**
- Create: `packages/schema/src/legacy-status.ts`
- Modify: `packages/schema/src/index.ts` (re-export)
- Test: `tests/schema/legacy-status.test.js`

- [ ] **Step 1: Look at an existing schema test for the harness pattern**

Read `tests/schema/promote.test.js` (first ~30 lines) and `tests/schema/load-schema.js` to see how tests import the built schema package (plain node, `assert`, no framework). Follow that pattern exactly.

- [ ] **Step 2: Write the failing test**

Create `tests/schema/legacy-status.test.js`:

```js
const assert = require("node:assert");
const { normalizeStatus, migrateStatusVocabulary, LEGACY_STATUS_ALIASES, STATUS_VOCABULARY_VERSION } = require("./load-schema.js");

// normalizeStatus
assert.equal(normalizeStatus("prioritized"), "backlog");
assert.equal(normalizeStatus("blocked"), "development");
assert.equal(normalizeStatus("discovery"), "discovery");
assert.equal(normalizeStatus("live"), "live");
assert.equal(normalizeStatus("nonsense"), undefined);
assert.deepEqual(LEGACY_STATUS_ALIASES, { prioritized: "backlog", blocked: "development" });
assert.equal(STATUS_VOCABULARY_VERSION, 3);

const oldBundle = {
  schema_version: 2,
  project: { id: "p", title: "P", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" },
  nodes: [
    { id: "V-a", project_id: "p", species: "view", title: "A", status: "backlog", platforms: ["web"] },
    { id: "V-b", project_id: "p", species: "view", title: "B", status: "prioritized", platforms: ["web"] },
    { id: "V-c", project_id: "p", species: "view", title: "C", status: "blocked", platforms: ["web"] },
    { id: "AC-d", project_id: "p", species: "acceptance", title: "D", status: "live", platforms: ["web", "ios"],
      metadata: { platformStatuses: { web: "prioritized", ios: "blocked" }, refs: [{ id: "r1", type: "github-pr", url: "https://x", status_mapped: "prioritized" }] } },
  ],
  edges: [],
  journal: [{ id: "01A", ts: "2026-01-01T00:00:00.000Z", type: "node.status_changed", node_id: "V-a", from: "prioritized", to: "blocked" }],
};

const migrated = migrateStatusVocabulary(oldBundle);
// Ordered remap: old backlog -> idea FIRST, then the aliases.
assert.equal(migrated.nodes[0].status, "idea");        // old backlog (someday pile)
assert.equal(migrated.nodes[1].status, "backlog");     // prioritized -> backlog (NOT then -> idea)
assert.equal(migrated.nodes[2].status, "development"); // blocked -> development
assert.equal(migrated.nodes[2].metadata.blocked_by, "migrated from legacy blocked status");
// platformStatuses values and refs.status_mapped remap too.
assert.equal(migrated.nodes[3].metadata.platformStatuses.web, "backlog");
assert.equal(migrated.nodes[3].metadata.platformStatuses.ios, "development");
assert.equal(migrated.nodes[3].metadata.refs[0].status_mapped, "backlog");
// Version stamped; journal untouched (history is never rewritten).
assert.equal(migrated.schema_version, 3);
assert.deepEqual(migrated.journal, oldBundle.journal);
// Input not mutated.
assert.equal(oldBundle.nodes[0].status, "backlog");

// Gate: an already-v3 bundle passes through IDENTICALLY (same reference).
const newBundle = { ...oldBundle, schema_version: 3, nodes: [{ id: "V-x", project_id: "p", species: "view", title: "X", status: "backlog", platforms: ["web"] }] };
assert.equal(migrateStatusVocabulary(newBundle), newBundle); // new-vocabulary backlog is NOT remapped
// Absent schema_version predates the bump -> migrated and stamped.
const { schema_version: _drop, ...unversioned } = oldBundle;
assert.equal(migrateStatusVocabulary(unversioned).schema_version, 3);
// blocked_by already set by the author survives (not overwritten).
const preset = { schema_version: 2, project: oldBundle.project, nodes: [{ id: "V-p", project_id: "p", species: "view", title: "P", status: "blocked", platforms: ["web"], metadata: { blocked_by: "V-a" } }], edges: [] };
assert.equal(migrateStatusVocabulary(preset).nodes[0].metadata.blocked_by, "V-a");
// Idempotent: running twice equals running once.
assert.deepEqual(migrateStatusVocabulary(migrated), migrated);

console.log("legacy-status: all assertions passed");
```

If `load-schema.js` exposes named exports differently (e.g. a namespace object), adapt the require line to its actual pattern — but keep every assertion.

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run build -w @arkaik/schema && node tests/schema/legacy-status.test.js`
Expected: FAIL — `normalizeStatus` is not exported.

- [ ] **Step 4: Implement `packages/schema/src/legacy-status.ts`**

```ts
/**
 * The legacy status vocabulary (pre schema_version 3) and its migration.
 *
 * Two ids died in v3: `prioritized` (renamed `backlog`) and `blocked` (now the
 * orthogonal `metadata.blocked_by` flag). Those aliases are unambiguous forever.
 * `backlog` exists in BOTH vocabularies with different meanings (old: someday
 * pile; new: ready to start), so its remap to `idea` is only decidable by the
 * bundle's vintage — that is why {@link migrateStatusVocabulary} is gated on
 * `schema_version` and why the remap order below is load-bearing: old `backlog`
 * moves to `idea` BEFORE `prioritized` becomes the new `backlog`.
 *
 * The journal is deliberately untouched: history is never rewritten
 * (docs/spec/journal.md); validators accept legacy ids in historical events.
 */
import { STATUS_IDS, type StatusId } from "./ids";
import type { NodeMetadata, ProjectBundle, Ref } from "./bundle";

export const LEGACY_STATUS_IDS = ["prioritized", "blocked"] as const;
export type LegacyStatusId = (typeof LEGACY_STATUS_IDS)[number];

export const LEGACY_STATUS_ALIASES: Record<LegacyStatusId, StatusId> = {
  prioritized: "backlog",
  blocked: "development",
};

/** The schema_version that introduced the 7-status vocabulary. */
export const STATUS_VOCABULARY_VERSION = 3;

export const BLOCKED_BY_MIGRATION_NOTE = "migrated from legacy blocked status";

/** Current-or-legacy id -> current id; undefined for anything else. */
export function normalizeStatus(value: string): StatusId | undefined {
  if ((STATUS_IDS as readonly string[]).includes(value)) return value as StatusId;
  return LEGACY_STATUS_ALIASES[value as LegacyStatusId];
}

/** One status value through the ordered v3 remap. Old `backlog` first. */
function remapStatusValue(value: string): { status: string; wasBlocked: boolean } {
  if (value === "backlog") return { status: "idea", wasBlocked: false };
  if (value === "prioritized") return { status: "backlog", wasBlocked: false };
  if (value === "blocked") return { status: "development", wasBlocked: true };
  return { status: value, wasBlocked: false };
}

/**
 * Upgrade a bundle's status vocabulary to v3. Pure; returns the input untouched
 * (same reference) when `schema_version` is already >= 3. Remaps `node.status`,
 * `metadata.platformStatuses` values, and `metadata.refs[].status_mapped`;
 * stamps `schema_version: 3`; never touches `journal`.
 */
export function migrateStatusVocabulary(bundle: ProjectBundle): ProjectBundle {
  const declared = (bundle as { schema_version?: unknown }).schema_version;
  if (typeof declared === "number" && declared >= STATUS_VOCABULARY_VERSION) return bundle;

  const nodes = bundle.nodes.map((node) => {
    const { status, wasBlocked } = remapStatusValue(node.status as string);
    let metadata: NodeMetadata | undefined = node.metadata;

    const platformStatuses = node.metadata?.platformStatuses;
    if (platformStatuses) {
      const next: Record<string, string> = {};
      let blockedPlatform = false;
      for (const [platform, value] of Object.entries(platformStatuses)) {
        if (typeof value !== "string") continue;
        const mapped = remapStatusValue(value);
        next[platform] = mapped.status;
        blockedPlatform ||= mapped.wasBlocked;
      }
      metadata = { ...metadata, platformStatuses: next as NodeMetadata["platformStatuses"] };
      if (blockedPlatform && !metadata.blocked_by) metadata.blocked_by = BLOCKED_BY_MIGRATION_NOTE;
    }

    const refs = node.metadata?.refs;
    if (Array.isArray(refs) && refs.some((ref) => typeof ref.status_mapped === "string")) {
      metadata = {
        ...metadata,
        refs: refs.map((ref: Ref) =>
          typeof ref.status_mapped === "string"
            ? { ...ref, status_mapped: remapStatusValue(ref.status_mapped as string).status as StatusId }
            : ref,
        ),
      };
    }

    if (wasBlocked) {
      metadata = { ...metadata };
      if (!metadata.blocked_by) metadata.blocked_by = BLOCKED_BY_MIGRATION_NOTE;
    }

    if (status === node.status && metadata === node.metadata) return node;
    return { ...node, status: status as StatusId, ...(metadata !== undefined ? { metadata } : {}) };
  });

  return { ...bundle, schema_version: STATUS_VOCABULARY_VERSION, nodes };
}
```

Note: `blocked_by` does not exist on `NodeMetadata` yet — Task 2 adds it. If `tsc` complains before Task 2, use `(metadata as Record<string, unknown>).blocked_by` locally, then clean it up in Task 2.

- [ ] **Step 5: Re-export from the package index**

In `packages/schema/src/index.ts`, add alongside the existing exports:

```ts
export {
  LEGACY_STATUS_IDS,
  LEGACY_STATUS_ALIASES,
  STATUS_VOCABULARY_VERSION,
  BLOCKED_BY_MIGRATION_NOTE,
  normalizeStatus,
  migrateStatusVocabulary,
  type LegacyStatusId,
} from "./legacy-status";
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm run build -w @arkaik/schema && node tests/schema/legacy-status.test.js`
Expected: `legacy-status: all assertions passed`

- [ ] **Step 7: Register the test script and commit**

In root `package.json` scripts, next to `test:refs`, add:
`"test:legacy-status": "node tests/schema/legacy-status.test.js",`

```bash
git add packages/schema/src/legacy-status.ts packages/schema/src/index.ts tests/schema/legacy-status.test.js package.json
git commit -m "feat(schema): legacy status aliases + pure v3 vocabulary migration"
```

---

### Task 2: Schema — new STATUS_IDS, blocked_by, legacy-tolerant parsing

**Files:**
- Modify: `packages/schema/src/ids.ts:11-21`
- Modify: `packages/schema/src/enums.ts`
- Modify: `packages/schema/src/bundle.ts` (NodeMetadata, NodeSchema, PlatformStatusMapSchema, RefSchema)
- Modify: `packages/schema/src/journal-events.ts` (from/to fields)
- Modify: `packages/schema/src/promote.ts` (normalize policy targets)
- Test: existing `tests/schema/*.test.js` + `tests/schema/legacy-status.test.js`

- [ ] **Step 1: Swap the vocabulary in `ids.ts`**

Replace the `STATUS_IDS` block (`packages/schema/src/ids.ts:11-21`) with:

```ts
export const STATUS_IDS = [
  "idea",
  "discovery",
  "backlog",
  "development",
  "releasing",
  "live",
  "archived",
] as const;
export type StatusId = (typeof STATUS_IDS)[number];
```

- [ ] **Step 2: Add the legacy-tolerant schema in `enums.ts`**

`legacy-status.ts` must not import `enums.ts` (it is zod-free); `enums.ts` imports the id lists instead. Add after `StatusSchema`:

```ts
import { LEGACY_STATUS_IDS } from "./legacy-status";

/**
 * Status as persisted data may carry it: the current vocabulary plus the two
 * pre-v3 legacy ids (`prioritized`, `blocked`). Used for bundle fields and
 * journal `from`/`to` so an old bundle parses BEFORE the migration chain runs
 * (parse happens first on every import path). Everything the app newly writes
 * uses the strict {@link StatusSchema}; `migrateStatusVocabulary` erases legacy
 * ids from live data on load.
 */
export const AnyStatusSchema = z.enum([...STATUS_IDS, ...LEGACY_STATUS_IDS]).meta({
  id: "AnyStatus",
  description:
    "Lifecycle status as stored: the current vocabulary, or a legacy id (prioritized, blocked) accepted from pre-v3 bundles and migrated on load.",
});
```

(Adjust the import at the top of `enums.ts`; keep `StatusSchema` itself strict-new — it feeds MCP input enums and agent-facing docs.)

- [ ] **Step 3: Use `AnyStatusSchema` for persisted fields in `bundle.ts`**

- `NodeSchema` (`bundle.ts:156`): `status: AnyStatusSchema as unknown as typeof StatusSchema,` — keep the declared `z.ZodType<Node>` so `Node.status` stays `StatusId`; add the comment `// legacy-tolerant: migrateStatusVocabulary normalizes on load`.
- `PlatformStatusMapSchema` (`bundle.ts:21-24`): swap `StatusSchema` → `AnyStatusSchema` (cast the same way to keep the `z.ZodType<PlatformStatusMap>` annotation compiling).
- `RefSchema.status_mapped` (`bundle.ts:94`): `StatusSchema.optional()` → `AnyStatusSchema.optional()` with the same cast.
- Add `blocked_by` to `NodeMetadata` (after `stage?: string;` at `bundle.ts:104`):

```ts
  /** Non-empty = the node is blocked at its current status. A node id (rendered as a link) or free text. */
  blocked_by?: string;
```

and to `NodeMetadataSchema` (after the `stage` line at `bundle.ts:120`):

```ts
    blocked_by: z.string().optional().meta({
      description: "Non-empty = blocked at the current status. A node id (rendered as a link) or free text naming the dependency.",
    }),
```

- [ ] **Step 4: Widen journal `from`/`to` in `journal-events.ts`**

In `NodeStatusChangedEventSchema` (`journal-events.ts:58-67`), replace `from: StatusSchema, to: StatusSchema` with `from: AnyStatusSchema, to: AnyStatusSchema` (import it). History carrying dead ids must keep validating strictly.

- [ ] **Step 5: Normalize policy targets in `promote.ts`**

A project's hand-written `ref_policy` may still say `"prioritized"`. In `computeRefPromotions` (`promote.ts:112`), after `const target = mapping[ref.external_status];` and the `undefined`/`null` checks, normalize:

```ts
      const normalizedTarget = normalizeStatus(target);
      if (normalizedTarget === undefined) {
        skipped.push({ node_id: node.id, ref_id: ref.id, reason: "no-mapping", detail: `unknown status: ${target}` });
        continue;
      }
```

and use `normalizedTarget` in place of `target` below (the `from === target` comparison and the pushed promotion). `promote.ts` is type-only today; `normalizeStatus` is a value import from `./legacy-status` — that keeps it zod-free, which is the actual constraint.

- [ ] **Step 6: Build and fix schema-internal compile errors**

Run: `npm run build -w @arkaik/schema`
Expected: errors only where old ids are named. Fix each; do NOT touch `lib/` or `components/` yet (Task 3+).

- [ ] **Step 7: Sweep the schema test fixtures**

Run: `grep -rn "prioritized\|\"blocked\"" tests/schema/ packages/schema/`
Update fixtures: `prioritized` → `backlog`, `blocked` → `development` where used as a status value. Keep any test that *deliberately* exercises legacy ids (promote tests may) and adapt its expectations to the normalized outcomes.

- [ ] **Step 8: Run the schema suites**

Run: `npm run build -w @arkaik/schema && npm run test:schema && npm run test:acceptance && npm run test:refs && npm run test:journal && npm run test:promote && npm run test:mutate && npm run test:emit && npm run test:serialize && npm run test:legacy-status && npm run test:edge-semantics && npm run test:maps && npm run test:products && npm run test:id-gen`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add packages/schema tests/schema package.json
git commit -m "feat(schema)!: 7-status vocabulary, blocked_by metadata, legacy-tolerant parsing"
```

---

### Task 3: App config + status styles + rollup ordering

**Files:**
- Modify: `lib/config/statuses.ts`
- Modify: `components/graph/nodes/node-styles.ts`
- Modify: `lib/utils/platform-status.ts:37-52`

- [ ] **Step 1: Rewrite `lib/config/statuses.ts` lists**

```ts
export const STATUSES = [
  { id: "idea",        label: "Idea",        order: 0 },
  { id: "discovery",   label: "Discovery",   order: 1 },
  { id: "backlog",     label: "Backlog",     order: 2 },
  { id: "development", label: "Development", order: 3 },
  { id: "releasing",   label: "Releasing",   order: 4 },
  { id: "live",        label: "Live",        order: 5 },
  { id: "archived",    label: "Archived",    order: 6 },
] as const satisfies readonly { id: StatusId; label: string; order: number }[];
```

and

```ts
export const COUNTED_STATUS_PRESETS = {
  delivery: ["backlog", "development", "releasing", "live"],
} as const satisfies Record<string, readonly StatusId[]>;
```

Everything else in the file stays.

- [ ] **Step 2: Update the exhaustive maps in `node-styles.ts`**

In each of `STATUS_STYLES`, `STATUS_ICONS`, `STATUS_LABELS`, `STATUS_MINIMAP_FILL`, `STATUS_GHOST_STYLES`: delete the `prioritized` and `blocked` rows, insert `discovery` between `idea` and `backlog`, and move `backlog` onto the blue-400 slot `prioritized` vacated (backlog now means "ready"):

```ts
export const STATUS_STYLES: Record<StatusId, { badge: string; dot: string; stroke: string }> = {
  idea:        { badge: "text-gray-400",   dot: "bg-gray-400",   stroke: "stroke-gray-400"   },
  discovery:   { badge: "text-violet-400", dot: "bg-violet-400", stroke: "stroke-violet-400" },
  backlog:     { badge: "text-blue-400",   dot: "bg-blue-400",   stroke: "stroke-blue-400"   },
  development: { badge: "text-blue-500",   dot: "bg-blue-500",   stroke: "stroke-blue-500"   },
  releasing:   { badge: "text-purple-500", dot: "bg-purple-500", stroke: "stroke-purple-500" },
  live:        { badge: "text-green-500",  dot: "bg-green-500",  stroke: "stroke-green-500"  },
  archived:    { badge: "text-gray-400",   dot: "bg-gray-400",   stroke: "stroke-gray-400"   },
};
```

- `STATUS_ICONS`: `discovery: Compass` (add `Compass` to the lucide import; remove `CircleDotDashed`/`CircleX` if now unused), `backlog: CircleDotDashed`... no — keep `backlog: CircleDashed` and give `discovery: Compass`; delete the `prioritized` and `blocked` rows.
- `STATUS_LABELS`: `discovery: "Discovery"`; delete dead rows.
- `STATUS_MINIMAP_FILL`: `discovery: "#a78bfa", // violet-400`; `backlog: "#60a5fa", // blue-400`; delete dead rows.
- `STATUS_GHOST_STYLES`: `discovery: { wrapper: "", border: "" }`; delete dead rows.

- [ ] **Step 3: Simplify display ordering in `platform-status.ts`**

`compareStatusesForDisplay` (`lib/utils/platform-status.ts:47-52`) existed to pin `blocked` last; `blocked` is gone. Replace function body with `return STATUS_ORDER[right] - STATUS_ORDER[left];` and rewrite its doc comment to say: display order is lifecycle-descending (Live → Releasing → Development → Backlog); the historical `blocked` pin is gone with the status. Update the stale preset list in the `compareStatusesBySeverity` comment (`:27-32`) too — severity is now simply highest `STATUS_ORDER` among counted statuses.

- [ ] **Step 4: Typecheck to enumerate the remaining blast radius**

Run: `npx tsc --noEmit 2>&1 | head -50`
Expected: errors in app/components consumers — that's Task 4's worklist. Confirm there are NO errors in `lib/config/`, `components/graph/nodes/node-styles.ts`, `lib/utils/platform-status.ts` themselves.

- [ ] **Step 5: Commit**

```bash
git add lib/config/statuses.ts components/graph/nodes/node-styles.ts lib/utils/platform-status.ts
git commit -m "feat(app): 7-status config, discovery styles, blocked pin removed from rollup ordering"
```

---

### Task 4: Type-guided sweep of remaining app consumers

**Files (expected, from `tsc` output — fix whatever it actually lists):**
- Modify: `lib/utils/delivery.ts`, `lib/utils/coverage.ts`, `lib/utils/acceptance-matrix.ts`, `components/delivery/DeliveryBoard.tsx`, `components/acceptances/*`, `components/panels/*`, `components/overview/InventoryCard.tsx`, `app/project/[id]/delivery/page.tsx`, `app/project/[id]/library/page.tsx`, `lib/services/github/pull-request.ts` (comment at `:1714` only), anything else `tsc` flags.

- [ ] **Step 1: Run `npx tsc --noEmit` and fix every error**

Mechanical rules: a literal `"prioritized"` becomes `"backlog"`; a literal `"blocked"` in a status position becomes `"development"` unless the code was blocked-specific UI (a blocked column/filter), in which case delete that branch — Task 6 reintroduces blocked as a flag. Do not change behavior beyond the rename; keep diffs minimal.

- [ ] **Step 2: Sweep for stringly-typed stragglers `tsc` can't see**

Run: `grep -rn "prioritized" app components lib --include='*.ts' --include='*.tsx' | grep -v generated`
Expected: only prose comments remain; update those comments (e.g. `lib/utils/delivery.ts:11`, `lib/services/github/pull-request.ts:1714`, `lib/utils/platform-status.ts` if any left).

- [ ] **Step 3: Run the app suites**

Run: `npm run test:delivery && npm run test:coverage && npm run test:effective-status && npm run test:acceptance-matrix && npm run test:journey-graph && npm run test:pyramid && npm run test:product-scope && npm run test:product-editing && npm run test:spotlight`
Fixtures using dead ids: same mechanical remap. Expected: all pass.

- [ ] **Step 4: Verify clean typecheck and commit**

Run: `npx tsc --noEmit` → Expected: zero errors.

```bash
git add -A && git commit -m "refactor(app): sweep status consumers to the 7-status vocabulary"
```

---

### Task 5: Migration wiring — v2→3 step, version stamping, stored-project sweep

**Files:**
- Modify: `lib/data/migrate.ts`
- Modify: `lib/data/local-provider.ts` (creation stamps version; stored-project sweep)
- Test: `tests/data/migrate.test.js` (extend), run `npm run test:migrate`

- [ ] **Step 1: Add the v2→3 step to the chain**

In `lib/data/migrate.ts`: bump `CURRENT_SCHEMA_VERSION` to `3` (`:25`), import `migrateStatusVocabulary` from `@arkaik/schema`, and append to `MIGRATIONS` (`:284-287`):

```ts
const MIGRATIONS: readonly Migration[] = [
  { from: 0, to: 1, migrate: migrateLegacyToV1 },
  { from: 1, to: 2, migrate: migrateV1ToV2 },
  // v2 -> 3: the status vocabulary overhaul. Unlike the earlier steps this one
  // STAMPS schema_version — the backlog->idea remap is not idempotent against
  // new-vocabulary data, so the stamp is what prevents a re-run on next load.
  { from: 2, to: 3, migrate: migrateStatusVocabulary },
];
```

`migrateStatusVocabulary` already stamps `schema_version: 3` internally (Task 1).

- [ ] **Step 2: Extend `tests/data/migrate.test.js`**

Follow the file's existing assertion style. Add cases:
- a `schema_version: 2` bundle with nodes at `backlog`/`prioritized`/`blocked` → migrated statuses `idea`/`backlog`/`development`, `blocked_by` set, `schema_version` = 3;
- a `schema_version: 3` bundle with a `backlog` node → returned with `backlog` intact;
- an unversioned legacy bundle (with `parent_id` children, reusing an existing v0 fixture) also ends at `schema_version` 3 with statuses remapped.

- [ ] **Step 3: Run to verify the new cases fail, then pass**

Run: `npm run test:migrate` — the new assertions should pass immediately after Step 1 (the step is already wired); if any fail, fix the wiring, not the test.

- [ ] **Step 4: Stamp `schema_version` at project creation**

In `lib/data/local-provider.ts`, find `createProject` (grep `createProject`). Where the fresh snapshot/bundle object is first assembled, add `schema_version: CURRENT_SCHEMA_VERSION` (import from `./migrate`). Without this, a fresh project has no version, reads as v0, and the v2→3 remap would corrupt user-set `backlog` nodes on a later load.

- [ ] **Step 5: One-time sweep of already-stored projects**

Stored IndexedDB snapshots predating this PR are unstamped. In `lib/data/local-provider.ts` (or `lib/data/db.ts` if the open seam lives there — follow where `getDb`/Dexie setup is), after the DB opens, run:

```ts
async function migrateStoredProjects(db: ArkaikDb): Promise<void> {
  const records = await db.projects.toArray();
  for (const record of records) {
    const declared = (record.snapshot as { schema_version?: unknown }).schema_version;
    if (typeof declared === "number" && declared >= CURRENT_SCHEMA_VERSION) continue;
    const journalRow = await db.journals.get(record.id);
    const migrated = migrateBundle(assembleBundle(record.snapshot, journalRow?.events));
    const { snapshot, journal } = splitBundle(migrated);
    await db.projects.put({ id: record.id, snapshot });
    if (journal !== undefined) await db.journals.put({ projectId: record.id, events: journal });
  }
}
```

Adapt names (`ArkaikDb`, `assembleBundle`, `splitBundle`, record shapes) to what the file actually uses — read it first. Call it once from the same place the legacy-localStorage import runs (`lib/data/db.ts:153-181` area), after that import. Per-record version check makes it a cheap no-op on every subsequent open.

- [ ] **Step 6: Run the data suites**

Run: `npm run test:migrate && npm run test:provider && npm run test:emit-events && npm run test:journal-projections && npm run test:project-sections`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add lib/data tests/data
git commit -m "feat(data): v2->3 status migration step, version stamping at creation, stored-project sweep"
```

---

### Task 6: Blocked flag UI — StatusBadge overlay, detail-panel field, library filter

**Files:**
- Modify: `components/layout/StatusBadge.tsx`
- Modify: `components/panels/NodeDetailPanel.tsx`
- Modify: `components/library/LibraryFilterBar.tsx` + the library page's filter state (`app/project/[id]/library/page.tsx`)

- [ ] **Step 1: Add the overlay to `StatusBadge`**

Current component: `components/layout/StatusBadge.tsx` (30 lines, icon + tooltip). Add an optional prop and overlay:

```tsx
interface StatusBadgeProps {
  status: StatusId;
  /** Non-empty = blocked at this status; shown as a red overlay + tooltip suffix. */
  blockedBy?: string;
  className?: string;
}

export function StatusBadge({ status, blockedBy, className }: StatusBadgeProps) {
  const { badge } = STATUS_STYLES[status] ?? STATUS_STYLES.idea;
  const Icon = STATUS_ICONS[status] ?? STATUS_ICONS.idea;
  const label = STATUS_LABELS[status] ?? status;
  const blocked = Boolean(blockedBy?.trim());

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={cn("relative inline-flex items-center", className)}>
            <Icon className={cn("w-4 h-4", badge)} aria-hidden="true" />
            {blocked && (
              <Ban className="absolute -right-1 -bottom-1 w-2.5 h-2.5 text-red-500" aria-hidden="true" />
            )}
            <span className="sr-only">{blocked ? `${label} (blocked)` : label}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">
          {blocked ? `${label} — blocked by: ${blockedBy}` : label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
```

(`Ban` from `lucide-react`.) Then grep StatusBadge call sites (`grep -rn "<StatusBadge" components app`) and pass `blockedBy={node.metadata?.blocked_by}` at every site that has a node in scope (library `NodeCard`/`NodeTable`, detail panel, canvas nodes if they render it). Sites without a node (legend, journal) pass nothing.

- [ ] **Step 2: Add the `blocked_by` field to `NodeDetailPanel`**

Read `components/panels/NodeDetailPanel.tsx` first; follow its existing pattern for optional text metadata (the `stage` or description field is the closest precedent). Add a "Blocked by" input in the status section: value `node.metadata?.blocked_by ?? ""`, on save write `metadata.blocked_by` (empty string → delete the key so absence stays the unblocked state). If the value equals an existing node id, render a link/chip to that node next to the input using the panel's existing node-link affordance if one exists; otherwise plain text is fine — do not invent a new navigation mechanism.

- [ ] **Step 3: Add a "Blocked" filter chip to the library**

Read `components/library/LibraryFilterBar.tsx` and the library page's filter state. Add a boolean `blocked` filter following exactly the pattern of the closest existing toggle; predicate: `Boolean(node.metadata?.blocked_by?.trim())`. Chip label "Blocked", styled like the status chips (red accent per `text-red-500` to match the old blocked color).

- [ ] **Step 4: Verify and commit**

Run: `npx tsc --noEmit && npm run lint 2>&1 | tail -5` — no new errors in touched files.

```bash
git add components app
git commit -m "feat(ui): blocked_by flag — badge overlay, detail-panel field, library filter"
```

---

### Task 7: Journal rendering + CLI/MCP legacy handling

**Files:**
- Modify: `components/journal/describe-event.ts`
- Modify: `packages/cli/src/lib/bundle-io.ts` (apply vocabulary migration on read)
- Modify: `packages/mcp/src/tools.ts` (normalize status inputs; migrate file-mode bundle on load)
- Test: `npm run test:journal-projections && npm run test:cli && npm run test:mcp`

- [ ] **Step 1: Legacy labels in `describe-event.ts`**

Read the file. Wherever a status id is turned into display text, ensure the lookup is `STATUS_LABELS[value] ?? value` (never an unguarded exhaustive index) so historical `prioritized`/`blocked` events render as plain text. If it already renders raw ids, capitalize nothing — passing the raw id through is fine; just confirm no `Record<StatusId, …>` index can throw/undefined on a legacy id.

- [ ] **Step 2: CLI reads migrate in memory**

In `packages/cli/src/lib/bundle-io.ts`, at the end of `readBundle` (after the object check), apply:

```ts
import { migrateStatusVocabulary, type ProjectBundle } from "@arkaik/schema";
// ...
  return migrateStatusVocabulary(parsed as unknown as ProjectBundle) as unknown as Record<string, unknown>;
```

The function is version-gated, so current bundles pass through untouched; commands that write (`sync`, `release`) persist the migrated form naturally.

- [ ] **Step 3: MCP file-mode load + input normalization**

In `packages/mcp/src/tools.ts`: find where the file-mode bundle is loaded (grep `readFile`/`bundle` in `packages/mcp/src`) and apply `migrateStatusVocabulary` the same way. For tool inputs, in `list_nodes` (`:202`) and the `create_node`/`update_node` status handling (`:403`, `:439` area), pass user-supplied status strings through `normalizeStatus` and use the result (reject with the tool's normal validation error when it returns `undefined`). Keep the advertised input enums as `[...STATUS_IDS]` — new vocabulary only.

- [ ] **Step 4: Run the suites**

Run: `npm run test:journal-projections && npm run test:cli && npm run test:mcp`
Fix any fixture still using dead ids (same mechanical remap). Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add components/journal packages/cli packages/mcp tests
git commit -m "feat(agents): legacy-safe journal rendering, CLI/MCP status migration + input normalization"
```

---

### Task 8: Seeds + hosted-side migration

**Files:**
- Modify: `seed/pebbles.json`, `seed/arkaik-self-map.json`
- Modify: server import path (grep `importProject`/`migrateBundle` under `app/api/graph` and `lib/services`; add migration where the snapshot is first stored)
- Create: `scripts/migrate/status-vocabulary.js`
- Test: `npm run test:migrate` (includes seed-import), `npm run test:graph`

- [ ] **Step 1: Update the seeds**

`seed/pebbles.json`: change `"schema_version": 2` → `3`; its two `"status": "backlog"` nodes → `"status": "idea"` (old backlog = someday pile). `seed/arkaik-self-map.json`: add `"schema_version": 3` as the first key of the top-level object (before `"project"`). No other status in either seed uses a dead id (verified: pebbles carries idea/backlog/development/live/archived; self-map carries development/live).

- [ ] **Step 2: Run seed round-trip tests**

Run: `npm run test:migrate`
Expected: pass — including `seed-import.test.js`, which pins that migration is a no-op on the seeds. If it diffs, the seeds and `CURRENT_SCHEMA_VERSION` disagree — fix the seed, not the test.

- [ ] **Step 3: Hosted import path migrates**

Find where the graph API stores an imported snapshot (grep `snapshot` under `app/api/graph` and `lib/services/graph*`). Ensure the stored snapshot goes through `migrateStatusVocabulary` (or full `migrateBundle` if the server already uses it) before the `jsonb` write. Add/extend a case in `tests/services/graph-api.test.js` only if that suite runs without Postgres (check how it stubs the store — `tests/services` pattern); if it requires a live DB, skip the test (no local Postgres) and rely on the pure-function coverage from Task 1.

- [ ] **Step 4: One-shot operator script for existing hosted rows**

Create `scripts/migrate/status-vocabulary.js` — a plain node script:

```js
#!/usr/bin/env node
/**
 * One-shot: upgrade every graph_projects.snapshot to the v3 status vocabulary.
 * Run manually against prod (deploys do NOT run migrations):
 *   DATABASE_URL=... node scripts/migrate/status-vocabulary.js [--dry-run]
 */
const { Client } = require("pg");
const { migrateStatusVocabulary } = require("../../packages/schema/dist/index.js");

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const { rows } = await client.query("select id, snapshot from graph_projects");
  let changed = 0;
  for (const row of rows) {
    const migrated = migrateStatusVocabulary(row.snapshot);
    if (migrated === row.snapshot) continue;
    changed += 1;
    console.log(`${dryRun ? "[dry-run] would migrate" : "migrating"} ${row.id}`);
    if (!dryRun) {
      await client.query("update graph_projects set snapshot = $1 where id = $2", [migrated, row.id]);
    }
  }
  console.log(`${changed}/${rows.length} project(s) ${dryRun ? "need migration" : "migrated"}`);
  await client.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
```

Match the actual table/column names from `db/migrations/008_graph_projects.sql` (table `graph_projects`, column `snapshot`) and the repo's existing script conventions (check `scripts/` for CJS vs ESM — mirror a neighbor). Do NOT run it here (no local Postgres); it's an operator step.

- [ ] **Step 5: Commit**

```bash
git add seed scripts app lib tests
git commit -m "feat(data): seeds on v3 vocabulary, hosted import migration + operator script"
```

---

### Task 9: Generated artifacts, docs, full verification

**Files:**
- Regenerate: `lib/prompts/generated/schema.ts`, `public/schema/project-bundle.json` (via `npm run generate`)
- Modify: `docs/graph-model.md` § Status Model, `docs/spec/journal.md`, `docs/spec/bundle-format.md` § Schema Versioning

- [ ] **Step 1: Regenerate**

Run: `npm run generate`
Expected: diffs in `lib/prompts/generated/` and `public/schema/` reflecting the new enum (and `AnyStatus` where bundle fields use it). CI diffs these — they MUST be committed with the change.

- [ ] **Step 2: Update `docs/graph-model.md` § Status Model (`:111-128`)**

Replace the section content with: the 7-status table from the spec (id + meaning), the sentence "Transitions are documented, not enforced — status is a free assignment", the `blocked_by` flag paragraph (non-empty = blocked at the current status; node id renders as link), the relationship to the orthogonal `stage` axis, and a Legacy note: `prioritized` → `backlog` and `blocked` → `development` + `blocked_by` since schema_version 3; old `backlog` remaps to `idea` on migration; journal history keeps old ids.

- [ ] **Step 3: Update the specs**

- `docs/spec/journal.md`: in the `node.status_changed` entry, note `from`/`to` may carry the pre-v3 ids `prioritized`/`blocked` in historical events; validators accept them; history is never rewritten.
- `docs/spec/bundle-format.md` § Schema Versioning: add v3 to the version chain — "v3: status vocabulary overhaul (`discovery` added; `prioritized`/`blocked` removed; `blocked_by` metadata; old `backlog` → `idea`). Migration stamps `schema_version: 3`."

- [ ] **Step 4: Full verification**

Run, and confirm each passes / is no worse than baseline:

```bash
npx tsc --noEmit
npm run lint 2>&1 | tail -3        # no NEW errors in touched files
npm run generate && git status --porcelain   # empty diff after commit = artifacts in sync
grep -rn "prioritized" app components lib packages seed docs/graph-model.md | grep -v generated | grep -v legacy   # only legacy-alias code + docs' legacy notes remain
```

Run every suite touched across tasks one final time:
`npm run test:legacy-status && npm run test:schema && npm run test:migrate && npm run test:promote && npm run test:journal && npm run test:delivery && npm run test:coverage && npm run test:effective-status && npm run test:acceptance-matrix && npm run test:cli && npm run test:mcp && npm run test:journal-projections`

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "docs: status lifecycle v3 — graph model, journal, bundle-format; regenerate artifacts"
```

---

### Task 10: Pull request

- [ ] **Step 1: Push and open the PR**

PR body must include: summary of the vocabulary change and migration; the **manual prod step** (`DATABASE_URL=... node scripts/migrate/status-vocabulary.js` after deploy — deploys do not run migrations); the manual visual checklist for Alexis (badge per status incl. discovery's Compass/violet, blocked overlay + tooltip, library Blocked chip, detail-panel blocked_by field, changelog rendering of a legacy `prioritized` event, delivery board columns, pyramid rings); and a **Lab Note** section (this is user-facing) per CLAUDE.md — heading starting `## Lab Note`, one yaml fence, `en.title`/`en.summary` double-quoted, `fr` adaptation with informal "Tu", `suggested.molecule: arkaik`, `type: improvement`.

- [ ] **Step 2: Read the PR comments after opening**

Per CLAUDE.md: check the advisory Lab Note reminder comment on the PR and fix the body if it flags problems.
