# Changelog Split (Design | Delivery) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cycle 3 of the self-map program — a `deliverable.shipped` journal event with slice-based release association, the changelog page split into Design | Delivery panels, a History page for the granular feed, an `arkaik deliverable` CLI command, and the blocked notch on StatusRing.

**Architecture:** Everything journal-native — no bundle shape change, no `schema_version` bump. New event type + projections live in `packages/schema` (shared by app and CLI); the app re-exports projections via `lib/utils/journal.ts`; pages are client components over `useJournal`/`useNodes`. Spec: `docs/superpowers/specs/2026-08-03-changelog-split-design.md`.

**Tech Stack:** Next.js (App Router, client pages), zod (schema package only), plain-Node test scripts (`node tests/...`), hand-rolled CLI (no commander).

**Working rules for every task:**
- Tests are plain Node scripts using a `check(name, cond, detail)` pass/fail pattern — no jest/vitest. Run them with the exact `npm run test:*` command given.
- No local Postgres: never add a test that needs a DB.
- Lint bar: `npx eslint <changed files>` must show **no new errors** in files you touched (main carries pre-existing ones elsewhere).
- The repo's `pnpm-lock.yaml` / `pnpm-workspace.yaml` untracked files are unrelated — do not touch, commit, or delete them.

---

### Task 0: Branch

**Files:** none

- [ ] **Step 1: Create the feature branch** (the cycle 3 spec commit `5651e4b` is already on local `main`; the PR will carry it)

```bash
git checkout -b cycle3/changelog-split
```

---

### Task 1: `deliverable.shipped` event type (types + zod)

**Files:**
- Modify: `packages/schema/src/journal.ts` (JOURNAL_EVENT_TYPES ~line 27, interfaces ~line 124, union ~line 175)
- Modify: `packages/schema/src/journal-events.ts` (schema ~line 100, registry ~line 159, union ~line 180)
- Test: `tests/schema/journal.test.js`

- [ ] **Step 1: Write the failing tests.** In `tests/schema/journal.test.js`, inside `main()`, after the existing per-type schema checks, add (destructure `DeliverableShippedEventSchema` and `makeEvent` from the existing `schema` object at the top of `main()` alongside the other destructured names):

```js
  // --- deliverable.shipped (cycle 3) ---------------------------------------
  check(
    "JOURNAL_EVENT_TYPES includes deliverable.shipped",
    JOURNAL_EVENT_TYPES.includes("deliverable.shipped"),
  );
  const goodDeliverable = {
    id: "01HZZZZZZZZZZZZZZZZZZZZZZZ",
    ts: "2026-08-03T00:00:00.000Z",
    type: "deliverable.shipped",
    deliverable_id: "pr-123",
    title: "Ship the widget",
    summary: "Widget now ships.",
    url: "https://github.com/example/repo/pull/123",
    node_ids: ["V-home"],
    future_field: "kept",
  };
  const parsedDeliverable = DeliverableShippedEventSchema.safeParse(goodDeliverable);
  check("DeliverableShippedEventSchema accepts a full event", parsedDeliverable.success);
  check(
    "DeliverableShippedEventSchema preserves unknown fields",
    parsedDeliverable.success && parsedDeliverable.data.future_field === "kept",
  );
  check(
    "KnownJournalEventSchema accepts deliverable.shipped",
    KnownJournalEventSchema.safeParse(goodDeliverable).success,
  );
  check(
    "DeliverableShippedEventSchema rejects a missing title",
    !DeliverableShippedEventSchema.safeParse({
      id: "01HZZZZZZZZZZZZZZZZZZZZZZZ",
      ts: "2026-08-03T00:00:00.000Z",
      type: "deliverable.shipped",
      deliverable_id: "pr-123",
    }).success,
  );
  let deliverableThrew = false;
  try {
    makeEvent("deliverable.shipped", { deliverable_id: "pr-9" }); // no title
  } catch {
    deliverableThrew = true;
  }
  check("makeEvent rejects a deliverable without a title", deliverableThrew);
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:journal`
Expected: FAIL — `DeliverableShippedEventSchema` is undefined / `JOURNAL_EVENT_TYPES includes deliverable.shipped` fails.

- [ ] **Step 3: Implement the type half.** In `packages/schema/src/journal.ts`:

In `JOURNAL_EVENT_TYPES`, after `"release.tagged",` add:

```ts
  "deliverable.shipped",
```

After the `ReleaseTaggedEvent` interface, add:

```ts
/**
 * A unit of shipped work (typically one merged PR): entity changes + a summary
 * note. Re-appending with the same `deliverable_id` edits — consumers resolve
 * content latest-wins, anchored at the first occurrence (when it shipped).
 */
export interface DeliverableShippedEvent extends JournalEvent {
  type: "deliverable.shipped";
  deliverable_id: string;
  title: string;
  summary?: string;
  url?: string;
  node_ids?: string[];
  platform?: PlatformId;
}
```

In the `KnownJournalEvent` union, after `| ReleaseTaggedEvent` add:

```ts
  | DeliverableShippedEvent
```

- [ ] **Step 4: Implement the zod half.** In `packages/schema/src/journal-events.ts`, after `ReleaseTaggedEventSchema`, add:

```ts
export const DeliverableShippedEventSchema = z
  .object({
    ...envelope,
    type: z.literal("deliverable.shipped"),
    deliverable_id: z.string(),
    title: z.string(),
    summary: z.string().optional(),
    url: z.string().optional(),
    node_ids: z.array(z.string()).optional(),
    platform: PlatformSchema.optional(),
  })
  .catchall(z.unknown());
```

In `JOURNAL_EVENT_SCHEMAS`, after the `"release.tagged"` entry, add:

```ts
  "deliverable.shipped": DeliverableShippedEventSchema,
```

In `KnownJournalEventSchema`'s union, after `ReleaseTaggedEventSchema,` add:

```ts
  DeliverableShippedEventSchema,
```

- [ ] **Step 5: Run to verify pass**

Run: `npm run test:journal && npm run test:emit`
Expected: all PASS (emit suite proves `makeEvent` wiring picked the schema up mechanically).

- [ ] **Step 6: Commit**

```bash
git add packages/schema/src/journal.ts packages/schema/src/journal-events.ts tests/schema/journal.test.js
git commit -m "feat(schema): deliverable.shipped journal event type"
```

---

### Task 2: Cross-check `node_ids` (dangling refs)

**Files:**
- Modify: `packages/schema/src/journal.ts` (`crossCheckJournal`, dangling-ref loop ~line 474)
- Test: `tests/schema/journal.test.js`

- [ ] **Step 1: Write the failing tests.** In `tests/schema/journal.test.js` `main()`, after the Task 1 block, add (the fixture mirrors the existing cross-check fixtures in that file — a snapshot node with matching `node.created`):

```js
  // --- deliverable.shipped node_ids cross-check ----------------------------
  const deliverableBundle = {
    schema_version: 3,
    project: { id: "p", title: "P", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" },
    nodes: [{ id: "V-a", species: "view", title: "A", status: "live", platforms: ["web"] }],
    edges: [],
    journal: [
      { id: "01A", ts: "2026-01-01T00:00:00.000Z", type: "node.created", node_id: "V-a", species: "view", title: "A" },
      { id: "01B", ts: "2026-01-02T00:00:00.000Z", type: "deliverable.shipped", deliverable_id: "pr-1", title: "Ship A", node_ids: ["V-a"] },
    ],
  };
  check(
    "deliverable node_ids referencing an existing node pass the cross-check",
    crossCheckJournal(deliverableBundle).length === 0,
    JSON.stringify(crossCheckJournal(deliverableBundle)),
  );
  const danglingBundle = {
    ...deliverableBundle,
    journal: [
      deliverableBundle.journal[0],
      { id: "01C", ts: "2026-01-02T00:00:00.000Z", type: "deliverable.shipped", deliverable_id: "pr-2", title: "Ship ghost", node_ids: ["V-ghost"] },
    ],
  };
  const danglingFindings = crossCheckJournal(danglingBundle);
  check(
    "deliverable node_ids referencing a never-existing node are an error",
    danglingFindings.some((f) => f.rule === "journal-dangling-node-ref" && f.message.includes("V-ghost")),
    JSON.stringify(danglingFindings),
  );
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:journal`
Expected: the "never-existing node" check FAILs (array refs are not walked today); the passing-case check PASSes.

- [ ] **Step 3: Implement.** In `crossCheckJournal` in `packages/schema/src/journal.ts`, inside the `for (const { ev, index } of valid)` dangling-reference loop, after the `NODE_REF_FIELDS` block and before the `edge.removed` block, add:

```ts
    // deliverable.shipped carries an ARRAY of node refs — NODE_REF_FIELDS
    // handles scalar fields only, so the array is walked here.
    if (ev.type === "deliverable.shipped" && Array.isArray(ev.node_ids)) {
      (ev.node_ids as unknown[]).forEach((raw, i) => {
        const ref = str(raw);
        if (ref !== undefined && !everNodes.has(ref)) {
          findings.push({
            path: `journal[${index}].node_ids[${i}]`,
            rule: "journal-dangling-node-ref",
            message: `journal[${index}] (deliverable.shipped): references node "${ref}" that never existed in the snapshot or journal.`,
            severity: "error",
          });
        }
      });
    }
```

- [ ] **Step 4: Run to verify pass**

Run: `npm run test:journal`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/schema/src/journal.ts tests/schema/journal.test.js
git commit -m "feat(schema): cross-check deliverable.shipped node_ids for dangling refs"
```

---

### Task 3: Projections — `computeDeliverables`, `Changelog.deliverables`, `computeCommitments`

**Files:**
- Modify: `packages/schema/src/projections.ts`
- Modify: `lib/utils/journal.ts` (re-exports)
- Test: `tests/data/journal-projections.test.js`

- [ ] **Step 1: Write the failing tests.** In `tests/data/journal-projections.test.js`, destructure the new names at the existing `loadJournalProjections()` call:

```js
const { computeNodeTimeline, computeChangelog, computeBacklog, computeDeliverables, computeCommitments } =
  loadJournalProjections();
```

Then append at the end of the file, before the final failure-count exit (reusing the existing `EVENTS`/`JOURNAL` fixture — releases `1.0` @2026-01-02, `1.1` @2026-01-04, `1.2`(ios) @2026-01-06):

```js
// --- computeDeliverables (cycle 3) -----------------------------------------
const DELIVERABLES = {
  // First occurrence between 1.0 and 1.1 → belongs to 1.1.
  d1: { id: "02A", ts: "2026-01-03T00:30:00.000Z", type: "deliverable.shipped", deliverable_id: "pr-1", title: "Ship home", summary: "v1", node_ids: ["V-home"] },
  // Re-append AFTER 1.2 — edits content, must NOT move the anchor.
  d1_edit: { id: "02B", ts: "2026-01-07T00:00:00.000Z", type: "deliverable.shipped", deliverable_id: "pr-1", title: "Ship home", summary: "v2 (edited)", node_ids: ["V-home"] },
  // First occurrence after the last marker → unreleased.
  d2: { id: "02C", ts: "2026-01-08T00:00:00.000Z", type: "deliverable.shipped", deliverable_id: "pr-2", title: "Ship settings", url: "https://example.com/pull/2" },
};
const WITH_DELIVERABLES = [...JOURNAL, DELIVERABLES.d1_edit, DELIVERABLES.d1, DELIVERABLES.d2]; // shuffled

const deliverables = computeDeliverables(WITH_DELIVERABLES);
check("computeDeliverables: one record per deliverable_id", deliverables.length === 2);
const d1 = deliverables.find((d) => d.deliverable_id === "pr-1");
const d2 = deliverables.find((d) => d.deliverable_id === "pr-2");
check("content is latest-wins", d1 && d1.summary === "v2 (edited)");
check("anchor is the FIRST occurrence ts", d1 && d1.ts === "2026-01-03T00:30:00.000Z");
check("released deliverable resolves to its slice's release", d1 && d1.releaseVersion === "1.1");
check("post-release edit does not un-release", d1 && d1.releaseVersion === "1.1");
check("first occurrence after the last marker is unreleased", d2 && d2.releaseVersion === null);
check("url passes through", d2 && d2.url === "https://example.com/pull/2");
check("node_ids default to empty array", d2 && Array.isArray(d2.node_ids) && d2.node_ids.length === 0);
check("shipped order (first-occurrence order)", deliverables[0].deliverable_id === "pr-1");
check("empty journal yields no deliverables", computeDeliverables([]).length === 0);

const changelog11 = computeChangelog(WITH_DELIVERABLES, "1.1");
check(
  "Changelog.deliverables carries the slice's deliverables",
  changelog11.deliverables.length === 1 && changelog11.deliverables[0].deliverable_id === "pr-1",
);
check("Changelog.deliverables is empty for an unknown version", computeChangelog([], "9.9").deliverables.length === 0);

// --- computeCommitments (cycle 3) ------------------------------------------
const COMMITS = [
  { id: "03A", ts: "2026-02-01T00:00:00.000Z", type: "node.status_changed", node_id: "V-home", from: "idea", to: "discovery" },
  { id: "03B", ts: "2026-02-02T00:00:00.000Z", type: "node.status_changed", node_id: "V-home", from: "discovery", to: "backlog" },
  { id: "03C", ts: "2026-02-03T00:00:00.000Z", type: "node.status_changed", node_id: "V-home", from: "backlog", to: "development" },
  { id: "03D", ts: "2026-02-04T00:00:00.000Z", type: "node.status_changed", node_id: "V-x", from: "prioritized", to: "development" },
];
const commitments = computeCommitments([COMMITS[2], COMMITS[0], COMMITS[3], COMMITS[1]]); // shuffled
check(
  "computeCommitments keeps only idea→discovery and discovery→backlog, ordered",
  commitments.length === 2 && commitments[0].id === "03A" && commitments[1].id === "03B",
  JSON.stringify(commitments.map((e) => e.id)),
);
check("computeCommitments on an empty journal is empty", computeCommitments([]).length === 0);
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:journal-projections`
Expected: FAIL — `computeDeliverables is not a function`.

- [ ] **Step 3: Implement in `packages/schema/src/projections.ts`.** Add `NodeStatusChangedEvent` to the existing type-only import from `./journal`. Then append after the Backlog section:

```ts
// --- Deliverables ---------------------------------------------------------

/**
 * One deliverable, resolved from its `deliverable.shipped` occurrences
 * (docs/spec/journal.md § Releases): content from the LATEST occurrence,
 * anchored at the FIRST — the first occurrence is when it shipped, and later
 * re-appends edit content without moving it between releases.
 */
export interface Deliverable {
  deliverable_id: string;
  title: string;
  summary?: string;
  url?: string;
  /** Graph entities the deliverable touched. Empty when the event carried none. */
  node_ids: string[];
  platform?: PlatformId;
  /** The first occurrence's timestamp — when the deliverable shipped. */
  ts: string;
  /** The release whose changelog slice contains the anchor, or `null` (unreleased). */
  releaseVersion: string | null;
}

/**
 * Every deliverable in the journal, in shipped (first-occurrence) order. A
 * release's slice boundaries follow {@link computeChangelog}: the version's
 * LAST marker is the `to` boundary, the nearest preceding `release.tagged` of
 * any version the `from`. Events without a string `deliverable_id` are skipped
 * (render-never-crash). An empty journal yields `[]`.
 */
export function computeDeliverables(events: readonly JournalEvent[]): Deliverable[] {
  const ordered = orderEvents(events);

  // First-occurrence index (anchor) and latest occurrence (content) per id.
  const firstIndex = new Map<string, number>();
  const latest = new Map<string, JournalEvent>();
  ordered.forEach((ev, i) => {
    if (ev.type !== "deliverable.shipped") return;
    const id = asString(ev.deliverable_id);
    if (id === undefined) return;
    if (!firstIndex.has(id)) firstIndex.set(id, i);
    latest.set(id, ev);
  });
  if (firstIndex.size === 0) return [];

  // Latest marker per version (re-tag resolves latest-wins), then each
  // version's (from, to) window exactly as computeChangelog slices it.
  const markerLatest = new Map<string, number>();
  ordered.forEach((ev, i) => {
    if (ev.type !== "release.tagged") return;
    const version = asString((ev as ReleaseTaggedEvent).version);
    if (version !== undefined) markerLatest.set(version, i);
  });
  const windows: { version: string; from: number; to: number }[] = [];
  for (const [version, toIndex] of markerLatest) {
    let fromIndex = -1;
    for (let i = toIndex - 1; i >= 0; i -= 1) {
      if (ordered[i].type === "release.tagged") {
        fromIndex = i;
        break;
      }
    }
    windows.push({ version, from: fromIndex, to: toIndex });
  }
  const releaseOf = (index: number): string | null => {
    for (const w of windows) {
      if (index > w.from && index < w.to) return w.version;
    }
    return null;
  };

  // Map insertion order is first-occurrence order — already "shipped order".
  const out: Deliverable[] = [];
  for (const [id, anchorIndex] of firstIndex) {
    const ev = latest.get(id);
    if (ev === undefined) continue;
    const summary = asString(ev.summary);
    const url = asString(ev.url);
    const platform = asString(ev.platform) as PlatformId | undefined;
    out.push({
      deliverable_id: id,
      title: asString(ev.title) ?? id,
      ...(summary !== undefined ? { summary } : {}),
      ...(url !== undefined ? { url } : {}),
      node_ids: Array.isArray(ev.node_ids)
        ? (ev.node_ids as unknown[]).filter((n): n is string => typeof n === "string")
        : [],
      ...(platform !== undefined ? { platform } : {}),
      ts: asString(ordered[anchorIndex].ts) ?? "",
      releaseVersion: releaseOf(anchorIndex),
    });
  }
  return out;
}

// --- Commitments ----------------------------------------------------------

/**
 * The ordered commitment transitions — `idea → discovery` and
 * `discovery → backlog` — the Design panel's feed. Legacy pre-v3 ids never
 * match (history is read as written). An empty journal yields `[]`.
 */
export function computeCommitments(events: readonly JournalEvent[]): NodeStatusChangedEvent[] {
  return orderEvents(events).filter((ev): ev is NodeStatusChangedEvent => {
    if (ev.type !== "node.status_changed") return false;
    const from = asString(ev.from);
    const to = asString(ev.to);
    return (from === "idea" && to === "discovery") || (from === "discovery" && to === "backlog");
  });
}
```

Then wire `Changelog`: add to the `Changelog` interface (after `events`):

```ts
  /** The deliverables anchored in this slice, in shipped order (§ Releases). */
  deliverables: Deliverable[];
```

In `computeChangelog`, change the early return to:

```ts
    return { fromVersion: null, toVersion, events: [], deliverables: [] };
```

and the final return to:

```ts
  return {
    fromVersion: fromIndex >= 0 ? asString((ordered[fromIndex] as ReleaseTaggedEvent).version) ?? null : null,
    toVersion,
    ...(platform ? { platform } : {}),
    events: slice,
    deliverables: computeDeliverables(ordered).filter((d) => d.releaseVersion === toVersion),
  };
```

- [ ] **Step 4: Re-export for the app.** In `lib/utils/journal.ts`, extend the two export statements:

```ts
export {
  computeNodeTimeline,
  computeChangelog,
  computeBacklog,
  computeDeliverables,
  computeCommitments,
} from "@arkaik/schema";

export type {
  NodeTimeline,
  Changelog,
  ChangelogOptions,
  Backlog,
  BacklogOptions,
  Deliverable,
} from "@arkaik/schema";
```

- [ ] **Step 5: Run to verify pass**

Run: `npm run test:journal-projections && npm run test:journal && npm run test:emit`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/schema/src/projections.ts lib/utils/journal.ts tests/data/journal-projections.test.js
git commit -m "feat(schema): computeDeliverables, Changelog.deliverables, computeCommitments"
```

---

### Task 4: CLI — `arkaik deliverable` + release-draft grouping

**Files:**
- Create: `packages/cli/src/commands/deliverable.ts`
- Modify: `packages/cli/src/index.ts` (USAGE + dispatch)
- Modify: `packages/cli/src/commands/release.ts` (draft grouping)
- Modify: `packages/cli/src/lib/render-event.ts` (event line)
- Test: `tests/cli/deliverable.test.js` (new), registered in `package.json` `test:cli`

- [ ] **Step 1: Render line first (used by log + release).** In `packages/cli/src/lib/render-event.ts`, after the `release.tagged` case, add:

```ts
    case "deliverable.shipped": {
      const url = str(event.url);
      return `Shipped: ${str(event.title) ?? str(event.deliverable_id) ?? "?"}${url ? ` (${url})` : ""}`;
    }
```

- [ ] **Step 2: Write the failing CLI test.** Create `tests/cli/deliverable.test.js` (same harness as `tests/cli/log-release.test.js`: spawn the built CLI in a temp dir):

```js
#!/usr/bin/env node

/**
 * Exercises `arkaik deliverable` (cycle 3): appends exactly one validated
 * deliverable.shipped line to the journal.jsonl sidecar, honours --id for
 * re-append edits, and `arkaik release` groups its draft by deliverables.
 * Runs in fresh mkdtemp dirs, never the repo itself.
 */

const { spawnSync } = require("child_process");
const { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } = require("fs");
const { tmpdir } = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const CLI = path.join(ROOT, "packages", "cli", "dist", "index.js");

if (!existsSync(CLI)) {
  console.error(`CLI not built at ${CLI}. Run \`npm run build -w arkaik\` first.`);
  process.exit(1);
}

function runCli(args, cwd) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", cwd });
}

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`PASS: ${name}`);
  } else {
    failures++;
    console.log(`FAIL: ${name}${detail ? `\n${detail}` : ""}`);
  }
}

const BUNDLE = JSON.stringify({
  schema_version: 3,
  project: { id: "demo", title: "Demo", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" },
  nodes: [{ id: "V-home", species: "view", title: "Home", status: "live", platforms: ["web"] }],
  edges: [],
});
const CREATED = JSON.stringify({ id: "01A", ts: "2026-01-01T00:00:00.000Z", type: "node.created", node_id: "V-home", species: "view", title: "Home" });

const dir = mkdtempSync(path.join(tmpdir(), "arkaik-deliverable-"));
try {
  mkdirSync(path.join(dir, "docs", "arkaik"), { recursive: true });
  const bundlePath = path.join(dir, "docs", "arkaik", "bundle.json");
  const journalPath = path.join(dir, "docs", "arkaik", "journal.jsonl");
  writeFileSync(bundlePath, BUNDLE);
  writeFileSync(journalPath, `${CREATED}\n`);

  // --- append one deliverable ---
  const res = runCli(
    ["deliverable", "Ship the home page", "--id", "pr-1", "--summary", "Home ships.", "--url", "https://x/pull/1", "--nodes", "V-home", bundlePath],
    dir,
  );
  check("deliverable exits 0", res.status === 0, res.stderr);
  const lines = readFileSync(journalPath, "utf8").trim().split("\n");
  check("exactly one line appended", lines.length === 2, String(lines.length));
  const ev = JSON.parse(lines[1]);
  check("event is deliverable.shipped with the payload", ev.type === "deliverable.shipped" && ev.deliverable_id === "pr-1" && ev.title === "Ship the home page" && ev.summary === "Home ships." && ev.url === "https://x/pull/1" && Array.isArray(ev.node_ids) && ev.node_ids[0] === "V-home", lines[1]);
  check("envelope stamped (id + ts + actor)", typeof ev.id === "string" && ev.id.length === 26 && typeof ev.ts === "string" && ev.actor === "arkaik-cli", lines[1]);

  // --- default id when --id is omitted ---
  const res2 = runCli(["deliverable", "Another thing", bundlePath], dir);
  check("deliverable without --id exits 0", res2.status === 0, res2.stderr);
  const ev2 = JSON.parse(readFileSync(journalPath, "utf8").trim().split("\n")[2]);
  check("a default deliverable_id is generated", typeof ev2.deliverable_id === "string" && ev2.deliverable_id.length > 0, JSON.stringify(ev2));

  // --- dangling node ref is rejected before writing ---
  const before = readFileSync(journalPath, "utf8");
  const res3 = runCli(["deliverable", "Ghost work", "--nodes", "V-ghost", bundlePath], dir);
  check("unknown --nodes id fails", res3.status !== 0, res3.stdout);
  check("nothing appended on failure", readFileSync(journalPath, "utf8") === before);

  // --- release draft groups by deliverables ---
  const rel = runCli(["release", "1.0", bundlePath], dir);
  check("release exits 0", rel.status === 0, rel.stderr);
  check("draft lists the deliverable", rel.stdout.includes("Deliverables:") && rel.stdout.includes("Ship the home page"), rel.stdout);

  // --- validate stays green ---
  const val = runCli(["validate", bundlePath], dir);
  check("validate stays VALID", val.status === 0, val.stdout + val.stderr);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nAll deliverable CLI tests passed.");
```

Register it: in `package.json`, inside the `test:cli` script value, after `node tests/cli/log-release.test.js && ` insert `node tests/cli/deliverable.test.js && `.

- [ ] **Step 3: Run to verify failure**

Run: `npm run test:cli`
Expected: FAIL — `Unknown command: deliverable` (exit non-zero on the first spawn).

- [ ] **Step 4: Implement the command.** Create `packages/cli/src/commands/deliverable.ts`:

```ts
/**
 * `arkaik deliverable <title> [--id <id>] [--summary <s>] [--url <u>]
 *  [--nodes id,id] [--platform <p>] [path]`.
 *
 * Appends one validated `deliverable.shipped` event to the journal.jsonl
 * sidecar (docs/spec/journal.md § Releases) — a unit of shipped work, typically
 * one merged PR. `--id` is the stable deliverable identity (`pr-123` by
 * convention); re-running with the same id EDITS: consumers resolve content
 * latest-wins, anchored at the first occurrence. Without `--id` a fresh ULID
 * is used, so the deliverable cannot be edited by re-append — fine for one-off
 * notes, wrong for PR automation.
 *
 * `--nodes` ids are checked against the snapshot before writing, so a typo
 * fails loudly here instead of surfacing later as a validator error.
 */
import { makeEvent, ulid, type JournalEvent } from "@arkaik/schema";
import { readBundle, nodesByIdOf } from "../lib/bundle-io";
import { appendJournalEvent, journalPathFor } from "../lib/journal-io";

const DEFAULT_BUNDLE_PATH = "docs/arkaik/bundle.json";
const ACTOR = "arkaik-cli";

const USAGE = `arkaik deliverable <title> [options] [path]

Record a deliverable: append a validated deliverable.shipped event to the
journal.jsonl sidecar. The bundle file is not modified.

Arguments:
  title             What shipped, in one line. Required.
  path              Path to the bundle JSON file (default: ${DEFAULT_BUNDLE_PATH}).

Options:
  --id <id>         Stable deliverable id (convention: pr-123). Re-appending
                    with the same id edits the deliverable (latest-wins
                    content, anchored at the first occurrence). Default: a
                    fresh ULID.
  --summary <s>     A short human note.
  --url <u>         The PR (or other reference) URL.
  --nodes <id,id>   Comma-separated ids of graph nodes this touched. Checked
                    against the snapshot.
  --platform <p>    Scope to a platform's release rhythm.
  -h, --help        Show this help.`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

export function runDeliverable(args: string[]): void {
  let id: string | undefined;
  let summary: string | undefined;
  let url: string | undefined;
  let nodes: string[] | undefined;
  let platform: string | undefined;
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-h" || arg === "--help") {
      console.log(USAGE);
      process.exit(0);
    } else if (arg === "--id") {
      const value = args[++i];
      if (value === undefined) fail(`Missing value for --id\n\n${USAGE}`);
      id = value;
    } else if (arg === "--summary") {
      const value = args[++i];
      if (value === undefined) fail(`Missing value for --summary\n\n${USAGE}`);
      summary = value;
    } else if (arg === "--url") {
      const value = args[++i];
      if (value === undefined) fail(`Missing value for --url\n\n${USAGE}`);
      url = value;
    } else if (arg === "--nodes") {
      const value = args[++i];
      if (value === undefined) fail(`Missing value for --nodes\n\n${USAGE}`);
      nodes = value.split(",").map((n) => n.trim()).filter((n) => n !== "");
    } else if (arg === "--platform") {
      const value = args[++i];
      if (value === undefined) fail(`Missing value for --platform\n\n${USAGE}`);
      platform = value;
    } else if (arg.startsWith("-")) {
      fail(`Unknown option: ${arg}\n\n${USAGE}`);
    } else {
      positionals.push(arg);
    }
  }

  const title = positionals[0];
  if (title === undefined) fail(`Missing title.\n\n${USAGE}`);
  const filePath = positionals[1] ?? DEFAULT_BUNDLE_PATH;

  let bundle: Record<string, unknown>;
  try {
    bundle = readBundle(filePath);
  } catch (e) {
    fail(`FATAL: ${(e as Error).message}`);
  }

  // A typo'd node id fails HERE, before anything is written.
  if (nodes !== undefined) {
    const nodesById = nodesByIdOf(bundle);
    const unknown = nodes.filter((n) => !nodesById.has(n));
    if (unknown.length > 0) {
      fail(`FATAL: --nodes references unknown node id(s): ${unknown.join(", ")}`);
    }
  }

  let event: JournalEvent;
  try {
    event = makeEvent(
      "deliverable.shipped",
      {
        deliverable_id: id ?? ulid(),
        title,
        ...(summary !== undefined ? { summary } : {}),
        ...(url !== undefined ? { url } : {}),
        ...(nodes !== undefined ? { node_ids: nodes } : {}),
        ...(platform !== undefined ? { platform } : {}),
      },
      { actor: ACTOR },
    );
  } catch (e) {
    fail(`FATAL: could not build deliverable event — ${(e as Error).message}`);
  }

  const journalPath = journalPathFor(filePath);
  appendJournalEvent(journalPath, event);
  console.log(
    `\n  Recorded deliverable ${event.deliverable_id as string} — ${title} -> ${journalPath}\n`,
  );
  process.exit(0);
}
```

- [ ] **Step 5: Register in `packages/cli/src/index.ts`.** Add the import next to its siblings:

```ts
import { runDeliverable } from "./commands/deliverable";
```

In `USAGE`, after the `release` line, add:

```
  deliverable <title> [path]  Record a deliverable (append deliverable.shipped).
```

In the dispatch `switch`, after the `release` case, add:

```ts
    case "deliverable":
      runDeliverable(rest);
      return;
```

- [ ] **Step 6: Group the release draft.** In `packages/cli/src/commands/release.ts`, replace the draft printing block

```ts
  if (changelog.events.length === 0) {
    console.log("  (no changes in this release)");
  } else {
    changelog.events.forEach((ev) => console.log(`  - ${renderEventLine(ev, nodesById)}`));
  }
```

with:

```ts
  if (changelog.deliverables.length > 0) {
    console.log("  Deliverables:");
    changelog.deliverables.forEach((d) => {
      console.log(`  - ${d.title}${d.summary ? ` — ${d.summary}` : ""}${d.url ? ` (${d.url})` : ""}`);
    });
    console.log("");
  }
  if (changelog.events.length === 0) {
    console.log("  (no changes in this release)");
  } else {
    changelog.events.forEach((ev) => console.log(`  - ${renderEventLine(ev, nodesById)}`));
  }
```

- [ ] **Step 7: Run to verify pass**

Run: `npm run test:cli`
Expected: all suites PASS, including the new `deliverable.test.js` and the untouched `log-release.test.js`.

- [ ] **Step 8: Commit**

```bash
git add packages/cli/src/commands/deliverable.ts packages/cli/src/index.ts packages/cli/src/commands/release.ts packages/cli/src/lib/render-event.ts tests/cli/deliverable.test.js package.json
git commit -m "feat(cli): arkaik deliverable command; release draft groups by deliverables"
```

---

### Task 5: App event label

**Files:**
- Modify: `components/journal/describe-event.ts`

- [ ] **Step 1: Add the icon.** In the lucide import list add `Package`, and in `EVENT_ICONS` add:

```ts
  "deliverable.shipped": Package,
```

- [ ] **Step 2: Add the case.** After the `release.tagged` case in `describeJournalEvent`, add:

```ts
    case "deliverable.shipped":
      return {
        icon,
        text: `Shipped: ${str(event.title) ?? str(event.deliverable_id) ?? "?"}`,
        meta: str(event.summary),
      };
```

- [ ] **Step 3: Verify + commit**

Run: `npx tsc --noEmit 2>&1 | grep describe-event` (expect no output) and `npx eslint components/journal/describe-event.ts` (no new errors).

```bash
git add components/journal/describe-event.ts
git commit -m "feat(app): describe deliverable.shipped journal events"
```

---

### Task 6: Changelog page — Design | Delivery panels

**Files:**
- Modify: `app/project/[id]/changelog/page.tsx` (full rewrite below)

No unit test (no component runner; the logic lives in Task 3's tested projections). Verification is `tsc` + eslint + Alexis's visual checklist (Task 11).

- [ ] **Step 1: Replace the page.** Full new content of `app/project/[id]/changelog/page.tsx`:

```tsx
"use client";

import { useMemo, type ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ExternalLinkIcon,
  LightbulbIcon,
  MessageSquareTextIcon,
  PackageIcon,
  ScaleIcon,
  TagIcon,
} from "lucide-react";
import { orderEvents } from "@arkaik/schema";
import { PageShell } from "@/components/layout/PageShell";
import { DecisionStatusBadge } from "@/components/layout/DecisionStatusBadge";
import { useNodes } from "@/lib/hooks/useNodes";
import { useEffectiveProduct } from "@/lib/hooks/useProductScope";
import { useProject } from "@/lib/hooks/useProject";
import { useJournal } from "@/lib/hooks/useJournal";
import {
  computeBacklog,
  computeCommitments,
  computeDeliverables,
  type Backlog,
  type Deliverable,
} from "@/lib/utils/journal";
import { describeJournalEvent, formatEventDate } from "@/components/journal/describe-event";
import type { DecisionStatusId } from "@/lib/config/decision-statuses";
import { PLATFORM_LABELS } from "@/components/graph/nodes/node-styles";
import { productScopeMetaLabel } from "@/lib/utils/product-scope";
import type { Node, JournalEvent, ReleaseTaggedEvent } from "@/lib/data/types";

/** One deliverable row: title, note, PR link, touched-node chips. */
function DeliverableRow({ deliverable, nodesById }: { deliverable: Deliverable; nodesById: Map<string, Node> }) {
  return (
    <div className="flex items-start gap-2 rounded-md border px-3 py-2 text-sm">
      <PackageIcon className="size-3.5 shrink-0 text-muted-foreground mt-0.5" aria-hidden="true" />
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <div className="flex items-center gap-2 min-w-0">
          <p className="truncate font-medium">{deliverable.title}</p>
          {deliverable.url && (
            <a
              href={deliverable.url}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 text-muted-foreground hover:text-foreground"
              aria-label="Open pull request"
            >
              <ExternalLinkIcon className="size-3.5" />
            </a>
          )}
        </div>
        {deliverable.summary && <p className="text-xs text-muted-foreground">{deliverable.summary}</p>}
        {deliverable.node_ids.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-0.5">
            {deliverable.node_ids.map((id) => (
              <span key={id} className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                {nodesById.get(id)?.title ?? id}
              </span>
            ))}
          </div>
        )}
      </div>
      <span className="text-xs text-muted-foreground shrink-0">{formatEventDate(deliverable.ts)}</span>
    </div>
  );
}

/** A release card: version marker + note + its deliverables (not the raw feed). */
function ReleaseCard({
  tag,
  deliverables,
  nodesById,
}: {
  tag: ReleaseTaggedEvent;
  deliverables: Deliverable[];
  nodesById: Map<string, Node>;
}) {
  return (
    <div className="rounded-xl border bg-card p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <TagIcon className="size-4 text-muted-foreground" aria-hidden="true" />
          <span className="text-sm font-semibold">{tag.version}</span>
          {tag.platform && (
            <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
              {PLATFORM_LABELS[tag.platform]}
            </span>
          )}
        </div>
        <span className="text-xs text-muted-foreground">{formatEventDate(tag.ts)}</span>
      </div>
      {tag.notes && <p className="text-sm text-muted-foreground">{tag.notes}</p>}
      {deliverables.length === 0 ? (
        <p className="text-xs text-muted-foreground">No deliverables recorded for this release.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {deliverables.map((deliverable) => (
            <DeliverableRow key={deliverable.deliverable_id} deliverable={deliverable} nodesById={nodesById} />
          ))}
        </div>
      )}
    </div>
  );
}

function BacklogList({ backlog }: { backlog: Backlog }) {
  if (backlog.items.length === 0) {
    return <p className="text-sm text-muted-foreground">No open ideas or requests.</p>;
  }

  return (
    <div className="flex flex-col gap-0.5">
      {backlog.items.map((item) => {
        const Icon = item.type === "idea.proposed" ? LightbulbIcon : MessageSquareTextIcon;

        return (
          <div key={item.id} className="flex items-start gap-2 rounded-md border px-3 py-2 text-sm">
            <Icon className="size-3.5 shrink-0 text-muted-foreground mt-0.5" aria-hidden="true" />
            <div className="flex-1 min-w-0">
              <p className="truncate font-medium">{item.title}</p>
              {item.description && <p className="text-xs text-muted-foreground truncate">{item.description}</p>}
            </div>
            <span className="text-xs text-muted-foreground shrink-0">
              {item.type === "idea.proposed" ? "Idea" : "Request"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** A commitment or decision feed row. */
function FeedRow({
  event,
  nodesById,
  trailing,
}: {
  event: JournalEvent;
  nodesById: Map<string, Node>;
  trailing?: ReactNode;
}) {
  const { icon: Icon, text, meta } = describeJournalEvent(event, nodesById);

  return (
    <div className="flex items-start gap-2 rounded-md px-2 py-1.5 text-sm">
      <Icon className="size-3.5 shrink-0 text-muted-foreground mt-0.5" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <p className="truncate">{text}</p>
        {meta && <p className="text-xs text-muted-foreground truncate">{meta}</p>}
      </div>
      {trailing}
      <span className="text-xs text-muted-foreground shrink-0">{formatEventDate(event.ts)}</span>
    </div>
  );
}

function SectionHeading({ children }: { children: ReactNode }) {
  return <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{children}</h3>;
}

export default function ChangelogPage() {
  const params = useParams();
  const id = Array.isArray(params.id) ? params.id[0] : params.id ?? "";

  const { project: projectBundle, loading: projectLoading } = useProject(id);
  const { nodes: dataNodes, loading: nodesLoading } = useNodes(id);
  const { journal, loading: journalLoading } = useJournal(id);
  // Display only — the changelog itself stays unscoped; this just fills the
  // header's meta line with the same scope name every other surface shows.
  const scope = useEffectiveProduct(id, projectBundle);

  const nodesById = useMemo(() => new Map(dataNodes.map((node) => [node.id, node])), [dataNodes]);

  const deliverables = useMemo(() => computeDeliverables(journal), [journal]);
  const unreleased = useMemo(
    () => deliverables.filter((d) => d.releaseVersion === null).reverse(),
    [deliverables],
  );

  const releases = useMemo(() => {
    const tags = orderEvents(
      journal.filter((event): event is ReleaseTaggedEvent => event.type === "release.tagged"),
    );
    // A re-tagged version resolves to its latest occurrence; keep the last one
    // per version, most-recent release first.
    const byVersion = new Map<string, ReleaseTaggedEvent>();
    for (const tag of tags) byVersion.set(tag.version, tag);

    return [...byVersion.values()].reverse().map((tag) => ({
      tag,
      deliverables: deliverables.filter((d) => d.releaseVersion === tag.version),
    }));
  }, [journal, deliverables]);

  const commitments = useMemo(() => computeCommitments(journal).reverse(), [journal]);

  const decisionEvents = useMemo(
    () => orderEvents(journal.filter((event) => event.type === "decision.status_changed")).reverse(),
    [journal],
  );

  const backlog = useMemo(
    () => computeBacklog(journal, { existingNodeIds: new Set(dataNodes.map((node) => node.id)) }),
    [journal, dataNodes],
  );

  if (projectLoading || nodesLoading || journalLoading) {
    return (
      <div className="h-full w-full flex items-center justify-center">
        <span className="text-muted-foreground text-sm">Loading changelog...</span>
      </div>
    );
  }

  const isEmpty = journal.length === 0;

  return (
    <PageShell
      title="Changelog"
      meta={productScopeMetaLabel(scope)}
      headerExtra={
        projectBundle?.project.version ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Current version</span>
            <span className="rounded-full border px-2 py-0.5 font-medium text-foreground">
              {projectBundle.project.version}
            </span>
          </div>
        ) : null
      }
    >
      <div className="h-full overflow-auto p-4 md:p-6">
        {isEmpty ? (
          <div className="rounded-xl border border-dashed p-10 text-center">
            <p className="text-sm text-muted-foreground">
              No journal yet. Releases and updates will appear here once history is recorded.
            </p>
          </div>
        ) : (
          <div className="grid w-full gap-6 lg:grid-cols-2 items-start">
            {/* Design: the funnel — open backlog → commitments → decisions. */}
            <section className="rounded-xl border bg-card/50 p-4 flex flex-col gap-5">
              <h2 className="text-sm font-semibold">Design</h2>

              <div className="flex flex-col gap-3">
                <SectionHeading>Backlog</SectionHeading>
                <BacklogList backlog={backlog} />
              </div>

              <div className="flex flex-col gap-3">
                <SectionHeading>Commitments</SectionHeading>
                {commitments.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No commitments yet.</p>
                ) : (
                  <div className="flex flex-col gap-0.5">
                    {commitments.map((event) => (
                      <FeedRow key={event.id} event={event} nodesById={nodesById} />
                    ))}
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <SectionHeading>Decisions</SectionHeading>
                  <Link
                    href={`/project/${id}/decisions`}
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <ScaleIcon className="size-3.5" aria-hidden="true" />
                    Decision Log →
                  </Link>
                </div>
                {decisionEvents.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No decision activity yet.</p>
                ) : (
                  <div className="flex flex-col gap-0.5">
                    {decisionEvents.map((event) => (
                      <FeedRow
                        key={event.id}
                        event={event}
                        nodesById={nodesById}
                        trailing={
                          typeof event.to === "string" ? (
                            <DecisionStatusBadge status={event.to as DecisionStatusId} className="shrink-0" />
                          ) : undefined
                        }
                      />
                    ))}
                  </div>
                )}
              </div>
            </section>

            {/* Delivery: unreleased deliverables, then releases newest-first. */}
            <section className="rounded-xl border bg-card/50 p-4 flex flex-col gap-5">
              <h2 className="text-sm font-semibold">Delivery</h2>

              {unreleased.length > 0 && (
                <div className="flex flex-col gap-3">
                  <SectionHeading>Unreleased</SectionHeading>
                  <div className="flex flex-col gap-1.5">
                    {unreleased.map((deliverable) => (
                      <DeliverableRow key={deliverable.deliverable_id} deliverable={deliverable} nodesById={nodesById} />
                    ))}
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-3">
                <SectionHeading>Releases</SectionHeading>
                {releases.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No releases tagged yet.</p>
                ) : (
                  <div className="flex flex-col gap-4">
                    {releases.map((entry) => (
                      <ReleaseCard
                        key={entry.tag.id}
                        tag={entry.tag}
                        deliverables={entry.deliverables}
                        nodesById={nodesById}
                      />
                    ))}
                  </div>
                )}
              </div>
            </section>
          </div>
        )}
      </div>
    </PageShell>
  );
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit 2>&1 | grep "changelog/page"` — expect no output. `npx eslint "app/project/[id]/changelog/page.tsx"` — no new errors (fix the unused-import note above if flagged).

- [ ] **Step 3: Commit**

```bash
git add "app/project/[id]/changelog/page.tsx"
git commit -m "feat(app): split changelog into Design | Delivery panels"
```

---

### Task 7: History page + navigation

**Files:**
- Create: `app/project/[id]/history/page.tsx`
- Modify: `components/layout/ProjectSwitcher.tsx` (`ProjectView` union ~line 45, menu item ~line 186)
- Modify: `app/project/[id]/layout.tsx` (currentView chain ~line 61)
- Modify: `components/layout/ProjectSidebar.tsx` (changelog icon)

- [ ] **Step 1: Create the page.** `app/project/[id]/history/page.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { orderEvents } from "@arkaik/schema";
import { PageShell } from "@/components/layout/PageShell";
import { useNodes } from "@/lib/hooks/useNodes";
import { useJournal } from "@/lib/hooks/useJournal";
import { describeJournalEvent, formatEventDate } from "@/components/journal/describe-event";

/**
 * Event families for the filter chips. An unknown/forward-compatible type
 * matches no family and shows only under "All".
 */
const FAMILIES = [
  { id: "nodes", label: "Nodes", prefixes: ["node."] },
  { id: "edges", label: "Edges", prefixes: ["edge."] },
  { id: "decisions", label: "Decisions", prefixes: ["decision."] },
  { id: "delivery", label: "Delivery", prefixes: ["release.", "deliverable."] },
  { id: "intake", label: "Ideas & requests", prefixes: ["idea.", "request."] },
  { id: "refs", label: "References", prefixes: ["ref."] },
] as const;

type FamilyId = (typeof FAMILIES)[number]["id"];

export default function HistoryPage() {
  const params = useParams();
  const id = Array.isArray(params.id) ? params.id[0] : params.id ?? "";

  const { nodes: dataNodes, loading: nodesLoading } = useNodes(id);
  const { journal, loading: journalLoading } = useJournal(id);
  const [family, setFamily] = useState<FamilyId | null>(null);

  const nodesById = useMemo(() => new Map(dataNodes.map((node) => [node.id, node])), [dataNodes]);

  const events = useMemo(() => {
    const ordered = orderEvents(journal).reverse(); // newest first
    if (family === null) return ordered;
    const prefixes = FAMILIES.find((f) => f.id === family)?.prefixes ?? [];
    return ordered.filter((event) => prefixes.some((prefix) => event.type.startsWith(prefix)));
  }, [journal, family]);

  if (nodesLoading || journalLoading) {
    return (
      <div className="h-full w-full flex items-center justify-center">
        <span className="text-muted-foreground text-sm">Loading history...</span>
      </div>
    );
  }

  return (
    <PageShell title="History" meta={`${journal.length} event${journal.length === 1 ? "" : "s"}`}>
      <div className="h-full overflow-auto p-4 md:p-6">
        <div className="flex w-full flex-col gap-4">
          {journal.length === 0 ? (
            <div className="rounded-xl border border-dashed p-10 text-center">
              <p className="text-sm text-muted-foreground">
                No journal yet. Every recorded event will appear here.
              </p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setFamily(null)}
                  className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                    family === null ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  All
                </button>
                {FAMILIES.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => setFamily(family === entry.id ? null : entry.id)}
                    className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                      family === entry.id ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>

              {events.length === 0 ? (
                <p className="text-sm text-muted-foreground">No events in this family.</p>
              ) : (
                <div className="flex flex-col gap-0.5">
                  {events.map((event) => {
                    const { icon: Icon, text, meta } = describeJournalEvent(event, nodesById);

                    return (
                      <div key={event.id} className="flex items-start gap-2 rounded-md px-2 py-1.5 text-sm">
                        <Icon className="size-3.5 shrink-0 text-muted-foreground mt-0.5" aria-hidden="true" />
                        <div className="flex-1 min-w-0">
                          <p className="truncate">{text}</p>
                          {meta && <p className="text-xs text-muted-foreground truncate">{meta}</p>}
                        </div>
                        <span className="text-xs text-muted-foreground shrink-0">{formatEventDate(event.ts)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </PageShell>
  );
}
```

- [ ] **Step 2: ProjectView + switcher entry.** In `components/layout/ProjectSwitcher.tsx`:
  - Add `HistoryIcon` to the lucide import list.
  - In the `ProjectView` union, after `| "changelog"` add `| "history"`.
  - After the Settings `DropdownMenuItem` (the one linking `settingsHref`), add:

```tsx
            <DropdownMenuItem asChild className="cursor-pointer gap-2">
              <Link href={`/project/${currentProjectId}/history`}>
                <HistoryIcon className="size-4" />
                <span>History</span>
              </Link>
            </DropdownMenuItem>
```

- [ ] **Step 3: Layout route matching.** In `app/project/[id]/layout.tsx`, in the `currentView` ternary chain, after the `changelog` branch add a `history` branch (same shape as its neighbours):

```ts
          : pathname.startsWith(`/project/${id}/history`)
            ? "history"
```

(then re-indent the following branches — the chain is a nested ternary, so each later branch shifts one level; `tsc` will catch any mistake).

- [ ] **Step 4: Changelog sidebar icon.** In `components/layout/ProjectSidebar.tsx`: replace `HistoryIcon` with `ScrollTextIcon` in the lucide import, and in the Changelog `SidebarMenuButton` change `<HistoryIcon />` to `<ScrollTextIcon />`. (`HistoryIcon` now belongs to the History entry in the switcher dropdown.)

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit 2>&1 | grep -E "history/page|ProjectSwitcher|layout.tsx|ProjectSidebar"` — expect no output. `npx eslint "app/project/[id]/history/page.tsx" components/layout/ProjectSwitcher.tsx "app/project/[id]/layout.tsx" components/layout/ProjectSidebar.tsx` — no new errors.

- [ ] **Step 6: Commit**

```bash
git add "app/project/[id]/history/page.tsx" components/layout/ProjectSwitcher.tsx "app/project/[id]/layout.tsx" components/layout/ProjectSidebar.tsx
git commit -m "feat(app): History page for the granular event feed, linked near Settings"
```

---

### Task 8: Blocked notch on StatusRing

**Files:**
- Modify: `lib/utils/platform-status.ts` (rollup shape + builders + merge)
- Modify: `components/graph/nodes/StatusRing.tsx`
- Modify: `components/graph/nodes/PlatformRingSet.tsx`
- Test: `tests/app/effective-status.test.js` (follow its existing loader pattern — it transpiles `lib/utils/platform-status.ts` the same way `load-journal-projections.js` does; put the new checks next to the existing rollup checks)

- [ ] **Step 1: Write the failing test.** In `tests/app/effective-status.test.js`, using the already-loaded rollup helpers (`createEmptyRollup`, `addNodeToRollup`, `mergeRollups` — destructure any that aren't yet), add:

```js
// --- blocked counting (cycle 3) --------------------------------------------
const blockedNode = { species: "view", status: "development", platforms: ["web"], metadata: { blocked_by: "V-auth" } };
const freeNode = { species: "view", status: "live", platforms: ["web"], metadata: {} };
let blockedRollup = createEmptyRollup();
blockedRollup = addNodeToRollup(blockedRollup, blockedNode);
blockedRollup = addNodeToRollup(blockedRollup, freeNode);
check("addNodeToRollup counts blocked nodes", blockedRollup.blocked === 1, JSON.stringify(blockedRollup));
const merged = mergeRollups(blockedRollup, blockedRollup);
check("mergeRollups sums blocked counts", merged.blocked === 2, JSON.stringify(merged));
check("an all-free rollup reports zero blocked", (addNodeToRollup(createEmptyRollup(), freeNode).blocked ?? 0) === 0);
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:effective-status`
Expected: the new checks FAIL (`blocked` is undefined).

- [ ] **Step 3: Implement in `lib/utils/platform-status.ts`.** Add the import:

```ts
import { isBlocked } from "@/lib/utils/blocked";
```

Extend the rollup interface:

```ts
export interface PlatformStatusRollup {
  counts: PlatformStatusCounts;
  totals: PlatformTotals;
  /** Nodes in this rollup carrying a non-empty `metadata.blocked_by`. Absent reads as 0. */
  blocked?: number;
}
```

In `addNodeToRollup`, wrap the existing return so the node-level flag is counted once per node (not per platform):

```ts
export function addNodeToRollup(
  rollup: PlatformStatusRollup,
  node: Pick<Node, "species" | "status" | "platforms" | "metadata">,
  presetId: CountedStatusPresetId = DEFAULT_COUNTED_STATUS_PRESET_ID,
) {
  const platformStatuses = getEditablePlatformStatuses(node);

  const next = Object.entries(platformStatuses).reduce((currentRollup, [platformId, status]) => {
    if (!status) {
      return currentRollup;
    }

    return addPlatformStatusToRollup(currentRollup, platformId as PlatformId, status, presetId);
  }, rollup);

  return isBlocked(node) ? { ...next, blocked: (next.blocked ?? 0) + 1 } : next;
}
```

Apply the identical wrap to `addEffectiveNodeToRollup` (its reduce result becomes `next`, followed by the same `isBlocked` return).

In `mergeRollups`, carry the sum — change the final `return nextRollup;` inside the reduce to:

```ts
    const blocked = (nextRollup.blocked ?? 0) + (rollup.blocked ?? 0);
    return blocked > 0 ? { ...nextRollup, blocked } : nextRollup;
```

- [ ] **Step 4: Run to verify pass**

Run: `npm run test:effective-status && npm run test:coverage && npm run test:pyramid`
Expected: all PASS (the two extra suites prove existing rollup consumers are unaffected).

- [ ] **Step 5: The notch.** In `components/graph/nodes/StatusRing.tsx`:

Add to `StatusRingProps`:

```ts
  /** Nodes behind this ring carrying `metadata.blocked_by`; > 0 draws the notch. */
  blockedCount?: number;
```

Update the signature to destructure it (`blockedCount = 0`), replace the header-comment paragraph about the deferral (`blocked is a node-level flag ... see the status-lifecycle spec for the deferral.`) with:

```
 * blocked is a node-level flag (`metadata.blocked_by`), not a segment: when
 * `blockedCount` > 0 a small amber notch marks the ring (cycle 3 closed the
 * cycle-1 deferral).
```

and add inside the wrapper `div`, after the center-content `div`:

```tsx
      {blockedCount > 0 && (
        <span
          className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-amber-500 ring-2 ring-background"
          title={`${blockedCount} blocked`}
          role="img"
          aria-label={`${blockedCount} blocked`}
        />
      )}
```

- [ ] **Step 6: Wire the global ring.** In `components/graph/nodes/PlatformRingSet.tsx`, pass the count on the **global** ring only (the flag is node-level, not per-platform):

```tsx
            <StatusRing
              segments={totalSegments}
              size={size}
              blockedCount={rollup.blocked ?? 0}
              label={describeRing(
                `All platforms, ${count} ${countLabel} across ${statusTotal} platform statuses`,
                totalSegments,
              )}
            >
```

- [ ] **Step 7: Verify + commit**

Run: `npx tsc --noEmit 2>&1 | grep -E "StatusRing|PlatformRingSet|platform-status"` — expect no output; eslint the three files.

```bash
git add lib/utils/platform-status.ts components/graph/nodes/StatusRing.tsx components/graph/nodes/PlatformRingSet.tsx tests/app/effective-status.test.js
git commit -m "feat(app): blocked notch on StatusRing via rollup blocked count"
```

---

### Task 9: Seeds

**Files:**
- Modify: `seed/pebbles.json` (journal array — worked example)
- Modify: `seed/arkaik-self-map.json` (gains a `journal` array)
- Create (scratchpad only, not committed): a generation script for the self-map journal

- [ ] **Step 1: Pebbles worked example.** Append these four events to `seed/pebbles.json`'s `journal` array (existing releases: `0.2.0` @2026-05-02, `0.3.0` @2026-05-25, `0.4.0` @2026-07-01; `V-home` and `V-timeline` are real node ids; seed ids are hand-written 26-char strings — the validator does not enforce the ULID alphabet, matching the existing `01K0DECISIONSEED…` style):

```json
{ "id": "01K0DELIVSEED0000000000001", "ts": "2026-06-15T10:00:00.000Z", "actor": "arkaik-cli", "type": "deliverable.shipped", "deliverable_id": "pr-84", "title": "Timeline groups pebbles by day", "summary": "The timeline now reads as days, not one endless list.", "url": "https://github.com/example/pebbles/pull/84", "node_ids": ["V-timeline"] },
{ "id": "01K0DELIVSEED0000000000002", "ts": "2026-07-10T09:00:00.000Z", "actor": "arkaik-cli", "type": "deliverable.shipped", "deliverable_id": "pr-91", "title": "Home shows a weekly streak", "summary": "First cut of the streak counter.", "url": "https://github.com/example/pebbles/pull/91", "node_ids": ["V-home"] },
{ "id": "01K0DELIVSEED0000000000003", "ts": "2026-07-12T09:00:00.000Z", "actor": "arkaik-cli", "type": "deliverable.shipped", "deliverable_id": "pr-91", "title": "Home shows a weekly streak", "summary": "Streak counter — edited note: counts calendar weeks, not rolling 7 days.", "url": "https://github.com/example/pebbles/pull/91", "node_ids": ["V-home"] }
```

Expected projection: `pr-84` belongs to `0.4.0` (anchored between the `0.3.0` and `0.4.0` markers); `pr-91` is **unreleased** (anchored after the last marker) with the edited summary (latest-wins).

- [ ] **Step 2: Self-map journal.** `seed/arkaik-self-map.json` has **no** journal today, and the cross-check demands provenance (`node.created` for every snapshot node) the moment one exists. Generate it — write this to the scratchpad and run it:

```js
// gen-selfmap-journal.js — run: node gen-selfmap-journal.js /path/to/seed/arkaik-self-map.json
const fs = require("fs");
const file = process.argv[2];
const bundle = JSON.parse(fs.readFileSync(file, "utf8"));

// Hand-written seed ids, matching the existing 01K0…SEED style. ts values are
// deliberate: provenance at project creation, deliverables on their PR merge day.
// "01K0SELFMAPSEED" is 15 chars; padStart(11) lands every id at the usual 26.
const seedId = (n) => `01K0SELFMAPSEED${String(n).padStart(11, "0")}`;
const createdTs = bundle.project.created_at;
const journal = bundle.nodes.map((node, i) => ({
  id: seedId(i + 1),
  ts: createdTs,
  actor: "claude-code",
  type: "node.created",
  node_id: node.id,
  species: node.species,
  title: node.title,
}));

journal.push(
  {
    id: seedId(900),
    ts: "2026-08-03T12:00:00.000Z",
    actor: "claude-code",
    type: "deliverable.shipped",
    deliverable_id: "pr-331",
    title: "Status lifecycle overhaul",
    summary: "Seven statuses, blocked as a flag, permanent legacy aliases.",
    url: "https://github.com/alexisbohns/arkaik/pull/331",
  },
  {
    id: seedId(901),
    ts: "2026-08-03T16:00:00.000Z",
    actor: "claude-code",
    type: "deliverable.shipped",
    deliverable_id: "pr-335",
    title: "Decisions species",
    summary: "ADR records as first-class graph nodes, with supersedes/generates/impacts edges.",
    url: "https://github.com/alexisbohns/arkaik/pull/335",
    node_ids: bundle.nodes.filter((n) => n.species === "decision").map((n) => n.id),
  },
);

// One decision.status_changed per decision node, agreeing with the snapshot
// (cross-check rule: last .to must equal current metadata.decision_status).
bundle.nodes
  .filter((n) => n.species === "decision")
  .forEach((n, i) => {
    journal.push({
      id: seedId(910 + i),
      ts: "2026-08-03T16:30:00.000Z",
      actor: "claude-code",
      type: "decision.status_changed",
      node_id: n.id,
      from: "proposed",
      to: (n.metadata && n.metadata.decision_status) || "proposed",
    });
  });

bundle.journal = journal;
fs.writeFileSync(file, `${JSON.stringify(bundle, null, 2)}\n`);
console.log(`journal: ${journal.length} events`);
```

**Caveat the implementer must check:** if any self-map node carries `node.status_changed`-relevant state this script doesn't emit, the cross-check only compares when such events exist — emitting none is safe. Decision events MUST end at each node's current `decision_status` (the script reads it from the snapshot — all three are `enacted` today).

- [ ] **Step 3: Validate**

Run: `npm run validate:seeds`
Expected: all three bundles VALID. If the standalone validator predates Task 1's schema change, run `npm run generate` first (Task 10 regenerates it properly).

- [ ] **Step 4: Commit**

```bash
git add seed/pebbles.json seed/arkaik-self-map.json
git commit -m "feat(seed): deliverable worked example in pebbles; self-map gains its journal"
```

---

### Task 10: Docs + generated artifacts

**Files:**
- Modify: `docs/spec/journal.md`
- Regenerate: `lib/prompts/generated/schema.ts`, `public/schema/project-bundle.json`, `docs/arkaik-skill/**` (whatever `npm run generate` touches)

- [ ] **Step 1: Vocabulary row.** In `docs/spec/journal.md`'s "Event Vocabulary (v1)" table, after the `release.tagged` row, add:

```markdown
| `deliverable.shipped` | `deliverable_id`, `title`, `summary?`, `url?`, `node_ids?`, `platform?` | A unit of shipped work (typically one merged PR): entity changes + a summary note. Re-appending with the same `deliverable_id` **edits** — consumers resolve content latest-wins, anchored at the first occurrence |
```

- [ ] **Step 2: Deliverables passage.** In the "Releases, Compaction & Growth" section, after the first bullet (`release.tagged` events are the version markers…), insert:

```markdown
- **Deliverables** sit between events and releases: a `deliverable.shipped`
  records a unit of shipped work (typically one merged PR) with a summary
  note, a `url`, and the touched `node_ids`. A deliverable belongs to release
  `V` when its **first** occurrence falls inside `V`'s changelog slice; the
  first occurrence anchors *when it shipped*, and later re-appends with the
  same `deliverable_id` edit content (latest occurrence wins) without moving
  it between releases. A first occurrence after the last marker is
  *unreleased*. There is no `deliverables[]` list on `release.tagged` — the
  slice is the grouping.
```

- [ ] **Step 3: Projections table.** In the "Projections" section table, after the Changelog row, add:

```markdown
| Deliverables | "What units of work shipped, and in which release?" | Delivery panel of the changelog page; `arkaik release` draft grouping |
| Commitments | "What moved from idea to committed work?" | Design panel of the changelog page |
```

- [ ] **Step 4: Regenerate + verify clean**

Run: `npm run generate && git status --short`
Expected: only generated files changed. Then `npm run validate:seeds` again (the freshly built standalone validator must still accept both seeds).

- [ ] **Step 5: Commit**

```bash
git add docs/spec/journal.md lib/prompts/generated public/schema docs/arkaik-skill
git commit -m "docs: deliverable.shipped vocabulary + regenerate artifacts"
```

---

### Task 11: Full verification, program-doc update, PR

**Files:**
- Modify: `docs/superpowers/specs/2026-08-03-self-map-program.md` (cycle 3 status line — mark shipped only AFTER merge; in the PR just reference the spec)

- [ ] **Step 1: Full test sweep**

Run:
```bash
npm run test:journal && npm run test:emit && npm run test:journal-projections && npm run test:cli && npm run test:effective-status && npm run test:coverage && npm run test:pyramid && npm run test:delivery && npm run validate:seeds && npx tsc --noEmit
```
Expected: every suite PASS; `tsc` errors, if any, only in files this branch never touched (compare against `main` if unsure).

- [ ] **Step 2: Push and open the PR** (the branch carries the spec + plan commits too):

````bash
git push -u origin cycle3/changelog-split
gh pr create --title "Changelog split: Design | Delivery, deliverables, History page (self-map cycle 3)" --body "$(cat <<'EOF'
Cycle 3 of the self-map program (spec: docs/superpowers/specs/2026-08-03-changelog-split-design.md).

- New journal event `deliverable.shipped` (PR-based unit of work); release association is slice-based, anchored at first occurrence, content latest-wins. No bundle change, no schema_version bump, **no prod migration**.
- `computeDeliverables` / `Changelog.deliverables` / `computeCommitments` projections (schema package, shared app+CLI).
- New `arkaik deliverable` CLI command; `arkaik release` draft groups by deliverables.
- Changelog page split into **Design** (Backlog → Commitments → Decisions) and **Delivery** (Unreleased + releases with their deliverables) panels.
- New **History** page (`/project/[id]/history`) with event-family filters, linked from the project switcher next to Settings.
- Blocked notch on StatusRing (closes cycle 1's deferral).
- Seeds: pebbles worked example; the self-map gains its journal (provenance + PRs #331/#335 as deliverables).

**Visual checklist for Alexis (no browser driver here):**
- [ ] Changelog: two panels side-by-side on wide, stacked on narrow; funnel order in Design; release cards show deliverables, not raw events; Unreleased block appears (pebbles seed has one).
- [ ] History: chips filter; "All" shows everything; unknown types render as raw type.
- [ ] Switcher dropdown: History entry next to Settings; Changelog sidebar icon is now the scroll.
- [ ] Blocked notch: a ring over a node with `blocked_by` set shows the amber dot with tooltip.

## Lab Note

```yaml
en:
  title: "Your changelog now tells two stories: what you decided, and what you shipped"
  summary: "The changelog page is split into a Design side (open ideas, commitments, decisions) and a Delivery side (releases with the actual deliverables inside them). The play-by-play event feed has its own new History page."
fr:
  title: "Ton changelog raconte enfin deux histoires : ce que tu décides, et ce que tu livres"
  summary: "La page changelog se sépare en un volet Design (idées ouvertes, engagements, décisions) et un volet Delivery (les releases avec leurs livrables). Le fil d'événements détaillé a désormais sa propre page Historique."
suggested:
  molecule: arkaik
  type: feature
  tags: [changelog]
```

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
````

(The Lab Note's own ```` ```yaml ```` fence sits inside the heredoc; the outer four-backtick fence keeps this plan's markdown intact.)

- [ ] **Step 3: Read the PR comments** (the Lab Note advisory reminder posts there): `gh pr view --comments`. Fix the PR body if the reminder flags the note; posting is idempotent.

- [ ] **Step 4: After merge (separate follow-up, not this branch):** update the program doc's cycle 3 status line + the auto-memory `self-map-program.md`, per the program's standing instruction. **No prod migration is needed** (journal vocabulary grows without version bumps).
