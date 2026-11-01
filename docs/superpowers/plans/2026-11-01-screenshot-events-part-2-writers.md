# Screenshot events, Part 2: store, door, MCP, CLI, workflow and UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let every writer record a screenshot through the Part 1 ops: the hosted mutations route, a CI door with its own append-only scope, two MCP tools, an `arkaik shot` verb (hosted and Kommit), a reusable workflow, and the node panel (drop zone and URL field), with a derived "may be stale" chip and a history strip.

**Architecture:** No new rule lives here. Every surface calls `applyOps` (directly or through `/mutations`) with a `record_screenshot` / `remove_screenshot` op, so `decideScreenshot` decides once. The door is a copy of the live door's shape (`lib/services/graph/live.ts` planner + `app/api/graph/projects/[projectId]/live/route.ts`): a pure planner over a read snapshot that reports skips and refusals, then `applyMutation` under the row lock. The UI stops writing `platformScreenshots` through `update_node`.

**Tech Stack:** Next.js route handlers, `lib/services/graph/*`, `packages/mcp`, `packages/cli` (esbuild), GitHub Actions, React panels. Tests are the repo's plain Node scripts: `tests/services/*` (DB-free planner through a `load-*.js` transpiler; route tests need Postgres like `graph-api.test.js`), `tests/mcp/run-mcp-tests.js`, `tests/cli/*.test.js`, `tests/app/*`.

**Spec:** `docs/superpowers/specs/2026-11-01-screenshot-events-design.md`. **Depends on:** Part 1 merged or stacked below (`feat/screenshot-events-schema`).

**Branch:** `feat/screenshot-events-writers`, stacked on Part 1.

---

## File map

| File | Responsibility |
|---|---|
| `app/api/graph/projects/[projectId]/mutations/route.ts` (modify) | `VALID_OPS` accepts the two ops |
| `lib/services/tokens.ts`, `components/settings/TokenManager.tsx` (modify) | the `screenshot:append` scope |
| `lib/services/graph/screenshots.ts` (create) | `parseScreenshotEntries`, `planScreenshots` (DB-free) |
| `app/api/graph/projects/[projectId]/screenshots/route.ts` (create) | the door |
| `packages/mcp/src/tools.ts` (modify) | `record_screenshot`, `remove_screenshot` tools |
| `packages/cli/src/commands/shot.ts` (create), `packages/cli/src/index.ts` (modify) | `arkaik shot` |
| `.github/workflows/record-screenshots.yml` (create) | reusable workflow |
| `lib/utils/screenshot-staleness.ts` (create) | `isScreenshotStale(meta, events, nodeId, platform)` |
| `components/panels/PlatformVariants.tsx`, `NodeDetailPanel.tsx`, `ProjectPanels.tsx`, `ShotPreviewDialog.tsx` (modify) | URL field, new callbacks, chip, history strip |
| `app/project/[id]/{library,delivery,decisions,acceptances}/page.tsx`, `components/maps/JourneyMap.tsx` (modify) | wire `onScreenshot` |
| tests: `tests/services/{load-screenshots.js,screenshots.test.js}`, `tests/services/graph-api.test.js`, `tests/mcp/run-mcp-tests.js`, `tests/cli/shot.test.js`, `tests/app/{load-screenshot-staleness.js,screenshot-staleness.test.js}` | |
| docs: `docs/spec/services.md`, `docs/spec/mcp.md`, `docs/spec/toolchain.md`, `docs/hosted-projects.md` | |

---

### Task 1: The mutations route and the scope

**Files:**
- Modify: `app/api/graph/projects/[projectId]/mutations/route.ts:30-38`
- Modify: `lib/services/tokens.ts:62`
- Modify: `components/settings/TokenManager.tsx:29-35`
- Test: `tests/services/graph-api.test.js` (after the `refusedOp` block near line 349)

- [ ] **Step 1: Add the failing route test**

In `tests/services/graph-api.test.js`, after the `check("the refusal carries the machine-readable code", …)` block, add:

```js
    // --- record_screenshot through /mutations (screenshot events, part 2) -----
    const shot = await api.MUTATE(
      jsonReq(ORIGIN, "POST", { ops: [{ op: "record_screenshot", node_id: "V-home", platform: "web", source: "manual", form: "url", value: "https://shots.example/home.png" }] }, bearer(writeToken.plaintext)),
      ctx(projectId),
    );
    const shotBody = await shot.json();
    check("record_screenshot is accepted by the mutations route", shot.status === 200, JSON.stringify(shotBody));
    check("record_screenshot lands a screenshot.recorded event", Array.isArray(shotBody.events) && shotBody.events.some((e) => e.type === "screenshot.recorded" && e.url === "https://shots.example/home.png"), JSON.stringify(shotBody.events));
    const afterShot = await (await api.GET_PROJECT(readReq(), ctx(projectId))).json();
    const shotNode = afterShot.bundle.nodes.find((n) => n.id === "V-home");
    check("the slot and its meta are in the snapshot", shotNode?.metadata?.platformScreenshots?.web === "https://shots.example/home.png" && shotNode?.metadata?.platformScreenshotMeta?.web?.source === "manual", JSON.stringify(shotNode?.metadata));
```

`V-home` must be a view listing `web` in the fixture this test seeds; if the seed names it differently, use the first `species: "view"` node id the test already relies on (search the file for `"V-` to find it).

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:graph-api` (needs the test database the CI job provides; locally, follow the `DATABASE_URL` note at the top of `tests/services/graph-api.test.js`)
Expected: `FAIL: record_screenshot is accepted by the mutations route` with a 400 `invalid_ops`.

- [ ] **Step 3: Accept the ops**

In `mutations/route.ts`, extend `VALID_OPS`:

```ts
const VALID_OPS = new Set([
  "create_node",
  "update_node",
  "delete_node",
  "delete_nodes",
  "create_edge",
  "delete_edge",
  "record_screenshot",
  "remove_screenshot",
]);
```

- [ ] **Step 4: Add the scope**

In `lib/services/tokens.ts`, extend the doc comment above `TOKEN_SCOPES` with one paragraph and the array with one id:

```ts
 * `screenshot:append` is the third append-only sibling (spec 2026-11-01): a
 * CI job that renders screenshots posts their URLs through `POST …/screenshots`
 * and nothing else. It cannot read the graph, cannot touch a status, and can
 * only fill a slot on a view or an acceptance for a platform it lists — a
 * leaked token can post a picture. Not a default, for the same reason.
 */
export const TOKEN_SCOPES = ["graph:read", "graph:write", "synk", "quality:append", "release:append", "screenshot:append"] as const;
```

In `components/settings/TokenManager.tsx`, append to `SCOPE_OPTIONS`:

```ts
  { id: "screenshot:append", label: "Record screenshots", hint: "Post screenshot URLs for views and acceptances — nothing else: no reads, no status writes" },
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm run test:graph-api && npm run build`
Expected: the three new checks PASS; the build is green (the settings UI's scope list is a `const` tuple that the server re-validates through `isTokenScope`, so no other file changes).

- [ ] **Step 6: Commit**

```bash
git add app/api/graph/projects/\[projectId\]/mutations/route.ts lib/services/tokens.ts components/settings/TokenManager.tsx tests/services/graph-api.test.js
git commit -m "feat(graph): accept the screenshot ops on /mutations and add the screenshot:append scope"
```

---

### Task 2: The door's planner (DB-free)

**Files:**
- Create: `lib/services/graph/screenshots.ts`
- Create: `tests/services/load-screenshots.js`, `tests/services/screenshots.test.js`
- Modify: `package.json` (scripts), `.github/workflows/ci.yml` (after the `Live door planner tests` step)

- [ ] **Step 1: The loader**

Create `tests/services/load-screenshots.js` as a copy of `tests/services/load-live.js` with three substitutions: `BUILD_DIR` → `.test-build-screenshots`, the source file → `lib/services/graph/screenshots.ts` (fileName `screenshots.ts`), the out file → `screenshots.js`, and the export → `module.exports = { loadScreenshots, BUILD_DIR };` (rename the function accordingly).

- [ ] **Step 2: The failing tests**

Create `tests/services/screenshots.test.js`:

```js
#!/usr/bin/env node

/**
 * The pure core behind `POST /api/graph/projects/{id}/screenshots` (screenshot
 * events, part 2): lib/services/graph/screenshots.ts. DB-free like the live
 * planner — `parseScreenshotEntries` is shape validation, `planScreenshots`
 * takes the nodes as an argument and defers every decision to
 * `decideScreenshot` (@arkaik/schema), so the door and `applyOps` cannot
 * disagree. Assertions by identity, never by count.
 */

const { loadScreenshots } = require("./load-screenshots");
const { parseScreenshotEntries, planScreenshots } = loadScreenshots();

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`PASS: ${name}`);
  else { failures++; console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`); }
}

const view = (id, extra = {}) => ({ id, project_id: "p", species: "view", title: id, status: "live", platforms: ["web", "ios"], ...extra });
const entry = (over = {}) => ({ node_id: "V-home", platform: "ios", url: "https://s/a.png", commit: "c1", order: 10, ...over });
const isError = (r) => !Array.isArray(r) && typeof r.error === "string";

// --- parseScreenshotEntries ---------------------------------------------------
{
  const ok = parseScreenshotEntries({ entries: [entry({ detail: "HomeTest.default" })] });
  check("a full entry parses", Array.isArray(ok) && ok[0].node_id === "V-home" && ok[0].order === 10 && ok[0].detail === "HomeTest.default", JSON.stringify(ok));
}
check("a non-object body is an error", isError(parseScreenshotEntries(null)) && isError(parseScreenshotEntries([])));
check("an empty entries array is an error", isError(parseScreenshotEntries({ entries: [] })));
{
  const many = Array.from({ length: 101 }, (_, i) => entry({ node_id: `V-${i}` }));
  check("more than 100 entries is an error", isError(parseScreenshotEntries({ entries: many })));
}
check("platform is required", isError(parseScreenshotEntries({ entries: [{ node_id: "V-home", url: "https://s/a.png", commit: "c1", order: 1 }] })));
check("url is required", isError(parseScreenshotEntries({ entries: [{ node_id: "V-home", platform: "ios", commit: "c1", order: 1 }] })));
check("commit is required (a ci shot without provenance is worthless)", isError(parseScreenshotEntries({ entries: [entry({ commit: undefined })] })));
check("order is required and an integer", isError(parseScreenshotEntries({ entries: [entry({ order: undefined })] })) && isError(parseScreenshotEntries({ entries: [entry({ order: 1.5 })] })));
check("an unknown key is refused", isError(parseScreenshotEntries({ entries: [entry({ source: "manual" })] })));
check("a repeated (node_id, platform) pair is refused", isError(parseScreenshotEntries({ entries: [entry(), entry({ url: "https://s/b.png" })] })));
check("detail is capped at 2000 characters", isError(parseScreenshotEntries({ entries: [entry({ detail: "x".repeat(2001) })] })));

// --- planScreenshots ----------------------------------------------------------
{
  const plan = planScreenshots([view("V-home")], [entry()]);
  check("a fresh slot applies", plan.ok && plan.applied.find((a) => a.node_id === "V-home" && a.platform === "ios") !== undefined, JSON.stringify(plan));
  const op = plan.ok && plan.ops.find((o) => o.op === "record_screenshot");
  check("the op is a record_screenshot with source ci and form url", op && op.source === "ci" && op.form === "url" && op.value === "https://s/a.png" && op.order === 10 && op.commit === "c1", JSON.stringify(op));
}
{
  const plan = planScreenshots([view("V-home")], [entry({ node_id: "V-nope" })]);
  check("an unknown node refuses the batch", !plan.ok && plan.refusals.find((r) => r.reason === "unknown_node" && r.index === 0) !== undefined, JSON.stringify(plan));
}
{
  const plan = planScreenshots([view("F-x", { species: "flow" })], [entry({ node_id: "F-x" })]);
  check("a flow refuses not_shot_bearing", !plan.ok && plan.refusals[0].reason === "not_shot_bearing", JSON.stringify(plan));
}
{
  const plan = planScreenshots([view("V-home")], [entry({ platform: "android" })]);
  check("an unlisted platform refuses platform_not_applicable with the list", !plan.ok && plan.refusals[0].reason === "platform_not_applicable" && /web, ios/.test(plan.refusals[0].detail ?? ""), JSON.stringify(plan));
}
{
  const plan = planScreenshots([view("V-home")], [entry({ url: "http://s/a.png" })]);
  check("an http url refuses invalid_url", !plan.ok && plan.refusals[0].reason === "invalid_url", JSON.stringify(plan));
}
{
  const seeded = view("V-home", { metadata: { platformScreenshots: { ios: "https://s/a.png" }, platformScreenshotMeta: { ios: { source: "ci", form: "url", order: 10, ci_order: 10 } } } });
  const stale = planScreenshots([seeded], [entry({ order: 9, url: "https://s/old.png" })]);
  check("a stale order is a skip, not a refusal", stale.ok && stale.skipped.find((s) => s.reason === "stale_order") !== undefined && stale.ops.length === 0, JSON.stringify(stale));
  const same = planScreenshots([seeded], [entry({ order: 11 })]);
  check("an unchanged url is a skip", same.ok && same.skipped.find((s) => s.reason === "unchanged") !== undefined, JSON.stringify(same));
  const mixed = planScreenshots([seeded], [entry({ order: 9 }), entry({ platform: "web", url: "https://s/w.png" })]);
  check("a batch with one skip and one apply applies the one", mixed.ok && mixed.ops.length === 1 && mixed.applied[0].platform === "web" && mixed.skipped[0].platform === "ios", JSON.stringify(mixed));
}
{
  const plan = planScreenshots([view("V-home")], [entry(), entry({ node_id: "V-nope", platform: "web" })]);
  check("one refusal refuses the whole batch", !plan.ok && plan.refusals.length === 1 && plan.refusals[0].node_id === "V-nope");
}

process.exit(failures > 0 ? 1 : 0);
```

- [ ] **Step 3: Run to verify it fails**

Run: `node tests/services/screenshots.test.js`
Expected: the loader throws `ENOENT … lib/services/graph/screenshots.ts`.

- [ ] **Step 4: Create `lib/services/graph/screenshots.ts`**

```ts
import { PLATFORM_IDS, decideScreenshot, type MutationOp, type Node, type PlatformId } from "@arkaik/schema";

/**
 * The pure core behind `POST /api/graph/projects/{id}/screenshots` (spec
 * 2026-11-01 § 3): a CI job says *here is a screenshot of this node on this
 * platform, from this commit*, and nothing else.
 *
 * Same posture as lib/services/graph/live.ts: shape validation, then a plan
 * over the project's nodes taken as a plain argument (DB-free, loadable by
 * tests/services/load-screenshots.js), all-or-nothing refusals, skips that
 * write nothing. The decision itself is `decideScreenshot` from
 * @arkaik/schema — the same function `applyOps` runs under the lock — so the
 * plan this returns and the write that follows cannot disagree, except when
 * the project changed between the read and the write, which the route
 * handles by re-reading and re-planning on a version conflict.
 *
 * `source` is forced to `ci` and `form` to `url`: a token that holds only
 * `screenshot:append` is a machine, and a machine posts URLs.
 */

export interface ScreenshotEntry {
  node_id: string;
  platform: PlatformId;
  url: string;
  commit: string;
  order: number;
  detail?: string;
}

export type ScreenshotRefusalReason = "unknown_node" | "not_shot_bearing" | "platform_not_applicable" | "invalid_url";

export interface ScreenshotRefusal {
  index: number;
  node_id: string;
  platform: PlatformId;
  reason: ScreenshotRefusalReason;
  detail?: string;
}

export interface ScreenshotSkip {
  index: number;
  node_id: string;
  platform: PlatformId;
  reason: "stale_order" | "unchanged";
}

export interface ScreenshotApplied {
  node_id: string;
  platform: PlatformId;
  url: string;
}

export type ScreenshotPlan =
  | { ok: true; ops: MutationOp[]; applied: ScreenshotApplied[]; skipped: ScreenshotSkip[] }
  | { ok: false; refusals: ScreenshotRefusal[] };

const MAX_ENTRIES = 100;
const MAX_DETAIL_LENGTH = 2000;
const BODY_KEYS: ReadonlySet<string> = new Set(["entries"]);
const ENTRY_KEYS: ReadonlySet<string> = new Set(["node_id", "platform", "url", "commit", "order", "detail"]);
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

function isPlatformId(value: unknown): value is PlatformId {
  return (PLATFORM_IDS as readonly string[]).includes(value as string);
}

/**
 * Shape-validate a request body into a batch of {@link ScreenshotEntry}.
 * Purely structural: `url` must be a non-empty string here; whether it is an
 * `https://` URL is `decideScreenshot`'s call, reported as `invalid_url`.
 */
export function parseScreenshotEntries(body: unknown): ScreenshotEntry[] | { error: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { error: "body must be an object with an entries array" };
  }
  for (const key of Object.keys(body)) {
    if (!BODY_KEYS.has(key)) return { error: `body has an unknown key: ${key}` };
  }
  const { entries } = body as { entries?: unknown };
  if (!Array.isArray(entries)) return { error: "entries must be an array" };
  if (entries.length === 0) return { error: "entries must contain at least one entry" };
  if (entries.length > MAX_ENTRIES) return { error: `entries must contain at most ${MAX_ENTRIES} entries` };

  const parsed: ScreenshotEntry[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of entries.entries()) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { error: `entries[${index}] must be an object` };
    const e = raw as Record<string, unknown>;
    for (const key of Object.keys(e)) {
      if (!ENTRY_KEYS.has(key)) return { error: `entries[${index}] has an unknown key: ${key}` };
    }
    if (!isNonEmptyString(e.node_id)) return { error: `entries[${index}].node_id must be a non-empty string` };
    if (!isPlatformId(e.platform)) return { error: `entries[${index}].platform is required and must be one of: ${PLATFORM_IDS.join(", ")}` };
    if (!isNonEmptyString(e.url)) return { error: `entries[${index}].url must be a non-empty string` };
    if (!isNonEmptyString(e.commit)) return { error: `entries[${index}].commit must be a non-empty string` };
    if (typeof e.order !== "number" || !Number.isInteger(e.order) || e.order < 0) {
      return { error: `entries[${index}].order must be a non-negative integer (the commit's height on the default branch)` };
    }
    if (e.detail !== undefined) {
      if (!isNonEmptyString(e.detail)) return { error: `entries[${index}].detail must be a non-empty string when present` };
      if (e.detail.length > MAX_DETAIL_LENGTH) return { error: `entries[${index}].detail must be at most ${MAX_DETAIL_LENGTH} characters` };
      if (CONTROL_CHARACTERS.test(e.detail)) return { error: `entries[${index}].detail must not contain control characters` };
    }
    const key = `${e.node_id}@${e.platform}`;
    if (seen.has(key)) return { error: `entries[${index}] repeats ${key}; each (node_id, platform) pair may appear once` };
    seen.add(key);
    parsed.push({
      node_id: e.node_id,
      platform: e.platform,
      url: e.url,
      commit: e.commit,
      order: e.order,
      ...(e.detail !== undefined ? { detail: e.detail } : {}),
    });
  }
  return parsed;
}

/** Decide the batch against the project's nodes. One refusal refuses it all; skips write nothing. */
export function planScreenshots(nodes: readonly Node[], entries: readonly ScreenshotEntry[]): ScreenshotPlan {
  const byId = new Map(nodes.map((node) => [node.id, node] as const));
  const refusals: ScreenshotRefusal[] = [];
  const skipped: ScreenshotSkip[] = [];
  const applied: ScreenshotApplied[] = [];
  const ops: MutationOp[] = [];

  for (const [index, entry] of entries.entries()) {
    const { node_id, platform } = entry;
    const input = {
      node_id,
      platform,
      source: "ci" as const,
      form: "url" as const,
      value: entry.url,
      commit: entry.commit,
      order: entry.order,
      ...(entry.detail !== undefined ? { detail: entry.detail } : {}),
    };
    const decision = decideScreenshot(byId.get(node_id), input);
    if (decision.kind === "refuse") {
      const reason: ScreenshotRefusalReason =
        decision.code === "node_not_found" ? "unknown_node"
        : decision.code === "invalid_screenshot" ? "invalid_url"
        : decision.code;
      refusals.push({ index, node_id, platform, reason, detail: decision.message });
      continue;
    }
    if (decision.kind === "skip") {
      skipped.push({ index, node_id, platform, reason: decision.reason });
      continue;
    }
    applied.push({ node_id, platform, url: entry.url });
    ops.push({ op: "record_screenshot", ...input });
  }

  if (refusals.length > 0) return { ok: false, refusals };
  return { ok: true, ops, applied, skipped };
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `node tests/services/screenshots.test.js`
Expected: all PASS.

- [ ] **Step 6: Register the suite**

`package.json` scripts, after `"test:live"`:

```json
    "test:screenshot-door": "node tests/services/screenshots.test.js",
```

`.github/workflows/ci.yml`, after the `Live door planner tests` step:

```yaml
      - name: Screenshot door planner tests (ci source forced, all-or-nothing, skips)
        run: npm run test:screenshot-door
```

- [ ] **Step 7: Commit**

```bash
git add lib/services/graph/screenshots.ts tests/services/load-screenshots.js tests/services/screenshots.test.js package.json .github/workflows/ci.yml
git commit -m "feat(graph): add the screenshot door planner"
```

---

### Task 3: The door route

**Files:**
- Create: `app/api/graph/projects/[projectId]/screenshots/route.ts`
- Modify: `tests/services/load-graph-api.js` (four registration points: the `@/lib/services/graph/live` rewrite near line 70, the `write("live.js", …)` near line 108, the `"live-route.js":` entry near line 145, the `LIVE: req("live-route.js").POST` near line 178)
- Test: `tests/services/graph-api.test.js`
- Modify: `docs/spec/services.md` (routes table after the `…/live` row; scopes paragraph at line ~170)

- [ ] **Step 1: Register the route in the loader**

Mirror each `live` line with a `screenshots` one:

```js
    ["@/lib/services/graph/screenshots", "./screenshots.js"],
…
  write("screenshots.js", transpile(src("lib", "services", "graph", "screenshots.ts"), "screenshots.ts", COMMON));
…
    "screenshots-route.js": src("app", "api", "graph", "projects", "[projectId]", "screenshots", "route.ts"),
…
    SCREENSHOTS: req("screenshots-route.js").POST,
```

- [ ] **Step 2: Add the failing route tests**

In `tests/services/graph-api.test.js`, after the Task 1 block, add (the test file already mints tokens with explicit scopes for the live door; copy its `mintToken`/`createToken` call for `release:append` and change the scope):

```js
    // --- the screenshot door ----------------------------------------------------
    const shotToken = await mintToken(["screenshot:append"]); // same helper the live-door checks use
    const readOnly = await mintToken(["graph:read"]);
    const forbidden = await api.SCREENSHOTS(
      jsonReq(ORIGIN, "POST", { entries: [{ node_id: "V-home", platform: "web", url: "https://shots.example/ci.png", commit: "abc1234", order: 5 }] }, bearer(readOnly.plaintext)),
      ctx(projectId),
    );
    check("a read-only token gets 403 naming graph:write", forbidden.status === 403 && (await forbidden.json()).required === "graph:write");
    const door = await api.SCREENSHOTS(
      jsonReq(ORIGIN, "POST", { entries: [{ node_id: "V-home", platform: "web", url: "https://shots.example/ci.png", commit: "abc1234", order: 5, detail: "HomeTest.default" }] }, bearer(shotToken.plaintext)),
      ctx(projectId),
    );
    const doorBody = await door.json();
    check("screenshot:append opens the door", door.status === 200, JSON.stringify(doorBody));
    check("the door reports the applied slot", doorBody.applied?.find((a) => a.node_id === "V-home" && a.platform === "web") !== undefined, JSON.stringify(doorBody));
    check("the door's event carries actor arkaik-ci, the commit and the order", doorBody.events?.find((e) => e.type === "screenshot.recorded" && e.actor === "arkaik-ci" && e.commit === "abc1234" && e.order === 5) !== undefined, JSON.stringify(doorBody.events));
    const rerun = await api.SCREENSHOTS(
      jsonReq(ORIGIN, "POST", { entries: [{ node_id: "V-home", platform: "web", url: "https://shots.example/ci.png", commit: "abc1234", order: 5 }] }, bearer(shotToken.plaintext)),
      ctx(projectId),
    );
    const rerunBody = await rerun.json();
    check("a re-run is a 200 with an unchanged skip and no event", rerun.status === 200 && rerunBody.skipped?.[0]?.reason === "unchanged" && rerunBody.events.length === 0, JSON.stringify(rerunBody));
    const late = await api.SCREENSHOTS(
      jsonReq(ORIGIN, "POST", { entries: [{ node_id: "V-home", platform: "web", url: "https://shots.example/older.png", commit: "0ldc0de", order: 4 }] }, bearer(shotToken.plaintext)),
      ctx(projectId),
    );
    check("a lower order is a stale_order skip", late.status === 200 && (await late.json()).skipped?.[0]?.reason === "stale_order");
    const refusedDoor = await api.SCREENSHOTS(
      jsonReq(ORIGIN, "POST", { entries: [{ node_id: "V-home", platform: "web", url: "http://insecure/x.png", commit: "abc1234", order: 6 }] }, bearer(shotToken.plaintext)),
      ctx(projectId),
    );
    check("an http url is refused with 422 invalid_url", refusedDoor.status === 422 && (await refusedDoor.json()).refusals?.[0]?.reason === "invalid_url");
```

If no `mintToken(scopes)` helper exists, look at how the live checks obtain a `release:append` token in this file (search `release:append`) and reuse that exact construction with `["screenshot:append"]`.

- [ ] **Step 3: Run to verify it fails**

Run: `npm run test:graph-api`
Expected: the loader fails on the missing route file.

- [ ] **Step 4: Create the route**

`app/api/graph/projects/[projectId]/screenshots/route.ts`:

```ts
import { getCaller, hasScope } from "@/lib/services/auth";
import { MAX_BUNDLE_BYTES, servicesConfigured, servicesUnavailable } from "@/lib/services/db";
import { parseScreenshotEntries, planScreenshots } from "@/lib/services/graph/screenshots";
import { applyMutation, getProject, type StoreFailure } from "@/lib/services/graph/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Re-read and re-plan this many times on a version conflict before giving up with 409. */
const MAX_ATTEMPTS = 3;

/**
 * `POST` — the screenshot door (spec 2026-11-01 § 3): *here is a screenshot
 * of this node on this platform, from this commit*, and nothing else.
 *
 * The live door's shape, for the same reason: the producer is a CI job
 * holding a credential in a public repository's secrets, so the scope it
 * needs (`screenshot:append`) opens this route alone. It cannot read the
 * graph, cannot move a status, and can only fill a slot on a view or an
 * acceptance for a platform it lists. A leaked token can post a picture.
 *
 * The decision is `planScreenshots` (DB-free), which defers to
 * `decideScreenshot` — the same function `applyOps` runs under the lock, so
 * the plan and the write agree. The plan is computed from a read outside the
 * lock, so a version conflict re-reads and re-plans up to three times; the
 * plan is idempotent (`unchanged`, `stale_order`), so a retry can only
 * converge. Skips are a 200 with nothing written; one refusal refuses the
 * whole batch with a 422 naming each entry's `index` and `reason`.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> },
): Promise<Response> {
  if (!servicesConfigured()) return servicesUnavailable("Graph");

  const caller = await getCaller(req);
  if (!caller) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!hasScope(caller, "graph:write") && !hasScope(caller, "screenshot:append")) {
    return Response.json({ error: "insufficient_scope", required: "graph:write" }, { status: 403 });
  }

  const { projectId } = await params;

  const raw = await req.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_BUNDLE_BYTES) {
    return Response.json({ error: "payload_too_large", limit: MAX_BUNDLE_BYTES }, { status: 413 });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const entries = parseScreenshotEntries(body);
  if (!Array.isArray(entries)) {
    return Response.json({ error: "invalid_entries", message: entries.error }, { status: 400 });
  }

  const actor = caller.via === "token" ? "arkaik-ci" : "arkaik-app";

  try {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const found = await getProject(projectId, caller.ownerIds);
      if (!found) return Response.json({ error: "not_found" }, { status: 404 });

      const plan = planScreenshots(found.bundle.nodes, entries);
      if (!plan.ok) {
        return Response.json({ error: "refused", refusals: plan.refusals }, { status: 422 });
      }
      if (plan.ops.length === 0) {
        return Response.json(
          { version: found.version, applied: [], skipped: plan.skipped, events: [] },
          { status: 200, headers: { ETag: `"${found.version}"` } },
        );
      }

      const result = await applyMutation({
        projectId,
        ownerIds: caller.ownerIds,
        ops: plan.ops,
        actor,
        // Fills slots on existing nodes, never adds an entity: a CI job must
        // not fail on a tier cap it cannot act on (as the live door).
        tier: "klub",
        expectedVersion: found.version,
      });

      if (result.ok) {
        return Response.json(
          { version: result.version, applied: plan.applied, skipped: plan.skipped, events: result.events },
          { status: 200, headers: { ETag: `"${result.version}"` } },
        );
      }
      if (result.reason === "conflict" && attempt < MAX_ATTEMPTS) continue;
      return failureResponse(result);
    }
    throw new Error("unreachable: the last attempt always returns");
  } catch (err) {
    console.error("[graph] POST screenshots failed:", err instanceof Error ? err.message : "unknown error");
    return Response.json({ error: "internal_error", message: "Failed to record screenshots." }, { status: 500 });
  }
}

function failureResponse(result: StoreFailure): Response {
  switch (result.reason) {
    case "conflict":
      return Response.json({ error: "version_conflict", version: result.version }, { status: 409, headers: { ETag: `"${result.version}"` } });
    case "not_found":
      return Response.json({ error: "not_found" }, { status: 404 });
    case "validation":
      return Response.json({ error: "invalid_bundle", errors: result.errors }, { status: 422 });
    case "mutation":
      return Response.json({ error: "mutation_refused", code: result.code, message: result.message }, { status: 422 });
    case "limit":
      return Response.json({ error: "limit_exceeded", limit: result.limit, actual: result.actual, tier: result.tier }, { status: 422 });
  }
}
```

Copy the `limit` case's exact shape from the live route's `failureResponse` if it differs from the above, so the two doors answer alike.

- [ ] **Step 5: Run to verify it passes**

Run: `npm run test:graph-api && npm run lint`
Expected: all PASS, lint clean.

- [ ] **Step 6: Document the route**

In `docs/spec/services.md`, after the `…/live` row:

```markdown
| `POST /api/graph/projects/{id}/screenshots` | `graph:write` or `screenshot:append` | The screenshot door (spec 2026-11-01): `{ entries: [{ node_id, platform, url, commit, order, detail? }] }` records a CI screenshot URL for each slot and nothing else — views and acceptances only, `https` only, `source` forced to `ci`. One `record_screenshot` op per entry through `applyMutation`, landing as `screenshot.recorded` with actor `arkaik-ci`. Refusals (`unknown_node`, `not_shot_bearing`, `platform_not_applicable`, `invalid_url`) are an all-or-nothing 422; `stale_order` (below the slot's `ci_order` watermark) and `unchanged` are 200 skips that write nothing, so a re-run or an out-of-order run is harmless (`lib/services/graph/screenshots.ts`). Same no-`If-Match`, re-plan-on-conflict posture as `…/live` |
```

In the scopes paragraph (line ~170), change "Two append-only scopes exist" to "Three append-only scopes exist" and add: "`screenshot:append` opens `…/screenshots` for a batch of CI screenshot URLs."

- [ ] **Step 7: Commit**

```bash
git add app/api/graph/projects/\[projectId\]/screenshots tests/services/load-graph-api.js tests/services/graph-api.test.js docs/spec/services.md
git commit -m "feat(graph): open the screenshot door behind screenshot:append"
```

---

### Task 4: MCP tools

**Files:**
- Modify: `packages/mcp/src/tools.ts` (after the `update_node` tool, before `delete_node`)
- Modify: `tests/mcp/run-mcp-tests.js` (the tool-name list at line ~125; a new block after the `update_node` no-op check near line 244)
- Modify: `docs/spec/mcp.md` (tool table after the `update_node` row)

- [ ] **Step 1: Add the failing MCP checks**

In `tests/mcp/run-mcp-tests.js`, add `"record_screenshot", "remove_screenshot"` to the tool-name list at line ~125, and after the `update_node` no-op block add:

```js
  // --- record_screenshot / remove_screenshot (screenshot events, part 2) ------
  const recorded = await callTool("record_screenshot", { node_id: "V-profile", platform: "web", form: "url", value: "https://shots.example/profile.png", detail: "from the fixture" });
  check(
    "record_screenshot emits screenshot.recorded with the mcp actor and source manual",
    recorded.events?.some((e) => e.type === "screenshot.recorded" && e.actor === "arkaik-mcp" && e.source === "manual" && e.url === "https://shots.example/profile.png"),
    JSON.stringify(recorded),
  );
  check("record_screenshot returns the slot", recorded.node?.metadata?.platformScreenshots?.web === "https://shots.example/profile.png", JSON.stringify(recorded.node?.metadata));
  const recordedAgain = await callTool("record_screenshot", { node_id: "V-profile", platform: "web", form: "url", value: "https://shots.example/profile.png" });
  check("the same value again is a no-op", recordedAgain.events?.length === 0 && /no-op|unchanged/i.test(recordedAgain.note ?? ""), JSON.stringify(recordedAgain));
  const badPlatform = await callToolExpectingError("record_screenshot", { node_id: "V-profile", platform: "ios", form: "url", value: "https://shots.example/p.png" });
  check("a platform the node does not list is a tool error naming platform_not_applicable", /platform_not_applicable|lists: web/.test(badPlatform), badPlatform);
  const cleared = await callTool("remove_screenshot", { node_id: "V-profile", platform: "web" });
  check("remove_screenshot emits screenshot.removed", cleared.events?.some((e) => e.type === "screenshot.removed"), JSON.stringify(cleared));
```

`callTool` exists in the harness; if there is no `callToolExpectingError`, use the harness's existing pattern for asserting a refused call (search the file for `isError` or `error.message` after a `tools/call`) and adapt the one check.

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:mcp`
Expected: the tool-list check fails on the two missing names.

- [ ] **Step 3: Add the tools**

In `packages/mcp/src/tools.ts`, after the `update_node` tool registration:

```ts
  tool(
    {
      name: "record_screenshot",
      description:
        "Record a screenshot for one platform slot of a view or acceptance (screenshot.recorded). `form` is url (https), path (relative to the bundle) or data (an image data URI). Source is manual; CI posts through the screenshots door. Never patch metadata.platformScreenshots with update_node.",
      inputSchema: {
        type: "object",
        properties: {
          node_id: { type: "string" },
          platform: { type: "string", enum: [...PLATFORM_IDS] },
          form: { type: "string", enum: ["url", "path", "data"] },
          value: { type: "string", description: "The https URL, relative path or image data URI, per form." },
          detail: { type: "string" },
        },
        required: ["node_id", "platform", "form", "value"],
        additionalProperties: false,
      },
    },
    async (args) => {
      const nodeId = requireString(args, "node_id");
      const platform = requireString(args, "platform");
      const form = requireString(args, "form");
      const value = requireString(args, "value");
      if (!(PLATFORM_IDS as readonly string[]).includes(platform)) {
        throw new ToolError(`"${platform}" is not a platform (expected one of: ${PLATFORM_IDS.join(", ")}).`);
      }
      if (!["url", "path", "data"].includes(form)) throw new ToolError(`"${form}" is not a screenshot form (url, path or data).`);
      const graph = await load(ctx);
      const ops: MutationOp[] = [
        {
          op: "record_screenshot",
          node_id: nodeId,
          platform: platform as PlatformId,
          source: "manual",
          form: form as "url" | "path" | "data",
          value,
          ...(typeof args.detail === "string" && args.detail !== "" ? { detail: args.detail } : {}),
        },
      ];
      const outcome = mutate(graph, ops);
      const node = outcome.nodes.find((candidate) => candidate.id === nodeId)!;
      if (outcome.eventInputs.length === 0) {
        return { node, events: [], note: "No-op — the slot already holds this value, or a newer CI shot outranks it; nothing written." };
      }
      const result = await ctx.store.persist(graph, { nodes: outcome.nodes, edges: outcome.edges, ops }, outcome.eventInputs);
      const { warnings, events } = unwrap(result);
      return { node, events, warnings };
    },
  );

  tool(
    {
      name: "remove_screenshot",
      description: "Clear one platform slot's screenshot (screenshot.removed). The slot's CI order watermark survives, so a late CI re-run cannot bring the shot back.",
      inputSchema: {
        type: "object",
        properties: { node_id: { type: "string" }, platform: { type: "string", enum: [...PLATFORM_IDS] } },
        required: ["node_id", "platform"],
        additionalProperties: false,
      },
    },
    async (args) => {
      const nodeId = requireString(args, "node_id");
      const platform = requireString(args, "platform");
      if (!(PLATFORM_IDS as readonly string[]).includes(platform)) {
        throw new ToolError(`"${platform}" is not a platform (expected one of: ${PLATFORM_IDS.join(", ")}).`);
      }
      const graph = await load(ctx);
      const ops: MutationOp[] = [{ op: "remove_screenshot", node_id: nodeId, platform: platform as PlatformId }];
      const outcome = mutate(graph, ops);
      const node = outcome.nodes.find((candidate) => candidate.id === nodeId)!;
      if (outcome.eventInputs.length === 0) return { node, events: [], note: "No-op — the slot was already empty." };
      const result = await ctx.store.persist(graph, { nodes: outcome.nodes, edges: outcome.edges, ops }, outcome.eventInputs);
      const { warnings, events } = unwrap(result);
      return { node, events, warnings };
    },
  );
```

Add `type PlatformId` to the `@arkaik/schema` import at the top of the file. `mutate()` in this file wraps `applyOps` and converts a `MutationError` into a `ToolError` carrying its code and message; confirm by reading `mutate` at line ~145 and, if it does not include `error.code` in the message, change it to `` `${error.code}: ${error.message}` `` so the `platform_not_applicable` check can match.

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:mcp`
Expected: all PASS. The hosted `remote-store.ts` needs no change: it forwards `ops` to `/mutations`, which Task 1 taught to accept them.

- [ ] **Step 5: Document**

In `docs/spec/mcp.md` tool table, after the `update_node` row:

```markdown
| `record_screenshot` | `node_id`, `platform`, `form` (`url` \| `path` \| `data`), `value`, `detail?` | updated node | `screenshot.recorded` (source `manual`); a no-op when the value is unchanged or a newer CI shot outranks it |
| `remove_screenshot` | `node_id`, `platform` | updated node | `screenshot.removed` |
```

Then `npm run generate` (the plugin's tool list and prompt fragments derive from the catalog) and commit the generated files.

- [ ] **Step 6: Commit**

```bash
git add packages/mcp/src/tools.ts tests/mcp/run-mcp-tests.js docs/spec/mcp.md plugin lib/prompts/generated
git commit -m "feat(mcp): add record_screenshot and remove_screenshot tools"
```

---

### Task 5: `arkaik shot`

**Files:**
- Create: `packages/cli/src/commands/shot.ts`
- Modify: `packages/cli/src/index.ts` (import, USAGE line after `live`, `case "shot"`)
- Create: `tests/cli/shot.test.js`; modify `package.json` (`test:cli` chain, add `&& node tests/cli/shot.test.js` after the live test)
- Modify: `docs/spec/toolchain.md` (verb table after the `arkaik live` row)

Two modes, chosen by the presence of `docs/arkaik/arkaik.json`:
- **hosted** (linked repo): post the manifest to the door, chunked by 100, like `live`.
- **Kommit** (no link): dual-write the local bundle through `applyOps` + `appendJournalEvent`, with `source: ci` when `--commit` is given and `manual` otherwise.

- [ ] **Step 1: The failing CLI test**

Create `tests/cli/shot.test.js`:

```js
#!/usr/bin/env node

/**
 * `arkaik shot` (packages/cli/src/commands/shot.ts): post a manifest of
 * screenshot URLs to the hosted door, or dual-write them into a repo bundle.
 *
 *  - hosted: `runShot` in-process with a mock httpClient recording every call
 *    (tests/cli/live.test.js's idiom), so the body and exit outcome are
 *    asserted without a network;
 *  - Kommit: the built CLI against a tmpdir bundle + journal (deliverable.test.js's idiom);
 *  - argv errors through the built CLI.
 */

const { build } = require("esbuild");
const { spawnSync } = require("child_process");
const { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } = require("fs");
const { tmpdir } = require("os");
const path = require("path");
const { pathToFileURL } = require("url");

const ROOT = path.join(__dirname, "..", "..");
const CLI = path.join(ROOT, "packages", "cli", "dist", "index.js");
const SHOT_ENTRY = path.join(ROOT, "packages", "cli", "src", "commands", "shot.ts");
const TEST_BUILD_DIR = path.join(ROOT, "packages", "cli", ".test-build-shot");
const SHOT_BUNDLE = path.join(TEST_BUILD_DIR, "shot.mjs");

if (!existsSync(CLI)) {
  console.error(`CLI not built at ${CLI}. Run \`npm run build -w arkaik\` first.`);
  process.exit(1);
}

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`PASS: ${name}`);
  else { failures++; console.log(`FAIL: ${name}${detail ? ` — ${typeof detail === "function" ? detail() : detail}` : ""}`); }
}

function makeMockHttpClient(responder) {
  const calls = [];
  const client = async (url, init) => { calls.push({ url, init }); return responder(url, init, calls.length); };
  client.calls = calls;
  return client;
}
const jsonResponse = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });

function linkedDir(remote = "https://arkaik.test") {
  const dir = mkdtempSync(path.join(tmpdir(), "arkaik-shot-"));
  mkdirSync(path.join(dir, "docs", "arkaik"), { recursive: true });
  writeFileSync(path.join(dir, "docs", "arkaik", "arkaik.json"), JSON.stringify({ project_id: "prj_test", remote }));
  return dir;
}

const BUNDLE = JSON.stringify({
  schema_version: 3,
  project: { id: "demo", title: "Demo", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" },
  nodes: [{ id: "V-home", project_id: "demo", species: "view", title: "Home", status: "live", platforms: ["web"] }],
  edges: [],
});
const CREATED = JSON.stringify({ id: "01A", ts: "2026-01-01T00:00:00.000Z", type: "node.created", node_id: "V-home", species: "view", title: "Home" });
const MANIFEST = JSON.stringify([{ node_id: "V-home", platform: "web", url: "https://shots.example/home.png", detail: "HomeTest.default" }]);

async function main() {
  mkdirSync(TEST_BUILD_DIR, { recursive: true });
  await build({ entryPoints: [SHOT_ENTRY], outfile: SHOT_BUNDLE, bundle: true, platform: "node", target: "node18", format: "esm", legalComments: "none" });
  const { runShot } = await import(pathToFileURL(SHOT_BUNDLE).href);

  // --- hosted ---------------------------------------------------------------------
  {
    const dir = linkedDir();
    writeFileSync(path.join(dir, "shots.json"), MANIFEST);
    const http = makeMockHttpClient(() => jsonResponse(200, { version: "2", applied: [{ node_id: "V-home", platform: "web", url: "https://shots.example/home.png" }], skipped: [], events: [] }));
    const out = [];
    const result = await runShot(["--manifest", "shots.json", "--commit", "abc1234", "--order", "412"], { cwd: dir, env: { ARKAIK_TOKEN: "t" }, httpClient: http, log: (m) => out.push(m), errorLog: (m) => out.push(m) });
    check("hosted: exits ok", result.ok === true, () => out.join("\n"));
    check("hosted: posts to the screenshots door with a bearer token", http.calls.length === 1 && /\/api\/graph\/projects\/prj_test\/screenshots$/.test(http.calls[0].url) && http.calls[0].init.headers.authorization === "Bearer t", JSON.stringify(http.calls[0]?.url));
    const body = JSON.parse(http.calls[0].init.body);
    check("hosted: the entries carry commit and order from the flags", body.entries[0].node_id === "V-home" && body.entries[0].commit === "abc1234" && body.entries[0].order === 412 && body.entries[0].detail === "HomeTest.default", JSON.stringify(body));
    rmSync(dir, { recursive: true, force: true });
  }
  {
    const dir = linkedDir();
    writeFileSync(path.join(dir, "shots.json"), MANIFEST);
    const http = makeMockHttpClient(() => jsonResponse(422, { error: "refused", refusals: [{ index: 0, node_id: "V-home", platform: "web", reason: "platform_not_applicable", detail: "V-home lists: ios" }] }));
    const out = [];
    const result = await runShot(["--manifest", "shots.json", "--commit", "abc1234", "--order", "1"], { cwd: dir, env: { ARKAIK_TOKEN: "t" }, httpClient: http, log: (m) => out.push(m), errorLog: (m) => out.push(m) });
    check("hosted: a refusal is exit 1 naming the entry", result.ok === false && out.some((m) => /V-home@web.*platform_not_applicable/.test(m)), () => out.join("\n"));
    rmSync(dir, { recursive: true, force: true });
  }
  {
    const dir = linkedDir();
    writeFileSync(path.join(dir, "shots.json"), MANIFEST);
    const http = makeMockHttpClient(() => jsonResponse(200, { version: "2", applied: [], skipped: [{ index: 0, node_id: "V-home", platform: "web", reason: "stale_order" }], events: [] }));
    const out = [];
    const result = await runShot(["--manifest", "shots.json", "--commit", "abc1234", "--order", "1"], { cwd: dir, env: { ARKAIK_TOKEN: "t" }, httpClient: http, log: (m) => out.push(m), errorLog: (m) => out.push(m) });
    check("hosted: a skip is exit 0 and says why", result.ok === true && out.some((m) => /stale_order/.test(m)), () => out.join("\n"));
    rmSync(dir, { recursive: true, force: true });
  }
  {
    const dir = linkedDir();
    writeFileSync(path.join(dir, "shots.json"), MANIFEST);
    const out = [];
    const result = await runShot(["--manifest", "shots.json", "--commit", "abc1234", "--order", "1"], { cwd: dir, env: {}, httpClient: makeMockHttpClient(() => jsonResponse(200, {})), log: (m) => out.push(m), errorLog: (m) => out.push(m) });
    check("hosted: no ARKAIK_TOKEN is exit 1 naming screenshot:append", result.ok === false && out.some((m) => /ARKAIK_TOKEN/.test(m) && /screenshot:append/.test(m)), () => out.join("\n"));
    rmSync(dir, { recursive: true, force: true });
  }
  {
    const dir = linkedDir();
    writeFileSync(path.join(dir, "shots.json"), MANIFEST);
    const out = [];
    const result = await runShot(["--manifest", "shots.json", "--order", "1"], { cwd: dir, env: { ARKAIK_TOKEN: "t" }, httpClient: makeMockHttpClient(() => jsonResponse(200, {})), log: (m) => out.push(m), errorLog: (m) => out.push(m) });
    check("hosted: --commit is required", result.ok === false && out.some((m) => /--commit/.test(m)), () => out.join("\n"));
    rmSync(dir, { recursive: true, force: true });
  }

  // --- Kommit ---------------------------------------------------------------------
  {
    const dir = mkdtempSync(path.join(tmpdir(), "arkaik-shot-kommit-"));
    mkdirSync(path.join(dir, "docs", "arkaik"), { recursive: true });
    const bundlePath = path.join(dir, "docs", "arkaik", "bundle.json");
    const journalPath = path.join(dir, "docs", "arkaik", "journal.jsonl");
    writeFileSync(bundlePath, BUNDLE);
    writeFileSync(journalPath, `${CREATED}\n`);
    writeFileSync(path.join(dir, "shots.json"), MANIFEST);
    const res = spawnSync(process.execPath, [CLI, "shot", "--manifest", "shots.json", "--commit", "abc1234", "--order", "7"], { encoding: "utf8", cwd: dir });
    check("kommit: exits 0", res.status === 0, res.stderr + res.stdout);
    const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
    const home = bundle.nodes.find((n) => n.id === "V-home");
    check("kommit: the slot is written", home.metadata?.platformScreenshots?.web === "https://shots.example/home.png", JSON.stringify(home.metadata));
    check("kommit: the meta carries ci provenance", home.metadata?.platformScreenshotMeta?.web?.source === "ci" && home.metadata.platformScreenshotMeta.web.order === 7 && home.metadata.platformScreenshotMeta.web.ci_order === 7, JSON.stringify(home.metadata));
    const lines = readFileSync(journalPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    check("kommit: one screenshot.recorded appended with actor arkaik-cli", lines.find((e) => e.type === "screenshot.recorded" && e.actor === "arkaik-cli" && e.url === "https://shots.example/home.png" && e.order === 7) !== undefined, JSON.stringify(lines));
    const validate = spawnSync(process.execPath, [CLI, "validate", bundlePath], { encoding: "utf8", cwd: dir });
    check("kommit: the bundle validates after the write", validate.status === 0, validate.stdout + validate.stderr);
    const again = spawnSync(process.execPath, [CLI, "shot", "--manifest", "shots.json", "--commit", "abc1234", "--order", "7"], { encoding: "utf8", cwd: dir });
    check("kommit: a re-run writes nothing and exits 0", again.status === 0 && readFileSync(journalPath, "utf8").trim().split("\n").length === 2, again.stdout + again.stderr);
    const manual = spawnSync(process.execPath, [CLI, "shot", "V-home", "web", "https://shots.example/by-hand.png"], { encoding: "utf8", cwd: dir });
    check("kommit: a positional shot without --commit is manual", manual.status === 0 && JSON.parse(readFileSync(bundlePath, "utf8")).nodes[0].metadata.platformScreenshotMeta.web.source === "manual", manual.stdout + manual.stderr);
    rmSync(dir, { recursive: true, force: true });
  }

  // --- argv errors ------------------------------------------------------------------
  {
    const res = spawnSync(process.execPath, [CLI, "shot", "--manifest=shots.json"], { encoding: "utf8" });
    check("an --flag=value form is refused", res.status === 1 && /Unknown flag/.test(res.stderr), res.stderr);
    const help = spawnSync(process.execPath, [CLI, "shot", "--help"], { encoding: "utf8" });
    check("--help prints usage and exits 0", help.status === 0 && /arkaik shot/.test(help.stdout));
  }

  rmSync(TEST_BUILD_DIR, { recursive: true, force: true });
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run build -w arkaik && node tests/cli/shot.test.js`
Expected: esbuild fails on the missing `shot.ts`.

- [ ] **Step 3: Create `packages/cli/src/commands/shot.ts`**

```ts
/**
 * `arkaik shot [--manifest <file>] [--commit <sha>] [--order <n>] [--remote <url>] [--dry-run] [node_id platform value]`
 *
 * Record screenshots (spec 2026-11-01). Entries come from `--manifest`, a
 * JSON array of `{ node_id, platform, url, detail? }`, and/or one positional
 * triple. Two modes, chosen by the repo:
 *
 *  - **hosted** (docs/arkaik/arkaik.json present): post the entries to
 *    `POST /api/graph/projects/{id}/screenshots` (scope `screenshot:append`),
 *    chunked by 100. `--commit` and `--order` are required — the door records
 *    CI shots only, and a CI shot without provenance is worthless. A refusal
 *    or any non-2xx is exit 1; skips (`stale_order`, `unchanged`) are
 *    reported and exit 0.
 *  - **Kommit** (no link): dual-write the local bundle through `applyOps`
 *    (`record_screenshot` op) and append the derived events to the journal
 *    sidecar — exactly what the skill does by hand. With `--commit` the shot
 *    is `source: ci` (and `--order` is required); without it, `manual`.
 *
 * The project id and remote come from docs/arkaik/arkaik.json; the token
 * from $ARKAIK_TOKEN, never from a file.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  PLATFORM_IDS,
  applyOps,
  serializeBundle,
  toJournalEvents,
  type MutationOp,
  type PlatformId,
} from "@arkaik/schema";
import { readBundle } from "../lib/bundle-io";
import { appendJournalEvent, ensureJournalBaseline, journalPathFor } from "../lib/journal-io";
import { renderEventLine } from "../lib/render-event";

const LINK_FILE = "docs/arkaik/arkaik.json";
const DEFAULT_BUNDLE_PATH = "docs/arkaik/bundle.json";
const DEFAULT_BASE_URL = "https://arkaik.app";
const ACTOR = "arkaik-cli";
/** The door's per-request cap (lib/services/graph/screenshots.ts MAX_ENTRIES). */
const MAX_ENTRIES_PER_REQUEST = 100;
const KNOWN_FLAGS = new Set(["--manifest", "--commit", "--order", "--remote", "--bundle", "--dry-run", "--help"]);
const VALUED_FLAGS = new Set(["--manifest", "--commit", "--order", "--remote", "--bundle"]);

const USAGE = `arkaik shot — record screenshots for views and acceptances

Usage:
  arkaik shot --manifest <file> --commit <sha> --order <n> [options]
  arkaik shot <node_id> <platform> <value> [--commit <sha> --order <n>]

Options:
  --manifest <file>   JSON array of { node_id, platform, url, detail? }.
  --commit <sha>      The commit the shots were rendered from. Required when hosted.
  --order <n>         The commit's height on the default branch (git rev-list --count). Required with --commit.
  --remote <url>      Override the hosted origin (default: the link file's remote, then $ARKAIK_URL, then ${DEFAULT_BASE_URL}).
  --bundle <path>     Kommit only: the bundle to write (default: ${DEFAULT_BUNDLE_PATH}).
  --dry-run           Show what would be recorded and exit 0.
  -h, --help          Show this help.

Environment:
  ARKAIK_TOKEN        Required when hosted. A screenshot:append token from <origin>/settings/tokens.`;

export interface RunShotOptions {
  httpClient?: typeof fetch;
  cwd?: string;
  env?: Record<string, string | undefined>;
  log?: (message: string) => void;
  errorLog?: (message: string) => void;
}

export interface RunShotResult {
  ok: boolean;
}

interface ManifestEntry {
  node_id: string;
  platform: PlatformId;
  url: string;
  detail?: string;
}

interface DoorResponse {
  version?: string;
  applied?: Array<{ node_id: string; platform: string; url: string }>;
  skipped?: Array<{ index: number; node_id: string; platform: string; reason: string }>;
  refusals?: Array<{ index: number; node_id: string; platform: string; reason: string; detail?: string }>;
  error?: string;
  message?: string;
}

function flagValue(argv: readonly string[], flag: string): string | undefined {
  const at = argv.indexOf(flag);
  return at === -1 ? undefined : argv[at + 1];
}

function isPlatformId(value: unknown): value is PlatformId {
  return (PLATFORM_IDS as readonly string[]).includes(value as string);
}

function readManifest(file: string): ManifestEntry[] | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    return { error: `Could not read ${file}: ${(e as Error).message}` };
  }
  if (!Array.isArray(parsed)) return { error: `${file} must be a JSON array of { node_id, platform, url, detail? }` };
  const entries: ManifestEntry[] = [];
  for (const [i, raw] of parsed.entries()) {
    if (typeof raw !== "object" || raw === null) return { error: `${file}[${i}] must be an object` };
    const r = raw as Record<string, unknown>;
    if (typeof r.node_id !== "string" || r.node_id === "") return { error: `${file}[${i}].node_id must be a non-empty string` };
    if (!isPlatformId(r.platform)) return { error: `${file}[${i}].platform must be one of: ${PLATFORM_IDS.join(", ")}` };
    if (typeof r.url !== "string" || r.url === "") return { error: `${file}[${i}].url must be a non-empty string` };
    if (r.detail !== undefined && typeof r.detail !== "string") return { error: `${file}[${i}].detail must be a string` };
    entries.push({ node_id: r.node_id, platform: r.platform, url: r.url, ...(typeof r.detail === "string" && r.detail !== "" ? { detail: r.detail } : {}) });
  }
  return entries;
}

function describeFailure(status: number, baseUrl: string, body: DoorResponse): string {
  if (status === 401) return `Unauthorized — check ARKAIK_TOKEN (create one at ${baseUrl}/settings/tokens).`;
  if (status === 403) return "Forbidden — this token lacks the screenshot:append scope (or graph:write).";
  if (status === 404) return `No linked project in this account — check ${LINK_FILE}.`;
  if (status === 409) return "The project changed under every retry — run again.";
  return `Request failed (${status})${body.message ? ` — ${body.message}` : body.error ? ` — ${body.error}` : ""}.`;
}

export async function runShot(argv: string[], options: RunShotOptions = {}): Promise<RunShotResult> {
  const log = options.log ?? ((m: string) => console.log(m));
  const errorLog = options.errorLog ?? ((m: string) => console.error(m));
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const doFetch = options.httpClient ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  if (argv.includes("--help") || argv.includes("-h")) {
    log(USAGE);
    return { ok: true };
  }

  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (VALUED_FLAGS.has(arg)) { i++; continue; }
    if (arg.startsWith("--")) {
      if (KNOWN_FLAGS.has(arg)) continue;
      errorLog(`Unknown flag ${arg}. Flags take a separate value (--manifest shots.json), see arkaik shot --help.`);
      return { ok: false };
    }
    positional.push(arg);
  }
  if (positional.length !== 0 && positional.length !== 3) {
    errorLog("A positional shot is exactly <node_id> <platform> <value>; see arkaik shot --help.");
    return { ok: false };
  }

  const manifestFile = flagValue(argv, "--manifest");
  const commit = flagValue(argv, "--commit");
  const orderArg = flagValue(argv, "--order");
  const dryRun = argv.includes("--dry-run");
  let order: number | undefined;
  if (orderArg !== undefined) {
    order = Number(orderArg);
    if (!Number.isInteger(order) || order < 0) {
      errorLog(`--order must be a non-negative integer, got "${orderArg}".`);
      return { ok: false };
    }
  }
  if (commit !== undefined && order === undefined) {
    errorLog("--order is required with --commit: the commit's height on the default branch (git rev-list --count <sha>).");
    return { ok: false };
  }

  const entries: ManifestEntry[] = [];
  if (manifestFile !== undefined) {
    const read = readManifest(resolve(cwd, manifestFile));
    if (!Array.isArray(read)) {
      errorLog(read.error);
      return { ok: false };
    }
    entries.push(...read);
  }
  if (positional.length === 3) {
    const [node_id, platform, url] = positional;
    if (!isPlatformId(platform)) {
      errorLog(`"${platform}" is not a platform. Expected one of: ${PLATFORM_IDS.join(", ")}.`);
      return { ok: false };
    }
    entries.push({ node_id, platform, url });
  }
  if (entries.length === 0) {
    errorLog("Nothing to record: pass --manifest <file> or <node_id> <platform> <value>.");
    return { ok: false };
  }

  const linkPath = join(cwd, LINK_FILE);
  if (existsSync(linkPath)) {
    return runHosted({ entries, commit, order, dryRun, linkPath, argv, env, doFetch, log, errorLog });
  }
  return runKommit({ entries, commit, order, dryRun, cwd, argv, log, errorLog });
}

interface HostedInput {
  entries: ManifestEntry[];
  commit: string | undefined;
  order: number | undefined;
  dryRun: boolean;
  linkPath: string;
  argv: string[];
  env: Record<string, string | undefined>;
  doFetch: typeof fetch;
  log: (m: string) => void;
  errorLog: (m: string) => void;
}

async function runHosted(input: HostedInput): Promise<RunShotResult> {
  const { entries, commit, order, dryRun, linkPath, argv, env, doFetch, log, errorLog } = input;
  if (commit === undefined || order === undefined) {
    errorLog("--commit and --order are required against a hosted project: the door records CI shots, and a CI shot without provenance is worthless.");
    return { ok: false };
  }
  let link: { project_id?: string; remote?: string };
  try {
    link = JSON.parse(readFileSync(linkPath, "utf8")) as { project_id?: string; remote?: string };
  } catch {
    errorLog(`Could not read ${LINK_FILE}.`);
    return { ok: false };
  }
  const projectId = link.project_id;
  if (!projectId) {
    errorLog(`${LINK_FILE} has no project_id. Run \`arkaik link --project <id>\`.`);
    return { ok: false };
  }
  const baseUrl = (flagValue(argv, "--remote") ?? env.ARKAIK_URL ?? link.remote ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const doorEntries = entries.map((e) => ({ node_id: e.node_id, platform: e.platform, url: e.url, commit, order, ...(e.detail !== undefined ? { detail: e.detail } : {}) }));

  if (dryRun) {
    log(`Would record ${doorEntries.length} screenshot(s) on ${projectId} (${baseUrl}) from ${commit} (order ${order}):`);
    for (const e of doorEntries) log(`  ${e.node_id}@${e.platform} ← ${e.url}`);
    return { ok: true };
  }

  const token = env.ARKAIK_TOKEN;
  if (!token) {
    errorLog(`ARKAIK_TOKEN is not set. Create a screenshot:append token at ${baseUrl}/settings/tokens and export it.`);
    return { ok: false };
  }

  for (let start = 0; start < doorEntries.length; start += MAX_ENTRIES_PER_REQUEST) {
    const chunk = doorEntries.slice(start, start + MAX_ENTRIES_PER_REQUEST);
    let res: Response;
    try {
      res = await doFetch(`${baseUrl}/api/graph/projects/${encodeURIComponent(projectId)}/screenshots`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ entries: chunk }),
      });
    } catch (e) {
      errorLog(`Could not reach ${baseUrl}: ${(e as Error).message}`);
      return { ok: false };
    }
    let body: DoorResponse = {};
    try { body = (await res.json()) as DoorResponse; } catch { /* a non-JSON error body */ }
    if (res.status === 422 && Array.isArray(body.refusals)) {
      for (const r of body.refusals) {
        const e = chunk[r.index];
        errorLog(`refused: ${e?.node_id ?? r.node_id}@${e?.platform ?? r.platform} — ${r.reason}${r.detail ? ` (${r.detail})` : ""}`);
      }
      errorLog("Nothing was recorded: a refused entry refuses the whole batch.");
      return { ok: false };
    }
    if (!res.ok) {
      errorLog(describeFailure(res.status, baseUrl, body));
      return { ok: false };
    }
    for (const a of body.applied ?? []) log(`recorded: ${a.node_id}@${a.platform} ← ${a.url}`);
    for (const s of body.skipped ?? []) log(`skipped: ${s.node_id}@${s.platform} — ${s.reason}`);
  }
  return { ok: true };
}

interface KommitInput {
  entries: ManifestEntry[];
  commit: string | undefined;
  order: number | undefined;
  dryRun: boolean;
  cwd: string;
  argv: string[];
  log: (m: string) => void;
  errorLog: (m: string) => void;
}

function runKommit(input: KommitInput): RunShotResult {
  const { entries, commit, order, dryRun, cwd, argv, log, errorLog } = input;
  const bundlePath = resolve(cwd, flagValue(argv, "--bundle") ?? DEFAULT_BUNDLE_PATH);
  let bundle: Record<string, unknown>;
  try {
    bundle = readBundle(bundlePath);
  } catch (e) {
    errorLog(`FATAL: ${(e as Error).message}`);
    return { ok: false };
  }
  const source = commit !== undefined ? "ci" : "manual";
  const ops: MutationOp[] = entries.map((e) => ({
    op: "record_screenshot",
    node_id: e.node_id,
    platform: e.platform,
    source,
    form: /^https:\/\//.test(e.url) ? "url" : e.url.startsWith("data:") ? "data" : "path",
    value: e.url,
    ...(commit !== undefined ? { commit, order } : {}),
    ...(e.detail !== undefined ? { detail: e.detail } : {}),
  }));

  if (dryRun) {
    log(`Would record ${ops.length} ${source} screenshot(s) into ${bundlePath}:`);
    for (const e of entries) log(`  ${e.node_id}@${e.platform} ← ${e.url}`);
    return { ok: true };
  }

  const project = bundle.project as { id: string };
  let outcome;
  try {
    outcome = applyOps(
      { projectId: project.id, nodes: bundle.nodes as Parameters<typeof applyOps>[0]["nodes"], edges: bundle.edges as Parameters<typeof applyOps>[0]["edges"] },
      ops,
    );
  } catch (e) {
    errorLog(`FATAL: ${(e as Error).message}`);
    return { ok: false };
  }
  if (outcome.eventInputs.length === 0) {
    log("Nothing to record: every slot already holds this value, or a newer CI shot outranks it.");
    return { ok: true };
  }
  const events = toJournalEvents(outcome.eventInputs, ACTOR);
  const next = { ...bundle, nodes: outcome.nodes, edges: outcome.edges, project: { ...(bundle.project as object), updated_at: new Date().toISOString() } };
  const journalPath = journalPathFor(bundlePath);
  // The first append to a journal-less bundle makes it cross-checked (#357).
  const baseline = ensureJournalBaseline(journalPath, bundle, ACTOR);
  writeFileSync(bundlePath, serializeBundle(next as unknown as Parameters<typeof serializeBundle>[0]));
  if (baseline !== undefined) log(`  ${renderEventLine(baseline)} -> ${journalPath}`);
  for (const event of events) {
    appendJournalEvent(journalPath, event);
    log(`  ${renderEventLine(event)} -> ${journalPath}`);
  }
  return { ok: true };
}

export function runShotCli(argv: string[]): void {
  void runShot(argv).then((result) => {
    if (!result.ok) process.exit(1);
  });
}
```

If `renderEventLine` does not know the two new types, it prints a generic line; extend `packages/cli/src/lib/render-event.ts` with a `case "screenshot.recorded": return \`screenshot ${ev.node_id}@${ev.platform}\`` and `case "screenshot.removed"` only if its switch would otherwise throw on an unknown type.

- [ ] **Step 4: Wire the dispatcher**

In `packages/cli/src/index.ts`: add `import { runShotCli } from "./commands/shot";` after the `live` import; in `USAGE` after the `live` lines add:

```
  shot [options] [id p value]  Record screenshots: --manifest <file> to the hosted door (screenshot:append token), or into the repo bundle.
```

and in the `switch`:

```ts
    case "shot":
      runShotCli(rest);
      return;
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm run build -w arkaik && node tests/cli/shot.test.js`
Expected: all PASS. Then add `&& node tests/cli/shot.test.js` after the live test in `package.json`'s `test:cli` chain and run `npm run test:cli`.

- [ ] **Step 6: Document**

In `docs/spec/toolchain.md`, after the `arkaik live` row:

```markdown
| `arkaik shot [--manifest <file>] [--commit <sha> --order <n>] [--dry-run] [node_id platform value]` | Record screenshots (spec 2026-11-01). Linked repo: post the manifest to `POST …/screenshots` (scope `screenshot:append`), `--commit` and `--order` required, refusals exit 1, skips exit 0. Unlinked repo: dual-write the bundle through `record_screenshot` and append `screenshot.recorded` (ci with `--commit`, manual without). The `record-screenshots` reusable workflow is its caller | 4 |
```

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/commands/shot.ts packages/cli/src/index.ts packages/cli/src/lib/render-event.ts tests/cli/shot.test.js package.json docs/spec/toolchain.md
git commit -m "feat(cli): add arkaik shot for hosted and repo screenshots"
```

---

### Task 6: The reusable workflow and the hosted docs

**Files:**
- Create: `.github/workflows/record-screenshots.yml`
- Modify: `docs/hosted-projects.md` (new subsection after "A token for deployments: `release:append`")

- [ ] **Step 1: The workflow**

```yaml
# Reusable: record a consumer's rendered screenshots in a hosted arkaik
# project (spec 2026-11-01). The caller renders and uploads its images
# wherever it likes, writes a manifest `[{ node_id, platform, url, detail? }]`
# and calls this workflow with its path and the rendered commit. It computes
# the commit's height on the default branch (the door's ordering key, so a
# re-run or a rebase arriving late can never overwrite a newer shot) and runs
# `arkaik shot`. A refused entry is a red job; a skipped one (stale order,
# unchanged) is reported and green.
#
# The caller's repo must be linked (docs/arkaik/arkaik.json, `arkaik link`)
# and hold a screenshot:append token as the ARKAIK_SCREENSHOT_TOKEN secret.
# The manifest is passed as a path inside the calling job's checkout, so the
# caller uploads it as an artifact named by `manifest_artifact` and this
# workflow downloads it.
name: record-screenshots

on:
  workflow_call:
    inputs:
      manifest_artifact:
        description: "Name of the uploaded artifact holding the manifest JSON."
        required: true
        type: string
      manifest_path:
        description: "Path of the manifest inside that artifact."
        required: false
        type: string
        default: "shots.json"
      sha:
        description: "The commit the screenshots were rendered from. Default: the triggering commit."
        required: false
        type: string
        default: ""
    secrets:
      ARKAIK_SCREENSHOT_TOKEN:
        required: true

permissions:
  contents: read

jobs:
  record:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    env:
      SHA: ${{ inputs.sha != '' && inputs.sha || github.sha }}
    steps:
      - name: Check out the rendered repository
        uses: actions/checkout@v4
        with:
          ref: ${{ inputs.sha != '' && inputs.sha || github.sha }}
          fetch-depth: 0
          path: repo
          persist-credentials: false

      - name: Check out arkaik (the CLI is built from main)
        uses: actions/checkout@v4
        with:
          repository: alexisbohns/arkaik
          ref: main
          path: tool
          persist-credentials: false

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: tool/package-lock.json

      - name: Build the arkaik CLI
        working-directory: tool
        run: |
          npm ci --no-audit --no-fund
          npm run build -w arkaik

      - name: Download the manifest
        uses: actions/download-artifact@v4
        with:
          name: ${{ inputs.manifest_artifact }}
          path: manifest

      - name: Record
        working-directory: repo
        env:
          ARKAIK_TOKEN: ${{ secrets.ARKAIK_SCREENSHOT_TOKEN }}
          MANIFEST: ../manifest/${{ inputs.manifest_path }}
        run: |
          set -euo pipefail
          SHA=$(git rev-parse "$SHA")
          # The ordering key: commits reachable from the rendered sha. Monotonic
          # along the default branch, which is all the door's watermark needs.
          ORDER=$(git rev-list --count "$SHA")
          echo "Recording $(jq length "$MANIFEST") screenshot(s) from $SHA (order $ORDER)" >&2
          node ../tool/packages/cli/dist/index.js shot --manifest "$MANIFEST" --commit "$SHA" --order "$ORDER"
```

- [ ] **Step 2: The docs**

In `docs/hosted-projects.md`, after the `release:append` subsection (before `## 2. Get a hosted project`), add:

```markdown
### A token for screenshots: `screenshot:append`

A screenshot is a fact about a commit, and the job that renders it is where it
should be recorded from. `screenshot:append` is the third append-only scope:
one route, `POST …/screenshots`, one kind of write. What it can do: say
*here is a screenshot of this view or acceptance on this platform, from this
commit*. What it cannot: read the graph, move a status, touch a flow or a
data model, or fill a platform the node does not list. A leaked token can
post a picture.

Each entry names the node, the platform, an `https` URL you host, the commit
and its `order` — the commit's height on your default branch
(`git rev-list --count <sha>`). The order is what keeps a re-run or a rebase
that lands late from overwriting a newer shot: an entry below the slot's
watermark is a `stale_order` skip, an unchanged URL an `unchanged` skip, and
both are a 200. A refused entry (`unknown_node`, `not_shot_bearing`,
`platform_not_applicable`, `invalid_url`) refuses the whole batch with a 422
naming its `index`. A shot a person records in the UI always lands and
becomes current; the next CI run after it replaces it, which is the point.

```bash
curl -sS --fail-with-body -X POST "$ARKAIK_URL/api/graph/projects/$PROJECT_ID/screenshots" \
  -H "Authorization: Bearer $ARKAIK_SCREENSHOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"entries":[{"node_id":"V-home","platform":"ios","url":"https://shots.example/'"$SHA"'/ios/V-home.png","commit":"'"$SHA"'","order":412,"detail":"HomeTests.default"}]}'
```

The CLI wraps it — `arkaik shot --manifest shots.json --commit $SHA --order $ORDER` —
and the **`record-screenshots` reusable workflow** does it from a manifest
your render job uploads as an artifact:

```yaml
jobs:
  render:
    # … run your screenshot tests, upload the PNGs to your bucket,
    # write shots.json as [{ node_id, platform, url, detail? }] …
    steps:
      - uses: actions/upload-artifact@v4
        with: { name: shots, path: shots.json }
  record:
    needs: render
    uses: alexisbohns/arkaik/.github/workflows/record-screenshots.yml@main
    with:
      manifest_artifact: shots
    secrets:
      ARKAIK_SCREENSHOT_TOKEN: ${{ secrets.ARKAIK_SCREENSHOT_TOKEN }}
```

Which test feeds which node is your naming convention — a test whose name
carries the `AC-…` or `V-…` id is the simplest — and the bytes stay with you:
arkaik stores URLs, not images.
```

- [ ] **Step 3: Validate the workflow file**

Run: `npx --yes @action-validator/cli .github/workflows/record-screenshots.yml 2>/dev/null || node -e "require('js-yaml').load(require('fs').readFileSync('.github/workflows/record-screenshots.yml','utf8')); console.log('yaml ok')"`
Expected: `yaml ok` (or the validator's success line).

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/record-screenshots.yml docs/hosted-projects.md
git commit -m "feat(ci): add the record-screenshots reusable workflow"
```

---

### Task 7: Staleness, a pure utility

**Files:**
- Create: `lib/utils/screenshot-staleness.ts`
- Create: `tests/app/load-screenshot-staleness.js`, `tests/app/screenshot-staleness.test.js`
- Modify: `package.json` (`"test:screenshot-staleness": "node tests/app/screenshot-staleness.test.js"`), `.github/workflows/ci.yml` (a step after `Screenshot door planner tests`)

- [ ] **Step 1: Loader and failing test**

`tests/app/load-screenshot-staleness.js`: copy `tests/services/load-live.js`, pointing at `lib/utils/screenshot-staleness.ts`, `BUILD_DIR` `.test-build-screenshot-staleness`, export `loadScreenshotStaleness`.

`tests/app/screenshot-staleness.test.js`:

```js
#!/usr/bin/env node

/** `isScreenshotStale` (lib/utils/screenshot-staleness.ts): derived, never stored (spec § 5). */

const { loadScreenshotStaleness } = require("./load-screenshot-staleness");
const { isScreenshotStale } = loadScreenshotStaleness();

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`PASS: ${name}`);
  else { failures++; console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`); }
}

const T0 = "2026-11-01T10:00:00.000Z";
const before = "2026-11-01T09:00:00.000Z";
const after = "2026-11-01T11:00:00.000Z";
const meta = { ts: T0, source: "ci", form: "url" };
const status = (ts, platform) => ({ id: ts, ts, type: "node.status_changed", node_id: "V-home", from: "development", to: "releasing", ...(platform ? { platform } : {}) });
const merged = (ts) => ({ id: ts, ts, type: "ref.status_changed", node_id: "V-home", ref_id: "gh-1", to: "merged", synced_at: ts });

check("no meta: not stale (nothing to be stale about)", isScreenshotStale(undefined, [status(after, "ios")], "V-home", "ios") === false);
check("no later event: not stale", isScreenshotStale(meta, [status(before, "ios")], "V-home", "ios") === false);
check("a later platform status change on this platform: stale", isScreenshotStale(meta, [status(after, "ios")], "V-home", "ios") === true);
check("a later status change on another platform: not stale", isScreenshotStale(meta, [status(after, "web")], "V-home", "ios") === false);
check("a later project-level status change: stale", isScreenshotStale(meta, [status(after)], "V-home", "ios") === true);
check("a later merged ref: stale", isScreenshotStale(meta, [merged(after)], "V-home", "ios") === true);
check("a later event on another node: not stale", isScreenshotStale(meta, [{ ...status(after, "ios"), node_id: "V-other" }], "V-home", "ios") === false);

process.exit(failures > 0 ? 1 : 0);
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/app/screenshot-staleness.test.js`
Expected: ENOENT on the missing module.

- [ ] **Step 3: The utility**

`lib/utils/screenshot-staleness.ts`:

```ts
import type { JournalEvent, PlatformId, PlatformScreenshotMeta } from "@arkaik/schema";

/**
 * Whether a slot's screenshot *may* be stale (spec 2026-11-01 § 5): the node
 * moved on that platform (or project-wide), or a pull request on it merged,
 * after the shot was taken. Derived from the journal on every read and never
 * stored — a derived flag costs nothing to be wrong about and nothing to
 * repair. A shot with no meta (a legacy slot) is never flagged.
 */
export function isScreenshotStale(
  meta: PlatformScreenshotMeta | undefined,
  events: readonly JournalEvent[],
  nodeId: string,
  platform: PlatformId,
): boolean {
  const since = meta?.ts;
  if (!since) return false;
  return events.some((ev) => {
    if (ev.node_id !== nodeId || typeof ev.ts !== "string" || ev.ts <= since) return false;
    if (ev.type === "node.status_changed") return ev.platform === undefined || ev.platform === platform;
    if (ev.type === "ref.status_changed") return ev.to === "merged";
    return false;
  });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node tests/app/screenshot-staleness.test.js`
Expected: all PASS. Register the script and the CI step.

- [ ] **Step 5: Commit**

```bash
git add lib/utils/screenshot-staleness.ts tests/app/load-screenshot-staleness.js tests/app/screenshot-staleness.test.js package.json .github/workflows/ci.yml
git commit -m "feat(app): derive screenshot staleness from the journal"
```

---

### Task 8: The panel writes through the op

**Files:**
- Modify: `components/panels/PlatformVariants.tsx` (props; the Screenshot field)
- Modify: `components/panels/NodeDetailPanel.tsx` (`NodeDetailPanelProps` near line 65; `PlatformVariantsSectionProps` + `PlatformVariantsSection` near lines 430-515; the mount near line 786)
- Modify: `components/panels/ProjectPanels.tsx` (`ProjectPanelsProps` near line 76; destructuring near line 132; the `NodeDetailPanel` mount near line 422)
- Modify: `app/project/[id]/library/page.tsx:498`, `delivery/page.tsx:220`, `decisions/page.tsx:129`, `acceptances/page.tsx:205`, `components/maps/JourneyMap.tsx:711`

The new callback is one prop, `onScreenshot`, carrying the op itself, so the panel never spreads metadata for a screenshot again:

```ts
export type ScreenshotPanelOp =
  | { op: "record_screenshot"; node_id: string; platform: PlatformId; source: "manual"; form: "url" | "data"; value: string }
  | { op: "remove_screenshot"; node_id: string; platform: PlatformId };
```

- [ ] **Step 1: `PlatformVariants.tsx`**

Replace `onScreenshotChange?: (platform: PlatformId, value: string | undefined) => void;` in `PlatformVariantsProps` with:

```ts
  /** Record a shot: the drop zone sends `form: "data"`, the URL field `form: "url"`. */
  onRecordScreenshot?: (platform: PlatformId, form: "url" | "data", value: string) => void;
  onRemoveScreenshot?: (platform: PlatformId) => void;
  /** Provenance of the current shot per platform, for the caption. */
  screenshotMeta?: Partial<Record<PlatformId, { ts?: string; source?: "ci" | "manual"; form?: string }>>;
  /** Per platform: the journal says the node moved after this shot. */
  stale?: Partial<Record<PlatformId, boolean>>;
```

Update the destructuring, then: `handleFile` calls `onRecordScreenshot?.(activeTab, "data", dataUrl)`; the remove button calls `onRemoveScreenshot?.(activeTab)`. Add a URL field state and input above the drop zone, inside the `Screenshot` `Field`, replacing the `{currentScreenshot ? … : …}` block's else-branch with a column that holds both the drop zone and the URL form:

```tsx
        ) : (
          <div className="flex flex-col gap-2">
            <div role="button" … (the existing drop zone, unchanged) …>
              …
            </div>
            <form
              className="flex items-center gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                const value = urlDraft.trim();
                if (!/^https:\/\/\S+$/.test(value)) return;
                onRecordScreenshot?.(activeTab, "url", value);
                setUrlDraft("");
              }}
            >
              <Input
                id={`${fieldId}-shot-url`}
                aria-label={`Screenshot URL${platformSuffix}`}
                value={urlDraft}
                onChange={(e) => setUrlDraft(e.target.value)}
                placeholder="https://…/screenshot.png"
                className="h-8 text-xs"
              />
              <Button type="submit" size="sm" variant="outline" disabled={!/^https:\/\/\S+$/.test(urlDraft.trim())}>
                Record
              </Button>
            </form>
          </div>
        )}
```

with `const [urlDraft, setUrlDraft] = useState("");` beside the other state and `import { Input } from "@/components/ui/input";`. Under the rendered `<img>`, add the caption:

```tsx
            {(screenshotMeta?.[activeTab] || stale?.[activeTab]) && (
              <p className="mt-1 text-[10px] text-muted-foreground">
                {screenshotMeta?.[activeTab]?.source === "ci" ? "From CI" : screenshotMeta?.[activeTab]?.source === "manual" ? "Recorded by hand" : "Legacy shot"}
                {screenshotMeta?.[activeTab]?.ts ? ` · ${new Date(screenshotMeta[activeTab]!.ts!).toLocaleDateString()}` : ""}
                {stale?.[activeTab] ? " · may be stale" : ""}
              </p>
            )}
```

- [ ] **Step 2: `NodeDetailPanel.tsx`**

Add to `NodeDetailPanelProps` (after `onUpdate`):

```ts
  /** Screenshot writes, as the op itself: the panel never patches `platformScreenshots` through `onUpdate`. */
  onScreenshot?: (op: ScreenshotPanelOp) => Promise<void> | void;
```

and define `ScreenshotPanelOp` in `lib/utils/screenshot-ops.ts`, derived from the schema's `MutationOp` (`Extract<MutationOp, { op: "record_screenshot" }> & { source: "manual"; form: "url" | "data" }` | `Extract<MutationOp, { op: "remove_screenshot" }>`) so it cannot drift; import it from there here, in `ProjectPanels`, `PageShell` and `AcceptancePlatformsSection`. Thread `onScreenshot` through the component's destructuring to `PlatformVariantsSection` (`onScreenshot={onScreenshot}` at the mount near line 786). In `PlatformVariantsSectionProps` add `onScreenshot?: (op: ScreenshotPanelOp) => Promise<void> | void;` and in the section:

- delete `handleScreenshotChange` and the `screenshots` state's participation in `handleNotesChange` / `handleStatusChange` patches: both now spread `platformScreenshots: node.metadata?.platformScreenshots` (the stored value, read-only here) instead of the local `screenshots` state, so a note edit still round-trips the slot untouched;
- read `const screenshots = (node.metadata?.platformScreenshots ?? {}) as Partial<Record<PlatformId, string>>;` and `const screenshotMeta = (node.metadata?.platformScreenshotMeta ?? {}) as PlatformScreenshotMetaMap;` straight from the node (no `useState` for them: the op's result comes back through the cache);
- compute staleness:

```ts
  const projectId = useProjectId();
  const { journal } = useJournal(projectId, { types: ["node.status_changed", "ref.status_changed", "deliverable.shipped"] });
  const stale = useMemo(() => {
    const out: Partial<Record<PlatformId, boolean>> = {};
    for (const platform of scope.platforms) out[platform] = isScreenshotStale(screenshotMeta[platform], journal, node.id, platform);
    return out;
  }, [journal, node.id, scope.platforms, screenshotMeta]);
```

- pass to `PlatformVariants`:

```tsx
          screenshots={screenshots}
          screenshotMeta={screenshotMeta}
          stale={stale}
          onRecordScreenshot={onScreenshot ? (platform, form, value) => { void onScreenshot({ op: "record_screenshot", node_id: node.id, platform, source: "manual", form, value }); } : undefined}
          onRemoveScreenshot={onScreenshot ? (platform) => { void onScreenshot({ op: "remove_screenshot", node_id: node.id, platform }); } : undefined}
```

Imports: `useJournal` from `@/lib/hooks/useJournal`, `isScreenshotStale` from `@/lib/utils/screenshot-staleness`, `PlatformScreenshotMetaMap` from `@arkaik/schema`, `useMemo` from react.

- [ ] **Step 3: `ProjectPanels.tsx`**

Add `onScreenshot?: (op: ScreenshotPanelOp) => Promise<void> | void;` to `ProjectPanelsProps` beside `onUpdate`, destructure it, and pass `onScreenshot={onScreenshot}` to `NodeDetailPanel` next to `onZoomShot`. Import the type from `./NodeDetailPanel`.

- [ ] **Step 4: The five surfaces**

In each file that renders `<ProjectPanels … onUpdate={handleNodeUpdate}`, add:

```tsx
        onScreenshot={async (op) => { await applyMutations([op]); }}
```

`applyMutations` is already destructured from `useNodes(id)` in `library`, `delivery`, `acceptances` and `JourneyMap`; in `decisions/page.tsx:37` add it to the destructuring. `op` is a `ScreenshotPanelOp`, which is assignable to `MutationOp` (both variants are members of the union).

- [ ] **Step 5: Build and the panel semantics test**

Run: `npm run lint && npm run build && node tests/app/panel-semantics.test.js`
Expected: green. The semantics test sweeps the panels directory for labelled controls; the URL input carries an `aria-label`, so it passes.

- [ ] **Step 6: Manual check, then commit**

Run `npm run dev`, open a view's panel on a local project, drop an image (the journal's History section shows `screenshot.recorded`), paste an `https://` URL and Record (a second event; the slot swaps), remove it (`screenshot.removed`). Move the view's status on that platform and confirm the caption says "may be stale" on a re-recorded shot taken before the move.

```bash
git add components/panels/PlatformVariants.tsx components/panels/NodeDetailPanel.tsx components/panels/ProjectPanels.tsx app/project components/maps/JourneyMap.tsx
git commit -m "feat(app): record screenshots through the op with a URL field and a staleness caption"
```

---

### Task 9: History strip in the preview dialog

**Files:**
- Modify: `components/panels/ShotPreviewDialog.tsx`

- [ ] **Step 1: Read history, in a child**

Add an `EarlierShots({ node, platform, current })` component at the bottom of the file. It owns the read — `useProjectId()` and `useJournal(projectId, { types: ["screenshot.recorded", "screenshot.removed"] })` — so the journal projection is only read while the dialog is mounted, not by every surface that holds a closed one. Its memo maps the slot's history to `{ id, url, label }`:

```ts
  const earlier = useMemo<EarlierShot[]>(() => {
    const shots: EarlierShot[] = [];
    for (const ev of screenshotHistory(journal, node.id, platform)) {
      if (ev.type !== "screenshot.recorded" || ev.form !== "url") continue;
      const url = ev.url;
      if (typeof url !== "string" || url === current) continue;
      const by = ev.source === "ci" ? "CI" : "By hand";
      const commit = typeof ev.commit === "string" ? ` · ${ev.commit.slice(0, 7)}` : "";
      shots.push({ id: ev.id, url, label: `${by} · ${formatShotDate(ev.ts) ?? "unknown date"}${commit}` });
    }
    return shots.reverse();
  }, [journal, node.id, platform, current]);
```

"Earlier" is keyed on the slot, not on position: every `url`-form recording whose url is not the slot's current value (`current = screenshots[platform]`). Only the `url` form reaches the strip — a path would render as a broken image in the hosted app and a data URI carries no url. `formatShotDate` moves from `PlatformVariants.tsx` to `lib/utils/screenshot-ops.ts` (exported) and both files import it.

Imports: `useProjectId` from `@/lib/hooks/useProjectId`, `useJournal` from `@/lib/hooks/useJournal`, `screenshotHistory` from `@arkaik/schema`, `useMemo` from react.

- [ ] **Step 2: Render the strip**

The child returns `null` when `earlier` is empty; otherwise the strip, newest first. The dialog renders `<EarlierShots node={node} platform={activeTab} current={currentScreenshot} />` in the sidebar after the Platform notes block and before the Gallery indicator:

```tsx
    <div className="flex flex-col gap-1.5">
      <span className={FIELD_LABEL_CLASS}>Earlier shots</span>
      <div className="flex gap-1.5 overflow-x-auto">
        {earlier.map((shot) => (
          <a key={shot.id} href={shot.url} target="_blank" rel="noreferrer" title={shot.label}>
            <img src={shot.url} alt={shot.label} className="h-12 w-auto rounded border border-border object-contain" />
          </a>
        ))}
      </div>
    </div>
```

- [ ] **Step 3: Build, check, commit**

Run: `npm run lint && npm run build`
Expected: green. Open the dialog on a slot you recorded twice in Task 8 and see one earlier thumbnail.

```bash
git add components/panels/ShotPreviewDialog.tsx
git commit -m "feat(app): show earlier screenshots in the preview dialog"
```

---

### Task 10: Full gate and the PR

- [ ] **Step 1: Everything**

Run: `npm run generate && git diff --exit-code -- public/schema docs/arkaik-skill plugin lib/prompts/generated && npm run lint && npm run build && npm run validate:seeds && npm run test:screenshots && npm run test:screenshot-door && npm run test:screenshot-staleness && npm run test:mutate && npm run test:journal && npm run test:live && npm run test:graph-api && npm run test:mcp && npm run test:cli`
Expected: all green. If `generate` moved a file, commit it.

- [ ] **Step 2: Open the PR, stacked on Part 1**

```bash
git push -u origin feat/screenshot-events-writers
gh pr create --base feat/screenshot-events-schema --title "feat: screenshot writers — door, scope, MCP, arkaik shot, workflow, panel (part 2)" --body "$(cat <<'EOF'
Part 2 of the screenshot events spec (docs/superpowers/specs/2026-11-01-screenshot-events-design.md), on top of part 1.

- `/mutations` accepts `record_screenshot` / `remove_screenshot`; new `screenshot:append` scope (settings UI + tokens)
- `POST …/screenshots`: the CI door, `lib/services/graph/screenshots.ts` planner (DB-free, defers to `decideScreenshot`), skips as 200, refusals as 422
- MCP `record_screenshot` / `remove_screenshot`
- `arkaik shot`: hosted (manifest → door) and Kommit (dual-write) modes; `record-screenshots.yml` reusable workflow
- Panel: drop zone and URL field both post the op; "From CI · date · may be stale" caption derived from the journal; earlier shots strip in the preview dialog
- Docs: services, mcp, toolchain, hosted-projects

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review

- **Spec coverage.** § 2 op surfaces: UI (Task 8), MCP (Task 4), CLI (Task 5), door (Tasks 2–3). § 3 door, scope, refusals, skips, https only, `img-src`: Tasks 2–3 (the CSP note is a deployment setting already in place for hosted shots; nothing in the spec asks for a code change). § 4 precedence: Part 1, exercised again by the door tests. § 5 staleness: Task 7 + caption in Task 8. § 6 bytes with the consumer, manifest, workflow, `arkaik shot --manifest`: Tasks 5–6. History strip: Task 9. Legacy `update_node` path still reachable for raw callers but not from `PlatformVariants`: Task 8 removes `handleScreenshotChange`.
- **Placeholders.** The two "if the helper does not exist" notes (route-test token minting, MCP error assertion) name the search string and the fallback; `render-event.ts` is touched only if its switch throws. No TBDs.
- **Type consistency.** `ScreenshotPanelOp` variants match `MutationOp`'s `record_screenshot` (`source: "manual"`, `form`, `value`) and `remove_screenshot`. The door's entry is `{ node_id, platform, url, commit, order, detail? }` in the planner, the route tests, the CLI and the docs. `planScreenshots` returns `{ ok, ops, applied, skipped }` / `{ ok: false, refusals }` and the route reads exactly those. `isScreenshotStale(meta, events, nodeId, platform)` is the signature in Task 7 and the call in Task 8. `screenshotHistory` is Part 1's export.
