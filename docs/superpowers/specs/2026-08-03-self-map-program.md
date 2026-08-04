# The Self-Map Program — vision & cycle plan

**Date:** 2026-08-03 · **Status:** all 5 cycles shipped (cycle 5 PRs in review)
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

### 3. Changelog split: Design | Delivery + Deliverables/Releases + History — ✅ SHIPPED 2026-08-03 (PR #337)

Split the changelog page into two boxed panels. **Delivery**: distinguishes
**Deliverables** (PR-based — entity changes + a summary note) from
**Releases** (grouping one or many deliverables + a release note; today a
release is only a derived `release.tagged` journal marker, not an entity).
**Design**: commitments (idea→discovery, discovery→backlog transitions) plus
Decisions from cycle 2. The granular event feed (`node.status_changed`,
`edge.added`, …) moves to a **History page** (project switcher section, near
settings). Depends on cycles 1–2.

### 4. Public Arkaik project in /projects — ✅ SHIPPED 2026-08-04 (PR #338)

The self-map as a default public **full sandbox** (reset on refresh, not
read-only): an in-memory seed provider behind the provider seam, a fourth
"Explore" section on `/projects` rendered for everyone, the stable
client-rendered URL `/project/arkaik-self-map`, a persistent banner with
Reset and Import-a-copy. Spec:
[2026-08-04-public-self-map-design.md](2026-08-04-public-self-map-design.md).

### 5. Content population (subagent horde) — ✅ SHIPPED 2026-08-04 (PR A #339, PR B #340)

The corpus-first fan-out populated the seed with the whole product and its
history: **220 nodes** (34 views, 36 flows, 26 data models, 22 API
endpoints, 84 valued acceptances, 18 decisions), 411 edges, three products
(`studio`/`platform`/`toolchain`), four curated maps, and a 791-event
journal — 111 deliverables (Lab-Note-sourced, real merge timestamps)
grouped into 10 thematic-era releases, decision trails, honest per-node
status arcs, and 3 open ideas. PR A = the map; PR B (stacked) = the story.
Spec:
[2026-08-04-content-population-design.md](2026-08-04-content-population-design.md).

## Standing decisions (do not re-litigate)

- Two axes: status = delivery lifecycle; `stage` = exposure.
- Transitions documented, never enforced.
- Journal history is never rewritten; legacy ids accepted forever.
- `idea` is a status until cycle 2 decides otherwise.
- Migration philosophy: hard cutover + permanent aliases + one-time
  version-gated remap (soft-deprecation and pluggable vocabularies rejected).
