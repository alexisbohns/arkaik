# Content population: filling the self-map — design

**Date:** 2026-08-04 · **Cycle:** 5 of the
[self-map program](2026-08-03-self-map-program.md) · **Status:** approved

## Goal

Turn `seed/arkaik-self-map.json` from a 15-node beachhead into the flagship
demo the sandbox (cycle 4) deserves: a comprehensive map of the whole Arkaik
product, an acceptance layer wired to Value elements, and a curated
historical narrative — deliverables, thematic releases, decisions, and
per-node status arcs — mined from the repo's 338 merged PRs and its docs by
a subagent fan-out. Content-only: no app code changes.

Decisions made in this cycle's brainstorm (2026-08-04):

- **History depth: curated arc.** Every user-visible PR becomes a
  deliverable (~60–120); chores/CI skipped. Not full-338, not
  highlights-only.
- **Map breadth: whole product**, including developer-facing surfaces (CLI,
  MCP server, plugin, arkaik-dev skill).
- **Releases: thematic eras** — 8–12 editorial chapters, not monthly rollups
  or invented semver.
- **Delivery: two staged PRs.** PR A = the map (anatomy + acceptances +
  values). PR B (branched on A) = the story (journal history, deliverables,
  releases, decisions).
- **Execution: corpus-first layered fan-out** with deterministic merge —
  agents emit fragments; a script owns ID uniqueness and referential
  integrity; agents never edit the seed directly.

## PR A — the map (present state)

### Scale

~160–210 nodes: 25–35 flows, 35–45 views, 20–25 data models, 15–20 API
endpoints, 60–90 acceptances. Calibration: `seed/pebbles.json` renders 152
nodes / 283 edges comfortably at 183KB, so this is known-good canvas
territory.

### Products

Whole-product breadth is expressed through the multi-product feature (which
the map thereby demos). `project.metadata.products` declares three products,
all with platform menu `[web]` (the schema's platform enum is
`web|ios|android`; products, not platforms, are the axis for the developer
split):

| id | Covers |
|---|---|
| `studio` | Projects home, canvas + maps, detail panels/editors, changelog + History, Decision Log, import/export, the Explore sandbox |
| `platform` | Synk hosted projects, auth, Publik publishing, /generate intake — the account-and-sharing layer |
| `toolchain` | CLI (`arkaik init/log/release/pack/doctor`), `@arkaik/schema`, MCP server, plugin, arkaik-dev skill |

Flows, views, and acceptances carry `metadata.product`; data models and API
endpoints derive membership from consumers (validator rule
`product-membership-wrong-species`).

### Anatomy discipline

- IDs per the skill reference: deterministic from title, species prefixes,
  the concept-vs-physical-table `DM-` rule (`DM-project` vs `DM-projects`).
- Every flow ships a real `metadata.playlist`; the validator enforces
  playlist↔`composes` coherence and cycle-freedom.
- Edges only from the legal semantics table (`composes`, `calls`,
  `displays`, `queries`, `covers`, plus decision edges in PR B).
- Data models cover concepts (Project, Node, Edge, JournalEvent,
  MapDefinition, Product…) and physical stores (IndexedDB stores, Postgres
  tables) as distinct nodes.

### Acceptances + values

Each acceptance: one Given/When/Then in `metadata.gherkin`; 1–3 Bain value
elements in `metadata.values` (most specific element wins; higher tier only
when genuinely earned — per `docs/arkaik-skill/references/values.md`);
`covers` edges to its view/flow anchors; single-product anchoring (the
validator warns on cross-product spans). Platform scoping stays trivial —
everything is `@web`.

### Curated maps

3–5 `MapDefinition`s in `project.metadata.maps` so the project opens well:
a journey map per product and a system map of the bundle/journal data
layer. `project.root_node_id` moves to the studio's real home view.

### Journal coupling

The validator requires a `node.created` event for every snapshot node
(`journal-missing-node-created`), so PR A ships a minimal journal: one
`node.created` per node, timestamped from the PR corpus — the merge date of
the PR that actually first shipped that surface, not today — preserving the
existing 20 events. Status-transition history waits for PR B; the validator
only cross-checks transitions that exist.

## PR B — the story (history)

### Thematic eras as releases

8–12 `release.tagged` events, each an editorial chapter: kebab `version`
slug + `notes` narrative paragraph. Working list (exact cut lines come from
the corpus): `first-graph`, `journal-and-changelog`,
`going-multi-product`, `acceptance-and-value`, `hosted-and-public`,
`decisions-and-history`, `the-self-map`. An era's marker is dated just
after the merge of its last deliverable. `project.version` ends at the
latest era slug.

### Curated deliverables

~60–120 `deliverable.shipped` events — every user-visible PR. The filter is
mostly mechanical: a PR with a Lab Note is user-visible by definition;
pre-pipeline PRs get agent judgment. Per deliverable:

- `deliverable_id`: `pr-<number>`
- `title` / `summary`: adapted from the Lab Note where one exists
  (benefit-first voice for free); written fresh otherwise
- `url`: the PR; `node_ids`: the map nodes it touched
- `ts`: real merge timestamp

A deliverable belongs to an era by journal-slice position (the spec's
grouping rule), so ordering is the grouping — the merge script sorts by
`ts` and verifies each deliverable lands inside its intended era.

### Decisions

Grow from 3 to ~12–18 `DEC-` nodes mined from spec docs and program
history — the standing decisions (two axes stay; migration philosophy;
JSONL union-merge journal; in-memory seed provider; acceptance-first
intake; `idea` stays a status; …). Each gets real `metadata.context` /
`consequences` / `decided_at`, a truthful `decision_status` (mostly
`enacted`), `generates`/`impacts`/`supersedes` edges, and matching `node.created` +
`decision.status_changed` events (the journal coupling applies to PR B's
new nodes too). Lifecycle status follows
`lifecycleStatusForDecision`.

### Status history

Per anatomy node, 1–3 `node.status_changed` events telling an honest arc
(e.g. created at its first PR, `live` when it shipped), with the final `to`
equal to the snapshot status — enforced by `journal-status-mismatch`. This
is what makes the Design panel's commitments and per-node timelines render.
Default to the current status vocabulary; pre-v3 aliases only where
authenticity demands (the validator accepts them).

### Backlog texture and actors

A handful of `idea.proposed` events for real deferred items (blocked
indicator on StatusRing, milestones, pebbles retro-population…) so the
backlog projection isn't empty. Events carry honest `actor` values
(`alexis`, `claude-code`).

## Execution machinery

### Corpus (one-time, scratchpad-only)

A script snapshots all merged PRs via `gh` into JSONL: number, title, body
(Lab Note included), merge date, labels, changed-file paths — plus a docs
manifest (specs, RFCs, program doc). Working material only; never
committed.

### Fragments

Agents never touch the seed. Each emits a JSON fragment file into a scratch
directory — `{nodes, edges}` shapes for waves 1–2,
`{deliverables, releases, decisions, events}` for wave 3. Slugs are
namespaced by area to preempt collisions; the merge script still verifies
globally.

### Merge scripts

Deterministic scripts, kept in the session scratchpad — not committed, like
the corpus (this is a content-only cycle; the repo's contract is the seed
plus `validate:seeds`): assemble fragments → dedupe/verify IDs → resolve
cross-area edge references → sort journal by `ts` → set `updated_at` →
write the seed → print the file size. Every wave ends with
`npm run validate:seeds` as a hard gate, and the flagship seed must be
**warning-clean** (most acceptance/product rules are warnings; they get
fixed, not ignored).

### Waves

1. **Anatomy** — ~8 area agents: projects home; canvas + maps; detail
   panels; changelog/History/Decision Log; import/export + sandbox;
   Publik + Synk + auth + /generate; toolchain + MCP + plugin + skill;
   data layer. Each reads the real code and docs for its area.
2. **Acceptances + values** — fan out per surface against the merged
   anatomy (so every `covers` edge targets a real node), plus a
   cross-cutting values-balance reviewer (the pyramid must not collapse
   into 90% `simplifies`).
3. **Story** — era agents over corpus slices, a decisions agent, then
   chronological merge.

Each wave gets an adversarial reviewer pass — checked against the product,
not just the schema — before its content is accepted.

### Size budget

Seed target ≤ ~600KB raw (gzips well; pebbles is 183KB at 152 nodes). The
merge script prints the size; exceeding the budget is a review flag, not a
silent fact. No screenshots or data-URIs in cycle 5.

## Delivery & review

- **PR A**: waves 1–2 (map + minimal journal). **PR B**: wave 3 (story),
  branched on A.
- Both are user-visible (the Explore sandbox fills with real content) →
  both carry Lab Notes.
- Visual pass checklist for Alexis per PR: canvas legibility at ~200 nodes,
  curated maps, product filter, changelog Design | Delivery panels, History
  page density, Decision Log.
- No prod migration; the seed is build-time imported, so content ships with
  the deploy.

## Testing

`npm run validate:seeds` is the primary gate (it enforces the full contract:
ID uniqueness, edge semantics, playlist coherence, journal cross-checks,
value enum). No new app tests — content-only. If a validator or renderer
bug is discovered, it becomes its own small PR, not a rider on A or B.

## Out of scope

- App code changes (content-only cycle).
- Pebbles retro-population (pending separately).
- French localization of seed content (the bundle schema has no locale
  axis today).
- New journal event types or schema changes — everything above fits the
  shipped vocabulary.
