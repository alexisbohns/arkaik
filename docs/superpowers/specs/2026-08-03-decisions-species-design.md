# Decisions Species — Design

**Date:** 2026-08-03
**Status:** Approved (spec #2 of the self-map program)

## Program context

Cycle 2 of the "Arkaik in Arkaik" program
([2026-08-03-self-map-program.md](2026-08-03-self-map-program.md)). Cycle 1
(status lifecycle overhaul, PR #331) shipped and is prod-migrated; this cycle
adds the **Decisions species** — ADR-style decision records as first-class
graph nodes — plus the journal vocabulary to narrate them. Cycle 3 (changelog
Design | Delivery split) will consume both.

## Decisions made during brainstorming

- **Idea stays a status.** No Idea entity this cycle either. A raw,
  species-less idea is captured as an `idea.proposed` journal event, or lands
  directly as a Decision at `proposed` whose Context holds the raw capture.
  Revisit only with real usage data.
- **Three new edge types** (`supersedes`, `generates`, `impacts`) rather than
  fewer overloaded ones — projections must never guess an edge's meaning from
  its endpoints.
- **Decision status is its own enum in metadata**
  (`metadata.decision_status`), following the acceptance precedent
  (`metadata.platformStatuses`). The global 7-status lifecycle stays global;
  the node's `status` field is kept in sync via a documented mapping.
- **Six decision states, `actual` renamed `enacted`:** the agreed-vs-realized
  distinction stays (it mirrors the spec→PR workflow), but "actual" is a
  false friend of the French *actuel*.
- **One new journal event type** (`decision.status_changed`), not a rich
  per-transition vocabulary and not overloading `node.updated`.
- **Milestones defer to cycle 3**, where they sit next to the
  Deliverables/Releases entities they coordinate.
- **UI scope: full model + working surfaces** (library, detail-panel editor,
  Decision Log page) — but no canvas rendering, same posture as acceptance.

## 1. The species

A 6th species `decision`: an ADR-style record with Context/Why,
Decision/What, Consequences/How.

- `packages/schema/src/ids.ts`: `SPECIES_IDS` gains `"decision"`.
- `packages/schema/src/id-gen.ts`: `SPECIES_PREFIXES` gains
  `decision: "DEC-"`.
- `lib/config/species.ts`: entry
  `{ id: "decision", level: null, label: "Decision", description: "an ADR-style decision record: Context (why), Decision (what), Consequences (how), with its own decision status" }`.

Field mapping:

| ADR part | Storage |
|---|---|
| Decision / What | `title` (short statement) + `description` (full statement) |
| Context / Why | `metadata.context` — markdown text |
| Consequences / How | `metadata.consequences` — markdown text |
| Decision status | `metadata.decision_status` — enum (§2) |
| When decided | `metadata.decided_at?` — ISO 8601 date, optional |

`decided_at` exists so cycle 5's historical backfill can date decisions
correctly: `node.created` journal events will all carry the backfill run's
timestamp, not the day the decision was actually made.

Decisions carry no `platforms` (empty array) and no per-platform statuses.
They are excluded from delivery/coverage rollups (`lib/utils/delivery.ts`,
`coverage.ts`, `platform-status.ts` treat the species as out of scope, the
same way acceptance is special-cased today) and from product membership
walks — a decision's product affiliation, if ever needed, derives from its
`impacts`/`generates` targets, but no surface needs it this cycle.

## 2. Decision status & lifecycle sync

`metadata.decision_status` vocabulary, in the usual path order:

| id | meaning |
|---|---|
| `proposed` | Drafted, under consideration. |
| `approved` | Agreed — but not yet reality. |
| `enacted` | In effect: the implementing change shipped. |
| `rejected` | Considered and declined. *(terminal)* |
| `deprecated` | Was enacted; no longer recommended, nothing replaces it. *(terminal)* |
| `superseded` | Replaced by a later decision (see `supersedes`, §3). *(terminal)* |

Like the node lifecycle, transitions are documented, never enforced.

**Lifecycle sync.** The node's global `status` field remains meaningful so
every existing surface (library badges, filters, counts) keeps working
without branching. Writers keep it in sync via one shared helper exported
from `@arkaik/schema` — `lifecycleStatusForDecision(decisionStatus)`:

| decision_status | lifecycle status |
|---|---|
| `proposed` | `discovery` |
| `approved` | `backlog` (agreed, waiting to become reality — exactly "ready to be delivered") |
| `enacted` | `live` |
| `rejected` / `deprecated` / `superseded` | `archived` |

The mapping is applied at write time by the app's decision editor and
documented for agents/CLI; the validator cross-checks it as a **warning**
(never an error — hand-edited bundles must not brick).

## 3. Edge grammar

Three new edge types appended to `EDGE_TYPE_IDS` and registered in
`VALID_EDGE_SEMANTICS` (`packages/schema/src/ids.ts`) and
`lib/config/edge-types.ts`:

| Edge type | Legal pairs | Meaning |
|---|---|---|
| `supersedes` | `decision → decision` | Source replaces target; recording it also moves the target to `decision_status: superseded` |
| `generates` | `decision → acceptance` | The decision produced this testable promise |
| `impacts` | `decision → flow \| view \| data-model \| api-endpoint` | The decision affects this existing node (or spawned it) |

`generates` and `impacts` are deliberately disjoint: acceptances are
*generated* by decisions, never merely *impacted*, so `impacts` does not
accept an `acceptance` target. `edgeTypesForSpeciesPair` picks all of this up
mechanically for the connect dialog.

Maps are untouched: the `journey` and `system` kind defaults in
`packages/schema/src/maps.ts` list species explicitly, so `decision` nodes
and the three new edge types are excluded from both maps by default — the
same posture acceptance/`covers` took. Canvas registration is out of scope
(revisit once real decision content exists, cycle 5).

## 4. Journal vocabulary

One new event type in the vocabulary and in the strict
`KnownJournalEventSchema` (`packages/schema/src/journal-events.ts`):

| Type | Payload | Meaning |
|---|---|---|
| `decision.status_changed` | `node_id`, `from`, `to` | A decision moved between decision states |

- Shape mirrors `node.status_changed`; `from`/`to` are decision-status ids.
- Supersession is two records: `edge.added` (`supersedes`) + the superseded
  decision's `decision.status_changed → superseded`. No dedicated
  `decision.superseded` event.
- The lifecycle sync (§2) also emits the ordinary `node.status_changed` when
  the mapped lifecycle status moves — both events in the same dual-write.
- Forward compatibility (journal spec § Event Envelope) means older parsers
  ignore the new type safely; no version bump.
- `components/journal/describe-event.ts` gains a human label
  ("Decision approved", "Decision superseded" …).
- `docs/spec/journal.md`'s vocabulary table gains the row.

## 5. Surfaces

- **Library** (`/project/[id]/library`): the species config entry drives
  gallery cards and the directory table mechanically; the sidebar's
  `?species=` deep link accepts `decision`. Gallery card shows the
  decision-status badge (§6) instead of platform chips.
- **Node detail panel** (`components/panels/NodeDetailPanel.tsx`), branching
  by species as today:
  - Context and Consequences textareas (markdown), description field as the
    full Decision statement.
  - Decision-status dropdown — writes `decision_status`, applies the
    lifecycle sync helper to `status`, and dual-writes
    `decision.status_changed` (+ `node.status_changed` when the mapped
    status moves) via `lib/data/emit-events.ts`.
  - `decided_at` date field.
  - Connections section: supersedes / superseded-by (from `supersedes`
    edges, both directions), generated acceptances, impacted nodes — each a
    linkified list.
- **Decision Log page** — new route `/project/[id]/decisions`, a sibling of
  Acceptances in the project navigation: decisions newest-first (by
  `decided_at`, falling back to journal `node.created`), decision-status
  badge, filter chips by decision status, and the supersession chain
  rendered inline — a superseded decision collapses/dims under its
  successor rather than cluttering the top level.
- **Not in scope**: canvas/map rendering, Milestones (cycle 3), an Idea
  entity (stays a status), changelog integration (cycle 3's Design panel).

## 6. Decision-status badge

A small `DecisionStatusBadge` component (sibling of `StatusBadge`), with its
own exhaustive `Record<DecisionStatusId, …>` style/icon/label maps so `tsc`
gates future vocabulary edits the same way `STATUS_STYLES` does. Used by the
library gallery card, the directory table, the detail panel, and the
Decision Log.

## 7. Mechanics: schema, seeds, generated artifacts

- **No `schema_version` bump, no migration.** Everything is additive:
  optional metadata fields, new enum members, new edge types, one new event
  type (products precedent). Old bundles parse unchanged; a bundle with no
  decisions renders empty states.
- `packages/schema/src/bundle.ts` `NodeMetadata`: optional `context`,
  `consequences`, `decision_status`, `decided_at`.
- New `DECISION_STATUS_IDS` const + `DecisionStatusId` type +
  `lifecycleStatusForDecision` in a new `packages/schema/src/decision.ts`
  module (matching the `acceptance.ts` precedent).
- Validator additions (warning severity unless stated): `decision_status`
  only on `decision` nodes; unknown `decision_status` value is an **error**
  at parse boundaries (same posture as unknown lifecycle status);
  lifecycle/decision-status mapping mismatch is a warning; edge-semantics
  violations for the three new types fall out of `VALID_EDGE_SEMANTICS`
  (existing error path).
- `npm run generate` refreshes `lib/prompts/generated/schema.ts` and
  `public/schema/project-bundle.json`; CI diffs generated artifacts, so this
  runs in the same PR.
- **Seeds:** `seed/pebbles.json` gains a small worked example (a decision
  superseding another, generating an acceptance, impacting a view).
  `seed/arkaik-self-map.json` gains *real* decisions — cycle 1's standing
  decisions ("two axes stay", "blocked is a flag, not a status", the
  migration philosophy) become the first inhabitants, which is the self-map
  program working as intended.
- **Docs:** `docs/graph-model.md` (species table, edge-type table, a
  Decisions section, Taxonomy Update Checklist dated note),
  `docs/spec/journal.md` (vocabulary row), `docs/spec/bundle-format.md`
  (metadata fields, edge semantics), `docs/arkaik-skill` references via
  regeneration.

## 8. Testing

DB-free by convention (no local Postgres): pure unit tests in
`packages/schema` for the edge semantics (legal/illegal pairs for all three
new types), `KnownJournalEventSchema` accepting `decision.status_changed`,
`lifecycleStatusForDecision` (all six inputs), validator rules
(decision_status on wrong species, mapping mismatch warning), and id
generation with the `DEC-` prefix. UI verification is a manual checklist
handed to Alexis (no browser driver): library card/table rendering, the
detail-panel editor round-trip, Decision Log ordering/filtering/supersession
chain, journal entries appearing in the changelog feed.

## 9. Error handling

- Unknown `decision_status` in stored data: badge falls back to `proposed`
  styling — render, never crash (mirrors the `?? STATUS_STYLES.idea`
  pattern).
- A `decision` node missing `decision_status` entirely: treated as
  `proposed` for display; validator warning.
- Journal events referencing decision nodes follow the existing
  cross-check rules; `decision.status_changed.to` must equal the node's
  current `decision_status` (same by-value rule as rule 3 of the journal's
  Authority & Consistency Model).

## Alternatives considered

- **Idea as a species** (or folded into Decision): deferred again —
  doubles the cycle's surface work; the journal's `idea.proposed` plus
  Decisions-at-`proposed` cover the capture need until real usage argues
  otherwise.
- **Two edge types** (`impacts` covering acceptances) and **one type +
  `metadata.relation`**: rejected — consumers should never infer meaning
  from endpoints or read edge metadata to know what an edge is.
- **Species-specific `status` vocabulary**: rejected — every status
  consumer would branch by species; the metadata enum + sync mapping keeps
  the global model intact.
- **Rich per-transition event vocabulary** (`decision.approved`, …):
  rejected — six event types duplicating what one from/to event says.
- **Classic 5-state ADR vocabulary**: rejected — loses the
  agreed-vs-realized distinction the spec→PR workflow needs.

## Out of scope

Canvas rendering of decisions and their edges, Milestones, Deliverables/
Releases, the changelog Design | Delivery split, the History page, an Idea
entity, transition enforcement, product membership for decisions, and
content population — all later cycles. The implementation PR is user-facing
and must carry a Lab Note.
