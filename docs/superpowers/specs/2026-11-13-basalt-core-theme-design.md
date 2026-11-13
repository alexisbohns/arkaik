# Basalt core theme — the first step from stones to Material 3 Expressive

**Date:** 2026-11-13
**Status:** approved design, built for review in the `~/code/arkaik-basalt`
worktree (branch `feat/basalt-core-theme`), shipped as a stack once approved.

## Why

The Arkademy now runs on Material 3 Expressive (`docs/arkademy-design.md`).
This is the first test of moving the **core app** onto the same system,
starting with the cheapest layer to change and the easiest to judge: the
**palette** and the **fonts**. The stone skins (`docs/superpowers/specs/2026-11-08-stone-skins-design.md`)
are deprecated by this move; the library is kept as a standalone kit to
re-home elsewhere (probably Ariko).

## Decisions (owner, 2026-11-13)

1. The core app uses **Basalt · Neutral** by default — the grey scheme already
   computed for the Arkademy's preview picker. It must stay **less vibrant than
   the Arkademy** (Ember · Vibrant is the Arkademy's, and stays there).
2. **Inclusive Sans replaces Geist Sans.** Geist Mono stays for code. No brand
   face (DynaPuff) in the core app in this step.
3. **Status and changelog colors** move off Tailwind's raw hues onto colors
   that belong to the new palettes.
4. The active sidebar row's stone chip becomes an **expressive badge shape:
   cookie12**.
5. **The stone effect goes.** No stone textures, no stone picker, nothing in
   the app reads a stone token. Basalt is the only scheme: Settings → Display
   loses the Stones section and gains nothing in its place.
6. The stone library moves to **`kits/stones/`**: self-contained, imported by
   nothing, with a README, ready to lift into Ariko.
7. Delivered as a **review build** first (worktree + dev server), shipped as a
   stack after review.

**Out of scope for this step:** shape and radius (the app keeps `--radius:
0.5rem`), motion, M3 components (`.mx-btn` and friends), species and platform
colors (data model amber, endpoint teal, platform dots), quality severity
colors, other raw Tailwind hues in the app (acceptance matrix, health cards…).
The hidden stone in the home page's ASCII terrain (`lib/background/stone-reveal.ts`)
**stays**: it is a brand easter egg, not a skin.

## Design

### 1. The Basalt role layer — `app/m3/basalt.css`

A new sheet, imported by `app/globals.css`, holds the M3 roles of Basalt ·
Neutral on `:root` (light) and `.dark` (dark). The values are the
`basalt-neutral` block of `app/arkademy/business-model-canvas/m3-expressive.css`,
copied verbatim (they came from the same CAM16/HCT solver; don't retune them).

It then maps the app's shadcn tokens onto those roles. The mapping is the one
the Arkademy sheet already uses, so the HSL triplets are copied from its
`basalt-neutral` blocks, with additions for the tokens the Arkademy didn't need:

| shadcn token | M3 role |
|---|---|
| `--background` | surface |
| `--foreground`, `--card-foreground`, `--popover-foreground` | on-surface |
| `--card` | surface-container-low |
| `--popover` | surface-container |
| `--primary` / `-foreground` | primary / on-primary |
| `--secondary`, `--accent` / `-foreground` | secondary-container / on-secondary-container |
| `--muted` / `-foreground` | surface-container-high / on-surface-variant |
| `--border` | outline-variant |
| `--input` | outline |
| `--ring` | secondary |
| `--destructive` / `-foreground` | error / on-error |
| `--sidebar-background`, `--sidebar` | surface-container-low |
| `--sidebar-foreground` | on-surface-variant |
| `--sidebar-primary` / `-foreground` | primary / on-primary |
| `--sidebar-accent` / `-foreground` | secondary-container / on-secondary-container |
| `--sidebar-border` | outline-variant |
| `--sidebar-ring` | secondary |

The old zinc values in `globals.css`'s `:root` and `.dark` blocks are removed;
`basalt.css` is the single source. `--radius` stays `0.5rem` in `globals.css`.

**The Arkademy is untouched.** Its rules are keyed on
`:root:has([data-m3="expressive"])`, more specific than `:root`, so on its
pages Ember · Vibrant still wins, light and dark. This is verified, not assumed.

**The installed app's title bar** (`viewport.themeColor` in `app/layout.tsx`)
follows the new surfaces: `#F9F9F9` light, `#131315` dark.

### 2. Fonts

- Inclusive Sans moves from `components/arkademy/m3-fonts.ts` to
  `lib/fonts.ts` (where `gochiHand` already lives), declared once with
  `variable: "--font-inclusive-sans"`. `m3-fonts.ts` imports it from there, so
  the face is fetched once and the Arkademy's preview faces stay out of the
  root layout.
- `app/layout.tsx` puts `inclusiveSans.variable` on `<html>` instead of
  `GeistSans.variable`; `@theme inline` sets
  `--font-sans: var(--font-inclusive-sans)`. Geist Mono is unchanged.
- Nothing else changes in type: sizes, weights and the markdown styles stay.

### 3. Status and changelog colors

Eight color families, all taken from the expressive palettes (their hue and
chroma come from the Basalt, Ember · Expressive and Ember · Tonal spot roles),
with chroma capped at 40 so they stay calm next to Basalt. Each family is an
M3 tonal palette (generated with `@material/material-color-utilities`); the
app uses three tones per family:

| Family | Hue / chroma | Light (T40) | Dark (T80) | Minimap (T60) | Comes from |
|---|---|---|---|---|---|
| neutral | 274 / 8 | `#5D5E67` | `#C6C6D0` | `#8F909A` | Basalt secondary |
| slate | 271 / 16 | `#585E72` | `#C0C6DD` | `#8A90A6` | Basalt tertiary |
| indigo | 273 / 40 | `#485B99` | `#B5C4FF` | `#7B8ED0` | Ember · Expressive primary |
| ember | 33 / 36 | `#8F4B39` | `#FFB4A1` | `#CB7C67` | Ember · Tonal spot primary |
| plum | 330 / 33 | `#7B4F7A` | `#EAB6E7` | `#B181AF` | new hue, same chroma band |
| green | 153 / 32 | `#3A6844` | `#A0D3A7` | `#6C9C73` | Ember · Expressive tertiary |
| amber | 68 / 32 | `#805520` | `#F5BC7D` | `#B9874D` | Ember · Vibrant tertiary |
| red | 25 / 84 | `#BA1A1A` | `#FFB4AB` | `#FF5449` | M3 error |

Every light tone is ≥ 5.8:1 on surface and surface-container-low; every dark
tone is ≥ 10:1. All pass WCAG AA as text.

**Which status takes which family:**

| Status | Family | (was) |
|---|---|---|
| idea, archived | neutral | gray-400 |
| discovery | ember | violet-400 |
| backlog | slate | blue-400 |
| development | indigo | blue-500 |
| releasing | plum | purple-500 |
| live | green | green-500 |

| Decision status | Family | (was) |
|---|---|---|
| proposed | neutral | gray-400 |
| approved | indigo | blue-400 |
| enacted | green | green-500 |
| rejected | red | red-400 |
| deprecated | amber | amber-500 |
| superseded | plum | violet-400 |

| Changelog mark | Family | (was) |
|---|---|---|
| shipped mark (`DeliverableTimeline`) | green | green-500 tile |
| forge tile (`DeliverableHoverCard`'s `FORGE_TILE`) | plum | purple-500 tile |

**How they're wired.** `basalt.css` defines `--tone-<family>` per theme (T40
on `:root`, T80 on `.dark`). `globals.css`'s `@theme inline` registers each as
`--color-tone-<family>: var(--tone-<family>)`, so Tailwind gives
`text-tone-green`, `bg-tone-green`, `stroke-tone-green`, `bg-tone-green/10`.
The style maps then read:

- `STATUS_STYLES[s]`: `badge: text-tone-X`, `dot: bg-tone-X`, `stroke:
  stroke-tone-X`, `surface: bg-tone-X/10`.
- `DECISION_STATUS_STYLES[s]`: `badge: text-tone-X`, `dot: bg-tone-X`.
- `DECISION_STATUS_TILE[s]` and the two changelog tiles: `bg-tone-X/10
  text-tone-X` (the dark variant comes from the variable, so no `dark:` class).
- `STATUS_MINIMAP_FILL`: the T60 hex (SVG fill attributes can't read a CSS
  variable), with the family named in the comment.

Whole literal class strings, as `node-styles.ts` already requires (Tailwind
reads source text).

### 4. The menu badge — cookie12

`stones.css`'s active-row chip is replaced by the same geometry in
`app/m3/basalt.css`: a 24px `::before` at `left: 4px`, vertically centered,
behind the leading icon of an active `menu-button` / `menu-sub-button` that
starts with an svg. It is now:

- painted `var(--md-secondary-container)`,
- cut to the **cookie12** outline with `mask` / `-webkit-mask`: a data-URI SVG
  of `EXPRESSIVE_SHAPES.cookie12` (`components/arkademy/ExpressiveShape.tsx`,
  copied as a literal; a comment names its source),
- with the icon stroked in `var(--md-on-secondary-container)` instead of the
  `url(#stone-icon)` gradient.

The 24px badge still centers on the 16px icon both in the expanded sidebar and
on the collapsed rail. With forced colors, the badge falls back to
`ButtonFace` with no mask, as the stone chip did.

Sidebar rows' `rounded-[min(var(--stone-radius),15px)]` becomes `rounded-md`.

### 5. The stones leave the app

| Was | Becomes |
|---|---|
| `Button` variant `stone` (~14 call sites) | `default` (Basalt primary) |
| `Button` variant `stone-secondary` | `secondary` (secondary-container) |
| the `rounded-[var(--stone-radius)]` compound variant | removed |
| `Checkbox` checked/indeterminate stone fill | `bg-primary text-primary-foreground` |
| `SectionCreateMenu`'s split seam on `--stone-primary-ink` | `--primary-foreground` |
| `app/layout.tsx`: `data-stone-*`, the boot script, `<StoneDefs />` | removed |
| Settings → Display's Stones section (`StonePicker`) | removed, with its explanatory comment |
| `app/stones.css`, `app/stones.generated.css` and their imports | removed from `app/` |
| `generate-stones.js` in `npm run generate`, the CI drift paths, `test:stones` / `test:stone-preferences` in `package.json` and CI | removed |

Comments that explained something by the stones (`button.tsx`, `checkbox.tsx`,
`RightRail.tsx`, `m3-expressive.css`'s seed note) are reworded to stand alone.
The Arkademy's seed comment keeps naming the ember tone it came from.

### 6. The kit — `kits/stones/`

Everything the stones were, moved (with `git mv` where the file survives as
is), and nothing in the app imports it:

```
kits/stones/
  README.md                 what it is, how to build it, the history (link to the 2026-11-08 spec), the move to Ariko
  data/stones.js            ← scripts/generate/lib/stones.js
  generate.js               ← scripts/generate/generate-stones.js, writing into kits/stones/dist/
  dist/svg/<id>.svg         ← public/stones/*.svg
  dist/stones.generated.css ← app/stones.generated.css
  dist/stones-registry.generated.ts ← lib/stones/stones-registry.generated.ts
  css/stones.css            ← app/stones.css (roles, the stone surface, the old chip)
  src/preferences.ts        ← lib/stones/preferences.ts
  src/useStonePreferences.ts ← lib/hooks/useStonePreferences.ts
  src/StonePicker.tsx       ← components/settings/StonePicker.tsx
  src/StoneDefs.tsx         ← components/stones/StoneDefs.tsx
  tests/stones.test.js      ← tests/app/stones.test.js
  tests/stone-preferences.test.js ← tests/app/stone-preferences.test.js
```

The kit's imports are rewritten to relative paths inside the kit where they
point at other kit files; imports of the app's own modules (`@/components/ui/*`,
`@/lib/utils`) stay as they are and the README lists them as the kit's
dependencies. `kits/` is excluded from `tsconfig.json`, ESLint and Tailwind's
source scan, so a kit nobody builds can't break the app's CI. Its tests still
run by hand: `node kits/stones/tests/stones.test.js`.

## Verification

- `npm run generate` leaves the tree clean; `npx tsc --noEmit`, `npm run lint`
  and every test script CI runs pass.
- Source-asserting suites that read the touched files are updated truthfully.
- Playwright, at 400 / 900 / 1440, light and dark: projects list, a project's
  map, the delivery board, the decisions page, the changelog, Settings →
  Display, and the Arkademy cover (to prove Ember still wins there).
- Contrast is measured, not eyeballed, on the status text pairs as drawn.
- Fonts: body text measures as Inclusive Sans (canvas width, not
  `document.fonts.check()`).
- `grep -rn "stone" app components lib` returns only the ASCII terrain's
  stone, the Arkademy's seed note and unrelated words (milestone).
