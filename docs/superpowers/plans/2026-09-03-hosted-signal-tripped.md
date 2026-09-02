# Hosted `quality.signal.tripped` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A public repo's nightly workflow, holding a `quality:append` token, can record `quality.signal.tripped` (with a commit and a run URL) against its linked hosted project — and that token can do nothing else: no graph reads, no graph writes, not even a finding decision on the same route (issue #406).

**Architecture:** Three small layers on top of what #400 shipped. The schema's tripped event gains an optional `commit`. `TOKEN_SCOPES` gains a fourth entry, `quality:append`, absent from the defaults. The events route's whitelist grows from two types to three, and its scope guard becomes asymmetric: `graph:write` may send all three, `quality:append` alone may send only a trip. No read path, no snapshot mutation, no new tables.

**Tech Stack:** TypeScript, Zod (`packages/schema`), Next.js route handlers, plain-node test harnesses (`tests/schema`, `tests/services`).

**Spec:** `docs/superpowers/specs/2026-09-03-hosted-signal-tripped-design.md`

**Shipping shape:** a 3-part `gh stack` (per `docs/conventions.md` § Shipping larger work). The MAIN SESSION creates/advances branches between parts; subagents only implement and commit on the current branch.

| Part | Branch | Tasks |
|---|---|---|
| 1 schema + scope | `signal-tripped-1-schema` | 1–2 |
| 2 server | `signal-tripped-2-server` | 3–4 |
| 3 docs | `signal-tripped-3-docs` | 5 |

**Repo rails every task must respect (from CLAUDE.md + hard-won lessons):**
- **No local Postgres.** Every new test must be DB-free — pure logic behind injected seams, run through the existing `tests/services/load-*.js` loaders. Do not write a test that needs a database.
- **CI gates on lint.** `npm run lint` must show 0 errors before any commit claim.
- **Generated artifacts are diffed in CI.** Run `npm run generate` after any schema change and commit the result.
- **New `@/…` imports can break test loaders silently.** If you add an import to a module a `tests/services` loader rewrites, check that loader's alias map. Verify by running the **npm script**, not the file.
- **Do not touch `package-lock.json`.** It has unrelated pre-existing drift in the working tree; leave it alone and never `git add -A`.

---

## Part 1 — schema + scope

### Task 1: optional `commit` on the tripped event

**Files:**
- Modify: `packages/schema/src/journal-events.ts` (`QualitySignalTrippedEventSchema`, ~line 257)
- Modify: `packages/schema/src/journal.ts` (`QualitySignalTrippedEvent`, ~line 273)
- Modify: `packages/schema/src/quality-ops.ts` (`signalTrippedInput`, ~line 506)
- Test: `tests/schema/quality.test.js`

- [ ] **Step 1: Write the failing tests.** In `tests/schema/quality.test.js`, matching the file's existing check style and import pattern:

```js
// #406: a hosted trip carries the commit it observed. Optional at this layer —
// repo-mode trips have no obligation to anchor; requiring it is a route policy
// about one caller class (see the spec).
{
  const withCommit = signalTrippedInput({
    criterion_id: "SEC-supabase-01",
    surface: "supabase",
    signal: "delete-account edge function rejects an unauthenticated call",
    commit: "0123456789abcdef0123456789abcdef01234567",
    detail: "https://github.com/o/r/actions/runs/1",
  });
  check("signalTrippedInput carries commit", withCommit.payload.commit === "0123456789abcdef0123456789abcdef01234567");
  check("signalTrippedInput carries detail", typeof withCommit.payload.detail === "string");

  const event = makeEvent(withCommit.type, withCommit.payload, { actor: "arkaik-agent" });
  const parsed = JOURNAL_EVENT_SCHEMAS["quality.signal.tripped"].safeParse(event);
  check("tripped event with commit validates", parsed.success, JSON.stringify(parsed.error?.issues ?? []));

  const bare = signalTrippedInput({ criterion_id: "C-1", surface: "web", signal: "s" });
  check("commit key omitted when absent", !("commit" in bare.payload));
}
```

- [ ] **Step 2: Run `npm run test:quality`** — expect FAIL (`commit` stripped or absent). Note: `.catchall(z.unknown())` on the schema means the *validation* check may pass before implementation; the `signalTrippedInput` checks are the ones that must fail. If a check passes early, that is fine — do not weaken it.
- [ ] **Step 3: Implement.**
  - `journal-events.ts`: add `commit: z.string().optional(),` to `QualitySignalTrippedEventSchema`, after `signal`.
  - `journal.ts`: add `commit?: string;` to `QualitySignalTrippedEvent`, after `signal`.
  - `quality-ops.ts`: widen `signalTrippedInput`'s parameter to include `commit?: string`, and spread it into the payload with the same `...(x !== undefined ? { x } : {})` idiom the function already uses for `detail`. Extend its doc comment with one sentence: a hosted trip written from CI carries the commit it observed (#406).
- [ ] **Step 4: Run `npm run test:quality`** — expect PASS.
- [ ] **Step 5: Run `npm run generate`** and commit any regenerated artifacts alongside.
- [ ] **Step 6: Run `npm run lint`** — 0 errors.
- [ ] **Step 7: Commit** `feat(schema): commit anchor on quality.signal.tripped`.

### Task 2: the `quality:append` token scope

**Files:**
- Modify: `lib/services/tokens.ts` (`TOKEN_SCOPES`, ~line 47, and its doc comment ~line 38)
- Modify: `components/settings/TokenManager.tsx` (`SCOPE_OPTIONS`, ~line 29)
- Test: `tests/services/token-auth.test.js`

- [ ] **Step 1: Write the failing tests.** In `tests/services/token-auth.test.js`, following the file's existing style:

```js
// #406: a fourth scope, for a credential that lives in a public repo's CI
// secrets. It must not be in the defaults — nothing mints it by accident.
check("quality:append is a recognized scope", isTokenScope("quality:append"));
check("quality:append is not a default", !DEFAULT_TOKEN_SCOPES.includes("quality:append"));
check("defaults are unchanged", DEFAULT_TOKEN_SCOPES.join(",") === "graph:read,graph:write");
```

If the file already exercises a mint/verify round-trip against a stubbed DB seam, add a case asserting a `quality:append`-only token round-trips with exactly that scope. If it does not — do not invent a DB dependency; the three checks above are sufficient.

- [ ] **Step 2: Run the matching npm script** (find it in `package.json` — `test:token` or whichever registers `token-auth.test.js`) — expect FAIL.
- [ ] **Step 3: Implement.**
  - `tokens.ts`: `export const TOKEN_SCOPES = ["graph:read", "graph:write", "synk", "quality:append"] as const;`. Extend the doc comment above it with the rationale, in the file's voice: `quality:append` is the narrow, append-only scope for a machine that only ever adds an observation — a CI job recording a tripped signal — and is deliberately not a default, because the caller class it exists for keeps its credential in a public repository's secrets.
  - `TokenManager.tsx`: add `{ id: "quality:append", label: "Append quality signals", hint: "Record a tripped Kritik signal — nothing else: no reads, no graph writes" }` to `SCOPE_OPTIONS`. `DEFAULT_SCOPES` in that file stays as it is.
- [ ] **Step 4: Run the test script** — expect PASS.
- [ ] **Step 5: Run `npm run lint`** — 0 errors.
- [ ] **Step 6: Commit** `feat(tokens): quality:append scope`.

---

## Part 2 — server

### Task 3: the third input shape in the pure core

**Files:**
- Modify: `lib/services/graph/quality-events.ts`
- Test: `tests/services/quality-events.test.js`

- [ ] **Step 1: Write the failing tests.** In `tests/services/quality-events.test.js`, following the file's existing style and its section/prior-events fixtures:

```js
// #406 — the third whitelisted type. A trip decides nothing, so it never
// consults a finding: no unknown_finding, no not_open, no batch bookkeeping.
const TRIP = {
  type: "quality.signal.tripped",
  criterion_id: "SEC-supabase-01",
  surface: "supabase",
  signal: "delete-account rejects an unauthenticated call",
  commit: "0123456789abcdef0123456789abcdef01234567",
  detail: "https://github.com/o/r/actions/runs/1",
};

{
  const parsed = parseQualityEventInputs({ events: [TRIP] });
  check("trip parses", Array.isArray(parsed) && parsed[0].type === "quality.signal.tripped");
  check("trip keeps commit", Array.isArray(parsed) && parsed[0].commit === TRIP.commit);
  check("trip keeps detail", Array.isArray(parsed) && parsed[0].detail === TRIP.detail);
}
for (const field of ["criterion_id", "surface", "signal", "commit"]) {
  const bad = { ...TRIP, [field]: undefined };
  const parsed = parseQualityEventInputs({ events: [bad] });
  check(`trip without ${field} is refused`, !Array.isArray(parsed) && parsed.error.includes(field));
}
{
  const parsed = parseQualityEventInputs({ events: [{ ...TRIP, detail: undefined }] });
  check("detail is optional", Array.isArray(parsed) && !("detail" in parsed[0]));
}
{
  const parsed = parseQualityEventInputs({ events: [{ type: "node.created", id: "V-x" }] });
  check("unknown type names all three legal values",
    !Array.isArray(parsed) &&
    parsed.error.includes("quality.signal.tripped") &&
    parsed.error.includes("quality.finding.resolved") &&
    parsed.error.includes("quality.finding.accepted"));
}
{
  // No section, no prior events, no findings anywhere — a trip still plans.
  const plan = planQualityEvents(undefined, [], [ /* parsed TRIP */ ], "arkaik-agent");
  check("trip plans without any section", plan.ok && plan.events.length === 1);
  check("trip event carries criterion + commit",
    plan.ok && plan.events[0].type === "quality.signal.tripped" &&
    plan.events[0].criterion_id === "SEC-supabase-01" && plan.events[0].commit === TRIP.commit);
}
```

Also add, reusing the file's existing open/decided finding fixtures: a trip batched with a **valid** resolution plans **two** events; a trip batched with a **refused** finding decision (unknown id) refuses the whole batch, `plan.ok === false`, and the refusals name only the finding — a trip never appears in `refusals`.

- [ ] **Step 2: Run `npm run test:quality-events`** (confirm the exact script name in `package.json`) — expect FAIL.
- [ ] **Step 3: Implement in `quality-events.ts`.**
  - Add the third member to `QualityEventInput`:
    ```ts
    | { type: "quality.signal.tripped"; criterion_id: string; surface: string; signal: string; commit: string; detail?: string }
    ```
  - **Invert `parseQualityEventInputs`'s per-entry order.** Today it checks `finding_id` before reading `type`; a trip has no `finding_id`. Read `entry.type` first, then branch: the two finding branches each check `finding_id` themselves (same message text as today, so no error string regresses), and the trip branch checks `criterion_id`, `surface`, `signal`, `commit` as non-empty strings and `detail` as a non-empty string when present. The final fallthrough error must name all three legal types.
  - **`planQualityEvents`:** at the top of the loop, handle the trip before the finding lookup — `if (input.type === "quality.signal.tripped") { const e = signalTrippedInput(input); events.push(makeEvent(e.type, e.payload, { actor })); continue; }`. Import `signalTrippedInput` from `@arkaik/schema`. Nothing else in the function changes: refusals, `decidedInBatch`, and the all-or-nothing return stay exactly as they are.
  - **Update the module doc comment.** Two places currently assert "exactly two event types". They become three, and the doc must state the new shape of the whitelist rule: a trip is whitelisted because it is append-only by construction — it decides nothing, so there is no verdict for it to overwrite. Keep the existing "this is not a general event-append surface" sentence; it is still true and still the point.
- [ ] **Step 4: Run the test script** — expect PASS.
- [ ] **Step 5: Run `npm run lint`** — 0 errors.
- [ ] **Step 6: Commit** `feat(quality): whitelist quality.signal.tripped in the events core`.

### Task 4: the asymmetric scope guard on the route

**Files:**
- Modify: `app/api/graph/projects/[projectId]/quality/events/route.ts`
- Test: whichever `tests/services` suite covers this route's guards (check `graph-api.test.js` and `auth-guard.test.js` first). **If no DB-free seam exists for this route, do not build one** — instead assert the decision function in isolation (see Step 1).

- [ ] **Step 1: Write the failing test.** The scope decision is the only new logic and it is pure, so extract it rather than reaching for the route:

  In `quality-events.ts`, add and export:
  ```ts
  /**
   * Which scope this batch requires.
   *
   * A trip is append-only by construction, so `quality:append` suffices for a
   * batch of nothing but trips. Any finding decision in the batch is a verdict
   * on the graph's quality state and needs `graph:write` — which is what makes
   * a CI credential in a public repo unable to decide a finding's fate, the
   * bar issue #406 exists to clear.
   */
  export function requiredScopeFor(inputs: readonly QualityEventInput[]): "graph:write" | "quality:append" {
    return inputs.every((i) => i.type === "quality.signal.tripped") ? "quality:append" : "graph:write";
  }
  ```
  Test it in `tests/services/quality-events.test.js`: all-trips → `quality:append`; one resolution → `graph:write`; a mixed batch → `graph:write`.

- [ ] **Step 2: Run the test script** — expect FAIL.
- [ ] **Step 3: Implement.** In the route:
  - The pre-parse guard widens to: `if (!hasScope(caller, "graph:write") && !hasScope(caller, "quality:append")) return 403 { error: "insufficient_scope", required: "graph:write" }`. The broad scope stays the one named for the broad ask.
  - After `parseQualityEventInputs` succeeds, add the post-parse guard:
    ```ts
    const required = requiredScopeFor(inputs);
    if (!hasScope(caller, required)) {
      return Response.json({ error: "insufficient_scope", required }, { status: 403 });
    }
    ```
    This is post-parse because it needs the event types — say so in a comment.
  - **Require `commit` on a trip written through this route.** `parseQualityEventInputs` already requires it (Task 3), so there is nothing extra to enforce here — add one comment line at the parse call recording *why* the shape is strict for this type and not for repo-mode trips: this is the caller class that pays nothing for its commit.
  - Update the route's doc comment: the whitelist is three types; the guard is asymmetric; a `quality:append` token can append an observation and nothing else.
- [ ] **Step 4: Run the test script and `npm run lint`** — PASS, 0 errors.
- [ ] **Step 5: Commit** `feat(api): accept quality.signal.tripped under quality:append`.

---

## Part 3 — docs

### Task 5: state the new surface where the three docs assert the old one

**Files:**
- Modify: `docs/hosted-projects.md` (scopes, ~line 42)
- Modify: `docs/spec/journal.md` (the event table row, line 87)
- Modify: `docs/rfcs/kritik.md` (decision 8, line 231)

- [ ] **Step 1: `docs/spec/journal.md`.** The `quality.signal.tripped` row's field list becomes `criterion_id`, `surface`, `signal`, `commit?`, `detail?`. Add one sentence after the table's `quality.*` paragraph: a trip written from CI against a hosted project carries the commit it observed and, by convention, its run URL in `detail` — the writer that always knows both.

- [ ] **Step 2: `docs/hosted-projects.md`.** After the existing scopes paragraph, add a short subsection — in the document's voice, second person, no bullets-for-their-own-sake — covering:
  - `quality:append` is the scope for a CI job, and it is not a default. It can append one kind of event to one route: a tripped Kritik signal. It cannot read your graph, read your findings, or decide a finding.
  - Why that matters: this is the credential you can put in a **public** repository's Actions secrets, because there is nothing in it worth stealing beyond the ability to write an observation you would have written anyway.
  - A worked example, as a workflow step:
    ```yaml
    - name: Record the trip
      if: failure()
      run: |
        curl -sS -X POST "$ARKAIK_URL/api/graph/projects/$PROJECT_ID/quality/events" \
          -H "Authorization: Bearer $ARKAIK_TOKEN" \
          -H "Content-Type: application/json" \
          -d "$(jq -n --arg c "$GITHUB_SHA" --arg d "$GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID" \
            '{events:[{type:"quality.signal.tripped",criterion_id:"SEC-supabase-01",surface:"supabase",signal:"contract harnesses pass against the linked project",commit:$c,detail:$d}]}')"
      env:
        ARKAIK_TOKEN: ${{ secrets.ARKAIK_QUALITY_TOKEN }}
    ```
  - One line on what a trip is *not*: it is not a finding. Nothing in CI mints findings; a trip is the prompt to go look.

- [ ] **Step 3: `docs/rfcs/kritik.md` decision 8.** It currently says the transitions post "a whitelisted event — `quality.finding.resolved` or `quality.finding.accepted`" and that "the scope split is `graph:read` for the reads above and `graph:write` for the two transitions". Amend in place, in the decision's existing dense voice: a third whitelisted type, `quality.signal.tripped`, written by CI rather than by an agent session; the scope split gains `quality:append`, which admits only that type, so a credential held in a public repository's secrets can append an observation without being able to read the graph or decide a finding; and the trip carries the `commit` it observed, the one writer class that pays nothing for the anchor. Note the read side is unchanged: `kritik_signals` stays repo-only, because the signal pack and its run sheet live with the code — the hosted trip is a write, not a window.

- [ ] **Step 4:** Re-read what you wrote against `docs/conventions.md`'s prose rules if it has any. Then `npm run lint` (docs may be linted) and commit `docs: quality:append and the third whitelisted event`.

---

## Definition of done for the stack

- [ ] `quality:append` exists, is not a default, and is offered in the settings UI with a hint that states the whole grant.
- [ ] `POST …/quality/events` accepts `quality.signal.tripped` with a required `commit`, refuses it without one as a 400, and accepts it from a token holding only `quality:append`.
- [ ] That same token gets a 403 naming `graph:write` if it sends a finding decision.
- [ ] `snapshot.quality` is still never written by this route.
- [ ] All three parts: `npm run lint` clean, generated artifacts committed, every new test DB-free and registered in an npm script.
- [ ] Each PR body carries a Lab Note (parts 1 and 3 are plausibly no-note chores — apply the gate per part, and use the `no-lab-note` label rather than an empty section).
