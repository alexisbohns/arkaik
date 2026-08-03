# The Self-Map Program — vision & cycle plan

**Date:** 2026-08-03 · **Status:** cycle 1 shipped; cycle 2 next
**Resume:** in a fresh session, say "continue the self-map program — start
cycle N" and point the agent here. Each cycle gets its own
brainstorm → spec → plan → subagent execution → PR, and updates this file's
status lines on merge.

## Vision

Two goals, deliberately interleaved:

1. **Arkaik in Arkaik.** Ship Arkaik's own product map as a default public
   project every visitor (anonymous or logged-in) can open from `/projects` —
   a real, cutting-edge example of the product used on itself, for discovery
   and for power users studying advanced features.
2. **Modernize the PM model.** Statuses, Decisions, Deliverables/Releases,
   and the changelog grow into a real product-management surface.

The interleaving is the method: building the model while populating it with
Arkaik's real history keeps the design honest (no theoretical schema that
reality can't fill) and the content complete (no half-empty bundle because
the workflow couldn't express half the story).

## Cycles

### 1. Status lifecycle overhaul — ✅ SHIPPED 2026-08-03 (PR #331)

7 statuses (`idea, discovery, backlog, development, releasing, live,
archived`); `blocked` → `metadata.blocked_by` flag; `limited`/`deprecated`
rejected as statuses (the orthogonal `stage` axis keeps expressing exposure —
"two axes stay"); permanent legacy aliases + one-time v3 migration; prod
migrated same day (the `Migrate status vocabulary (production)` workflow
remains dispatchable). Spec:
[2026-08-03-status-lifecycle-overhaul-design.md](2026-08-03-status-lifecycle-overhaul-design.md).
Deferred from it: blocked indicator on StatusRing/aggregate rollups (noted in
`StatusRing.tsx`; revisit in cycle 3).

### 2. Decisions species + journal vocabulary — NEXT

A 6th species recording ADR-style decisions: Context/Why, Decision/What,
Consequences/How. Decision statuses (proposed, approved, rejected, actual,
deprecated, superseded) are **not** node lifecycle statuses — likely their own
enum. Decisions supersede earlier Decisions; generate Acceptances; impact
existing nodes (views, flows, APIs) or spawn new ones — the graph analog of
"a PR answers an Issue". Open questions for its brainstorm:

- Edge grammar: which `[source, target]` pairs (`decision→decision`
  supersedes, `decision→acceptance` generates, `decision→*` impacts?) and
  whether existing edge types stretch or new ones are needed.
- **Idea-as-entity, revisited** (parked in cycle 1): Alexis writes fewer
  GitHub issues and starts in the terminal — the flow is Terminal →
  Brainstorm → Spec → Decisions → Milestone → Issues → PRs → Releases.
  Should Idea become a standalone, prioritizable entity (impact/Value links)
  that gets "pulled" into brainstorming and yields Decisions?
- Journal vocabulary for decisions (`decision.recorded`,
  `decision.superseded`?), and whether Milestones (a bundle of issues where
  Acceptances/Views/Flows are pre-created at `backlog` and tagged so PRs know
  which nodes to move) enter the model here or in cycle 3.

### 3. Changelog split: Design | Delivery + Deliverables/Releases + History

Split the changelog page into two boxed panels. **Delivery**: distinguishes
**Deliverables** (PR-based — entity changes + a summary note) from
**Releases** (grouping one or many deliverables + a release note; today a
release is only a derived `release.tagged` journal marker, not an entity).
**Design**: commitments (idea→discovery, discovery→backlog transitions) plus
Decisions from cycle 2. The granular event feed (`node.status_changed`,
`edge.added`, …) moves to a **History page** (project switcher section, near
settings). Depends on cycles 1–2.

### 4. Public Arkaik project in /projects

The self-map as a default, public, uneditable project for anonymous and
logged-in users. Open questions: how it's referenced in `/projects`
(`seed/arkaik-self-map.json` already ships as the beachhead; Publik
infrastructure exists but renders previews, not graphs); play-without-persist
(local display tweaks that don't write back); stretch goal — full local
sandbox edits (create/rewire/remove, reset on hard refresh), possibly via
import-a-copy semantics which already exist.

### 5. Content population (subagent horde) — interleaved with 4

Fan out subagents over the repo's PRs and docs to build: a comprehensive
product mapping; an intelligent acceptance mapping; acceptances wired to
Value elements; a full changelog history and narrative (deliverables,
releases, decisions). Runs against the cycle 1–3 model so nothing is
retrofitted. The back-and-forth with cycle 4 is deliberate (see Vision).

## Standing decisions (do not re-litigate)

- Two axes: status = delivery lifecycle; `stage` = exposure.
- Transitions documented, never enforced.
- Journal history is never rewritten; legacy ids accepted forever.
- `idea` is a status until cycle 2 decides otherwise.
- Migration philosophy: hard cutover + permanent aliases + one-time
  version-gated remap (soft-deprecation and pluggable vocabularies rejected).
