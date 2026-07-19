---
title: "Spec: Acceptance & Value model"
navTitle: "Spec: Acceptance & Value"
order: 95
---

# Acceptance & Value Model — Design Spec

> Status: **Validated design** (brainstormed and approved section-by-section, 2026-07-19).
> Scope: deep spec for **Foundation**, **Surfaces**, and **Retro-population**; outlines for **Objectives/time-series** and **Navigation remediation** (own specs later).

## 1. Intent

Platform status at the view level is too coarse to be truthful: inside "Pebble Detail", the draw-in animation is live on iOS only, the Emotion palette is missing on web, the Snap display is missing on iOS. The unit where per-platform status is *meaningful* is the **acceptance**: a short name (the What), one Given/When/Then scenario (the How), and one or more value elements (the Why), with a status per applicable platform.

Arkaik's job — navigate a complex multi-platform product, spot parity gaps precisely, see what's missing, prioritize rationally — is served by monitoring acceptances, not boxes. Views, flows, and the product become *aggregates* of acceptances.

## 2. Decisions record

| Question | Decision |
|---|---|
| Shape of the unit | One flat entity: name + one Gherkin + values + per-platform status. No epic species; grouping emerges from anchors. |
| Name | Species `acceptance`, id prefix `AC-`. |
| Stored status home | Acceptances store per-platform status. View per-platform status becomes **computed with fallback** to its stored (deprecated) `platformStatuses`. |
| Components | Not reintroduced. Sub-view granularity = acceptances; render variants = Given clauses. |
| Value taxonomy | Full Bain B2C pyramid (30 elements, 4 tiers) as a **fixed core enum** in `ids.ts`. |
| Bundle representation | 5th species in `nodes[]` + new `covers` edge type (chosen over a parallel `acceptances[]` plane and over embedded metadata). |
| Acceptance list layout | Parity matrix grouped by anchor (option A). |
| Pyramid view layout | Element gauge grid, no silhouette (option B), **with an icon per value element**. |
| Scope | Foundation + Surfaces + Retro-population deep; Objectives/time-series + Navigation remediation outlined. |

## 3. Domain model

### 3.1 Species `acceptance`

`SPECIES_IDS` gains `"acceptance"` (5th entry); `id-gen.ts` gains prefix `AC-` with the same deterministic title-derived id scheme. Acceptances reuse the existing `Node` shape:

- `title` — the **What**. Short, scannable, imperative-ish: "Pebble draw-in animation", "Buy a community glyph (30 Karma)". Lists show this.
- `description` — optional free context (rationale, links prose).
- `metadata.gherkin` (new, string) — the **How**: exactly **one** Given/When/Then scenario as a single text field. A second scenario is a second acceptance. `Given` clauses encode render variants ("Given the pebble has a picture attached…"). Missing on an acceptance ⇒ validator **warning** (title-only drafts are legal).
- `metadata.values` (new, `ValueId[]`) — the **Why**: 1..n elements from `VALUE_IDS`. Empty/missing ⇒ **warning**. Unknown id ⇒ **error**.
- `platforms` — the **applicable** platforms (the "availability" filter). A haptics acceptance is `[ios, android]`; web is *not expected*, not "backlog".
- `status` + `metadata.platformStatuses` — same mechanic views use today: `status` is the base; per-platform entries override. Statuses reuse the existing 8 (`live` = "shipped"). `platformStatuses` keys must be ⊆ `platforms` (error, same rule as views).

`gherkin` and `values` are typed optional fields on `NodeMetadata` (zod + JSON Schema). Present on a non-acceptance species ⇒ warning.

### 3.2 Value taxonomy (core enum)

New in `packages/schema/src/ids.ts`, beside `STATUS_IDS`/`PLATFORM_IDS`:

```ts
export const VALUE_TIER_IDS = ["functional", "emotional", "life-changing", "social-impact"] as const;

export const VALUE_IDS = [
  // functional (14)
  "saves-time", "simplifies", "makes-money", "reduces-risk", "organizes",
  "integrates", "connects", "reduces-effort", "avoids-hassles", "reduces-cost",
  "quality", "variety", "sensory-appeal", "informs",
  // emotional (10)
  "reduces-anxiety", "rewards-me", "nostalgia", "design-aesthetics", "badge-value",
  "wellness", "therapeutic-value", "fun-entertainment", "attractiveness", "provides-access",
  // life-changing (5)
  "provides-hope", "self-actualization", "motivation", "heirloom", "affiliation-belonging",
  // social-impact (1)
  "self-transcendence",
] as const;

export const VALUE_TIERS: Record<ValueId, ValueTierId> = { /* fixed element → tier map */ };
```

Zod wrappers in `enums.ts`; flows into the MCP tool schemas, both validators, the published JSON Schema, and the skill reference through the existing generation pipeline. The `lib/config/values.ts` UI mirror carries per-element: label, tier, tier color, and a **lucide icon** (30 icons, chosen at implementation time; each element renders icon + label everywhere it appears).

Per-project taxonomies are an explicit non-goal (§12); future B2B-style elements are additive enum extensions.

### 3.3 Edge `covers`

`EDGE_TYPE_IDS` gains `"covers"`. Admissibility (in `VALID_EDGE_SEMANTICS` and both validators):

```
covers: [[acceptance, view], [acceptance, flow]]
```

- **0 edges** — product-level acceptance ("Offline pebble capture"). Legal; exempt from orphan/health warnings.
- **1 edge** — the common case: anchored to one view or one flow.
- **n edges** — spans surfaces ("Given I carve a glyph, Then it appears on my Soul" covers `V-glyph-carve` and `V-soul-detail`).

Anchoring to `data-model`/`api-endpoint` is not admitted initially (additive later if needed).

### 3.4 Status semantics & rollups

Stored per-platform status has exactly one home going forward: acceptances. Rollups become uniform:

- **Acceptance** (stored): resolved status for platform *p* = `metadata.platformStatuses[p]` else `status`. Only defined for *p* ∈ `platforms`.
- **View** (computed): per-platform gauge = distribution of resolved statuses (for *p*) of the acceptances covering it whose `platforms` include *p*. **Fallback:** a view covered by zero acceptances uses its stored `metadata.platformStatuses` as today (kept, marked deprecated in docs and UI copy). Views keep their single `status` field as the base lifecycle value.
- **Flow** (computed, extended): today's descendant-view rollup **plus** the resolved statuses of acceptances covering the flow directly.
- **Product** (computed): all acceptances; drives Overview gauges.

Rollup logic lives in `lib/utils/platform-status.ts` / `journey-graph.ts` extensions plus a schema-level projection so the MCP/CLI can serve the same numbers.

### 3.5 Parity gap (derived, not stored)

An acceptance has a **parity gap** iff at least one applicable platform's resolved status is `live` and at least one other applicable platform's is not (`archived` acceptances excluded). The projection takes the delivered-threshold as a parameter (default `{live}`; callers may pass `{live, releasing}`). Exposed as: a filter in the Acceptance list, a count on Overview, a `parity_gap` filter on `list_nodes`, and a per-anchor count in matrix group headers.

### 3.6 Reserved: objectives

Species `objective` (`OBJ-`) and edge `serves: [[acceptance, objective]]` are **named here and not built**. Adding them later is purely additive (no migration). Foundation must not squat the `OBJ-` prefix or `serves` name.

## 4. Validation

Both the zod validator (`packages/schema/src/validate.ts`) and the zod-free standalone port stay parity-tested. New rules:

| Rule | Severity |
|---|---|
| `covers` edge with source/target species outside §3.3 | error |
| `metadata.values` entry not in `VALUE_IDS` | error |
| `platformStatuses` key ∉ `platforms` (now also for acceptances) | error |
| acceptance missing `gherkin` | warning |
| acceptance missing/empty `values` | warning |
| `gherkin`/`values` on non-acceptance species | warning |
| acceptance with 0 `covers` edges | **no finding** (product-level is legal) |

Health projection gains **uncovered views** — views no acceptance covers — as the coverage/"what's missing" metric (informational, not a validation finding).

## 5. Journal & backdating

**No new event vocabulary.** `node.created/updated/status_changed/deleted` and `edge.added/removed` cover acceptances; `node.status_changed` already carries the optional `platform` field.

**Foundation change — order by `ts`:** all projections that consume the journal (changelog, release pulse, coverage, future time-series) must order by the event's `ts` field, never by file/append order, and tolerate out-of-order appends. This is what makes retro-population (§10) able to append events *now* with historical timestamps. Covered by tests. Backfilled events use a distinct `actor` (e.g. `backfill-agent`); ULID ids are minted at append time (no requirement that ULID time = `ts`).

## 6. MCP & CLI

Extend, don't multiply — no new tool family:

- `create_node` / `update_node` / `delete_node` / `add_edge` / `remove_edge` work on acceptances as soon as the enums land (species/edge enums are spliced from `ids.ts`). The playlist/composes synthesis logic is untouched.
- `list_nodes` gains filters: `value` (ValueId), `anchor` (node id — acceptances covering it), `parity_gap` (boolean).
- Node summaries for acceptances include `platform_statuses` and `values` in addition to `{id,title,species,status,platforms}` — without this, reading parity costs one `get_node` per acceptance.
- `get_node` on a view/flow includes a `covered_by` section (acceptance summaries); on an acceptance, its `covers` anchors with titles.
- CLI: no new commands. `arkaik sync`/`release`/`push` are unaffected.

## 7. Skill v3.0.0

The skill's discipline changes (canonical source `docs/arkaik-skill/skill.md`, regenerated into the plugin and rendered by `arkaik init`):

- **Ship → update the acceptance, not the view.** When user-visible behavior ships on a platform, set the covering acceptance's `platformStatuses[platform]`; create the acceptance if none exists. View `platformStatuses` is legacy fallback — never write it on covered views.
- **Gherkin rules:** one scenario per acceptance; `Given` encodes variants; keep titles short (the What), scenario precise (the How).
- **Value mapping with progressive disclosure** (the token toggle): the SKILL body says "assign 1–3 values; if unsure, omit — an enrichment pass exists"; the 30-element cheat sheet (one-line definitions + Pebbles-flavored examples) lives in `references/values.md`, consulted only when actually mapping. `arkaik init` gains a template flag to render the skill without the values section entirely.
- Version bump to `3.0.0`; pbbls upgrades via `arkaik init --update`.

## 8. Migration & compatibility

**Additive — no bundle transform, `schema_version` stays 2.** A v2 bundle without acceptances is untouched and valid.

- **Ordering constraint:** repo-local validators (e.g. pbbls CI) reject unknown species, so skill v3 + its bundled validator must land in a consumer repo **before** any agent writes acceptances there. `arkaik init --update` ships both together.
- View `metadata.platformStatuses` is kept as deprecated fallback (§3.4); no data is rewritten or deleted.
- Publik/Synk ingress revalidate through the shared schema on deploy; bundles are stored verbatim (jsonb) — **no Postgres migration**. Deploy the arkaik app (new schema) before consumers push acceptance-bearing bundles.
- The Taxonomy Update Checklist (`docs/graph-model.md`) applies: `ids.ts` → zod wrappers → both validators → `lib/config/*` mirrors → `npm run generate` (JSON Schema, skill reference, plugin, prompt fragments) → CI drift gate green.

## 9. Surfaces

### 9.1 Acceptance list — parity matrix (route `/project/[id]/acceptances`)

Chosen layout: **parity matrix grouped by anchor**.

- Rows = acceptances; one status-dot column per platform; `—` for non-applicable platforms; value chips (icon + label) on each row.
- Rows grouped under collapsible anchor headers (view/flow, with species tag and per-group acceptance + gap counts); a **Product-level** group last. An acceptance covering n anchors appears under each (badge marks duplicates).
- Rows with a parity gap get an amber edge marker.
- Filter bar: free-text search · platform · status · value · anchor · **parity-gaps-only** toggle. Filters compose; state in the URL (shareable).
- Row click opens the existing `NodeDetailPanel` slide-over: title, Gherkin (editable), values picker (icon grid), per-platform status editor, covered anchors (click-through), history.

### 9.2 Pyramid view (route `/project/[id]/pyramid`)

Chosen layout: **element gauge grid** (no silhouette).

- Four titled tier sections (functional → social-impact), each a responsive grid of element cards: **icon + element label**, status-distribution bar (reusing the `PlatformGaugeList` idiom), acceptance count. Unserved elements render muted with an empty bar — the value-level "what's missing" radar stays visible.
- Platform chip row (All · Web · iOS · Android) recomputes all bars.
- Element card click → Acceptance list pre-filtered on that value.

### 9.3 Integrations

- **Sidebar:** "Acceptances" entry in the Library group linking to the **parity matrix route** (`/acceptances`, §9.1 — not the generic `library?species=` filter); "Pyramid" entry in the Project group.
- **Node detail panel (views/flows):** new "Acceptances" section — per-platform dots per covering acceptance, parity flag, "add acceptance" affordance — displayed *above* the legacy platform-variants editor, which collapses once the node is covered.
- **Delivery board:** `acceptance` joins the species toggle; cards become (acceptance × platform) — the atomic parity unit.
- **Library:** acceptances appear as a species there too (gallery card shows title + gherkin preview + value icons + platform dots).
- **Overview:** new **Parity card** (gap count, worst-offending anchors, link to pre-filtered matrix) and **Pyramid mini-card** (four tier gauges, links to Pyramid).

## 10. Retro-population program (runs in pbbls)

Standalone GitHub issues executable by independent Opus agents; every issue self-contained (scope, inputs, skill discipline, validation command, PR format). Four passes:

1. **Seeding — current state first.** One issue per flow (11) + orphan-view clusters (~2–4). Agent reads all three platforms' code for the flow's views; drafts acceptances (title, one Gherkin, `platforms`, 1–3 values); adds `covers` edges; sets per-platform statuses from **what the code does today**. Yield estimate: 150–300 acceptances over 62 views. Parity monitoring is real when seeding completes.
2. **History mining — backdated journal.** Issues sliced per platform × time window (conventional-commit scopes `android`/`ios`/`ui`/`admin`, milestones M42–M44 as anchors). Agents walk merged PRs via `gh`, map PRs → acceptances, append `node.status_changed` events with `ts` = PR merge date, `actor: backfill-agent`. **Journal-only**: if mining contradicts seeded current state, the codebase wins; the discrepancy is logged in the issue, never silently written.
3. **Enrichment & consistency.** One sweep agent: uniform value mappings across feature families, fill missing values, flag weak Gherkin. Also the standing remedy for values omitted at create time.
4. **Verification.** pbbls CI validator gate (already wired) + one human-review issue: skim the parity matrix for false claims; spot-check a sample against the running apps.

Prerequisites: Foundation shipped; skill v3 landed in pbbls (§8 ordering constraint).

## 11. Testing

- **Schema:** unit tests for new enums, `covers` admissibility, new validation rules (each severity), zod ↔ standalone validator **parity tests** extended to every new rule.
- **Rollups:** unit tests for acceptance→view/flow/product rollup incl. fallback path and applicable-platform subsetting; parity-gap projection incl. threshold parameter.
- **Journal:** projections order by `ts` with out-of-order appends (backdating scenario test).
- **MCP:** tool-schema snapshot tests (enums spliced), `list_nodes` new filters, enriched summaries.
- **Generation:** `npm run generate` drift gate (existing CI) covers JSON Schema/skill/plugin outputs.
- **UI:** rollup/filter logic extracted into `lib/utils` and unit-tested; surfaces verified by driving the app (seeded Pebbles bundle gains acceptances so `seed/pebbles.json` exercises everything).

## 12. Non-goals

- No `component` species, ever, in this line of work.
- No epic/story hierarchy; no second aggregate entity.
- No per-project value taxonomies.
- No objectives implementation (reserved names only, §3.6); no time-series computation.
- No Journey/System map or Library navigation redesign (follow-up spec).
- No new journal event vocabulary; no `schema_version` bump.

## 13. Follow-up specs (outlined, own brainstorms later)

- **Objectives & time-series:** `objective` species + `serves` edge; objective progression = % of served acceptances live, per platform; journal replay by `ts` plots value/objective completion per period (quarter) — retroactively real thanks to §10 backdating. Open questions: period semantics, targets, Overview treatment.
- **Navigation remediation:** Journey map multi-expand + URL-persisted expansion + breadcrumb; System map scoping (species/status/platform filters, saved `MapDefinition`s); Library status/platform/value filters.

## 14. Phasing → issues (for writing-plans)

1. **Foundation** (arkaik): enums + metadata fields + `covers`; validation rules ×2 validators + parity tests; rollup/parity projections; journal `ts`-ordering; MCP extensions; skill v3 + init flag; config mirrors (incl. 30 value icons); `npm run generate`; seed update.
2. **Surfaces** (arkaik, after 1): Acceptance list; Pyramid; panel/sidebar/delivery/library/overview integrations.
3. **Retro-population** (pbbls, after 1, parallel with 2): skill v3 rollout issue; ~13–15 seeding issues; ~6–10 mining issues; 1 enrichment; 1 verification.
4. **Follow-up briefs**: two brainstorm-first issues (objectives/time-series; navigation remediation).
