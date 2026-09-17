# A finding closes only when a PR says so

**Issue:** [#440](https://github.com/alexisbohns/arkaik/issues/440) — the GitHub
App resolves any Kritik finding id it finds in a PR body, including ones listed
as follow-ups.

## The defect

[pbbls#832](https://github.com/alexisbohns/pbbls/pull/832) shipped one finding —
the `content_reports` database primitive — and silently resolved six. Its body
carried a section headed "Follow-ups — mostly already-filed findings", a table
naming the five client-side findings still to do. `mentionedFindings` reads a
bare `F-…` token anywhere in the title or body as a closure, so all five were
appended `quality.finding.resolved` with `resolved_by` set to a pull request
whose diff touches `packages/supabase`, `docs` and `.github` and no client file
at all.

The damage is not the events. It is that the matrix — the thing consulted to ask
"is this pillar done before we submit to the App Store?" — now answers **yes**
for criterion PLT-04 on every surface, when the true answer is "server primitive
only; no client can report anything". It fails quietly, and toward
under-reporting risk: nobody gets an error, the findings just stop appearing in
`kritik_findings --status open`.

`plugin-kritik/skills/kritik/SKILL.md` already carries a warning callout telling
authors not to name a finding id in a PR that does not fix it. A rule that has to
be remembered by every author of every PR forever is not a rule, it is a trap
with a sign on it. This design removes the trap and deletes the sign.

## Scope

Two of the four fixes the issue proposes, as a two-part stack:

- **Part A** — resolve only on an explicit closing verb. A bare id becomes a
  reference, reported but never acted on.
- **Part B** — warn, in the delivery response, when a resolved finding's surface
  owns a repository path that the pull request did not touch.

Out of scope, and why: the follow-up-heading heuristic (issue's option 2) is
redundant once a verb is required — the issue itself calls it weaker and
heuristic. `kritik_reopen_finding` (option 4) is a repair tool for damage already
done, not a fix for the defect; it needs a new `quality.finding.reopened` event
type, a change to the fold's first-decision-wins rule, the hosted events
whitelist, validate warnings, a CLI verb and an MCP tool — its own stack, filed
separately.

## Part A — an explicit closing verb

### The grammar

`lib/services/github/quality-parse.ts` replaces `mentionedFindings` with a single
scan returning two sets, the shape `mentionedAcceptances` already uses in
`pull-request.ts`:

```ts
export interface FindingScan {
  /** Ids a closing keyword names in the BODY — these resolve. */
  closed: string[];
  /** Ids named with no closing keyword, title or body — reported, never resolved. */
  mentioned: string[];
}

export function scanFindings(event: Pick<PullRequestEvent, "title" | "body">): FindingScan;
```

A new `CLOSING_FINDING` pattern reuses `CLOSING_REFERENCE`'s keyword prefix and
separator verbatim — `(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)[\s:]{1,20}` —
then captures an `F-` token that `isFindingId` still validates:

```ts
const CLOSING_FINDING =
  /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)[\s:]{1,20}(F-[A-Za-z0-9-]{3,80})\b/gi;
```

Every quantifier stays bounded and none is followed by something it can backtrack
against, so the linear-by-construction promise this module makes about
attacker-influenced input is unchanged. `[\s:]{1,20}` keeps the colon because
this repo's own convention writes `Closes: #12`.

`splitOnFencedCode` still runs first, for both channels. Fenced code is inert on
GitHub's side and must stay inert here — it is what makes a PR *about* this
syntax safe.

`isFindingId` and `FINDING_TOKEN` are unchanged. The token scan now feeds
`mentioned` rather than the resolution path.

### Three sub-decisions, each GitHub's own rule

**Body only.** `closedIssues` is body-only because GitHub does not honour a
closing keyword in a pull request title. Part A adopts GitHub's verb; adopting
the verb and not its scope would be two rules where authors expect one. A
`Closes F-…` written in a title lands in `mentioned` and is reported, so the
change is visible rather than silent.

**One verb, one id.** `Closes F-a-01, F-b-02` closes `F-a-01` only, exactly as
GitHub requires a keyword before each issue it closes. The remaining ids surface
as `mentioned` with the hint, so the mistake is loud at merge rather than
discovered later in the matrix.

**The issue channel is untouched.** `Closes #123` reaching a finding through its
own `issue_url` already required a verb. `closedIssues`, `parseIssueRef` and the
matching loop in `quality.ts` are unchanged.

### The `mentioned` outcome

`QualityResolutionOutcome` gains a variant:

```ts
| { projectId: string; status: "mentioned"; findingId: string; hint: string }
```

with `hint` reading:

> named without a closing verb — write `Closes F-2026-08-PLT-ios-02` to resolve it

The delivery response is the one diagnostic surface `docs/hosted-projects.md`
points people at (GitHub's **Advanced → Recent Deliveries**), and the same
channel `ApplyOutcome.warnings` already uses. Reporting here is what keeps the
behaviour change from becoming a new silence of its own.

It is reported **only** for an id that the project actually holds and that is
**open and undecided** — measured against the same `isOpenFinding` check and
`decidedFindingIds` set the resolution path uses. An already-resolved finding, an
already-accepted one, and a string that merely looks id-shaped all produce
nothing. Prose cannot generate noise.

`unknown` stays reserved for the `closed` channel. An id under a closing verb
that matches no finding is an assertion that failed and there is something to act
on; a bare id that matches nothing is just text.

### What this changes for existing pull requests

A body that names a finding id without a verb stops resolving it. That is the
point of the change, and the `mentioned` outcome is what makes it legible at the
moment it happens. `arkaik kritik finding resolve <id> --by <pr-url>` in the repo
is, as SKILL.md already says, the thing that makes `findings.json` true and was
never optional — so a PR caught by the new grammar loses a convenience, not the
record.

## Part B — a surface sanity warning

### One changed-files call per delivery, still

The quality pass makes no GitHub call today. Part B gives it the pull request's
changed files without breaking the standing rule that one delivery makes at most
one changed-files request, now that two halves want the list.

`pull-request.ts` exports a memoizing wrapper:

```ts
export function onceChangedFiles(fetch: FetchChangedFiles): FetchChangedFiles;
```

keyed by `repoFullName#number` — there is only one pull request per delivery, but
keying it is honest and costs nothing. It memoizes the **promise**, not the
resolved value, so a fetch that rejects rejects once for both halves rather than
being retried by the second one: `applyPullRequestEvent` throws a
`GithubTransientError` on a 5xx precisely so the route can release the delivery
claim and let GitHub redeliver, and a memo that re-fetched after a rejection
would make one delivery issue the request the doctrine says it must not repeat.
`app/api/github/webhook/route.ts` builds
it once and hands the same function to both halves:

```ts
const fetchFiles = onceChangedFiles((pr) => githubApp().listPullRequestFiles(pr));
const outcomes = await applyPullRequestEvent(prEvent, { scopesADeliverable, declaredNodes, fetchFiles });
const quality  = isMerge ? await applyQualityResolutions(prEvent, { fetchFiles }) : [];
```

The quality pass calls it **lazily**, and only once it knows it will resolve at
least one finding whose surface declares a `path`. The overwhelming majority of
merges resolve nothing and make no extra request; a merge that does resolve
something usually had the list fetched by the delivery half already, and the memo
makes that one call serve both.

`fetchFiles` is optional on `applyQualityResolutions`. Absent, the pass records
`{ kind: "not-needed" }` and emits no warnings — the same explicit,
under-claiming default `ChangedFilesEvidence` already demands of every caller
that has not fetched.

### The check

A new pure module `lib/services/github/quality-surface.ts`, importing only
`paths.ts` (which has no imports of its own) and types:

```ts
export function surfaceMismatchWarning(input: {
  findingId: string;
  surface: string;
  profile: QualityProfile | undefined;
  evidence: ChangedFilesEvidence;
}): string | undefined;
```

It lives outside `quality-parse.ts` deliberately: that module is about parsing
pull request text and states that it has no value imports at all, which is what
lets the suite load it with a bare transpile. A path check is not parsing.

The rules, and the reason each one is silent rather than loud:

| condition | result |
|---|---|
| `evidence.kind !== "files"` | silent — no list, no claim |
| `evidence.incomplete.length > 0` | silent — a missing file can invent a mismatch |
| surface absent from `profile.surfaces` | silent — nothing to compare against |
| surface declares no `path`, or it normalizes to `""` | silent |
| `cross-surface` | silent, by the row above — it is a findings-only lens the profile never declares |
| some changed path is under the prefix | silent — the fix is where the finding is |
| otherwise | the warning |

Reading:

> resolved F-2026-08-PLT-ios-02, but this pull request changed no file under `apps/ios` (surface `ios`)

The incomplete-list rule is the mirror image of the one `RepoScope` already
states. There, a missing file cannot invent a *match*, so what matched is still
real. Here, a missing file can invent a *mismatch* — which would be a false
accusation printed against a correct resolution — so the pass declines to make
one. Both rules point the same way: under-claim, never over-claim.

Path comparison is `normalizePathPrefix` then `pathMatchesPrefix` from
`paths.ts`, so containment is decided on segment boundaries by the same code that
decides it for path-scoped repository links. `apps/ios-shared/x.swift` does not
count as a file under `apps/ios`.

Surface paths are repository-relative, as `SurfaceDef.path` documents and as
`docs/quality/library/framework.json` writes them (`apps/web`, `apps/ios`,
`packages/supabase`). They are compared against the pull request's changed paths
directly, with no reference to a project's link prefixes — a surface path
describes where the code lives, a link prefix describes what a project claims,
and conflating them would make the warning depend on configuration it has no
business reading.

### Reads and shapes

`ProjectQualityState` gains `profile?: QualityProfile`, read from
`snapshot->'quality'->'profile'` in the same query that already reads
`snapshot->'quality'->'findings'`. `profile` is required by `QualitySection`, but
it is read defensively — the pass compares against whatever storage holds and a
missing profile simply means no warning.

The `resolved` outcome gains an optional `warning: string`.

Nothing about the append changes. The event is written either way, and a warning
never gates a write: `SurfaceDef.path` is optional, and a real fix can
legitimately live in a shared package or a monorepo-wide config. Refusing on a
heuristic would fail in the opposite dangerous direction — silently not closing
findings that genuinely were fixed. With Part A in place a wrong `Closes F-…` is
a deliberate act, and a second opinion is the right weight for it.

## Testing

Both parts are database-free and extend
`tests/services/quality-webhook.test.js` (`npm run test:quality-webhook`),
through the existing injection seam in `tests/services/load-quality-parse.js` —
extended to compile `paths.ts` and `quality-surface.ts` alongside the two modules
it already builds.

**Part A**

- every verb form and casing: `Closes`/`closed`/`Fixes`/`fixed`/`Resolves`/`resolved`
- `Closes: F-…`, the repo's own colon convention
- a keyword wrapped across a newline, as a real body wraps it
- a bare id resolves nothing and reports `mentioned`
- a `Closes F-…` in the **title** resolves nothing and reports `mentioned`
- `Closes F-a-01, F-b-02, F-c-03` resolves the first and reports the rest
- an id under a verb inside a fenced block is inert, both fence characters
- an id under a verb that matches no finding reports `unknown`
- a bare id that matches no finding reports nothing
- a bare id naming an already-resolved or already-accepted finding reports nothing
- the existing ReDoS budget, overlong-token, near-miss and dedupe cases, carried
  over against `scanFindings`
- **a regression test reproducing pbbls#832**: one `Closes F-…-supabase-01` plus
  a five-row follow-up table naming the others, asserting exactly one resolution
  and five `mentioned`

**Part B**

- the warning fires on a path miss, with the surface id and path in the text
- silent on a path hit
- silent on `incomplete`, on `unavailable`, and on `not-needed`
- silent for a surface the profile does not declare, and for `cross-surface`
- silent for a surface declaring no `path`
- segment-boundary containment: `apps/ios-shared/x` does not satisfy `apps/ios`
- `onceChangedFiles` makes exactly one underlying call across both halves
- no fetch at all when nothing resolvable declares a path

## Documentation

Each part carries its own.

**Part A** — `plugin-kritik/skills/kritik/SKILL.md`: rewrite "The App reads two
channels" for the verb, and **delete the warning callout** beginning "Name a
finding id in a PR only when that PR fixes it", which exists only to describe the
defect this part removes. `docs/rfcs/kritik.md` § 3.4 and
`docs/hosted-projects.md` get the grammar and the `mentioned` outcome.

**Part B** — `docs/hosted-projects.md` gets the `warning` field on a resolved
outcome and what it means; SKILL.md gets a sentence on the surface check.

## Stack

| part | branch | contents |
|---|---|---|
| A | `finding-closure-1-closing-verb` | this spec, the grammar, the `mentioned` outcome, tests, docs |
| B | `finding-closure-2-surface-warning` | `onceChangedFiles`, `quality-surface.ts`, the `warning` field, tests, docs |

Part B stacks on Part A because the `warning` it adds hangs off the `resolved`
outcome, and the set of resolutions it can hang off is exactly what Part A's
grammar decides — a warning written against the old grammar would be a warning
about five resolutions Part A stops producing. Each part lints, typechecks and
passes its suite on its own.

Both parts ship a Lab Note: the change is one a user notices — a PR that used to
close six findings now closes one and says why about the other five.
