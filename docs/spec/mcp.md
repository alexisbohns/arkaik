---
title: "Spec: MCP Server (Agent Plane)"
navTitle: "MCP Server"
order: 6
icon: plug
---

# MCP Server — the Agent Plane

> Status: **Implemented** — `packages/mcp` (`arkaik-mcp`), a dependency-free stdio server: the SDK caveat below resolved to its own fallback (the workspace's zod 4 vs the SDK's zod 3), so the server speaks newline-delimited JSON-RPC directly; the tool catalog is the contract, and adopting the SDK later changes plumbing, not behavior. File IO comes from the `arkaik/io` subpath export (§ Reuse Seams); the plugin ships the generated `plugin/.mcp.json`; `tests/mcp/run-mcp-tests.js` is the harness (§ Testing). This document remains the normative contract.
> The key words MUST, MUST NOT, SHOULD, and MAY are to be interpreted as in RFC 2119.

## Purpose

The skill makes agents good *writers* of the map; the format makes them competent *readers*. What's missing is a **conversational surface**: an agent asked "what's blocked on iOS?" or "link this new endpoint to the checkout view" should not need to parse a 4,000-line JSON file into context or shell out to a CLI with flags. The MCP server exposes the map as **tools** — the same projections humans see as pages ([maps.md](maps.md), [journal.md](journal.md) § Projections), plus validated dual-write mutations.

This is the **audience-symmetry principle** (vision.md § Core Product) made concrete: every human surface has an agent-consumable twin, produced by the same `@arkaik/schema` functions.

## Packaging & Transport

| Decision | Detail |
|---|---|
| Package | New workspace package `packages/mcp`, npm name **`arkaik-mcp`** (unscoped, symmetric with `arkaik`), MIT — toolchain side of the license split |
| Bin / install story | `npx -y arkaik-mcp` is the whole setup; esbuild-bundled single file like the CLI |
| Transport | **stdio** (v1). The server is spawned per session by the agent host; no daemon, no port |
| Not a CLI subcommand | The `arkaik` CLI stays dependency-free; the MCP SDK would end that. The CLI usage text gains a pointer line; an `arkaik mcp` alias MAY wrap the package later |
| SDK note | `@modelcontextprotocol/sdk` was the default choice; its zod-3 pin against the workspace's zod 4 resolved this to the fallback, taken all the way: the server speaks newline-delimited JSON-RPC directly (`src/protocol.ts`, ~150 lines — `initialize`, `tools/list`, `tools/call`, `ping`) with raw JSON-Schema tool definitions whose enums come from `@arkaik/schema` ids. `@arkaik/schema` remains the only validation authority; the SDK MAY be adopted later without changing the tool catalog |

## Graph Discovery — two modes, one catalog

The server serves a graph from one of two backends. **The tool catalog is identical in both**, which is the point: the mode is a `Store` implementation (`src/store.ts`), not a second set of tools, so repo and hosted behaviour cannot drift.

### Repo bundle (Kommit-first, the default)

The map lives next to the code, maintained as a side effect of development. Resolution order:

1. `--bundle <path>` argument
2. `ARKAIK_BUNDLE` environment variable
3. `docs/arkaik/bundle.json` under the current working directory

| Environment | Used for |
|---|---|
| `ARKAIK_BUNDLE` | The bundle path (2 above). |
| `ARKAIK_ON_BEHALF_OF` | Repo mode only: whom `assess` records as the person it acted for, first of three sources — see [Weighing tools](#weighing-tools). `-` records nobody. Hosted mode ignores it (the server stamps the token's owner). |

The journal is the sidecar resolved by the rules in [journal.md](journal.md) § Storage Shapes. The server MUST reload the bundle per tool call (files are small; external edits — a human, another agent, `git pull` — must be picked up).

### Hosted project (the account backend)

The map lives in an arkaik account and is reached over HTTP, so the app, this server, and the GitHub App all read and write one copy — no sync, no merge, no conflict UI ([hosted-projects.md](../hosted-projects.md), [services.md](services.md) § *Boundary 1 no longer holds for hosted projects*).

Selected by `--remote`, or automatically by a `docs/arkaik/arkaik.json` written by `arkaik link`. Resolution:

| | Order |
|---|---|
| Project | `--project`, then `$ARKAIK_PROJECT`, then `arkaik.json` |
| Origin | `$ARKAIK_URL`, then `arkaik.json`, then `https://arkaik.app` |
| Token | `$ARKAIK_TOKEN` only — never a file, because a credential in a repo file is a credential in a git history |

`--bundle` always wins, so an explicit path overrides a link file.

Three rules this mode MUST hold:

- **The client sends OPS, not a mutated graph.** The server recomputes under its own row lock, so two writers cannot lose each other's work. `Store.persist` therefore takes an *intent* for the hosted backend where the file backend takes an *outcome*.
- **A linked repo with no token exits non-zero.** It MUST NOT fall back to a repo bundle: a silent fallback serves a stale graph that looks fine, which is the failure an agent cannot notice.
- **`load()` returns a real `BundleValidation`, not a look-alike.** Most read tools touch only `bundle`/`nodes`/`edges`/`journal`, so a hosted `loaded` carrying just those passed unnoticed until `validate_bundle` — which also reads `result`, `valid` and `sidecarFindings` — crashed on it, putting the skill's hard validator gate out of reach for every hosted project. Hosted mode fetches the whole bundle plus its journal, so the findings come from running the same `validateBundle` over the same graph the server validated: one validator, one verdict, either side of the wire.

`propose_idea` and `file_request` are refused against a hosted project — the hosted write path has no journal-only operation yet — with an explicit message rather than a silent drop.

## Tool Catalog (v1)

All tool results are JSON text content. Read tools are projections; write tools follow the Write Path below.

| Tool | Input | Returns | Journal events |
|---|---|---|---|
| `list_nodes` | `species?`, `status?`, `platform?`, `value?`, `anchor?`, `parity_gap?`, `query?`, `limit?` | node summaries `{id, title, species, status, platforms}` (acceptances add `platform_statuses`, `values`; stakes add `stake_species`, `provenance` and, when set, `felt`, `matters`, `frequency`; options add `answer_types`, read from the stakes they address) | — |
| `get_node` | `node_id` | full node + edges with neighbor titles + where-used flows + `computeNodeTimeline` + (views/flows) `covered_by` | — |
| `create_node` | `species`, `title`, `description?`, `status?`, `platforms` (`[]` for a decision, a stake or an option), `metadata?` (a stake carries `stake_species`) | created node (id via `deriveNodeId`) + any synthesized `composes` edges | `node.created` (+ one `edge.added` per synthesized composes edge — see Playlist Composition) |
| `update_node` | `node_id`, `patch` | updated node + any synthesized `composes` edges | via `diffNodeUpdate`: `node.updated` / `node.status_changed` (± `platform`) / `ref.added` / `ref.removed` (+ `edge.added` per synthesized composes edge) |
| `record_screenshot` | `node_id`, `platform`, `form` (`url` \| `path` \| `data`), `value`, `detail?` | updated node | `screenshot.recorded` (source `manual`); a no-op when the value is unchanged or a newer CI shot outranks it |
| `remove_screenshot` | `node_id`, `platform` | updated node | `screenshot.removed` |
| `delete_node` | `node_id` | removed node + cascaded edge ids | `node.deleted` (edge cascade implied per [journal.md](journal.md)) |
| `add_edge` | `source_id`, `target_id`, `edge_type` | created edge (id via `edgeId`) | `edge.added` |
| `remove_edge` | `edge_id` | ack | `edge.removed` |
| `propose_idea` | `title`, `description?`, `node_id?` | event | `idea.proposed` |
| `file_request` | `title`, `description?`, `source?`, `node_id?`, `source_kind?`, `verbatim?`, `provenance?`, `stake_ids?`, `finding_id?`, `criterion_id?`, `url?` | event | `request.filed` (a signal; `source_kind` and `provenance` are enums, an out-of-vocabulary value is refused before anything is written) |
| `qualify_signal` | `signal_id?` or `title?`, `verbatim?`, the routing answers (`scope`, `door?`, `facing`, `expectation?`, `threat?`, `basis?`), `anchors?`, `catalog_id?` | `{ signal, routing, anchors, catalog_id?, candidates, suggestion, questions? }`: the species the RFC's table reaches, the existing stakes of that species the signal could join (scored, archived ones flagged), and a suggestion (`ask`, `route-out`, `refused`, `create`, `merge`, `already-qualified`; the last when a stake of any species cites the signal). `signal` echoes what was read (`event_id?`, `title`, `source_kind?`, `provenance?`), `catalog_id` is the resolved catalog link, and `questions` carries the full question objects still to answer when the route is `incomplete`. Read-only; never merges | — |
| `promote_signal` | the `qualify_signal` inputs, then exactly one of `create: true` (+ `stake_title?`) or `merge_into`; `voice?` | the stake (created at `idea`, or the stake that gained one evidence entry), its anchors, the ops, `handToHuman` (every route out, refusal, inferred answer and anticipated stake). Ops only, so it works against a hosted project; a signal a stake already cites is a no-op | `node.created` + `edge.added` per anchor (create), or `node.updated` (merge) |
| `decide_option` | `stake_id`, `option_id`, `reason`, `closed?` (`[{ option_id, reason? }]`), `title?`, `status?` (`approved` \| `enacted`), `supersede?`, `decided_at?` | the decision, its ops, `reasons` (what it supersedes), `handToHuman` (every loser closed with a default reason). Creates a decision with `reason` as its context, an `impacts` edge to the stake and a `generates` edge to the option, and closes every other non-archived option addressing the stake. Refused when the option does not address the stake or is archived, the reason is empty, or the stake already has an approved or enacted decision and `supersede` is not set. Ops only, so it works against a hosted project; the server stamps the author | `node.created` + `edge.added` ×2; with `supersede`, `decision.status_changed` (+ `node.status_changed`) for the old decision and a `supersedes` `edge.added` |
| `get_changelog` | `version?` | release list, or one `computeChangelog` slice | — |
| `get_backlog` | — | `computeBacklog` (open ideas & requests; a signal a stake names, or an idea or signal a stake cites, is closed) | — |
| `list_maps` | — | built-in + stored `MapDefinition`s with node/edge counts | — |
| `get_map` | `map_id` | `computeMapSubgraph` result | — |
| `validate_bundle` | — | `validateBundle` findings (errors + warnings, with paths) | — |

`list_nodes` additionally accepts:

- `value` — only acceptances tagged with this value element (enum: the 30 `VALUE_IDS`).
- `anchor` — a node id; only acceptances covering it via a `covers` edge.
- `parity_gap` — boolean; only acceptances delivered (`live`) on ≥1 applicable platform but not all (spec §3.5).

Acceptance summaries additionally carry `platform_statuses` (resolved per applicable platform) and `values`. `get_node` on a view or flow includes `covered_by`: summaries of the acceptances covering it.

**`get_map` and `list_maps` apply `MapDefinition.product`** ([maps.md](maps.md) § Product Scope): a
map scoped to one product returns that product's subgraph here, and those counts, exactly as the
canvas draws it. Neither tool resolves membership of its own — the restriction is step 0 of
`computeMapSubgraph`, and this layer adds only a `ProductGraph` built once so `list_maps` traverses
the snapshot for the whole catalog rather than per map.

That is a deliberate division and not an implementation detail: this used to be applied by the *app*
before the call, so both tools served the unscoped subgraph under a scoped map's own name — audience
symmetry broken by nothing more than where a function sat (issue #319). The fix was to move
membership resolution into `@arkaik/schema`, **not** to reimplement the restriction here, which is
precisely how two surfaces come to disagree about the same node.

`arkaik release` (tagging, note drafting, compaction) stays **CLI-only** in v1 — it is a ceremony with side effects beyond the bundle, owned by `packages/cli/src/commands/release.ts`.

### Quality tools (Kritik)

Fourteen `kritik_*` tools mirror the `arkaik kritik` verbs ([kritik.md](../rfcs/kritik.md) § 4.4), which
is what makes a **scheduled agent audit** a first-class monitoring loop: a routine wakes, reads the
signal pack, audits what changed since the last audited commit, scores through these tools, and the
journal accumulates the quality history the UI renders as trends.

| Tool | Input | Returns | Journal events |
|---|---|---|---|
| `kritik_matrix` | `audit_id?`, `record?`, `scope?`, `plan?`, `commit?` | the comparative matrix, per-surface roll-ups, finding counts, priority lanes, the P0 list; refreshes `matrix.json` in repo mode. A scoped re-audit (scored with `kritik_score` `scope: true`, or declared with `scope: true` in repo mode) also returns `scope` and `left_unscored` — the listed cells no score covered, which drop out of the next scope once it records. Hosted, a plain read is the stored quality section with the journal's finding decisions and hosted scores folded in, and it refuses `audit_id` (hosted has no audit file to partition it by). Hosted `record: true` records **a scoped re-audit only**: it requires the `audit_id` `kritik_score` returned, takes an optional `commit` (the tree the re-audit read), and implies `scope`; the server computes the merged scores and counts itself, so nothing the caller sends can disagree with the scores behind them. A retry of a scoped recording that already landed returns that re-audit's reading as success; `already_recorded` on any other audit (the `since` audit, a comprehensive one) stays an error. Repo `plan: true` takes a plan id from `kritik_plan` as `audit_id`: it returns the plan's merged reading — every audit through its last part, latest-wins — with `scope` (the plan marker), `coverage` and `coverage_notes`, writes nothing, and with `record: true` appends it as one event under the plan id, after the same checks as `arkaik kritik matrix <planId> --record --plan` (cells unmoved, no audit sorting after a part, every part scored exactly its cells). A plan part's own id is refused with `record` or `scope`, a plan id without `plan: true`, and `plan` in a hosted session | `quality.audit.completed` (only with `record: true`; hosted, only a scoped one, marked `scope: {partial, cells, since}`; a plan record is marked `scope: {partial, cells, since?, plan, parts, scored, coverage}`) |
| `kritik_findings` | `surface?`, `status?`, `priority?`, `criterion_id?`, `audit_id?`, `finding_id?` | findings with **derived** `severity` and `priority`; `finding_id` fetches one. Repo mode reads across every audit under `docs/quality/audits/`; hosted findings are a single living pool with no `audit_id` partition (the filter is refused there) | — |
| `kritik_signals` | `surface?`, `criterion_id?`, `domain?` | the signal run sheet, plus `tripped_since_last_audit`. Repo sessions only — the pack and its run sheet live with the code | — |
| `kritik_regressions` | `from?`, `to?`, `record?` | what got worse between two audits: a dropped maturity level, a cell that gained an open Critical or High, a finding resolved and open again. In repo mode a planned partial audit's parts are one reading: the default pair is the newest reading and the one before it, `from`/`to` take a plan id or any of its part ids, and the reply names readings. Hosted comparisons are read-only and cover assessment-level drops only — hosted findings are a living pool, not a per-audit snapshot, so the other two regression kinds don't apply there | `quality.signal.tripped`, one per regression (only with `record: true`, repo mode only) |
| `kritik_trend` | `surface?`, `domain?` | where the product stood at each recorded audit: one row per `quality.audit.completed`, oldest first, the overall score per surface (or one domain's with `domain`) and its delta against the row above. A re-recorded audit id keeps its latest reading; a framework major bump marks the later row `comparable: false` with no delta across it. Both modes — hosted reads the hosted journal, and there a restored audit with no recorded reading appears as a first row flagged `baseline: true`, rebuilt from its stored scores until the first hosted score records that reading for real (the `note` says which); a scoped re-audit's row carries its `scope` | — |
| `kritik_burndown` | `surface?`, `domain?` | what was done since the last audit: findings opened, resolved and accepted since the newest `quality.audit.completed` (and across the whole journal), the open count by severity at that audit and now (`rows`), a `summary` line, and every point of the replay. Replays `quality.finding.*` in journal order; an opened finding counts at the severity on its event; each recorded audit re-baselines the open counts to what it counted (a narrowed view never is — an audit's counts are project-wide). Both modes — hosted reads the hosted journal, and there a restored audit with no recorded reading is the first point, with the section's findings standing in for the opened events a restore never wrote | — |
| `kritik_scope` | `since?`, `widen?` | the scoped re-audit's work list: every (criterion × surface) cell a `quality.finding.resolved` since the `since` audit (default: the newest `quality.audit.completed`) made stale — `kind: direct`, `because` the finding ids — plus, with `widen` (default on), assessed cells one `node_ids` hop away — `kind: widened`, `because` the shared node ids. Each cell carries the score a re-score would replace; `unknown` lists resolved ids that name no finding, `unscorable` resolved findings whose cell nothing can re-score (a retired criterion, an undeclared surface); `summary` is the CLI's totals line. Accepted risks never scope anything. It plans an audit and scores nothing. Both modes — hosted reads the hosted journal and quality section, and on a restored project with no recorded reading it measures from that audit's implicit baseline, dated where the audit was taken. Hosted, it also returns `open_audit` — `{audit_id, scored: [{criterion_id, surface}]}` for the unrecorded scoped re-audit in progress (the last one, in journal order, scored from the current `since`: the server's own rule for the audit an id-less score continues), or `null` — and marks each cell that audit has scored `rescored: true`, so the loop can check it left nothing before recording. Hosted `kritik_score` is checked against the default scope (newest recorded audit, widened), so `since` and `widen: false` change only this read. With nothing to measure from, the hosted hints point at a repo audit landed by `arkaik restore`, never at `kritik_matrix` `record` | — |
| `kritik_plan` | `runs?`, `dry_run?`, `status?` | a counts-only plan for a partial audit, the same file `arkaik kritik plan` writes: one part per `DOMAIN:SURFACE` in `runs` (order kept, duplicates merged with a warning), each with its own audit id sorting after every audit on disk, its cells, its checklist step count and a prompt to paste, plus a combined prompt and the record command. Written to `docs/quality/plans/<planId>.json` unless `dry_run`; returns `{plan, path, written, warnings}`. With `status: <planId>` instead it writes nothing and returns `{plan_id, recorded, parts, ready_to_record}`: each part's `progress` (`not started`, `in progress`, `scored`), its `missing` cells and its `stray` scores, read from the part's audit directory, and its `summary` as the CLI's status row reads it (`scored, 1 outside the plan` until that row is deleted from the part's `scores.json`). Counts only: no estimate and no budget yet. Repo sessions only — a part is scored against a checkout | — |
| `kritik_issue` | `criterion_id`, `surface`, `level?`, `finding_id?` | the prefilled GitHub issue skeleton | — |
| `kritik_score` | `criterion_id`, `surface`, `level`, `evidence`, `audit_id?`, `commit?`, `scope?` | the assessment, latest-per-cell, plus `audit_id` and (with `scope: true`) `scoped_from`. With `scope: true` a cell `kritik_scope` does not list is refused and the score lands in a scoped audit of its own (`<YYYY-MM>-scoped`, continuing one already open). Hosted scoring is **scoped-only**: `scope: true` is required, the server checks the cell against the scope and names the audit, and nothing is written to disk. The first hosted score of a restored audit with no recorded reading first records that reading as a backdated `quality.audit.completed` with `baseline: true`; the reply returns it in `events` and says so in `notes`, which also flag a missing `commit` | repo: none (the score is written to `scores.json`); hosted: `quality.assessment.scored`, preceded once by the baseline `quality.audit.completed` |
| `kritik_open_finding` | `criterion_id`, `surface`, `title`, `evidence`, `impact`, `likelihood`, `cost`, `detail?`, `remediation?`, `node_ids?`, `issue_url?`, `verification?`, `audit_id?`, `finding_id?` | the finding + its derived severity/priority. Repo sessions only — a new finding cites code, so a hosted session refuses | `quality.finding.opened` (none when `verification.verdict` is `REFUTED`) |
| `kritik_resolve_finding` | `finding_id`, `resolved_by?` | the closed finding | `quality.finding.resolved` — repo mode writes it via `store.persist`; hosted posts it to the host (idempotent either way — a second resolve writes nothing) |
| `kritik_accept_finding` | `finding_id`, `note` | the finding as an accepted risk | repo mode: none (acceptance is a state, written straight to the findings file); hosted: `quality.finding.accepted`, since there is no findings file to hold that state — the read derives `accepted-risk` from the event |
| `kritik_trip_signal` | `criterion_id`, `surface`, `signal`, `detail?` | ack. Repo sessions only | `quality.signal.tripped` |

Four properties of this namespace are worth stating out loud, because each is a decision rather
than a detail:

**The sidecars are the store, the journal is the gate — in repo mode.** Kritik state lives in
`docs/quality/`, canonical in a repository the way `journal.jsonl` is canonical while a bundle's
embedded `journal[]` is only the interchange projection. So assessments and findings are written to
those files, while the `quality.*` events go through `store.persist` — the same validator-gated path
every other write tool uses. The journal write runs **first**: a refusal then leaves nothing behind,
where the other order would leave a finding on disk that no event ever announced.

**Hosted sessions read, transition findings, and re-score what a fix made stale; they don't run a
full audit.** A hosted project has no `docs/quality/` directory — instead the server folds the
account's own journal events into the stored bundle's quality section, and `kritik_matrix`,
`kritik_findings`, `kritik_regressions` and `kritik_issue` read that folded section directly, no
checkout required (`kritik_trend` reads the hosted journal the same way, and `kritik_scope` reads
both). Transitions (`kritik_resolve_finding`, `kritik_accept_finding`) go the same way in reverse:
the tool posts a whitelisted event — `quality.finding.resolved` or `quality.finding.accepted` — to
`POST /api/graph/projects/{id}/quality/events` under the `graph:write` scope, and the snapshot's
`quality` section is never mutated by that route; current status is re-derived on every read, the
same "current state is a projection" doctrine as everywhere else (§3.2), and the same path the
GitHub App's own resolution pass uses.

**The hosted scoped re-audit (issue #473).** The same route takes two more whitelisted types, both
under `graph:write`: `quality.assessment.scored` (what hosted `kritik_score` posts) and a scoped
`quality.audit.completed` (`scope: true`, `audit_id`, `commit?` — what hosted `kritik_matrix
record: true` posts). The loop is `kritik_scope` → `kritik_score scope: true` per listed cell →
`kritik_scope` again, until every cell reads `rescored: true` → `kritik_matrix record: true` with
the `audit_id` the scores returned (`open_audit.audit_id`), never the scope's `since`. Hosted scoring is
**scoped-only**: the server refuses a cell `deriveAuditScope` does not list (`out_of_scope`), names
the scoped audit itself (`<YYYY-MM>-scoped`, continuing one already open from the same scope), and
computes the recorded reading — the merged matrix through the scores, marked `scope: {partial,
cells, since}` — from the folded section, refusing a caller-supplied `scores`/`counts`. That scope
check is a workflow guard that keeps a hosted re-audit scoped, not an access control: any
`graph:write` caller can resolve a finding, which widens the scope. On a project whose audit arrived
by `arkaik restore` with no recorded reading, `kritik_scope` and `kritik_trend` measure from an
implicit baseline (`withImplicitBaseline`, `packages/schema/src/quality-baseline.ts`), dated where
the audit was taken and capped before the first finding decision, with every finding decided since
counted as open again (the audit saw it open); the first hosted score writes that
same reading for real, backdated, with `baseline: true`, after which the synthesis is off. Nothing
reaches `docs/quality/` — the journal events are the whole record. The agent still reads code to
score, so it runs from a checkout and passes the `commit` it read. What stays repo-only is
`kritik_signals`, `kritik_trip_signal`, `kritik_open_finding` and `kritik_plan` — a signal is checked
against the repo, a new finding cites code, and a plan's parts are scored in one — and a **comprehensive** audit, which has no hosted twin; those
refuse with that reason stated, not a blanket "hosted isn't supported" (issue #400).

A few shapes of that split are worth being explicit about: writes are events-only (no snapshot
mutation, no new tables — the fold is the only place a hosted finding's status is computed);
findings stay a living pool rather than being partitioned by `audit_id` the way repo findings are;
an optional `commit` anchor on a finding is required by policy for any future hosted-written
`kritik_open_finding`, should that ever ship; the token scope split stays `graph:read` for the reads
above and `graph:write` for the transitions, a hosted score and a scoped recording; and Publik's `stripQuality` is unaffected — it
strips the whole quality section before either read or write path is reachable.

**Nothing here authors a criterion or picks a surface.** `arkaik kritik profile` and `arkaik kritik
criterion add` deliberately have no MCP mirror. Both are one-time design decisions about what this
product is and how it should be judged — the choices an audit is measured *against*, not moves within
one — and the loop these tools exist to serve is the audit, not its terms.

**Severity is derived, never stored.** Severity, priority, scores, grades and caps never appear in
stored data and are recomputed on every read; a finding cannot carry a severity its own
`impact × likelihood` disagrees with.

### Weighing tools

Three tools read and write the weighing layer ([docs/rfcs/weighing.md](../rfcs/weighing.md), [bundle-format.md](bundle-format.md) § Weighing). They mirror `kritik_matrix` and `kritik_score`, and the write goes through the same validator-gated gate the app's form uses (`planWeighingEvents` in `@arkaik/schema`): an unknown element, a level off the −3..+3 scale or a subject that is neither an acceptance nor a stake of a kind the ruler declares is refused with the reason.

| Tool | Input | Returns | Journal events |
|---|---|---|---|
| `get_matrix` | `matrix?`, `subject?`, `sort?` (`served` \| `cost` \| `positioned` \| `title`), `filter?` (`flagged` \| `stale` \| `review` \| `uncertain` \| `unassessed`), `limit?`, `probabilities?` | The value matrix, on the **reach** ruler (`value-contribution@2`: +1 within the product, +2 across its domain, +3 life-wide). Per promise: `served` (Σ positive levels ÷ 3) and `cost` (Σ\|negative levels\| ÷ 3) — **never netted** —, `positioned` (the same over the elements an *active* positioning stands on, each × its weight; `null` for none or a draft), `kept_share`, `guesswork` (the share resting on confidence-0 cells; `positioned` has its own, and each element and the totals carry `{ promised, kept, cost }`), `flags` (`claim_not_supported`, `claim_contradicted`, `unclaimed_value`, `unclaimed_cost` — a partition), `stale`, `review` and `uncertain` (a probabilistic scorer was unsure: read it as a range). `claim_not_supported` is a claim assessed at 0 — +1 supports it. A cell nobody scored reads at a **seeded** level (every claimed value +1; scorer `rule`, confidence 0; negatives never) — a guess, never a score — and `notes` says when everything is one. A human's level beats an agent's beats a seed. `skipped` lists any stored set or matrix the resolver dropped. With `subject`: that promise's every cell with scorer, confidence, evidence and `others` (a stale cell says why in `stale_by`: `subject`, the promise's text moved; `ruler`, it was scored on an older major), plus the scale's and the confidence's anchors and every element's question and ladder (`elements`); `probabilities: true` adds each cell's `p_serves` / `p_costs`. Without: the promises plus per-element promised / kept / cost masses and totals | — |
| `assess` | `subject`, `criterion`, `level`, `confidence`, `evidence?` (≤ 2,000 characters, not blank), `refs?` (≤ 50, each ≤ 200), `model?`, `run?`, `commit?` (each ≤ 200), `p_serves?`, `p_costs?` (each 0..1, from a probabilistic scorer), `matrix?` (one a roll-up reads: a draft matrix is refused) | The stamped assessment (scorer `agent`, the set's version, the subject's fingerprint). `evidence` is required above confidence 0. Re-scoring replaces in place (`replaced_level`). `anchor` is what the level means on that element's own ladder. `notes` says when a human's level already stands for the cell and the agent's sits beside it. There is deliberately **no scorer argument** — a human's level wins every cell, so a caller must not be able to claim to be one | repo: none (`docs/weighing/assessments/<matrix>.json` is the record); hosted: `weighing.assessment.recorded` |
| `save_positioning` | `elements` (`[{ id, weight?, anchors? }]`), `status?` (default `draft`), `title?` | The positioning — a criteria set naming the elements the product stands on, each with a weight and, optionally, what each level means in the product's own words. Replaces the previous one whole. Weights and anchors are passed through as given, so the planner refuses a weight that is not a number above 0 or an anchor not keyed by a level on the scale (`invalid_set`) instead of the tool correcting it. A **draft feeds no roll-up**; draft one from the landing page or a brainstorm and leave it for a person to read | repo: none (`docs/weighing/sets/positioning.json`); hosted: `weighing.set.saved` |

**Stakes.** `value-contribution@2` declares the stake kinds it scores (`bug`, `friction`, `need`), and the built-in **`stakes`** matrix holds their cells, in their own sidecar (`docs/weighing/assessments/stakes.json`), never mixed into `value`. `get_matrix` with a stake as `subject`, and `assess` with a stake as `subject`, default to it. A stake is never seeded and claims nothing, so it has no claim flags and no `kept_share`; each stake row carries `stake` (its `stake_species`, its `reference`, and its `felt`, `matters` and `frequency` when set), shown beside the score and never summed with it. `assess` refuses a requirement, risk or defect (`unknown_subject`): those are read against a Kritik criterion, and a Kritik criterion id is never written as an assessment (`unknown_criterion`). `felt`, `matters` and `frequency` are stake metadata, set with `update_node`; `get_node` and `list_nodes` show them. `update_node` replaces a patched `metadata` whole on every species except a stake, where it is merged key by key (`null` clears a key) and `stakeMetadataWith` applies: a bug is `expected`, and a requirement, risk or defect carries none of the three. **No ranking across kinds.** Over the `stakes` matrix `get_matrix` returns `groups`, one list per species and, for bug, friction and need, per felt kind, each with its own `totals`, `elements`, `promises` and `matching`; stakes of different kinds are never ordered or summed against each other, and the order of the groups is not a priority.

**Repo and hosted behave alike.** In a repo the sidecars under `docs/weighing/` are read fresh and written by the tool; hosted, the server's folded section is the read and the events are the write, and nothing lands on disk. The hosted route stamps the scorer from the token (`agent`) and refuses a body that carries one.

**On whose behalf (`scorer.on_behalf_of`).** An assessment records whom the agent acted for.

- **Hosted:** the server stamps the token's owner (a user id). The MCP server sends nothing, whatever its environment says.
- **In a repo:** `assess` stamps the first usable of, in order: (1) `ARKAIK_ON_BEHALF_OF`, trimmed; (2) `git config arkaik.user`, read in the repo root; (3) `git config user.name`, the git author name. So most local scores say who they were made for with no setup.
- **Privacy, and the opt-out.** In a repo, your git author name is written into the committed `docs/weighing/` sidecars (and into a Publik publication that opts into weighing). Set `git config arkaik.user <handle>` to use another name, or `-` to record nobody. `-` as `ARKAIK_ON_BEHALF_OF` or as `arkaik.user` stamps nothing and stops the chain (git's name is not read); an *empty* value is just "not set" and falls through.
- **Never an email.** `user.email` is not a source, and a value that is email-shaped (anything containing `@`) in any source is *skipped*, not refused: the next source is tried, and scoring still works. The field is a user id, a handle or a display name, at most 128 characters with no control or invisible format characters (ZWJ and ZWNJ allowed); sidecars are committed to repos.
- **Absent when none is set**, as in an unattended CI run: the row is still written, without the key. Git is run without a shell (`git config --get <key>`) with a 1.5 s timeout, and any failure (no git, not a repo, not set) means "not set"; a timeout on `arkaik.user` ends the chain, so a hung git costs one short wait, not two. The value is read on every `assess`, so a config change mid-session is honoured.

It never changes who wins a cell: only the scorer's kind does.

## Write Path (dual-write, validator-gated)

Every mutating tool MUST follow, in order:

1. Load bundle + journal (fresh).
2. Apply the mutation **in memory** and derive the matching journal events (shared derivation — see Reuse Seams).
3. Run `validateBundle` on the mutated bundle with the new events folded in. **Any error → return the pathed findings and write nothing.** Warnings pass through in the tool result.
4. Persist: append each event to the journal sidecar (JSONL, one line per event, `actor: "arkaik-mcp"`), then rewrite the snapshot with `serializeBundle` (canonical form — clean git diffs).

This is the skill's dual-write doctrine ([journal.md](journal.md) § Authority) enforced structurally: an MCP mutation is *incapable* of the snapshot-without-history drift that free-form file edits invite.

### Playlist Composition (composes-edge synthesis)

A flow's playlist and its `composes` edges are two views of one relationship: the validator's `playlist-composes-coherence` rule requires a `composes` edge from a flow to every view/sub-flow its playlist references. Under the gate above this created a deadlock — a flow created with a populated playlist fails coherence because the edges don't exist yet, but `add_edge` cannot create them until the flow node exists, so no single call could produce a populated flow (issue #263).

`create_node` and `update_node` therefore **synthesize** the required edges: when the mutated node is a flow, they add a `composes` edge (flow → referenced node) for every playlist reference (recursing through `condition`/`junction` branches) that lacks one, fold those edges and their `edge.added` events into the *same* validated write, and return them in the tool result under `edges`. Edges that already exist are never duplicated; a reference to a missing node still fails the gate (nothing is written). This mirrors the app's own playlist editor, which adds the edge and the entry together. A populated flow is thus a single `create_node` call.

## Reuse Seams (three enabling moves)

1. **CLI file-IO becomes importable.** `packages/cli` exposes a subpath export `arkaik/io` (bundle read/write, journal sidecar IO, validation wrapper) built as a second esbuild entry. `packages/mcp` depends on `arkaik` and imports these verbatim — no drift between what the CLI and the MCP server consider "the bundle on disk". Filesystem code stays out of `@arkaik/schema`, which remains browser-safe.
2. **Dual-write derivation moves to the schema package.** `lib/data/emit-events.ts` is already pure; its core moves to `packages/schema/src/derive.ts` with the actor as a parameter. The app keeps a thin re-export binding `actor: "arkaik-app"`; the MCP server binds `"arkaik-mcp"`; the skill doctrine stays the human-readable statement of the same rules.
3. **The Kritik seam rides the first one.** `arkaik/io` also exports where the criteria pack lives and where quality events go (`packages/cli/src/lib/kritik-io.ts`), and the operations themselves are `@arkaik/schema` (`quality-ops.ts`, `cli/kritik-audit.ts`, `cli/kritik-overlay.ts`). The `kritik_*` tools, the `arkaik kritik` verbs and the plugin's standalone scripts are therefore three entry points over one implementation — a score written by an agent and a score written by a person are the same write.

## Distribution

- **npm:** `npx -y arkaik-mcp` — zero-install for any MCP host.
- **Claude Code plugin:** the plugin gains a generated `plugin/.mcp.json` declaring the server (`command: "npx", args: ["-y", "arkaik-mcp"]`), emitted by `scripts/generate/generate-plugin.js` and covered by the CI drift check. Installing the plugin then delivers **skill + MCP together**: the doctrine and the tools, one install.

### Qualification tools

Two tools turn a signal into a stake ([docs/rfcs/stake-architecture.md](../rfcs/stake-architecture.md) § 9; the routing is `packages/schema/src/qualify.ts`). They are the only tools that decide a stake's species, and they never decide it themselves: the caller answers the routing questions (`ROUTING_QUESTIONS`, the single source of the tool descriptions and the skill text) and `routeSpecies` applies the RFC's table.

- **`qualify_signal` is a read.** It returns the route (`stake`, `internal`, `off-scope`, `refused` or `incomplete`, with the questions still to answer), the existing stakes of the same species the signal could join (`findMergeCandidates`: a shared catalog id, a shared anchor, shared words; archived stakes flagged, never hidden; a benchmark flagged as not counting toward frequency), and a suggestion. The result is `{ signal, routing, anchors, catalog_id?, candidates, suggestion }`, plus `questions` (the full question objects, not just their ids) while the route is `incomplete`. A signal an existing stake already cites, under any species, reads as `already-qualified`, and a species mismatch goes to `routing.handToHuman`. An idea (`idea.proposed`, or an `anticipated` signal) defaults to the imagine door. A routed-out signal is not recorded, so it stays in `get_backlog`. It never writes and never merges.
- **`promote_signal` is ops only** (`create_node` + one `create_edge` per anchor, or one `update_node` appending an evidence entry), so it works against a hosted project where `file_request` is refused. A created stake lands at `idea` with no platforms, the species, the provenance the door implies (collect is observed, imagine is anticipated), a catalog link when one applies, and a first `metadata.evidence[]` entry (`event_id`, `quote` = the signal's `verbatim`, `voice`, `date`). A merge is always an explicit `merge_into`, appends one entry de-duplicated by `event_id`, and is refused across species. Promoting a signal a stake already cites is a no-op. The imagine door refuses a bug or a friction ("reroute as need"). A catalog id must fit the species: a value id of the pyramid for a bug, friction or need, a Kritik criterion for the others; a value link with an unknown id is refused. A signal with nothing but a title stores that title as its evidence quote, never an empty entry. Anything routed out, refused, inferred or anticipated (the imagine door) comes back in `handToHuman` for a person to confirm.

Both read a signal from the journal (`signal_id`, a `request.filed` or `idea.proposed` event) or take an inline `title`; an inline signal records evidence without an `event_id`.

### Decision tool

`decide_option` records that one option was chosen to answer a stake ([docs/rfcs/stake-architecture.md](../rfcs/stake-architecture.md) § 14; the plan is `planSelectOption` in `packages/schema/src/option.ts`, the tool is `packages/mcp/src/decide-tools.ts`). The caller supplies the judgement: which option wins and why each other one lost.

- **It is ops only** (`create_node` for the decision, `create_edge` for its `impacts` edge to the stake and its `generates` edge to the option), so it works against a hosted project, through the same `applyOps` and validator-gated persist as every other writer. There is no `actor` argument: the server stamps the author. `decided_at` defaults to today.
- **The decision** lands approved (stored `backlog`), or enacted (stored `live`) with `status: "enacted"`. It has no platforms. `reason` is its `context`; `closed_options` lists every other non-archived option addressing the stake, with the reason given in `closed`, or `Not selected: "<option>" was chosen.` for one with none (each defaulted reason is named in `handToHuman`). The title defaults to `Select "<option>" for "<stake>"`.
- **Refusals write nothing.** A stake or option that is missing or of another species, an option that does not address the stake, an archived option, an empty reason, a status other than approved or enacted, a `closed` entry naming an option that does not address the stake (or the selected one), and a stake that already has an approved or enacted decision while `supersede` is not set.
- **`supersede: true`** first updates each settling decision on the stake to `superseded` (stored `archived`) with an ordinary `update_node`, so the journal records `decision.status_changed`, then writes the new decision with a `supersedes` edge to each of them.
- Whether an option is selected, closed or open is read from the decision (`optionClosureFor`) and never stored on the option. The acceptances of the selected option read as promises (`isPromise`).

## Testing

`tests/mcp/run-mcp-tests.js` follows the CLI harness pattern: spawn the built server against a tmpdir fixture bundle + journal sidecar, speak JSON-RPC over stdio (`initialize`, `tools/list`, `tools/call`), and assert: read-tool shapes; a write round-trip (update → journal line appended → `validate_bundle` clean → snapshot canonical); and the gate (a mutation that would dangle an edge is refused with pathed findings and the files untouched).

`tests/mcp/remote-store.test.js` runs the same built server against a stub of the hosted API. Assertions that a tool *behaves the same through both stores* belong here rather than in the file-mode suite, which by construction cannot see hosted-only drift: `validate_bundle` returning a verdict identical to repo mode — clean and broken — is checked that way.

`tests/mcp/qualify-tools.test.js` covers the two qualification tools over a tmpdir repo (the hosted, ops-only path is in `remote-store.test.js`); `tests/schema/qualify.test.js` covers the routing table, the merge candidates and the plans through the real `applyOps` and validator.

`tests/mcp/weighing-tools.test.js` covers the weighing tools over a tmpdir repo and a stub of the hosted API, and finishes by running the built CLI's `pack` over what an agent wrote. Its `on_behalf_of` cases use a temp git repo with local config and run the server with `GIT_CONFIG_GLOBAL=/dev/null` and `GIT_CONFIG_NOSYSTEM=1`, so "none set" never depends on the machine's own git identity.

## Non-Goals (v1)

- **Hosted MCP / REST over Synk projects.** The natural Klub-tier follow-up: the same tool catalog served over authenticated transport against account-backed projects, enforced on the existing `lib/services/limits.ts` seam. Requires a device-token auth flow (shared open question with `arkaik push --to synk`, [services.md](services.md)). Specified when scheduled — nothing in this document precludes it.
- **Multi-bundle workspaces** — one server instance, one bundle.
- **Release ceremony** — CLI-only, above.
