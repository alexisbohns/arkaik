# Screenshot events, Part 1: schema, decision and reducer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `@arkaik/schema` the two screenshot events, the two mutation ops with their ingest rule, the per-slot meta, the history reducers and the validator cross-check, so every writer (Part 2) shares one implementation.

**Architecture:** One new zod-free module `packages/schema/src/screenshots.ts` holds the decision function `decideScreenshot` (apply / skip / refuse) and the reducers over journal events. `applyOps` gains `record_screenshot` and `remove_screenshot`, which call the decision, patch `metadata.platformScreenshots` + `metadata.platformScreenshotMeta`, and emit `screenshot.recorded` / `screenshot.removed`. `crossCheckJournal` warns when a slot disagrees with its last event. Nothing in this part touches the app, the store, the MCP server or the CLI.

**Tech Stack:** TypeScript (`packages/schema`, zod 4 for event schemas only), plain Node test scripts under `tests/schema/` loaded through `tests/schema/load-schema.js`, run by `npm run test:<name>` and `.github/workflows/ci.yml`.

**Spec:** `docs/superpowers/specs/2026-11-01-screenshot-events-design.md`.

**Branch:** `feat/screenshot-events-schema` from `main`. All commits on it; the PR is Part 1 of a two-PR stack.

**House rules to keep:** `journal.ts` and the new `screenshots.ts` are zod-free (type-only imports), because `validate.ts` is bundled into the standalone validator. Tests assert by identity (`find`, `every`), never by count. Every test file ends with `process.exit(failures > 0 ? 1 : 0)` and prints `PASS:`/`FAIL:` lines like `tests/schema/mutate.test.js`.

---

## File map

| File | Responsibility |
|---|---|
| `packages/schema/src/journal.ts` (modify) | The two event interfaces, `SCREENSHOT_SOURCES`, `SCREENSHOT_FORMS`, `JOURNAL_EVENT_TYPES`, `KnownJournalEvent`, `NODE_REF_FIELDS`, the `screenshot-untracked` cross-check |
| `packages/schema/src/journal-events.ts` (modify) | zod schemas for the two events, registered in `JOURNAL_EVENT_SCHEMAS` and `KnownJournalEventSchema` |
| `packages/schema/src/bundle.ts` (modify) | `PlatformScreenshotMeta`, `PlatformScreenshotMetaMap`, `NodeMetadata.platformScreenshotMeta` + zod |
| `packages/schema/src/screenshots.ts` (create) | `isValidScreenshotValue`, `decideScreenshot`, `screenshotHistory`, `currentScreenshot` |
| `packages/schema/src/mutate.ts` (modify) | The two ops in `MutationOp`, three new `MutationErrorCode`s, the two `applyOps` cases |
| `packages/schema/src/index.ts` (modify) | `export * from "./screenshots"` |
| `tests/schema/screenshots.test.js` (create) | Every rule above |
| `package.json`, `.github/workflows/ci.yml` (modify) | `test:screenshots` script and step |
| `docs/spec/journal.md`, `docs/spec/bundle-format.md`, `docs/arkaik-skill/skill.md` (modify) | Vocabulary rows, meta paragraph, "which events to append" rows |
| generated: `docs/arkaik-skill/references/schema.md`, `plugin/**`, `public/schema/project-bundle.json`, `lib/prompts/generated/**` | refreshed by `npm run generate`, committed |

---

### Task 1: Event types and zod schemas

**Files:**
- Modify: `packages/schema/src/journal.ts` (the `JOURNAL_EVENT_TYPES` array at line ~27, the interfaces after `RefStatusChangedEvent`, the `KnownJournalEvent` union, `NODE_REF_FIELDS` at line ~429)
- Modify: `packages/schema/src/journal-events.ts` (after `RefStatusChangedEventSchema`, then `JOURNAL_EVENT_SCHEMAS` and `KnownJournalEventSchema`)
- Test: `tests/schema/screenshots.test.js`

- [ ] **Step 1: Write the failing test file**

Create `tests/schema/screenshots.test.js`:

```js
#!/usr/bin/env node

/**
 * Screenshots as events (docs/superpowers/specs/2026-11-01-screenshot-events-design.md):
 * the two event types, the decision function every writer shares, the two
 * applyOps cases, the history reducers and the cross-check warning.
 *
 * Pure functions over plain objects — no store, no filesystem. Assertions
 * are by identity, never by count.
 */

const { loadSchema } = require("./load-schema");

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`PASS: ${name}`);
  else { failures++; console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`); }
}

const schema = loadSchema();
const { makeEvent, JOURNAL_EVENT_TYPES } = schema;

// --- Task 1: event vocabulary -------------------------------------------------

check("screenshot.recorded is in the known vocabulary", JOURNAL_EVENT_TYPES.includes("screenshot.recorded"));
check("screenshot.removed is in the known vocabulary", JOURNAL_EVENT_TYPES.includes("screenshot.removed"));

{
  const ev = makeEvent("screenshot.recorded", {
    node_id: "V-home", platform: "ios", source: "ci", form: "url",
    url: "https://shots.example/abc.png", commit: "deadbeef", order: 412, detail: "HomeTest.default",
  }, { actor: "arkaik-ci", ts: "2026-11-01T10:00:00.000Z" });
  check("a full ci screenshot.recorded validates", ev.type === "screenshot.recorded" && ev.order === 412 && ev.actor === "arkaik-ci", JSON.stringify(ev));
}
{
  const ev = makeEvent("screenshot.recorded", { node_id: "V-home", platform: "web", source: "manual", form: "data" });
  check("a manual data-form event validates with no url", ev.form === "data" && ev.url === undefined, JSON.stringify(ev));
}
{
  let threw = false;
  try { makeEvent("screenshot.recorded", { node_id: "V-home", platform: "web", source: "robot", form: "url", url: "https://x/y.png" }); } catch { threw = true; }
  check("an unknown source is refused by the event schema", threw);
}
{
  let threw = false;
  try { makeEvent("screenshot.recorded", { node_id: "V-home", platform: "web", source: "ci", form: "url", url: "https://x/y.png", order: 1.5 }); } catch { threw = true; }
  check("a non-integer order is refused by the event schema", threw);
}
{
  const ev = makeEvent("screenshot.removed", { node_id: "V-home", platform: "android" });
  check("screenshot.removed validates", ev.type === "screenshot.removed" && ev.platform === "android");
}

process.exit(failures > 0 ? 1 : 0);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tests/schema/screenshots.test.js`
Expected: `FAIL: screenshot.recorded is in the known vocabulary` and the `makeEvent` checks pass through the lenient envelope (they will tighten once the schema exists). Exit code 1.

- [ ] **Step 3: Add the types to `journal.ts`**

In `JOURNAL_EVENT_TYPES`, after `"ref.status_changed",` add:

```ts
  "screenshot.recorded",
  "screenshot.removed",
```

After the `RefStatusChangedEvent` interface add:

```ts
/** Who recorded a screenshot: a CI job, or a person in the UI / over MCP. */
export const SCREENSHOT_SOURCES = ["ci", "manual"] as const;
export type ScreenshotSource = (typeof SCREENSHOT_SOURCES)[number];

/** The asset form of the slot value (docs/spec/bundle-format.md § Asset Values). */
export const SCREENSHOT_FORMS = ["url", "path", "data"] as const;
export type ScreenshotForm = (typeof SCREENSHOT_FORMS)[number];

/**
 * A screenshot of `node_id` on `platform` exists. `url` is present for the
 * `url` and `path` forms and absent for `data`: events never embed asset
 * payloads (§ Event Envelope), so a data-URI shot is recorded as "a manual
 * shot was taken" and the bytes live in the snapshot only. `commit` is the
 * sha the shot was taken from and `order` its height on the default branch,
 * both CI only; `detail` is free text (the test name, the device).
 */
export interface ScreenshotRecordedEvent extends JournalEvent {
  type: "screenshot.recorded";
  node_id: string;
  platform: PlatformId;
  source: ScreenshotSource;
  form: ScreenshotForm;
  url?: string;
  commit?: string;
  order?: number;
  detail?: string;
}

/** The slot was cleared on purpose. Removed shots stay in history. */
export interface ScreenshotRemovedEvent extends JournalEvent {
  type: "screenshot.removed";
  node_id: string;
  platform: PlatformId;
}
```

In the `KnownJournalEvent` union, after `| RefStatusChangedEvent` add:

```ts
  | ScreenshotRecordedEvent
  | ScreenshotRemovedEvent
```

In `NODE_REF_FIELDS`, after `"request.filed": ["node_id"],` add:

```ts
  "screenshot.recorded": ["node_id"],
  "screenshot.removed": ["node_id"],
```

- [ ] **Step 4: Add the zod schemas to `journal-events.ts`**

After `RefStatusChangedEventSchema` add:

```ts
export const ScreenshotRecordedEventSchema = z
  .object({
    ...envelope,
    type: z.literal("screenshot.recorded"),
    node_id: z.string(),
    platform: z.enum(PLATFORM_IDS),
    source: z.enum(["ci", "manual"]),
    form: z.enum(["url", "path", "data"]),
    url: z.string().optional(),
    commit: z.string().optional(),
    order: z.number().int().nonnegative().optional(),
    detail: z.string().optional(),
  })
  .catchall(z.unknown());

export const ScreenshotRemovedEventSchema = z
  .object({ ...envelope, type: z.literal("screenshot.removed"), node_id: z.string(), platform: z.enum(PLATFORM_IDS) })
  .catchall(z.unknown());
```

Check the file's imports: `PLATFORM_IDS` comes from `./ids`. If the file does not import it yet, add `import { PLATFORM_IDS } from "./ids";` next to the existing id imports (look at how `NodeStatusChangedEventSchema` validates `platform` and reuse the same expression if one exists).

Register both in `JOURNAL_EVENT_SCHEMAS` (after `"ref.status_changed": RefStatusChangedEventSchema,`):

```ts
  "screenshot.recorded": ScreenshotRecordedEventSchema,
  "screenshot.removed": ScreenshotRemovedEventSchema,
```

and in `KnownJournalEventSchema`'s union after `RefStatusChangedEventSchema,`:

```ts
  ScreenshotRecordedEventSchema,
  ScreenshotRemovedEventSchema,
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node tests/schema/screenshots.test.js`
Expected: every line `PASS`, exit 0.

- [ ] **Step 6: Run the existing journal suites**

Run: `npm run test:journal && npm run test:emit`
Expected: all PASS (the vocabulary grew, nothing else moved).

- [ ] **Step 7: Commit**

```bash
git add packages/schema/src/journal.ts packages/schema/src/journal-events.ts tests/schema/screenshots.test.js
git commit -m "feat(schema): add screenshot.recorded and screenshot.removed events"
```

---

### Task 2: Slot meta on `NodeMetadata`

**Files:**
- Modify: `packages/schema/src/bundle.ts` (after `PlatformScreenshotsMapSchema` at line ~52; `NodeMetadata` at line ~110; `NodeMetadataSchema` at line ~140)
- Test: `tests/schema/screenshots.test.js`

- [ ] **Step 1: Add the failing test**

Append before `process.exit`:

```js
// --- Task 2: platformScreenshotMeta parses -------------------------------------

{
  const { NodeMetadataSchema } = schema;
  const parsed = NodeMetadataSchema.safeParse({
    platformScreenshots: { ios: "https://shots.example/a.png" },
    platformScreenshotMeta: { ios: { ts: "2026-11-01T10:00:00.000Z", source: "ci", form: "url", commit: "deadbeef", order: 3, ci_order: 3 } },
  });
  check("platformScreenshotMeta parses", parsed.success, JSON.stringify(parsed.error?.issues));
  const bare = NodeMetadataSchema.safeParse({ platformScreenshotMeta: { web: { ci_order: 9 } } });
  check("a watermark-only meta entry parses (slot removed, watermark kept)", bare.success, JSON.stringify(bare.error?.issues));
  const bad = NodeMetadataSchema.safeParse({ platformScreenshotMeta: { web: { ts: "x", source: "bot", form: "url" } } });
  check("an unknown meta source is refused", !bad.success);
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/schema/screenshots.test.js`
Expected: `FAIL: platformScreenshotMeta parses` (unknown key is stripped or refused depending on the object's strictness; either way the watermark check or the refusal check fails). Exit 1.

- [ ] **Step 3: Add the types and schema to `bundle.ts`**

After `PlatformScreenshotsMapSchema` add:

```ts
/**
 * Provenance of the current shot in `platformScreenshots[platform]`, written
 * only by the `record_screenshot` / `remove_screenshot` ops (mutate.ts). Every
 * field is optional because a removed slot keeps `ci_order`, the ingest
 * watermark: the highest CI `order` ever accepted for this slot. It survives a
 * manual shot and a removal, so a late CI re-run of an older commit can never
 * overwrite a shot a person recorded after it (spec § 4).
 */
export interface PlatformScreenshotMeta {
  ts?: string;
  source?: "ci" | "manual";
  form?: "url" | "path" | "data";
  commit?: string;
  order?: number;
  ci_order?: number;
}
export const PlatformScreenshotMetaSchema: z.ZodType<PlatformScreenshotMeta> = z
  .object({
    ts: z.string().optional(),
    source: z.enum(["ci", "manual"]).optional(),
    form: z.enum(["url", "path", "data"]).optional(),
    commit: z.string().optional(),
    order: z.number().int().nonnegative().optional(),
    ci_order: z.number().int().nonnegative().optional(),
  })
  .meta({ id: "PlatformScreenshotMeta", description: "Provenance of the current per-platform screenshot and the CI order watermark." });

export type PlatformScreenshotMetaMap = Partial<Record<PlatformId, PlatformScreenshotMeta>>;
export const PlatformScreenshotMetaMapSchema: z.ZodType<PlatformScreenshotMetaMap> = z
  .partialRecord(PlatformSchema, PlatformScreenshotMetaSchema)
  .meta({ id: "PlatformScreenshotMetaMap", description: "Per-platform screenshot provenance (see PlatformScreenshotMeta)." });
```

In `NodeMetadata`, after `platformScreenshots?: PlatformScreenshotsMap;` add:

```ts
  /** Provenance of each current screenshot plus the CI order watermark; written by the screenshot ops only. */
  platformScreenshotMeta?: PlatformScreenshotMetaMap;
```

In `NodeMetadataSchema`, after the `platformScreenshots:` line add:

```ts
    platformScreenshotMeta: PlatformScreenshotMetaMapSchema.optional(),
```

- [ ] **Step 4: Run to verify it passes**

Run: `node tests/schema/screenshots.test.js`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/schema/src/bundle.ts tests/schema/screenshots.test.js
git commit -m "feat(schema): add platformScreenshotMeta with the ci_order watermark"
```

---

### Task 3: The decision function and value validation

**Files:**
- Create: `packages/schema/src/screenshots.ts`
- Modify: `packages/schema/src/index.ts` (add `export * from "./screenshots";` next to `export * from "./mutate";`)
- Test: `tests/schema/screenshots.test.js`

- [ ] **Step 1: Add the failing tests**

Append before `process.exit`:

```js
// --- Task 3: decideScreenshot --------------------------------------------------

const { decideScreenshot, isValidScreenshotValue } = schema;

function view(id, extra = {}) {
  return { id, project_id: "p", species: "view", title: id, status: "live", platforms: ["web", "ios"], ...extra };
}
const ci = (over = {}) => ({ node_id: "V-home", platform: "ios", source: "ci", form: "url", value: "https://s/a.png", commit: "c1", order: 10, ...over });
const manual = (over = {}) => ({ node_id: "V-home", platform: "ios", source: "manual", form: "url", value: "https://s/m.png", ...over });

check("https is a valid url form", isValidScreenshotValue("url", "https://s/a.png"));
check("http is not a valid url form", !isValidScreenshotValue("url", "http://s/a.png"));
check("a relative path is a valid path form", isValidScreenshotValue("path", "assets/web/home.png"));
check("a leading slash is not a valid path form", !isValidScreenshotValue("path", "/assets/home.png"));
check("a scheme is not a valid path form", !isValidScreenshotValue("path", "https://s/a.png"));
check("an image data uri is a valid data form", isValidScreenshotValue("data", "data:image/png;base64,AAAA"));
check("a non-image data uri is not a valid data form", !isValidScreenshotValue("data", "data:text/plain;base64,AAAA"));

{
  const d = decideScreenshot(undefined, ci());
  check("an unknown node refuses node_not_found", d.kind === "refuse" && d.code === "node_not_found", JSON.stringify(d));
}
{
  const d = decideScreenshot(view("DM-x", { species: "data-model" }), ci({ node_id: "DM-x" }));
  check("a data model refuses not_shot_bearing", d.kind === "refuse" && d.code === "not_shot_bearing", JSON.stringify(d));
}
{
  const d = decideScreenshot(view("V-home"), ci({ platform: "android" }));
  check("a platform the node does not list refuses platform_not_applicable", d.kind === "refuse" && d.code === "platform_not_applicable", JSON.stringify(d));
}
{
  const d = decideScreenshot(view("V-home"), ci({ value: "http://s/a.png" }));
  check("an http url refuses invalid_screenshot", d.kind === "refuse" && d.code === "invalid_screenshot", JSON.stringify(d));
}
{
  const d = decideScreenshot(view("V-home"), ci({ order: undefined }));
  check("a ci shot without order refuses invalid_screenshot", d.kind === "refuse" && d.code === "invalid_screenshot", JSON.stringify(d));
}
{
  const d = decideScreenshot(view("V-home"), manual({ form: "data", value: "data:image/png;base64,AAAA" }));
  check("a manual data shot on a fresh slot applies", d.kind === "apply", JSON.stringify(d));
}
{
  const node = view("V-home", { metadata: { platformScreenshots: { ios: "https://s/a.png" }, platformScreenshotMeta: { ios: { source: "ci", form: "url", order: 10, ci_order: 10 } } } });
  const d = decideScreenshot(node, ci({ order: 9, value: "https://s/old.png" }));
  check("a ci shot below the watermark skips stale_order", d.kind === "skip" && d.reason === "stale_order", JSON.stringify(d));
  const same = decideScreenshot(node, ci({ order: 11 }));
  check("the same value again skips unchanged", same.kind === "skip" && same.reason === "unchanged", JSON.stringify(same));
  const equal = decideScreenshot(node, ci({ order: 10, value: "https://s/b.png" }));
  check("a ci shot at the watermark applies (equal order is a re-run of the same height)", equal.kind === "apply", JSON.stringify(equal));
  const person = decideScreenshot(node, manual());
  check("a manual shot always applies over a ci one", person.kind === "apply", JSON.stringify(person));
}
{
  const afterManual = view("V-home", { metadata: { platformScreenshots: { ios: "https://s/m.png" }, platformScreenshotMeta: { ios: { source: "manual", form: "url", ci_order: 10 } } } });
  const late = decideScreenshot(afterManual, ci({ order: 9 }));
  check("a late ci re-run below the watermark cannot overwrite a manual shot", late.kind === "skip" && late.reason === "stale_order", JSON.stringify(late));
  const fresh = decideScreenshot(afterManual, ci({ order: 12 }));
  check("a newer ci shot replaces a manual one", fresh.kind === "apply", JSON.stringify(fresh));
}
{
  const removed = view("V-home", { metadata: { platformScreenshotMeta: { ios: { ci_order: 10 } } } });
  const d = decideScreenshot(removed, ci({ order: 9 }));
  check("the watermark survives a removal", d.kind === "skip" && d.reason === "stale_order", JSON.stringify(d));
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/schema/screenshots.test.js`
Expected: `TypeError: decideScreenshot is not a function` (the module does not exist). Exit 1.

- [ ] **Step 3: Create `packages/schema/src/screenshots.ts`**

```ts
/**
 * Screenshots as events (docs/superpowers/specs/2026-11-01-screenshot-events-design.md).
 *
 * The one decision every writer shares. `applyOps` (mutate.ts) calls
 * {@link decideScreenshot} to apply, skip or refuse a `record_screenshot` op;
 * the hosted door's planner (lib/services/graph/screenshots.ts) calls the
 * same function over a read snapshot to report skips and refusals to its
 * caller before the ops run. Two callers, one rule — the reason this is not
 * inlined in either.
 *
 * Deliberately **zod-free** (type-only imports): `journal.ts` reaches the
 * reducers below for the cross-check, and `validate.ts` bundles that into the
 * standalone validator.
 *
 * ## The ingest rule (spec § 4)
 * - a `manual` shot is always accepted and becomes current;
 * - a `ci` shot is accepted only if its `order` is at least the slot's
 *   `ci_order` watermark — a re-run or a rebase arriving late is a
 *   `stale_order` skip, never a late overwrite;
 * - the same value again is an `unchanged` skip, so a re-run writes nothing.
 */

import type { Node } from "./bundle";
import type { PlatformId } from "./ids";
import type { JournalEvent, ScreenshotForm, ScreenshotSource } from "./journal";
import { orderEvents } from "./journal";

/** The caller-supplied shape of a `record_screenshot` op, before any node is consulted. */
export interface ScreenshotInput {
  node_id: string;
  platform: PlatformId;
  source: ScreenshotSource;
  form: ScreenshotForm;
  /** The slot value: an `https://` URL, a relative path, or an image data URI — per `form`. */
  value: string;
  commit?: string;
  order?: number;
  detail?: string;
}

export type ScreenshotRefusalCode = "node_not_found" | "not_shot_bearing" | "platform_not_applicable" | "invalid_screenshot";
export type ScreenshotSkipReason = "stale_order" | "unchanged";

export type ScreenshotDecision =
  | { kind: "apply" }
  | { kind: "skip"; reason: ScreenshotSkipReason }
  | { kind: "refuse"; code: ScreenshotRefusalCode; message: string };

/** Species that carry screenshots: a view is what people see, an acceptance is one of its render variants. */
export const SHOT_BEARING_SPECIES: readonly string[] = ["view", "acceptance"];

const HTTPS = /^https:\/\/\S+$/;
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const IMAGE_DATA_URI = /^data:image\//;

/** Whether `value` is a well-formed slot value for `form` (docs/spec/bundle-format.md § Asset Values). */
export function isValidScreenshotValue(form: ScreenshotForm, value: string): boolean {
  if (value === "" || /[\u0000-\u001f\u007f]/.test(value)) return false;
  switch (form) {
    case "url":
      return HTTPS.test(value);
    case "path":
      return !value.startsWith("/") && !HAS_SCHEME.test(value);
    case "data":
      return IMAGE_DATA_URI.test(value);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The slot's current value and meta, read loosely so a hand-edited bundle cannot throw here. */
function readSlot(node: Node, platform: PlatformId): { value: string | undefined; ciOrder: number | undefined } {
  const md = isRecord(node.metadata) ? node.metadata : {};
  const shots = isRecord(md.platformScreenshots) ? md.platformScreenshots : {};
  const metas = isRecord(md.platformScreenshotMeta) ? md.platformScreenshotMeta : {};
  const meta = isRecord(metas[platform]) ? metas[platform] : {};
  const value = typeof shots[platform] === "string" ? (shots[platform] as string) : undefined;
  const ciOrder = typeof meta.ci_order === "number" ? (meta.ci_order as number) : undefined;
  return { value, ciOrder };
}

/**
 * Decide one `record_screenshot` against the node it names. `node` is
 * `undefined` when the id matched nothing. Pure; never throws.
 */
export function decideScreenshot(node: Node | undefined, input: ScreenshotInput): ScreenshotDecision {
  if (!node) return { kind: "refuse", code: "node_not_found", message: `Node ${input.node_id} not found` };
  if (!SHOT_BEARING_SPECIES.includes(node.species)) {
    return { kind: "refuse", code: "not_shot_bearing", message: `${node.id} is a ${node.species}; only views and acceptances carry screenshots` };
  }
  if (!node.platforms.includes(input.platform)) {
    return {
      kind: "refuse",
      code: "platform_not_applicable",
      message: node.platforms.length > 0 ? `${node.id} lists: ${node.platforms.join(", ")}` : `${node.id} lists no platforms`,
    };
  }
  if (!isValidScreenshotValue(input.form, input.value)) {
    return { kind: "refuse", code: "invalid_screenshot", message: `value is not a well-formed ${input.form} screenshot` };
  }
  if (input.source === "ci" && (typeof input.order !== "number" || !Number.isInteger(input.order) || input.order < 0)) {
    return { kind: "refuse", code: "invalid_screenshot", message: "a ci screenshot needs a non-negative integer order" };
  }
  const slot = readSlot(node, input.platform);
  if (input.source === "ci" && slot.ciOrder !== undefined && (input.order as number) < slot.ciOrder) {
    return { kind: "skip", reason: "stale_order" };
  }
  if (slot.value === input.value) return { kind: "skip", reason: "unchanged" };
  return { kind: "apply" };
}

// ---------------------------------------------------------------------------
// History reducers
// ---------------------------------------------------------------------------

/** Every `screenshot.*` event for one slot, in `(ts, id)` order. */
export function screenshotHistory(events: readonly JournalEvent[], nodeId: string, platform: PlatformId): JournalEvent[] {
  return orderEvents(
    events.filter(
      (ev) => (ev.type === "screenshot.recorded" || ev.type === "screenshot.removed") && ev.node_id === nodeId && ev.platform === platform,
    ),
  );
}

/**
 * The event that explains the slot's current value: the last
 * `screenshot.recorded` unless a `screenshot.removed` came after it, in which
 * case `null`. `undefined` when the journal says nothing about the slot (a
 * legacy shot written through `update_node`, or no shot at all).
 */
export function currentScreenshot(events: readonly JournalEvent[], nodeId: string, platform: PlatformId): JournalEvent | null | undefined {
  const history = screenshotHistory(events, nodeId, platform);
  if (history.length === 0) return undefined;
  const last = history[history.length - 1];
  return last.type === "screenshot.removed" ? null : last;
}
```

- [ ] **Step 4: Export it from `packages/schema/src/index.ts`**

After `export * from "./mutate";` add `export * from "./screenshots";`.

- [ ] **Step 5: Run to verify it passes**

Run: `node tests/schema/screenshots.test.js`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/schema/src/screenshots.ts packages/schema/src/index.ts tests/schema/screenshots.test.js
git commit -m "feat(schema): add the shared screenshot decision and history reducers"
```

---

### Task 4: The two ops in `applyOps`

**Files:**
- Modify: `packages/schema/src/mutate.ts` (`MutationOp` at line ~38, `MutationErrorCode` at line ~46, the `switch` in `applyOps` before its closing brace)
- Test: `tests/schema/screenshots.test.js`

- [ ] **Step 1: Add the failing tests**

Append before `process.exit`:

```js
// --- Task 4: applyOps record_screenshot / remove_screenshot --------------------

const { applyOps, MutationError } = schema;
const graph = (nodes) => ({ projectId: "p", nodes, edges: [] });
const TS = "2026-11-01T10:00:00.000Z";

{
  const out = applyOps(graph([view("V-home")]), [{ op: "record_screenshot", ...ci(), ts: TS }]);
  const node = out.nodes.find((n) => n.id === "V-home");
  check("record_screenshot writes the slot", node.metadata.platformScreenshots.ios === "https://s/a.png", JSON.stringify(node.metadata));
  const meta = node.metadata.platformScreenshotMeta.ios;
  check("record_screenshot writes the meta and the watermark", meta.ts === TS && meta.source === "ci" && meta.form === "url" && meta.commit === "c1" && meta.order === 10 && meta.ci_order === 10, JSON.stringify(meta));
  const ev = out.eventInputs.find((e) => e.type === "screenshot.recorded");
  check("record_screenshot emits screenshot.recorded with the url", ev && ev.payload.node_id === "V-home" && ev.payload.platform === "ios" && ev.payload.url === "https://s/a.png" && ev.payload.order === 10 && ev.payload.source === "ci", JSON.stringify(ev));
  check("no node.updated is emitted for the slot path", !out.eventInputs.some((e) => e.type === "node.updated"));
}
{
  const out = applyOps(graph([view("V-home")]), [{ op: "record_screenshot", ...manual({ form: "data", value: "data:image/png;base64,AAAA" }), ts: TS }]);
  const ev = out.eventInputs.find((e) => e.type === "screenshot.recorded");
  check("a data-form shot emits no url", ev && ev.payload.form === "data" && !("url" in ev.payload), JSON.stringify(ev));
  check("a data-form shot still fills the slot", out.nodes[0].metadata.platformScreenshots.ios.startsWith("data:image/png"));
}
{
  const seeded = view("V-home", { metadata: { platformScreenshots: { ios: "https://s/a.png" }, platformScreenshotMeta: { ios: { source: "ci", form: "url", order: 10, ci_order: 10 } } } });
  const out = applyOps(graph([seeded]), [{ op: "record_screenshot", ...ci({ order: 9, value: "https://s/old.png" }) }]);
  check("a stale_order shot is a no-op: no event", out.eventInputs.length === 0, JSON.stringify(out.eventInputs));
  check("a stale_order shot is a no-op: slot untouched", out.nodes[0].metadata.platformScreenshots.ios === "https://s/a.png");
  const same = applyOps(graph([seeded]), [{ op: "record_screenshot", ...ci({ order: 11 }) }]);
  check("an unchanged shot is a no-op", same.eventInputs.length === 0);
  const person = applyOps(graph([seeded]), [{ op: "record_screenshot", ...manual(), ts: TS }]);
  const meta = person.nodes[0].metadata.platformScreenshotMeta.ios;
  check("a manual shot over a ci one keeps the watermark", meta.source === "manual" && meta.ci_order === 10 && meta.order === undefined, JSON.stringify(meta));
  const newer = applyOps(graph([person.nodes[0]]), [{ op: "record_screenshot", ...ci({ order: 12, value: "https://s/c.png" }), ts: TS }]);
  check("a newer ci shot raises the watermark", newer.nodes[0].metadata.platformScreenshotMeta.ios.ci_order === 12);
}
{
  const seeded = view("V-home", { metadata: { platformScreenshots: { ios: "https://s/a.png", web: "https://s/w.png" }, platformScreenshotMeta: { ios: { source: "ci", form: "url", order: 10, ci_order: 10 } }, platformNotes: { ios: "keep me" } } });
  const out = applyOps(graph([seeded]), [{ op: "remove_screenshot", node_id: "V-home", platform: "ios" }]);
  const md = out.nodes[0].metadata;
  check("remove_screenshot clears the slot", md.platformScreenshots.ios === undefined && md.platformScreenshots.web === "https://s/w.png", JSON.stringify(md));
  check("remove_screenshot keeps only the watermark in the meta", JSON.stringify(md.platformScreenshotMeta.ios) === JSON.stringify({ ci_order: 10 }), JSON.stringify(md.platformScreenshotMeta));
  check("remove_screenshot leaves sibling metadata alone", md.platformNotes.ios === "keep me");
  check("remove_screenshot emits screenshot.removed", out.eventInputs.some((e) => e.type === "screenshot.removed" && e.payload.platform === "ios"));
  const again = applyOps(graph([out.nodes[0]]), [{ op: "remove_screenshot", node_id: "V-home", platform: "ios" }]);
  check("removing an empty slot is a no-op", again.eventInputs.length === 0);
}
{
  let err;
  try { applyOps(graph([view("V-home")]), [{ op: "record_screenshot", ...ci({ platform: "android" }) }]); } catch (e) { err = e; }
  check("a refusal throws a MutationError with the decision's code", err instanceof MutationError && err.code === "platform_not_applicable" && err.subjectId === "V-home", String(err));
  let missing;
  try { applyOps(graph([]), [{ op: "remove_screenshot", node_id: "V-nope", platform: "web" }]); } catch (e) { missing = e; }
  check("remove_screenshot on an unknown node throws node_not_found", missing instanceof MutationError && missing.code === "node_not_found");
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/schema/screenshots.test.js`
Expected: the Task 4 block fails (`record_screenshot writes the slot` and following; `applyOps` ignores an unknown op). Exit 1.

- [ ] **Step 3: Extend `mutate.ts`**

Add to the imports at the top of the file:

```ts
import { decideScreenshot, type ScreenshotInput } from "./screenshots";
import type { PlatformId } from "./ids";
```

Extend `MutationOp`:

```ts
export type MutationOp =
  | { op: "create_node"; node: Node }
  | { op: "update_node"; node_id: string; patch: NodePatch }
  | { op: "delete_node"; node_id: string }
  | { op: "delete_nodes"; node_ids: readonly string[] }
  | { op: "create_edge"; edge: Edge }
  | { op: "delete_edge"; edge_id: string }
  /**
   * Record a screenshot for one platform slot (spec § 2). Applies, skips or
   * refuses per `decideScreenshot`; a skip derives no event and changes
   * nothing, like a no-op `update_node`. `ts` is the meta timestamp, for
   * deterministic tests; it defaults to now.
   */
  | ({ op: "record_screenshot"; ts?: string } & ScreenshotInput)
  | { op: "remove_screenshot"; node_id: string; platform: PlatformId };
```

Extend `MutationErrorCode`:

```ts
export type MutationErrorCode =
  | "node_not_found"
  | "edge_not_found"
  | "duplicate_node"
  | "edge_type_conflict"
  | "playlist_cycle"
  | "not_shot_bearing"
  | "platform_not_applicable"
  | "invalid_screenshot";
```

In `applyOps`, add two cases before the closing brace of the `switch`:

```ts
      case "record_screenshot": {
        const index = nodes.findIndex((candidate) => candidate.id === op.node_id);
        const current = index === -1 ? undefined : nodes[index];
        const decision = decideScreenshot(current, op);
        if (decision.kind === "refuse") throw new MutationError(decision.code, decision.message, op.node_id);
        // A skip is a no-op by design: nothing changes, nothing is evented, so
        // a CI re-run or an unchanged value never costs a journal line.
        if (decision.kind === "skip") break;
        const node = current as Node;
        const md = isRecord(node.metadata) ? node.metadata : {};
        const metas = isRecord(md.platformScreenshotMeta) ? md.platformScreenshotMeta : {};
        const prevMeta = isRecord(metas[op.platform]) ? (metas[op.platform] as Record<string, unknown>) : {};
        const prevWatermark = typeof prevMeta.ci_order === "number" ? (prevMeta.ci_order as number) : undefined;
        const watermark =
          op.source === "ci" ? Math.max(prevWatermark ?? -1, op.order as number) : prevWatermark;
        const meta = {
          ts: op.ts ?? new Date().toISOString(),
          source: op.source,
          form: op.form,
          ...(op.commit !== undefined ? { commit: op.commit } : {}),
          ...(op.source === "ci" ? { order: op.order } : {}),
          ...(watermark !== undefined ? { ci_order: watermark } : {}),
        };
        const updated: Node = {
          ...node,
          metadata: {
            ...md,
            platformScreenshots: { ...(isRecord(md.platformScreenshots) ? md.platformScreenshots : {}), [op.platform]: op.value },
            platformScreenshotMeta: { ...metas, [op.platform]: meta },
          },
        };
        const nextNodes = [...nodes];
        nextNodes[index] = updated;
        nodes = nextNodes;
        eventInputs.push({
          type: "screenshot.recorded",
          payload: {
            node_id: op.node_id,
            platform: op.platform,
            source: op.source,
            form: op.form,
            // Events never embed asset payloads: a data URI stays in the snapshot.
            ...(op.form !== "data" ? { url: op.value } : {}),
            ...(op.commit !== undefined ? { commit: op.commit } : {}),
            ...(op.source === "ci" ? { order: op.order } : {}),
            ...(op.detail !== undefined ? { detail: op.detail } : {}),
          },
        });
        break;
      }

      case "remove_screenshot": {
        const index = nodes.findIndex((candidate) => candidate.id === op.node_id);
        if (index === -1) {
          throw new MutationError("node_not_found", `Node ${op.node_id} not found`, op.node_id);
        }
        const node = nodes[index];
        const md = isRecord(node.metadata) ? node.metadata : {};
        const shots = isRecord(md.platformScreenshots) ? { ...md.platformScreenshots } : {};
        if (!(op.platform in shots)) break; // nothing to clear, nothing to event
        delete shots[op.platform];
        const metas = isRecord(md.platformScreenshotMeta) ? { ...md.platformScreenshotMeta } : {};
        const prevMeta = isRecord(metas[op.platform]) ? (metas[op.platform] as Record<string, unknown>) : {};
        // The slot is gone; the watermark is not — it is what keeps a late CI
        // re-run from resurrecting the shot a person just removed.
        if (typeof prevMeta.ci_order === "number") metas[op.platform] = { ci_order: prevMeta.ci_order };
        else delete metas[op.platform];
        const updated: Node = {
          ...node,
          metadata: { ...md, platformScreenshots: shots, platformScreenshotMeta: metas },
        };
        const nextNodes = [...nodes];
        nextNodes[index] = updated;
        nodes = nextNodes;
        eventInputs.push({ type: "screenshot.removed", payload: { node_id: op.node_id, platform: op.platform } });
        break;
      }
```

Add the `isRecord` helper next to the other module-level helpers in `mutate.ts` (it exists in `derive.ts` but is not exported; a four-line copy is cheaper than widening that module's surface):

```ts
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node tests/schema/screenshots.test.js`
Expected: all PASS.

- [ ] **Step 5: Run the mutation suites and the typecheck**

Run: `npm run test:mutate && npm run test:emit-events && npx tsc --noEmit -p packages/schema 2>&1 | head` (if the package has no tsconfig, run the repo's `npx tsc --noEmit` instead)
Expected: all PASS, no type errors. If `lib/data/local-provider.ts` or `packages/mcp` switch over `op.op` exhaustively, the compiler names them: those are Part 2's files and only need the new cases to be tolerated, so add a `default: break;` there only if the build is red.

- [ ] **Step 6: Commit**

```bash
git add packages/schema/src/mutate.ts tests/schema/screenshots.test.js
git commit -m "feat(schema): add record_screenshot and remove_screenshot ops"
```

---

### Task 5: The cross-check warning

**Files:**
- Modify: `packages/schema/src/journal.ts` (`crossCheckJournal`, after the decision-status block and before `return findings;`)
- Test: `tests/schema/screenshots.test.js`

- [ ] **Step 1: Add the failing tests**

Append before `process.exit`:

```js
// --- Task 5: crossCheckJournal screenshot-untracked ----------------------------

const { crossCheckJournal, currentScreenshot, screenshotHistory } = schema;
const created = { id: "01A", ts: "2026-01-01T00:00:00.000Z", type: "node.created", node_id: "V-home", species: "view", title: "Home" };
const recorded = (id, ts, over = {}) => ({ id, ts, type: "screenshot.recorded", node_id: "V-home", platform: "ios", source: "ci", form: "url", url: "https://s/a.png", order: 1, ...over });
const removed = (id, ts) => ({ id, ts, type: "screenshot.removed", node_id: "V-home", platform: "ios" });
const bundle = (metadata, journal) => ({ project: { id: "p" }, nodes: [{ ...view("V-home"), metadata }], edges: [], journal });
const untracked = (findings) => findings.find((f) => f.rule === "screenshot-untracked");

check("slot equals last event: no diagnostic", untracked(crossCheckJournal(bundle({ platformScreenshots: { ios: "https://s/a.png" } }, [created, recorded("01B", "2026-01-02T00:00:00.000Z")]))) === undefined);
{
  const f = untracked(crossCheckJournal(bundle({ platformScreenshots: { ios: "https://s/other.png" } }, [created, recorded("01B", "2026-01-02T00:00:00.000Z")])));
  check("slot differs from last event: a warning naming both", f && f.severity === "warning" && /other\.png/.test(f.message) && /a\.png/.test(f.message), JSON.stringify(f));
}
{
  const f = untracked(crossCheckJournal(bundle({ platformScreenshots: { ios: "https://s/a.png" } }, [created, recorded("01B", "2026-01-02T00:00:00.000Z"), removed("01C", "2026-01-03T00:00:00.000Z")])));
  check("slot present after a removal: a warning", f && f.severity === "warning", JSON.stringify(f));
}
check("slot with no event: no diagnostic (legacy)", untracked(crossCheckJournal(bundle({ platformScreenshots: { ios: "https://s/legacy.png" } }, [created]))) === undefined);
check("a data-form event with a filled slot: no diagnostic", untracked(crossCheckJournal(bundle({ platformScreenshots: { ios: "data:image/png;base64,AAAA" } }, [created, recorded("01B", "2026-01-02T00:00:00.000Z", { form: "data", url: undefined })]))) === undefined);
{
  const f = untracked(crossCheckJournal(bundle({}, [created, recorded("01B", "2026-01-02T00:00:00.000Z", { form: "data", url: undefined })])));
  check("a data-form event with an empty slot: a warning", f && f.severity === "warning", JSON.stringify(f));
}
{
  const events = [created, recorded("01B", "2026-01-02T00:00:00.000Z"), removed("01C", "2026-01-03T00:00:00.000Z"), recorded("01D", "2026-01-04T00:00:00.000Z", { url: "https://s/b.png" })];
  const history = screenshotHistory(events, "V-home", "ios");
  check("screenshotHistory keeps every screenshot event in order", history.map((e) => e.id).join(",") === "01B,01C,01D", JSON.stringify(history.map((e) => e.id)));
  check("currentScreenshot is the last recorded", currentScreenshot(events, "V-home", "ios").id === "01D");
  check("currentScreenshot is null after a removal", currentScreenshot(events.slice(0, 3), "V-home", "ios") === null);
  check("currentScreenshot is undefined with no history", currentScreenshot([created], "V-home", "ios") === undefined);
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/schema/screenshots.test.js`
Expected: `FAIL: slot differs from last event: a warning naming both` and the two other warning checks. Exit 1.

- [ ] **Step 3: Add the check to `crossCheckJournal`**

Add the import at the top of `journal.ts` (type-only module, no cycle: `screenshots.ts` imports only `orderEvents` from here, which is a value import of a function — to avoid a circular value import, move nothing; TypeScript/CommonJS tolerate this cycle because `orderEvents` is only called at run time, after both modules load. If the test loader reports `orderEvents is not a function`, move `orderEvents` into a new `packages/schema/src/order.ts` and re-export it from `journal.ts`):

```ts
import { currentScreenshot } from "./screenshots";
```

Before `return findings;` in `crossCheckJournal`, add:

```ts
  // --- Screenshot slots vs their events (spec § 2, warning only) ---
  // A slot written through the legacy update_node path has no event and gets
  // no diagnostic; a slot with history must agree with its last event.
  for (const n of nodesRaw) {
    const nodeId = str(n?.id);
    if (nodeId === undefined) continue;
    const metadata = isRecordLoose(n.metadata) ? n.metadata : {};
    const shots = isRecordLoose(metadata.platformScreenshots) ? metadata.platformScreenshots : {};
    const platforms = new Set<string>(Object.keys(shots));
    for (const { ev } of valid) {
      if ((ev.type === "screenshot.recorded" || ev.type === "screenshot.removed") && ev.node_id === nodeId && typeof ev.platform === "string") {
        platforms.add(ev.platform);
      }
    }
    for (const platform of platforms) {
      const last = currentScreenshot(ordered, nodeId, platform as PlatformId);
      if (last === undefined) continue; // legacy slot, no history
      const slot = typeof shots[platform] === "string" ? (shots[platform] as string) : undefined;
      let expected: string | undefined;
      let agrees: boolean;
      if (last === null) {
        agrees = slot === undefined;
        expected = undefined;
      } else if (last.form === "data") {
        agrees = slot !== undefined;
        expected = "(a data URI)";
      } else {
        expected = str(last.url);
        agrees = slot === expected;
      }
      if (!agrees) {
        findings.push({
          path: `nodes[${nodesRaw.indexOf(n)}].metadata.platformScreenshots.${platform}`,
          rule: "screenshot-untracked",
          message: `Node "${nodeId}": platformScreenshots.${platform} is ${slot === undefined ? "empty" : `"${slot}"`} but the journal's last screenshot event says ${expected === undefined ? "it was removed" : `"${expected}"`} — write screenshots through record_screenshot, not update_node.`,
          severity: "warning",
        });
      }
    }
  }
```

Add this helper next to `statusesAgree` (the file is zod-free, so no shared helper exists yet):

```ts
function isRecordLoose(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
```

`PlatformId` is already imported as a type in `journal.ts`; `ordered` and `valid` are the arrays the function builds above.

- [ ] **Step 4: Run to verify it passes**

Run: `node tests/schema/screenshots.test.js && npm run test:journal`
Expected: all PASS in both.

- [ ] **Step 5: Register the suite and run the standalone validator build**

In `package.json` scripts, after `"test:mutate": …` add:

```json
    "test:screenshots": "node tests/schema/screenshots.test.js",
```

In `.github/workflows/ci.yml`, after the `Mutation core tests` step add:

```yaml
      - name: Screenshot events tests (decision, ops, reducers, cross-check)
        run: npm run test:screenshots
```

Run: `npm run generate && npm run validate:seeds`
Expected: the generator rebuilds `docs/arkaik-skill/scripts/validate-bundle.js` (it bundles `validate.ts` + `journal.ts` + now `screenshots.ts`) and `references/schema.md`; every seed validates with exit 0. If the bundler complains about `screenshots.ts` importing zod, it does not: the module is type-only except for `orderEvents`.

- [ ] **Step 6: Commit**

```bash
git add packages/schema/src/journal.ts tests/schema/screenshots.test.js package.json .github/workflows/ci.yml docs/arkaik-skill plugin public/schema lib/prompts/generated
git commit -m "feat(schema): warn when a screenshot slot disagrees with its last event"
```

---

### Task 6: Documentation

**Files:**
- Modify: `docs/spec/journal.md` (vocabulary table after the `ref.status_changed` row; § Authority & Consistency Model rule 3)
- Modify: `docs/spec/bundle-format.md` (§ Asset Values, after the size-bomb paragraph)
- Modify: `docs/arkaik-skill/skill.md` (§ Which events to append table; § 2 Decide what to change table)

- [ ] **Step 1: `docs/spec/journal.md`**

After the `ref.status_changed` row add:

```markdown
| `screenshot.recorded` | `node_id`, `platform`, `source` (`ci` \| `manual`), `form` (`url` \| `path` \| `data`), `url?`, `commit?`, `order?`, `detail?` | A screenshot of this node on this platform exists (spec 2026-11-01). `url` is present for the `url` and `path` forms and absent for `data` — events never embed asset payloads, so a data-URI shot is recorded as "a manual shot was taken" and the bytes live in the snapshot only. `commit` is the sha the shot was taken from and `order` its height on the default branch, both CI only. The current slot is the projection: `metadata.platformScreenshots[platform]` plus `metadata.platformScreenshotMeta[platform]`, written only by the `record_screenshot` op, whose ingest rule (a manual shot always lands; a CI shot lands only at or above the slot's `ci_order` watermark; the latest accepted by `(ts, id)` is current) is decided once in `@arkaik/schema`'s `decideScreenshot` |
| `screenshot.removed` | `node_id`, `platform` | The slot was cleared on purpose. The `ci_order` watermark survives, so a late CI re-run cannot resurrect the shot |
```

In rule 3 of § Authority & Consistency Model, after the sentence about decisions, add:

```markdown
Screenshots are cross-checked as a **warning**, not an error: for a slot with at least one `screenshot.*` event, `platformScreenshots[platform]` must equal the last `screenshot.recorded.url` (be non-empty for a `data` form, be empty after a `screenshot.removed`). A slot with no event is the legacy `update_node` path and is not diagnosed.
```

- [ ] **Step 2: `docs/spec/bundle-format.md`**

After the size-bomb paragraph in § Asset Values add:

```markdown
**Provenance.** `metadata.platformScreenshotMeta[platform]` records how the current slot value got there — `ts`, `source` (`ci` | `manual`), `form`, `commit?`, `order?` — and `ci_order`, the highest CI `order` ever accepted for the slot, which survives a manual shot and a removal (a slot that was removed keeps `{ ci_order }` alone). It is written only by the `record_screenshot` / `remove_screenshot` mutation ops; a producer that patches `platformScreenshots` through `update_node` leaves it stale, and `validateBundle()` warns `screenshot-untracked` when the slot disagrees with the journal.
```

- [ ] **Step 3: `docs/arkaik-skill/skill.md`**

In § Which events to append, after the `ref.added / ref.removed` row add:

```markdown
| Record a screenshot for one platform | `screenshot.recorded` (`node_id`, `platform`, `source`, `form`, `url?`, `commit?`, `order?`) — through the `record_screenshot` tool/op, never by patching `metadata.platformScreenshots` |
| Clear a screenshot | `screenshot.removed` (`node_id`, `platform`) — through `remove_screenshot` |
```

In § 2 Decide what to change, after the "Ship/add user-visible behavior" row add:

```markdown
| A screenshot of a view or acceptance on a platform | `record_screenshot` (`node_id`, `platform`, `source: manual`, `form`, `value`) — writes the slot, its meta and the event in one op | `screenshot.recorded` |
```

Then run `npm run generate` so `plugin/skills/arkaik/SKILL.md` and `references/schema.md` follow, and `git diff --stat` to confirm only generated files moved beyond the three docs.

- [ ] **Step 4: Full gate**

Run: `npm run lint && npm run build && npm run validate:seeds && npm run test:schema && npm run test:journal && npm run test:mutate && npm run test:screenshots && npm run test:emit-events && npm run test:journal-projections`
Expected: everything green. `npm run build` compiles the app against the new `MutationOp` union; if `lib/data/local-provider.ts` or `packages/mcp/src` fail on an exhaustive switch, add `default: break;` there (Part 2 fills them in).

- [ ] **Step 5: Commit and open the PR**

```bash
git add docs/spec/journal.md docs/spec/bundle-format.md docs/arkaik-skill plugin public/schema lib/prompts/generated
git commit -m "docs: record the screenshot events, meta and skill rows"
git push -u origin feat/screenshot-events-schema
gh pr create --title "feat(schema): screenshots as journal events (part 1: schema, decision, reducer)" --body "$(cat <<'EOF'
Part 1 of the screenshot events spec (docs/superpowers/specs/2026-11-01-screenshot-events-design.md).

- `screenshot.recorded` / `screenshot.removed` events, zod schemas and `NODE_REF_FIELDS`
- `metadata.platformScreenshotMeta` with the `ci_order` ingest watermark
- `packages/schema/src/screenshots.ts`: `decideScreenshot` (the one rule every writer shares), `screenshotHistory`, `currentScreenshot`
- `record_screenshot` / `remove_screenshot` ops in `applyOps`; a skip is a no-op, a refusal is a `MutationError`
- `crossCheckJournal` warning `screenshot-untracked`
- `tests/schema/screenshots.test.js` + CI step; spec docs and skill rows

Part 2 (store, door, MCP, CLI, workflow, UI) follows on this branch.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review

- **Spec coverage.** § 1 events: Task 1. Meta and watermark: Task 2. Decision rule (§ 4) and value forms: Task 3. Ops (§ 2 "one narrow op"), no `node.updated` for the slot, data form without url: Task 4. Validator warning (§ 2, § Format and projection): Task 5. History reducers for the panel strip: Task 3 + Task 5 tests. Docs: Task 6. The door, scope, MCP tool, CLI verb, workflow, UI and staleness chip are Part 2 by design.
- **Placeholders.** None: every step carries its code; the two "if the build is red" notes name the exact file and the exact fix.
- **Type consistency.** `ScreenshotInput.value` is the op's slot value everywhere (not `url`); the event payload maps `value` → `url` only for non-`data` forms. `decideScreenshot(node | undefined, input)` is the signature in Task 3 and the call in Task 4. `currentScreenshot` returns `JournalEvent | null | undefined` and Task 5 branches on all three. `PlatformScreenshotMeta` fields are all optional, which is what lets `remove_screenshot` keep `{ ci_order }` alone.
