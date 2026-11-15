# Weighing — First Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every acceptance a weight: a `bundle.weighing` section (criteria sets, a matrix, assessments with scorer, confidence and basis), a built-in signed −3..+3 value matrix, pure derivation of served / cost / kept share / masses / flags / guesswork, a positioning authored as a criteria set, the MCP tools `get_matrix` and `assess`, a form in the acceptance panel and a minimal positioning editor in Settings.

**Architecture:** `bundle.weighing` follows Kritik's `bundle.quality` one for one. The model, the zod shapes, the built-in library, the derivation, the event fold and the one validator-gated write planner all live in `@arkaik/schema` (zod-free wherever Kritik's are). In a repository the canonical record is sidecar files under `docs/weighing/`, folded in by `arkaik pack`; on a hosted project and in a browser project an assessment is a journal event (`weighing.assessment.recorded`) folded over the stored section on every read, exactly like `quality.assessment.scored`. Publik withholds the section by default. Nothing in the derivation is stored.

**Tech Stack:** TypeScript (`@arkaik/schema`, `arkaik` CLI, `arkaik-mcp`), zod 4, Next.js 16 / React 19 app (TanStack Query provider layer, Dexie), Postgres-backed hosted graph API, plain-Node test harnesses (`ts.transpileModule` loaders, no test framework).

**Where:** worktree `/Users/alexis/code/arkaik-weighing`. `docs/rfcs/weighing.md` and `docs/README.md` belong to the agent writing the RFC on branch `weighing/docs` — **this plan never touches those two files** (the doc edits below go to `docs/spec/*.md` and `docs/hosted-projects.md`).

**Every line of code in this plan was run, except the `on_behalf_of` additions of Parts 3 and 4 (D14), which are marked *not yet run* wherever they appear.** (Part 1's own `on_behalf_of` field, its zod line and its test were run when Part 1 was implemented, and pass.) The schema, CLI, hosted route, provider, MCP and app code below was applied to a scratch copy of the worktree and the test suites quoted here were run there: `tsc --noEmit`, `eslint` (0 errors), `test:schema`, `test:fixtures`, `test:journal`, `test:quality*`, `test:cli`, `test:mcp`, `test:provider`, `test:migrate`, `test:project-queries`, `test:panel-semantics`, `test:publik-strip`, `test:bootstrap` and `test:graph` against a scratch Postgres 16 all pass with it. Not run: `npm run build` (Turbopack refuses the scratch copy's symlinked `node_modules`, an artifact of the copy, not of the code — run it in the real worktree) and a browser pass over the two UI components (the panel form and the Settings editor are verified by `tsc`, `eslint` and the source-asserting panel suites only — see Part 5's manual check).

**Not yet run: `on_behalf_of` in Parts 3 and 4.** The owner's decision to record whom a scorer acts for (D14) was folded into this plan after the run above, in a worktree with no `node_modules`, so none of the suites could be executed against it. Every added line is marked *not yet run*. They are small and follow the code beside them, but the first implementer must run `test:weighing`, `test:weighing-events`, `test:graph` and `test:mcp` and treat a red check there as the plan's bug, not theirs.

---

## 0. Read this first

### The design that wins

The owner's decisions are in `scratchpad/ac/arch/DISCUSSION.md`; `ARCHITECTURE.md` §§ 2, 3, 6, 8, 9 is the v1 draft. **Where they disagree, DISCUSSION wins**, and the two places that matters for slice 1 are baked in below: the scale is signed **−3..+3** (served and cost summed separately, never netted; negatives never seeded), and there are **no human-only actions** (an agent may draft and even activate a positioning; provenance is on every record; a human's level wins; a draft feeds no roll-up).

Slice 1 = no new species, no nesting, no opportunities, no caps. `schema_version` stays 3 because the section is additive.

### Decisions this plan makes (each one is a place the draft was silent or wrong about the code)

| # | Decision | Why |
|---|---|---|
| D1 | **Positioning is a `WeighingCriteriaSet`** with `role: "positioning"`, `status?: "draft" \| "active"` (absent = active) and `extends: "value-contribution@1"`. Each criterion is `{ id, weight?, anchors? }`. The `WeighingMatrix` carries only a pointer, `positioning: "positioning"`. `Matrix.weights` from ARCHITECTURE § 3 is **dropped**. | DISCUSSION § "Positioning is a criteria set". A draft must feed no roll-up, so the status has to live on the thing being drafted — the set — not on the matrix. |
| D2 | **Storage, three homes.** Repo: `docs/weighing/sets/<set-id>.json` + `docs/weighing/assessments/<matrix-id>.json` (`{ matrix, assessments[] }`), folded by `arkaik pack` and `arkaik restore`, never written into `bundle.json`. Hosted and browser: two events, `weighing.assessment.recorded` (an assessment minus its `ts`, flat) and `weighing.set.saved` (`{ set }`, latest wins by id), folded on read. **No DB migration**: `graph_events.event` is already free-form JSON and Kritik's `quality.assessment.scored` needed none. | Kritik precedent (`docs/spec/bundle-format.md` § Quality, `lib/services/graph/store.ts`, `packages/cli/src/lib/kritik-io.ts`). |
| D3 | **One stored row per cell per scorer kind.** `(matrix, subject, criterion, scorer.kind)` is the key; a human row and an agent row sit side by side; a `rule` row is never stored (seeds are computed). | DISCUSSION: "human beats agent beats rule; latest wins within a kind". |
| D4 | **The writer stamps the scorer; the caller never sends it.** The hosted route stamps `human` for a session and `agent` for a token; the browser provider stamps `human`; the MCP server stamps `agent`. A token write also stamps `scorer.on_behalf_of`, the token owner's user id (D14). A body carrying `scorer`, `basis` or `ts` is a 400. The server also stamps the set's full version and the subject's **fingerprint** (title + Gherkin + values, whitespace-normalised, never status). | A human's level wins every cell, so a token must not be able to claim to be a human; and staleness must be measured from what the server saw. |
| D5 | **The fold, the planner and the derivation live in `@arkaik/schema`**, not `lib/`. | The MCP server cannot import `lib/`, and every new `@/…` import in a tested app file silently breaks one of the hand-maintained alias tables (§ 1.4). Nothing in this plan adds a new `@/…` specifier to a module a DB-free loader compiles. |
| D6 | **Kept share uses `resolvePlatformStatus`** (`packages/schema/src/acceptance.ts`), pinned by a parity test to `getNodePlatformStatuses` in `lib/utils/platform-status.ts`. | The brief says use `getNodePlatformStatuses`; the MCP server cannot import it. Both read `metadata.platformStatuses[p] ?? node.status`; the test fails if they ever diverge. |
| D7 | **Archived promises are weighed but counted in no mass.** `kept_share` is `null` (not 0) when a promise applies to no platform, and contributes 0 to kept mass. **Owner: yes (decided).** | "Subjects = every acceptance" would otherwise count a dead promise in the totals. |
| D8 | **Flag definitions.** `claim_not_supported`: claimed, and the *stored* winner is ≤ 1. `unclaimed_value`: not claimed, stored winner ≥ 1. `unclaimed_cost`: **any** stored negative — a claim in `metadata.values` is positive intent, so a cost is never claimed. A seeded cell never raises a flag. A stored `0` suppresses a seed and flags the claim. | ARCHITECTURE § 3 table + DISCUSSION § signed scale. |
| D9 | **The positioning editor lives in Settings** (`components/settings/PositioningPanel.tsx`), not on the Pyramid. | Settings is where this app keeps everything that *configures* a project (Products live there for the same reason); a positioning is a statement of intent, not a reading; the Pyramid is a derived page and the next design pass (tweaker) will reshape it, and an editor should not move with it. |
| D10 | **`JOURNAL_EVENT_TYPES` stays at 22** (`tests/schema/journal.test.js` asserts the count). The new events join `JOURNAL_EVENT_SCHEMAS` / `KnownJournalEventSchema` only — exactly what `quality.assessment.scored` did. | Kritik precedent. |
| D11 | **A third MCP tool, `save_positioning`.** The brief names two. Without it an agent on a *hosted* project has no way to draft a positioning (in a repo it could edit a file). It is the last task of Part 4 and self-contained — **Owner: keep (decided).** Agents may draft and activate a positioning; a human can revert it (see R17 for what the journal records of a save). | DISCUSSION: "an agent drafts it from the landing page". |
| D12 | **`ValuePicker` keeps the author's pick order** (last task of Part 5). Today it re-sorts `metadata.values` into the model's canonical order on every change, so for any acceptance edited in the app the seeding rule "first value = +3" would read the *tier order*, not the author's intent. See Risk R1. | The seeding rule reads order; the only editor destroys it. **Owner: keep (decided).** |
| D13 | **Publik:** `stripWeighing` + `?include_weighing=true`; CLI `arkaik push --include-weighing` (default: deleted before packing); `arkaik pack --no-weighing` deletes the section. A separate opt-in, as quality is separate from the journal. | Kritik precedent, one for one. |
| D14 | **`WeighingScorer.on_behalf_of?: string`: whom a scorer acts for.** Optional. Stamped by the writer **where identity is known**: a hosted token write stamps the token owner's user id (`String(caller.userId)`); a session, the browser provider and a repo-mode MCP session stamp nothing unless told (`ARKAIK_ON_BEHALF_OF`). An opaque user id or handle, **never an email**, because sidecars are committed to repos: the planner refuses an email-shaped value. A caller cannot send it, because it sits inside `scorer`, which the parser already refuses. Part 1 carries the field, Part 3 the stamping and the guard, Part 4 the MCP source. | The owner: recording who a scorer acts for is "very important". `scorer.id` says what acted (`arkaik-agent`), not for whom, so a person driving an agent was indistinguishable from any other. **Supersedes the coarse-label half of R11.** |
| D15 | **Import never blocks: only the containers are strict.** `weighing` must be an object and each of `sets` / `matrices` / `assessments` an array; everything inside parses, whatever it holds. A list item may be anything (a `null` row), every leaf is `z.unknown()` (a string `level`, a confidence of 4, a scorer that is a string, a numeric `evidence`, a mistyped `role` or `status`), and even the keys a record is addressed by (`matrix`/`subject`/`criterion`/`ts`; a set's `id`/`version`; a matrix's `id`/`set`/`subjects`) are optional. "Cannot be addressed" means a reader skips the row and the validator warns — never that the import is refused. Readers go through `resolveWeighing` (well-formed sets and matrices; unusable criteria dropped) and `readWeighingAssessments`, and the record types describe a well-formed record except `scorer` (optional), a positioning's `scale` (optional: it uses its ruler's, `weighingScaleOf`), the section's lists (optional) and `status` (a string). **Status is read one way: absent or `"active"` is active, any other present value is a draft** (`isActiveWeighingSet`), so a mistyped draft never feeds a roll-up. "The first wins" counts only well-formed duplicates. | The RFC: validation is warnings only, never import-blocking. A section is filled at scale by agents and scorers, so one bad cell must not refuse a whole project. The departure from `QualitySectionSchema` is deliberate. Writers (the planner, the event parser) stay strict about what they will WRITE. |

### Not in slice 1 (so nothing below builds it)

Opportunities, nesting, caps, project-defined matrices or criteria sets other than the positioning, `matrix_scope` / `matrix_plan`, sorting a page (Acceptances, Pyramid) by served/cost — **slice 1 ships the numbers in the panel and in `get_matrix`; no page sorts by them yet** (owner confirmed: served and cost appear only in the panel and in MCP in slice 1; page sorting comes with the Acceptances redesign) — and any visual design (the tweaker explores it afterwards).

---

## 1. The stack

One part = one branch = one PR, chained with `gh stack` (`docs/conventions.md` § "Shipping larger work", skill `gh-stack`). The cut below is the one the brief guessed with **one deviation**: the brief's "schema and storage" is split in two, because the pure model (types, shapes, library, validator) is a different review from the three storage homes (journal events and the planner, repo sidecars + `pack`/`restore`/`push`, the hosted route + ETag, the browser/remote providers). Dependency order, lowest first: shared types → domain model → persistence → API → UI.

| # | Branch | Part | Depends on | User-facing | Lab Note |
|---|---|---|---|---|---|
| 0 | `weighing/docs` | The RFC (`docs/rfcs/weighing.md`) — **another agent, not this plan** | — | no | no |
| 1 | `weighing/1-schema` | Records, zod shapes, built-in `value-contribution` set and `value` matrix, fingerprint, validator warnings, Publik withhold, generated artifacts, `docs/spec/bundle-format.md` | 0 | no | no |
| 2 | `weighing/2-derive` | Pure derivation: seeding, effective level, served/cost, positioned, kept share, element masses, claim flags, guesswork | 1 | no | no |
| 3 | `weighing/3-storage` | Events + fold + the one write planner; repo sidecars, `pack`/`restore`/`push` flags; hosted route, ETag and GET fold; browser/remote providers; CLI 0.12.0 | 1 | no | no |
| 4 | `weighing/4-mcp` | `get_matrix`, `assess`, `save_positioning`; MCP 0.11.0 | 1, 2, 3 | no (agent plane) | no |
| 5 | `weighing/5-panel` | `useWeighing`, the acceptance-panel form, the Settings positioning editor, History wording, `ValuePicker` order | 1, 2, 3 | **yes** | **yes** |

**Why part 5 carries the note and 4 does not.** CLAUDE.md: a Lab Note goes in the PR that ships something *a user would notice*. The first thing a person sees is the panel form; 1–4 are infrastructure and an agent-plane tool catalog, and a note on each would be five announcements of one feature. The stack merges as a unit, so part 5's merge is the moment the feature is whole. If the reminder comments on parts 1–4, add the `no-lab-note` label.

**Each part is green on its own** — it passes lint, `tsc` and every suite that exists at that layer without the parts above it (the "Gate" in § 1.3). Parts 2 and 3 are independent of each other (both need only part 1); they are ordered 2 then 3 only because the brief's order and the dependency rule agree.

### 1.1 Stack commands

```bash
cd /Users/alexis/code/arkaik-weighing
git config rerere.enabled true
npm ci                                   # the worktree has no node_modules
# Part 0 (the RFC) is on weighing/docs. Stack on top of it; re-base onto main once it merges.
gh stack init --base weighing/docs weighing/1-schema
# … Part 1 tasks …
gh stack add weighing/2-derive
# … Part 2 tasks …
gh stack add weighing/3-storage
gh stack add weighing/4-mcp
gh stack add weighing/5-panel
# A lower part needs a fix: gh stack down, commit there, gh stack rebase --upstack, gh stack top.
gh stack submit --auto                   # drafts; --open when the whole stack is green
```

`gh stack` needs `git config remote.pushDefault origin` if more than one remote is configured, and never run `gh stack view` without `--json`.

After opening, **read every PR's comments** (CLAUDE.md): the Lab Note reminder clears its own comment once the body is fixed. Part 5's body must carry the note in § Part 5 Task 5.7.

### 1.2 File map

**Part 1 — `weighing/1-schema`**

| Action | Path | Responsibility |
|---|---|---|
| Create | `packages/schema/src/weighing.ts` | Types (`WeighingAssessment`, `WeighingCriteriaSet`, `WeighingMatrix`, `WeighingScorer`, `WeighingSection`), scales, confidence anchors, keys, `acceptanceFingerprint`, `upsertWeighingAssessment`, event-type constants. Zod-free. |
| Create | `packages/schema/src/weighing-library.ts` | The built-in `value-contribution` set (30 elements, 4 tiers, −3..+3 anchors), the `value` matrix, `resolveWeighing`, `setOfRef`. Zod-free. |
| Create | `packages/schema/src/weighing-schemas.ts` | Zod shapes, all `.catchall(z.unknown())`. |
| Create | `packages/schema/src/weighing-validate.ts` | Warning-only validator rules; zod-free so `validate.ts` stays bundleable. |
| Modify | `packages/schema/src/bundle.ts` | `weighing?:` on `ProjectBundle` and its zod schema. |
| Modify | `packages/schema/src/validate.ts` | One call into `validateWeighingSection`. |
| Modify | `packages/schema/src/index.ts` | Re-exports. |
| Modify | `lib/services/publik.ts`, `app/api/publik/route.ts` | `stripWeighing`, `?include_weighing=true`. |
| Create / modify | `tests/schema/weighing.test.js`, `tests/services/publik-strip.test.js`, `tests/app/value-icons.test.js` | The model, the withhold, the label-parity pin. |
| Modify | `package.json`, `.github/workflows/ci.yml` | `test:weighing` + CI step. |
| Regenerate | `public/schema/project-bundle.json`, `docs/arkaik-skill/scripts/validate-bundle.js`, `plugin/skills/arkaik/scripts/validate-bundle.js` | `npm run generate` (CI diffs them). |
| Modify | `docs/spec/bundle-format.md` | New § Weighing. |

**Part 2 — `weighing/2-derive`**: create `packages/schema/src/weighing-derive.ts`, `tests/schema/weighing-derive.test.js`; modify `packages/schema/src/index.ts`, `package.json`, `ci.yml`.

**Part 3 — `weighing/3-storage`**

| Action | Path | Responsibility |
|---|---|---|
| Create | `packages/schema/src/weighing-events.ts` | `parseWeighingEventInputs`, `planWeighingEvents` (the one gate), `foldWeighingEvents`. |
| Modify | `packages/schema/src/journal-events.ts`, `index.ts` | Strict event schemas; export. |
| Create | `packages/schema/src/cli/weighing-files.ts` | Sidecar paths, load/save, `loadWeighingSection`. Not loaded by `load-schema.js` (which reads `src/*.ts` only) — exercised through the built CLI. |
| Create | `packages/cli/src/lib/weighing-io.ts` | `foldWeighingSection`. |
| Modify | `packages/cli/src/io.ts`, `commands/pack.ts`, `commands/push.ts`, `commands/restore.ts` | `--no-weighing`, `--include-weighing`; fold on pack and restore. |
| Modify | `lib/services/graph/store.ts` | `BUNDLE_FOLD_TYPES`, `weighingFoldEvents`; the ETag count reads the union. |
| Modify | `app/api/graph/projects/[projectId]/route.ts` | GET folds weighing events. |
| Create | `app/api/graph/projects/[projectId]/weighing/events/route.ts` | `POST`, `graph:write`, all-or-nothing, scorer stamped from the caller. |
| Modify | `lib/data/data-provider.ts`, `local-provider.ts`, `remote-provider.ts`, `routing-provider.ts` | `appendWeighingEvents`; local fold on read. |
| Create / modify | `tests/schema/weighing-events.test.js`, `tests/cli/weighing.test.js`, `tests/data/weighing-provider.test.js`, `tests/services/graph-api.test.js`, `tests/services/load-graph-api.js` | |
| Modify | `package.json`, `ci.yml`, `.gitignore`, `packages/cli/package.json` (0.12.0), `docs/spec/{journal,services,toolchain}.md`, `docs/hosted-projects.md` | |

**Part 4 — `weighing/4-mcp`**: create `packages/mcp/src/weighing-tools.ts`, `tests/mcp/weighing-tools.test.js`; modify `packages/mcp/src/{store,remote-store,tools}.ts`, `tests/mcp/run-mcp-tests.js`, `package.json`, `packages/mcp/package.json` (0.11.0), `docs/spec/mcp.md`, `docs/hosted-projects.md`.

**Part 5 — `weighing/5-panel`**: create `lib/hooks/useWeighing.ts`, `components/panels/WeighingGroup.tsx`, `components/settings/PositioningPanel.tsx`; modify `components/panels/NodeDetailPanel.tsx`, `app/project/[id]/settings/page.tsx`, `components/journal/describe-event.ts`, `components/values/ValuePicker.tsx`.

### 1.3 Commands and the gate

Real commands (from `package.json` and `.github/workflows/ci.yml`; CI runs Node 20, local is Node 26 — every loader here transpiles with `ts.transpileModule`, none `require`s a `.ts`, so the gap does not bite):

```bash
npm run generate                 # then: git diff --exit-code -- public/schema/project-bundle.json docs/arkaik-skill/scripts/validate-bundle.js docs/arkaik-skill/references/schema.md lib/prompts/generated plugin/.claude-plugin/plugin.json plugin/.mcp.json plugin/skills/arkaik plugin-kritik lib/landing/generated
npm run lint                     # eslint; CI also runs actionlint over .github/workflows
npx tsc --noEmit -p .
npm run build                    # next build — a CI gate
npm run validate:seeds           # NOT the whole seed gate — test:schema (zod parseBundle, stricter) and test:fixtures are too
npm run test:fixtures && npm run test:schema
npm run test:weighing …          # the suites each part adds
npm run test:cli                 # builds arkaik first
npm run test:mcp                 # builds arkaik and arkaik-mcp first
npm run test:graph               # needs Postgres — see below
```

**The gate for every part** is: `npm run generate` leaves no diff beyond what the part's own task regenerated and committed, `npm run lint`, `npx tsc --noEmit -p .`, `npm run build`, `npm run validate:seeds`, `npm run test:fixtures`, `npm run test:schema`, `npm run test:journal`, `npm run test:quality`, and the part's own suites. Parts 3 and 4 add `test:cli` / `test:mcp` / `test:publik-strip`; part 3 adds `test:graph`.

**A scratch Postgres** (the project's own memory notes: local Postgres is available). The Unix-socket path under a long scratchpad directory is too long for Postgres (103-byte limit), so disable Unix sockets and use TCP:

```bash
PGD="$(mktemp -d)/pgdata"
initdb -D "$PGD" -U arkaik --auth=trust >/dev/null
pg_ctl -D "$PGD" -o "-p 5544 -c unix_socket_directories=''" -l "$PGD/../pg.log" start
sleep 2
createdb -h 127.0.0.1 -p 5544 -U arkaik arkaik_test
export DATABASE_URL=postgres://arkaik@127.0.0.1:5544/arkaik_test
npm run db:migrate               # expected: "done — applied 13 migration(s)."
```

### 1.4 Harness traps this plan walks around (so you do not step in them)

1. **Alias tables.** `tests/services/load-*.js`, `tests/data/load-*.js`, `tests/app/load-*.js` each carry a hand-maintained `@/…` → compiled-copy table; a new `@/…` import in a module any of them compiles resolves under Next and dies in the loader with `Cannot find module '@/…'` *before the first check prints*. Fixing one table does not fix the others. **Every new module in this plan keeps its imports to `@arkaik/schema` and relative paths**; the one new route (`…/weighing/events/route.ts`) imports only specifiers already in `load-graph-api.js`'s `COMMON` table (`@/lib/services/auth`, `/db`, `/graph/store`) and is added to its `routes` map. After Part 3, run `npm run test:graph`, `test:provider`, `test:quality-fold`, `test:project-queries`, `test:publik-strip` and `test:github` (Postgres) — not just the suite for the module you touched.
2. **Schema modules are auto-discovered** by `tests/schema/load-schema.js` and `scripts/generate/load-schema-package.js` (every `src/*.ts`), so a new file needs no table edit — but **`packages/schema/src/cli/*` is not discovered**; test it through the built CLI.
3. **Generated artifacts.** Part 1 changes `public/schema/project-bundle.json` (new `.meta({ id })` schemas) and the two `validate-bundle.js` copies (new rules in `validate.ts`). CI runs `npm run generate` and `git diff --exit-code`. Regenerate in the commit that causes it.
4. **Source-asserting suites** (`test:panel-semantics`, `test:product-scope`, `test:platform-variants-gates`, `test:project-panels`) read panel *source*. `WeighingGroup` uses only `PanelGroup` + `PanelSection` for headings (no bare `h3`/`h4`) and the new group is mounted beside the existing ones, not wrapped around them.
5. **New `.test-build-*` directories** need a `.gitignore` line (Part 3 adds `/packages/cli/.test-build-weighing/`).
6. **Every new CI step is a separate `package.json` script *and* a `ci.yml` step**; `actionlint` and `shellcheck` run on `ci.yml`.
7. **`JOURNAL_EVENT_TYPES.length === 22`** is asserted; do not add the weighing types to it (D10).
8. **Never `require` a `.ts` file in a test.** Use a loader or `ts.transpileModule`.

Every commit in this plan ends with the session's usual attribution trailer; it is omitted from the command lines for brevity.

---

## Part 1 — `weighing/1-schema`

**Goal.** The `bundle.weighing` section exists as a type, a zod shape, a validated and a withheld thing — and the built-in `value-contribution` set and `value` matrix exist as library content. Nothing writes it yet (Part 3), nothing derives from it yet (Part 2).

**Must not touch:** `packages/cli`, `packages/mcp`, `lib/data`, `components/`, `app/` (except the Publik route), any journal event type.

**Reference precedent (read before starting):** `packages/schema/src/quality.ts` (types + pure helpers, zod-free), `quality-schemas.ts` (zod, `.catchall`), `validate.ts` lines ~934–1125 (warnings-only Kritik block), `docs/spec/bundle-format.md` § Quality.

### Task 1.1: Types, scales, keys, fingerprint, and the built-in library

**Files:**
- Create: `packages/schema/src/weighing.ts`
- Create: `packages/schema/src/weighing-library.ts`
- Modify: `packages/schema/src/index.ts`
- Create: `tests/schema/weighing.test.js` (grows over tasks 1.1–1.3)

- [x] **Step 1: Write the failing test (library, keys, fingerprint)**

Create `tests/schema/weighing.test.js` — the preamble, the first three sections and the epilogue. Later tasks append the "zod shapes" and "validator" sections **above** the final `fs.rmSync(…)` line.

```js
/**
 * The weighing section's model (docs/rfcs/weighing.md): the built-in value
 * library, the fingerprint staleness reads, the zod shapes, and the validator's
 * warnings. Pure and DB-free — runs in CI's fast `build` job.
 *
 * Run: npm run test:weighing
 */

const fs = require("fs");
const { loadSchema, BUILD_DIR } = require("./load-schema");

const {
  VALUE_IDS,
  VALUE_TIERS,
  VALUE_CONTRIBUTION_SET,
  VALUE_MATRIX,
  VALUE_SET_VERSION,
  POSITIONING_SET_ID,
  resolveWeighing,
  setOfRef,
  isActiveWeighingSet,
  isWeighingAssessmentShape,
  isWeighingMatrixShape,
  isWeighingSetShape,
  readWeighingAssessments,
  weighingScaleOf,
  splitSetRef,
  majorOf,
  acceptanceFingerprint,
  cellKey,
  assessmentKey,
  scorerRank,
  upsertWeighingAssessment,
  sortWeighingAssessments,
  WeighingSectionSchema,
  WeighingAssessmentSchema,
  WeighingCriteriaSetSchema,
  ProjectBundleSchema,
  validateBundle,
} = loadSchema();

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`PASS: ${name}`);
  else {
    failures++;
    console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// --- The built-in library ---------------------------------------------------

const set = VALUE_CONTRIBUTION_SET;
check("the value set has the 30 elements, in VALUE_IDS order", eq(set.criteria.map((c) => c.id), [...VALUE_IDS]));
check("every element sits in its tier", set.criteria.every((c) => c.group === VALUE_TIERS[c.id]));
check("the four tiers are the set's groups", eq(set.groups.map((g) => g.id), ["functional", "emotional", "life-changing", "social-impact"]));
check(
  "the tiers hold 14, 10, 5 and 1 elements",
  eq(
    set.groups.map((g) => set.criteria.filter((c) => c.group === g.id).length),
    [14, 10, 5, 1],
  ),
);
check("the scale is signed −3..+3", set.scale.min === -3 && set.scale.max === 3);
check(
  "every level from −3 to +3 has an anchor",
  [-3, -2, -1, 0, 1, 2, 3].every((level) => typeof set.scale.anchors[String(level)] === "string" && set.scale.anchors[String(level)] !== ""),
);
check("every element has a name and a definition", set.criteria.every((c) => c.name && c.definition));
check("level 0 means weighed and unrelated, and says a missing row is unweighed", /weighed and found to have nothing to do with it/.test(set.scale.anchors["0"]) && /No row means nobody has weighed it yet/.test(set.scale.anchors["0"]));
check("the built-ins are deep-frozen — nobody can mutate the shared library", Object.isFrozen(set) && Object.isFrozen(set.criteria) && Object.isFrozen(set.criteria[0]) && Object.isFrozen(set.scale.anchors) && Object.isFrozen(VALUE_MATRIX) && Object.isFrozen(VALUE_MATRIX.subjects));
check("the set is pinned at 1.0.0", set.version === VALUE_SET_VERSION && VALUE_SET_VERSION === "1.0.0");
check("the built-in matrix judges every acceptance against value-contribution@1", VALUE_MATRIX.id === "value" && VALUE_MATRIX.set === "value-contribution@1" && VALUE_MATRIX.subjects.kind === "query" && VALUE_MATRIX.subjects.species === "acceptance");
check("the built-in matrix names the positioning set", VALUE_MATRIX.positioning === POSITIONING_SET_ID);

const resolved = resolveWeighing(undefined);
check("an absent section resolves to the built-ins alone", resolved.sets.length === 1 && resolved.matrices.length === 1);
check("a ref resolves to its set", setOfRef(resolved, "value-contribution@1")?.id === "value-contribution");
check("an unknown ref resolves to nothing", setOfRef(resolved, "nope@1") === undefined);
check("a ref at another major resolves to nothing — levels are comparable only within a major", setOfRef(resolved, "value-contribution@2") === undefined && setOfRef(resolved, "value-contribution@1")?.id === "value-contribution");
check("a ref with no major names the set at whatever major it is", setOfRef(resolved, "value-contribution")?.id === "value-contribution");
const withOwn = resolveWeighing({
  sets: [{ ...set, version: "9.0.0" }, { id: "positioning", version: "1.0.0", subject: "acceptance", scale: set.scale, criteria: [] }],
  matrices: [],
});
check("a project cannot redefine a pinned set", withOwn.sets.find((s) => s.id === "value-contribution").version === "1.0.0");
check("the project's own sets are layered on", withOwn.sets.some((s) => s.id === "positioning"));
const matrixOf = (...extra) => resolveWeighing({ sets: [], matrices: extra }).matrices.map((m) => m.id);
check("a matrix with only an id is skipped, not thrown on", eq(matrixOf({ id: "m" }), ["value"]));
check("a matrix with no subjects is skipped", eq(matrixOf({ id: "m", set: "value-contribution@1" }), ["value"]));
check("a well-formed matrix is layered on", eq(matrixOf({ id: "m", set: "value-contribution@1", subjects: { kind: "query", species: "acceptance" } }), ["value", "m"]));
check("a set with no criteria or no scale is skipped", resolveWeighing({ sets: [{ id: "s" }, { id: "t", scale: set.scale }, { id: "u", criteria: [] }], matrices: [] }).sets.length === 1);
check("a later well-formed duplicate beats an earlier malformed one", resolveWeighing({ sets: [{ id: "s" }, { id: "s", version: "1.0.0", scale: set.scale, criteria: [] }], matrices: [] }).sets.some((s) => s.id === "s"));
check(
  "a garbage section never throws, from the resolver or the validator",
  [
    { sets: [null, 5, "x", [], {}, { id: 3 }], matrices: [null, [], "m", { id: "m" }, { id: "m", set: 4, subjects: 5 }], assessments: [null, 7, "a", [], {}, { scorer: null, level: "2", confidence: {} }, { matrix: 1, subject: 2, criterion: 3, scorer: 4 }] },
    { sets: "x", matrices: null, assessments: {} },
    { sets: [{ id: "positioning", role: "positioning", criteria: [null, 3, { id: null }], scale: null }] },
    "not an object",
    [],
    null,
  ].every((garbage) => {
    try {
      resolveWeighing(garbage);
      validateBundle({ schema_version: 3, project: { id: "p", title: "P", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" }, nodes: [], edges: [], weighing: garbage });
      sortWeighingAssessments(Array.isArray(garbage?.assessments) ? garbage.assessments.filter((a) => typeof a === "object" && a !== null) : []);
      return true;
    } catch (error) {
      console.log(`  threw on ${JSON.stringify(garbage)}: ${error.message}`);
      return false;
    }
  }),
);
check("splitSetRef reads id and major", eq(splitSetRef("value-contribution@1"), { id: "value-contribution", major: "1" }) && splitSetRef("x").major === undefined);
check("majorOf reads a semver major", majorOf("1.4.2") === "1" && majorOf("2") === "2" && majorOf("beta") === undefined);

// --- Keys and ordering ------------------------------------------------------

const human = { kind: "human", id: "alexis" };
const agent = { kind: "agent", id: "arkaik-mcp" };
check("a human outranks an agent outranks a rule", scorerRank("human") > scorerRank("agent") && scorerRank("agent") > scorerRank("rule"));
check("an unknown scorer kind ranks below a rule, and so does no kind at all", scorerRank("robot") === 0 && scorerRank("robot") < scorerRank("rule") && scorerRank(undefined) === 0);
check("a row with no scorer still has a key and a place in a sorted sidecar", typeof assessmentKey({ matrix: "value", subject: "AC-a", criterion: "connects" }) === "string" && sortWeighingAssessments([{ matrix: "value", subject: "AC-a", criterion: "connects" }, { matrix: "value", subject: "AC-a", criterion: "connects", scorer: { kind: "human", id: "a" } }])[0].scorer?.kind === "human");
check("a cell key is stable", cellKey("value", "AC-a", "connects") === cellKey("value", "AC-a", "connects"));
check(
  "a human and an agent have different assessment keys for one cell",
  assessmentKey({ matrix: "value", subject: "AC-a", criterion: "connects", scorer: human }) !==
    assessmentKey({ matrix: "value", subject: "AC-a", criterion: "connects", scorer: agent }),
);

const row = (over = {}) => ({ matrix: "value", subject: "AC-a", criterion: "connects", level: 2, scorer: human, confidence: 2, evidence: "the title says so", ts: "2026-11-15T10:00:00.000Z", ...over });
const first = upsertWeighingAssessment([], row());
check("upsert appends a new cell", first.assessments.length === 1 && first.replaced === undefined);
const second = upsertWeighingAssessment(first.assessments, row({ level: 3, ts: "2026-11-15T11:00:00.000Z" }));
check("upsert replaces the same cell and scorer kind in place", second.assessments.length === 1 && second.assessments[0].level === 3 && second.replaced.level === 2);
const third = upsertWeighingAssessment(second.assessments, row({ scorer: agent, level: -1 }));
check("an agent's row sits beside the human's, not over it", third.assessments.length === 2);
check("upsert does not mutate its input", first.assessments.length === 1 && first.assessments[0].level === 2);
const sorted = sortWeighingAssessments([row({ subject: "AC-b" }), row({ scorer: agent }), row()]);
check("a sidecar sorts by subject, then authority", sorted[0].subject === "AC-a" && sorted[0].scorer.kind === "human" && sorted[1].scorer.kind === "agent" && sorted[2].subject === "AC-b");

// --- The fingerprint --------------------------------------------------------

const ac = (over = {}) => ({
  id: "AC-a",
  title: "Accept an invite",
  status: "development",
  platforms: ["web"],
  metadata: { gherkin: "Given a link\nWhen I tap it\nThen we connect", values: ["connects", "reduces-anxiety"] },
  ...over,
});
const fp = acceptanceFingerprint(ac());
check("a fingerprint is a short stable string", /^fp1-[0-9a-f]{14}$/.test(fp) && fp === acceptanceFingerprint(ac()));
check("the status is NOT in the fingerprint", fp === acceptanceFingerprint(ac({ status: "live", platforms: ["web", "ios"] })));
check("the title is", fp !== acceptanceFingerprint(ac({ title: "Accept an invitation" })));
check("the Gherkin is", fp !== acceptanceFingerprint(ac({ metadata: { ...ac().metadata, gherkin: "Given a link\nWhen I tap it\nThen we are friends" } })));
check("the values are, and their order is", fp !== acceptanceFingerprint(ac({ metadata: { ...ac().metadata, values: ["reduces-anxiety", "connects"] } })));
check("whitespace is not", fp === acceptanceFingerprint(ac({ title: "  Accept   an invite ", metadata: { ...ac().metadata, gherkin: "Given a link When I tap it Then we connect" } })));
check("a node with no metadata still fingerprints", /^fp1-/.test(acceptanceFingerprint({ title: "x" })));

fs.rmSync(BUILD_DIR, { recursive: true, force: true });
if (failures > 0) {
  console.log(`\n${failures} weighing test(s) failed.`);
  process.exit(1);
}
console.log("\nAll weighing tests passed.");
```

- [x] **Step 2: Run it to verify it fails**

Run: `node tests/schema/weighing.test.js`
Expected: FAIL — a `TypeError: Cannot read properties of undefined (reading 'criteria')` (the loader returns `undefined` for every name the schema does not export yet).

- [x] **Step 3: Write `packages/schema/src/weighing.ts`**

This is the whole model file. (It already carries the two event-type constants — the validator in Task 1.3 reads them, and Part 3's fold needs them.)

```ts
/**
 * Weighing — the layer that gives a promise a weight (docs/rfcs/weighing.md).
 *
 * Counting says how many promises claim a value; weighing says how much each
 * one carries, according to whom, and how sure. A project pins a versioned
 * **criteria set** (the 30 elements of value are the first), declares a
 * **matrix** (which subjects are judged against which set) and records
 * **assessments** — one signed level per (subject × criterion), with who judged
 * (`scorer`), how sure (`confidence`) and what the judge was looking at
 * (`basis`). Everything downstream — served, cost, kept share, element masses,
 * the claim-versus-assessment flags — is derived in {@link ./weighing-derive}
 * and never stored, exactly as Kritik's severity and grades are.
 *
 * This is Kritik's section shape one for one (`bundle.weighing` beside
 * `bundle.quality`, {@link ./quality}), with three differences that are the
 * point of it: the scale is signed (−3..+3, so a promise can cost a value as
 * well as serve it), every cell carries its scorer and confidence, and a
 * staleness check reads a fingerprint of the subject rather than a commit.
 *
 * Same doctrine as {@link ./quality}: pure functions, immutable, deliberately
 * **zod-free** (type-only imports plus plain constants) so the module stays
 * browser-safe and adds nothing to the standalone validator bundle. The zod
 * shapes live next door in {@link ./weighing-schemas}.
 *
 * Everything here is lenient and total. A set that left the section, a level
 * outside the scale, a stray scorer — none of them throw; they degrade to a
 * blank cell and a `validateBundle()` warning, because a hand-edited weighing
 * section must never fail an import or a CI gate. That includes the zod
 * shapes: they are looser than Kritik's on purpose (a section is filled at
 * scale by agents and scorers, so one bad cell must not block importing the
 * project), and the validator owns every judgement about a value.
 *
 * **Types and storage.** The record types below describe a record that has
 * passed its shape guard (`isWeighingSetShape`, `isWeighingMatrixShape`,
 * `isWeighingAssessmentShape`), plus the few things a stored record may
 * legitimately lack: an assessment's `scorer`, a positioning's `scale`. What
 * comes out of storage is not that — the zod shapes accept any value in any
 * leaf — so a reader goes through `resolveWeighing` (sets and matrices) and
 * `readWeighingAssessments` (rows), which hand back only records that pass
 * their guard. Only the containers are strict: the section is an object and
 * each of its lists is an array.
 */

import type { Node } from "./bundle";

// --- Scales ------------------------------------------------------------------

/** The signed value scale: −3 costs it at its core … +3 is core. 0 is "unrelated". */
export type WeighingLevel = -3 | -2 | -1 | 0 | 1 | 2 | 3;

export const WEIGHING_LEVELS: readonly WeighingLevel[] = [-3, -2, -1, 0, 1, 2, 3];

export const WEIGHING_MIN_LEVEL = -3;
export const WEIGHING_MAX_LEVEL = 3;

/** How sure the scorer is. 0 is a guess; a seeding rule always scores 0. */
export type WeighingConfidence = 0 | 1 | 2 | 3;

export const CONFIDENCE_LEVELS: readonly WeighingConfidence[] = [0, 1, 2, 3];

/** What each confidence level means, in words — the anchors a form and a prompt both show. */
export const CONFIDENCE_ANCHORS: Readonly<Record<WeighingConfidence, string>> = {
  0: "Guess. Nothing behind it.",
  1: "Inferred from the subject's own text.",
  2: "Evidenced: cites something outside the subject.",
  3: "Verified: reviewed by a human, measured, or survived a second scorer trying to refute it.",
};

/**
 * Who judged. The order is the authority order, strongest first: a human's level
 * beats an agent's, which beats a rule's. A `rule` is a seeding rule — it is
 * computed on read and never stored.
 */
export type WeighingScorerKind = "human" | "agent" | "rule";

export const SCORER_KINDS: readonly WeighingScorerKind[] = ["human", "agent", "rule"];

/** The kinds a stored assessment may carry — `rule` seeds are derived, never written. */
export const STORED_SCORER_KINDS: readonly WeighingScorerKind[] = ["human", "agent"];

/** 3 human, 2 agent, 1 rule — higher wins a cell. */
export function scorerRank(kind: string | undefined): number {
  const index = SCORER_KINDS.indexOf(kind as WeighingScorerKind);
  // A kind nobody defined (a hand-edited sidecar) ranks below a rule, so it can never win a cell.
  return index === -1 ? 0 : SCORER_KINDS.length - index;
}

export interface WeighingScorer extends Record<string, unknown> {
  kind: WeighingScorerKind;
  /** Who: a person's handle, an agent's name, or the seeding rule's id. */
  id: string;
  /** The model behind an agent, when it says. */
  model?: string;
  /**
   * Whom the scorer acts for, when the writer knows: an opaque user id or
   * handle, NEVER an email (sidecars are committed to repos). Stamped by the
   * writer, never sent by a caller.
   */
  on_behalf_of?: string;
}

// --- Criteria sets -----------------------------------------------------------

export interface WeighingScale extends Record<string, unknown> {
  min: number;
  max: number;
  /** Every level described in words, keyed by the level as a string (`"-3"` … `"3"`). */
  anchors: Record<string, string>;
}

export interface WeighingGroup extends Record<string, unknown> {
  id: string;
  title: string;
}

export interface WeighingCriterion extends Record<string, unknown> {
  /** Stable. For the value set this is a `ValueId`. Never redefined — retired via `superseded_by`. */
  id: string;
  /** A {@link WeighingGroup.id} — for the value set, the tier. */
  group?: string;
  name?: string;
  question?: string;
  definition?: string;
  /** This criterion's own wording of each level, in the product's words on a positioning. */
  anchors?: Record<string, string>;
  /** On a positioning: how much the product stands on it. Absent means 1. */
  weight?: number;
  superseded_by?: string;
}

export type WeighingCriteriaSetStatus = "draft" | "active";

export interface WeighingCriteriaSet extends Record<string, unknown> {
  id: string;
  /** Semver. Levels are comparable only within a major. */
  version: string;
  title?: string;
  /** What the set judges. Slice 1 uses `acceptance`; the rest is reserved. */
  subject?: string;
  /** Absent on a positioning, which then uses its `extends` ruler's scale ({@link weighingScaleOf}). */
  scale?: WeighingScale;
  groups?: WeighingGroup[];
  criteria: WeighingCriterion[];
  /** `positioning` marks the set a project writes about itself; it re-weights `extends`. */
  role?: string;
  /**
   * Absent or `"active"` is active; anything else — `"draft"`, or a mistyped
   * value — is a draft, which feeds no roll-up until someone activates it
   * ({@link isActiveWeighingSet}).
   */
  status?: string;
  /** A positioning's ruler: `value-contribution@1`. */
  extends?: string;
}

// --- Matrices ----------------------------------------------------------------

export type WeighingMatrixSubjects =
  | { kind: "query"; species: string }
  | { kind: "list"; items: { id: string; title?: string; node_id?: string }[] };

export interface WeighingMatrix extends Record<string, unknown> {
  id: string;
  title?: string;
  /** `value-contribution@1` — the set's id and major. */
  set: string;
  subjects: WeighingMatrixSubjects;
  /** The id of the positioning set that re-weights this matrix, when one exists. */
  positioning?: string;
  context?: { node_id: string };
  /** Same reading as {@link WeighingCriteriaSet.status}. */
  status?: string;
}

// --- Assessments -------------------------------------------------------------

/** What a scorer was looking at, so a re-read can tell the score went stale. */
export interface WeighingAssessmentBasis extends Record<string, unknown> {
  /** A hash of the subject's judged fields ({@link acceptanceFingerprint}). */
  fingerprint?: string;
  commit?: string;
  /** The full version of the set the level was read against. */
  set_version: string;
}

/** One (matrix × subject × criterion) judgement. */
export interface WeighingAssessment extends Record<string, unknown> {
  matrix: string;
  /** A node id for the value matrix. */
  subject: string;
  /** A {@link WeighingCriterion.id}. */
  criterion: string;
  /** A whole number on the set's scale. No half points. 0 means "unrelated". */
  level: number;
  /** Absent on a hand-edited row: it is then read as unscored (the validator warns) and can win no cell. */
  scorer?: WeighingScorer;
  confidence: WeighingConfidence;
  /** Markdown. */
  evidence?: string;
  /** Ids cited: nodes, journal events, findings. */
  refs?: string[];
  basis?: WeighingAssessmentBasis;
  /** The audit or plan the score belongs to. */
  run?: string;
  /** ISO 8601. */
  ts: string;
}

/**
 * The project-owned weighing state — a top-level bundle section, like
 * `quality`. The built-in set and matrix are library content and are not
 * stored here; `sets` holds the project's own (its positioning, today).
 */
export interface WeighingSection extends Record<string, unknown> {
  /** Each list may be absent in storage; a reader treats it as empty. */
  sets?: WeighingCriteriaSet[];
  matrices?: WeighingMatrix[];
  /** Latest per (matrix × subject × criterion × scorer kind); history lives in the journal. */
  assessments?: WeighingAssessment[];
}

// --- Journal event types -----------------------------------------------------

/** One assessment recorded away from a checkout (a hosted session, a browser project). */
export const WEIGHING_ASSESSMENT_RECORDED = "weighing.assessment.recorded";
/** A criteria set saved whole — how a positioning is written away from a checkout. */
export const WEIGHING_SET_SAVED = "weighing.set.saved";

/** The event types {@link ./weighing-events}'s fold reads into the section on the way out. */
export const WEIGHING_FOLD_TYPES = [WEIGHING_ASSESSMENT_RECORDED, WEIGHING_SET_SAVED] as const;

// --- Keys and versions -------------------------------------------------------

/** The cell an assessment is about. */
export function cellKey(matrix: string, subject: string, criterion: string): string {
  return `${matrix}\u0000${subject}\u0000${criterion}`;
}

/**
 * One stored row per cell per scorer kind — a human's level and an agent's sit
 * side by side. Total: a hand-edited row with no scorer, or a key that is not a
 * string, still gets a key (it never matches a well-formed row's), so keying
 * cannot throw on it. Readers skip such rows with {@link isWeighingAssessmentShape}.
 */
export function assessmentKey(a: Pick<WeighingAssessment, "matrix" | "subject" | "criterion" | "scorer">): string {
  const kind = typeof a?.scorer?.kind === "string" ? a.scorer.kind : "";
  return `${cellKey(String(a?.matrix), String(a?.subject), String(a?.criterion))}\u0000${kind}`;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * A row a reader can address: an object whose `matrix`, `subject` and
 * `criterion` are strings. A row that is not (a `null`, a number, a row with no
 * criterion) is skipped by every reader and warned about by the validator
 * (`weighing-assessment-shape`) — it never blocks an import.
 */
export function isWeighingAssessmentShape(row: unknown): row is WeighingAssessment {
  return isRecord(row) && typeof row.matrix === "string" && typeof row.subject === "string" && typeof row.criterion === "string";
}

/** The rows of a section a reader can address, in stored order. A missing list or a garbage row yields nothing. */
export function readWeighingAssessments(section: Partial<Pick<WeighingSection, "assessments">> | null | undefined): WeighingAssessment[] {
  return Array.isArray(section?.assessments) ? section.assessments.filter(isWeighingAssessmentShape) : [];
}

/**
 * Is a set (or matrix) active? Absent means active and `"active"` means active;
 * ANY other present value — `"draft"`, `"Draft"`, a typo, a non-string — counts
 * as a draft, so a mistyped status can never let a draft feed a roll-up. The
 * validator warns on anything but the two spellings (`weighing-set-status`).
 */
export function isActiveWeighingSet(set: { status?: unknown } | null | undefined): boolean {
  const status = set?.status;
  return status === undefined || status === "active";
}

/** `value-contribution@1` → `{ id: "value-contribution", major: "1" }`. A ref with no `@` has no major. */
export function splitSetRef(ref: string): { id: string; major: string | undefined } {
  const at = ref.lastIndexOf("@");
  if (at === -1) return { id: ref, major: undefined };
  return { id: ref.slice(0, at), major: ref.slice(at + 1) };
}

/** The major of a semver string, as a string; `undefined` for anything that does not start with digits. */
export function majorOf(version: string): string | undefined {
  const match = /^(\d+)(?:\.|$)/.exec(version);
  return match ? match[1] : undefined;
}

// --- Fingerprints ------------------------------------------------------------

/**
 * A 53-bit string hash (cyrb53). Not cryptographic and not meant to be: it
 * only has to tell "the text this scorer read" from "the text now", in a
 * browser, in Node and in the plugin scripts alike, with no dependency.
 */
function hash53(text: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

const squash = (text: string): string => text.replace(/\s+/g, " ").trim();

/**
 * The fingerprint of an acceptance: its title, its Gherkin and its values, in
 * that order, whitespace-normalized. **Not its status** — delivery is a fact
 * joined at read time, not something the scorer judged — and not its
 * platforms, for the same reason. Values keep their order because the order is
 * what the seeding rule reads.
 */
export function acceptanceFingerprint(node: Pick<Node, "title" | "metadata">): string {
  const gherkin = typeof node.metadata?.gherkin === "string" ? node.metadata.gherkin : "";
  const values = Array.isArray(node.metadata?.values) ? node.metadata.values : [];
  const text = JSON.stringify([squash(node.title ?? ""), squash(gherkin), values]);
  return `fp1-${hash53(text).toString(16).padStart(14, "0")}`;
}

// --- Writing assessments -----------------------------------------------------

/**
 * Record one assessment, latest-per-cell-per-scorer-kind: a second row for the
 * same key REPLACES in place, keeping its position, so a re-score reads as a
 * correction. The replaced row comes back so the caller can say so.
 */
export function upsertWeighingAssessment(
  assessments: readonly WeighingAssessment[],
  next: WeighingAssessment,
): { assessments: WeighingAssessment[]; replaced?: WeighingAssessment } {
  const key = assessmentKey(next);
  const index = assessments.findIndex((candidate) => assessmentKey(candidate) === key);
  if (index === -1) return { assessments: [...assessments, next] };
  const updated = [...assessments];
  const replaced = updated[index];
  updated[index] = next;
  return { assessments: updated, replaced };
}

/** A stable order for a sidecar file, so two writers diff cleanly: matrix, subject, criterion, then authority. */
export function sortWeighingAssessments(assessments: readonly WeighingAssessment[]): WeighingAssessment[] {
  return [...assessments].sort((a, b) => {
    // A key that is not a string sorts last, so a malformed row stays in the file but out of the way.
    const text = (x: unknown) => (typeof x === "string" ? x : "\uffff");
    const by = (x: unknown, y: unknown) => (text(x) < text(y) ? -1 : text(x) > text(y) ? 1 : 0);
    return (
      by(a?.matrix, b?.matrix) ||
      by(a?.subject, b?.subject) ||
      by(a?.criterion, b?.criterion) ||
      scorerRank(b?.scorer?.kind) - scorerRank(a?.scorer?.kind)
    );
  });
}
```

- [x] **Step 4: Write `packages/schema/src/weighing-library.ts`**

```ts
/**
 * The built-in weighing library — the `value-contribution` criteria set (the 30
 * elements of value, in their four tiers, on the signed −3..+3 scale) and the
 * `value` matrix that judges every acceptance against it.
 *
 * Library content, not project state: it is pinned by version and never stored
 * in `bundle.weighing`, the way Kritik's pack is shipped rather than authored
 * (`packages/kritik-library`). A project's own sets — its positioning — live in
 * the section and are layered on by {@link resolveWeighing}.
 *
 * Zod-free and fs-free, like {@link ./weighing}: the app, the CLI, the MCP
 * server and the plugin scripts all read this one copy.
 */

import { VALUE_IDS, VALUE_TIERS, type ValueId, type ValueTierId } from "./ids";
import type { WeighingCriteriaSet, WeighingMatrix, WeighingScale, WeighingSection } from "./weighing";
import { majorOf, splitSetRef } from "./weighing";

/**
 * Freeze a value and everything under it. The built-ins are shared by every
 * reader in the process; a caller that mutated one would change it for all.
 */
function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as object)) deepFreeze(child);
  }
  return value;
}

export const VALUE_SET_ID = "value-contribution";
export const VALUE_SET_VERSION = "1.0.0";
export const VALUE_MATRIX_ID = "value";
/** The id a project's positioning set carries. */
export const POSITIONING_SET_ID = "positioning";

/** The scale, every level in words. The anchors a scorer — human or agent — reads before choosing. */
export const VALUE_SCALE_ANCHORS: Readonly<Record<string, string>> = {
  "3": "Core. The promise exists for this; take it away and the value goes.",
  "2": "Supports clearly. The user would notice it missing.",
  "1": "Touches. A side effect of the promise, not its purpose.",
  "0": "Unrelated: weighed and found to have nothing to do with it. (No row means nobody has weighed it yet.)",
  "-1": "Small friction. It costs this value a little.",
  "-2": "Works against it. The user notices the cost.",
  "-3": "Costs it at its core. The user feels the opposite.",
};

const TIER_TITLES: Readonly<Record<ValueTierId, string>> = {
  functional: "Functional",
  emotional: "Emotional",
  "life-changing": "Life-changing",
  "social-impact": "Social impact",
};

/**
 * One label and one definition per element. Mirrors `lib/config/values.ts`
 * (the app's UI table); `tests/app/value-icons.test.js` pins the two copies
 * together so neither can drift. A `Record<ValueId, …>` makes a missing element
 * a compile error.
 */
const VALUE_TEXT: Readonly<Record<ValueId, { name: string; definition: string }>> = {
  "saves-time": { name: "Saves time", definition: "Completes the user's task in less time." },
  simplifies: { name: "Simplifies", definition: "Reduces steps, choices, or cognitive load." },
  "makes-money": { name: "Makes money", definition: "Helps the user earn." },
  "reduces-risk": { name: "Reduces risk", definition: "Protects against loss, error, or uncertainty." },
  organizes: { name: "Organizes", definition: "Brings order to the user's things or life." },
  integrates: { name: "Integrates", definition: "Ties different tools or parts of life together." },
  connects: { name: "Connects", definition: "Brings the user together with other people." },
  "reduces-effort": { name: "Reduces effort", definition: "Same outcome, less work." },
  "avoids-hassles": { name: "Avoids hassles", definition: "Prevents friction and annoyance before it happens." },
  "reduces-cost": { name: "Reduces cost", definition: "Saves the user money." },
  quality: { name: "Quality", definition: "Superior craft or performance the user can feel." },
  variety: { name: "Variety", definition: "Meaningful choice and breadth." },
  "sensory-appeal": { name: "Sensory appeal", definition: "Looks, sounds, or feels good in the moment." },
  informs: { name: "Informs", definition: "Tells the user something they want to know." },
  "reduces-anxiety": { name: "Reduces anxiety", definition: "Calms; makes the user feel safe." },
  "rewards-me": { name: "Rewards me", definition: "Tangible perks for engagement." },
  nostalgia: { name: "Nostalgia", definition: "Positive memory of the past." },
  "design-aesthetics": { name: "Design / aesthetics", definition: "Beauty as an experienced value, beyond function." },
  "badge-value": { name: "Badge value", definition: "Signals identity or status to others." },
  wellness: { name: "Wellness", definition: "Improves physical or mental well-being." },
  "therapeutic-value": { name: "Therapeutic value", definition: "Actively supports emotional processing or healing." },
  "fun-entertainment": { name: "Fun / entertainment", definition: "Enjoyable, playful, delightful." },
  attractiveness: { name: "Attractiveness", definition: "Makes the user feel attractive." },
  "provides-access": { name: "Provides access", definition: "Grants entry to something otherwise out of reach." },
  "provides-hope": { name: "Provides hope", definition: "Reason to believe things can improve." },
  "self-actualization": { name: "Self-actualization", definition: "Helps the user become who they want to be." },
  motivation: { name: "Motivation", definition: "Energizes the user toward their goals." },
  heirloom: { name: "Heirloom", definition: "Something worth passing on across time." },
  "affiliation-belonging": { name: "Affiliation & belonging", definition: "Makes the user part of a group that matters." },
  "self-transcendence": { name: "Self-transcendence", definition: "Helps beyond the user themselves." },
};

/** The signed scale the value set (and, by default, a positioning) is read on. */
const VALUE_SCALE: WeighingScale = { min: -3, max: 3, anchors: { ...VALUE_SCALE_ANCHORS } };

/** The 30 elements as criteria, in `VALUE_IDS` order, grouped by tier. */
export const VALUE_CONTRIBUTION_SET: WeighingCriteriaSet = deepFreeze({
  id: VALUE_SET_ID,
  version: VALUE_SET_VERSION,
  title: "Elements of value",
  subject: "acceptance",
  scale: VALUE_SCALE,
  groups: (Object.keys(TIER_TITLES) as ValueTierId[]).map((id) => ({ id, title: TIER_TITLES[id] })),
  criteria: VALUE_IDS.map((id) => ({
    id,
    group: VALUE_TIERS[id],
    name: VALUE_TEXT[id].name,
    question: `Does this promise serve, or cost, "${VALUE_TEXT[id].name}"?`,
    definition: VALUE_TEXT[id].definition,
  })),
});

/** The built-in matrix: every acceptance, judged against the elements of value. */
export const VALUE_MATRIX: WeighingMatrix = deepFreeze({
  id: VALUE_MATRIX_ID,
  title: "Value",
  set: `${VALUE_SET_ID}@1`,
  subjects: { kind: "query", species: "acceptance" },
  positioning: POSITIONING_SET_ID,
  status: "active",
});

export const BUILT_IN_SETS: readonly WeighingCriteriaSet[] = [VALUE_CONTRIBUTION_SET];
export const BUILT_IN_MATRICES: readonly WeighingMatrix[] = [VALUE_MATRIX];

/**
 * The built-ins layered under a project's own entries — the WELL-FORMED view of a
 * section: every set and matrix here passed its shape guard, so derivation code
 * can read `.criteria`, `.set` and `.subjects` without checking. Read a stored
 * section through {@link resolveWeighing}, never straight off `section.sets`.
 */
export interface ResolvedWeighing {
  sets: WeighingCriteriaSet[];
  matrices: WeighingMatrix[];
  /**
   * Every stored entry the resolver dropped — malformed, a redefinition of a
   * built-in, or a duplicate id — with its position in the stored list, so a
   * surface can say "your saved positioning is malformed and is ignored"
   * instead of showing nothing. `id` is absent when the entry has none.
   */
  skipped: { kind: "set" | "matrix"; id?: string; /** A set's role, when it names one (a mistyped positioning has role `positioning` and any id). */ role?: string; index: number }[];
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A copy of a project set without its unusable criteria; the set itself when it has none. */
function cleaned(set: WeighingCriteriaSet): WeighingCriteriaSet {
  const usable = set.criteria.filter((criterion) => isObject(criterion) && typeof criterion.id === "string");
  return usable.length === set.criteria.length ? set : { ...set, criteria: usable };
}

/**
 * A set a reader can use: a string id and version, a criteria array and a scale
 * object — except a positioning (`role: "positioning"`), which may have no
 * scale because it uses its `extends` ruler's ({@link weighingScaleOf}).
 */
export function isWeighingSetShape(set: unknown): set is WeighingCriteriaSet {
  return (
    isObject(set) &&
    typeof set.id === "string" &&
    typeof set.version === "string" &&
    Array.isArray(set.criteria) &&
    (isObject(set.scale) || set.role === "positioning")
  );
}

/**
 * A matrix a reader can use: a string id and set ref, and a subjects object of
 * a known kind that carries what the kind needs — a `query` names a species, a
 * `list` has an items array.
 */
export function isWeighingMatrixShape(matrix: unknown): matrix is WeighingMatrix {
  if (!isObject(matrix) || typeof matrix.id !== "string" || typeof matrix.set !== "string" || !isObject(matrix.subjects)) return false;
  const { kind, species, items } = matrix.subjects;
  return (kind === "query" && typeof species === "string") || (kind === "list" && Array.isArray(items));
}

/** A scale a reader can use: numeric `min` and `max` and an object `anchors` (`weighing-scale-shape` warns on the rest). */
function isUsableScale(scale: unknown): scale is WeighingScale {
  return isObject(scale) && typeof scale.min === "number" && typeof scale.max === "number" && isObject(scale.anchors);
}

/**
 * The scale a set is read on: its own, or — for a positioning with none — its
 * `extends` ruler's, or at the last the built-in signed scale — and it only
 * takes a set's own scale when that scale is usable (numeric min and max, an
 * anchors object), so `.anchors[...]` is always safe. Total, so a
 * reader never needs a guard before `.min` / `.max` / `.anchors`.
 */
export function weighingScaleOf(set: Pick<WeighingCriteriaSet, "scale" | "extends">, resolved?: Pick<ResolvedWeighing, "sets">): WeighingScale {
  if (isUsableScale(set.scale)) return set.scale;
  const ruler = typeof set.extends === "string" && resolved !== undefined ? setOfRef(resolved, set.extends) : undefined;
  return ruler !== undefined && isUsableScale(ruler.scale) ? ruler.scale : VALUE_SCALE;
}

/**
 * The effective sets and matrices: the built-ins, then the project's own.
 * A project entry that reuses a built-in's id is ignored — a pinned set is
 * never redefined (`validateBundle` warns) — and later duplicates lose to
 * earlier ones, matching every other first-wins read in this package. An entry
 * a reader could not use (a matrix with no set, a set with no criteria or
 * scale) is skipped rather than thrown on; the validator warns about it
 * (`weighing-set-shape`, `weighing-matrix-shape`). A criterion that is not an
 * object with a string id is dropped from a project set's copy, so
 * `set.criteria` is clean to walk (`weighing-criterion-shape` warns).
 */
export function resolveWeighing(section?: Partial<Pick<WeighingSection, "sets" | "matrices">> | null): ResolvedWeighing {
  const sets: WeighingCriteriaSet[] = [...BUILT_IN_SETS];
  const matrices: WeighingMatrix[] = [...BUILT_IN_MATRICES];
  const skipped: ResolvedWeighing["skipped"] = [];
  const idOf = (entry: unknown): { id?: string; role?: string } =>
    isObject(entry) ? { ...(typeof entry.id === "string" ? { id: entry.id } : {}), ...(typeof entry.role === "string" ? { role: entry.role } : {}) } : {};
  (Array.isArray(section?.sets) ? section.sets : []).forEach((set, index) => {
    if (isWeighingSetShape(set) && !sets.some((s) => s.id === set.id)) sets.push(cleaned(set));
    else skipped.push({ kind: "set", ...idOf(set), index });
  });
  (Array.isArray(section?.matrices) ? section.matrices : []).forEach((matrix, index) => {
    if (isWeighingMatrixShape(matrix) && !matrices.some((m) => m.id === matrix.id)) matrices.push(matrix);
    else skipped.push({ kind: "matrix", ...idOf(matrix), index });
  });
  return { sets, matrices, skipped };
}

/**
 * The set a `value-contribution@1` ref names, if the resolved library holds it
 * **at that major**: a ref to `@2` of a set that is at `1.x` is not the same
 * ruler, and levels are comparable only within a major. A ref with no `@` names
 * the set at whatever major it is. The validator tells the two failures apart
 * (`weighing-unknown-set` / `weighing-set-ref-major`).
 */
export function setOfRef(resolved: Pick<ResolvedWeighing, "sets">, ref: string): WeighingCriteriaSet | undefined {
  const { id, major } = splitSetRef(ref);
  const set = resolved.sets.find((candidate) => candidate.id === id);
  if (set === undefined) return undefined;
  return major === undefined || majorOf(set.version) === major ? set : undefined;
}
```

- [x] **Step 5: Export both from the package index**

In `packages/schema/src/index.ts`, after the line `export * from "./journal-page";`, add:

```ts
export * from "./weighing";
export * from "./weighing-library";
```

- [x] **Step 6: Run the test to verify it passes**

Run: `node tests/schema/weighing.test.js && npx tsc --noEmit -p .`
Expected: every `PASS:` line, ending `All weighing tests passed.`; `tsc` prints nothing.

- [x] **Step 7: Commit**

```bash
git add packages/schema/src/weighing.ts packages/schema/src/weighing-library.ts packages/schema/src/index.ts tests/schema/weighing.test.js
git commit -m "feat(weighing): the records, the fingerprint and the built-in value library (part 1/5)"
```

### Task 1.2: Zod shapes and the `bundle.weighing` key

**Files:**
- Create: `packages/schema/src/weighing-schemas.ts`
- Modify: `packages/schema/src/bundle.ts`, `packages/schema/src/index.ts`
- Modify: `tests/schema/weighing.test.js`

- [x] **Step 1: Write the failing test**

In `tests/schema/weighing.test.js`, insert this block **immediately above** the final `fs.rmSync(BUILD_DIR, …)` line:

```js
// --- The zod shapes ---------------------------------------------------------

const section = { sets: [], matrices: [], assessments: [row()] };
check("a valid section parses", WeighingSectionSchema.safeParse(section).success);
// Import never blocks: every judgement about a value is the validator's, and a bad cell only warns.
// (Each of these is checked against the validator's warning in the section below.)
check("a level of 3.5 parses — the validator warns, the import does not fail", WeighingAssessmentSchema.safeParse(row({ level: 3.5 })).success);
check("a confidence of 4 parses", WeighingAssessmentSchema.safeParse(row({ confidence: 4 })).success);
check("a missing scorer parses", WeighingAssessmentSchema.safeParse({ ...row(), scorer: undefined }).success);
check("an unknown scorer kind parses", WeighingAssessmentSchema.safeParse(row({ scorer: { kind: "robot", id: "x" } })).success);
check("a scorer with no id parses", WeighingAssessmentSchema.safeParse(row({ scorer: { kind: "agent" } })).success);
check("a row that cannot be addressed still parses — readers skip it, the validator warns", WeighingAssessmentSchema.safeParse({ ...row(), criterion: undefined }).success && WeighingAssessmentSchema.safeParse({ ...row(), subject: 7 }).success && WeighingAssessmentSchema.safeParse({ ...row(), ts: undefined }).success);
check("a partial section parses: each list is optional and a reader treats it as empty", WeighingSectionSchema.safeParse({}).success && WeighingSectionSchema.safeParse({ assessments: [row()] }).success && WeighingSectionSchema.safeParse({ sets: [] }).success);
check("a matrix with no set or subjects, and a set with no scale or criteria, parse", WeighingSectionSchema.safeParse({ matrices: [{ id: "m" }], sets: [{ id: "s", version: "1.0.0", subject: "acceptance" }] }).success);
check("unknown keys survive (a scorer's full distribution)", WeighingAssessmentSchema.parse(row({ distribution: [0.1, 0.9] })).distribution?.[1] === 0.9);
check("a scorer may say whom it acts for: an optional string that survives, and a number still parses", WeighingAssessmentSchema.parse(row({ scorer: { ...agent, on_behalf_of: "u_1842" } })).scorer.on_behalf_of === "u_1842" && WeighingAssessmentSchema.safeParse(row({ scorer: agent })).success && WeighingAssessmentSchema.safeParse(row({ scorer: { ...agent, on_behalf_of: 42 } })).success);
check("a set parses with its own anchors and weight", WeighingCriteriaSetSchema.safeParse({ id: "positioning", version: "1.0.0", subject: "acceptance", scale: set.scale, role: "positioning", status: "draft", extends: "value-contribution@1", criteria: [{ id: "reduces-anxiety", weight: 3, anchors: { 3: "Removes a worry the user names" } }] }).success);

const base = {
  schema_version: 3,
  project: { id: "p", title: "P", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" },
  nodes: [{ id: "AC-a", project_id: "p", species: "acceptance", title: "Accept an invite", status: "live", platforms: ["web"], metadata: { values: ["connects"] } }],
  edges: [],
};
check("a bundle with a weighing section parses", ProjectBundleSchema.safeParse({ ...base, weighing: section }).success);
check("a bundle without one still parses", ProjectBundleSchema.safeParse(base).success);
check("a bundle carrying a bad cell still imports (zod) — and validates, with warnings", ProjectBundleSchema.safeParse({ ...base, weighing: { assessments: [row({ level: 3.5, confidence: 4, scorer: undefined })] } }).success);
```

- [x] **Step 2: Run it to verify it fails**

Run: `node tests/schema/weighing.test.js`
Expected: FAIL — `TypeError: Cannot read properties of undefined (reading 'safeParse')` (no `WeighingSectionSchema` yet).

- [x] **Step 3: Write `packages/schema/src/weighing-schemas.ts`**

```ts
/**
 * Zod schemas for the weighing section (docs/rfcs/weighing.md).
 *
 * Same split as Kritik's ({@link ./quality-schemas}): {@link ./weighing} owns the
 * types and the pure helpers and stays zod-free so the standalone validator can
 * bundle it; this module owns the shapes. Every object is
 * `.catchall(z.unknown())` — a scorer that keeps its full probability
 * distribution in an extra field, or a project that hangs its own key off a
 * criterion, must survive import → export → Synk → Publik untouched.
 *
 * The section is additive: `schema_version` stays 3, and older readers preserve
 * `weighing` through the bundle root's own catchall.
 *
 * **Import never blocks.** These shapes are deliberately looser than
 * {@link ./quality-schemas}: weighing is filled at scale by agents and scorers,
 * so one bad cell must never refuse an import of the project. Only the
 * CONTAINERS are strict — `weighing` is an object and each of its lists is an
 * array. Every item in a list may be anything (a `null` row parses), and every
 * leaf below is `z.unknown()`: a level of "2", a confidence of 4, a scorer
 * that is a string, a matrix with no id, a criterion with no weight all parse.
 * The `.meta` descriptions still document what each field should hold, and the
 * validator ({@link ./weighing-validate}) warns on every one that does not.
 *
 * Values must survive round trips untouched, so nothing here coerces, strips
 * or falls back (no `.catch()`). The exported types describe a well-formed
 * record, so the loosened schemas are cast to them; a reader goes through the
 * shape guards ({@link ./weighing}, {@link ./weighing-library}).
 */

import { z } from "zod";
import type {
  WeighingAssessment,
  WeighingAssessmentBasis,
  WeighingCriteriaSet,
  WeighingMatrix,
  WeighingScorer,
  WeighingCriterion,
  WeighingGroup,
  WeighingScale,
  WeighingSection,
} from "./weighing";

/** A shape that documents what a value should be, and still accepts anything else untouched. */
const documented = <T extends z.ZodType>(schema: T) => z.union([schema, z.unknown()]);
/** A leaf: any value, or none, with a description of what it should hold. */
const leaf = (description: string) => z.unknown().optional().meta({ description });

/** 0 guess · 1 inferred · 2 evidenced · 3 verified — but any value parses; the validator warns outside 0..3. */
export const WeighingConfidenceSchema = z.unknown().meta({ description: "0 guess · 1 inferred · 2 evidenced · 3 verified." });

export const WeighingScorerSchema = z
  .object({
    kind: leaf("Who judged: human, agent or rule. A human's level beats an agent's, which beats a rule's. Any value parses; the validator warns on another kind."),
    id: leaf("A person's handle, an agent's name, or a seeding rule's id."),
    model: leaf("The model behind an agent, when it says."),
    on_behalf_of: leaf("Whom the scorer acts for: an opaque user id or handle, never an email. Stamped by the writer where identity is known."),
  })
  .catchall(z.unknown())
  .meta({ id: "WeighingScorer", description: "Provenance of one assessment." }) as unknown as z.ZodType<WeighingScorer>;

export const WeighingScaleSchema = z
  .object({
    min: leaf("The lowest level, e.g. -3."),
    max: leaf("The highest level, e.g. 3."),
    anchors: leaf("Every level described in words, keyed by the level as a string."),
  })
  .catchall(z.unknown())
  .meta({ id: "WeighingScale", description: "A criteria set's scale: its bounds and every level's anchor." }) as unknown as z.ZodType<WeighingScale>;

export const WeighingGroupSchema = z
  .object({ id: leaf("The group's id."), title: leaf("The group's title.") })
  .catchall(z.unknown())
  .meta({ id: "WeighingGroup", description: "A grouping of criteria — the tiers, for the value set." }) as unknown as z.ZodType<WeighingGroup>;

export const WeighingCriterionSchema = z
  .object({
    id: leaf("Stable identifier. Never redefined — retired via superseded_by."),
    group: leaf("A group id — for the value set, the tier."),
    name: leaf("A short name."),
    question: leaf("The question a scorer answers."),
    definition: leaf("What the criterion means."),
    anchors: leaf("This criterion's own wording of each level — on a positioning, in the product's words."),
    weight: leaf("On a positioning: how much the product stands on it, a number above 0. Absent means 1."),
    superseded_by: leaf("The id of the criterion that replaces this one."),
  })
  .catchall(z.unknown())
  .meta({ id: "WeighingCriterion", description: "One question on a scale where every level is described." }) as unknown as z.ZodType<WeighingCriterion>;

export const WeighingCriteriaSetSchema = z
  .object({
    id: leaf("The set's id."),
    version: leaf("Semver. Levels are comparable only within a major."),
    title: leaf("A human title."),
    subject: leaf("What the set judges: acceptance today."),
    scale: documented(WeighingScaleSchema).optional().meta({ description: "The scale. A positioning may leave it out and use its ruler's." }),
    groups: documented(z.array(documented(WeighingGroupSchema))).optional(),
    criteria: documented(z.array(documented(WeighingCriterionSchema))).optional(),
    role: leaf("positioning marks the set a project writes about itself."),
    status: leaf("Absent or active is active; anything else is a draft, which feeds no roll-up."),
    extends: leaf("A positioning's ruler, e.g. value-contribution@1."),
  })
  .catchall(z.unknown())
  .meta({ id: "WeighingCriteriaSet", description: "A versioned list of criteria for one kind of subject. The 30 elements of value are one; a positioning is another." }) as unknown as z.ZodType<WeighingCriteriaSet>;

export const WeighingMatrixSchema = z
  .object({
    id: leaf("The matrix's id."),
    title: leaf("A human title."),
    set: leaf("The set's id and major, e.g. value-contribution@1."),
    subjects: documented(
      z.object({ kind: leaf("query or list."), species: leaf("For a query: the species judged."), items: leaf("For a list: the subjects.") }).catchall(z.unknown()),
    ).optional().meta({ description: "What the matrix judges: { kind: query, species } or { kind: list, items }." }),
    positioning: leaf("The id of the positioning set that re-weights this matrix."),
    context: leaf("The node the matrix is about, as { node_id }."),
    status: leaf("Absent or active is active; anything else is a draft."),
  })
  .catchall(z.unknown())
  .meta({ id: "WeighingMatrix", description: "A criteria set applied to a list of subjects." }) as unknown as z.ZodType<WeighingMatrix>;

export const WeighingAssessmentBasisSchema = z
  .object({
    fingerprint: leaf("A hash of the subject's judged fields."),
    commit: leaf("The commit the scorer was looking at."),
    set_version: leaf("The full version of the set the level was read against."),
  })
  .catchall(z.unknown()) as unknown as z.ZodType<WeighingAssessmentBasis>;

export const WeighingAssessmentSchema = z
  .object({
    matrix: leaf("The matrix's id. A row without it cannot be addressed: readers skip it and the validator warns."),
    subject: leaf("A node id for the value matrix."),
    criterion: leaf("A criterion id."),
    level: leaf("A whole number on the set's scale. 0 means unrelated. No half points — but any value parses; the validator warns on one off the scale."),
    scorer: documented(WeighingScorerSchema).optional().meta({ description: "Who judged. Required in practice: without it a human, an agent and a rule are indistinguishable, so the validator warns." }),
    confidence: leaf("0 guess · 1 inferred · 2 evidenced · 3 verified."),
    evidence: leaf("Markdown."),
    refs: leaf("Ids cited: nodes, journal events, findings."),
    basis: documented(WeighingAssessmentBasisSchema).optional().meta({ description: "What the scorer was looking at, so a re-read can tell the score went stale." }),
    run: leaf("The audit or plan the score belongs to."),
    ts: leaf("ISO 8601."),
  })
  .catchall(z.unknown())
  .meta({ id: "WeighingAssessment", description: "One (matrix × subject × criterion) judgement — latest per scorer kind wins; history lives in the journal." }) as unknown as z.ZodType<WeighingAssessment>;

export const WeighingSectionSchema = z
  .object({
    sets: z.array(documented(WeighingCriteriaSetSchema)).optional(),
    matrices: z.array(documented(WeighingMatrixSchema)).optional(),
    assessments: z.array(documented(WeighingAssessmentSchema)).optional(),
  })
  .catchall(z.unknown())
  .meta({
    id: "WeighingSection",
    description:
      "The project's weighing state (docs/rfcs/weighing.md) — its own criteria sets (a positioning), matrices and assessments. The built-in value set is library content, not stored; served, cost and kept share are derived, never stored. Each list may be absent; a reader treats it as empty.",
  }) as unknown as z.ZodType<WeighingSection>;
```

- [x] **Step 4: Wire the key into the bundle**

```diff
--- a/packages/schema/src/bundle.ts
+++ b/packages/schema/src/bundle.ts
@@ -22,6 +22,8 @@
 import type { ProductDefinition } from "./products";
 import type { QualitySection } from "./quality";
 import { QualitySectionSchema } from "./quality-schemas";
+import type { WeighingSection } from "./weighing";
+import { WeighingSectionSchema } from "./weighing-schemas";
 
 export type PlatformStatusMap = Partial<Record<PlatformId, StatusId>>;
 export const PlatformStatusMapSchema: z.ZodType<PlatformStatusMap> = z.partialRecord(
@@ -411,6 +413,8 @@
   journal?: JournalEvent[];
   /** Optional Kritik quality state — profile, assessments, findings (docs/rfcs/kritik.md § 4.1). Additive; the matrix is derived, never stored. */
   quality?: QualitySection;
+  /** Optional weighing state — the project's own criteria sets (a positioning), matrices and assessments (docs/rfcs/weighing.md). Additive; served, cost and kept share are derived, never stored. */
+  weighing?: WeighingSection;
 }
 
 export const ProjectBundleSchema: z.ZodType<ProjectBundle> = z.object({
@@ -429,6 +433,10 @@
     description:
       "Optional Kritik quality state (docs/rfcs/kritik.md \u00a7 4.1) \u2014 the pinned pack version, the project's surface profile, its assessments and findings. Additive: a bundle without it is not an error, and the comparative matrix is derived from it (deriveQualityMatrix), never stored.",
   }),
+  weighing: WeighingSectionSchema.optional().meta({
+    description:
+      "Optional weighing state (docs/rfcs/weighing.md) \u2014 the project's own criteria sets (a positioning), matrices and assessments, each assessment carrying its scorer, confidence and basis. Additive: a bundle without it is not an error, and every weight, served and cost figure is derived from it, never stored.",
+  }),
 }).catchall(z.unknown()).meta({
   id: "ProjectBundle",
   title: "Arkaik ProjectBundle",
```

- [x] **Step 5: Export the schemas**

In `packages/schema/src/index.ts`, after `export * from "./weighing";` add `export * from "./weighing-schemas";` (keep `weighing-library` last of the three).

- [x] **Step 6: Run the tests**

Run: `node tests/schema/weighing.test.js && npm run test:schema && npm run test:fixtures && npx tsc --noEmit -p .`
Expected: `All weighing tests passed.`, `All 15 parity tests passed.`, `All 14 fixture tests passed.`, `tsc` silent.

- [x] **Step 7: Commit**

```bash
git add packages/schema/src/weighing-schemas.ts packages/schema/src/bundle.ts packages/schema/src/index.ts tests/schema/weighing.test.js
git commit -m "feat(weighing): zod shapes and the additive bundle.weighing key (part 1/5)"
```

### Task 1.3: Validator warnings

**Files:**
- Create: `packages/schema/src/weighing-validate.ts`
- Modify: `packages/schema/src/validate.ts`, `packages/schema/src/index.ts`
- Modify: `tests/schema/weighing.test.js`

- [x] **Step 1: Write the failing test**

Insert **above** the final `fs.rmSync(BUILD_DIR, …)` line in `tests/schema/weighing.test.js`:

```js
// --- The validator ----------------------------------------------------------

const warningsFor = (weighing, extra = {}) => validateBundle({ ...base, weighing, ...extra }).warnings.map((w) => w.rule);
check("a clean section raises no weighing warning", warningsFor(section).filter((r) => r.startsWith("weighing")).length === 0);
check("an unknown criterion warns", warningsFor({ ...section, assessments: [row({ criterion: "teleports" })] }).includes("weighing-unknown-criterion"));
check("a level off the scale warns", warningsFor({ ...section, assessments: [row({ level: 4 })] }).includes("weighing-level-range"));
check("a stored rule seed warns", warningsFor({ ...section, assessments: [row({ scorer: { kind: "rule", id: "seed" }, confidence: 0, evidence: undefined })] }).includes("weighing-rule-stored"));
check("a missing scorer warns", warningsFor({ ...section, assessments: [{ ...row(), scorer: undefined }] }).includes("weighing-scorer-missing"));
check("an unknown subject warns", warningsFor({ ...section, assessments: [row({ subject: "AC-gone" })] }).includes("weighing-unknown-subject"));
check("a subject that is not an acceptance warns", warningsFor({ ...section, assessments: [row({ subject: "V-home" })] }, { nodes: [...base.nodes, { id: "V-home", project_id: "p", species: "view", title: "Home", status: "live", platforms: ["web"] }] }).includes("weighing-subject-species"));
check("confidence 2 with no evidence warns", warningsFor({ ...section, assessments: [row({ evidence: undefined })] }).includes("weighing-no-evidence"));
check("confidence 0 with no evidence is fine", !warningsFor({ ...section, assessments: [row({ confidence: 0, evidence: undefined })] }).includes("weighing-no-evidence"));
check("two rows for one cell and kind warn", warningsFor({ ...section, assessments: [row(), row({ level: 1 })] }).includes("weighing-duplicate-assessment"));
check("a human and an agent row for one cell do not", !warningsFor({ ...section, assessments: [row(), row({ scorer: agent })] }).includes("weighing-duplicate-assessment"));
check("an unknown matrix warns", warningsFor({ ...section, assessments: [row({ matrix: "nope" })] }).includes("weighing-unknown-matrix"));
check("a set major bump warns", warningsFor({ ...section, assessments: [row({ basis: { set_version: "0.9.0" } })] }).includes("weighing-set-major"));
check("redefining a pinned set warns", warningsFor({ sets: [{ ...set, version: "9.0.0" }], matrices: [], assessments: [] }).includes("weighing-pinned-set-redefined"));
const positioning = (criteria) => ({ id: "positioning", version: "1.0.0", subject: "acceptance", scale: set.scale, role: "positioning", extends: "value-contribution@1", criteria });
check("a positioning naming a non-element warns", warningsFor({ sets: [positioning([{ id: "teleports", weight: 2 }])], matrices: [], assessments: [] }).includes("weighing-positioning-unknown-element"));
check("a positioning weight of 0 warns", warningsFor({ sets: [positioning([{ id: "connects", weight: 0 }])], matrices: [], assessments: [] }).includes("weighing-positioning-weight"));
check("a good positioning raises nothing", warningsFor({ sets: [positioning([{ id: "connects", weight: 3 }])], matrices: [], assessments: [] }).filter((r) => r.startsWith("weighing")).length === 0);
const rulesOf = (weighing) => warningsFor(weighing).filter((r) => r.startsWith("weighing"));
check("a level of 3.5 warns", warningsFor({ ...section, assessments: [row({ level: 3.5 })] }).includes("weighing-level-range"));
check("a confidence of 4 warns", warningsFor({ ...section, assessments: [row({ confidence: 4 })] }).includes("weighing-confidence-range"));
check("a scorer with no id warns as a missing scorer", warningsFor({ ...section, assessments: [row({ scorer: { kind: "agent" } })] }).includes("weighing-scorer-missing"));
check(
  "an unknown scorer kind warns as itself, not as a stored rule",
  (() => {
    const rules = warningsFor({ ...section, assessments: [row({ scorer: { kind: "robot", id: "x" } })] });
    return rules.includes("weighing-scorer-kind") && !rules.includes("weighing-rule-stored");
  })(),
);
check("a partial section raises nothing", rulesOf({ assessments: [] }).length === 0 && rulesOf({}).length === 0 && rulesOf({ sets: [] }).length === 0);

const own = (over = {}) => ({ id: "rubric", version: "1.0.0", subject: "acceptance", scale: set.scale, criteria: [{ id: "old", superseded_by: "new" }, { id: "new" }], ...over });
const ownMatrix = (over = {}) => ({ id: "m", set: "rubric@1", subjects: { kind: "query", species: "acceptance" }, ...over });
check("a duplicate set id warns", warningsFor({ sets: [own(), own()], matrices: [], assessments: [] }).includes("weighing-duplicate-set"));
check("a set with a criterion list and a scale is not a shape problem", !rulesOf({ sets: [own()], matrices: [], assessments: [] }).includes("weighing-set-shape"));
check("a set with no criteria or scale warns", warningsFor({ sets: [{ id: "s" }], matrices: [], assessments: [] }).includes("weighing-set-shape") && warningsFor({ sets: [own({ scale: undefined })], matrices: [], assessments: [] }).includes("weighing-set-shape"));
check("redefining the built-in matrix warns", warningsFor({ sets: [], matrices: [ownMatrix({ id: "value", set: "value-contribution@1" })], assessments: [] }).includes("weighing-pinned-matrix-redefined"));
check("a duplicate matrix id warns", warningsFor({ sets: [own()], matrices: [ownMatrix(), ownMatrix()], assessments: [] }).includes("weighing-duplicate-matrix"));
check("a matrix naming a set nothing defines warns", warningsFor({ sets: [], matrices: [ownMatrix()], assessments: [] }).includes("weighing-unknown-set"));
check("a matrix naming a defined set is clean", rulesOf({ sets: [own()], matrices: [ownMatrix()], assessments: [] }).length === 0);
check("a matrix with only an id warns, and so does one with no subjects", warningsFor({ sets: [], matrices: [{ id: "m" }], assessments: [] }).includes("weighing-matrix-shape") && warningsFor({ sets: [], matrices: [{ id: "m", set: "value-contribution@1" }], assessments: [] }).includes("weighing-matrix-shape"));
check("a matrix naming another major of a set warns as a major, not as unknown", (() => {
  const rules = warningsFor({ sets: [], matrices: [ownMatrix({ set: "value-contribution@2" })], assessments: [] });
  return rules.includes("weighing-set-ref-major") && !rules.includes("weighing-unknown-set");
})());
check("an assessment on a retired criterion warns", warningsFor({ sets: [own()], matrices: [ownMatrix()], assessments: [row({ matrix: "m", criterion: "old" })] }).includes("weighing-retired-criterion"));
check("an assessment on its replacement does not", !warningsFor({ sets: [own()], matrices: [ownMatrix()], assessments: [row({ matrix: "m", criterion: "new" })] }).includes("weighing-retired-criterion"));

const positioningOf = (over) => ({ ...positioning([{ id: "connects", weight: 3 }]), ...over });
check("a positioning under another id warns — it would never be applied", warningsFor({ sets: [positioningOf({ id: "positioning-pebbles" })], matrices: [], assessments: [] }).includes("weighing-positioning-id"));
check("a set called positioning with no role warns", warningsFor({ sets: [positioningOf({ role: undefined })], matrices: [], assessments: [] }).includes("weighing-positioning-id"));
check("a positioning with no extends warns", warningsFor({ sets: [positioningOf({ extends: undefined })], matrices: [], assessments: [] }).includes("weighing-positioning-unknown-ruler"));
check("a positioning extending nothing known warns", warningsFor({ sets: [positioningOf({ extends: "nope@1" })], matrices: [], assessments: [] }).includes("weighing-positioning-unknown-ruler"));
check("a positioning extending itself warns", warningsFor({ sets: [positioningOf({ extends: "positioning@1" })], matrices: [], assessments: [] }).includes("weighing-positioning-unknown-ruler"));
check("a positioning extending another major warns as a major", (() => {
  const rules = warningsFor({ sets: [positioningOf({ extends: "value-contribution@7" })], matrices: [], assessments: [] });
  return rules.includes("weighing-set-ref-major") && !rules.includes("weighing-positioning-unknown-ruler");
})());
check("a positioning that names its ruler right is clean", rulesOf({ sets: [positioningOf({})], matrices: [], assessments: [] }).length === 0);
check(
  "a weighing event with no actor warns",
  warningsFor(undefined, { journal: [{ id: "01A", ts: "2026-11-15T10:00:00.000Z", type: "weighing.assessment.recorded", matrix: "value", subject: "AC-a", criterion: "connects", level: 2, confidence: 1, scorer: human }] }).includes("weighing-event-no-actor"),
);

// --- Import never blocks: every probe case parses AND warns ------------------

const good = { matrix: "value", subject: "AC-a", criterion: "connects", level: 1, scorer: { kind: "human", id: "x" }, confidence: 1, ts: "2026-11-15T10:00:00.000Z" };
const pos = { id: "positioning", version: "1.0.0", subject: "acceptance", role: "positioning", extends: "value-contribution@1", criteria: [{ id: "connects", weight: 2 }] };
const asRow = (over) => ({ sets: [], matrices: [], assessments: [{ ...good, ...over }] });
const asPos = (over) => ({ sets: [{ ...pos, ...over }], matrices: [], assessments: [] });
const mat = (subjects) => ({ sets: [], matrices: [{ id: "m", set: "value-contribution@1", subjects }], assessments: [] });
const bad = [
  ["an assessment with no ts", asRow({ ts: undefined }), "weighing-assessment-ts"],
  ["an assessment with an invalid ts", asRow({ ts: "yesterday" }), "weighing-assessment-ts"],
  ["an assessment with no criterion", asRow({ criterion: undefined }), "weighing-assessment-shape"],
  ["an assessment with a numeric subject", asRow({ subject: 7 }), "weighing-assessment-shape"],
  ["a string level", asRow({ level: "2" }), "weighing-level-range"],
  ["a null level", asRow({ level: null }), "weighing-level-range"],
  ["a string confidence", asRow({ confidence: "high" }), "weighing-confidence-range"],
  ["a scorer that is a string", asRow({ scorer: "alexis" }), "weighing-scorer-missing"],
  ["a scorer with no kind", asRow({ scorer: { id: "x" } }), "weighing-scorer-missing"],
  ["a numeric evidence", asRow({ evidence: 3 }), "weighing-evidence-type"],
  ["refs that is a string", asRow({ refs: "AC-b" }), "weighing-refs-type"],
  ["a numeric set_version", asRow({ basis: { set_version: 1 } }), "weighing-basis-shape"],
  ["a null assessment row", { sets: [], matrices: [], assessments: [null] }, "weighing-assessment-shape"],
  ["a number among the assessments", { sets: [], matrices: [], assessments: [good, 5] }, "weighing-assessment-shape"],
  ["a null set", { sets: [null], matrices: [], assessments: [] }, "weighing-set-shape"],
  ["a null matrix", { sets: [], matrices: [null], assessments: [] }, "weighing-matrix-shape"],
  ["a set with no id", { sets: [{ version: "1.0.0", scale: set.scale, criteria: [] }], matrices: [], assessments: [] }, "weighing-set-shape"],
  ["a positioning with no version", asPos({ version: undefined }), "weighing-set-shape"],
  ["a positioning weight that is a string", asPos({ criteria: [{ id: "connects", weight: "2" }] }), "weighing-positioning-weight"],
  ["a positioning anchor that is a number", asPos({ criteria: [{ id: "connects", anchors: { 3: 3 } }] }), "weighing-criterion-shape"],
  ["a positioning criterion with no id", asPos({ criteria: [{ weight: 2 }] }), "weighing-criterion-shape"],
  ["a null positioning criterion", asPos({ criteria: [null] }), "weighing-criterion-shape"],
  ["a status of Draft", asPos({ status: "Draft" }), "weighing-set-status"],
  ["a mistyped role", asPos({ role: "Positioning" }), "weighing-positioning-id"],
  ["a numeric role", asPos({ role: 5 }), "weighing-positioning-id"],
  ["a scale with no anchors", asPos({ scale: { min: -3, max: 3 } }), "weighing-scale-shape"],
  ["a matrix whose subjects kind is a tag", mat({ kind: "tag" }), "weighing-matrix-shape"],
  ["a matrix whose subjects is empty", mat({}), "weighing-matrix-shape"],
  ["a matrix with a numeric status", { sets: [], matrices: [{ id: "m", set: "value-contribution@1", subjects: { kind: "query", species: "acceptance" }, status: 5 }], assessments: [] }, "weighing-set-status"],
];
for (const [name, weighing, rule] of bad) {
  const parsed = ProjectBundleSchema.safeParse({ ...base, weighing }).success;
  let rules = [];
  let threw = "";
  try {
    rules = warningsFor(weighing);
  } catch (error) {
    threw = error.message;
  }
  check(`${name} imports and warns ${rule}`, parsed && threw === "" && rules.includes(rule), `parsed=${parsed} threw=${threw} rules=${rules.filter((r) => r.startsWith("weighing")).join(",")}`);
}
check("only the containers block: a section that is not an object, or a list that is not an array", !ProjectBundleSchema.safeParse({ ...base, weighing: "x" }).success && !ProjectBundleSchema.safeParse({ ...base, weighing: { sets: "x" } }).success);
check("…and the validator still says so, without throwing", warningsFor("x").includes("weighing-section-shape") && warningsFor({ sets: "x" }).includes("weighing-section-shape"));
check("a bad row survives a parse round trip untouched", (() => {
  const weighing = { sets: [], matrices: [], assessments: [{ ...good, level: "2", confidence: { a: 1 }, scorer: "alexis", extra: [1, 2] }, null, 5] };
  return eq(ProjectBundleSchema.parse({ ...base, weighing }).weighing, weighing);
})());
check("a clean assessment with a valid ts raises no assessment warning", rulesOf({ sets: [], matrices: [], assessments: [good] }).length === 0);

// --- The readers skip what cannot be addressed -------------------------------

check("readWeighingAssessments keeps only rows with string keys, in order", readWeighingAssessments({ assessments: [null, good, 5, { ...good, criterion: 3 }, { ...good, subject: "AC-b" }] }).map((r) => r.subject).join() === "AC-a,AC-b" && readWeighingAssessments(undefined).length === 0 && readWeighingAssessments({}).length === 0);
check("isWeighingAssessmentShape", isWeighingAssessmentShape(good) && !isWeighingAssessmentShape(null) && !isWeighingAssessmentShape([]) && !isWeighingAssessmentShape({ ...good, matrix: undefined }));
check("assessmentKey and the sort never throw on a null or half-empty row", (() => {
  try {
    assessmentKey(null);
    return sortWeighingAssessments([null, good, { subject: 1 }, 5]).filter((r) => r === good).length === 1 && sortWeighingAssessments([null, good])[0] === good;
  } catch {
    return false;
  }
})());

// --- Status: absent or "active" is active; anything else is a draft ---------

check("a set with no status is active", isActiveWeighingSet({ id: "positioning" }) === true);
check("status active is active", isActiveWeighingSet({ status: "active" }) === true);
check("status draft is a draft", isActiveWeighingSet({ status: "draft" }) === false);
check("status Draft (mistyped) is a draft, so it feeds no roll-up", isActiveWeighingSet({ status: "Draft" }) === false);
check("status archived is a draft", isActiveWeighingSet({ status: "archived" }) === false);
check("a non-string status is a draft", isActiveWeighingSet({ status: 5 }) === false && isActiveWeighingSet({ status: null }) === false);
check("only draft and active are valid spellings", !warningsFor(asPos({ status: "active" })).includes("weighing-set-status") && !warningsFor(asPos({ status: "draft" })).includes("weighing-set-status") && warningsFor(asPos({ status: "archived" })).includes("weighing-set-status"));

// --- A positioning needs no scale -------------------------------------------

check("a positioning with no scale is well-formed", isWeighingSetShape(pos) && !("scale" in pos));
check("…and raises no warning", rulesOf({ sets: [pos], matrices: [], assessments: [] }).length === 0);
check("…it uses its ruler's scale", weighingScaleOf(pos, resolveWeighing({ sets: [pos] })) === set.scale);
check("a set that is not a positioning still needs a scale", !isWeighingSetShape({ id: "s", version: "1.0.0", criteria: [] }) && isWeighingSetShape({ id: "s", version: "1.0.0", criteria: [], scale: set.scale }));
check("a set needs a string version", !isWeighingSetShape({ ...pos, version: undefined }) && !isWeighingSetShape({ ...pos, version: 1 }));
check("a matrix needs a string id, a string set and a known subjects kind", isWeighingMatrixShape({ id: "m", set: "s@1", subjects: { kind: "list", items: [] } }) && !isWeighingMatrixShape({ id: "m", set: "s@1", subjects: { kind: "tag" } }) && !isWeighingMatrixShape({ set: "s@1", subjects: { kind: "query" } }));

check("a query matrix names a species and a list matrix has items", !isWeighingMatrixShape({ id: "m", set: "s@1", subjects: { kind: "query" } }) && !isWeighingMatrixShape({ id: "m", set: "s@1", subjects: { kind: "list" } }) && isWeighingMatrixShape({ id: "m", set: "s@1", subjects: { kind: "query", species: "acceptance" } }));
check("a project set's unusable criteria are dropped from its resolved copy, so it is clean to walk", (() => {
  const own = { id: "rubric", version: "1.0.0", scale: set.scale, criteria: [null, { id: "a" }, { weight: 2 }, 7, { id: "b" }] };
  const resolvedSet = resolveWeighing({ sets: [own] }).sets.find((s) => s.id === "rubric");
  return eq(resolvedSet.criteria.map((c) => c.id), ["a", "b"]) && own.criteria.length === 5;
})());

check("a project set whose scale has no anchors falls back: to its ruler's scale, then to the signed one", (() => {
  const noAnchors = { id: "rubric", version: "1.0.0", criteria: [], scale: { min: -3, max: 3 } };
  const bareMinMax = { ...pos, scale: { anchors: {} } };
  return (
    weighingScaleOf(noAnchors, resolveWeighing({ sets: [noAnchors] })) === set.scale &&
    typeof weighingScaleOf(noAnchors).anchors === "object" &&
    weighingScaleOf(bareMinMax, resolveWeighing({ sets: [bareMinMax] })) === set.scale &&
    weighingScaleOf({ ...pos, scale: set.scale }) === set.scale
  );
})());
check("resolveWeighing reports what it dropped, with kind, id and stored index", (() => {
  const okSet = { id: "ok", version: "1.0.0", scale: set.scale, criteria: [] };
  const okMatrix = { id: "m", set: "value-contribution@1", subjects: { kind: "query", species: "acceptance" } };
  const r = resolveWeighing({
    sets: [okSet, { id: "positioning", role: "positioning" }, null, { ...okSet }, { ...set, version: "9.0.0" }],
    matrices: [okMatrix, { id: "m2" }, { ...okMatrix }, 5],
  });
  return eq(r.skipped, [
    { kind: "set", id: "positioning", role: "positioning", index: 1 },
    { kind: "set", index: 2 },
    { kind: "set", id: "ok", index: 3 },
    { kind: "set", id: "value-contribution", index: 4 },
    { kind: "matrix", id: "m2", index: 1 },
    { kind: "matrix", id: "m", index: 2 },
    { kind: "matrix", index: 3 },
  ]);
})());
check("nothing dropped means an empty skipped list", resolveWeighing(undefined).skipped.length === 0 && resolveWeighing({ sets: [pos] }).skipped.length === 0);

// --- "The first wins" is true ------------------------------------------------

const dup = (title) => ({ id: "rubric", version: "1.0.0", subject: "acceptance", scale: set.scale, criteria: [], title });
check("two well-formed sets with one id: the first wins, and the warning says exactly that", (() => {
  const weighing = { sets: [dup("first"), dup("second")], matrices: [], assessments: [] };
  const finding = validateBundle({ ...base, weighing }).warnings.find((w) => w.rule === "weighing-duplicate-set");
  return resolveWeighing(weighing).sets.find((s) => s.id === "rubric").title === "first" && finding !== undefined && /first well-formed one wins/.test(finding.message) && finding.path === "weighing.sets[1].id";
})());
check("a malformed earlier set does not shadow a good later one, and raises no duplicate warning", (() => {
  const weighing = { sets: [{ id: "rubric" }, dup("good")], matrices: [], assessments: [] };
  return resolveWeighing(weighing).sets.find((s) => s.id === "rubric")?.title === "good" && !warningsFor(weighing).includes("weighing-duplicate-set");
})());
check("the same holds for matrices", (() => {
  const okMatrix = (title) => ({ id: "m", title, set: "value-contribution@1", subjects: { kind: "query", species: "acceptance" } });
  const first = { sets: [], matrices: [okMatrix("first"), okMatrix("second")], assessments: [] };
  const shadow = { sets: [], matrices: [{ id: "m" }, okMatrix("good")], assessments: [] };
  return (
    resolveWeighing(first).matrices.find((m) => m.id === "m").title === "first" &&
    warningsFor(first).includes("weighing-duplicate-matrix") &&
    resolveWeighing(shadow).matrices.find((m) => m.id === "m")?.title === "good" &&
    !warningsFor(shadow).includes("weighing-duplicate-matrix")
  );
})());

check("none of this is an error — warnings never block an import", validateBundle({ ...base, weighing: { ...section, assessments: [row({ criterion: "teleports", level: 9 })] } }).valid === true);
check("a bundle with no weighing section raises no weighing finding", validateBundle(base).findings.every((f) => !f.rule.startsWith("weighing")));
```

- [x] **Step 2: Run it to verify it fails**

Run: `node tests/schema/weighing.test.js`
Expected: FAIL — `FAIL: an unknown criterion warns` (no rule fires yet) and the rest of the "validator" checks.

- [x] **Step 3: Write `packages/schema/src/weighing-validate.ts`**

```ts
/**
 * The weighing section's validator rules — warnings only, never import-blocking.
 *
 * Same leniency doctrine as the Kritik block in {@link ./validate}: a weighing
 * section is written by scorers and edited by hand between them, so a set the
 * project retired, a cell scored on an acceptance since deleted, a level a
 * scorer got wrong — all of them are ordinary states of a living section, and
 * none may fail an import or a CI gate. Every projection already degrades to a
 * blank cell.
 *
 * Kept in its own zod-free module so `validate.ts` (which the standalone
 * validator bundles) grows by a call, not by a hundred lines.
 */

import {
  BUILT_IN_MATRICES,
  BUILT_IN_SETS,
  POSITIONING_SET_ID,
  isWeighingMatrixShape,
  isWeighingSetShape,
  resolveWeighing,
  setOfRef,
  weighingScaleOf,
} from "./weighing-library";
import {
  WEIGHING_ASSESSMENT_RECORDED,
  WEIGHING_SET_SAVED,
  SCORER_KINDS,
  STORED_SCORER_KINDS,
  assessmentKey,
  isWeighingAssessmentShape,
  majorOf,
  splitSetRef,
  type WeighingSection,
} from "./weighing";

export interface WeighingFinding {
  path: string;
  rule: string;
  message: string;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Check a `weighing` section against the graph it sits in.
 *
 * @param nodeSpecies node id → species, for the "subject is an acceptance" check.
 * @param journal the bundle's embedded journal, for the actor check on `weighing.*` events.
 */
export function validateWeighingSection(
  section: unknown,
  nodeSpecies: ReadonlyMap<string, string>,
  journal: readonly unknown[],
): WeighingFinding[] {
  const out: WeighingFinding[] = [];
  const warn = (path: string, rule: string, message: string) => out.push({ path, rule, message });

  if (section !== undefined && section !== null && !isObject(section)) {
    warn("weighing", "weighing-section-shape", "The weighing section is not an object — it is ignored");
  }

  if (isObject(section)) {
    for (const list of ["sets", "matrices", "assessments"] as const) {
      if (section[list] !== undefined && !Array.isArray(section[list])) {
        warn(`weighing.${list}`, "weighing-section-shape", `weighing.${list} is not an array — it is ignored`);
      }
    }
    const sets = Array.isArray(section.sets) ? section.sets : [];
    const matrices = Array.isArray(section.matrices) ? section.matrices : [];
    const assessments = Array.isArray(section.assessments) ? section.assessments : [];
    const resolved = resolveWeighing(section as Partial<WeighingSection>);

    /**
     * Resolve a set ref, and say why when it does not: the set is not in the
     * library at all, or it is but at another major (levels are comparable only
     * within a major). Warns once, at `path`, and returns the set or undefined.
     */
    const resolveRef = (ref: string, path: string, who: string, unknownRule: string) => {
      const set = setOfRef(resolved, ref);
      if (set !== undefined) return set;
      const named = resolved.sets.find((candidate) => candidate.id === splitSetRef(ref).id);
      if (named !== undefined) {
        warn(path, "weighing-set-ref-major", `${who} names ${ref}, but "${named.id}" is at ${named.version} — levels are comparable only within a major, so the ref resolves to nothing`);
      } else {
        warn(path, unknownRule, `${who} names set "${ref}", which is neither built in nor in this section`);
      }
      return undefined;
    };
    // The ids a matrix points its positioning at — the one id a positioning set may carry.
    const positioningIds = new Set(
      resolved.matrices.map((matrix) => matrix.positioning).filter((id): id is string => typeof id === "string"),
    );
    const checkStatus = (path: string, who: string, entry: Record<string, unknown>) => {
      if (entry.status !== undefined && entry.status !== "draft" && entry.status !== "active") {
        warn(`${path}.status`, "weighing-set-status", `${who}: status ${JSON.stringify(entry.status)} is not "draft" or "active" — it is read as a draft, which feeds no roll-up`);
      }
    };
    const isLevelMap = (value: unknown) => isObject(value) && Object.values(value).every((anchor) => typeof anchor === "string");

    // Pinned built-ins are library content: a project cannot redefine them.
    // Only shape-valid entries are counted for "the first wins", because only
    // those can win: a malformed earlier entry never shadows a good later one.
    const seenSets = new Set<string>();
    sets.forEach((entry, index) => {
      const path = `weighing.sets[${index}]`;
      if (!isObject(entry)) {
        warn(path, "weighing-set-shape", "A set is not an object — it is ignored");
        return;
      }
      const who = `Set "${String(entry.id)}"`;
      const wellFormed = isWeighingSetShape(entry);
      if (!wellFormed) {
        warn(path, "weighing-set-shape", `${who} needs a string id and version, a criteria array and a scale object (a positioning may leave the scale out) — it is ignored`);
      }
      if (typeof entry.id === "string") {
        if (BUILT_IN_SETS.some((set) => set.id === entry.id)) {
          warn(`${path}.id`, "weighing-pinned-set-redefined", `${who} is built in and pinned by version — the project's copy is ignored`);
        } else if (wellFormed) {
          if (seenSets.has(entry.id)) warn(`${path}.id`, "weighing-duplicate-set", `Duplicate set id "${entry.id}" — the first well-formed one wins, this one is ignored`);
          seenSets.add(entry.id);
        }
      }
      checkStatus(path, who, entry);

      if (isObject(entry.scale)) {
        const scale = entry.scale;
        if (typeof scale.min !== "number" || typeof scale.max !== "number" || !isLevelMap(scale.anchors)) {
          warn(`${path}.scale`, "weighing-scale-shape", `${who}: a scale needs a numeric min and max and an anchors object of strings`);
        }
      }
      if (Array.isArray(entry.criteria)) {
        entry.criteria.forEach((criterion, at) => {
          const cpath = `${path}.criteria[${at}]`;
          if (!isObject(criterion) || typeof criterion.id !== "string" || (criterion.anchors !== undefined && !isLevelMap(criterion.anchors))) {
            warn(cpath, "weighing-criterion-shape", `${who}: criterion ${at} needs a string id, and its anchors (if any) must be an object of strings`);
          }
        });
      }

      // A positioning is found by its id (docs/rfcs/weighing.md § 9): slice 1 fixes it
      // at the id the matrices point to, so a renamed one would silently never apply.
      if (entry.role === "positioning" && !(typeof entry.id === "string" && positioningIds.has(entry.id))) {
        warn(`${path}.id`, "weighing-positioning-id", `A positioning set must have the id "${POSITIONING_SET_ID}" (the one a matrix points at) — "${String(entry.id)}" would never be applied`);
      } else if (entry.role !== "positioning" && entry.id === POSITIONING_SET_ID) {
        warn(`${path}.role`, "weighing-positioning-id", `Set "${POSITIONING_SET_ID}" is where a matrix looks for its positioning, but its role is ${JSON.stringify(entry.role)}, not "positioning" — it would never be applied`);
      }

      if (entry.role === "positioning") {
        const ruler =
          typeof entry.extends === "string"
            ? resolveRef(entry.extends, `${path}.extends`, `Positioning "${String(entry.id)}"`, "weighing-positioning-unknown-ruler")
            : undefined;
        if (typeof entry.extends !== "string") {
          warn(`${path}.extends`, "weighing-positioning-unknown-ruler", `Positioning "${String(entry.id)}" does not say which set it re-weights — set extends to e.g. value-contribution@1`);
        } else if (ruler !== undefined && ruler.role === "positioning") {
          warn(`${path}.extends`, "weighing-positioning-unknown-ruler", `Positioning "${String(entry.id)}" extends "${entry.extends}", which is itself a positioning — it must extend a criteria set such as value-contribution@1`);
        }
        const known = new Set(ruler !== undefined && ruler.role !== "positioning" ? ruler.criteria.map((criterion) => criterion?.id) : []);
        (Array.isArray(entry.criteria) ? entry.criteria : []).forEach((criterion, at) => {
          if (!isObject(criterion)) return;
          const cpath = `${path}.criteria[${at}]`;
          if (known.size > 0 && typeof criterion.id === "string" && !known.has(criterion.id)) {
            warn(`${cpath}.id`, "weighing-positioning-unknown-element", `Positioning names "${criterion.id}", which is not in ${String(entry.extends)}`);
          }
          if (criterion.weight !== undefined && (typeof criterion.weight !== "number" || !(criterion.weight > 0))) {
            warn(`${cpath}.weight`, "weighing-positioning-weight", `Positioning weight for "${String(criterion.id)}" must be a number above 0 — leave the element out to leave it unpositioned`);
          }
        });
      }
    });

    const seenMatrices = new Set<string>();
    matrices.forEach((entry, index) => {
      const path = `weighing.matrices[${index}]`;
      if (!isObject(entry)) {
        warn(path, "weighing-matrix-shape", "A matrix is not an object — it is ignored");
        return;
      }
      const who = `Matrix "${String(entry.id)}"`;
      const wellFormed = isWeighingMatrixShape(entry);
      if (!wellFormed) {
        warn(path, "weighing-matrix-shape", `${who} needs a string id, a set ref and a subjects object of kind query or list — it is ignored`);
      }
      if (typeof entry.id === "string") {
        if (BUILT_IN_MATRICES.some((matrix) => matrix.id === entry.id)) {
          warn(`${path}.id`, "weighing-pinned-matrix-redefined", `${who} is built in — the project's copy is ignored`);
        } else if (wellFormed) {
          if (seenMatrices.has(entry.id)) warn(`${path}.id`, "weighing-duplicate-matrix", `Duplicate matrix id "${entry.id}" — the first well-formed one wins, this one is ignored`);
          seenMatrices.add(entry.id);
        }
      }
      checkStatus(path, who, entry);
      if (wellFormed) resolveRef(entry.set, `${path}.set`, who, "weighing-unknown-set");
    });

    const seenCells = new Set<string>();
    assessments.forEach((entry, index) => {
      const path = `weighing.assessments[${index}]`;
      const label = `Assessment ${index}`;
      if (!isWeighingAssessmentShape(entry)) {
        warn(path, "weighing-assessment-shape", `${label}: not an object with a string matrix, subject and criterion — it cannot be addressed, so every reader skips it`);
        return;
      }
      if (typeof entry.ts !== "string" || Number.isNaN(Date.parse(entry.ts))) {
        warn(`${path}.ts`, "weighing-assessment-ts", `${label}: ts must be an ISO 8601 string — without it "latest wins" cannot order this row`);
      }
      const matrix = resolved.matrices.find((candidate) => candidate.id === entry.matrix);
      if (matrix === undefined) {
        warn(`${path}.matrix`, "weighing-unknown-matrix", `${label}: matrix "${entry.matrix}" is not defined`);
      }
      // A matrix whose ref resolves to nothing was already warned about once, at the matrix.
      const set = matrix === undefined ? undefined : setOfRef(resolved, matrix.set);
      const criterion = set?.criteria.find((candidate) => candidate?.id === entry.criterion);
      if (set !== undefined && criterion === undefined) {
        warn(`${path}.criterion`, "weighing-unknown-criterion", `${label}: criterion "${entry.criterion}" is not in set "${set.id}"`);
      }
      if (criterion !== undefined && typeof criterion.superseded_by === "string" && criterion.superseded_by !== "") {
        warn(`${path}.criterion`, "weighing-retired-criterion", `${label}: criterion "${criterion.id}" is retired — superseded by "${criterion.superseded_by}"`);
      }
      const scale = set === undefined ? undefined : weighingScaleOf(set, resolved);
      const min = typeof scale?.min === "number" ? scale.min : -3;
      const max = typeof scale?.max === "number" ? scale.max : 3;
      if (typeof entry.level !== "number" || !Number.isInteger(entry.level) || entry.level < min || entry.level > max) {
        warn(`${path}.level`, "weighing-level-range", `${label}: level must be an integer ${min}..${max} (a blank cell is the absence of the row; 0 means weighed and unrelated)`);
      }
      if (![0, 1, 2, 3].includes(entry.confidence as number)) {
        warn(`${path}.confidence`, "weighing-confidence-range", `${label}: confidence must be 0, 1, 2 or 3`);
      }
      const scorer = isObject(entry.scorer) ? entry.scorer : undefined;
      if (scorer === undefined || typeof scorer.kind !== "string" || typeof scorer.id !== "string" || scorer.id === "") {
        warn(`${path}.scorer`, "weighing-scorer-missing", `${label}: no scorer with a string kind and id — human, agent and rule levels become indistinguishable, and the row can win no cell`);
      } else if (!(SCORER_KINDS as readonly string[]).includes(scorer.kind)) {
        warn(`${path}.scorer.kind`, "weighing-scorer-kind", `${label}: scorer kind "${scorer.kind}" is not one of ${SCORER_KINDS.join(", ")} — it ranks below every other scorer`);
      } else if (!(STORED_SCORER_KINDS as readonly string[]).includes(scorer.kind)) {
        warn(`${path}.scorer.kind`, "weighing-rule-stored", `${label}: scorer kind "${scorer.kind}" is never stored — a seeding rule is computed on read`);
      }
      if (matrix?.subjects.kind === "query") {
        const species = nodeSpecies.get(entry.subject);
        if (species === undefined) {
          warn(`${path}.subject`, "weighing-unknown-subject", `${label}: subject "${entry.subject}" is not a node in this bundle`);
        } else if (species !== matrix.subjects.species) {
          warn(`${path}.subject`, "weighing-subject-species", `${label}: subject "${entry.subject}" is a ${species}, and matrix "${matrix.id}" judges ${String(matrix.subjects.species)} nodes`);
        }
      }
      if (entry.evidence !== undefined && typeof entry.evidence !== "string") {
        warn(`${path}.evidence`, "weighing-evidence-type", `${label}: evidence must be a markdown string`);
      } else if ((entry.confidence === 2 || entry.confidence === 3) && (entry.evidence === undefined || entry.evidence.trim() === "")) {
        warn(`${path}.evidence`, "weighing-no-evidence", `${label}: confidence ${String(entry.confidence)} claims evidence and cites none`);
      }
      if (entry.refs !== undefined && !(Array.isArray(entry.refs) && entry.refs.every((ref) => typeof ref === "string"))) {
        warn(`${path}.refs`, "weighing-refs-type", `${label}: refs must be an array of id strings`);
      }
      if (
        entry.basis !== undefined &&
        !(isObject(entry.basis) && ["fingerprint", "commit", "set_version"].every((key) => (entry.basis as Record<string, unknown>)[key] === undefined || typeof (entry.basis as Record<string, unknown>)[key] === "string"))
      ) {
        warn(`${path}.basis`, "weighing-basis-shape", `${label}: basis must be an object whose fingerprint, commit and set_version are strings`);
      }
      if (scorer !== undefined && typeof scorer.kind === "string") {
        const key = assessmentKey(entry);
        if (seenCells.has(key)) {
          warn(path, "weighing-duplicate-assessment", `${label}: a second ${scorer.kind} score for the same cell — the section stores latest-per-scorer-kind, so this cell is ambiguous`);
        }
        seenCells.add(key);
      }
      const setVersion = isObject(entry.basis) && typeof entry.basis.set_version === "string" ? entry.basis.set_version : undefined;
      if (set !== undefined && setVersion !== undefined && majorOf(setVersion) !== majorOf(set.version)) {
        warn(`${path}.basis.set_version`, "weighing-set-major", `${label}: scored against ${set.id} ${setVersion}, and the set is now ${set.version} — levels are comparable only within a major`);
      }
    });
  }

  journal.forEach((entry, index) => {
    if (!isObject(entry)) return;
    const type = typeof entry.type === "string" ? entry.type : "";
    if (type !== WEIGHING_ASSESSMENT_RECORDED && type !== WEIGHING_SET_SAVED) return;
    if (typeof entry.actor !== "string" || entry.actor.trim() === "") {
      warn(`journal[${index}].actor`, "weighing-event-no-actor", `Journal event ${index}: ${type} has no actor — human, agent and CI scores become indistinguishable`);
    }
  });

  return out;
}
```

- [x] **Step 4: Call it from `validateBundle`**

```diff
--- a/packages/schema/src/validate.ts
+++ b/packages/schema/src/validate.ts
@@ -17,6 +17,7 @@
 import { isBuiltInMapId, MAP_FLOW_PLATFORMS_MODES, MAP_MINIMAP_COLOR_MODES, MAP_VIEW_PLATFORMS_MODES } from "./maps";
 import { PRODUCT_MEMBERSHIP_SPECIES, resolveProducts } from "./products";
 import { CROSS_SURFACE_ID } from "./quality";
+import { validateWeighingSection } from "./weighing-validate";
 
 /**
  * Semantic validation for Arkaik ProjectBundles.
@@ -1122,6 +1123,19 @@
         }
       }
     });
+  }
+
+  // --- Weighing section (docs/rfcs/weighing.md) ---
+  // Warning severity only, for the reason the Kritik block above gives: the
+  // section is written by scorers and edited by hand between them. Runs when a
+  // section is carried OR a `weighing.*` event is embedded, because an event
+  // with no actor is a finding with no section behind it.
+  const weighing = (bundle as { weighing?: unknown }).weighing;
+  const embeddedJournal = Array.isArray((bundle as { journal?: unknown }).journal) ? ((bundle as { journal?: unknown[] }).journal as unknown[]) : [];
+  const weighingSpecies = new Map<string, string>();
+  for (const [id, node] of nodeMap) weighingSpecies.set(id, String(node.species));
+  for (const finding of validateWeighingSection(weighing, weighingSpecies, embeddedJournal)) {
+    warn(finding.path, finding.rule, finding.message);
   }
 
   // --- Snapshot ↔ journal cross-checks (Format Level 2, docs/spec/journal.md) ---
```

- [x] **Step 5: Export it**

In `packages/schema/src/index.ts`, after `export * from "./weighing-library";` add `export * from "./weighing-validate";`.

- [x] **Step 6: Run the tests**

Run: `node tests/schema/weighing.test.js && npm run test:schema && npm run test:journal && npm run test:quality && npx tsc --noEmit -p . && npx eslint packages/schema/src`
Expected: all pass (`All weighing tests passed.` — 159 `PASS:` lines in total), `tsc` and `eslint` silent.

- [x] **Step 7: Commit**

```bash
git add packages/schema/src/weighing-validate.ts packages/schema/src/validate.ts packages/schema/src/index.ts tests/schema/weighing.test.js
git commit -m "feat(weighing): validator warnings — never import-blocking (part 1/5)"
```

### Task 1.4: Publik withholds the section by default

**Files:**
- Modify: `lib/services/publik.ts`, `app/api/publik/route.ts`
- Modify: `tests/services/publik-strip.test.js`

- [x] **Step 1: Write the failing test**

Apply to `tests/services/publik-strip.test.js` (the diff adds a `weighing` section to the fixture bundle and a block of checks):

```diff
--- a/tests/services/publik-strip.test.js
+++ b/tests/services/publik-strip.test.js
@@ -32,7 +32,7 @@
 }
 
 const { publik } = loadPublikApi();
-const { stripJournal, stripQuality } = publik;
+const { stripJournal, stripQuality, stripWeighing } = publik;
 
 const bundle = () => ({
   schema_version: 3,
@@ -40,6 +40,11 @@
   nodes: [{ id: "V-a", project_id: "p", species: "view", title: "A", status: "live", platforms: ["web"] }],
   edges: [],
   journal: [{ id: "01A", ts: "2026-01-01T00:00:00.000Z", type: "node.created", node_id: "V-a", species: "view", title: "A" }],
+  weighing: {
+    sets: [{ id: "positioning", version: "1.0.0", subject: "acceptance", role: "positioning", scale: { min: -3, max: 3, anchors: {} }, criteria: [{ id: "reduces-anxiety", weight: 3 }] }],
+    matrices: [],
+    assessments: [{ matrix: "value", subject: "V-a", criterion: "reduces-anxiety", level: -2, scorer: { kind: "human", id: "alexis" }, confidence: 2, evidence: "the consent page worries people", ts: "2026-11-15T10:00:00.000Z" }],
+  },
   quality: {
     framework_version: "0.1.0",
     profile: { surfaces: [{ id: "web", title: "Web" }] },
@@ -71,6 +76,30 @@
 const neither = stripQuality(stripJournal(bundle()));
 check("the default withholds both", !("journal" in neither) && !("quality" in neither) && neither.nodes.length === 1);
 
+// --- stripWeighing -----------------------------------------------------------
+
+const withoutWeighing = stripWeighing(bundle());
+const everythingButWeighing = { ...bundle() };
+delete everythingButWeighing.weighing;
+check("stripWeighing removes the weighing section", !("weighing" in withoutWeighing));
+check("stripWeighing keeps every other key verbatim", JSON.stringify(withoutWeighing) === JSON.stringify(everythingButWeighing));
+check("stripWeighing does not mutate its input", (() => { const input = bundle(); stripWeighing(input); return "weighing" in input; })());
+check("stripWeighing on a bundle with no weighing section is a no-op", (() => {
+  const plain = stripWeighing({ project: { id: "p" }, nodes: [], edges: [] });
+  return !("weighing" in plain) && plain.project.id === "p";
+})());
+check("opting into the quality section does not publish weighing", (() => {
+  const onlyQuality = stripWeighing(stripJournal(bundle()));
+  return "quality" in onlyQuality && !("weighing" in onlyQuality);
+})());
+check("opting into weighing does not publish the quality section or the journal", (() => {
+  const onlyWeighing = stripQuality(stripJournal(bundle()));
+  return "weighing" in onlyWeighing && !("quality" in onlyWeighing) && !("journal" in onlyWeighing);
+})());
+const allThree = stripWeighing(stripQuality(stripJournal(bundle())));
+check("the default withholds all three", !("journal" in allThree) && !("quality" in allThree) && !("weighing" in allThree) && allThree.nodes.length === 1);
+check("no assessment evidence survives the default strip", !JSON.stringify(allThree).includes("the consent page worries people"));
+
 // --- what the default actually protects --------------------------------------
 
 check("no finding evidence survives the default strip", !JSON.stringify(neither).includes("middleware.ts:12"));
```

- [x] **Step 2: Run it to verify it fails**

Run: `npm run test:publik-strip`
Expected: FAIL — `TypeError: stripWeighing is not a function`.

- [x] **Step 3: Implement the strip and the opt-in**

```diff
--- a/lib/services/publik.ts
+++ b/lib/services/publik.ts
@@ -172,7 +172,7 @@
 }
 
 // ---------------------------------------------------------------------------
-// Default withholds (journal, quality)
+// Default withholds (journal, quality, weighing)
 // ---------------------------------------------------------------------------
 
 /**
@@ -197,6 +197,22 @@
 export function stripQuality(bundle: Record<string, unknown>): Record<string, unknown> {
   const { quality: _quality, ...rest } = bundle;
   void _quality;
+  return rest;
+}
+
+/**
+ * Remove the `weighing` section from a bundle, returning a shallow copy with
+ * every other key preserved verbatim. Same server-side enforcement as the
+ * strips above, for the same family of reason: a weighing section holds a
+ * product's positioning, what it scores each promise against its own values,
+ * and the costs it has admitted — "this consent page works against reducing
+ * anxiety" is a sentence a product keeps to itself until it chooses
+ * otherwise. Opt-in only (`?include_weighing=true`), never client-decided, and
+ * opting into the journal or the quality section never implies it.
+ */
+export function stripWeighing(bundle: Record<string, unknown>): Record<string, unknown> {
+  const { weighing: _weighing, ...rest } = bundle;
+  void _weighing;
   return rest;
 }
 
```

```diff
--- a/app/api/publik/route.ts
+++ b/app/api/publik/route.ts
@@ -9,13 +9,14 @@
   storeSnapshot,
   stripJournal,
   stripQuality,
+  stripWeighing,
   validateInboundBundle,
 } from "@/lib/services/publik";
 
 /**
  * POST /api/publik — create an anonymous snapshot (docs/spec/services.md §
- * Publik → Protocol). Validates through @arkaik/schema, strips the journal and
- * the quality section by default, rate-limits per IP in Postgres, and returns `201 { id, url, owner_key }`
+ * Publik → Protocol). Validates through @arkaik/schema, strips the journal, the
+ * quality section and the weighing section by default, rate-limits per IP in Postgres, and returns `201 { id, url, owner_key }`
  * with the owner key delivered exactly once.
  *
  * Node runtime: the `pg` driver needs Node APIs, not the edge runtime.
@@ -71,18 +72,22 @@
       );
     }
 
-    // 5. Journal + quality strips, enforced server-side (§ "Journal stripped by
-    //    default"; docs/rfcs/kritik.md § 8.3 for quality). Both operate on the
+    // 5. Journal + quality + weighing strips, enforced server-side (§ "Journal
+    //    stripped by default"; docs/rfcs/kritik.md § 8.3 for quality;
+    //    docs/rfcs/weighing.md for weighing). All three operate on the
     //    vocabulary-migrated bundle the gate returned — that is what gets
     //    stored, so a legacy-vocabulary snapshot is never persisted. Each opts
-    //    in separately: publishing your history and publishing your open
-    //    security findings are not the same decision.
+    //    in separately: publishing your history, publishing your open security
+    //    findings and publishing what you think your promises cost are not the
+    //    same decision.
     const params = new URL(req.url).searchParams;
     const includeJournal = params.get("include_journal") === "true";
     const includeQuality = params.get("include_quality") === "true";
+    const includeWeighing = params.get("include_weighing") === "true";
     const bundle = validation.bundle;
     const withJournal = includeJournal ? bundle : stripJournal(bundle);
-    const toStore = includeQuality ? withJournal : stripQuality(withJournal);
+    const withQuality = includeQuality ? withJournal : stripQuality(withJournal);
+    const toStore = includeWeighing ? withQuality : stripWeighing(withQuality);
 
     // 6. Store (immutable) and return id + one-time owner key.
     const { id, ownerKey } = await storeSnapshot(toStore);
```

- [x] **Step 4: Run the tests**

Run: `npm run test:publik-strip && npx tsc --noEmit -p . && npx eslint lib/services/publik.ts app/api/publik/route.ts`
Expected: `All Publik strip tests passed` (17 `PASS:` lines), `tsc` and `eslint` silent.

- [x] **Step 5: Commit**

```bash
git add lib/services/publik.ts app/api/publik/route.ts tests/services/publik-strip.test.js
git commit -m "feat(weighing): Publik withholds the weighing section unless asked (part 1/5)"
```

### Task 1.5: Pin the two copies of the element labels together

The library carries its own copy of the 30 labels and definitions (the MCP server and the CLI cannot import `lib/config/values.ts`). This test makes drift fail.

**Files:**
- Modify: `tests/app/value-icons.test.js`

- [x] **Step 1: Add the checks**

```diff
--- a/tests/app/value-icons.test.js
+++ b/tests/app/value-icons.test.js
@@ -1,4 +1,5 @@
 const { loadValueIcons, BUILD_DIR } = require("./load-value-icons");
+const { loadSchema } = require("../schema/load-schema");
 const fs = require("fs");
 
 let failures = 0;
@@ -19,6 +20,17 @@
   VALUES.every((v) => { const c = VALUE_ICON_COMPONENTS[v.id]; return c && c.displayName === v.icon; }),
   VALUES.filter((v) => VALUE_ICON_COMPONENTS[v.id]?.displayName !== v.icon).map((v) => v.id).join(", "));
 
+// The weighing library (packages/schema/src/weighing-library.ts) carries its own copy of the
+// element labels and definitions, because the MCP server and the CLI cannot import lib/.
+// This is the pin that keeps the two copies one.
+const { VALUE_CONTRIBUTION_SET } = loadSchema();
+check("the weighing library's element names match lib/config/values.ts labels (no drift)",
+  VALUES.every((v) => VALUE_CONTRIBUTION_SET.criteria.find((c) => c.id === v.id)?.name === v.label),
+  VALUES.filter((v) => VALUE_CONTRIBUTION_SET.criteria.find((c) => c.id === v.id)?.name !== v.label).map((v) => v.id).join(", "));
+check("the weighing library's element definitions match lib/config/values.ts descriptions (no drift)",
+  VALUES.every((v) => VALUE_CONTRIBUTION_SET.criteria.find((c) => c.id === v.id)?.definition === v.description),
+  VALUES.filter((v) => VALUE_CONTRIBUTION_SET.criteria.find((c) => c.id === v.id)?.definition !== v.description).map((v) => v.id).join(", "));
+
 fs.rmSync(BUILD_DIR, { recursive: true, force: true });
 if (failures > 0) { console.log(`\n${failures} value-icon test(s) failed.`); process.exit(1); }
 console.log("\nAll value-icon tests passed.");
```

- [x] **Step 2: Run it**

Run: `npm run test:value-icons`
Expected: `PASS: the weighing library's element names match lib/config/values.ts labels (no drift)`, the definitions line, then `All value-icon tests passed.`

- [x] **Step 3: Prove the pin bites (then undo)**

Temporarily change `"Saves time"` to `"Saves times"` in `packages/schema/src/weighing-library.ts`, run `npm run test:value-icons`, and expect `FAIL: the weighing library's element names match … — saves-time`. Revert the edit.

- [x] **Step 4: Commit**

```bash
git add tests/app/value-icons.test.js
git commit -m "test(weighing): pin the library's element wording to lib/config/values.ts (part 1/5)"
```

### Task 1.6: Script, CI step, and the regenerated artifacts

**Files:**
- Modify: `package.json`, `.github/workflows/ci.yml`
- Regenerate: `public/schema/project-bundle.json`, `docs/arkaik-skill/scripts/validate-bundle.js`, `plugin/skills/arkaik/scripts/validate-bundle.js`

- [x] **Step 1: Add the script**

In `package.json`, directly after the `"test:quality-plan"` line, add:

```json
    "test:weighing": "node tests/schema/weighing.test.js",
```

- [x] **Step 2: Add the CI step**

In `.github/workflows/ci.yml`, after the "Kritik plan tests (grammar, cells, sort-last ids, partial ids, schema)" step and before the "Kritik webhook tests" comment block, insert (two-space YAML indentation as the neighbours):

```yaml
      # The weighing layer's model (docs/rfcs/weighing.md): the built-in value
      # library, the fingerprint staleness reads, the zod shapes and the
      # validator's warnings. Pure and DB-free like the Kritik suites above.
      - name: Weighing model tests (library, fingerprint, shapes, validator warnings)
        run: npm run test:weighing
```

- [x] **Step 3: Regenerate and look at what moved**

Run: `npm run generate && git status --short`
Expected modified: `public/schema/project-bundle.json`, `docs/arkaik-skill/scripts/validate-bundle.js`, `plugin/skills/arkaik/scripts/validate-bundle.js`. Nothing under `lib/prompts/generated`, `plugin-kritik`, `lib/landing/generated`, `docs/arkaik-skill/references/schema.md`. Run `git diff --stat public/schema/project-bundle.json` and confirm the JSON Schema gained `weighing` on `ProjectBundle` and the `$defs` `WeighingScorer`, `WeighingScale`, `WeighingGroup`, `WeighingCriterion`, `WeighingCriteriaSet`, `WeighingMatrix`, `WeighingAssessment`, `WeighingSection`.

- [x] **Step 4: Verify the drift gate is now clean**

Run: `npm run generate && git diff --exit-code -- docs/arkaik-skill/references/schema.md lib/prompts/generated plugin/.claude-plugin/plugin.json plugin/.mcp.json plugin-kritik lib/landing/generated`
Expected: exit 0 (the three changed artifacts are the ones you are about to commit).

- [x] **Step 5: Commit**

```bash
git add package.json .github/workflows/ci.yml public/schema/project-bundle.json docs/arkaik-skill/scripts/validate-bundle.js plugin/skills/arkaik/scripts/validate-bundle.js
git commit -m "chore(weighing): test script, CI step and regenerated contract artifacts (part 1/5)"
```

### Task 1.7: Document the section

**Files:**
- Modify: `docs/spec/bundle-format.md`

- [x] **Step 1: Insert § Weighing**

In `docs/spec/bundle-format.md`, immediately **before** the `## References` heading (which follows the Quality section's "Publik withholds it by default" paragraph), insert exactly:

````markdown
## Weighing

A project MAY carry a `weighing` section: the weighing layer's own state ([docs/rfcs/weighing.md](../rfcs/weighing.md)) — how much each promise is worth, according to whom, and how sure. It is a top-level section for the reason `quality` is: criteria are library content, not product anatomy, and 30 elements times every acceptance would drown a product graph.

```ts
interface ProjectBundle {
  // ... unchanged
  weighing?: WeighingSection;   // additive; schema_version stays 3
}

interface WeighingSection extends Record<string, unknown> {
  sets?: WeighingCriteriaSet[];          // the project's OWN sets — its positioning. The built-in value set is library content, not stored. Absent = []
  matrices?: WeighingMatrix[];           // the project's own matrices; empty in slice 1 (the built-in `value` matrix is not stored). Absent = []
  assessments?: WeighingAssessment[];    // latest per (matrix × subject × criterion × scorer kind). Absent = []
}

interface WeighingAssessment extends Record<string, unknown> {
  matrix: string;               // "value"
  subject: string;              // an acceptance id
  criterion: string;            // an element of value, e.g. "reduces-anxiety"
  level: number;                // -3..+3, whole numbers. 0 = weighed and unrelated. A blank cell is the ABSENCE of the row
  scorer?: { kind: "human" | "agent" | "rule"; id: string; model?: string; on_behalf_of?: string };  // absent on a hand-edited row: it wins no cell, and the validator warns
  confidence: 0 | 1 | 2 | 3;    // guess · inferred · evidenced · verified
  evidence?: string;            // markdown
  refs?: string[];
  basis?: { fingerprint?: string; commit?: string; set_version: string };
  run?: string;
  ts: string;
}
```

**The built-in library.** `value-contribution` (the 30 elements of value in their four tiers, each level −3..+3 described in words) and the `value` matrix (every acceptance against that set) ship in `@arkaik/schema` and are pinned by version, as Kritik's pack is. A project cannot redefine them (`validateBundle` warns).

**Signed, never netted.** +3 is core, +2 supports clearly, +1 touches, 0 is unrelated (weighed, and found to have nothing to do with it — no row at all means nobody has weighed it yet), −1 a small friction, −2 works against it, −3 costs it at its core. A promise's *served* (sum of positive levels ÷ 3) and *cost* (sum of |negative levels| ÷ 3) are derived separately and never combined: "serves 1.0 · costs 0.67", never "0.33".

**Who judged.** A human's level beats an agent's, which beats a rule's; the latest wins within a kind. The section keeps one row per cell *per scorer kind*, so both sit side by side. A `rule` is the **seeding rule** — the first claimed value in `metadata.values` reads +3, the second +2, every other +1, confidence 0, negatives never — and it is computed on read, never stored (a stored `rule` row is a warning). `scorer.on_behalf_of` is optional and says whom the scorer acts for: an opaque user id or handle, never an email, because sidecars are committed to repos. A hosted token write stamps the token owner's id; a writer that does not know stamps nothing.

**Staleness is computed, never stored.** An assessment records what its scorer looked at: `basis.fingerprint` is a hash of the acceptance's title, Gherkin and values (whitespace-normalised) — **not its status**, which is joined at read time — and `basis.set_version` the set's full version. A cell is stale when the fingerprint no longer matches or the set's major moved. Staleness flags a cell; it never changes which scorer wins.

**The positioning is a criteria set.** In slice 1 its id is fixed: `sets` may hold one set with `id: "positioning"`, `role: "positioning"`, `extends: "value-contribution@1"` and `status?: "draft" | "active"` (absent = active). Each criterion is `{ id, weight?, anchors? }`: how much the product stands on the element (absent = 1) and what each level means in the product's own words. A **draft feeds no roll-up**.

**Storage follows Kritik's rule exactly.** In a repository the sidecars under `docs/weighing/` — `sets/<set-id>.json` and `assessments/<matrix-id>.json` (`{ "matrix", "assessments": [] }`) — are canonical, and `arkaik pack` / `arkaik restore` fold them into this key; `docs/arkaik/bundle.json` is never rewritten to carry it. On a hosted project, and in a browser project, an assessment is a journal event (`weighing.assessment.recorded`) and a saved positioning is `weighing.set.saved`; every read folds them over the stored section latest-wins ([journal.md](journal.md)). `--no-weighing` opts out of the fold on `pack` and `restore`.

**Import never blocks, and the shapes are looser than Kritik's on purpose.** `QualitySectionSchema` refuses a malformed quality record; `WeighingSectionSchema` does not. A weighing section is filled at scale by agents and scorers, so one bad cell must never block importing a project. **Only the containers are strict: `weighing` must be an object, and each of `sets`, `matrices` and `assessments` — if present — must be an array.** Everything inside parses, whatever it holds:

- an item in a list may be anything (a `null` row, a number) and is skipped by every reader;
- every leaf is accepted as any value: a level of `"2"` or 3.5, a confidence of 4, a scorer that is a string or has no kind or id, a numeric `evidence`, `refs` that is a string, a `set_version` that is a number, a weight that is a string, a scale with no anchors, a status of `"Draft"`, a mistyped `role`;
- the keys a row is addressed by (`matrix`, `subject`, `criterion`, `ts` on an assessment; `id`, `version`, `subject` on a set; `id`, `set`, `subjects` on a matrix) are optional too — a record that lacks them **cannot be addressed**, which means the readers skip it and the validator warns, never that the import is refused;
- values survive a round trip untouched: nothing is coerced, stripped or defaulted.

The validator warns on each of these (`weighing-assessment-shape`, `-assessment-ts`, `-level-range`, `-confidence-range`, `-scorer-missing`, `-evidence-type`, `-refs-type`, `-basis-shape`, `-set-shape`, `-matrix-shape`, `-scale-shape`, `-criterion-shape`, `-section-shape`, …). **A reader goes through `resolveWeighing` (sets and matrices that pass their shape guard) and `readWeighingAssessments` (rows with string keys)** instead of reading the stored lists directly; both skip rather than throw.

**Status.** `status` on a set or matrix is any value in storage. Readers follow one rule: **absent or `"active"` is active, and any other present value — `"draft"`, `"Draft"`, `"archived"`, a non-string — counts as a draft**, so a draft feeds no roll-up even if its status is mistyped (`isActiveWeighingSet`). The validator warns on anything but `draft` and `active` (`weighing-set-status`).

**A positioning may have no `scale`.** It then uses its `extends` ruler's scale (`weighingScaleOf`); every other set needs one. A set needs a string `id` and `version` and a `criteria` array to be used at all.

**A scale is used only when usable** (numeric `min` and `max`, an object `anchors`); otherwise a set is read on its ruler's scale, then on the built-in signed one (`weighingScaleOf`), so `.anchors[...]` is always safe. **What `resolveWeighing` drops is reported:** its `skipped` list names the kind, id, role and stored index of every set or matrix it ignored (malformed, a built-in redefined, a duplicate), so a surface can say so instead of showing nothing.

**"The first wins" is true.** For two sets (or matrices) with one id, the first *well-formed* one wins and the later one is ignored with a `weighing-duplicate-set` (`-matrix`) warning; a malformed earlier entry never shadows a good later one, and is not counted as a duplicate.

**Validation is warnings only** (never import-blocking, per the leniency doctrine): an unknown or retired `criterion_id`, a surface absent from the profile, a duplicate score for one cell, an assessment with no evidence, a risk value outside 1-5, a `quality.*` event with no `actor`, a `quality.finding.resolved` or `quality.finding.accepted` for a finding nothing ever opened.

**Publik withholds it by default.** A quality section lists open, unfixed findings with the file paths to reach them, so `POST /api/publik` strips it exactly as it strips the journal, and for a sharper reason. `?include_quality=true` opts in; opting into the journal never implies it.


## Weighing

A project MAY carry a `weighing` section: the weighing layer's own state ([docs/rfcs/weighing.md](../rfcs/weighing.md)) — how much each promise is worth, according to whom, and how sure. It is a top-level section for the reason `quality` is: criteria are library content, not product anatomy, and 30 elements times every acceptance would drown a product graph.

```ts
interface ProjectBundle {
  // ... unchanged
  weighing?: WeighingSection;   // additive; schema_version stays 3
}

interface WeighingSection extends Record<string, unknown> {
  sets?: WeighingCriteriaSet[];          // the project's OWN sets — its positioning. The built-in value set is library content, not stored. Absent = []
  matrices?: WeighingMatrix[];           // the project's own matrices; empty in slice 1 (the built-in `value` matrix is not stored). Absent = []
  assessments?: WeighingAssessment[];    // latest per (matrix × subject × criterion × scorer kind). Absent = []
}

interface WeighingAssessment extends Record<string, unknown> {
  matrix: string;               // "value"
  subject: string;              // an acceptance id
  criterion: string;            // an element of value, e.g. "reduces-anxiety"
  level: number;                // -3..+3, whole numbers. 0 = weighed and unrelated. A blank cell is the ABSENCE of the row
  scorer?: { kind: "human" | "agent" | "rule"; id: string; model?: string; on_behalf_of?: string };  // absent on a hand-edited row: it wins no cell, and the validator warns
  confidence: 0 | 1 | 2 | 3;    // guess · inferred · evidenced · verified
  evidence?: string;            // markdown
  refs?: string[];
  basis?: { fingerprint?: string; commit?: string; set_version: string };
  run?: string;
  ts: string;
}
```

**The built-in library.** `value-contribution` (the 30 elements of value in their four tiers, each level −3..+3 described in words) and the `value` matrix (every acceptance against that set) ship in `@arkaik/schema` and are pinned by version, as Kritik's pack is. A project cannot redefine them (`validateBundle` warns).

**Signed, never netted.** +3 is core, +2 supports clearly, +1 touches, 0 is unrelated (weighed, and found to have nothing to do with it — no row at all means nobody has weighed it yet), −1 a small friction, −2 works against it, −3 costs it at its core. A promise's *served* (sum of positive levels ÷ 3) and *cost* (sum of |negative levels| ÷ 3) are derived separately and never combined: "serves 1.0 · costs 0.67", never "0.33".

**Who judged.** A human's level beats an agent's, which beats a rule's; the latest wins within a kind. The section keeps one row per cell *per scorer kind*, so both sit side by side. A `rule` is the **seeding rule** — the first claimed value in `metadata.values` reads +3, the second +2, every other +1, confidence 0, negatives never — and it is computed on read, never stored (a stored `rule` row is a warning). `scorer.on_behalf_of` is optional and says whom the scorer acts for: an opaque user id or handle, never an email, because sidecars are committed to repos. A hosted token write stamps the token owner's id; a writer that does not know stamps nothing.

**Staleness is computed, never stored.** An assessment records what its scorer looked at: `basis.fingerprint` is a hash of the acceptance's title, Gherkin and values (whitespace-normalised) — **not its status**, which is joined at read time — and `basis.set_version` the set's full version. A cell is stale when the fingerprint no longer matches or the set's major moved. Staleness flags a cell; it never changes which scorer wins.

**The positioning is a criteria set.** In slice 1 its id is fixed: `sets` may hold one set with `id: "positioning"`, `role: "positioning"`, `extends: "value-contribution@1"` and `status?: "draft" | "active"` (absent = active). Each criterion is `{ id, weight?, anchors? }`: how much the product stands on the element (absent = 1) and what each level means in the product's own words. A **draft feeds no roll-up**.

**Storage follows Kritik's rule exactly.** In a repository the sidecars under `docs/weighing/` — `sets/<set-id>.json` and `assessments/<matrix-id>.json` (`{ "matrix", "assessments": [] }`) — are canonical, and `arkaik pack` / `arkaik restore` fold them into this key; `docs/arkaik/bundle.json` is never rewritten to carry it. On a hosted project, and in a browser project, an assessment is a journal event (`weighing.assessment.recorded`) and a saved positioning is `weighing.set.saved`; every read folds them over the stored section latest-wins ([journal.md](journal.md)). `--no-weighing` opts out of the fold on `pack` and `restore`.

**Import never blocks, and the shapes are looser than Kritik's on purpose.** `QualitySectionSchema` refuses a malformed quality record; `WeighingSectionSchema` does not. A weighing section is filled at scale by agents and scorers, so one bad cell must never block importing a project: a level of 3.5, a confidence of 4, a scorer with an unknown kind or no id (or none at all), a matrix with no set, a set with no criteria or scale, and a section with some of its lists absent (read as empty) all parse, and the validator warns about each. Only what a record cannot be addressed without stays required (`matrix`, `subject`, `criterion`, `ts` on an assessment; `id` on a set or matrix). A reader must still tolerate a value the validator warned about: `resolveWeighing` skips a set or matrix it cannot use rather than throwing on it.

**Validation is warnings only** (never import-blocking): an unknown or retired criterion, an unknown matrix or set, a set ref at another major than the set (`weighing-set-ref-major`), a set or matrix too malformed to use (`weighing-set-shape`, `weighing-matrix-shape`), a level off the set's scale, a confidence outside 0–3, a missing scorer, an unknown scorer kind, a stored `rule` row, a subject that is not an acceptance of this bundle, confidence 2–3 with no evidence, two rows for one cell and scorer kind, a score taken against another major of the set, a positioning naming a non-element or a weight at or below 0, a positioning under an id other than `positioning` (or a set called `positioning` with no role), a positioning whose `extends` is missing, unknown or itself a positioning, a `weighing.*` event with no `actor`.

**Publik withholds it by default.** A weighing section holds what a product scores its own promises against its own values, and the costs it has admitted. `POST /api/publik` strips it as it strips the journal and the quality section; `?include_weighing=true` opts in, and opting into either of the others never implies it.

````

- [x] **Step 2: Check the docs gate**

Run: `npm run test:docs-visibility`
Expected: `All docs-visibility tests passed`.

- [x] **Step 3: Commit**

```bash
git add docs/spec/bundle-format.md
git commit -m "docs(weighing): the bundle format's weighing section (part 1/5)"
```

### Task 1.8: Gate and push Part 1

- [x] **Step 1: Run the gate**

Run, in order: `npm run generate && git diff --exit-code -- public/schema/project-bundle.json docs/arkaik-skill/scripts/validate-bundle.js docs/arkaik-skill/references/schema.md lib/prompts/generated plugin/.claude-plugin/plugin.json plugin/.mcp.json plugin/skills/arkaik plugin-kritik lib/landing/generated` (exit 0 — everything is committed), `npm run lint`, `npx tsc --noEmit -p .`, `npm run build`, `npm run validate:seeds`, `npm run test:fixtures`, `npm run test:schema`, `npm run test:journal`, `npm run test:quality`, `npm run test:weighing`, `npm run test:publik-strip`, `npm run test:value-icons`.
Expected: every command exits 0. (`lint` prints the two pre-existing `<img>` warnings in `ShotPreviewDialog.tsx` and no errors.)

- [ ] **Step 2: Submit**

```bash
gh stack submit --auto
```
Then read the PR's comments; if the Lab Note reminder comments, add the `no-lab-note` label.

---

## Part 2 — `weighing/2-derive`

**Goal.** Every number a matrix shows, as pure functions over `nodes` and a `WeighingSection`: the seeding rule, the level a cell reads at, served and cost per promise (never netted), the positioned variants, kept share, per-element promised/kept/cost masses, the claim-versus-assessment flags, the stale and review lists and the guesswork share. Nothing here is stored and nothing here does I/O.

**Must not touch:** anything outside `packages/schema/src/weighing-derive.ts`, `index.ts`, the new test, `package.json`, `ci.yml`.

**Reference precedent:** `packages/schema/src/quality.ts` (`deriveQualityMatrix`) and `acceptance.ts` (`resolvePlatformStatus`, `DEFAULT_DELIVERED_STATUSES`).

**The rules this part pins** (so a reviewer can read the tests as the spec):

- Seeds: first claimed value +3, second +2, the rest +1; scorer `rule` (`seed-by-claim-order`), confidence 0; **positive only**; computed, never stored; unknown or repeated values ignored.
- Effective level per cell: human > agent > seed; latest `ts` wins within a kind (a tie goes to the later row); a stored `rule` row is ignored. **Staleness never changes the winner** — it flags it; the fresh agent level rides beside a stale human one in `others`. A human and an agent two or more levels apart put the cell on the review list.
- `served` = Σ(level ÷ 3) over positive levels; `cost` = Σ(|level| ÷ 3) over negative ones. Never netted.
- `positioned` exists only with an **active** positioning; each element contributes its mass × its weight (absent weight = 1); a draft yields `null`.
- `kept_share` = platforms where the promise is live ÷ platforms it applies to; `null` for none. Pinned to `getNodePlatformStatuses` by a parity check.
- Element masses: `promised` = Σ positive ÷ 3; `kept` = the same × the promise's kept share (0 when `null`); `cost` = Σ|negative| ÷ 3; `guesswork` = the share of `promised` resting on confidence-0 cells. Archived promises count in none.

### Task 2.1: Seeding and the effective level of a cell

**Files:**
- Create: `packages/schema/src/weighing-derive.ts`
- Modify: `packages/schema/src/index.ts`
- Create: `tests/schema/weighing-derive.test.js`

- [x] **Step 1: Write the failing test**

Create `tests/schema/weighing-derive.test.js` (preamble, the first two sections, epilogue). Tasks 2.2 and 2.3 insert more sections **above** the final `fs.rmSync(…)` lines.

```js
/**
 * The weighing projections (docs/rfcs/weighing.md): seeding, the level a cell
 * reads at, served and cost per promise, positioned variants, kept share,
 * per-element masses, the claim-versus-assessment flags and the guesswork
 * share. Pure and DB-free — runs in CI's fast `build` job.
 *
 * Run: npm run test:weighing-derive
 */

const fs = require("fs");
const { loadSchema, BUILD_DIR } = require("./load-schema");
const { loadEffectiveStatus, BUILD_DIR: STATUS_BUILD_DIR } = require("../app/load-effective-status");

const {
  VALUE_CONTRIBUTION_SET,
  acceptanceFingerprint,
  seedLevelAt,
  claimedElements,
  seedAssessments,
  resolveCell,
  buildWeighingContext,
  weighPromise,
  keptShare,
  deriveWeighing,
  matrixSubjects,
  sortPromises,
  resolvePlatformStatus,
  SEED_SCORER_ID,
} = loadSchema();
const { getNodePlatformStatuses } = loadEffectiveStatus();

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`PASS: ${name}`);
  else {
    failures++;
    console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const near = (a, b) => Math.abs(a - b) < 1e-9;

const human = { kind: "human", id: "alexis" };
const agent = { kind: "agent", id: "arkaik-mcp", model: "claude" };

const ac = (id, values, over = {}) => ({
  id,
  project_id: "p",
  species: "acceptance",
  title: `Promise ${id}`,
  status: "live",
  platforms: ["web"],
  metadata: { gherkin: `Given ${id}`, values },
  ...over,
});
const row = (node, criterion, level, over = {}) => ({
  matrix: "value",
  subject: node.id,
  criterion,
  level,
  scorer: human,
  confidence: 2,
  evidence: "because",
  basis: { fingerprint: acceptanceFingerprint(node), set_version: "1.0.0" },
  ts: "2026-11-15T10:00:00.000Z",
  ...over,
});
const set = VALUE_CONTRIBUTION_SET;

// --- Seeding ----------------------------------------------------------------

check("the first claimed value seeds +3, the second +2, every other +1", eq([0, 1, 2, 3, 9].map(seedLevelAt), [3, 2, 1, 1, 1]));
const four = ac("AC-four", ["connects", "reduces-anxiety", "informs", "organizes"]);
const seeds = seedAssessments(four, { id: "value" }, set);
check("a seed is made per claimed element, in claim order", eq(seeds.map((s) => s.criterion), ["connects", "reduces-anxiety", "informs", "organizes"]) && eq(seeds.map((s) => s.level), [3, 2, 1, 1]));
check("a seed is a rule at confidence 0", seeds.every((s) => s.scorer.kind === "rule" && s.scorer.id === SEED_SCORER_ID && s.confidence === 0));
check("a seed is never negative", seeds.every((s) => s.level > 0));
check("an unknown or repeated value is not seeded", eq(claimedElements(ac("AC-x", ["connects", "teleports", "connects"]), set), ["connects"]));
check("a promise that claims nothing seeds nothing", seedAssessments(ac("AC-none", []), { id: "value" }, set).length === 0);

// --- The level a cell reads at ----------------------------------------------

const node = ac("AC-a", ["connects"]);
const current = { fingerprint: acceptanceFingerprint(node), setVersion: "1.0.0" };
const seed = seedAssessments(node, { id: "value" }, set)[0];
const resolve = (stored, over = {}) => resolveCell("connects", stored, seed, over.current ?? current, true);

check("with nothing stored a cell reads its seed", resolve([]).source === "seed" && resolve([]).level === 3 && resolve([]).confidence === 0);
check("an unclaimed, unscored cell is blank", resolveCell("informs", [], undefined, current, false) === undefined);
check("an agent beats the seed", resolve([row(node, "connects", 1, { scorer: agent })]).level === 1);
check("a human beats an agent, even a newer one", resolve([row(node, "connects", 2), row(node, "connects", -1, { scorer: agent, ts: "2026-11-16T10:00:00.000Z" })]).level === 2);
check("the latest row wins within a kind", resolve([row(node, "connects", 1), row(node, "connects", 3, { ts: "2026-11-15T12:00:00.000Z" })]).level === 3);
check("a stored rule row is ignored — seeds are computed", resolve([row(node, "connects", -3, { scorer: { kind: "rule", id: "x" } })]).source === "seed");

const moved = { fingerprint: "fp1-other", setVersion: "1.0.0" };
const staleHuman = resolve([row(node, "connects", 2), row(node, "connects", 3, { scorer: agent })], { current: moved });
check("a moved subject marks the winner stale", staleHuman.stale === true);
check("…and staleness never changes the winner", staleHuman.level === 2 && staleHuman.scorer.kind === "human");
check("…the agent's level rides beside it", staleHuman.others.length === 1 && staleHuman.others[0].level === 3);
check("a new set major marks it stale", resolve([row(node, "connects", 2, { basis: { fingerprint: current.fingerprint, set_version: "0.9.0" } })]).stale === true);
check("a fresh row is not stale", resolve([row(node, "connects", 2)]).stale === false);
check("a row with no basis is never stale", resolve([row(node, "connects", 2, { basis: undefined })], { current: moved }).stale === false);
check("a human and an agent two levels apart go on the review list", resolve([row(node, "connects", 3), row(node, "connects", 1, { scorer: agent })]).review === true);
check("one level apart does not", resolve([row(node, "connects", 3), row(node, "connects", 2, { scorer: agent })]).review === false);

fs.rmSync(BUILD_DIR, { recursive: true, force: true });
fs.rmSync(STATUS_BUILD_DIR, { recursive: true, force: true });
if (failures > 0) {
  console.log(`\n${failures} weighing-derive test(s) failed.`);
  process.exit(1);
}
console.log("\nAll weighing-derive tests passed.");
```

- [x] **Step 2: Run it to verify it fails**

Run: `node tests/schema/weighing-derive.test.js`
Expected: FAIL — `TypeError: seedLevelAt is not a function`.

- [x] **Step 3: Write the first half of `weighing-derive.ts`**

Create `packages/schema/src/weighing-derive.ts` with the module header (imports included — later tasks use them), the seeding section and the one-cell section:

```ts
/**
 * The weighing projections — everything a matrix says that is not stored.
 *
 * Stored: assessments. Computed, every time, from those and from the graph:
 * the level a cell reads at, how much a promise serves and costs, how much of
 * it is kept, what each element is promised and kept, which claims the
 * assessments do not support, and how much of every number rests on a guess.
 * A computed number cannot go stale and cannot disagree with its inputs — the
 * rule `deriveQualityMatrix` already follows for Kritik's severity and grades.
 *
 * **Served and cost are never netted.** A promise that serves "reduces
 * anxiety" at +3 and costs it at −2 reads "serves 1.0 · costs 0.67", never
 * "0.33": netting hides the trade-off the matrix exists to show.
 *
 * **Seeds are computed, not stored.** A claimed value with no assessment reads
 * at a level seeded from the *order* of `metadata.values` (first +3, second +2,
 * the rest +1), scorer `rule`, confidence 0. Negatives are never seeded.
 *
 * Same doctrine as {@link ./quality}: pure, immutable, zod-free and fs-free,
 * minimal `Pick<>` inputs, lenient and total — a level outside the scale, an
 * element the set dropped, a node with no platforms degrade to a blank cell or
 * a `null`, never a throw.
 */

import { DEFAULT_DELIVERED_STATUSES, resolvePlatformStatus } from "./acceptance";
import type { Node } from "./bundle";
import {
  acceptanceFingerprint,
  cellKey,
  isActiveWeighingSet,
  majorOf,
  readWeighingAssessments,
  type WeighingAssessment,
  type WeighingConfidence,
  type WeighingCriteriaSet,
  type WeighingMatrix,
  type WeighingScorer,
  type WeighingSection,
} from "./weighing";
import { VALUE_MATRIX_ID, resolveWeighing, setOfRef } from "./weighing-library";

/** The seeding rule's scorer id — what a `rule` cell reads as. */
export const SEED_SCORER_ID = "seed-by-claim-order";

/** The scorer every seed carries. */
const SEED_SCORER: WeighingScorer = { kind: "rule", id: SEED_SCORER_ID };

/** A seed has no time. */
export const SEED_TS = "1970-01-01T00:00:00.000Z";

/** A judged node: only the fields the projections read. */
export type WeighedNode = Pick<Node, "id" | "title" | "species" | "status" | "platforms" | "metadata">;

// --- Seeding -----------------------------------------------------------------

/** First claimed value +3, second +2, every other +1. Positive only — a rule never invents a cost. */
export function seedLevelAt(position: number): number {
  return position === 0 ? 3 : position === 1 ? 2 : 1;
}

/** The claimed values of a node that the set knows, deduplicated, in claim order. */
export function claimedElements(node: Pick<Node, "metadata">, set: Pick<WeighingCriteriaSet, "criteria">): string[] {
  // `resolveWeighing` hands back sets whose criteria are all objects with string ids; read a set from there.
  const known = new Set(set.criteria.map((criterion) => criterion.id));
  const claimed = Array.isArray(node.metadata?.values) ? node.metadata.values : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of claimed) {
    if (typeof value !== "string" || !known.has(value) || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

/** The seeded assessments of a node, one per claimed element. Computed on read, never stored. */
export function seedAssessments(node: WeighedNode, matrix: Pick<WeighingMatrix, "id">, set: WeighingCriteriaSet): WeighingAssessment[] {
  const fingerprint = acceptanceFingerprint(node);
  return claimedElements(node, set).map((criterion, position) => ({
    matrix: matrix.id,
    subject: node.id,
    criterion,
    level: seedLevelAt(position),
    scorer: SEED_SCORER,
    confidence: 0,
    basis: { fingerprint, set_version: set.version },
    ts: SEED_TS,
  }));
}

// --- One cell ----------------------------------------------------------------

/** What a cell reads as, and why. */
export interface EffectiveCell {
  criterion: string;
  /** The winning level. */
  level: number;
  scorer: WeighingScorer;
  confidence: WeighingConfidence;
  /** `seed` means no scorer has judged this cell — the level is the rule's guess. */
  source: "stored" | "seed";
  /** The subject or the set moved since the winner looked. Never changes who wins. */
  stale: boolean;
  evidence?: string;
  /** The author claimed this element in `metadata.values`. */
  claimed: boolean;
  /** Stored rows of the other kinds — the fresh agent level beside a stale human one. */
  others: WeighingAssessment[];
  /** A human and an agent differ by two levels or more. */
  review: boolean;
}

/** A row's time as text, `""` when it has none (the validator warns), so a row with no ts is the oldest. */
const tsOf = (row: WeighingAssessment): string => (typeof row.ts === "string" ? row.ts : "");

/** The latest row of a kind: greatest `ts`, a tie going to the later row. */
function latestOf(rows: readonly WeighingAssessment[]): WeighingAssessment | undefined {
  let best: WeighingAssessment | undefined;
  for (const row of rows) {
    if (best === undefined || tsOf(row) >= tsOf(best)) best = row;
  }
  return best;
}

/**
 * The level one cell reads at.
 *
 * A human beats an agent beats a rule, and the latest wins within a kind.
 * **Staleness never changes the winner** — a stale human level still shows,
 * flagged, with the fresh agent level beside it in `others`; an agent never
 * replaces a human. A stored `rule` row is ignored: seeds are computed, so one
 * on disk is a hand edit, and the validator warns about it.
 */
export function resolveCell(
  criterion: string,
  stored: readonly WeighingAssessment[],
  seed: WeighingAssessment | undefined,
  current: { fingerprint: string; setVersion: string },
  claimed: boolean,
): EffectiveCell | undefined {
  const human = latestOf(stored.filter((row) => row.scorer?.kind === "human"));
  const agent = latestOf(stored.filter((row) => row.scorer?.kind === "agent"));
  const winner = human ?? agent;

  if (winner === undefined) {
    if (seed === undefined) return undefined;
    return {
      criterion,
      level: seed.level,
      scorer: seed.scorer ?? SEED_SCORER,
      confidence: 0,
      source: "seed",
      stale: false,
      claimed,
      others: [],
      review: false,
    };
  }

  const basis = winner.basis;
  const stale =
    (basis?.fingerprint !== undefined && basis.fingerprint !== current.fingerprint) ||
    (basis?.set_version !== undefined && majorOf(basis.set_version) !== majorOf(current.setVersion));
  const other = winner === human ? agent : undefined;
  return {
    criterion,
    level: winner.level,
    // The winner was picked by `scorer?.kind`, so it has a scorer.
    scorer: winner.scorer as WeighingScorer,
    confidence: winner.confidence,
    source: "stored",
    stale,
    ...(winner.evidence !== undefined ? { evidence: winner.evidence } : {}),
    claimed,
    others: other === undefined ? [] : [other],
    review: human !== undefined && agent !== undefined && Math.abs(human.level - agent.level) >= 2,
  };
}
```

- [x] **Step 4: Export it**

In `packages/schema/src/index.ts`, after `export * from "./weighing-validate";` add `export * from "./weighing-derive";`.

- [x] **Step 5: Run the test to verify it passes**

Run: `node tests/schema/weighing-derive.test.js && npx tsc --noEmit -p .`
Expected: the seeding and cell checks `PASS:`, ending `All weighing-derive tests passed.`; `tsc` silent. (Lint is run at the end of the part: the header imports names the next tasks use.)

- [x] **Step 6: Commit**

```bash
git add packages/schema/src/weighing-derive.ts packages/schema/src/index.ts tests/schema/weighing-derive.test.js
git commit -m "feat(weighing): seeding and the level a cell reads at (part 2/5)"
```

### Task 2.2: One promise — served, cost, positioned, kept share, flags, guesswork

**Files:**
- Modify: `packages/schema/src/weighing-derive.ts`, `tests/schema/weighing-derive.test.js`

- [x] **Step 1: Write the failing test**

Insert above the final `fs.rmSync(BUILD_DIR…` line in `tests/schema/weighing-derive.test.js`:

```js
// --- One promise: served and cost, never netted -----------------------------

const consent = ac("AC-consent", ["reduces-risk", "reduces-anxiety"], { platforms: ["web", "ios", "android"], status: "development", metadata: { gherkin: "g", values: ["reduces-risk", "reduces-anxiety"], platformStatuses: { web: "live", ios: "releasing", android: "development" } } });
const section = {
  sets: [],
  matrices: [],
  assessments: [
    row(consent, "reduces-risk", 3),
    row(consent, "reduces-anxiety", 1),
    row(consent, "reduces-effort", -1, { scorer: agent, confidence: 1 }),
  ],
};
const ctx = buildWeighingContext(section);
const w = weighPromise(consent, ctx);
check("served is the sum of positive levels over 3", near(w.served, 4 / 3), String(w.served));
check("cost is the sum of |negative| levels over 3", near(w.cost, 1 / 3), String(w.cost));
check("served and cost are never netted", !near(w.served - w.cost, w.served) && w.cost > 0);
check("the claimed elements come first, in claim order, then the rest", eq(w.cells.map((c) => c.criterion), ["reduces-risk", "reduces-anxiety", "reduces-effort"]));
check("an unclaimed negative is flagged as an unclaimed cost", eq(w.flags.unclaimed_cost, ["reduces-effort"]));
check("a claim assessed at +3 is supported; one assessed at +1 is not (the consent page claims anxiety, delivers a touch)", eq(w.flags.claim_not_supported, ["reduces-anxiety"]) && w.flags.unclaimed_value.length === 0);
check("no positioning means no positioned variant", w.positioned === null);
check("kept share is live platforms over applicable ones", near(w.kept_share, 1 / 3), String(w.kept_share));
check("the fingerprint rides along", w.fingerprint === acceptanceFingerprint(consent));

const hollow = ac("AC-hollow", ["connects", "informs"]);
const hw = weighPromise(hollow, buildWeighingContext({ assessments: [row(hollow, "connects", 1), row(hollow, "organizes", 2)] }));
check("claimed but assessed at 1 or less: the claim is not supported", eq(hw.flags.claim_not_supported, ["connects"]));
check("not claimed but assessed at 1 or more: an unclaimed value", eq(hw.flags.unclaimed_value, ["organizes"]));
check("a claimed element nobody assessed is only seeded — no flag", !hw.flags.claim_not_supported.includes("informs") && hw.cells.find((c) => c.criterion === "informs").source === "seed");
const zeroed = weighPromise(hollow, buildWeighingContext({ assessments: [row(hollow, "connects", 0)] }));
check("a stored 0 suppresses the seed and flags the claim", zeroed.cells.find((c) => c.criterion === "connects").level === 0 && zeroed.flags.claim_not_supported.includes("connects"));

// --- Positioning ------------------------------------------------------------

const positioning = (status, criteria) => ({ id: "positioning", version: "1.0.0", subject: "acceptance", scale: set.scale, role: "positioning", extends: "value-contribution@1", ...(status ? { status } : {}), criteria });
const stands = [{ id: "reduces-risk", weight: 3 }, { id: "reduces-effort" }];
const positioned = weighPromise(consent, buildWeighingContext({ ...section, sets: [positioning("active", stands)] }));
check("an active positioning gives a positioned variant: only its elements, each times its weight", positioned.positioned && near(positioned.positioned.served, (3 / 3) * 3) && near(positioned.positioned.cost, (1 / 3) * 1), JSON.stringify(positioned.positioned));
check("a positioning with no status is active", weighPromise(consent, buildWeighingContext({ ...section, sets: [positioning(undefined, stands)] })).positioned !== null);
const draft = buildWeighingContext({ ...section, sets: [positioning("draft", stands)] });
check("a draft positioning feeds no roll-up", weighPromise(consent, draft).positioned === null);
check("…but the context still knows it is there", draft.positioningSet !== undefined && draft.positioning === null);
check("a mistyped status counts as a draft too, so it feeds no roll-up", ["Draft", "archived", 5].every((status) => weighPromise(consent, buildWeighingContext({ ...section, sets: [positioning(status, stands)] })).positioned === null));
check("rows a reader cannot address, or with a non-numeric level, are skipped and never throw", (() => {
  const junk = [null, 5, { matrix: "value" }, { ...row(hollow, "connects", 3), level: "3" }, { ...row(hollow, "connects", 3), scorer: undefined }, { ...row(hollow, "connects", 3), criterion: 7 }];
  const ctx = buildWeighingContext({ assessments: junk });
  return weighPromise(hollow, ctx).cells.every((cell) => cell.source === "seed");
})());
check("the plain served and cost do not depend on the positioning", near(positioned.served, w.served) && near(positioned.cost, w.cost));

// --- Kept share and the existing platform seam ------------------------------

check("a promise that applies nowhere has no kept share", keptShare(ac("AC-n", [], { platforms: [] })) === null);
check("every platform live is 1", keptShare(ac("AC-l", [], { platforms: ["web", "ios"] })) === 1);
check("nothing live is 0", keptShare(ac("AC-d", [], { status: "development" })) === 0);
const nodes3 = [consent, ac("AC-p", [], { platforms: ["web", "ios"], status: "backlog", metadata: { platformStatuses: { ios: "live" } } }), ac("AC-q", [], { platforms: ["android"], status: "releasing" })];
check(
  "the schema's platform resolution agrees with lib/utils/platform-status.ts getNodePlatformStatuses",
  nodes3.every((n) => {
    const app = getNodePlatformStatuses(n);
    return n.platforms.every((p) => app[p] === resolvePlatformStatus(n, p));
  }),
);
```

- [x] **Step 2: Run it to verify it fails**

Run: `node tests/schema/weighing-derive.test.js`
Expected: FAIL — `TypeError: buildWeighingContext is not a function`.

- [x] **Step 3: Append the context and the promise sections**

Append to `packages/schema/src/weighing-derive.ts`:

```ts
// --- The context -------------------------------------------------------------

/** The matrix, its set, the stored cells and the active positioning, resolved once. */
export interface WeighingContext {
  matrix: WeighingMatrix;
  set: WeighingCriteriaSet;
  /** Stored non-rule rows by {@link cellKey}. */
  byCell: Map<string, WeighingAssessment[]>;
  /** The project's positioning set, active or not. */
  positioningSet: WeighingCriteriaSet | undefined;
  /** Present only while the positioning is active; a draft feeds no roll-up. */
  positioning: { set: WeighingCriteriaSet; weights: Map<string, number> } | null;
}

/** Resolve a matrix over a section — `undefined` when the matrix or its set is not available. */
export function buildWeighingContext(
  section: Partial<Pick<WeighingSection, "sets" | "matrices" | "assessments">> | null | undefined,
  matrixId: string = VALUE_MATRIX_ID,
): WeighingContext | undefined {
  const resolved = resolveWeighing(section);
  const matrix = resolved.matrices.find((candidate) => candidate.id === matrixId);
  if (matrix === undefined) return undefined;
  const set = setOfRef(resolved, matrix.set);
  if (set === undefined) return undefined;

  const byCell = new Map<string, WeighingAssessment[]>();
  // Rows a reader cannot address (no string matrix/subject/criterion) are skipped, and so is a
  // row whose level is not a finite number — the validator warns about both.
  for (const row of readWeighingAssessments(section)) {
    if (row.matrix !== matrix.id || row.scorer?.kind === "rule" || typeof row.level !== "number" || !Number.isFinite(row.level)) continue;
    const key = cellKey(row.matrix, row.subject, row.criterion);
    const rows = byCell.get(key);
    if (rows === undefined) byCell.set(key, [row]);
    else rows.push(row);
  }

  const positioningSet = matrix.positioning === undefined ? undefined : resolved.sets.find((candidate) => candidate.id === matrix.positioning);
  const positioning =
    positioningSet === undefined || !isActiveWeighingSet(positioningSet)
      ? null
      : {
          set: positioningSet,
          weights: new Map(positioningSet.criteria.map((criterion) => [criterion.id, typeof criterion.weight === "number" && criterion.weight > 0 ? criterion.weight : 1] as const)),
        };
  return { matrix, set, byCell, positioningSet, positioning };
}

// --- One promise -------------------------------------------------------------

export interface PromiseWeighing {
  node_id: string;
  title: string;
  status: string;
  /** An archived promise is weighed but counts toward no element's mass. */
  archived: boolean;
  fingerprint: string;
  /** Every non-blank cell: the claimed elements first, in claim order, then the rest in set order. */
  cells: EffectiveCell[];
  /** Σ of positive levels ÷ 3. */
  served: number;
  /** Σ of |negative levels| ÷ 3. Never netted against `served`. */
  cost: number;
  /** The same sums over the positioned elements only, each times its weight. `null` without an active positioning. */
  positioned: { served: number; cost: number } | null;
  /** Platforms where the promise is live ÷ platforms it applies to; `null` when it applies to none. */
  kept_share: number | null;
  /** The share (0–1) of `served` and of `cost` that rests on confidence-0 cells. */
  guesswork: { served: number; cost: number };
  flags: {
    /** Claimed, and the stored level is 1 or less: the claim is stronger than the promise. */
    claim_not_supported: string[];
    /** Not claimed, and the stored level is 1 or more: the promise does more than it says. */
    unclaimed_value: string[];
    /** Any stored negative level — authors claim intent, so a cost is never claimed. */
    unclaimed_cost: string[];
  };
  /** Elements whose winning level was scored against a subject or set that has since moved. */
  stale: string[];
  /** Elements where a human and an agent differ by two levels or more. */
  review: string[];
}

/** Live platforms ÷ applicable platforms, read through the same resolution `getNodePlatformStatuses` uses. */
export function keptShare(node: Pick<Node, "status" | "platforms" | "metadata">): number | null {
  if (!Array.isArray(node.platforms) || node.platforms.length === 0) return null;
  const live = node.platforms.filter((platform) => {
    const status = resolvePlatformStatus(node, platform);
    return status !== undefined && DEFAULT_DELIVERED_STATUSES.includes(status);
  }).length;
  return live / node.platforms.length;
}

/** Weigh one promise against a resolved context. */
export function weighPromise(node: WeighedNode, ctx: WeighingContext): PromiseWeighing {
  const fingerprint = acceptanceFingerprint(node);
  const current = { fingerprint, setVersion: ctx.set.version };
  const claimedList = claimedElements(node, ctx.set);
  const claimedSet = new Set(claimedList);
  const seeds = new Map(seedAssessments(node, ctx.matrix, ctx.set).map((seed) => [seed.criterion, seed] as const));

  const order = [...claimedList, ...ctx.set.criteria.map((criterion) => criterion.id).filter((id) => !claimedSet.has(id))];
  const cells: EffectiveCell[] = [];
  for (const criterion of order) {
    const stored = ctx.byCell.get(cellKey(ctx.matrix.id, node.id, criterion)) ?? [];
    const cell = resolveCell(criterion, stored, seeds.get(criterion), current, claimedSet.has(criterion));
    if (cell !== undefined) cells.push(cell);
  }

  let served = 0;
  let cost = 0;
  let servedGuess = 0;
  let costGuess = 0;
  let positionedServed = 0;
  let positionedCost = 0;
  const flags: PromiseWeighing["flags"] = { claim_not_supported: [], unclaimed_value: [], unclaimed_cost: [] };
  const stale: string[] = [];
  const review: string[] = [];

  for (const cell of cells) {
    const weight = ctx.positioning?.weights.get(cell.criterion);
    if (cell.level > 0) {
      const mass = cell.level / 3;
      served += mass;
      if (cell.confidence === 0) servedGuess += mass;
      if (weight !== undefined) positionedServed += mass * weight;
    } else if (cell.level < 0) {
      const mass = -cell.level / 3;
      cost += mass;
      if (cell.confidence === 0) costGuess += mass;
      if (weight !== undefined) positionedCost += mass * weight;
    }
    if (cell.stale) stale.push(cell.criterion);
    if (cell.review) review.push(cell.criterion);
    if (cell.source === "stored") {
      if (cell.claimed && cell.level <= 1) flags.claim_not_supported.push(cell.criterion);
      if (!cell.claimed && cell.level >= 1) flags.unclaimed_value.push(cell.criterion);
      if (cell.level < 0) flags.unclaimed_cost.push(cell.criterion);
    }
  }

  return {
    node_id: node.id,
    title: node.title,
    status: node.status,
    archived: node.status === "archived",
    fingerprint,
    cells,
    served,
    cost,
    positioned: ctx.positioning === null ? null : { served: positionedServed, cost: positionedCost },
    kept_share: keptShare(node),
    guesswork: { served: served > 0 ? servedGuess / served : 0, cost: cost > 0 ? costGuess / cost : 0 },
    flags,
    stale,
    review,
  };
}
```

- [x] **Step 4: Run the test**

Run: `node tests/schema/weighing-derive.test.js`
Expected: `PASS: the schema's platform resolution agrees with lib/utils/platform-status.ts getNodePlatformStatuses` among the new checks, ending `All weighing-derive tests passed.`

- [x] **Step 5: Commit**

```bash
git add packages/schema/src/weighing-derive.ts tests/schema/weighing-derive.test.js
git commit -m "feat(weighing): served, cost, positioned, kept share, claim flags, guesswork (part 2/5)"
```

### Task 2.3: The matrix — masses, archived, totals, sort keys

**Files:**
- Modify: `packages/schema/src/weighing-derive.ts`, `tests/schema/weighing-derive.test.js`

- [ ] **Step 1: Write the failing test**

Insert above the final `fs.rmSync(BUILD_DIR…` lines in `tests/schema/weighing-derive.test.js`:

```js
// --- The matrix: masses, archived, totals -----------------------------------

const a1 = ac("AC-1", ["connects", "reduces-anxiety"], { platforms: ["web", "ios"], metadata: { gherkin: "g1", values: ["connects", "reduces-anxiety"], platformStatuses: { web: "live", ios: "development" } } });
const a2 = ac("AC-2", ["connects"], { platforms: ["web"] });
const gone = ac("AC-gone", ["connects"], { status: "archived" });
const view = { id: "V-home", project_id: "p", species: "view", title: "Home", status: "live", platforms: ["web"] };
const sec = { sets: [], matrices: [], assessments: [row(a1, "connects", 3), row(a1, "reduces-anxiety", -2)] };
const derived = deriveWeighing([a1, a2, gone, view], sec);
check("the matrix judges acceptances only", derived.promises.length === 3 && !derived.promises.some((p) => p.node_id === "V-home"));
check("matrixSubjects reads the matrix's query", matrixSubjects([a1, view], derived.matrix).length === 1);
check("every element of the set has a mass, zeros included", Object.keys(derived.elements).length === 30 && derived.elements.variety.promised === 0);
check("connects: promised = 3/3 (a1, human) + 3/3 (a2, seed) = 2", near(derived.elements.connects.promised, 2), String(derived.elements.connects.promised));
check("connects: kept = 1 × 1/2 (a1) + 1 × 1 (a2) = 1.5", near(derived.elements.connects.kept, 1.5), String(derived.elements.connects.kept));
check("reduces-anxiety carries a cost mass and no promised mass", near(derived.elements["reduces-anxiety"].cost, 2 / 3) && derived.elements["reduces-anxiety"].promised === 0);
check("an archived promise is weighed but counted nowhere", derived.totals.archived === 1 && near(derived.totals.promised, 2));
check("only a1 has a stored cell", derived.totals.assessed === 1);
check("connects: guesswork is the seeded share — a2's mass over the total", near(derived.elements.connects.guesswork, 0.5), String(derived.elements.connects.guesswork));
check("the total guesswork share is the same reading across elements", near(derived.totals.guesswork, 0.5));
check("a promise built only from seeds is all guesswork", near(derived.promises.find((p) => p.node_id === "AC-2").guesswork.served, 1));
check("a human-scored promise at confidence 2 is no guesswork", near(derived.promises.find((p) => p.node_id === "AC-1").guesswork.served, 0));
check("an unknown matrix derives to nothing", deriveWeighing([a1], sec, "nope") === undefined);
check("a project with no section derives from seeds alone", deriveWeighing([a2], undefined).totals.guesswork === 1);

const order = sortPromises(derived.promises, "served").map((p) => p.node_id);
check("promises sort by served, heaviest first, ties by title", order[0] === "AC-1" && order.length === 3);
check("promises sort by title A to Z", sortPromises(derived.promises, "title")[0].title === "Promise AC-1");
check("promises sort by cost, costliest first", sortPromises(derived.promises, "cost")[0].node_id === "AC-1");
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tests/schema/weighing-derive.test.js`
Expected: FAIL — `TypeError: deriveWeighing is not a function`.

- [ ] **Step 3: Append the matrix section**

Append to `packages/schema/src/weighing-derive.ts`:

```ts
// --- The matrix --------------------------------------------------------------

/** What one element is promised and kept across every live promise. */
export interface ElementMass {
  /** Σ over promises of positive level ÷ 3. */
  promised: number;
  /** The same, each promise times its kept share (0 when it applies nowhere). */
  kept: number;
  /** Σ over promises of |negative level| ÷ 3. */
  cost: number;
  /** The share (0–1) of `promised` that rests on confidence-0 cells. */
  guesswork: number;
}

export interface WeighingView {
  matrix: WeighingMatrix;
  set: WeighingCriteriaSet;
  /** `null` when no positioning exists; `active: false` for a draft, which feeds nothing. */
  positioning: { set: WeighingCriteriaSet; active: boolean } | null;
  promises: PromiseWeighing[];
  /** One entry per element of the set, in set order, zeros included. Archived promises are left out. */
  elements: Record<string, ElementMass>;
  totals: {
    promised: number;
    kept: number;
    cost: number;
    guesswork: number;
    promises: number;
    archived: number;
    /** Promises with at least one stored (non-seed) cell. */
    assessed: number;
  };
}

/** The nodes a matrix judges. */
export function matrixSubjects<N extends Pick<Node, "id" | "species">>(nodes: readonly N[], matrix: WeighingMatrix): N[] {
  if (matrix.subjects.kind === "query") {
    const species = matrix.subjects.species;
    return nodes.filter((node) => node.species === species);
  }
  const ids = new Set(matrix.subjects.items.map((item) => item?.node_id ?? item?.id));
  return nodes.filter((node) => ids.has(node.id));
}

/**
 * Derive the whole matrix: every promise weighed, every element's masses, the
 * totals. `undefined` when the matrix or its set is not available.
 *
 * Every roll-up is computed from promises, never from another roll-up, and an
 * archived promise is weighed (so its form still works) but counted nowhere.
 */
export function deriveWeighing(
  nodes: readonly WeighedNode[],
  section: Partial<Pick<WeighingSection, "sets" | "matrices" | "assessments">> | null | undefined,
  matrixId: string = VALUE_MATRIX_ID,
): WeighingView | undefined {
  const ctx = buildWeighingContext(section, matrixId);
  if (ctx === undefined) return undefined;

  const promises = matrixSubjects(nodes, ctx.matrix).map((node) => weighPromise(node, ctx));
  const raw = new Map<string, { promised: number; kept: number; cost: number; promisedGuess: number }>(
    ctx.set.criteria.map((criterion) => [criterion.id, { promised: 0, kept: 0, cost: 0, promisedGuess: 0 }]),
  );

  let assessed = 0;
  let archived = 0;
  for (const promise of promises) {
    if (promise.cells.some((cell) => cell.source === "stored")) assessed++;
    if (promise.archived) {
      archived++;
      continue;
    }
    const kept = promise.kept_share ?? 0;
    for (const cell of promise.cells) {
      const mass = raw.get(cell.criterion);
      if (mass === undefined) continue;
      if (cell.level > 0) {
        mass.promised += cell.level / 3;
        mass.kept += (cell.level / 3) * kept;
        if (cell.confidence === 0) mass.promisedGuess += cell.level / 3;
      } else if (cell.level < 0) {
        mass.cost += -cell.level / 3;
      }
    }
  }

  const elements: Record<string, ElementMass> = {};
  let promised = 0;
  let keptTotal = 0;
  let cost = 0;
  let promisedGuess = 0;
  for (const [id, mass] of raw) {
    elements[id] = { promised: mass.promised, kept: mass.kept, cost: mass.cost, guesswork: mass.promised > 0 ? mass.promisedGuess / mass.promised : 0 };
    promised += mass.promised;
    keptTotal += mass.kept;
    cost += mass.cost;
    promisedGuess += mass.promisedGuess;
  }

  return {
    matrix: ctx.matrix,
    set: ctx.set,
    positioning: ctx.positioningSet === undefined ? null : { set: ctx.positioningSet, active: ctx.positioning !== null },
    promises,
    elements,
    totals: { promised, kept: keptTotal, cost, guesswork: promised > 0 ? promisedGuess / promised : 0, promises: promises.length, archived, assessed },
  };
}

/** The sort keys a matrix page or an agent orders promises by. */
export type PromiseSortKey = "served" | "cost" | "positioned" | "title";

/** Promises ordered by a derived key, heaviest first (title: A to Z); a promise with no positioned figure sorts last. */
export function sortPromises(promises: readonly PromiseWeighing[], key: PromiseSortKey): PromiseWeighing[] {
  const value = (promise: PromiseWeighing): number =>
    key === "served" ? promise.served : key === "cost" ? promise.cost : key === "positioned" ? promise.positioned?.served ?? -1 : 0;
  return [...promises].sort((a, b) => (key === "title" ? a.title.localeCompare(b.title) : value(b) - value(a) || a.title.localeCompare(b.title)));
}
```

- [ ] **Step 4: Run the test**

Run: `node tests/schema/weighing-derive.test.js`
Expected: all 59 checks `PASS:`, ending `All weighing-derive tests passed.`

- [ ] **Step 5: Commit**

```bash
git add packages/schema/src/weighing-derive.ts tests/schema/weighing-derive.test.js
git commit -m "feat(weighing): element masses, totals and the promise sort keys (part 2/5)"
```

### Task 2.4: Script, CI step, gate

**Files:**
- Modify: `package.json`, `.github/workflows/ci.yml`

- [ ] **Step 1: Add the script** — after `"test:weighing"` in `package.json`:

```json
    "test:weighing-derive": "node tests/schema/weighing-derive.test.js",
```

- [ ] **Step 2: Add the CI step** — directly after the "Weighing model tests" step in `ci.yml`:

```yaml
      # The weighing projections: seeding, the level a cell reads at, served and
      # cost (never netted), positioned variants, kept share (pinned to
      # lib/utils/platform-status.ts), element masses and the claim flags. Pure.
      - name: Weighing derivation tests (seeds, effective level, served/cost, masses, flags)
        run: npm run test:weighing-derive
```

- [ ] **Step 3: Run the gate**

Run: `npm run generate && git status --short` (expected: no change — nothing in this part touches a generated artifact), `npm run lint`, `npx tsc --noEmit -p .`, `npm run build`, `npm run test:weighing && npm run test:weighing-derive && npm run test:schema && npm run test:quality && npm run test:effective-status`.
Expected: all exit 0; `eslint` reports no error (the header imports are all used now).

- [ ] **Step 4: Commit and submit**

```bash
git add package.json .github/workflows/ci.yml
git commit -m "chore(weighing): derivation test script and CI step (part 2/5)"
gh stack submit --auto
```

---

## Part 3 — `weighing/3-storage`

**Goal.** An assessment, and a positioning, can be written and read back in all three homes: the repo (sidecars folded by `arkaik pack` / `restore`, withheld by `push`), a hosted project (`POST …/weighing/events`, folded by the project GET, counted by the ETag), and a browser project (the local provider appends to its journal row and folds on read). All three go through **one** validator-gated planner.

**Must not touch:** `lib/utils/quality.ts`, `lib/services/graph/quality-events.ts` (Kritik's path — weighing never rides it), `packages/mcp`, `components/`, the `QUALITY_FOLD_TYPES` list itself (a weighing event must never be read into a Kritik plan).

**Reference precedent:** `lib/services/graph/quality-events.ts` + `app/api/graph/projects/[projectId]/quality/events/route.ts` (the whitelist, all-or-nothing refusal, the unlocked append), `lib/utils/quality.ts` `foldQualityEvents`, `packages/cli/src/lib/kritik-io.ts` `foldQualitySection`, `packages/cli/src/commands/{pack,push,restore}.ts`.

**No database migration.** `graph_events.event` is free-form JSON, and the ETag's `count(*) … where type in (…)` list is source code, not schema. (Verified: `quality.assessment.scored` shipped with none.)

### Task 3.1: The two event shapes and the input parser

**Files:**
- Modify: `packages/schema/src/journal-events.ts`, `packages/schema/src/index.ts`
- Create: `packages/schema/src/weighing-events.ts`
- Create: `tests/schema/weighing-events.test.js` (grows over 3.1–3.3)

- [ ] **Step 1: Write the failing test**

Create `tests/schema/weighing-events.test.js` (preamble, the vocabulary and parser sections, epilogue):

```js
/**
 * The weighing write path (docs/rfcs/weighing.md): the events, the fold that
 * reads them back, and the one planner every writer goes through — the hosted
 * route, the browser provider and the MCP tools. Pure and DB-free.
 *
 * Run: npm run test:weighing-events
 */

const assert = require("assert");
const fs = require("fs");
const { loadSchema, BUILD_DIR } = require("./load-schema");

const {
  acceptanceFingerprint,
  foldWeighingEvents,
  parseWeighingEventInputs,
  planWeighingEvents,
  WEIGHING_FOLD_TYPES,
  JOURNAL_EVENT_SCHEMAS,
  KnownJournalEventSchema,
  makeEvent,
  validateBundle,
} = loadSchema();

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`PASS: ${name}`);
  else {
    failures++;
    console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** Key-order-insensitive: an event round-trips through zod, which reorders. */
const same = (a, b) => {
  try {
    assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
    return true;
  } catch {
    return false;
  }
};

const NODE = { id: "AC-a", species: "acceptance", title: "Accept an invite", metadata: { gherkin: "Given a link", values: ["connects"] } };
const VIEW = { id: "V-home", species: "view", title: "Home" };
const NOW = new Date("2026-11-15T10:00:00.000Z");
const assess = (over = {}) => ({ type: "weighing.assessment.recorded", subject: "AC-a", criterion: "connects", level: 2, confidence: 2, evidence: "the title says so", ...over });
const ctx = (over = {}) => ({ actor: "arkaik-app", scorerKind: "human", now: NOW, ...over });

// --- The vocabulary ----------------------------------------------------------

check("two event types fold", eq([...WEIGHING_FOLD_TYPES], ["weighing.assessment.recorded", "weighing.set.saved"]));
check("both have a strict schema", Boolean(JOURNAL_EVENT_SCHEMAS["weighing.assessment.recorded"]) && Boolean(JOURNAL_EVENT_SCHEMAS["weighing.set.saved"]));

// --- parseWeighingEventInputs ------------------------------------------------

check("a minimal assessment parses", Array.isArray(parseWeighingEventInputs({ events: [assess()] })));
check("a body with no events array is an error", typeof parseWeighingEventInputs({}).error === "string");
check("an empty batch is an error", typeof parseWeighingEventInputs({ events: [] }).error === "string");
check("51 entries is an error", typeof parseWeighingEventInputs({ events: Array.from({ length: 51 }, () => assess()) }).error === "string");
check("an unknown type is an error", typeof parseWeighingEventInputs({ events: [{ type: "quality.finding.resolved", finding_id: "x" }] }).error === "string");
check("a fractional level is an error", typeof parseWeighingEventInputs({ events: [assess({ level: 1.5 })] }).error === "string");
check("a confidence of 4 is an error", typeof parseWeighingEventInputs({ events: [assess({ confidence: 4 })] }).error === "string");
check("an empty subject is an error", typeof parseWeighingEventInputs({ events: [assess({ subject: "" })] }).error === "string");
for (const stamped of ["scorer", "basis", "ts"]) {
  check(`a caller-supplied ${stamped} is refused — the server stamps it`, /stamped by the server/.test(parseWeighingEventInputs({ events: [assess({ [stamped]: stamped === "ts" ? "2026-01-01T00:00:00.000Z" : { kind: "human", id: "me" } })] }).error ?? ""));
}
check("refs must be non-empty strings", typeof parseWeighingEventInputs({ events: [assess({ refs: ["ok", ""] })] }).error === "string");
check("a set needs an id, version and subject", typeof parseWeighingEventInputs({ events: [{ type: "weighing.set.saved", set: { id: "positioning" } }] }).error === "string");

fs.rmSync(BUILD_DIR, { recursive: true, force: true });
if (failures > 0) {
  console.log(`\n${failures} weighing-events test(s) failed.`);
  process.exit(1);
}
console.log("\nAll weighing-events tests passed.");
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tests/schema/weighing-events.test.js`
Expected: FAIL — `FAIL: both have a strict schema`, then `TypeError: parseWeighingEventInputs is not a function`.

- [ ] **Step 3: Add the strict event schemas**

```diff
--- a/packages/schema/src/journal-events.ts
+++ b/packages/schema/src/journal-events.ts
@@ -14,6 +14,7 @@
 import { z } from "zod";
 import { AnyStatusSchema, DecisionStatusSchema, EdgeTypeSchema, PlatformSchema, SpeciesSchema } from "./enums";
 import { SCREENSHOT_FORMS, SCREENSHOT_SOURCES } from "./journal";
+import { WeighingAssessmentBasisSchema, WeighingConfidenceSchema, WeighingCriteriaSetSchema, WeighingScorerSchema } from "./weighing-schemas";
 import type { JournalEvent } from "./journal";
 
 /** Shared envelope fields (docs/spec/journal.md § Event Envelope). */
@@ -320,6 +321,36 @@
   })
   .catchall(z.unknown());
 
+/**
+ * Weighing events (docs/rfcs/weighing.md). Written away from a checkout — a
+ * hosted session, a browser project — where there is no `docs/weighing/` sidecar
+ * to hold them; in a repository the sidecar is the record and no event is
+ * written. The read folds them over `snapshot.weighing` latest-wins
+ * (`foldWeighingEvents`). The payload is an assessment minus its `ts`, which is
+ * the envelope's.
+ */
+export const WeighingAssessmentRecordedEventSchema = z
+  .object({
+    ...envelope,
+    type: z.literal("weighing.assessment.recorded"),
+    matrix: z.string(),
+    subject: z.string(),
+    criterion: z.string(),
+    level: z.number().int(),
+    scorer: WeighingScorerSchema,
+    confidence: WeighingConfidenceSchema,
+    evidence: z.string().optional(),
+    refs: z.array(z.string()).optional(),
+    basis: WeighingAssessmentBasisSchema.optional(),
+    run: z.string().optional(),
+  })
+  .catchall(z.unknown());
+
+/** A criteria set saved whole — latest-wins by set id. How a positioning is written away from a checkout. */
+export const WeighingSetSavedEventSchema = z
+  .object({ ...envelope, type: z.literal("weighing.set.saved"), set: WeighingCriteriaSetSchema })
+  .catchall(z.unknown());
+
 /** Per-type schemas keyed by `type`, for validating a single known event. */
 export const JOURNAL_EVENT_SCHEMAS = {
   "node.created": NodeCreatedEventSchema,
@@ -345,6 +376,8 @@
   "quality.finding.resolved": QualityFindingResolvedEventSchema,
   "quality.finding.accepted": QualityFindingAcceptedEventSchema,
   "quality.signal.tripped": QualitySignalTrippedEventSchema,
+  "weighing.assessment.recorded": WeighingAssessmentRecordedEventSchema,
+  "weighing.set.saved": WeighingSetSavedEventSchema,
 } as const;
 
 /**
@@ -376,4 +409,6 @@
   QualityFindingResolvedEventSchema,
   QualityFindingAcceptedEventSchema,
   QualitySignalTrippedEventSchema,
+  WeighingAssessmentRecordedEventSchema,
+  WeighingSetSavedEventSchema,
 ]);
```

- [ ] **Step 4: Write the first half of `weighing-events.ts`**

Create `packages/schema/src/weighing-events.ts` with the header and the inputs section. (`planWeighingEvents` and `foldWeighingEvents` are appended in 3.2 and 3.3 — the header already imports what they need.)

```ts
/**
 * The journal half of the weighing layer: the events that write assessments and
 * a positioning away from a checkout, the fold that reads them back, and the
 * one validator-gated planner every writer goes through.
 *
 * Where each home keeps an assessment:
 *
 * - **A repository** keeps sidecar files under `docs/weighing/`, canonical the
 *   way `journal.jsonl` is ({@link ./cli/weighing-files}). No event is written
 *   there — the file is the record and git is its history.
 * - **A hosted project and a browser project** keep `weighing.assessment.recorded`
 *   and `weighing.set.saved` events in the journal, and every read folds them
 *   over the stored section ({@link foldWeighingEvents}) — the same rule as
 *   Kritik's `quality.assessment.scored`.
 *
 * {@link planWeighingEvents} is the single gate: the hosted route, the local
 * provider and the MCP tools all ask it before anything is written, so a score
 * written by an agent and a score written by a person are the same write.
 * **The writer's kind is stamped by the caller, never read from the payload**:
 * the route knows a session from a token, the MCP server knows it is an agent.
 *
 * Unlike {@link ./weighing} this module imports `makeEvent`, and so zod. It is
 * not bundled into the standalone validator.
 */

import type { Node } from "./bundle";
import { makeEvent } from "./emit";
import type { JournalEvent } from "./journal";
import { acceptanceFingerprint } from "./weighing";
import {
  POSITIONING_SET_ID,
  VALUE_SET_ID,
  VALUE_MATRIX_ID,
  resolveWeighing,
  setOfRef,
  weighingScaleOf,
} from "./weighing-library";
import {
  WEIGHING_ASSESSMENT_RECORDED,
  WEIGHING_SET_SAVED,
  upsertWeighingAssessment,
  type WeighingAssessment,
  type WeighingConfidence,
  type WeighingCriteriaSet,
  type WeighingMatrix,
  type WeighingScorerKind,
  type WeighingSection,
} from "./weighing";

/** Read an unknown field as an array, never throwing on a hand-edited section. */
const asArray = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

// --- Inputs ------------------------------------------------------------------

/** One caller-supplied write, after {@link parseWeighingEventInputs} has narrowed its shape. */
export type WeighingEventInput =
  | {
      type: typeof WEIGHING_ASSESSMENT_RECORDED;
      /** Defaults to the built-in `value` matrix. */
      matrix?: string;
      subject: string;
      criterion: string;
      level: number;
      confidence: number;
      evidence?: string;
      refs?: string[];
      run?: string;
      commit?: string;
      /** The model behind an agent scorer. */
      model?: string;
    }
  | { type: typeof WEIGHING_SET_SAVED; set: WeighingCriteriaSet };

const MAX_EVENTS = 50;

const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value !== "";

/** D14, not yet run: an opaque id or handle: no whitespace, 128 characters at most, and not an email (a sidecar is committed to a repo). */
const isOpaqueId = (value: string): boolean => value.length > 0 && value.length <= 128 && !/\s/.test(value) && !/[^\s@]+@[^\s@]+/.test(value);

/**
 * Shape-validate a request body into a batch of {@link WeighingEventInput}.
 *
 * Purely structural — it never looks at the graph or the section, so it cannot
 * refuse an unknown subject (that is {@link planWeighingEvents}'s job). A legal
 * batch is an array; an error is `{ error }`. 1–50 entries. **`scorer`, `basis`
 * and `ts` are refused outright**: provenance is stamped by the writer and the
 * fingerprint is read off the graph, so a caller can claim neither.
 */
export function parseWeighingEventInputs(body: unknown): WeighingEventInput[] | { error: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { error: "body must be an object with an events array" };
  }
  const { events } = body as { events?: unknown };
  if (!Array.isArray(events)) return { error: "events must be an array" };
  if (events.length === 0) return { error: "events must contain at least one entry" };
  if (events.length > MAX_EVENTS) return { error: `events must contain at most ${MAX_EVENTS} entries` };

  const parsed: WeighingEventInput[] = [];
  for (const [index, raw] of events.entries()) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { error: `events[${index}] must be an object` };
    const entry = raw as Record<string, unknown>;

    if (entry.type === WEIGHING_ASSESSMENT_RECORDED) {
      for (const stamped of ["scorer", "basis", "ts"] as const) {
        if (stamped in entry) return { error: `events[${index}].${stamped} is stamped by the server — remove it` };
      }
      for (const field of ["subject", "criterion"] as const) {
        if (!isNonEmptyString(entry[field])) return { error: `events[${index}].${field} must be a non-empty string` };
      }
      if (typeof entry.level !== "number" || !Number.isInteger(entry.level)) return { error: `events[${index}].level must be an integer` };
      if (typeof entry.confidence !== "number" || !Number.isInteger(entry.confidence) || entry.confidence < 0 || entry.confidence > 3) {
        return { error: `events[${index}].confidence must be an integer 0-3` };
      }
      for (const field of ["matrix", "evidence", "run", "commit", "model"] as const) {
        if (entry[field] !== undefined && !isNonEmptyString(entry[field])) return { error: `events[${index}].${field} must be a non-empty string when present` };
      }
      if (entry.refs !== undefined && (!Array.isArray(entry.refs) || !entry.refs.every(isNonEmptyString))) {
        return { error: `events[${index}].refs must be an array of non-empty strings when present` };
      }
      parsed.push({
        type: WEIGHING_ASSESSMENT_RECORDED,
        subject: entry.subject as string,
        criterion: entry.criterion as string,
        level: entry.level,
        confidence: entry.confidence,
        ...(entry.matrix !== undefined ? { matrix: entry.matrix as string } : {}),
        ...(entry.evidence !== undefined ? { evidence: entry.evidence as string } : {}),
        ...(entry.refs !== undefined ? { refs: entry.refs as string[] } : {}),
        ...(entry.run !== undefined ? { run: entry.run as string } : {}),
        ...(entry.commit !== undefined ? { commit: entry.commit as string } : {}),
        ...(entry.model !== undefined ? { model: entry.model as string } : {}),
      });
      continue;
    }

    if (entry.type === WEIGHING_SET_SAVED) {
      const set = entry.set;
      if (typeof set !== "object" || set === null || Array.isArray(set)) return { error: `events[${index}].set must be an object` };
      const s = set as Record<string, unknown>;
      if (!isNonEmptyString(s.id) || !isNonEmptyString(s.version) || !isNonEmptyString(s.subject)) {
        return { error: `events[${index}].set needs a non-empty id, version and subject` };
      }
      // The scale is optional: a positioning without one uses its ruler's (weighingScaleOf).
      if (!Array.isArray(s.criteria)) {
        return { error: `events[${index}].set needs a criteria array` };
      }
      parsed.push({ type: WEIGHING_SET_SAVED, set: set as WeighingCriteriaSet });
      continue;
    }

    return { error: `events[${index}].type must be ${WEIGHING_ASSESSMENT_RECORDED} or ${WEIGHING_SET_SAVED}` };
  }
  return parsed;
}
```

- [ ] **Step 5: Export it**

In `packages/schema/src/index.ts`, after `export * from "./weighing-validate";` add `export * from "./weighing-events";` (keep `weighing-derive` after it if Part 2 is below you).

- [ ] **Step 6: Run the test**

Run: `node tests/schema/weighing-events.test.js && npx tsc --noEmit -p .`
Expected: the vocabulary and parser checks `PASS:`, ending `All weighing-events tests passed.`; `tsc` silent. (If `tsc` complains that `planWeighingEvents`/`foldWeighingEvents` are imported-but-unused names — it does not; unused imports are not an error here. ESLint is run at the end of the part.)

- [ ] **Step 7: Commit**

```bash
git add packages/schema/src/journal-events.ts packages/schema/src/weighing-events.ts packages/schema/src/index.ts tests/schema/weighing-events.test.js
git commit -m "feat(weighing): the event shapes and a parser that refuses a claimed scorer (part 3/5)"
```

### Task 3.2: The planner — the one validator-gated write path

**Files:**
- Modify: `packages/schema/src/weighing-events.ts`, `tests/schema/weighing-events.test.js`

- [ ] **Step 1: Write the failing test**

Insert above the final `fs.rmSync(BUILD_DIR…` line of `tests/schema/weighing-events.test.js`:

```js
// --- planWeighingEvents: assessments -----------------------------------------

const plan = planWeighingEvents(undefined, [NODE, VIEW], [assess({ model: "claude" })], ctx({ scorerKind: "agent", actor: "arkaik-mcp" }));
check("a valid assessment plans one event", plan.ok === true && plan.events.length === 1 && plan.assessments.length === 1);
const row = plan.assessments[0];
check("the scorer is stamped by the caller, with the model", eq(row.scorer, { kind: "agent", id: "arkaik-mcp", model: "claude" }));
check("the matrix defaults to value", row.matrix === "value");
check("the basis is read off the graph: fingerprint and the set's full version", row.basis.fingerprint === acceptanceFingerprint(NODE) && row.basis.set_version === "1.0.0");
check("the row's ts is the event's ts", row.ts === NOW.toISOString() && plan.events[0].ts === NOW.toISOString());
check("the event carries the assessment flat, with the writer as actor", plan.events[0].type === "weighing.assessment.recorded" && plan.events[0].actor === "arkaik-mcp" && plan.events[0].level === 2 && plan.events[0].scorer.kind === "agent");
check("the event validates against its strict schema", KnownJournalEventSchema.safeParse(plan.events[0]).success);
check("a human session stamps a human", planWeighingEvents(undefined, [NODE], [assess()], ctx()).assessments[0].scorer.kind === "human");

// on_behalf_of (not yet run — D14)
const behalf = planWeighingEvents(undefined, [NODE], [assess()], ctx({ scorerKind: "agent", actor: "arkaik-agent", onBehalfOf: "42" }));
check("a writer that knows whose hands these are stamps scorer.on_behalf_of, on the row and on the event", behalf.ok === true && behalf.assessments[0].scorer.on_behalf_of === "42" && behalf.events[0].scorer.on_behalf_of === "42" && KnownJournalEventSchema.safeParse(behalf.events[0]).success);
check("…and stamps nothing when it does not know", !("on_behalf_of" in plan.assessments[0].scorer));
check("an email is refused: sidecars are committed to repos", planWeighingEvents(undefined, [NODE], [assess()], ctx({ onBehalfOf: "me@example.com" })).refusals?.[0].reason === "invalid_on_behalf_of");

const refused = (inputs) => planWeighingEvents(undefined, [NODE, VIEW], inputs, ctx());
check("an unknown subject is refused", refused([assess({ subject: "AC-nope" })]).refusals?.[0].reason === "unknown_subject");
check("a view is not a subject of the value matrix", refused([assess({ subject: "V-home" })]).refusals?.[0].reason === "unknown_subject");
check("an unknown criterion is refused", refused([assess({ criterion: "teleports" })]).refusals?.[0].reason === "unknown_criterion");
check("a level of 4 is refused", refused([assess({ level: 4 })]).refusals?.[0].reason === "level_out_of_range");
check("a level of −3 is accepted — the scale is signed", refused([assess({ level: -3 })]).ok === true);
check("a level of 0 is accepted — weighed and unrelated", refused([assess({ level: 0 })]).ok === true);
check("an unknown matrix is refused", refused([assess({ matrix: "nope" })]).refusals?.[0].reason === "unknown_matrix");
const batch = refused([assess(), assess({ criterion: "teleports" }), assess({ level: 9 })]);
check("one bad entry refuses the whole batch, each naming its index", batch.ok === false && eq(batch.refusals.map((r) => r.index), [1, 2]));

const retired = { sets: [], matrices: [], assessments: [] };
check("an empty section changes nothing about planning", planWeighingEvents(retired, [NODE], [assess()], ctx()).ok === true);

// --- planWeighingEvents: the positioning -------------------------------------

const positioning = (over = {}) => ({
  id: "positioning",
  version: "1.0.0",
  subject: "acceptance",
  scale: { min: -3, max: 3, anchors: {} },
  role: "positioning",
  status: "draft",
  extends: "value-contribution@1",
  criteria: [{ id: "reduces-anxiety", weight: 3, anchors: { 3: "removes a worry the user names", 0: "nothing to do with worry" } }],
  ...over,
});
const saved = planWeighingEvents(undefined, [NODE], [{ type: "weighing.set.saved", set: positioning() }], ctx());
check("a positioning plans one set.saved event", saved.ok === true && saved.events.length === 1 && saved.events[0].type === "weighing.set.saved" && saved.events[0].set.id === "positioning");
check("the saved set validates against its strict schema", KnownJournalEventSchema.safeParse(saved.events[0]).success);
check("a positioning with an unknown element is refused", planWeighingEvents(undefined, [NODE], [{ type: "weighing.set.saved", set: positioning({ criteria: [{ id: "teleports" }] }) }], ctx()).refusals?.[0].reason === "invalid_set");
check("a weight of 0 is refused", planWeighingEvents(undefined, [NODE], [{ type: "weighing.set.saved", set: positioning({ criteria: [{ id: "connects", weight: 0 }] }) }], ctx()).refusals?.[0].reason === "invalid_set");
check("only the positioning can be saved in this slice", planWeighingEvents(undefined, [NODE], [{ type: "weighing.set.saved", set: positioning({ id: "my-set", role: undefined }) }], ctx()).refusals?.[0].reason === "invalid_set");
check("a positioning extending nothing is refused", planWeighingEvents(undefined, [NODE], [{ type: "weighing.set.saved", set: positioning({ extends: "nope@1" }) }], ctx()).refusals?.[0].reason === "invalid_set");
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tests/schema/weighing-events.test.js`
Expected: FAIL — `TypeError: planWeighingEvents is not a function`.

> **Not yet run, and more than a field (D14).** The planner gains `ctx.onBehalfOf`, one refusal reason (`invalid_on_behalf_of`) and a small `isOpaqueId` guard that rejects an email-shaped value. The lines are marked in the code and the three checks are at the end of Step 1.

- [ ] **Step 3: Append the planner**

Append to `packages/schema/src/weighing-events.ts`:

```ts
// --- The planner -------------------------------------------------------------

export type WeighingRefusalReason =
  | "unknown_matrix"
  | "unknown_subject"
  | "unknown_criterion"
  | "retired_criterion"
  | "level_out_of_range"
  | "invalid_on_behalf_of" // D14, not yet run
  | "invalid_set";

/** Why one entry of a batch was refused. `index` is its position in the request's `events` array. */
export interface WeighingRefusal {
  index: number;
  reason: WeighingRefusalReason;
  detail: string;
}

export interface WeighingPlanContext {
  /** The envelope's `actor`: `arkaik-app`, `arkaik-agent`, `arkaik-mcp`. */
  actor: string;
  /** Stamped by the caller: a session is `human`, a token or the MCP server is `agent`. Never `rule`. */
  scorerKind: Exclude<WeighingScorerKind, "rule">;
  /**
   * Whom the scorer acts for, when the writer knows (D14, not yet run): the token
   * owner's user id on the hosted route, whatever the MCP server was told in a
   * repo. An opaque id or handle, never an email. Absent otherwise.
   */
  onBehalfOf?: string;
  /** Defaults to now. */
  now?: Date;
}

export type WeighingPlan =
  | {
      ok: true;
      /** Stamped, ready to append. Same order as the inputs. */
      events: JournalEvent[];
      /** The assessment rows the assessment events carry — what a sidecar writer upserts. */
      assessments: WeighingAssessment[];
    }
  | { ok: false; refusals: WeighingRefusal[] };

/**
 * Plan the journal events one batch of {@link WeighingEventInput}s would
 * produce, or refuse the whole batch.
 *
 * Checks every assessment against the resolved library the way `kritik_score`
 * checks a score against the pack: the matrix exists, the subject is a node the
 * matrix judges, the criterion is in the set and not retired, the level is on
 * the set's scale. Then it stamps what the caller must not: the scorer, the
 * set's full version and the subject's fingerprint (and, when the writer knows
 * it, whom the scorer acts for) — so staleness is measured
 * from what the server saw, never from what a client said it saw.
 *
 * **All-or-nothing**, like `persistMutation`: one refusal anywhere refuses
 * every entry, each naming its `index`, so a caller retrying a corrected batch
 * never reasons about a partial write.
 *
 * A saved set is held to the positioning's contract: id `positioning`, role
 * `positioning`, extending a set the library holds, naming only that set's
 * criteria, every weight above zero. Nothing else can be saved in slice 1.
 */
export function planWeighingEvents(
  section: WeighingSection | undefined,
  nodes: readonly Pick<Node, "id" | "species" | "title" | "metadata">[],
  inputs: readonly WeighingEventInput[],
  ctx: WeighingPlanContext,
): WeighingPlan {
  const resolved = resolveWeighing(section);
  const byId = new Map(nodes.map((node) => [node.id, node] as const));
  const now = ctx.now ?? new Date();
  const refusals: WeighingRefusal[] = [];
  const events: JournalEvent[] = [];
  const assessments: WeighingAssessment[] = [];

  inputs.forEach((input, index) => {
    const refuse = (reason: WeighingRefusalReason, detail: string) => refusals.push({ index, reason, detail });

    if (input.type === WEIGHING_SET_SAVED) {
      const set = input.set;
      const ruler = typeof set.extends === "string" ? setOfRef(resolved, set.extends) : undefined;
      if (set.id !== POSITIONING_SET_ID || set.role !== "positioning") {
        return refuse("invalid_set", `only the positioning can be saved: id "${POSITIONING_SET_ID}" with role "positioning"`);
      }
      if (ruler === undefined) return refuse("invalid_set", `a positioning extends a set the library holds (e.g. ${VALUE_SET_ID}@1)`);
      const known = new Set(ruler.criteria.map((criterion) => criterion.id));
      for (const criterion of set.criteria) {
        if (!isNonEmptyString(criterion?.id) || !known.has(criterion.id)) {
          return refuse("invalid_set", `"${String(criterion?.id)}" is not an element of ${ruler.id}`);
        }
        if (criterion.weight !== undefined && (typeof criterion.weight !== "number" || !(criterion.weight > 0))) {
          return refuse("invalid_set", `the weight for "${criterion.id}" must be a number above 0 — leave the element out to leave it unpositioned`);
        }
      }
      if (set.status !== undefined && set.status !== "draft" && set.status !== "active") {
        return refuse("invalid_set", `status must be "draft" or "active"`);
      }
      events.push(makeEvent(WEIGHING_SET_SAVED, { set }, { actor: ctx.actor, ts: now }));
      return;
    }

    const matrix = resolved.matrices.find((candidate) => candidate.id === (input.matrix ?? VALUE_MATRIX_ID));
    if (matrix === undefined) {
      return refuse("unknown_matrix", `no matrix "${input.matrix ?? VALUE_MATRIX_ID}" (have: ${resolved.matrices.map((m) => m.id).join(", ")})`);
    }
    const set = setOfRef(resolved, matrix.set);
    if (set === undefined) return refuse("unknown_matrix", `matrix "${matrix.id}" names set "${matrix.set}", which is not available`);

    const node = byId.get(input.subject);
    const judged = matrix.subjects.kind === "query" ? node?.species === matrix.subjects.species : matrix.subjects.items.some((item) => (item?.node_id ?? item?.id) === input.subject);
    if (node === undefined || !judged) {
      return refuse("unknown_subject", `"${input.subject}" is not a subject of matrix "${matrix.id}"`);
    }

    const criterion = set.criteria.find((candidate) => candidate.id === input.criterion);
    if (criterion === undefined) return refuse("unknown_criterion", `"${input.criterion}" is not in set "${set.id}"`);
    if (typeof criterion.superseded_by === "string") {
      return refuse("retired_criterion", `"${criterion.id}" is retired — score "${criterion.superseded_by}" instead`);
    }
    const scale = weighingScaleOf(set, resolved);
    if (input.level < scale.min || input.level > scale.max) {
      return refuse("level_out_of_range", `level ${input.level} is outside ${scale.min}..${scale.max}`);
    }

    if (ctx.onBehalfOf !== undefined && !isOpaqueId(ctx.onBehalfOf)) {
      // D14, not yet run.
      return refuse("invalid_on_behalf_of", "on_behalf_of is an opaque user id or handle, never an email — sidecars are committed to repos");
    }

    const ts = now.toISOString();
    const row: WeighingAssessment = {
      matrix: matrix.id,
      subject: input.subject,
      criterion: criterion.id,
      level: input.level,
      scorer: {
        kind: ctx.scorerKind,
        id: ctx.actor,
        ...(input.model !== undefined ? { model: input.model } : {}),
        ...(ctx.onBehalfOf !== undefined ? { on_behalf_of: ctx.onBehalfOf } : {}), // D14, not yet run
      },
      confidence: input.confidence as WeighingConfidence,
      ...(input.evidence !== undefined ? { evidence: input.evidence } : {}),
      ...(input.refs !== undefined ? { refs: input.refs } : {}),
      basis: {
        fingerprint: acceptanceFingerprint(node),
        set_version: set.version,
        ...(input.commit !== undefined ? { commit: input.commit } : {}),
      },
      ...(input.run !== undefined ? { run: input.run } : {}),
      ts,
    };
    assessments.push(row);
    const { ts: _ts, ...payload } = row;
    void _ts;
    events.push(makeEvent(WEIGHING_ASSESSMENT_RECORDED, payload, { actor: ctx.actor, ts: now }));
  });

  return refusals.length > 0 ? { ok: false, refusals } : { ok: true, events, assessments };
}
```

- [ ] **Step 4: Run the test**

Run: `node tests/schema/weighing-events.test.js`
Expected: the planner checks `PASS:` (including `a level of −3 is accepted — the scale is signed`, `one bad entry refuses the whole batch, each naming its index`); the fold checks are not written yet, so the file ends `All weighing-events tests passed.`

- [ ] **Step 5: Commit**

```bash
git add packages/schema/src/weighing-events.ts tests/schema/weighing-events.test.js
git commit -m "feat(weighing): planWeighingEvents — one gate for the route, the browser and MCP (part 3/5)"
```

### Task 3.3: The fold

**Files:**
- Modify: `packages/schema/src/weighing-events.ts`, `tests/schema/weighing-events.test.js`

- [ ] **Step 1: Write the failing test**

Insert above the final `fs.rmSync(BUILD_DIR…` line:

```js
// --- foldWeighingEvents ------------------------------------------------------

const ev = (planResult) => planResult.events;
const section = { sets: [], matrices: [], assessments: [] };
check("no weighing events: the SAME section comes back", foldWeighingEvents(section, [makeEvent("node.created", { node_id: "x", species: "view", title: "x" })]) === section);
check("no section and no events stays undefined", foldWeighingEvents(undefined, []) === undefined);
const fromNothing = foldWeighingEvents(undefined, ev(plan));
check("a project with only events still folds, from nothing", fromNothing.assessments.length === 1 && fromNothing.sets.length === 0 && fromNothing.matrices.length === 0);
check("the folded row is the planned row", same(fromNothing.assessments[0], row));

const later = planWeighingEvents(undefined, [NODE], [assess({ level: 3 })], ctx({ scorerKind: "agent", actor: "arkaik-mcp", now: new Date("2026-11-15T11:00:00.000Z") }));
const folded = foldWeighingEvents(fromNothing, ev(later));
check("a later event from the same scorer kind replaces the cell", folded.assessments.length === 1 && folded.assessments[0].level === 3);
const humanEvent = planWeighingEvents(undefined, [NODE], [assess({ level: -1 })], ctx({ now: new Date("2026-11-15T12:00:00.000Z") }));
const both = foldWeighingEvents(folded, ev(humanEvent));
check("a human's event lands beside the agent's, not over it", both.assessments.length === 2 && both.assessments.some((a) => a.scorer?.kind === "human" && a.level === -1) && both.assessments.some((a) => a.scorer?.kind === "agent" && a.level === 3));
check("the fold does not mutate the stored section", fromNothing.assessments.length === 1 && fromNothing.assessments[0].level === 2);
check("the fold keeps unknown top-level keys on the section", foldWeighingEvents({ ...section, extra: 7 }, ev(plan)).extra === 7);

const setFolded = foldWeighingEvents(section, ev(saved));
check("a set event adds the set", setFolded.sets.length === 1 && setFolded.sets[0].status === "draft");
const activated = planWeighingEvents(undefined, [NODE], [{ type: "weighing.set.saved", set: positioning({ status: "active" }) }], ctx({ now: new Date("2026-11-15T13:00:00.000Z") }));
const reFolded = foldWeighingEvents(setFolded, ev(activated));
check("a later set event replaces the set by id — latest wins", reFolded.sets.length === 1 && reFolded.sets[0].status === "active");
const junk = [
  { id: "01J", ts: "2026-11-15T10:00:00.000Z", type: "weighing.assessment.recorded", subject: "AC-a" },
  { id: "01K", ts: "2026-11-15T10:00:00.000Z", type: "weighing.set.saved", set: "nope" },
];
check("malformed events are skipped, never thrown on", foldWeighingEvents(section, junk).assessments.length === 0);

// --- It all validates --------------------------------------------------------

const bundle = {
  schema_version: 3,
  project: { id: "p", title: "P", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" },
  nodes: [{ id: "AC-a", project_id: "p", species: "acceptance", title: "Accept an invite", status: "live", platforms: ["web"], metadata: NODE.metadata }],
  edges: [],
};
check("a folded section raises no weighing warning", validateBundle({ ...bundle, weighing: both }).warnings.filter((w) => w.rule.startsWith("weighing")).length === 0);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tests/schema/weighing-events.test.js`
Expected: FAIL — `TypeError: foldWeighingEvents is not a function`.

- [ ] **Step 3: Append the fold**

Append to `packages/schema/src/weighing-events.ts`:

```ts
// --- The fold ----------------------------------------------------------------

/** The assessment an event carries, or `undefined` when it is not a well-formed one. */
function assessmentOfEvent(event: JournalEvent): WeighingAssessment | undefined {
  const e = event as Record<string, unknown>;
  const scorer = e.scorer as { kind?: unknown; id?: unknown } | undefined;
  if (
    typeof e.matrix !== "string" ||
    e.matrix === "" ||
    typeof e.subject !== "string" ||
    e.subject === "" ||
    typeof e.criterion !== "string" ||
    e.criterion === "" ||
    typeof e.level !== "number" ||
    !Number.isInteger(e.level) ||
    typeof e.confidence !== "number" ||
    typeof e.ts !== "string" ||
    e.ts === "" ||
    typeof scorer !== "object" ||
    scorer === null ||
    typeof scorer.kind !== "string" ||
    typeof scorer.id !== "string"
  ) {
    return undefined;
  }
  // The envelope's own keys are not part of the assessment; `ts` is both.
  const { id: _id, actor: _actor, type: _type, v: _v, ...rest } = e;
  void _id;
  void _actor;
  void _type;
  void _v;
  return rest as unknown as WeighingAssessment;
}

/**
 * Fold the weighing events of a journal over a stored section, latest-wins.
 *
 * Returns the SAME `section` reference when there is nothing to fold, so a
 * caller can tell "unchanged" with `===` — the identity check the hosted read
 * and the local provider both use to avoid copying a bundle for nothing. Unlike
 * the Kritik fold it will start a section from nothing: weighing needs no audit
 * restored first, so a project holding only events still folds.
 *
 * An assessment event replaces the stored row with the same
 * {@link assessmentKey}; a set event replaces the set with the same id. An
 * event that is not shaped right is skipped, never thrown on — the journal is
 * append-only, and a bad line stays forever.
 */
export function foldWeighingEvents(
  section: WeighingSection | undefined,
  events: readonly JournalEvent[],
): WeighingSection | undefined {
  const relevant = events.filter((event) => event?.type === WEIGHING_ASSESSMENT_RECORDED || event?.type === WEIGHING_SET_SAVED);
  if (relevant.length === 0) return section;

  let assessments = asArray<WeighingAssessment>(section?.assessments);
  let sets = asArray<WeighingCriteriaSet>(section?.sets);

  for (const event of relevant) {
    if (event.type === WEIGHING_ASSESSMENT_RECORDED) {
      const row = assessmentOfEvent(event);
      if (row !== undefined) assessments = upsertWeighingAssessment(assessments, row).assessments;
      continue;
    }
    const set = (event as { set?: unknown }).set;
    if (typeof set !== "object" || set === null || Array.isArray(set)) continue;
    const id = (set as { id?: unknown }).id;
    if (typeof id !== "string" || id === "") continue;
    const at = sets.findIndex((existing) => existing?.id === id);
    sets = at === -1 ? [...sets, set as WeighingCriteriaSet] : sets.map((existing, i) => (i === at ? (set as WeighingCriteriaSet) : existing));
  }

  return { ...(section ?? {}), sets, matrices: asArray<WeighingMatrix>(section?.matrices), assessments };
}
```

- [ ] **Step 4: Run the tests**

Run: `node tests/schema/weighing-events.test.js && npm run test:journal && npm run test:schema && npx tsc --noEmit -p . && npx eslint packages/schema/src`
Expected: 50 `PASS:` lines, `All weighing-events tests passed.`, the others green, `tsc` and `eslint` silent.

- [ ] **Step 5: Commit**

```bash
git add packages/schema/src/weighing-events.ts tests/schema/weighing-events.test.js
git commit -m "feat(weighing): foldWeighingEvents — latest wins per cell and scorer kind (part 3/5)"
```

### Task 3.4: Repo sidecars, `pack`, `restore`, `push`

**Files:**
- Create: `packages/schema/src/cli/weighing-files.ts`, `packages/cli/src/lib/weighing-io.ts`
- Modify: `packages/cli/src/io.ts`, `packages/cli/src/commands/{pack,push,restore}.ts`
- Create: `tests/cli/weighing.test.js`
- Modify: `package.json`, `.gitignore`

- [ ] **Step 1: Write the failing test**

Create `tests/cli/weighing.test.js` (drives the built CLI for `pack`, an esbuild-bundled `push.ts` with a mock `httpClient` for the network half — the techniques `quality-section-fold.test.js` and `push.test.js` already use; nothing reaches a network):

```js
#!/usr/bin/env node

/**
 * The weighing sidecars (docs/rfcs/weighing.md): `docs/weighing/` folded into a
 * bundle's `weighing` section by `arkaik pack`, deleted by `--no-weighing`, and
 * withheld by `arkaik push` unless `--include-weighing` says otherwise.
 *
 * Drives the BUILT CLI in mkdtemp repos for `pack`, and an esbuild-bundled
 * `push.ts` in-process with a mock `httpClient` for the network half — the two
 * techniques tests/cli/quality-section-fold.test.js and tests/cli/push.test.js
 * already use, so nothing here ever reaches a real network.
 *
 * Run via `npm run test:weighing-cli` (builds the CLI first).
 */

const { build } = require("esbuild");
const { spawnSync } = require("child_process");
const { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("fs");
const { tmpdir } = require("os");
const path = require("path");
const { pathToFileURL } = require("url");

const ROOT = path.join(__dirname, "..", "..");
const CLI = path.join(ROOT, "packages", "cli", "dist", "index.js");
const PUSH_ENTRY = path.join(ROOT, "packages", "cli", "src", "commands", "push.ts");
const TEST_BUILD_DIR = path.join(ROOT, "packages", "cli", ".test-build-weighing");
const PUSH_BUNDLE = path.join(TEST_BUILD_DIR, "push.mjs");

if (!existsSync(CLI)) {
  console.error(`CLI not built at ${CLI}. Run \`npm run build -w arkaik\` first.`);
  process.exit(1);
}

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`PASS: ${name}`);
  else {
    failures++;
    console.log(`FAIL: ${name}${detail ? `\n${detail}` : ""}`);
  }
}

const BUNDLE = {
  schema_version: 3,
  project: { id: "demo", title: "Demo", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" },
  nodes: [{ id: "AC-a", project_id: "demo", species: "acceptance", title: "Accept an invite", status: "live", platforms: ["web"], metadata: { values: ["connects"] } }],
  edges: [],
};

const HUMAN = { kind: "human", id: "alexis" };
const ROW = (over = {}) => ({
  matrix: "value",
  subject: "AC-a",
  criterion: "connects",
  level: 2,
  scorer: HUMAN,
  confidence: 2,
  evidence: "the title says so",
  basis: { fingerprint: "fp1-0", set_version: "1.0.0" },
  ts: "2026-11-15T10:00:00.000Z",
  ...over,
});
const POSITIONING = {
  id: "positioning",
  version: "1.0.0",
  subject: "acceptance",
  scale: { min: -3, max: 3, anchors: {} },
  role: "positioning",
  status: "active",
  extends: "value-contribution@1",
  criteria: [{ id: "connects", weight: 3 }],
};

/** A repo: docs/arkaik/bundle.json, plus docs/weighing/ files unless `withFiles` is false. */
function repo({ withFiles = true, bundle = BUNDLE } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "arkaik-weighing-"));
  mkdirSync(path.join(dir, "docs", "arkaik"), { recursive: true });
  writeFileSync(path.join(dir, "docs", "arkaik", "bundle.json"), JSON.stringify(bundle, null, 2));
  if (withFiles) {
    mkdirSync(path.join(dir, "docs", "weighing", "assessments"), { recursive: true });
    mkdirSync(path.join(dir, "docs", "weighing", "sets"), { recursive: true });
    writeFileSync(
      path.join(dir, "docs", "weighing", "assessments", "value.json"),
      JSON.stringify({ matrix: "value", assessments: [ROW({ level: 3, scorer: { kind: "agent", id: "arkaik-mcp" } }), ROW()] }, null, 2),
    );
    writeFileSync(path.join(dir, "docs", "weighing", "sets", "positioning.json"), JSON.stringify(POSITIONING, null, 2));
  }
  return { dir, bundlePath: path.join(dir, "docs", "arkaik", "bundle.json") };
}

const pack = (args, cwd) => spawnSync(process.execPath, [CLI, "pack", ...args], { encoding: "utf8", cwd });

async function main() {
  // --- pack folds the sidecars -----------------------------------------------
  {
    const { dir, bundlePath } = repo();
    const elsewhere = mkdtempSync(path.join(tmpdir(), "arkaik-weighing-elsewhere-"));
    const res = pack([bundlePath], elsewhere);
    check("pack exits 0", res.status === 0, res.stderr);
    const out = JSON.parse(res.stdout);
    check("pack folds the assessments of every scorer kind", out.weighing?.assessments?.length === 2, JSON.stringify(out.weighing?.assessments?.length));
    check("…in the stable order: authority within a cell", out.weighing.assessments[0].scorer.kind === "human" && out.weighing.assessments[1].scorer.kind === "agent");
    check("pack folds the positioning set", out.weighing.sets.length === 1 && out.weighing.sets[0].id === "positioning" && out.weighing.sets[0].criteria[0].weight === 3);
    check("the built-in matrix is not stored", Array.isArray(out.weighing.matrices) && out.weighing.matrices.length === 0);
    check("the root is the bundle's repo, not the cwd (a repo elsewhere folds in)", out.weighing !== undefined);
    check("pack says what it folded", /Weighing: folded 2 assessment\(s\), 1 set\(s\)/.test(res.stderr), res.stderr);
    check("the source bundle file is never rewritten", !("weighing" in JSON.parse(readFileSync(bundlePath, "utf8"))));
    check("schema_version stays 3", out.schema_version === 3);
    rmSync(dir, { recursive: true, force: true });
    rmSync(elsewhere, { recursive: true, force: true });
  }

  // --- nothing to fold is not a failure -----------------------------------------
  {
    const { dir, bundlePath } = repo({ withFiles: false });
    const res = pack([bundlePath], dir);
    check("no docs/weighing/ still packs", res.status === 0, res.stderr);
    check("…and adds no section", !("weighing" in JSON.parse(res.stdout)));
    check("…and says so", /Weighing: none to fold/.test(res.stderr), res.stderr);
    rmSync(dir, { recursive: true, force: true });
  }
  {
    const { dir, bundlePath } = repo({ withFiles: false, bundle: { ...BUNDLE, weighing: { sets: [], matrices: [], assessments: [ROW()] } } });
    const res = pack([bundlePath], dir);
    const out = JSON.parse(res.stdout);
    check("a section the bundle already carried survives a fold with nothing to fold", out.weighing?.assessments?.length === 1);
    check("…and the notice says it was kept", /Kept the weighing section/.test(res.stderr), res.stderr);
    rmSync(dir, { recursive: true, force: true });
  }

  // --- --no-weighing DELETES ------------------------------------------------------
  {
    const { dir, bundlePath } = repo({ bundle: { ...BUNDLE, weighing: { sets: [], matrices: [], assessments: [ROW()] } } });
    const res = pack(["--no-weighing", bundlePath], dir);
    const out = JSON.parse(res.stdout);
    check("--no-weighing removes the section, folded or carried", !("weighing" in out));
    check("--no-weighing does not touch quality or the rest", out.nodes.length === 1);
    rmSync(dir, { recursive: true, force: true });
  }

  // --- a malformed sidecar is named ---------------------------------------------------
  {
    const { dir, bundlePath } = repo();
    writeFileSync(path.join(dir, "docs", "weighing", "assessments", "value.json"), "{ not json");
    const res = pack([bundlePath], dir);
    check("a malformed sidecar fails the pack", res.status !== 0);
    check("…naming the file", /value\.json/.test(res.stderr), res.stderr);
    rmSync(dir, { recursive: true, force: true });
  }
  {
    const { dir, bundlePath } = repo();
    writeFileSync(path.join(dir, "docs", "weighing", "assessments", "value.json"), JSON.stringify({ matrix: "value" }));
    const res = pack([bundlePath], dir);
    check("a file with no assessments array fails the pack, naming it", res.status !== 0 && /value\.json/.test(res.stderr), res.stderr);
    rmSync(dir, { recursive: true, force: true });
  }

  // --- push withholds it by default ---------------------------------------------------
  mkdirSync(TEST_BUILD_DIR, { recursive: true });
  await build({ entryPoints: [PUSH_ENTRY], outfile: PUSH_BUNDLE, bundle: true, platform: "node", target: "node18", format: "esm", legalComments: "none" });
  const { runPush, DEFAULT_API_BASE } = await import(pathToFileURL(PUSH_BUNDLE).href);
  const client = (sink) => async (url, init) => {
    sink.push({ url, body: JSON.parse(init.body) });
    return { ok: true, status: 201, json: async () => ({ id: "abc", url: `${DEFAULT_API_BASE}/p/abc`, owner_key: "11111111-1111-4111-8111-111111111111" }), headers: { get: () => null } };
  };
  {
    const { dir, bundlePath } = repo({ bundle: { ...BUNDLE, weighing: { sets: [], matrices: [], assessments: [ROW()] } } });
    const calls = [];
    const result = await runPush({ path: bundlePath, cwd: dir, httpClient: client(calls) });
    check("a default push succeeds", result.ok === true && result.status === 201, JSON.stringify(result));
    check("the default push never sends a weighing section — carried or folded", calls.length === 1 && !("weighing" in calls[0].body));
    check("…and forwards no include_weighing", calls[0].url === `${DEFAULT_API_BASE}/api/publik`, calls[0].url);
    check("…no assessment evidence is anywhere in the body", !JSON.stringify(calls[0].body).includes("the title says so"));
    rmSync(dir, { recursive: true, force: true });
  }
  {
    const { dir, bundlePath } = repo();
    const calls = [];
    const result = await runPush({ path: bundlePath, cwd: dir, includeWeighing: true, httpClient: client(calls) });
    check("--include-weighing succeeds", result.ok === true && result.status === 201, JSON.stringify(result));
    check("…folds the repo's docs/weighing/ into the body", calls[0].body.weighing?.assessments?.length === 2);
    check("…and forwards ?include_weighing=true", calls[0].url === `${DEFAULT_API_BASE}/api/publik?include_weighing=true`, calls[0].url);
    rmSync(dir, { recursive: true, force: true });
  }
  {
    const { dir, bundlePath } = repo();
    const calls = [];
    await runPush({ path: bundlePath, cwd: dir, includeWeighing: true, includeQuality: true, includeJournal: true, httpClient: client(calls) });
    check("the three opt-ins combine into one query string", calls[0].url === `${DEFAULT_API_BASE}/api/publik?include_journal=true&include_quality=true&include_weighing=true`, calls[0].url);
    rmSync(dir, { recursive: true, force: true });
  }

  rmSync(TEST_BUILD_DIR, { recursive: true, force: true });
  if (failures > 0) {
    console.log(`\n${failures} weighing CLI test(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll weighing CLI tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 2: Wire it into `test:cli` and ignore its build dir**

In `package.json`, change the end of the `"test:cli"` script from `… && node tests/cli/kritik-plan-record.test.js",` to `… && node tests/cli/kritik-plan-record.test.js && node tests/cli/weighing.test.js",`.

In `.gitignore`, after the `/packages/cli/.test-build-quality/` line add `/packages/cli/.test-build-weighing/`.

- [ ] **Step 3: Run it to verify it fails**

Run: `npm run build -w arkaik && node tests/cli/weighing.test.js`
Expected: FAIL — `FAIL: pack folds the assessments of every scorer kind` (the CLI does not know `docs/weighing/` yet) and the checks that follow it.

- [ ] **Step 4: Write the sidecar files module**

```ts
/**
 * The weighing sidecar files under `docs/weighing/` — reading them, writing
 * them, and folding them into a `WeighingSection`.
 *
 * `weighing.ts` answers "what is an assessment"; this answers "where does a
 * repository keep them". The files are **canonical in a repository** — the same
 * doctrine as the journal's JSONL sidecar and Kritik's `docs/quality/`
 * (docs/spec/journal.md § Storage Shapes) — with the bundle's `weighing` key as
 * the interchange projection `arkaik pack` builds. Nothing here writes to a
 * bundle.
 *
 *   docs/weighing/
 *     sets/<set-id>.json            a project-authored criteria set — the positioning
 *     assessments/<matrix-id>.json  { matrix, assessments[] }, latest per scorer kind
 *
 * Like `kritik-audit.ts`, everything here **throws** rather than exits: the
 * `arkaik` CLI turns a throw into a usage-shaped failure and the MCP tools turn
 * it into a `ToolError` an agent can read.
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { sortWeighingAssessments, type WeighingAssessment, type WeighingCriteriaSet, type WeighingSection } from "../weighing";
import { readJson, writeJson } from "./kritik-paths";

/** Where a project's own weighing files live, relative to the repo root. */
export const WEIGHING_DIR = "docs/weighing";
export const WEIGHING_SETS_DIR = "sets";
export const WEIGHING_ASSESSMENTS_DIR = "assessments";

/** `assessments/<matrix>.json`: one matrix's stored cells. */
export interface AssessmentsFile {
  matrix: string;
  assessments: WeighingAssessment[];
}

/**
 * An id is a file name, so it is held to kebab-case here as well as upstream:
 * `../` in a matrix id must never be able to reach outside `docs/weighing/`.
 */
function safeId(id: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error(`"${id}" is not a valid weighing id (kebab-case, no path separators)`);
  return id;
}

export const weighingDir = (root: string): string => join(root, WEIGHING_DIR);
export const weighingSetPath = (root: string, setId: string): string => join(weighingDir(root), WEIGHING_SETS_DIR, `${safeId(setId)}.json`);
export const weighingAssessmentsPath = (root: string, matrixId: string): string =>
  join(weighingDir(root), WEIGHING_ASSESSMENTS_DIR, `${safeId(matrixId)}.json`);

/** The `.json` files of a directory, by name; none when it does not exist. */
function jsonFilesIn(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => join(dir, name));
}

/** Every project-authored set on disk, by file name. */
export function loadWeighingSets(root: string): WeighingCriteriaSet[] {
  return jsonFilesIn(join(weighingDir(root), WEIGHING_SETS_DIR)).map((file) => readJson<WeighingCriteriaSet>(file));
}

/** Every stored assessment on disk, matrix by matrix. A file that is not `{ assessments: [] }` throws, naming the file. */
export function loadWeighingAssessments(root: string): WeighingAssessment[] {
  return jsonFilesIn(join(weighingDir(root), WEIGHING_ASSESSMENTS_DIR)).flatMap((file) => {
    const parsed = readJson<Partial<AssessmentsFile>>(file);
    if (!Array.isArray(parsed.assessments)) throw new Error(`${file}: expected { "matrix": …, "assessments": [] }`);
    return parsed.assessments;
  });
}

/**
 * The section the files hold, or `undefined` when there is nothing to fold —
 * no `docs/weighing/`, or one with no sets and no assessments in it. Assessments
 * come back in the stable order a save writes, so a packed bundle is
 * byte-for-byte the same however the files were edited. `matrices`
 * stays empty: the built-in `value` matrix is library content, and a
 * project-defined matrix is not a slice-1 feature.
 */
export function loadWeighingSection(root: string): WeighingSection | undefined {
  const sets = loadWeighingSets(root);
  const assessments = loadWeighingAssessments(root);
  if (sets.length === 0 && assessments.length === 0) return undefined;
  return { sets, matrices: [], assessments: sortWeighingAssessments(assessments) };
}

/** Write one matrix's cells, in the stable order that keeps two writers' diffs small. */
export function saveWeighingAssessments(root: string, matrixId: string, assessments: readonly WeighingAssessment[]): void {
  const file: AssessmentsFile = { matrix: matrixId, assessments: sortWeighingAssessments(assessments) };
  writeJson(weighingAssessmentsPath(root, matrixId), file);
}

/** Write one set — the positioning. */
export function saveWeighingSet(root: string, set: WeighingCriteriaSet): void {
  writeJson(weighingSetPath(root, set.id), set);
}

/** The stored cells of one matrix, `[]` when its file does not exist. */
export function loadMatrixAssessments(root: string, matrixId: string): WeighingAssessment[] {
  const file = weighingAssessmentsPath(root, matrixId);
  if (!existsSync(file)) return [];
  const parsed = readJson<Partial<AssessmentsFile>>(file);
  if (!Array.isArray(parsed.assessments)) throw new Error(`${file}: expected { "matrix": …, "assessments": [] }`);
  return parsed.assessments;
}
```

- [ ] **Step 5: Write the CLI's fold and export it through `arkaik/io`**

```ts
/**
 * What `arkaik pack`, `arkaik restore` and the MCP server need from the
 * environment to carry a project's weighing state: **fold the repo's
 * `docs/weighing/` sidecars into a bundle's `weighing` key**.
 *
 * The model, the files and the projection are `@arkaik/schema`'s
 * (`packages/schema/src/cli/weighing-files.ts`); this is only what "being the
 * CLI's environment" means — turning "there is nothing to fold" into a line a
 * human can act on. It is exported through `arkaik/io` (docs/spec/mcp.md
 * § Reuse Seams), and the repo root it folds from is the one `resolveQualityRoot`
 * already answers: which repo owns a bundle file is one question, not two.
 */

import { loadWeighingSection, weighingDir } from "@arkaik/schema/src/cli/weighing-files";

/** What {@link foldWeighingSection} did, for a caller that wants the fact rather than the sentence. */
export interface FoldWeighingResult {
  /** A section was built from `docs/weighing/` and written onto the bundle. */
  folded: boolean;
  /** Nothing was folded AND the bundle arrived carrying its own `weighing`, which is therefore still on it. */
  carriedSection: boolean;
  notice: string;
}

function isSection(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Fold the repo's weighing sidecars into a bundle's `weighing` section.
 *
 * MUTATES `bundle`, like `foldQualitySection`: `runPack` owns a throwaway parse
 * of the source file, and what its caller wants back is the notice. Nothing to
 * fold is never a failure — weighing is additive, a project with no
 * `docs/weighing/` must still pack — and "leave the bundle untouched" is
 * literal: a section the bundle already carried survives, which is what lets
 * `arkaik restore <backup>` put the weighing half back too. What DOES throw is
 * a *malformed* sidecar, named by its path.
 */
export function foldWeighingSection(bundle: Record<string, unknown>, root: string): FoldWeighingResult {
  const section = loadWeighingSection(root);
  if (section === undefined) {
    const carriedSection = isSection(bundle.weighing);
    return {
      folded: false,
      carriedSection,
      notice: carriedSection
        ? `Weighing: none to fold — no files under ${weighingDir(root)}\n  Kept the weighing section this bundle already carried — nothing replaced it.`
        : `Weighing: none to fold — no files under ${weighingDir(root)}`,
    };
  }
  bundle.weighing = section;
  return {
    folded: true,
    carriedSection: false,
    notice: `Weighing: folded ${section.assessments?.length ?? 0} assessment(s), ${section.sets?.length ?? 0} set(s) from ${weighingDir(root)}`,
  };
}
```

```diff
--- a/packages/cli/src/io.ts
+++ b/packages/cli/src/io.ts
@@ -33,6 +33,7 @@
   resolveQualityRoot,
   type ResolvedPack,
 } from "./lib/kritik-io";
+export { foldWeighingSection, type FoldWeighingResult } from "./lib/weighing-io";
 export {
   validateBundleAt,
   journalLineErrorLines,
```

- [ ] **Step 6: `pack` folds, `--no-weighing` deletes**

```diff
--- a/packages/cli/src/commands/pack.ts
+++ b/packages/cli/src/commands/pack.ts
@@ -1,6 +1,6 @@
 /**
- * `arkaik pack [--no-journal] [--no-quality] [--inline-assets] [--audit <id>]
- *              [--root <dir>] [--out <path>] [path]`.
+ * `arkaik pack [--no-journal] [--no-quality] [--no-weighing] [--inline-assets]
+ *              [--audit <id>] [--root <dir>] [--out <path>] [path]`.
  *
  * Produces a SINGLE self-contained interchange bundle (docs/spec/journal.md §
  * Interchange: embedded journal[]; docs/spec/bundle-format.md § Asset Values):
@@ -28,6 +28,14 @@
  *     merge, and `--root <dir>` overrides the repo root the sidecars are
  *     looked for under (see `resolveQualityRoot` — the default follows the
  *     bundle, not the cwd);
+ *  3b. weighing folding — `docs/weighing/` is canonical for a project's
+ *     positioning and assessments exactly as `docs/quality/` is for its audits
+ *     (docs/rfcs/weighing.md), with `bundle.weighing` as the interchange
+ *     projection. The sidecars of the packed bundle's own repo root are
+ *     merged into `weighing` (`lib/weighing-io.ts`); no files means no
+ *     section, never a failure. `--no-weighing` DELETES `weighing` instead,
+ *     for the reason `--no-quality` does. The root is the same one quality
+ *     uses — which repo owns a bundle file is one question;
  *  4. `--inline-assets` (OFF by default, local-only in v1): every
  *     `metadata.platformScreenshots` value that is a *relative path* (no URI
  *     scheme, no leading `/` — docs/spec/bundle-format.md § Asset Values) is
@@ -53,16 +61,17 @@
 import { readBundle } from "../lib/bundle-io";
 import { loadJournalEvents } from "../lib/journal-io";
 import { foldQualitySection, resolveQualityRoot } from "../lib/kritik-io";
+import { foldWeighingSection } from "../lib/weighing-io";
 
 const DEFAULT_BUNDLE_PATH = "docs/arkaik/bundle.json";
 
-const USAGE = `arkaik pack [--no-journal] [--no-quality] [--inline-assets] [--audit <id>]
-            [--root <dir>] [--out <path>] [path]
+const USAGE = `arkaik pack [--no-journal] [--no-quality] [--no-weighing] [--inline-assets]
+            [--audit <id>] [--root <dir>] [--out <path>] [path]
 
 Produce a single self-contained interchange bundle: fold in the sidecar
 journal (or keep an existing embedded one), fold docs/quality/ into the
-quality section, and, with --inline-assets, inline local screenshot files as
-data: URIs. Written canonically via serializeBundle. Unknown top-level keys
+quality section, fold docs/weighing/ into the weighing section, and, with
+--inline-assets, inline local screenshot files as data: URIs. Written canonically via serializeBundle. Unknown top-level keys
 and unknown fields always round-trip.
 
 Arguments:
@@ -83,6 +92,10 @@
                      find it in. ("arkaik push" packs this way by default;
                      its --include-quality opts back in.)
                      Default: docs/quality/ IS folded in.
+  --no-weighing     DELETE the weighing section rather than folding one in, for
+                     the same reason --no-quality deletes: a source bundle that
+                     already carried one must not be packed with it either.
+                     Default: docs/weighing/ IS folded in.
   --inline-assets   Convert relative-path metadata.platformScreenshots values
                      into data: URIs by reading the file from disk (resolved
                      against the bundle's directory). Absolute https:// URLs
@@ -148,6 +161,8 @@
   inlineAssets?: boolean;
   /** Delete `quality` rather than folding docs/quality/ in — including a section the source bundle already carried. The Publik-safe posture, as `noJournal` is for history. */
   noQuality?: boolean;
+  /** Delete `weighing` rather than folding docs/weighing/ in — including a section the source bundle already carried. */
+  noWeighing?: boolean;
   /** Pin one audit's snapshot instead of merging every audit into current state. */
   audit?: string;
   /** Repo root holding docs/quality/, resolved against `cwd`. Default: NOT `cwd` — {@link resolveQualityRoot} derives it from the bundle's own path, with `cwd` only as the fallback for a bundle outside `docs/arkaik/`. */
@@ -168,6 +183,10 @@
   inlinedAssets: InlinedAsset[];
   /** Non-fatal notices — e.g. an asset referenced by a relative path that was not found on disk. */
   assetWarnings: string[];
+  /** Whether a `weighing` section was actually folded in. Absent with `noWeighing`. */
+  weighingFolded?: boolean;
+  /** What the weighing fold did — folded, or nothing to fold. Absent with `noWeighing`. */
+  weighingNotice?: string;
   /** Whether a `quality` section was actually folded in. Absent with `noQuality`. */
   qualityFolded?: boolean;
   /** What the quality fold did — folded, skipped, or nothing to fold. Absent with `noQuality`. */
@@ -238,6 +257,21 @@
     }
   }
 
+  let weighingFolded: boolean | undefined;
+  let weighingNotice: string | undefined;
+  if (options.noWeighing ?? false) {
+    delete bundle.weighing;
+  } else {
+    const root = resolveQualityRoot({ root: options.root, bundlePath: filePath, fallback: cwd });
+    try {
+      const fold = foldWeighingSection(bundle, root);
+      weighingFolded = fold.folded;
+      weighingNotice = fold.notice;
+    } catch (e) {
+      return fatalResult(filePath, (e as Error).message);
+    }
+  }
+
   const inlinedAssets: InlinedAsset[] = [];
   const assetWarnings: string[] = [];
   if (inlineAssets) {
@@ -275,12 +309,26 @@
     writeFileSync(outPath, output);
   }
 
-  return { ok: true, bundlePath: filePath, outPath, journalIncluded, journalEventCount, inlinedAssets, assetWarnings, qualityFolded, qualityNotice, output };
+  return {
+    ok: true,
+    bundlePath: filePath,
+    outPath,
+    journalIncluded,
+    journalEventCount,
+    inlinedAssets,
+    assetWarnings,
+    qualityFolded,
+    qualityNotice,
+    weighingFolded,
+    weighingNotice,
+    output,
+  };
 }
 
 export function runPackCli(args: string[]): void {
   let noJournal = false;
   let noQuality = false;
+  let noWeighing = false;
   let inlineAssets = false;
   let audit: string | undefined;
   let root: string | undefined;
@@ -296,6 +344,8 @@
       noJournal = true;
     } else if (arg === "--no-quality") {
       noQuality = true;
+    } else if (arg === "--no-weighing") {
+      noWeighing = true;
     } else if (arg === "--inline-assets") {
       inlineAssets = true;
     } else if (arg === "--audit") {
@@ -329,7 +379,7 @@
   }
 
   const filePath = positionals[0] ?? DEFAULT_BUNDLE_PATH;
-  const result = runPack({ path: filePath, out, noJournal, inlineAssets, noQuality, audit, root });
+  const result = runPack({ path: filePath, out, noJournal, inlineAssets, noQuality, noWeighing, audit, root });
   if (!result.ok) fail(`FATAL: ${result.fatal}`);
 
   if (result.journalIncluded) {
@@ -342,6 +392,9 @@
   if (result.qualityNotice !== undefined) {
     console.error(result.qualityNotice);
   }
+  if (result.weighingNotice !== undefined) {
+    console.error(result.weighingNotice);
+  }
   for (const asset of result.inlinedAssets) {
     console.error(`Inlined asset: ${asset.nodeId}/${asset.platform} (${asset.path})`);
   }
```

- [ ] **Step 7: `push` withholds, `--include-weighing` opts in**

```diff
--- a/packages/cli/src/commands/push.ts
+++ b/packages/cli/src/commands/push.ts
@@ -1,5 +1,6 @@
 /**
- * `arkaik push [--include-journal] [--include-quality] [--api <base-url>] [path]`
+ * `arkaik push [--include-journal] [--include-quality] [--include-weighing]
+ *             [--api <base-url>] [path]`
  * `arkaik push --delete <id> --key <owner_key> [--api <base-url>]`
  *
  * Completes the Kommit journey — repo bundle to shareable URL without
@@ -25,7 +26,11 @@
  *     `--include-quality` flips it. The two are separate decisions on
  *     purpose: publishing your history and publishing your open findings are
  *     different disclosures, and both default to no.
- *  3. `POST {api}/api/publik[?include_journal=true][&include_quality=true]`
+ *     `noWeighing: !includeWeighing` is the same posture for a weighing
+ *     section (docs/rfcs/weighing.md): what a product scores its promises
+ *     against its own values, and the costs it has admitted, is a third
+ *     disclosure with a third default of no. `--include-weighing` flips it.
+ *  3. `POST {api}/api/publik[?include_journal=true][&include_quality=true][&include_weighing=true]`
  *     with the packed, canonical bundle as the body (docs/spec/services.md
  *     § Publik → Protocol — the API this command talks to is implemented at
  *     `app/api/publik/route.ts` / `lib/services/publik.ts`).
@@ -63,7 +68,8 @@
 /** Default Publik host — override with `--api <base-url>` for self-hosted deployments. */
 export const DEFAULT_API_BASE = "https://arkaik.app";
 
-const USAGE = `arkaik push [--include-journal] [--include-quality] [--api <base-url>] [path]
+const USAGE = `arkaik push [--include-journal] [--include-quality] [--include-weighing]
+            [--api <base-url>] [path]
 arkaik push --delete <id> --key <owner_key> [--api <base-url>]
 
 Publish a project bundle to Publik (anonymous, account-less snapshot
@@ -79,7 +85,9 @@
 
 A Kritik "quality" section is stripped by default too, and separately:
 publishing your history and publishing your open findings are two decisions,
-not one, and both default to no. --include-quality opts in.
+not one, and both default to no. --include-quality opts in. A "weighing"
+section (a positioning and the assessments scored against it) is a third
+decision with a third default of no: --include-weighing opts in.
 
 Snapshots are immutable: there is no update verb. Pushing again always mints
 a new id. The owner key printed on success is shown exactly once and cannot
@@ -100,6 +108,11 @@
                        § 8.3) — publishing that is a decision worth typing.
                        Default: deleted before packing, so it is never in the
                        request body at all.
+  --include-weighing  Embed the weighing section and forward
+                       ?include_weighing=true. Opt-in: it holds what the
+                       product scores its own promises, costs included.
+                       Default: deleted before packing, so it is never in
+                       the request body at all.
   --api <base-url>    Publik API base URL (default: ${DEFAULT_API_BASE}).
                        Point at a self-hosted deployment.
   --delete <id>       Delete a snapshot by id instead of pushing. Requires
@@ -124,6 +137,8 @@
   includeJournal?: boolean;
   /** Embed the quality section (forwarding ?include_quality=true) instead of stripping it. */
   includeQuality?: boolean;
+  /** Embed the weighing section (forwarding ?include_weighing=true) instead of stripping it. */
+  includeWeighing?: boolean;
   /** Publik API base URL (default: https://arkaik.app). */
   apiBase?: string;
   /** Base directory `path` resolves against (default: process.cwd()). */
@@ -195,6 +210,7 @@
   const filePath = resolve(cwd, options.path ?? DEFAULT_BUNDLE_PATH);
   const includeJournal = options.includeJournal ?? false;
   const includeQuality = options.includeQuality ?? false;
+  const includeWeighing = options.includeWeighing ?? false;
   const apiBase = options.apiBase ?? DEFAULT_API_BASE;
   const httpClient = options.httpClient ?? DEFAULT_HTTP_CLIENT;
 
@@ -221,7 +237,13 @@
   // No `root:` here on purpose — runPack derives it from the bundle's own
   // path, and passing the cwd would fold whichever repo the user happens to
   // be standing in.
-  const packed = runPack({ path: filePath, noJournal: !includeJournal, noQuality: !includeQuality, cwd });
+  const packed = runPack({
+    path: filePath,
+    noJournal: !includeJournal,
+    noQuality: !includeQuality,
+    noWeighing: !includeWeighing,
+    cwd,
+  });
   if (!packed.ok) {
     return fatalResult(filePath, packed.fatal ?? "pack failed");
   }
@@ -234,6 +256,7 @@
   const params: string[] = [];
   if (includeJournal) params.push("include_journal=true");
   if (includeQuality) params.push("include_quality=true");
+  if (includeWeighing) params.push("include_weighing=true");
   const url = `${apiBase}/api/publik${params.length > 0 ? `?${params.join("&")}` : ""}`;
 
   let res: Response;
@@ -436,6 +459,7 @@
 export function runPushCli(args: string[]): void {
   let includeJournal = false;
   let includeQuality = false;
+  let includeWeighing = false;
   let apiBase: string | undefined;
   let deleteId: string | undefined;
   let key: string | undefined;
@@ -450,6 +474,8 @@
       includeJournal = true;
     } else if (arg === "--include-quality") {
       includeQuality = true;
+    } else if (arg === "--include-weighing") {
+      includeWeighing = true;
     } else if (arg === "--api") {
       const value = args[++i];
       if (value === undefined) fail(`Missing value for --api\n\n${USAGE}`);
@@ -485,7 +511,7 @@
 
   const filePath = positionals[0] ?? DEFAULT_BUNDLE_PATH;
 
-  runPush({ path: filePath, includeJournal, includeQuality, apiBase })
+  runPush({ path: filePath, includeJournal, includeQuality, includeWeighing, apiBase })
     .then((result) => {
       if (!result.ok) fail(`FATAL: ${result.fatal}`);
       reportPush(result);
```

- [ ] **Step 8: `restore` carries it**

```diff
--- a/packages/cli/src/commands/restore.ts
+++ b/packages/cli/src/commands/restore.ts
@@ -1,6 +1,7 @@
 /**
  * `arkaik restore [--dry-run] [--allow-history-loss] [--allow-deletions]
- *                 [--no-quality] [--allow-quality-loss] [--allow-metadata-loss]
+ *                 [--no-quality] [--no-weighing] [--allow-quality-loss]
+ *                 [--allow-metadata-loss]
  *                 [--audit <id>]
  *                 [--root <dir>] [--api <base-url>] [path]`
  *
@@ -172,6 +173,7 @@
 import { join, resolve } from "node:path";
 import { journalPathFor, loadJournalEvents } from "../lib/journal-io";
 import { foldQualitySection, isQualitySection, resolveQualityRoot } from "../lib/kritik-io";
+import { foldWeighingSection } from "../lib/weighing-io";
 import { QUALITY_DIR } from "@arkaik/schema/src/cli/kritik-paths";
 import { DEFAULT_HTTP_CLIENT, type HttpClient } from "../lib/providers";
 
@@ -223,6 +225,12 @@
                         one — that needs --allow-quality-loss too, because
                         "don't send mine" and "destroy theirs" are different
                         decisions and only one of them is irreversible.
+  --no-weighing         Do not send a weighing section: skip the docs/weighing/
+                        fold AND drop any section the local bundle already
+                        carries. A restore replaces the hosted journal, and
+                        with it any assessment written hosted since the last
+                        one — the history-loss guard below is what catches
+                        that, as it does for every other event.
   --allow-quality-loss  Proceed even though the restore would erase a quality
                         section the hosted project currently has. Without this
                         flag, that refuses outright — it usually means
@@ -267,6 +275,8 @@
   allowDeletions?: boolean;
   /** Skip folding docs/quality/ into the outbound bundle, and drop any section the local bundle carries. Default: false. */
   noQuality?: boolean;
+  /** Skip folding docs/weighing/ into the outbound bundle, and drop any section the local bundle carries. Default: false. */
+  noWeighing?: boolean;
   /** Pin one audit's snapshot instead of merging every audit into current state. */
   audit?: string;
   /** Repo root holding docs/quality/. Default: derived from the bundle's path, cwd as fallback. */
@@ -655,6 +665,7 @@
   const allowHistoryLoss = options.allowHistoryLoss ?? false;
   const allowDeletions = options.allowDeletions ?? false;
   const noQuality = options.noQuality ?? false;
+  const noWeighing = options.noWeighing ?? false;
   const allowQualityLoss = options.allowQualityLoss ?? false;
   const allowMetadataLoss = options.allowMetadataLoss ?? false;
   const httpClient = options.httpClient ?? DEFAULT_HTTP_CLIENT;
@@ -721,6 +732,19 @@
     }
   }
   const qualityFields = { qualityFolded, qualityNotice };
+
+  // Weighing rides the same bundle, from the same repo root. No loss guard of
+  // its own: an assessment written hosted lives in the journal, and a restore
+  // that would shrink the journal is already refused by the history guard.
+  if (noWeighing) {
+    delete outboundBundle.weighing;
+  } else {
+    try {
+      foldWeighingSection(outboundBundle, qualityRoot);
+    } catch (e) {
+      return fatalResult(dryRun, (e as Error).message);
+    }
+  }
 
   const headers = { Authorization: `Bearer ${token}` };
 
@@ -1023,6 +1047,7 @@
   let allowHistoryLoss = false;
   let allowDeletions = false;
   let noQuality = false;
+  let noWeighing = false;
   let allowQualityLoss = false;
   let allowMetadataLoss = false;
   let audit: string | undefined;
@@ -1044,6 +1069,8 @@
       allowDeletions = true;
     } else if (arg === "--no-quality") {
       noQuality = true;
+    } else if (arg === "--no-weighing") {
+      noWeighing = true;
     } else if (arg === "--allow-quality-loss") {
       allowQualityLoss = true;
     } else if (arg === "--allow-metadata-loss") {
@@ -1082,6 +1109,7 @@
     allowHistoryLoss,
     allowDeletions,
     noQuality,
+    noWeighing,
     allowQualityLoss,
     allowMetadataLoss,
     audit,
```

- [ ] **Step 9: Run the CLI suites**

Run: `npm run test:cli && npm run test:bootstrap && npx tsc --noEmit -p . && npx eslint packages`
Expected: `All weighing CLI tests passed.` (27 `PASS:` lines) and every other CLI suite green (the bootstrap restore suite exercises `restore`); `tsc` and `eslint` silent.

- [ ] **Step 10: Commit**

```bash
git add packages/schema/src/cli/weighing-files.ts packages/cli/src/lib/weighing-io.ts packages/cli/src/io.ts packages/cli/src/commands/pack.ts packages/cli/src/commands/push.ts packages/cli/src/commands/restore.ts tests/cli/weighing.test.js package.json .gitignore
git commit -m "feat(weighing): docs/weighing sidecars folded by pack and restore, withheld by push (part 3/5)"
```

### Task 3.5: The hosted route, the ETag and the GET fold

**Files:**
- Modify: `lib/services/graph/store.ts`, `app/api/graph/projects/[projectId]/route.ts`
- Create: `app/api/graph/projects/[projectId]/weighing/events/route.ts`
- Modify: `tests/services/load-graph-api.js`, `tests/services/graph-api.test.js`

This is the only task that needs Postgres (`npm run test:graph`); start the scratch cluster from § 1.3 first.

> **Not yet run (D14).** The route's `onBehalfOf` stamp and the two `on_behalf_of` assertions below were added after the run.

- [ ] **Step 1: Write the failing integration test**

Teach the loader about the new route (a `routes` entry and a returned handler — the new route imports only specifiers `COMMON` already maps, so the alias table needs no change):

```diff
--- a/tests/services/load-graph-api.js
+++ b/tests/services/load-graph-api.js
@@ -146,6 +146,7 @@
     "quality-events-route.js": src("app", "api", "graph", "projects", "[projectId]", "quality", "events", "route.ts"),
     "live-route.js": src("app", "api", "graph", "projects", "[projectId]", "live", "route.ts"),
     "screenshots-route.js": src("app", "api", "graph", "projects", "[projectId]", "screenshots", "route.ts"),
+    "weighing-events-route.js": src("app", "api", "graph", "projects", "[projectId]", "weighing", "events", "route.ts"),
   };
   for (const [out, from] of Object.entries(routes)) {
     write(out, transpile(from, "route.ts", COMMON));
@@ -180,6 +181,7 @@
     QUALITY_EVENTS: req("quality-events-route.js").POST,
     LIVE: req("live-route.js").POST,
     SCREENSHOTS: req("screenshots-route.js").POST,
+    WEIGHING_EVENTS: req("weighing-events-route.js").POST,
   };
 }
 
```

Add the ETag checks and the route block to `tests/services/graph-api.test.js` (the first hunk sits after the "quality.assessment.scored moves the validator" checks, the second before the "POST .../live" block):

```diff
--- a/tests/services/graph-api.test.js
+++ b/tests/services/graph-api.test.js
@@ -623,6 +623,45 @@
       `${afterScored["GET nodes"]} / ${afterScored["GET edges"]}`,
     );
 
+    // A weighing event is journal-only and folded into the bundle the same way
+    // (foldWeighingEvents), so it moves the bundle GET's validator through the
+    // same `quality_event_count` column — BUNDLE_FOLD_TYPES is the one list both
+    // the fold and the count read, and this pins it growing to include them.
+    const beforeWeighingValidators = await store.loadValidators(projectId, [ownerA]);
+    const weighingEvent = {
+      id: "01etagweighing0000000000001",
+      ts: "2026-11-15T12:10:00Z",
+      actor: "graphtest",
+      type: "weighing.assessment.recorded",
+      matrix: "value",
+      subject: "V-etag",
+      criterion: "connects",
+      level: 2,
+      confidence: 1,
+      scorer: { kind: "human", id: "graphtest" },
+    };
+    const appendWeighing = await store.appendJournalEvents(projectId, [ownerA], [weighingEvent], "graphtest");
+    check("a weighing.assessment.recorded append succeeds", appendWeighing.ok === true, JSON.stringify(appendWeighing));
+    const afterWeighingValidators = await store.loadValidators(projectId, [ownerA]);
+    check(
+      "qualityEventCount rises by one for a weighing.assessment.recorded append",
+      BigInt(afterWeighingValidators.qualityEventCount) === BigInt(beforeWeighingValidators.qualityEventCount) + BigInt(1),
+      `${beforeWeighingValidators.qualityEventCount} -> ${afterWeighingValidators.qualityEventCount}`,
+    );
+    const afterWeighing = {};
+    for (const [label, route] of READS) {
+      afterWeighing[label] = etagOf(await route(new Request(ORIGIN), ctx(projectId)));
+    }
+    check(
+      "a weighing.assessment.recorded append moves the bundle GET's validator",
+      afterWeighing["GET project"] !== afterScored["GET project"],
+      `${afterScored["GET project"]} -> ${afterWeighing["GET project"]}`,
+    );
+    check(
+      "…and still not /nodes or /edges",
+      afterWeighing["GET nodes"] === afterScored["GET nodes"] && afterWeighing["GET edges"] === afterScored["GET edges"],
+    );
+
     // A snapshot write bumps the version, so every read validator moves.
     const etagMutation = await api.MUTATE(
       jsonReq(ORIGIN, "POST", { ops: [{ op: "create_node", node: node("V-etag", "view") }] }),
@@ -1434,6 +1473,126 @@
       scopeDeniedRes.status === 403 && scopeDeniedBody.required === "graph:write",
       `${scopeDeniedRes.status} ${JSON.stringify(scopeDeniedBody)}`,
     );
+    // --- POST .../weighing/events: assessments and a positioning (docs/rfcs/weighing.md) ---
+    // A fresh owner, for the reason the blocks above give.
+    const userW = await seedUser(client, "weighing");
+    const ownerW = (await owners.resolveOwnerIds(userW))[0];
+    const weighToken = await tokens.mintToken({ ownerId: ownerW, userId: userW, name: "weigh-write", scopes: ["graph:read", "graph:write"] });
+    const weighReadToken = await tokens.mintToken({ ownerId: ownerW, userId: userW, name: "weigh-read", scopes: ["graph:read"] });
+    const weighAppendToken = await tokens.mintToken({ ownerId: ownerW, userId: userW, name: "weigh-append", scopes: ["quality:append"] });
+
+    setSession(sessionFor(userW));
+    const weighSeed = bundle([
+      node("AC-w", "acceptance", { status: "live", metadata: { gherkin: "Given a link", values: ["connects"] } }),
+      node("V-w", "view", { status: "live" }),
+    ]);
+    const weighCreated = await api.CREATE_PROJECT(jsonReq(`${ORIGIN}/api/graph/projects`, "POST", weighSeed));
+    const weighCreatedBody = await weighCreated.json();
+    check("weighing fixture project imports", weighCreated.status === 201, `${weighCreated.status} ${JSON.stringify(weighCreatedBody)}`);
+    const weighProjectId = weighCreatedBody.id;
+
+    const weighPost = (events, token) =>
+      api.WEIGHING_EVENTS(
+        jsonReq(`${ORIGIN}/api/graph/projects/${weighProjectId}/weighing/events`, "POST", { events }, token ? bearer(token) : {}),
+        ctx(weighProjectId),
+      );
+    const weighAssess = (over = {}) => ({ type: "weighing.assessment.recorded", subject: "AC-w", criterion: "connects", level: 3, confidence: 2, evidence: "the title says so", ...over });
+    const readWeighing = async (token) => {
+      const res = await api.GET_PROJECT(new Request(ORIGIN, { headers: bearer(token) }), ctx(weighProjectId));
+      return (await res.json()).bundle.weighing;
+    };
+
+    // 1. The scope posture: graph:write, and no narrower credential opens it.
+    setSession(null);
+    check("weighing events without credentials is 401", (await weighPost([weighAssess()])).status === 401);
+    {
+      const res = await weighPost([weighAssess()], weighReadToken.plaintext);
+      const body = await res.json();
+      check("a graph:read token is refused 403 naming graph:write", res.status === 403 && body.required === "graph:write", `${res.status} ${JSON.stringify(body)}`);
+    }
+    {
+      const res = await weighPost([weighAssess()], weighAppendToken.plaintext);
+      check("a quality:append token is refused — an assessment outranks the ones before it", res.status === 403, String(res.status));
+    }
+
+    // 2. A token is an agent; the scorer is stamped, never read from the body.
+    {
+      const res = await weighPost([weighAssess({ model: "claude" })], weighToken.plaintext);
+      const body = await res.json();
+      check("a graph:write token records an assessment", res.status === 200 && body.events?.length === 1, `${res.status} ${JSON.stringify(body)}`);
+      check(
+        "the event carries the agent scorer, the model and the server's basis",
+        body.events?.[0].scorer.kind === "agent" && body.events[0].scorer.model === "claude" && /^fp1-/.test(body.events[0].basis?.fingerprint) && body.events[0].actor === "arkaik-agent",
+        JSON.stringify(body.events?.[0]),
+      );
+      // D14, not yet run: a token is an agent acting for its owner.
+      check(
+        "a token write is stamped on behalf of its owner: the user id as an opaque string, never an email",
+        body.events?.[0].scorer.on_behalf_of === String(userW) && !String(body.events[0].scorer.on_behalf_of).includes("@"),
+        JSON.stringify(body.events?.[0].scorer),
+      );
+    }
+    {
+      const res = await weighPost([weighAssess({ scorer: { kind: "human", id: "me" } })], weighToken.plaintext);
+      const body = await res.json();
+      check("a body that claims a scorer is a 400, not a forged human", res.status === 400 && body.error === "invalid_events" && /stamped by the server/.test(body.message), `${res.status} ${JSON.stringify(body)}`);
+    }
+
+    // 3. The GET folds it, and a session writes as a person.
+    {
+      const section = await readWeighing(weighToken.plaintext);
+      check("the project GET folds the event into a weighing section", section?.assessments?.length === 1 && section.assessments[0].level === 3, JSON.stringify(section));
+    }
+    setSession(sessionFor(userW));
+    {
+      const res = await weighPost([weighAssess({ level: -1, evidence: "costs more than it says" })]);
+      const body = await res.json();
+      check("a signed-in session records a human assessment", res.status === 200 && body.events?.[0].scorer.kind === "human" && body.events[0].actor === "arkaik-app" && !("on_behalf_of" in body.events[0].scorer), `${res.status} ${JSON.stringify(body)}`);
+    }
+    setSession(null);
+    {
+      const section = await readWeighing(weighToken.plaintext);
+      const kinds = (section?.assessments ?? []).map((a) => `${a.scorer?.kind}:${a.level}`).sort();
+      check("the human's level and the agent's sit side by side", kinds.join() === "agent:3,human:-1", kinds.join());
+    }
+    {
+      const stored = await store.getProject(weighProjectId, [ownerW]);
+      check("the stored snapshot never grew a weighing section", stored.bundle.weighing === undefined);
+    }
+
+    // 4. The gate: all or nothing, each refusal naming its entry.
+    {
+      const before = await store.loadValidators(weighProjectId, [ownerW]);
+      const res = await weighPost([weighAssess({ level: 2 }), weighAssess({ criterion: "teleports" }), weighAssess({ subject: "V-w" })], weighToken.plaintext);
+      const body = await res.json();
+      check(
+        "a batch with bad entries is a 422 refusing every entry, naming indexes",
+        res.status === 422 && body.error === "refused" && body.refusals?.map((r) => r.index).join() === "1,2" && /unknown_criterion/.test(body.message),
+        `${res.status} ${JSON.stringify(body)}`,
+      );
+      const after = await store.loadValidators(weighProjectId, [ownerW]);
+      check("…and nothing was written", after.qualityEventCount === before.qualityEventCount, `${before.qualityEventCount} -> ${after.qualityEventCount}`);
+    }
+    {
+      const res = await weighPost([{ type: "quality.finding.resolved", finding_id: "F-1" }], weighToken.plaintext);
+      check("only weighing types are accepted here", res.status === 400, String(res.status));
+    }
+
+    // 5. A positioning is a saved set, latest-wins.
+    {
+      const set = { id: "positioning", version: "1.0.0", subject: "acceptance", scale: { min: -3, max: 3, anchors: {} }, role: "positioning", status: "draft", extends: "value-contribution@1", criteria: [{ id: "connects", weight: 3 }] };
+      const first = await weighPost([{ type: "weighing.set.saved", set }], weighToken.plaintext);
+      check("a positioning draft is recorded", first.status === 200, String(first.status));
+      await weighPost([{ type: "weighing.set.saved", set: { ...set, status: "active" } }], weighToken.plaintext);
+      const section = await readWeighing(weighToken.plaintext);
+      check("saving it again replaces it — one set, now active", section.sets.length === 1 && section.sets[0].status === "active", JSON.stringify(section.sets));
+      const bad = await weighPost([{ type: "weighing.set.saved", set: { ...set, criteria: [{ id: "teleports" }] } }], weighToken.plaintext);
+      check("a positioning naming a non-element is refused", bad.status === 422, String(bad.status));
+    }
+
+    // 6. Owner isolation, like every other route here.
+    {
+      const stranger = await seedUser(client, "weighing-stranger");
+      const strangerOwner = (await owners.resolveOwnerIds(stranger))[0];
+      const strangerToken = await tokens.mintToken({ ownerId: strangerOwner, userId: stranger, name: "stranger", scopes: ["graph:read", "graph:write"] });
+      const res = await weighPost([weighAssess()], strangerToken.plaintext);
+      check("another owner's token cannot weigh this project (404, not 403)", res.status === 404, String(res.status));
+    }
+
     // --- POST .../live: the deployment door (issue #424) --------------------
     // A fresh owner, as for quality/events above: userA sits at its project cap.
     const userL = await seedUser(client, "live");
```

- [ ] **Step 2: Run it to verify it fails**

Run: `DATABASE_URL=postgres://arkaik@127.0.0.1:5544/arkaik_test npm run test:graph`
Expected: FAIL at load — `Cannot find module …/weighing/events/route.ts` (the route does not exist yet).

- [ ] **Step 3: The store — one fold list, two readers**

```diff
--- a/lib/services/graph/store.ts
+++ b/lib/services/graph/store.ts
@@ -8,6 +8,7 @@
   MutationError,
   RELEASE_COUNT_EVENT_FIELDS,
   STATUS_VOCABULARY_VERSION,
+  WEIGHING_FOLD_TYPES,
   applyOps,
   computeReleaseEventCounts,
   formatJournalCursor,
@@ -247,7 +248,11 @@
   version: string;
   /** Every `graph_events` row of the project — `/journal` and `/export` depend on all of them. */
   eventCount: string;
-  /** Only the event types `foldQualityEvents` reads into the bundle — see `QUALITY_FOLD_TYPES`. */
+  /**
+   * Only the event types the project GET folds into the bundle — see
+   * `BUNDLE_FOLD_TYPES`. Named for the first of them; a weighing event moves it
+   * too, because the bundle it validates carries the folded weighing section.
+   */
   qualityEventCount: string;
 }
 
@@ -267,6 +272,16 @@
  * so a new fold type cannot silently ship without the ETag learning about it.
  */
 export const QUALITY_FOLD_TYPES = ["quality.finding.resolved", "quality.finding.accepted", "quality.assessment.scored"] as const;
+
+/**
+ * Everything the project GET folds over the stored snapshot on the way out: the
+ * Kritik decisions above, plus the weighing events (`WEIGHING_FOLD_TYPES` in
+ * `@arkaik/schema`, folded by `foldWeighingEvents`). The ETag's count is built
+ * from THIS list, so a new fold type cannot ship without the validator learning
+ * about it — and `QUALITY_FOLD_TYPES` stays what `planQualityEvents` loads, so a
+ * weighing event is never read into a Kritik plan.
+ */
+export const BUNDLE_FOLD_TYPES = [...QUALITY_FOLD_TYPES, ...WEIGHING_FOLD_TYPES] as const;
 
 /**
  * The validator columns, selected off `graph_projects p` in the SAME
@@ -276,7 +291,7 @@
  * `seq` order and a max taken between them would never learn about the
  * earlier row; a count moves on every commit whatever the order.
  *
- * The `in (...)` list is string-built from `QUALITY_FOLD_TYPES` rather than
+ * The `in (...)` list is string-built from `BUNDLE_FOLD_TYPES` rather than
  * `$`-parameterized: those are source-code constants, never request input, so
  * there is nothing here for the "values go through `$`-params" rule (see
  * `replaceProjectBundle`'s own doc comment) to be protecting against.
@@ -286,7 +301,7 @@
             (select count(*) from graph_events e where e.project_id = p.id)::text as event_count,
             (select count(*) from graph_events e
               where e.project_id = p.id
-                and e.event->>'type' in (${QUALITY_FOLD_TYPES.map((t) => `'${t}'`).join(", ")}))::text as quality_event_count`;
+                and e.event->>'type' in (${BUNDLE_FOLD_TYPES.map((t) => `'${t}'`).join(", ")}))::text as quality_event_count`;
 
 /**
  * The owner scope every read shares — and deliberately NO `archived_at`
@@ -641,6 +656,15 @@
  */
 export const qualityFoldEvents = (projectId: string, ownerIds: readonly string[]): Promise<JournalEvent[]> =>
   qualityEventsOfTypes(projectId, ownerIds, QUALITY_FOLD_TYPES);
+
+/**
+ * The `WEIGHING_FOLD_TYPES` events, and nothing else — what the project GET
+ * folds over the stored `weighing` section (`foldWeighingEvents` in
+ * `@arkaik/schema`), and what `POST …/weighing/events` plans against. Same
+ * one-row owner check as `qualityEventsOfTypes`, which it is.
+ */
+export const weighingFoldEvents = (projectId: string, ownerIds: readonly string[]): Promise<JournalEvent[]> =>
+  qualityEventsOfTypes(projectId, ownerIds, WEIGHING_FOLD_TYPES);
 
 /**
  * Append pre-stamped journal events WITHOUT touching the snapshot — the
```

- [ ] **Step 4: The project GET folds weighing events**

```diff
--- a/app/api/graph/projects/[projectId]/route.ts
+++ b/app/api/graph/projects/[projectId]/route.ts
@@ -7,9 +7,10 @@
   loadValidators,
   qualityFoldEvents,
   updateProjectFields,
+  weighingFoldEvents,
 } from "@/lib/services/graph/store";
 import { foldQualityEvents } from "@/lib/utils/quality";
-import type { Project, QualitySection } from "@arkaik/schema";
+import { foldWeighingEvents, type Project, type QualitySection, type WeighingSection } from "@arkaik/schema";
 
 /**
  * A single hosted project (db/migrations/008_graph_projects.sql).
@@ -21,7 +22,8 @@
 export const dynamic = "force-dynamic";
 
 /**
- * GET — snapshot + version, with the quality decisions folded in.
+ * GET — snapshot + version, with the quality decisions and the weighing events
+ * folded in.
  *
  * The JSON `version` is what a client passes back as `If-Match` on a mutation
  * to say "only if nothing moved since I read this". The `ETag` header is NOT
@@ -79,7 +81,16 @@
       storedQuality,
       await qualityFoldEvents(projectId, caller.ownerIds),
     );
-    const bundle = quality === storedQuality ? found.bundle : { ...found.bundle, quality };
+    // The weighing section, the same way: its assessments and its positioning
+    // are journal events on a hosted project, and the read is what folds them
+    // over whatever section a restore stored. `foldWeighingEvents` hands back
+    // the SAME reference when there is nothing to fold, so an untouched project
+    // is not copied; unlike the quality fold it also starts a section from
+    // nothing, because weighing needs no audit restored first.
+    const storedWeighing = (found.bundle as { weighing?: WeighingSection }).weighing;
+    const weighing = foldWeighingEvents(storedWeighing, await weighingFoldEvents(projectId, caller.ownerIds));
+    const withQuality = quality === storedQuality ? found.bundle : { ...found.bundle, quality };
+    const bundle = weighing === storedWeighing ? withQuality : { ...withQuality, weighing };
     return Response.json(
       { bundle, version: found.version },
       { status: 200, headers: readResponseHeaders(bundleEtag(found.validators)) },
```

- [ ] **Step 5: The route**

```ts
import { getCaller, hasScope } from "@/lib/services/auth";
import { MAX_BUNDLE_BYTES, servicesConfigured, servicesUnavailable } from "@/lib/services/db";
import { appendJournalEvents, getProject, weighingFoldEvents } from "@/lib/services/graph/store";
import {
  foldWeighingEvents,
  parseWeighingEventInputs,
  planWeighingEvents,
  type Node,
  type WeighingSection,
} from "@arkaik/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST` — the hosted, events-only write path for weighing: one assessment, or a
 * positioning, recorded on a project that has no checkout to hold
 * `docs/weighing/` (docs/rfcs/weighing.md). The twin of
 * `quality/events/route.ts`, and built the same way.
 *
 * A batch of typed entries, each `weighing.assessment.recorded` or
 * `weighing.set.saved`, and nothing else — this is not a general
 * event-append surface. Every entry goes through `planWeighingEvents`, the one
 * validator-gated gate the browser provider and the MCP tools also use, so an
 * assessment written here has been checked against the same library, the same
 * scale and the same subject rule as every other. The batch is all-or-nothing:
 * one refusal anywhere refuses every entry, each naming its `index`.
 *
 * **Provenance is stamped here, never read from the body.** A session (the
 * browser) is a `human`; a token (the MCP server, a script) is an `agent` —
 * `getCaller` is the only thing on this route that knows which, so `scorer`,
 * `basis` and `ts` are refused if a caller supplies them. A human's level beats
 * an agent's in every roll-up, which is exactly why a token cannot claim to be
 * one.
 *
 * **On whose behalf (D14, not yet run).** A token is an agent acting for the
 * person who minted it, and the record says so: `scorer.on_behalf_of` is the
 * token owner's user id, an opaque string and never an email (sidecars are
 * committed to repos, and a bundle can be published). A session is the person
 * themselves, so it stamps nothing.
 *
 * `snapshot.weighing` is NEVER rewritten: the journal grows and the project GET
 * folds it (`foldWeighingEvents`), the doctrine `quality/events` already
 * follows. The scope is `graph:write` — there is no narrower credential for
 * this, because nothing here is an append-only observation: an assessment
 * outranks the ones before it.
 *
 * Deliberately unlocked, like its sibling: the journal is append-only and the
 * fold is latest-wins per cell and scorer kind, so two concurrent writers
 * produce the same outcome a lock would have — the later event wins.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> },
): Promise<Response> {
  if (!servicesConfigured()) return servicesUnavailable("Graph");

  const caller = await getCaller(req);
  if (!caller) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!hasScope(caller, "graph:write")) {
    return Response.json({ error: "insufficient_scope", required: "graph:write" }, { status: 403 });
  }

  const { projectId } = await params;

  const raw = await req.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_BUNDLE_BYTES) {
    return Response.json({ error: "payload_too_large", limit: MAX_BUNDLE_BYTES }, { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const inputs = parseWeighingEventInputs(body);
  if (!Array.isArray(inputs)) {
    return Response.json({ error: "invalid_events", message: inputs.error }, { status: 400 });
  }

  try {
    const found = await getProject(projectId, caller.ownerIds);
    if (!found) return Response.json({ error: "not_found" }, { status: 404 });

    // What acted, not just who: an agent's writes stay distinguishable from the
    // same person's edits in the browser, and the scorer kind follows from it.
    const agent = caller.via === "token";
    const actor = agent ? "arkaik-agent" : "arkaik-app";

    const snapshot = found.bundle as { weighing?: WeighingSection; nodes: Node[] };
    // The section the next GET would show, so a check reads what a reader sees.
    const section = foldWeighingEvents(snapshot.weighing, await weighingFoldEvents(projectId, caller.ownerIds));

    const plan = planWeighingEvents(section, snapshot.nodes, inputs, {
      actor,
      scorerKind: agent ? "agent" : "human",
      // D14, not yet run: whose hands the token is. `caller.userId` is the token's owner.
      ...(agent ? { onBehalfOf: String(caller.userId) } : {}),
    });
    if (!plan.ok) {
      const message = plan.refusals.map((r) => `entry ${r.index}: ${r.reason} — ${r.detail}`).join("; ");
      return Response.json({ error: "refused", message, refusals: plan.refusals }, { status: 422 });
    }

    const result = await appendJournalEvents(projectId, caller.ownerIds, plan.events, actor);
    if (!result.ok) {
      return Response.json({ error: "refused", reason: result.reason }, { status: 422 });
    }

    return Response.json({ events: plan.events }, { status: 200 });
  } catch (err) {
    console.error("[graph] POST weighing events failed:", err instanceof Error ? err.message : "unknown error");
    return Response.json({ error: "internal_error", message: "Failed to append weighing events." }, { status: 500 });
  }
}
```

- [ ] **Step 6: Run the integration suite**

Run: `DATABASE_URL=postgres://arkaik@127.0.0.1:5544/arkaik_test npm run test:graph`
Expected: every `PASS:`, including `qualityEventCount rises by one for a weighing.assessment.recorded append`, `a graph:read token is refused 403 naming graph:write`, `a body that claims a scorer is a 400, not a forged human`, `the human's level and the agent's sit side by side`, `the stored snapshot never grew a weighing section`, `a batch with bad entries is a 422 refusing every entry, naming indexes`, `another owner's token cannot weigh this project (404, not 403)`, ending `All graph-API checks passed.`

- [ ] **Step 7: Commit**

```bash
git add lib/services/graph/store.ts "app/api/graph/projects/[projectId]/route.ts" "app/api/graph/projects/[projectId]/weighing/events/route.ts" tests/services/load-graph-api.js tests/services/graph-api.test.js
git commit -m "feat(weighing): POST weighing/events, folded by the project GET and counted by the ETag (part 3/5)"
```

### Task 3.6: The browser and remote providers

**Files:**
- Modify: `lib/data/data-provider.ts`, `lib/data/local-provider.ts`, `lib/data/remote-provider.ts`, `lib/data/routing-provider.ts`
- Create: `tests/data/weighing-provider.test.js`

- [ ] **Step 1: Write the failing test**

```js
#!/usr/bin/env node

/**
 * The browser provider's weighing writes (lib/data/local-provider.ts
 * `appendWeighingEvents`, docs/rfcs/weighing.md): an assessment, or a
 * positioning, lands in the project's journal row as an event, `getProject`
 * folds it over the stored section, and the snapshot itself is never touched.
 *
 * Runs the real provider over load-local-provider.js's in-memory fake `./db`
 * (deliberately IndexedDB-free), exactly like mutation-notifications.test.js.
 */

const fs = require("fs");
const { loadLocalProvider, BUILD_DIR } = require("./load-local-provider");

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`PASS: ${name}`);
  else {
    failures++;
    console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const ISO = "2026-01-01T00:00:00.000Z";
const PROJECT = "p-weigh";

const bundle = (extra = {}) => ({
  schema_version: 3,
  project: { id: PROJECT, title: "Weigh", created_at: ISO, updated_at: ISO, archived_at: null },
  nodes: [
    { id: "AC-a", project_id: PROJECT, species: "acceptance", title: "Accept an invite", status: "live", platforms: ["web"], metadata: { gherkin: "Given a link", values: ["connects"] } },
    { id: "V-home", project_id: PROJECT, species: "view", title: "Home", status: "live", platforms: ["web"] },
  ],
  edges: [],
  ...extra,
});

const assess = (over = {}) => ({ type: "weighing.assessment.recorded", subject: "AC-a", criterion: "connects", level: 2, confidence: 2, evidence: "the title says so", ...over });

async function main() {
  const { localProvider, subscribeToMutations, __makeFakeDb, __setFakeDb } = loadLocalProvider();
  const db = __makeFakeDb();
  __setFakeDb(db);
  await localProvider.saveProject(bundle());

  const received = [];
  const unsubscribe = subscribeToMutations((e) => received.push(e));

  // --- a write lands as an event and folds on read ---------------------------
  const before = await localProvider.getProject(PROJECT);
  check("a project with no weighing data reads with no weighing section", before.weighing === undefined);

  const events = await localProvider.appendWeighingEvents(PROJECT, [assess()]);
  check("appending returns the stamped events", events.length === 1 && events[0].type === "weighing.assessment.recorded" && events[0].actor === "arkaik-app");
  check("exactly one mutation notification fires, for this project", received.length === 1 && received[0].projectId === PROJECT, JSON.stringify(received));

  const after = await localProvider.getProject(PROJECT);
  check("getProject folds the event into a weighing section", after.weighing?.assessments?.length === 1);
  const row = after.weighing?.assessments?.[0];
  check("the browser is a person: the scorer is stamped human", row.scorer.kind === "human");
  check("the basis is read off the stored node: fingerprint and set version", /^fp1-/.test(row.basis.fingerprint) && row.basis.set_version === "1.0.0");
  check("the level, confidence and evidence are the caller's", row.level === 2 && row.confidence === 2 && row.evidence === "the title says so");

  const stored = await db.projects.get(PROJECT);
  check("the stored snapshot is never touched — events only", stored.snapshot.weighing === undefined);
  const journal = await db.journals.get(PROJECT);
  check("the journal row holds the event", journal.events.some((e) => e.type === "weighing.assessment.recorded"));

  // --- latest wins, per scorer kind -----------------------------------------
  await localProvider.appendWeighingEvents(PROJECT, [assess({ level: -1, evidence: "second thoughts" })]);
  const rescored = (await localProvider.getProject(PROJECT)).weighing?.assessments ?? [];
  check("a later write replaces the cell", rescored.length === 1 && rescored[0].level === -1);

  // --- a positioning ---------------------------------------------------------
  const positioning = { id: "positioning", version: "1.0.0", subject: "acceptance", scale: { min: -3, max: 3, anchors: {} }, role: "positioning", status: "draft", extends: "value-contribution@1", criteria: [{ id: "connects", weight: 3 }] };
  await localProvider.appendWeighingEvents(PROJECT, [{ type: "weighing.set.saved", set: positioning }]);
  const withSet = (await localProvider.getProject(PROJECT)).weighing;
  check("a saved positioning folds into sets", withSet?.sets?.length === 1 && withSet.sets[0].status === "draft");
  await localProvider.appendWeighingEvents(PROJECT, [{ type: "weighing.set.saved", set: { ...positioning, status: "active" } }]);
  check("saving it again replaces it — latest wins", (await localProvider.getProject(PROJECT)).weighing?.sets?.[0]?.status === "active");

  // --- the gate refuses, all or nothing -------------------------------------
  received.length = 0;
  const eventCount = (await db.journals.get(PROJECT)).events.length;
  let refusal = null;
  try {
    await localProvider.appendWeighingEvents(PROJECT, [assess(), assess({ criterion: "teleports" })]);
  } catch (error) {
    refusal = error;
  }
  check("a bad entry refuses the whole batch", refusal !== null && /unknown_criterion/.test(refusal.message), refusal?.message);
  check("…and writes nothing", (await db.journals.get(PROJECT)).events.length === eventCount);
  check("…and notifies nobody", received.length === 0);
  let viewRefusal = null;
  try {
    await localProvider.appendWeighingEvents(PROJECT, [assess({ subject: "V-home" })]);
  } catch (error) {
    viewRefusal = error;
  }
  check("a view is not a subject of the value matrix", viewRefusal !== null && /unknown_subject/.test(viewRefusal.message), viewRefusal?.message);
  let missing = null;
  try {
    await localProvider.appendWeighingEvents("p-nope", [assess()]);
  } catch (error) {
    missing = error;
  }
  check("an unknown project is an error", missing !== null && /not found/.test(missing.message));

  // --- it travels: export carries the events, import folds them back -----------
  const exported = await localProvider.exportProject(PROJECT);
  check("the exported bundle carries the events in its journal", exported.journal.filter((e) => e.type.startsWith("weighing.")).length === 4);
  check("…and no folded section — the section is a read, not a copy", exported.weighing === undefined);
  const db2 = __makeFakeDb();
  __setFakeDb(db2);
  await localProvider.importProject(exported);
  const reimported = await localProvider.getProject(PROJECT);
  check("importing it somewhere else folds the same assessment back", reimported.weighing?.assessments?.[0]?.level === -1 && reimported.weighing?.sets?.[0]?.status === "active");

  // --- an imported section and the events fold together -----------------------------
  const db3 = __makeFakeDb();
  __setFakeDb(db3);
  await localProvider.importProject(bundle({ weighing: { sets: [], matrices: [], assessments: [{ matrix: "value", subject: "AC-a", criterion: "connects", level: 3, scorer: { kind: "agent", id: "arkaik-mcp" }, confidence: 1, ts: "2026-11-14T10:00:00.000Z" }] } }));
  await localProvider.appendWeighingEvents(PROJECT, [assess({ level: 1 })]);
  const merged = (await localProvider.getProject(PROJECT)).weighing?.assessments ?? [];
  check("a packed section's agent row and a browser human row sit side by side", merged.length === 2 && merged.some((a) => a.scorer?.kind === "agent" && a.level === 3) && merged.some((a) => a.scorer?.kind === "human" && a.level === 1));

  unsubscribe();
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  if (failures > 0) {
    console.log(`\n${failures} weighing-provider test(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll weighing-provider tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tests/data/weighing-provider.test.js`
Expected: FAIL — `TypeError: localProvider.appendWeighingEvents is not a function`.

- [ ] **Step 3: The interface, the local provider and the fold on read**

```diff
--- a/lib/data/data-provider.ts
+++ b/lib/data/data-provider.ts
@@ -1,4 +1,4 @@
-import type { JournalFamilyId, JournalPage, MutationOp, ReleaseEventCount } from "@arkaik/schema";
+import type { JournalFamilyId, JournalPage, MutationOp, ReleaseEventCount, WeighingEventInput } from "@arkaik/schema";
 
 import type { Node, Edge, Project, ProjectBundle, JournalEvent } from "./types";
 
@@ -184,6 +184,21 @@
    * would land a hosted bundle in IndexedDB.
    */
   replaceProject?(projectId: string, bundle: ProjectBundle, options: ReplaceProjectOptions): Promise<{ version: string }>;
+
+  /**
+   * Record assessments, or a positioning, as journal events (docs/rfcs/weighing.md)
+   * — OPTIONAL, because the public seed sandbox has no journal to keep them in.
+   * The local provider appends to its journal row; the remote one posts to
+   * `POST …/weighing/events`. Both run the schema's `planWeighingEvents` gate,
+   * stamp the scorer from who is writing (a browser session is a person), and
+   * leave the snapshot alone: `getProject` folds the events over the stored
+   * section. Resolves to the events that were appended, and rejects with the
+   * refusal's reasons when the gate says no — all or nothing.
+   *
+   * The router refuses for a backend without it; it never falls back to a graph
+   * mutation, because an assessment is not one.
+   */
+  appendWeighingEvents?(projectId: string, inputs: readonly WeighingEventInput[]): Promise<JournalEvent[]>;
 }
 
 export interface ReadJournalPageOptions extends ReadProjectOptions {
```

```diff
--- a/lib/data/local-provider.ts
+++ b/lib/data/local-provider.ts
@@ -2,8 +2,15 @@
 import { journalPageOf, journalStatsOf, projectJournal } from "./journal-projection";
 import type { Node, Edge, JournalEvent, ProjectBundle } from "./types";
 import { migrateBundle } from "./migrate";
-import { applyOps, type JournalPage, type MutationOp } from "@arkaik/schema";
 import {
+  applyOps,
+  foldWeighingEvents,
+  planWeighingEvents,
+  type JournalPage,
+  type MutationOp,
+  type WeighingEventInput,
+} from "@arkaik/schema";
+import {
   appendJournalEvents,
   assembleBundle,
   getDb,
@@ -168,7 +175,12 @@
     // carry resolutions — and the two providers must not disagree about what a
     // bundle says.
     const quality = foldQualityEvents(bundle.quality, journalRow?.events ?? []);
-    return quality === bundle.quality ? bundle : { ...bundle, quality };
+    const withQuality = quality === bundle.quality ? bundle : { ...bundle, quality };
+    // The weighing section the same way: a local project's assessments and its
+    // positioning are journal events (there is no checkout for a sidecar), and
+    // the read folds them over whatever section an import carried.
+    const weighing = foldWeighingEvents(withQuality.weighing, journalRow?.events ?? []);
+    return weighing === withQuality.weighing ? withQuality : { ...withQuality, weighing };
   },
 
   /**
@@ -318,6 +330,38 @@
     // No `version`: Dexie serializes the transactions, so results resolve in
     // commit order and the cache has nothing to guard against.
     return { nodes, edges, events };
+  },
+
+  /**
+   * Record assessments, or a positioning, as journal events — the local twin of
+   * `POST …/weighing/events`. The same `planWeighingEvents` gate the hosted route
+   * and the MCP tools use, so a score written here has been checked against the
+   * same library, scale and subject rule. A browser session is a person: the
+   * scorer is stamped `human`, which is why a level written here beats an
+   * agent's.
+   *
+   * Journal only — the snapshot is not touched, exactly as on a hosted project:
+   * `getProject` folds the events over the stored section. Notifies once, after
+   * the transaction commits, so the query cache and Synk both hear of it.
+   */
+  async appendWeighingEvents(projectId: string, inputs: readonly WeighingEventInput[]) {
+    const db = await getDb();
+    if (!db) throw new Error(`Project ${projectId} not found`);
+    let appended: JournalEvent[] = [];
+    await db.transaction("rw", db.projects, db.journals, async () => {
+      const record = await db.projects.get(projectId);
+      if (!record) throw new Error(`Project ${projectId} not found`);
+      const journalRow = await db.journals.get(projectId);
+      const section = foldWeighingEvents(record.snapshot.weighing, journalRow?.events ?? []);
+      const plan = planWeighingEvents(section, record.snapshot.nodes, inputs, { actor: "arkaik-app", scorerKind: "human" });
+      if (!plan.ok) {
+        throw new Error(`Assessment refused — ${plan.refusals.map((r) => `${r.reason}: ${r.detail}`).join("; ")}`);
+      }
+      appended = plan.events;
+      await appendJournalEvents(db, projectId, appended);
+    });
+    notifyMutation(projectId);
+    return appended;
   },
 
   async exportProject(id: string) {
```

- [ ] **Step 4: The remote provider and the router**

```diff
--- a/lib/data/remote-provider.ts
+++ b/lib/data/remote-provider.ts
@@ -1,4 +1,4 @@
-import type { JournalPage, MutationOp } from "@arkaik/schema";
+import type { JournalPage, MutationOp, WeighingEventInput } from "@arkaik/schema";
 
 import type {
   DataProvider,
@@ -318,6 +318,22 @@
         body: JSON.stringify(bundle),
       });
       return { version: result.version };
+    },
+
+    /**
+     * Assessments and a positioning, recorded as journal events on the server
+     * (`POST …/weighing/events`, docs/rfcs/weighing.md). The route stamps the
+     * scorer from the session — a person — so nothing about provenance is sent
+     * from here, and a refusal (422) surfaces with the server's reasons in its
+     * message. The snapshot is not touched; the next project read folds the
+     * events in, which is why the caller invalidates the project afterwards.
+     */
+    async appendWeighingEvents(projectId: string, inputs: readonly WeighingEventInput[]) {
+      const result = await request<{ events: JournalEvent[] }>(
+        `/projects/${encodeURIComponent(projectId)}/weighing/events`,
+        { method: "POST", body: JSON.stringify({ events: inputs }) },
+      );
+      return result.events;
     },
 
     async readProject(id: string, options: ReadProjectOptions): Promise<ReadResult<ProjectBundle>> {
```

```diff
--- a/lib/data/routing-provider.ts
+++ b/lib/data/routing-provider.ts
@@ -1,4 +1,4 @@
-import type { MutationOp } from "@arkaik/schema";
+import type { MutationOp, WeighingEventInput } from "@arkaik/schema";
 
 import type {
   DataProvider,
@@ -156,6 +156,20 @@
       }
       return target.replaceProject(projectId, bundle, options);
     },
+
+    /**
+     * NO fallback, for the reason `replaceProject` has none: an assessment is
+     * not a graph mutation, so there is nothing honest to stand in for it. The
+     * public seed sandbox has no journal to keep one in, and a caller that
+     * reaches it hears so.
+     */
+    appendWeighingEvents(projectId: string, inputs: readonly WeighingEventInput[]) {
+      const target = forProject(projectId);
+      if (!target.appendWeighingEvents) {
+        return Promise.reject(new Error(`Project ${projectId} cannot record assessments.`));
+      }
+      return target.appendWeighingEvents(projectId, inputs);
+    },
   } satisfies DataProvider as DataProvider;
 }
 
```

- [ ] **Step 5: Run the provider suites and the type check**

Run: `node tests/data/weighing-provider.test.js && npm run test:provider && npm run test:migrate && npm run test:quality-fold && npm run test:project-queries && npx tsc --noEmit -p .`
Expected: `All weighing-provider tests passed.` (21 `PASS:` lines) and the existing suites green. (`local-provider.ts` imports only `@arkaik/schema` additions, so `load-local-provider.js`'s alias table is untouched.)

- [ ] **Step 6: Commit**

```bash
git add lib/data/data-provider.ts lib/data/local-provider.ts lib/data/remote-provider.ts lib/data/routing-provider.ts tests/data/weighing-provider.test.js
git commit -m "feat(weighing): appendWeighingEvents on the browser, hosted and routing providers (part 3/5)"
```

### Task 3.7: Scripts, CI steps, CLI version, docs

**Files:**
- Modify: `package.json`, `package-lock.json`, `packages/cli/package.json`, `.github/workflows/ci.yml`
- Modify: `docs/spec/journal.md`, `docs/spec/services.md`, `docs/spec/toolchain.md`, `docs/hosted-projects.md`

- [ ] **Step 1: Scripts** — after `"test:weighing-derive"` in `package.json` add:

```json
    "test:weighing-events": "node tests/schema/weighing-events.test.js",
    "test:weighing-provider": "node tests/data/weighing-provider.test.js",
```

- [ ] **Step 2: CI steps** — in `ci.yml`, after the "Weighing derivation tests" step:

```yaml
      # The weighing write path: the two events, the planner every writer goes
      # through (the hosted route, the browser provider, the MCP tools) and the
      # fold that reads them back. Pure — the route's SQL is in `services`.
      - name: Weighing events tests (parser, planner gate, all-or-nothing, fold)
        run: npm run test:weighing-events
```

and after the "Quality fold wired to the local provider's getProject" step:

```yaml
      # The browser provider's weighing writes: events into the journal row,
      # folded on read, the snapshot never touched, the gate refusing whole.
      - name: Weighing browser-provider tests (append, fold, refusal, export/import)
        run: npm run test:weighing-provider
```

(The CLI suite rides the existing "CLI tests" step through `test:cli`; the route suite rides "Hosted graph API integration tests" through `test:graph`.)

- [ ] **Step 3: Bump the CLI** (the CLI's behaviour changed; the owner publishes by hand)

In `packages/cli/package.json` set `"version": "0.12.0"`. In `package-lock.json` change the `"packages/cli"` entry's `"version": "0.11.1"` to `"0.12.0"`. Run `npm run test:cli` once more (`tests/cli/version.test.js` reads the built binary).

- [ ] **Step 3b: `docs/spec/journal.md`** — after the `quality.signal.tripped` row of the vocabulary table add:

````markdown
| `weighing.assessment.recorded` | `matrix`, `subject`, `criterion`, `level`, `scorer`, `confidence`, `evidence?`, `refs?`, `basis?`, `run?` | One assessment (an `WeighingAssessment` minus its `ts`, which is the envelope's) written away from a checkout — a hosted session or a browser project (docs/rfcs/weighing.md). The read folds these latest-wins per `(matrix, subject, criterion, scorer.kind)` over the bundle's `weighing` section, the way a repo checkout folds a sidecar re-score in place. The writer stamps `scorer` (a session is `human`, a token `agent` and also carries `scorer.on_behalf_of`, the token owner's opaque user id, never an email) and `basis` (the set's version and the subject's fingerprint); a caller cannot supply them. In a repository no event is written — `docs/weighing/` is the record |
| `weighing.set.saved` | `set` | A criteria set saved whole — latest wins by `set.id`. Slice 1 admits exactly one: the `positioning` (`role: "positioning"`, `extends: "value-contribution@1"`, `status: "draft" \| "active"`) |
````

and after the paragraph that begins "The six `quality.*` types" add:

````markdown
The two `weighing.*` types follow the same rule — facts, not state: the weighing section a reader sees is a projection, the stored section with these events folded over it. Like `quality.assessment.scored` they are in the strict schema map (`JOURNAL_EVENT_SCHEMAS`) but not in the 22-type `JOURNAL_EVENT_TYPES` list, and `validateBundle` warns when one has no `actor`.
````

- [ ] **Step 3c: `docs/spec/services.md`** — after the `POST /api/graph/projects/{id}/quality/events` row of the route table add:

````markdown
| `POST /api/graph/projects/{id}/weighing/events` | `graph:write` (no narrower scope: an assessment outranks the ones before it) | Journal-only weighing events, two whitelisted types: `weighing.assessment.recorded` and `weighing.set.saved` (docs/rfcs/weighing.md) — no snapshot change, no version bump. Every entry goes through `planWeighingEvents`, the gate the browser provider and the MCP tools share; all-or-nothing, refusals name each entry's `index`, `reason` and `detail`. The scorer is **stamped from the caller** — a session is `human`, a token `agent` acting on behalf of its owner (`scorer.on_behalf_of`, an opaque user id) — and a body carrying `scorer`, `basis` or `ts` is a 400. The project `GET` folds these events over `snapshot.weighing`, and the bundle ETag's count covers them (`BUNDLE_FOLD_TYPES`) |
````

- [ ] **Step 3d: `docs/spec/toolchain.md`** — replace the two table rows and add two detail rows:

Replace the `arkaik pack [--no-journal] [--no-quality] [--inline-assets]` row's command cell and description with:

```
| `arkaik pack [--no-journal] [--no-quality] [--no-weighing] [--inline-assets]` | Produce a single-file interchange bundle: embed the journal, fold `docs/quality/` into the `quality` section and `docs/weighing/` into the `weighing` section, inline or upload assets | 3 |
```

Replace the `arkaik push [--include-journal] [--include-quality]` row with:

```
| `arkaik push [--include-journal] [--include-quality] [--include-weighing]` | Publish to Publik / a synced account project from the terminal or CI; the journal, the `quality` section and the `weighing` section are each stripped before packing unless opted in | 4 |
```

and in the per-verb table (the one beginning `| Verb | Default | Flags |`) add after the `arkaik push` row:

````markdown
| `arkaik pack` (weighing) | folds | `--no-weighing` **deletes** the `weighing` section rather than declining to add one, for the reason `--no-quality` does. `docs/weighing/` is folded from the same repo root as `docs/quality/` (derived from the bundle's own path); no files means no section, never a failure ([bundle-format.md](bundle-format.md) § Weighing) |
| `arkaik push` (weighing) | strips | `--include-weighing` embeds the section and forwards `?include_weighing=true`. A third, independent opt-in: what a product scores its own promises, costs included, is neither its history nor its open findings |
| `arkaik restore` (weighing) | folds | `--no-weighing` drops the section. There is no separate loss guard: an assessment written hosted lives in the journal, and a restore that would shrink the journal is refused by `--allow-history-loss` already |
````

- [ ] **Step 3e: `docs/hosted-projects.md`** — immediately before `## 4. Set up the GitHub App (once per deployment)` add:

````markdown
### Weighing on a hosted project

A hosted project has no `docs/weighing/` directory. Its weighing state is the `weighing` section a restore stored, plus the journal events that arrived since; the server folds the events in on every read. Every hosted write goes to one route, `POST /api/graph/projects/{id}/weighing/events`, scope `graph:write`, and takes exactly two event types: `weighing.assessment.recorded` (one signed level, from −3 to +3, for one acceptance on one element of value, with a confidence and evidence) and `weighing.set.saved` (the positioning). A batch is all-or-nothing and each refusal names the entry's `index`, a `reason` and a `detail`.

**The scorer is stamped by the server, never read from the body.** A signed-in session writes as a person; a token writes as an agent and also records `scorer.on_behalf_of`, the token owner's user id (an opaque number, never an email), so the record says whose hands the agent was. A person's level beats an agent's for the same cell, and the agent's is kept beside it, which is why a token cannot claim to be one. The server also stamps a fingerprint of the acceptance (title, Gherkin, values) so a later edit marks the score stale, and the full version of the value set it was read against.

Over MCP, `get_matrix` reads the section, `assess` records a judgement and `save_positioning` drafts or saves the positioning — see [mcp.md](spec/mcp.md) § Weighing. Nothing lands in the repository: the journal events are the whole record.

````

- [ ] **Step 4: Gate**

Run: `npm run generate && git status --short` (no generated artifact changes in this part), `npm run lint`, `npx tsc --noEmit -p .`, `npm run build`, `npm run validate:seeds`, `npm run test:fixtures`, `npm run test:schema`, `npm run test:journal`, `npm run test:quality`, `npm run test:weighing`, `npm run test:weighing-derive`, `npm run test:weighing-events`, `npm run test:weighing-provider`, `npm run test:publik-strip`, `npm run test:cli`, `npm run test:bootstrap`, `npm run test:mcp` (the MCP suite still expects its Part-4-era counts only after Part 4 — at this layer it must still pass at its old count of 30), `npm run test:docs-visibility`, and with the scratch Postgres up: `npm run test:graph`, `npm run test:github`, `npm run test:publik`.
Expected: all exit 0.

- [ ] **Step 5: Commit and submit**

```bash
git add package.json package-lock.json packages/cli/package.json .github/workflows/ci.yml docs/spec/journal.md docs/spec/services.md docs/spec/toolchain.md docs/hosted-projects.md
git commit -m "chore(weighing): scripts, CI steps, arkaik 0.12.0 and the storage docs (part 3/5)"
gh stack submit --auto
```

---

## Part 4 — `weighing/4-mcp`

**Goal.** An agent can read the value matrix and write a judgement: `get_matrix` (mirrors `kritik_matrix`), `assess` (mirrors `kritik_score`), and `save_positioning`. In a repo they read and write `docs/weighing/`; on a hosted project they read the server's folded section and post `weighing.*` events. Both go through the same `planWeighingEvents` gate as the app.

**Must not touch:** `kritik-tools.ts`, `lib/`, `components/`, `app/`, any schema file (if you find you need a schema change, navigate down: `gh stack down`, fix it in `weighing/1-schema` / `2-derive` / `3-storage`, `gh stack rebase --upstack`).

**Reference precedent:** `packages/mcp/src/kritik-tools.ts` (`buildKritikCatalog`, the hosted/repo split, `kritik_score`), `packages/mcp/src/store.ts` (`appendQualityEvents?`), `packages/mcp/src/remote-store.ts`, `tests/mcp/kritik-tools.test.js` (stdio harness + a stub of the hosted API), `docs/spec/mcp.md` § Quality tools.

**What the tools promise** (and the tests pin):

- `get_matrix` also returns `skipped` — `{ kind, id?, role?, index }` for every stored set or matrix the resolver dropped (malformed, a built-in redefined, a duplicate id) — plus a note, only when there is one. `get_matrix` reports served and cost per promise **never netted**, `positioned` only for an *active* positioning, `kept_share`, `guesswork`, the three claim flags, `stale` and `review`, and says — in `notes` — when every figure is a seeded guess or when the positioning is a draft. With `subject` it returns one promise's every cell plus the scale's anchors and the confidence anchors: what an agent reads before it scores.
- `assess` has **no scorer argument** (an agent is stamped `agent`; the most it may say about itself is `model`; a repo-mode session stamps `scorer.on_behalf_of` only when it was told whose it is, via `ARKAIK_ON_BEHALF_OF`, and a hosted one lets the server stamp the token owner: D14, not yet run), requires `evidence` above confidence 0, refuses unknown elements, levels off the scale and non-acceptance subjects with the planner's reason, stamps the set's version and the subject's fingerprint, and — when a human's level already stands for the cell — says so and that the agent's is recorded beside it (and that the cell is on the review list if they differ by 2 or more).
- Repo mode upserts `docs/weighing/assessments/<matrix>.json` and writes **nothing to the journal**; hosted mode sends no `scorer`, `basis` or `ts` (the route would 400 it).
- `save_positioning` defaults to `status: "draft"` and replaces the positioning whole.

### Task 4.1: The store seam

**Files:**
- Modify: `packages/mcp/src/store.ts`, `packages/mcp/src/remote-store.ts`

- [ ] **Step 1: Add `appendWeighingEvents?` to the `Store` interface and implement it on the remote store**

The input type is `@arkaik/schema`'s own `WeighingEventInput` — unlike Kritik's `HostedQualityInput` it lives in the package this server already bundles, so there is no structural copy to keep in lockstep.

```diff
--- a/packages/mcp/src/store.ts
+++ b/packages/mcp/src/store.ts
@@ -18,6 +18,7 @@
   type MutationOp,
   type Project,
   type ValidationFinding,
+  type WeighingEventInput,
 } from "@arkaik/schema";
 import { appendJournalEvent, journalPathFor, validateBundleAt, type BundleValidation } from "arkaik/io";
 
@@ -109,6 +110,16 @@
    * no checkout needs the server to hold the pen.
    */
   appendQualityEvents?(inputs: readonly HostedQualityInput[]): Promise<JournalEvent[]>;
+  /**
+   * Hosted-only: record assessments, or a positioning, via
+   * `POST …/weighing/events` (docs/rfcs/weighing.md). `undefined` on the file
+   * store — in a repo the weighing tools write the sidecars under
+   * `docs/weighing/` themselves. The input type is `@arkaik/schema`'s own, not
+   * a structural copy: unlike the quality union it lives in the package this
+   * server already bundles. Resolves to the events the server appended; rejects
+   * with the refusal's reasons.
+   */
+  appendWeighingEvents?(inputs: readonly WeighingEventInput[]): Promise<JournalEvent[]>;
 }
 
 /**
```

```diff
--- a/packages/mcp/src/remote-store.ts
+++ b/packages/mcp/src/remote-store.ts
@@ -28,6 +28,7 @@
   type Project,
   type ValidationFinding,
   type ValidationResult,
+  type WeighingEventInput,
 } from "@arkaik/schema";
 
 import type { HostedQualityInput, LoadedGraph, QualityEventRefusal, Store, WriteResult } from "./store";
@@ -263,6 +264,32 @@
         throw err;
       }
     },
+
+    // The weighing twin of the method above, and simpler: there is no
+    // retry-after-a-dropped-response story, because an assessment is
+    // latest-wins per cell and scorer kind — sending it twice is the same write.
+    // The server stamps the scorer (a token is an agent) and the basis, so
+    // nothing about provenance travels from here, and a refusal names each
+    // entry's `index`, `reason` and `detail`.
+    async appendWeighingEvents(inputs: readonly WeighingEventInput[]): Promise<JournalEvent[]> {
+      try {
+        const result = await request<{ events: JournalEvent[] }>("/weighing/events", {
+          method: "POST",
+          body: JSON.stringify({ events: inputs }),
+        });
+        return result.events;
+      } catch (err) {
+        const e = err as Error & {
+          status?: number;
+          body?: { error?: string; refusals?: { index: number; reason: string; detail?: string }[] };
+        };
+        if (e.status === 422 && e.body?.error === "refused" && e.body.refusals) {
+          const detail = e.body.refusals.map((r) => `entry ${r.index}: ${r.reason}${r.detail ? ` — ${r.detail}` : ""}`).join("; ");
+          throw new Error(`Weighing events refused — ${detail}`);
+        }
+        throw err;
+      }
+    },
   };
 }
 
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p .`
Expected: silent.

- [ ] **Step 3: Commit**

```bash
git add packages/mcp/src/store.ts packages/mcp/src/remote-store.ts
git commit -m "feat(weighing): the Store seam for hosted weighing events (part 4/5)"
```

### Task 4.2: The failing test, and the catalog count

**Files:**
- Create: `tests/mcp/weighing-tools.test.js`
- Modify: `tests/mcp/run-mcp-tests.js`, `package.json`

- [ ] **Step 1: Write the stdio test**

It spawns the built server over a tmpdir repo (the sidecars) and over a stub of the hosted API (events), and finishes by running the built CLI's `pack` over what the agent wrote — so an agent's file and the CLI's fold are proven to be the same thing.

```js
#!/usr/bin/env node

/**
 * The weighing tool catalog over stdio (docs/rfcs/weighing.md) — `get_matrix`,
 * `assess` and `save_positioning`, against a tmpdir repo (the sidecars under
 * `docs/weighing/`) and against a stub of the hosted API (events).
 *
 * What this covers that tests/schema/weighing-*.test.js cannot: that an agent
 * gets the same answers through MCP as the schema derives, that `assess` goes
 * through the same validator-gated gate as every other writer, that an agent is
 * stamped an agent whatever it says, and that what an agent writes in a repo is
 * what `arkaik pack` folds into the bundle.
 *
 * Run via `npm run test:mcp` (builds `arkaik` and `arkaik-mcp` first).
 */

const { spawn, spawnSync } = require("child_process");
const http = require("node:http");
const { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("fs");
const { tmpdir } = require("os");
const path = require("path");
const readline = require("readline");

const ROOT = path.join(__dirname, "..", "..");
const SERVER = path.join(ROOT, "packages", "mcp", "dist", "index.js");
const CLI = path.join(ROOT, "packages", "cli", "dist", "index.js");

if (!existsSync(SERVER) || !existsSync(CLI)) {
  console.error("arkaik-mcp / arkaik are not built. Run: npm run build -w arkaik -w arkaik-mcp (test:mcp does this).");
  process.exit(1);
}

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`PASS: ${name}`);
  else {
    failures++;
    console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const ISO = "2026-01-01T00:00:00.000Z";
const NODES = [
  {
    id: "AC-consent",
    project_id: "demo",
    species: "acceptance",
    title: "You agree to the terms knowingly, not by accident",
    status: "development",
    platforms: ["web", "ios"],
    metadata: { gherkin: "Given the consent page\nWhen I tick both boxes\nThen the button wakes", values: ["reduces-risk", "reduces-anxiety"], platformStatuses: { web: "live", ios: "development" } },
  },
  {
    id: "AC-invite",
    project_id: "demo",
    species: "acceptance",
    title: "Accept an invite",
    status: "live",
    platforms: ["web"],
    metadata: { gherkin: "Given a link\nWhen I tap it\nThen we connect", values: ["connects"] },
  },
  { id: "V-home", project_id: "demo", species: "view", title: "Home", status: "live", platforms: ["web"] },
];
const BUNDLE = { schema_version: 3, project: { id: "demo", title: "Demo", created_at: ISO, updated_at: ISO }, nodes: NODES, edges: [] };
const CREATED = NODES.map((n, i) => JSON.stringify({ id: `01A${i}`, ts: ISO, type: "node.created", node_id: n.id, species: n.species, title: n.title }));

/** Spawn a server over a fresh tmpdir repo (or hosted, with extra args); returns an rpc client. */
function startSession(extraArgs = [], env = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "arkaik-mcp-weighing-"));
  mkdirSync(path.join(dir, "docs", "arkaik"), { recursive: true });
  const bundlePath = path.join(dir, "docs", "arkaik", "bundle.json");
  writeFileSync(bundlePath, JSON.stringify(BUNDLE, null, 2));
  writeFileSync(path.join(dir, "docs", "arkaik", "journal.jsonl"), `${CREATED.join("\n")}\n`);

  const args = extraArgs.length > 0 ? extraArgs : ["--bundle", bundlePath];
  const child = spawn(process.execPath, [SERVER, ...args], { stdio: ["pipe", "pipe", "pipe"], cwd: dir, env: { ...process.env, ...env } });
  const lines = readline.createInterface({ input: child.stdout });
  const pending = new Map();
  let nextId = 1;
  lines.on("line", (line) => {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    const waiter = pending.get(message.id);
    if (waiter) {
      pending.delete(message.id);
      waiter(message);
    }
  });
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, resolve);
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      setTimeout(() => reject(new Error(`timeout on ${method}`)), 15000).unref?.();
    });
  const call = async (name, args = {}) => {
    const response = await request("tools/call", { name, arguments: args });
    const text = response.result?.content?.[0]?.text ?? "";
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = { message: text };
    }
    return { isError: response.result?.isError === true, json, text };
  };
  return {
    dir,
    bundlePath,
    request,
    call,
    readJson: (...parts) => JSON.parse(readFileSync(path.join(dir, ...parts), "utf8")),
    stop: () => {
      child.kill();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function main() {
  const repo = startSession();
  try {
    await repo.request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "weighing-test", version: "0" } });

    const listed = await repo.request("tools/list");
    const names = (listed.result?.tools ?? []).map((t) => t.name);
    check("the catalog lists get_matrix, assess and save_positioning", ["get_matrix", "assess", "save_positioning"].every((n) => names.includes(n)), names.join());
    const assessDef = listed.result.tools.find((t) => t.name === "assess");
    check("assess takes no scorer — an agent cannot claim to be a human", assessDef !== undefined && !("scorer" in assessDef.inputSchema.properties) && !("kind" in assessDef.inputSchema.properties));
    check("assess's level is the signed scale", assessDef !== undefined && assessDef.inputSchema.properties.level.minimum === -3 && assessDef.inputSchema.properties.level.maximum === 3);

    // --- get_matrix with nothing assessed: seeds, honestly labelled --------------
    const first = await repo.call("get_matrix");
    check("get_matrix answers with nothing stored", !first.isError, first.text.slice(0, 200));
    check("it judges the two acceptances, not the view", first.json.totals.promises === 2, JSON.stringify(first.json.totals));
    check("nothing is assessed, and it says every figure is a guess", first.json.totals.assessed === 0 && first.json.notes.some((n) => /seeded/.test(n)), JSON.stringify(first.json.notes));
    check("all of it is guesswork", first.json.totals.guesswork === 1);
    const consent = first.json.promises.find((p) => p.node_id === "AC-consent");
    check("served is seeded from claim order: +3 and +2 over 3 = 1.67", consent.served === 1.67 && consent.cost === 0, JSON.stringify(consent));
    check("kept share is live platforms over applicable ones", consent.kept_share === 0.5);
    check("no positioning, no positioned figure", consent.positioned === null && first.json.positioning === null);
    check("a list row carries no cells; the subject read does", consent.cells === undefined);
    check("nothing stored was dropped, so there is no skipped list", first.json.skipped === undefined);

    const one = await repo.call("get_matrix", { subject: "AC-consent" });
    check("a subject read returns every cell with its scorer", one.json.promise.cells.length === 2 && one.json.promise.cells.every((c) => c.source === "seed" && c.scorer.kind === "rule" && c.confidence === 0));
    check("…and the scale's anchors, so the agent scores against words", one.json.scale.anchors["-3"] && one.json.scale.anchors["3"] && one.json.confidence_anchors["0"]);
    check("a view is not a subject", (await repo.call("get_matrix", { subject: "V-home" })).isError);
    check("an unknown matrix is an error", (await repo.call("get_matrix", { matrix: "nope" })).isError);
    check("a bad sort is an error", (await repo.call("get_matrix", { sort: "vibes" })).isError);

    // --- assess: validator-gated, agent-stamped -----------------------------------
    const bad = [
      ["an unknown element", { subject: "AC-consent", criterion: "teleports", level: 1, confidence: 0 }],
      ["a level of 4", { subject: "AC-consent", criterion: "connects", level: 4, confidence: 0 }],
      ["a view as the subject", { subject: "V-home", criterion: "connects", level: 1, confidence: 0 }],
      ["a missing acceptance", { subject: "AC-gone", criterion: "connects", level: 1, confidence: 0 }],
      ["evidence missing above confidence 0", { subject: "AC-consent", criterion: "reduces-anxiety", level: 1, confidence: 2 }],
    ];
    for (const [label, args] of bad) {
      const res = await repo.call("assess", args);
      check(`assess refuses ${label}`, res.isError, res.text.slice(0, 160));
    }
    check("…and wrote nothing", !existsSync(path.join(repo.dir, "docs", "weighing")));

    const scored = await repo.call("assess", { subject: "AC-consent", criterion: "reduces-anxiety", level: 1, confidence: 2, evidence: "the Then clause removes one worry (accidental consent), not the page's overall anxiety", model: "claude" });
    check("assess records a judgement", !scored.isError && scored.json.assessment.level === 1, scored.text.slice(0, 300));
    check("the scorer is stamped an agent, with the model", scored.json.assessment.scorer.kind === "agent" && scored.json.assessment.scorer.model === "claude");
    // D14, not yet run: absent unless known, stamped when the session was told.
    check("on_behalf_of is absent unless the session was told whose it is", !("on_behalf_of" in scored.json.assessment.scorer));
    const told = startSession([], { ARKAIK_ON_BEHALF_OF: "u_1842" });
    try {
      await told.request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "weighing-test", version: "0" } });
      const behalf = await told.call("assess", { subject: "AC-consent", criterion: "reduces-anxiety", level: 1, confidence: 0 });
      check("…and stamped when it was told", !behalf.isError && behalf.json.assessment.scorer.on_behalf_of === "u_1842", behalf.text.slice(0, 200));
    } finally {
      told.stop();
    }
    check("the basis is stamped: fingerprint and the set's version", /^fp1-/.test(scored.json.assessment.basis.fingerprint) && scored.json.assessment.basis.set_version === "1.0.0");
    check("the reply carries the level's anchor", typeof scored.json.anchor === "string" && scored.json.anchor.length > 0);
    const file = repo.readJson("docs", "weighing", "assessments", "value.json");
    check("it upserts docs/weighing/assessments/value.json — the sidecar is the record", file.matrix === "value" && file.assessments.length === 1);
    check("…and writes nothing to the journal", !readFileSync(path.join(repo.dir, "docs", "arkaik", "journal.jsonl"), "utf8").includes("weighing."));

    const cost = await repo.call("assess", { subject: "AC-consent", criterion: "reduces-effort", level: -1, confidence: 1, evidence: "two boxes before the button wakes" });
    check("a negative level is a cost, and an unclaimed one", !cost.isError && cost.json.assessment.level === -1);
    const rescored = await repo.call("assess", { subject: "AC-consent", criterion: "reduces-anxiety", level: 2, confidence: 2, evidence: "second reading" });
    check("re-scoring replaces in place and reports the old level", rescored.json.replaced_level === 1);
    check("…leaving two rows, not three", repo.readJson("docs", "weighing", "assessments", "value.json").assessments.length === 2);

    // --- the read now reflects it -------------------------------------------------------
    const after = await repo.call("get_matrix", { subject: "AC-consent" });
    const p = after.json.promise;
    check("served and cost are never netted: +3 seed, +2 scored, −1 scored", p.served === 1.67 && p.cost === 0.33, JSON.stringify(p));
    check("a scored claim reads at the scorer's level", p.cells.find((c) => c.criterion === "reduces-anxiety").level === 2 && p.cells.find((c) => c.criterion === "reduces-anxiety").source === "stored");
    check("the unclaimed cost is flagged", p.flags.unclaimed_cost.join() === "reduces-effort");
    check("guesswork is only the seeded reduces-risk cell now", p.guesswork.served === 0.6, String(p.guesswork.served));
    check("assessed is one promise", (await repo.call("get_matrix")).json.totals.assessed === 1);

    // --- staleness: edit the promise, the score goes stale ---------------------------------
    await repo.call("update_node", { node_id: "AC-consent", patch: { title: "You agree to the terms, knowingly" } });
    const stale = await repo.call("get_matrix", { subject: "AC-consent" });
    check("editing the title marks the scored cells stale", stale.json.promise.stale.sort().join() === "reduces-anxiety,reduces-effort", JSON.stringify(stale.json.promise.stale));
    check("…without changing their level", stale.json.promise.cells.find((c) => c.criterion === "reduces-anxiety").level === 2);
    check("filter=stale lists it", (await repo.call("get_matrix", { filter: "stale" })).json.promises.map((x) => x.node_id).join() === "AC-consent");
    check("filter=unassessed lists the other", (await repo.call("get_matrix", { filter: "unassessed" })).json.promises.map((x) => x.node_id).join() === "AC-invite");
    check("filter=flagged lists the one with an unclaimed cost", (await repo.call("get_matrix", { filter: "flagged" })).json.promises.map((x) => x.node_id).join() === "AC-consent");

    // --- a human's file is never overwritten by an agent ---------------------------------------
    const filePath = path.join(repo.dir, "docs", "weighing", "assessments", "value.json");
    const onDisk = JSON.parse(readFileSync(filePath, "utf8"));
    onDisk.assessments.push({ matrix: "value", subject: "AC-consent", criterion: "reduces-anxiety", level: 3, scorer: { kind: "human", id: "alexis" }, confidence: 3, evidence: "I wrote it", basis: { fingerprint: "fp1-0", set_version: "1.0.0" }, ts: "2026-11-15T09:00:00.000Z" });
    writeFileSync(filePath, JSON.stringify(onDisk, null, 2));
    const afterHuman = await repo.call("get_matrix", { subject: "AC-consent" });
    const cell = afterHuman.json.promise.cells.find((c) => c.criterion === "reduces-anxiety");
    check("a human's level beats the agent's", cell.level === 3 && cell.scorer.kind === "human");
    check("…and the agent's rides beside it", cell.others?.[0]?.level === 2);
    check("…and the cell is on the review list only when they differ by 2 or more (3 vs 2: not)", !cell.review);
    const again = await repo.call("assess", { subject: "AC-consent", criterion: "reduces-anxiety", level: 0, confidence: 2, evidence: "I disagree" });
    check("an agent that disagrees is told a human's level stands", again.json.notes?.some((n) => /human's level already stands/.test(n) && /review/.test(n)), JSON.stringify(again.json.notes));
    check("…and the human's row is still on disk", repo.readJson("docs", "weighing", "assessments", "value.json").assessments.some((a) => a.scorer?.kind === "human" && a.level === 3));

    // --- positioning ----------------------------------------------------------------------------------
    const draft = await repo.call("save_positioning", { elements: [{ id: "reduces-anxiety", weight: 3, anchors: { 3: "removes a worry the user names", 0: "nothing to do with worry" } }, { id: "connects" }] });
    check("save_positioning writes a draft by default", !draft.isError && draft.json.positioning.status === "draft" && draft.json.notes.some((n) => /draft/.test(n)), draft.text.slice(0, 200));
    check("…to docs/weighing/sets/positioning.json", repo.readJson("docs", "weighing", "sets", "positioning.json").criteria.length === 2);
    const drafted = await repo.call("get_matrix");
    check("a draft feeds no roll-up: no positioned figure, and it says so", drafted.json.promises.every((x) => x.positioned === null) && drafted.json.notes.some((n) => /draft/.test(n)));
    check("…but get_matrix shows the draft", drafted.json.positioning.status === "draft" && drafted.json.positioning.elements.length === 2);
    const active = await repo.call("save_positioning", { status: "active", elements: [{ id: "reduces-anxiety", weight: 3 }, { id: "connects" }] });
    check("saving it active replaces it whole", !active.isError && repo.readJson("docs", "weighing", "sets", "positioning.json").status === "active");
    const positioned = (await repo.call("get_matrix", { subject: "AC-consent" })).json.promise.positioned;
    check("an active positioning gives positioned figures: anxiety 3/3 × weight 3", positioned.served === 3 && positioned.cost === 0, JSON.stringify(positioned));
    check("a positioning naming a non-element is refused", (await repo.call("save_positioning", { elements: [{ id: "teleports" }] })).isError);
    check("a weight of 0 is refused", (await repo.call("save_positioning", { elements: [{ id: "connects", weight: 0 }] })).isError);

    // --- what the agent wrote is what pack folds ---------------------------------------------------------
    const packed = spawnSync(process.execPath, [CLI, "pack", repo.bundlePath], { encoding: "utf8", cwd: repo.dir });
    const out = JSON.parse(packed.stdout);
    check("arkaik pack folds the agent's file into bundle.weighing", out.weighing?.assessments?.length === 3 && out.weighing.sets[0].id === "positioning", packed.stderr);
    check("validate_bundle reports no error for the repo", (await repo.call("validate_bundle")).json.errors?.length === 0);
  } finally {
    repo.stop();
  }

  // --- hosted: the same tools over a stub of the API --------------------------------------------------------
  const received = [];
  let refuse = false;
  const HOSTED = {
    ...BUNDLE,
    weighing: {
      sets: [],
      matrices: [],
      assessments: [{ matrix: "value", subject: "AC-invite", criterion: "connects", level: 2, scorer: { kind: "human", id: "arkaik-app" }, confidence: 2, evidence: "a person", basis: { fingerprint: "fp1-0", set_version: "1.0.0" }, ts: "2026-11-14T10:00:00.000Z" }],
    },
  };
  const stub = http.createServer((req, res) => {
    const json = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "GET" && req.url === "/api/graph/projects/demo") return json(200, { bundle: HOSTED, version: "v1" });
    if (req.method === "GET" && req.url === "/api/graph/projects/demo/journal") return json(200, { journal: [] });
    if (req.method === "POST" && req.url === "/api/graph/projects/demo/weighing/events") {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        const body = JSON.parse(raw);
        received.push(body);
        if (refuse) return json(422, { error: "refused", message: "entry 0: unknown_criterion", refusals: [{ index: 0, reason: "unknown_criterion", detail: '"teleports" is not in set "value-contribution"' }] });
        return json(200, { events: body.events.map((e, i) => ({ id: `01H${i}`, ts: "2026-11-15T10:00:00.000Z", actor: "arkaik-agent", ...e, ...(e.type === "weighing.assessment.recorded" ? { scorer: { kind: "agent", id: "arkaik-agent", ...(e.model ? { model: e.model } : {}) }, basis: { fingerprint: "fp1-server", set_version: "1.0.0" } } : {}) })) });
      });
      return;
    }
    json(404, { error: "not_found" });
  });
  await new Promise((resolve) => stub.listen(0, resolve));
  const baseUrl = `http://127.0.0.1:${stub.address().port}`;
  const hosted = startSession(["--remote", "--project", "demo"], { ARKAIK_TOKEN: "t", ARKAIK_URL: baseUrl });
  try {
    await hosted.request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "weighing-test", version: "0" } });

    const read = await hosted.call("get_matrix", { subject: "AC-invite" });
    check("hosted get_matrix reads the section the server folded", read.json.promise.cells[0].scorer.kind === "human" && read.json.promise.cells[0].level === 2, read.text.slice(0, 200));

    const res = await hosted.call("assess", { subject: "AC-consent", criterion: "reduces-anxiety", level: -2, confidence: 2, evidence: "a hypothetical health-data consent", model: "claude" });
    check("hosted assess posts exactly one assessment entry", !res.isError && received.length === 1 && received[0].events.length === 1, res.text.slice(0, 300));
    const sent = received[0].events[0];
    check("…of the right type and fields", sent.type === "weighing.assessment.recorded" && sent.subject === "AC-consent" && sent.criterion === "reduces-anxiety" && sent.level === -2 && sent.confidence === 2 && sent.model === "claude");
    check("…with NO scorer, basis or ts — the server stamps them", !("scorer" in sent) && !("basis" in sent) && !("ts" in sent), JSON.stringify(sent));
    check("the reply is the server's stamped event", res.json.assessment.scorer.kind === "agent" && res.json.assessment.basis.fingerprint === "fp1-server");
    check("no human level stands for that cell, so there is no note", res.json.notes === undefined);
    check("nothing was written to disk", !existsSync(path.join(hosted.dir, "docs", "weighing")));

    const note = await hosted.call("assess", { subject: "AC-invite", criterion: "connects", level: 0, confidence: 1, evidence: "reads as touching only" });
    check("hosted assess tells an agent a human's level stands", note.json.notes?.some((n) => /human's level already stands/.test(n)), JSON.stringify(note.json.notes));

    const pos = await hosted.call("save_positioning", { elements: [{ id: "connects", weight: 2 }] });
    check("hosted save_positioning posts a weighing.set.saved draft", !pos.isError && received.at(-1).events[0].type === "weighing.set.saved" && received.at(-1).events[0].set.status === "draft");

    refuse = true;
    const refused = await hosted.call("assess", { subject: "AC-consent", criterion: "reduces-anxiety", level: 1, confidence: 0 });
    check("a server refusal surfaces with its reason", refused.isError && /unknown_criterion/.test(refused.text), refused.text.slice(0, 300));
  } finally {
    hosted.stop();
    stub.close();
  }

  if (failures > 0) {
    console.log(`\n${failures} weighing tool test(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll weighing tool tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 2: Update the catalog assertion and chain the suite**

```diff
--- a/tests/mcp/run-mcp-tests.js
+++ b/tests/mcp/run-mcp-tests.js
@@ -120,14 +120,17 @@
 
   const listed = await request("tools/list");
   const toolNames = (listed.result?.tools ?? []).map((tool) => tool.name);
-  // 16 graph tools + 14 kritik_* (docs/spec/mcp.md § Tool Catalog).
-  check("tools/list exposes the 30-tool catalog", toolNames.length === 30, toolNames.join(", "));
+  // 16 graph tools + 14 kritik_* + 3 weighing (docs/spec/mcp.md § Tool Catalog).
+  check("tools/list exposes the 33-tool catalog", toolNames.length === 33, toolNames.join(", "));
   for (const name of ["list_nodes", "get_node", "create_node", "update_node", "add_edge", "validate_bundle", "get_map", "record_screenshot", "remove_screenshot"]) {
     check(`catalog includes ${name}`, toolNames.includes(name));
   }
   for (const name of ["kritik_matrix", "kritik_score", "kritik_open_finding", "kritik_resolve_finding"]) {
     check(`catalog includes ${name}`, toolNames.includes(name));
   }
+  for (const name of ["get_matrix", "assess", "save_positioning"]) {
+    check(`catalog includes ${name}`, toolNames.includes(name));
+  }
   const createDef = (listed.result?.tools ?? []).find((tool) => tool.name === "create_node");
   check(
     "tool schemas carry format enums",
```

In `package.json`, change the end of `"test:mcp"` from `… && node tests/mcp/kritik-tools.test.js",` to `… && node tests/mcp/kritik-tools.test.js && node tests/mcp/weighing-tools.test.js",`.

- [ ] **Step 3: Run it to verify it fails**

Run: `npm run test:mcp`
Expected: FAIL — `FAIL: tools/list exposes the 33-tool catalog` (30 listed) and `FAIL: catalog includes get_matrix` (then the weighing suite fails at its first check). No tool exists yet.

- [ ] **Step 4: Do not commit yet.** A stack part must be green when it is pushed; the test and the three tools are committed together at the end of Task 4.5.

### Task 4.3: `get_matrix`

**Files:**
- Create: `packages/mcp/src/weighing-tools.ts`
- Modify: `packages/mcp/src/tools.ts`

- [ ] **Step 1: Create the file with the header, the helpers and `get_matrix`**

The file ends with the catalog's `return` and closing brace; the next two tasks insert the other two tools **above** `  return { tools, handlers };`.

```ts
/**
 * The weighing half of the tool catalog (docs/rfcs/weighing.md) — `get_matrix`,
 * `assess` and `save_positioning`, the agent plane's way of reading what each
 * promise is worth and writing a judgement about it. They mirror
 * `kritik_matrix` and `kritik_score`, and go through the same validator-gated
 * write path.
 *
 * **The same code as every other writer.** A level written here goes through
 * `planWeighingEvents`, the one gate the hosted route and the browser provider
 * also use, so a score written by an agent and a score written by a person have
 * been checked against the same library, the same scale and the same subject
 * rule. The derived numbers a read returns are `@arkaik/schema`'s
 * (`weighing-derive.ts`), never recomputed here.
 *
 * **Two stores, one gate.** In a repository the sidecar files under
 * `docs/weighing/` are canonical, so `assess` upserts one row into
 * `assessments/<matrix>.json` and writes no journal event — the file is the
 * record and git its history, as for `kritik_score`. A hosted project has no
 * such directory: `assess` posts to `POST …/weighing/events` and the server
 * folds the event back into every read. The tools do not branch on anything
 * else, and both modes work.
 *
 * **An agent writes as an agent.** The scorer kind is stamped `agent` — here
 * from the server's identity, on the hosted route from the token — never from
 * an argument, because a human's level wins every cell and a caller must not be
 * able to claim to be one. What an agent may say about itself is `model`.
 *
 * **On whose behalf (D14, not yet run).** Hosted, the server stamps
 * `scorer.on_behalf_of` from the token. In a repository nothing identifies a
 * person, so it is absent unless the session was told: `ARKAIK_ON_BEHALF_OF`,
 * an opaque user id or handle, never an email.
 */

import {
  CONFIDENCE_ANCHORS,
  POSITIONING_SET_ID,
  VALUE_MATRIX_ID,
  VALUE_SET_ID,
  WEIGHING_ASSESSMENT_RECORDED,
  WEIGHING_SET_SAVED,
  buildWeighingContext,
  deriveWeighing,
  planWeighingEvents,
  resolveWeighing,
  sortPromises,
  upsertWeighingAssessment,
  weighPromise,
  weighingScaleOf,
  type WeighingAssessment,
  type WeighingCriteriaSet,
  type EffectiveCell,
  type JournalEvent,
  type Node,
  type PromiseWeighing,
  type WeighingEventInput,
  type WeighingSection,
} from "@arkaik/schema";
import {
  loadMatrixAssessments,
  loadWeighingSection,
  saveWeighingAssessments,
  saveWeighingSet,
  weighingAssessmentsPath,
  weighingSetPath,
} from "@arkaik/schema/src/cli/weighing-files";
import { ToolError, type ToolDefinition, type ToolHandler } from "./protocol";
import { MCP_ACTOR, type LoadedGraph, type Store } from "./store";

export interface WeighingToolContext {
  store: Store;
  /**
   * The repo root holding `docs/weighing/`, or `undefined` in hosted mode — the
   * same root `docs/quality/` is found under, set by index.ts from the resolved
   * bundle path.
   */
  qualityRoot?: string;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value.length === 0) throw new ToolError(`\`${key}\` is required and must be a non-empty string.`);
  return value;
}

function requireInt(args: Record<string, unknown>, key: string, min: number, max: number): number {
  const value = args[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new ToolError(`\`${key}\` is required and must be an integer ${min} to ${max}.`);
  }
  return value;
}

const optionalString = (args: Record<string, unknown>, key: string): string | undefined =>
  typeof args[key] === "string" && args[key] !== "" ? (args[key] as string) : undefined;

/** One cell, in the shape an agent reads. */
function cellRow(cell: EffectiveCell) {
  return {
    criterion: cell.criterion,
    level: cell.level,
    scorer: cell.scorer,
    confidence: cell.confidence,
    source: cell.source,
    stale: cell.stale,
    claimed: cell.claimed,
    ...(cell.evidence !== undefined ? { evidence: cell.evidence } : {}),
    ...(cell.review ? { review: true } : {}),
    ...(cell.others.length > 0
      ? { others: cell.others.map((row) => ({ scorer: row.scorer, level: row.level, confidence: row.confidence, ...(row.evidence !== undefined ? { evidence: row.evidence } : {}) })) }
      : {}),
  };
}

/** One promise: the numbers every time, the cells only when asked for. */
function promiseRow(promise: PromiseWeighing, withCells: boolean) {
  return {
    node_id: promise.node_id,
    title: promise.title,
    status: promise.status,
    served: round2(promise.served),
    cost: round2(promise.cost),
    positioned: promise.positioned === null ? null : { served: round2(promise.positioned.served), cost: round2(promise.positioned.cost) },
    kept_share: promise.kept_share === null ? null : round2(promise.kept_share),
    guesswork: { served: round2(promise.guesswork.served), cost: round2(promise.guesswork.cost) },
    flags: promise.flags,
    stale: promise.stale,
    review: promise.review,
    ...(promise.archived ? { archived: true } : {}),
    ...(withCells ? { cells: promise.cells.map(cellRow) } : {}),
  };
}

const FILTERS = ["flagged", "stale", "review", "unassessed"] as const;

function matchesFilter(promise: PromiseWeighing, filter: string): boolean {
  switch (filter) {
    case "flagged":
      return promise.flags.claim_not_supported.length + promise.flags.unclaimed_value.length + promise.flags.unclaimed_cost.length > 0;
    case "stale":
      return promise.stale.length > 0;
    case "review":
      return promise.review.length > 0;
    case "unassessed":
      return !promise.cells.some((cell) => cell.source === "stored");
    default:
      return true;
  }
}

export function buildWeighingCatalog(ctx: WeighingToolContext): {
  tools: ToolDefinition[];
  handlers: Record<string, ToolHandler>;
} {
  const tools: ToolDefinition[] = [];
  const handlers: Record<string, ToolHandler> = {};
  const tool = (definition: ToolDefinition, handler: ToolHandler) => {
    tools.push(definition);
    handlers[definition.name] = handler;
  };

  /** D14, not yet run: whom this session acts for, when it has been told. Absent otherwise; the planner refuses an email-shaped value. */
  const onBehalfOf = process.env.ARKAIK_ON_BEHALF_OF?.trim() || undefined;

  const load = async (): Promise<LoadedGraph> => {
    try {
      return await ctx.store.load();
    } catch (error) {
      throw new ToolError(`Cannot load ${ctx.store.describe()}: ${(error as Error).message}`);
    }
  };

  /** The section as this session sees it: the sidecars in a repo, the server's fold when hosted. */
  const sectionOf = (graph: LoadedGraph): WeighingSection | undefined => {
    if (ctx.qualityRoot === undefined) return (graph.loaded.bundle as { weighing?: WeighingSection }).weighing;
    try {
      return loadWeighingSection(ctx.qualityRoot);
    } catch (error) {
      throw new ToolError((error as Error).message);
    }
  };

  const appendHosted = async (inputs: readonly WeighingEventInput[]): Promise<JournalEvent[]> => {
    if (ctx.store.appendWeighingEvents === undefined) throw new ToolError(`${ctx.store.describe()} cannot record assessments.`);
    try {
      return await ctx.store.appendWeighingEvents(inputs);
    } catch (error) {
      throw new ToolError((error as Error).message);
    }
  };

  // ---- Read -----------------------------------------------------------------

  tool(
    {
      name: "get_matrix",
      description:
        "The value matrix: what each promise (acceptance) is worth, against the 30 elements of value on a signed -3..+3 scale. Per promise: `served` (sum of positive levels / 3) and `cost` (sum of |negative levels| / 3), NEVER netted; `positioned` (the same over the elements the product's active positioning stands on, each times its weight); `kept_share` (platforms where it is live / platforms it applies to); `guesswork` (the share of served and of cost resting on confidence-0 cells). `flags` lists claim_not_supported (claimed in metadata.values but assessed 1 or less), unclaimed_value (assessed 1 or more but not claimed) and unclaimed_cost (any negative level — authors claim intent, so a cost is never claimed). `stale` lists elements whose winning level was scored before the promise's title, Gherkin or values changed; `review` lists elements where a human and an agent differ by 2 or more. A cell nobody has scored reads at a SEEDED level (first claimed value +3, second +2, rest +1; scorer rule, confidence 0): a guess, never a score — negatives are never seeded. A human's level beats an agent's beats a seed, whatever the dates. Pass `subject` for one promise with every cell, its evidence and the scale's anchors — what you read before calling assess. Otherwise it lists promises (sort: served | cost | positioned | title; filter: flagged | stale | review | unassessed; limit) plus the per-element promised / kept / cost masses. A draft positioning feeds nothing.",
      inputSchema: {
        type: "object",
        properties: {
          matrix: { type: "string", description: `Default: ${VALUE_MATRIX_ID}.` },
          subject: { type: "string", description: "An acceptance id: return that promise with every cell." },
          sort: { type: "string", enum: ["served", "cost", "positioned", "title"], description: "Default: served, heaviest first." },
          filter: { type: "string", enum: [...FILTERS] },
          limit: { type: "integer", minimum: 1, maximum: 200, description: "Default 25." },
        },
        additionalProperties: false,
      },
    },
    async (args) => {
      const graph = await load();
      const section = sectionOf(graph);
      const nodes = graph.nodes as Node[];
      const matrixId = optionalString(args, "matrix") ?? VALUE_MATRIX_ID;
      const view = deriveWeighing(nodes, section, matrixId);
      if (view === undefined) throw new ToolError(`No matrix "${matrixId}". The built-in one is "${VALUE_MATRIX_ID}".`);

      const positioning =
        view.positioning === null
          ? null
          : {
              status: view.positioning.active ? "active" : "draft",
              elements: view.positioning.set.criteria.map((criterion) => ({ id: criterion.id, weight: typeof criterion.weight === "number" && criterion.weight > 0 ? criterion.weight : 1, ...(criterion.anchors !== undefined ? { anchors: criterion.anchors } : {}) })),
            };
      // What the resolver dropped (a malformed saved positioning, a duplicate id): said, not silent.
      const { skipped } = resolveWeighing(section);
      const notes: string[] = [];
      if (skipped.length > 0) notes.push(`${skipped.length} stored set(s) or matrix(es) are malformed or duplicated and are ignored — see \`skipped\`.`);
      if (view.positioning !== null && !view.positioning.active) notes.push("The positioning is a draft — `positioned` figures are absent until it is saved as active.");
      if (view.totals.assessed === 0) notes.push("Nothing has been assessed yet — every figure is seeded from the order of metadata.values (confidence 0), a guess.");

      const subject = optionalString(args, "subject");
      if (subject !== undefined) {
        const promise = view.promises.find((candidate) => candidate.node_id === subject);
        if (promise === undefined) throw new ToolError(`"${subject}" is not a subject of matrix "${matrixId}" (it judges ${view.matrix.subjects.kind === "query" ? `${view.matrix.subjects.species} nodes` : "a listed set"}).`);
        return {
          matrix: { id: view.matrix.id, set: view.matrix.set, set_version: view.set.version },
          scale: weighingScaleOf(view.set),
          confidence_anchors: CONFIDENCE_ANCHORS,
          positioning,
          promise: promiseRow(promise, true),
          ...(skipped.length > 0 ? { skipped } : {}),
          ...(notes.length > 0 ? { notes } : {}),
        };
      }

      const sort = optionalString(args, "sort") ?? "served";
      if (!["served", "cost", "positioned", "title"].includes(sort)) throw new ToolError("`sort` must be served, cost, positioned or title.");
      const filter = optionalString(args, "filter");
      if (filter !== undefined && !(FILTERS as readonly string[]).includes(filter)) throw new ToolError(`\`filter\` must be one of ${FILTERS.join(", ")}.`);
      const limit = typeof args.limit === "number" && Number.isInteger(args.limit) ? Math.min(Math.max(args.limit, 1), 200) : 25;

      const matching = view.promises.filter((promise) => filter === undefined || matchesFilter(promise, filter));
      const ordered = sortPromises(matching, sort as "served" | "cost" | "positioned" | "title");
      const elements = view.set.criteria
        .map((criterion) => ({ criterion, mass: view.elements[criterion.id] }))
        .filter(({ mass }) => mass.promised > 0 || mass.cost > 0)
        .sort((a, b) => b.mass.promised - a.mass.promised)
        .map(({ criterion, mass }) => ({
          id: criterion.id,
          name: criterion.name,
          tier: criterion.group,
          promised: round2(mass.promised),
          kept: round2(mass.kept),
          cost: round2(mass.cost),
          guesswork: round2(mass.guesswork),
        }));
      return {
        matrix: { id: view.matrix.id, set: view.matrix.set, set_version: view.set.version },
        positioning,
        totals: {
          promises: view.totals.promises,
          archived: view.totals.archived,
          assessed: view.totals.assessed,
          promised: round2(view.totals.promised),
          kept: round2(view.totals.kept),
          cost: round2(view.totals.cost),
          guesswork: round2(view.totals.guesswork),
        },
        elements,
        promises: ordered.slice(0, limit).map((promise) => promiseRow(promise, false)),
        matching: ordered.length,
        ...(skipped.length > 0 ? { skipped } : {}),
        ...(notes.length > 0 ? { notes } : {}),
      };
    },
  );

  return { tools, handlers };
}
```

- [ ] **Step 2: Register the catalog**

```diff
--- a/packages/mcp/src/tools.ts
+++ b/packages/mcp/src/tools.ts
@@ -39,6 +39,7 @@
 } from "@arkaik/schema";
 import { ToolError, type ToolDefinition, type ToolHandler } from "./protocol";
 import { buildKritikCatalog } from "./kritik-tools";
+import { buildWeighingCatalog } from "./weighing-tools";
 import type { LoadedGraph as StoreLoadedGraph, Store, WriteResult } from "./store";
 
 interface ToolContext {
@@ -767,5 +768,13 @@
   tools.push(...kritik.tools);
   Object.assign(handlers, kritik.handlers);
 
+  // The weighing layer's tools (docs/rfcs/weighing.md): the same shape as the
+  // quality namespace above — a self-contained module over the docs/weighing/
+  // sidecars in a repo and the hosted events route otherwise, reached through
+  // the same validated gate every other writer uses.
+  const weighing = buildWeighingCatalog(ctx);
+  tools.push(...weighing.tools);
+  Object.assign(handlers, weighing.handlers);
+
   return { tools, handlers };
 }
```

- [ ] **Step 3: Run the suite**

Run: `npm run test:mcp`
Expected: the catalog is now 31 tools (`FAIL: tools/list exposes the 33-tool catalog` — two tools still missing), `catalog includes get_matrix` passes, and in `weighing-tools.test.js` the `get_matrix` checks `PASS:` (seeds, `kept share`, `a subject read returns every cell with its scorer`, the three refusals) while `FAIL: assess takes no scorer …` fires; the run then crashes at the first `assess` call with `TypeError: Cannot read properties of undefined (reading 'level')` — `assess` is not registered.

### Task 4.4: `assess`

**Files:**
- Modify: `packages/mcp/src/weighing-tools.ts`

- [ ] **Step 1: Insert `assess`** immediately above `  return { tools, handlers };`

```ts
  // ---- Write ----------------------------------------------------------------

  tool(
    {
      name: "assess",
      description:
        "Record one judgement: a signed level (-3..+3) for one promise on one value element, with how sure you are and why. Read the promise first with get_matrix `subject` so you score against the scale's anchors, not from memory. 0 means weighed and unrelated; a negative level is a COST (the promise works against that value) — score costs you find, authors rarely claim them, and an unclaimed cost is the most valuable thing an audit returns. `confidence`: 0 guess · 1 inferred from the promise's own text · 2 evidenced (cites something outside it) · 3 verified. `evidence` is required above confidence 0: a score without a citation is an opinion. Scored as an AGENT — a human's level for the same cell keeps winning and yours is recorded beside it, flagged for review when you differ by 2 or more. The tool stamps what you cannot: who you are (and, when the server was told, whose hands you are), the set's version and a fingerprint of the promise, so a later edit to its title, Gherkin or values marks your score stale. In a repository it upserts docs/weighing/assessments/<matrix>.json (nothing in the journal); on a hosted project it records weighing.assessment.recorded. The write goes through the same validator-gated gate as the app's form: an unknown element, an out-of-range level or a subject that is not an acceptance refuses with the reason.",
      inputSchema: {
        type: "object",
        properties: {
          subject: { type: "string", description: "An acceptance id." },
          criterion: { type: "string", description: "A value element id, e.g. reduces-anxiety." },
          level: { type: "integer", minimum: -3, maximum: 3 },
          confidence: { type: "integer", enum: [0, 1, 2, 3] },
          evidence: { type: "string", description: "Markdown. Required when confidence is above 0." },
          refs: { type: "array", items: { type: "string" }, description: "Ids cited: nodes, journal events, findings." },
          model: { type: "string", description: "The model you are, when you know." },
          run: { type: "string", description: "The audit or session this score belongs to." },
          commit: { type: "string" },
          matrix: { type: "string", description: `Default: ${VALUE_MATRIX_ID}.` },
        },
        required: ["subject", "criterion", "level", "confidence"],
        additionalProperties: false,
      },
    },
    async (args) => {
      const subject = requireString(args, "subject");
      const criterion = requireString(args, "criterion");
      const level = requireInt(args, "level", -3, 3);
      const confidence = requireInt(args, "confidence", 0, 3);
      const evidence = optionalString(args, "evidence");
      if (confidence > 0 && evidence === undefined) {
        throw new ToolError("`evidence` is required above confidence 0 — a score without a citation is an opinion, not an assessment. Say what you read, or score at confidence 0.");
      }
      const refs = Array.isArray(args.refs) ? (args.refs as unknown[]).filter((ref): ref is string => typeof ref === "string" && ref !== "") : undefined;
      const input: WeighingEventInput = {
        type: WEIGHING_ASSESSMENT_RECORDED,
        subject,
        criterion,
        level,
        confidence,
        ...(optionalString(args, "matrix") !== undefined ? { matrix: optionalString(args, "matrix") as string } : {}),
        ...(evidence !== undefined ? { evidence } : {}),
        ...(refs !== undefined && refs.length > 0 ? { refs } : {}),
        ...(optionalString(args, "model") !== undefined ? { model: optionalString(args, "model") as string } : {}),
        ...(optionalString(args, "run") !== undefined ? { run: optionalString(args, "run") as string } : {}),
        ...(optionalString(args, "commit") !== undefined ? { commit: optionalString(args, "commit") as string } : {}),
      };

      const graph = await load();
      const section = sectionOf(graph);
      const nodes = graph.nodes as Node[];

      // What the cell reads before this write, so the reply can say whose level stands.
      const view = buildWeighingContext(section, input.matrix);
      const node = nodes.find((candidate) => candidate.id === subject);
      const before = view !== undefined && node !== undefined ? weighPromise(node, view).cells.find((cell) => cell.criterion === criterion) : undefined;

      const notes: string[] = [];
      if (before?.source === "stored" && before.scorer.kind === "human") {
        notes.push("A human's level already stands for this cell and keeps winning — yours is recorded beside it" + (Math.abs(before.level - level) >= 2 ? ", and the cell now sits on the review list (you differ by 2 or more)." : "."));
      }
      const anchor = view === undefined ? undefined : weighingScaleOf(view.set).anchors[String(level)];

      if (ctx.qualityRoot === undefined) {
        const events = await appendHosted([input]);
        const recorded = events.find((event) => event.type === WEIGHING_ASSESSMENT_RECORDED);
        return { assessment: recorded, ...(anchor !== undefined ? { anchor } : {}), events, ...(notes.length > 0 ? { notes } : {}) };
      }

      const plan = planWeighingEvents(section, nodes, [input], { actor: MCP_ACTOR, scorerKind: "agent", ...(onBehalfOf !== undefined ? { onBehalfOf } : {}) });
      if (!plan.ok) throw new ToolError(`Assessment refused — ${plan.refusals.map((r) => `${r.reason}: ${r.detail}`).join("; ")}`, { refusals: plan.refusals });
      const row = plan.assessments[0];
      let replaced: WeighingAssessment | undefined;
      try {
        const next = upsertWeighingAssessment(loadMatrixAssessments(ctx.qualityRoot, row.matrix), row);
        replaced = next.replaced;
        saveWeighingAssessments(ctx.qualityRoot, row.matrix, next.assessments);
      } catch (error) {
        throw new ToolError((error as Error).message);
      }
      return {
        assessment: row,
        file: weighingAssessmentsPath(ctx.qualityRoot, row.matrix),
        ...(replaced !== undefined ? { replaced_level: replaced.level } : {}),
        ...(anchor !== undefined ? { anchor } : {}),
        ...(notes.length > 0 ? { notes } : {}),
      };
    },
  );
```

- [ ] **Step 2: Run the suite**

Run: `npm run test:mcp`
Expected: the `assess` refusals, the stamped scorer and basis, the sidecar upsert, replacement, staleness, the human-beats-agent note and the filters `PASS:`; the run then fails at `save_positioning` (`TypeError … reading 'status'` — not registered yet).

### Task 4.5: `save_positioning`

**Files:**
- Modify: `packages/mcp/src/weighing-tools.ts`

- [ ] **Step 1: Insert `save_positioning`** immediately above `  return { tools, handlers };`

```ts
  tool(
    {
      name: "save_positioning",
      description:
        "Write the product's positioning: the elements of value it stands on, each with a weight and, optionally, what each level means IN THE PRODUCT'S OWN WORDS (e.g. for reduces-anxiety: \"3 removes a worry the user names; 0 has nothing to do with worry\"). A positioning is a criteria set: a scorer — you, or another — reads those descriptions to judge a promise, and the weights make get_matrix's `positioned` figures. It REPLACES the previous positioning whole. `status` defaults to draft, and a draft feeds no roll-up: draft one from the landing page, the decisions or a brainstorm, and leave it for a person to read and save as active — you may activate it, but a positioning is a statement of intent, so say what you drafted it from. In a repository it writes docs/weighing/sets/positioning.json; on a hosted project it records weighing.set.saved.",
      inputSchema: {
        type: "object",
        properties: {
          elements: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              properties: {
                id: { type: "string", description: "A value element id." },
                weight: { type: "number", exclusiveMinimum: 0, description: "How much the product stands on it. Default 1." },
                anchors: { type: "object", additionalProperties: { type: "string" }, description: 'Level -> description in the product\'s words, keyed by the level as a string ("3", "0", "-3").' },
              },
              required: ["id"],
              additionalProperties: false,
            },
          },
          status: { type: "string", enum: ["draft", "active"], description: "Default: draft." },
          title: { type: "string" },
        },
        required: ["elements"],
        additionalProperties: false,
      },
    },
    async (args) => {
      if (!Array.isArray(args.elements) || args.elements.length === 0) throw new ToolError("`elements` is required: at least one element of value.");
      const status = optionalString(args, "status") ?? "draft";
      if (status !== "draft" && status !== "active") throw new ToolError("`status` must be draft or active.");

      const graph = await load();
      const section = sectionOf(graph);
      const ruler = buildWeighingContext(section)?.set;
      if (ruler === undefined) throw new ToolError(`The built-in set "${VALUE_SET_ID}" is not available.`);

      const set: WeighingCriteriaSet = {
        id: POSITIONING_SET_ID,
        version: "1.0.0",
        title: optionalString(args, "title") ?? "Positioning",
        subject: ruler.subject,
        scale: weighingScaleOf(ruler),
        role: "positioning",
        status,
        extends: `${ruler.id}@${ruler.version.split(".")[0]}`,
        criteria: (args.elements as Record<string, unknown>[]).map((entry) => ({
          id: String(entry.id),
          ...(typeof entry.weight === "number" ? { weight: entry.weight } : {}),
          ...(typeof entry.anchors === "object" && entry.anchors !== null ? { anchors: entry.anchors as Record<string, string> } : {}),
        })),
      };
      const input: WeighingEventInput = { type: WEIGHING_SET_SAVED, set };

      const notes = status === "draft" ? ["Saved as a draft: it feeds no roll-up until it is saved as active."] : [];
      if (ctx.qualityRoot === undefined) {
        const events = await appendHosted([input]);
        return { positioning: set, events, ...(notes.length > 0 ? { notes } : {}) };
      }
      const plan = planWeighingEvents(section, graph.nodes as Node[], [input], { actor: MCP_ACTOR, scorerKind: "agent" });
      if (!plan.ok) throw new ToolError(`Positioning refused — ${plan.refusals.map((r) => `${r.reason}: ${r.detail}`).join("; ")}`, { refusals: plan.refusals });
      try {
        saveWeighingSet(ctx.qualityRoot, set);
      } catch (error) {
        throw new ToolError((error as Error).message);
      }
      return { positioning: set, file: weighingSetPath(ctx.qualityRoot, set.id), ...(notes.length > 0 ? { notes } : {}) };
    },
  );
```

- [ ] **Step 2: Run the suite**

Run: `npm run test:mcp`
Expected: every suite green — `tools/list exposes the 33-tool catalog`, `All MCP server tests passed`, `All MCP journal-baseline tests passed`, `All remote-store checks passed.`, `All MCP version checks passed.`, `All Kritik MCP tests passed`, `All weighing tool tests passed.` (66 `PASS:` lines).

- [ ] **Step 3: Lint and type-check**

Run: `npx tsc --noEmit -p . && npx eslint packages/mcp/src`
Expected: silent.

- [ ] **Step 4: Commit**

```bash
git add packages/mcp/src/weighing-tools.ts packages/mcp/src/tools.ts tests/mcp/weighing-tools.test.js tests/mcp/run-mcp-tests.js package.json
git commit -m "feat(weighing): get_matrix, assess and save_positioning over MCP (part 4/5)"
```

### Task 4.6: Version, docs, gate

**Files:**
- Modify: `packages/mcp/package.json`, `package-lock.json`, `docs/spec/mcp.md`

- [ ] **Step 1: Bump the server** (its tool catalog grew; the owner publishes by hand)

In `packages/mcp/package.json` set `"version": "0.11.0"`; in `package-lock.json` change the `"packages/mcp"` entry's `"version": "0.10.0"` to `"0.11.0"`. `tests/mcp/version.test.js` reads the built server's announced version.

- [ ] **Step 2: `docs/spec/mcp.md`**

Immediately **before** `## Write Path (dual-write, validator-gated)` insert:

````markdown
### Weighing tools

Three tools read and write the weighing layer ([docs/rfcs/weighing.md](../rfcs/weighing.md), [bundle-format.md](bundle-format.md) § Weighing). They mirror `kritik_matrix` and `kritik_score`, and the write goes through the same validator-gated gate the app's form uses (`planWeighingEvents` in `@arkaik/schema`): an unknown element, a level off the −3..+3 scale or a subject that is not an acceptance is refused with the reason.

| Tool | Input | Returns | Journal events |
|---|---|---|---|
| `get_matrix` | `matrix?`, `subject?`, `sort?` (`served` \| `cost` \| `positioned` \| `title`), `filter?` (`flagged` \| `stale` \| `review` \| `unassessed`), `limit?` | The value matrix. Per promise: `served` (Σ positive levels ÷ 3) and `cost` (Σ\|negative levels\| ÷ 3) — **never netted** —, `positioned` (the same over the elements an *active* positioning stands on, each × its weight; `null` for none or a draft), `kept_share`, `guesswork` (the share resting on confidence-0 cells), `flags` (`claim_not_supported`, `unclaimed_value`, `unclaimed_cost`), `stale` and `review`. A cell nobody scored reads at a **seeded** level (first claimed value +3, second +2, the rest +1; scorer `rule`, confidence 0; negatives never) — a guess, never a score — and `notes` says when everything is one. A human's level beats an agent's beats a seed. With `subject`: that promise's every cell with scorer, confidence, evidence and `others`, plus the scale's and the confidence's anchors. Without: the promises plus per-element promised / kept / cost masses and totals | — |
| `assess` | `subject`, `criterion`, `level`, `confidence`, `evidence?`, `refs?`, `model?`, `run?`, `commit?`, `matrix?` | The stamped assessment (scorer `agent`, the set's version, the subject's fingerprint). `evidence` is required above confidence 0. Re-scoring replaces in place (`replaced_level`). `notes` says when a human's level already stands for the cell and the agent's sits beside it. There is deliberately **no scorer argument** — a human's level wins every cell, so a caller must not be able to claim to be one | repo: none (`docs/weighing/assessments/<matrix>.json` is the record); hosted: `weighing.assessment.recorded` |
| `save_positioning` | `elements` (`[{ id, weight?, anchors? }]`), `status?` (default `draft`), `title?` | The positioning — a criteria set naming the elements the product stands on, each with a weight and, optionally, what each level means in the product's own words. Replaces the previous one whole. A **draft feeds no roll-up**; draft one from the landing page or a brainstorm and leave it for a person to read | repo: none (`docs/weighing/sets/positioning.json`); hosted: `weighing.set.saved` |

**Repo and hosted behave alike.** In a repo the sidecars under `docs/weighing/` are read fresh and written by the tool; hosted, the server's folded section is the read and the events are the write, and nothing lands on disk. The hosted route stamps the scorer from the token (`agent`) and refuses a body that carries one.
````

In the same file, change the `### Quality tools (Kritik)` neighbour nothing else; and wherever the doc states the tool total (search for "16 graph" / "30"), update to include the three weighing tools (the suite's catalog assertion is now 33).

- [ ] **Step 3: Gate**

Run: `npm run generate && git status --short` (expected: no artifact changes), `npm run lint`, `npx tsc --noEmit -p .`, `npm run build`, `npm run validate:seeds`, `npm run test:fixtures`, `npm run test:schema`, `npm run test:weighing && npm run test:weighing-derive && npm run test:weighing-events && npm run test:weighing-provider`, `npm run test:cli`, `npm run test:mcp`, `npm run test:docs-visibility`.
Expected: all exit 0.

- [ ] **Step 4: Commit and submit**

```bash
git add packages/mcp/package.json package-lock.json docs/spec/mcp.md
git commit -m "chore(weighing): arkaik-mcp 0.11.0 and the weighing tools in the MCP spec (part 4/5)"
gh stack submit --auto
```

---

## Part 5 — `weighing/5-panel`

**Goal.** A person can weigh a promise: open an acceptance, see what it serves and costs, and score each element of value from −3 to +3 with a confidence and evidence; and write the product's positioning in Settings. This is the part a user sees, so it carries the Lab Note.

**Must not touch:** any schema, CLI, MCP or route file (navigate down for a fix), `app/m3/*.css` and any visual design — **this is a functional baseline, markup kept simple and data-hooked, so the look can be explored afterwards in the tweaker (skill `redesigning-with-tweaks`).** No new colours, no new motion, no custom controls: `PanelGroup`, `PanelSection`, `SegmentedControl`, `Textarea`, `Badge`, `Button` as they are.

**Reference precedent:** `components/panels/PanelGroup.tsx` / `PanelSection.tsx` (the collapsible sections), `components/panels/AcceptancePlatformsSection.tsx` (an acceptance-only group), `components/quality/LevelMeter.tsx` (Kritik's level control, 0–4 and read-only — the signed scale needs an input, so the baseline reuses `SegmentedControl`), `components/settings/ProductManagerPanel.tsx` (a Settings section), `lib/hooks/useProject.ts` and `lib/data/project-queries.ts` (`invalidateProject`).

**Why the positioning editor is in Settings, not on the Pyramid** (D9): Settings is where this app keeps everything that *configures* a project (Products live there for the same reason); a positioning is a statement of intent, not a reading; the Pyramid is a derived page the next design pass will reshape, and an editor should not move with it. The Pyramid stays a place that shows what the product is.

**Behaviour the form owns** (read the source comment in `WeighingGroup.tsx`; `tests/app/weighing-panel.test.js` pins it):

1. Claimed elements first, in claim order; then every other element somebody scored; the rest behind "Add an element". Adding opens a *blank* row — nothing is written until a level is chosen.
2. A cell nobody scored reads at its **seeded** level and says "Guess, from the order of the claimed values". Choosing a level writes the first human assessment (default confidence **1**, "inferred from the promise's own text" — nobody picking a level on a form means "I guessed").
3. Each cell shows the effective level, its scorer, a **stale** badge (the promise changed since), a **review** badge (a person and an agent differ by 2+), and the other scorer's level in `others`.
4. Above the list: serves, costs (never netted), "of what we stand on" (only with an *active* positioning), kept, and the share resting on guesses; plus the three claim flags.
5. One write = one `weighing.assessment.recorded` through `useWeighing().record`; a refusal is a toast; the list re-reads either way. The form never sends a scorer.
6. Without a save path (`onUpdate` absent) it is read-only.

### Task 5.1: The failing contract test and the order helper's test

**Files:**
- Create: `tests/app/weighing-panel.test.js`, `tests/app/value-order.test.js`
- Modify: `package.json`, `.gitignore`

- [ ] **Step 1: Write the source-asserting test**

A file that does not exist yet reads as empty, so each missing piece is a `FAIL`, not a crash.

```js
#!/usr/bin/env node

/**
 * The weighing UI's contract (docs/rfcs/weighing.md), read off the SOURCE —
 * the idiom tests/app/panel-semantics.test.js uses, for the same reason: the
 * panel is a client component wired to hooks and refs, and standing a React
 * runtime up would test the stubs as much as the markup.
 *
 * What is pinned is what a later design pass (skill `redesigning-with-tweaks`)
 * must not break while it reshapes the look:
 *  - the form is built from `PanelGroup` + `PanelSection`, never a bare heading
 *    (the panel stack's outline is asserted elsewhere and this must not undo it);
 *  - every part carries a `data-weighing-*` hook, so a stylesheet has something
 *    to hold on to;
 *  - the numbers come from `@arkaik/schema`'s derivation, never recomputed here;
 *  - the form never sends a scorer: provenance is stamped by the writer, so a
 *    person cannot be recorded as an agent or the reverse;
 *  - the group is mounted for acceptances only, read-only without a save path;
 *  - the positioning editor saves a DRAFT by default and activates only on its
 *    own button; and the hook invalidates the project after a write.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
/** A file that does not exist yet reads as empty, so a missing piece is a FAIL, not a crash. */
const read = (...parts) => {
  try {
    return fs.readFileSync(path.join(ROOT, ...parts), "utf8");
  } catch {
    return "";
  }
};

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`PASS: ${name}`);
  else {
    failures++;
    console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const group = read("components", "panels", "WeighingGroup.tsx");
const positioning = read("components", "settings", "PositioningPanel.tsx");
const hook = read("lib", "hooks", "useWeighing.ts");
const detail = read("components", "panels", "NodeDetailPanel.tsx");
const settings = read("app", "project", "[id]", "settings", "page.tsx");
const describe = read("components", "journal", "describe-event.ts");

// --- the acceptance-panel form ------------------------------------------------
check("the form is a PanelGroup with PanelSections", /<PanelGroup\b/.test(group) && /<PanelSection\b/.test(group));
check("the form renders no bare heading — the panel stack owns the outline", !/<h[1-6][\s>]/.test(group));
for (const hookName of ["data-weighing", "data-weighing-element", "data-weighing-served", "data-weighing-cost", "data-weighing-kept", "data-weighing-guesswork", "data-weighing-scorer", "data-weighing-stale", "data-weighing-review", "data-weighing-flags", "data-weighing-add"]) {
  check(`the form carries ${hookName}`, group.includes(hookName));
}
check("the numbers come from the schema's derivation", /buildWeighingContext/.test(group) && /weighPromise/.test(group) && /from "@arkaik\/schema"/.test(group));
check("the form never sends a scorer — the writer stamps it", !/\bscorer\s*:\s*\{/.test(group) && !/\bbasis\s*:/.test(group));
check("a write is one weighing.assessment.recorded through record()", /WEIGHING_ASSESSMENT_RECORDED/.test(group) && /await record\(\[input\]\)/.test(group));
check("a refused write is a toast, and the list re-reads either way", /toast\.error/.test(group) && /finally/.test(group));
check("a first human score defaults to confidence 1, never a silent guess", /mine\?\.confidence \?\? 1/.test(group));
check("a person never inherits an agent's evidence", /cell\?\.source === "stored" && cell\.scorer\.kind === "human"/.test(group));
check("the claimed elements are listed first, then 'Add an element'", /Add an element/.test(group) && /claimed/.test(group));
check("a read-only panel offers no controls", /readOnly/.test(group) && /data-weighing-readonly/.test(group));

// --- where it is mounted --------------------------------------------------------
check("NodeDetailPanel mounts the group for acceptances only", /node\.species === "acceptance" && <WeighingGroup/.test(detail));
check("…read-only without a save path", /<WeighingGroup[^>]*readOnly=\{!onUpdate\}/.test(detail));
check("…keyed per record, like its siblings", /<WeighingGroup key=\{`weighing-\$\{node\.id\}`\}/.test(detail));

// --- the hook ----------------------------------------------------------------------
check("useWeighing writes through the provider's appendWeighingEvents", /appendWeighingEvents/.test(hook));
check("…and invalidates the project so a caller reads its own write", /invalidateProject\(projectId\)/.test(hook));
check("…and refuses with a reason when the provider cannot", /cannot record assessments/.test(hook));

// --- the positioning editor ------------------------------------------------------------
check("the editor saves a weighing.set.saved", /WEIGHING_SET_SAVED/.test(positioning));
check("it has a draft button and an activate button", /Save as draft/.test(positioning) && /Save and activate/.test(positioning));
check("the draft button saves a draft; only the other activates", /save\("draft"\)/.test(positioning) && /save\("active"\)/.test(positioning));
check("it says a draft weighs nothing", /feeds no weight until/.test(positioning));
check("it carries data hooks", ["data-positioning", "data-positioning-element", "data-positioning-draft"].every((h) => positioning.includes(h)));
check("Settings mounts it, in the project's own words", /<PositioningPanel projectId=\{id\}/.test(settings) && /<h2 className="text-lg font-semibold">Positioning<\/h2>/.test(settings));

// --- History ----------------------------------------------------------------------------
check("History words both weighing events instead of printing a raw type", /case "weighing\.assessment\.recorded"/.test(describe) && /case "weighing\.set\.saved"/.test(describe));

if (failures > 0) {
  console.log(`\n${failures} weighing-panel test(s) failed.`);
  process.exit(1);
}
console.log("\nAll weighing-panel tests passed.");
```

- [ ] **Step 2: Write the order helper's test**

```js
#!/usr/bin/env node

/**
 * The order of `metadata.values` is a claim (lib/utils/value-order.ts): the
 * weighing layer seeds the first value at +3 and the second at +2, so the value
 * picker must keep the order the author picked them in.
 *
 * Loads the one-file util with `ts.transpileModule` — it imports nothing.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, ".test-build-value-order");

fs.rmSync(BUILD_DIR, { recursive: true, force: true });
fs.mkdirSync(BUILD_DIR, { recursive: true });
fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));
const source = fs.readFileSync(path.join(ROOT, "lib", "utils", "value-order.ts"), "utf8");
const { outputText } = ts.transpileModule(source, {
  fileName: "value-order.ts",
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
});
fs.writeFileSync(path.join(BUILD_DIR, "value-order.js"), outputText);
const { keepClaimOrder } = require(path.join(BUILD_DIR, "value-order.js"));

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`PASS: ${name}`);
  else {
    failures++;
    console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// The model's canonical order puts `saves-time` (functional) before `nostalgia` (emotional).
const CANON = ["saves-time", "connects", "reduces-anxiety", "nostalgia"];

check("a first pick is the list", eq(keepClaimOrder([], new Set(["nostalgia"]), CANON), ["nostalgia"]));
check("a second pick goes LAST, even when the model files it earlier", eq(keepClaimOrder(["nostalgia"], new Set(["nostalgia", "saves-time"]), CANON), ["nostalgia", "saves-time"]));
check("removing the first promotes the second", eq(keepClaimOrder(["nostalgia", "saves-time"], new Set(["saves-time"]), CANON), ["saves-time"]));
check("the rest keep their places when one in the middle leaves", eq(keepClaimOrder(["connects", "nostalgia", "saves-time"], new Set(["connects", "saves-time"]), CANON), ["connects", "saves-time"]));
check("several added at once take the model's order, after what was there", eq(keepClaimOrder(["nostalgia"], new Set(["nostalgia", "reduces-anxiety", "saves-time"]), CANON), ["nostalgia", "saves-time", "reduces-anxiety"]));
check("nothing changed is the same list", eq(keepClaimOrder(["connects", "saves-time"], new Set(["connects", "saves-time"]), CANON), ["connects", "saves-time"]));
check("it does not mutate its input", (() => { const input = ["nostalgia"]; keepClaimOrder(input, new Set(["nostalgia", "connects"]), CANON); return eq(input, ["nostalgia"]); })());

fs.rmSync(BUILD_DIR, { recursive: true, force: true });
if (failures > 0) {
  console.log(`\n${failures} value-order test(s) failed.`);
  process.exit(1);
}
console.log("\nAll value-order tests passed.");
```

- [ ] **Step 3: Scripts and ignore line**

In `package.json`, after `"test:weighing-provider"` add:

```json
    "test:weighing-panel": "node tests/app/weighing-panel.test.js",
    "test:value-order": "node tests/app/value-order.test.js",
```

In `.gitignore`, after `/tests/app/.test-build-arkademy/` add `/tests/app/.test-build-value-order/`.

- [ ] **Step 4: Run both to verify they fail**

Run: `npm run test:weighing-panel; npm run test:value-order`
Expected: `weighing-panel` prints a `FAIL:` for every check (none of the files exist) and `1x weighing-panel test(s) failed.`; `value-order` fails with `ENOENT … lib/utils/value-order.ts`.

### Task 5.2: `useWeighing`

**Files:**
- Create: `lib/hooks/useWeighing.ts`

- [ ] **Step 1: Write the hook**

```ts
"use client";

import { useCallback } from "react";
import type { WeighingEventInput, WeighingSection } from "@arkaik/schema";

import { invalidateProject } from "@/lib/data/project-queries";
import { getProvider } from "@/lib/data/provider-registry";
import { useProject } from "@/lib/hooks/useProject";

/**
 * The project's weighing section (docs/rfcs/weighing.md) and the one way to
 * write to it.
 *
 * The section is read off the project bundle the query cache already holds —
 * on a hosted project the server folded its events in, on a browser project
 * the local provider did — so reading costs nothing extra and every surface
 * that asks sees the same section.
 *
 * `record` sends one batch through the provider's `appendWeighingEvents`: the
 * schema's `planWeighingEvents` gate, a person stamped as the scorer, the
 * journal grown and the snapshot untouched. It resolves once the project has
 * been marked stale and refetched, so a caller that awaits it reads its own
 * write. It rejects with the gate's reasons (`unknown_criterion: …`) when
 * the batch is refused — all of it, or none — and the caller says so.
 */
export function useWeighing(projectId: string) {
  const { project } = useProject(projectId);
  const section: WeighingSection | undefined = project?.weighing;

  const record = useCallback(
    async (inputs: readonly WeighingEventInput[]) => {
      const provider = getProvider();
      if (!provider.appendWeighingEvents) throw new Error("This project cannot record assessments.");
      await provider.appendWeighingEvents(projectId, inputs);
      await invalidateProject(projectId);
    },
    [projectId],
  );

  return { section, record };
}
```

- [ ] **Step 2: Run the contract test**

Run: `npm run test:weighing-panel`
Expected: the three `useWeighing …` checks now `PASS:`; the rest still `FAIL:`.

- [ ] **Step 3: Commit**

```bash
git add tests/app/weighing-panel.test.js tests/app/value-order.test.js package.json .gitignore lib/hooks/useWeighing.ts
git commit -m "feat(weighing): useWeighing, and the contract the panel must keep (part 5/5)"
```

### Task 5.3: The acceptance-panel form

**Files:**
- Create: `components/panels/WeighingGroup.tsx`
- Modify: `components/panels/NodeDetailPanel.tsx`

- [ ] **Step 1: Write the group**

```tsx
"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  CONFIDENCE_ANCHORS,
  CONFIDENCE_LEVELS,
  WEIGHING_ASSESSMENT_RECORDED,
  WEIGHING_LEVELS,
  buildWeighingContext,
  weighPromise,
  type EffectiveCell,
  type WeighingCriterion,
  type WeighingEventInput,
} from "@arkaik/schema";

import { PanelGroup } from "@/components/panels/PanelGroup";
import { PanelSection } from "@/components/panels/PanelSection";
import { Badge } from "@/components/ui/badge";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Textarea } from "@/components/ui/textarea";
import type { Node } from "@/lib/data/types";
import { useProjectId } from "@/lib/hooks/useProjectId";
import { useWeighing } from "@/lib/hooks/useWeighing";

/**
 * An acceptance's weight: a signed level (−3 to +3) for each element of value it
 * touches, how sure the scorer is, and why — with what that adds up to
 * (docs/rfcs/weighing.md).
 *
 * **A functional baseline, not a design.** The markup is plain and every part
 * carries a `data-weighing-*` hook, so the look can be explored afterwards
 * (skill `redesigning-with-tweaks`) without touching what it says. What this
 * file owns is the behaviour:
 *
 * - The elements the author *claimed* come first, in claim order, then every
 *   other element somebody has scored; the rest wait behind "Add an element".
 * - A cell nobody has scored reads at its **seeded** level and says so: a guess
 *   from the order of `values`, never a score. Choosing a level writes the
 *   first human assessment and replaces the guess — at confidence 1 ("inferred
 *   from the promise's own text") unless a person says otherwise, because
 *   nobody picking a level on a form means "I guessed".
 * - A cell shows its **effective** level, who scored it, whether it has gone
 *   **stale** (the promise's title, Gherkin or values changed since), and — when
 *   a human and an agent disagree by two or more — that it wants a review. A
 *   human's level wins; an agent's rides beside it.
 * - **Served and cost** sit above the list, never netted, with the share that
 *   rests on guesses.
 *
 * Every write is one `weighing.assessment.recorded` through `useWeighing`'s
 * `record` — the same gate an agent's `assess` goes through. A refused write
 * (the gate's reasons) is a toast, and the list re-reads either way, so the
 * controls never show a level the journal does not hold.
 */

interface WeighingGroupProps {
  node: Node;
  /** No save path: show the weight, offer no controls. */
  readOnly?: boolean;
}

const LEVEL_OPTIONS = WEIGHING_LEVELS.map((level) => ({ id: String(level), label: level > 0 ? `+${level}` : level < 0 ? `−${-level}` : "0" }));
const CONFIDENCE_OPTIONS = CONFIDENCE_LEVELS.map((level) => ({ id: String(level), label: String(level) }));

const pct = (share: number) => `${Math.round(share * 100)}%`;
const num = (value: number) => (Math.round(value * 100) / 100).toFixed(2);

function scorerLabel(cell: EffectiveCell): string {
  if (cell.source === "seed") return "Guess, from the order of the claimed values";
  const model = typeof cell.scorer.model === "string" ? ` (${cell.scorer.model})` : "";
  return `${cell.scorer.kind === "human" ? "A person" : "An agent"}: ${cell.scorer.id}${model}`;
}

export function WeighingGroup({ node, readOnly = false }: WeighingGroupProps) {
  const projectId = useProjectId();
  const { section, record } = useWeighing(projectId);
  const ctx = useMemo(() => buildWeighingContext(section), [section]);
  const weighed = useMemo(() => (ctx === undefined ? undefined : weighPromise(node, ctx)), [ctx, node]);
  // Elements the person has opened a blank row for; nothing is written until a level is chosen.
  const [extra, setExtra] = useState<string[]>([]);
  const [pending, setPending] = useState<string | null>(null);

  if (ctx === undefined || weighed === undefined) return null;

  const names = new Map(ctx.set.criteria.map((criterion) => [criterion.id, criterion] as const));
  const shown = new Set(weighed.cells.map((cell) => cell.criterion));
  const blank = extra.filter((id) => !shown.has(id));
  const addable = ctx.set.criteria.filter((criterion) => !shown.has(criterion.id) && !extra.includes(criterion.id));

  async function save(criterion: string, cell: EffectiveCell | undefined, patch: { level?: number; confidence?: number; evidence?: string }) {
    // What a person has already said about this cell — never an agent's evidence, which is not theirs to inherit.
    const mine = cell?.source === "stored" && cell.scorer.kind === "human" ? cell : undefined;
    const level = patch.level ?? cell?.level;
    if (level === undefined) return;
    const evidence = patch.evidence ?? mine?.evidence;
    const input: WeighingEventInput = {
      type: WEIGHING_ASSESSMENT_RECORDED,
      subject: node.id,
      criterion,
      level,
      confidence: patch.confidence ?? mine?.confidence ?? 1,
      ...(evidence !== undefined && evidence.trim() !== "" ? { evidence } : {}),
    };
    setPending(criterion);
    try {
      await record([input]);
      setExtra((current) => current.filter((id) => id !== criterion));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not record that assessment.");
    } finally {
      setPending(null);
    }
  }

  const rows: { criterion: WeighingCriterion; cell: EffectiveCell | undefined }[] = [
    ...weighed.cells.map((cell) => ({ criterion: names.get(cell.criterion) ?? { id: cell.criterion }, cell })),
    ...blank.map((id) => ({ criterion: names.get(id) ?? { id }, cell: undefined })),
  ];

  const flagged = [
    ["Claim not supported", weighed.flags.claim_not_supported],
    ["Unclaimed value", weighed.flags.unclaimed_value],
    ["Unclaimed cost", weighed.flags.unclaimed_cost],
  ] as const;

  return (
    <PanelGroup
      title="Value"
      meta={
        <span data-weighing-meta>
          serves {num(weighed.served)} · costs {num(weighed.cost)}
        </span>
      }
    >
      <div data-weighing data-weighing-subject={node.id} className="flex flex-col gap-4">
        <PanelSection title="What it adds up to">
          <dl data-weighing-figures className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Serves</dt>
            <dd data-weighing-served>{num(weighed.served)}</dd>
            <dt className="text-muted-foreground">Costs</dt>
            <dd data-weighing-cost>{num(weighed.cost)}</dd>
            {weighed.positioned !== null && (
              <>
                <dt className="text-muted-foreground">Of what we stand on</dt>
                <dd data-weighing-positioned>
                  serves {num(weighed.positioned.served)} · costs {num(weighed.positioned.cost)}
                </dd>
              </>
            )}
            <dt className="text-muted-foreground">Kept</dt>
            <dd data-weighing-kept>{weighed.kept_share === null ? "applies to no platform" : pct(weighed.kept_share)}</dd>
            <dt className="text-muted-foreground">Resting on guesses</dt>
            <dd data-weighing-guesswork>
              {pct(weighed.guesswork.served)} of what it serves{weighed.cost > 0 ? `, ${pct(weighed.guesswork.cost)} of what it costs` : ""}
            </dd>
          </dl>
          {ctx.positioningSet !== undefined && ctx.positioning === null && (
            <p data-weighing-draft className="text-xs text-muted-foreground">
              The positioning is a draft, so nothing is weighed against it yet.
            </p>
          )}
          {flagged.some(([, ids]) => ids.length > 0) && (
            <ul data-weighing-flags className="flex flex-col gap-1 text-xs">
              {flagged.map(([label, ids]) =>
                ids.length === 0 ? null : (
                  <li key={label} data-weighing-flag={label}>
                    <span className="font-medium">{label}:</span> {ids.map((id) => names.get(id)?.name ?? id).join(", ")}
                  </li>
                ),
              )}
            </ul>
          )}
        </PanelSection>

        <PanelSection title="Elements of value">
          {rows.length === 0 ? (
            <p data-weighing-empty className="text-sm text-muted-foreground">
              This promise claims no value and nobody has scored one. Add the first element below.
            </p>
          ) : (
            <ul className="flex flex-col gap-4">
              {rows.map(({ criterion, cell }) => (
                <li
                  key={criterion.id}
                  data-weighing-element={criterion.id}
                  data-source={cell?.source ?? "blank"}
                  data-level={cell?.level ?? ""}
                  data-stale={cell?.stale ? "true" : "false"}
                  className="flex flex-col gap-2"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{criterion.name ?? criterion.id}</span>
                    {cell?.claimed && <Badge variant="outline">claimed</Badge>}
                    {cell?.stale && (
                      <Badge data-weighing-stale variant="secondary">
                        stale: the promise changed since this was scored
                      </Badge>
                    )}
                    {cell?.review && (
                      <Badge data-weighing-review variant="secondary">
                        a person and an agent differ: review
                      </Badge>
                    )}
                  </div>
                  {cell !== undefined && (
                    <p data-weighing-scorer className="text-xs text-muted-foreground">
                      {scorerLabel(cell)}, confidence {cell.confidence}
                    </p>
                  )}
                  {readOnly ? (
                    <p data-weighing-readonly className="text-sm">
                      {cell === undefined ? "Not scored" : `Level ${cell.level > 0 ? "+" : ""}${cell.level}`}
                    </p>
                  ) : (
                    <>
                      <SegmentedControl
                        ariaLabel={`${criterion.name ?? criterion.id}: level`}
                        options={LEVEL_OPTIONS}
                        value={cell === undefined ? "" : String(cell.level)}
                        onChange={(value) => void save(criterion.id, cell, { level: Number(value) })}
                      />
                      <SegmentedControl
                        ariaLabel={`${criterion.name ?? criterion.id}: confidence`}
                        options={CONFIDENCE_OPTIONS}
                        value={cell === undefined ? "" : String(cell.confidence)}
                        onChange={(value) => void save(criterion.id, cell, { confidence: Number(value) })}
                      />
                      <p className="text-xs text-muted-foreground">
                        {cell === undefined ? "Choose a level to score this element." : CONFIDENCE_ANCHORS[cell.confidence]}
                      </p>
                      <Textarea
                        // Re-mounts when the stored evidence changes, so an agent's refresh or this person's own save shows.
                        key={`${criterion.id}:${cell?.evidence ?? ""}`}
                        aria-label={`${criterion.name ?? criterion.id}: evidence`}
                        placeholder="Why this level? Cite what you read."
                        defaultValue={cell?.scorer.kind === "human" ? cell.evidence : undefined}
                        disabled={pending === criterion.id || cell === undefined}
                        rows={2}
                        onBlur={(event) => {
                          const next = event.currentTarget.value;
                          if (cell !== undefined && next !== (cell.scorer.kind === "human" ? (cell.evidence ?? "") : "")) {
                            void save(criterion.id, cell, { evidence: next });
                          }
                        }}
                      />
                    </>
                  )}
                  {cell !== undefined && cell.others.length > 0 && (
                    <p data-weighing-others className="text-xs text-muted-foreground">
                      {cell.others.map((row) => `${row.scorer?.kind === "agent" ? "An agent" : "A person"} reads ${row.level > 0 ? "+" : ""}${row.level} (confidence ${row.confidence})`).join("; ")}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </PanelSection>

        {!readOnly && addable.length > 0 && (
          <PanelSection title="Add an element">
            <select
              data-weighing-add
              aria-label="Add an element of value"
              className="border-input bg-transparent h-9 w-full rounded-md border px-3 text-sm"
              value=""
              onChange={(event) => {
                const id = event.currentTarget.value;
                if (id !== "") setExtra((current) => [...current, id]);
              }}
            >
              <option value="">Choose an element…</option>
              {(ctx.set.groups ?? []).map((group) => (
                <optgroup key={group.id} label={group.title}>
                  {addable
                    .filter((criterion) => criterion.group === group.id)
                    .map((criterion) => (
                      <option key={criterion.id} value={criterion.id}>
                        {criterion.name ?? criterion.id}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </PanelSection>
        )}
      </div>
    </PanelGroup>
  );
}
```

- [ ] **Step 2: Mount it beside the other acceptance groups**

```diff
--- a/components/panels/NodeDetailPanel.tsx
+++ b/components/panels/NodeDetailPanel.tsx
@@ -19,6 +19,7 @@
 import { PlaylistEditor } from "@/components/panels/PlaylistEditor";
 import { AcceptanceAuthoredFields } from "@/components/panels/AcceptanceAuthoredFields";
 import { AcceptancePlatformsSection } from "@/components/panels/AcceptancePlatformsSection";
+import { WeighingGroup } from "@/components/panels/WeighingGroup";
 import { DecisionEditor, DecisionReasoning, DecisionVerdict, useDecisionEditor } from "@/components/panels/DecisionEditor";
 import { DecisionLineage } from "@/components/panels/DecisionLineage";
 import { Shape, StatusPill, sealShapeOf } from "@/components/decisions/DecisionMarks";
@@ -1054,6 +1055,11 @@
             </div>
           </PanelGroup>
         )}
+        {/* What the promise is worth: a signed level per element of value, how
+            sure the scorer is and why, and what that adds up to. A group of its
+            own, like Platforms and Relations, and read-only without a save path
+            (docs/rfcs/weighing.md). */}
+        {node.species === "acceptance" && <WeighingGroup key={`weighing-${node.id}`} node={node} readOnly={!onUpdate} />}
         {node.species === "view" && (
           <PlatformVariantsSection
             key={`pv-${node.id}-${initialPlatform ?? ""}`}
```

- [ ] **Step 3: Run the checks that read panel source**

Run: `npm run test:weighing-panel && npm run test:panel-semantics && npm run test:project-panels && npm run test:product-scope && npm run test:platform-variants-gates && npm run test:panel-stack && npx tsc --noEmit -p . && npx eslint components/panels lib/hooks`
Expected: the form and mount checks of `weighing-panel` `PASS:` (the editor, Settings and History checks still `FAIL:`); the four existing source-asserting suites pass; `tsc` and `eslint` silent.

- [ ] **Step 3b: Note for the next person** — `WeighingGroup` keys the evidence `Textarea` on the stored evidence (`key={`${criterion.id}:${cell?.evidence ?? ""}`}`) so a refetch re-mounts it with the saved text; it autosaves on blur only when the text changed. That is a baseline, not a design: the tweaker may well want a Save button instead.

- [ ] **Step 4: Commit**

```bash
git add components/panels/WeighingGroup.tsx components/panels/NodeDetailPanel.tsx
git commit -m "feat(weighing): weigh a promise from its panel — a signed level, a confidence, evidence (part 5/5)"
```

### Task 5.4: The positioning editor in Settings

**Files:**
- Create: `components/settings/PositioningPanel.tsx`
- Modify: `app/project/[id]/settings/page.tsx`

- [ ] **Step 1: Write the panel**

```tsx
"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  POSITIONING_SET_ID,
  VALUE_SET_ID,
  WEIGHING_SET_SAVED,
  isActiveWeighingSet,
  resolveWeighing,
  weighingScaleOf,
  type WeighingCriteriaSet,
  type WeighingCriterion,
} from "@arkaik/schema";

import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Textarea } from "@/components/ui/textarea";
import { useWeighing } from "@/lib/hooks/useWeighing";

/**
 * The Positioning section of project settings: which elements of value the
 * product stands on, how much, and — in the product's own words — what each
 * level means (docs/rfcs/weighing.md).
 *
 * **Why here, and not on the Pyramid.** Settings is where this app keeps
 * everything that configures a project rather than describes it (products live
 * here for the same reason), and a positioning is a statement of intent, not a
 * reading. The Pyramid is a derived page: it should stay a place that shows what
 * the product is, and not also be where you decide what it ought to be. It is
 * also the page the next design pass reshapes, and an editor does not want to
 * move with it.
 *
 * A positioning is a criteria set: each element it lists carries a weight (1–3)
 * and, optionally, the product's wording for three levels — the top (+3), the
 * middle (0) and the bottom (−3). Those words are what a scorer that is not the
 * author (an agent, Jev.ai) reads to judge a promise, because a bare label is
 * not enough. An element that is not listed is not stood on.
 *
 * A **draft** feeds no roll-up: an agent may draft one from the landing page or
 * a brainstorm, and a person reads it and activates it here. Saving writes one
 * `weighing.set.saved` event (latest wins) through `useWeighing`'s `record`,
 * the same gate as every other write.
 */

interface RowState {
  on: boolean;
  weight: number;
  top: string;
  middle: string;
  bottom: string;
}

const WEIGHT_OPTIONS = [
  { id: "1", label: "1" },
  { id: "2", label: "2" },
  { id: "3", label: "3" },
];

function initialRows(ruler: WeighingCriteriaSet, saved: WeighingCriteriaSet | undefined): Record<string, RowState> {
  const rows: Record<string, RowState> = {};
  for (const criterion of ruler.criteria) {
    const own = saved?.criteria.find((candidate) => candidate.id === criterion.id);
    rows[criterion.id] = {
      on: own !== undefined,
      weight: typeof own?.weight === "number" ? Math.min(3, Math.max(1, Math.round(own.weight))) : 2,
      top: own?.anchors?.["3"] ?? "",
      middle: own?.anchors?.["0"] ?? "",
      bottom: own?.anchors?.["-3"] ?? "",
    };
  }
  return rows;
}

function toCriterion(id: string, row: RowState): WeighingCriterion {
  const anchors: Record<string, string> = {};
  if (row.top.trim() !== "") anchors["3"] = row.top.trim();
  if (row.middle.trim() !== "") anchors["0"] = row.middle.trim();
  if (row.bottom.trim() !== "") anchors["-3"] = row.bottom.trim();
  return { id, weight: row.weight, ...(Object.keys(anchors).length > 0 ? { anchors } : {}) };
}

export function PositioningPanel({ projectId }: { projectId: string }) {
  const { section, record } = useWeighing(projectId);
  const resolved = useMemo(() => resolveWeighing(section), [section]);
  // A saved positioning the resolver dropped as malformed would otherwise just vanish from this form.
  const malformed = resolved.skipped.some((entry) => entry.kind === "set" && (entry.id === POSITIONING_SET_ID || entry.role === "positioning"));
  const ruler = resolved.sets.find((set) => set.id === VALUE_SET_ID);
  const saved = resolved.sets.find((set) => set.id === POSITIONING_SET_ID && set.role === "positioning");

  // Keyed on the saved set's identity so a refetch after a save re-seeds the form.
  const seed = useMemo(() => (ruler === undefined ? {} : initialRows(ruler, saved)), [ruler, saved]);
  const [rows, setRows] = useState<Record<string, RowState>>(seed);
  const [seededFrom, setSeededFrom] = useState(seed);
  const [saving, setSaving] = useState(false);
  if (seed !== seededFrom) {
    setSeededFrom(seed);
    setRows(seed);
  }

  if (ruler === undefined) return null;

  const standingOn = ruler.criteria.filter((criterion) => rows[criterion.id]?.on);
  const status = saved === undefined ? "none" : isActiveWeighingSet(saved) ? "active" : "draft";

  function patch(id: string, change: Partial<RowState>) {
    setRows((current) => ({ ...current, [id]: { ...current[id], ...change } }));
  }

  async function save(next: "draft" | "active") {
    if (ruler === undefined) return;
    const set: WeighingCriteriaSet = {
      id: POSITIONING_SET_ID,
      version: "1.0.0",
      title: "Positioning",
      subject: ruler.subject,
      scale: weighingScaleOf(ruler),
      role: "positioning",
      status: next,
      extends: `${ruler.id}@${ruler.version.split(".")[0]}`,
      criteria: ruler.criteria.filter((criterion) => rows[criterion.id]?.on).map((criterion) => toCriterion(criterion.id, rows[criterion.id])),
    };
    setSaving(true);
    try {
      await record([{ type: WEIGHING_SET_SAVED, set }]);
      toast.success(next === "active" ? "Positioning saved and active." : "Positioning saved as a draft.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the positioning.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div data-positioning data-positioning-status={status} className="flex flex-col gap-4">
      {malformed && (
        <p data-positioning-malformed role="status" className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
          Your saved positioning is malformed and is ignored. Saving will replace it.
        </p>
      )}
      {status === "draft" && (
        <p data-positioning-draft className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
          This is a draft. It feeds no weight until you save it as active.
        </p>
      )}
      {(ruler.groups ?? []).map((group) => (
        <fieldset key={group.id} data-positioning-tier={group.id} className="flex flex-col gap-3">
          <legend className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{group.title}</legend>
          {ruler.criteria
            .filter((criterion) => criterion.group === group.id)
            .map((criterion) => {
              const row = rows[criterion.id];
              if (row === undefined) return null;
              return (
                <div key={criterion.id} data-positioning-element={criterion.id} data-on={row.on ? "true" : "false"} className="flex flex-col gap-2">
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input type="checkbox" checked={row.on} onChange={(event) => patch(criterion.id, { on: event.currentTarget.checked })} />
                    {criterion.name ?? criterion.id}
                    <span className="text-xs font-normal text-muted-foreground">{criterion.definition}</span>
                  </label>
                  {row.on && (
                    <div className="flex flex-col gap-2 pl-6">
                      <SegmentedControl
                        ariaLabel={`${criterion.name ?? criterion.id}: weight`}
                        options={WEIGHT_OPTIONS}
                        value={String(row.weight)}
                        onChange={(value) => patch(criterion.id, { weight: Number(value) })}
                      />
                      <Textarea
                        aria-label={`${criterion.name ?? criterion.id}: what +3 means for us`}
                        placeholder="+3 means, in our words…"
                        rows={2}
                        value={row.top}
                        onChange={(event) => patch(criterion.id, { top: event.currentTarget.value })}
                      />
                      <Textarea
                        aria-label={`${criterion.name ?? criterion.id}: what 0 means for us`}
                        placeholder="0 means, in our words…"
                        rows={2}
                        value={row.middle}
                        onChange={(event) => patch(criterion.id, { middle: event.currentTarget.value })}
                      />
                      <Textarea
                        aria-label={`${criterion.name ?? criterion.id}: what −3 means for us`}
                        placeholder="−3 means, in our words…"
                        rows={2}
                        value={row.bottom}
                        onChange={(event) => patch(criterion.id, { bottom: event.currentTarget.value })}
                      />
                    </div>
                  )}
                </div>
              );
            })}
        </fieldset>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" disabled={saving || standingOn.length === 0} onClick={() => void save("draft")}>
          Save as draft
        </Button>
        <Button type="button" disabled={saving || standingOn.length === 0} onClick={() => void save("active")}>
          {status === "active" ? "Save" : "Save and activate"}
        </Button>
        <span data-positioning-count className="text-xs text-muted-foreground">
          {standingOn.length === 0 ? "No element chosen yet." : `${standingOn.length} element${standingOn.length === 1 ? "" : "s"} stood on.`}
        </span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Mount it between Products and Display preferences**

```diff
--- a/app/project/[id]/settings/page.tsx
+++ b/app/project/[id]/settings/page.tsx
@@ -10,6 +10,7 @@
 import { PageSurface } from "@/components/layout/PageSurface";
 import { DisplayPreferencesPanel } from "@/components/settings/DisplayPreferencesPanel";
 import { FederationPanel } from "@/components/settings/FederationPanel";
+import { PositioningPanel } from "@/components/settings/PositioningPanel";
 import { ProductManagerPanel } from "@/components/settings/ProductManagerPanel";
 import { RepoLinksPanel } from "@/components/settings/RepoLinksPanel";
 import { Button } from "@/components/ui/button";
@@ -148,6 +149,17 @@
 
           <section className="flex flex-col gap-3">
             <div className="flex flex-col gap-1">
+              <h2 className="text-lg font-semibold">Positioning</h2>
+              <p className="text-sm text-muted-foreground">
+                {/* One expression, for the reason the Display preferences note gives. */}
+                {`The elements of value ${title} stands on, how much, and what each level means in your own words. A promise is weighed against these; a draft weighs nothing until you activate it.`}
+              </p>
+            </div>
+            <PositioningPanel projectId={id} />
+          </section>
+
+          <section className="flex flex-col gap-3">
+            <div className="flex flex-col gap-1">
               <h2 className="text-lg font-semibold">Display preferences</h2>
               <p className="text-sm text-muted-foreground">
                 {/* One expression rather than text around `{title}`: the JSX compiler
```

- [ ] **Step 3: Run the checks**

Run: `npm run test:weighing-panel && npx tsc --noEmit -p . && npx eslint components/settings app`
Expected: the editor and Settings checks `PASS:`; only the History check still `FAIL:`; `tsc` and `eslint` silent.

- [ ] **Step 4: Commit**

```bash
git add components/settings/PositioningPanel.tsx "app/project/[id]/settings/page.tsx"
git commit -m "feat(weighing): write the product's positioning in Settings — a draft weighs nothing (part 5/5)"
```

### Task 5.5: History says what happened

**Files:**
- Modify: `components/journal/describe-event.ts`

- [ ] **Step 1: Word the two events** (they printed their raw type before)

```diff
--- a/components/journal/describe-event.ts
+++ b/components/journal/describe-event.ts
@@ -67,6 +67,8 @@
   "quality.finding.resolved": CircleCheck,
   "quality.finding.accepted": ShieldCheck,
   "quality.signal.tripped": Radar,
+  "weighing.assessment.recorded": Scale,
+  "weighing.set.saved": Scale,
   "screenshot.recorded": ImagePlus,
   "screenshot.removed": ImageMinus,
 };
@@ -209,7 +211,21 @@
       const where = `${str(event.criterion_id) ?? "?"} on ${str(event.surface) ?? "?"}`;
       const commit = str(event.commit);
       return { icon, text: `Signal tripped: ${where}`, meta: [str(event.signal), commit ? `at ${commit.slice(0, 7)}` : undefined].filter(Boolean).join(" · ") };
+    }
+    case "weighing.assessment.recorded": {
+      const level = typeof event.level === "number" ? `${event.level > 0 ? "+" : ""}${event.level}` : "?";
+      const scorer = event.scorer as { kind?: unknown } | undefined;
+      return {
+        icon,
+        text: `${resolveTitle(event.subject, nodesById)}: ${str(event.criterion) ?? "?"} weighed ${level}`,
+        meta: [typeof scorer?.kind === "string" ? `by ${scorer.kind}` : undefined, typeof event.confidence === "number" ? `confidence ${event.confidence}` : undefined].filter(Boolean).join(" · "),
+      };
     }
+    case "weighing.set.saved": {
+      const set = event.set as { status?: unknown; criteria?: unknown[] } | undefined;
+      const count = Array.isArray(set?.criteria) ? set.criteria.length : 0;
+      return { icon, text: `Positioning saved: ${count} element${count === 1 ? "" : "s"}`, meta: set?.status === undefined || set.status === "active" ? "active" : "draft" };
+    }
     case "screenshot.recorded": {
       const platform = str(event.platform);
       const where = platform ? PLATFORM_LABELS[platform as keyof typeof PLATFORM_LABELS] ?? platform : "?";
```

- [ ] **Step 2: Run the contract test**

Run: `npm run test:weighing-panel && npx tsc --noEmit -p .`
Expected: `All weighing-panel tests passed.` — all of them.

- [ ] **Step 3: Commit**

```bash
git add components/journal/describe-event.ts
git commit -m "feat(weighing): History words weighing events (part 5/5)"
```

### Task 5.6: Keep the author's claim order (owner: keep — see D12 / R1)

The seeding rule reads the order of `metadata.values`; `ValuePicker` — the only editor — re-sorts it into the model's canonical order on every change. Without this task a seed for any app-edited acceptance reflects the tier a value sits in. It changes existing behaviour (the stored order of a *newly* edited acceptance), so it was the one task the owner might veto, and the owner decided to keep it; everything else stands without it, and seeds are flagged guesses either way.

**Files:**
- Create: `lib/utils/value-order.ts`
- Modify: `components/values/ValuePicker.tsx`

- [ ] **Step 1: The helper**

```ts
/**
 * The order of an acceptance's `metadata.values` is a claim, not decoration:
 * the first value is the one the promise is most about, and the weighing layer
 * seeds it at +3, the second at +2 and every other at +1 until somebody scores
 * them (docs/rfcs/weighing.md). The value picker used to rebuild the list in the
 * model's canonical order on every change, which made the order the model's and
 * not the author's — for any acceptance edited in the app, the seed would have
 * read the tier a value sits in instead of what the author meant.
 */

/**
 * The list after a change: what was already chosen keeps its place, a value
 * dropped from `next` leaves, and a value newly in `next` goes last — several at
 * once in the model's canonical order, which is the only order they have.
 */
export function keepClaimOrder<T extends string>(
  selected: readonly T[],
  next: ReadonlySet<T>,
  canonical: readonly T[],
): T[] {
  const already = new Set(selected);
  const kept = selected.filter((id) => next.has(id));
  const added = canonical.filter((id) => next.has(id) && !already.has(id));
  return [...kept, ...added];
}
```

- [ ] **Step 2: Use it in the picker**

```diff
--- a/components/values/ValuePicker.tsx
+++ b/components/values/ValuePicker.tsx
@@ -5,6 +5,7 @@
 
 import type { ValueId } from "@arkaik/schema";
 import { VALUES, VALUE_TIERS_CONFIG } from "@/lib/config/values";
+import { keepClaimOrder } from "@/lib/utils/value-order";
 import { VALUE_ICON_COMPONENTS } from "@/lib/config/value-icons";
 import { cn } from "@/lib/utils";
 
@@ -39,9 +40,10 @@
  * matches on the label and on the definition, and empty tiers simply do not
  * render.
  *
- * `onChange` re-derives the array from `VALUES` order rather than appending, so
- * the stored list reads in the model's canonical order no matter what order the
- * values were picked in — the behaviour the chip grid had, kept.
+ * `onChange` keeps the order the values were picked in: the first is the one the
+ * promise is most about, and the weighing layer reads it that way. (It used to
+ * re-derive the array from `VALUES` order, the chip grid's behaviour, which made
+ * that order the model's and not the author's.)
  */
 export function ValuePicker({ selected, onChange }: ValuePickerProps) {
   const rootRef = useRef<HTMLDivElement | null>(null);
@@ -127,7 +129,13 @@
   }, [open]);
 
   function commit(next: Set<ValueId>) {
-    onChange(VALUES.filter((value) => next.has(value.id)).map((value) => value.id));
+    onChange(
+      keepClaimOrder(
+        selected,
+        next,
+        VALUES.map((value) => value.id),
+      ),
+    );
   }
 
   function toggle(id: ValueId) {
```

- [ ] **Step 3: Run**

Run: `npm run test:value-order && npx tsc --noEmit -p . && npx eslint components/values lib/utils`
Expected: `All value-order tests passed.`; `tsc` and `eslint` silent.

- [ ] **Step 4: Commit**

```bash
git add lib/utils/value-order.ts components/values/ValuePicker.tsx
git commit -m "fix(values): the picker keeps the order values were chosen in — it is a claim now (part 5/5)"
```

### Task 5.7: CI steps, the manual pass, the Lab Note, the gate

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: CI steps** — after the "Value icon resolution tests" step in `ci.yml`:

```yaml
      # The weighing UI's contract, read off the source: PanelGroup/PanelSection
      # only, data hooks, numbers from the schema, no scorer sent, mount points,
      # a draft-by-default positioning editor.
      - name: Weighing panel contract tests (source-asserting)
        run: npm run test:weighing-panel

      - name: Value claim-order tests (the picker keeps the order values were chosen in)
        run: npm run test:value-order
```

- [ ] **Step 2: Gate**

Run: `npm run generate && git status --short` (no artifact change in this part), `npm run lint`, `npx tsc --noEmit -p .`, `npm run build`, `npm run validate:seeds`, `npm run test:fixtures`, `npm run test:schema`, `npm run test:weighing && npm run test:weighing-derive && npm run test:weighing-events && npm run test:weighing-provider && npm run test:weighing-panel && npm run test:value-order`, `npm run test:panel-semantics && npm run test:project-panels && npm run test:product-scope && npm run test:platform-variants-gates && npm run test:panel-stack && npm run test:panel-preferences`, `npm run test:provider && npm run test:project-queries && npm run test:quality-fold`, `npm run test:cli`, `npm run test:mcp`.
Expected: all exit 0.

- [ ] **Step 3: Look at it** (nothing above renders a component; this is the only step that does)

```bash
# A stale dev server fakes hydration mismatches — restart it, do not trust a running one.
PORT=4242 npm run dev
```
In a browser (or with the project's playwright setup — memory note: import a bundle through the `/projects` file input): import `seed/pebbles.json`; open the project, open any acceptance's panel. Check, and write down what you see rather than assuming:

1. A **Value** group with "What it adds up to" (serves/costs/kept/"resting on guesses" at 100% on a project nobody has scored) and one row per claimed value, each labelled "Guess, from the order of the claimed values".
2. Click `+2` on the first row: the row's label becomes "A person: arkaik-app, confidence 1", the guess share drops, and the figures update without a reload. Reload the page: it persisted.
3. Click `−1` on another element via "Add an element": a "Unclaimed cost" flag appears.
4. Edit the acceptance's title in the same panel: the scored rows show the **stale** badge.
5. Settings → Positioning: tick two elements, set a weight, **Save as draft**: the panel now says the positioning is a draft and "Of what we stand on" does **not** appear; **Save and activate**: it appears.
6. The History page lists "…weighed +2 · by human · confidence 1" and "Positioning saved: 2 elements".
7. The public self-map (`/project/<seed id>`) shows the form read-only-or-erroring gracefully: choosing a level there toasts "cannot record assessments" (the seed sandbox has no journal) — it must not crash the panel.

If any of 1–7 is wrong, fix it in this part before opening the PR.

- [ ] **Step 4: Commit, submit, and put the Lab Note in the PR body**

```bash
git add .github/workflows/ci.yml
git commit -m "chore(weighing): CI steps for the panel contract and the claim-order helper (part 5/5)"
gh stack submit --auto
gh pr list --head weighing/5-panel --json number --jq '.[0].number'      # → <N>
```

Edit the PR body (`gh pr edit <N> --body-file body.md`) so it contains a section whose heading **starts with** `## Lab Note` and exactly one `yaml` fence — every title and summary double-quoted, `fr` an adaptation in the informal "tu", `nodes:` ids that exist in this project's graph (they do: all five are in `seed/arkaik-self-map.json`):

````markdown
## What this ships

The first slice of weighing: a promise can now say which values it serves and which it costs, how sure you are, and why — from its panel — and the product can write down what it stands on. (Parts 1–4 of the stack are the schema, the derivation, the storage and the MCP tools underneath.)

## Lab Note

```yaml
en:
  title: "Weigh what each promise is worth"
  summary: "Open any promise and rate each value it touches from −3 to +3 — what it serves and what it costs, kept apart, with how sure you are and why. Your call always wins over a guess, and a draft positioning weighs nothing until you say so."
fr:
  title: "Pèse ce que vaut chaque promesse"
  summary: "Ouvre une promesse et note chaque valeur qu'elle touche de −3 à +3 : ce qu'elle apporte et ce qu'elle coûte, sans les mélanger, avec ton degré de certitude et ta raison. Ton avis passe toujours avant une estimation, et un positionnement en brouillon ne pèse rien tant que tu ne l'actives pas."
nodes: [V-node-detail-panel, F-edit-acceptance, V-project-settings, V-mcp-tool-catalog, F-audit-value-coverage]
suggested:
  molecule: arkaik
  type: feature
  tags: [weighing, value]
```
````

(`atom:` is left out on purpose — never guess a slug.) Parts 1–4's bodies carry **no** Lab Note section; if the advisory reminder comments on them, add the `no-lab-note` label. After pushing, **read the comments on every PR in the stack**: the reminder clears its own comment once the body is fixed, and a malformed note (`en.title is required`) fails the post-on-merge job loudly.

---

## Risks, conflicts with the code, and open questions

### Where the design met the code and bent

| # | What the design says | What the code does | What this plan does |
|---|---|---|---|
| R1 | The seeding rule reads **the order of `metadata.values`** (first +3, second +2). | `components/values/ValuePicker.tsx` re-derives the list in the model's *canonical* order on every change ("the behaviour the chip grid had, kept"). For any acceptance edited in the app the order is the tier order, not the author's intent; only bundles written by an agent or by hand keep a real order. | Task 5.6 makes the picker keep pick order (helper + test). It was droppable; **the owner decided to keep it** (seeds are flagged guesses at confidence 0 either way, but without it a seed in an app-edited project is arbitrary). Note the fingerprint includes the values' order, so reordering a claim marks scores stale — intended, since the order is the claim. |
| R2 | ARCHITECTURE § 3: `Matrix.weights` holds the positioning; § 5/DISCUSSION: a draft matrix feeds no roll-up. | A draft must live on the thing being drafted, and DISCUSSION § "Positioning is a criteria set" says the *set* carries weights and per-level words. | D1: `CriteriaSet.status`/`role`/`extends`; `Matrix.positioning` is a pointer. `Matrix.weights` is not built. |
| R3 | The brief: kept share "via the existing `getNodePlatformStatuses`". | It lives in `lib/utils/platform-status.ts`, behind `@/lib/config/*` imports; `packages/mcp` cannot import `lib/`. | The schema reads `resolvePlatformStatus` (same `platformStatuses[p] ?? status` rule); `tests/schema/weighing-derive.test.js` loads the real `lib` module and asserts the two agree on every platform. |
| R4 | "Hosted projects store assessments as journal events, like `quality.assessment.scored`." | That event is written only through `…/quality/events`, whose whitelist, scope rules (`quality:append`), baseline synthesis and `QualityEventRefusal` are all Kritik's. | A sibling route, `…/weighing/events`, with its own whitelist and `graph:write` only, and **no** edit to the Kritik route. The ETag count reads a new union list (`BUNDLE_FOLD_TYPES`) so `planQualityEvents` keeps loading only Kritik events. |
| R5 | "Positive levels seeded; negatives never; 0 is a blank cell." | A seed can only be *suppressed* by something stored, and a blank is the absence of a row. | A stored `0` is allowed ("weighed and unrelated") and beats a seed — so a person can say "this claim is wrong". It raises `claim_not_supported`. |
| R6 | "Unclaimed cost." | `metadata.values` lists value elements only, so no negative is ever claimed. | `unclaimed_cost` = any stored negative. A claimed element scored negative raises **both** `claim_not_supported` and `unclaimed_cost` — deliberate (the consent page that claims "reduces anxiety" and scores −2). |
| R7 | "12 Pebbles acceptances have a node `status` that disagrees with their platform statuses." | `resolvePlatformStatus` reads `platformStatuses[p] ?? node.status` per platform, so a stale node `status` does not matter once every platform has a status. | Kept share reads platform statuses only, as designed. Nothing to fix here; the validator warning the draft suggests is out of slice. |
| R8 | The tweaker will redesign the panel afterwards. | `tests/app/panel-semantics.test.js` and friends read panel *source*. | `WeighingGroup` uses `PanelGroup` + `PanelSection` only and is mounted beside its siblings; `weighing-panel.test.js` pins the hooks the tweaker must keep. |
| R9 | "`schema_version` stays 3." | `ProjectBundleSchema` is strict about a *present* `weighing`: a malformed section fails `parseBundle` on import (hard), exactly as a malformed `quality` does. Everything else is a warning. | Same as Kritik; the zod shapes are `.catchall` so extra fields survive. |

### Risks that remain

- **R-F1 — stored elements are typed as well-formed.** `WeighingSection.sets` / `matrices` / `assessments` are typed as arrays of well-formed records although storage may hold anything in them (D15). Readers are safe because they go through `resolveWeighing` / `readWeighingAssessments`, but nothing in the types forces that. Follow-up: type the stored elements `unknown[]` so a direct read does not compile.
- **R-F2 — the published JSON Schema no longer says what an author should write.** D15 made every leaf `z.unknown()`, so `public/schema/project-bundle.json` documents descriptions but enforces and types nothing. Follow-up: publish a strict authoring JSON Schema (the shapes as written, no `unknown` leaves) beside the permissive import one.

- **R10 — restore replaces the hosted journal.** An assessment written hosted (or in a browser project) is an *event*; `arkaik restore` PUTs a bundle and journal from the repo, so hosted-only assessments vanish unless the repo's `docs/weighing/` carries them. The existing `--allow-history-loss` guard catches a journal that *shrinks*; nothing writes hosted events *back* into `docs/weighing/`. A `pull`-style verb is out of slice. Same story for a browser project exported to a repo: its events travel in `journal[]`, not as sidecars. **The owner wants `arkaik restore` to append by default and to overwrite only behind an explicit flag; that is filed as issue #624 (critical) and is deliberately not part of slice 1.** Until it lands, this risk stands as written: slice 1's `restore` folds the repo's sidecars and replaces the hosted journal.
- **R11 — provenance on the hosted route (revised by D14).** `scorer.id` is still the actor string (`arkaik-app` for a session, `arkaik-agent` for a token). The first draft stopped there, judging numeric user ids in a bundle that Publik can opt into publishing worse than a coarse label. **The owner overruled that:** a token write now also records `scorer.on_behalf_of`, the token owner's user id. The residual risk is the one the first draft named: the id travels in the section, and Publik withholds `weighing` by default but publishes it behind `?include_weighing=true`, so an opted-in publication carries opaque user ids (never emails: the planner refuses one). A session records nothing, since it is the person.
- **R12 — no page sorts by served/cost yet.** The brief calls them "the derived sort keys"; slice 1 ships them in the panel and in `get_matrix` (`sort`), and `sortPromises` is exported for the next slice's pages. Acceptances/Pyramid are untouched.
- **R13 — `qualityEventCount` now counts weighing events.** The validator field keeps its name to avoid a rename across `etag.ts`, `store.ts` and four tests; its doc comment says so. A follow-up rename is cheap.
- **R14 — not run here:** `npm run build` (Turbopack refused the scratch copy's symlinked `node_modules`) and any browser pass over `WeighingGroup` / `PositioningPanel`. Task 5.7 step 3 is the checklist for the second; the first is a CI gate.
- **R15 — local Node 26 vs CI Node 20.** Nothing here `require`s a `.ts` file; the loaders transpile. The new CLI/MCP suites spawn built `dist` artifacts, which are plain JS.
- **R16 — the History page** shows a weighing event only in the unfiltered feed (no family claims `weighing.*`, as for `quality.*`). Task 5.5 gives it words; a "Weighing" family chip is out of slice.
- **R17 — a saved positioning is journaled by actor (D14, D11). Resolved by the lead:** the event envelope's `actor` already records who saved it (session = human, token/MCP = agent), which satisfies the owner's "every save is journaled with who made it"; no `scorer` field is added to `weighing.set.saved`. In repo mode the save's author is the git commit's.

### Open questions for the owner, and what was answered

**Decided by the owner:**

1. **Task 5.6, the picker order fix (R1): keep.**
2. **`save_positioning` (D11): keep.** Agents may draft and activate a positioning. Every save is journaled with its scorer, and a human can revert. (R17 notes that the set event as written records the actor, not a scorer.)
3. **Archived promises (D7): weighed, but counted in no mass.** Yes.
4. **Slice-1 sorting (R12): yes.** Served and cost appear only in the panel and in MCP in slice 1. Page sorting comes with the Acceptances redesign.

**Still open:**

5. **Provenance** (R11, D14) — `on_behalf_of` records whom an agent acts for, but should an MCP session that a person drives be allowed to record as `human` (e.g. a `--as human` flag on the server), given "a human's level wins"? Not decided; D14 deliberately does not do it.
6. **Hosted to repo** (R10) — is a verb that writes hosted weighing events back into `docs/weighing/` wanted before slice 2? Related but separate: `arkaik restore` appending by default is issue #624, outside slice 1.

---

## Self-review

**Spec coverage** (the brief's seven scope items, then the research asks):

| Brief item | Where |
|---|---|
| 1. `bundle.weighing`, schema + zod in `@arkaik/schema`; sidecars folded by `arkaik pack`; hosted events; Publik withholds; `WeighingCriteriaSet`/`WeighingMatrix`/`WeighingAssessment` with `scorer`, `confidence`, `basis`; `schema_version` 3 | 1.1–1.3 (types, zod, validator), 3.1–3.3 (events, fold), 3.4 (sidecars, `pack`, `restore`, `push`), 3.5 (hosted), 3.6 (browser), 1.4 (Publik) |
| 2. Built-in `value-contribution` (30 elements, tiers, −3..+3 anchors) and `value` matrix | 1.1 (`weighing-library.ts`), pinned to the app's labels in 1.5 |
| 3. Derivation: seeding, effective level, fingerprint, served/cost, positioned, kept share, masses, flags, guesswork | 1.1 (fingerprint), 2.1–2.3 |
| 4. Positioning as a criteria set, draft/active, draft feeds no roll-up | 1.1/1.3 (shape, rules), 2.2 (draft → `null`), 3.2 (planner contract), 4.5 (`save_positioning`), 5.4 (editor) |
| 5. MCP `get_matrix` and `assess`, validator-gated | 4.1–4.5 |
| 6. Acceptance-panel form | 5.2–5.3 |
| 7. Minimal positioning editor, home justified | 5.4; justification in Part 5's header and D9 |
| Research: how Kritik is typed/validated/packed/stored/journaled/withheld/exported | Cited at the head of each part; every storage home mirrored |
| Stack cut, branch names, Lab Note part, draft note | § 1, Task 5.7 |
| Migration needed? | No (Part 3 header, D2) |

**Placeholder scan.** No "TBD", "TODO", "add validation" or "similar to Task N"; every code step carries the code (new files whole, existing files as unified diffs against the worktree's `main` state that were applied and run).

**Type consistency.** The names below are used identically in every task: `WeighingAssessment`, `WeighingCriteriaSet`, `WeighingMatrix`, `WeighingScorer`, `WeighingSection`, `WeighingEventInput`, `WEIGHING_ASSESSMENT_RECORDED`, `WEIGHING_SET_SAVED`, `WEIGHING_FOLD_TYPES`, `BUNDLE_FOLD_TYPES`, `acceptanceFingerprint`, `upsertWeighingAssessment`, `resolveWeighing`, `setOfRef`, `buildWeighingContext`, `weighPromise`, `deriveWeighing`, `sortPromises`, `planWeighingEvents`, `parseWeighingEventInputs`, `foldWeighingEvents`, `loadWeighingSection`, `foldWeighingSection`, `appendWeighingEvents` (provider **and** `Store`, with different signatures — the provider takes `(projectId, inputs)`, the MCP store `(inputs)`), `useWeighing`, `keepClaimOrder`.

---

## Shared names and signatures (the contract between the parts)

```ts
// P1 — packages/schema/src/weighing.ts, weighing-library.ts, weighing-schemas.ts, weighing-validate.ts
type WeighingScorerKind = "human" | "agent" | "rule";                    // authority order; `rule` is never stored
interface WeighingScorer { kind: WeighingScorerKind; id: string; model?: string; on_behalf_of?: string }  // on_behalf_of: opaque id or handle, never an email (D14)
interface WeighingAssessment { matrix; subject; criterion; level: number /* -3..3 */; scorer?: WeighingScorer /* absent on a hand-edited row */; confidence: 0|1|2|3;
                       evidence?; refs?; basis?: { fingerprint?; commit?; set_version: string }; run?; ts }
interface WeighingCriteriaSet { id; version; title?; subject?; scale?: { min; max; anchors } /* a positioning may omit it */; groups?; criteria: WeighingCriterion[];
                        role?: string; status?: string /* absent or "active" = active; anything else = draft */; extends? }
interface WeighingMatrix { id; title?; set: "value-contribution@1"; subjects: {kind:"query";species}|{kind:"list";items}; positioning?; context?; status? }
interface WeighingSection { sets?: WeighingCriteriaSet[]; matrices?: WeighingMatrix[]; assessments?: WeighingAssessment[] }   // every list optional: read through resolveWeighing / readWeighingAssessments
function acceptanceFingerprint(node: Pick<Node, "title" | "metadata">): string          // "fp1-<14 hex>"; never status
function upsertWeighingAssessment(rows, next): { assessments; replaced? }                 // key: matrix|subject|criterion|scorer.kind
function resolveWeighing(section?): ResolvedWeighing   // { sets; matrices } — well-formed only; built-ins first; a project cannot redefine them
function readWeighingAssessments(section?): WeighingAssessment[]                    // rows with string matrix/subject/criterion only
function isActiveWeighingSet(set): boolean                                           // absent or "active" = active; any other present value = draft
function weighingScaleOf(set, resolved?): WeighingScale                              // a set's scale, else its ruler's, else the signed one
function isWeighingSetShape / isWeighingMatrixShape / isWeighingAssessmentShape(x): boolean
function validateWeighingSection(section, nodeSpecies, journal): { path; rule; message }[]

// P2 — packages/schema/src/weighing-derive.ts
function seedAssessments(node, matrix, set): WeighingAssessment[]                                  // computed, never stored
function resolveCell(criterion, stored, seed, { fingerprint, setVersion }, claimed): EffectiveCell | undefined
function buildWeighingContext(section, matrixId = "value"): WeighingContext | undefined
function weighPromise(node, ctx): PromiseWeighing        // { served, cost, positioned|null, kept_share|null, guesswork, flags, stale, review, cells }
function deriveWeighing(nodes, section, matrixId = "value"): WeighingView | undefined     // + elements{promised,kept,cost,guesswork}, totals
function sortPromises(promises, "served" | "cost" | "positioned" | "title"): PromiseWeighing[]

// P3 — packages/schema/src/weighing-events.ts
type WeighingEventInput =
  | { type: "weighing.assessment.recorded"; matrix?; subject; criterion; level; confidence; evidence?; refs?; run?; commit?; model? }
  | { type: "weighing.set.saved"; set: WeighingCriteriaSet }
function parseWeighingEventInputs(body): WeighingEventInput[] | { error: string }          // refuses scorer/basis/ts
function planWeighingEvents(section, nodes, inputs, { actor, scorerKind: "human"|"agent", onBehalfOf?, now? }):
  | { ok: true; events: JournalEvent[]; assessments: WeighingAssessment[] } | { ok: false; refusals: { index; reason; detail }[] }
function foldWeighingEvents(section | undefined, events): WeighingSection | undefined      // same reference when nothing to fold
// P3 — packages/schema/src/cli/weighing-files.ts:  loadWeighingSection(root), saveWeighingAssessments(root, matrix, rows), saveWeighingSet(root, set), loadMatrixAssessments(root, matrix)
// P3 — DataProvider.appendWeighingEvents?(projectId, inputs): Promise<JournalEvent[]>        // local: journal row; remote: POST …/weighing/events
// P3 — POST /api/graph/projects/{id}/weighing/events   200 { events } · 400 invalid_events · 403 graph:write · 422 { error:"refused", message, refusals }
// P4 — MCP: get_matrix { matrix?, subject?, sort?, filter?, limit? } · assess { subject, criterion, level, confidence, evidence?, … } · save_positioning { elements, status?, title? }
// P5 — useWeighing(projectId): { section: WeighingSection | undefined; record(inputs): Promise<void> }
```

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-11-15-weighing-first-slice.md`. Two execution options:**

1. **Subagent-Driven (recommended)** — one fresh subagent per task, review between tasks; REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`. Parts 2 and 3 are independent after Part 1 and could run in parallel worktrees, but they share `index.ts` and `package.json` edits, so run them in order unless you rebase between.
2. **Inline execution** — `superpowers:executing-plans`, a batch per part with a checkpoint at each part's gate.

Either way: run each part's **gate** (§ 1.3) before `gh stack submit --auto`, and read every PR's comments after opening.
