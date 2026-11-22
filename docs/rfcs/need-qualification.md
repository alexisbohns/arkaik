---
title: "RFC: Need qualification (voice to value)"
navTitle: "RFC: Need qualification"
order: 93
---

# RFC: Need qualification: from raw input to a qualified need

> Status: **Proposed. A method, not yet a feature; nothing here is implemented.** 2026-11-22. Worked out with the product owner from 2026-11-16 to 2026-11-21, on the Pebbles backlog. The method was used in a ranking tool and tested on 33 of 77 needs by one labeller. Items marked **(proposal)** were not settled. [§ 8](#8-what-the-pebbles-run-showed) says what the run did and did not show.
>
> Precedent: [Weighing](./weighing.md). That RFC defines the species now built as `stake` and leaves *stake sizing* unslotted ([§ 18, question 9](./weighing.md#18-open-questions)). This RFC answers what sizing could be, and how a stake gets its wording.
>
> Extended by: [Stake architecture](./stake-architecture.md) (2026-11-22, agreed with the product owner). It places this method inside a wider chain (signal, stake, evaluation, options, decision, answer, proof). Where the two disagree, that RFC wins. What it changes in this one:
>
> - **The node is renamed.** `opportunity` becomes `stake`, in the interface and in the schema.
> - **A need is one species of six** (bug, friction, need, requirement, risk, defect). Classifying the register ([step 2](#step-2-classify-the-register)) becomes species routing, and the gate ([step 5](#step-5-gate-is-this-a-need-to-weigh)) gives a routed-out item a species instead of parking it.
> - **Feedback is evidence.** It is a signal; the species for a friction on something that works as designed is *friction*.
> - **Kind and mattering reach further** ([steps 6 and 7](#step-6-feel-route-by-how-the-need-is-experienced)). A friction takes one of the three kinds like a need; a bug is always *expected*. Mattering ranks inside a kind, and the pyramid score says which value is at stake.
> - **Kritik is read, never written.** Requirements, risks and defects are scored against the Kritik matrix and point to a criterion by its id. This settles [open questions 5 and 6](#9-open-questions).
>
> Written so a person or a triage agent can follow it.

## Summary

Raw product input arrives in every shape: a bug report, a complaint, a feature request, a half-formed idea. Weighing needs *needs* to weigh, in the user's words, and says nothing about how to get from the input to the need.

This RFC defines that path as nine steps. The output is a **qualified need**:

- **positive and solution-neutral** (what a person wants to do, know or have, not a mechanism and not a fix);
- **with provenance**: which parts were stated by someone and which are the analyst's hypothesis;
- **with a felt kind**: expected, wanted or a delight;
- **with a measure of how much it matters**, on a scale that fits the kind;
- **with a frequency**, kept apart from how much it matters.

It is **not** a bug or QA triage. Many items that arrive as needs are sanity checks on a feature that already exists. The method recognises them and routes them out. It does not weigh them as stakes.

```
voice -> classify register -> neutralize and excavate -> merge -> gate -> feel -> matter -> frequency -> (values)
```

## 1. The problem

On Pebbles, the backlog was the first corpus. 100 items (issues, Lab Notes, pull requests) were read as needs. After laddering and merging, they became 77 needs and 7 groupings. The owner rated the first 33 of the 77 and noticed three things.

1. **Most items were complaints or solutions in disguise.** "I need to branch ChatGPT on Pebbles" names a mechanism. "I backgrounded my app and lost the pebble" is one occurrence of something, not a need.
2. **The needs were negatively worded.** The first ranking page asked how critical each one was and what to fix. The owner's correction: a need is something we *address*, not something we fix, and classification has to come before judging.
3. **A single "how much does it matter" scale did not fit.** "Browsing back through my path feels immediate, photos included" is not transformative and not marginal. It is *expected*: nobody notices it when it works, and they are annoyed when it does not.

All three come from asking for a size before asking what the thing is. The method fixes the order: say what it is, then what it is underneath, then how it feels, then how much it matters.

## 2. Vocabulary

| Term | Meaning |
|---|---|
| **Need** | A positive, lasting thing a person wants to do, know or have. Something we address, not something we fix. Stored as a `stake` ([Weighing § 6](./weighing.md#6-opportunities-and-outcomes)). |
| **Complaint / feedback** | One real occurrence of a person hitting a gap. Dated and sourced. It is **evidence** for a need, never the need. |
| **Solution-biased need** | Voiced as a need but names one way of meeting it ("I need to branch ChatGPT on Pebbles"). |
| **Feature** | A described capability with the need left unstated. |
| **Requirement / sanity check** | A condition an existing feature must satisfy to feel robust or safe. A quality concern. |
| **Product stance** | A principle the product takes that rules solutions in or out ("connections need both people's agreement"). A constraint on solutions, not a need. **(proposal)**: it is not yet a route in the ranking tool, and "not a need" absorbed it. |
| **Internal** | About operating the product (CI, telemetry, maker analytics) with no experience a person has. |

## 3. The pipeline

### Step 1. Voice: capture the input as it came

Keep the input exactly as voiced and never edit it. Record:

- the source (issue, PR, Lab Note, journal event, interview, review), its reference and URL, and its date;
- the **voice**: `user` or `maintainer`;
- the **actor**: `person` or `operator`;
- a verbatim quote.

Voice matters. On Pebbles, 99 of 100 items were found by the maintainer (audits, device passes, code reads) and not reported by users. A maintainer-found item is evidence of a gap, not of anyone's demand.

### Step 2. Classify the register

Decide what the input is, because the next steps differ.

- **Complaint:** describes something that happened to a person. *"I backgrounded the app and lost the pebble I was creating; I had to reupload, resize and rename my picture."*
- **Need:** says what the person wants, in their terms. *"When I record, I need to be reassured that what I filled in is kept even if I quit the app or lose connection."*
- **Solution-biased need:** asks for a mechanism.
- **Feature:** asks for a capability.
- **Requirement / sanity check, stance, internal:** see [§ 2](#2-vocabulary).

The same underlying need can arrive in several registers. The lost-pebble complaint and the "reassured it is kept" statement are one need.

### Step 3. Neutralize and excavate (laddering)

Take the voiced input and ask **why?** until the need could be addressed by several quite different solutions.

Worked example (solution-biased):

1. *Voiced:* "I need to branch ChatGPT on Pebbles."
2. *Why:* "I want ChatGPT to analyse my history and tendencies." That gives "I can identify my tendencies."
3. *Why:* possibly "I understand how my emotional economy works". This is a hypothesis to challenge.
4. *Workaround:* today the person asks ChatGPT. That also tells you what people already pay to meet the need.

Rules:

1. **Never invent.** A rung is `stated` only if the source says it, with a verbatim quote. Anything else is `inferred`: a hypothesis for a human to confirm. Keep that mark through every later step.
2. **Climb at most three rungs** above the voiced one. Stop sooner when the next rung is too vague to act on ("I live a good life").
3. **Choose the rung to weigh with the solution test.** The right rung is the one where at least three genuinely different solutions could address the need and the rung below it names a single solution. Write the three alternatives. If you cannot, the rung is too low. For a complaint, the occurrence is rung 0 and the need is usually rung 1.
4. **Write it positively**, in the first person, for the person and not for the maintainer. "What I have filled in is kept, even if I quit or lose connection", not "the app must not lose my draft". No "shouldn't", "no longer", "stop" or "fix".
5. **Record the workaround** in its own field (null if unknown, marked inferred if guessed).
6. **Split** when the "why" has two different answers. List them as separate needs.
7. **A more general rung is not automatically a better one.** Record parent and child links and weigh at the rung the solution test picks. The owner may later weigh at either level.

### Step 4. Merge

Merge items whose chosen need is the same need at the same rung, and only when one solution-neutral sentence honestly covers them all.

- A related need at a different rung is a parent or a child, not a merge.
- Never merge a person-facing need with an operator-facing one.
- Keep every item as evidence under its need.
- **Evidence count is not frequency** when the items are maintainer-found ([step 8](#step-8-frequency)).

### Step 5. Gate: is this a need to weigh?

Route out what is not a need to weigh as a stake.

| Route | Where it goes |
|---|---|
| Requirement / sanity check | A quality audit, as a candidate check with its source and quote. For Pebbles that audit is [Kritik](./kritik.md). Routing was deliberately **not** done in this work. |
| Product stance | A principle that constrains solutions. **(proposal)** |
| Internal, or off scope | Set aside, with the reason. |

Tests that an item is a check and not a need:

- it derives from a bug or an audit finding;
- nobody is quoted asking for it;
- it would be satisfied by "the feature works as intended";
- the person would only mention it when it fails.

Keep the excluded item and its reason, so a human can overrule the call.

### Step 6. Feel: route by how the need is experienced

Ask: **how would the person feel it?** This is a routing question, not a size. It decides which question [step 7](#step-7-matter) asks.

It adapts the Kano model: expected is *must-be*, wanted is *performance*, a delight is *attractive*. It is asked as a single question. The standard method asks "how would you feel if it were there?" and "if it were missing?" separately. That paired form is available if one-question answers prove unreliable.

| Kind | Definition | Tell |
|---|---|---|
| **Expected** | Nobody notices it when it works. They are annoyed when it does not. | Nobody asks for it. It only appears in complaints. *Browsing back through my path feels immediate, photos included.* |
| **Wanted** | More of it is better, in proportion. | People ask for it and compare. *I can get a moment down quickly.* |
| **A delight** | They do not miss it when it is absent. It pleases them when it is there. | Nobody would complain without it. *A reward or surprise the person remembers.* |

Do not order needs of different kinds against each other. An expected need and a delight do not compete for the same slot.

### Step 7. Matter

The same four tiers for every kind, stored as the numbers 4 to 1, so everything stays comparable. The question and the wording of the tiers change with the kind. Judge the person's experience: not the work it would take, and not how many people have it.

**Wanted. "How much does addressing this matter to the person?"**

| Tier | Definition |
|---|---|
| 4 Transformative | Changes what the person gets from the product. |
| 3 Valuable | The person would clearly feel the difference. |
| 2 Nice to have | They would be pleased, and not much would change. |
| 1 Marginal | It would barely register. |

**A delight. "How much would it please the person?"**

| Tier | Definition |
|---|---|
| 4 Memorable | They would remember it and mention it. |
| 3 Pleasing | They would clearly enjoy it. |
| 2 Pleasant | A small smile, and not much more. |
| 1 Barely registers | Most would hardly notice. |

**Expected. "How much would it hurt if it were missing?"** This is the one place a negative framing is accepted, because that is how an expected need is felt.

| Tier | Definition |
|---|---|
| 4 Deal-breaker | They would stop using it, or stop trusting it. |
| 3 Clearly annoying | They would notice and be bothered each time. |
| 2 Mildly annoying | They would notice now and then. |
| 1 Barely noticed | Most would shrug. |

Status: the owner used all three scales while rating. The expected wording was not discussed on its own.

### Step 8. Frequency

Ask: **how often would it come up for the person?** `rare`, `some` or `often`. It is optional, and separate from mattering: a need can matter a lot and come up rarely, or the reverse.

Frequency is **not** the evidence count. Count only occurrences that a real person reported, dated and sourced. When almost every item is maintainer-found, as on Pebbles, the count measures the maintainer's attention. In that case estimate frequency from the person's described situation and mark it inferred.

### Step 9 (optional). Values

Which of the 30 elements of value does addressing the need give the person? Phrase it positively: what the person gets once the need is addressed. In the tool this was optional and used on 19 of 33 cards.

## 4. Where it lands in the graph

**(proposal, all of it.)** A qualified need is a `stake` ([Weighing § 6](./weighing.md#6-opportunities-and-outcomes)). The species exists ([Stake architecture](./stake-architecture.md), part 1) with `stake_species`, `provenance` and `catalog`; the fields in this table are not built yet, so it only shows the mapping.

| Method output | Stake field |
|---|---|
| `need` (the chosen rung, positive, first person) | `title` |
| `evidence[]` (item, voice, date, quote) | `metadata.evidence` (already in Weighing § 6) |
| `values[]` | `metadata.values` (already in Weighing § 6) |
| `felt`, `matters`, `frequency` | `metadata.felt`, `metadata.matters`, `metadata.frequency` |
| `ladder[]`, `workaround`, `solution_test` | `metadata.ladder`, `metadata.workaround`, `metadata.solution_test`, kept so a human can overrule an inferred rung |
| `route`, `parent` | `route` is not stored (routed-out items are not stakes of the need species). `parent` becomes a link between stakes. |
| Agent-written records | Land at status `idea`, like every agent write ([Weighing § 6](./weighing.md#6-opportunities-and-outcomes)). |

Two consequences for the Weighing RFC:

1. **Wording.** Its example title, *"I don't find out when someone accepts my invite or shares a moment with me"*, is a deficit. Under this method it would be written positively ("I know when someone accepts my invite or shares a moment with me"), and the deficit would be kept as evidence. Nothing is implemented, so nothing breaks. The example would be updated if this RFC is accepted.
2. **Sizing.** Weighing leaves *stake sizing* open ([§ 18, question 9](./weighing.md#18-open-questions)). The proposal here is that a need is sized by `felt` and `matters`, never by evidence count, and that a need's weight is only compared with the weight of needs of the same kind.

## 5. The output record

```json
{
  "id": "NV-050",
  "voiced": ["Browsing back through my path feels slow with photos"],
  "kind_of_input": "complaint | need | solution-biased | feature | requirement | stance | internal",
  "ladder": [
    {"rung": 0, "text": "…", "provenance": "voiced"},
    {"rung": 1, "text": "…", "provenance": "stated | inferred", "quote": "verbatim or null"}
  ],
  "chosen_rung": 1,
  "need": "Browsing back through my path and opening a pebble feels immediate, photos included, however many pebbles I have.",
  "solution_test": {"alternatives": ["…", "…", "…"], "passes": true},
  "workaround": {"text": "…", "provenance": "stated | inferred"},
  "evidence": [{"item": "N-020", "voice": "maintainer", "date": "…", "quote": "…"}],
  "actor": "person | operator",
  "route": "weigh | check | stance | internal | off-scope",
  "felt": "expected | wanted | delight",
  "matters": 1,
  "frequency": "rare | some | often",
  "values": ["saves-time"],
  "parent": null,
  "confidence": "high | medium | low",
  "open_questions": ["…"]
}
```

Ordering: group by `felt` and `matters`, and order inside a group. Never across kinds.

## 6. Running it as a triage agent

The method is meant to be run by an agent, with a human confirming what the agent only inferred.

- **Input:** raw items with voice, source and date.
- **Output:** the records above, plus an excluded list with a reason for each item.
- **The agent may decide alone:** the register, merge proposals, the route for clear checks, positive wording, and the solution test.
- **The agent must hand to a human:**
  - every `inferred` rung the need's wording depends on;
  - any merge it is less than confident about;
  - every item routed out, so a human can overrule it;
  - `felt` and `matters`, which are judgements and not facts.
- **Guardrails:**
  - never invent a reason or a quote;
  - keep the provenance marks;
  - never delete an input;
  - a human's answer beats the agent's;
  - never mix kinds when ordering.
- **Where a scorer such as Jev can help:** scoring a need against the 30 elements ([step 9](#step-9-optional-values)). It must be asked a positive question, what the person gets once the need is addressed, and it must be run at the chosen rung. The question stem used in the Pebbles run still carried the deficit framing ("is not getting"). It must be reworded and re-run before any comparison with human ratings.

## 7. Decisions at a glance

| Decision | Choice |
|---|---|
| What a need is | Positive and solution-neutral. Something we address, not something we fix. |
| Complaints | Evidence for a need, never the need. |
| Where to weigh | At the rung the solution test picks (three genuinely different solutions). |
| Provenance | `stated` with a verbatim quote, or `inferred`, kept to the end. |
| How it feels | Expected, wanted or a delight. A routing question, asked first. |
| How much it matters | Four tiers per kind, stored as 4 to 1. Never ordered across kinds. |
| Frequency | Separate from mattering, and separate from the evidence count. |
| Sanity checks | Recognised and routed out, not weighed as stakes. |

## 8. What the Pebbles run showed

- **Corpus.** 100 backlog items became 84 records after laddering and merging: 77 needs and 7 groupings. 59 of 78 records rest on one item. Only one has any user voice.
- **The backlog is a QA corpus.** On the owner's first 33 of 77 ratings, 22 were right as written, 10 were "not a need" and 1 needed a split. Of the 10, nine cite a reason, and five of those name a sanity check, a requirement or a Kritik check. Of the 23 kept, 16 are expected, 4 are wanted and 3 are a delight. Only the 7 wanted or delight needs look like opportunities.
- **Laddering is mostly inference.** Of the rungs above the voiced sentence, most were inferred (about 36 of 42 in one slice). The human confirmation step is the real work.
- **Jev**, run on these needs under the deficit framing, was stable (95.6% of cells at the same level across runs) but generous at a 0.5 threshold (`makes-money` fired on 56 of 100 needs). The 30 elements have no home for safety, legal or accessibility needs. None of this was checked against labels.

The QA result comes from the source, not from the method: a backlog of shipped features, found by the person who built them, reads as robustness work. It says nothing about how well the method works on input that is shaped like opportunities.

## 9. Open questions

| # | Question | Lean |
|---|---|---|
| 1 | Does the method hold on opportunity-shaped input (user voice, roadmap and vision documents, positioning gaps)? It has only run on a QA-shaped corpus, with one labeller and 33 of 77 needs. | Run it on real opportunities before building anything. |
| 2 | Is a single `felt` question reliable, or does it need the paired present/absent form? | Keep the single question until the answers prove unreliable. |
| 3 | Is **product stance** its own route? "Not a need" currently absorbs it. | Yes, as its own route. It is a constraint on solutions and not a need. |
| 4 | Should frequency enter the ordering, and how? | Undecided. Show it, do not sort by it yet. |
| 5 | Should sanity checks be routed into Kritik as candidate checks? | **Settled 2026-11-22: no.** They become stakes of species requirement or defect and nothing is written into Kritik. See [the stake architecture](./stake-architecture.md). Earlier lean: not decided; the owner chose not to touch Kritik in this work, so routed-out items were only parked. |
| 6 | Should the safety, legal and accessibility needs get elements, or sit outside the 30? | **Settled 2026-11-22: outside the 30.** They are requirements, risks or defects, scored against the Kritik matrix. See [the stake architecture](./stake-architecture.md). |
| 7 | The expected-need tier wording was never discussed on its own. | Review it with the first expected needs of a real run. |

## 10. Next steps

1. Source real opportunities (user voice, roadmap, positioning gaps) and run the method on them.
2. Reword the Jev need-side question positively and re-run it before comparing it with the owner's ratings, by kind.
3. Decide product stance as a route.
4. If accepted, update the example title in [Weighing § 6](./weighing.md#6-opportunities-and-outcomes), and add the fields in [§ 4](#4-where-it-lands-in-the-graph) when slice 2 lands the rest of the weighing chain.
