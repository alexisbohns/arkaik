# Waves & gates

A bootstrap run is four waves, each fanning out over work units that
`arkaik bootstrap plan` writes to `.arkaik/bootstrap/manifest.json`:

| Wave | Units | Emits |
|---|---|---|
| 0 · Recon | `w0-recon` (one agent) | `.arkaik/bootstrap/profile.json` |
| 1 · Anatomy / Reconcile | `w1-<area>`, one per area | `{nodes, edges}` (greenfield) or `{add, update, retire}` (brownfield) |
| 2 · Acceptances + values | `w2-<area>`, one per area (+ a values-balance reviewer role — not a unit) | acceptances with gherkin, values, `covers` edges, platform scoping |
| 3 · Story | `w3-<era>` per era, plus `w3-decisions` and `w3-status-arcs` | `events` (deliverables, releases, arcs) and `DEC-` nodes |

Working a unit is always the same loop: `arkaik bootstrap slice <unit>` →
judge → write the fragment → set the unit's status to `done` in
`.arkaik/bootstrap/manifest.json`. **Resumability is structural:** statuses
(`pending` / `done` / `rejected`) live in the manifest and output lives in
fragment files, so a killed session resumes at the first `pending` unit, and
re-running `plan` preserves the status of any unit whose slice is unchanged.

**Every wave ends the same way:** an adversarial reviewer — checking against
the product, not just the schema — then `arkaik bootstrap merge` (preview
with `--dry-run`), then `arkaik validate` on the bundle, **warning-clean**.
Merge itself blocks only on errors; warnings never block the write, so
warning-clean is the reviewer's gate to enforce, not the CLI's. A wave that
does not gate green does not advance.

## Wave 0 · Recon

One agent reads the corpus and the repo (`slice` gives it the docs manifest)
and writes `.arkaik/bootstrap/profile.json`: `products`, the `platforms`
axis, `areas` (id, title, code paths — typically 8–12 for a real product),
and `eras` (slug, title, date window). Then re-run `arkaik bootstrap plan` to
expand waves 1–3.

**Reviewer checklist — wave 0:**

- [ ] Area ids and era slugs are lowercase kebab-case (they become fragment
      filenames — `plan` rejects anything else).
- [ ] Every area has at least one real path, and the areas together cover the
      product's code. An area with wrong paths starves its agents of exactly
      the PRs and surfaces they need.
- [ ] Every era has at least one date bound; windows are half-open, so
      adjacent eras may share a boundary date but must never overlap. Two
      eras with only a `from` always overlap — give the earlier one a `to`.
- [ ] The eras cover the PR timeline. A PR falling inside no era is silently
      absent from the story.
- [ ] The platform axis matches how the product actually ships; `products`
      is declared only when the repo really is a family of apps.

## Wave 1 · Anatomy / Reconcile

One unit per area. Greenfield: map the area's flows, views, data models, API
endpoints, and the edges between them. Brownfield: reconcile the existing map
against the code — `add` what's missing, `update` what drifted, `retire`
what's gone. Never delete.

**Reviewer checklist — wave 1:**

- [ ] Species are right: the route handler is `API-`, the page it feeds is
      `V-`, the journey between pages is `F-`, the stored thing is `DM-`.
- [ ] No `DM-` concept/table collisions; concept titles are capitalized
      words, table titles the exact DB identifier.
- [ ] Every flow has a real playlist that agrees with its `composes` edges,
      and no flow contains itself.
- [ ] Edge kinds match their semantics (`composes` / `calls` / `displays` /
      `queries`) — spot-check a few against the actual code.
- [ ] `created_ts` values come from the PRs that first shipped each surface,
      not from today.
- [ ] **Churn guard (brownfield): a unit proposing `retire` or `update` on
      more than 20% of the existing nodes stops for human review.** Churn at
      that scale is usually a wrong slice or a misread map, not a real
      product change.
- [ ] Nothing is deleted; every `retire` carries a reason a human could act
      on.

## Wave 2 · Acceptances + values

One unit per area writes acceptances for its surfaces; one values-balance
reviewer then reads the whole wave.

**Reviewer checklist — wave 2:**

- [ ] Exactly one Given/When/Then per acceptance — a second scenario is a
      second acceptance.
- [ ] Every `covers` edge points at an id that exists (`arkaik bootstrap
      index`), and each acceptance anchors inside a single product.
- [ ] Platform scoping is the fewest platforms that are true; no unscoped
      promotion claiming every platform.
- [ ] Values are 1–3 per acceptance, from the table, most specific element
      first — or omitted where unsure. (Skipped entirely if the repo has no
      values reference.)
- [ ] **Values balance: if more than half the acceptances land on one value
      element, the wave is rejected and re-run.** An unchecked acceptance
      wave collapses into ~90% `simplifies`; the pyramid must show real
      spread.

## Wave 3 · Story

Era units (`w3-<era>`) turn each era's user-visible PRs into
`deliverable.shipped` events and tag the era's `release.tagged`.
`w3-decisions` mines the design docs into `DEC-` nodes, their edges, and
their events. `w3-status-arcs` gives each anatomy node an honest 1–3 event
arc ending at its snapshot status.

**Reviewer checklist — wave 3:**

- [ ] The user-visible filter held: every PR with a Lab Note became a
      deliverable; chores, CI, and refactors did not; borderline calls are
      explained in the fragment's `notes`.
- [ ] Deliverable and release timestamps are real merge instants from the
      corpus, never invented dates.
- [ ] Every decision traces to a real document in the corpus — decisions are
      mined, not imagined.
- [ ] Every arc ends at the node's snapshot status, contains no transition
      that did not happen, and gives same-node events distinct instants.
- [ ] Nothing project-shaped was deleted or rewritten — story only ever adds.

After wave 3 gates green, the run is done: the bundle and its journal are the
product. Landing them (and removing this skill) is the operator's move, not a
wave.
