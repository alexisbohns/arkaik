# Hosted scoped re-audit — design (issues #472 + #473)

**Status:** approved 2026-09-27. Ships as a three-part stack.

## Problem

`kritik_scope` (0.6.0, #443) works hosted but is useless on the project that
needed it. Pebbles (`prj_5dDiZc-G6lseF3cb`) got its `2026-08` audit through
`arkaik restore`: 338 assessments in `snapshot.quality`, no
`quality.audit.completed` in the journal, and 36 hosted resolutions since then.
The scope measures from the newest recorded audit, so it is always empty
(#472). Even with a scope, a hosted session can't act on it:
`kritik_score` and `kritik_matrix record=true` refuse in hosted mode, and
`POST …/quality/events` only accepts finding decisions and trips (#473).

## Decisions

1. **Synthesize the baseline on read, then write it for real on the first
   hosted score.** Reads get the baseline without any write (#472 option 1).
   The first hosted `quality.assessment.scored` makes the server write the
   same reading as a real, backdated `quality.audit.completed`. After that the
   synthesis is off. Why: once hosted scores fold into `section.assessments`
   (latest-wins per cell), no reader can rebuild the level a re-scored cell
   had at the baseline. Writing it at that moment, from the unfolded snapshot,
   means it can't drift.
2. **Hosted scoring is scoped-only.** The server refuses any cell
   `deriveAuditScope` does not list. Repo mode's "leave scope off to re-score
   an out-of-scope cell on purpose" has no hosted twin. A hosted comprehensive
   audit would be its own design.
3. **Repo mode is out of scope.** The synthesis is wired into hosted reads
   (MCP hosted branch, server, app Quality page) only. A repo can record its
   own audits. Wiring the synthesis in there without also writing the baseline
   would lose the first trend row the moment the repo records a scoped audit.

## Part 1 — the implicit baseline (#472)

**`packages/schema/src/quality-baseline.ts`** (pure, zod-free, fs-free, like
its `quality-scope`/`quality-trend` siblings):

```ts
implicitAuditBaseline(events, section, library): JournalEvent | null
withImplicitBaseline(events, section, library): JournalEvent[]  // events, plus the baseline when there is one
```

- **When:** the journal holds no `quality.audit.completed` at all, **and** the
  section holds at least one assessment with an `audit_id`. Otherwise `null`.
- **Which audit:** the lexically newest `audit_id` among the assessments (the
  latest-wins order the merge uses).
- **When it's dated (`ts`):** the newest `ts` among that audit's assessments.
  It is capped to 1 ms before the first `quality.finding.resolved`/`accepted`
  in `orderEvents` order, so no resolution is ever pushed out of the window
  (that's the #472 trap). With no assessment `ts`, it's 1 ms before the first
  decision. With neither, it takes the newest journal event's `ts`, else the
  Unix epoch. An unparsable `ts` falls back to that string, with the event id
  breaking the tie.
- **The scores at the time of the audit:** start from the section, then set
  every finding that a decision event ordered after the baseline's `ts` names
  back to `open`. That undoes both the server's fold and a sidecar resolution
  that came later. Anti-averaging caps depend on finding status, so without
  this step the baseline would read higher than the audit really scored. It
  also makes the stored section and the folded one produce the same baseline.
  Then `deriveQualityMatrix` → `auditCompletedInput(matrix, {audit_id,
  framework_version: matrix.framework_version ?? library.version ?? "unknown"})`.
- **Event:** `id: "implicit-baseline:<audit_id>"`, no actor, payload
  `baseline: true`.

**Schema:** `QualityAuditCompletedEventSchema` gains optional
`baseline: boolean`. `AuditSnapshot`/`TrendRow` gain `baseline?: true` and
`scope?: {since, cells}`. The latter is read from the event, since #443
recorded it but never surfaced it, and #473 needs the row flagged as scoped.

**Wiring:**
- MCP `scopeOf` (hosted branch) and `kritik_trend` (hosted) prepend it.
  `since=<audit_id>` resolves against `recordedAuditIds` of the augmented
  journal. The trend row for the baseline says it was synthesized.
- App `useQualityData`: the journal read widens from `AUDIT_EVENTS` to the
  audit and decision types, and the trend is derived over
  `withImplicitBaseline`. The Quality page's arrows then read "since the
  restored audit" as soon as anything is re-scored.
- CLI trend printing marks `baseline` and `scoped` rows.

## Part 2 — the hosted write path (#473, server)

**Schema:** a new `quality.assessment.scored` event, `{ audit_id,
criterion_id, surface, level (0–4), evidence, commit?, scope: { since } }`,
plus `assessmentScoredInput()` in `quality-ops.ts`.

**Fold:** `foldFindingEvents` (app-internal, `lib/utils/quality.ts`) is renamed
`foldQualityEvents`. It also folds `quality.assessment.scored`
latest-wins per `(criterion × surface)` in journal order, and appends a cell
the section never held. Every caller moves to it: the project GET, the local
provider, and `planQualityEvents`. `qualityFindingEvents` becomes
`qualityFoldEvents`, and it and `VALIDATOR_COLUMNS` include the new type,
because the ETag has to move when the folded body does.

**Route whitelist** (`parseQualityEventInputs`), two new entries, both
`graph:write`:
- `{type: "quality.assessment.scored", criterion_id, surface, level, evidence,
  audit_id?, commit?}`
- `{type: "quality.audit.completed", scope: true, audit_id, commit?}`. The
  literal `scope: true` is required. A caller-supplied `scores`/`counts` is a
  400: the server computes both.

**Planning** (`planQualityEvents`, still pure). The route now loads the
decisions, the scored events and the recorded audits.
- **Scored:** reject an unknown or retired criterion (`resolveKritikLibrary`
  of the stored section), a surface the profile doesn't declare or
  `cross-surface`, an `applies_to` mismatch, a level that isn't an integer
  0–4, or empty evidence. Then run `deriveAuditScope(withImplicitBaseline(
  events), folded section, library)`: `since === null` means no reading to
  measure from; a cell the scope doesn't list is `out_of_scope`. Audit id: the
  requested one, else the open scoped audit (scored events with the same
  `since` and no recording), else `<YYYY-MM>-scoped[-NN]`. The
  `scopedAuditTarget` rules move into a pure helper both modes share: never
  the `since` audit, never a recorded one, and it must sort after every known
  audit id. `scope.since` is stamped on the event.
- **Writing the baseline:** if any scored entry is accepted and
  `implicitAuditBaseline(events, stored section, library)` is non-null, the
  plan puts it first, as a real event (`makeEvent` with the baseline's `ts`, a
  fresh id, the caller's actor, `baseline: true`).
- **Scoped completion:** the audit id must have ≥1 scored event (from earlier
  or in this batch), must not already be recorded, and every scored event in
  it must share one `since`, which has to be the current scope's `since`.
  Scores come from `deriveQualityMatrix` over the section folded through
  everything, as `auditCompletedInput(…, {scope: {partial: true, cells:
  <distinct cells scored in that audit>, since}})`.
- All-or-nothing as before. New refusal reasons: `invalid_assessment`,
  `out_of_scope`, `no_baseline`, `not_scored`, `already_recorded`,
  `scope_mismatch`. The refusal type widens from `{finding_id, reason}` to
  `{index, reason, finding_id?, detail?}`.

## Part 3 — MCP + docs (#473, client)

- `Store.appendQualityEvents` takes the widened input union.
- `kritik_score` hosted: requires `scope=true` (otherwise a refusal naming the
  scoped-only rule) and posts a scored event. The reply carries `audit_id`,
  `scoped_from`, the baseline event when one was written, and the anchor.
- `kritik_matrix record=true` hosted: requires `audit_id`, and `scope=true` is
  implied. It posts the scoped completion and returns the recorded event. A
  plain hosted read stays as it is. With `audit_id` on a read, it's still
  refused.
- `kritik_trend`/`kritik_scope` descriptions and the module header are
  updated. The Kritik skill prose (`plugin-kritik`, `docs/kritik-skill`) gets
  a hosted scoped re-audit loop, checked adversarially as its own pass.
  `docs/hosted-projects.md` and `docs/spec/journal.md` document the event and
  the whitelist.
- Version bump for arkaik + arkaik-mcp and the skill. The Lab Note goes on
  this PR.

## Acceptance → tests

| Acceptance | Test |
|---|---|
| Restored project, no recording: scope lists every resolved cell; `since=<audit>` resolves | `tests/schema/quality-baseline.test.js` + `tests/mcp/kritik-tools.test.js` (hosted fake store) |
| Trend's first row is the baseline | same, via `deriveQualityTrend(withImplicitBaseline(…))` |
| Baseline undoes later decisions before the caps apply | baseline test: a Critical resolved after the audit still caps its cell in the baseline |
| Hosted score → record: no files, matrix reflects re-scored cells, others keep their level | `tests/services/quality-events.test.js` (DB-free plan) + MCP hosted test |
| Trend shows the scoped row flagged, with a real delta against the baseline | trend test over the planned events |
| Out-of-scope cell refused server-side | plan test, `out_of_scope` |
| Baseline written once, backdated, then the synthesis turns off | plan test: first score batch starts with it; second batch doesn't |
| ETag moves on a scored event | `tests/services/graph-etag.test.js` |

Every suite the new `@/…` imports touch gets its loader rewrite table checked.
The Postgres-backed route suites run against a scratchpad cluster before
pushing.
