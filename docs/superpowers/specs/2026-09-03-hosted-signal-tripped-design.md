# Hosted `quality.signal.tripped`: a CI writer behind an append-only scope

**Issue:** #406 · **Date:** 2026-09-03 · **Status:** approved

## Problem

#400 shipped hosted Kritik's read/transition loop, and its events-only design
was validated before it landed by a concrete consumer that the stack
deliberately did not cover: `pbbls`' database contract harnesses
(alexisbohns/pbbls#741, #743), wired into CI. Their nightly run against `main`
is the gate that catches a regression introduced by a PR that never touched
`packages/supabase/**` — and when it goes red, that result "had nowhere
durable to go". It went to a GitHub issue instead
(alexisbohns/pbbls#745), recorded as blocked.

The failing harness is the exact guard that closed
`F-2026-08-SEC-supabase-01`. The ledger that raised the finding should hear
that its remediation regressed. In Kritik's vocabulary that is not a finding —
CI must never mint findings — it is a `quality.signal.tripped`: cheap,
frequent, allowed to be wrong, the prompt to go look.

Two things block it:

1. **The whitelist.** `POST /api/graph/projects/{id}/quality/events` accepts
   exactly `quality.finding.resolved` and `quality.finding.accepted`.
2. **The token.** `pbbls` is a public repo. A hosted write from its Actions
   means a credential in repository secrets, and that repo has already refused
   a `SUPABASE_SERVICE_ROLE_KEY` on exactly this bar. Their stated
   requirement: "a write-only, append-only, project-scoped credential would
   clear it; anything that can also read or mutate the graph broadly would
   not." `graph:write` can mutate the whole graph.

#400's decision 6 (keep `graph:read`/`graph:write`) was made for the
agent-session case and is right there. A CI credential in a public repo is a
different caller class.

## Settled decisions

1. **Write-only. No read path at all.** The consumer "knows what broke,
   because it just ran it." `kritik_signals` stays repo-mode-only — the signal
   pack and its run sheet live with the code, and nothing here changes that.
   A hosted trip is visible through the journal read that already exists; the
   `tripped_since_last_audit` window is computed by the repo-mode tool over
   the same events once a checkout has them. Designing a hosted signals window
   is not required to make this consumer whole, and is not attempted.
2. **A fourth token scope, `quality:append`.** It grants exactly one route
   and, within it, exactly one event type. `DEFAULT_TOKEN_SCOPES` is
   unchanged, so nothing mints it by accident.
3. **The scope is asymmetric, deliberately.** `graph:write` keeps its #400
   powers on this route (resolve, accept, and now trip). `quality:append`
   alone may append `quality.signal.tripped` and **nothing else** — a
   `finding.resolved` or `finding.accepted` from a `quality:append`-only
   caller is a 403 naming the scope it lacks. That is what makes the CI
   credential unable to decide a finding's fate, which was the actual bar.
4. **Evidence is required for this writer class.** The tripped event schema
   gains an optional `commit`, mirroring the anchor #400 put on the finding
   shape; the hosted route *refuses a trip without it*. Repo-mode trips
   (`kritik_trip_signal`, `kritik_regressions --record`) are unaffected,
   because they were never the writer class the rule is about. The run URL
   rides in the existing free-form `detail`. A CI writer pays nothing for
   either: `GITHUB_SHA` and the run URL are ambient in a workflow.
5. **Still events-only, still no snapshot writes.** A trip changes no
   finding's status, so `snapshot.quality` is untouched here for the same
   reason it is untouched by resolve/accept. #392 remains sidestepped.

## Design

### Schema (`packages/schema`)

`QualitySignalTrippedEventSchema`, the `QualitySignalTrippedEvent` interface,
and `signalTrippedInput` each gain an optional `commit: string`. Optional is
correct at this layer: the schema describes every trip in every mode, and
repo-mode trips have no obligation to carry one. Requiring it is a *route*
policy about a *caller class*, and belongs where that class is identified.

### Token scope (`lib/services/tokens.ts`, `components/settings/TokenManager.tsx`)

`TOKEN_SCOPES` becomes `["graph:read", "graph:write", "synk",
"quality:append"]`. `DEFAULT_TOKEN_SCOPES` is unchanged. The settings UI gains
a fourth checkbox whose hint states the whole grant — append a tripped quality
signal; no reads, no graph writes — so what the reader is about to paste into
a public repo's secrets is legible at mint time.

Unknown-scope-dropping in `createToken` already means an older client asking
for an unknown scope is narrowed rather than rejected; nothing about that
changes.

### The pure core (`lib/services/graph/quality-events.ts`)

`QualityEventInput` gains a third member:

```ts
| {
    type: "quality.signal.tripped";
    criterion_id: string;
    surface: string;
    signal: string;
    commit: string;
    detail?: string;
  }
```

`parseQualityEventInputs` inverts one thing. Today it validates `finding_id`
*before* it reads `type`, which is fine while every accepted type has one; a
trip has none. `type` is read first, then the per-type fields — so
`finding_id` is checked in the two finding branches and `criterion_id` /
`surface` / `signal` / `commit` in the trip branch. The error messages keep
their `events[i].field must be …` shape, and the type error now names three
legal values.

`planQualityEvents` skips the finding lookup entirely for a trip: no
`unknown_finding`, no `not_open`, no `decidedInBatch` entry, because a trip
decides nothing. It emits `makeEvent(signalTrippedInput(...))` and moves on.
Batches stay all-or-nothing, so a trip batched alongside a refused finding
decision is refused with it.

`planQualityEvents` gains no new refusal reason. A missing `commit` is a
*shape* error, caught by `parseQualityEventInputs` → 400, not a 422 refusal:
the caller sent something malformed, not something the graph declined.

### The route

The scope guard becomes two-sided:

- Reject with 401 if there is no caller (unchanged).
- A caller with neither `graph:write` nor `quality:append` gets 403,
  `required: "graph:write"` — the broad scope stays the one named for the
  broad ask.
- After parsing, a caller that holds `quality:append` but not `graph:write`
  and sent any non-trip entry gets 403 with
  `{ error: "insufficient_scope", required: "graph:write" }`. The check is
  post-parse because it needs the event types, which is also why it cannot be
  folded into the first guard.

`actor` for a token caller stays `arkaik-agent` — a trip written by CI is a
machine write like any other, and the token id is already the audit handle for
*which* machine.

### Testing

Everything new is DB-free, per the repo's standing constraint (no local
Postgres):

- `tests/services/quality-events.test.js` (pure core, via its existing
  loader): a trip parses with commit and detail; a trip missing `commit`
  errors; a trip missing `criterion_id`/`surface`/`signal` errors; an unknown
  type names all three legal values; `planQualityEvents` emits a trip event
  without consulting the section; a trip mixed with a valid finding resolution
  produces both events; a trip mixed with a refused finding decision is
  refused all-or-nothing.
- `tests/schema/quality.test.js`: `signalTrippedInput` carries `commit` when
  given and omits the key when not; the event validates against
  `JOURNAL_EVENT_SCHEMAS["quality.signal.tripped"]`.
- `tests/services/token-auth.test.js`: `quality:append` is a recognized scope,
  survives the mint/verify round-trip, and is not in `DEFAULT_TOKEN_SCOPES`.

### Docs

- `docs/hosted-projects.md` — the scope table gains `quality:append`, with a
  worked CI example (a workflow step posting one trip with `GITHUB_SHA` and
  the run URL).
- `docs/spec/journal.md` — the `quality.signal.tripped` entry gains `commit`.
- `docs/rfcs/kritik.md` and any #400-era text asserting the whitelist is
  "exactly two types" — updated to three, with the asymmetry stated.

## Non-goals

- Hosted `kritik_open_finding`. A finding cites code.
- Running audits server-side.
- Any read path for CI writers, including a hosted `kritik_signals`.
- The `pbbls` workflow YAML itself, which lives in that repo. This stack makes
  it possible; alexisbohns/pbbls#745 unblocks on it.

## Definition of done

A public repo's nightly workflow, holding a `quality:append` token, can record
`quality.signal.tripped` with a commit and a run URL against its linked hosted
project — and that token cannot read the graph, cannot read findings, and
cannot write any other event, including a finding decision.
