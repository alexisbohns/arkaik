# Hosted Kritik: the read/write loop for findings that already live on the host

**Issue:** #400 · **Date:** 2026-09-02 · **Status:** approved

## Problem

Kritik's MCP tools refuse in hosted mode on a premise phases D and E made
false: that a hosted project has no quality state. It has — the `quality`
section is Zod-validated on import, stored in `graph_projects.snapshot`,
served folded over `GET /api/graph/projects/{id}`, rendered by the app, and
already written to (events-only) by the GitHub App. Yet an agent in a hosted
session cannot read a single finding, and nothing can update one without a
checkout and a whole-bundle `PUT`. Issue #400 documents an agent one refusal
away from reporting a wrong answer as fact.

The old rationale conflates *running* an audit (which reads code and genuinely
needs a working tree) with *reading and maintaining* its results (which needs
none).

## Settled decisions

These were the issue's six open questions; all are now decided:

1. **Tool split:** the catalog stays identical in both modes (the spec's
   standing promise). Tools that read or transition state work hosted; tools
   that read code refuse with a message that says *why* — "scoring reads
   code" — distinct from a blanket "Kritik is repo-only".
2. **Write mechanism: events-only.** Extend the webhook's proven pattern —
   append `quality.finding.*` events to the journal, re-derive current state
   on read. Zero migrations; a dated audit verdict stays immutable;
   `snapshot.quality` is never mutated by these writes (phase E doctrine).
3. **Findings stay a living pool.** No `audit_id` on findings; history lives
   in the journal, matching assessments' "latest wins" semantics. No
   re-restore of live data.
4. **Evidence anchoring:** `QualityFindingSchema` gains an optional `commit`
   field now. The rule — any hosted-written *open* or *score* must carry a
   commit — is recorded here and becomes enforceable when hosted opens exist
   (see Non-goals). Resolve/accept need no commit: they cite a PR or a
   decision, not code.
5. **Cross-project rollup: out of scope.** Events-only does not foreclose
   tables later; a rollup can project from journals when it becomes real.
6. **Token scope: keep `graph:read` / `graph:write`.** Owner tokens already
   receive `bundle.quality` on `GET` under `graph:read`, so a finer scope
   would protect nothing not already exposed. `stripQuality` remains the
   public-side (Publik) guard and must not regress.

## Two load-bearing facts

- The hosted **read path already delivers the data.** The remote store's
  `load()` fetches `GET /api/graph/projects/{id}`, whose response carries
  `bundle.quality` folded through `foldResolvedFindings`
  (`app/api/graph/projects/[projectId]/route.ts:46`). Only the kritik tools
  refuse to look at it.
- `quality.finding.accepted` **does not exist** as an event type, and
  `quality.finding.opened` carries a summary of the finding, not its full
  shape — so a read-side fold cannot materialize a hosted-opened finding.
  That is what makes hosted *opens* a bigger job than hosted *resolve/accept*
  and puts them out of scope.

## Design

### 1. Schema (`packages/schema`)

- New event type `quality.finding.accepted`: `finding_id`, `reason`,
  optional `node_ids`. Schema in `journal-events.ts`, registered in
  `JOURNAL_EVENT_SCHEMAS`; `findingAcceptedInput` helper in `quality-ops.ts`
  mirroring `findingResolvedInput`.
- `QualityFindingSchema` gains optional `commit` (a commit SHA anchoring the
  `file:line` evidence). No live data changes; 0-of-246 existing findings
  carry one and stay valid.

### 2. Server (Next.js app)

- `foldResolvedFindings` (`lib/utils/quality.ts:550`) grows to fold
  `quality.finding.accepted` → status `accepted-risk` (carrying the event's
  `reason`), under the same semantics as resolved: only an *open* finding
  moves; `refuted` / `accepted-risk` / `resolved` are decisions already
  recorded and are left alone. Rename or wrap so the name stops lying
  (e.g. `foldFindingEvents`).
- `qualityResolutionEvents` (`lib/services/graph/store.ts`) fetches both
  event types.
- **New route:** `POST /api/graph/projects/{projectId}/quality/events`,
  gated on `graph:write`.
  - Accepts a whitelist of event *inputs* only: `quality.finding.resolved`
    and `quality.finding.accepted`. Anything else → 400. The journal `GET`
    route stays read-only; this route does not become a general event-append
    surface.
  - Verifies the named finding exists in the stored section and is open
    (post-fold — a finding already resolved by an earlier event refuses
    too). A miss is a refusal with a reason, never silence: `unknown_finding`
    / `not_open`.
  - Stamps `id`/`ts` server-side and records the caller as actor
    (`arkaik-agent` for token callers), then appends via the same
    `appendJournalEvents` the webhook uses. `snapshot.quality` is never
    mutated. No bundle `PUT` is involved, so #392's validator-leniency gap
    is sidestepped entirely.
  - Same size/shape rails as sibling routes (byte cap before parse, bounded
    batch).

### 3. MCP (`packages/mcp`)

- Replace `KritikContext`'s bare `qualityRoot: string | undefined` + blanket
  refusal with a small **quality access seam** (the store seam the issue says
  is missing):
  - **Repo implementation:** today's behavior — `docs/quality/` file ops,
    journal-first dual-write. Unchanged semantics.
  - **Hosted implementation:** reads take the quality section from
    `store.load()`'s bundle (already folded by the server); resolve/accept
    `POST` to the new quality events route.
- Tool behavior by mode:

  | Tool | Repo | Hosted |
  |---|---|---|
  | `kritik_findings` | files | stored section (fetch by id, filter by surface/status) |
  | `kritik_matrix` | files | `deriveQualityMatrix` over stored section |
  | `kritik_regressions` | files | `detectRegressions` over stored assessments |
  | `kritik_issue` | files | pure render from a stored finding |
  | `kritik_resolve_finding` | files + journal | event append via new route |
  | `kritik_accept_finding` | files + journal | event append via new route |
  | `kritik_score` | works | refuses: "scoring reads code — run where the checkout is" |
  | `kritik_signals` | works | refuses: same class (signal pack lives in the repo) |
  | `kritik_trip_signal` | works | refuses: same class |
  | `kritik_open_finding` | works | refuses: "a new finding cites code" (see Non-goals) |

  The catalog is identical in both modes; only refusals differ, and each
  refusal now distinguishes "needs code" from "not supported here".
- Reconcile `qualityRootFor` (`packages/mcp/src/index.ts:87`) and
  `resolveQualityRoot` (`packages/cli/src/lib/kritik-io.ts:305`) into one
  function, keeping the documented behavioral difference deliberate (bundle-dir
  fallback + `$ARKAIK_QUALITY_ROOT` for the server; cwd fallback for the CLI)
  or collapsing it if inspection shows it unneeded — decided in that part,
  not as a drive-by.

### 4. Docs

Update the three places asserting the stale premise to state the read/run
split: `docs/spec/mcp.md:137`, `docs/rfcs/kritik.md` §8.7, and the
`kritik-tools.ts` header comment. Restate the half that remains true: running
an audit reads code and stays repo-only.

## Error handling

- Hosted read tools on a project with **no quality section**: a plain "this
  project has no quality data yet — run an audit in the repo and `arkaik
  restore` it" result, not an exception.
- Hosted resolve/accept on an unknown or non-open finding: the route's
  `unknown_finding` / `not_open` refusal surfaces verbatim as the tool error.
- Journal append refusal (validator): reported as a refusal, never as
  success — same rule the webhook enforces ("an append that wrote nothing is
  a refusal").

## Testing

- Schema: event round-trip + `parseBundle` accepts a finding with `commit`.
- Server: fold cases for accepted (open → accepted-risk; decided findings
  untouched; unknown ids ignored), route auth/whitelist/refusal/append paths.
  DB-free where possible per repo convention (pure fold logic; route logic
  behind an injected state reader like `applyQualityResolutions`).
- MCP: hosted-mode tool tests against a stubbed remote store (existing
  pattern in `tests/mcp/`); refusal messages asserted for the repo-only four.
- Repo mode: existing kritik tool tests keep passing untouched — the seam
  refactor must be behavior-preserving.

## Definition of done (from #400)

An agent in a hosted session can fetch a finding by id, list what is open on
a surface, see the matrix, and move a finding to `resolved` /
`accepted-risk` with an actor recorded — without a checkout. Scoring still
refuses, with a message that distinguishes "needs code" from "not supported
here". The three docs asserting the old premise say what is now true.

## Non-goals

- Running audits server-side (scoring reads code; the standing decision is
  restated, not reversed).
- **Hosted `kritik_open_finding`.** The opened event cannot carry a full
  finding today; when hosted opens arrive they must carry `commit` (decision
  4). The optional field lands now so that rule is enforceable then.
- `kritik_profile` / `kritik_criterion_add` mirrors (RFC §8.7).
- Cross-project rollup; `quality_*` tables.
- New token scopes.

## Shipping shape

A 4-part `gh stack`, ordered by dependency:

1. **schema** — `quality.finding.accepted` event + input helper; optional
   `commit` on findings.
2. **server** — fold extension, both-types event query, `POST
   …/quality/events` route.
3. **mcp** — the quality access seam, hosted tool behavior, refusal split,
   quality-root reconciliation.
4. **docs** — the three premise updates.

Each part passes lint/typecheck alone. The stack's Lab Note rides the MCP
part: agents can now read and close findings on hosted projects.
