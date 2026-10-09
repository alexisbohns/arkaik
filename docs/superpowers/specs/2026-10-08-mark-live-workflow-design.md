# Marking live from a deploy: `arkaik live` and the `mark-live` reusable workflow

**Issue:** follow-up to #424 · **Date:** 2026-10-08 · **Status:** approved

## Problem

#424 built the door: `POST /api/graph/projects/{id}/live` behind
`release:append`. Nothing walks through it yet. The signals live in CI, and the
hard part of wiring them is not the call but knowing *which acceptances a deploy
carried*. That knowledge is in the pull requests the deploy shipped, written in
the `AC-id@platform` mention grammar the GitHub App already reads on merge — a
grammar that lives only in the app's webhook code, has been subtly wrong twice,
and must not be copied into a workflow by hand.

pbbls is the first consumer: a monorepo (`apps/web`, `apps/ios`, `apps/android`)
deployed to Vercel, which makes GitHub emit a `deployment_status` with
`state: success` for the environment `Production – pbbls` on every production
deploy. Android ships to Play's internal track from a workflow and is promoted
by hand; iOS has no release workflow yet.

## Settled decisions

1. **The grammar moves to `@arkaik/schema`.** `mentionedAcceptances` and its
   regex become `packages/schema/src/mentions.ts`, zod-free, keyed on the
   schema's `PLATFORM_IDS`. The webhook imports it back. One implementation,
   three callers (webhook, CLI, and through the CLI the workflow). Rejected: an
   inline copy of the regex in the workflow (a second grammar to keep in sync),
   and an app-side endpoint that derives ids from a commit range (arkaik would
   have to read GitHub per deploy, and a `release:append` token could then
   learn PR contents).

2. **A CLI verb, `arkaik live`.** #424's spec declined a verb as YAGNI; the
   reusable workflow is the consumer that makes it earn its place. The verb
   derives ids from a mentions file and posts to the door; the workflow stays
   thin.

3. **Bare mentions count only when the PR touched the platform's paths.** An
   explicit `@<platform>` always counts; a mention of another platform never
   does; an unknown suffix is reported, never guessed. A bare `AC-x` counts
   when the verb has no `--paths`, or when one of that PR's changed files sits
   under a given prefix — the webhook's path-scoped-link rule, applied from the
   deploy side. Rejected: always counting bare mentions (an iOS-only PR that
   forgot `@ios` would mark web live) and never counting them (every PR must
   remember the suffix or the deploy marks nothing).

4. **The workflow builds the CLI from `arkaik@main`**, as the ariko Lab Note
   reminder builds its script from ariko, so a caller never waits on an npm
   publish and always runs the current grammar.

5. **No previous successful deploy means mark nothing.** The range is bounded
   by the newest earlier deployment of the same environment with a `success`
   status. On a first run there is none, and guessing a range would over-claim;
   the workflow says so and exits 0. Explicit `ids` bypass derivation.

6. **A deploy that carried no acceptance is normal.** The verb prints "nothing
   to mark" and exits 0. A refused explicit claim or any other failed request
   is a failed step. An id that counted only through a bare mention and that
   the door refuses (`platform_not_applicable`, `unknown_node`) is dropped
   with a warning and the batch resent once — the webhook's rule for an
   inferred scope, applied from the deploy side — so one stale bare mention
   never blocks the rest of a deploy's marks.

## Design

### `packages/schema/src/mentions.ts`

Moved verbatim from `lib/services/github/pull-request.ts`: `ACCEPTANCE_MENTION`,
`TRAILING_PROSE`, `trimTrailingProse`, the types `AcceptanceMention`,
`UnknownPlatformMention`, `MentionScan`, and `mentionedAcceptances(text: Pick<…, "title" | "body">)`.
`IS_PLATFORM` becomes an exported `isPlatformId(value: string): value is PlatformId`
over `PLATFORM_IDS` from `./ids`. The webhook file keeps its own local
`PLATFORM_IDS`/`IS_PLATFORM` (used elsewhere in it) and re-exports the moved
names from `@arkaik/schema` so `tests/services/pr-plan.test.js` keeps reading
them off the planner module. Behaviour is unchanged; a direct schema suite pins
the grammar's cases.

### `arkaik live`

```
arkaik live --platform <web|ios|android> [--detail <text>] [--mentions <file>]
            [--paths <prefix>[,<prefix>…]] [--dry-run] [--remote <url>] [AC-id …]
```

- Reads `docs/arkaik/arkaik.json` (`project_id`, `remote`) from the cwd like
  `restore`; `--remote`/`ARKAIK_URL` override; `ARKAIK_TOKEN` required.
- **Ids** = positional `AC-…` arguments ∪ `deriveLiveIds(prs, platform, paths)`
  over the `--mentions` file: a JSON array of `{ number, title, body, files }`.
  Per PR, `mentionedAcceptances({ title, body })`; keep `platform === <platform>`;
  keep `platform === null` when `paths` is empty or some `files[i]` starts with
  a prefix (normalised to end in `/`); drop other platforms; print each
  `unknown` as a warning naming the PR number. Dedupe, stable order.
- **Nothing to mark** → `Nothing to mark live on <platform>.`, exit 0.
- **Post** `{ entries: [{ node_id, platform, detail? }] }` in chunks of 50 to
  `${remote}/api/graph/projects/${project_id}/live`. Print one line per
  `applied` (`AC-x: releasing → live [ios]`) and per `skipped`
  (`AC-x: already live [ios]`). On 422, when every refusal is
  `platform_not_applicable`/`unknown_node` on an inferred id, warn, drop those
  ids and resend the chunk once; otherwise print each refusal
  (`entries[i] AC-x@ios: platform_not_applicable — detail`) and exit 1; on any
  other non-2xx print `describeFailure` with the door's message and exit 1
  (403 names `release:append`).
- `--dry-run` prints the entries it would send and exits 0 without a request.
- `deriveLiveIds` is exported and pure; `runLive(argv, { httpClient, cwd, env,
  log, errorLog })` mirrors `runLink`'s injectable shape for tests.

### `.github/workflows/mark-live.yml` (arkaik)

`on: workflow_call` and `workflow_dispatch`, same inputs:

| input | required | meaning |
|---|---|---|
| `platform` | yes | `web` \| `ios` \| `android` |
| `sha` | no, default `github.sha` | the deployed commit |
| `environment` | no | deployment environment name; needed to find the previous deploy |
| `deployment_id` | no | the current deployment, to exclude it from "previous" |
| `paths` | no | comma-separated prefixes for the bare-mention rule |
| `detail` | no | evidence; default the run URL |
| `ids` | no | space-separated ids; skips derivation |

Secret: `ARKAIK_RELEASE_TOKEN`. Permissions: `contents: read`,
`pull-requests: read`, `deployments: read` — and the **caller must grant the
same block**: a called workflow can only narrow the caller's `GITHUB_TOKEN`,
and a repository's default token (pbbls's included) grants neither deployments
nor pull requests. `environment` and `deployment_id` default to the triggering
deployment event (`github.event.deployment`), so a `deployment_status` caller
may omit them; under `workflow_dispatch` they stay empty unless given.

Steps: check out the caller at `sha` (full history) into `repo/`; check out
`alexisbohns/arkaik@main` into `tool/`; setup-node 22 with npm cache keyed on
`tool/package-lock.json`; `npm ci` and `npm run build -w arkaik` in `tool/`.
Then, unless `ids` was given: find the previous deploy (deployments of
`environment`, newest first, excluding `deployment_id`, created before the
current one, first whose statuses contain `success`); with none, print the
reason and stop with success. Otherwise collect PR numbers from
`git log --format=%s prev..sha` (`(#N)` suffix, or `Merge pull request #N`),
fetch each with `gh pr view N --json number,title,body` and its files through
the paginated REST `pulls/N/files` (the `gh` field stops at 100), write
`mentions.json`, and run `node ../tool/packages/cli/dist/index.js live` from
`repo/` with the token, platform, paths, detail and mentions file. The step's
exit code is the job's.

### The pbbls caller

`.github/workflows/mark-live.yml` in pbbls: `on: deployment_status` and
`workflow_dispatch`, with `permissions: { contents: read, deployments: read,
pull-requests: read }`, job
`if: github.event_name == 'workflow_dispatch' || (github.event.deployment_status.state == 'success' && github.event.deployment.environment == 'Production – pbbls')`,
`uses: alexisbohns/arkaik/.github/workflows/mark-live.yml@main` with
`platform: web`, `paths: apps/web`, `sha: ${{ github.event.deployment.sha || github.sha }}`,
`environment: ${{ github.event.deployment.environment || 'Production – pbbls' }}`,
`detail: ${{ github.event.deployment_status.environment_url || '' }}`, and
`secrets: ARKAIK_RELEASE_TOKEN`. The user mints the token in arkaik settings and
adds the repository secret; the caller lands after the arkaik stack.

### Docs

`docs/spec/toolchain.md` gains the `arkaik live` row. `docs/hosted-projects.md`'s
"A token for deployments" section gains the verb beside the curl and replaces
the web row's "where the call goes" with the reusable workflow and the caller
snippet; Android and iOS rows point at the same workflow with `ids` or a
future poll.

### Tests

- `tests/schema/mentions.test.js`: bare, scoped, `\@`, trailing prose, unknown
  suffix kept whole (`@android-tv`), `@iOS` case-folding, dedupe on
  (id, platform), `AC-a@ios,AC-b@web`, title and body both scanned.
- `tests/cli/live.test.js` (esbuild-bundled `live.ts`, mock `httpClient`, the
  push test's idiom): derivation with and without `--paths`, other-platform
  and unknown mentions, positional ids merged, dry run sends nothing, a 200
  prints applied and skipped, a 422 prints refusals and fails, a 403 names the
  scope, missing link file / token fail clearly, chunks of 50.
- The planner and webhook suites keep passing through the re-exports.
- The pbbls caller carries a `workflow_dispatch` trigger, so the workflow is
  exercised by hand from pbbls against a real production deploy once the caller
  is wired; a dispatch from arkaik itself only reaches arkaik's own project.

### Out of scope

Android and iOS polls (Play Developer API track status; App Store Connect
version state) — the workflow accepts explicit `ids`, so a poll job only has to
compute them. A GitHub App `deployment_status` listener.

## Stack

1. **`mentions-1-schema`** — the move, `isPlatformId`, the schema suite,
   re-exports. Chore: no Lab Note (`no-lab-note`).
2. **`live-2-cli`** — `arkaik live`, its suite, the toolchain row, `arkaik`
   0.10.0. Lab Note.
3. **`live-3-workflow`** — `mark-live.yml`, hosted-projects docs. Lab Note.

Then one pbbls PR with the caller.
