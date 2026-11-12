# Spec — Kritik planner

Nov 11, 2026 · @Alexis

`arkaik kritik plan` turns a list of domain-by-surface parts into one plan file. The file holds the cells per part, audit ids that sort last, a budget cut and the prompts to paste. `arkaik kritik matrix <id> --record --plan` then records the merged result as a partial reading, and clears only the stale cells it re-scored. The spec was first written from the product-direction doc alone. On 11 Nov its twelve code assumptions were checked against the repo by reading the source; nothing was run. The answers are under Open questions, and the id, record, test and rollout sections were revised to match.

## Goal and non-goals

Goal: a builder can launch "Security on Web" (or several parts) from the repo with one command, see the cell count and a cost band first, and record the result without corrupting the trend or the findings lifecycle.

In scope:

- `arkaik kritik plan` with repeatable `--run DOMAIN:SURFACE` and an optional `--budget`.
- A versioned plan file (zod schema), written next to the audits.
- A plan id and one part id per part, built by the planner's own id function so that every part sorts after every existing audit.
- A paste-able prompt per part and one combined prompt.
- `matrix --record --plan`, which merges the parts, records the matrix as `partial` and closes the window per cell.
- Parts that can run in parallel sessions.

Non-goals:

- The estimator's calibration and the cost field on `quality.audit.completed`. Those are separate PRs; the planner only calls them.
- Creating or recording a plan from a hosted session. Hosted scoring stays scoped re-audits only. The scope rule itself is shared code, so hosted reads do change; see "The window closes per cell".
- The Launch panel and the "How Kritik runs" page. They will read this plan schema but ship separately.
- The classify pre-pass (section 4 of the direction doc). The planner uses `applicableCells` as it is today.
- Changing what `score --scope` and `matrix --scope` do for a repo with no plan record. Two shared rules do change: how the scope is derived, and how a scoped re-audit is named after a plan.

## Facts and assumptions

The facts below come from the direction doc (section 3, and section 4 for `applicableCells`). Nothing here was read from the repo.

| Fact (direction doc) | Where it is cited |
| --- | --- |
| `arkaik kritik signals --domain SEC --surface web` narrows the run sheet: SEC on web is 6 criteria and 36 checklist steps; AGT on iOS is 8 and 42 | SKILL.md, CLI |
| Today's workaround: score into `--audit 2026-11-sec-web`, then `arkaik kritik matrix 2026-11-sec-web --record --scope` | `kritik.ts` |
| Without `--scope` the trend reads 6 cells as the whole product; with it, the resolved-findings window closes | `kritik.ts` |
| Hosted sessions score scoped re-audits only | `kritik-tools.ts` |
| `applicableCells` matches `applies_to` to surface ids literally; framework.json knows web, ios, android, admin, supabase | `packages/schema/src/quality.ts` |
| 88 criteria in 11 domains; a full Pebbles audit is 338 cells; 41 Critical/High findings confirmed in the pilot | direction doc |
| `scopedAuditId` naming and "merged recording" exist and are listed for reuse | direction doc, section 3 |
| Estimator: tokens = cells × (P + c × B/4) + steps × q + h × V; P and B counted, c, q, h, V unmeasured | direction doc, section 3 |
| No token, dollar or duration figure is recorded anywhere | direction doc |

Assumptions about the code, checked against the repo on 11 Nov:

| # | Assumption | Verdict | What the code does |
| --- | --- | --- | --- |
| A1 | Scores live per audit id in a repo directory; scoring takes `--audit <id>` | Holds | `docs/quality/audits/<id>/` holds `scores.json`, `findings.json`, `matrix.json`. `arkaik kritik score <criterion> <surface> <level> --evidence … --audit <id>` |
| A2 | "Latest" is picked by sorting ids as strings | Half | `listAuditIds` sorts directory names, unrecorded ones included, and the merge is latest-wins per cell in that order. The trend and the window follow journal time instead |
| A3 | `scopedAuditId(base, domain, surface)` returns `<base>-<domain>-<surface>` | Wrong | It takes `{since, month, requested, known, recorded, open}` and returns `<month>-scoped`, then `-scoped-02`. It validates no characters |
| A4 | `applicableCells(profile, criteria)` returns criterion and surface pairs | Wrong shape | `applicableCells(library, surfaces)` returns `{criterion_id, surfaces[]}`. `kritik signals` filters through `signalRunSheet(library, surfaces, filter)` |
| A5 | The window runs from an anchor matrix; records resolve findings not reproduced; `--scope` moves the anchor | Wrong | There is no anchor matrix. The window is the cells whose findings were resolved after the newest `quality.audit.completed` event, so any record closes it. No code resolves a finding on record |
| A6 | Each record adds a trend point read as the whole product | Holds | A plain record of a partial audit carries that audit's cells alone. A scoped record carries the merged matrix and a `scope` marker |
| A7 | Merged recording overlays new cells on the previous matrix | Holds, differently | `loadQualitySectionThrough` merges every audit directory up to an id, latest-wins per cell |
| A8 | The profile maps each surface to a path | Optional | `path` exists on a surface and is optional. Pebbles' profile was not readable here |
| A9 | The CLI depends on zod | Wrong | The CLI has no runtime dependencies. zod belongs to `@arkaik/schema`; its scope and trend modules are zod-free on purpose |
| A10 | No token price is stored anywhere | Holds | Nothing in `kritik.ts` mentions a price or a tier |
| A11 | Finding ids could collide across parallel sessions | Wrong | `mintFindingId` builds `F-<audit>-<DOMAIN>-<surface>-NN` per prefix. Each part has its own audit id, so parts cannot collide |
| A12 | Scoring accepts a cell list | Wrong | One cell per call. The prompt carries the list |

One fact the assumptions missed: when a project has no recorded audit at all, `implicitAuditBaseline` (`quality-baseline.ts`) synthesises one from the newest audit id that does not end in `-scoped` or `-scoped-NN`. A plan part's id would be picked. This only bites a project whose first audit is a plan, before that plan is recorded.

## CLI surface

```
arkaik kritik plan --run <DOMAIN:SURFACE> [--run …]
                   [--budget-tokens <n>] [--budget <usd> --price <usd-per-Mtok>] [--tier <name>]
                   [--counts-only] [--out <path>] [--json] [--dry-run]
arkaik kritik plan --status <planId>          # read-only: part progress, actual vs estimate
```

| Flag | Meaning | Default |
| --- | --- | --- |
| `--run D:S` | One part. Repeatable. The order given is the priority order for the budget cut. | required, at least one |
| `--budget-tokens <n>` | Cap on the plan's estimated tokens. The main budget: it means the same on a subscription and on API billing. | none: every part is included |
| `--budget <usd>` | Cap in US dollars, for API billing. Needs `--price`. With both budgets given, the tighter one cuts. | none |
| `--price <usd>` | Blended price per million tokens, used only to convert tokens to dollars. The CLI has no config file, so the flag is the only source. | none |
| `--tier <name>` | Model tier, used to pick the calibration state. Stored in the plan file. | none |
| `--counts-only` | Skip the estimator: cells and steps only, no budget | off |
| `--out <path>` | Write the plan file somewhere else | `docs/quality/plans/<planId>.json` |
| `--json` | Print the plan JSON instead of the human summary | off |
| `--dry-run` | Print, write nothing | off |

### `--run` grammar

```
run     := domain ":" surface
domain  := 2*4 ALPHA          ; case-insensitive input, stored upper case; must be one of the 11 framework domains
surface := 1*( ALNUM / "-" / "_" ) ; case-sensitive; must be a surface id in the project profile
```

- Surfaces are matched literally, as `applicableCells` does. `web` matches `web`, never `Web` or `website`.
- Duplicates (`--run SEC:web --run sec:web`) collapse into one part with a warning.
- A part with 0 applicable cells is an error: the criterion's `applies_to` never names that surface.
- Wildcards (`SEC:*`, `*:web`) are deferred to v2. They would expand in framework order, then profile order.

### Cells per part

For each part, the planner takes the entries of `applicableCells(library, profile.surfaces)` whose criterion belongs to domain D and whose `surfaces` include S. `steps` is the sum of those criteria's checklist lengths. A unit test pins the result to what `signalRunSheet` returns for the same `--domain` and `--surface`: SEC:web gives 6 and 36, AGT:ios gives 8 and 42.

### `--budget` and the estimator

The planner calls one function per part. The estimator is its own module and PR; the planner never reimplements the formula.

```ts
estimate(part: { cells: Cell[]; steps: number; surfacePath: string; tier: string }): {
  tokens: Band;                 // {low, mid, high}
  inputs: { P: number; B: number; c: Band; q: Band; h: Band; V: Band };
  calibrated: boolean;          // false until the ledger holds >= 3 runs for this tier
}
```

- `tokens = cells × (P + c × B/4) + steps × q + h × V`. P (skill and criterion text) and B (bytes under the surface path, with a fallback when the profile gives none) are counted. c, q, h and V are bands taken from a constants file until the ledger refits them.
- **Tokens are the unit.** Every estimate is a token band. Dollars appear only when `--price` is passed: USD band = tokens band × price / 1e6. Without a price the USD fields are null and nothing prints in dollars.
- **Budget cut.** Walk the parts in `--run` order and keep a running total of the high bound, in tokens for `--budget-tokens` and in dollars for `--budget`. A part is included while every given budget holds; every later part is deferred. Parts are never reordered, so the user's priority holds.
- If even the first part's high bound is over a budget, nothing is written and the command refuses.
- Every figure prints as "uncalibrated" while `calibrated` is false.

Example output for Pebbles. The numbers are illustrative, not measured:

```
Plan 2026-11-zplan-1100   pebbles @ 3f9c2e1   framework 1.4
part      audit id                      cells  steps  tokens low–high (uncalibrated)  status
SEC:web   2026-11-zplan-1100-sec-web        6     36   …                              included
AGT:ios   2026-11-zplan-1100-agt-ios        8     42   …                              included
total                                      14     78   of 338 applicable cells
budget 400,000 tokens: fits at the high bound (…)
wrote docs/quality/plans/2026-11-zplan-1100.json

Paste into one agent session (or use one prompt per part, see the plan file):
…
After every part is scored:  arkaik kritik matrix 2026-11-zplan-1100 --record --plan
```

With `--price`, a USD column is added beside the tokens.

## Plan file

The plan file is JSON, written once by `plan` and read by `matrix --record --plan`. Its path is `docs/quality/plans/<planId>.json`. Part status is never written back into it; it is derived from the parts' audit directories, so parallel sessions never contend for the file. The schema lives in `packages/schema/src/quality-schemas.ts`, with the other zod schemas, so the Launch panel can reuse it later. The pure modules (`quality-scope.ts`, `quality-trend.ts`) stay zod-free. The file carries no hash: the record step recomputes the cells and compares them.

```
import { z } from "zod";

const Band = z.object({ low: z.number().nonnegative(), mid: z.number().nonnegative(), high: z.number().nonnegative() });
const Cell = z.object({ criterion_id: z.string(), surface: z.string() });

export const KritikPlanPart = z.object({
  domain: z.string().regex(/^[A-Z0-9]{2,5}$/),
  surface: z.string().min(1),
  auditId: z.string(),                       // planPartId(plan.planId, domain, surface)
  cells: z.array(Cell).min(1),
  steps: z.number().int().nonnegative(),
  estimate: z.object({
    tokens: Band,
    usd: Band.nullable(),                    // null when no price was passed
    inputs: z.object({ P: z.number(), B: z.number(), c: Band, q: Band, h: Band, V: Band }),
    calibrated: z.boolean(),
  }).nullable(),                             // null with --counts-only
  status: z.enum(["included", "deferred"]),  // deferred = cut by a budget
  prompt: z.string(),                        // the paste-able prompt for this part alone
});

export const KritikPlan = z.object({
  schema: z.literal("arkaik.kritik.plan/1"),
  planId: z.string(),                        // names the plan file and the recorded event; has no audit directory
  createdAt: z.string().datetime(),
  commit: z.string().nullable(),             // HEAD at plan time; null outside git
  frameworkVersion: z.string(),              // as scores.json records it
  tier: z.string().nullable(),
  budgetTokens: z.number().int().positive().nullable(),
  budgetUsd: z.number().positive().nullable(),
  pricePerMTok: z.number().positive().nullable(),  // required when budgetUsd is set
  parts: z.array(KritikPlanPart).min(1),
  totals: z.object({
    cells: z.number().int(), steps: z.number().int(),
    applicableCells: z.number().int(),       // whole product, for example 338 for Pebbles
    tokens: Band.nullable(), usd: Band.nullable(),   // sums over included parts only
  }),
  prompt: z.string(),                        // one session, every included part in order
  recordCommand: z.string(),                 // "arkaik kritik matrix <planId> --record --plan"
});
export type KritikPlan = z.infer<typeof KritikPlan>;
```

### Audit id format and why it sorts last

The plan id is `YYYY-MM-zplan-DDNN`, for example `2026-11-zplan-1100`. DD is the day of the month and NN a two-digit counter for that day, starting at 00. Each part's id is `<planId>-<domain>-<surface>` in lower case, for example `2026-11-zplan-1100-sec-web`. A new function `planPartId(planId, domain, surface)` builds it; `scopedAuditId` names scoped re-audits only and is not reused. Only parts have a directory under `docs/quality/audits/`. The plan id names the plan file and the recorded event.

Part ids must sort last. Audits merge latest-wins per cell in the string order of their directory names (`listAuditIds`, `mergeAudits`), so a part that sorts before an older audit has its fresh scores outvoted. A date alone fails: `2026-11-11…` sorts before `2026-11-scoped`, because digits sort before letters. The `z` lead fixes this:

- `2026-11-z…` sorts after every same-month id whose third segment starts with a digit or a to y, including `2026-11-scoped` and `2026-11-sec-web`.
- Next month's ids (`2026-12-…`) still sort after it, so the order stays chronological.
- `DDNN` is fixed width, so a later plan in the same month sorts after an earlier plan's parts: `2026-11-zplan-1101-…` is greater than `2026-11-zplan-1100-sec-web`.

Rule: the planner calls `listAuditIds` and picks the smallest NN for which every part id sorts after the newest existing id. It stops with an error after NN = 99.

Two existing rules have to learn about these ids, both in PR 2:

- **The implicit baseline.** With no recorded audit, `implicitAuditBaseline` picks the newest id that is not a scoped one. One shared `isPartialAuditId` must cover scoped ids and plan part ids, so an unrecorded part is never read as a full audit. Low priority: it only applies before a project's first record.
- **Scoped re-audits after a plan.** In a month that holds a plan, `<month>-scoped` sorts before the plan's parts, so `score --scope` refuses and suggests `<newest>-scoped`. That refusal is correct but clumsy. The scoped candidates should start from the newest id when it is a plan part.

## Prompt template

Each included part gets its own prompt, for parallel sessions. The plan also carries one combined prompt that runs the parts in order and records at the end. Both are rendered from one template in `kritik-plan-prompt.ts`, and a snapshot test pins the output. Placeholders use `{{…}}`.

Per part:

```markdown
Run part {{domain}}:{{surface}} of Kritik plan {{planId}} in this repo (commit {{commit}}).
Scope: {{cellCount}} cells, {{steps}} checklist steps. Estimate: {{tokensLow}}–{{tokensHigh}} tokens{{#usd}} (${{usdLow}}–${{usdHigh}}, uncalibrated){{/usd}}.

1. Follow the Kritik skill (SKILL.md) for a partial audit.
2. Get the run sheet: `arkaik kritik signals --domain {{domain}} --surface {{surface}}`
3. Score exactly these cells and no others:
{{#cells}}   - {{criterionId}} on {{surface}}
{{/cells}}
4. Write every score and finding with `--audit {{partAuditId}}`. Give file-and-line evidence, and verify every Critical and High finding adversarially.
5. Do not run `arkaik kritik matrix … --record`. The plan records once, after all parts.
6. Finish by printing this session's usage readout: model, tokens in and out, duration, number of agents.
```

The combined prompt is a header (plan id, parts, totals), then steps 2 to 4 repeated per part, then step 6, then one last step: "When every part is scored, run `{{recordCommand}}`."

Deferred parts are listed at the end of both prompts as "not in this run (over budget)", so the agent does not pick them up. Step 6 feeds the ledger (cost field PR). Until that lands, the user pastes the readout by hand.

## `matrix --record --plan`

`arkaik kritik matrix <planId> --record --plan` records the plan: one event under `planId`, carrying the merged matrix and a partial marker. It is the only command that records a plan. `--plan` and `--scope` cannot be combined.

Steps:

1. Load and parse `docs/quality/plans/<planId>.json`. Recompute each part's cells from the library and profile as they are now. If they differ from the plan's cells, or the framework version changed, refuse and ask for a new plan.
2. For each included part, read `scores.json` under the part's id. A score for a cell outside the plan is refused, not ignored: the merge reads every audit directory, so a stray score would enter the matrix anyway. The message names the cells to remove.
3. If any plan cell has no score, refuse and list the missing cells per part.
4. Build the merged matrix with the loader that exists: every audit directory up to the last part id, latest-wins per cell (`loadQualitySectionThrough`). No anchor and no overlay code are needed.
5. Append one `quality.audit.completed` under `planId`, carrying the merged matrix and this marker:

   ```
   scope: {
     partial: true,
     cells: 14,                       // cells this plan re-scored
     since: "2026-10" | undefined,    // newest recorded audit that is not a plan; absent on a first audit
     plan: "2026-11-zplan-1100",
     parts: ["2026-11-zplan-1100-sec-web", "2026-11-zplan-1100-agt-ios"],
     scored: ["SEC-01::web", …],      // cell keys, as quality-scope.ts builds them
     coverage: { scored: 14, assessed: 152, applicable: 338 }
   }
   ```

   The event schema already accepts extra keys under `scope`. `assessed` counts the cells that hold any score after the merge.
6. Once the ledger exists, the event also carries the cost per part.

**Parts count as recorded.** `recordedAuditIds` must also return every id in `scope.parts`. Today each guard asks whether the id being written to is recorded: the `score` warning, the `scopedAuditId` refusal and the MCP checks. Without this change a session could keep scoring into a part after its plan was recorded and silently rewrite that reading.

### Merge rules

| Cell | Value in the merged matrix | Findings |
| --- | --- | --- |
| In the plan (always scored, or the record refuses) | The part's score, because the part id sorts last | Unchanged by the record. A finding closes only when someone resolves it |
| Not in the plan, scored by an earlier audit | Its last score | Unchanged |
| Never scored by any audit | Absent, and counted out of `coverage.assessed` | Not applicable |

Recording never resolves, reopens or creates a finding. An auditor who sees that a defect is gone resolves the finding explicitly, as today. Plans are disjoint by construction, because duplicates collapse at plan time, so two parts never score the same cell.

### The window closes per cell

The window is what `arkaik kritik scope` lists: the cells whose findings were resolved after the newest `quality.audit.completed` event. Today any record moves that point, so recording six Security cells would drop every other stale cell from the next scope. That is the trap, and it does not depend on `--scope`.

`deriveAuditScope` changes as follows (question 6, decided):

1. **Choosing `since`.** It takes the newest `quality.audit.completed` that has no `scope.plan`. A plan record is never the audit a scope is measured from.
2. **One rule for clearing.** A resolution counts toward a cell only if it happened after the last plan record that lists that cell in `scored`. Order is journal order (`orderEvents`), as everywhere else in the function.
3. **Direct cells.** A cell is listed when at least one of its resolved findings still counts under rule 2. Its `because` holds only those findings.
4. **Cross-surface findings.** They fan out to every surface the criterion applies to, as today. Rule 2 then applies to each cell separately, so a plan that re-scored web clears web and leaves iOS listed.
5. **Widened cells.** A node counts as resolved for a cell only through resolutions that count under rule 2. A widened cell the plan re-scored therefore leaves the scope until a later fix touches one of its nodes.
6. **A cell can come back.** A finding resolved after the plan record makes its cell stale again, and it is listed again.
7. **Reported lists.** `findings` and `resolved_by` keep only the findings that still drive a listed cell. `unknown` and `unscorable` are unchanged.

A full record or a scoped re-audit still moves `since` and so clears everything, as today.

**This is shared code.** The CLI, the repo-mode MCP server (`kritik-tools.ts`) and the hosted server (`lib/services/graph/quality-events.ts`) all call `deriveAuditScope`. A journal that holds a plan record gives the same scope on all three. Hosted sessions cannot create a plan record in v1, but a hosted project restored from a repo that has one will read it. The tests for rules 1 to 7 belong in the shared suite, and the hosted suite needs one case with a plan record in the journal.

### Trend

- The trend already orders snapshots by journal time and shows a `scope` marker on a scoped re-audit's merged reading. A plan record reuses that: one point holding the merged matrix, labelled "partial: 14 cells re-scored".
- Because the point carries the merged matrix, unscored cells count at their last scores and 14 cells are never read as the whole product.
- Deltas for a partial point are read over its scored cells only.
- No per-part trend point is written in v1. The per-part detail is in the event's `parts`.
- Burndown counts findings as usual. The baseline must not pick a part id; see the audit id section.

**`regressions` after a plan.** With no arguments, `regressions` compares the last two audit directories, which after a plan are two parts of the same plan. It must treat a plan's parts as one reading: the default pair becomes the state through the plan's last part against the state before its first part. An explicit `--from` or `--to` naming a part resolves to its plan the same way. This lands in PR 4.

### A first audit that is a plan

A project's first audit may be a plan. This is the "Security on Web first" case a newcomer starts with, so it must work without a full audit before it. Alexis confirmed this on 11 Nov (question 12).

- **The record.** There is no earlier audit, so `since` is absent and the merged matrix holds only the plan's cells. `coverage` says so: for example 6 scored, 6 assessed, 338 applicable.
- **The roll-up problem.** `rollUpSurface` takes the weighted mean of the domains that scored and skips the rest. With one domain scored, web's overall score is its Security score, which reads as a grade for the whole surface.
- **The rule.** Wherever a surface or product roll-up is shown, it carries its coverage when `assessed` is below `applicable`: "web 62, from 6 of 71 cells". `arkaik kritik trend` and `matrix` print it in v1. The dashboard follows with the Launch panel.
- **Per-cell grades are unaffected.** A scored cell's level, caps and findings mean the same as in a full audit.
- **The scope.** With no non-plan record, `since` is null and `arkaik kritik scope` lists nothing. Its message should say why: fixes are re-checked by running the part again, until a full audit exists.
- **Later plans add up.** Each plan record carries the merged matrix, so `assessed` grows. Reaching full coverage through plans does not create a `since`; only a full audit does (question 6).

### Idempotency

Recording a plan that is already recorded refuses, and so does recording a part id directly (`matrix <partId> --record`), which points to `--plan`. To correct a recorded plan, make a new plan for the same parts. The journal is append-only; the trend already keeps the latest record per audit id, so no replace flag is needed in v1.

## Parallel sessions per part

Each part is its own audit id, so parts can run in separate agent sessions at the same time and meet only at record time.

- **Disjoint writes.** A session writes only under its part id. The plan file is read-only after `plan`, and part status comes from the audit directories. No lock is needed until record.
- **Single writer at record.** `matrix --record --plan` is run once, by one session, after every part is scored. v1 takes no lock; the journal has none elsewhere.
- **Finding ids.** No change is needed. `mintFindingId` builds `F-<audit>-<DOMAIN>-<surface>-NN` and each part has its own audit id, so two sessions cannot mint the same id.
- **Always pass the id.** `score` without `--audit` writes into the newest audit on disk, which with two parts in flight may be the other part. Every command in a part's prompt carries `--audit <partId>`.
- **Worktrees.** Sessions in separate git worktrees leave scores in separate checkouts. Record looks only in the current checkout and names any part with no scores there, so the user can merge or copy first.
- **Hosted sessions** cannot take a part: hosted scoring is scoped re-audits only. The prompt says the part must run in the repo.
- **Status.** `arkaik kritik plan --status <planId>` prints each part as not started, in progress or scored, with actual cost against the estimate once the ledger has it. It is read-only.

## The MCP server

An agent often runs Kritik through the repo-mode MCP server, which has its own copies of the score and matrix paths (`kritik_score`, `kritik_matrix`, `kritik_scope` in `packages/mcp/src/kritik-tools.ts`). The plan must hold there too.

| Tool | Change | PR |
| --- | --- | --- |
| `kritik_scope` | None in the tool. It calls the shared `deriveAuditScope`, so it follows the new rule | 4 |
| `kritik_score` | Treats a part of a recorded plan as recorded, through the shared `recordedAuditIds` | 4 |
| `kritik_matrix` with `record: true` | Refuses a plan part id and points to the plan. Gains `plan: true` with the same steps as the CLI, from one shared function | 4 |
| `kritik_plan` (new) | Same inputs and plan file as `arkaik kritik plan`. Returns the plan and its prompts | 3 |

The record steps live in one function in `@arkaik/schema`'s CLI helpers, called by both the CLI and the MCP tool, as `scopedAuditTarget` is today. A hosted project gets no plan tool in v1.

## Error cases

Every refusal exits 1 and writes nothing, as the rest of `arkaik kritik` does through `fail`. The CLI already uses 1 for "regressions found" and "signals tripped", so a caller tells the cases apart by the command, not the code.

| Command | Condition | Result | Message (gist) |
| --- | --- | --- | --- |
| plan | No `--run` | refuse | at least one `--run DOMAIN:SURFACE` is required |
| plan | Token is not `D:S` (`SEC`, `SEC:`, `SEC:web:x`) | refuse | shows the grammar and the bad token |
| plan | Unknown domain | refuse | lists the domain codes |
| plan | Surface not in the profile (for example `api`) | refuse | lists the profile's surfaces; a literal match is required |
| plan | 0 applicable cells for a pair | refuse | no SEC criterion applies to admin |
| plan | No project profile | refuse | points to `arkaik kritik profile` |
| plan | `--budget` with no `--price` | refuse | pass `--price` |
| plan | `A budget flag` with `--counts-only` | refuse | the two flags conflict |
| plan | First part's high bound is over budget | refuse | prints that part's band and the smallest budget that fits |
| plan | No NN up to 99 sorts last | refuse | names the id that blocks the sort |
| plan | Duplicate `--run` | warn | merged into one part |
| record | Plan file missing or fails the schema | refuse | path, plus the schema issue |
| record | `--plan` with `--scope` | refuse | the two flags conflict |
| record | Cells or framework version changed since the plan | refuse | make a new plan; the cells have moved |
| record | Plan cells with no score | refuse | missing cells per part |
| record | Scores outside the plan's cells | refuse | names the cells to remove from the part |
| record | Plan already recorded | refuse | make a new plan to correct it |
| record | Id is a part of a plan | refuse | points to `matrix <planId> --record --plan` |
| record | No earlier recorded audit | ok | records with `since` absent; prints the coverage |

## Tests

### Unit

- **Grammar:** valid tokens, case normalisation, every malformed token in the error table, duplicate collapse.
- **Cells:** for every domain and surface in the Pebbles fixture, the planner's cells equal what `signalRunSheet` returns. Pinned cases: SEC:web = 6 cells and 36 steps; AGT:ios = 8 and 42.
- **Ids sort last:** a property test generates existing ids (`YYYY-MM`, `YYYY-MM-scoped`, `-scoped-NN`, hand-named ids such as `2026-11-sec-web`, earlier plans' parts). Every new part id must be greater than all of them under plain string order, and NN overflow raises the error.
- **Partial ids:** `isPartialAuditId` is true for scoped ids and plan part ids and false for `YYYY-MM`. The baseline never picks a part id.
- **Budget cut:** keeps `--run` order; compares on the high bound; an exact-equal total is included; a first part over budget exits 3; with `--counts-only`, every part is included.
- **Schema:** the written plan parses; an unknown schema version is rejected.
- **Prompts:** snapshot of the per-part and combined prompts for SEC:web + AGT:ios with a deferred third part. Every `score` line carries `--audit`.
- **Merge:** each row of the merge table; a score outside the plan refuses the record; a plan cell with no score refuses it too.
- **Findings:** recording a plan changes no finding's status.
- **Window:** a plan record is never chosen as `since`. A stale cell the plan re-scored leaves the scope; a stale cell it did not re-score stays. A full record still clears all.
- **Trend:** the plan's point carries the merged matrix and the `scope` marker; deltas cover scored cells only.
- **Regression:** `score --scope`, `matrix --scope` and `scope` behave exactly as before when no plan record exists.

Added on review:

- **Recorded parts:** after a plan record, `recordedAuditIds` returns the plan id and each part id. `score --audit <partId>` warns, and `scopedAuditId` refuses the part as a target.
- **Scope rules 1 to 7:** one case each, in the shared suite. They include a cross-surface finding with one surface re-scored, a widened cell re-scored, and a cell that comes back after a later resolution.
- **Hosted:** a hosted journal that holds a plan record yields the same scope as the repo.
- **First audit as a plan:** the record has no `since`, the coverage is right, `trend` and `matrix` print the coverage beside each roll-up, and `scope` explains why it is empty.
- **Implicit baseline:** with no recorded audit, an unrecorded part id is never picked.
- **MCP parity:** `kritik_plan` writes the same file as the CLI. `kritik_matrix` refuses a part id, and with `plan: true` appends the same event as the CLI.
- **Exit codes:** every refusal exits 1 and writes nothing.

### Acceptance: Pebbles, SEC on web

The fixture is synthetic: a small repo tree with a five-surface profile like Pebbles', the shipped criteria pack, one recorded full audit and a few open findings. The local Pebbles checkout has no `docs/quality`, so it cannot be the fixture. Scores are fixture files, so CI spends no tokens. CI runs Node 20, so the tests load TypeScript through the existing loader, not by requiring `.ts` files.

1. `arkaik kritik plan --run SEC:web --counts-only` writes `2026-11-zplan-DD00.json` with one part: 6 cells, 36 steps, status included.
2. The part id sorts after every audit id in the fixture, including a hand-named `2026-11-sec-web` and a `2026-11-scoped`.
3. The part prompt names exactly those 6 cells, passes `--audit <partId>` on every `score` line, and contains no `--record`.
4. Seed the journal: resolve one SEC on web finding and one AGT on iOS finding after the last recorded audit. `arkaik kritik scope` lists both cells.
5. Copy the fixture scores to the part id, then run `arkaik kritik matrix <planId> --record --plan`.
6. Check the event: `scope.partial` is true, `scope.plan` is the plan id, `scope.scored` holds 6 cells. The recorded matrix is the merged one: its composite does not equal the 6-cell score.
7. No finding changed status. `arkaik kritik scope` now lists the AGT on iOS cell and no longer the SEC on web cell. This proves the window closed per cell.
8. Run the same sequence through today's workaround (`matrix <id> --record --scope`) and confirm that the AGT on iOS cell drops out of the scope. That is the trap.

Manual follow-up (not CI): run SEC on web twice for real through the plan and compare the usage readouts with the estimate band. This is the direction doc's cheapest test.

## Rollout

There are seven PRs. PRs 2 to 4 give a counts-only planner and close the trap, in the CLI and over MCP. That is the fallback the direction doc names if usage cannot be recovered. PR 5 can start once the ledger's cost field exists.

1. **Verify the assumptions.** Done on 11 Nov by reading the source; see Facts and assumptions.
2. **Schema, grammar, cells, ids.** The plan schema in `quality-schemas.ts`, `parseRun`, `planCells` built on `applicableCells(library, surfaces)`, `planId` and `planPartId`. `isPartialAuditId` for the implicit baseline. Scoped candidates that start from a plan part. Unit tests for grammar, cells, sort-last, partial ids and schema.
3. **`kritik plan --counts-only` and `kritik_plan`.** CLI and MCP tool, plan file, prompts, `--json`, `--dry-run`, `--status`. The skill's "Scoping a run" gains the partial-audit procedure the prompt points to, so the prompt never references text that does not exist. No estimator; `--budget` is rejected until PR 5.
4. **Record a plan.** One shared record function behind `matrix --record --plan` and `kritik_matrix`. `recordedAuditIds` returns parts. `deriveAuditScope` rules 1 to 7. Coverage beside roll-ups in `trend` and `matrix`. Acceptance steps 4 to 8, the first-audit case and the hosted case. This PR fixes the trap.
5. **Estimator and `--budget`.** Estimator module with counted P and B, a fallback when a surface has no `path`, band constants for c, q, h and V, the budget cut and the "uncalibrated" label. Price and tier come from flags and are stored in the plan file.
6. **Actual against estimate.** `--status` reads cost from the ledger events per part. `calibrated` turns true after 3 runs per tier. Depends on the cost field PR.
7. **Docs.** The "How Kritik runs" page and the Launch panel read the plan schema. `matrix --scope` by hand gets a pointer to `--plan`.

**Left out of v1** (question 13, decided): `--allow-incomplete`, `--force`, a record lock, and a per-part trend point. Each can be added without changing the plan file or the event.

## Open questions

No question is open. Questions 1 to 5 were answered from the repo, and Alexis decided questions 6 to 14 on 11 Nov.

**Answered, 11 Nov**

1. **Storage and scoring.** Audits live in `docs/quality/audits/<id>/`. `arkaik kritik score` takes one cell per call and `--audit <id>`; without it, the score lands in the newest audit on disk. It already refuses a criterion on a surface it does not apply to. The prompt must name every cell and always pass the part's id.
2. **"Latest" selection.** By id for the merge: directory names sorted as strings, unrecorded directories included. By journal time for the trend and the window. The plan's ids must sort last.
3. **`scopedAuditId`.** It names scoped re-audits only (`<month>-scoped`, `-scoped-02`). The planner needs its own id function.
4. **The window.** It is the set of cells whose findings were resolved after the newest `quality.audit.completed` event. Any record closes it, with or without `--scope`. Merged recording exists (`loadQualitySectionThrough`). Nothing resolves a finding on record. The trend orders snapshots by time and already marks scoped ones.
5. **Ids, paths, dependencies.** Finding ids cannot collide across parts. A surface's `path` is optional, so the byte count B needs a fallback. The plan schema belongs in `@arkaik/schema`.

**Decided by Alexis, 11 Nov**

| # | Question | Decision |
| --- | --- | --- |
| 6 | Closing the window | Per cell. A plan record clears only the stale cells it re-scored; a full record clears all, as today |
| 7 | Product trend for partials | A carried-forward point marked partial, as scoped re-audits already record |
| 8 | Price model | Tokens are the unit and `--budget-tokens` is the main budget. Dollars are a conversion through `--price` |
| 9 | Budget bound | Cut on the high bound. Revisit after the first calibration |
| 10 | `--scope` | Keep `score --scope`. Retire the hand-declared `matrix --scope` once `--plan` holds |
| 11 | Band constants | From the two recorded Security-on-Web runs. If they differ by more than 2×, ship counts only |
| 12 | A first audit that is a plan | Allowed, with coverage shown beside every roll-up |
| 13 | What v1 leaves out | `--allow-incomplete`, `--force`, the record lock and per-part trend points |
| 14 | `regressions` after a plan | A plan's parts count as one reading |

**Still unknown**

- Whether Pebbles' profile sets a `path` on each surface.
- Whether a subscription user can recover token usage per run.
- The answers above come from reading the source; no command was run.
