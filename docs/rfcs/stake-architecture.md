---
title: "RFC: Stake architecture (signal to proof)"
navTitle: "RFC: Stake architecture"
order: 94
---

# RFC: Stake architecture: one node, one chain, from signal to proof

> Status: **Architecture agreed with the product owner on 2026-11-22. Parts 1 to 4 shipped. Parts 5 and 6 are not built; the owner answered the thirteen calls of [§ 14](#14-proposal-for-parts-5-and-6) on 2026-11-22, so they are ready to plan.** Written from the design document [arkaik: unified stake architecture](https://claude.ai/artifact/Gu2WTyrbsCQf6tTP9UPdvC), which this RFC now replaces as the source of truth. One question is deferred to its own research session: how options are compared ([§ 12](#12-open-questions)).
>
> Reading guide: sentences about what Arkaik does *today* are checked against the code and cite a path. [§ 10](#10-what-exists-today) lists them, including three places where the design document assumed more than the code holds; it describes the code as it stood before parts 1 to 4, which [§ 11](#11-shipping-order) now says what built. Shapes marked **(proposal)** are the lead's working choice for a detail the owner did not settle.
>
> Precedents: [Weighing](./weighing.md) (the `opportunity` species, its derived states, the assessment primitive) and [Need qualification](./need-qualification.md) (how raw input becomes a qualified need). This RFC renames the first and widens the second. Where they disagree with this one, this one wins. [§ 11](#11-shipping-order) says what it changes in weighing's slice 2.

## Summary

Everything that can be acted on becomes one node, the **stake**, and travels one chain:

```
signal -> (qualify) -> stake -> (evaluate, against a reference) -> options -> decision -> answer, with its definition of done -> proof
```

- **One node, six species.** Bug, friction, need, requirement, risk and defect share one structure: a species, an anchor in the product graph, a provenance and an optional link to a catalog entry.
- **Two doors.** An existing product raises stakes from observed signals. A product being designed raises them from imagination and from what the catalogs say applies. Both land on the same node.
- **References are plug-ins.** The pyramid of elements of value and the Kritik matrix are two catalogs of criteria. The species decides which one scores the stake. Another framework is added the same way.
- **Many options, one decision.** Several candidate answers can target one stake. A decision with a reason selects one and closes the others.
- **Done is defined before, proven after.** Each answer carries a definition of done. The proof has two halves, verified and delivered, and each species declares which halves it needs.

The value side (weighing) and the quality side (Kritik) stay separate. Both plug into the chain at the same three points: a source of signals, a reference that scores, and a check that verifies.

### Decisions at a glance

All taken with the owner on 2026-11-22.

| # | Decision | Section |
|---|---|---|
| 1 | The node is a **stake**, in the interface and in the schema. `opportunity` is renamed. | [§ 10](#10-what-exists-today) |
| 2 | **Need is one species of six**, no longer a synonym of the node. | [§ 3](#3-species) |
| 3 | **Feedback is evidence, so a signal.** The species for "works as designed, still in the way" is **friction**. | [§ 3](#3-species) |
| 4 | **Kritik is read, never written.** A requirement stores a criterion id such as `SAF-01` and copies nothing. | [§ 5](#5-catalogs-and-incarnations) |
| 5 | The parked QA-shaped needs from the Pebbles run are **routed** as requirements or defects. Nothing goes into Kritik. | [§ 6](#6-evaluation-routing) |
| 6 | **Mattering ranks inside a kind**; the pyramid score says which value is at stake. A bug is always *expected*. | [§ 6](#6-evaluation-routing) |
| 7 | **One answer can address several stakes.** Each stake keeps its own decision. | [§ 7](#7-options-and-decision) |
| 8 | **A signal can seed an option**, and an option never exists without a stake. | [§ 7](#7-options-and-decision) |
| 9 | **Promise is a role, not a type.** `acceptance` stays the entity. | [§ 7](#7-options-and-decision) |
| 10 | **A proof has two halves**, verified and delivered, required per species. | [§ 8](#8-done-and-proof) |
| 11 | **A proof may expire.** The expiry is optional and set case by case, as an interval on the stake. | [§ 8](#8-done-and-proof) |

## 1. The problem

Two parts of Arkaik judge a product, and they do not meet.

- **Weighing** judges promises against the 30 elements of value ([`docs/rfcs/weighing.md`](./weighing.md)). It plans an `opportunity` species for needs (slice 2, not built).
- **Kritik** judges the product against a quality matrix of 88 criteria (`packages/kritik-library/framework.json`, version 0.1.0) and writes findings.

The Pebbles needs run (2026-11-16 to 2026-11-21) showed the gap. Of the 33 backlog items the owner rated, 10 were "not a need", and five of those reasons named a sanity check, a requirement or a Kritik check ([need qualification § 8](./need-qualification.md#8-what-the-pebbles-run-showed)). They had no home: weighing had no species for them, and the owner had chosen not to write into Kritik. A bug, a GDPR obligation and a delightful idea all arrive as raw input and all end as work. Today each would need its own pipeline.

This RFC gives them one.

## 2. The chain

The chain has eight entities and seven steps. The species changes what each entity contains, never the order.

| Entity | What it is | What it carries |
|---|---|---|
| **Signal** | Raw evidence in the product's context. Never scored. Feedback is a signal. | Source, date, verbatim, provenance (observed or anticipated) |
| **Stake** | The one thing we can act on, written once. | Species, anchor in the product graph, provenance, optional catalog link |
| **Reference** | A catalog of criteria that exists outside the product. | Versioned criteria, each with a question and a scale; the species it scores |
| **Evaluation** | One score for one stake against one criterion. | Level, scorer, certainty |
| **Option** | A candidate answer to one or several stakes. A hypothesis. | Type matching the species, expected effect, a draft definition of done |
| **Decision** | The choice of one option for one stake, with its reason. | Selected option, reason, author. The other options are closed. |
| **Answer** | The selected option, being built. | Type (fix, enhancement, feature, diligence, mitigation, resolution), definition of done |
| **Proof** | Evidence that the answer is done. | A verified half and a delivered half, an optional expiry |

The steps between them are verbs: **raise, qualify, evaluate, ideate, decide, build, prove.** Qualification and evaluation are both routing steps: qualification picks the species, and the species picks the reference.

## 3. Species

Six species cover both polarities. Three face the user's value, three face quality and obligation.

| Species | What it is | Typical sources | Scored against |
|---|---|---|---|
| **Bug** | Something expected to work one way that does not. | Users, support tickets | Pyramid of elements of value |
| **Friction** | Something that works as designed and still gets in the way. | Users, interviews, feedback forms | Pyramid of elements of value |
| **Need** | A value people expect, want or would enjoy. | Research, interviews, positioning gaps | Pyramid of elements of value |
| **Requirement** | An obligation from outside, such as GDPR or another regulation. | Legal, a Kritik criterion that applies, an audit finding | Kritik matrix |
| **Risk** | A threat that can only be mitigated. | Audits | Kritik matrix |
| **Defect** | A flaw of our own making, in design or build, that leaves a threat. | Audits, sometimes a bug | Kritik matrix |

Each species follows its own path to closure.

| Species | Answer | Definition of done | Verified by | Delivered by |
|---|---|---|---|---|
| Bug | Fix | Reproduction steps | Non-reproduction | Changelog |
| Friction | Enhancement | Acceptance on the improved behaviour **(proposal)** | Acceptance checked | Changelog or release note |
| Need | Feature | Acceptance (the promise) | Acceptance checked on each platform | Announcement or release note |
| Requirement | Diligence | The Kritik criterion it comes from | The audit passes, with evidence of compliance | Optional |
| Risk | Mitigation | The mitigation process and when it applies **(proposal)** | The process exists and is followed | Not required |
| Defect | Resolution | The check that failed **(proposal)** | Re-check passes, or a post-mortem | Optional |

The definitions of done for bug, need and requirement are settled. Those for friction, risk and defect are proposals.

The last two columns name the evidence a person recognises. How the code reads it is settled in [§ 14](#14-proposal-for-parts-5-and-6), call 6: each answer except a requirement is written as an acceptance, verified reads that acceptance at `releasing` or `live`, and delivered reads it `live`. The changelog, release note or announcement is the trace of a delivery, not its proof.

**Two meanings of "species".** In the graph model, *species* already names the node kind (`flow`, `view`, `data-model`, `api-endpoint`, `acceptance`, `decision`; `SPECIES_IDS` in `packages/schema/src/ids.ts`). A stake is one graph species; bug to defect are its species in the sense of this RFC. The schema field needs its own name, so the two never share a word in code: `metadata.stake_species` (built in part 1). The interface keeps "species", as the owner says it.

A later analysis layer can group species to compare where effort goes: gains (need, friction) against protections (bug, requirement, risk, defect). The owner reads that balance as a rough measure of technical debt. It is derived from the species and never stored on the stake.

## 4. Two doors

Collecting and imagining are two doors into the same node. Only the provenance differs, and it is recorded on every signal and stake.

| | Collect | Imagine |
|---|---|---|
| **Situation** | A product exists and people use it. | A product is being shaped. Nothing exists to audit. |
| **Where signals come from** | Tickets, Slack, feedback forms, interviews, audits run on the product | An agent reading the product idea, plus the catalogs: criteria that apply, value elements with no promise |
| **Provenance** | Observed | Anticipated, marked inferred until a person confirms it |
| **Species available** | All six | Need, requirement, risk, defect. No bug or friction, since nothing exists yet. |
| **Anchor** | An existing flow, view, data model or API | A node still at idea stage (status `idea`) |
| **How a Kritik criterion acts** | The audit fails; the finding raises a requirement or a defect. | The criterion applies, so it becomes a line on the roadmap. |
| **Guardrail** | Merge a new signal into an existing stake before creating one. | An applicability filter, so the whole matrix does not become tasks. |

A product moves from the second door to the first as it ships. The anticipated requirement of today is audited tomorrow, against the same criterion.

Provenance has two axes. **Observed or anticipated** says which door the signal came through. **Stated or inferred** says, part by part, who said it: a person, or the analyst's hypothesis ([need qualification, step 3](./need-qualification.md#step-3-neutralize-and-excavate-laddering)). They are independent: an observed signal can carry an inferred stake.

## 5. Catalogs and incarnations

A catalog entry is a principle and names no product. A stake is that principle applied to one place in yours. This removes the overlap between a GDPR criterion and a GDPR requirement.

- **The criterion** stays in the Kritik matrix, once. Example: protect health data.
- **The requirement** is the criterion plus an anchor. Example: the sign-up form collects health data, so explicit consent is needed here.
- **The finding** is the result of testing the criterion on the product. A failed finding is a signal.

Three consequences follow.

1. **One criterion raises several requirements.** The same GDPR principle can raise one on sign-up, one on export and one on analytics. Each has its own answer and proof.
2. **The anchor is what makes it Arkaik.** Every stake points to a flow, a view, a data model or an API endpoint, so it is traversed like the rest of the graph.
3. **The value side has the same shape.** "Reduces anxiety" is the element. "I cannot tell how many sessions I have left" is the need, at one place.

### Kritik is read, never written

Kritik sits at both ends of the chain: its findings are a source of signals, and a passing re-audit is the verified half of a proof. The dependency is accepted on three rules.

1. **Both links are stored on the stake.** A signal points to a finding; a requirement points to a criterion.
2. **Nothing is created or changed in Kritik.** No new criterion, no finding written from this chain, no shared scale. One exception, approved by the owner on 2026-11-22 ([§ 14](#14-proposal-for-parts-5-and-6), call 7): the Kritik library gains a **version per criterion**, so that rule 3 can be read. It is a change to the library's shape, made in the library; this chain still writes nothing into it.
3. **When a criterion changes, the requirements linked to it read stale** until they are checked again. A requirement stores the criterion version it was last verified against; a newer version reads stale.

Kritik criteria already carry ids to point at. `SAF-01` is "Crisis and self-harm response pathways", in domain `SAF`, with `applies_to`, `default_impact` and `weight` (`packages/kritik-library/framework.json`). A requirement stores that id, and the criterion version it was last verified against, and copies nothing else from the criterion.

## 6. Evaluation routing

The species decides which reference scores a stake, so neither framework has to cover everything. The pyramid keeps the three user-facing species; the Kritik matrix keeps the other three.

```
bug, friction, need          -> pyramid of elements of value (value-contribution@2)
requirement, risk, defect    -> Kritik matrix (read by criterion id)
(another species set)        -> another reference, declared the same way
```

A **reference** is a component with a small contract. Any scorer, a person, an agent or Jev, can score against it.

- A versioned criteria set, each criterion with a question and a scale. Weighing already stores the pyramid this way, as `value-contribution@2` (`packages/schema/src/weighing-library.ts`).
- A declared list of the species it can score. A weighing criteria set has a `subject` field for what it judges; slice 1 uses `acceptance` and reserves the rest (`packages/schema/src/weighing.ts`). Part 4 built the declaration as a separate optional `stake_species` list beside `subject`.
- Its own aggregation. Scores from two references sit side by side and are never added or netted.

Adding a framework means adding one criteria set and declaring its species. Nothing else in the chain changes.

Three rules keep the scores honest.

1. **Pyramid scores say what value is at stake.** They use the signed scale from −3 to +3, aggregated apart from the value a promise serves.
2. **A need gets its kind before its score:** expected, wanted or a delight. Needs of different kinds are never ranked against each other.
3. **Prioritisation happens inside a species.** A deal-breaking requirement and a delightful need are not on one scale.

### What each species is measured on

| Species | Kind | Mattering, 4 to 1 | Frequency | Reference score |
|---|---|---|---|---|
| Bug | Always expected | "How much would it hurt if it were missing?" | Yes **(assumed)** | Pyramid, −3 to +3 |
| Friction | Expected, wanted or a delight | The question of its kind | Yes **(assumed)** | Pyramid, −3 to +3 |
| Need | Expected, wanted or a delight | The question of its kind | Yes | Pyramid, −3 to +3 |
| Requirement, risk, defect | None | Not used | Not used | Kritik criticality |

The mattering questions and tiers come from [need qualification, step 7](./need-qualification.md#step-7-matter), unchanged. Mattering judges the person's experience, not the work and not how many people have it; frequency is recorded apart. Frequency on bug and friction is assumed here: the need-qualification RFC defines it for needs only, and the owner has not confirmed it.

**Kritik criticality** is read from the criterion, never restated: today a criterion carries `default_impact` (1 to 5) and `weight`, and the framework declares `impact`, `likelihood` and `severity_buckets` scales (`packages/kritik-library/framework.json`). Which of these a requirement shows as its criticality is a detail for the evaluation part (built in part 4: `default_impact`, with the finding's severity when a finding raised it).

### The parked QA-shaped needs are routed

The run supports this split. Of the 10 items rated "not a need", five reasons named a sanity check, a requirement or a Kritik check, and Jev has no value element for safety, legal or accessibility needs. Each of those items now goes through qualification like any signal and becomes a requirement or a defect, with its anchor. None is written into Kritik. The items themselves are not routed yet.

## 7. Options and decision

A stake can have many options and exactly one decision, and one option can serve several stakes. The decision is what turns a hypothesis into an answer.

- **Options are hypotheses.** Each is a candidate fix, enhancement, feature, diligence, mitigation or resolution. A person or an agent can write one.
- **Options are compared before one is chosen:** how well each addresses the stake, and what it costs. *How* they are compared is deferred ([§ 12](#12-open-questions)).
- **The decision is a record, not a status.** It names the selected option, the reason and the author. It reuses the `decision` species (`packages/schema/src/ids.ts`).
- **Cleanup is part of the decision.** The selected option becomes the answer. The others are closed with the reason they lost; they stay readable and leave every working view.
- **Many-to-many.** One answer can address several stakes. Each stake still gets its own decision, so the same option can be selected for one and closed for another.

### A signal can seed an option

Ideas and benchmark takeaways arrive already shaped as solutions. Ingesting one produces two things:

1. **The stake behind it.** Ask why until three different solutions could address it ([need qualification, step 3](./need-qualification.md#step-3-neutralize-and-excavate-laddering)). The stake is marked inferred until confirmed.
2. **The idea itself**, kept as a first option on that stake, with a "suggested by" link to the signal and its verbatim.

An option never exists without a stake. If the stake cannot be named yet, the idea waits on an unnamed stake. A benchmark takeaway is a signal whose source kind is `benchmark`; it does not count toward the stake's frequency or mattering.

### Promise is a role, not a type

An option carries a draft definition of done. For a feature, that draft is its acceptances. When a decision selects the option, those acceptances read as **promises**. The schema keeps `acceptance` as the entity, and "promise" is derived from the decision, never stored. An acceptance that is already live also reads as a promise, which covers the quick wins nobody debated.

This matches what weighing already planned: a story at status `idea` that no decision chose is a *candidate*, and a chosen one is a promise ([weighing § 6](./weighing.md#6-opportunities-and-outcomes)). For a feature, an option *is* a candidate story. The other five answer types are new.

## 8. Done and proof

The definition of done is written before the work, and the proof is collected after it. An acceptance is a definition of done, not a proof.

The proof has two halves:

- **Verified:** the definition of done passes. The stake is addressed technically. For an acceptance, this reads as the acceptance at `releasing` or `live` on a platform, never `archived`: the change is merged, which a project's `ref_policy` records as `releasing` (without one, a person moves the status).
- **Delivered:** the answer is in people's hands. For an acceptance, this reads as `live` on a platform. The deploy door (`POST …/live`) is its automated writer, one platform at a time; a person's edit, or a project `ref_policy` that maps a merged pull request to `live`, can set it too. A changelog entry, a release note or an announcement is its trace, not its proof.

An answer that is not naturally an acceptance (a non-reproduction, a followed process, a mitigation) is written as one, so it is proved the same way ([§ 14](#14-proposal-for-parts-5-and-6), call 6).

| Species | Verified | Delivered |
|---|---|---|
| Bug | Required | Required |
| Friction | Required | Required |
| Need | Required | Required |
| Requirement | Required | Optional, case by case |
| Risk | Required | Not required |
| Defect | Required | Optional, case by case |

**A proof can expire.** The verified half may carry an expiry, optional and set case by case, as an interval on the stake (`metadata.reverify_every_days`; [§ 14](#14-proposal-for-parts-5-and-6), call 9): a new check restarts the clock. Once it lapses, the half reads stale and the stake falls back to *promised* until a new check passes. This suits a risk, whose mitigation is reviewed and never final, and any requirement audited on a schedule.

### Statuses, derived and never stored

The sequence extends weighing's derived states ([weighing § 6](./weighing.md#6-opportunities-and-outcomes)) with one state.

| Status | True when |
|---|---|
| **Raised** | A signal has been qualified into a stake. |
| **Considered** | It has an evaluation or at least one option. |
| **Promised** | A decision selected an option, and the answer has a definition of done. |
| **Verified, not delivered** (new) | The definition of done passes, and a required delivery is missing. This is the fix merged and not yet deployed. |
| **Partly addressed** | The required proof exists on some platforms and not on all. |
| **Addressed** | Every required half exists on every platform concerned. |

"Promises are kept, needs are addressed" still holds and widens: definitions of done are met, stakes are addressed.

## 9. Who does what

No step is reserved for a person. Every record says who wrote it, and a person's value wins over an agent's, as in weighing today.

| Step | When | A person | An agent | Jev |
|---|---|---|---|---|
| Collect | Continuously, on an existing product | Adds interviews and notes | Pulls tickets, messages, forms and audit findings | |
| Imagine | While shaping a product | Describes the idea, confirms candidates | Generates candidate stakes, filters the catalogs for what applies | |
| Qualify | On each new signal | Confirms or corrects | Proposes the species, the anchor and a merge with an existing stake | |
| Evaluate | Once the species is set | Scores, or overrides a score | Scores against the reference | Scores against the criteria set, with a certainty |
| Ideate | When a stake is worth acting on | Writes options | Writes options | |
| Decide | When options exist | Selects and gives the reason | May select, with a written reason | Could score options against the same criteria (untested) |
| Build | After the decision | Writes the definition of done, does the work | Same | |
| Prove | After the work | Confirms delivery | Re-runs the check or the audit, links the release | |

Two measured limits apply to Jev. Its need scores were stable across runs and generous at the 0.5 threshold. Its cost calls never reached certainty, so they read as a range.

## 10. What exists today

Most of the chain already exists under another name. Two entities are new, option and proof. Each "today" below was checked against the code on 2026-11-22.

| Concept here | Today in Arkaik | What changes |
|---|---|---|
| **Stake** | Nothing in the schema. `opportunity` is a species *designed* in weighing slice 2 and never built: `SPECIES_IDS` holds six species, none of them `opportunity` (`packages/schema/src/ids.ts`). | Built as `stake` instead, with a species, an anchor, a provenance and an optional catalog link. |
| **Signal** | The `request.filed` journal event: `title`, `description`, `source`, one optional `node_id`, plus the envelope's `ts` and `actor` (`packages/schema/src/journal-events.ts`). Kritik's `quality.finding.opened` is a second source. | Generalised to every source kind (ticket, interview, form, audit finding, idea, benchmark), with a verbatim, a provenance and links to many stakes. |
| **Qualification** | The [need-qualification](./need-qualification.md) method, proposed, not implemented. | Its first step becomes species routing for all six. The rest stays the need's own evaluation. |
| **Reference** | A weighing criteria set such as `value-contribution@2` (`packages/schema/src/weighing-library.ts`); the Kritik matrix (`packages/kritik-library/framework.json`). | The Kritik matrix is read as it is, apart from one change in part 6: a version per criterion in the library ([§ 14](#14-proposal-for-parts-5-and-6), call 7). A reference declares the species it scores. |
| **Evaluation** | A weighing assessment: level, scorer with an optional `on_behalf_of`, confidence, optional `p_serves` and `p_costs` (`packages/schema/src/weighing-schemas.ts`). Subjects are acceptances only. | Subjects widen to stakes, with kind, mattering and frequency on the user-facing species. |
| **Option** | Nothing in the schema. The Options Matrix and the opportunity-solution tree are prototypes in the Tool Lab, outside this repo. | New entity. |
| **Decision** | The `decision` species, with `decision_status` and the `generates` edge to an acceptance (`packages/schema/src/ids.ts`, `packages/schema/src/bundle.ts`). A decision that *accepts a cost* on a promise is a weighing proposal ([weighing § 10](./weighing.md#10-costs-and-decisions)), not built. | Reused. It also links one option to one stake. |
| **Answer** | An acceptance, or a story of acceptances, for a feature. | The five other answer types are new. |
| **Definition of done** | The acceptance, said "promise" in the interface. | Generalised to every answer type. "Promise" becomes a role. |
| **Proof, verified half** | Per-platform acceptance status: the parity matrix on the Acceptances page ([`docs/graph-model.md`](../graph-model.md)). | Generalised: non-reproduction, a passing audit, a followed process. Per [§ 14](#14-proposal-for-parts-5-and-6) call 6, it reads `releasing` or `live`. |
| **Proof, delivered half** | The `deliverable.shipped` journal event, with `node_ids` and a Lab Note (`packages/schema/src/journal-events.ts`). It is not read as proof today. | Not the proof. Per [§ 14](#14-proposal-for-parts-5-and-6) call 6, the delivered half reads `live`, set per platform by the deploy door; the shipped deliverable stays the trace. |
| **Statuses** | Raised to addressed are *designed* in weighing § 6, not built. | Built with one more state: verified, not delivered. |
| **Provenance** | Stated and inferred marks in the need-qualification method; `on_behalf_of` and confidence (0 guess, 1 inferred, 2 evidenced, 3 verified) on a weighing assessment. | One more axis: observed or anticipated. |

### Three corrections to the design document

1. **The rename needs no migration.** The design document asks for "a migration that still reads old bundles". No bundle can hold an `opportunity` node: the species enum is closed, so a validator rejects it ([weighing § 17](./weighing.md#17-shipping-order)), and the Pebbles bundle has none. The rename is free as long as it lands before slice 2. Only prose changes: the weighing RFC and the need-qualification RFC.
2. **Derived statuses are designed, not built.** "One state added to the current sequence" extends weighing's design, not running code.
3. **The cost-accepting decision is a proposal.** Weighing § 10 proposes `accepted: { decision, level }` on an assessment; nothing in `packages/schema/src/weighing*.ts` holds it yet.

## 11. Shipping order

Each part is its own PR, in this order. Each builds on the one before. **Parts 1 to 4 shipped with this stack.** Parts 5 and 6 are not built; the owner's answers to [§ 14](#14-proposal-for-parts-5-and-6) settle their shape.

| Part | Ships | Depends on | State |
|---|---|---|---|
| **1. Schema** | Graph species `stake` (id prefix `STK-`), `metadata.stake_species`, the anchor, provenance (observed or anticipated) and the optional catalog link. Like decisions: no platforms, excluded from delivery and parity roll-ups and from the Journey and System maps. | Nothing | Shipped |
| **2. Signal** | `request.filed` generalised to every source kind, including a Kritik finding, an idea and a benchmark. A verbatim field. Links to many stakes. The "suggested by" link to an option. | 1 | Shipped. The option-side "suggested by" link (`metadata.suggested_by`) landed with part 5's vocabulary ([§ 14](#14-proposal-for-parts-5-and-6), call 12) |
| **3. Qualification** | Species routing as the first step, ahead of the need-specific steps of need qualification. Merge into an existing stake before creating one. | 1, 2 | Shipped |
| **4. Evaluation** | A reference declares its species. Kind, mattering and frequency on the user-facing species. Kritik criticality read by criterion id. | 1, 3 | Shipped |
| **5. Option and decision** | The option entity. A decision links one option to one stake. The derived promise role. | 1, 4 | Decided in § 14. The vocabulary shipped (species `option`, the `addresses` edge, the two widened decision pairs, `suggested_by`, `closed_options`, warnings); the decision write and the readers are not built |
| **6. Proof and statuses** | The two halves, the optional expiry interval, the derived statuses (including "verified, not delivered"), and a version per criterion in the Kritik library with the version a requirement was last verified against. | 5 | Decided in § 14, not built |

### What parts 1 to 4 built

The names the code settled on, where the RFC had left a **(proposal)**. The last three rows are the vocabulary half of part 5.

| Part | Choice built | Where |
|---|---|---|
| 1 | Species `stake`, prefix `STK-`. Its six kinds live in `metadata.stake_species` (bug, friction, need, requirement, risk, defect). | `packages/schema/src/ids.ts`, `stake.ts` |
| 1 | The anchor is an **edge**, `concerns`: stake to flow, view, data model or API endpoint. `impacts` stays decision-only. | `ids.ts` (`VALID_EDGE_SEMANTICS.concerns`) |
| 1 | `metadata.provenance` (observed or anticipated; absent reads observed) and `metadata.catalog: { source: "kritik" \| "values", id }`, an id and nothing copied. | `stake.ts`, `bundle.ts` |
| 1 | Stored lifecycle is `idea`, `discovery` or `archived`; every other state stays derived. Validator rules are warnings. | `stake.ts`, `validate.ts` |
| 2 | `request.filed` gained optional fields (source kind, verbatim, provenance, `stake_ids`, `finding_id`, `criterion_id`, `url`). The durable signal-to-stake link is `metadata.evidence[]` on the stake. | `journal.ts`, `journal-events.ts` |
| 3 | Pure routing and merge-candidate logic, plus MCP `qualify_signal` (read) and `promote_signal` (write, op-only). | `packages/schema/src/qualify.ts` |
| 4 | A criteria set declares `stake_species`; `value-contribution@2` declares bug, friction and need. Kritik stays read-only. | `weighing.ts`, `weighing-library.ts`, `stake-evaluation.ts` |
| 4 | `metadata.felt` (expected, wanted, delight), `metadata.matters` (1 to 4) and `metadata.frequency` (rare, some, often), user-facing kinds only. | `stake.ts`, `stake-evaluation.ts` |
| 5 (vocabulary) | Species `option`, prefix `OPT-`, `platforms: []`, stored lifecycle `idea`, `discovery` or `archived`. Its answer type is read from the kind of stake it addresses (a table, nothing stored). | `ids.ts`, `option.ts` |
| 5 (vocabulary) | The `addresses` edge: option to stake, acceptance to stake, acceptance to option. `generates` gains decision to option; `impacts` gains decision to stake. They stay disjoint by pair, and a decision edge's meaning now depends on its target species. | `ids.ts` (`VALID_EDGE_SEMANTICS`) |
| 5 (vocabulary) | `metadata.suggested_by` on an option (a journal event id) and `metadata.closed_options` on a decision (`{ option_id, reason }[]`). Ten validator warnings, none an error. | `bundle.ts`, `validate.ts`, `journal.ts` |

Nothing parts 1 to 4 built writes a derived state, an option or a proof. The part 5 vocabulary writes none either: it adds the species and the edges, and the decision that selects an option comes next.

### What it changes in weighing's slice 2

Weighing § 17 ships slice 2 as `composes` acceptance to acceptance, species `opportunity`, edge `addresses` with confidence, and caps.

- **`opportunity` becomes `stake`**, built by part 1 above. Its `OPP-` id prefix became `STK-`, as built in part 1. Weighing's stored lifecycle (`idea`, `discovery`, `archived`) carries over unchanged.
- **`addresses`** (acceptance to opportunity) becomes acceptance to stake. It is how a feature's definition of done points to the stake it answers. For the other answer types, the same edge runs from the option to the stake ([§ 14](#14-proposal-for-parts-5-and-6), call 2).
- **Stories** (`composes` acceptance to acceptance) and **caps** are untouched. Caps read needs; they read stakes of species `need`, and later friction.
- Weighing § 18 question 10 ("opportunity" or "need" in the interface) is settled: **stake**.

## 12. Open questions

| # | Question | Lean |
|---|---|---|
| 1 | **How are options compared?** The criteria for choosing between options are not defined. | Deferred to its own research session. The Options Matrix prototype is the starting point. Do not build on it yet. |
| 2 | Definitions of done for friction, risk and defect. | The proposals in [§ 3](#3-species). Not settled. |
| 3 | Frequency on bug and friction. | Assumed. The owner has not confirmed. |
| 4 | The balance of gains against protections. | A later analysis layer, derived, never stored. |
| 5 | The schema name of the six species, given that *species* already names graph node kinds. | `metadata.stake_species`. Built in part 1. |
| 6 | Is the anchor an edge or a field? An edge lets a stake be traversed like the graph and admits several anchors. | An edge, `concerns`. Built in part 1. |
| 7 | Which Kritik field reads as a requirement's criticality. | `default_impact`, with the finding's severity when a finding raised it. Built in part 4. |
| 8 | Is an option a graph species, a record, or (for features) a candidate story at status `idea`? | A graph species, `OPT-`. Decided by the owner on 2026-11-22 ([§ 14](#14-proposal-for-parts-5-and-6), call 1). |

## 13. What changes in the normative docs when this ships

This RFC describes a design, so the documents below keep describing what is built until a part ships.

| Part | Document | Change |
|---|---|---|
| 1 | [`docs/graph-model.md`](../graph-model.md) | § Species: `stake`, its six species and the exemptions it shares with decisions. § Canvas Visibility. A dated Taxonomy Update Checklist note. |
| 1 | [`docs/spec/bundle-format.md`](../spec/bundle-format.md) | A new § Stake Nodes. |
| 2 | [`docs/spec/journal.md`](../spec/journal.md) | The generalised signal event and its source kinds. |
| 4 | [`docs/spec/bundle-format.md`](../spec/bundle-format.md) | § Weighing: subjects widen to stakes; a reference declares its species. |
| 1–6 | [`docs/spec/mcp.md`](../spec/mcp.md) | New species, edges and tools as each part adds them. |
| Each | [`docs/rfcs/weighing.md`](./weighing.md), [`docs/rfcs/need-qualification.md`](./need-qualification.md) | `opportunity` reads `stake` once part 1 ships. |
| Each | `public/schema/project-bundle.json`, plugin and CLI scripts | Regenerated and committed, because CI diffs them. |

## 14. Proposal for parts 5 and 6

Parts 1 to 4 gave the chain its first half: a signal is qualified into a stake, and the stake is evaluated against the reference its species picks. Parts 5 and 6 build the second half: options, the decision, the proof and the derived states. [§ 7](#7-options-and-decision) and [§ 8](#8-done-and-proof) settle the shape. They leave thirteen calls to the owner.

This section lays out each call, with the lean **(proposal)** and the alternative, and records the owner's answer. Nothing here is built. Every "today" below was checked against the code on the tip of the stack that shipped parts 1 to 4.

### 14.0 The owner's answers (2026-11-22)

The owner took the lean on eleven of the thirteen calls. Call 6 takes alternative A. Call 7 takes the lean on what a pass is and the alternative on staleness. The trap in call 8 was dropped. Where an answer differs from the lean, the rest of this section and [§ 5](#5-catalogs-and-incarnations), [§ 8](#8-done-and-proof) and [§ 10](#10-what-exists-today) follow the answer.

| Call | Answer | Lean taken? |
|---|---|---|
| 1. What an option is | A graph species, `option`, prefix `OPT-`, no platforms | Yes |
| 2. Edges | New edge `addresses`; `generates` widened to decision to option; `impacts` widened to decision to stake | Yes |
| 3. Closure | Derived per option and stake; losers' reasons in `metadata.closed_options` on the decision; the author read from the journal `actor` | Yes |
| 4. Promise | An acceptance an approved or enacted decision generates (directly or through an option), or one already `live` | Yes |
| 5. States across platforms | The ordered ladder | Yes |
| 6. Verified and delivered | **Verified is `releasing` or `live`; delivered is `live`.** An answer that is not naturally an acceptance is written as one. No new journal event. | **No: alternative A** |
| 7. Kritik pass | No open finding on the criterion at the anchor, **and** a score at the target level dated after the stake was raised | Yes |
| 7. Staleness | **A version per criterion in the Kritik library**; the requirement stores the version it was last verified against | **No: the alternative** |
| 8. Platforms concerned | The union of the definition-of-done acceptances' platforms, in the active product's scope; one platform-less cell when there is none | Yes |
| 8. The trap | **Dropped.** With delivered read from `live`, which the reader resolves per platform (`resolvePlatformStatus`, with the deploy door writing one platform at a time), `deliverable.shipped` no longer feeds the proof, so part 6 does not widen it. | n/a |
| 9. Expiry | An interval, `metadata.reverify_every_days`, on the stake | Yes |
| 10. Considered (quality kinds) | An option addresses it, or it carries a catalog link | Yes |
| 11. Archived | Derives no state | Yes |
| 12. Suggested by | `metadata.suggested_by: <event id>` on the option; ships with part 5 | Yes |
| 13. Comparing options | Stays deferred; part 5 does not wait for it | Yes |

### 14.1 The ground the proposal stands on

| Fact | Today | Where |
|---|---|---|
| No option exists. | No `option` species, no `OPT-` prefix, no `addresses` edge anywhere in the schema, the app or the MCP tools. | `packages/schema/src/ids.ts`, `id-gen.ts` |
| A decision reaches two things. | `generates` runs decision to acceptance only. `impacts` runs decision to flow, view, data model or API endpoint. They are disjoint on purpose: an acceptance is generated, never merely impacted. | `ids.ts` (`VALID_EDGE_SEMANTICS`) |
| A decision's status is global to the node. | `decision_status` (proposed, approved, enacted, rejected, deprecated, superseded) sits on the node, and `lifecycleStatusForDecision` sends rejected, deprecated and superseded to `archived`. | `packages/schema/src/decision.ts` |
| No derived state exists. | Nothing computes *promised*, *verified, not delivered*, *partly addressed* or *addressed*. A stake stores `idea`, `discovery` or `archived` only. | `stake.ts`; a search of `packages`, `lib`, `app` and `components` finds none |
| "Promise" is not derived. | The nearest code is the parity read: `resolvePlatformStatus`, `hasParityGap` and `DEFAULT_DELIVERED_STATUSES = ["live"]`. | `packages/schema/src/acceptance.ts` |
| `live` already means delivered. | When a project has opted in with `ref_policy`, a merged pull request that names an acceptance moves it to `releasing` (`DEFAULT_REF_POLICY`); without a `ref_policy` a merge moves nothing. The deploy door, `POST …/live`, is the automated writer of `live`, one platform at a time, and refuses an unscoped one; a person's edit, or a `ref_policy` that maps merged to `live`, can also set it. | `packages/schema/src/promote.ts`, `lib/services/graph/live.ts` |
| A shipped deliverable names nodes. | `deliverable.shipped` carries optional `node_ids` and one optional `platform`. The webhook sets `platform` only when exactly one platform resolves, so a delivery that spans two carries none. | `journal.ts`, `lib/services/github/pull-request.ts` (`deliverableScope`) |
| A stake or option id reaches `node_ids` by hand only. | The PR mention grammar matches `AC-…` ids. Other ids come from the Lab Note `nodes:` key or the CLI `--nodes`, and an id the project does not hold is dropped and reported. | `packages/schema/src/mentions.ts`, `lib/services/github/lab-note-parse.ts`, `packages/cli/src/commands/deliverable.ts` |
| Kritik findings name nodes; criteria carry no version. | `quality.finding.opened`, `.resolved` and `.accepted` carry optional `node_ids`. An assessment is keyed by criterion and surface, and a surface has no node link. A criterion has an id, `default_impact` and `weight`, and no version of its own; only the framework has one. | `journal-events.ts`, `quality.ts` |
| A matrix can already hold a non-node. | A weighing matrix has `subjects` (a species query or a list) and an optional `context.node_id`. The derive and the validator read nodes only. | `packages/schema/src/weighing.ts`, `weighing-derive.ts`, `weighing-validate.ts` |

### 14.2 What the answers add up to

With the owner's answers, parts 5 and 6 add this much and no more.

| Part | Adds | Stores | Derives |
|---|---|---|---|
| 5 | Species `option` (`OPT-`, no platforms). One new edge type, `addresses`. Two new pairs on existing edges (`generates` decision to option, `impacts` decision to stake). A pure helper that writes a decision and its two edges in one batch. | The option node, its edges, the decision. The losers' reasons. | The answer type, the answer, an option's closure per stake, the promise role. |
| 6 | A zod-free reader that derives the halves of the proof and the state of a stake from facts that already exist. A stable list of the journal event types it reads. A version on each Kritik criterion, in the library (call 7). | Two optional fields on the stake: the expiry interval, and the criterion version a requirement was last verified against. | Verified (`releasing` or `live`), delivered (`live`), the platforms concerned, the six states. |

No new journal event is needed, and no existing one changes. Both halves of the proof read facts the journal already holds, which are acceptance statuses and, for a requirement, its Kritik findings and assessments; `deliverable.shipped` stays the changelog's trace and is not read as proof. Every new field is optional and additive, so neither part bumps `schema_version`. The new species and edge type are not additive for an older validator, which rejects an unknown species or edge type: part 5 is one release that adds both together.

### 14.3 The calls

Calls 1 to 4 shape part 5. Calls 5 to 11 shape part 6. Calls 12 and 13 are about ordering and what stays out.

#### Call 1. What is an option? (RFC question 8)

> **Owner's answer (2026-11-22):** A graph species, `option`, prefix `OPT-`. The lean.

| | Option |
|---|---|
| **Lean (proposal)** | **A graph species**, `option`, id prefix `OPT-`, `platforms: []`. Stored lifecycle `idea`, `discovery` or `archived`, like a stake. The description holds the expected effect. The draft definition of done of [§ 7](#7-options-and-decision) lives on or beside it (§ 14.4). |
| **Why** | An option needs edges (to stakes, to a decision, to acceptances), journal `node_ids` (a deliverable can name it) and, later, a matrix subject. A record has none of that. A candidate story covers a feature only; a diligence, a mitigation and a resolution are not acceptance-shaped. |
| **Alternative A** | **A record** in the bundle, not a node. Smaller, but no edges, and the journal cross-check reads `node_ids` against nodes. |
| **Alternative B** | **A candidate story**: an acceptance at status `idea`. Free for features, and the RFC already says it fits. Five of the six answer types would still need a home. |
| **Rejected** | **A decision at `proposed`.** `decision_status` is global to the node, so one option could not be selected for one stake and closed for another, and `lifecycleStatusForDecision` forces a rejected decision to `archived`. |

#### Call 2. The edge vocabulary

> **Owner's answer (2026-11-22):** The lean: `addresses`, with `generates` and `impacts` widened.

[§ 11](#what-it-changes-in-weighings-slice-2) says part 5 decides the shape of `addresses` for the answer types other than a feature.

| Pair | Lean **(proposal)** |
|---|---|
| Option to stake | New edge **`addresses`** |
| Acceptance to stake | `addresses` (weighing slice 2's pair, now to a stake) |
| Acceptance to option | `addresses` (a feature's draft definition of done) |
| Decision to the selected option | Reuse **`generates`**, widened to decision to option |
| Decision to the stake it settles | Reuse **`impacts`**, widened to decision to stake |

| | |
|---|---|
| **Cost of the lean** | `generates` and `impacts` are disjoint by design. Widening both bends that rule: a reader can no longer tell the meaning from the edge type alone. The write helper and the validator carry the rest. |
| **Alternative** | A second new edge, **`selects`** (decision to option), keeping `generates` for acceptances only. Clearer, and one more closed-enum edge type to ship together with the first. |
| **Also decide** | Where `composes` acceptance to acceptance (weighing's stories) lands. It is untouched by this RFC, and `composes` is tied to flow playlists in the validator and the mutation planner, so the lean leaves it alone and does not use it for a definition of done. |

#### Call 3. Where closure lives, and who decided

> **Owner's answer (2026-11-22):** The lean: `metadata.closed_options` on the decision, the author from the journal `actor`.

Closure is derived per option and stake, never stored on the option. A shared option can be selected for one stake and closed for another, so no single `status` can hold it. An option is closed for a stake when that stake has an approved or enacted decision that generates a different option. A rejected or deprecated decision reopens it.

| | |
|---|---|
| **Lean (proposal)** | Store only the reason each loser lost, on the decision: `metadata.closed_options: { option_id, reason }[]`. An optional metadata key needs no version bump. |
| **Alternative A** | The reason on the edge's own `metadata`. Closer to the pair, but a loser has no edge to the decision to carry it. |
| **Alternative B** | The reasons in the decision's `consequences` prose. Nothing new, nothing machine-readable. |
| **Author** | Lean: read it from the journal `actor` of the decision's write, as every other record does. Alternative: store `decided_by` on the decision. |

#### Call 4. The promise threshold

> **Owner's answer (2026-11-22):** The lean: chosen by an approved or enacted decision, or already `live`.

An acceptance reads as a promise when a decision chose it. [§ 7](#7-options-and-decision) adds that an acceptance already live also reads as a promise, and weighing § 6 says status `backlog` or later. The two do not agree.

| | |
|---|---|
| **Lean (proposal)** | A promise is an acceptance that an **approved or enacted** decision generates, directly or through an option it addresses, **or** one that already resolves to `live`. A `proposed` decision does not count, as in weighing § 10. |
| **Alternative** | Weighing's rule: also any acceptance at `backlog` or later. It covers quick wins nobody debated, and it makes every backlog item a promise. |
| **A candidate** | An acceptance at `idea` or `discovery` that no decision chose. Derived, never stored. |

#### Call 5. How the states relate, platform by platform

> **Owner's answer (2026-11-22):** The lean: the ordered ladder.

The table in [§ 8](#statuses-derived-and-never-stored) does not say how a state reads when the two halves differ across platforms. The cases it leaves open: verified on some platforms with nothing delivered; delivered with no verification; verified and delivered on different platforms; an expired verification with delivery already in hand.

The lean is one reading, top rule first.

| Order | State | True when |
|---|---|---|
| 1 | Addressed | Every required half holds on every platform concerned. |
| 2 | Verified, not delivered | Delivery is required, it holds nowhere, and verification holds on every platform concerned. |
| 3 | Partly addressed | Some required half holds on some platform, and no rule above applies. |
| 4 | Promised | A decision chose an option and the answer has a definition of done. A stale verification lands here, whatever was delivered. |
| 5 | Considered | An evaluation exists or an option addresses the stake (call 10 for the quality kinds). |
| 6 | Raised | A signal was qualified into the stake. |

**Lean (proposal):** this ladder. **Alternative:** a grid of the two halves per platform, shown as such, with a state only where one rule is unambiguous. Under the owner's answer to call 6, delivered without verified cannot arise for an answer written as an acceptance, since `live` follows `releasing`; where delivery is optional and read separately (a requirement), the ladder files it under *partly addressed*.

#### Call 6. What "verified" reads, given that `live` already means delivered

> **Owner's answer (2026-11-22):** **Alternative A.** Verified is the acceptance at `releasing` or `live` on a platform; delivered is `live` on that platform. "Verified, not delivered" means merged and not yet deployed. Answers that are not naturally acceptances are modelled as acceptances, so no `proof.recorded` event is added.

[§ 10](#10-what-exists-today) says the verified half is the parity matrix, which reads `live`. But the deploy door sets `live` only when a build reached users, and a merged change sits at `releasing` until then. So the parity matrix already reads delivery.

| Reading | Effect |
|---|---|
| **Lean (proposal):** verified is the acceptance reaching `live` on a platform; delivered is a `deliverable.shipped` that names the answer. | "Verified, not delivered" then means *live, with no changelog record*. Honest, and cheap: both reads exist. |
| **Alternative A:** verified is `releasing` or `live`; delivered is `live`. | It reads better in words, and it contradicts the design document, where delivered was the shipped deliverable. This is the alternative the owner took. |
| **Alternative B:** a new journal event, `proof.recorded`, written by whoever checked. | The only way to prove a non-acceptance answer (a followed process, a non-reproduction) without modelling it as an acceptance. A new event type, so a new reader and spec entry. |

Lean for the non-acceptance answers: **model each as an acceptance** (a repro becomes a Gherkin scenario; a mitigation process becomes a checkable acceptance), so no new event type is needed. If the owner wants an explicit confirmation, take alternative B.

Under the lean (not taken), the delivered half needs an acceptance, option or stake id in a deliverable's `node_ids`. The mention grammar only reads `AC-…`, so a stake or option id arrives by the Lab Note `nodes:` key or the CLI `--nodes`.

#### Call 7. What "the audit passes" means for Kritik, and when a criterion goes stale

> **Owner's answer (2026-11-22):** Pass is the lean (c), both. Staleness takes **the alternative**: the Kritik library gains a version per criterion, and § 5 rule 2 records the exception.

[§ 5](#5-catalogs-and-incarnations) rule 3 says a requirement reads stale when its criterion changes. The code cannot tell. A criterion has no version, an assessment is not tied to a node, and a surface is not either. Only a finding names nodes.

| | |
|---|---|
| **What a pass could be** | (a) Every finding with the stake's criterion id and an anchor in its `node_ids` is resolved, refuted or accepted-risk. (b) An assessment of that criterion at or above the target level (`DEFAULT_TARGET_LEVEL`, 3) dated after the stake was raised. (c) Both. |
| **Lean (proposal)** | (c) **Both**, so that no open finding and a re-scored criterion are each required. A finding alone passes a criterion nobody re-audited. A score alone ignores an open finding on the anchor. |
| **Staleness** | Lean: store the framework version the requirement was last verified against, as weighing's `basis.set_version` does, and read the stake stale when the library moved to a new major (`sameFrameworkMajor` exists). It is coarse. **Alternative:** add a per-criterion version to the Kritik library. That is a Kritik change, against rule 2 of § 5, and it is the precise answer. |

Part 4 owns the stored link from a stake to its criterion (`metadata.catalog`). The version it was last checked against is a new field and belongs to part 6.

#### Call 8. Which platforms a stake concerns

> **Owner's answer (2026-11-22):** The lean for the platforms concerned. **The trap is dropped:** under call 6 the delivered half reads `live`, which the reader resolves per platform (`resolvePlatformStatus`, with the deploy door writing one platform at a time), so `deliverable.shipped` is not widened.

A stake and an option carry no platforms. A state that says "on every platform concerned" needs a list.

| | |
|---|---|
| **Lean (proposal)** | The union of the platforms of the definition-of-done acceptances, read through the active product's scope. For an answer with no acceptance (a requirement), one platform-less cell: it is met or it is not. |
| **Alternative A** | The platforms of the stake's anchor nodes. Simple, and an anchor often lists platforms the answer does not touch. |
| **Alternative B** | Always one platform-less cell. Never wrong about a platform, and says nothing about parity. |
| **The trap** | A `deliverable.shipped` with no `platform` is a delivery that spans two. Reading it as "every platform" over-claims; reading it as "none" under-claims. The lean reads an absent platform as **unknown, so not met on any platform**, which can understate a real delivery. A fix is an optional list of platforms per node on the event, additive, so that `AC-x@ios` stops being lost. The owner decides whether to widen the event. |

#### Call 9. The shape of an expiry

> **Owner's answer (2026-11-22):** The lean: an interval, on the stake.

The design document said the verified half may carry an expiry date, and [§ 8](#8-done-and-proof) first repeated it. A date set once is already past the day a later check passes.

| | |
|---|---|
| **Lean (proposal)** | An **interval** on the stake: `metadata.reverify_every_days`. The half reads stale when the latest check is older than the interval, so a new check restarts the clock. Optional; absent means it never expires. |
| **Alternative** | An absolute date, `metadata.verify_by`. It reads stale when now is past it and no check is dated after it. It matches the RFC's wording, and the owner has to move it by hand. |
| **Where** | Lean: on the stake, since the evidence is derived and the stake is what stays. **Alternative:** on the option or the answer, which dies with the choice. |

The date of the latest check is the latest `node.status_changed` for the answer's acceptance and platform, or the latest assessment or finding resolution for a quality kind. Every read takes `now` as an argument, so it is testable.

#### Call 10. "Considered" for requirement, risk and defect

> **Owner's answer (2026-11-22):** The lean: an option, or a catalog link.

*Considered* is true when the stake has an evaluation or an option addresses it. A user-facing stake can hold a weighing assessment. A quality stake is read against Kritik, which is read-only, so no assessment of ours exists to find.

| | |
|---|---|
| **Lean (proposal)** | A quality stake is *considered* when **an option addresses it**, or when it carries a catalog link (`metadata.catalog` naming a criterion), since the link is the evaluation by reference. |
| **Alternative** | Only an option counts. A requirement then stays *raised* until someone writes an answer, which is true to the chain and makes the state less informative for the imagine door. |

#### Call 11. What an archived stake derives to

> **Owner's answer (2026-11-22):** The lean: no state.

The RFC lists six states and none is *closed*. Part 1 stores `archived` as a lifecycle value.

| | |
|---|---|
| **Lean (proposal)** | An archived stake derives no state. It leaves the state counts and every working view, as an archived option does, and stays readable. Its last derived state is not kept. |
| **Alternative** | A seventh derived state, *closed*, with a free-text reason on the stake, so that a dismissed stake and a stake that was addressed can be told apart. |

#### Call 12. The "suggested by" link, and where the edge lands

> **Owner's answer (2026-11-22):** The lean: `suggested_by` on the option, shipped with part 5.

[§ 7](#a-signal-can-seed-an-option) says a signal can seed an option, kept with a "suggested by" link. Signals are journal events, not nodes, so there is no edge to draw.

| | |
|---|---|
| **Lean (proposal)** | The option carries `metadata.suggested_by: <request.filed event id>`, a string, written when an idea is ingested. A reader links the two the way a stake's `evidence[].event_id` already does. The cross-check warns on a dangling id, never errors. |
| **Alternative** | Put the option's id on the signal (`option_ids` on `request.filed`). Two writers then own one link, and the event is immutable. |
| **Ordering** | `suggested_by` ships with part 5, since it needs the option. Part 2 shipped everything else the RFC asked of it. `addresses` also ships with part 5: it has no use before an option exists. |

#### Call 13. The comparison of options stays deferred (RFC question 1)

> **Owner's answer (2026-11-22):** The lean: stays deferred, part 5 does not wait.

No part builds on how options are compared. A decision is written by a person or an agent, with a reason. The existing matrix is enough to attach a comparison later: a list or query matrix whose `context.node_id` is the stake. Weighing options, cost and effect are the research session's.

| | |
|---|---|
| **Lean (proposal)** | Leave question 1 open. Part 5 ships the option, the decision and the closure, with no scoring of options. |
| **Alternative** | Wait for the research session, and ship part 5 after it. Nothing in the proposal depends on its outcome, so the lean does not need to wait. |

### 14.4 What parts 5 and 6 build

With the owner's answers in hand. Each bullet is a build item, not a call.

- **The answer type is derived.** A stake's species names it: bug to fix, friction to enhancement, need to feature, requirement to diligence, risk to mitigation, defect to resolution. One constant in the schema, nothing stored on the option.
- **The answer is not a node.** It is the option that an approved or enacted decision generates for the stake.
- **A definition of done per type.** Every answer type except the requirement points acceptances at the option with `addresses`; a non-reproduction, a mitigation or a resolution is written as an acceptance (call 6). A requirement names its criterion through the stake, and its verified half is the Kritik pass of call 7.
- **One atomic write.** A pure planner returns the mutation ops for "select this option for this stake": it creates the decision at `approved` (stored status `backlog`, as `lifecycleStatusForDecision` says) with its `impacts` and `generates` edges, and records the losers' reasons. It is exposed as an MCP tool only if the owner wants one; a new tool changes the tool-catalog count that a test pins.
- **Validator warnings only.** An option with no `addresses` stake; a stake with more than one approved or enacted decision; a decision with more than one stake or more than one generated option; a generated option that does not address its stake; an option addressing stakes of two answer types.
- **Part 5's schema.** Species `option`, the `addresses` edge, the two widened pairs (`generates` decision to option, `impacts` decision to stake) and `metadata.suggested_by`, with a warning on a dangling `suggested_by`. One release, since an older validator rejects the new species and edge type.
- **A version per Kritik criterion.** Added in the library, the approved exception to [§ 5](#5-catalogs-and-incarnations) rule 2. The stake stores the version it was last verified against, and the proof reader reads a requirement stale when the criterion's version is newer.
- **The stake's expiry.** The reader compares `metadata.reverify_every_days` with the latest check and `now`.
- **The proof reader.** A pure, zod-free module taking nodes, edges, the journal events of a stable type list and `now`. It returns the two halves, the platforms concerned and the state. Its event types are `node.status_changed`, `decision.status_changed`, the three `quality.finding.*` types and `quality.assessment.scored`, so every consumer shares one query.

### 14.5 What this proposal does not decide

- The interface for options, the decision and the states. Each is a panel and Library question for its own design round.
- The analysis layer on gains against protections ([§ 12](#12-open-questions), question 4).
- Whether frequency belongs on bug and friction (question 3). It stays assumed.
- Anything about migrating bundles: there is nothing to migrate, since no option or proof exists.
