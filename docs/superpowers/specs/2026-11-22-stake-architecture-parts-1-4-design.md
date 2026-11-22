# Stake architecture, parts 1 to 4: implementation design

Implements [`docs/rfcs/stake-architecture.md`](../../rfcs/stake-architecture.md) § 11, parts 1 to 4. Parts 5 (option and decision) and 6 (proof and statuses) are **not built**: their open calls are written up as a proposal for the owner (part 5 of this stack, docs only).

Owner calls taken on 2026-11-22, on top of the RFC's decisions:

| Call | Choice |
|---|---|
| Scope of this run | Parts 1 to 4, then a written proposal for 5 and 6 |
| Anchor | An **edge**, named **`concerns`**: stake → flow, view, data-model, api-endpoint |
| Signal ↔ stake link | **Both sides**: `metadata.evidence[]` on the stake (durable, written at qualification) and optional `stake_ids[]` on `request.filed` (when known at filing) |
| Interface in part 1 | **Panel and Library**: stakes list in the Library; the node panel gets a stake editor. No dedicated page. |

Field names follow [need qualification § 4](../../rfcs/need-qualification.md) where it already proposed one (`evidence`, `felt`, `matters`, `frequency`). The RFC's prose words map onto them: *kind* is `felt`, *mattering* is `matters`.

## Part 1. Schema (`stake` species)

**Vocabulary** (`packages/schema/src/ids.ts`, `id-gen.ts`):

- `SPECIES_IDS` gains `"stake"`, appended last. Prefix `STK-`.
- `EDGE_TYPE_IDS` gains `"concerns"`, appended last (`edgeTypesForSpeciesPair` order is pinned). `VALID_EDGE_SEMANTICS.concerns = [stake→flow, stake→view, stake→data-model, stake→api-endpoint]`. Not `acceptance`, not `decision`: the RFC anchors to the product's anatomy only. `impacts` stays decision-only and disjoint.

**New zod-free module** `packages/schema/src/stake.ts` (pattern: `decision.ts`), exported from `index.ts`:

- `STAKE_SPECIES_IDS = ["bug", "friction", "need", "requirement", "risk", "defect"]`, `StakeSpeciesId`.
- `STAKE_PROVENANCE_IDS = ["observed", "anticipated"]`. Absent reads as `observed`.
- `STAKE_LIFECYCLE_STATUSES = ["idea", "discovery", "archived"]`: the stored lifecycle carried over from weighing § 6. Every derived state (raised … addressed) is never stored.
- `ANTICIPATED_STAKE_SPECIES = ["need", "requirement", "risk", "defect"]` (RFC § 4: nothing exists yet to have a bug or a friction).
- `USER_FACING_STAKE_SPECIES = ["bug", "friction", "need"]`, `QUALITY_STAKE_SPECIES = ["requirement", "risk", "defect"]`.
- `STAKE_ANCHOR_SPECIES`, derived from `VALID_EDGE_SEMANTICS.concerns`.
- `STAKE_CATALOG_SOURCES = ["kritik", "values"]`.
- Readers: `stakeSpeciesOf(node)`, `stakeProvenanceOf(node)`, `stakeCatalogOf(node)`, `isUserFacingStakeSpecies(s)`.

**Metadata** (`NodeMetadata` interface and zod schema in `bundle.ts`, enums in `enums.ts`), all optional, additive, no `schema_version` bump:

```ts
stake_species?: StakeSpeciesId;
provenance?: "observed" | "anticipated";
catalog?: { source: "kritik" | "values"; id: string };  // a Kritik criterion id (SAF-01) or a value id (reduces-anxiety); nothing else is copied
```

An unknown `stake_species`, `provenance` or `catalog.source` is a parse-boundary error, as an unknown `decision_status` is.

**Validator** (`validate.ts`, a zod-free `stake-validate.ts` if it grows), **warnings only**, so a hand-edited bundle never bricks:

- `platforms-non-empty` exempts `stake` as it exempts `decision`.
- `stake-species-missing`: a stake without `stake_species`.
- `stake-species-wrong-species`: `stake_species`, `provenance` or `catalog` on a node that is not a stake.
- `stake-lifecycle`: a stake whose `status` is outside idea, discovery, archived.
- `stake-anticipated-species`: an anticipated bug or friction.
- `stake-catalog-mismatch`: requirement, risk or defect linked to `values`, or bug, friction, need linked to `kritik`.
- `stake-catalog-unknown-value`: `catalog.source: "values"` with an id outside `VALUE_IDS`.
- `stake-unanchored`: a stake with no outgoing `concerns` edge (allowed while an idea waits on an unnamed stake, hence a warning).
- The product-membership rule's message must not claim a stake's membership "is derived from consumers"; stakes store no product (they show under every scope, as decisions do).

**Exemptions shared with decisions**: no platforms; out of delivery and parity roll-ups; absent from the Journey, System and Screens maps (map `KIND_DEFAULTS` are allow-lists, leave them alone); no Canvas registration (placeholder in `graph-build.ts`, as decisions).

**Interface**: every compile-gated `Record<SpeciesId…>` and `Record<EdgeTypeId…>`; `lib/config/species.ts`; `lib/config/edge-types.ts`; `RELATION_LINE_ORDER`; species icon (lucide `Target`), hue, shape; Library card without a platforms block; `NodeDetailPanel` gets a `StakeEditor` (stake species, provenance, catalog link, lifecycle status limited to three values); `NewNodeForm` asks for the stake species when the species is `stake` and offers no platforms. A stake created from a panel's Relations "link new" gets `stake_species` left unset (the validator warns, the panel offers the picker).

**MCP**: enums already derive from `SPECIES_IDS`/`EDGE_TYPE_IDS`. `create_node` accepts `platforms: []` for a stake. `nodeSummary` shows `stake_species`.

**Docs**: `docs/graph-model.md` (species count, § Stakes, edge table, Canvas Visibility, dated Taxonomy Update Checklist note), `docs/spec/bundle-format.md` § Stake Nodes, `docs/spec/mcp.md`, the "6-species" lines (README, CLAUDE.md, `.github/copilot-instructions.md`, `docs/README.md`), and `opportunity` → `stake` in `docs/rfcs/weighing.md` and `docs/rfcs/need-qualification.md` (RFC § 13).

**Seed**: one stake in `seed/pebbles.json`, with its `concerns` edge.

## Part 2. Signal (`request.filed` generalised)

Extend `request.filed` **additively**; no new event type (every payload change so far was additive optionals; `JOURNAL_FAMILIES.intake` and every reader already know it). Only `title` stays required.

```ts
{ type: "request.filed",
  title: string, description?: string,
  source?: string,          // unchanged FREE string, the source's name; never retyped
  node_id?: string,         // unchanged
  source_kind?: "ticket" | "interview" | "form" | "feedback" | "audit-finding" | "idea" | "benchmark" | "other",
  verbatim?: string,        // exactly as voiced, never edited
  provenance?: "observed" | "anticipated",   // absent reads observed
  stake_ids?: string[],     // stakes known at filing time
  finding_id?: string,      // source_kind audit-finding: the Kritik finding (never put F-… ids in node_id/stake_ids)
  criterion_id?: string,    // audit-finding: its criterion
  url?: string }
```

`SIGNAL_SOURCE_KINDS` lives zod-free in `journal.ts` (pattern: `SCREENSHOT_SOURCES`).

**Stake side**: `metadata.evidence?: { event_id?: string; quote?: string; voice?: "person" | "maintainer" | "agent"; date?: string }[]`, on stakes. The durable signal → stake link: qualification (part 3) writes it.

**Readers**:

- `computeBacklog`: a signal is closed when its `node_id` exists, **or** any of its `stake_ids` exists, **or** an existing stake's `evidence[].event_id` cites it.
- `computeNodeTimeline`: a stake's timeline lists the signals linked either way.
- Journal row describers (`describe-event.ts`, `FeedRow`, CLI `render-event.ts`) show the source kind.
- `crossCheckJournal`: a dangling `stake_ids` entry is a warning, never an error.
- A benchmark signal is a signal like any other; it simply never counts toward frequency or mattering (enforced by whoever reads frequency: nothing does yet).
- Pollen does not project signals (unchanged).

**MCP** `file_request` takes the new fields. It stays repo-only (hosted journal-only writes are refused today; unchanged).

**"Suggested by"**: the link runs from an option to the signal that seeded it. Options are part 5, so nothing is built; the proposal records that the option will carry `suggested_by: <event id>`.

## Part 3. Qualification (species routing first)

A pure, zod-free `packages/schema/src/qualify.ts`:

- `routeSpecies(answers)`: the RFC § 3 decision as a table. Facts in (door collect or imagine; facing value or quality; value: broken, as-designed or absent → bug, friction, need; quality: obligation, own-flaw, mitigable-only → requirement, defect, risk; the need-qualification gate routes product, internal, off-scope), a route out. The imagine door refuses bug and friction with "reroute as need". Anything routed out, or inferred, is handed to a person. A `ROUTING_QUESTIONS` table is the single source for tool descriptions and skill text.
- `findMergeCandidates(signal, stakes)`: same stake species only; scored by catalog id plus anchor, anchor overlap and title/verbatim token overlap; deterministic order; archived candidates flagged, never hidden; never auto-merges.
- `planSignalToStake` / `planSignalMerge`: pure `MutationOp[]` (create a `STK-` node at `idea` with `stake_species`, `provenance`, `evidence[]`, optional `catalog`, plus one `concerns` edge per anchor; or append one evidence entry to an existing stake, de-duplicated by `event_id`). The caller applies them.

**MCP**: `qualify_signal` (read: routing plus merge candidates) and `promote_signal` (write: op-only, so it works hosted too). The catalog grows by two; the count test follows.

**Skill**: `docs/arkaik-skill/skill.md` gains the qualification steps; the need-qualification RFC's first step reads as species routing.

## Part 4. Evaluation (a reference declares its species)

- A criteria set declares what it scores: `subject` stays (`acceptance`), and a new optional `stake_species?: StakeSpeciesId[]` says which stakes it may also score. `value-contribution@2` declares `["bug", "friction", "need"]`. **Trap**: if the set fingerprint or version covers this field, scored cells would go stale; the declaration must not change any existing cell's freshness (prove it in a test).
- `referenceForStakeSpecies(species)`: bug, friction, need → `{ kind: "weighing-set", set: "value-contribution@2" }`; requirement, risk, defect → `{ kind: "kritik" }`.
- Assessments may target a stake of a declared species; the planner refuses a stake whose species the set does not declare (a new write), and the validator warns on such rows already stored. Kritik criteria are never written into the weighing section.
- Stake metadata, user-facing species only: `felt?: "expected" | "wanted" | "delight"`, `matters?: 1 | 2 | 3 | 4`, `frequency?: "rare" | "some" | "often"`. Warnings: a bug whose `felt` is not `expected`; any of the three on a requirement, risk or defect.
- `kritikCriticality(criterionId, library, finding?)` reads `default_impact` and `weight` from the criterion, and the finding's severity when a finding raised the stake. Nothing is restated on the stake.
- Never rank across kinds or species: no helper sums `matters` with a pyramid level or with Kritik criticality.
- Interface: the stake editor shows felt, matters and frequency for the user-facing species and the criterion's criticality, read only, for the others.
