# Sections on the Projects page — Hosted, Synked, Lokal

**Date:** 2026-08-01
**Status:** Approved, ready for planning

## Problem

`/projects` shows one flat list. Storage type is conveyed only by a small
"In your account" badge on hosted cards, and every creation control sits in a
single page-level row, so nothing tells the user which kind of project a button
will produce. The "Back up your local projects to Synk" callout renders whenever
there is at least one project, including when every project is hosted and the
callout is therefore irrelevant.

## Goal

Group projects into three named sections, give each section its own creation
controls that produce that section's kind of project, and show the backup
callout only when it applies.

## Taxonomy

There are two storage backends, not three. "Synked" is a *state* of a local
project, not a third backend.

| Section | Definition |
| --- | --- |
| Hosted | `summary.hosted === true` — lives in the account |
| Synked | local **and** has a Synk backup on the server |
| Lokal  | local with no Synk backup |

A project moves from Lokal to Synked the moment a backup succeeds, and the UI
reflects that without a reload.

## Section assignment

New pure module `lib/data/project-sections.ts`:

```ts
export type ProjectSection = "hosted" | "synked" | "lokal";

export function sectionFor(
  summary: ProjectSummary,
  backedUpIds: Set<string>,
): ProjectSection;
```

Returns `"hosted"` when `summary.hosted`; otherwise `"synked"` when
`backedUpIds.has(summary.project.id)`; otherwise `"lokal"`. No I/O, no DB — it
takes the backup set as an argument so it can be unit-tested in CI's fast job
(this machine has no local Postgres).

### Where `backedUpIds` comes from

`components/sync/SynkOnboardingBanner.tsx` today fetches `/api/synk/projects`
itself and subscribes to `syncManager` to re-render on status changes. Both move
**up** into `app/projects/page.tsx`:

- the page fetches `/api/synk/projects` once when signed in and holds the id set
  in state;
- the page subscribes to `syncManager` so a newly backed-up project hops from
  Lokal to Synked live;
- the page passes the id set down to `SynkOnboardingBanner` as a prop.

One fetch, one source of truth, and the banner and the sections can no longer
disagree. Signed out, the set is empty and every project is Lokal.

## Layout

**Signed out** — unchanged from today: a single flat list of local projects, no
section headings. Hosted and Synked are impossible without an account, and the
local-first promise is that signing in changes nothing except adding backup.

**Signed in** — three sections in fixed order: Hosted, Synked, Lokal. Each has a
heading row: an `h2` with the section name and a project count on the left, and
that section's create control on the right.

Empty sections still render, with a one-line explanation and the same create
control centred in the empty area. The page-level button row (Import JSON,
Generate with AI, Restore from Synk, Create project) is removed entirely — every
one of those actions now lives inside a section.

The existing per-card content is unchanged, with one simplification: the
"In your account" badge is redundant under a Hosted heading and is dropped.
The "Move to account" button stays — it is how a Lokal or Synked project becomes
Hosted.

## Create control

Each section header carries a split button: a primary **Create project** action
plus a chevron opening a menu.

| Section | Menu items |
| --- | --- |
| Hosted | Create project · Generate with AI · Import JSON |
| Synked | Create project · Generate with AI · Import JSON · Restore from Synk |
| Lokal  | Create project · Generate with AI · Import JSON |

**Restore from Synk appears only under Synked**, since restoring pulls a backup
back down and the result is by definition a backed-up local project.

### What each action does per target

**Hosted.** Build the empty `ProjectBundle` as today, then
`createRemoteProvider().importProject(bundle)` and navigate to the
server-assigned id. Import JSON on this target parses the file into a bundle and
calls the same `importProject`. This is a direct hosted creation — it replaces
the current local-create-then-"Move to account" detour.

**Synked.** The existing local creation path (`getProvider().saveProject`), then
`syncManager.backupNow(id)` before navigating. If the backup fails — offline,
entity limit exceeded — the project still exists as a Lokal project and we
surface the reason via toast. Creation must never fail because backup did.

**Lokal.** Exactly today's behaviour, unchanged.

### Import plumbing

One shared hidden `<input type="file">` plus a "pending target" ref, rather than
one input per section. The change handler reads the ref to decide whether to
route the parsed bundle to `importProject` (Hosted) or the local import path,
and whether to trigger a backup afterwards (Synked). Existing guards — the 5 MB
size cap and the parse-error message — are unchanged.

## Generate with AI

`/generate` does not create a project. It is a prompt builder: the user copies a
prompt, runs it in an LLM elsewhere, and returns to import the resulting JSON.
So the section's intent has to survive that round trip.

- The section menu item links to `/generate?target=hosted|synked|lokal`.
- `/generate` reads the param and shows a line in its header stating where the
  result will land ("in your account" / "in this browser, backed up to Synk" /
  "in this browser").
- Its "Back to projects" link becomes `/projects?import=<target>`.
- `/projects`, seeing `?import=`, opens the file picker with that target
  preselected and strips the param from the URL.

If the param is absent or unrecognised at either end, nothing special happens
and the flow degrades to a plain Lokal import. No state is persisted beyond the
URL, so a lost intent costs the user one extra click, never a wrong-target
project.

## Backup callout

`SynkOnboardingBanner` renders only when at least one project falls in the
**Lokal** bucket. Two hosted projects and no local ones → no callout. The
banner's internal candidate filtering and dismissal behaviour are otherwise
unchanged; it only loses its own fetch and subscription, which now come from the
page.

## Testing

DB-free only — the services suites no-op without a local Postgres, so everything
here must run in CI's fast build job.

This repo has **no React component test harness** — no vitest, no jest, no
Testing Library. Every suite is a plain `node tests/**/*.test.js` script that
transpiles the TypeScript under test on the fly via a `load-*.js` helper. So the
behaviour worth testing has to live in modules that Node can import without a
DOM. That constraint shapes the design: the two decisions this feature makes are
extracted out of the page component and into pure modules.

**Unit — `sectionFor` / `groupBySection` (`lib/data/project-sections.ts`):**

- hosted summary → `"hosted"`, regardless of the backup set
- local summary whose id is in the backup set → `"synked"`
- local summary whose id is absent → `"lokal"`
- empty backup set (signed out) → every local summary is `"lokal"`
- `groupBySection` preserves input order within each bucket

**Unit — `parseCreateTarget` / `createInTarget` (`lib/data/create-target.ts`):**
`createInTarget` takes its three effects — `saveLocal`, `importHosted`,
`backupNow` — as injected dependencies, so a Node test can prove routing without
Dexie, `fetch`, or a browser.

- Hosted → calls `importHosted`, never `saveLocal`, returns the server id
- Synked → calls `saveLocal` then `backupNow`, returns the local id
- Lokal → calls `saveLocal`, never `backupNow`
- a rejected `backupNow` still resolves with the created id and a `backupError`
  message — creation never fails because backup did
- `parseCreateTarget` accepts the three known values and returns `null` for
  anything else, including `null` input

**Manual verification** (documented in the plan, not automated): section headings
and ordering, empty-state rendering, Restore appearing only under Synked, the
callout disappearing when no project is Lokal, and the `/generate` round trip.

## Out of scope

- Changing what a hosted or local project *is*, or adding a real third backend
- Reworking the card body, publish, repos, or delete flows
- Making `/generate` produce a project directly
- Migrating existing projects between sections automatically
