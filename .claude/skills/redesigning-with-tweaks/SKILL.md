---
name: redesigning-with-tweaks
description: Use when the owner asks for a redesign of a UI surface explored through several design directions (bold vs calm, multiple sub-agents, "propositions for each section"), composed by picking per section in a tweaker, then shipped — including when they ask for the result as a user-switchable look or preference.
---

# Redesigning with tweaks

## Overview

Several authors (sub-agents) explore a surface **in one shared build**, each adding
variants per section into a **tweaker** the owner uses to compose live. The owner's
picks are then rebuilt into the shipped components — never shipped as forks — and the
exploration CSS is **ported by script** to preference-keyed CSS.

**Core principle:** the owner composes by eye in a running build, so everything
serves that loop — one tree, composable sections, reproducible recipes — and nothing
from the exploration ships unexamined.

## When to use

- "Redesign X with N sub-agents, one bold, one calm, several propositions per section"
- "Composable through the tweaker", "let me pick per section", "make it a preference"
- NOT for a single focused restyle (just do it), or a one-direction redesign without
  composition (no tweaker needed).

## The method

**1. Scaffold first (you, before any author starts).** In a detached exploration
worktree, copy `scaffold/*.tmpl` into the surface (e.g. `components/<surface>/tweaks/`,
drop `.tmpl`), plus `author-index.tsx.tmpl` as `<author>/index.tsx` for each author
(the registry imports them). Mount `<Tweaker />` once, where the surface mounts.
Adapt `contract.ts`:
- Cut the surface into **sections**; give each a slot (`<TweakSlot section props>`
  around the shipped JSX) and `renderOriginal()`. A repeated surface (cards in a grid)
  also gets container sections (grid, density) — CSS-only is fine there.
- Pass **models, not records**, wherever the shipped UI encodes a subtle rule
  (membership, derived values, read-only): authors render data, never re-derive rules.
- Pass live/autosaving elements as nodes to *place* (seed contentEditables via
  callback refs, not a mount-once effect, or a re-parented element comes up empty).
- Add data hooks on the surface root/header (`data-<surface>`, `data-species`…).
- Smoke-test one throwaway variant through `?tw=` before dispatching.

**2. One worktree, disjoint folders.** A detached worktree, one dev server, each author
writes ONLY `tweaks/<author>/**` (registry, stylesheet, forks). They see each other's
work live; the owner composes across authors with no merge step. Write the brief from
`brief-template.md`; the direction (bold/calm) goes in each agent's prompt.

**3. The owner loop.** Ask early: which look is the default, and should this
surface follow an existing preference (e.g. `data-panel-look`) or get its own? Point
them at the tweaker; recipes (`?tw=…`, "Copy recipe")
make every composition reproducible. When they pick, add **lead-composed variants**
(`★ …`) and presets that encode the decisions; keep open sections tweakable. Shoot
real data (a production export imported locally) — seeds hide multi-platform,
long-text and empty cases.

**4. Probe every variant, not just presets** (`scripts/probe.mjs`, run with no args for
its modes): `scroll` over every variant × record kind (each species, empty, long),
`radius` on anything that morphs, `stack` on anything that opens inline, `shoot` at
`--width 400` and `--dark`, plus the surface's read-only route. Owner-reported bugs in the panels run were
all probe-findable — see the trap table.

**5. Ship by rebuilding, in a stack — from a fresh worktree off main.** The scaffold
and the authors' folders never get committed; they stay in the exploration worktree,
which is the CSS porter's source until the stack merges. Plan parts: shared fixes → pure refactor (models)
→ the default look as THE surface → alternate look + preference → secondary preference
→ removal of dead pieces. Then:
- Port picks **into the shipped components** (rewrite `PlatformVariants`, don't ship
  `BoldPlatformEditor`); source-asserting tests pin the shipped names.
- Re-key every structural selector (`:has(> section > h4)`, utility classes) onto data
  hooks you add to the shipped markup.
- Generate the CSS with `scripts/port_css.py --config … --part N` (see
  `config.example.json`, the real config that shipped the panels): conditions →
  `[data-<pref>]` (default = no attribute), renames to a **prefix new to this
  surface** (the panels took `np-`), dead-class pruning, patches.
- A preference applied before paint needs an inline script in the root layout, whose
  string lives in a **plain module** (a `"use client"` export reaches a server
  component as a reference, not a string). Test the parser and the script.
- Lab Note: on the user-facing part(s) per CLAUDE.md (the panels carried one, on the
  part where the switch arrived); label the rest `no-lab-note`.
- After merge: archive the exploration (`git diff` patch + shots + brief + config)
  outside the repo, then remove both worktrees.

## Traps (each one happened)

| Symptom | Cause | Fix |
|---|---|---|
| Panel won't scroll with one variant | `overflow:hidden` on a flex child makes it a scroll container; its min-height drops to 0 and it shrinks | `overflow: clip` + `flex-shrink: 0` |
| Corners flash square on hover | spring from `border-radius: 999px` overshoots below 0 | radius = half the size |
| Dropdown opens under the next block | `animation-fill-mode: both`/opacity leave every block a stacking context | fill `backwards`; `:focus-within` block `z-index` |
| A component's CSS only works with one other pick | rules keyed on another section's variant id | key on the component's own variant too |
| Ported rule silently gone | dead class inside `:is(a, b)` pruned the whole selector; `:is(:root…, .x)` not expanded | `port_css.py` handles both — check counts |
| Commit lands on the previous part | `gh stack add` after committing | add the branch first; after `branch -f`, `unstack --local` + `init` |
| A fake Lab Note on every PR | `gh stack submit` fills bodies from the PR template | rewrite every body |
| Tooltip "not showing" in a probe | one-shot `hover()` | move the pointer in steps |

## Related

**REQUIRED SUB-SKILL:** use `gh-stack` for the stack. Read `docs/conventions.md`
§ "Shipping larger work" before cutting parts, and CLAUDE.md for the Lab Note.
