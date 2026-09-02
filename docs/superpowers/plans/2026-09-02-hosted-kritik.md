# Hosted Kritik Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An agent in a hosted MCP session can read Kritik findings/matrix/regressions and resolve or accept a finding via journal events — no checkout — while scoring tools refuse with a message that says why (issue #400).

**Architecture:** Events-only writes reusing the webhook's proven pattern: a new `quality.finding.accepted` event joins `quality.finding.resolved`; the server folds both into the read; a new `POST …/quality/events` route appends them; the MCP kritik tools branch per mode — hosted reads come from the already-folded `bundle.quality` the remote store fetches today, hosted resolve/accept post to the new route. `snapshot.quality` is never mutated.

**Tech Stack:** TypeScript, Zod (`packages/schema`), Next.js route handlers, plain-node test harnesses (`tests/schema`, `tests/services`, `tests/mcp`).

**Spec:** `docs/superpowers/specs/2026-09-02-hosted-kritik-design.md`

**Shipping shape:** a 4-part `gh stack` (per `docs/conventions.md` § Shipping larger work). The MAIN SESSION creates/advances branches between parts; subagents only implement and commit on the current branch.

| Part | Branch | Tasks |
|---|---|---|
| 1 schema | `kritik-hosted-1-schema` | 1–2 |
| 2 server | `kritik-hosted-2-server` | 3–5 |
| 3 mcp | `kritik-hosted-3-mcp` | 6–9 |
| 4 docs | `kritik-hosted-4-docs` | 10 |

**Repo rails every task must respect (from memory + CLAUDE.md):**
- No local Postgres. All new tests must be DB-free (pure logic behind injected seams).
- CI gates on lint: `npm run lint` must show 0 errors before any commit claim.
- Generated artifacts are diffed in CI: run `npm run generate` after any schema change and commit the result.
- New `@/…` imports can break test loaders silently: when adding a `tests/services` or `tests/app` test, copy an existing `load-*.js` loader in the same directory and register the test in the matching `test:*` npm script in `package.json`. Verify by running the npm script, not the file.

---

## Part 1 — schema

### Task 1: `quality.finding.accepted` event + `findingAcceptedInput`

**Files:**
- Modify: `packages/schema/src/journal-events.ts` (schemas around line 236, registry around line 258)
- Modify: `packages/schema/src/quality-ops.ts` (next to `findingResolvedInput`, ~line 451)
- Modify: `packages/schema/src/index.ts` (only if exports are named, not `export *` — check first)
- Test: `tests/schema/quality.test.js`

- [ ] **Step 1: Write the failing tests.** In `tests/schema/quality.test.js`, following the file's existing check style, add:

```js
// quality.finding.accepted — the event that records an accepted risk written
// away from the checkout (hosted mode has no findings file to hold the state).
{
  const { findingAcceptedInput, makeEvent, JOURNAL_EVENT_SCHEMAS } = schema; // match the file's actual import/require pattern
  const input = findingAcceptedInput({ id: "F-2026-08-SEC-web-01", node_ids: ["V-home"] }, "Cost outweighs exposure");
  check("findingAcceptedInput carries finding_id + reason + node_ids",
    input.type === "quality.finding.accepted" &&
    input.payload.finding_id === "F-2026-08-SEC-web-01" &&
    input.payload.reason === "Cost outweighs exposure" &&
    Array.isArray(input.payload.node_ids));

  const event = makeEvent(input.type, input.payload, { actor: "arkaik-agent" });
  const parsed = JOURNAL_EVENT_SCHEMAS["quality.finding.accepted"].safeParse(event);
  check("quality.finding.accepted event validates", parsed.success, JSON.stringify(parsed.error?.issues ?? []));

  const noNodes = findingAcceptedInput({ id: "F-1" }, "why");
  check("node_ids omitted when absent", !("node_ids" in noNodes.payload));
}
```

- [ ] **Step 2: Run `npm run test:quality`** — expect FAIL (`findingAcceptedInput` is not exported / schema key missing).
- [ ] **Step 3: Implement.** In `journal-events.ts`, after `QualityFindingResolvedEventSchema`:

```ts
export const QualityFindingAcceptedEventSchema = z
  .object({
    ...envelope,
    type: z.literal("quality.finding.accepted"),
    finding_id: z.string(),
    reason: z.string(),
    node_ids: z.array(z.string()).optional(),
  })
  .catchall(z.unknown());
```

Register `"quality.finding.accepted": QualityFindingAcceptedEventSchema` in `JOURNAL_EVENT_SCHEMAS`. In `quality-ops.ts`, after `findingResolvedInput`:

```ts
/**
 * `quality.finding.accepted` — a known, owned risk, recorded as an event.
 *
 * In a repository, acceptance is a state of the finding (`acceptFinding`
 * patches the file) and no event is written. This event exists for writes
 * made AWAY from the checkout: a hosted project has no findings file, so the
 * journal is the only place the decision can live, and the read derives the
 * status from it (`foldFindingEvents`).
 */
export function findingAcceptedInput(
  finding: Pick<QualityFinding, "id" | "node_ids">,
  reason: string,
): EventInput {
  return {
    type: "quality.finding.accepted",
    payload: {
      finding_id: finding.id,
      reason,
      ...(finding.node_ids !== undefined ? { node_ids: finding.node_ids } : {}),
    },
  };
}
```

- [ ] **Step 4: Sweep the event-type cross-checks.** Run `rg -n "quality.finding.resolved" packages/schema/src packages/cli/src lib scripts` and, for every site that enumerates quality event types generically (e.g. `validate.ts`'s "event names a finding the section does not hold" class, any event-type union or docs generator), extend it to cover `quality.finding.accepted` the same way. Do NOT touch `lib/` app code here (that's Part 2) — schema/CLI/scripts only.
- [ ] **Step 5: Run `npm run test:quality` (PASS), `npm run test:journal` (PASS), `npm run generate`** (commit any artifact churn), **`npm run lint`** (0 errors).
- [ ] **Step 6: Commit** on `kritik-hosted-1-schema`: `feat(schema): quality.finding.accepted event for hosted acceptance`

### Task 2: optional `commit` on `QualityFindingSchema`

**Files:**
- Modify: `packages/schema/src/quality-schemas.ts` (~line 150, inside `QualityFindingSchema`)
- Test: `tests/schema/quality.test.js`

- [ ] **Step 1: Failing test** — a finding carrying `commit` parses:

```js
{
  const finding = {
    id: "F-2026-08-SEC-web-01", criterion_id: "SEC-01", surface: "web",
    title: "t", detail: "d", evidence: "file.ts:1", impact: 4, likelihood: 4,
    cost: "M", status: "open", commit: "0123abc",
  };
  const parsed = schema.QualityFindingSchema.safeParse(finding);
  check("finding accepts optional commit anchor", parsed.success, JSON.stringify(parsed.error?.issues ?? []));
}
```

Note: `QualityFindingSchema` has `.catchall(z.unknown())`, so this passes even before the field is typed — the test guards regression, the real change is the typed field + doc. Verify the `QualityFinding` TS type gains `commit?: string` by using it in the schema (typecheck is the gate).

- [ ] **Step 2: Implement.** Add to `QualityFindingSchema` after `issue_url`:

```ts
commit: z.string().optional().meta({
  description:
    "Commit SHA anchoring the file:line evidence. Required by policy on any finding written away from a checkout (issue #400 decision 4) — without it a stale citation is indistinguishable from a wrong one.",
}),
```

Add `commit?: string;` to the `QualityFinding` interface/type if it is hand-declared (check `packages/schema/src/quality-types.ts` or wherever `QualityFinding` lives; if inferred from the schema, nothing more).

- [ ] **Step 3: Run `npm run test:quality`, `npm run test:schema`, `npm run generate`, `npm run lint`, and the repo typecheck (`npm run typecheck` if present, else `npx tsc --noEmit` per package convention).** All green.
- [ ] **Step 4: Commit:** `feat(schema): optional commit anchor on quality findings`

---

## Part 2 — server

### Task 3: fold `accepted` events — `foldResolvedFindings` → `foldFindingEvents`

**Files:**
- Modify: `lib/utils/quality.ts:550` (the fold)
- Modify: `app/api/graph/projects/[projectId]/route.ts:4,46` (caller)
- Test: `tests/app/quality.test.js` (loader: `tests/app/load-quality.js` — extend if it whitelists exports)

Semantics to implement: process events **in journal order**; the FIRST decision on an open finding wins (once decided, later events are ignored — mirrors the route's `not_open` refusal, so an event that would have been refused can never take effect on read). `resolved` keeps today's "latest event that names a PR wins for `resolved_by`" behavior **within** the pre-decision window — simplest faithful composition: walk events in order, and for each finding apply only while its folded status is still open, except `resolved → resolved` may still upgrade `resolved_by` from a later resolved event that names one (today's behavior, keep the existing test passing). `accepted` maps to status `accepted-risk` and appends the reason to `detail` exactly as `acceptFinding` does: `` `${finding.detail}\n\nAccepted risk: ${reason}`.trim() ``.

- [ ] **Step 1: Failing tests** in `tests/app/quality.test.js`:

```js
{
  const section = { framework_version: "1", profile: { surfaces: [] }, assessments: [], findings: [
    { id: "F-1", criterion_id: "SEC-01", surface: "web", title: "t", detail: "d", evidence: "e", impact: 4, likelihood: 4, cost: "M", status: "open" },
    { id: "F-2", criterion_id: "SEC-01", surface: "web", title: "t2", detail: "d2", evidence: "e", impact: 2, likelihood: 2, cost: "S", status: "resolved" },
  ]};
  const accepted = { id: "01B", ts: "2026-09-01T00:00:00.000Z", type: "quality.finding.accepted", finding_id: "F-1", reason: "owned risk" };
  const folded = foldFindingEvents(section, [accepted]);
  check("accepted event folds open finding to accepted-risk", folded.findings[0].status === "accepted-risk");
  check("acceptance reason appended to detail", folded.findings[0].detail === "d\n\nAccepted risk: owned risk");
  check("decided finding untouched by accepted event",
    foldFindingEvents(section, [{ ...accepted, finding_id: "F-2" }]) === section);
  const resolvedAfter = { id: "01C", ts: "2026-09-02T00:00:00.000Z", type: "quality.finding.resolved", finding_id: "F-1", resolved_by: "https://pr/1" };
  check("first decision wins — resolve after accept is ignored",
    foldFindingEvents(section, [accepted, resolvedAfter]).findings[0].status === "accepted-risk");
}
```

- [ ] **Step 2: Run `npm run test:app`** (or the script that runs `tests/app/quality.test.js` — check `package.json`; run that named script). Expect FAIL.
- [ ] **Step 3: Implement.** Rewrite the fold as an in-order walk. Sketch (adapt to the file's local helpers, keep the doc comment and update it):

```ts
export function foldFindingEvents(
  section: QualitySection | undefined,
  events: readonly JournalEvent[],
): QualitySection | undefined {
  if (section === undefined) return undefined;
  const findings = Array.isArray(section.findings) ? section.findings : [];
  if (findings.length === 0 || events.length === 0) return section;

  const byId = new Map(findings.map((f, i) => [f.id, i] as const));
  const patched = new Map<number, QualityFinding>();
  const current = (i: number) => patched.get(i) ?? findings[i];

  for (const event of events) {
    const type = event?.type;
    if (type !== "quality.finding.resolved" && type !== "quality.finding.accepted") continue;
    const findingId = (event as { finding_id?: unknown }).finding_id;
    if (typeof findingId !== "string" || findingId === "") continue;
    const index = byId.get(findingId);
    if (index === undefined) continue; // validateBundle already warns on this class
    const finding = current(index);

    if (type === "quality.finding.resolved") {
      const by = (event as { resolved_by?: unknown }).resolved_by;
      const named = typeof by === "string" && by !== "" ? by : undefined;
      if (isOpenFinding(finding)) {
        patched.set(index, { ...finding, status: "resolved", ...(named !== undefined ? { resolved_by: named } : {}) });
      } else if (finding.status === "resolved" && named !== undefined && patched.has(index)) {
        // A later resolution that NAMES a PR upgrades an unnamed fold — the
        // evidence rule the old fold enforced, kept on purpose.
        patched.set(index, { ...finding, resolved_by: named });
      }
      continue;
    }
    if (!isOpenFinding(finding)) continue;
    const reason = (event as { reason?: unknown }).reason;
    const note = typeof reason === "string" ? reason : "";
    patched.set(index, {
      ...finding,
      status: "accepted-risk",
      detail: `${finding.detail}\n\nAccepted risk: ${note}`.trim(),
    });
  }

  if (patched.size === 0) return section;
  return { ...section, findings: findings.map((f, i) => patched.get(i) ?? f) };
}
```

Rename at the definition, update the two call sites (`route.ts`, any test/loader). Preserve the identity-return-when-unchanged property — the existing tests assert it.

- [ ] **Step 4: Run the app test script — all fold tests (old and new) PASS. `npm run lint` clean.**
- [ ] **Step 5: Commit:** `feat(quality): fold accepted-risk events into the read (foldFindingEvents)`

### Task 4: fetch both event types

**Files:**
- Modify: `lib/services/graph/store.ts:266-279` (`qualityResolutionEvents`)
- Modify: `lib/services/github/quality.ts:144-148` (webhook's already-decided query)

- [ ] **Step 1:** In `store.ts`, rename `qualityResolutionEvents` → `qualityFindingEvents` and widen the SQL:

```sql
where project_id = $1
  and event->>'type' in ('quality.finding.resolved', 'quality.finding.accepted')
order by seq asc
```

Update the caller (`app/api/graph/projects/[projectId]/route.ts:48`) and any test doubles (`rg -n "qualityResolutionEvents" --glob '!node_modules'`).

- [ ] **Step 2:** In `lib/services/github/quality.ts`, widen the `resolvedFindingIds` query the same way and rename the field `resolvedFindingIds` → `decidedFindingIds` (update `applyQualityResolutions:88` and the tests' fixtures in `tests/services/quality-webhook.test.js`). Rationale to state in the comment: a finding accepted via event still LOOKS open in the unfolded snapshot, and a merge must not silently close a recorded decision.
- [ ] **Step 3: Failing-then-passing test** in `tests/services/quality-webhook.test.js`: a finding whose id appears in a `quality.finding.accepted` event reports `unchanged`, not `resolved`. Follow the file's existing fixture pattern for `readState` injection.
- [ ] **Step 4: Run the services test script (named npm script), `npm run lint`. Commit:** `feat(quality): resolved and accepted events both decide a finding`

### Task 5: `POST /api/graph/projects/{id}/quality/events`

**Files:**
- Create: `lib/services/graph/quality-events.ts` (pure core)
- Create: `app/api/graph/projects/[projectId]/quality/events/route.ts`
- Test: `tests/services/quality-events.test.js` + `tests/services/load-quality-events.js` (copy `load-quality-parse.js`'s mechanism)

**Contract.** Body: `{ events: [{ type, finding_id, resolved_by?, reason? }] }`, 1–50 entries, whitelist `quality.finding.resolved` (optional `resolved_by`) and `quality.finding.accepted` (required non-empty `reason`). Gate: `graph:write`. Refusals per finding: `unknown_finding` (not in stored section) and `not_open` (decided in the snapshot OR by a prior event, i.e. checked post-fold). Any refusal refuses the whole batch (mirror `persistMutation`'s all-or-nothing). Success: append via `appendJournalEvents(projectId, ownerIds, stamped, "arkaik-agent")`, return `{ events }` (the stamped events) with 200. `snapshot.quality` untouched. Size-cap the raw body with `MAX_BUNDLE_BYTES` before `JSON.parse` (copy the PATCH pattern in the sibling `route.ts:86-89`).

- [ ] **Step 1: Write the pure core's failing tests** (`tests/services/quality-events.test.js`, DB-free). The core:

```ts
// lib/services/graph/quality-events.ts
import "server-only" — NO: this module must stay importable by the DB-free test loader; keep it pure (no db imports). Only the route file imports db/auth.
import { findingAcceptedInput, findingResolvedInput, isOpenFinding, makeEvent, type JournalEvent, type QualityFinding, type QualitySection } from "@arkaik/schema";
import { foldFindingEvents } from "@/lib/utils/quality";

export type QualityEventInput =
  | { type: "quality.finding.resolved"; finding_id: string; resolved_by?: string }
  | { type: "quality.finding.accepted"; finding_id: string; reason: string };

export type QualityEventRefusal = { finding_id: string; reason: "unknown_finding" | "not_open" };

export function planQualityEvents(
  section: QualitySection | undefined,
  priorEvents: readonly JournalEvent[],
  inputs: readonly QualityEventInput[],
  actor: string,
): { ok: true; events: JournalEvent[] } | { ok: false; refusals: QualityEventRefusal[] } {
  const folded = foldFindingEvents(section, priorEvents);
  const findings = new Map<string, QualityFinding>(
    (Array.isArray(folded?.findings) ? folded.findings : []).map((f) => [f.id, f]),
  );
  const refusals: QualityEventRefusal[] = [];
  const events: JournalEvent[] = [];
  const decidedInBatch = new Set<string>();
  for (const input of inputs) {
    const finding = findings.get(input.finding_id);
    if (finding === undefined) { refusals.push({ finding_id: input.finding_id, reason: "unknown_finding" }); continue; }
    if (!isOpenFinding(finding) || decidedInBatch.has(finding.id)) { refusals.push({ finding_id: input.finding_id, reason: "not_open" }); continue; }
    decidedInBatch.add(finding.id);
    const eventInput = input.type === "quality.finding.resolved"
      ? findingResolvedInput(finding, input.resolved_by)
      : findingAcceptedInput(finding, input.reason);
    events.push(makeEvent(eventInput.type, eventInput.payload, { actor }));
  }
  if (refusals.length > 0) return { ok: false, refusals };
  return { ok: true, events };
}
```

Also export `parseQualityEventInputs(body: unknown): QualityEventInput[] | { error: string }` doing the shape/whitelist/1–50 validation, so the route stays a thin shell. Tests cover: valid resolve → one stamped event with actor + `node_ids` carried; accepted requires reason (parse error); unknown id → `unknown_finding`; snapshot-decided and prior-event-decided → `not_open`; duplicate id within one batch → `not_open`; any refusal → no events; >50 or non-array → parse error; unknown type → parse error.

- [ ] **Step 2: Run the test via its npm script registration** (add `tests/services/quality-events.test.js` wherever `quality-webhook.test.js` is registered in `package.json`). Expect FAIL (module missing).
- [ ] **Step 3: Implement the core** as above (adapt imports to what `@arkaik/schema` actually exports; `makeEvent` lives there per `lib/services/github/quality.ts:3`).
- [ ] **Step 4: Implement the route:**

```ts
// app/api/graph/projects/[projectId]/quality/events/route.ts
import { getCaller, hasScope } from "@/lib/services/auth";
import { MAX_BUNDLE_BYTES, servicesConfigured, servicesUnavailable } from "@/lib/services/db";
import { appendJournalEvents, getProject, qualityFindingEvents } from "@/lib/services/graph/store";
import { parseQualityEventInputs, planQualityEvents } from "@/lib/services/graph/quality-events";
import type { QualitySection } from "@arkaik/schema";

/**
 * POST — append quality finding EVENTS (resolved / accepted) to the journal.
 *
 * The events-only half of hosted Kritik (issue #400): the stored
 * `snapshot.quality` is never mutated here — `foldFindingEvents` derives the
 * current status on every read, exactly as the GitHub App's resolution path
 * works. The whitelist is the point: this is not a general event-append
 * surface, and the journal GET route stays read-only.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ projectId: string }> }): Promise<Response> {
  if (!servicesConfigured()) return servicesUnavailable("Graph");
  const caller = await getCaller(req);
  if (!caller) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!hasScope(caller, "graph:write")) {
    return Response.json({ error: "insufficient_scope", required: "graph:write" }, { status: 403 });
  }
  const { projectId } = await params;

  const raw = await req.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_BUNDLE_BYTES) {
    return Response.json({ error: "payload_too_large", limit: MAX_BUNDLE_BYTES }, { status: 413 });
  }
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return Response.json({ error: "invalid_json" }, { status: 400 }); }
  const inputs = parseQualityEventInputs(body);
  if (!Array.isArray(inputs)) return Response.json({ error: "invalid_events", message: inputs.error }, { status: 400 });

  try {
    const found = await getProject(projectId, caller.ownerIds);
    if (!found) return Response.json({ error: "not_found" }, { status: 404 });
    const section = (found.bundle as { quality?: QualitySection }).quality;
    const plan = planQualityEvents(section, await qualityFindingEvents(projectId, caller.ownerIds), inputs, "arkaik-agent");
    if (!plan.ok) return Response.json({ error: "refused", refusals: plan.refusals }, { status: 422 });
    const result = await appendJournalEvents(projectId, caller.ownerIds, plan.events, "arkaik-agent");
    if (!result.ok) return Response.json({ error: "refused", reason: result.reason }, { status: 422 });
    return Response.json({ events: plan.events }, { status: 200 });
  } catch (err) {
    console.error("[graph] POST quality events failed:", err instanceof Error ? err.message : "unknown error");
    return Response.json({ error: "internal_error", message: "Failed to append quality events." }, { status: 500 });
  }
}
```

Check `appendJournalEvents`'s exact return type at `lib/services/graph/store.ts:288` and adapt. If `graph-api.test.js` has a DB-free harness for route handlers, add auth/whitelist cases there too; otherwise the pure-core tests carry the logic and the route stays shell-thin by construction.

- [ ] **Step 5: Run the services test script, `npm run lint`, typecheck. Commit:** `feat(api): POST quality finding events — the hosted write path`

---

## Part 3 — mcp

### Task 6: the quality seam — `Store.appendQualityEvents` on the remote store

**Files:**
- Modify: `packages/mcp/src/store.ts:84-104` (interface)
- Modify: `packages/mcp/src/remote-store.ts`
- Test: `tests/mcp/remote-store.test.js`

- [ ] **Step 1:** Extend the `Store` interface:

```ts
/**
 * Hosted-only: append whitelisted quality finding events (resolved/accepted)
 * via `POST …/quality/events`. `undefined` on the file store — in a repo the
 * kritik tools write the findings file and journal themselves, which is the
 * dual-write the CLI performs; only a session with no checkout needs the
 * server to hold the pen.
 */
appendQualityEvents?(
  inputs: readonly { type: string; finding_id: string; resolved_by?: string; reason?: string }[],
): Promise<JournalEvent[]>;
```

- [ ] **Step 2:** Implement in `remote-store.ts` using the existing `request` helper: `POST /quality/events` with `{ events: inputs }`; a 422 body's `refusals`/`reason` becomes a thrown `Error` whose message names each refusal (`F-1: not_open`) — the kritik tool wraps it in `ToolError`. Return the response's `events`.
- [ ] **Step 3: Failing-then-passing test** in `tests/mcp/remote-store.test.js`: stub server handles `POST /api/graph/projects/demo/quality/events`, asserts the request body shape, returns `{ events: [...] }`; a second case returns 422 `{ error: "refused", refusals: [{ finding_id: "F-9", reason: "unknown_finding" }] }` and the client surfaces it as an error naming `F-9`. Follow the file's existing stub-server pattern exactly. (Exercise it through Task 8's tool calls if driving the store directly through stdio isn't feasible — in that case write these checks as part of Task 8 and note it.)
- [ ] **Step 4: `npm run test:mcp` green so far, lint, commit:** `feat(mcp): remote store learns to append quality events`

### Task 7: hosted reads — findings (with `finding_id`), matrix, regressions, issue

**Files:**
- Modify: `packages/mcp/src/kritik-tools.ts`
- Test: `tests/mcp/kritik-tools.test.js` (hosted section, ~line 367)

**Shared plumbing first.** Replace the single `rootOf` with:

```ts
/** The repo root, or the refusal explaining what genuinely needs a checkout. */
function repoRootOf(ctx: KritikContext, needs: string): string {
  if (ctx.qualityRoot === undefined) {
    throw new ToolError(
      `${needs} This session is connected to a hosted project (${ctx.store.describe()}); ` +
        `run it where the checkout is — \`arkaik-mcp --bundle <path>\`.`,
    );
  }
  return ctx.qualityRoot;
}

/** Hosted quality state: the stored section, already folded by the server. */
function hostedSection(graph: LoadedGraph): { section: QualitySection; library: KritikLibrary | undefined } {
  const section = (graph.loaded.bundle as { quality?: QualitySection }).quality;
  if (section === undefined || !Array.isArray(section.findings)) {
    throw new ToolError(
      "This hosted project has no quality section yet. Run an audit in the repository and `arkaik restore` it — hosted Kritik reads what an audit stored.",
    );
  }
  return { section, library: resolveKritikLibrary(section) };
}
```

Import `resolveKritikLibrary`, `type QualitySection` from `@arkaik/schema` (verify both are exported; `resolveKritikLibrary` is at `packages/schema/src/quality.ts:491` — export it if the barrel misses it, in Part 1's branch via `gh stack down` if truly needed, else here if the change is mcp-local re-export).

Then per tool, branch on `ctx.qualityRoot === undefined`:

- **`kritik_findings`:** add `finding_id: { type: "string" }` to `inputSchema.properties` and a `row.id !== args.finding_id` filter (BOTH modes — repo mode gains fetch-by-id for free). Hosted rows: `section.findings.map((f) => ({ ...f, severity: severityOf(f, library), priority: priorityOf(f, library) }))` — no `audit_id` (living pool); ignore an `audit_id` filter arg in hosted mode by refusing it: `throw new ToolError("Hosted findings are a living pool — audit_id does not partition them (issue #400 decision 3).")` when provided.
- **`kritik_matrix`:** hosted → `record === true` refuses via `repoRootOf(ctx, "Recording quality.audit.completed belongs to the audit run, which reads code.")`; otherwise `const matrix = deriveQualityMatrix({ quality: section }, library)` plus the same `open`/`lanes`/`p0` derivation as repo mode (reuse by extracting the small `lanes/p0` block into a local helper taking `(findings, library)`). Return `{ matrix, assessment_count, open_findings, lanes, p0, events: [] }` — no `matrix.json` refresh to report.
- **`kritik_regressions`:** hosted → group `section.assessments` by `audit_id` (they carry it; ignore rows without one), audit order = sorted ids; validate `from`/`to` against that list with the same error texts; build `AuditState`s as `{ assessments: grouped[id], findings: section.findings }` for BOTH sides — passing the same pool to both means finding-based regression kinds cannot fire, which is the honest reading of a living pool. Include `note: "hosted comparison covers assessment level drops only — findings are a living pool (issue #400 decision 3)"` in the result. `record === true` refuses (the tripped-signal write path is repo-only).
- **`kritik_issue`:** hosted → criterion via `criterionOf(hostedLibrary!, …)` — when `resolveKritikLibrary` returned a synthesized library the skeleton renders with placeholders standing, which is the tool's documented behavior; guard `library === undefined` (no findings/assessments at all → the no-section error already fired). Surface check against `section.profile` when present. Finding lookup from the pool.

- [ ] **Step 1: Write the failing hosted tests.** In `tests/mcp/kritik-tools.test.js`'s hosted section, replace the single blanket-refusal check with a stub HTTP server (copy the harness from `tests/mcp/remote-store.test.js`) serving `GET /api/graph/projects/demo` whose bundle carries a quality section: profile with surfaces `web`, two findings (`F-A` open impact 5 likelihood 5 cost M; `F-B` status resolved), assessments for `SEC-01×web` at `audit_id` `2026-07` level 3 and `2026-08` level 2. Assert:
  - `kritik_findings` `{finding_id: "F-A"}` → total 1, id F-A, `severity: "critical"`, `priority: "P0"`;
  - `kritik_findings` `{status: "open"}` → total 1;
  - `kritik_matrix` → a matrix with a `web` column and `open_findings === 1`; `{record: true}` → isError with text matching `reads code`;
  - `kritik_regressions` → one `level-drop` (3 → 2) and the living-pool `note`;
  - `kritik_issue` `{criterion_id: "SEC-01", surface: "web", finding_id: "F-A"}` → a body string containing the finding title.
- [ ] **Step 2: `npm run test:mcp`** — new checks FAIL against current refusals.
- [ ] **Step 3: Implement per the plumbing above. Step 4: `npm run test:mcp` fully green (repo-mode checks untouched), lint. Step 5: Commit:** `feat(mcp): kritik reads work on hosted projects`

### Task 8: hosted resolve / accept

**Files:**
- Modify: `packages/mcp/src/kritik-tools.ts` (`kritik_resolve_finding:661`, `kritik_accept_finding:695`)
- Test: `tests/mcp/kritik-tools.test.js`

Hosted branch for both: locate the finding in `hostedSection(graph)` (id miss → `No finding "<id>" in this hosted project's quality section.`); resolve of an already-`resolved` finding keeps the idempotent `note` return with `events: []`; otherwise:

```ts
const events = await appendHosted(ctx.store, [
  { type: "quality.finding.resolved", finding_id: finding.id, ...(resolvedBy !== undefined ? { resolved_by: resolvedBy } : {}) },
]);
return { finding: { ...finding, status: "resolved", ...(resolvedBy !== undefined ? { resolved_by: resolvedBy } : {}) }, events };
```

and for accept (`note` arg is required by the schema already):

```ts
const events = await appendHosted(ctx.store, [{ type: "quality.finding.accepted", finding_id: finding.id, reason: note }]);
return { finding: { ...finding, status: "accepted-risk", detail: `${finding.detail}\n\nAccepted risk: ${note}`.trim() }, events };
```

with `appendHosted` a small helper wrapping `ctx.store.appendQualityEvents` (absent method or thrown error → `ToolError` carrying the server's refusal text). Update `kritik_accept_finding`'s description: acceptance now writes `quality.finding.accepted` **in hosted mode only** — in a repo it remains a state of the finding (keep the existing sentence, add the hosted clause). An accept/resolve of a non-open finding surfaces the server's `not_open` refusal — no client-side pre-check beyond the resolve-idempotency case, the server owns the verdict.

- [ ] **Step 1: Failing tests:** stub server additionally handles `POST …/quality/events` (capture body, return stamped events); assert resolve posts `{ type: "quality.finding.resolved", finding_id: "F-A" }` and the tool returns status `resolved`; accept posts reason and returns `accepted-risk`; a 422 `refusals` response surfaces as `isError` naming the finding id; resolving `F-B` (already resolved) returns the idempotent note WITHOUT any POST hitting the stub.
- [ ] **Step 2–4: red → implement → `npm run test:mcp` green, lint. Commit:** `feat(mcp): resolve and accept findings on hosted projects`

### Task 9: honest refusals for the repo-only four + header comment

**Files:**
- Modify: `packages/mcp/src/kritik-tools.ts` (`kritik_score:483`, `kritik_signals:331`, `kritik_trip_signal:723`, `kritik_open_finding:554`, header `:13-24`)
- Test: `tests/mcp/kritik-tools.test.js`

- [ ] **Step 1:** Each repo-only tool opens with `repoRootOf(ctx, <reason>)`:
  - score: `"Scoring reads the code — evidence is file:line against a working tree."`
  - signals / trip_signal: `"Signals are statements checked against the repository — the pack and its run sheet live with the code."`
  - open_finding: `"A new finding cites code: evidence is file:line, verified adversarially against the checkout."`
- [ ] **Step 2:** Rewrite the header's "Two stores, one of them without a floor" paragraph: hosted mode now reads the stored quality section and transitions findings through journal events; what stays repo-only is the audit run itself, because scoring reads code. Reference issue #400.
- [ ] **Step 3: Tests:** hosted `kritik_score` refuses with text matching `/reads the code/`, `kritik_open_finding` with `/cites code/` — and neither matches the old blanket text.
- [ ] **Step 4: `npm run test:mcp`, lint. Commit:** `feat(mcp): repo-only kritik tools say why they need a checkout`

### Task 10: reconcile the two quality-root resolvers

**Files:**
- Modify: `packages/cli/src/lib/kritik-io.ts:305` (`resolveQualityRoot`), `packages/mcp/src/index.ts:87` (`qualityRootFor`)

- [ ] **Step 1:** Read both functions and their comments in full. Extract ONE function into `packages/cli/src/lib/kritik-io.ts` (exported via `arkaik/io` — verify the barrel):

```ts
export function resolveQualityRoot(options: {
  env?: Record<string, string | undefined>;
  bundlePath?: string;
  /** Where an unconventional layout falls back: the CLI's cwd, or the MCP server's bundle dir. */
  fallback: string;
}): string
```

honoring `$ARKAIK_QUALITY_ROOT` (now in both callers — the CLI gains it, which the divergence comment at `packages/mcp/src/index.ts:78-86` already blesses as the deliberate direction; if the CLI half turns out to have a documented reason to refuse the env var, keep two thin wrappers over one core and say so), and the `<root>/docs/arkaik/bundle.json` convention detection. Update both call sites, delete both KNOWN-DIVERGENCE comments, replace with one comment at the shared function.
- [ ] **Step 2: Run `npm run test:mcp` and the CLI kritik test script (`tests/cli/kritik.test.js`'s npm script) — behavior-preserving, all green. Lint. Commit:** `refactor: one quality-root resolver for CLI and MCP`

---

## Part 4 — docs

### Task 11: update the three stale-premise docs

**Files:**
- Modify: `docs/spec/mcp.md:137` (and the kritik tool table nearby if it states repo-only per tool)
- Modify: `docs/rfcs/kritik.md` § 8.7
- (kritik-tools.ts header already done in Task 9)

- [ ] **Step 1:** In each, replace the "an agent auditing a hosted map has no code to read" rationale with the read/run split: hosted sessions read findings/matrix/regressions from the stored quality section and transition findings via `POST …/quality/events` (`quality.finding.resolved` / `quality.finding.accepted`, folded on read); **running** an audit — scoring, signals, opening findings — stays repo-only because scoring reads code. Note decisions: events-only, living pool, `commit` anchor policy, `graph:write` scope, Publik's `stripQuality` unaffected. Cross-reference issue #400.
- [ ] **Step 2:** `rg -n "no code to read" docs packages` → zero hits outside history/changelogs.
- [ ] **Step 3: `npm run lint` (markdown may be linted), commit:** `docs: hosted Kritik reads and transitions findings; audits stay repo-only`

---

## Stack + PR mechanics (main session, not subagents)

1. Before Task 1: `gh stack create` / branch `kritik-hosted-1-schema` from `main` (use the `gh-stack` skill for exact commands).
2. After each part's tasks pass review: stack the next branch on top; push the stack; open PRs bottom-up.
3. **Lab Note** goes in Part 3's PR body (the user-noticeable change); Parts 1, 2, 4 get the `no-lab-note` label if the advisory bot comments. Note skeleton (per CLAUDE.md contract — quoted strings, molecule `arkaik`):

```yaml
en:
  title: "Your quality findings, readable and closable from anywhere"
  summary: "Agents connected to a hosted project can now read the quality board and mark findings fixed or accepted — no checkout required. Running an audit still happens next to the code, where evidence lives."
fr:
  title: "Tes constats qualité, lisibles et clôturables où que tu sois"
  summary: "Un agent connecté à un projet hébergé peut maintenant lire le tableau qualité et marquer un constat corrigé ou accepté — sans dépôt local. L'audit, lui, se fait toujours près du code."
suggested:
  molecule: arkaik
  type: feature
  tags: [changelog]
```

4. After opening each PR, read its comments (advisory reminder) before moving on.
5. Full verification before any PR: `npm run lint`, `npm run generate` (clean diff), `npm run test:quality`, `npm run test:mcp`, the services and app test scripts by name.
