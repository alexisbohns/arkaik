# Kritik lane 2 — the bundle writer

**Date:** 2026-08-29
**Status:** approved, implementing
**Issue:** [#389](https://github.com/alexisbohns/arkaik/issues/389)
**Follows:** #382 phases A–E (#383 schema, #384 plugin, #385 CLI/MCP, #386 release, #387 the app feature, #388 the loop)
**RFC:** [`docs/rfcs/kritik.md`](../../rfcs/kritik.md) §§ 3.1, 4.1

## Problem

Kritik's audit data lives in `docs/quality/` sidecars. The app reads it from a
bundle's `quality` section. Nothing connects the two, so both read surfaces
built in #382 have no producer.

The Quality page (#387) renders `deriveQualityMatrix(bundle)` and shows the
empty state to a project that has audited every surface. The resolution webhook
(#388) reads `snapshot->'quality'->'findings'`, finds none, and returns
`no_quality_data` for every repo that audits into sidecars — which is every repo
following the skill.

This is the lane-1/lane-2 split of the RFC (§§ 3–4), not a regression in any
phase. But #382's Definition of Done — *"run an audit … and see the comparative
matrix and findings board in the app"* — needs the writer, and no phase built
it. This is the last thing standing between #382 and its own DoD.

## What is already true

Six facts, each verified against the code, that shape the design more than the
issue anticipated:

1. **`loadQualitySection` already assembles the right shape.** One audit's
   `scores.json` + `findings.json` + `profile.json` become exactly the
   `QualitySection` a bundle carries (`packages/schema/src/cli/kritik-audit.ts:153`).
   Its four callers all use the result in memory and discard it. Nothing is
   missing from the *shape*; only from the plumbing.

2. **`arkaik restore` does not go through `pack`.** It assembles
   `{ ...readBundle(path), journal: loadJournalEvents(...) }` directly
   (`packages/cli/src/commands/restore.ts:474`). A pack-time-only projection
   would miss the one verb that lands a bundle on a hosted project — the verb
   the issue's own acceptance criteria name.

3. **Embedding the library is a correctness requirement, not a size trade.**
   The app calls `resolveKritikLibrary(section)` with **no** fallback pack
   (`app/project/[id]/quality/page.tsx:62`); it has no other source for one.
   The synthesized fallback assigns every criterion `weight: 1`. The real pack's
   weights are `3 × 43, 2 × 39, 1 × 6`. A bundle without an embedded library
   therefore renders a matrix whose scores **silently disagree with the
   project's own `matrix.json`**.

4. **`validateBundle` already legislates most of this.** Three of its warnings
   are, read the other way round, a specification for the projection:
   `quality-duplicate-assessment` ("the section stores latest-per-cell") forces
   the merge to dedupe; `quality-library-missing` forces the embed;
   `quality-derived-field-stored` forbids `severity`/`priority` on a stored
   finding.

5. **`severityOf`/`priorityOf` ignore any stored value.** Both derive from
   `impact × likelihood` (`packages/schema/src/quality.ts:400`, `:419`). A
   stored `severity` is inert at render time — it costs a validator warning and
   nothing else, so dropping it loses no information.

6. **Storage needs no change and `serializeBundle` needs no change.**
   `createProject` does `const { journal = [], ...snapshot } = bundle`, so a
   `quality` section rides into Postgres and back out through
   `readProjectBundle` (verified in phase D). `emissionOrder`
   (`packages/schema/src/serialize.ts:82`) sorts unknown top-level keys and
   appends them, so `quality` lands deterministically after `journal`.

## Decisions taken before the design

Four questions the issue left open, and one it did not.

### 1. Assembly-time fold, never a write to `bundle.json`

The projection happens where a bundle is assembled for interchange. Nothing
rewrites `docs/arkaik/bundle.json`, ever.

This is the journal's doctrine applied unchanged: `journal.jsonl` is canonical
in a repository, the bundle's embedded `journal[]` is only the interchange
projection, and `arkaik pack` is what folds one into the other. `docs/quality/`
is canonical the same way, and `bundle.quality` is its interchange projection.

Two of the issue's four open questions dissolve here rather than being answered.
**Idempotence** (Q3) is not a requirement to meet but a property of writing
nothing: re-running with nothing re-scored cannot churn a file it never touches.
**Implicit-on-push** (Q4) stops being a trade-off: no push rewrites a tracked
file, because no verb does.

The cost, stated plainly: `git diff docs/arkaik/bundle.json` will never show
quality state, and the fold has two call sites instead of one. The issue's first
acceptance bullet — *"`docs/arkaik/bundle.json` gains a `quality` section"* — is
therefore **not** met as literally written, deliberately. The bullets it exists
to serve (the hosted project shows the matrix; a merged PR resolves a finding)
are met.

### 2. The full effective library, embedded

`quality.library` carries the **effective** library — `loadKritikLibrary(root)`,
which is pack ⊕ overlay — never the bare pack, or a project's custom criteria
vanish from the bundle that is supposed to be self-describing.

The full pack is ~482 KB, of which 477 KB is the 88 criteria. A trim carrying
only what the matrix needs to be correct (`id`, `domain`, `name`, `weight`, plus
domains and scales) measures 11 KB — 44× smaller, and enough for correct scores,
correct grade bands and real domain names. It was rejected because it leaves
`CriterionDetailPanel` — a whole surface phase D shipped — with an id and
nothing else, and because a trim function must track which fields the UI reads,
a coupling with no test to catch it rotting.

RFC § 4.1 says as much in the type itself: `library?: KritikLibrary; //
embedded on export`.

Scale check: the pilot sidecars are 351 KB of scores and 551 KB of findings.
A Pebbles-scale packed bundle lands near 1.9 MB against `restore`'s 5 MB server
cap.

### 3. Current state, merged — not one audit taken whole

Findings and assessments are **not symmetric** in this codebase, and the design
follows the asymmetry that is already there rather than imposing one.

`locateFinding` and `allFindings` already search across every audit, and
`mintFindingId` makes ids audit-scoped (`F-2026-08-SEC-web-01`) — findings
behave as a repo-wide ledger. Assessments are per-audit snapshots, and
`arkaik kritik score` writes into the newest audit directory, so a partial
re-audit leaves a **sparse** newest `scores.json`.

Taking the newest audit whole would therefore render a mostly-empty matrix after
any partial re-audit, and drop still-open findings from earlier audits off the
board. So:

- **assessments** — latest-wins per `(criterion_id, surface)` across every
  audit, which is what `QualitySection.assessments` is documented as and what
  `quality-duplicate-assessment` insists on;
- **findings** — every finding from every audit.

**The consequence is deliberate and must be documented, not hidden:** the app's
matrix answers *"where does the product stand"*, while `matrix.json` and
`arkaik kritik matrix` answer *"how did this audit go"*. These are different
questions, and caps can fire in the app that did not fire in a single audit's
roll-up — an open critical from two audits ago still caps its cell, which is
true. `--audit <id>` pins one audit's snapshot for anyone who wants the other
question answered.

### 4. `severity` and `priority` are stripped on fold

The sidecars store both on every finding; the schema forbids both on a stored
finding. The projection emits the doctrinal shape and drops them. Every other
key passes through verbatim, unknowns included (`source_cell`, `remediation`).

Nothing is lost (fact 5), and a projection that emits a bundle its own validator
warns about 492 times is a broken projection. The sidecars are canonical and
keep whatever they keep; this writes one direction only and never edits them.

This does not weaken `pack`'s round-trip guarantee. That guarantee is about not
damaging what an author wrote in `bundle.json` — the defect at
`docs/spec/bundle-format.md:40`. This section was never in `bundle.json` to
damage; it is synthesized.

### 5. `restore` guards against wiping a hosted section

Not in the issue, added because `restore` is the one destructive verb the CLI
offers and this opens a new way for it to destroy something. Covered in § 4.

## Design

### 1. The seam — `loadCurrentQualitySection`

New, in `packages/schema/src/cli/kritik-audit.ts`, beside `loadQualitySection`:

```ts
export function loadCurrentQualitySection(
  root: string,
  library: KritikLibrary,
): QualitySection | undefined
```

It lives in `@arkaik/schema` rather than in the CLI for the reason
`loadQualitySection` does: "what is this project's current quality state" is
schema-level knowledge, and a future `kritik_*` tool that wants it must not grow
a second answer. This is the read-projection analogue of doctrine 8 (*three
entry points, one implementation*).

Behaviour:

1. `listAuditIds(root)` — oldest first, the existing chronological sort. Empty ⇒
   return `undefined`.
2. `loadProfile(root)` — `null` ⇒ return `undefined` (the caller explains why;
   see § 4).
3. For each audit oldest→newest, `loadScoresOrEmpty(root, id)`; upsert each
   assessment into a `Map` keyed by `` `${criterion_id}\u0000${surface}` ``.
   Later audits overwrite earlier ones.
4. For each audit, `loadFindings(root, id).findings`, concatenated in audit
   order. `stripDerived` removes `severity` and `priority` from each.
5. `framework_version` — from the newest audit's `scores.json`, falling back to
   `library.version`, matching `loadQualitySection`'s existing precedence.
6. Return `{ framework_version, library, profile, assessments, findings }`.

Assessment order is audit order then first-seen order within an audit, so the
output is deterministic for a given tree — which is what makes the byte-identical
assertions in § 5 meaningful.

`loadQualitySection` is unchanged, and so are its four callers
(`computeAuditMatrix`, `arkaik kritik matrix`, `arkaik kritik regressions`,
`kritik_regressions`). `--audit <id>` routes to it.

### 2. The CLI wrapper — `foldQualitySection`

New, in `packages/cli/src/lib/kritik-io.ts`, which already owns the two
questions "where is the pack" and "does this repo journal":

```ts
export function foldQualitySection(
  bundle: Record<string, unknown>,
  root: string,
  auditId?: string,
): { folded: boolean; notice: string }
```

It resolves the effective library via the existing `loadKritikLibrary(root)`,
calls `loadCurrentQualitySection` (or `loadQualitySection` when `auditId` is
given), sets `bundle.quality` on success, and returns the stderr line its caller
prints. It never throws: every failure is a `folded: false` with a notice that
says what to do (§ 4).

### 3. The four verbs

| verb | quality | flag |
| --- | --- | --- |
| `pack` | folded by default | `--no-quality`, `--audit <id>`, `--root <dir>` |
| `open` | folded — inherits `runPack` defaults | — |
| `push` | **stripped** by default | `--include-quality` |
| `restore` | folded into the outbound bundle | `--no-quality`, `--audit <id>`, `--root <dir>` |

`--audit <id>` routes to `loadQualitySection` — one audit's snapshot, today's
behaviour — instead of the merge. It is offered on the two verbs that fold;
`push` and `open` take `runPack`'s defaults.

`pack`'s default-on with `--no-quality` mirrors `--no-journal` exactly.
`RunPackOptions` gains `noQuality?: boolean` and `root?: string`;
`RunPackResult` gains `qualityNotice?: string`.

`push` strips by default and mirrors `--include-journal`: the flag both keeps
the section in the packed body and forwards `?include_quality=true`. That query
parameter is already honoured server-side (`app/api/publik/route.ts:85`,
`stripQuality`) and has never had a client — publishing your open findings is a
separate decision from publishing your history, and both default to no
(RFC § 8.3).

Both `pack` and `restore` gain `--root <dir>`, defaulting to `process.cwd()` —
the same flag name and the same default as every `arkaik kritik` verb
(`packages/cli/src/commands/kritik.ts:237`), rather than deriving root from the
bundle path and inventing a second rule.

### 4. Failure modes — `pack` never dies on a quality problem

Quality is additive; a problem in it must not fail a bundle assembly. Three
outcomes, all stderr, all exit 0:

- **no `docs/quality/audits/`** — `Quality: none to fold (no audits under
  <root>)`. It names the root it looked in, because the two ways to get here are
  "no audit yet" and "wrong `--root`", and the path tells them apart at a glance
  — the reasoning `newestAuditId` already uses for its own error text.
- **no `profile.json`** — `Quality: skipped — no profile at
  docs/quality/profile.json (run \`arkaik kritik profile\`)`. This is
  `requireProfile`'s refusal downgraded from throw to warn. The fold is skipped
  rather than emitted profile-less: without a profile there is no column order
  and no surface titles, and the section would trip `quality-no-surfaces`.
  Emitting nothing beats emitting something the app renders wrong.
- **success** — `Quality: folded 338 assessment(s), 258 finding(s) from 2
  audit(s)`.

### 5. The `restore` guard

`restore` replaces the hosted snapshot wholesale. A repo with no sidecars
restoring over a project that *has* a quality section silently destroys it —
a new instance of exactly the shape `--allow-history-loss` already guards.

So: after the existing `GET .../export` (which the backup doctrine already
requires, and which returns the hosted snapshot including any `quality`), if the
export carries a `quality` section and the outbound bundle does not, abort
before the `PUT` unless `--allow-quality-loss` is passed. The message names the
hosted finding count and points at `--root`, since a wrong root is the likely
cause.

This rides on the export `restore` already fetches — no extra request, no new
failure mode on the destructive path.

## Files

**New**
- `tests/cli/quality-fold.test.js`
- `tests/cli/fixtures/quality-two-audits/` — the two-audit sidecar tree (§ Testing)

**Changed**
- `packages/schema/src/cli/kritik-audit.ts` — `loadCurrentQualitySection` and `stripDerived` land in the existing audit-file layer, beside `loadQualitySection`; no new module
- `packages/cli/src/lib/kritik-io.ts` — `foldQualitySection`
- `packages/cli/src/commands/pack.ts` — `--no-quality`, `--root`, fold in `runPack`, notice in `runPackCli`
- `packages/cli/src/commands/push.ts` — `--include-quality`, `noQuality: true` default, `?include_quality=true`
- `packages/cli/src/commands/restore.ts` — `--no-quality`, `--root`, `--allow-quality-loss`, fold into the outbound bundle
- `packages/cli/src/index.ts` — usage lines
- `docs/spec/bundle-format.md`, `docs/spec/toolchain.md` — the projection and its verbs
- `docs/kritik-skill/skill.md` — "your audit reaches the app when you `pack`/`restore`"
- `docs/rfcs/kritik.md` § 4.1 — record that lane 2's writer is assembly-time

**Untouched**
- `docs/arkaik/bundle.json` and every seed bundle — nothing writes them
- `computeAuditMatrix`, `matrix.json`, `loadQualitySection` and its four callers
- `packages/schema/src/serialize.ts`, `validate.ts`, `bundle.ts` — no schema change
- every `kritik_*` MCP tool

## Testing

DB-free, in CI's fast build job — the fold is file I/O plus pure functions, so
none of it needs Postgres.

**The trap this suite exists to avoid.** With a single-audit fixture, a "merge"
implemented as plain concatenation *and* one implemented as "newest audit only"
both pass every assertion — the same class of hole as the `scales` blind spot a
phase D reviewer found by mutation-testing rather than reading. So the fixture
has **two audits with an overlapping cell**: `2026-08` scores a set,
`2026-09` re-scores a subset at different levels and adds a finding. The suite
then asserts the union count, that the *newer* level wins on the overlap, and
that a `2026-08` finding not mentioned in `2026-09` is still present. Any of the
three plausible wrong implementations fails at least one.

Its `findings.json` files deliberately **store `severity` and `priority`**, the
way the real sidecars in `docs/quality/audits/2026-08/` do. The existing
`tests/fixtures/quality/pilot-2026-08.json` cannot stand in here: it is a
`{ section, expected }` pair rather than a sidecar tree, and its findings were
already sanitized of both fields — it could not exercise the strip even if the
fold could read it.

Cases:

1. Merge: union count, newer level wins, older finding retained.
2. `--audit 2026-08` returns exactly `loadQualitySection`'s output for that
   audit — the pin is the old behaviour, unchanged.
3. `severity`/`priority` absent from every folded finding; `source_cell` and
   other unknown keys present.
4. `validateBundle` on a bundle carrying the folded two-audit section: zero new
   warnings — in particular no `quality-duplicate-assessment` from the overlap,
   no `quality-derived-field-stored`, no `quality-library-missing`.
5. `library` present, is the effective library (a fixture overlay's custom
   criterion appears in it), and carries the pack's real weights.
6. `--no-quality` produces a bundle byte-identical to today's output.
7. No `audits/` ⇒ no `quality` key, notice names the root, exit 0.
8. No `profile.json` ⇒ no `quality` key, notice names `arkaik kritik profile`,
   exit 0.
9. `push` sends no `quality` key by default; `--include-quality` sends it and
   the `?include_quality=true` parameter (mock `HttpClient`, the seam `push`
   tests already use).
10. `restore` refuses when the hosted export has `quality` and the outbound does
    not; `--allow-quality-loss` proceeds (mock `HttpClient`).

## Non-goals

- **Two-way sync.** The sidecars stay canonical; this writes one direction.
- **Writing `docs/arkaik/bundle.json`.** See decision 1.
- **A slim/trimmed library mode.** See decision 2.
- **Publik exposure by default.** RFC § 8.3 stands: `stripQuality` stays
  default-on server-side and `push` now defaults to not sending it either.
- **Any schema, validator or storage change.** Fact 6.
- **Rewriting the pilot sidecars** to drop their stored `severity`/`priority`.
  The projection handles them; the sidecars are the audit's own record.

## Risks

1. **A 482 KB library in every bundle carrying quality.** Mitigated by the
   5 MB `restore` cap being ~2.6× a Pebbles-scale bundle, and by `--no-quality`.
   If it ever bites, the 11 KB trim measured in decision 2 is the escape hatch —
   but it is not built until something needs it.
2. **The app's matrix diverging from `matrix.json`.** Deliberate (decision 3)
   and the single most likely thing to read as a bug. It is documented in the
   spec files listed above and in the skill, not only here.
3. **Two call sites drifting.** `pack` and `restore` both fold, and only a test
   keeps them agreeing. Cases 6 and 10 cover each; the shared
   `foldQualitySection` is what makes the drift small if it happens.
