# Status Lifecycle Overhaul — Design

**Date:** 2026-08-03
**Status:** Approved (spec #1 of the self-map program)

## Program context

This is the first of five spec→plan→build cycles agreed for the "Arkaik in
Arkaik" program:

1. **Status lifecycle overhaul** (this spec) — prerequisite for everything below.
2. Decisions species (ADR pattern) + journal vocabulary.
3. Changelog split into Design | Delivery panels + Deliverables/Releases +
   History page.
4. Public Arkaik project referenced in `/projects` (anonymous read-only,
   local play without shared persistence).
5. Subagent content population (repo/PR/docs scraping into the self-map),
   interleaved with #4.

## Decisions made during brainstorming

- **Two axes stay.** Status remains the pure delivery lifecycle. Exposure
  stays on the orthogonal `stage` axis (`beta | monitoring | deprecated`,
  `metadata.stage`). The proposed `limited` and `deprecated` statuses are
  dropped: `stage: beta` already expresses "limited", `stage: deprecated`
  already expresses "deprecated".
- **`idea` stays a status**, not a standalone entity. Priority/impact can live
  in metadata; the Idea-as-entity question may be revisited in cycle #2
  (Decisions), where ideas are actually consumed.
- **`blocked` stops being a status** and becomes an orthogonal
  `metadata.blocked_by` flag — a blocked node keeps its lifecycle position.
- **Migration map:** `prioritized → backlog`, old `backlog → idea`,
  `blocked → development` + `blocked_by` set. Journal history is never
  rewritten.
- **Approach A:** hard cutover + permanent parse-time legacy aliases +
  one-time versioned migration (over additive soft-deprecation and a
  versioned status model, both rejected — see Alternatives).

## 1. Vocabulary & semantics

Seven statuses, in lifecycle order:

| id | meaning |
|---|---|
| `idea` | Raw capture — request, intuition, opportunity. The inbox. |
| `discovery` | Actively being made ready to deliver, via design or specification. |
| `backlog` | Ready to be delivered; waiting to start. |
| `development` | Being implemented or executed. |
| `releasing` | Implementation done; awaiting validation (QA) or effective release/distribution (staging→prod, app-store review…). |
| `live` | Fully available. |
| `archived` | Retired from the working set. |

Semantics compared to the old list: `discovery` is new (the old model had no
"being designed" state); `backlog` upgrades from "someday pile" to "ready to
start" (the role old `prioritized` played); `prioritized` and `blocked` are
removed.

**The cycle is documented, not enforced.** `docs/graph-model.md` § Status
Model gets the table above plus a transition diagram; runtime code performs no
legal-transition validation — status remains a free assignment, as today.

**Blocked flag.** `metadata.blocked_by?: string` — free text or a node id.
Non-empty means the node is blocked at whatever status it holds. When the
value resolves to an existing node id, surfaces render it as a link. Clearing
the field unblocks.

**Stage axis.** Untouched. No file under `lib/config/stages.ts` or any stage
consumer changes in this cycle.

## 2. Schema changes (`packages/schema`)

- `src/ids.ts`: `STATUS_IDS` becomes
  `["idea", "discovery", "backlog", "development", "releasing", "live", "archived"]`.
- New `LEGACY_STATUS_ALIASES: Record<string, StatusId>` =
  `{ prioritized: "backlog", blocked: "development" }`, plus
  `normalizeStatus(value: string): StatusId | undefined`. These two ids are
  dead (absent from both vocabularies), so aliasing them is unambiguous and
  **permanent** — old bundles, JSONL journals, MCP inputs, and `ref_policy`
  configs keep working forever.
- Alias application points: bundle parse/validate, journal JSONL parse, MCP
  write-tool inputs (`create_node`, `update_node`), and `ref_policy` target
  values in `promote.ts`.
- `src/bundle.ts` `NodeMetadata`: add optional `blocked_by?: string`.
- Bundle `schema_version` bumps by one. The ambiguous old-`backlog → idea`
  remap is keyed on this bump (it cannot be an alias: `backlog` is a valid id
  in both vocabularies with different meanings).
- `src/journal-events.ts`: in the strict `KnownJournalEventSchema`, the
  `from`/`to` fields of `node.status_changed` (and `ref.status_changed`'s
  `status_mapped`) accept the union of new and legacy ids, so historical
  events still validate.
- `DEFAULT_REF_POLICY` is unchanged: `github-pr`/`gitlab-mr` →
  `{open: "development", merged: "live", closed: null}`.

## 3. Migration

One **pure function** over a bundle (exported from `@arkaik/schema` so every
runtime shares it):

1. `prioritized → backlog`
2. `blocked → development`, and set
   `blocked_by: "migrated from legacy blocked status"` if not already set
3. `backlog → idea` (only when the bundle's `schema_version` predates the bump)
4. Stamp the new `schema_version`

Application points:

- **IndexedDB:** a migration step in `lib/data/migrate.ts` runs the function
  over every stored project on first load.
- **Bundle import** (`parseBundleFromFile` path): old bundles — including old
  Publik snapshots, which stay immutable server-side — migrate on import.
- **CLI:** loading an old file bundle migrates in memory; `arkaik validate`
  reports the stale version; a write command persists the migrated form.
- **Hosted projects:** a server-side migration script over the Postgres graph
  store. Per the deploy convention, **prod migrations are run manually** —
  the plan must call this out as an operator step.
- **Seeds:** `seed/pebbles.json` and `seed/arkaik-self-map.json` are
  regenerated with new statuses and the new `schema_version`.

**No journal events are emitted by migration.** This is a vocabulary change,
not product history. The journal is never rewritten; old events keep old ids.
`components/journal/describe-event.ts` keeps a label fallback so legacy ids
render readably (`prioritized`, `blocked` as plain text labels).

## 4. App surfaces

- `lib/config/statuses.ts`: new `STATUSES` list and `STATUS_ORDER`.
  `COUNTED_STATUS_PRESETS.delivery` becomes
  `[backlog, development, releasing, live]` (blocked nodes now count under
  their real status).
- `components/graph/nodes/node-styles.ts`: `STATUS_STYLES`, `STATUS_ICONS`,
  `STATUS_LABELS` gain a `discovery` entry (Compass icon, violet family) and
  drop `prioritized`/`blocked`. These exhaustive `Record<StatusId, …>` maps
  are the compile-time gate: after editing them and `ids.ts`, `tsc`
  enumerates every remaining site (~38 files — badges, rollups, filters,
  panels, delivery board, pyramid rings).
- `StatusBadge` / `StatusRing`: when `metadata.blocked_by` is non-empty,
  render a blocked overlay (small indicator + tooltip showing the
  `blocked_by` value, linkified when it is a node id). The
  `?? STATUS_STYLES.idea` unknown-status fallback stays.
- `NodeDetailPanel`: status dropdown uses the new list; add a `blocked_by`
  text field.
- Library filter bar: add a "Blocked" chip driven by the flag, so the
  filtering capability lost with the status is preserved.
- Rollups (`lib/utils/platform-status.ts`, `coverage.ts`, `delivery.ts`,
  `acceptance-matrix.ts`) recompute mechanically off the new list.

## 5. Agent plane & generated artifacts

- MCP write tools **normalize legacy ids on input** rather than erroring —
  an agent sending `status: "prioritized"` gets `backlog` stored.
- `npm run generate` refreshes `lib/prompts/generated/schema.ts` and the
  published JSON Schema (`public/schema/project-bundle.json`); CI diffs
  generated artifacts, so this is a required step of the same PR.
- The plugin skill's rendered references pick up the new vocabulary from the
  regenerated assets.

## 6. Docs

- `docs/graph-model.md` § Status Model: rewritten — the 7-status table,
  transition diagram, `blocked_by`, the stage-axis relationship, and the
  legacy-alias note.
- `docs/spec/journal.md`: note that `from`/`to` may carry legacy ids in
  historical events and that validators accept them.
- `docs/spec/bundle-format.md`: record the `schema_version` bump and the
  migration function.

## 7. Testing

DB-free by convention (no local Postgres): pure unit tests in the schema
package for `normalizeStatus`, the migration function (all three remaps,
version gating, `blocked_by` stamping, idempotence), and the projections fed
journals containing legacy ids. UI verification is a manual checklist handed
to Alexis (no browser driver): badge rendering per status, blocked overlay,
filter chip, detail-panel field, changelog rendering of legacy events.

## 8. Error handling

- Unknown status in stored data after migration: `StatusBadge` falls back to
  `idea` styling (existing behavior) — render, never crash.
- `normalizeStatus` on an unrecognized value returns `undefined`; parse
  boundaries surface a validation error listing accepted ids (new + legacy).
- Migration is idempotent: re-running on an already-migrated bundle is a
  no-op (version gate for step 3; steps 1–2 operate on ids that no longer
  exist).

## Alternatives considered

- **B — Additive soft-deprecation** (both vocabularies valid, lazy migration
  on write): rejected — 10 ids forever in every consumer, and untouched
  hosted projects never converge; permanent complexity to avoid a one-time
  cost the small dataset doesn't justify.
- **C — Versioned status model** (`status_model` field, pluggable
  vocabularies): rejected as YAGNI — statuses are not user-customizable and
  are not intended to become so.

## Out of scope

Transition enforcement, the Decisions species, the changelog Design|Delivery
split, Deliverables/Releases entities, the History page, Idea-as-entity, any
`stage` axis change, the public Arkaik project, and content population — all
later cycles. The implementation PR is user-facing and must carry a Lab Note.
