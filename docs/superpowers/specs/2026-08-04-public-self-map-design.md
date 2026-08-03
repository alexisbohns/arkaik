# Public self-map: the Arkaik project in /projects — design

**Date:** 2026-08-04 · **Cycle:** 4 of the
[self-map program](2026-08-03-self-map-program.md) · **Status:** approved

## Goal

Ship Arkaik's own map (`seed/arkaik-self-map.json`) as a default **public,
sandbox** project every visitor — anonymous or signed-in — sees on `/projects`
and can open at a stable URL. Inside it, everything is interactive; nothing
persists. Refresh restores the pristine seed.

Decisions made in this cycle's brainstorm (2026-08-04):

- **Play model: full sandbox, reset on refresh.** Not read-only, not
  display-tweaks-only. The map must feel like the real product.
- **Placement: a fourth "Explore" section** on `/projects`, rendered for
  everyone, always.
- **URL: stable and client-rendered** (`/project/arkaik-self-map`), in the
  sitemap. SEO beyond the app shell is out of scope.
- **Architecture: an in-memory seed provider** behind the documented
  provider seam — not a shadow IndexedDB copy, not a server-hosted project.

## Architecture

### Seed provider

New `lib/data/seed-provider.ts`: a `DataProvider` implementation over per-tab
memory.

- **Initialization** (lazy, on first access): deep-clone the statically
  imported `seed/arkaik-self-map.json`, run through the existing
  `parseAndValidateBundle` migrate path (`lib/utils/export.ts`) so a
  schema-version drift can never brick the page. The seed is build-time
  imported — it already is, at `app/projects/page.tsx:40` — so each deploy
  serves the latest seed, which is the cycle-5 contract (content lands via
  PRs to the seed file; CI's `validate:seeds` gates it).
- **Reads** serve from memory.
- **Every mutator succeeds** and applies to memory — nodes, edges, project
  metadata, journal appends — so all existing hooks, editors, and toasts
  behave identically. That is the entire sandbox mechanism. Nothing touches
  IndexedDB or the network. The one exception is `deleteProject`, which
  rejects: no UI offers it for the seed, and a provider that quietly
  "deleted" the always-listed project would relist it on the next render.
- **Lifetime**: module state, per tab. Two tabs are two independent
  sandboxes. Refresh = pristine seed.
- **Reset**: an exported `resetSeedProject()` re-clones the pristine bundle
  (used by the banner's Reset action, which then refreshes page data).

### Routing

`createRoutingProvider` (`lib/data/routing-provider.ts`) gains a first
branch: `isSeedProjectId(id)` → seed provider, checked before the hosted
(`prj_`) and local branches. The reserved id is the literal
`arkaik-self-map`.

`listProjects()` always prepends the seed's `ProjectSummary` — signed-in or
out — with a derived `seed: true` flag (sibling of the existing derived
`hosted`). The prepend is synchronous: it is never gated on
`whenHostedAvailabilityKnown()`, so anonymous visitors on a slow network see
Explore instantly.

### Namespace guard

`ensureUniqueProjectId` (`lib/utils/export.ts:106`) already refuses to mint
local ids in the `prj_` namespace; it learns the reserved seed id too, so an
imported bundle can never squat `arkaik-self-map`. Importing a copy of the
self-map itself flows through this same funnel and gets a fresh id — correct
as-is.

### URL

`/project/arkaik-self-map/…` works through the normal project routes with no
route changes — every provider call in the layout resolves to the seed
branch. The route is added to `app/sitemap.ts`.

## /projects UX

### Explore section

A fourth section, derived not stored: `summary.seed → explore` in
`groupBySection` (`lib/data/project-sections.ts`). It renders **for
everyone, always** — including signed-out visitors, who today get no
sections at all; they now see Explore above their existing flat local grid /
empty state.

Explore is **not a create target**: `CREATE_TARGETS` stays a closed union.
It is the one section with no "new project" affordance, so it renders with a
lightweight section header rather than forcing a fake `CreateTarget` variant
through `ProjectSection`.

### Card

Reuses `ProjectCard` with the footer suppressed (the same branch that hides
it for hosted projects, `ProjectCard.tsx:76`) plus a small **"Public"**
badge. The card is the open button, as everywhere else. No rename, no
delete, no sync, no Move to account.

The existing empty-state example picker stays exactly where it is, and the
Arkaik entry stays in `EXAMPLE_SEEDS` — importing a private copy remains a
legitimate parallel path.

## Sandbox semantics inside the project

### Banner

A persistent banner across `/project/arkaik-self-map/*`, rendered from the
project layout when the id is the seed id:

> You're exploring Arkaik's own map — a live sandbox. Changes stay in this
> tab and vanish on refresh.

Two actions: **Reset** (re-clone the pristine seed, refresh page data) and
**Import a copy** (the existing example-import funnel, landing a real
editable project in Lokal).

### What works

Everything — node/edge editing, rewiring, map display options, the Decision
Log, the Changelog, History. The seed ships a journal (since cycle 3), so
those pages render real content, and sandbox writes append journal events in
memory like any project: the History page demonstrates itself.

Publik publishing stays available — publishing a snapshot of sandboxed
tweaks is harmless and consistent with Publik's anonymous-snapshot model.

### What is suppressed

Synk sync control, Move to account, delete, card-level rename — all via the
existing seed/hosted-style branching. `/generate` and the other import flows
are untouched.

## Testing

All DB-free (vitest; no Postgres on the dev machine, and these run in CI's
fast job):

- **Seed provider**: reads, every mutator, journal append, reset restores
  pristine, initialization runs the migrate path.
- **Routing dispatch**: seed id → seed provider; `prj_…` → remote; anything
  else → local.
- **Import guard**: `ensureUniqueProjectId` regenerates on the reserved seed
  id.
- **Sections**: `groupBySection` routes `seed: true` to explore; ordering.

The visual pass (banner, Explore section signed-in/out, sandbox feel, Reset,
Import a copy) goes to Alexis as a PR checklist.

## Out of scope

- SEO / server-rendering of graph content (Publik's spec deferred the same
  thing; unchanged).
- Multiple public projects — the Explore section is built to hold more
  cards, but only the self-map ships.
- Cross-tab or persisted sandbox state.
- Cycle 5 content population (interleaved but its own work).
