# Kritik phase E — the loop

**Date:** 2026-08-29
**Status:** approved, implementing
**Issue:** [#382](https://github.com/alexisbohns/arkaik/issues/382) phase E
**Follows:** #383 (schema), #384 (plugin), #385 (CLI/MCP), #386 (release), #387 (the app feature)
**RFC:** [`docs/rfcs/kritik.md`](../../rfcs/kritik.md) §§ 3.2, 3.4, 8.6

## Problem

Kritik can score a product, store the result, and render it. Nothing writes back
into it once an audit ends.

Two loops are missing, and they are the two the RFC named. A PR that fixes a
finding merges and the finding stays open forever — until somebody runs a whole
new audit and re-scores the cell by hand. And drift *between* audits announces
itself to nobody: the pack's `signals[]` are printed as a run sheet (phase C,
RFC § 8.6) but two consecutive audits are never compared, so a maturity level
that fell back from 3 to 2 is discovered the third time somebody looks.

Phase E closes both. It is the last phase, and it is the only one that writes to
Kritik state from outside an audit.

## What is already true

Five facts, each verified against the code, that remove work this phase might
otherwise carry:

1. **The event shapes exist and are strict.** `QualityFindingResolvedEventSchema`
   and `QualitySignalTrippedEventSchema` landed in phase A. Nothing here defines
   an event; it fills in the two that have had no producer.
2. **The finding id was designed for this.** `mintFindingId` mints
   `F-<audit>-<DOMAIN>-<surface>-NN` and says why in its own comment: "stable
   enough to quote in a PR body, which is how `quality.finding.resolved` finds
   its way back". The webhook grammar is reading back what phase C wrote.
3. **The webhook already has the shape.** `applyLabNote` is a merged-PR half
   that appends journal events per linked project, treats parse problems as
   outcomes, and throws only on infrastructure failures so the delivery claim's
   release/retry covers it. Phase E's half is the same shape, one file over.
4. **The audit history is on disk, per audit.** `listAuditIds`, `loadScores` and
   `loadFindings` already read `docs/quality/audits/<id>/` one audit at a time.
   Comparing two is a pure function over what those already return.
5. **`resolved_by` is already the vocabulary.** `resolveFinding` takes it,
   `findingResolvedInput` carries it, and the RFC defines it as "the PR/commit
   URL". The webhook has exactly that value in hand.

## Decisions taken before the design

| Question | Decision |
| --- | --- |
| PR slicing | **One PR, all three parts** — matches "one PR per phase" and how A–D landed. |
| Webhook detection | **Both channels**: finding ids in the PR text, and closing keywords whose issue matches a finding's `issue_url`. |
| What a resolution changes | **Journal append + a read-side fold.** The webhook's write stays a pure append. |
| Fold site | **Where the app's bundle is assembled** — the hosted GET route and `localProvider.getProject`, not `store.getProject`. |
| Regression kinds | **Level drops, new open Critical/High, reopened findings.** |
| `signals` | **Unchanged.** It prints a run sheet; RFC § 8.6 stands. |

### Why the fold is not in `store.getProject`

`store.getProject` has three callers, and only one of them is the app's read.
The other two are `applyPullRequestEvent` — which loads a bundle to *plan
mutations from* — and the pollen route. Folding there would put a derived
finding status inside the object the acceptance planner reasons about, one
refactor away from a fold being written back to the snapshot as though it had
been stored. Folding at the two places that assemble a bundle *for the app*
keeps the derived value on the read path where it belongs, and leaves every
other caller looking at exactly what Postgres holds.

## Design

### 1. The webhook half — `lib/services/github/quality.ts`

The third half of a merged-PR delivery, beside `applyPullRequestEvent` and
`applyLabNote`, called from the same `try` in the route for the same reason: a
transient failure releases the delivery claim and the retry redoes all three,
and all three are idempotent by construction.

```ts
export type QualityResolutionOutcome =
  | { projectId: string; status: "resolved"; findingId: string; eventId: string }
  | { projectId: string; status: "unchanged"; findingId: string }
  | { projectId: string; status: "unknown"; findingId: string }
  | { status: "no_mentions" };

export async function applyQualityResolutions(
  event: PullRequestEvent,
  options: { readState?: ReadProjectQualityState } = {},
): Promise<QualityResolutionOutcome[]>
```

Per linked project (deduped exactly as `applyLabNote` dedupes — a monorepo's
several path-scoped links to one repository still produce one pass):

1. Read the project's stored `quality.findings` — through `store.getProject`,
   which is deliberately *not* folded, so the pass sees what Postgres holds —
   and its existing `quality.finding.resolved` events. That read is the one
   injectable seam (`options.readState`), the way `applyPullRequestEvent`
   already injects `fetchFiles`, so the whole pass is pinned without a database.
2. Match the PR's mentions against them: finding ids directly, issue references
   against each finding's `issue_url`.
3. Keep only findings whose status is **`open`**. `refuted` and `accepted-risk`
   are decisions somebody recorded, not defects waiting to be closed, and a PR
   that happens to name one must not overwrite that.
4. Skip anything already resolved — in the section, or by a
   `quality.finding.resolved` already in the journal. This is the open-minus-
   resolved projection consulted *before* writing, and it is what makes a PR
   reopened and re-merged safe. The delivery claim covers a redelivery; it does
   not cover a genuinely second merge event.
5. Append one `quality.finding.resolved` per surviving match through
   `appendJournalEvents`, actor `github-app`, `resolved_by` the PR URL, carrying
   the finding's `node_ids` so the resolution reaches the graph the same way the
   opening did.

A mentioned id that matches no finding comes back as `status: "unknown"` rather
than as silence — the same reasoning as `unknownPlatformWarnings` and as the
route's `skipped: "no project has linked …"`. A typo'd finding id is the
commonest reason "nothing happened", and an empty outcome list names nothing.

### 2. The mention grammar — `lib/services/github/quality-parse.ts`

Pure, DB-free, no imports beyond types, mirroring `lab-note-parse.ts`.

```ts
export function mentionedFindings(event: Pick<PullRequestEvent, "title" | "body">): string[]
export function closedIssues(event: Pick<PullRequestEvent, "title" | "body">): IssueRef[]
export function parseIssueRef(url: string): IssueRef | undefined
export interface IssueRef { repo: string; number: number }
```

**Finding ids are matched in two steps, on purpose.** A finding id is
hyphen-separated with three variable-length parts — the audit id is itself
hyphenated (`2026-08`), the surface may be (`cross-surface`) — so a regex that
decomposes it needs a quantifier followed by `-\d{2,}`, which backtracks. A PR
body is attacker-influenced input (anyone can open a PR from a fork) and up to
2 MB, and `pull-request.ts` already holds itself to "linear by construction" for
this exact reason. So the regex only *recognises a candidate token* —
`/\bF-[A-Za-z0-9-]{3,80}\b/g`, one bounded quantifier with nothing ambiguous
after it — and a plain string check decides whether the token is a finding id
(at least three segments, last segment all digits). The validation is four lines
of JavaScript and cannot backtrack at all.

**Closing keywords** are GitHub's own set — `close`/`closes`/`closed`,
`fix`/`fixes`/`fixed`, `resolve`/`resolves`/`resolved` — followed by `#123`,
`owner/repo#123`, or a full `https://github.com/owner/repo/issues/123`. Every
quantifier is bounded; the alternation is flat.

**Matching an issue to a finding compares parsed pairs, not strings.**
`parseIssueRef` reduces both the finding's `issue_url` and the PR's reference to
`{repo, number}`, so a trailing slash, a `www.`, or `http` vs `https` cannot
make a real match miss. A bare `#123` takes the PR's own repository; an
`owner/repo#123` keeps the one it names.

### 3. The fold — `foldResolvedFindings` in `lib/utils/quality.ts`

```ts
export function foldResolvedFindings(
  section: QualitySection | undefined,
  events: readonly JournalEvent[],
): QualitySection | undefined
```

Pure, and **returns its input by reference** when no `quality.finding.resolved`
event names a finding the section holds. That is the overwhelmingly common case
— every project without a webhook resolution since its last audit — and it means
the fold allocates nothing, changes no memo identity, and re-renders nothing.

For each match still `open`: `status: "resolved"`, plus `resolved_by` from the
event when it carries one, so the board can link the PR that proves it. A
`refuted` or `accepted-risk` finding is left exactly as it is, for the reason
the webhook already refuses to resolve one. An event naming a finding the
section does not hold is ignored — `validateBundle` already warns about that
class (RFC § 4.5) and a read projection is not the place to raise it again.

Two call sites, both of which assemble a bundle *for the app*:

- `app/api/graph/projects/[projectId]/route.ts` (GET) — with a new narrow store
  read, `qualityResolutionEvents(projectId, ownerIds)`, that selects only
  `event->>'type' = 'quality.finding.resolved'` rows rather than pulling a
  project's whole history to fold a handful of events over it.
- `lib/data/local-provider.ts` `getProject` — which already holds
  `journalRow?.events`, so it folds with what it has. Local projects receive no
  webhook, but they do receive imported bundles whose journals carry
  resolutions, and the two providers must not disagree about what a bundle says.

All five existing consumers become correct with no change of their own: the
matrix and the findings board (`app/project/[id]/quality/page.tsx`), the overview
gauge, the node badge on both maps, and the node panel's Findings section.
`/export` and `/bundle` keep serving stored truth, so a round-trip through the
CLI is untouched.

### 4. Regression detection — `packages/schema/src/quality-regressions.ts`

A new module rather than more of `quality-ops.ts`, which is already 488 lines
across five concerns. Same two disciplines as its neighbours: zod-free and
fs-free (type-only imports), and nothing mutates its input.

```ts
export type RegressionKind = "level-drop" | "new-severe-finding" | "reopened-finding";

export interface Regression {
  kind: RegressionKind;
  criterion_id: string;
  surface: string;
  /** The statement that no longer holds — what the trip event carries. */
  signal: string;
  detail: string;
}

export function detectRegressions(
  previous: Pick<QualitySection, "assessments" | "findings">,
  next: Pick<QualitySection, "assessments" | "findings">,
  library?: KritikLibrary,
): Regression[]
```

| Kind | Fires when | Signal statement |
| --- | --- | --- |
| `level-drop` | a cell's maturity level is lower in `next` than in `previous` | `maturity on this cell does not regress` |
| `new-severe-finding` | a cell has an open Critical or High finding in `next` and had none in `previous` | `no open Critical or High finding on this cell` |
| `reopened-finding` | a finding id reads `resolved` in `previous` and `open` in `next` | `a resolved finding stays resolved` |

**The guard, and its one exemption.** `level-drop` and `new-severe-finding`
compare a cell to itself, so both require the cell to be **scored in both
audits**. Without it, a half-finished new audit would fire a trip for every cell
it has not reached yet — hundreds of them, all saying "not scored yet", which is
the fastest way to teach somebody to ignore the runner. `reopened-finding`
compares a finding to itself and needs no cell reading at all, so the guard does
not apply to it; a finding that came back matters whether or not its cell was
re-scored.

Severity is `severityOf(finding, library)`, never a restatement of the buckets —
a pack that retunes its scales must move the runner with it.

`detail` says what actually changed, in the terms the reader has: `level 3 → 2
(2026-08 → 2026-09)`, `F-2026-09-SEC-web-01 — critical (impact 5 × likelihood
4)`, `F-2026-08-PRV-ios-02 — "Analytics SDK ships before consent"`.

### 5. The verb — `arkaik kritik regressions`

```
arkaik kritik regressions [--from <audit>] [--to <audit>] [--record] [--json]
```

`--to` defaults to the newest audit, `--from` to the one before it. With fewer
than two audits it refuses and says why: a regression needs two readings.

`--record` appends one `quality.signal.tripped` per regression, through
`signalTrippedInput` and the same `reportJournal` path every other verb writes
by. Exit code 1 when anything regressed, 0 otherwise — the same CI contract
`signals` already offers, so a scheduled job can run one, the other, or both.

`signals` itself is untouched. RFC § 8.6 decided it prints a run sheet and does
not execute one, and this phase is where the other half of that decision —
"regression detection between two audits' matrices stays with the phase-E
runner" — gets built somewhere else. `signals`' summary line gains one pointer
to `regressions` when a second audit exists.

### 6. The other two entry points

**MCP** — `kritik_regressions`, repo-mode only like every other `kritik_*` tool
(RFC § 8.7): `from`, `to`, and an optional `record`, calling the same
`detectRegressions`. Rule 8 of this program holds: three entry points, one
implementation.

**Plugin** — a `detect-regressions.js` script generated from a new
`packages/schema/src/cli/kritik-regressions-cli.ts`, which is a four-line
addition to `SCRIPTS` in `scripts/generate/build-kritik-scripts.js`, so a
project running Kritik from the plugin alone can run the check too. The skill's
between-audits section gains the step; the CI drift gate covers the script
exactly as it covers `compute-matrix.js`.

## Files

**New**

| Path | What |
| --- | --- |
| `lib/services/github/quality-parse.ts` | The mention grammar. Pure, DB-free. |
| `lib/services/github/quality.ts` | `applyQualityResolutions`. |
| `packages/schema/src/quality-regressions.ts` | `detectRegressions`. |
| `packages/schema/src/cli/kritik-regressions-cli.ts` | The plugin script's entry. |
| `tests/services/quality-webhook.test.js` | The grammar and the resolution pass. |
| `tests/schema/quality-regressions.test.js` | The three kinds and the guard. |

**Changed**

| Path | Change |
| --- | --- |
| `app/api/github/webhook/route.ts` | One call beside `applyLabNote`; outcomes in the response. |
| `app/api/graph/projects/[projectId]/route.ts` | Fold on GET. |
| `lib/services/graph/store.ts` | `qualityResolutionEvents`. |
| `lib/data/local-provider.ts` | Fold in `getProject`. |
| `lib/utils/quality.ts` | `foldResolvedFindings`. |
| `packages/schema/src/index.ts` | Export the regression module. |
| `packages/cli/src/commands/kritik.ts` | The `regressions` verb; the `signals` pointer. |
| `packages/mcp/src/kritik-tools.ts` | `kritik_regressions`. |
| `scripts/generate/build-kritik-scripts.js` | The new script entry. |
| `docs/kritik-skill/skill.md` | The between-audits step (generated into the plugin). |
| `tests/app/quality.test.js` | The fold. |
| `tests/cli/kritik.test.js` | The verb. |
| `tests/mcp/kritik-tools.test.js` | The tool. |

## Testing

Everything is DB-free, per the standing constraint that the services suites
no-op on a machine without Postgres.

- **The grammar** (`tests/services/quality-webhook.test.js`): ids found in title
  and body; the `2026-08` / `cross-surface` hyphenation actually parsing; a
  near-miss (`F-nope`, `F-2026-08-SEC-web-`) rejected; all nine closing
  keywords; `#12`, `owner/repo#12` and the full URL form; `parseIssueRef`
  round-tripping past a trailing slash and an `http` scheme; and a body of
  pathological `F-` repetitions completing in bounded time.
- **The resolution pass**: matched-by-id and matched-by-issue both resolve;
  `refuted` and `accepted-risk` are refused; an already-resolved finding is
  `unchanged`; a second merge appends nothing; an unmatched id is reported. The
  project read is injected through `options.readState`, the way
  `applyPullRequestEvent` already injects `fetchFiles`, so the pass is pinned
  without a database.
- **The fold** (`tests/app/quality.test.js`): a resolution flips the finding, an
  unmatched event is ignored, a `refuted` finding survives, `resolved_by` lands,
  and the no-match case returns the **same object reference**. Then the pair
  that makes it matter: the matrix uncaps and the node badge clears once a
  Critical is folded resolved.
- **`detectRegressions`** (`tests/schema/quality-regressions.test.js`): each kind
  once, the guard suppressing an unscored cell, the exemption letting a reopen
  through, and — following the lesson from this program's golden fixture — the
  severity assertions run against a pack whose `severity_buckets` are **not** the
  schema defaults, so a mutant that hardcodes `20..25` fails rather than passes.
- **The verb and the tool**: default audit selection, `--record` appending
  exactly one event per regression, exit 1 with regressions and 0 without, and
  the one-audit refusal.

## Non-goals

- **Executing the signal pack.** RFC § 8.6 stands: `signals` prints statements
  to check. Nothing here runs a grep.
- **A GitHub Actions workflow for lane 1.** The RFC's lane-1 sketch (a workflow
  step grepping the PR body) is what this phase *replaces* with native support.
  A repo with no hosted project resolves findings with
  `arkaik kritik finding resolve`, which already exists.
- **Domain-level regressions.** A (domain × surface) grade drop has no
  `criterion_id`, and `quality.signal.tripped` requires one. Adding an event
  shape the RFC did not define is a bigger decision than this phase.
- **Writing the fold back.** The stored section stays exactly as the last audit
  left it. The repo is the store; the next `arkaik kritik finding resolve` or
  the next audit is what makes it true there.
- **Trend UI.** The journal now accumulates resolutions and trips; rendering
  quality over time is its own piece of work.

## Risks

**A PR that names a finding it did not fix.** The grammar cannot tell. This is
the same exposure `AC-` mentions have carried since slice 1, and the same answer
applies: the resolution is a journal fact with an author and a `resolved_by`
URL, it is visible in the delivery response and the raw history, and the next
audit re-scores the cell regardless. The fold is a read projection, so undoing
one is appending a correction, not editing a snapshot.

**Two audits with different profiles.** A surface added between audits produces
cells present in one and not the other; the "scored in both" guard already
handles it as *not comparable* rather than as a regression.

**The fold and the next push disagree.** After a webhook resolution the hosted
app shows resolved while the repo's `findings.json` still says open, until
somebody runs `arkaik kritik finding resolve` or a new audit. That gap is
inherent to two stores and one truth, and it is the reason `resolved_by` carries
the PR URL: the repo-side fix is a copy-paste, not an investigation.
