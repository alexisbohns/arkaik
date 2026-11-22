---
title: "RFC: Stake architecture (signal to proof)"
navTitle: "RFC: Stake architecture"
order: 94
---

# RFC: Stake architecture: one node, one chain, from signal to proof

> Status: **Proposed. Architecture agreed with the product owner on 2026-11-22; nothing here is implemented.** Written from the design document [arkaik: unified stake architecture](https://claude.ai/artifact/Gu2WTyrbsCQf6tTP9UPdvC), which this RFC now replaces as the source of truth. One question is deferred to its own research session: how options are compared ([§ 12](#12-open-questions)).
>
> Reading guide: sentences about what Arkaik does *today* are checked against the code and cite a path. [§ 10](#10-what-exists-today) lists them, including three places where the design document assumed more than the code holds. Shapes marked **(proposal)** are the lead's working choice for a detail the owner did not settle.
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
| 11 | **A proof may expire.** The date is optional and set case by case. | [§ 8](#8-done-and-proof) |

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

**Two meanings of "species".** In the graph model, *species* already names the node kind (`flow`, `view`, `data-model`, `api-endpoint`, `acceptance`, `decision`; `SPECIES_IDS` in `packages/schema/src/ids.ts`). A stake is one graph species; bug to defect are its species in the sense of this RFC. The schema field needs its own name, so the two never share a word in code: `metadata.stake_species` **(proposal)**. The interface keeps "species", as the owner says it.

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
2. **Nothing is created or changed in Kritik.** No new criterion, no finding written from this chain, no shared scale.
3. **When a criterion changes, the requirements linked to it read stale** until they are checked again.

Kritik criteria already carry ids to point at. `SAF-01` is "Crisis and self-harm response pathways", in domain `SAF`, with `applies_to`, `default_impact` and `weight` (`packages/kritik-library/framework.json`). A requirement stores that id and nothing else from the criterion.

## 6. Evaluation routing

The species decides which reference scores a stake, so neither framework has to cover everything. The pyramid keeps the three user-facing species; the Kritik matrix keeps the other three.

```
bug, friction, need          -> pyramid of elements of value (value-contribution@2)
requirement, risk, defect    -> Kritik matrix (read by criterion id)
(another species set)        -> another reference, declared the same way
```

A **reference** is a component with a small contract. Any scorer, a person, an agent or Jev, can score against it.

- A versioned criteria set, each criterion with a question and a scale. Weighing already stores the pyramid this way, as `value-contribution@2` (`packages/schema/src/weighing-library.ts`).
- A declared list of the species it can score. A weighing criteria set has a `subject` field for what it judges; slice 1 uses `acceptance` and reserves the rest (`packages/schema/src/weighing.ts`). Declaring species extends that field **(proposal)**.
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

**Kritik criticality** is read from the criterion, never restated: today a criterion carries `default_impact` (1 to 5) and `weight`, and the framework declares `impact`, `likelihood` and `severity_buckets` scales (`packages/kritik-library/framework.json`). Which of these a requirement shows as its criticality is a detail for the evaluation part **(proposal: `default_impact`, with the finding's severity when a finding raised it)**.

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

- **Verified:** the definition of done passes. The stake is addressed technically.
- **Delivered:** the answer is in people's hands. A changelog entry, a release note or an announcement is its trace.

| Species | Verified | Delivered |
|---|---|---|
| Bug | Required | Required |
| Friction | Required | Required |
| Need | Required | Required |
| Requirement | Required | Optional, case by case |
| Risk | Required | Not required |
| Defect | Required | Optional, case by case |

**A proof can expire.** The verified half may carry an expiry date, optional and set case by case. Once it passes, the half reads stale and the stake falls back to *promised* until a new check passes. This suits a risk, whose mitigation is reviewed and never final, and any requirement audited on a schedule.

### Statuses, derived and never stored

The sequence extends weighing's derived states ([weighing § 6](./weighing.md#6-opportunities-and-outcomes)) with one state.

| Status | True when |
|---|---|
| **Raised** | A signal has been qualified into a stake. |
| **Considered** | It has an evaluation or at least one option. |
| **Promised** | A decision selected an option, and the answer has a definition of done. |
| **Verified, not delivered** (new) | The definition of done passes, and a required delivery is missing. This is the fix asleep on a branch. |
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
| **Reference** | A weighing criteria set such as `value-contribution@2` (`packages/schema/src/weighing-library.ts`); the Kritik matrix (`packages/kritik-library/framework.json`). | The Kritik matrix is read as it is. A reference declares the species it scores. |
| **Evaluation** | A weighing assessment: level, scorer with an optional `on_behalf_of`, confidence, optional `p_serves` and `p_costs` (`packages/schema/src/weighing-schemas.ts`). Subjects are acceptances only. | Subjects widen to stakes, with kind, mattering and frequency on the user-facing species. |
| **Option** | Nothing in the schema. The Options Matrix and the opportunity-solution tree are prototypes in the Tool Lab, outside this repo. | New entity. |
| **Decision** | The `decision` species, with `decision_status` and the `generates` edge to an acceptance (`packages/schema/src/ids.ts`, `packages/schema/src/bundle.ts`). A decision that *accepts a cost* on a promise is a weighing proposal ([weighing § 10](./weighing.md#10-costs-and-decisions)), not built. | Reused. It also links one option to one stake. |
| **Answer** | An acceptance, or a story of acceptances, for a feature. | The five other answer types are new. |
| **Definition of done** | The acceptance, said "promise" in the interface. | Generalised to every answer type. "Promise" becomes a role. |
| **Proof, verified half** | Per-platform acceptance status: the parity matrix on the Acceptances page ([`docs/graph-model.md`](../graph-model.md)). | Generalised: non-reproduction, a passing audit, a followed process. |
| **Proof, delivered half** | The `deliverable.shipped` journal event, with `node_ids` and a Lab Note (`packages/schema/src/journal-events.ts`). It is not read as proof today. | New reading: a shipped deliverable that names the stake's answer is its delivered half. |
| **Statuses** | Raised to addressed are *designed* in weighing § 6, not built. | Built with one more state: verified, not delivered. |
| **Provenance** | Stated and inferred marks in the need-qualification method; `on_behalf_of` and confidence (0 guess, 1 inferred, 2 evidenced, 3 verified) on a weighing assessment. | One more axis: observed or anticipated. |

### Three corrections to the design document

1. **The rename needs no migration.** The design document asks for "a migration that still reads old bundles". No bundle can hold an `opportunity` node: the species enum is closed, so a validator rejects it ([weighing § 17](./weighing.md#17-shipping-order)), and the Pebbles bundle has none. The rename is free as long as it lands before slice 2. Only prose changes: the weighing RFC and the need-qualification RFC.
2. **Derived statuses are designed, not built.** "One state added to the current sequence" extends weighing's design, not running code.
3. **The cost-accepting decision is a proposal.** Weighing § 10 proposes `accepted: { decision, level }` on an assessment; nothing in `packages/schema/src/weighing*.ts` holds it yet.

## 11. Shipping order

Each part is its own PR, in this order. Each builds on the one before.

| Part | Ships | Depends on |
|---|---|---|
| **1. Schema** | Graph species `stake` (id prefix `STK-` **(proposal)**), `metadata.stake_species`, the anchor, provenance (observed or anticipated) and the optional catalog link. Like decisions: no platforms, excluded from delivery and parity roll-ups and from the Journey and System maps. | Nothing |
| **2. Signal** | `request.filed` generalised to every source kind, including a Kritik finding, an idea and a benchmark. A verbatim field. Links to many stakes. The "suggested by" link to an option. | 1 |
| **3. Qualification** | Species routing as the first step, ahead of the need-specific steps of need qualification. Merge into an existing stake before creating one. | 1, 2 |
| **4. Evaluation** | A reference declares its species. Kind, mattering and frequency on the user-facing species. Kritik criticality read by criterion id. | 1, 3 |
| **5. Option and decision** | The option entity. A decision links one option to one stake. The derived promise role. | 1, 4 |
| **6. Proof and statuses** | The two halves, the optional expiry and the derived statuses, including "verified, not delivered". | 5 |

### What it changes in weighing's slice 2

Weighing § 17 ships slice 2 as `composes` acceptance to acceptance, species `opportunity`, edge `addresses` with confidence, and caps.

- **`opportunity` becomes `stake`**, built by part 1 above. Its `OPP-` id prefix becomes `STK-` **(proposal)**. Weighing's stored lifecycle (`idea`, `discovery`, `archived`) carries over unchanged.
- **`addresses`** (acceptance to opportunity) becomes acceptance to stake. It is how a feature's definition of done points to the stake it answers. For the other answer types, part 5 decides the shape.
- **Stories** (`composes` acceptance to acceptance) and **caps** are untouched. Caps read needs; they read stakes of species `need`, and later friction.
- Weighing § 18 question 10 ("opportunity" or "need" in the interface) is settled: **stake**.

## 12. Open questions

| # | Question | Lean |
|---|---|---|
| 1 | **How are options compared?** The criteria for choosing between options are not defined. | Deferred to its own research session. The Options Matrix prototype is the starting point. Do not build on it yet. |
| 2 | Definitions of done for friction, risk and defect. | The proposals in [§ 3](#3-species). Not settled. |
| 3 | Frequency on bug and friction. | Assumed. The owner has not confirmed. |
| 4 | The balance of gains against protections. | A later analysis layer, derived, never stored. |
| 5 | The schema name of the six species, given that *species* already names graph node kinds. | `metadata.stake_species` **(proposal)**. |
| 6 | Is the anchor an edge or a field? An edge lets a stake be traversed like the graph and admits several anchors. | An edge **(proposal)**, named in part 1. |
| 7 | Which Kritik field reads as a requirement's criticality. | `default_impact`, with the finding's severity when a finding raised it **(proposal)**. |
| 8 | Is an option a graph species, a record, or (for features) a candidate story at status `idea`? | Part 5 decides. For features, a candidate story already fits. |

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
