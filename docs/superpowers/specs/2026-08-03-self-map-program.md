# The Self-Map Program — vision & cycle plan

**Date:** 2026-08-03 · **Status:** cycles 1–2 shipped; cycle 3 next
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

### 2. Decisions species + journal vocabulary — ✅ SHIPPED 2026-08-03 (PR #335)

A 6th species `decision` (`DEC-` prefix): Context/Why (`metadata.context`),
Decision/What (title + description), Consequences/How
(`metadata.consequences`), `metadata.decided_at`. Decision statuses are their
own enum in `metadata.decision_status` (`proposed, approved, enacted,
rejected, deprecated, superseded` — `actual` renamed `enacted`), synced to
the lifecycle by `lifecycleStatusForDecision` (proposed→discovery,
approved→backlog, enacted→live, terminals→archived). Three new edge types:
`supersedes` (decision→decision), `generates` (decision→acceptance),
`impacts` (decision→flow|view|data-model|api-endpoint) — generates/impacts
deliberately disjoint. One journal event `decision.status_changed`, derived
in `diffNodeUpdate` so every dual-writer emits it. Surfaces: Decision Log
page, detail-panel editor, library; maps/Delivery exclude decisions. All
additive — **no `schema_version` bump, no prod migration**. Brainstorm
resolutions: **Idea stays a status** (revisited and re-parked); Milestones
deferred to cycle 3. Known debt in the PR body (notably: `supersedes` moving
its target to `superseded` is writer discipline, no validator warning yet).
Spec: [2026-08-03-decisions-species-design.md](2026-08-03-decisions-species-design.md).

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
