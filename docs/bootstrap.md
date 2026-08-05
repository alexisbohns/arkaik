---
title: "Bootstrap: onboarding a repo onto Arkaik"
navTitle: "Bootstrap"
order: 8
---

# Bootstrap: onboarding a repo onto Arkaik

> A walkthrough, not a reference. The agents' doctrine — fragment shapes, wave
> checklists, judgment rules — lives in the
> [`arkaik-bootstrap` skill](arkaik-bootstrap-skill/skill.md) and its
> [references](arkaik-bootstrap-skill/references/waves.md); the full rationale
> is the [design spec](superpowers/specs/2026-08-04-bootstrap-method-design.md).

Bootstrap takes a repository from "no map" (or "stale map") to a complete
Arkaik graph — anatomy, acceptances, values, platform scoping, and the
product's whole history mined from its merged PRs — in one run. Agents do the
judgment; the `arkaik bootstrap` CLI does everything deterministic; and when
the run lands, the skill that drove it is removed. The run's cost is agent
tokens — the levers that keep it down are below. One run, then it gets out
of the way.

**If your repo already has a map, run `arkaik init --update` before anything
else.** The installed `arkaik` skill ships a repo-local validator, and a stale
one predates the `acceptance` and `decision` species — so everything the run
produces gets rejected at the gate. This is the number-one way a real run
fails, and it fails late. Update first.

## Two modes, one method

- **Greenfield** — no bundle yet, or an `arkaik init` stub with zero nodes.
  Agents mint the anatomy from scratch.
- **Brownfield** — a bundle that already carries nodes. Agents **reconcile**
  the existing map against the code: `add` what's missing, `update` what
  drifted, `retire` what's gone.

`arkaik bootstrap plan` detects the mode on its own; only the wave-1 fragment
shape differs. And **bootstrap never deletes** — `retire` proposes
`status: archived` with a reason, and removal stays a human act. That is what
makes re-runs safe.

## Why the CLI owns determinism

The method's core lesson (learned the expensive way, mapping Arkaik itself):
the costly part of a run is not judgment, it is agents re-deriving plumbing —
`gh` pagination, ID uniqueness, cross-fragment edge resolution, journal
sorting. So the split is absolute: **determinism lives in the CLI, judgment
lives in agents, and they meet at a file boundary.** Agents read a slice and
write a fragment. They never read the bundle, never write the bundle, and
never write merge logic — `arkaik bootstrap merge` owns ID-collision
detection, edge resolution, event synthesis, and validation gating, the same
way every time, for every repo.

## One run, start to finish

```bash
arkaik init --update                       # brownfield: get the current skill first
arkaik init --bootstrap                    # install the one-time skill
arkaik bootstrap corpus                    # mine PRs, docs, surfaces
arkaik bootstrap plan                      # wave 0 only
# ... recon agent writes .arkaik/bootstrap/profile.json ...
arkaik bootstrap plan                      # expands waves 1-3
arkaik bootstrap slice w1-<area>           # what one agent reads
# ... agents write fragments ...
arkaik bootstrap merge
arkaik validate docs/arkaik/bundle.json    # the gate — warning-clean
arkaik restore --dry-run                   # hosted only
arkaik restore                             # hosted only — destructive; see below
arkaik init --remove-bootstrap             # the skill has done its job
```

Step by step:

1. **`arkaik init --update`** — the brownfield opener (see the warning above).
   Version-gated: a no-op when the skill is already current, and it never
   touches the bundle or journal.
2. **`arkaik init --bootstrap`** — installs the one-time `arkaik-bootstrap`
   skill beside the maintenance skill (`.claude/skills/arkaik-bootstrap` by
   default). On a greenfield repo this same command also scaffolds
   `docs/arkaik/`. The two init lines combine if you prefer:
   `arkaik init --update --bootstrap`.
3. **`arkaik bootstrap corpus`** — mines merged PRs (via `gh`, including Lab
   Notes), a docs manifest, and a code-surface inventory into
   `.arkaik/corpus/`. Run it from the repo root. `--from-git` works without
   GitHub but loses Lab Notes; `--since <iso-date>` keeps incremental re-runs
   cheap.
4. **`arkaik bootstrap plan`** — writes the work-unit manifest. With no recon
   profile yet, it plans exactly one unit: `w0-recon`, the agent that reads
   the corpus and declares the repo's shape — products, platform axis, areas,
   eras — in `.arkaik/bootstrap/profile.json`.
5. **`arkaik bootstrap plan`** again — now expands waves 1–3 from the
   profile: `w1-<area>` and `w2-<area>` per area, `w3-<era>` per era, plus
   `w3-decisions` and `w3-status-arcs`. Unit ids come from the area ids and
   era slugs recon declared; `plan` prints the full list. Re-planning
   preserves the status of any unit whose slice is unchanged, so it is always
   safe to run.
6. **`arkaik bootstrap slice <unit>`** — prints exactly the corpus subset one
   unit needs. This is what a work agent reads instead of the repo.
7. **Agents write fragments** — one JSON file per unit under
   `.arkaik/bootstrap/fragments/`, in the shape defined by the skill's
   [fragment contract](arkaik-bootstrap-skill/references/fragments.md).
8. **`arkaik bootstrap merge`** — assembles every fragment onto the bundle
   and validates the result: errors block the write outright; warnings are
   reported but never block. `--dry-run` previews without writing.
9. **`arkaik validate docs/arkaik/bundle.json`** — the independent gate. Note
   that it exits 0 even with warnings; **warning-clean output** is the bar a
   wave must meet, and that is yours to enforce, not the CLI's.
10. **`arkaik restore --dry-run`, then `arkaik restore`** — hosted projects
    only; see below. A purely local map is done at step 9: commit the bundle
    and its journal.
11. **`arkaik init --remove-bootstrap`** — see
    ["When the run is done"](#when-the-run-is-done).

The merge → validate pair is not a final step — it closes **every** wave (see
the gates below). The block above shows it once.

## The wave gates

A run is four waves — recon, anatomy/reconcile, acceptances + values, story —
and every wave ends the same way: an **adversarial review** checked against
the product (not just the schema), then `merge`, then `validate`
**warning-clean**. A wave that does not gate green does not advance. Two of
the checks are hard stops:

- **Churn guard (wave 1, brownfield):** a unit proposing `retire` or `update`
  on more than 20% of the existing nodes stops for human review — churn at
  that scale is usually a wrong slice, not a real product change.
- **Values balance (wave 2):** if more than half the acceptances land on one
  value element, the wave is rejected and re-run.

The full per-wave checklists live in the skill's
[waves reference](arkaik-bootstrap-skill/references/waves.md) — the reviewer
reads those, not this page.

## The token model

Agent tokens are the run's real cost; every lever below exists to cut them:

- **Slices** — an agent reads the ~30–60KB its unit needs, never the ~1.5MB
  whole corpus.
- **Index over bundle** — `arkaik bootstrap index` is a ~6KB
  id/species/title/product listing instead of a 164KB bundle, and every
  referencing agent reads it (agents run it themselves mid-unit — it is not
  a step in the walkthrough above).
- **Warm in-session subagents** — the default driver: fan units out to
  subagents in one session, no cold-start orientation tax per unit.
  `arkaik bootstrap plan --issues` files one GitHub issue per unit instead —
  durable and parallel across machines, at a stated price of roughly 15–30k
  tokens per unit for the cold starts.
- **Lab Notes as free copy** — a PR with a note already has a benefit-first
  title and summary written.
- **Early gates** — a bad wave fails at roughly a quarter of the cost of a
  bad run.

## `.arkaik/` is scratch

Everything bootstrap produces before the final bundle — the corpus
(`.arkaik/corpus/`), the plan (`.arkaik/bootstrap/manifest.json`), the recon
profile, the fragments — is working material, never committed. `corpus` (or
`plan`, whichever runs first) adds `.arkaik/` to `.gitignore` itself. The
repo's contract stays what it already was: the bundle, the journal, and
`arkaik validate`.

Scratch does not mean fragile: unit statuses live in the manifest and output
lives in fragment files, so a killed session resumes at the first `pending`
unit instead of starting over.

## Landing on a hosted project

If the repo is linked to a hosted project (`docs/arkaik/arkaik.json` — see
[Hosted Projects](hosted-projects.md)), `arkaik restore` lands the bootstrapped
bundle there. **Restore is the one destructive verb the CLI offers**: it
replaces the hosted project's snapshot *and* its journal wholesale, in one
transaction. Three rails make it safe enough to use:

- **It always backs up first.** Before sending anything, restore exports the
  current hosted state — journal included — to
  `docs/arkaik/.backups/<timestamp>-bundle.json`, verifies the file reads
  back, and refuses to proceed if it cannot. The server keeps no pre-image,
  so this file is the only undo: `arkaik restore <backup-path>` reverses a
  restore you regret.
- **It is `If-Match`-gated and owner-only.** A concurrent edit gets a `412`,
  never a silent overwrite — re-run to read the current state and decide
  again. And the token must own the project, not merely hold a write scope.
- **`--dry-run` is an exact preview.** The server runs the same validation,
  version, and tier gates a real write would and returns the node/edge/event
  delta; nothing is written and no backup is taken.

One more guard: if the outbound journal has fewer events than the hosted one,
restore refuses — that shape usually means a missing `journal.jsonl`, not an
intended rewrite. `--allow-history-loss` is the deliberate override.

## When the run is done

```bash
arkaik init --remove-bootstrap
```

The bootstrap skill is deliberately opt-in and deliberately removed: it is a
large skill for a one-time job, and leaving it installed taxes every future
maintenance session's context for no benefit. Removal isn't precious — the
skill is version-stamped, and `arkaik init --bootstrap` reinstalls it any
time you want another run. Day-to-day map upkeep belongs to the `arkaik`
skill, which stays.
