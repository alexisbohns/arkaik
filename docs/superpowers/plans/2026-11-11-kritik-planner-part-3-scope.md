# Kritik planner — Part 3: reading plan records — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teach the shared scope code to read a plan record: `recordedAuditIds` returns a plan's parts, and `deriveAuditScope` closes the window per cell (spec rules 1 to 7), so a plan that re-scored six Security cells clears those six and leaves every other stale cell listed — in the CLI, the repo-mode MCP server and the hosted server alike.

**Architecture:** All logic lives in `packages/schema/src/quality-scope.ts`, which stays zod-free and fs-free; its only new runtime import is part 1's pure `readPlanScope` from `./quality-plan`. Five new exports (`isPlanRecord`, `RecordedPlan`, `recordedPlans`, `recordedSinceIds`, `scopeAnchorId`) and two private helpers (`orderedRows`, `anchorIndex`). `deriveAuditScope` keeps its signature; its anchor loop skips plan records, and a per-cell floor (the journal index of the last plan record that re-scored the cell) decides which resolutions count for which cell. No caller changes: the CLI, `packages/mcp/src/kritik-tools.ts` and `lib/services/graph/quality-events.ts` pick the rule up through the shared functions. Tests build plan-record events by hand.

**Tech Stack:** TypeScript (`@arkaik/schema`, raw TS bundled by esbuild into the CLI and MCP), plain Node test scripts loaded through `tests/schema/load-schema.js` and `tests/services/load-quality-events.js` (TypeScript `transpileModule`, CommonJS).

**Spec:** `docs/superpowers/specs/2026-11-11-kritik-planner-design.md` (section "The window closes per cell").

**Contract:** `docs/superpowers/plans/2026-11-11-kritik-planner-stack.md` (authoritative; part 3 row, "`packages/schema/src/quality-scope.ts`" → P3, "The recorded event", test-strategy row 3).

**Branch:** `feat/kritik-plan-scope`, stacked on `feat/kritik-plan-cli` (part 2), which stacks on `feat/kritik-plan-schema` (part 1). Part 4 (`feat/kritik-plan-record`) stacks on this one. Create it with `gh stack` (see the `gh-stack` skill) from the tip of part 2. The stack merges as a unit.

**Must not touch:** `packages/cli`, `packages/mcp`, `lib/` source (tests only), `quality-trend.ts`, `quality-ops.ts`, any version.

---

## Contract deviations

None. Every name and signature below is the contract's. Three details the contract leaves open, decided here and stated so parts 1 and 4 can check them:

1. **`recordedAuditIds` drops non-object rows before ordering.** On `main` it passes raw rows to `orderEvents`, which throws on a `null` row. It now filters first, as `deriveAuditScope` already does. Strictly more lenient; no valid journal changes.
2. **`recordedPlans` returns one entry per plan record**, journal order, no de-duplication. Part 4's "plan already recorded" check only needs `some(...)`.
3. **`resolved_by` for a driving finding is still the latest *named* resolver over the whole window**, not only over the resolutions after the plan. The finding is what drives a cell; which PR closed it is a fact about the finding, and it is the fact the findings board shows (`foldQualityEvents` applies the same rule).

## What this part relies on from parts 1 and 2

- **`readPlanScope(scope: unknown): PlanScopeReading | null`** (part 1, `quality-plan.ts`): non-null iff `scope` is an object with a non-empty string `plan`; `parts` and `scored` are `string[]` (empty when absent). Part 3 still passes them through `stringsOf` where it copies them, so a looser reader cannot leak a non-string.
- **Part 1's import line in `quality-scope.ts`.** Part 1 adds `import { … } from "./quality-plan";` for its candidate rule. Task 2 adds `readPlanScope` to that line. `quality-plan.ts` must not import `quality-scope.ts` (it does not in the contract; an import cycle would still work under CommonJS and esbuild, but there is no reason for one).
- **Part 1's `scopedAuditId` candidate rule** (a scoped id after a plan part is `<partId>-scoped`). Task 3's hosted case asserts it end to end; it passes only with part 1 underneath.
- Part 2 changes nothing this part reads.

## How the rule is implemented

`deriveAuditScope` (`quality-scope.ts:145-342` on `main`) runs in eight phases. The seven rules land as follows.

**Phase A — order (`:151`).** `orderEvents` over the object rows: by `ts` as a raw string, then by `id`. This order is the only one used anywhere in the function, and the rules use it too: "after" always means *a strictly greater index in `ordered`*. A plan record and a resolution with the same `ts` are ordered by event id, exactly as the trend and the implicit baseline order them. The new private helper `orderedRows(events)` is this line, shared with the readers so `recordedAuditIds`, `recordedPlans`, `scopeAnchorId` and the scope all read one order.

**Phase B — the anchor (`:153-161`), rule 1.** The loop moves into a private `anchorIndex(ordered, since)`: walk back from the end, skip anything that is not a `quality.audit.completed`, **skip every plan record** (`isPlanRecord`), and return the newest match (or the newest recording of `since` when named). `scopeAnchorId(events)` is `anchorIndex(orderedRows(events), undefined)` mapped to its `audit_id` (`null` when none, or when the record has no string id), so the `since` part 4 writes on a plan record is, by construction, the `since` an unscoped scope measures from. `options.since` naming a plan id or a part id matches no non-plan record, so it returns the existing `empty` scope with `since` set to the requested id and `since_ts: null` — the same shape as an unrecorded `since` today. A journal whose only records are plans has no anchor: `since: null`, no cells.

**Phase C — empty / anchor fields (`:163-178`).** Unchanged.

**New phase C′ — the per-cell floor, rule 2.** One forward pass over `ordered` after the anchor builds `planFloor: Map<cellKey, index>`: for each plan record at index `i`, every key in its `scored` is set to `i`. Later records overwrite earlier ones, so the map holds **the last plan record that scored each cell**. `floorOf(key) = planFloor.get(key) ?? sinceIndex`. A plan record at or before the anchor needs no entry: the anchor's index is already higher, so it can clear nothing the anchor has not. A resolution at index `r` counts for cell `k` iff `r > floorOf(k)`.

**Phase D — resolutions (`:180-194`), several resolutions per finding.** Still one `Map` entry per finding, in first-resolution order (so `findings` keeps today's order). The entry now carries `last`, the index of the finding's **latest** resolution, and `nodes: Map<nodeId, index>`, each node id an event carried mapped to the index of the latest event of this finding that carried it. A finding counts for a cell iff `last > floorOf(cell)`. That is the same as "at least one of its resolutions is after the floor", because the latest one is the greatest index. `resolved_by` is unchanged (latest named wins; decision 3 above).

**Phase E — lookups (`:196-242`).** Unchanged: `findingById`, `criterionById`, `assessmentByCell`, `surfaces`, `scorable`.

**Phase F — direct cells (`:244-284`), rules 3, 4, 6 and 7.**
- `unknown` (no finding) and the accepted-risk / refuted skip are unchanged.
- `targets` is still the finding's surface, or every declared surface for `cross-surface`, filtered by `scorable`. An empty `targets` still goes to `unscorable`, whatever the floors say: a cell `score` refuses is never in a plan's `scored` (plan cells come from `applicableCells`), so no plan can have re-scored it.
- New: `live = targets.filter(surface => last > floorOf(cellKey(criterion, surface)))`. **Rule 3:** only `live` cells get the finding in their `because`; a cell whose every finding is below its floor is never created. **Rule 4:** the filter runs per fanned-out surface, so a plan that re-scored `SEC-01::web` drops web and keeps `ios` and `supabase` from the same cross-surface finding. **Rule 6** needs no code: a resolution after the floor is above it, so the cell is listed again, with `because` holding only the findings after the plan and `current` read from the section as always (the part's score).
- **Rule 7:** a finding with no `live` cell is `continue`d before `drivers.push` and before `resolvedBy[...] =`, so `findings` and `resolved_by` hold exactly the findings that drive a listed direct cell. `unknown` and `unscorable` are computed before the floor is consulted, as today.
- **Node ids (rule 5's input).** `resolvedNodes` becomes `Map<nodeId, index>`, kept at the **maximum** index by `touch(node, index)`. For every known, non-accepted finding — drivers, non-drivers and unscorable ones alike, as today — the finding's own `node_ids` are touched at `last`, and each event-carried node at its own event's index. A node's fact ("a fix touched it at index r") does not depend on whether the finding's own cell still counts.

**Phase G — widening (`:286-321`), rule 5.** Unchanged except the filter: a candidate cell `k` shares node `n` iff `resolvedNodes.get(n) > floorOf(k)`. Since the map holds the greatest index of any resolution that touched `n`, this is true iff some resolution touching `n` is after `k`'s floor, which is exactly "a node counts for a cell only through resolutions that count for that cell under rule 2". Consequences, each tested: a widened cell the plan re-scored leaves; a widened cell it did not re-score stays even when the direct cell that pulled it in was cleared; a later fix touching one of its nodes brings it back; a node carried on an event before the plan does not come back just because the same finding was resolved again after it without that node.

**Phase H — `current`, sort, return (`:323-341`).** Unchanged. `widened` counts the hop's cells and `scopeSummary` reads the filtered lists, so the summary follows.

**A full record or a scoped re-audit's record** is not a plan record, so it becomes the anchor; every floor is then at or below it, and everything before it is cleared, as today.

**A journal with no plan record** has an empty `planFloor`, so `floorOf` is `sinceIndex` for every cell; every resolution after the anchor has a greater index, so `live === targets` and every touched node passes the widening filter. The output is identical to `main`'s; Task 1 pins it byte for byte before any code changes.

**Readers.** `isPlanRecord(event)`: an object, `type === "quality.audit.completed"`, `readPlanScope(event.scope) !== null`. `recordedAuditIds`: each record's `audit_id`, then each of its `parts`, each id once, journal order. `recordedSinceIds`: `recordedAuditIds` over the rows that are not plan records. `recordedPlans`: one `{ plan, parts, scored, ts }` per plan record, journal order.

## Between this part and part 4

`recordedAuditIds` returning parts reaches the CLI and MCP with no code change there: `score --audit <partId>` warns "already recorded", hosted `audit_id` into a part is refused, and hosted completion of a part id is `already_recorded` — all intended. Two reads stay loose until part 4 wires `recordedSinceIds`: `declaredScopeSince(auditId, recordedAuditIds(...))` (`kritik.ts:837`, `kritik-tools.ts:626`) could name a part as a hand-declared scope's `since`, and `kritik scope --since <planId>` passes the recorded check and prints an empty scope instead of a refusal. Neither is reachable before part 4, because nothing can write a plan record until then, and the stack merges as a unit.

---

## File map

- Modify `packages/schema/src/quality-scope.ts` — header; import `readPlanScope`; `orderedRows`, `isPlanRecord`, `RecordedPlan`, `recordedPlans`, `recordedAuditIds`, `recordedSinceIds`, `anchorIndex`, `scopeAnchorId`; `deriveAuditScope` (rules 1 to 7); doc comments on `AuditScope.since` and `AuditScopeOptions.since`.
- Modify `tests/schema/quality-scope.test.js` — `audit()` helper takes a payload; destructure the new exports; blocks: no-plan golden pin, readers, rule 1, rules 2/3/4/6/7, rule 5.
- Modify `tests/services/quality-events.test.js` — one hosted block: a journal holding a plan record.
- No change to `packages/schema/src/index.ts` (it already has `export * from "./quality-scope"`), `package.json` (`test:quality-scope` and `test:quality-events` exist) or `.github/workflows/ci.yml` (the `build` job already runs both, `ci.yml:168` and `:193`). No test loader changes: `load-schema.js` discovers modules, and `lib/services/graph/quality-events.ts` gains no import.
- No generated artifact should change; Task 7 checks it.

## Traps that apply here

- **Node 20 in CI, Node 26 locally.** Every new check goes through `loadSchema()` / `loadQualityEvents()`; never `require` a `.ts` file. Use only syntax Node 20 runs (nothing below needs more than ES2020).
- **Hand-maintained alias rewrites.** `tests/services/load-quality-events.js` rewrites only `@arkaik/schema` and `@/lib/utils/quality`. This part adds no import to `lib/services/graph/quality-events.ts`; the hosted test uses the `schema` and `foldQualityEvents` handles the suite already builds (`quality-events.test.js:354-357`).
- **`export *` collisions.** Before Task 2, run `grep -rn "isPlanRecord\|recordedPlans\|RecordedPlan\|recordedSinceIds\|scopeAnchorId" packages/schema/src` — expect no hit outside `quality-scope.ts` (checked on `main`; re-check on top of parts 1 and 2). A duplicate fails `tsc`.
- **zod-free, fs-free.** `quality-scope.ts` may import from `./journal`, `./quality` and `./quality-plan` only. Task 7 greps for it.
- **Lint and typecheck gate CI.** `npm run lint` and `npx tsc --noEmit -p .` after each implementation step that touches TypeScript. `tests/**` is lint-ignored.
- **Generated-artifact drift.** No plugin script calls a function this part changes (`plugin-kritik/skills/kritik/scripts/*.js` contain no trace of `quality-scope.ts`), so `npm run generate` must leave the tree clean. If it does not, a top-level call has crept into a plugin-reachable module.
- **Source-asserting suites.** None reads `quality-scope.ts` as text (contract, "Known traps").
- **The suites print, they do not throw.** Each check prints `PASS:`/`FAIL:`; the exit code is the verdict. Read the `FAIL:` lines, not only the last line.

---

### Task 1: Pin the scope of a journal with no plan record

A characterization test, written before any code moves: the two literals below were printed by `deriveAuditScope` on `main` over this exact journal (a July audit, a scoped re-audit's record, a re-resolved finding, an unknown id, a retired criterion, an accepted risk, a cross-surface finding, event-carried node ids, shuffled input). Every later task must leave them byte-identical. It passes on first run; that is its point.

**Files:**
- Modify: `tests/schema/quality-scope.test.js`

- [ ] **Step 1: Let the `audit()` helper carry a payload**

In `tests/schema/quality-scope.test.js`:

Replace:

```js
const audit = (auditId, ts) => ev("quality.audit.completed", ts, { audit_id: auditId, framework_version: "1.0.0" });
```

with:

```js
const audit = (auditId, ts, payload = {}) => ev("quality.audit.completed", ts, { audit_id: auditId, framework_version: "1.0.0", ...payload });
```

- [ ] **Step 2: Write the pin**

Insert directly above the line `// --- scopedAuditId (issue #473): the shared naming rule ----------------------`:

```js
// --- no plan record: exactly as before ------------------------------------------
//
// The two literals were printed by deriveAuditScope on main, before the planner
// existed, over this same journal: a July audit, a scoped re-audit's
// record, a re-resolved finding, an unknown id, a retired criterion, an
// accepted risk, a cross-surface finding and event-carried node ids. Every
// change the planner makes to the scope must leave them byte-identical.

const NO_PLAN_JOURNAL = [
  audit("2026-07", "2026-07-31T00:00:00.000Z"),
  resolved("F-7", "2026-08-05T00:00:00.000Z"),
  audit("2026-08", "2026-08-31T00:00:00.000Z"),
  audit("2026-09-scoped", "2026-09-01T00:00:00.000Z", { scope: { partial: true, cells: 1, since: "2026-08" } }),
  resolved("F-1", "2026-09-02T00:00:00.000Z", { resolved_by: "https://pr/1" }),
  resolved("F-3", "2026-09-03T00:00:00.000Z", { node_ids: ["V-login"] }),
  resolved("F-4", "2026-09-04T00:00:00.000Z"),
  resolved("F-5", "2026-09-05T00:00:00.000Z"),
  resolved("F-404", "2026-09-06T00:00:00.000Z"),
  resolved("F-6", "2026-09-07T00:00:00.000Z", { resolved_by: "https://pr/6" }),
  resolved("F-1", "2026-09-08T00:00:00.000Z"),
];
const NO_PLAN_SHUFFLED = [...NO_PLAN_JOURNAL].reverse();
const GOLDEN_DEFAULT =
  "{\"since\":\"2026-09-scoped\",\"since_ts\":\"2026-09-01T00:00:00.000Z\",\"cells\":[{\"criterion_id\":\"SEC-01\",\"surface\":\"web\",\"kind\":\"direct\",\"because\":[\"F-1\",\"F-6\"],\"current\":{\"level\":2,\"audit_id\":\"2026-08\"}},{\"criterion_id\":\"SEC-03\",\"surface\":\"web\",\"kind\":\"widened\",\"because\":[\"V-home\",\"V-login\"],\"current\":{\"level\":1,\"audit_id\":\"2026-08\"}},{\"criterion_id\":\"A11Y-01\",\"surface\":\"ios\",\"kind\":\"direct\",\"because\":[\"F-3\"],\"current\":{\"level\":3,\"audit_id\":\"2026-08\"}},{\"criterion_id\":\"SEC-01\",\"surface\":\"ios\",\"kind\":\"direct\",\"because\":[\"F-6\"],\"current\":{\"level\":2,\"audit_id\":\"2026-08\"}},{\"criterion_id\":\"A11Y-02\",\"surface\":\"supabase\",\"kind\":\"widened\",\"because\":[\"V-login\"],\"current\":{\"level\":2,\"audit_id\":\"2026-08\"}},{\"criterion_id\":\"SEC-01\",\"surface\":\"supabase\",\"kind\":\"direct\",\"because\":[\"F-6\"]}],\"findings\":[\"F-1\",\"F-3\",\"F-6\"],\"resolved_by\":{\"F-1\":\"https://pr/1\",\"F-6\":\"https://pr/6\"},\"unknown\":[\"F-404\"],\"unscorable\":[\"F-4\"],\"widened\":2}";
const GOLDEN_SINCE_JULY =
  "{\"since\":\"2026-07\",\"since_ts\":\"2026-07-31T00:00:00.000Z\",\"cells\":[{\"criterion_id\":\"SEC-01\",\"surface\":\"web\",\"kind\":\"direct\",\"because\":[\"F-1\",\"F-6\"],\"current\":{\"level\":2,\"audit_id\":\"2026-08\"}},{\"criterion_id\":\"SEC-03\",\"surface\":\"web\",\"kind\":\"widened\",\"because\":[\"V-home\",\"V-login\"],\"current\":{\"level\":1,\"audit_id\":\"2026-08\"}},{\"criterion_id\":\"A11Y-01\",\"surface\":\"ios\",\"kind\":\"direct\",\"because\":[\"F-3\"],\"current\":{\"level\":3,\"audit_id\":\"2026-08\"}},{\"criterion_id\":\"SEC-01\",\"surface\":\"ios\",\"kind\":\"direct\",\"because\":[\"F-6\"],\"current\":{\"level\":2,\"audit_id\":\"2026-08\"}},{\"criterion_id\":\"A11Y-02\",\"surface\":\"supabase\",\"kind\":\"direct\",\"because\":[\"F-7\"],\"current\":{\"level\":2,\"audit_id\":\"2026-08\"}},{\"criterion_id\":\"SEC-01\",\"surface\":\"supabase\",\"kind\":\"direct\",\"because\":[\"F-6\"]}],\"findings\":[\"F-7\",\"F-1\",\"F-3\",\"F-6\"],\"resolved_by\":{\"F-1\":\"https://pr/1\",\"F-6\":\"https://pr/6\"},\"unknown\":[\"F-404\"],\"unscorable\":[\"F-4\"],\"widened\":1}";

{
  check(
    "no plan record: the default scope is byte-identical to main's",
    JSON.stringify(deriveAuditScope(NO_PLAN_SHUFFLED, SECTION, LIBRARY)) === GOLDEN_DEFAULT,
    JSON.stringify(deriveAuditScope(NO_PLAN_SHUFFLED, SECTION, LIBRARY)),
  );
  check(
    "no plan record: an explicit since is byte-identical to main's",
    JSON.stringify(deriveAuditScope(NO_PLAN_SHUFFLED, SECTION, LIBRARY, { since: "2026-07" })) === GOLDEN_SINCE_JULY,
    JSON.stringify(deriveAuditScope(NO_PLAN_SHUFFLED, SECTION, LIBRARY, { since: "2026-07" })),
  );
  check(
    "no plan record: recordedAuditIds is unchanged",
    recordedAuditIds(NO_PLAN_SHUFFLED).join() === "2026-07,2026-08,2026-09-scoped",
    recordedAuditIds(NO_PLAN_SHUFFLED).join(),
  );
}
```

- [ ] **Step 3: Run it**

Run: `npm run test:quality-scope`
Expected: PASS — the three `no plan record:` checks print `PASS:`, the suite ends `All quality-scope checks passed.`, exit 0. If either golden check fails here, stop and report it: parts 1 or 2 already changed the scope of a journal with no plan record, which the contract does not allow. Do not edit the literals to match.

- [ ] **Step 4: Commit**

```bash
git add tests/schema/quality-scope.test.js
git commit -m "test(kritik): pin the scope of a journal with no plan record"
```

---

### Task 2: Read plan records — parts count as recorded

**Files:**
- Modify: `packages/schema/src/quality-scope.ts`
- Modify: `tests/schema/quality-scope.test.js`

- [ ] **Step 1: Write the failing test**

Check for name collisions first (trap above):

Run: `grep -rn "isPlanRecord\|recordedPlans\|RecordedPlan\|recordedSinceIds\|scopeAnchorId" packages/schema/src`
Expected: no output.

In `tests/schema/quality-scope.test.js`, add `isPlanRecord`, `recordedPlans` and `recordedSinceIds` to the `loadSchema()` destructuring. On `main` the line is `const { deriveAuditScope, recordedAuditIds, scopeSummary, scopedAuditId } = loadSchema();`; keep any name part 1 added and write it as:

```js
const {
  deriveAuditScope,
  isPlanRecord,
  recordedAuditIds,
  recordedPlans,
  recordedSinceIds,
  scopeSummary,
  scopedAuditId,
} = loadSchema();
```

Then insert directly above the line `// --- scopedAuditId (issue #473): the shared naming rule ----------------------`:

```js
// --- plan records (the Kritik planner): reading them ----------------------------
//
// A plan record is a `quality.audit.completed` whose `scope` names a plan
// (stack contract, "The recorded event"). Built by hand here: this suite needs
// only the event's shape, not the command that writes it.

const PLAN = "2026-09-zplan-1000";
const PART_SEC_WEB = `${PLAN}-sec-web`;
const PART_A11Y_IOS = `${PLAN}-a11y-ios`;
const planRecord = (planId, ts, scored, parts = [`${planId}-sec-web`]) =>
  audit(planId, ts, {
    scope: {
      partial: true,
      cells: scored.length,
      since: "2026-08",
      plan: planId,
      parts,
      scored,
      coverage: { scored: scored.length, assessed: 7, applicable: 12, surfaces: { web: { assessed: 4, applicable: 5 } } },
    },
  });
const T = (day, hour = 0) => `2026-09-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00.000Z`;
const AUG = () => audit("2026-08", "2026-08-31T00:00:00.000Z");

{
  const record = planRecord(PLAN, T(10), ["SEC-01::web", "A11Y-01::ios"], [PART_SEC_WEB, PART_A11Y_IOS]);
  const scopedRecord = audit("2026-09-scoped", T(11), { scope: { partial: true, cells: 1, since: "2026-08" } });
  check("a plan record is one", isPlanRecord(record) === true);
  check("a scoped re-audit's record is not a plan record", isPlanRecord(scopedRecord) === false);
  check("a plain record is not a plan record", isPlanRecord(AUG()) === false);
  check("a scope.plan on any other event type is not a plan record", isPlanRecord(resolved("F-1", T(10), { scope: { plan: PLAN } })) === false);
  check(
    "an empty or missing plan id is not a plan record, and nothing malformed throws",
    [null, undefined, 7, "x", {}, audit(PLAN, T(10), { scope: { plan: "" } }), audit(PLAN, T(10), { scope: null })].every(
      (value) => isPlanRecord(value) === false,
    ),
  );

  const journal = [record, AUG(), scopedRecord];
  check(
    "recordedAuditIds returns each plan record's parts right after its plan id",
    recordedAuditIds(journal).join() === `2026-08,${PLAN},${PART_SEC_WEB},${PART_A11Y_IOS},2026-09-scoped`,
    recordedAuditIds(journal).join(),
  );
  check(
    "a part named by two records is listed once",
    recordedAuditIds([...journal, planRecord("2026-09-zplan-1100", T(12), ["SEC-03::web"], [PART_SEC_WEB])]).join() ===
      `2026-08,${PLAN},${PART_SEC_WEB},${PART_A11Y_IOS},2026-09-scoped,2026-09-zplan-1100`,
  );
  check("recordedSinceIds leaves plan ids and part ids out", recordedSinceIds(journal).join() === "2026-08,2026-09-scoped", recordedSinceIds(journal).join());

  const plans = recordedPlans(journal);
  check(
    "recordedPlans reads the plan, its parts, its scored cells and when",
    plans.length === 1 &&
      plans[0].plan === PLAN &&
      plans[0].parts.join() === `${PART_SEC_WEB},${PART_A11Y_IOS}` &&
      plans[0].scored.join() === "SEC-01::web,A11Y-01::ios" &&
      plans[0].ts === T(10),
    JSON.stringify(plans),
  );
  check(
    "recordedPlans keeps journal order, not array order",
    recordedPlans([planRecord("2026-09-zplan-1100", T(12), ["SEC-03::web"]), record]).map((plan) => plan.plan).join() ===
      `${PLAN},2026-09-zplan-1100`,
  );
  check("the readers never throw on malformed rows", recordedAuditIds([null, 7, record]).join() === `${PLAN},${PART_SEC_WEB},${PART_A11Y_IOS}`);

  check("no plan record: recordedPlans is empty", recordedPlans(NO_PLAN_SHUFFLED).length === 0);
  check(
    "no plan record: recordedSinceIds equals recordedAuditIds",
    recordedSinceIds(NO_PLAN_SHUFFLED).join() === recordedAuditIds(NO_PLAN_SHUFFLED).join(),
  );
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:quality-scope`
Expected: FAIL, exit 1 — the Task 1 checks pass, then the suite aborts with `TypeError: isPlanRecord is not a function`.

- [ ] **Step 3: Implement the readers**

In `packages/schema/src/quality-scope.ts`, add `readPlanScope` to the import from `./quality-plan` that part 1 added — for example `import { isPlanPartId } from "./quality-plan";` becomes `import { isPlanPartId, readPlanScope } from "./quality-plan";` (keep every name part 1 imports). If part 1 left no such import, add this line directly below the `} from "./quality";` line:

```ts
import { readPlanScope } from "./quality-plan";
```

Then make these two replacements.

Replace:

```ts
 * Same two disciplines as `quality-regressions.ts` and `quality-trend.ts`:
 * zod-free and fs-free (the runtime imports are `orderEvents` and a constant),
 * and nothing mutates its input. Lenient and total: no events, no recorded
 * audit, no findings — each is an empty scope, never a throw. A scope is a
 * plan; refusing to produce one would only send the auditor back to the
 * comprehensive audit this exists to spare them.
 */
```

with:

```ts
 * **A plan record closes the window per cell** (the Kritik planner, spec "The
 * window closes per cell"). A `quality.audit.completed` whose `scope` names a
 * plan re-scored a known list of cells and nothing else, so it is never the
 * audit a scope is measured from, and it clears only the cells it lists.
 *
 * Same two disciplines as `quality-regressions.ts` and `quality-trend.ts`:
 * zod-free and fs-free (the runtime imports are `orderEvents`, a constant and
 * `quality-plan.ts`'s pure readers), and nothing mutates its input. Lenient and
 * total: no events, no recorded audit, no findings — each is an empty scope,
 * never a throw. A scope is a plan; refusing to produce one would only send the
 * auditor back to the comprehensive audit this exists to spare them.
 */
```

Replace:

```ts
/** Same `criterion::surface` key `quality-regressions.ts` uses, for the same reasons. */
const cellKey = (criterionId: string, surface: string): string => `${criterionId}::${surface}`;

/**
 * Every audit id the journal has a `quality.audit.completed` for, in recording
 * order, each once. What a caller names in the refusal when `since` asks for an
 * audit that was never recorded.
 */
export function recordedAuditIds(events: readonly JournalEvent[]): string[] {
  const ids: string[] = [];
  for (const event of orderEvents(rowsOf<JournalEvent>(events))) {
    if (event?.type !== "quality.audit.completed") continue;
    const id = (event as { audit_id?: unknown }).audit_id;
    if (isString(id) && !ids.includes(id)) ids.push(id);
  }
  return ids;
}
```

with:

```ts
/** Same `criterion::surface` key `quality-regressions.ts` uses, for the same reasons. */
const cellKey = (criterionId: string, surface: string): string => `${criterionId}::${surface}`;

/** The journal's object rows in `orderEvents` order — the one order every reader here uses. */
const orderedRows = (events: readonly JournalEvent[] | null | undefined): JournalEvent[] =>
  orderEvents(rowsOf<JournalEvent>(events).filter((event) => typeof event === "object" && event !== null));

/**
 * Whether `event` is a plan record: a `quality.audit.completed` whose `scope`
 * names a plan (`matrix <planId> --record --plan`). Lenient: anything else,
 * malformed rows included, is not one.
 */
export function isPlanRecord(event: unknown): boolean {
  if (typeof event !== "object" || event === null) return false;
  const { type, scope } = event as { type?: unknown; scope?: unknown };
  return type === "quality.audit.completed" && readPlanScope(scope) !== null;
}

/** One recorded plan, as its event carries it. */
export interface RecordedPlan {
  plan: string;
  /** The plan's part ids, plan order. */
  parts: string[];
  /** `criterion::surface` per cell the plan re-scored. */
  scored: string[];
  /** When it was recorded; `null` for a row with no `ts`. */
  ts: string | null;
}

/** Every plan record in the journal, in journal order, one entry per record. */
export function recordedPlans(events: readonly JournalEvent[]): RecordedPlan[] {
  const plans: RecordedPlan[] = [];
  for (const event of orderedRows(events)) {
    if (event.type !== "quality.audit.completed") continue;
    const reading = readPlanScope((event as { scope?: unknown }).scope);
    if (reading === null) continue;
    plans.push({ plan: reading.plan, parts: stringsOf(reading.parts), scored: stringsOf(reading.scored), ts: isString(event.ts) ? event.ts : null });
  }
  return plans;
}

/**
 * Every audit id the journal has a `quality.audit.completed` for, in recording
 * order, each once. What a caller names in the refusal when `since` asks for an
 * audit that was never recorded.
 *
 * A plan record's parts follow its plan id: each part is an audit directory
 * whose reading the plan recorded, so a score written into one after the
 * record would silently rewrite history — every guard that asks "is this id
 * recorded?" has to see them.
 */
export function recordedAuditIds(events: readonly JournalEvent[]): string[] {
  const ids: string[] = [];
  const note = (id: unknown) => {
    if (isString(id) && !ids.includes(id)) ids.push(id);
  };
  for (const event of orderedRows(events)) {
    if (event.type !== "quality.audit.completed") continue;
    note((event as { audit_id?: unknown }).audit_id);
    for (const part of readPlanScope((event as { scope?: unknown }).scope)?.parts ?? []) note(part);
  }
  return ids;
}

/**
 * {@link recordedAuditIds} over the records a scope can be measured from: every
 * one but a plan record, so neither a plan id nor a part id is ever offered as
 * a `since`.
 */
export function recordedSinceIds(events: readonly JournalEvent[]): string[] {
  return recordedAuditIds(rowsOf<JournalEvent>(events).filter((event) => !isPlanRecord(event)));
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm run test:quality-scope && npm run test:quality-baseline && npx tsc --noEmit -p . && npm run lint`
Expected: PASS — `All quality-scope checks passed.`, `All checks passed`, no `tsc` output, no lint error.

- [ ] **Step 5: Commit**

```bash
git add packages/schema/src/quality-scope.ts tests/schema/quality-scope.test.js
git commit -m "feat(kritik): read plan records, and count a plan's parts as recorded"
```

---

### Task 3: The hosted case, written first

The hosted write path calls `deriveAuditScope` and `recordedAuditIds` (`quality-events.ts:401`, `:425`, `:475`, `:487`). This case pins all of part 3 through it: the score on the cell the plan re-scored is refused `out_of_scope`, the other stale cell is accepted, and the scoped audit it opens is `<partId>-scoped` (part 1's candidate rule, fed by part 3's `recordedAuditIds`). It stays red until Task 5 and is committed there.

**Files:**
- Modify: `tests/services/quality-events.test.js`

- [ ] **Step 1: Write the failing test**

Insert directly above the line `// --- requiredScopeFor --------------------------------------------------------` (the block uses `RESTORED`, `RESOLUTION`, `RESOLUTION_2`, `SCORE`, `COMPLETE`, `NOW`, `LIB`, `schema`, `foldQualityEvents`, `typesOf`, `reasonsOf` and `detailOf`, all defined earlier in the file):

```js
// --- the Kritik planner, part 3: a plan record in a hosted journal ------------
//
// Hosted sessions cannot record a plan, but a project restored from a repo that
// has one reads it. The journal below: the 2026-08 audit recorded, F-1 (SEC-01)
// and F-2 (SEC-02) resolved after it, then a plan that re-scored SEC-01 on web.
// The plan record is built by hand — this suite needs only its shape.
{
  const PLAN_ID = "2026-09-zplan-1000";
  const PART_ID = `${PLAN_ID}-sec-web`;
  const RECORDED = {
    id: "01K0000000000000000000AUD1", ts: "2026-08-15T00:00:00.000Z", type: "quality.audit.completed",
    audit_id: "2026-08", framework_version: "1.0.0", scores: {}, counts: {},
  };
  const PLAN_RECORD = {
    id: "01K0000000000000000000PLN1", ts: "2026-09-10T00:00:00.000Z", type: "quality.audit.completed",
    audit_id: PLAN_ID, framework_version: "1.0.0", scores: {}, counts: {},
    scope: {
      partial: true, cells: 1, since: "2026-08", plan: PLAN_ID, parts: [PART_ID], scored: ["SEC-01::web"],
      coverage: { scored: 1, assessed: 2, applicable: 2, surfaces: { web: { assessed: 2, applicable: 2 } } },
    },
  };
  const JOURNAL = [RECORDED, RESOLUTION, RESOLUTION_2, PLAN_RECORD];
  // The restored section carries the part's re-score of SEC-01 on web.
  const AFTER_PLAN = () =>
    RESTORED({
      assessments: [
        { criterion_id: "SEC-01", surface: "web", level: 3, evidence: "e1", audit_id: PART_ID, ts: "2026-09-05T00:00:00.000Z" },
        { criterion_id: "SEC-02", surface: "web", level: 2, evidence: "e2", audit_id: "2026-08", ts: "2026-08-10T00:00:00.000Z" },
      ],
    });

  const scope = schema.deriveAuditScope(JOURNAL, foldQualityEvents(AFTER_PLAN(), JOURNAL), LIB);
  check("plan record (hosted): the scope is measured from the recorded audit, not the plan", scope.since === "2026-08", JSON.stringify(scope));
  check(
    "plan record (hosted): it lists the stale cell the plan did not re-score, and only that one",
    scope.cells.map((cell) => `${cell.surface}:${cell.criterion_id}`).join() === "web:SEC-02",
    JSON.stringify(scope.cells),
  );

  const rescored = planQualityEvents(AFTER_PLAN(), JOURNAL, [SCORE()], "arkaik-agent", NOW);
  check("plan record (hosted): a score on the cell the plan re-scored refuses out_of_scope", reasonsOf(rescored) === "out_of_scope", JSON.stringify(rescored));
  check("plan record (hosted): the refusal names the non-plan audit", detailOf(rescored).includes("since 2026-08"), detailOf(rescored));

  const other = planQualityEvents(AFTER_PLAN(), JOURNAL, [SCORE({ criterion_id: "SEC-02" })], "arkaik-agent", NOW);
  check("plan record (hosted): a score on the other stale cell is accepted, with no baseline", typesOf(other) === "quality.assessment.scored", typesOf(other));
  check(
    "plan record (hosted): in a month holding a plan, it lands in <partId>-scoped, measured from 2026-08",
    other.ok && other.events[0].audit_id === `${PART_ID}-scoped` && other.events[0].scope?.since === "2026-08",
    JSON.stringify(other),
  );

  // Without the part's assessment in the section, only the journal names the
  // part — so this holds only because recordedAuditIds returns a plan's parts.
  const journalOnly = planQualityEvents(RESTORED(), JOURNAL, [SCORE({ criterion_id: "SEC-02" })], "arkaik-agent", NOW);
  check(
    "plan record (hosted): the part id reaches the naming rule through recordedAuditIds alone",
    journalOnly.ok && journalOnly.events[0].audit_id === `${PART_ID}-scoped`,
    JSON.stringify(journalOnly),
  );

  const intoPart = planQualityEvents(AFTER_PLAN(), JOURNAL, [SCORE({ criterion_id: "SEC-02", audit_id: PART_ID })], "arkaik-agent", NOW);
  check(
    "plan record (hosted): a score asked into a recorded plan's part refuses audit_id_conflict",
    reasonsOf(intoPart) === "audit_id_conflict" && detailOf(intoPart).includes("already recorded"),
    JSON.stringify(intoPart),
  );
  const completePart = planQualityEvents(AFTER_PLAN(), JOURNAL, [COMPLETE(PART_ID)], "arkaik-agent", NOW);
  check("plan record (hosted): completing a recorded plan's part refuses already_recorded", reasonsOf(completePart) === "already_recorded", JSON.stringify(completePart));

  const both = planQualityEvents(AFTER_PLAN(), JOURNAL, [SCORE({ criterion_id: "SEC-02" }), COMPLETE(`${PART_ID}-scoped`)], "arkaik-agent", NOW);
  check(
    "plan record (hosted): score and complete in one batch record a scoped reading from 2026-08",
    typesOf(both) === "quality.assessment.scored,quality.audit.completed" &&
      JSON.stringify(both.events[1].scope) === JSON.stringify({ partial: true, cells: 1, since: "2026-08" }),
    JSON.stringify(both),
  );
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:quality-events`
Expected: FAIL, exit 1, with these eight `FAIL:` lines (the plan record is still read as the anchor, so the scope is empty):

  - `FAIL: plan record (hosted): the scope is measured from the recorded audit, not the plan`
  - `FAIL: plan record (hosted): it lists the stale cell the plan did not re-score, and only that one`
  - `FAIL: plan record (hosted): the refusal names the non-plan audit`
  - `FAIL: plan record (hosted): a score on the other stale cell is accepted, with no baseline`
  - `FAIL: plan record (hosted): in a month holding a plan, it lands in <partId>-scoped, measured from 2026-08`
  - `FAIL: plan record (hosted): the part id reaches the naming rule through recordedAuditIds alone`
  - `FAIL: plan record (hosted): a score asked into a recorded plan's part refuses audit_id_conflict`
  - `FAIL: plan record (hosted): score and complete in one batch record a scoped reading from 2026-08`

- [ ] **Step 3: Leave it uncommitted**

Do not commit. Tasks 4 and 5 stage only their own files; Task 5 commits this one once it is green.

---

### Task 4: Rule 1 — a plan record is never the audit a scope is measured from

**Files:**
- Modify: `packages/schema/src/quality-scope.ts`
- Modify: `tests/schema/quality-scope.test.js`

- [ ] **Step 1: Write the failing test**

Add `scopeAnchorId` to the `loadSchema()` destructuring, after `recordedSinceIds`:

```js
  recordedSinceIds,
  scopeAnchorId,
  scopeSummary,
```

Insert directly above the line `// --- scopedAuditId (issue #473): the shared naming rule ----------------------`:

```js
// --- rule 1: a plan record is never the audit a scope is measured from ---------

{
  const events = [AUG(), resolved("F-1", T(2)), planRecord(PLAN, T(10), ["A11Y-01::ios"])];
  const scope = deriveAuditScope(events, SECTION, LIBRARY, { widen: false });
  check("rule 1: since skips the plan record", scope.since === "2026-08" && scope.since_ts === "2026-08-31T00:00:00.000Z", JSON.stringify(scope));
  check("rule 1: a fix before the plan still counts for a cell the plan did not re-score", cellIds(scope).join() === "web:SEC-01:direct", cellIds(scope).join());
  check("rule 1: scopeAnchorId names the same audit", scopeAnchorId(events) === "2026-08", String(scopeAnchorId(events)));

  const onlyPlans = [planRecord(PLAN, T(10), ["SEC-01::web"]), resolved("F-3", T(11))];
  const first = deriveAuditScope(onlyPlans, SECTION, LIBRARY);
  check(
    "rule 1: with only plan records there is nothing to measure from — an empty scope",
    first.since === null && first.since_ts === null && first.cells.length === 0 && first.findings.length === 0,
    JSON.stringify(first),
  );
  check("rule 1: scopeAnchorId is null with only plan records", scopeAnchorId(onlyPlans) === null);

  const byPlan = deriveAuditScope(events, SECTION, LIBRARY, { since: PLAN });
  check("rule 1: since naming a plan finds no anchor", byPlan.since === PLAN && byPlan.since_ts === null && byPlan.cells.length === 0, JSON.stringify(byPlan));
  const byPart = deriveAuditScope(events, SECTION, LIBRARY, { since: PART_SEC_WEB });
  check("rule 1: nor does since naming a part", byPart.since === PART_SEC_WEB && byPart.since_ts === null && byPart.cells.length === 0, JSON.stringify(byPart));

  check("no plan record: scopeAnchorId is the scope's since", scopeAnchorId(NO_PLAN_SHUFFLED) === "2026-09-scoped");
  check("scopeAnchorId of nothing is null, never a throw", scopeAnchorId([]) === null && scopeAnchorId(null) === null && scopeAnchorId([null, 7]) === null);
  check(
    "a plan record that re-scored nothing changes nothing",
    JSON.stringify(deriveAuditScope([...NO_PLAN_JOURNAL, planRecord(PLAN, "2026-09-09T00:00:00.000Z", [])], SECTION, LIBRARY)) === GOLDEN_DEFAULT,
    JSON.stringify(deriveAuditScope([...NO_PLAN_JOURNAL, planRecord(PLAN, "2026-09-09T00:00:00.000Z", [])], SECTION, LIBRARY)),
  );
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:quality-scope`
Expected: FAIL, exit 1:

  - `FAIL: rule 1: since skips the plan record`
  - `FAIL: rule 1: a fix before the plan still counts for a cell the plan did not re-score`
  - `TypeError: scopeAnchorId is not a function`

- [ ] **Step 3: Implement rule 1**

In `packages/schema/src/quality-scope.ts`, make these four replacements.

Replace:

```ts
  /**
   * The audit the scope is measured from — `null` when no audit has been
   * recorded, which is an empty scope rather than "everything since the start":
   * with no recorded reading there is nothing for a re-score to be a re-score of.
   */
  since: string | null;
```

with:

```ts
  /**
   * The audit the scope is measured from — `null` when no audit has been
   * recorded, which is an empty scope rather than "everything since the start":
   * with no recorded reading there is nothing for a re-score to be a re-score of.
   * Never a plan record: a project whose only records are plans has none.
   */
  since: string | null;
```

Replace:

```ts
  /** The audit to measure from. Default: the newest `quality.audit.completed`. */
  since?: string;
```

with:

```ts
  /**
   * The audit to measure from. Default: the newest `quality.audit.completed`
   * that is not a plan record. A plan id or a part id names no anchor, so it
   * gives an empty scope.
   */
  since?: string;
```

Replace:

```ts
/**
 * The cells a batch of fixes made stale since an audit.
```

with:

```ts
/**
 * The index in `ordered` of the record a scope is measured from: the newest
 * `quality.audit.completed` that is not a plan record (rule 1), or the newest
 * recording of `since` when one is named. `-1` when there is none — and a
 * `since` naming a plan or a part never matches, because no non-plan record
 * carries that id.
 */
function anchorIndex(ordered: readonly JournalEvent[], since: string | undefined): number {
  for (let i = ordered.length - 1; i >= 0; i--) {
    const event = ordered[i];
    if (event.type !== "quality.audit.completed" || isPlanRecord(event)) continue;
    if (since !== undefined && (event as { audit_id?: unknown }).audit_id !== since) continue;
    return i;
  }
  return -1;
}

/**
 * The audit id of the newest record that is not a plan record — the `since` an
 * unscoped {@link deriveAuditScope} measures from, and the `since` a plan
 * record carries. `null` when there is none, or when that record names no id.
 */
export function scopeAnchorId(events: readonly JournalEvent[]): string | null {
  const ordered = orderedRows(events);
  const at = anchorIndex(ordered, undefined);
  if (at === -1) return null;
  const id = (ordered[at] as { audit_id?: unknown }).audit_id;
  return isString(id) ? id : null;
}

/**
 * The cells a batch of fixes made stale since an audit.
```

Replace:

```ts
  const ordered = orderEvents(rowsOf<JournalEvent>(events).filter((event) => typeof event === "object" && event !== null));

  let sinceIndex = -1;
  for (let i = ordered.length - 1; i >= 0; i--) {
    const event = ordered[i];
    if (event.type !== "quality.audit.completed") continue;
    const id = (event as { audit_id?: unknown }).audit_id;
    if (options.since !== undefined && id !== options.since) continue;
    sinceIndex = i;
    break;
  }
```

with:

```ts
  const ordered = orderedRows(events);
  // Rule 1: the anchor is never a plan record.
  const sinceIndex = anchorIndex(ordered, options.since);
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm run test:quality-scope && npm run test:quality-baseline && npx tsc --noEmit -p . && npm run lint`
Expected: PASS for all four.

Run: `npm run test:quality-events`
Expected: still FAIL, exit 1, now with three lines left (the anchor is right; the per-cell rule is Task 5):

  - `FAIL: plan record (hosted): it lists the stale cell the plan did not re-score, and only that one`
  - `FAIL: plan record (hosted): a score on the cell the plan re-scored refuses out_of_scope`
  - `FAIL: plan record (hosted): the refusal names the non-plan audit`

- [ ] **Step 5: Commit**

```bash
git add packages/schema/src/quality-scope.ts tests/schema/quality-scope.test.js
git commit -m "feat(kritik): a plan record is never the audit a scope is measured from"
```

---

### Task 5: Rules 2, 3, 4, 6 and 7 — a resolution counts for a cell only after the plan that re-scored it

**Files:**
- Modify: `packages/schema/src/quality-scope.ts`
- Modify: `tests/schema/quality-scope.test.js`
- Commit: `tests/services/quality-events.test.js` (from Task 3)

- [ ] **Step 1: Write the failing test**

Insert directly above the line `// --- scopedAuditId (issue #473): the shared naming rule ----------------------`:

```js
// --- rules 2, 3, 4, 6 and 7: a resolution counts per cell ----------------------

// Rule 2: one clearing rule, in orderEvents order.
{
  const before = [AUG(), resolved("F-1", T(2)), planRecord(PLAN, T(10), ["SEC-01::web"])];
  check(
    "rule 2: a resolution before the plan that re-scored its cell no longer counts",
    deriveAuditScope(before, SECTION, LIBRARY, { widen: false }).cells.length === 0,
    cellIds(deriveAuditScope(before, SECTION, LIBRARY, { widen: false })).join(),
  );
  check(
    "rule 2: the journal's order decides, never the array's",
    deriveAuditScope([...before].reverse(), SECTION, LIBRARY, { widen: false }).cells.length === 0,
  );

  const after = [AUG(), planRecord(PLAN, T(10), ["SEC-01::web"]), resolved("F-1", T(11))];
  check(
    "rule 2: a resolution after the plan counts",
    cellIds(deriveAuditScope(after, SECTION, LIBRARY, { widen: false })).join() === "web:SEC-01:direct",
  );

  // Same ts: orderEvents falls back to the event id, and `ev` mints ids in call order.
  const tieResolved = resolved("F-1", T(10));
  const tiePlan = planRecord(PLAN, T(10), ["SEC-01::web"]);
  check(
    "rule 2: on a ts tie, the id order orderEvents uses decides",
    deriveAuditScope([AUG(), tiePlan, tieResolved], SECTION, LIBRARY, { widen: false }).cells.length === 0,
  );
  const tiePlanFirst = planRecord(PLAN, T(10), ["SEC-01::web"]);
  const tieResolvedSecond = resolved("F-1", T(10));
  check(
    "rule 2: and the other way round, a resolution whose id sorts after the plan's counts",
    cellIds(deriveAuditScope([AUG(), tieResolvedSecond, tiePlanFirst], SECTION, LIBRARY, { widen: false })).join() === "web:SEC-01:direct",
  );

  const twice = [AUG(), resolved("F-1", T(2), { resolved_by: "https://pr/1" }), planRecord(PLAN, T(10), ["SEC-01::web"]), resolved("F-1", T(11))];
  const again = deriveAuditScope(twice, SECTION, LIBRARY, { widen: false });
  check(
    "rule 2: a finding resolved before and after the plan counts by its latest resolution",
    cellIds(again).join() === "web:SEC-01:direct" && again.findings.join() === "F-1",
    JSON.stringify(again),
  );
  check("rule 2: its named resolver is still the latest named one", again.resolved_by["F-1"] === "https://pr/1", JSON.stringify(again.resolved_by));

  const explicit = [audit("2026-07", "2026-07-31T00:00:00.000Z"), AUG(), resolved("F-1", T(2)), planRecord(PLAN, T(10), ["SEC-01::web"])];
  check(
    "rule 2: with an explicit older since, a plan after it still clears the cells it re-scored",
    deriveAuditScope(explicit, SECTION, LIBRARY, { since: "2026-07", widen: false }).cells.length === 0,
    cellIds(deriveAuditScope(explicit, SECTION, LIBRARY, { since: "2026-07", widen: false })).join(),
  );

  const stale = [AUG(), planRecord(PLAN, T(1), ["SEC-01::web"]), audit("2026-09", T(5)), resolved("F-1", T(6))];
  check(
    "rule 2: a plan record before the anchor clears nothing after it",
    cellIds(deriveAuditScope(stale, SECTION, LIBRARY, { widen: false })).join() === "web:SEC-01:direct",
  );
}

// Rule 3: direct cells.
{
  const events = [AUG(), resolved("F-1", T(2)), resolved("F-3", T(3)), planRecord(PLAN, T(10), ["SEC-01::web"])];
  const scope = deriveAuditScope(events, SECTION, LIBRARY, { widen: false });
  check("rule 3: the cell the plan re-scored leaves; the one it did not stays", cellIds(scope).join() === "ios:A11Y-01:direct", cellIds(scope).join());
  check("rule 3: the kept cell's because names its own finding", scope.cells[0]?.because.join() === "F-3", JSON.stringify(scope.cells));

  const section = { ...SECTION, findings: [...SECTION.findings, find("F-11", "SEC-01", "web")] };
  const mixed = deriveAuditScope(
    [AUG(), resolved("F-1", T(2)), planRecord(PLAN, T(10), ["SEC-01::web"]), resolved("F-11", T(11))],
    section,
    LIBRARY,
    { widen: false },
  );
  check(
    "rule 3: a listed cell's because holds only the findings that still count",
    cellIds(mixed).join() === "web:SEC-01:direct" && mixed.cells[0].because.join() === "F-11",
    JSON.stringify(mixed.cells),
  );
}

// Rule 4: a cross-surface finding fans out, then each cell is judged alone.
{
  const events = [AUG(), resolved("F-6", T(2)), planRecord(PLAN, T(10), ["SEC-01::web"])];
  const scope = deriveAuditScope(events, SECTION, LIBRARY, { widen: false });
  check(
    "rule 4: a plan that re-scored web clears web and leaves the other surfaces listed",
    cellIds(scope).join() === "ios:SEC-01:direct,supabase:SEC-01:direct",
    cellIds(scope).join(),
  );
  check("rule 4: the finding still drives the cells it left", scope.findings.join() === "F-6", scope.findings.join());

  const all = deriveAuditScope(
    [AUG(), resolved("F-6", T(2)), planRecord(PLAN, T(10), ["SEC-01::web", "SEC-01::ios", "SEC-01::supabase"])],
    SECTION,
    LIBRARY,
    { widen: false },
  );
  check("rule 4: a plan that re-scored every surface clears the finding", all.cells.length === 0 && all.findings.length === 0, JSON.stringify(all));
}

// Rule 6: a cell can come back.
{
  const section = {
    ...SECTION,
    assessments: [...SECTION.assessments, assess("SEC-01", "web", 3, PART_SEC_WEB)],
    findings: [...SECTION.findings, find("F-11", "SEC-01", "web")],
  };
  const cleared = [AUG(), resolved("F-1", T(2)), planRecord(PLAN, T(10), ["SEC-01::web"])];
  check("rule 6 (precondition): the plan cleared SEC-01 x web", deriveAuditScope(cleared, section, LIBRARY, { widen: false }).cells.length === 0);

  const back = deriveAuditScope([...cleared, resolved("F-11", T(12))], section, LIBRARY, { widen: false });
  check("rule 6: a finding resolved after the plan makes the cell stale again", cellIds(back).join() === "web:SEC-01:direct", cellIds(back).join());
  check(
    "rule 6: the score it would replace is the plan part's",
    back.cells[0]?.current?.level === 3 && back.cells[0]?.current?.audit_id === PART_SEC_WEB,
    JSON.stringify(back.cells[0]),
  );

  const secondPlan = deriveAuditScope(
    [...cleared, resolved("F-11", T(12)), planRecord("2026-09-zplan-2000", T(20), ["SEC-01::web"])],
    section,
    LIBRARY,
    { widen: false },
  );
  check("rule 6: the LAST plan record that re-scored the cell is the one that counts", secondPlan.cells.length === 0, cellIds(secondPlan).join());

  const otherPlan = deriveAuditScope(
    [...cleared, resolved("F-11", T(12)), planRecord("2026-09-zplan-2000", T(20), ["SEC-03::web"])],
    section,
    LIBRARY,
    { widen: false },
  );
  check("rule 6: a later plan that did not re-score the cell leaves it listed", cellIds(otherPlan).join() === "web:SEC-01:direct", cellIds(otherPlan).join());
}

// Rule 7: the reported lists.
{
  const events = [
    AUG(),
    resolved("F-1", T(2), { resolved_by: "https://pr/1" }),
    resolved("F-3", T(3), { resolved_by: "https://pr/3" }),
    resolved("F-404", T(4)),
    resolved("F-4", T(5)),
    planRecord(PLAN, T(10), ["SEC-01::web", "SEC-09::web"]),
  ];
  const scope = deriveAuditScope(events, SECTION, LIBRARY, { widen: false });
  check("rule 7: findings keeps only the findings that still drive a listed cell", scope.findings.join() === "F-3", scope.findings.join());
  check(
    "rule 7: resolved_by keeps only those findings too",
    JSON.stringify(scope.resolved_by) === JSON.stringify({ "F-3": "https://pr/3" }),
    JSON.stringify(scope.resolved_by),
  );
  check("rule 7: unknown is computed as before", scope.unknown.join() === "F-404", scope.unknown.join());
  check("rule 7: unscorable is computed as before, plan or no plan", scope.unscorable.join() === "F-4", scope.unscorable.join());
  check(
    "rule 7: the summary counts what is left",
    scopeSummary(scope) === "1 cell to re-score from 1 resolved finding since 2026-08",
    scopeSummary(scope),
  );
}

// A full record, or a scoped re-audit's, still clears everything.
{
  const plan = [AUG(), resolved("F-1", T(2)), resolved("F-3", T(3)), planRecord(PLAN, T(10), ["SEC-01::web"])];
  check("(precondition) after the plan, A11Y-01 x ios is listed", cellIds(deriveAuditScope(plan, SECTION, LIBRARY, { widen: false })).join() === "ios:A11Y-01:direct");
  const full = deriveAuditScope([...plan, audit("2026-10", "2026-10-01T00:00:00.000Z")], SECTION, LIBRARY);
  check("a full record after a plan still moves since and clears all", full.since === "2026-10" && full.cells.length === 0, JSON.stringify(full));
  const scoped = deriveAuditScope(
    [...plan, audit("2026-09-scoped", T(20), { scope: { partial: true, cells: 1, since: "2026-08" } })],
    SECTION,
    LIBRARY,
  );
  check("so does a scoped re-audit's record", scoped.since === "2026-09-scoped" && scoped.cells.length === 0, JSON.stringify(scoped));
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:quality-scope`
Expected: FAIL, exit 1, with these lines:

  - `FAIL: rule 2: a resolution before the plan that re-scored its cell no longer counts`
  - `FAIL: rule 2: the journal's order decides, never the array's`
  - `FAIL: rule 2: on a ts tie, the id order orderEvents uses decides`
  - `FAIL: rule 2: with an explicit older since, a plan after it still clears the cells it re-scored`
  - `FAIL: rule 3: the cell the plan re-scored leaves; the one it did not stays`
  - `FAIL: rule 3: the kept cell's because names its own finding`
  - `FAIL: rule 3: a listed cell's because holds only the findings that still count`
  - `FAIL: rule 4: a plan that re-scored web clears web and leaves the other surfaces listed`
  - `FAIL: rule 4: a plan that re-scored every surface clears the finding`
  - `FAIL: rule 6 (precondition): the plan cleared SEC-01 x web`
  - `FAIL: rule 6: the LAST plan record that re-scored the cell is the one that counts`
  - `FAIL: rule 7: findings keeps only the findings that still drive a listed cell`
  - `FAIL: rule 7: resolved_by keeps only those findings too`
  - `FAIL: rule 7: the summary counts what is left`
  - `FAIL: (precondition) after the plan, A11Y-01 x ios is listed`

- [ ] **Step 3: Implement the per-cell floor**

In `packages/schema/src/quality-scope.ts`, make these five replacements. The widening filter (`resolvedNodes.has(node)`) keeps working on the new `Map` until Task 6 replaces it.

Replace:

```ts
 * - **The window.** Every `quality.finding.resolved` ordered (by `orderEvents`)
 *   after the `since` audit's recording. A re-recorded audit id is measured
 *   from its latest recording, the reading the trend keeps too.
 * - **Direct cells.** Each resolved finding's own `(criterion_id, surface)`,
 *   read from `section.findings` — the event does not carry them — when
 *   `score` could re-score it; a finding whose cell it could not (a retired
 *   criterion, an undeclared surface) is reported in `unscorable`. A
 *   `cross-surface` finding scopes every surface its criterion applies to: the
 *   contract lens has no column of its own, so the fix lands in the columns
 *   either side of it.
```

with:

```ts
 * - **The window.** Every `quality.finding.resolved` ordered (by `orderEvents`)
 *   after the `since` audit's recording. A re-recorded audit id is measured
 *   from its latest recording, the reading the trend keeps too. `since`
 *   defaults to the newest recording that is not a plan record; a plan record
 *   is never the audit a scope is measured from.
 * - **Per cell, after a plan.** A resolution counts toward a cell only when it
 *   is ordered after the last plan record whose `scored` lists that cell: the
 *   plan re-scored the cell after the fix, so the fix is already in its score.
 *   A finding resolved more than once counts by its latest resolution.
 * - **Direct cells.** Each resolved finding's own `(criterion_id, surface)`,
 *   read from `section.findings` — the event does not carry them — when
 *   `score` could re-score it; a finding whose cell it could not (a retired
 *   criterion, an undeclared surface) is reported in `unscorable`. A
 *   `cross-surface` finding scopes every surface its criterion applies to: the
 *   contract lens has no column of its own, so the fix lands in the columns
 *   either side of it. The per-cell rule then judges each of those cells alone.
```

Replace:

```ts
 *   second would pull the whole graph in, and a scope that says "everything"
 *   is the comprehensive audit again.
 */
```

with:

```ts
 *   second would pull the whole graph in, and a scope that says "everything"
 *   is the comprehensive audit again.
 * - **Reported lists.** `findings` and `resolved_by` hold only the findings
 *   that still drive a listed cell; `unknown` and `unscorable` hold every
 *   resolution in the window, plan or no plan.
 */
```

Replace:

```ts
  // Resolutions in order, one entry per finding. A later NAMED `resolved_by`
  // wins over an earlier one — the rule `foldQualityEvents` applies, so the
  // run sheet and the findings board name the same PR.
  const resolutions = new Map<string, { resolved_by?: string; node_ids: Set<string> }>();
  for (const event of ordered.slice(sinceIndex + 1)) {
    if (event.type !== "quality.finding.resolved") continue;
    const findingId = (event as { finding_id?: unknown }).finding_id;
    if (!isString(findingId)) continue;
    const entry = resolutions.get(findingId) ?? { node_ids: new Set<string>() };
    const by = (event as { resolved_by?: unknown }).resolved_by;
    if (isString(by)) entry.resolved_by = by;
    for (const node of stringsOf((event as { node_ids?: unknown }).node_ids)) entry.node_ids.add(node);
    resolutions.set(findingId, entry);
  }
```

with:

```ts
  // Rule 2's floor per cell: the journal index of the last plan record that
  // re-scored it, else the anchor's. A resolution counts for a cell only when
  // its index is above the cell's floor. Plan records before the anchor need
  // no entry — the anchor's index is already higher.
  const planFloor = new Map<string, number>();
  for (let i = sinceIndex + 1; i < ordered.length; i++) {
    const event = ordered[i];
    if (event.type !== "quality.audit.completed") continue;
    const reading = readPlanScope((event as { scope?: unknown }).scope);
    if (reading === null) continue;
    for (const key of reading.scored) planFloor.set(key, i);
  }
  const floorOf = (key: string): number => planFloor.get(key) ?? sinceIndex;

  // Resolutions in order, one entry per finding: the index of its latest
  // resolution, and each node id an event carried with the index of the
  // latest event that carried it. A later NAMED `resolved_by` wins over an
  // earlier one — the rule `foldQualityEvents` applies, so the run sheet and
  // the findings board name the same PR.
  const resolutions = new Map<string, { last: number; resolved_by?: string; nodes: Map<string, number> }>();
  for (let i = sinceIndex + 1; i < ordered.length; i++) {
    const event = ordered[i];
    if (event.type !== "quality.finding.resolved") continue;
    const findingId = (event as { finding_id?: unknown }).finding_id;
    if (!isString(findingId)) continue;
    const entry = resolutions.get(findingId) ?? { last: i, nodes: new Map<string, number>() };
    entry.last = i;
    const by = (event as { resolved_by?: unknown }).resolved_by;
    if (isString(by)) entry.resolved_by = by;
    for (const node of stringsOf((event as { node_ids?: unknown }).node_ids)) entry.nodes.set(node, i);
    resolutions.set(findingId, entry);
  }
```

Replace:

```ts
  const resolvedBy: Record<string, string> = {};
  const resolvedNodes = new Set<string>();
```

with:

```ts
  const resolvedBy: Record<string, string> = {};
  // Node id → index of the latest counted resolution that touched it. Whether
  // it counts for a candidate cell is decided per cell, against that cell's floor.
  const resolvedNodes = new Map<string, number>();
  const touch = (node: string, index: number) => {
    if ((resolvedNodes.get(node) ?? -1) < index) resolvedNodes.set(node, index);
  };
```

Replace:

```ts
    // The fix still happened, and still touched its nodes — so it widens even
    // when its own cell is one nothing can re-score.
    for (const node of stringsOf(finding.node_ids)) resolvedNodes.add(node);
    for (const node of resolution.node_ids) resolvedNodes.add(node);
    if (targets.length === 0) {
      unscorable.push(findingId);
      continue;
    }

    drivers.push(findingId);
    if (resolution.resolved_by !== undefined) resolvedBy[findingId] = resolution.resolved_by;
    for (const surface of targets) addDirect(finding.criterion_id, surface, findingId);
  }
```

with:

```ts
    // The fix still happened, and still touched its nodes — so it widens even
    // when its own cell is one nothing can re-score. The finding's own nodes
    // date from its latest resolution; an event's nodes from that event.
    for (const node of stringsOf(finding.node_ids)) touch(node, resolution.last);
    for (const [node, index] of resolution.nodes) touch(node, index);
    if (targets.length === 0) {
      unscorable.push(findingId);
      continue;
    }

    // Rules 2 to 4, per target cell: a plan that re-scored the cell after this
    // finding's latest resolution already holds the fix.
    const live = targets.filter((surface) => resolution.last > floorOf(cellKey(finding.criterion_id, surface)));
    if (live.length === 0) continue;

    drivers.push(findingId);
    if (resolution.resolved_by !== undefined) resolvedBy[findingId] = resolution.resolved_by;
    for (const surface of live) addDirect(finding.criterion_id, surface, findingId);
  }
```

- [ ] **Step 4: Run both suites to verify they pass**

Run: `npm run test:quality-scope && npm run test:quality-events && npm run test:quality-baseline && npx tsc --noEmit -p . && npm run lint`
Expected: PASS for all five — the hosted case from Task 3 is green now.

- [ ] **Step 5: Commit, then commit the hosted case**

```bash
git add packages/schema/src/quality-scope.ts tests/schema/quality-scope.test.js
git commit -m "feat(kritik): a resolution counts for a cell only after the plan that re-scored it"
git add tests/services/quality-events.test.js
git commit -m "test(kritik): a hosted journal holding a plan record"
```

---

### Task 6: Rule 5 — widen a cell only through fixes after its last plan record

**Files:**
- Modify: `packages/schema/src/quality-scope.ts`
- Modify: `tests/schema/quality-scope.test.js`

- [ ] **Step 1: Write the failing test**

Insert directly above the line `// --- scopedAuditId (issue #473): the shared naming rule ----------------------`:

```js
// --- rule 5: widened cells ------------------------------------------------------

// Rule 5: widened cells count a node only through a resolution that counts for them.
{
  const base = [AUG(), resolved("F-1", T(2))];
  check(
    "(precondition) without a plan, F-1's V-home widens SEC-03 x web in",
    cellIds(deriveAuditScope(base, SECTION, LIBRARY)).join() === "web:SEC-01:direct,web:SEC-03:widened",
    cellIds(deriveAuditScope(base, SECTION, LIBRARY)).join(),
  );

  const rescored = deriveAuditScope([...base, planRecord(PLAN, T(10), ["SEC-03::web"])], SECTION, LIBRARY);
  check(
    "rule 5: a widened cell the plan re-scored leaves the scope",
    cellIds(rescored).join() === "web:SEC-01:direct" && rescored.widened === 0,
    cellIds(rescored).join(),
  );

  const directOnly = deriveAuditScope([...base, planRecord(PLAN, T(10), ["SEC-01::web"])], SECTION, LIBRARY);
  check(
    "rule 5: one it did not re-score stays widened, though the direct cell that pulled it in was cleared",
    cellIds(directOnly).join() === "web:SEC-03:widened" && directOnly.cells[0].because.join() === "V-home" && directOnly.findings.length === 0,
    JSON.stringify(directOnly),
  );

  const later = deriveAuditScope(
    [...base, planRecord(PLAN, T(10), ["SEC-03::web"]), resolved("F-3", T(11), { node_ids: ["V-home"] })],
    SECTION,
    LIBRARY,
  );
  check(
    "rule 5: a later fix touching one of its nodes widens it back in",
    cellIds(later).join() === "web:SEC-01:direct,web:SEC-03:widened,ios:A11Y-01:direct" &&
      later.cells.find((cell) => cell.criterion_id === "SEC-03")?.because.join() === "V-home",
    cellIds(later).join(),
  );

  // F-1's event before the plan carries V-settings; its resolution after the
  // plan does not. V-settings dates from the first event, so A11Y-01 x ios —
  // re-scored by the plan in between — is not widened back by it.
  const dated = deriveAuditScope(
    [AUG(), resolved("F-1", T(2), { node_ids: ["V-settings"] }), planRecord(PLAN, T(10), ["A11Y-01::ios"]), resolved("F-1", T(11))],
    SECTION,
    LIBRARY,
  );
  check(
    "rule 5: a node an event carried dates from that event, not from the finding's latest resolution",
    !cellIds(dated).includes("ios:A11Y-01:widened"),
    cellIds(dated).join(),
  );
  const undated = deriveAuditScope(
    [AUG(), resolved("F-1", T(2), { node_ids: ["V-settings"] }), resolved("F-1", T(11))],
    SECTION,
    LIBRARY,
  );
  check("(precondition) without the plan, that V-settings does widen A11Y-01 x ios", cellIds(undated).includes("ios:A11Y-01:widened"), cellIds(undated).join());
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:quality-scope`
Expected: FAIL, exit 1:

  - `FAIL: rule 5: a widened cell the plan re-scored leaves the scope`
  - `FAIL: rule 5: one it did not re-score stays widened, though the direct cell that pulled it in was cleared`
  - `FAIL: rule 5: a node an event carried dates from that event, not from the finding's latest resolution`

- [ ] **Step 3: Implement rule 5**

In `packages/schema/src/quality-scope.ts`, make these two replacements.

Replace:

```ts
 *   with a resolved finding, joins with `because: [node ids]`. One hop only — a
 *   second would pull the whole graph in, and a scope that says "everything"
 *   is the comprehensive audit again.
```

with:

```ts
 *   with a resolved finding, joins with `because: [node ids]` — counting a
 *   node only through a resolution that counts for that cell. One hop only — a
 *   second would pull the whole graph in, and a scope that says "everything"
 *   is the comprehensive audit again.
```

Replace:

```ts
      const shared = [...(nodesByCell.get(key) ?? [])].filter((node) => resolvedNodes.has(node)).sort();
```

with:

```ts
      // Rule 5: a node counts for this cell only through a resolution after
      // the cell's floor — a plan that re-scored this cell after it holds it.
      const floor = floorOf(key);
      const shared = [...(nodesByCell.get(key) ?? [])].filter((node) => (resolvedNodes.get(node) ?? -1) > floor).sort();
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm run test:quality-scope && npm run test:quality-events && npm run test:quality-baseline && npx tsc --noEmit -p . && npm run lint`
Expected: PASS for all five; the Task 1 golden checks still pass.

- [ ] **Step 5: Commit**

```bash
git add packages/schema/src/quality-scope.ts tests/schema/quality-scope.test.js
git commit -m "feat(kritik): widen a cell only through fixes after its last plan record"
```

---

### Task 7: Verify the part and open its PR

**Files:** none changed; this task only runs checks and opens the PR.

- [ ] **Step 1: Check the module's discipline**

Run: `grep -n "^import" packages/schema/src/quality-scope.ts`
Expected: exactly three imports, from `./journal`, `./quality` and `./quality-plan`. No `zod`, no `fs`, no `node:` module.

- [ ] **Step 2: Run the part's gate**

Run each; every one must exit 0:

```bash
npm run test:quality-scope
npm run test:quality-events
npm run test:quality-baseline
npm run test:quality-plan
npm run test:cli
npm run test:mcp
npm run lint
npx tsc --noEmit -p .
```

`test:cli` and `test:mcp` rebuild the CLI and MCP bundles, which carry `quality-scope.ts` raw; their fixtures hold no plan record, so they must pass unchanged.

- [ ] **Step 3: Check for generated drift**

Run: `npm run generate && git status --porcelain`
Expected: no output. Nothing under `plugin-kritik/`, `public/schema/` or `lib/landing/generated/` may change; if something does, a module the plugin scripts reach has gained a top-level call — find it rather than committing the drift.

- [ ] **Step 4: Open the PR**

Push and open the PR through `gh stack` (the `gh-stack` skill), on top of part 2. Title: `feat(kritik): read plan records — the window closes per cell (part 3/4)`. Body: what the part does (readers, rules 1 to 7, hosted case), the two transient reads part 4 closes ("Between this part and part 4" above), and **no Lab Note section** — nothing a user can reach changes until part 4 writes a plan record. Add the `no-lab-note` label. After opening, read the PR's comments for the advisory reminder and confirm the label silenced it.

---

## Part done when

- On `feat/kritik-plan-scope`, stacked on part 2, each of these exits 0:
  `npm run test:quality-scope`, `npm run test:quality-events`, `npm run test:quality-baseline`, `npm run test:quality-plan`, `npm run test:cli`, `npm run test:mcp`, `npm run lint`, `npx tsc --noEmit -p .`.
- `npm run generate && git status --porcelain` prints nothing.
- The Task 1 golden checks pass unchanged: a journal with no plan record gives byte-for-byte the scope it gave on `main`.
- The only files changed are `packages/schema/src/quality-scope.ts`, `tests/schema/quality-scope.test.js` and `tests/services/quality-events.test.js`.
- PR: "feat(kritik): read plan records — the window closes per cell (part 3/4)", no Lab Note, label `no-lab-note`.
