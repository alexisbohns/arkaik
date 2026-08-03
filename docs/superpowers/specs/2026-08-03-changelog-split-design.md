# Changelog Split: Design | Delivery — Design

**Date:** 2026-08-03
**Status:** Approved (spec #3 of the self-map program)

## Program context

Cycle 3 of the "Arkaik in Arkaik" program
([2026-08-03-self-map-program.md](2026-08-03-self-map-program.md)). Cycles 1
(status lifecycle, PR #331) and 2 (Decisions species, PR #335) shipped. This
cycle splits the changelog page into **Design** and **Delivery** panels,
introduces **Deliverables** and makes **Releases** first-class in the journal
vocabulary, moves the granular event feed to a **History page**, and closes
cycle 1's deferred **blocked indicator** on StatusRing.

## Decisions made during brainstorming

- **Deliverables and Releases are journal-native** — new/extended journal
  event types, not node species and not bundle-level entities. Fits the
  PR-merge workflow (append-only, union-merge safe, agent-write safe);
  hundreds of PR-based deliverables live in the journal, which has
  compaction/archives, instead of bloating the snapshot. Species and
  bundle-array models rejected (see Alternatives).
- **Release ↔ deliverable association is slice-based**, not an explicit id
  list: a release's deliverables are the `deliverable.shipped` events in its
  changelog slice. One mechanism, reusing `computeChangelog`'s existing
  boundary semantics.
- **Editing = re-append, latest occurrence wins** — the re-tag rule the
  changelog page already applies to `release.tagged` extends to
  `deliverable.shipped` via `deliverable_id`.
- **Milestones deferred again.** They coordinate *future* work, which the
  append-only journal models poorly; they need their own (likely
  snapshot-side) brainstorm once the Delivery panel shows the gap.
- **Backlog moves into the Design panel** — open ideas/requests are
  pre-commitment, design-side signals; the panel reads as a funnel.
- **Authoring is CLI + agents only this cycle** — a new `arkaik deliverable`
  command and direct JSONL appends; the app renders read-only.
- **Blocked ring indicator is in scope** (deferred from cycle 1).

## 1. Journal vocabulary

One new event type; no change to `release.tagged`'s shape. No bundle change,
no `schema_version` bump — the vocabulary grows without version bumps
(journal spec § Event Envelope).

| Type | Payload | Meaning |
|---|---|---|
| `deliverable.shipped` | `deliverable_id`, `title`, `summary?`, `url?`, `node_ids?`, `platform?` | A unit of shipped work (typically one merged PR): entity changes + a summary note |

- `deliverable_id` — stable caller-chosen string. Convention for PR-based
  work: `pr-123`. Re-appending with the same id **edits**: consumers resolve
  a deliverable to its latest occurrence (the `release.tagged` re-tag rule).
- `title` required; `summary` is the human note; `url` points at the PR;
  `node_ids` lists the graph entities the deliverable touched (validated by
  the journal cross-check's existing "no event references a node that never
  existed" rule); `platform` scopes it to a platform's release rhythm,
  mirroring `release.tagged`.
- **Association rule:** a deliverable belongs to release `V` when its
  *latest* occurrence falls inside `V`'s changelog slice (strictly between
  `V`'s marker and the previous marker — `computeChangelog`'s boundaries).
  Occurrences after the last marker are **unreleased**. No `deliverables[]`
  field on `release.tagged`.
- Schema work in `packages/schema/src/journal-events.ts`: a
  `DeliverableShippedEventSchema` (envelope + payload, `.catchall` like its
  siblings), registered in `JOURNAL_EVENT_SCHEMAS` and
  `KnownJournalEventSchema`. `makeEvent` picks it up mechanically.
- `docs/spec/journal.md`: vocabulary row + a "Deliverables" passage under
  § Releases documenting the association and latest-wins rules.

## 2. Projections

Pure functions in `packages/schema/src/projections.ts`, same contract as the
existing ones (zod-free, immutable, empty journal → empty projection):

- `computeDeliverables(events, options?)` → `Deliverable[]`: latest
  occurrence per `deliverable_id`, each resolved to
  `{ deliverable_id, title, summary?, url?, node_ids, platform?, ts, releaseVersion: string | null }`
  (`null` = unreleased), in journal order. Release resolution walks the
  ordered events once, tracking the marker window each latest occurrence
  falls in; a re-tagged release resolves markers latest-wins exactly as
  `computeChangelog` does.
- `Changelog` gains `deliverables: Deliverable[]` — the deliverables whose
  latest occurrence sits in the slice — so release consumers (app card, CLI
  draft) get grouping for free.
- `computeCommitments(events)` → the ordered `node.status_changed` events
  whose transition is a **commitment**: `idea → discovery` or
  `discovery → backlog`. (Legacy pre-v3 `from`/`to` ids do not qualify;
  history is read as written.)
- Decision activity needs no new projection: the Design panel filters
  `decision.status_changed` events directly.

## 3. CLI

New `arkaik deliverable <title> [--id <deliverable_id>] [--summary <s>]
[--url <u>] [--nodes id,id] [--platform <p>] [path]` in
`packages/cli/src/commands/deliverable.ts`, mirroring `release.ts`: build
via `makeEvent` (validation throws on bad payload), append one line to the
sidecar, print the recorded deliverable. `--id` defaults to a generated
ULID-based id when not given; PR-based callers pass `--id pr-123` so later
re-appends edit. `arkaik release`'s draft groups its slice by deliverable
when any are present (falling back to the flat event list). Registered in
the CLI entry alongside `log`/`release`.

## 4. Changelog page: Design | Delivery panels

`app/project/[id]/changelog/page.tsx` keeps its route and "Changelog" title
(the sidebar's Delivery *board* is a different page; panel titles are scoped
by their context). Two boxed panels — side by side on wide viewports,
stacked on narrow:

- **Design panel** (the funnel, top to bottom):
  - **Backlog** — the existing open ideas/requests list, moved here.
  - **Commitments** — `computeCommitments` feed: node title, from→to badge,
    date.
  - **Decisions** — `decision.status_changed` feed with
    `DecisionStatusBadge`, each row linking to the node (panel deep-link),
    plus a "Decision Log →" link to `/project/[id]/decisions`.
- **Delivery panel**:
  - **Unreleased** — deliverables with `releaseVersion: null`, newest first.
  - **Releases** — newest first; each card shows version, date, platform
    chip, release `notes`, and its **deliverables** (title, summary, PR
    link, touched-node chips resolved via `nodesById`) instead of the raw
    event feed. A release whose slice has no deliverables shows its note and
    a quiet "no deliverables recorded" line (backfill will fill these; the
    raw events are one click away in History).
- Empty states per panel section, not per page; the page-level "No journal
  yet" state stays.

## 5. History page

New route `app/project/[id]/history/page.tsx`: the full granular feed —
every journal event in journal order, newest first, rendered with
`describeJournalEvent` rows (what release cards show today, generalized) —
with simple client-side filter chips by event family (nodes, edges,
decisions, refs, releases/deliverables, ideas/requests). No pagination this
cycle; the working journal is kept small by compaction.

Navigation: linked from the **ProjectSwitcher dropdown** next to Settings
(program doc: "project switcher section, near settings"), gaining a
`history` member in the `ProjectView` union and layout route matching. The
`HistoryIcon` moves to this entry; the Changelog sidebar item takes a
changelog-appropriate icon (e.g. `ScrollTextIcon`).

## 6. Blocked indicator on StatusRing

`StatusRing` (`components/graph/nodes/StatusRing.tsx`) gains an optional
`blockedCount?: number` prop: when `> 0`, a small alert notch/dot renders on
the ring with a tooltip ("N blocked"). Callers that build segments from
nodes pass the count of nodes whose `metadata.blocked_by` is non-empty. The
existing header comment's deferral note is replaced. Subtle by design — a
flag, not a segment (cycle 1's "blocked is a flag, not a status").

## 7. Mechanics: seeds, docs, generated artifacts

- `components/journal/describe-event.ts` gains the `deliverable.shipped`
  label ("Shipped: <title>").
- **Seeds:** `seed/pebbles.json`'s journal (179 events) gains a worked
  example — two deliverables inside a tagged release plus one unreleased,
  one of them re-appended to show latest-wins. `seed/arkaik-self-map.json`
  currently has **no** journal; it gains one (additive) carrying real
  history: `deliverable.shipped` for PRs #331 and #335 and a commitment/
  decision event or two — cycle 5 backfills the rest.
- **Docs:** `docs/spec/journal.md` (vocabulary row, Deliverables passage,
  projections table row); `docs/spec/bundle-format.md` untouched (no bundle
  shape change); `npm run generate` refreshes
  `lib/prompts/generated/schema.ts` / `public/schema/project-bundle.json` in
  the same PR (CI diffs generated artifacts).
- Lab Note required — the PR is user-facing.

## 8. Testing

DB-free (no local Postgres): pure unit tests in `packages/schema` for
`DeliverableShippedEventSchema` (valid/invalid payloads, unknown-field
preservation), `computeDeliverables` (latest-wins editing, slice
association, unreleased resolution, re-tagged release boundaries, platform
passthrough), `Changelog.deliverables`, and `computeCommitments` (matching
transitions only, legacy ids excluded). CLI test alongside
`tests/cli/log-release.test.js` for the new command. UI verification is a
manual checklist handed to Alexis (no browser driver): panel layout at both
widths, funnel ordering, release card grouping, unreleased block, History
page filters, switcher entry, blocked notch.

## 9. Error handling

- A `deliverable.shipped` missing `title` or `deliverable_id` fails strict
  validation at write time (`makeEvent`); already-stored malformed lines are
  surfaced by the existing per-line validator path, never crash a
  projection — `computeDeliverables` skips events without a string
  `deliverable_id`.
- `node_ids` entries that no longer resolve render as plain ids (no link),
  matching how `describeJournalEvent` degrades today.
- An empty journal or a journal with no deliverables renders the panels'
  empty states — never an error (journal spec's backward-compat story).

## Alternatives considered

- **Deliverable/release as node species**: rejected — one node per PR floods
  the snapshot and library over time; delivery history is not product
  anatomy; every rollup and map would need exclusions.
- **Bundle-level entity arrays**: rejected — invents a third entity kind
  with none of the existing machinery.
- **Explicit `deliverables[]` on `release.tagged`**: rejected — two
  association mechanisms; the slice already groups, and corrections are
  re-appends (move the deliverable's latest occurrence, not the release).
- **Milestones now**: deferred — forward-looking coordination doesn't fit
  the append-only journal; needs its own design once real usage shows the
  shape.

## Out of scope

Milestones, an app-side deliverable/release editor, pagination or search on
the History page, canvas rendering, changelog product-scoping (the header
meta label keeps its display-only role), and full self-map journal
backfill (cycle 5).
