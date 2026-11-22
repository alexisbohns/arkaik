---
title: "RFC: Weighing (promises, journeys and value)"
navTitle: "RFC: Weighing"
order: 92
---

# RFC: Weighing: promises, journeys and value

> Status: **Accepted; slice 1 implemented** (the weighing section, the signed value matrix, the panel form, positioning, and the MCP tools `get_matrix`, `assess` and `save_positioning`). Slices 2 and 3 are not implemented. 2026-11-15. The product owner and the lead settled the model below in a design discussion. The model is cut into three slices in [§ 17](#17-shipping-order), each its own release.
>
> Reading guide: sentences about what Arkaik does *today* are checked against the code and cite a path. Shapes marked **(proposal)** are the lead's working choice for a detail the discussion did not settle. Pebbles ids are real (from `pbbls/docs/arkaik/bundle.json`) unless marked proposal or hypothetical.
>
> Superseded in part by: [Stake architecture](./stake-architecture.md) (2026-11-22). The `opportunity` species designed in slice 2 is built as `stake` instead, one node with six species; [§ 11 there](./stake-architecture.md#11-shipping-order) says what changes in slice 2.
>
> Precedent: [Kritik](./kritik.md). Weighing generalizes the part of Kritik that judges (criteria, levels, assessments, matrices, caps) so that promises, needs and options can be judged the same way surfaces are.

## Summary

Arkaik can count promises. It cannot weigh them. Pebbles has 159 acceptances; 30 of them claim "avoids hassles" and 2 claim "therapeutic value". Nothing says whether that is a problem, because nothing has a weight.

This RFC adds weighing in small, optional layers:

1. **A signed level for value.** Each promise gets a level from −3 to +3 on the elements of value it touches. Positive means it serves the element. Negative means it costs it. Served and cost are summed separately, never netted.
2. **Stories.** An acceptance can have child acceptances, at any depth. The story is the unit we score. The leaves are the unit we deliver and check on each platform.
3. **Needs and outcomes.** A story can address a need (a *stake*), and a need can serve a measurable *outcome*.
4. **Positioning.** The product states, in its own words, which elements it stands on.
5. **Caps.** A hole in the value we stand for cannot be averaged away. It shows as a visible lid.

All of it rests on one way of judging, the one Kritik already uses: a level on a described scale, for one subject, on one criterion, with who scored it and how sure they were.

```
  WHY WE BUILD                 WHAT WE OWE                          WHERE IT LIVES

  Outcome <--serves-- Stake <--addresses-- Story --covers--> Journey, view
  a number            a need, in the              |
   (new)              user's words               composes
                       (new)                      v
                         ^                       Leaf  Gherkin + status per platform
                         |                       (today's acceptance)
                    hollow need
                    (placeholder, named later)

  ONE WAY OF JUDGING, USED FOUR TIMES

  Assessment = a level, for one subject, on one criterion,
               + who scored it + how sure + on what evidence

  surfaces       x Kritik's criteria        0..4     grades, findings        today
  stories        x the elements of value   -3..+3    served, cost, gaps      new
  stakes  x reach, intensity, ...    0..4     a ranked list of needs  new
  options        x a decision's criteria    0..4     a winner and its limits new
```

**Nothing is mandatory.** A project with only acceptances looks exactly as it does today. Each layer is switched on by adding data. A human can do every action. Agents do the same actions at scale, and turn the output of brainstorms and code sessions into the map.

### Decisions at a glance

| # | Decision | Section |
|---|---|---|
| 1 | Status and role are different things. An acceptance always has a status and may have roles. | [§ 4](#4-role-and-status) |
| 2 | Acceptances nest at any depth. A story is an acceptance with parts. | [§ 5](#5-stories) |
| 3 | A promise may point straight at an outcome. The link goes through a hollow placeholder need (option C). | [§ 6](#6-opportunities-and-outcomes) |
| 4 | One assessment primitive serves four kinds of judging. | [§ 7](#7-the-assessment-primitive) |
| 5 | The value scale is signed, −3 to +3. Served and cost are never netted. | [§ 8](#8-the-signed-value-scale) |
| 6 | There are no human-only actions. Provenance is on every record and a human's level wins. | [§ 9](#9-positioning-as-criteria) |
| 7 | Positioning is a criteria set with weights and level descriptions in the product's words. | [§ 9](#9-positioning-as-criteria) |
| 8 | Estimating a cost needs no decision. A cost on a chosen or live promise stays "unexplained" until a decision covers it. | [§ 10](#10-costs-and-decisions) |
| 9 | Caps are declarative rules stored with the criteria, shown as a visible lid. Accepting a cost lifts the cap and keeps the cost. | [§ 11](#11-caps) |
| 10 | The cheap matrix (stories by elements) ships first. The expensive one (journeys by elements, with evidence) comes last. | [§ 14](#14-the-progressive-layers), [§ 17](#17-shipping-order) |
| 11 | The states of a need are derived, never stored: raised, considered, promised, partly addressed, addressed. | [§ 6](#6-opportunities-and-outcomes) |
| 12 | The journey cap fires on the owed share: the promises owed on a platform carry at least X% of the journey's served mass there. X lives in the positioning, 25% by default. It never ties. | [§ 11](#11-caps) |
| 13 | A scorer records whom it acts for (`on_behalf_of`), where identity is known: the token owner's id on a hosted write, the git author name (or an override) in a repo. Never an email. | [§ 7](#7-the-assessment-primitive) |

---

## 1. The problem

The owner reviewed four prototypes of a redesigned Acceptances page and found that the page serves three different intentions:

| Intention | The question | Who asks |
|---|---|---|
| **Parity monitoring** | Is every promise kept on every platform it applies to? | Whoever ships |
| **Product mapping** | What does the product promise, journey by journey? | Whoever needs to understand the product |
| **Value assessment** | Do we deliver the value we stand for, and where should we invest? | Whoever decides what is next |

One notion is missing for all three: a way to **weigh**. Today only counting exists:

- The Pyramid page (`/project/[id]/pyramid`, `lib/utils/pyramid.ts`) shows, per element, how many acceptances claim it and how those are delivered per platform. That is a count with a progress bar ([`docs/graph-model.md`](../graph-model.md) § Pyramid View).
- The Acceptances page is the parity matrix: acceptances grouped by what they cover, one status column per platform (`docs/graph-model.md` § Acceptances View).
- An acceptance lists the elements it is *for* in `metadata.values`. It says which elements, not how much ([`docs/spec/bundle-format.md`](../spec/bundle-format.md) § Acceptance Nodes).

Counting cannot say that a promise matters more than another, that a journey is thin where it should be strong, or that a promise costs a value it never claimed. The pyramid should become an evaluation matrix like Kritik's. Its "findings" on the value side are stakes.

## 2. The principles

| Principle | What it means here |
|---|---|
| **Optional layers** | The product stays usable without any of this. A page that lacks a layer shows counts, labelled as counts. |
| **Human-operable** | Every action can be done by a person, through a form or the existing panel. |
| **Agent-scalable** | Agents may do any action too, to help, to work at scale, or to turn a brainstorm or a code session into the map. That is the point of mapping. Provenance says who did what. |
| **Scores from orthogonal criteria** | Every score comes from a matrix of criteria that do not overlap. A person assesses it through a form. A probabilistic scorer such as Jev.ai can assess it at scale. Nothing is a free-floating number. |
| **Stored and computed are separate** | Stored: nodes, edges and assessments. Computed on every read: served, cost, shares, states, caps. A computed number cannot go stale and cannot disagree with its inputs. This is already Kritik's rule ([`docs/spec/bundle-format.md`](../spec/bundle-format.md) § Quality: "Derived values are never stored"). |

## 3. The vocabulary

One meaning per word. "New" means the model does not have it today. "Derived" means computed, never stored.

| Word | Meaning | Status | Where |
|---|---|---|---|
| **Acceptance** | A testable promise: What (`title`), How (`metadata.gherkin`), Why (`metadata.values`), a status per platform. | Exists | Species `acceptance`, `AC-` ([`docs/graph-model.md`](../graph-model.md) § Species) |
| **Promise** | The same thing, said to a human. The docs already call an acceptance "a testable promise". `acceptance` stays the word in the schema, the CLI and the MCP. | Exists | A label, not an entity |
| **Story** | An acceptance that has child acceptances. It is the named solution to a need. | New | Same species. New `composes` pair, acceptance to acceptance |
| **Leaf** | An acceptance with no children. It carries the Gherkin and the platform statuses. A quick win is a lone leaf. | Derived | |
| **Journey** | A flow. A promise belongs to the journeys its `covers` edges reach. | Exists | Species `flow` |
| **Value element** | One of 30 reasons a promise can matter, in 4 tiers (functional, emotional, life-changing, social impact). | Exists | `VALUE_IDS` in `packages/schema/src/ids.ts`, labels in `lib/config/values.ts` |
| **Stake** | A need, pain or wish in the user's voice, with evidence. Said **"need"** to a human, the way an acceptance is a promise (owner, 2026-11-15). | New | Species `stake`, `STK-` |
| **Need** | The same thing as a stake, said to a human. `stake` stays the word in the schema. | New | A label, not an entity |
| **Feedback** | One real-life occurrence of one or several needs: evidence, dated and sourced (a `request.filed` event, say), linked to needs many-to-many. Not weighed itself; it adds evidence and frequency to a need's size. | New | Slice 2 |
| **Outcome** | A measurable change in what people do, that the team wants. | New | Species `outcome`, `OUT-` |
| **Solution** | A story that answers a stake. It is a role, drawn as an `addresses` edge. | New | Edge, no species |
| **Hollow need** | An unnamed stake, created when a promise is linked straight to an outcome. A person or an agent names it later. | New | A `stake` node flagged as unnamed |
| **Status** | Where the acceptance itself stands in its lifecycle. One value. | Exists | `idea`, `discovery`, `backlog`, `development`, `releasing`, `live`, `archived` |
| **Role** | What an acceptance is for, relative to something else. Several allowed. | New | An edge |
| **Criterion** | One question on a described scale. | Exists (Kritik) | Generalized |
| **Criteria set** | A versioned list of criteria for one kind of subject. Kritik's library is one. The 30 elements are another. A product's positioning is a third. | Exists (Kritik) | Generalized |
| **Matrix** | A criteria set applied to a list of subjects. | Exists (Kritik's profile) | Generalized |
| **Assessment** | One cell: a level, for one subject on one criterion, with scorer, confidence, evidence and basis. | Exists (`QualityAssessment`) | Generalized. Adds scorer and confidence |
| **Level** | The value in a cell. A whole number on the set's scale. | Exists | |
| **Positioning** | The elements the product stands on, each with a weight and level descriptions in the product's words. | New | A criteria set |
| **Served** | The positive levels of a subject, summed. | Derived | |
| **Cost** | The negative levels of a subject, summed as positive numbers. | Derived | |
| **State** | A word for how a thing is doing: thriving, served, thin, at risk (elements, journeys); on track, partly ready, blocked (outcomes). | Derived | |
| **Need state** | Where a need stands: raised, considered, promised, partly addressed, addressed. Promises are *kept*; needs are *addressed*. | Derived | [§ 6](#6-opportunities-and-outcomes) |
| **Cap** | A rule that holds a state down, however good the rest is. | New | Declarative rule in a criteria set |
| **Unexplained cost** | A cost on a chosen or live promise that no decision covers. | Derived | |
| **Option** | One subject of an Options Matrix. Always a story, since the story is the named solution. | New | |
| **Finding** | A concrete defect found by a Kritik audit. Unchanged. | Exists | `bundle.quality` |

Weight is reserved for what a criterion counts in this project. A promise does not have a weight. It has a served and a cost. That keeps the two from being confused.

**Outcome or objective.** The acceptance spec reserved, and did not build, a species `objective` (`OBJ-`) and an edge `serves` from acceptance to objective, measured by "% of served acceptances live" ([`docs/superpowers/specs/2026-07-19-acceptance-value-model-design.md`](../superpowers/specs/2026-07-19-acceptance-value-model-design.md) § 3.6). This design uses the slot differently:

- It is named **outcome**, because it carries a number that comes from users. Measuring it by how much we shipped would be the progress bar we are leaving behind.
- The `serves` edge keeps its name and runs from stake to outcome.

Nothing was built on the reservation, so the change costs no migration. The spec's § 3.6 is updated when the outcome ships.

## 4. Role and status

They answer different questions, so an acceptance always has both.

- **Status** describes the acceptance itself. It has exactly one value, follows the lifecycle, and answers "how far along is it, and will we build it?".
- **Role** is a relation to something else. It exists because of the thing on the other end, an acceptance can have several, and it answers "what is it for?". Being a solution is a role: the `addresses` edge to a stake.

The four combinations:

| | Addresses a need | Addresses none |
|---|---|---|
| **idea** | Candidate solution | Raw idea |
| **live** | Shipped solution | Shipped, reason unstated |

Pebbles examples:

- `AC-invite-link-and-qr` is live and answers "bring in one person I chose" (a proposed need, see [§ 16](#16-pebbles-worked)). It is a shipped solution.
- The three profile acceptances in Connect (`AC-profile-identity-banner`, `AC-profile-practice-stats`, `AC-profile-achievements-shelf`) are live and answer nothing. That is a visible fact, not a defect.

**Two hypotheses live in two places.**

| Hypothesis | Where it lives |
|---|---|
| "Will we build it?" | The acceptance's **status** |
| "Will it really answer the need?" | The **confidence on the `addresses` edge** |

The second survives shipping. A live acceptance's link to a need stays a bet until the outcome moves. An edge already has an optional `metadata` record (`EdgeSchema` in `packages/schema/src/bundle.ts`), so the confidence needs no new field on the edge type. It reuses the four confidence anchors of [§ 7](#7-the-assessment-primitive) **(proposal)**.

**Why not a status for it.** A candidate solution and a shipped one differ in status. A candidate and a raw idea differ in role. Merging the two axes would give one list of values that no one could read: "idea that addresses a need" is not a stage of life.

The existing graph already allows this without new machinery. An acceptance with no `covers` edge is legal and means intake: "an idea filed before the flows and views exist" ([`docs/spec/bundle-format.md`](../spec/bundle-format.md) § Acceptance Nodes). The `idea` status is already defined as "Raw capture, request, intuition, opportunity" (`docs/graph-model.md` § Status Model).

## 5. Stories

The owner distinguishes a **story** ("I can attach a picture to a pebble") from the granular acceptances inside it ("I can choose the picture in my roll", "I can browse my albums", "I can resize the upload"). Sometimes there are two levels, sometimes one. A quick win needs one PR. A bigger piece needs a stack, or several stacks delivered over time.

### One kind of record, nestable

- A new species pair on the existing `composes` edge: **acceptance to acceptance**. Today only `covers` (to a view or flow) and `generates` (from a decision) touch an acceptance (`VALID_EDGE_SEMANTICS` in `packages/schema/src/ids.ts`).
- **Depth is free.** A quick win is a lone acceptance. A story has parts, and parts can have parts. A quick win that grows gets children and is never re-identified.
- **Delivery size never decides the level.** Deliverables (PRs, stacks) name the acceptances they ship. A leaf that needed a stack is still a leaf. A story delivered by three stacks goes from in the making, to partly kept, to kept as its leaves go live.
- A story with no leaves yet is a candidate solution: a story at `idea`.

### What each level carries

| | Leaf | Story |
|---|---|---|
| Gherkin | Yes. It is the test. | **Optional.** The owner: "leaves can do the job". When present, it is the end-to-end scenario. |
| Status per platform | Stored, as today (`metadata.platformStatuses`) | **Derived** from its leaves. A story with no leaves reads its own stored status. |
| Value levels | Inherits the story's levels. Scores only the elements the story does not carry. | Scored once, at the top. |
| Addresses a need | Does not need to | **Yes. The story is the named solution.** |
| Read by | Parity (what is owed, concretely) | Mapping, and value |

**A story's own Gherkin is optional.** Decided. A story with leaves is checked by its leaves' Gherkin. It may carry one end-to-end scenario of its own, and nothing requires it. A story with no leaves yet is a candidate and has nothing to check.

### Each intention reads a different level

- **Parity reads leaves**, because what is owed must be concrete: "iOS still owes: browse albums".
- **Mapping reads stories**, because a map is read in promises people recognize.
- **Value scores stories once, at the top.** Leaves inherit and add only what the story does not carry, so nothing is counted twice. The story's kept share comes from its leaves.

If a story and one of its leaves both score the same element, the story's level is the one counted **(proposal)**. It is the simplest rule that cannot double count.

### Real example: the photo story

Pebbles has these as four sibling acceptances today. With stories, the first is the story and the other three are its leaves. The levels are **proposals**.

| Acceptance | Role | Value levels (proposal) |
|---|---|---|
| `AC-attach-photo-to-pebble` "Pin a picture to the moment" | **Story** | nostalgia **+3**, sensory appeal **+2** |
| `AC-replace-pebble-photo` "Swap out the picture you wish you had picked" | Leaf | avoids hassles **+2** |
| `AC-pebble-photo-allowance-is-enforced` "You are told when a pebble is over its photo limit" | Leaf | informs **+1**, avoids hassles **−1** (a limit is a friction) |
| `AC-pebble-photos-stay-private` "The photos on your pebbles stay private" | Leaf | reduces anxiety **+3** |

Read at the story level, the photo story serves nostalgia 3, sensory appeal 2, avoids hassles 2, informs 1 and reduces anxiety 3, and costs avoids hassles 1. Served and cost for avoids hassles stay separate: `+2` from one leaf, `−1` from another. The allowance leaf is `ios` and `android` only; the other leaves apply to all three platforms, so parity stays concrete even though the story is one thing.

### Things this design does not decide yet

- A leaf with two parents would be counted twice by every roll-up. The recommendation is **one parent per acceptance**, a tree, with a cycle check as playlists have. The discussion did not settle it ([§ 18](#18-open-questions)).
- Stakes may nest the same way, mirroring stories, but they **start flat**.

## 6. Opportunities and outcomes

### The two species

Both follow the decision precedent: no platforms, excluded from delivery and parity roll-ups, absent from the Journey and System maps by construction ([`docs/graph-model.md`](../graph-model.md) § Decisions).

```ts
// Species "stake", id prefix STK-   (all fields are a proposal)
{
  id: "STK-know-when-something-happens",
  title: "I don't find out when someone accepts my invite or shares a moment with me", // the user's voice
  status: "idea",               // idea | discovery | archived (below)
  platforms: [],
  metadata: {
    values: ["informs", "connects"],  // the elements this need is about
    evidence: [                       // what makes us believe the need is real
      { kind: "node", ref: "DEC-connections-single-row-symmetric", quote: "No push, no realtime." }
    ]
  }
}

// Species "outcome", id prefix OUT-   (all fields are a proposal)
{
  id: "OUT-connected-pairs-share",
  title: "People who connect go on to share a moment with each other",
  status: "idea",
  platforms: [],
  metadata: {
    metric: { name: "...", unit: "% of new pairs", direction: "up", target?: number }
  }
}
```

An evidence entry points at something that already exists: a node, a journal event (`request.filed`, `deliverable.shipped`), a Kritik finding or a URL. A `quote` is optional and verbatim.

**Status without a new vocabulary.** Only three lifecycle statuses are stored on these species:

| Stored status | Meaning |
|---|---|
| `idea` | Proposed, not reviewed. Every agent write lands here. |
| `discovery` | Accepted by a person. Open and being worked on. |
| `archived` | Closed: dismissed, parked or, for an outcome, reached. |

The stored lifecycle of a stake is the three statuses above: proposed (`idea`), accepted (`discovery`) and closed (`archived`). It is separate from how far the need has been answered. That is a **state**, computed from the stories that address it and never typed in or stored:

| State | Derived from |
|---|---|
| **raised** | The need exists and nothing addresses it. |
| **considered** | Only candidate stories address it: status `idea`, not chosen. |
| **promised** | A chosen story addresses it. "Chosen" means generated by a decision, or at status `backlog` or later ([§ 10](#10-costs-and-decisions)). The second case covers quick wins nobody debated. |
| **partly addressed** | Some of its chosen promises are kept. |
| **addressed** | All of its chosen promises are kept. |

Promises are *kept*; needs are *addressed*. "Addressed" also matches the `addresses` edge. A need can be accepted (`discovery`) and still only raised: the two axes do not move together. Choosing a candidate is what lifts a need out of *raised* and *considered*, which is how the cap table in [§ 11](#11-caps) reads it. A reading of an outcome's metric is a dated fact, so it belongs in the journal (an `outcome.measured` event), like every other time series in Arkaik ([`docs/spec/journal.md`](../spec/journal.md)). An outcome with no reading is legal and says "not measured yet".

### The two edges

| Edge | From to | Meaning |
|---|---|---|
| `addresses` | acceptance to stake | This story is, or is part of, a solution to this need. |
| `serves` | stake to outcome | Answering this need should move this number. |

`generates` (decision to acceptance) already records that a choice produced a promise. With `addresses`, the path *decision, story, need, outcome* is complete, and no edge is needed between a decision and a stake.

A solution is rarely one-to-one. In Pebbles the need "bring in one person I chose" is answered by five acceptances together. With stories, that group is one story with five leaves, or one story and four siblings, whichever the team prefers. Either way the model adds one edge, not a `solution` species.

### Must a need always sit between a promise and an outcome?

The question had three answers.

- **A, strict:** always.
- **B:** a direct promise-to-outcome link is allowed.
- **C:** a direct link is allowed, but it creates a hollow "unnamed need" placeholder in between, which a person or agent can name later.

Four examples decided it. The first, second and fourth outcomes and needs are **illustrations, not Pebbles content**. The third uses real Pebbles ids and a proposed need.

| # | Example | A, strict | B, direct link | C, hollow placeholder |
|---|---|---|---|---|
| 1 | Profile stats to "people keep up their practice" | Forces you to write the need ("I want to see I'm keeping it up"). That is a test of whether the need is real. | Learns nothing. | Links instantly and shows a hollow need to name. |
| 2 | The Pebbles back-office (16 acceptances) to "moderation takes under a day" | Awkward. The need is in the team's voice, not a user's. | Natural. | Lets the needs stay unnamed until they are worth the effort. |
| 3 | The invite link reaches the outcome through "bring in one person I chose". Someone also links it straight to the outcome. | One path, no double count. | Counts it twice, unless every roll-up removes duplicates. | One path. A placeholder redundant with a real path can be flagged. |
| 4 | A raw idea, "less alone", to "shared pebbles" | Asks "what need does this answer?". That is the stake tree's discipline, but it slows a brainstorm. | Skips the question forever. | Skips it now. An agent comes back with a proposed need to confirm. |

**The owner chose C.** It keeps A's single path (totals are not doubled) and B's speed (a brainstorm is not slowed). The price is a node that exists to be named.

Practical consequences:

- Every path from a promise to an outcome still runs through exactly one need. Totals are computed over the *set* of promises reachable from an outcome, de-duplicated by id ([§ 12](#12-roll-ups-without-double-counting)).
- A hollow need has no evidence and no size until someone adds them. It is shown as hollow, never as a real need.
- Naming a hollow need is an ordinary edit, by a person or an agent. Stakes are at `idea` until a person accepts them, so an agent-named need still waits for review.
- The record for "hollow" is **(proposal)**: a `stake` node with `metadata.hollow: true`, cleared when it is named.

## 7. The assessment primitive

### Kritik, generalized

Kritik already is this primitive, for one subject. Today a `QualityAssessment` is `{criterion_id, surface, level, evidence, audit_id, commit?, ts}` ([`packages/schema/src/quality-schemas.ts`](../../packages/schema/src/quality-schemas.ts)), with N/A as an absent row and no half points. Weighing keeps every one of those rules and adds what Kritik did not need: a scorer, a confidence, and a way to say what was being looked at when the subject is not code.

Kritik's own RFC settled scorer identity in a smaller way: quality events SHOULD carry `actor`, enforced by a `quality-event-no-actor` warning, never a gate ([`docs/rfcs/kritik.md`](./kritik.md) § 8, item 2). Weighing makes the scorer a field of the assessment, with the same leniency.

### Four instances

| | Kritik (today) | Value matrix | Stake sizing | Options Matrix |
|---|---|---|---|---|
| **Subjects** | Surfaces | Stories (and lone acceptances) | Stakes | Options: candidate stories |
| **Criteria set** | Kritik library, 11 domains | The 30 elements, 4 tiers, plus the positioning | Reach, intensity, leverage | The decision's own criteria |
| **Scale** | 0 to 4, maturity | **−3 to +3**, signed | 0 to 4 | 0 to 4 |
| **Project weights** | `domain_weights` | **Positioning** | Optional | Per decision |
| **Evidence** | `file:line` at a commit | The promise's own text, feedback, decisions | Requests, findings, decisions, interviews | Graph facts. Guesses are confidence 0. |
| **What is computed** | Domain scores, grades, caps | Served, cost, shares, states, caps | A ranked list | A winner and how fragile it is |
| **What it produces** | **Findings** | **Stakes**, drafted from gaps and unclaimed costs | An order to work in | A **decision** |
| **Attached to** | The project | The project | An outcome | A decision or a stake |

The Options Matrix no longer needs a guessed "fit" criterion. Fit with what the product stands on is read from the value matrix: a candidate that costs an element the product stands on shows it there ([§ 16](#16-pebbles-worked)).

### The three records (proposal)

```ts
interface CriteriaSet {
  id: string;                 // "value-contribution", "positioning"
  version: string;            // semver. A criterion is never redefined, only superseded (Kritik's rule)
  subject: "acceptance" | "flow" | "stake" | "option" | ...;
  scale: { min: number; max: number; anchors: Record<string, string> };  // value: min -3, max 3
  groups?: { id: string; title: string }[];     // Kritik's domains, the value tiers
  criteria: {
    id: string; group?: string; name?: string; question?: string;
    anchors?: Record<string, string>;           // this criterion's own words for each level
    weight?: number;
  }[];
  caps?: CapRule[];                             // § 11
}

interface Matrix {
  id: string;                 // "value"
  set: string;                // "value-contribution@2"
  subjects:
    | { kind: "query"; species: SpeciesId }
    | { kind: "list"; items: { id: string; title?: string; node_id?: string }[] };
  positioning?: string;       // the positioning set this matrix is read through
  context?: { node_id: string };   // the decision or stake this matrix serves
  status: "draft" | "active";
}

interface Assessment {
  matrix: string;
  subject: string;
  criterion: string;
  level: number;              // a whole number on the set's scale. No half points.
  scorer: { kind: "human" | "agent" | "rule"; id: string; model?: string; on_behalf_of?: string };
  confidence: 0 | 1 | 2 | 3;
  evidence?: string;          // markdown
  refs?: string[];            // ids cited: nodes, journal events, findings
  basis?: { fingerprint?: string; commit?: string; set_version: string };
  accepted?: { decision: string; level: number };   // § 10
  run?: string;
  p_serves?: number;          // a probabilistic scorer's certainty that it serves, 0..1 (§ 8, ruler v2)
  p_costs?: number;           // the same for costs, asked independently
  ts: string;
}
```

### Rules that complete it

**A missing row and a zero are two different statements.** In Kritik, "not applicable" is an absent row, never a level. Weighing keeps that for criteria that do not apply. In the value matrix, a blank cell means "nobody has assessed this", and an explicit **0** means "assessed, unrelated". Both add nothing to any sum. The difference matters to claim checking: a claimed element assessed at 0 is "claim not supported" ([below](#claim-and-assessment-are-two-things)), which needs a row that says 0.

**Confidence has anchors too.**

| Confidence | Meaning | Typical scorer |
|---|---|---|
| 0 | Guess. Nothing behind it. | A seeding rule. An agent with no evidence. A person marking "I'm guessing". |
| 1 | Inferred from the subject's own text. | An agent reading a title and a Gherkin. |
| 2 | Evidenced: cites something outside the subject. | A person or agent quoting feedback, a decision, a finding, code. |
| 3 | Verified: reviewed by a person, measured, or survived a second scorer trying to refute it. | Kritik's `CONFIRMED` verdict is this. |

A probabilistic scorer writes its most likely level and maps its probability onto this scale. It may also store **`p_serves` and `p_costs`**, its certainty (0 to 1) that the subject serves and that it costs the element, asked independently. Nothing more of a distribution is stored, and no raw scorer answers ride in the bundle. A cell is **uncertain**, and the interface reads it as a range, when the scorer was under 0.9 sure of the direction its level took, or at least 0.5 sure of the other one. The gates come from a calibration of Jev against 180 hand-labelled cells (2026-11-16): a serves direction was right 94% of the time from 0.9 and 56% between 0.7 and 0.9, nothing real was found below 0.5, and a costs direction never reached that certainty (right about two times in three at its best), so a cost almost always reads as a range. `get_matrix` returns the numbers only when asked. Uncertainty is a marker, never a discount: it changes no sum.

**Provenance and who wins.** The latest assessment per cell *per kind of scorer* is kept, so a human's level and an agent's can sit side by side.

1. A human's level wins over an agent's, which wins over a rule's.
2. Within a kind, the latest wins.
3. Staleness never changes who wins. A stale human level still shows, flagged, with the fresh agent level beside it as a suggestion. An agent never replaces a human.
4. When a human and an agent differ by two levels or more, the cell goes on a review list.
5. A **draft** matrix feeds no roll-up until someone activates it. Activation is an action like any other and records who did it.

**On whose behalf.** An agent acts for somebody, and the owner calls recording who "very important". The scorer therefore carries an optional `on_behalf_of`: whom it acts for. The writer stamps it **where identity is known**. On a hosted token write it is the token owner's user id. A session is the person, so it stamps nothing. In a repo the MCP server has no account to ask, so it reads the checkout: the first usable of `ARKAIK_ON_BEHALF_OF`, `git config arkaik.user` and `git config user.name` (the git author name), which is what lets most local scores say who they were made for. A writer that finds none, as in an unattended CI run, leaves it absent. Because a sidecar is committed, `-` as `ARKAIK_ON_BEHALF_OF` or `arkaik.user` is the opt-out: it records nobody and stops the chain. It is a user id, a handle or a display name, **never an email** (the git email is not a source, and an email-shaped value in any source is skipped, not stamped), because sidecars are committed to repos. A caller cannot send it, since it sits inside `scorer`, which the writer stamps. It never changes who wins a cell: only the kind does.

**Staleness.** An assessment records what it was looking at. For code, Kritik stores a commit. For a graph subject it is a **fingerprint**: a short hash of the fields the criterion reads. A cell is stale when its fingerprint no longer matches, or when its criteria set had a major version bump. Staleness is computed on read and never stored.

| Subject | Fingerprint covers | Deliberately excluded |
|---|---|---|
| Story or acceptance (value matrix) | title, Gherkin, values | Status. Delivery is a fact joined at read time, not something the scorer judged. |
| Stake | title, evidence refs | |
| Option | the fingerprint of its node | |
| Surface (Kritik) | commit | |

The list of stale and unscored cells is the work list for a re-audit, as `kritik_scope` already is for quality ([`docs/spec/mcp.md`](../spec/mcp.md) § Quality tools).

### Claim and assessment are two things

`metadata.values` stays, unchanged, and stays the author's **claim**. The value matrix adds the **assessment**: how much, according to whom. They are allowed to disagree. That is what a value audit is for, in the same way Kritik compares what the code does with what the team believes.

| Situation | What it means | What the page says | Flag |
|---|---|---|---|
| Claimed, no assessment | Nobody has looked yet | "Seeded": every claim guessed at +1 (confidence 0), weighed and labelled as a guess. | none |
| Claimed, assessed +1, +2 or +3 | The claim holds. On the reach ruler +1 is a real contribution within the product. | A served level | none |
| Claimed, assessed 0 | The promise does not touch what it claims | "Claim not supported" | `claim_not_supported` |
| Claimed, assessed negative | The promise costs what it claims to serve | "Claim contradicted" | `claim_contradicted` |
| Not claimed, assessed +1 or more | The promise does more than it says | "Unclaimed value" | `unclaimed_value` |
| Not claimed, assessed negative | The promise costs something it never mentioned | "**Unclaimed cost**" | `unclaimed_cost` |

The four flags are a partition: only an assessment a scorer stored raises one (a seeded cell never does), and a cell raises at most one. A claimed element assessed negative raises `claim_contradicted` alone, not also `unclaimed_cost`.

The last row is the most valuable output of a value audit ([§ 8](#8-the-signed-value-scale)).

### The bundle section

Assessments are judgements, so they are not nodes. They live in a new top-level section, beside `quality`:

```ts
interface ProjectBundle {
  // unchanged, including quality?: QualitySection
  weighing?: {
    sets: CriteriaSet[];        // the rulers this project pins
    matrices: Matrix[];
    assessments: Assessment[];
  };
}
```

In code the three records carry a `Weighing` prefix (`WeighingCriteriaSet`, `WeighingMatrix`, `WeighingAssessment`; likewise `WeighingScorer` and `WeighingConfidence`), because the bare names are too generic to export from the package root. The prose here uses the short names.

It follows Kritik's storage rule exactly ([`docs/spec/bundle-format.md`](../spec/bundle-format.md) § Quality):

- In a repository, sidecar files are canonical and `arkaik pack` folds them into the key. The section is a projection, never a second copy to keep in step.
- In a hosted project, an assessment is a journal event, as `quality.assessment.scored` already is. The event names are **(proposal)**.
- It is additive. `schema_version` stays 3. An older reader keeps the key, because the bundle schema is `catchall` and the spec requires preserving unknown top-level fields ([`docs/spec/bundle-format.md`](../spec/bundle-format.md) § Schema Versioning).
- Publik withholds it by default, as it strips `quality`. A list of raised needs and unexplained costs is as sensitive as a list of open findings.
- Validation is warnings only, never import-blocking.

Criteria are library content, not product anatomy, so they are not graph nodes either. The reason is Kritik's: they would drown the graph.

## 8. The signed value scale

The owner asked why scoring cannot be negative. A consent page that asks for 16 or older and for health data serves some values (it reduces risk) and costs others (it is worrying).

**The scale measures reach in a person's life** (ruler v2, `value-contribution@2`, 2026-11-15). The first ruler (`@1`) measured how *central* a value was to the promise; the Jev POC (`~/code/arkaik-weighing-jev-poc/MEMO.md`) showed that this inflates every claim to +2 or +3. A value element is global, not scoped to the product: opening an account with any email "avoids hassles" inside the app, but +3 on *avoids hassles* should mean in the person's life, the way a GPS does.

| Level | Meaning |
|---|---|
| **+3** | Life-wide. It gives the person this well beyond the product and its domain. |
| **+2** | Across the domain. The person gets this in the whole area the product belongs to. |
| **+1** | Within the product. A real contribution, felt while using it. |
| **0** | Unrelated. |
| **−1** | Within the product. A small cost, felt while using it. |
| **−2** | Across the domain. The person notices the loss in the whole area the product belongs to. |
| **−3** | Life-wide. It leaves the person with the opposite of this in their life. |

- **Each element has its own ladder** (`packages/schema/src/weighing-ladders.ts`): the six non-zero levels of *saves time* run from "takes hours out of the person's life" to "gives the person back hours of their life". The table above is the fallback. The ladders were drafted in the Jev POC and reviewed by the owner on 2026-11-15, element by element. A rung carries no example (a scorer would match the promise against it), nothing a promise cannot show (no comparison with other products), and a negative ladder starts at keeping the person from the value, not at removing it.
- **Informs is asked as "mainly"**: is what this promise mainly gives the person information, rather than an ability, a shortcut, a protection or a feeling? Asked "at least a little", every promise informs the person about the service. This is the wording of one element's question, a measurement fix, not a second dimension.
- **There is no centrality axis.** "What the promise is mainly for" is not stored. The pyramid is an audit and navigation compass, like Kritik, so absolute reach is what counts (owner, 2026-11-15).
- **Most promises land at +1.** That is what the definition implies, and it was accepted. +3 is rare by design.
- **Migration is the major bump.** The built-in matrix reads `@2`. Every level scored against `@1` reads **stale** until re-scored: it still wins its cell and still counts, flagged, like any stale level. `@1` stays in the library, frozen, so a positioning or a project matrix that names it still resolves; a positioning on `@1` raises `weighing-positioning-old-ruler` until it is saved again (and a project matrix on `@1`, `weighing-matrix-old-ruler`). **Nothing new is written on `@1`**: the write gate refuses a positioning that extends it and an assessment on a matrix that reads it.

Rules that make it useful:

- **Served and cost are summed separately and never netted.** The display is "serves 2.0 · costs 1.0", never "1.0". Netting hides the trade-off, which is the thing worth seeing.
- **Elements read as two-sided bars.** What serves it on one side, what erodes it on the other.
- **Authors claim intent, so they rarely claim costs.** "Unclaimed cost" is the most valuable output of an agent audit.
- **Negative levels are never seeded by a rule.** A person or an agent adds them.
- **Positive levels can be seeded**: every claimed element is guessed at **+1**, within the product, whatever its position in `metadata.values`. On the reach ruler the claim order says what the author thought of first, not how far it reaches. (Under `@1` the first claim seeded +3 and the second +2; that overstated almost every claim.) Seeds carry scorer `rule` (`seed-claimed`) and confidence 0, and are computed on read, never stored. They are guesses and say so on every number built from them.
- **One cell can both serve and cost.** Sign-in simplifies, yet adds a step. A scorer that asks "serves?" and "costs?" separately finds such cells. Keep one signed level per cell, and read "both" — or a promise that states a feature and its limitation in one line ("you can X, but not Y") — as a **split this promise** signal, which is what stories are for ([§ 5](#5-stories)). One situation per line is an authoring rule. The limitation is not part of the promise: it is a need, or feedback about one, shown beside the promise as "at stake around it", never subtracted.

### Real examples

`AC-registration-consent` ("You agree to the terms knowingly, not by accident") is live on all three platforms and claims reduces risk and reduces anxiety. Its Gherkin: the create-account button stays disabled until both the Terms and the Privacy Policy boxes are ticked. Proposed levels:

| Element | Level | Why |
|---|---|---|
| reduces risk | **+3** | The point of the promise |
| reduces anxiety | **+1** | A clear agreement calms a little |
| reduces effort | **−1** | Two boxes before the button wakes |

The owner's **hypothetical**, which is **not in Pebbles**: a consent that asks for 16 or older and for health data.

| Element | Level |
|---|---|
| reduces risk | **+3** |
| reduces anxiety | **−2** |
| reduces effort | **−1** |

The hypothetical is the case that motivates the next sections: a live promise that costs an element the product stands on.

### What becomes of a cost

A cost on a positioned element can become a stake (a need to reduce it). It can be accepted by a decision. Both are in [§ 10](#10-costs-and-decisions).

## 9. Positioning as criteria

### Positioning is a criteria set, not a list of tags

For each element the product stands on, the positioning holds:

- a **weight**, and
- **level descriptions in the product's own words**.

Pebbles' *reduces anxiety*, for example: **3** means it removes a worry the user names. **0** means it has nothing to do with worry. A scorer such as Jev.ai needs those descriptions, because a bare label is not enough to assess against. A person writes the positioning. An agent drafts it from the landing page, the decisions or a brainstorm.

Shape **(proposal)**. Only the two descriptions quoted above come from the discussion.

**The id is fixed in slice 1.** A project's positioning set is called `positioning`, with `role: "positioning"` — the id the value matrix's `positioning` pointer names. A set with another id, or a set called `positioning` without the role, would never be applied, so the validator warns (`weighing-positioning-id`). Several named positionings are a later slice.

```jsonc
{
  "id": "positioning",
  "version": "0.1.0",
  "subject": "acceptance",
  "scale": { "min": -3, "max": 3, "anchors": { "+3": "core", "0": "unrelated", "-3": "costs it at its core" } },
  "criteria": [
    {
      "id": "reduces-anxiety",
      "weight": 2,
      "anchors": {
        "3": "It removes a worry the user names.",
        "0": "It has nothing to do with worry."
        // the other levels, including -1 to -3, are for the product to write
      }
    }
  ],
  "caps": [ /* § 11 */ ]
}
```

How it sits with the generic value matrix **(proposal)**:

- The value matrix pins the 30 elements with generic anchors.
- A matrix may also pin a positioning set. For an element the positioning lists, its words and weight replace the generic ones. For any other element, the generic ones apply.
- The thresholds for states and caps live in the positioning, so each product tunes its own.

### There are no human-only actions

An earlier draft said "the positioning is never written by an agent", following Kritik's doctrine that an agent does not author criteria or pick surfaces ([`docs/spec/mcp.md`](../spec/mcp.md) § Quality tools: "Nothing here authors a criterion or picks a surface"). **That is superseded for weighing.** Rules:

- Every action can be done by a person, and agents may do it too: to help, to work at scale, or to turn brainstorms and code sessions into the map.
- **Provenance is on every record.** The scorer is `human`, `agent` or `rule`, plus the model.
- **A human's level wins.**
- **A draft matrix feeds no roll-up until someone activates it.** This is the guard that replaced "human only": an agent can draft a positioning, and it changes nothing until activated.

The Kritik rule stays as it is for Kritik. The two layers differ on purpose. A criterion about code is a standard that an audit is measured against. A positioning is the product's statement of itself, which an agent can usefully draft from the product's own pages and decisions.

## 10. Costs and decisions

The rule is about *when a cost needs explaining*, not when it may be written.

- **Estimating a cost needs no decision.** A person, an agent or a scorer can estimate costs freely on any candidate solution. A cost is information.
- **A decision is the act of choosing.** It consolidates the candidates and their costs (an Options Matrix attached to it) and picks one.
- **The chosen solution carries its costs into the product.** The decision that chose it explains them.
- **The rule:** a cost on a **chosen or live** promise requires a decision. Until one covers it, the cost is **unexplained**. That is not an error. It is a question waiting for an answer.

### Two ways to close an unexplained cost

| Situation | What to do |
|---|---|
| The choice was made earlier. | Link the decision that chose it. |
| Nobody ever chose. A quick win shipped without debate. | Write a decision now that accepts the cost, **or** open a need to reduce it. |

Both ways end in the same record **(proposal)**: the assessment carries `accepted: { decision, level }`, the decision's id and the level it accepted. This is Kritik's accepted risk, applied to a level. Kritik has the same two outcomes for a finding: resolve it or accept it with a note (`kritik_accept_finding`, [`docs/spec/mcp.md`](../spec/mcp.md)).

- "The decision that chose it" is the existing `generates` edge, decision to acceptance ([`docs/graph-model.md`](../graph-model.md) § Edge Types). A decision covers a cost when its `decision_status` is `approved` or `enacted` **(proposal)**. A merely `proposed` decision does not.
- A promise counts as **chosen** once a decision generates it or its status is `backlog` or later **(proposal)**.

### The acceptance covers the cost as assessed

An accepted cost keeps its number. It is *covered*, not erased. The cap comes back, the same way a stale score is flagged, when:

- the cost is re-scored worse (accepted at −2, now −3), or
- the deciding decision is superseded or reverted (`superseded`, `rejected` or `deprecated`).

### Pebbles examples

- Nothing in the Pebbles bundle explains a photo limit. If `AC-pebble-photo-allowance-is-enforced` costs avoids hassles −1 (a proposal), that cost is unexplained today. It is a quick win nobody chose. One of the two exits above applies.
- The hypothetical health-data consent at reduces anxiety −2 would also be unexplained, and, being −2, it would cap ([§ 11](#11-caps)).

## 11. Caps

Kritik's precedent: an open Critical finding caps a cell at grade D however good the rest is, and an open High caps it at B ([`packages/kritik-library/SPEC.md`](../../packages/kritik-library/SPEC.md) § 4.5). It exists to stop a hole being averaged away. The value side needs the same, in three parts.

### Part 1: a state per thing, in words

| Thing | States |
|---|---|
| Value element | thriving, served, thin, at risk |
| Journey | the same four words |
| Outcome | on track, partly ready, blocked |
| Need | raised, considered, promised, partly addressed, addressed (derived, [§ 6](#6-opportunities-and-outcomes)) |

The bands that earn a state from numbers are not set yet ([§ 18](#18-open-questions)). Positioning is where each product tunes them.

### Part 2: caps are declarative rules, stored with the criteria, versioned

A person and a scorer apply the same rule. The thresholds live in the positioning. Three caps to start:

| Cap on | When | Held at |
|---|---|---|
| **Value element** | A chosen or live promise costs it −2 or worse, **unexplained** | at risk |
| **Outcome** | A need of size ≥ 70 is **raised or considered** | partly ready |
| **Journey** | The promises **owed** on a platform carry at least X% of the journey's served mass on that platform | thin |

Shape **(proposal)**. The three rules are decided. X, the journey cap's threshold, lives in the positioning, with a proposed default of 25%. The field names are not decided.

```jsonc
"caps": [
  { "id": "cost-unexplained",      "on": "element",
    "when": { "cost_at_least": 2, "explained": false, "promise": ["chosen", "live"] },
    "held_at": "at-risk" },
  { "id": "big-need-unpromised",  "on": "outcome",
    "when": { "need_size_at_least": 70, "need_state": ["raised", "considered"] },
    "held_at": "partly-ready" },
  { "id": "owed-share",            "on": "journey",
    "when": { "owed_share_at_least": 0.25 },   // X, tuned in the positioning
    "held_at": "thin" }
]
```

A cost of −1 on a live promise is still unexplained ([§ 10](#10-costs-and-decisions)). It does not cap, because the element cap starts at −2. **Caps ignore −1** on the reach ruler too (owner, 2026-11-15): −2 now means a cost across the domain, and product-level friction shows in the cost totals, never as a lid. "Owed" means the promise applies on a platform and is not `live` there.

- **The outcome cap lifts at *promised*.** A need stops capping once a chosen story addresses it ([§ 6](#6-opportunities-and-outcomes)). The outcome's state then follows how much is kept.
- **The journey cap uses the owed share.** It fires when the promises owed on a platform carry at least X% of the journey's served mass on that platform. It counts the whole owed share, so it never ties and no single promise has to be picked as the heaviest. Later, an "essential" mark on a promise could let one critical promise fire the cap alone ([§ 18](#18-open-questions)).

### Part 3: a visible lid, never a silent number

Every capped state shows its cause and what would lift it. In the interface:

- The filling shape fills to its **earned** state.
- A **dashed lid** sits where the cap stops it.
- Hovering the lid opens a card with the cause and the lift.
- Sorting lids by how much they hold back gives the roadmap order. Capping and prioritizing are the same mechanism.

This is a design intent from the discussion. The interface itself is not designed here.

### Pebbles, today

| Thing | Without the cap | With the cap | Cause | Lift |
|---|---|---|---|---|
| **Reduces anxiety** | thriving | at risk | A **hypothetical** health-data consent at −2 (not in Pebbles) | Explain or accept it |
| **Connected pairs share** (a proposed outcome) | on track | partly ready | "I don't find out when someone shares" (size 86) is raised | Choose push or the quiet dot, which makes it promised |
| **Connect** | served | thin | Android owes 3 promises, about 28–33% of the served mass depending on the example levels (X is 25%) | Ship enough there to drop under 25%. The accept alone does it. |

The third row needs a note. `AC-accept-invite-connects-both` is `web: live`, `ios: releasing`, `android: development`. With the example levels in [§ 16](#16-pebbles-worked), Android owes three Connect promises: the accept (2.00), `AC-invite-link-opens-the-app` (2.00) and `AC-invite-survives-sign-up` (1.67). Together that is 5.67: about 33% of the 13 promises' served mass with the slice's computed weights, about 28% with the real bundle's seeds. Either is at least X (25%), so the cap fires. iOS owes the same three (all `releasing`), so it fires there too. Nothing ties and nothing is picked: the rule reads the owed share, not one "heaviest" promise. The discussion names the accept as the cause. Shipping it on Android leaves 3.67 owed, which is under 25%, and lifts the lid.

### Accepting lifts the cap but does not erase the cost

The owner confirmed this. The table shows why the balance still matters.

| Reduces anxiety | Served | Cost | Capped | State |
|---|---|---|---|---|
| 100 stories at +3, one −2 **unexplained** | 300 | 2 | yes | at risk |
| 100 stories at +3, one −2 **accepted** | 300 | 2 | no | thriving, with 1 accepted cost |
| 10 stories at +3, eight −2, **all accepted** | 30 | 16 | no | thin |

The cap catches a single unexplained hole. The balance catches many small accepted ones. Neither makes the other unnecessary.

## 12. Roll-ups without double counting

A matrix gives two kinds of number, and keeping them apart avoids most mistakes.

- A **grade** answers *how good*. It is a weighted mean of levels, `Σ(level × weight) / Σ(max × weight) × 100`. Kritik's domain score uses exactly this ([`packages/kritik-library/SPEC.md`](../../packages/kritik-library/SPEC.md) § 4.5). Stake size and an Options Matrix score use it too.
- A **mass** answers *how much*. It is a sum. The value matrix is read this way, because the mean contribution of 159 promises to one element would be close to zero and would say nothing.

### The value chain, from the cell up

Served and cost are always separate columns. The tables below divide by 3, so that one promise fully core on one element counts 1.0 ("core-equivalents").

| Step | Number | How it is computed |
|---|---|---|
| Story × element | Level −3 to +3 | Assessed. The only stored number in this table. |
| Story | **Served** | Sum of its positive levels, plus its leaves' positive levels on elements the story does not carry, ÷ 3. |
| Story | **Cost** | The same for negative levels, as positive numbers. |
| Story | **Positioned served** | Served, counting only elements the positioning lists, each times its weight. Exists only when a positioning is set. |
| Story | **Kept share** | Platforms where its leaves are live ÷ platforms its leaves apply to, from `getNodePlatformStatuses` (`lib/utils/platform-status.ts`). The exact aggregation over leaves is in [§ 18](#18-open-questions). |
| Element | **Promised**, **kept** | Promised: served mass over every story in scope. Kept: the same, each times its kept share. |
| Element | **Share** | Its promised mass ÷ the total. "What part of everything we promise goes to this element." |
| Journey | **Share** | Sum of its stories' served, each divided by the number of journeys that story belongs to, over the product total. |
| Element, journey, outcome | **State** | From the numbers above, held down by any cap ([§ 11](#11-caps)). |

A story belongs to the journeys that its own `covers` edges, or its leaves' `covers` edges, reach **(proposal)**.

### Two rules prevent double counting

1. **Every roll-up is computed from the set of scored units, never from another roll-up.** The product total is the sum over that set, each unit once. It is not the sum of the journeys. A set is de-duplicated by id, so two paths to one outcome count a promise once.
2. **Split when the parts must add up. Do not split when asking about one part.** For sizes (the tile of a journey, a share of the whole), a story anchored in *k* journeys gives 1/*k* of its served to each, so the journeys add up to the product exactly. For the reading of a single journey ("what does Connect promise for *connects*?"), the story counts in full, and such readings are never added together.

The same two rules cover a story that addresses two stakes, and option C ([§ 6](#6-opportunities-and-outcomes)): every path still runs through one need.

### Every number says how much of it is guesswork

Alongside a share or a state, the roll-up returns the part of it that rests on cells with confidence 0. A pyramid built only from seeded levels says so on its face. A blank cell is blank, never drawn as zero.

### Read shares and masses, not a 0 to 100 formula

A prototype of the value page computed a served score as `100 × (1 − e^(−raw)) × breadth`. On the real Pebbles bundle, with levels seeded from the order of `values`, 19 of the 27 claimed elements score 99 or 100. The formula was designed on a small example set and saturates on a real product. Shares do not saturate: *avoids hassles* and *informs* take 23% of everything Pebbles promises, while *therapeutic value* and *wellness* together take about 1%. The roll-up function is therefore a replaceable projection, and the default reading is shares and promised/kept masses.

## 13. The three intentions and what each reads

Each intention is a different question with its own default order. "Absent" is what the page shows for a project that has only acceptances.

| | 1. Parity | 2. Mapping | 3. Value |
|---|---|---|---|
| **Question** | Is every promise kept on every platform where it applies? | What does the product promise, journey by journey? | Does it deliver the value it stands for, and where should we invest? |
| **Reads** | **Leaves** | **Stories** | **Stories**, scored once |
| **Rows** | Leaves that are owed somewhere | Journeys, then their stories | Value elements, then stakes |
| **Default sort** | Heaviest debt first: the story's served plus the leaf's own, and, when needs exist, the size of the need it answers | Walking order of the journey | Gaps first: weighted elements with the smallest share. Then lids by how much they hold back. Then needs, raised first and then considered, largest first. |
| **Segments** | By platform that owes ("mobile owes 3"), then by journey or by need | By journey and place. Tile size is journey share. | By tier. By state of the need. |
| **Second lens** | Group debt under the need it blocks | Resize tiles by one element or one tier | Open one element to see the stories behind it, by served |
| **Absent** | Journey order, then title. Debt is a count. Today's page. | Tile size is the number of promises. | Today's pyramid: claims and delivery per element, labelled "claimed". No score, no gap, no need. |

Three points stated plainly:

- **Parity never needs the new layers.** They only change the order: the most valuable debt first instead of the first one alphabetically. A leaf inherits its story's levels, so it can sort by value without being scored itself.
- **Mapping gets its sizes from the same served number.** "Do the same for values" is the journey share restricted to one element.
- **Value is where the new species appear.** The matrix produces gaps and unclaimed costs. A person or an agent turns a gap, a cost, a request or a finding into a stake. Stakes are the list this page ends on, as findings end a Kritik matrix.

## 14. The progressive layers

Each layer is switched on by adding data. None requires another unless the last column says so.

| Layer | What is added | Who can fill it | What it unlocks | Needs |
|---|---|---|---|---|
| **0. Promises** | Nothing. Acceptances as today. | Person, agent | Counts, parity, the claimed pyramid | None |
| **1. Value levels** | Assessments in the value matrix, −3 to +3 | A rule seeds positives. An agent refines and adds costs. A person overrides in the acceptance panel. | Served and cost per promise. Weighted pyramid. Parity sorted by value. "Claim not supported", "unclaimed value", "unclaimed cost". | 0 |
| **2. Positioning** | A criteria set: weights, words, state bands, caps | A person writes it. An agent may draft it from the landing page, decisions or a brainstorm. | Gaps. Positioned served. States and caps. | 0. Better with 1. |
| **3. Stories** | `composes` between acceptances | Person, agent | A named solution. Parity on leaves, mapping on stories. | 0 |
| **4. Stakes** | `stake` nodes, `addresses` edges with confidence, evidence | An agent proposes at `idea`. A person accepts. Or the reverse. | A list of needs and their state. Debt grouped by need. | 0. Best with 3. |
| **5. Stake sizing** | A matrix: stakes by reach, intensity, leverage | Person, agent | A ranked list of needs. The size that outcome caps read. | 4 |
| **6. Outcomes** | `outcome` nodes, `serves` edges, a metric, hollow needs for direct links | A person, or an agent drafting | The full tree. Later, readings: "kept, but did it matter?" | 4 |
| **7. Options matrices** | A matrix attached to a decision or a stake | Person, agent | A weighed choice between stories, stored with the decision | 0. Best with 3. |
| **8. Experience audit** | A second value matrix: journeys by elements, 0 to 4, evidence required | An agent audit with human review, like Kritik | "Is it actually delivered", not only "is it shipped" | 2 |

Which layers each cap needs:

| Cap | Needs |
|---|---|
| Element cap (unexplained cost) | Layers 1, 2 and decisions, which exist today |
| Journey cap (owed share) | Layer 1 and delivery status, which exist today. Better with 2. |
| Outcome cap (large need raised or considered) | Layers 4, 5 and 6 |

**Layer 8 in a word.** Layers 1 and 2 answer *what do we claim, and have we shipped it*. They cannot tell a promise that is live and lands well from one that is live and falls flat. A real evaluation scores how well a *journey* delivers an element, with anchored levels and evidence: absent, incidental, deliberate, consistent, proven. It is the same primitive with a different subject and scale, so it costs no new notion. It is last because it is the most expensive to fill. The cheap matrix comes first.

**How absent layers degrade.**

- A blank cell is blank. It is never drawn as zero.
- A number built from seeded levels is labelled seeded.
- A page whose layer is missing shows the count it shows today, labelled "claimed" or "count".
- A matrix with no assessments is not rendered. The page offers one action: seed it, or ask an agent to.

## 15. The agent loops and MCP tools

The pattern is Kritik's: an agent plans within a budget, scores with evidence, a second pass challenges the scores that matter, and a person reviews what changes a decision ([`docs/spec/mcp.md`](../spec/mcp.md) § Quality tools). Any step below may also be done by a person.

| Loop | The agent reads | The agent writes | A person reviews | Kritik twin |
|---|---|---|---|---|
| **Positioning draft** | The landing page, decisions, a brainstorm | A draft criteria set: weights, level words, caps | Activates it. Until then it feeds nothing. | None |
| **Value audit** | Stories (title, Gherkin, values), the criteria and anchors, the stale and unscored list | Assessments, scorer `agent`, confidence 1 or 2. **Costs the author never claimed.** | Cells where it differs from the claim, or from a person by two levels | `kritik_plan`, `kritik_score`, `kritik_matrix` |
| **Re-audit** | Only cells whose fingerprint changed | Fresh assessments for them | Nothing, unless a human level went stale | `kritik_scope` |
| **Cost explanation** | Unexplained costs on chosen or live promises | A proposed link to the deciding decision, a draft decision that accepts the cost, or a stake to reduce it | Which exit to take | `kritik_accept_finding` |
| **Capture** | The output of a brainstorm or a code or design session | Stories and leaves at `idea`, stakes at `idea`, `addresses` edges. Direct outcome links as hollow needs. | Accepts, dismisses, merges duplicates | None |
| **Need discovery, from the product** | Gaps and unclaimed costs, decisions' consequences, Kritik findings, promises that address nothing | Stakes at `idea` with evidence, and `addresses` edges to the stories that already answer them | Accepts (`discovery`), dismisses (`archived`), merges, rewords in the user's voice | Auditor emitting findings |
| **Need discovery, from feedback** | `request.filed` and `idea.proposed` events (`get_backlog`), pasted interviews or reviews | The same, with the events as evidence, one need per cluster | The same | None |
| **Naming hollow needs** | A hollow need and its linked promises | A proposed name and, where possible, evidence | Confirms the name | None |
| **Solution proposal** | One stake and the nodes around it | Candidate stories at `idea` with an `addresses` edge, and a draft Options Matrix | Which candidates survive | None |
| **Solution weighing** | The candidates, graph facts, and the candidates' value readings including costs | Assessments on the Options Matrix, guesses at confidence 0 | The weights, the guessed cells, the pick. The pick becomes a decision that `generates` the chosen story and covers its costs. | Adversarial verification |
| **Roadmap** | Everything above | Nothing stored. A computed order: lids by how much they hold back, owed leaves, raised needs. | The order. Moving a promise from `idea` to `backlog` stays a deliberate act. | `kritik_findings` priority lanes |

### The MCP

New species and edges ride the existing tools (`create_node`, `add_edge`, `update_node`, `list_nodes`). Their enums come from `@arkaik/schema` ids ([`docs/spec/mcp.md`](../spec/mcp.md) § Packaging & Transport), so a new species or edge arrives with the schema release and needs no new tool.

Tools for matrices, each mirroring a Kritik tool:

| Tool | Mirrors | Does | Slice |
|---|---|---|---|
| `get_matrix` | `kritik_matrix` | The grid with effective levels, served and cost, stale cells, the review list | 1 |
| `assess` | `kritik_score` | Writes one assessment through the validator-gated write path. Takes confidence, evidence (no scorer — it is stamped), and optionally `accepted_by` **(proposal)**. The server stamps `on_behalf_of` where it knows whose hands the scorer is; in a repo the MCP server reads the env var, then `git config arkaik.user`, then the git author name. | 1 |
| `matrix_scope` | `kritik_scope` | The work list: unscored and stale cells | Not slotted |
| `matrix_plan` | `kritik_plan` | Cuts a large audit into budgeted parts with a prompt per part | Not slotted |

The tool names `matrix_scope` and `matrix_plan` and the slice they land in are the lead's reading. The discussion fixed only `get_matrix` and `assess` for the first slice.

The need-to-outcome tree is itself a map. A built-in map kind over `outcome`, `stake` and `acceptance` with the `serves`, `addresses` and `composes` edges would give the visual form through the existing map machinery, and `get_map` would give an agent the same subgraph ([`docs/spec/maps.md`](../spec/maps.md)). That is a possibility, not a decision.

**What a person can always do.** Every assessment is one form: read a level's description, pick it, say how sure, cite evidence. Every node is the existing panel. Every matrix is a grid, and Kritik's components for levels, scales and matrices already exist (`components/quality/`).

## 16. Pebbles, worked

The slice is the outcome behind the journey **Connect with someone** (`F-connect`), plus the photo story and the consent examples.

### What is real and what is not

| Real, from `pbbls/docs/arkaik/bundle.json` | Proposal or hypothetical |
|---|---|
| The 13 Connect acceptances, with their statuses, values and Gherkins | Every level below. No person has scored anything. Levels come from a seeding rule or from an agent and say so. |
| `DEC-connections-single-row-symmetric` and `DEC-web-activity-sonner-explicit-fire` and their quotes | The outcome, the six needs, the `addresses` and `serves` edges |
| The photo acceptances and `AC-registration-consent` | The two candidate acceptances `AC-connection-activity-push` and `AC-connections-quiet-dot` |
| `V-connection-detail`, `V-invite-accept` and the other views | The positioning (an illustrative list of 11 elements; the owner has not set one) |
| | The 16+ and health-data consent (hypothetical, not in Pebbles) |

Pebbles has 159 acceptances and 266 claimed (acceptance, element) pairs, out of 159 × 30 = 4,770 possible cells. The matrix is sparse. Score the claimed cells and the few an agent proposes. Never draw the full grid.

### The outcome and its needs

`OUT-connected-pairs-share` (proposal): **People who connect go on to share a moment with each other.** Metric: connected pairs where one person opened a pebble the other shared, within 30 days of connecting. No reading exists, so it says "not measured yet". Nothing downstream needs a reading to work.

Sizes are grades from three criteria (reach ×2, intensity ×2, leverage ×3), scored by an agent. All needs are proposals at `idea`.

| Need (proposal) | Evidence in the bundle | Addressed by | State | Size |
|---|---|---|---|---|
| `STK-know-when-something-happens` "I don't find out when someone accepts my invite or shares a moment with me" | `DEC-connections-single-row-symmetric`: "No push, no realtime." | Nothing | **Raised** | 86 |
| `STK-undo-a-block` "I blocked someone by mistake and I can't take it back" | Same decision: "Block management UI is deferred, so until then an accidental block needs a service-role fix." | Nothing | **Raised** | 39 |
| `STK-bring-one-person-in` "I want to bring in one person I chose, without being findable by strangers" | `F-connect`: "Accepting is the mutual consent — there is no request queue and no directory to search." | `AC-invite-link-and-qr`, `AC-accept-invite-connects-both`, `AC-invite-link-persists`, `AC-invite-link-rotation`, `AC-connections-list` | **Partly addressed**, 81% kept | 100 |
| `STK-invitee-not-on-pebbles-yet` "The person I invite isn't on Pebbles yet, and the invite gets lost on their way in" | `V-invite-accept`: "Signed-out visitors on web get the sign-up-first path and return here afterwards." | `AC-invite-preview-before-account`, `AC-invite-survives-sign-up`, `AC-invite-link-opens-the-app` | **Partly addressed**, 42% kept | 86 |
| `STK-see-what-they-share` "Once we're connected, I want to see the moments they chose to share with me" | `V-connection-detail`: "the pebbles that connection shares with you (grades private and public, trimmed by RLS)" | `AC-connection-shared-pebbles`, `AC-pebble-grade-choice`, `AC-pebbles-secret-by-default` | **Addressed** | 93 |
| `STK-back-out-safely` "I need to be able to back out of a connection without a scene" | `DEC-connections-single-row-symmetric`: "store guidelines require blocking at launch" | `AC-remove-connection`, `AC-block-on-removal` | **Addressed** | 54 |

What this shows that no page shows today:

- **Two needs have no promise at all**, and both were already written down as consequences of an enacted decision. An agent reading decisions finds them in seconds.
- **The outcome cuts across journeys.** Ten of the 13 promises live in Connect, two in Record Pebble (`AC-pebble-grade-choice`, `AC-pebbles-secret-by-default`) and one on the Connection Detail page. A journey is where a promise lives. An outcome is why it exists.
- **Three promises in Connect answer none of these needs**: the profile ones. They are there because `V-profile` is the first step of the flow. That is a visible fact once the edge exists.
- **Five acceptances answer one need.** This is "the solution is a role" on real data.

### A few rows of the value matrix, on the signed scale

**These rows predate ruler v2** ([§ 8](#8-the-signed-value-scale)): they read levels as centrality and seed by claim order. Under the reach ruler most of them land at +1, and every seed is +1. They are kept as the record of the discussion. The positive levels below are the discussion's positive levels, unchanged by the move to −3..+3. Plain numbers are seeded from the order of `metadata.values` (rule, confidence 0). **Bold** numbers are an agent's assessment (confidence 1), with the seed it replaces. Nothing is negative: negatives are never seeded, and no agent has audited costs on this slice yet.

| Story or promise | connects | affiliation and belonging | reduces anxiety | reduces risk | reduces effort | other | Served | Cost | Kept on |
|---|---|---|---|---|---|---|---|---|---|
| `AC-accept-invite-connects-both` | +3 | **+3** (seed +2) | | | | | 2.00 | 0 | 1 of 3 |
| `AC-connection-shared-pebbles` | +3 | **+3** (seed +2) | | | | | 2.00 | 0 | 1 of 1 |
| `AC-connections-list` | | **+1** (seed +2) | | | | organizes +3 | 1.33 | 0 | 3 of 3 |
| `AC-block-on-removal` | | | **+3** (seed +2) | +3 | | | 2.00 | 0 | 3 of 3 |
| `AC-invite-link-opens-the-app` | **+1** (unclaimed) | | | | +3 | quality +2 | 2.00 | 0 | 0 of 2 |
| `AC-invite-survives-sign-up` | | | | | +2 | avoids hassles +3 | 1.67 | 0 | 1 of 3 |

Served is the positive levels summed and divided by 3. The agent's reasons are stored with each cell. Two examples:

- `AC-connections-list` claims *affiliation and belonging*. Its Then clause shows names and avatar glyphs. A list touches belonging. It does not create it. Level +1: the claim is stronger than the promise.
- `AC-invite-link-opens-the-app` does not claim *connects*, yet opening on the accept screen removes a detour on the way to connecting. Level +1: unclaimed value.

Read by column over the 13 promises (served, kept, in core-equivalents):

| Element | Promised | Kept | |
|---|---|---|---|
| reduces anxiety | 4.67 | 4.67 | All of it shipped |
| connects | 4.00 | 3.00 | |
| reduces risk | 2.67 | 2.67 | All of it shipped |
| affiliation and belonging | 2.33 | 1.67 | |
| reduces effort | 1.67 | 0.22 | Almost none of it shipped |
| quality | 0.67 | 0.00 | None of it shipped |

In one sentence: **the safety side of connecting is fully kept, and the ease side is almost entirely unshipped.** A count per element cannot say that.

### Costs in Pebbles

| Promise | Element | Level | Status of the example |
|---|---|---|---|
| `AC-registration-consent` | reduces risk | +3 | Proposal |
| `AC-registration-consent` | reduces anxiety | +1 | Proposal |
| `AC-registration-consent` | reduces effort | −1 | Proposal. Unexplained until a decision covers it. Does not cap, because the element cap starts at −2. |
| `AC-pebble-photo-allowance-is-enforced` | avoids hassles | −1 | Proposal. A limit is a friction. Unexplained, with no decision in the bundle about photo limits. |
| *A 16+ and health-data consent* | reduces anxiety | −2 | **Hypothetical, not in Pebbles.** Would cap *reduces anxiety* at "at risk" until explained. |

### One positioning description, in the product's words

For *reduces anxiety* (the two anchors the owner gave): **3** removes a worry the user names. **0** has nothing to do with worry. The other levels, including the three negative ones, are for Pebbles to write.

### One Options Matrix, on the new model

The largest raised need is `STK-know-when-something-happens` (86). Two candidate stories, both new acceptances at `idea` (proposals):

- `AC-connection-activity-push`: "Hear about it when a connection shares a moment with you" (iOS, Android).
- `AC-connections-quiet-dot`: "A quiet dot tells you a connection has something new" (all three platforms; covers `V-connections-list` and `V-profile`).

An earlier draft scored a fourth criterion called Fit, by guesswork. It is gone. Fit with what the product stands on is now read from the value matrix. The three remaining criteria are Impact (weight 3), Reach (2) and Ease (2), on 0 to 4.

| Criterion (weight) | Push | Quiet dot |
|---|---|---|
| Impact (3) | 4: reaches you outside the app | 2 *(guess)*: only once you open the app |
| Reach (2) | 2 *(guess)*: mobile only, permission needed | 4: every platform, nothing to allow |
| Ease (2) | 0: no push infrastructure; the decision says "No push, no realtime." | 3: one read at screen load, the shape `DEC-web-activity-sonner-explicit-fire` already chose |
| **Score** | **57** (50 to 64) | **71** (61 to 82) |
| Value matrix reading (proposal) | **reduces anxiety −2**: an interruption in a product that stands on calm | No cost estimated yet |

The scores are the lead's arithmetic on the earlier draft's levels, `Σ(level × weight) / (4 × 7) × 100`, and the range moves each guessed cell one level down and up. The ranges now overlap by three points, so on these criteria alone the order is probable, not certain. The value reading settles it, and settles it in the open: choosing push means choosing a −2 on an element the product stands on. That is an unexplained cost on a chosen promise, and it caps *reduces anxiety* at "at risk" until a decision accepts it. Choosing the quiet dot would create a decision that `generates` `AC-connections-quiet-dot`, with this matrix attached. Writing the two candidates moves the need from raised to considered, and the outcome's lid holds. Choosing one makes the need promised, and that lifts the lid.

### How the three pages would sort the slice

**Parity.** Three promises are owed on mobile, and web already keeps two of them.

| Order | Promise | iOS | Android | Why this order |
|---|---|---|---|---|
| 1 | `AC-accept-invite-connects-both` | releasing | development | Answers the largest need (100). Served 2.00. |
| 2 | `AC-invite-link-opens-the-app` | releasing | development | Need of size 86. Served 2.00. |
| 3 | `AC-invite-survives-sign-up` | releasing | development | Same need. Served 1.67. |

Without the layers these are three equal rows in title order, and the accept, without which nothing else on mobile matters, has no reason to come first.

**Mapping.** Connect holds 13 of the 159 promises: 8.2% by count, or 7.2% once the three profile promises it shares with Follow the Lab are split. Weighted by positioned served, with seeded levels and the example positioning, it is 10.3%. The same computation moves Back-office from 10.1% to 6.7%, Settings from 8.2% to 12.0%, and Manage Collections from 1.9% to 0. The tiles change size, and each change can be explained by opening the tile. These percentages are from the earlier draft's computation on unsigned levels; the positive levels are the same, so they stand.

**Value.** The page opens on gaps among weighted elements, then on the needs in the order of the table: raised first, largest first. Product-wide, *therapeutic value* is claimed by 2 promises and *wellness* by 1, in an app whose example positioning depends on both.

**One thing only the value side can see.** `AC-connection-shared-pebbles` applies to web only, because `V-connection-detail` is a web-only view. On mobile a person can choose who sees a pebble (`AC-pebble-grade-choice`, live on all three) but cannot see what a connection shared with them. Parity reports no gap, correctly: the promise does not apply there. The need makes the hole visible, and the fix is a proposal to widen that promise to iOS and Android, where it then appears as ordinary debt.

**The order of work this gives.**

1. Finish `AC-accept-invite-connects-both` on mobile (need of size 100, and the promise holding the Connect lid).
2. Decide between the two answers to `STK-know-when-something-happens` (86, raised, and the need holding the outcome's lid).
3. Finish the two invitee promises on mobile (86, partly addressed).
4. `STK-undo-a-block` (39): real, small, last.

## 17. Shipping order

Approved. Each slice is its own release. Nothing in slice 1 needs a new species, which is why it goes first: an older validator rejects a bundle carrying a species or an edge type it does not know, because both enums are closed (`SPECIES_IDS`, `EDGE_TYPE_IDS` in `packages/schema/src/ids.ts`, wrapped as `z.enum` in `packages/schema/src/enums.ts`).

| Slice | Ships | New species or edges | Why this order |
|---|---|---|---|
| **1. The weighing section** | `bundle.weighing`: CriteriaSet, Matrix, Assessment (scorer with an optional `on_behalf_of`, confidence, basis and fingerprint), following Kritik's files. The signed value matrix: acceptances by the 30 elements (stories do not exist yet), −3 to +3, positive levels seeded from the order of `values` as guesses, negatives never seeded. A form in the acceptance panel. Positioning as a criteria set. MCP `get_matrix`, `assess` and `save_positioning`. **Served and cost per promise** as the derived sort keys. | **None** | It is the piece every other layer reuses. Old readers ignore it safely. It gives the three pages a sort key at once. |
| **2. Stories, stakes and caps** | `composes` acceptance to acceptance. Species `stake`, edge `addresses` with confidence. Caps, with states. | Species `stake`. Edges: `composes` pair, `addresses`. | One schema release, because they change the closed species and edge-pair tables, and caps need needs and stories to exist. |
| **3. Outcomes and Options Matrices** | Species `outcome`, edge `serves`. Option C placeholders for direct links. Options Matrices attached to decisions. | Species `outcome`. Edge `serves`. | Needs slice 2. |

Also from the discussion and still valid:

- The cheap value matrix (stories by elements) comes first. The expensive journeys-by-elements experience audit is layer 8.
- The outcome cap switches on when outcomes land, since it reads needs and outcomes. In slice 2 the element and journey caps work. **(The lead's reading.)**
- Stake sizing, which the outcome cap reads, and `matrix_scope` and `matrix_plan` are not slotted by the discussion ([§ 18](#18-open-questions)).

## 18. Open questions

The model is decided. These are the details it leaves, each with the lead's lean where there is one.

| # | Question | Lean |
|---|---|---|
| 1 | Can a leaf have more than one parent? | No. One parent, a tree, cycle-checked as playlists are. Every roll-up assumes a tree. |
| 2 | How is a story's kept share computed from its leaves? | Count (leaf × platform) cells: live cells ÷ applicable cells. Not a mean of leaf shares. |
| 3 | What numbers earn thriving, served, thin and at risk, and on track, partly ready and blocked? The caps are decided. The earned bands are not. | Positioning holds them. A product that sets none gets a default. |
| 4 | Which decisions cover a cost? What *chosen* means is settled ([§ 6](#6-opportunities-and-outcomes)): generated by a decision, or status `backlog` or later. It also decides when a need becomes *promised*. | Covered by a decision at `approved` or `enacted`. |
| 5 | How many hollow needs does a direct link create: one per link, or one per outcome? | One per link is cheapest to merge later, but 16 back-office promises would make 16 placeholders. Open. |
| 6 | Do element states exist only for positioned elements, or for all 30? | Positioned only, since the bands and caps live in the positioning. Costs on other elements still list as unexplained. |
| 7 | Product membership of stakes and outcomes. Decisions carry none. Pebbles declares products. | Not yet considered. |
| 8 | Can an agent activate its own draft matrix? The draft guard assumes the activator is someone else. | The provenance on the activation is the check. Open. |
| 9 | Where do stake sizing, `matrix_scope` and `matrix_plan` land? | Sizing no later than slice 3, because the outcome cap reads it. |
| 10 | Wording in the interface. "Promise" for acceptance is established. "Stake" or "need" is not. | Open. |
| 11 | Names of journal events and of the sidecar folder for weighing. | Follow `quality.*`. All proposals. |
| 12 | Where do outcome readings come from? | Manual entry is enough to start. A connected source is a product decision of its own. |
| 13 | Pebbles acceptances whose node status disagrees with their platform statuses. | Kept share reads platform statuses only, as `getNodePlatformStatuses` does. A validator warning is worth adding. |
| 14 | An "essential" mark on a promise, so that one critical promise can fire the journey cap alone. | Later. The owed-share rule is the first cut. |
| 15 | The default for X, the journey cap's threshold. | 25%, held in the positioning so each product tunes it. |
| 16 | Forged human rows. `POST …/weighing/events` stamps the scorer, so no caller there can claim to be a human. A whole-bundle `PUT` (`arkaik restore`) or an import carries whatever scorers the bundle holds, so anyone with `graph:write` can plant a `human` row, and a human's level wins every cell. | Known and accepted in slice 1: provenance is a record, not an access control. Restore appending by default (issue #624) narrows the window. Provenance-checked restore is a later question. |

Risks, and what answers them:

| Risk | Answer |
|---|---|
| A wall of cells | The matrix is sparse and claimed cells come first. |
| Seeds read as scores | Scorer `rule` and confidence 0 on every seed. Every roll-up reports its guesswork. |
| A formula that saturates | Shares and masses by default. Any 0 to 100 formula is replaceable. |
| New species break old validators | Slice 1 adds none. Slice 2 adds the species and edges in one coordinated release. |
| Value claims as currency | Once levels follow claims, over-claiming pays. The claim-versus-assessment table lists a claimed element assessed 0 or +1. |
| Two status sources | See question 13. |
| `arkaik restore` loses hosted-only assessments | **Resolved by #624: restore appends by default.** The hosted journal and weighing section are merged with the repo's, so an assessment recorded only on a hosted project survives. Only `arkaik restore --replace` still swaps the journal wholesale, and its history guard compares counts, so the backup it writes first is the recovery there. |

## 19. What changes in the normative docs when this ships

This RFC describes a design, so the documents below keep describing what is built until a slice ships. When it does, each slice updates these.

### Slice 1

| Document | Change |
|---|---|
| [`docs/spec/bundle-format.md`](../spec/bundle-format.md) | A new § Weighing beside § Quality: the section shape, the storage rule (sidecars canonical, journal events hosted), "derived values are never stored", the warning-only validation rules, the Publik default. A line in § Schema Versioning: additive, `schema_version` stays 3. |
| [`docs/spec/journal.md`](../spec/journal.md) | The weighing event types, with `actor` guidance. |
| [`docs/spec/mcp.md`](../spec/mcp.md) | `get_matrix` and `assess` in the tool catalog. Repo and hosted behaviour. |
| [`docs/spec/toolchain.md`](../spec/toolchain.md) | `arkaik pack` and `arkaik restore` fold the weighing sidecars. Any new CLI verb. |
| [`docs/spec/services.md`](../spec/services.md) | Wherever it lists what Publik strips, add the weighing section. |
| [`docs/graph-model.md`](../graph-model.md) | § Pyramid View and § Acceptances View: served and cost as sort keys, the claimed fallback. A short § Weighing pointing here. |
| [`docs/README.md`](../README.md) | The RFC entry becomes a spec entry. |

### Slice 2

| Document | Change |
|---|---|
| [`docs/graph-model.md`](../graph-model.md) | § Species: "exactly 6" becomes 7, with `stake`. § Edge Types: `composes` gains acceptance to acceptance, new `addresses`. § Status Model: role versus status, derived story status, the three statuses on stakes. § Acceptances View and § Pyramid View: leaves and stories. § Canvas Visibility: the new species are excluded from the Journey and System maps. A dated Taxonomy Update Checklist note. |
| [`docs/spec/bundle-format.md`](../spec/bundle-format.md) | § Acceptance Nodes: stories, optional Gherkin on a story, derived status. A new § Stake Nodes. The `platforms` exemption for stakes, as decisions have. The cap rules and states in § Weighing. New validator rules (a cycle in `composes`, a story's stored status ignored). |
| [`docs/spec/maps.md`](../spec/maps.md) | `KIND_DEFAULTS` keep the new species out of the built-in maps. |
| [`docs/spec/mcp.md`](../spec/mcp.md) | New species and edge types in the tool enums. A `parity_gap` reading on leaves. |
| [`docs/superpowers/specs/2026-07-19-acceptance-value-model-design.md`](../superpowers/specs/2026-07-19-acceptance-value-model-design.md) | Nothing yet (the objective reservation changes in slice 3). |

### Slice 3

| Document | Change |
|---|---|
| [`docs/graph-model.md`](../graph-model.md) | § Species: `outcome`. § Edge Types: `serves`. § Decisions: an Options Matrix attached to a decision. |
| [`docs/spec/bundle-format.md`](../spec/bundle-format.md) | A new § Outcome Nodes. Hollow needs. Options Matrix records. |
| [`docs/spec/journal.md`](../spec/journal.md) | `outcome.measured`. |
| [`docs/superpowers/specs/2026-07-19-acceptance-value-model-design.md`](../superpowers/specs/2026-07-19-acceptance-value-model-design.md) | § 3.6 (reserved objectives) is replaced: `outcome` and `serves` from stake, as designed here. |
| [`docs/rfcs/weighing.md`](./weighing.md) | Status moves from "accepted design" to "shipped". |

### Always

`public/schema/project-bundle.json` and the plugin and CLI scripts are generated from `packages/schema`. They are regenerated and committed with each slice, because CI diffs them.
