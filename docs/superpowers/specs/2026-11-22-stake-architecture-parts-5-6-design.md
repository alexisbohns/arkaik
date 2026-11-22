# Stake architecture, parts 5 and 6: implementation design

Implements [`docs/rfcs/stake-architecture.md`](../../rfcs/stake-architecture.md) § 11, parts 5 (option and decision) and 6 (proof and statuses), as the owner settled them in § 14.0 on 2026-11-22. Parts 1 to 4 are in [the parts 1–4 design](./2026-11-22-stake-architecture-parts-1-4-design.md); this document follows its shape.

Owner calls taken on 2026-11-22, on top of § 14:

| Call | Choice |
|---|---|
| MCP tools (§ 14.4 left it open) | **Both**: `decide_option` (op-only write) ships with the decision planner; `stake_proof` (read) ships with the proof reader. The catalog goes 35 → 37. |
| Interface (§ 14.5 left it to a design round) | **Minimal**: an option gets what every species needs to render (icon, hue, shape, Library, node panel, new-node form) and a small read-only panel group; the stake editor shows the derived state read-only. No page, no option comparison, no decision wizard. |

## The stack

Four parts, one branch and one PR each, chained with `gh stack`. RFC part 5 is split in two (vocabulary, then the write), and RFC part 6 in two (the stored inputs, then the reader), so each PR is reviewable on its own.

| Part | Branch | Ships | Lab Note |
|---|---|---|---|
| A | `stake/7-option-schema` | Species `option`, edge `addresses`, the widened `generates` and `impacts` pairs, `suggested_by` and `closed_options`, the answer-type table, validator warnings, the option in the interface | Yes |
| B | `stake/8-decide` | Closure, answer and promise readers; the pure select-option planner; MCP `decide_option` | Yes (agents can now decide) |
| C | `stake/9-criterion-version` | A version per Kritik criterion; the two stake fields `reverify_every_days` and `verified_criterion_version` | No (`no-lab-note`) |
| D | `stake/10-proof` | The pure proof reader; MCP `stake_proof`; the derived state in the stake editor; RFC status flipped to built | Yes |

Part A is one release on its own merits: an older validator rejects the new species and edge type (RFC § 14.2). No part bumps `schema_version`; every new field is optional.

## Part A. Option vocabulary

**Vocabulary** (`packages/schema/src/ids.ts`, `id-gen.ts`):

- `SPECIES_IDS` gains `"option"`, appended last. Prefix `OPT-`.
- `EDGE_TYPE_IDS` gains `"addresses"`, appended last. `VALID_EDGE_SEMANTICS.addresses = [option→stake, acceptance→stake, acceptance→option]`.
- `generates` gains `decision→option`; `impacts` gains `decision→stake`. The comment that called the two disjoint is rewritten: they stay disjoint **by pair** (no pair is admitted by both), and the meaning of a decision edge now depends on its target species (call 2's cost).

**New zod-free module** `packages/schema/src/option.ts` (pattern: `stake.ts`), exported from `index.ts`:

- `OPTION_LIFECYCLE_STATUSES = STAKE_LIFECYCLE_STATUSES` (idea, discovery, archived). Selected, closed and open are derived.
- `ANSWER_TYPE_IDS = ["fix", "enhancement", "feature", "diligence", "mitigation", "resolution"]`, `AnswerTypeId`.
- `ANSWER_TYPE_FOR_STAKE_SPECIES: Record<StakeSpeciesId, AnswerTypeId>`: bug → fix, friction → enhancement, need → feature, requirement → diligence, risk → mitigation, defect → resolution (RFC § 3). Nothing stored on the option.
- Readers: `optionSuggestedByOf(node)`, `closedOptionsOf(decision)` (well-formed `{ option_id, reason }` entries only), `stakesAddressedBy(optionId, nodes, edges)`, `optionsAddressing(stakeId, nodes, edges)`, `answerTypesOf(optionId, nodes, edges)` (the distinct answer types of the stakes it addresses).

**Metadata** (`NodeMetadata` and its zod schema in `bundle.ts`), all optional, inlined shapes (the generated types block cannot see named types):

```ts
suggested_by?: string;                                   // option: the request.filed event id that seeded it (call 12)
closed_options?: { option_id: string; reason: string }[]; // decision: why each loser lost (call 3)
```

**Validator** (`validate.ts`), **warnings only**:

- `platforms-non-empty` exempts `option` (as `decision` and `stake`); the product-membership message counts it among the species that store none.
- `option-lifecycle`: an option whose `status` is outside idea, discovery, archived.
- `option-unaddressed`: an option with no outgoing `addresses` edge to a stake (an option never exists without a stake, § 7).
- `option-mixed-answer-types`: an option addressing stakes of two answer types.
- `option-field-wrong-species`: `suggested_by` on a non-option; `closed_options` on a non-decision.
- `decision-multiple-stakes`: a decision that `impacts` more than one stake.
- `decision-multiple-options`: a decision that `generates` more than one option.
- `decision-option-not-addressing`: a decision generates an option that does not address the stake it impacts.
- `stake-multiple-decisions`: a stake impacted by more than one approved or enacted decision.
- `decision-closed-option-unknown`: a `closed_options` entry naming no option.
- `crossCheckJournal`: `option-suggested-by-dangling` when a non-empty journal holds no event with that id (pattern: `journal-dangling-stake-ref`).

**Interface**: every compile-gated `Record<SpeciesId…>` / `Record<EdgeTypeId…>`; the silent-miss tables the code map lists (`EDGE_TYPES`, `RELATION_LINE_ORDER`, `SPECIES_SHAPE`, the four CSS hue files, `SPECIES`, the Library card and row chains, `NewNodeForm`); icon lucide `Lightbulb`; hue `--tone-neutral` (a hypothesis, not yet chosen; it is the one tone no species claims); no Canvas registration; no delivery or parity exemption code (empty `platforms` excludes it by construction). `generates.out` relabels from "Generated acceptances" to "Generates"; the Decision Log's "Generated acceptances" and "Impacted surfaces" tiles split by target species, or say "Generated" and "Impacts", so an option or a stake never reads as an acceptance or a surface. An `OptionGroup` in the node panel: lifecycle status (three values), the answer type(s), `suggested_by` read only. `NewNodeForm`: no platforms, status `idea`.

**MCP**: `create_node` description says an option takes `platforms: []`; `nodeSummary` shows an option's answer types. **Docs**: species counts (7 → 8) everywhere the code map lists; `graph-model.md` § Options, edge table, a dated Taxonomy Update Checklist note; `bundle-format.md` § Option Nodes, the decision edge table and warnings; `mcp.md`; `docs/arkaik-skill/references/schema.md` hand-written sections. **Seed**: one option in `seed/pebbles.json`, addressing `STK-pebble-reveal-too-slow`, with its journal events. **Fixtures**: `option-valid`, `option-warnings`, `option-invalid-edge`, registered in both fixture lists.

## Part B. The decision

Readers in `option.ts` (zod-free), all derived, never stored:

- **Stake decisions**: decisions with an `impacts` edge to the stake. A decision *settles* the stake when its `decisionStatusOf` is `approved` or `enacted`.
- **The answer** (`answerFor(stakeId, …)`): the option generated by the settling decision; `undefined` when none, or when the data is ambiguous (two settling decisions: the validator warns, and the reader takes the latest by `decided_at`, then by id, and says so).
- **Closure** (`optionClosureFor(optionId, stakeId, …)`): `selected` when the settling decision generates it; `closed` (with the reason from that decision's `closed_options`, or none) when a settling decision generates another option; `open` otherwise. A rejected, deprecated or superseded decision reopens (call 3).
- **Promise role** (`isPromise(acceptanceId, …)`, `promisesOf`): an acceptance an approved or enacted decision generates directly, or that `addresses` an option such a decision generates, or that resolves to `live` on a platform it applies to (call 4). A **candidate** is an acceptance at `idea` or `discovery` that is not a promise.

**Planner** `planSelectOption(input)` (pure, `MutationOp[]`, pattern: `planSignalToStake`):

```ts
interface SelectOptionInput {
  projectId: string;
  stakeId: string;
  optionId: string;
  reason: string;                                  // why this option: the decision's context
  closed?: { option_id: string; reason: string }[]; // why each loser lost
  title?: string;                                  // defaults to `Select "<option>" for "<stake>"`
  status?: "approved" | "enacted";                 // default approved
  supersede?: boolean;                             // required when the stake already has a settling decision
  decidedAt?: string;                              // ISO date, written to metadata.decided_at
  nodes: Node[]; edges: Edge[];
}
```

- Refuses (no ops) when: the stake or option is missing or of the wrong species; the option does not `addresses` the stake; the option is archived; `reason` is empty; the stake already has a settling decision and `supersede` is not set; a `closed` entry names an option that does not address the stake.
- Creates the decision (`DEC-…` from the title, `platforms: []`, `status: lifecycleStatusForDecision(status)`, `metadata: { decision_status, context: reason, decided_at?, closed_options }`), its `impacts` edge to the stake and its `generates` edge to the option.
- `closed_options` lists **every other non-archived option addressing the stake**; one with no reason given gets the reason `Not selected: "<selected title>" was chosen.` and is named in `handToHuman`.
- With `supersede`, the previous settling decision is updated to `superseded` (status `archived`, through `update_node`, so the journal records `decision.status_changed`) and a `supersedes` edge runs from the new decision to it.
- Returns `{ action: "decide" | "refused", ops, decision_id?, reasons, handToHuman }`.

**MCP** `decide_option` (in a new `packages/mcp/src/decide-tools.ts`, pattern: `qualify-tools.ts`'s `promote_signal`): op-only, so it works hosted; no `actor` argument (the server stamps it); `decidedAt` defaults to today. Catalog 35 → 36. **Skill**: `docs/arkaik-skill/skill.md` replaces "Options and decisions are not yet part of this skill" with the ideate and decide steps.

## Part C. The stored inputs of the proof

**A version per Kritik criterion** (the approved exception to § 5 rule 2):

- `packages/kritik-library/framework.json`: every criterion gains `"version": 1`, after `weight`, keeping the file's one-space indent. The framework's own `version` (0.1.0) does not move: the pack's criteria keep their meaning, and bumping it would mark every saved Kritik plan as moved.
- `KritikCriterion.version?: number` (`quality.ts`) and its zod field (`quality-schemas.ts`, lenient `z.number()`, as `default_impact`). An integer counter, not semver: the only question is "changed since I verified it". Absent reads as 1 (a vendored, synthesized or overlay library has none).
- `mergeKritikLibrary`: an overlay that replaces a pack criterion without a `version` keeps the pack's.
- The custom-criterion scaffold (`cli/kritik-overlay.ts`) writes `version: 1`.
- `SPEC.md` § 5 gains the field; § 8 says a changed definition or level anchors bump the criterion's version and keep its id, and that a replacement still supersedes.
- `kritikCriterionVersion(criterionId, library)` in `stake-evaluation.ts`: the version, 1 when absent, `undefined` for an unknown id. Never throws.

**Two stake fields** (`stake.ts`, `bundle.ts`, `StakeFieldChange`, `stakeMetadataWith`):

```ts
reverify_every_days?: number;        // call 9: the verified half expires this many days after the latest check
verified_criterion_version?: number; // call 7: the Kritik criterion version a requirement was last verified against
```

- `verified_criterion_version` is for quality species with a `kritik` catalog link; `stakeMetadataWith` drops it when the species or the catalog link stops fitting.
- Warnings: `stake-reverify-invalid` (not a positive number), `stake-criterion-version-invalid` (not a positive integer), `stake-criterion-version-unlinked` (set on a stake without a Kritik catalog link). Both join the `stake-species-wrong-species` field list.
- The stake editor gets the interval (a number field, "Re-verify every N days"); the version stays agent- and MCP-written.

## Part D. The proof reader

A pure, zod-free `packages/schema/src/stake-proof.ts`:

```ts
export const PROOF_EVENT_TYPES = [
  "node.created", "node.status_changed", "decision.status_changed",
  "quality.finding.opened", "quality.finding.resolved", "quality.finding.accepted",
  "quality.assessment.scored",
] as const;

export const STAKE_STATES = ["raised", "considered", "promised", "verified-not-delivered", "partly-addressed", "addressed"] as const;

deriveStakeProof(input: {
  stakeId: string;
  nodes; edges;
  events?: JournalEvent[];         // any events; the reader keeps PROOF_EVENT_TYPES
  now: Date | string | number;
  project?: Pick<Project, "metadata">; productId?: string | null;  // the active product scope
  library?: KritikLibrary;          // for the criterion version
  quality?: QualitySection;         // findings and assessments stored in the bundle
  weighing?: WeighingSection;       // for "considered" on the user-facing kinds
}): StakeProof | null               // null: not a stake

interface StakeProof {
  stake_id: string;
  stake_species?: StakeSpeciesId;
  answer_type?: AnswerTypeId;
  state: StakeStateId | null;       // null when the stake is archived (call 11)
  answer?: { decision_id: string; option_id: string };
  definition_of_done: string[];     // acceptance ids; empty for a requirement
  delivery: "required" | "optional" | "not-required";
  cells: ProofCell[];               // one per platform concerned; one platform-less cell for a requirement or when no platform resolves
  reasons: string[];                // why the state is what it is, in words
}

interface ProofCell {
  platform: PlatformId | null;
  verified: boolean;                // the half holds and is not stale
  delivered: boolean;
  stale: boolean;                   // expired interval or newer criterion version
  checked_at?: string;              // the latest check this cell's verified half rests on
}
```

`node.created` is added to the RFC's list because call 7's pass needs the date the stake was raised.

**Rules.**

- **Required halves** (RFC § 8): bug, friction, need need both; requirement, risk and defect need the verified half only. Delivery reads `optional` for requirement and defect and `not-required` for risk; an optional delivery is reported in the cells and never required for *addressed*. "Case by case" has no stored switch yet (not built; named in the RFC).
- **Definition of done.** For every species except requirement: the non-archived acceptances that `addresses` the answer option, plus the acceptances that `addresses` the stake directly and read as promises (the quick-win path of call 4). For a requirement: its Kritik criterion, through `metadata.catalog`.
- **Platforms concerned** (call 8): the union of the definition-of-done acceptances' effective platforms in the active product's scope (`effectiveNodePlatforms`). A requirement, or a definition of done that resolves no platform, gets one platform-less cell.
- **Verified on a platform** (call 6): every definition-of-done acceptance that applies there resolves to `releasing` or `live`, and none is archived. **Delivered**: every one resolves to `live`.
- **Verified for a requirement** (call 7): no open finding whose criterion is the stake's and whose `node_ids` meet the stake's `concerns` anchors (a finding's status is the stored section's when the section holds it, else the journal replay's: opened, then resolved or accepted), **and** at least one score of the criterion dated after the stake was raised, with the latest such score on every surface at or above `DEFAULT_TARGET_LEVEL` (3). Scores come from the section's assessments and from `quality.assessment.scored` events. The raised date is the stake's `node.created`, else its earliest evidence date, else unknown (then every score counts).
- **Staleness.** With `reverify_every_days` set, a cell is stale when its latest check is older than the interval at `now`, or has no dated check. The latest check is the latest `node.status_changed` into `releasing` or `live` for each definition-of-done acceptance on that platform (a platform-less event counts for a platform without its own entry), and the cell takes the oldest of those; for a requirement, the latest score or finding closure on the criterion. A requirement is also stale when the library's criterion version is newer than `verified_criterion_version`; an absent stored version is not stale on that axis.
- **The ladder** (call 5), top rule first, on a non-archived stake: *addressed* (an answer or a promise exists, and every required half holds on every cell), *verified-not-delivered* (delivery required, delivered on no cell, verified on every cell), *partly-addressed* (some required half holds on some cell), *promised* (a settling decision's answer has a definition of done, or a promise addresses the stake directly; a stale verification lands here), *considered* (an option or a candidate acceptance addresses the stake; or, user-facing, a weighing assessment of the stake or a `matters` score; or, quality, a Kritik catalog link), *raised*.
- Lenient and total: unknown values, malformed events and unparseable dates degrade, never throw. `now` is always an argument.

**MCP** `stake_proof` (read; in `decide-tools.ts` or its own file): one stake by id, or every stake, with the active product optional. Catalog 36 → 37.

**Interface**: the stake editor shows the state as a read-only chip and the cells as a small row of platform marks (verified, delivered, stale), computed with the journal the app already loads (`useJournal`) and the quality data when present. No new page.

**Docs**: RFC § 8, § 10, § 11 (parts 5 and 6 shipped, "What parts 5 and 6 built"), § 14 status; `bundle-format.md` § Stake proof; `journal.md` § Projections (the event type list); `mcp.md`; the skill's prove step.
