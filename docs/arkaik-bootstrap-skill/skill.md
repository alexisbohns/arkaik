---
name: arkaik-bootstrap
version: 1.0.0
description: >
  Bootstrap the Arkaik product graph map for {{PRODUCT_NAME}} from its
  repository history — map this repo, bootstrap the map, retro-populate or
  backfill the map from merged PRs, design docs, and code surfaces. Use this
  skill when working a unit of an `arkaik bootstrap` run: reading a slice,
  writing a fragment, or reviewing a wave. One-time onboarding only — ongoing
  map maintenance belongs to the `arkaik` skill, not this one.
---

# Arkaik Bootstrap — the judgment half

The bootstrap method has two halves. The `arkaik bootstrap` CLI owns
everything deterministic: mining the corpus, planning work units, slicing
what you read, merging what you write, validating the result. This skill owns
what code cannot decide: which species a thing is, what a flow's playlist
really contains, what a PR actually shipped, which value an acceptance
genuinely earns. You are the judgment half.

Two references ship beside this file:

- [references/fragments.md](references/fragments.md) — the exact shape of the
  file you write
- [references/waves.md](references/waves.md) — the wave catalog and the
  reviewer checklist each wave gates on

> **Template parameters.** Like the maintenance skill, this file is rendered
> by `arkaik init`. If you are reading an unrendered copy, treat the defaults
> in parentheses as the values:
>
> | Parameter | Meaning | Default |
> |---|---|---|
> | `{{PRODUCT_NAME}}` | The product being mapped | the current product |
> | `{{BUNDLE_PATH}}` | Where the merged map lands | `docs/arkaik/bundle.json` |

## When this skill applies

This skill drives a **one-time onboarding run**: building the map for
{{PRODUCT_NAME}} out of the repository's own history. Greenfield (no bundle
yet, or an `arkaik init` stub with zero nodes) means mapping from scratch;
brownfield (a bundle that already carries nodes) means reconciling the
existing map against the code. Same method either way — only the wave-1
fragment shape differs.

Ongoing edits belong to the **`arkaik` skill installed beside this one**
(`../arkaik/SKILL.md`): if you are updating the map as a side-effect of a
code change, that is its job, not this skill's. Once the bootstrap run has
landed, this skill has done its one job and can be removed:

```bash
arkaik init --remove-bootstrap
```

## The contract you work under

**You never read the bundle. You never write the bundle. You never write
merge logic.** You read a slice, you write a fragment:

```bash
arkaik bootstrap slice <unit> > slice.json   # what to read
arkaik bootstrap index                        # existing node ids, when you need to reference them
```

The slice is exactly the corpus subset your unit needs — matching PRs,
matching surfaces, and the docs manifest when your unit asks for it — instead
of the whole repository. The index is one tab-separated line per existing
node (`id`, `species`, `title`, `product`): how you reference real nodes
without loading their bodies.

Your output is one JSON file at `.arkaik/bootstrap/fragments/<unit>.json`,
in the shape defined by [references/fragments.md](references/fragments.md).
`arkaik bootstrap merge` owns everything after that — ID-collision detection,
cross-fragment edge resolution, journal event synthesis, validation, landing
the result at `{{BUNDLE_PATH}}` with its journal sidecar — and a malformed
fragment fails with your unit's name attached rather than corrupting the
map. Never edit another unit's fragment. When yours is
written, set your unit's status to `done` in
`.arkaik/bootstrap/manifest.json`.

## Species discrimination

Four anatomy species, one question each:

- **Flow (`F-`)** — a journey the user moves through. It has a playlist.
- **View (`V-`)** — one surface the user looks at: a screen, page, or panel.
- **Data model (`DM-`)** — a thing the product stores or reasons about.
- **API endpoint (`API-`)** — a callable contract across a boundary: a route
  handler, an RPC, a webhook.

A route file is usually one `API-` node; the page it feeds is a `V-`; the
navigation between pages is the `F-`. Later waves add **acceptances (`AC-`)**
— testable promises — and **decisions (`DEC-`)** mined from design docs.

**The `DM-` rule — concept vs physical table.** A conceptual model takes the
singular concept name: the concept "Project" is `DM-project`. A physical
table or DB view takes its exact identifier: the table `projects` is
`DM-projects`. Both may legitimately exist in one map; they must never
kebab-case into the same id. Full ID and title rules live in the `arkaik`
skill beside this one and its `../arkaik/references/schema.md`.

## Playlists

Every flow ships a **real** `metadata.playlist` — actual entries referencing
actual views and sub-flows, never a placeholder. Two invariants:

- The playlist and the flow's `composes` edges **agree**: every view or flow
  in the playlist has a `composes` edge from the flow, and every `composes`
  edge appears in the playlist.
- **No cycles** — a flow cannot contain itself, directly or through
  sub-flows.

Entry shapes — including the branching `condition` and `junction` entries —
are in `../arkaik/references/schema.md`.

## Acceptances

An acceptance is a testable promise. When you write one:

- **Exactly one Given/When/Then** in `metadata.gherkin`. A second scenario is
  a second acceptance.
- **`covers` edges to real anchors** — views or flows whose ids exist in the
  index or in your own fragment. An acceptance covering nothing is an intake
  idea, not mapped behavior.
- **Single-product anchoring** — its `covers` edges may span several views
  and flows, but they must all resolve to the same product. A promise that
  genuinely spans two products is two acceptances.

The full doctrine (per-platform statuses, anchorless intake, the parity
layer) is the `arkaik` skill's "Acceptances" section — follow it, don't
reinvent it.

## Values

Assign **1–3 Bain value elements** in `metadata.values` per acceptance. The
**most specific element wins**; claim a higher tier of the pyramid **only
when the acceptance genuinely operates there**. The 30-element table with
one-line definitions is `../arkaik/references/values.md` in the skill beside
this one. If that file is absent (the maintenance skill was installed with
`--no-values`), value mapping is out of scope for this repo — skip it
entirely. When unsure, omit: a wrong value is worse than a missing one, and
the wave-2 balance check (see [references/waves.md](references/waves.md))
rejects a lopsided wave anyway.

## Platform scoping

Per-platform truth lives on acceptances (`metadata.platformStatuses`), and
history is full of platform-scoped shipping — a PR that says `AC-x@ios`, or
that only touched the iOS target, shipped iOS and nothing else.

**An unscoped promotion claims every platform.** Moving an acceptance's base
`status` asserts the behavior everywhere the acceptance's platforms reach —
exactly like an unscoped `AC-x` mention in a PR. When the evidence says one
platform, write that one platform's status. **Scope to the fewest platforms
that are true**, and keep `platforms` itself to where the behavior is
actually expected — mobile-only behavior is `["ios", "android"]`, not
backlog-on-web.

## What counts as user-visible

Wave 3 turns PRs into story. The filter:

- **A PR with a Lab Note is user-visible by definition** — and the note is a
  benefit-first title and summary already written for you. Use it.
- **Chores, CI, refactors, dependency bumps, and docs-only changes are not.**
- **Judge the rest** — pre-pipeline PRs carry no note. Ask: could a user of
  {{PRODUCT_NAME}} notice the difference? Record the judgment and the reason
  in your fragment's `notes` so the reviewer can check it.

## Status arcs

Every anatomy node gets an honest arc of **1–3 events ending at its snapshot
status**: the `node.created` that merge synthesizes from `created_ts`, plus
**0–2 `node.status_changed` written by you** — one per transition that
actually happened, the final one landing on the node's snapshot status.
**Never invent a transition that did not happen.** A born-live node's arc is
its `node.created` alone — write no status event for it, not a fabricated
idea → development → live staircase. Build the arc from evidence: the PR
that first shipped the surface, the era it was built in. Timestamp mechanics
(distinct instants, `changed_ts`) are in
[references/fragments.md](references/fragments.md).

## Never delete

Bootstrap never deletes. In a brownfield reconcile, a node that exists in
the map but no longer in the product is **retired** — a `retire` op with a
`reason` — and merge archives it with the reason on record. Removal stays a
human decision, made outside this run. If you find yourself wanting to
delete, you are holding the wrong tool.
