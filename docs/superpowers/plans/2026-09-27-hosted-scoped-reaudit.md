# Hosted scoped re-audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A hosted project whose audit arrived by `arkaik restore` gets a real baseline (#472). A hosted session can then run the whole scoped re-audit loop with no files written: `kritik_scope` → `kritik_score scope=true` → `kritik_matrix record=true` (#473).

**Architecture:** A pure schema helper builds the missing `quality.audit.completed` on read from the stored section, dated where the audit was taken. The hosted events route learns two new whitelisted entries: `quality.assessment.scored`, folded latest-wins per cell like finding decisions, and a scoped `quality.audit.completed` whose scores the server computes. The first hosted score writes the baseline for real. The MCP hosted branches post those entries instead of refusing.

**Tech Stack:** TypeScript (Next.js app, `packages/schema`, `packages/mcp`, `packages/cli`), zod, plain-node test scripts (`check(name, cond, detail)` style) loaded through the repo's `tests/**/load-*.js` transpile loaders.

**Spec:** `docs/superpowers/specs/2026-09-27-hosted-scoped-reaudit-design.md`. Read it first.

---

## Ground rules for every task (read before starting)

- **Tests are plain node scripts**, not jest. Each file defines `check(name, cond, detail)`, counts failures, and ends with `process.exit(failures ? 1 : 0)` (copy the exact tail of the file you're extending). Schema suites load TypeScript through `tests/schema/load-schema.js` (`const { loadSchema } = require("./load-schema"); const {...} = loadSchema();`). It compiles every file in `packages/schema/src`, so a new schema module needs no loader change, **but it must be exported from `packages/schema/src/index.ts`**.
- **Never `require()` a `.ts` file directly from a test.** CI runs Node 20 (this machine runs Node 26). Use a loader.
- **Loader rewrite tables are hand-maintained.** When a file under `lib/` gains a new `@/…` import, grep `tests/` for every `load-*.js` that compiles that file (`grep -rln "<file basename>" tests/`) and add both the rewrite and the matching compile/`write` line to each. Then run every suite that uses those loaders, not just the obvious one.
- **Assert by identity, never by count** (`ids.join() === "a,b"`, not `length === 2`). Assert preconditions first so a no-op implementation can't pass vacuously.
- **After any edit under `packages/schema/src/`**, run `npm run generate` and commit what it changes. CI diffs the generated artifacts.
- **Before each commit:** `npx tsc --noEmit -p .` (root) and `npx eslint <changed files>` must be clean. Errors in files you didn't touch are pre-existing, but main lints clean, so treat any lint error as yours.
- Commit messages end with a blank line then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Match the surrounding comment density and voice. These modules carry long "why" docblocks; new exports get one too, written the same way. No ticket-speak in user-facing strings.

## Branches (one part = one branch = one PR, stacked)

| Part | Branch | Base | Tasks |
|---|---|---|---|
| 1 | `kritik-hosted-1-implicit-baseline` (exists; the spec is already committed on it) | `main` | 1–5 |
| 2 | `kritik-hosted-2-write-path` | part 1 | 6–11 |
| 3 | `kritik-hosted-3-mcp` | part 2 | 12–16 |

Create part 2's branch from part 1's tip when part 1's tasks are done (`git checkout -b kritik-hosted-2-write-path`), and the same for part 3. The controller handles `gh stack` and the PRs.

## File map

| File | Part | Responsibility |
|---|---|---|
| `packages/schema/src/quality-baseline.ts` (new) | 1 | `implicitAuditBaseline`, `withImplicitBaseline`, `baselineEventPayload` |
| `packages/schema/src/journal-events.ts` | 1, 2 | `baseline` on audit.completed; new `quality.assessment.scored` schema |
| `packages/schema/src/quality-trend.ts` | 1 | `baseline`/`scope` on `AuditSnapshot` and `TrendRow` |
| `packages/schema/src/quality-scope.ts` | 2 | pure `scopedAuditId` (shared by repo and hosted) |
| `packages/schema/src/quality-ops.ts` | 2 | `assessmentScoredInput` |
| `packages/schema/src/cli/kritik-audit.ts` | 2 | `scopedAuditTarget` delegates to `scopedAuditId` |
| `packages/mcp/src/kritik-tools.ts` | 1, 3 | hosted wiring |
| `packages/mcp/src/store.ts`, `remote-store.ts` | 3 | widened `appendQualityEvents` input + refusal text |
| `packages/cli/src/commands/kritik.ts` | 1 | trend table marks baseline / scoped rows |
| `lib/hooks/useQualityData.ts` | 1 | app trend over `withImplicitBaseline` |
| `lib/utils/quality.ts` | 2 | `foldFindingEvents` → `foldQualityEvents` (+ assessment fold) |
| `lib/services/graph/quality-events.ts` | 2 | parse + plan the two new entries, baseline write |
| `lib/services/graph/store.ts` | 2 | fold-type list, validator count, typed event query |
| `app/api/graph/projects/[projectId]/route.ts`, `…/quality/events/route.ts`, `lib/data/local-provider.ts` | 2 | callers |

---

# Part 1 — the implicit baseline (#472)

### Task 1: `quality-baseline.ts`, the synthesized reading

**Files:**
- Create: `packages/schema/src/quality-baseline.ts`
- Modify: `packages/schema/src/index.ts` (add `export * from "./quality-baseline";` after the `quality-scope` line)
- Modify: `packages/schema/src/journal-events.ts` (`QualityAuditCompletedEventSchema`: add `baseline: z.boolean().optional(),` after `scope`, with a one-line comment: `// A reading synthesized from a stored audit that arrived without one (issue #472).`)
- Create: `tests/schema/quality-baseline.test.js`
- Modify: `package.json` (script `"test:quality-baseline": "node tests/schema/quality-baseline.test.js"` next to `test:quality-scope`)
- Modify: `.github/workflows/ci.yml` (a step running `npm run test:quality-baseline`, copied from the `test:quality-scope` step at ~line 149)

**Behaviour (from the spec):**
- `implicitAuditBaseline(events, section, library?)` returns a `JournalEvent` or `null`.
  - `null` if any event has `type === "quality.audit.completed"`, or if the section has no assessment with a non-empty string `audit_id`.
  - `audit_id` is the lexically greatest assessment `audit_id`.
  - **`ts`:** let `firstDecision` be the first `quality.finding.resolved`/`quality.finding.accepted` in `orderEvents` order. Let `assessedAt` be the newest parseable `ts` among the assessments of that audit, normalized with `new Date(x).toISOString()`.
    - A decision with a parseable ts: `justBefore = new Date(Date.parse(ts) - 1).toISOString()`, and `ts = assessedAt` when `assessedAt` exists and parses earlier than `justBefore`, else `justBefore`.
    - A decision whose ts doesn't parse: `ts = EPOCH` (`"1970-01-01T00:00:00.000Z"`), which puts no resolution out of the window.
    - No decision: `ts = assessedAt ?? EPOCH`.
  - **Scores:** copy the section's findings, and set every finding named by any decision event back to `status: "open"`, deleting `resolved_by`. By construction every decision is ordered after the baseline, so each one post-dates the reading. Then run `deriveQualityMatrix({ quality: { ...section, findings } }, library)`.
  - Event: `{ id: "implicit-baseline:<audit_id>", ts, type: "quality.audit.completed", ...auditCompletedInput(matrix, { audit_id, framework_version }).payload, baseline: true }`, where `framework_version = matrix.framework_version ?? section.framework_version ?? library?.version ?? "unknown"`. There's no `actor`, since nobody recorded it.
  - Build the object directly and don't call `makeEvent`: this module stays zod-free like its siblings.
- `withImplicitBaseline(events, section, library?)`: `baseline ? [baseline, ...events] : events` (returns the input array untouched when there's no baseline).
- `baselineEventPayload(event)`: the event minus `id`, `ts`, `type` and `actor`. Part 2 uses it to write the baseline for real.
- Lenient and total, like `quality-scope.ts`: non-array `events`, a null section and malformed rows never throw.

- [ ] **Step 1: Write the failing test** `tests/schema/quality-baseline.test.js`:

```js
#!/usr/bin/env node

/**
 * The implicit baseline (issue #472): a hosted project whose audit arrived by
 * `arkaik restore` has assessments but no recorded reading, so the scope and
 * the trend had nothing to measure from. Pure and DB-free.
 *
 * The pack's severity scale is the schema default, so the cap assertions below
 * test the status revert, not arithmetic: an open impact-5 x likelihood-5
 * finding is Critical and caps its cell; resolved, it doesn't.
 */

const { loadSchema } = require("./load-schema");
const {
  implicitAuditBaseline,
  withImplicitBaseline,
  baselineEventPayload,
  deriveAuditScope,
  deriveQualityMatrix,
  deriveQualityTrend,
  recordedAuditIds,
} = loadSchema();

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`PASS: ${name}`);
  else { failures++; console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`); }
}

const LIBRARY = {
  version: "1.4.0",
  domains: [{ code: "SEC", name: "Security" }],
  criteria: [
    { id: "SEC-01", domain: "SEC", applies_to: ["web"] },
    { id: "SEC-02", domain: "SEC", applies_to: ["web"] },
  ],
};
const assess = (criterion, level, audit, ts) => ({ criterion_id: criterion, surface: "web", level, evidence: "e", audit_id: audit, ...(ts ? { ts } : {}) });
const finding = (id, criterion, over = {}) => ({
  id, criterion_id: criterion, surface: "web", title: id, detail: "d", evidence: "e", impact: 5, likelihood: 5, cost: "S", status: "open", ...over,
});
const SECTION = {
  profile: { surfaces: [{ id: "web", title: "Web" }] },
  assessments: [
    assess("SEC-01", 3, "2026-07", "2026-07-03T00:00:00.000Z"),
    assess("SEC-01", 3, "2026-08", "2026-08-04T10:00:00.000Z"),
    assess("SEC-02", 3, "2026-08", "2026-08-05T10:00:00.000Z"),
  ],
  // F-1 is resolved in the folded read, but a hosted resolution below decided it.
  findings: [finding("F-1", "SEC-01", { status: "resolved", resolved_by: "https://pr/1" }), finding("F-2", "SEC-02", { impact: 1, likelihood: 1 })],
};
const resolved = (id, findingId, ts) => ({ id, ts, type: "quality.finding.resolved", finding_id: findingId, actor: "github-app" });
const JOURNAL = [
  { id: "01OPEN", ts: "2026-08-04T09:00:00.000Z", type: "quality.finding.opened", finding_id: "F-1", criterion_id: "SEC-01", surface: "web", severity: "critical", priority: "P0", title: "F-1" },
  resolved("01RES2", "F-1", "2026-08-20T00:00:00.000Z"),
  { id: "01NODE", ts: "2026-08-10T00:00:00.000Z", type: "node.created", node_id: "V-x" },
];

// --- when --------------------------------------------------------------------

check("no assessments → no baseline", implicitAuditBaseline(JOURNAL, { ...SECTION, assessments: [] }, LIBRARY) === null);
check(
  "a recorded audit anywhere → no baseline",
  implicitAuditBaseline([...JOURNAL, { id: "01A", ts: "2026-08-06T00:00:00.000Z", type: "quality.audit.completed", audit_id: "2026-07", framework_version: "1.4.0" }], SECTION, LIBRARY) === null,
);
check("garbage in never throws", implicitAuditBaseline(null, null, undefined) === null && implicitAuditBaseline([null, 3], { assessments: "x" }) === null);

const baseline = implicitAuditBaseline(JOURNAL, SECTION, LIBRARY);
check("a restored, unrecorded audit gets a baseline", baseline !== null, JSON.stringify(baseline));

// --- which and when ------------------------------------------------------------

check("it reads the newest stored audit", baseline.audit_id === "2026-08", baseline.audit_id);
check("it is dated when that audit was taken (its newest assessment)", baseline.ts === "2026-08-05T10:00:00.000Z", baseline.ts);
check("it is flagged baseline, has a stable id and no actor", baseline.baseline === true && baseline.id === "implicit-baseline:2026-08" && !("actor" in baseline));
check("framework_version falls back to the pack's", baseline.framework_version === "1.4.0", baseline.framework_version);

const late = implicitAuditBaseline([resolved("01EARLY", "F-1", "2026-08-05T00:00:00.000Z")], SECTION, LIBRARY);
check(
  "an assessment newer than the first decision is capped to 1 ms before it — no resolution falls out of the window",
  late.ts === "2026-08-04T23:59:59.999Z",
  late.ts,
);
const noTs = implicitAuditBaseline(JOURNAL, { ...SECTION, assessments: SECTION.assessments.map(({ ts, ...rest }) => rest) }, LIBRARY);
check("no assessment ts → 1 ms before the first decision", noTs.ts === "2026-08-19T23:59:59.999Z", noTs.ts);
const nothing = implicitAuditBaseline([], { ...SECTION, assessments: SECTION.assessments.map(({ ts, ...rest }) => rest) }, LIBRARY);
check("no ts and no decision → the epoch", nothing.ts === "1970-01-01T00:00:00.000Z", nothing.ts);
const badTs = implicitAuditBaseline([resolved("01BAD", "F-1", "not a date")], SECTION, LIBRARY);
check("an unparsable decision ts → the epoch, never after the decision", badTs.ts === "1970-01-01T00:00:00.000Z", badTs.ts);

// --- the scores are the audit's, not today's -----------------------------------

const live = deriveQualityMatrix({ quality: SECTION }, LIBRARY).matrix.SEC.web;
check("precondition: the live matrix has F-1 resolved, so the cell is uncapped", live.capped === false, JSON.stringify(live));
const atAudit = deriveQualityMatrix(
  { quality: { ...SECTION, findings: SECTION.findings.map((f) => (f.id === "F-1" ? { ...f, status: "open" } : f)) } },
  LIBRARY,
).matrix.SEC.web;
check("precondition: with F-1 open the cell is capped", atAudit.capped === true, JSON.stringify(atAudit));
check(
  "the baseline scores the cell as it stood at the audit — F-1 open, capped",
  baseline.scores.web.SEC === atAudit.score && baseline.counts.critical === 1,
  JSON.stringify({ scores: baseline.scores, counts: baseline.counts }),
);
check("the input section is not mutated", SECTION.findings[0].status === "resolved" && SECTION.findings[0].resolved_by === "https://pr/1");

// --- what it unlocks -------------------------------------------------------------

const augmented = withImplicitBaseline(JOURNAL, SECTION, LIBRARY);
check("withImplicitBaseline prepends it", augmented[0] === undefined ? false : augmented[0].id === "implicit-baseline:2026-08" && augmented.length === JOURNAL.length + 1);
check("withImplicitBaseline hands back the same array when there is none", withImplicitBaseline(JOURNAL, { ...SECTION, assessments: [] }, LIBRARY) === JOURNAL);
check("the baseline counts as recorded", recordedAuditIds(augmented).join() === "2026-08");

const scope = deriveAuditScope(augmented, SECTION, LIBRARY);
check(
  "the scope measures from it and lists the resolved finding's cell",
  scope.since === "2026-08" && scope.cells.map((c) => `${c.criterion_id}:${c.kind}`).join() === "SEC-01:direct" && scope.findings.join() === "F-1",
  JSON.stringify(scope),
);
check("without it, the scope was empty (the bug)", deriveAuditScope(JOURNAL, SECTION, LIBRARY).since === null);

const trend = deriveQualityTrend(augmented, SECTION.profile);
check("the trend's first row is the baseline", trend.snapshots.length === 1 && trend.snapshots[0].audit_id === "2026-08" && trend.snapshots[0].baseline === true, JSON.stringify(trend.snapshots));

const payload = baselineEventPayload(baseline);
check(
  "baselineEventPayload strips the envelope and keeps the reading",
  !("id" in payload) && !("ts" in payload) && !("type" in payload) && payload.audit_id === "2026-08" && payload.baseline === true && payload.scores.web.SEC === baseline.scores.web.SEC,
  JSON.stringify(payload),
);

console.log(`\n${failures === 0 ? "All" : failures} ${failures === 0 ? "checks passed" : "check(s) failed"}`);
process.exit(failures ? 1 : 0);
```

(The `trend.snapshots[0].baseline` check fails until Task 2. Keep it: Task 2 turns it green.)

- [ ] **Step 2: Run it and confirm it fails**

Run: `node tests/schema/quality-baseline.test.js`
Expected: FAIL, `implicitAuditBaseline is not a function`.

- [ ] **Step 3: Implement** `packages/schema/src/quality-baseline.ts`:

```ts
/**
 * The reading a restored audit never got (issue #472).
 *
 * `kritik_scope` and `kritik_trend` both measure from `quality.audit.completed`.
 * A hosted project whose audit arrived through `arkaik restore` has the audit —
 * its assessments and findings sit in `snapshot.quality` — but no recorded
 * reading of it, so the scope is always empty and the trend has no first row.
 *
 * Recording one now would be the trap the issue names: the scope counts only
 * resolutions ordered after its `since` recording, so a baseline dated today
 * drops every fix since the audit out of the window. This synthesizes the
 * reading instead, **dated where the audit was taken** — its newest assessment,
 * and never later than 1 ms before the first finding decision — and scored the
 * way the audit scored it: every finding a decision event names is read as
 * open again, because every decision is ordered after the reading, and the
 * anti-averaging caps must see the defects the audit saw.
 *
 * Nothing is written here. The hosted write path (issue #473) writes this same
 * event for real the first time a hosted score would otherwise overwrite the
 * levels it is computed from.
 *
 * Same disciplines as `quality-scope.ts` and `quality-trend.ts`: zod-free and
 * fs-free, nothing mutates its input, and malformed input is no baseline
 * rather than a throw.
 */

import { orderEvents, type JournalEvent } from "./journal";
import { deriveQualityMatrix, type KritikLibrary, type QualityAssessment, type QualityFinding, type QualitySection } from "./quality";
import { auditCompletedInput } from "./quality-ops";

const EPOCH = "1970-01-01T00:00:00.000Z";
const DECISIONS = new Set(["quality.finding.resolved", "quality.finding.accepted"]);

const rowsOf = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);
const isString = (value: unknown): value is string => typeof value === "string" && value !== "";
const isEvent = (value: unknown): value is JournalEvent => typeof value === "object" && value !== null && !Array.isArray(value);

/** `x` as a canonical ISO string, or `undefined` when it does not parse. */
function isoOf(value: unknown): string | undefined {
  if (!isString(value)) return undefined;
  const at = Date.parse(value);
  return Number.isFinite(at) ? new Date(at).toISOString() : undefined;
}

type BaselineSection = Pick<QualitySection, "assessments" | "findings"> & Partial<Pick<QualitySection, "profile" | "framework_version" | "library">>;

export function implicitAuditBaseline(
  events: readonly JournalEvent[] | null | undefined,
  section: BaselineSection | null | undefined,
  library?: KritikLibrary,
): JournalEvent | null {
  const rows = rowsOf<unknown>(events).filter(isEvent);
  if (rows.some((event) => event.type === "quality.audit.completed")) return null;

  const assessments = rowsOf<QualityAssessment>(section?.assessments).filter((row) => isString(row?.audit_id));
  if (assessments.length === 0) return null;
  const auditId = assessments.map((row) => row.audit_id as string).sort().at(-1) as string;

  // When: the audit's own newest score, capped to just before the first
  // decision — whichever is earlier — so the window keeps every fix.
  const ordered = orderEvents(rows);
  const firstDecision = ordered.find((event) => DECISIONS.has(event.type));
  const assessedAt = assessments
    .filter((row) => row.audit_id === auditId)
    .map((row) => isoOf(row.ts))
    .filter((at): at is string => at !== undefined)
    .sort()
    .at(-1);
  let ts: string;
  if (firstDecision === undefined) {
    ts = assessedAt ?? EPOCH;
  } else {
    const decidedAt = isoOf(firstDecision.ts);
    if (decidedAt === undefined) {
      ts = EPOCH;
    } else {
      const justBefore = new Date(Date.parse(decidedAt) - 1).toISOString();
      ts = assessedAt !== undefined && assessedAt < justBefore ? assessedAt : justBefore;
    }
  }

  // What: the audit's scores, with every decided finding open again.
  const decided = new Set<string>();
  for (const event of rows) {
    if (!DECISIONS.has(event.type)) continue;
    const id = (event as { finding_id?: unknown }).finding_id;
    if (isString(id)) decided.add(id);
  }
  const findings = rowsOf<QualityFinding>(section?.findings).map((finding) => {
    if (!isString(finding?.id) || !decided.has(finding.id)) return finding;
    const { resolved_by: _resolvedBy, ...rest } = finding as QualityFinding & { resolved_by?: string };
    return { ...rest, status: "open" } as QualityFinding;
  });
  const matrix = deriveQualityMatrix({ quality: { ...(section as QualitySection), findings } }, library);
  const frameworkVersion = matrix.framework_version ?? section?.framework_version ?? library?.version ?? "unknown";
  const input = auditCompletedInput(matrix, { audit_id: auditId, framework_version: frameworkVersion });

  return { id: `implicit-baseline:${auditId}`, ts, type: input.type, ...input.payload, baseline: true } as JournalEvent;
}

/** `events` with the implicit baseline in front, or `events` itself when there is none. */
export function withImplicitBaseline(
  events: readonly JournalEvent[],
  section: BaselineSection | null | undefined,
  library?: KritikLibrary,
): readonly JournalEvent[] {
  const baseline = implicitAuditBaseline(events, section, library);
  return baseline === null ? events : [baseline, ...events];
}

/** The reading without its envelope — what the hosted write path hands `makeEvent` when it records the baseline for real. */
export function baselineEventPayload(event: JournalEvent): Record<string, unknown> {
  const { id: _id, ts: _ts, type: _type, actor: _actor, ...payload } = event as JournalEvent & { actor?: unknown };
  return payload;
}
```

Adjust to reality while implementing, without changing behaviour:
- Check `QualitySection`'s actual field names (`framework_version`, `library`) in `packages/schema/src/quality.ts`.
- Check that `quality-ops.ts` is importable from here without a cycle. `quality-scope.ts` imports `./quality`, and `quality-ops.ts` may import the IO-free `./quality` too. If `quality-ops.ts` pulls in anything fs-bound, stop and report.
- Check whether the repo's lint config allows `_`-prefixed unused destructures. If not, use the same pattern the repo uses elsewhere (grep `_unused` / `eslint-disable-next-line @typescript-eslint/no-unused-vars`).

- [ ] **Step 4: Run it**

Run: `node tests/schema/quality-baseline.test.js`
Expected: every check passes except `the trend's first row is the baseline` (Task 2).

- [ ] **Step 5: Regenerate, typecheck, lint, commit**

```bash
npm run generate
npx tsc --noEmit -p . && npx eslint packages/schema/src/quality-baseline.ts
git add packages/schema/src/quality-baseline.ts packages/schema/src/index.ts packages/schema/src/journal-events.ts tests/schema/quality-baseline.test.js package.json .github/workflows/ci.yml
git add -u   # generated artifacts
git commit -m "feat(kritik): synthesize the reading a restored audit never got (#472)"
```

### Task 2: the trend knows a baseline and a scoped row

**Files:**
- Modify: `packages/schema/src/quality-trend.ts`
- Test: `tests/schema/quality-trend.test.js` (append)

`AuditSnapshot` gains `baseline?: true` (present when the event's `baseline === true`) and `scope?: { since: string; cells: number | null }` (present when `event.scope` is an object with a non-empty string `since`; `cells` is the number, else `null`). `TrendRow` carries both through `trendRows` under the same names, only when present. Update the doc comments: a baseline row is "synthesized from a stored audit that arrived without a recorded reading", and a scoped row is "a scoped re-audit's merged reading".

- [ ] **Step 1: Append failing checks** to `tests/schema/quality-trend.test.js`, before its final summary lines. Match that file's existing `check` helper and event-building idiom; read the top of the file first.

```js
// --- baseline and scoped rows (issues #472, #473) ----------------------------
{
  const events = [
    { id: "01B", ts: "2026-08-05T00:00:00.000Z", type: "quality.audit.completed", audit_id: "2026-08", framework_version: "1.0.0", scores: { web: { SEC: 50 } }, baseline: true },
    { id: "01S", ts: "2026-09-10T00:00:00.000Z", type: "quality.audit.completed", audit_id: "2026-09-scoped", framework_version: "1.0.0", scores: { web: { SEC: 75 } }, scope: { partial: true, cells: 3, since: "2026-08" } },
  ];
  const trend = deriveQualityTrend(events);
  check("a baseline event reads as a baseline snapshot", trend.snapshots[0].baseline === true && trend.snapshots[0].scope === undefined, JSON.stringify(trend.snapshots[0]));
  check("a scoped event carries its scope", JSON.stringify(trend.snapshots[1].scope) === JSON.stringify({ since: "2026-08", cells: 3 }) && trend.snapshots[1].baseline === undefined, JSON.stringify(trend.snapshots[1]));
  const { rows } = trendRows(trend);
  check("trend rows carry both flags", rows[0].baseline === true && rows[1].scope.since === "2026-08", JSON.stringify(rows));
  check("the scoped row has a real delta against the baseline", rows[1].cells.web.delta === 25, JSON.stringify(rows[1].cells));
  const plain = trendRows(deriveQualityTrend([{ id: "01P", ts: "2026-08-05T00:00:00.000Z", type: "quality.audit.completed", audit_id: "2026-08", framework_version: "1.0.0", scores: { web: { SEC: 50 } } }]));
  check("an ordinary row carries neither key", !("baseline" in plain.rows[0]) && !("scope" in plain.rows[0]), JSON.stringify(plain.rows[0]));
}
```

- [ ] **Step 2: Run and confirm the new checks fail:** `npm run test:quality-trend`
- [ ] **Step 3: Implement** in `deriveQualityTrend`'s snapshot construction and in `trendRows`:

```ts
// inside the loop, after `counts`:
...(event.baseline === true ? { baseline: true as const } : {}),
...(scopeOf(event.scope) ?? {}),
```

with a helper above `deriveQualityTrend`:

```ts
/** The event's scope marker, kept to what a row can show: the audit it followed, and how many cells it re-scored. */
function scopeOf(raw: unknown): { scope: { since: string; cells: number | null } } | undefined {
  if (!isRecord(raw) || typeof raw.since !== "string" || raw.since === "") return undefined;
  return { scope: { since: raw.since, cells: typeof raw.cells === "number" && Number.isFinite(raw.cells) ? raw.cells : null } };
}
```

and in `trendRows`'s `rows.push`: `...(snapshot.baseline ? { baseline: true as const } : {}), ...(snapshot.scope !== undefined ? { scope: snapshot.scope } : {}),`. Add the two optional fields to both interfaces, with doc comments.

- [ ] **Step 4: Run** `npm run test:quality-trend && node tests/schema/quality-baseline.test.js`. All pass.
- [ ] **Step 5: `npm run generate`, tsc, eslint, commit:** `feat(kritik): the trend flags baseline and scoped readings (#472)`

### Task 3: MCP hosted `kritik_scope` / `kritik_trend` use the baseline

**Files:**
- Modify: `packages/mcp/src/kritik-tools.ts` (`scopeOf`, the `kritik_trend` handler, both tool descriptions)
- Test: `tests/mcp/kritik-tools.test.js`

`scopeOf`: resolve `section`/`library` first, as it does now. Then `const events = ctx.qualityRoot === undefined ? withImplicitBaseline(graph.journal, section, library) : graph.journal;` and use `events` for both the `since` check (`recordedAuditIds(events)`) and `deriveAuditScope(events, …)`. Repo mode doesn't change (spec decision 3). Change the hosted-section library fallback from `{ criteria: [] }` to `hosted.library`: pass `hosted.library` to `withImplicitBaseline` and `hosted.library ?? { criteria: [] }` to `deriveAuditScope`.

`kritik_trend` hosted: `const quality = bundle.quality;` and when it has array `assessments` and `findings`, `events = withImplicitBaseline(graph.journal, quality, resolveKritikLibrary(quality))`, else `graph.journal`. When the first row is a baseline, add `note: "The first row is the restored audit's reading, rebuilt from its stored scores — no reading was recorded for it."` Keep the existing "No recorded audits yet" note for the empty case. Import `withImplicitBaseline` from `@arkaik/schema` (already a dependency).

Descriptions: `kritik_scope` gets "In a hosted project whose audit arrived by restore with no recorded reading, the scope measures from that audit, dated where it was taken." `kritik_trend` gets "a restored audit with no recorded reading appears as a baseline first row."

- [ ] **Step 1: Failing test.** In `tests/mcp/kritik-tools.test.js`, extend `startHostedStub` so it also serves a second project, `restored`: `GET /api/graph/projects/restored` returns `{ bundle: RESTORED_BUNDLE, version: "v1" }`, and `GET /api/graph/projects/restored/journal` returns only resolutions, no audit. Define it next to `HOSTED_BUNDLE`:

```js
const RESTORED_BUNDLE = {
  ...HOSTED_BUNDLE,
  project: { ...HOSTED_BUNDLE.project, id: "restored" },
  quality: {
    ...HOSTED_BUNDLE.quality,
    assessments: [{ criterion_id: "SEC-01", surface: "web", level: 2, evidence: "e", audit_id: "2026-08", ts: "2026-08-01T00:00:00.000Z" }],
  },
};
const RESTORED_JOURNAL = [
  { id: "01RRES", ts: "2026-08-20T00:00:00.000Z", type: "quality.finding.resolved", finding_id: "F-B", resolved_by: "https://pr/3", actor: "github-app" },
];
```

After the existing `hosted` session's checks, start `startSession(["--remote", "--project", "restored"], { ARKAIK_TOKEN: "t", ARKAIK_URL: baseUrl })`, initialize it exactly as the `hosted` one is, and assert:

```js
const restoredScope = await restored.call("kritik_scope", {});
check("a restored project with no recorded audit scopes from its stored audit",
  !restoredScope.isError && restoredScope.json.since === "2026-08" && restoredScope.json.since_ts === "2026-08-01T00:00:00.000Z" &&
  JSON.stringify(restoredScope.json.cells.map((c) => [c.criterion_id, c.kind, c.because])) === JSON.stringify([["SEC-01", "direct", ["F-B"]]]),
  restoredScope.text.slice(0, 400));
const restoredSince = await restored.call("kritik_scope", { since: "2026-08" });
check("since=<the stored audit> resolves", !restoredSince.isError && restoredSince.json.since === "2026-08", restoredSince.text.slice(0, 300));
const restoredTrend = await restored.call("kritik_trend", {});
check("the trend's first row is the restored audit, flagged baseline",
  !restoredTrend.isError && restoredTrend.json.total === 1 && restoredTrend.json.rows[0].audit_id === "2026-08" && restoredTrend.json.rows[0].baseline === true && /rebuilt/.test(restoredTrend.json.note),
  restoredTrend.text.slice(0, 400));
```

Close the `restored` session the same way the file closes `hosted`. Keep the pre-existing hosted checks green: the `demo` project has a recorded audit, so no baseline is synthesized there.

- [ ] **Step 2: Run and confirm it fails:** `npm run test:mcp` (it builds `arkaik` and `arkaik-mcp` first). Expected: the three new checks FAIL.
- [ ] **Step 3: Implement** as described above.
- [ ] **Step 4: Run** `npm run test:mcp`. All pass.
- [ ] **Step 5: tsc, eslint, commit:** `feat(mcp): hosted kritik_scope and kritik_trend measure from a restored audit (#472)`

### Task 4: the app's Quality page trend uses the baseline

**Files:**
- Modify: `lib/hooks/useQualityData.ts`

Change `AUDIT_EVENTS` to `["quality.audit.completed", "quality.finding.resolved", "quality.finding.accepted"] as const` and rename it to `TREND_EVENTS`. Its comment gains: the decisions are there so a restored audit's implicit baseline can be dated and scored (`withImplicitBaseline`). Derive the trend over `withImplicitBaseline(audits, section, library)` inside the existing `useMemo`, and add `section` and `library` to its deps. Before the change, grep what else consumes the `audits` value from this hook (`grep -n "audits" lib/hooks/useQualityData.ts components -r`). If anything besides the trend reads it as "audit events only", filter it to `quality.audit.completed` for that consumer.

- [ ] **Step 1:** Make the change.
- [ ] **Step 2:** Run `npx tsc --noEmit -p .`, `npx eslint lib/hooks/useQualityData.ts`, `npm run test:quality-page` and `npm run test:product-scope` (source-asserting suites read app source). All clean.
- [ ] **Step 3: Commit:** `feat(quality): the trend arrows read against a restored audit's baseline (#472)`

### Task 5: the CLI trend table marks baseline and scoped rows

**Files:**
- Modify: `packages/cli/src/commands/kritik.ts` (the trend printer, around lines 1165–1195)
- Test: `tests/cli/kritik.test.js` (find the existing `trend` checks and add beside them)

After each printed row, the same way the `!row.comparable` note is printed: for `row.baseline`, print `  <pad>   baseline — rebuilt from a restored audit's stored scores`; for `row.scope`, print `  <pad>   scoped re-audit of ${row.scope.cells ?? "?"} cell(s) since ${row.scope.since}`. `--json` already includes the rows unchanged.

- [ ] **Step 1: Failing test.** Find how `tests/cli/kritik.test.js` writes a journal and runs `trend` (grep `"trend"`). Add a case whose journal has one `baseline: true` audit and one scoped audit, run `kritik trend`, and assert stdout matches `/baseline — rebuilt/` and `/scoped re-audit of 3 cell\(s\) since 2026-08/`.
- [ ] **Step 2: Run** `npm run test:cli` and confirm it fails.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm run test:cli`. All pass.
- [ ] **Step 5: Commit:** `feat(cli): kritik trend marks baseline and scoped rows (#472)`

**Part 1 exit check:** `npm run test:quality-baseline && npm run test:quality-trend && npm run test:quality-scope && npm run test:mcp && npm run test:cli && npm run test:quality-page && npx tsc --noEmit -p . && npx eslint . && npm run generate && git status --short` shows a clean tree.

---

# Part 2 — the hosted write path (#473, server)

Branch: `git checkout -b kritik-hosted-2-write-path` from part 1's tip.

### Task 6: the `quality.assessment.scored` event and the shared scoped-id rule

**Files:**
- Modify: `packages/schema/src/journal-events.ts` (new schema; add it to `JOURNAL_EVENT_SCHEMAS` and `KnownJournalEventSchema`)
- Modify: `packages/schema/src/quality-ops.ts` (`assessmentScoredInput`)
- Modify: `packages/schema/src/quality-scope.ts` (`scopedAuditId`)
- Modify: `packages/schema/src/cli/kritik-audit.ts` (`scopedAuditTarget` delegates)
- Modify: `docs/spec/journal.md` (event vocabulary: add the row beside the other `quality.*` rows, matching their format)
- Test: `tests/schema/quality-ops.test.js`, `tests/schema/quality-scope.test.js`

Schema:

```ts
/**
 * One (criterion × surface) score written by a hosted session (issue #473) —
 * the hosted twin of a row in an audit's `scores.json`. The read folds these
 * latest-wins per cell over `snapshot.quality.assessments`, the rule
 * `loadCurrentQualitySection` applies across audit dirs. `scope.since` is the
 * recorded audit the scoped re-audit was measured from.
 */
export const QualityAssessmentScoredEventSchema = z
  .object({
    ...envelope,
    type: z.literal("quality.assessment.scored"),
    audit_id: z.string(),
    criterion_id: z.string(),
    surface: z.string(),
    level: z.number().int().min(0).max(4),
    evidence: z.string(),
    commit: z.string().optional(),
    scope: z.object({ since: z.string().optional() }).catchall(z.unknown()).optional(),
  })
  .catchall(z.unknown());
```

`assessmentScoredInput(assessment: Pick<QualityAssessment, "criterion_id" | "surface" | "level" | "evidence" | "audit_id" | "commit">, since: string): EventInput` returns `{ type: "quality.assessment.scored", payload: { audit_id, criterion_id, surface, level, evidence, ...(commit ? { commit } : {}), scope: { since } } }`. Give it a docblock in the style of `auditCompletedInput`.

`scopedAuditId` is the pure core of `scopedAuditTarget`:

```ts
export interface ScopedAuditIdInput {
  /** The recorded audit the scope is measured from. */
  since: string;
  /** `YYYY-MM`, the month a new scoped audit is named for. */
  month: string;
  requested?: string;
  /** Every audit id that exists: on disk in a repo, in the section and journal when hosted. */
  known: readonly string[];
  recorded: readonly string[];
  /** A scoped audit in progress from the same `since`, not yet recorded — continued rather than forked. */
  open?: string;
}
export function scopedAuditId(input: ScopedAuditIdInput): string
```

Rules, verbatim from today's `scopedAuditTarget` (keep its error messages, with `--audit` phrasing replaced by neutral "name a new audit"):
1. `requested === since` throws.
2. `requested` recorded throws: `"<id>" is already recorded — its reading is history. Name a new audit.` (new).
3. `requested` sorting before the newest known id throws.
4. Otherwise `requested` is returned. With no `requested`: `open` is returned when given.
5. Otherwise the first `${month}-scoped`, `${month}-scoped-02`, … not in `known`. Throw if it sorts before the newest known id.

`scopedAuditTarget(root, since, month, requested, recorded)` keeps its signature and computes `known = listAuditIds(root)` and `open` (newest, when it isn't `since`, isn't recorded, and its `scores.json` scope.since === since), then returns `scopedAuditId(...)`.

- [ ] **Step 1: Failing tests.**
  - In `tests/schema/quality-ops.test.js`, assert that `assessmentScoredInput({criterion_id:"SEC-01",surface:"web",level:3,evidence:"src/a.ts:3",audit_id:"2026-09-scoped",commit:"abc"}, "2026-08")` deep-equals the expected input (compare `JSON.stringify`), that it omits `commit` when absent, and that `makeEvent(input.type, input.payload)` parses. Also assert that `makeEvent("quality.assessment.scored", {...level: 7})` throws.
  - In `tests/schema/quality-scope.test.js`, assert each `scopedAuditId` rule: default `2026-09-scoped`; `-02` when taken; `open` continued; `requested === since` throws; a recorded `requested` throws; `requested` < newest throws; a candidate sorting before a known `2026-10` throws.
- [ ] **Step 2: Run** `npm run test:quality-ops && npm run test:quality-scope` and confirm they fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** those two plus `npm run test:cli` (it pins `scopedAuditTarget` behaviour through `kritik score --scope`). If an existing CLI test relied on scoring into a *recorded* requested audit, stop and report instead of changing the test.
- [ ] **Step 5:** `npm run generate`, tsc, eslint, commit: `feat(kritik): quality.assessment.scored, and one scoped-audit naming rule for both modes (#473)`

### Task 7: `foldQualityEvents` folds scores as well as decisions

**Files:**
- Modify: `lib/utils/quality.ts` (rename `foldFindingEvents` → `foldQualityEvents`; add the assessment fold)
- Modify every caller: `app/api/graph/projects/[projectId]/route.ts`, `lib/data/local-provider.ts`, `lib/services/graph/quality-events.ts`, and any comment that names the old function (`git grep -n foldFindingEvents`)
- Test: `tests/app/quality.test.js`, `tests/data/quality-fold.test.js` (rename usages; add assessment cases in `tests/app/quality.test.js`)

The assessment fold, in the same event walk: for `type === "quality.assessment.scored"` with string `criterion_id`, `surface`, `audit_id`, `evidence` and an integer `level` 0–4, upsert into the assessments by `criterion_id::surface`, **latest wins**. The folded row is `{ criterion_id, surface, level, evidence, audit_id, ...(commit), ...(ts) }`. A cell the section never held is appended. A malformed event is skipped. Findings logic doesn't change. Return the section by reference when neither findings nor assessments changed. Update the docblock: the fold now makes two kinds of hosted write visible, decisions (first decision wins) and scores (last score wins), and says why they differ. A decision is a verdict the write path refuses to overwrite; a score is an assessment that a re-score is meant to replace.

- [ ] **Step 1: Failing tests** appended in `tests/app/quality.test.js` (it loads `lib/utils/quality.ts` via `tests/app/load-quality.js`; rename every `foldFindingEvents` in the file to `foldQualityEvents` first):

```js
// --- scores fold latest-wins (issue #473) ------------------------------------
{
  const section = {
    profile: { surfaces: [{ id: "web", title: "Web" }] },
    assessments: [{ criterion_id: "SEC-01", surface: "web", level: 1, evidence: "old", audit_id: "2026-08" }],
    findings: [],
  };
  const scored = (id, criterion, level, audit = "2026-09-scoped") => ({ id, ts: `2026-09-0${id.slice(-1)}T00:00:00.000Z`, type: "quality.assessment.scored", audit_id: audit, criterion_id: criterion, surface: "web", level, evidence: `ev ${id}`, scope: { since: "2026-08" } });
  const folded = foldQualityEvents(section, [scored("S1", "SEC-01", 2), scored("S2", "SEC-01", 3), scored("S3", "SEC-02", 4)]);
  const byCell = Object.fromEntries(folded.assessments.map((a) => [a.criterion_id, a]));
  check("a re-score replaces the stored level, latest wins", byCell["SEC-01"].level === 3 && byCell["SEC-01"].evidence === "ev S2" && byCell["SEC-01"].audit_id === "2026-09-scoped");
  check("a cell the section never held is appended", byCell["SEC-02"].level === 4);
  check("the stored section is not mutated", section.assessments[0].level === 1 && section.assessments.length === 1);
  check("a malformed score is skipped", foldQualityEvents(section, [{ ...scored("S4", "SEC-01", 9) }]) === section);
  check("nothing to fold returns the section by reference", foldQualityEvents(section, []) === section);
}
```

- [ ] **Step 2: Run** `npm run test:quality-page` and confirm the new checks fail.
- [ ] **Step 3: Implement** the rename and the fold. Then `git grep -n foldFindingEvents` should return nothing.
- [ ] **Step 4: Run** `npm run test:quality-page && npm run test:quality-fold && npm run test:quality-events`. All pass. (`load-quality-events.js` rewrites `@/lib/utils/quality`, so no loader change is needed. Confirm no new `@/` import was added.)
- [ ] **Step 5:** tsc, eslint, commit: `feat(quality): the read folds hosted scores latest-wins per cell (#473)`

### Task 8: the store reads, and counts, the new fold type

**Files:**
- Modify: `lib/services/graph/store.ts`
- Modify: `app/api/graph/projects/[projectId]/route.ts` (the renamed reader)
- Test: `tests/services/graph-etag.test.js` (DB-free) and `tests/services/graph-api.test.js` (Postgres)

In `store.ts`, declare `const QUALITY_FOLD_TYPES = ["quality.finding.resolved", "quality.finding.accepted", "quality.assessment.scored"] as const;` with a comment: these are the event types `foldQualityEvents` reads into the bundle, so the ETag must move on each. Build `VALIDATOR_COLUMNS`' `in (...)` list from it (the types are constants, so string-building the SQL literal is safe; say so in the comment). Replace `qualityFindingEvents` with:

```ts
export async function qualityEventsOfTypes(projectId, ownerIds, types: readonly string[]): Promise<JournalEvent[]>
// same owner check as today; `and event->>'type' = any($2::text[])` with `[projectId, types]`, order by seq asc
export const qualityFoldEvents = (projectId: string, ownerIds: readonly string[]) => qualityEventsOfTypes(projectId, ownerIds, QUALITY_FOLD_TYPES);
```

Export `QUALITY_FOLD_TYPES`. The project GET uses `qualityFoldEvents`. Rename `ProjectValidators.qualityEventCount`'s doc comment to match.

- [ ] **Step 1: Failing test.** Read `tests/services/graph-etag.test.js` to see what it exercises DB-free. If it covers the validator column SQL, add an assertion that the column text contains `quality.assessment.scored`. If it doesn't, add a check to `tests/services/graph-api.test.js`: append a `quality.assessment.scored` event through `appendJournalEvents`, and assert the project's validators' `qualityEventCount` rose by one and the GET's ETag changed.
- [ ] **Step 2: Start the scratchpad Postgres** (memory: *Local Postgres IS available*):

```bash
SCRATCH=<scratchpad dir>
initdb -D "$SCRATCH/pgdata" -U arkaik --auth=trust
pg_ctl -D "$SCRATCH/pgdata" -l "$SCRATCH/pg.log" -o "-p 5432 -c listen_addresses=localhost -c unix_socket_directories=''" start
createdb -h localhost -p 5432 -U arkaik arkaik_test
DATABASE_URL=postgres://arkaik@localhost:5432/arkaik_test npm run db:migrate
```

Run `DATABASE_URL=… npm run test:graph` and confirm the new check fails.
- [ ] **Step 3: Implement.** Grep the test loaders for `qualityFindingEvents` stubs (`grep -rn qualityFindingEvents tests/`) and rename them.
- [ ] **Step 4: Run** `npm run test:graph-etag`, then with `DATABASE_URL`: `npm run test:graph && npm run test:github && npm run test:graph-restore`. Also execute each DB loader once to catch a missing rewrite: `node -e "require('./tests/services/load-graph-api.js').loadGraphApi()"` (check each loader's export name).
- [ ] **Step 5:** tsc, eslint, commit: `feat(graph): hosted scores are a folded quality event — read and counted in the ETag (#473)`

### Task 9: the whitelist parses the two new entries

**Files:**
- Modify: `lib/services/graph/quality-events.ts` (`QualityEventInput`, `parseQualityEventInputs`, module docblock)
- Test: `tests/services/quality-events.test.js`

New union members:

```ts
| { type: "quality.assessment.scored"; criterion_id: string; surface: string; level: number; evidence: string; audit_id?: string; commit?: string }
| { type: "quality.audit.completed"; scope: true; audit_id: string; commit?: string }
```

Parse rules:
- **scored:** `criterion_id`, `surface`, `evidence` are non-empty strings. `level` is an integer 0–4. `audit_id`/`commit` are non-empty strings when present.
- **audit.completed:** `scope === true`, else error `events[i].scope must be true — only a scoped re-audit is recorded here`. `audit_id` is a non-empty string. `commit` is a non-empty string when present. If `"scores" in entry || "counts" in entry`, error `events[i]: scores and counts are computed by the server`.
- The unknown-type error lists all five types.

Update the module docblock's "whitelist is the point" paragraph: five types now. The two new ones are writes of assessment state, both scoped to a re-audit the server can check against the journal, so neither is a general append.

- [ ] **Step 1: Failing tests:** one valid parse per new type (the output equals the input minus unknown keys); a level of `5`, of `2.5` and of `"3"` each refused; missing evidence refused; `scope` missing/false refused; `scores` present refused; `requiredScopeFor` returns `graph:write` for a batch holding a scored entry.
- [ ] **Step 2: Run** `npm run test:quality-events` and confirm they fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** All pass.
- [ ] **Step 5: Commit:** `feat(graph): the quality events whitelist admits a scoped score and a scoped recording (#473)`

### Task 10: planning scores, scoped recordings and the baseline write

**Files:**
- Modify: `lib/services/graph/quality-events.ts` (`planQualityEvents`, `QualityEventRefusal`)
- Test: `tests/services/quality-events.test.js`

New signature: `planQualityEvents(section, priorEvents, inputs, actor, now: Date = new Date())`. `priorEvents` now holds decisions, scores and `quality.audit.completed`. Update the docblock.

Refusal type:

```ts
export type QualityEventRefusal = {
  index: number;
  reason: "unknown_finding" | "not_open" | "invalid_assessment" | "out_of_scope" | "no_baseline" | "not_scored" | "already_recorded" | "scope_mismatch";
  finding_id?: string;
  detail?: string;
};
```

Existing finding refusals keep `finding_id` and gain `index`.

Algorithm (all names from `@arkaik/schema`):

```ts
const library = resolveKritikLibrary(section);
let working = foldQualityEvents(section, priorEvents);   // current state
const journal: JournalEvent[] = [...priorEvents];         // grows as entries are planned
const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
const withBaseline = () => withImplicitBaseline(journal, section, library); // the STORED section: exact
```

Per entry, by type:

- **trip / resolved / accepted:** as today. The finding lookup reads `working.findings`. When a decision is planned, push it to `journal` and set `working = foldQualityEvents(working, [event])`, so a later scored entry in the same batch sees it.
- **`quality.assessment.scored`:**
  1. Validate. The criterion must be in `library?.criteria`, else `invalid_assessment` with detail `unknown criterion "<id>"`. Also refuse a retired criterion (`superseded_by`), a surface that's `cross-surface` or not in `section.profile.surfaces` (only checked when the profile declares surfaces), or an `applies_to` that excludes the surface. Each detail should read like the MCP's messages.
  2. `const scope = deriveAuditScope(withBaseline(), working, library ?? { criteria: [] });`. `scope.since === null` → `no_baseline`. A cell that isn't in `scope.cells` → `out_of_scope`, with detail `scopeSummary(scope)`.
  3. Resolve the audit id:
     - `recorded = recordedAuditIds(withBaseline())`.
     - `scoredEvents = journal.filter(e => e.type === "quality.assessment.scored")`.
     - `known` = the union of `working.assessments` audit ids, the scored events' audit ids, and `recorded`.
     - `open` = the last scored event whose `scope.since === scope.since` and whose audit id isn't recorded.
     - `auditId = scopedAuditId({ since: scope.since, month, requested: input.audit_id, known, recorded, open })`. A throw → `invalid_assessment` with the message as detail.
  4. If `implicitAuditBaseline(journal, section, library)` is non-null, first plan `makeEvent("quality.audit.completed", baselineEventPayload(b), { ts: b.ts, actor })` and push it to `events` and `journal`. This happens once: after the push, the journal holds a recording, so the helper returns `null`.
  5. Plan `makeEvent(...assessmentScoredInput({ criterion_id, surface, level, evidence, audit_id: auditId, commit }, scope.since), { actor })`, push it to `events` and `journal`, and set `working = foldQualityEvents(working, [event])`.
- **`quality.audit.completed` (scoped):**
  1. `recordedAuditIds(withBaseline())` includes `audit_id` → `already_recorded`.
  2. `scored` = journal scored events with this `audit_id`. None → `not_scored`.
  3. `sinces` = the distinct `scope.since` values of `scored`. `current = deriveAuditScope(withBaseline(), working, library ?? { criteria: [] }).since`. If `sinces.size !== 1` or the single value isn't `current` → `scope_mismatch`, with detail naming both.
  4. `matrix = deriveQualityMatrix({ quality: working }, library)`. `cells` = the count of distinct `criterion_id::surface` in `scored`. `framework_version = matrix.framework_version ?? section?.framework_version ?? library?.version ?? "unknown"`.
  5. Plan `makeEvent(...auditCompletedInput(matrix, { audit_id, framework_version, commit, scope: { partial: true, cells, since } }), { actor })` and push it.

This stays all-or-nothing: any refusal returns `{ ok: false, refusals }` and no events.

- [ ] **Step 1: Failing tests** in `tests/services/quality-events.test.js`. Add a fixture block: a restored section (profile `web`, criteria `SEC-01`/`SEC-02` via an embedded `library` with `applies_to: ["web"]`, two `2026-08` assessments with `ts`, findings `F-1` on SEC-01 open and `F-2` on SEC-02 open) and a prior journal holding one `quality.finding.resolved` for `F-1` at `2026-08-20`. Pass `now = new Date("2026-09-15T00:00:00Z")`. Assert, each as its own `check`:
  1. A scored entry for SEC-01/web plans **two** events: first a `quality.audit.completed` with `baseline === true`, `audit_id === "2026-08"` and `ts` < the resolution's ts, then a `quality.assessment.scored` with `audit_id === "2026-09-scoped"` and `scope.since === "2026-08"`. Check the types in order by identity.
  2. Feed plan 1's events back as prior events and score SEC-01 again: exactly one scored event and no baseline (the baseline was written once). Its audit id is `2026-09-scoped` (the open audit is continued).
  3. SEC-02/web (no resolution → not in scope) → `out_of_scope`, and no events.
  4. An unknown criterion → `invalid_assessment`. `cross-surface` → `invalid_assessment`.
  5. A section with no assessments and no recording → `no_baseline`.
  6. A scoped completion for `2026-09-scoped` after plan 1's events → one `quality.audit.completed` with `scope` `{partial:true, cells:1, since:"2026-08"}`. Its `scores.web.SEC` equals `deriveQualityMatrix({quality: foldQualityEvents(section, allEvents)}, library).matrix.SEC.web.score`, computed in the test from the same inputs, and it isn't equal to the baseline's score (assert that precondition).
  7. Completion for an audit with no scores → `not_scored`. Completing again after it was recorded → `already_recorded`.
  8. Score and complete in **one batch** → three events (baseline, scored, completed) in order.
  9. A batch with a good score and an out-of-scope score → refused as a whole, and the refusal carries `index: 1`.
  10. The trend over `[...prior, ...all planned events]` via `deriveQualityTrend` + `trendRows` has two rows. The first is `baseline`, the second `scope.since === "2026-08"` with a non-null `delta`. (This is #473's trend acceptance, end to end in pure code.)
- [ ] **Step 2: Run** `npm run test:quality-events` and confirm they fail.
- [ ] **Step 3: Implement.** Update the existing checks' refusal shape expectations only where they assert the exact object. The existing assertions read `.reason`/`.finding_id`, so they should hold.
- [ ] **Step 4: Run** `npm run test:quality-events && npm run test:quality-page`. All pass.
- [ ] **Step 5: Commit:** `feat(graph): plan hosted scores against the scope, record the baseline once, compute the scoped reading server-side (#473)`

### Task 11: the route passes the planner what it now needs

**Files:**
- Modify: `app/api/graph/projects/[projectId]/quality/events/route.ts`
- Test: `tests/services/graph-api.test.js` (or whichever Postgres suite already exercises this route: `grep -rn "quality/events" tests/services`)

`priorEvents = await qualityEventsOfTypes(projectId, caller.ownerIds, [...QUALITY_FOLD_TYPES, "quality.audit.completed"])`. Keep passing `found.bundle.quality` as the stored section. Update the route docblock: five whitelisted types, two of them assessment state, the baseline written once, and scores/counts computed here. The "deliberately unlocked" paragraph needs a sentence on the new race. Two concurrent first scores could each write a baseline. Say what reads do then: `recordedAuditIds` dedupes and the trend keeps the latest recording of an id, so a duplicate baseline is inert. Verify that claim against `deriveQualityTrend`'s "re-recorded audit id — latest wins" rule and `recordedAuditIds`' dedupe before writing it.

- [ ] **Step 1: Failing Postgres test.** Seed a project whose snapshot carries the restored section from Task 10 and whose journal carries the `F-1` resolution (follow how the suite seeds projects and the journal). POST a scored entry with a `graph:write` token and assert: a 200; two events returned (baseline, scored); `GET` of the project shows SEC-01/web at the new level; `GET …/journal` holds both. Then POST the scoped completion and assert a 200 with a `scope.partial` event. POST an out-of-scope cell → 422 with `refusals[0].reason === "out_of_scope"`. A `quality:append`-only token posting a score → 403.
- [ ] **Step 2: Run** with `DATABASE_URL` and confirm it fails.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm run test:graph && npm run test:github && npm run test:quality-events && npm run test:graph-etag`. All pass.
- [ ] **Step 5: Commit:** `feat(graph): the quality events route runs a hosted scoped re-audit (#473)`

**Part 2 exit check:** every suite named in tasks 6–11, plus `npm run test:cli`, `npm run test:mcp`, `npx tsc --noEmit -p .`, `npx eslint .`, and `npm run generate` leaving a clean tree.

---

# Part 3 — MCP + docs (#473, client)

Branch: `git checkout -b kritik-hosted-3-mcp` from part 2's tip.

### Task 12: the store forwards the widened inputs and the richer refusals

**Files:**
- Modify: `packages/mcp/src/store.ts` (`appendQualityEvents` input type)
- Modify: `packages/mcp/src/remote-store.ts` (refusal text)
- Modify: `packages/mcp/src/kritik-tools.ts` (`appendHosted` input type)
- Test: `tests/mcp/remote-store.test.js`

Define `HostedQualityInput` in `store.ts` as the same five-member union as the server's `QualityEventInput` (a structural copy; the MCP package can't import `lib/`), and use it in all three places. The refusal line in `remote-store.ts` becomes ``${r.finding_id ?? `entry ${r.index}`}: ${r.reason}${r.detail ? ` — ${r.detail}` : ""}``, joined with `; `.

- [ ] **Step 1: Failing test** in `tests/mcp/remote-store.test.js`, following the file's stub-server pattern: a 422 whose `refusals: [{ index: 0, reason: "out_of_scope", detail: "1 cell to re-score…" }]` surfaces as an error message containing `entry 0: out_of_scope — 1 cell to re-score`.
- [ ] **Step 2–4:** run `npm run test:mcp`, implement, and run again.
- [ ] **Step 5: Commit:** `feat(mcp): hosted quality appends carry scores and scoped recordings (#473)`

### Task 13: `kritik_score` scores hosted, scoped-only

**Files:**
- Modify: `packages/mcp/src/kritik-tools.ts` (the `kritik_score` handler, its description, the module docblock)
- Test: `tests/mcp/kritik-tools.test.js`

At the top of the handler, before `repoRootOf`:

```ts
if (ctx.qualityRoot === undefined) {
  if (args.scope !== true) {
    throw new ToolError(
      "A hosted session scores only a scoped re-audit: pass scope=true and score the cells kritik_scope lists. " +
        "A comprehensive audit runs where the checkout is — `arkaik-mcp --bundle <path>`.",
    );
  }
  const graph = await load();
  const { library } = hostedSection(graph);          // refuses a project with no quality section
  const criterionId = requireString(args, "criterion_id");
  const surface = requireString(args, "surface");
  const level = requireInt(args, "level", 0, 4) as MaturityLevel;
  const evidence = requireString(args, "evidence");
  const commit = typeof args.commit === "string" && args.commit !== "" ? args.commit : undefined;
  const events = await appendHosted(ctx.store, [{
    type: "quality.assessment.scored", criterion_id: criterionId, surface, level, evidence,
    ...(typeof args.audit_id === "string" && args.audit_id !== "" ? { audit_id: args.audit_id } : {}),
    ...(commit !== undefined ? { commit } : {}),
  }]);
  const scored = events.find((e) => e.type === "quality.assessment.scored") as (JournalEvent & { audit_id: string; scope?: { since?: string } }) | undefined;
  const baseline = events.find((e) => e.type === "quality.audit.completed" && (e as { baseline?: unknown }).baseline === true); // by flag, never by position
  const notes: string[] = [];
  if (baseline !== undefined) notes.push(`Recorded the baseline reading of ${(baseline as { audit_id?: string }).audit_id} first, dated where that audit was taken — the scope and the trend now measure from a real event.`);
  if (commit === undefined) notes.push("No commit given — it is the only thing that lets a hosted reader check this evidence against the tree it cites.");
  return {
    assessment: { criterion_id: criterionId, surface, level, evidence, audit_id: scored?.audit_id, ...(commit !== undefined ? { commit } : {}), ts: scored?.ts },
    audit_id: scored?.audit_id,
    ...(scored?.scope?.since !== undefined ? { scoped_from: scored.scope.since } : {}),
    anchor: library?.criteria?.find((c) => c.id === criterionId)?.level_anchors?.[`l${level}`],
    events,
    ...(notes.length > 0 ? { notes } : {}),
  };
}
```

(The server is the validator. The tool doesn't re-check the criterion or scope client-side, for the same reason `appendHosted` doesn't: the server's post-fold verdict is the only one that counts.)

Description: replace "Repo sessions only: scoring reads the code, so a hosted session refuses." with: "In a hosted session scoring is scoped-only (scope=true is required) and nothing is written to disk. The server checks the cell against the scope, names the audit (default <YYYY-MM>-scoped), and, for a restored audit with no recorded reading, records that baseline first. You are still reading code: run this where the product's checkout is, and pass commit so the evidence can be checked against it." Update the module docblock's "What stays repo-only" paragraph: `kritik_score` joins the hosted tools, scoped-only; `kritik_open_finding`, `kritik_signals` and `kritik_trip_signal` stay repo-only.

- [ ] **Step 1: Failing test.** In the hosted stub's `/quality/events` handler, echo a scored input as `{ id: "01SC", ts: "2026-09-15T00:00:00.000Z", type, audit_id: input.audit_id ?? "2026-09-scoped", criterion_id, surface, level, evidence, scope: { since: "2026-08" }, actor: "arkaik-agent" }`. For the `restored` project, prepend a `{ id: "01BL", ts: "2026-08-01T00:00:00.000Z", type: "quality.audit.completed", audit_id: "2026-08", baseline: true, … }` event, the way the real server does. Replace the old `kritik_score still refuses in hosted mode` check with:
  - Without `scope` → an error matching `/scoped re-audit/`, and no POST.
  - With `scope: true` on `demo` → exactly one POST whose body is `{ events: [{ type: "quality.assessment.scored", criterion_id: "SEC-01", surface: "web", level: 3, evidence: "src/a.ts:3", commit: "abc" }] }` (deep-equal via `JSON.stringify`). The reply has `audit_id === "2026-09-scoped"` and `scoped_from === "2026-08"`, and no `notes`.
  - On `restored` without a commit → `notes` mentions `baseline` and `commit`.
  - A server 422 `out_of_scope` surfaces as the tool error text.
- [ ] **Step 2–4:** run `npm run test:mcp`, implement, run again.
- [ ] **Step 5: Commit:** `feat(mcp): kritik_score runs a hosted scoped re-audit (#473)`

### Task 14: `kritik_matrix record=true` records the hosted scoped audit

**Files:**
- Modify: `packages/mcp/src/kritik-tools.ts` (the `kritik_matrix` hosted branch, its description, and a `commit` input property)
- Test: `tests/mcp/kritik-tools.test.js`

Hosted branch, in this order:
1. **`record === true`:** `audit_id` is required. Without it: `ToolError("record=true in a hosted session records a scoped re-audit: pass the audit_id kritik_score returned (e.g. 2026-09-scoped).")`. `scope` may be true or absent, since it's implied. Load the graph. Compute `left_unscored` = `scopeOf(graph).cells` minus the cells of the journal's `quality.assessment.scored` events with that `audit_id` (only when `scopeOf(graph).since` equals those events' `scope.since`, mirroring repo mode). POST `[{ type: "quality.audit.completed", scope: true, audit_id, ...(commit) }]`. Then reload the graph and return the same flat read shape as the plain hosted read, plus `audit_id`, `scope` (from the returned event), `left_unscored` and `events`.
   **Retry safety (from the Task 10 review):** there is no idempotency key. If the POST is refused and every refusal is `already_recorded` for this `audit_id`, the earlier attempt landed: reload the graph, find the journal's `quality.audit.completed` for that `audit_id`, and return it as success with `note: "Already recorded — returning the reading that landed."`. Test it with a stub 422 `{error:"refused", refusals:[{index:0, reason:"already_recorded"}]}` whose journal already holds the recording. The remote store must expose the parsed refusals (e.g. on the thrown error) for this, so extend Task 12's error to carry `refusals`.
2. **`scope === true` without `record`:** keep refusing, with an updated message: "In a hosted session a scoped re-audit is recorded with record=true and its audit_id; the read is always the current state."
3. **`audit_id` without `record`:** refused as today.
4. Otherwise: the plain read, unchanged.

Add `commit: { type: "string", description: "Hosted record only: the commit the scoped re-audit read. Repo mode reads it from the audit's scores.json." }` to the input schema. Rewrite the description's hosted sentence: "in hosted mode it is a read of the stored quality section, and record=true (with the audit_id kritik_score returned) records that scoped re-audit — the server computes the merged scores itself, so the recorded reading cannot disagree with the scores behind it."

- [ ] **Step 1: Failing test.** Stub: echo `quality.audit.completed` inputs as `{ id: "01REC", ts: "2026-09-16T00:00:00.000Z", type, audit_id, framework_version: "1.0.0", scores: { web: { SEC: 80 } }, scope: { partial: true, cells: 1, since: "2026-08" }, actor: "arkaik-agent" }`. Replace `hosted matrix refuses record` with:
  - `record: true` without `audit_id` → an error matching `/audit_id/`, no POST.
  - `record: true, audit_id: "2026-09-scoped", commit: "abc"` → one POST with body `{ events: [{ type: "quality.audit.completed", scope: true, audit_id: "2026-09-scoped", commit: "abc" }] }`, and a reply with `scope.since === "2026-08"` and a `matrix` key (the read).
  - Keep `hosted matrix refuses scope` (message regex updated) and `hosted matrix refuses audit_id rather than ignoring it`.
- [ ] **Step 2–4:** run `npm run test:mcp`, implement, run again.
- [ ] **Step 5: Commit:** `feat(mcp): kritik_matrix records a hosted scoped re-audit (#473)`

### Task 15: docs and skill prose

**Files:**
- Modify: `docs/hosted-projects.md` (the Kritik section: the hosted scoped re-audit loop, the five whitelisted types, the `graph:write` requirement, the one-time baseline)
- Modify: `docs/spec/mcp.md` (the `kritik_score` / `kritik_matrix` hosted rows)
- Modify: `docs/kritik-skill/skill.md` and `plugin-kritik/skills/kritik/SKILL.md` (a "Hosted scoped re-audit" subsection: `kritik_scope` → `kritik_score scope=true commit=<sha>` per cell, including widened cells that didn't move, scored at their current level and saying so → `kritik_matrix audit_id=<returned> record=true commit=<sha>`. State that hosted scoring refuses out-of-scope cells (a workflow guard that keeps a hosted re-audit scoped, not an access control — any `graph:write` caller can resolve findings), and that nothing lands in `docs/quality/`, which is the point for a public repo.)
- Modify: `docs/rfcs/kritik.md` only if it states that hosted scoring is refused (grep `repo-only`/`hosted`). Add a dated note there rather than rewriting history.

Then run `npm run generate` (the skill docs are generated into `plugin/skills/…`) and commit the result.

- [ ] **Step 1:** Write the prose. Then re-read it adversarially as a separate pass (memory: *skill prose is the untested surface*). For every instruction, ask what an agent that follows it literally would do wrong. Specifically check that nothing tells a hosted agent to pass `record=true` without `audit_id`, or to score without `scope=true`, and that nothing still says hosted scoring is refused.
- [ ] **Step 2:** `npm run generate && npm run test:kritik-plugin && npm run validate:seeds`. All clean.
- [ ] **Step 3: Commit:** `docs(kritik): the hosted scoped re-audit loop (#473)`

### Task 16: release bump

**Files:** as in `git show 47bb709 --stat`: `packages/cli/package.json`, `packages/mcp/package.json`, the Kritik skill/plugin version (`plugin-kritik/.claude-plugin/plugin.json` or wherever 0.5.0 lives: `git grep -n '"0.5.0"' plugin-kritik docs/kritik-skill`), the lockfile, and any version test (`tests/mcp/version.test.js`, `tests/cli/version.test.js`).

- [ ] **Step 1:** Bump arkaik and arkaik-mcp 0.6.0 → 0.7.0 and the Kritik skill 0.5.0 → 0.6.0, and update `arkaik-mcp`'s dependency on `arkaik` if it pins it. Run `npm install --package-lock-only` if the lockfile records workspace versions.
- [ ] **Step 2:** `npm run generate && npm run test:mcp && npm run test:cli && npm run test:kritik-plugin`. All pass.
- [ ] **Step 3: Commit:** `chore(release): arkaik + arkaik-mcp 0.7.0, kritik skill 0.6.0`

**Part 3 exit check:** the full list from parts 1 and 2 plus `npm run test:kritik-plugin`, `npx tsc --noEmit -p .`, `npx eslint .`, and `npm run generate` leaving a clean tree.

---

## PRs (controller)

- Part 1 PR: title `Kritik hosted 1: a baseline for a restored audit (#472)`, label `no-lab-note`, body `Closes #472`.
- Part 2 PR: `Kritik hosted 2: the hosted scoped re-audit write path (#473)`, label `no-lab-note`.
- Part 3 PR: `Kritik hosted 3: kritik_score and kritik_matrix record in a hosted session (#473)`, body `Closes #473`, plus a Lab Note (molecule `arkaik`, type `feature`, tags `[kritik, quality]`, no `nodes` unless an id is verified in `seed/arkaik-self-map.json`).
- Link them with `gh stack`, then read each PR's comments after opening.
