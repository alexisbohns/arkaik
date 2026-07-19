# Icon Wobble

A subtle hand-drawn "wobble" applied to every lucide icon: a fixed distortion at
rest, animating ("boil") while an icon — or the item containing it — is hovered or
keyboard-focused. Shipped in issue #271 / PR #272.

This doc is both the reference for arkaik's implementation and a **portable recipe**
for reproducing the effect in another codebase.

---

## Why

arkaik's icons rendered as clean, mechanical lucide vectors. A static wobble gives
them a hand-drawn, "arkaik" character at rest; a hover/focus boil adds a small moment
of life on interaction — without any icon animating continuously and becoming
distracting. Constraints that shaped the design:

- **Static by default**, no per-frame work while idle.
- **Drop-in**: no changes at the ~130 icon call sites.
- **Deterministic**: the same icon wobbles identically everywhere; different icons differ.
- **Per-instance boil**: hovering one icon in a grid must not animate the others.
- **Accessible**: respect `prefers-reduced-motion`; keyboard focus behaves like hover.

## What it does (behaviour)

- Every `lucide-react` icon shows a fixed, non-animating wobble at rest.
- Hovering/focusing an icon **or its enclosing interactive item** (a link, button, or
  menu item) boils that icon — the noise field cycles for as long as it's active, then
  snaps back to the resting shape.
- Only the active icon boils; other icons of the same name stay static.
- Under `prefers-reduced-motion: reduce`, the static wobble stays and the boil is skipped.

## How it works

The effect is an SVG filter — `feTurbulence` (Perlin-ish noise) → `feDisplacementMap`
— applied to each icon via CSS `filter: url(#…)`. **Path data is never rewritten.**
"Static" is simply a filter whose attributes never change; "boil" cycles one attribute
(`seed`) while active.

It's a **global** mechanism, not a per-call-site wrapper. This is possible — and is the
whole trick — because every `lucide-react` icon renders as
`<svg class="lucide lucide-<name>" viewBox="0 0 24 24">`. That class is a stable global
hook, so CSS and a delegated listener reach every icon (including icons passed around as
`Record<…, LucideIcon>` config values) without touching call sites.

Pipeline:

1. **Build-time generator** (`scripts/generate/generate-icon-wobble.js`) scans the source
   tree for `lucide-react` imports, **renders each imported component** to read its
   authoritative runtime class, dedupes to the set of icon names in use, bakes a
   deterministic seed per name, and emits two committed artifacts (CI diff-gated):
   - `lib/wobble/wobble-registry.generated.ts` — `{ name, seed }[]`.
   - `app/wobble.generated.css` — `.lucide-<name> { filter: url(#wob-<name>) }` per name,
     plus `svg.lucide { overflow: visible }` and a `.no-wobble` opt-out.
2. **Filter registry** (`components/wobble/WobbleFilters.tsx`, a server component) mounts a
   hidden `<svg><defs>` once at the app root with **two** filters per name (see
   "per-instance boil" below). Static markup, SSR'd → no flash of un-wobbled icons.
3. **Static wobble** is then pure CSS (the generated rules) — zero JS, zero idle cost.
4. **Boil driver** (`lib/wobble/boil.ts`, wired by the client leaf
   `components/wobble/WobbleBoil.tsx`) attaches a **single** set of delegated document
   listeners and animates on interaction (below).

### Six decisions worth carrying to other projects

1. **Global filter + generated CSS beats a `<Wobble>` wrapper.** A wrapper can't cleanly
   wrap icons passed as component *values* through config maps, and would touch every call
   site. Keying off the library's rendered class covers all three usage patterns (direct
   JSX, conditional swaps, config-map renders) with zero call-site edits.
2. **Read the icon's real class by rendering it — don't derive it from the import name.**
   Aliases lie: `Loader2Icon` renders `lucide-loader-circle`; `CheckIcon` and `Check` both
   render `lucide-check`. The generator does `renderToStaticMarkup(<Icon/>)` and regexes
   out `lucide-<name>`, so aliases and numbered icons map correctly and dedupe by identity.
3. **Coordinate space is the make-or-break detail.** A CSS-referenced SVG filter operates
   in the target element's **CSS-pixel box**, not the icon's `viewBox`. With
   `objectBoundingBox` frequency the noise wavelength is tied to render size, which reads as
   fine *grain*, not a confident bend — and browser support is flaky. Fix: set
   `primitiveUnits="userSpaceOnUse"`. For lucide, every icon shares `viewBox="0 0 24 24"`,
   so the filter runs in that 24-unit space and a **single filter per name is automatically
   size-independent** — it reads proportionally identical from a 16px nav icon to a 96px
   hero icon, no per-size variants.
4. **Static shared filter + per-instance boil.** All instances of a name reference one
   shared `wob-<name>` filter for the static look (identical at rest, tiny DOM). But
   animating that shared filter's seed would boil *every* instance on screen. So each name
   also has a dedicated `wob-boil-<name>` filter; on hover, only the active icons are
   switched to it via inline `style.filter`, the driver cycles that filter, and the icons
   revert on leave. Both filters share the baked seed, so the switch is seamless.
5. **One delegated listener, direct DOM writes, no React state.** `mouseover`/`mouseout`/
   `focusin`/`focusout` bubble (unlike `mouseenter/leave`), so a single set of document
   listeners covers every icon. The boil is one `setInterval` per *active icon name* that
   `setAttribute("seed", …)` through a short ping-pong — no React reconciliation, and
   nothing runs while nothing is hovered.
6. **"Item hover" via the nearest interactive ancestor, not Tailwind `.group`.** Hovering a
   sidebar row or card should boil its icon even when the cursor is on the row's text. The
   driver resolves a "scope" = `target.closest(a[href], button, [role="menuitem"], …)` and
   falls back to the icon itself for a standalone glyph. `.group` was unusable (rarely
   present, and used as a *named* group where it is). Non-semantic clickable wrappers opt in
   with a `data-wobble-group` attribute.

### Boil control flow (per interaction)

`enter(icon)` → mark active, set `icon.style.filter = url(#wob-boil-<name>)`, start (or
ref-count into) that name's interval. `leave(icon)` → clear the icon's inline filter
(revert to the shared static filter); when no instance of the name is still active, stop
the interval and reset the boil filter's seed. A `prefers-reduced-motion` guard skips the
filter switch and the interval entirely (static wobble remains, since it's a filter, not
an animation).

## Tuning

Calibrated visually in Chromium (screenshot sweeps across sizes), expressed in the shared
24-unit viewBox space:

| Parameter | Value | Notes |
|---|---|---|
| `feTurbulence type` | `fractalNoise` | Smoother than `turbulence`; reads as ink, not spray. |
| `baseFrequency` | `0.06` | Cycles per viewBox unit (~1.4 waves across a 24u icon). |
| `feDisplacementMap scale` | `2` | Displacement in viewBox units (~8% of the icon). |
| `numOctaves` | `1` | One confident bend; higher adds surface roughness. |
| boil rate | `5` fps | `setInterval(200ms)`; spec range 4–6. |
| boil seed steps | `[0, 1, 2, 1]` | Ping-pong offsets from the base seed. |

Tuning lives in `lib/wobble/constants.ts`; changing it needs no regeneration (the generated
CSS only references filters — the geometry is in the component/constants).

## Gotchas & performance

- **SVG filters have a real raster cost per filtered element.** Static filters are cached
  (fine at idle), but very icon-dense views pay an initial paint cost, and containers that
  transform per frame (e.g. a pan/zoom graph canvas) re-rasterize filtered descendants.
  Mitigation ready if needed: `.react-flow__node svg.lucide { filter: none }`.
- **Continuously-animating icons** (a spinning `Loader2`) compound cost under a filter;
  add them to the `.no-wobble` opt-out if it shows.
- **Clipping**: displaced strokes can exceed the icon box — emit `svg.lucide { overflow: visible }`.
- **Cross-browser**: `primitiveUnits="userSpaceOnUse"` is why the effect is both
  size-independent *and* reliable; `objectBoundingBox` frequency was rejected for grain +
  WebKit fidelity issues.
- **Escape hatch**: any icon with class `no-wobble` (or an ancestor for group behaviour) is
  left alone.

## File map

| Path | Role |
|---|---|
| `scripts/generate/generate-icon-wobble.js` | Scan imports, render to read classes, bake seeds, emit artifacts. Wired into `npm run generate`. |
| `scripts/generate/lib/wobble-hash.js` | FNV-1a hash → `seed = hash(name) % 20`. |
| `lib/wobble/wobble-registry.generated.ts` | Generated `{ name, seed }[]`. |
| `app/wobble.generated.css` | Generated per-name filter rules + overflow + opt-out. |
| `lib/wobble/constants.ts` | Tuning + `no-wobble` / `data-wobble-group` names. |
| `lib/wobble/boil.ts` | Delegated hover/focus driver; scope resolution; per-instance boil. |
| `components/wobble/WobbleFilters.tsx` | Hidden `<defs>` of static + boil filters (server component). |
| `components/wobble/WobbleBoil.tsx` | Client leaf that wires the driver on mount. |
| `app/layout.tsx`, `app/globals.css` | Mount the filters/driver; import the generated CSS. |

## Reproducing this in another repo

1. **Confirm the icon library exposes a stable per-icon DOM hook.** lucide gives every icon
   `class="lucide lucide-<name>"`. Whatever your library uses (a class, a `data-` attr) is
   the anchor for both the generated CSS and the delegated listener.
2. **Write the generator.** Enumerate the icons actually used (scan imports), and get each
   one's *rendered* identifier — render the component and read the real class rather than
   transforming the import name. Bake a deterministic seed per name.
3. **Emit a filter registry component + a stylesheet.** Two filters per name (static +
   boil); CSS points `.<hook>-<name>` at the static filter. Set
   `primitiveUnits="userSpaceOnUse"` and know your icons' shared `viewBox` size — that's
   what makes one filter per name size-independent. If your icons *don't* share a viewBox,
   fall back to per-size-bucket filters.
4. **Mount the registry once** at the app root (SSR it to avoid a flash).
5. **Add the delegated boil driver**: one set of document listeners; resolve a hover scope
   (nearest interactive ancestor, else the icon); switch active icons to the boil filter and
   cycle its seed via a single interval; guard on `prefers-reduced-motion`.
6. **Tune** frequency/scale/octaves visually with before/after screenshots at your real
   icon sizes — the numbers above are a good starting point in 24-unit space.
