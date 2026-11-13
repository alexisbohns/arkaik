# Author brief — template

Copy to the session scratchpad, fill every `<…>`, and hand the SAME file to every
author. The author-specific direction goes in each agent's prompt, not here. Drop the
lines that do not apply (no owner complaint, no autosaving elements, no read-only
rendering) rather than leaving them vague.

---

# <Surface> brief

You are one of <N> designer-engineers working in parallel on the same build. Each of
you proposes **several variants for every section** of <surface>. The owner composes
the final design by picking a variant per section in a floating **tweaker**, so your
variants must be **independent and composable**: each must look right next to the
shipped version or another author's variant of the neighbouring sections.

## What the owner said

> <the owner's words, verbatim — the complaint that started this>

## Where things are

- Worktree: `<path>` (detached, uncommitted, shared by every author). **Never commit,
  push, stash, reset or checkout.** The dev server runs on **<url>**; do not start or
  stop it — if it dies, say so in your report.
- The surface's code: <files>.
- The visual language: <design guide, theme and control stylesheets>. Read <guide>
  first; its principles are the owner's own rules.
- Read-only renderings exist (<where>): every variant must degrade there — no dead
  controls.

## The tweaker scaffold (already built — read it first)

`<scaffold dir>/`:
- `contract.ts` — **the contract**: the sections, the props each section's variant
  receives (`SectionProps`), `TweakVariant`, `TweakPreset`. Every variant gets
  `renderOriginal()` (the shipped UI) to wrap, restyle or replace.
- <models, e.g. `product-model.ts`> — <subtle rules as data; render them, never
  re-derive them>.
- `TweakSlot.tsx`, `store.ts`, `Tweaker.tsx`, `registry.ts` — plumbing. **Do not edit.**
- Picking: `?tw=section:id,…` (or `?tw=base`, `preset:<id>`, `<axis>:<value>`)
  overrides on load. The tweaker writes
  `data-tw-<section>="<id>"` on `<html>` for **CSS-only variants**. The surface
  carries `<hooks>` for scoping.
- Live, autosaving elements (<which>) arrive as nodes: place them, never rebuild them.

## Your folder — the ONLY place you write

- `<scaffold dir>/<author>/**` — registry `index.tsx` (`variants`, `presets`),
  stylesheet `<author>.css`. **Every id, class, custom property and keyframe starts
  with the full author id** (`<author>-…`) — another author may share your direction.
- An ownership table (author → direction → surfaces → sections) when there are more
  than two authors.
- **Never edit a file outside your folder.** To change a shipped subcomponent, **fork
  it into your folder**, keeping its write behaviour exactly (same handlers, same patch
  shapes). A missing slot or prop you cannot work around goes in your report.
- Scope every CSS rule to your own `data-tw-…="<author>-…"` value.

## Deliver

At least **<k> variants per section**, at least **<k+2>** for <the section the owner
complained about>. Each variant: a 1–3 word `label`, a one-line `note`. Plus **1–2 presets** (your full look), carrying the
axes they belong with (`axes: { look: "calm" }`). For <the complaint>, explore where it should live and how
much room it gets, including disappearing when it says nothing.

Keep every behaviour: autosave, keyboard, labels, screen-reader names, light **and**
dark, no horizontal overflow at a 400px viewport, `forced-colors` edges on every
borderless surface, `prefers-reduced-motion` on every spring.

## Verify

Playwright lives in `<dir>`, with **your own profile dir** — two Chromiums cannot
share one: `node import.mjs profiles/<author> <bundle>` once, then
`node shoot.mjs profiles/<author> <shots>/<author>/<name> "<recipe>" [--only …] [--dark] [--width 400]`
shoots every surface and edge record at full height; `probe.mjs` for scroll/radius/stack. Data: `<how to
get it>`; edge data: `<one-product / empty / read-only fixtures>`. Shots go under
`<shots dir>/<author>/`. Look at your own shots and iterate before reporting.

Checks on your own files only (the other authors are mid-edit):
`npx tsc --noEmit -p .` and `npx eslint <your folder>`.

## Report (compact)

A table: section → id → label → one-line pitch → shot paths. Then presets, what you
verified (dark, 400px, read-only, edge data), and anything that needed a shared-file
change you could not make. No code.
