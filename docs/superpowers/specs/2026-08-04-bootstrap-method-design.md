# Bootstrap: onboarding any repo onto Arkaik — design

**Date:** 2026-08-04 · **Status:** approved

## Goal

Turn the one-off method invented for [self-map cycle 5](2026-08-04-content-population-design.md)
— corpus-first layered fan-out with deterministic merge — into a **shipped,
repo-agnostic capability**: any repository can go from "no map" or "stale map"
to a complete Arkaik graph (anatomy, acceptances, values, platform scoping,
and mined history) with the smallest possible agent-token bill.

Cycle 5 proved the method works at ~220 nodes and ~530 journal events. But its
machinery lived in a session scratchpad and was deliberately discarded, so the
next repo would pay the same discovery cost again — in agent tokens, the
expensive kind. This spec makes the method a product surface.

**Pebbles is the proving run**, at full parity with the Arkaik self-map. It
exercises the two dimensions Arkaik's own run never could: **brownfield
reconcile** (a map already exists) and a **multi-platform axis** (ios + web).

## Decisions made in this brainstorm (2026-08-04)

- **Generalize first; Pebbles proves it.** The method is written repo-agnostic
  from the start, with cycle 5 as the retrospective case study, rather than
  running Pebbles manually and extracting later.
- **Determinism ships as CLI commands**, judgment ships as a skill. A
  docs-only method was rejected: it is exactly what made cycle 5 expensive
  and non-repeatable.
- **`gh`-first corpus mining** with a `git log` fallback. The Lab Note
  pipeline is what makes deliverable copy nearly free, so the richest tier
  binds to GitHub deliberately.
- **Hosted history lands via whole-bundle restore**, not an `append_event`
  mutation op. Simplest verb, one call; safety comes from `If-Match`, a
  mandatory client-side backup, and `--dry-run`.
- **Manifest-driven in-session fan-out** is the primary driver; GitHub issues
  are an alternate output mode of the same manifest, not a second design.
- **The Pebbles run goes to full parity** — reconcile + acceptances/values +
  platform scoping + the whole story from 324 merged PRs.

## Findings that shaped this design

Established by inspection during the brainstorm, and load-bearing below:

- **Pebbles is brownfield.** `~/code/pbbls/docs/arkaik/bundle.json` holds 173
  nodes / 337 edges / 253 journal events with **zero acceptances, zero
  decisions, and no `platformStatuses`** — a pre-acceptance-era anatomy map.
- **Pebbles is hosted.** `docs/arkaik/arkaik.json` points at
  `prj_5dDiZc-G6lseF3cb` on `https://arkaik.app`; the local `bundle.json` /
  `journal.jsonl` are a pulled cache, not the source of truth.
- **The hosted journal is read-only.** `POST /api/graph/projects/{id}/mutations`
  accepts `create_node | update_node | delete_node | delete_nodes |
  create_edge | delete_edge` (atomic, ≤500 ops), and journal events are
  *derived* server-side. `GET` is the only verb on `/journal`. Backdated
  `node.status_changed`, `deliverable.shipped` and `release.tagged` therefore
  have **no landing path** on a hosted project today — hence § 7.
- **Whole-bundle intake already exists.** `createProject` in
  `lib/services/graph/store.ts` validates an inbound bundle (shape, semantics,
  status-vocabulary migration) and stores snapshot + journal. Restore is a
  sibling of code that already works.
- **No tier risk.** `HOSTED_LIMITS.synk` is 5,000 entities; Pebbles at full
  parity lands around 400 nodes / 700 edges.

## 1. Two modes, one method

**Bootstrap** is the one-time onboarding capability, sibling to the existing
**maintenance** skill ("you changed a route, update the map").

| Mode | Trigger | Wave 1 behavior |
|---|---|---|
| Greenfield | no bundle, or a stub | agents mint the anatomy |
| Brownfield | bundle exists, layers missing | agents **reconcile** — `add` / `update` / `retire` against a compact index |

**Bootstrap never deletes.** `retire` proposes `status: archived` with a
reason; destructive removal stays a human act. This is what makes re-runs
safe, and re-runnability is what makes the method reusable rather than a
story about one session.

## 2. Three planes

The core lesson of cycle 5: the expensive part was not judgment, it was agents
re-deriving plumbing — `gh` pagination, ID uniqueness, cross-fragment edge
resolution, journal sorting, era assignment. So the split is absolute:
**determinism lives in code, judgment lives in agents, and they meet at a file
boundary.**

```
corpus (CLI) → slices → [agents emit fragments] → merge (CLI) → validate (CLI) → land (CLI)
```

Agents never read the bundle, never write the bundle, and never write merge
logic.

## 3. Deterministic plane — `packages/cli`

A new command group, `arkaik bootstrap`:

| Command | Does |
|---|---|
| `corpus` | Mines the repo into `.arkaik/corpus/`: `prs.jsonl` (via `gh`: number, title, body incl. Lab Note, `mergedAt`, labels, changed paths), `docs.json` (specs/RFCs manifest), `surfaces.json` (route / screen / handler inventory by conventional globs). `--since` for incremental re-runs; `--from-git` mines merge commits for non-GitHub hosts (and loses Lab Notes). |
| `plan` | Emits `manifest.json` — work units per wave, each with slice ref, scope, output fragment path, status. `--issues` files one GitHub issue per unit instead of driving in-session. |
| `slice <unit>` | Prints exactly the corpus subset one unit needs. The primary token lever. |
| `index` | Compact `id · title · species · product` listing of the current map (~6KB for Pebbles vs 164KB for the bundle). |
| `merge <dir>` | Assembles fragments onto the base bundle: verifies ID uniqueness, resolves cross-fragment edge endpoints, applies reconcile ops, synthesizes required `node.created` events, sorts the journal by `ts`, sets `updated_at`, writes, prints counts + file size. |
| `restore` | Lands a bundle on a hosted project (§ 7). |

`arkaik validate` (already shipped) is the gate after every wave.

### Working directory

Everything bootstrap produces before the final bundle is **working material,
never committed**: `.arkaik/corpus/` (mined corpus),
`.arkaik/bootstrap/manifest.json` (the plan), `.arkaik/bootstrap/fragments/`
(agent output). `arkaik bootstrap corpus` adds `.arkaik/` to the repo's
`.gitignore` if it is not already ignored. The repo's contract stays what it
is today: the bundle, the journal, and `arkaik validate`.

### Fragment contract

Two shapes, both machine-checkable, both small:

```jsonc
// waves 1–2
{
  "unit": "views/journal",
  "wave": 1,
  "nodes": [], "edges": [],                    // greenfield
  "add": [], "update": [], "retire": []        // brownfield
}

// wave 3
{
  "unit": "era/first-graph",
  "wave": 3,
  "deliverables": [], "releases": [],
  "decisions": { "nodes": [], "edges": [] },
  "events": []
}
```

IDs are deterministic from title per the skill's existing rules, so
cross-fragment edges resolve without agent-to-agent coordination. Two agents
minting the same ID for *different* things is a hard `merge` error printing
both titles — never a silent union.

Nodes carry an optional `created_ts` (the merge date of the PR that first
shipped the surface) so `merge` can synthesize the `node.created` event the
validator requires. Absent that, it falls back to `project.created_at`.

## 4. Judgment plane — the `arkaik-bootstrap` skill

Installed **on demand**: `arkaik init --bootstrap` adds it,
`--remove-bootstrap` drops it once the run is done. Ongoing maintenance
sessions must not carry a large one-time skill in context — that is a
permanent token tax for a one-time job.

It teaches only what code cannot decide:

- species discrimination (flow vs view vs data model vs endpoint)
- ID conventions, including the concept-vs-physical-table `DM-` rule
  (`DM-project` vs `DM-projects`)
- playlist authoring and playlist ↔ `composes` coherence
- one Given/When/Then per acceptance; 1–3 Bain value elements, most specific
  element wins, higher tier only when genuinely earned
- platform scoping (`AC-x@ios`) — including the trap that an **unscoped**
  promotion claims *every* platform
- the user-visible PR filter (a Lab Note means user-visible by definition;
  pre-pipeline PRs need judgment)
- era cut lines, decision mining from specs/RFCs, honest status arcs

## 5. Waves & gates

| Wave | Agents | Emits |
|---|---|---|
| 0 · Recon | 1 | `profile.json` — products, platform axis, surface conventions, corpus stats, proposed area split. This is what makes `plan` repo-aware instead of hardcoded to Arkaik's shape. |
| 1 · Anatomy / Reconcile | ~8–12 area agents | `{nodes, edges}` or `{add, update, retire}` |
| 2 · Acceptances + values | per-surface agents + 1 values-balance reviewer | acceptances with Gherkin, `metadata.values`, `covers` edges, platform scoping |
| 3 · Story | era agents over corpus slices + 1 decisions agent + 1 status-arc agent | deliverables, releases, decisions, backdated events |

Every wave ends the same way: **adversarial reviewer** (checked against the
product, not just the schema) → `merge` → `validate` **warning-clean**. A wave
that does not gate green does not advance.

**Resumability is structural, not a feature.** Unit status lives in
`manifest.json`; output lives in fragment files. A killed session re-reads the
manifest and resumes at the first `pending` unit.

The values-balance reviewer exists because an unchecked acceptance wave
collapses into ~90% `simplifies`; the pyramid must show real spread.

## 6. Token model

Levers, in descending order of savings:

1. **Slices** — an agent reads ~30–60KB of its own slice, never the ~1.5MB whole
2. **Index over bundle** — ~6KB instead of 164KB, times ~25 agents
3. **Warm in-session subagents** — no cold-start orientation tax per unit. The
   `--issues` mode trades roughly 15–30k tokens per unit for durability and
   cross-machine parallelism; that is the stated price, not a hidden one
4. **CLI determinism** — merge logic written once, not re-derived per run per repo
5. **Lab Notes as free copy** — a PR with a note already has a benefit-first
   title and summary written
6. **Early gates** — a bad wave fails at roughly a quarter of the cost

## 7. Hosted landing — `PUT /api/graph/projects/{projectId}/bundle`

- **Owner-only** — an ownership check, not merely the `graph:write` scope
- **`If-Match: "<version>"` required** — a concurrent edit gets `412`, never a
  silent overwrite
- Body is the whole bundle including its journal; reuses
  `validateInboundBundle` (shape, semantics, status-vocabulary migration) and
  `getHostedLimitsForTier`
- One transaction: replace snapshot + journal, bump `version`

`arkaik restore` exports the current hosted state to
`docs/arkaik/.backups/<ts>-bundle.json` — anchored to the link file's
directory, not wherever the local bundle argument happens to live — **before**
sending, and refuses to proceed if it cannot write that file (including a
read-back-and-parse check after the write, and exclusivity against a
colliding timestamp). It also refuses if the outbound journal is shorter than
the hosted one (`--allow-history-loss` overrides), since an empty or
truncated journal would otherwise pass every other check and read as an
ordinary successful restore. `--dry-run` sends the identical request with
`?dryRun=1` — the server runs the same validation/version/tier gates a real
write would, so the preview is exact, not a local approximation — and prints
the returned node / edge / event deltas; nothing is written in this mode, and
no backup is taken (there is nothing to protect against).

**Stated trade-off.** A server-side pre-image would need a new table, hence a
migration, hence a *manual* production step — a known foot-gun in this repo.
The mandatory local backup plus `If-Match` covers the realistic failure modes
(an agent clobbering its own work; someone editing in the browser meanwhile)
at zero migration cost. Whole-bundle replace is destructive by design; these
three rails are what make it safe enough to prefer over a new mutation op.

## 8. The Pebbles run

0. `arkaik init --update` in pbbls **first** — repo-local validators reject the
   `acceptance` and `decision` species until the skill is v3.1. Then
   `arkaik init --bootstrap`.
1. `corpus` — 324 merged PRs + docs manifest + surface inventory
2. Wave 0 recon — confirm the product split and the **ios/web** platform axis
3. Wave 1 **reconcile** against the 173 existing nodes
4. Wave 2 acceptances + values + platform scoping (heaviest judgment load)
5. Wave 3 story — eras across 324 PRs, decisions from docs, status arcs
6. `merge` + `validate` warning-clean
7. `restore --dry-run`, then `restore` to `prj_5dDiZc-G6lseF3cb`
8. Commit the refreshed cache in pbbls, with a Lab Note on the PR

**Guardrail:** any reconcile unit proposing more than 20% churn on existing
nodes stops for review instead of auto-merging.

## 9. Delivery

| PR | Repo | Contents | Lab Note |
|---|---|---|---|
| 1 | arkaik | CLI bootstrap surface + fragment/manifest schemas + tests | yes |
| 2 | arkaik | Hosted restore endpoint + `arkaik restore` | yes |
| 3 | arkaik | `arkaik-bootstrap` skill + method doc + `init --bootstrap` | yes |
| 4 | pbbls | The run's output + refreshed cache | yes |

Sequential: PR 3 depends on the fragment contracts landed in PR 1. Optional
follow-up — the self-map gains nodes for the bootstrap surface (dogfood).

## 10. Testing

- **CLI unit tests on fixtures:** merge determinism (byte-identical output for
  identical input), ID-collision detection, cross-fragment edge resolution,
  journal sort stability, reconcile op application, `node.created` synthesis
- **Restore:** this machine has no local Postgres, so the `If-Match`
  comparison, delta computation and validation wiring are extracted as **pure
  functions** with real tests in CI's fast build job; the route-level test
  no-ops locally like the rest of the services suites
- **Golden end-to-end:** a tiny fixture repo (5 PRs, 3 surfaces) driven through
  corpus → plan → merge → validate. This is the regression test for the method
  itself
- `npm run generate` if any generated schema artifact moves; lint bar is no new
  errors in files this work touches

## 11. Out of scope

- App code beyond the restore endpoint
- French localization of map content (the bundle schema has no locale axis)
- New journal event types or status vocabulary changes
- Billing / tier changes
- Issue-mode automation beyond emitting the issues (no bot merges fragments)
