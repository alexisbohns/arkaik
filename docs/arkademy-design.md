# Arkademy design system — Material 3 Expressive, the Arkaik way

The Arkademy's cover (`/arkademy/business-model-canvas`) and its tour
(`/tour/<example>`) were redesigned in November 2026 on **Material 3
Expressive**, read through Arkaik's own material: a seed taken from the stones,
a playful brand face, the canvas as one connected shape. The owner approved
both ("insanely approved", "from far, the best"). This guide is the brief, the
principles and the rules behind them, so the next page — or the redesign of an
existing one — starts from what was decided instead of rediscovering it.

The explorations that led here, with the rejected directions and why, are
archived with screenshots outside the repo (`arkademy-explorations-26-11/`,
README index). This file records only the outcome.

**Status:** shipped with the cover and tour redesign. This file is private to
the repo: `docs/` serves an allowlist (`lib/utils/docs-visibility.ts`), and
`arkademy-design` is not on it.

---

## 1. The brief

**What it should feel like:** bold, warm and playful, never childish. A page
that has one loud thing and lets the rest be calm. Motion that feels like a
hand, not a timeline. Reading always comes first: the fun lives in titles,
shapes and motion, never in the text you have to read.

**Who it's for:** builders reading an example company's business, on a phone
or a wide screen, in light or dark, with a mouse, a keyboard, touch or a
screen reader.

**Where it comes from:**

| Source | What we took |
|---|---|
| Material 3 | Color roles from one seed (HCT tonal palettes), the type scale's roles, the shape scale, state layers, elevation, the focus indicator |
| M3 **Expressive** | Springs instead of easing curves, shapes that morph on press, connected button groups and shapes, larger and more varied corners, the shape library (cookies, clover, burst, flower), hero type |
| Arkaik | The seed (the stones' ember, `#E5552F`), the canvas and its nine numbered questions, the "show where it comes from" honesty (sourced notes, Simulation badges) |

---

## 2. Principles

These are the decisions the owner made while reviewing the work. Each one
corrected something, so read them as rules, not suggestions.

1. **One loud thing per screen.** The hero, the Continue button, or the turned
   tile is the loud thing. Everything around it stays calm. Saturated color
   everywhere reads as "Christmas lights": the owner rejected red question
   bubbles for exactly that reason.
2. **Two faces, two jobs.** The brand face (DynaPuff) is for display, headline
   and title roles: page titles, section titles, company names, the bar's
   "Arkademy". Everything a person reads is set in **Inclusive Sans**: body
   text, labels, subtitles, buttons and message bubbles. Never set a bubble,
   a paragraph or a digit in the brand face. A handwritten 1 reads as a 7, so
   every numeral uses the plain face (`.mx-numeral`).
3. **Conversational surfaces are soft and raised, not colored.** A message
   from the Arkademy is a light tonal surface at elevation level 1. Color is
   kept for meaning: an answer is tinted like the canvas block it fills.
4. **Connected shapes.** When pieces join into one thing (the canvas, a
   button group, a run of bubbles), the outer corners take the large radius
   and the joints the small one: 22px outside, 5px inside, 3px gaps. The
   group reads as one object.
5. **Lifting out = rounding up + a ring.** When one piece is singled out
   (hovered, focused or just revealed), it leaves the connected shape:
   - every corner springs to 24px
   - a 3px `--md-secondary` ring appears at a 3px offset
   - it rises above its neighbours
6. **Focus by receding, not by shouting.** Hovering one line of a card fades
   its other lines and blocks to 30%. The thing you point at stays as it was;
   the rest steps back.
7. **Rhythm, not reading time.** Staged entrances follow a fixed beat:
   **pop · pop-pop · pop · pop-pop**. They don't wait for reading speed. The
   owner found reading-time pauses "too slow, not fluid". A whole group
   arrives in about 2 seconds, and any press shows the rest at once.
8. **The reader drives.** Nothing advances on a timer. Every step has its own
   URL (reload, share, back and forward land on it), the server renders it,
   and it works without JavaScript.
9. **Chrome yields to content.** On the cover, the hero runs up under the
   header and contains it; there are no breadcrumbs. In an immersive flow
   like the tour, the shell header is not rendered at all, and the flow
   draws its own minimal bar (leave, who, where, theme).
10. **Say it once.** The tour had a "Question 3 of 9" kicker above a stepper
    that already showed the step; the owner had it removed. Don't add a
    label that repeats what an indicator already shows.
11. **Lists without bullets.** Items in a block start with a capital, sit
    flush with no indent, and are separated by spacing alone (6px in the
    canvas).
12. **Honest data, visible gaps.** A question left open on purpose shows as a
    dashed outline with "open: …" wording, never as an empty or hidden slot.

---

## 3. Turning it on

The system is CSS custom properties plus `.mx-*` classes, and all of it is
scoped. A page opts in with one wrapper:

```tsx
<div data-m3="expressive" data-scheme={…} data-font={…}>
  <style href="arkademy-m3x-fun-font" precedence="default">{M3_FONT_CSS}</style>
  …
</div>
```

and imports `app/arkademy/business-model-canvas/m3-expressive.css`.

- **Scope:** every token is set on `:root:has([data-m3="expressive"])`, so
  the header and Radix popovers that portal to `<body>` pick the scheme up
  too. Leave the page and nothing matches. Page-specific styling goes in its
  own sheet scoped to its own wrapper (the tour uses
  `[data-m3="expressive"][data-m3-tour]` in `tour/m3-tour.css`). Never fork
  the base sheet.
- **The app's tokens follow:** shadcn's `--background`, `--primary`,
  `--muted`, `--border`, `--ring` and the rest are remapped to their M3 roles
  inside the scope. Shared components (`ui/*`, `SourcedNote`, `ParagraphView`)
  therefore restyle without being touched.
- **Dark mode:** the same roles under `:root.dark:has(…)`. Build every
  surface from roles and never hard-code a color, and dark mode comes for
  free.
- **Review links:** `?scheme=` and `?font=` switch the scheme and the brand
  face, and the floating `SchemePicker` shows only on a review link: one with
  `?preview`, or one that already names a scheme or a face
  (`showsM3Preview`). Visitors get Ember · Vibrant and DynaPuff, and no
  picker.

> **To reuse outside `/arkademy`:** move `m3-expressive.css` and the
> `m3-*` modules to a shared place (e.g. `app/m3/` + `components/m3/`) and
> split the canvas and carousel rules (`.mx-item …`) into the Arkademy's own
> sheet. The tokens, type, shape, motion, buttons and chip are generic.

---

## 4. Foundations

### Color

One seed, the ember of the Travertine, Pumice and Lava stones (`#E5552F`, HCT
hue 33). The default scheme is **Ember · Vibrant**. The palettes were computed
once with a CAM16/L* solver, checked against M3's baseline, and hard-coded as
`--md-*` roles. Three preview schemes come from the same solver:

| Scheme | Character |
|---|---|
| **Ember · Vibrant** (default) | Brick-red primary, warm browns, peach surfaces |
| Ember · Expressive | Indigo primary, olive and green accents on the same warm surfaces |
| Ember · Tonal spot | Muted terracotta, the quietest ember |
| Basalt · Neutral | Greys from the Basalt stone, no hue |

**What each role is for:**

| Role | Used for |
|---|---|
| `--md-surface` | The page |
| `--md-surface-container` | Cards (a carousel item) and the app bar once scrolled |
| `--md-surface-container-lowest` (light) / `-high` (dark) | Soft raised surfaces: the asker's bubbles, the elevated button |
| `--md-primary-container` / `on-` | The hero, the tour's opening card, the value-proposition block |
| `--md-primary` / `on-` | The single loudest action (filled button, Continue), the end title, the backs of face-down tiles |
| `--md-secondary-container` / `on-` | Tonal buttons, the Back button, the carousel arrows, the "how it's made" blocks |
| `--md-secondary` | Focus rings and the lifted-tile ring |
| `--md-tertiary-container` / `on-` | Chips (Simulation), the "who it's for" blocks |
| `--md-inverse-surface` / `on-` | The prompt panel, the asker's avatar, the preview picker |
| `--md-outline` | Dashed "open on purpose" outlines, step pips ahead |
| `--md-on-surface-variant` | Secondary text: hints, captions, counts |

**Sides of the canvas** (`data-side` in the tour; the `[data-question]` groups
on the cover):

| Side | Blocks | Tint |
|---|---|---|
| make | key partners, activities, resources | secondary-container |
| offer | value propositions | primary-container |
| people | relationships, channels, segments | tertiary-container |
| money | revenue, cost | surface-container-highest |

An answer bubble takes its side's tint mixed 70% toward the surface, so it is
quieter than the tile itself.

**Contrast:** every pair the pages use passes WCAG AA in all four schemes,
light and dark. Measure it; don't eyeball it.

### Type

| Role | Face | Size (DynaPuff, tuned) | Class |
|---|---|---|---|
| Hero | brand | `clamp(3.75rem, 1.9rem + 7.2vw, 8.5rem) × 0.74`, lh 0.92 | `.mx-hero-title` |
| Display | brand | `clamp(2.75rem, …, 4.25rem) × 0.8` | `.mx-display` |
| Headline L | brand | `clamp(2.1rem, …, 3rem) × 0.8` | `.mx-headline-l` |
| Headline M | brand | 34px × 0.8 | `.mx-headline-m` |
| Title L | brand | 26px × 0.8 | `.mx-title-l` |
| Title M | brand | 20px × 0.8 | `.mx-title-m` |
| Subtitle | plain | 22 / 32 | `.mx-subtitle` |
| Lede | plain | 20 / 30 | `.mx-lede` |
| Body L | plain | 17 / 27 | `.mx-body-l` |
| Body M | plain | 14 / 21 | `.mx-body-m` |
| Body S | plain | 12 / 17 | `.mx-body-s` |
| Label L | plain | 14 / 20, 600 | `.mx-label-l` |
| Numerals | plain, tabular | — | `.mx-numeral` |

- **Brand face:** DynaPuff, weight 600, `wdth` 90, tracking −0.01em,
  `font-synthesis: none`. It is the only face preloaded; the other preview
  faces load with `preload: false`.
- **Per-face tuning:** each brand face has its own tuning row
  (`--mx-fs-hero`, `--mx-fs`, `--mx-lh`, `--mx-ls`, `--mx-fw`, `--mx-fvs`),
  because faces differ widely in width and x-height. Use the classes or
  these variables; never write a bare `font-size` with the brand face.
- **Plain face:** Inclusive Sans for everything else, including message
  bubbles. Weight carries emphasis: the question in a bubble is
  `clamp(1.4rem, …, 2.125rem)`, semi-bold, Inclusive Sans.
- **Text wrapping:** `text-wrap: balance` on titles; `pretty` on text inside
  a hugging container (bubbles), so the bubble fits lines that fill it.
- **Long sizes adapt:** a long paragraph gets a smaller size chosen on the
  server from its length (the end's `data-fit` s/m/l/xl), rather than
  overflowing the screen.

### Shape

| Token | Value | Typical use |
|---|---|---|
| `--md-shape-xs` | 4px | Done pips |
| `--md-shape-sm` | 8px | Chips, a pressed small button, bubble joints |
| `--md-shape-md` | 12px | — |
| `--md-shape-lg` | 16px | `--radius` (shadcn), a pressed medium button, picker options |
| `--md-shape-lg-inc` | 20px | A pressed large button |
| `--md-shape-xl` | 28px | Code panel, picker panel, bubble outer corners |
| `--md-shape-xl-inc` | 32px | Carousel cards |
| `--md-shape-xxl` | 48px | The hero's foot, the opening card, the prompt panel |
| `--md-shape-full` | pill | Buttons at rest, icon buttons, number badges |

Shapes in use:

- **Connected:** `--mx-joint: 5px`, `--mx-outer: 22px`, 3px gaps. The outer
  corners follow the layout, through container queries at 18rem and 48rem
  (one column / two columns / canonical canvas).
- **Lifted:** `--mx-lifted: 24px` on every corner, with a 3px secondary ring
  at a 3px offset and `z-index: 1`.
- **Expressive shapes:** `ExpressiveShape` draws cookie9 (the nine
  questions), cookie12, clover4, sunny (burst) and flower. They are
  decorative only (`aria-hidden`, `currentColor`), used for:
  - the hero's accent cluster
  - section marks (a clover above "Why")
  - company badges (one shape per example, `example-accents.ts`, kept from
    the card to the tour)
  - the asker's avatar
  - the backs of face-down tiles

### Elevation

The pages are mostly flat, built from tonal surfaces. Elevation level 1 is
used only where something must float off the surface: the asker's bubbles.

- light: `0 1px 2px rgb(0 0 0 / .3), 0 1px 3px 1px rgb(0 0 0 / .15)`
- dark: the same at `.5` and `.3`

Floating tools (the picker) use level 2.

### Motion

| Token | Value | For |
|---|---|---|
| `--mx-spring` / `-dur` | M3 expressive spatial (damping 0.8, stiffness 380) as CSS `linear()`, 510ms | Spatial moves: entrances, deals, pips morphing |
| `--mx-spring-fast` / `-dur` | M3 fast spatial (damping 0.6, stiffness 800), 440ms | Small and quick: pops, a press that morphs a shape, a lift |
| `--mx-effects` | `cubic-bezier(0.2, 0, 0, 1)` | Opacity and color (150–300ms): state layers, receding, fades |

- **Always behind `@media (prefers-reduced-motion: no-preference)`.** With
  reduced motion, content swaps at once or with a 160ms fade: no flips, no
  springs and no scroll-driven morphs.
- **Press = shape morph.** A button's pill corners tighten on `:active`
  (to 8, 16 or 20px by size); a button group's pressed half widens.
- **Entrances play once on mount**, and not when you step back onto a screen
  (`[data-enter="back"]`).
- **Tempo** (`lib/arkademy/tour-stage.ts`, `TOUR_CADENCE`): lead 100ms, a
  beat of 450ms between groups, 150ms within a group, each pop 440ms. Three
  answers finish in about 2.3s.
- **Word-by-word text:** 30ms per word, grouped into runs so the whole stays
  under 3.5s, each word fading in over 260ms. The next element follows one
  beat (450ms) later.
- **Scroll-driven:** carousel cards scale from 0.88 and round from 72px to
  32px as they enter and leave (`animation-timeline: view(inline)`), exactly
  as fast as the hand.

### Layout

- **Column:** `ARKADEMY_COLUMN`, which is `max-w-6xl` (72rem) with 16px
  gutters (24px from `sm`). The tour's column is 80rem, with 16, 24 and
  40px gutters at the 640 and 1024 breakpoints.
- **Full-bleed strips** (the gallery) run edge to edge, with their padding
  aligned to the column:
  `px-[max(1.5rem,calc((100%-72rem)/2+1.5rem))]` and the same `scroll-px`.
- **Breakpoints:** 640, 768, 1024 and 1280. Components that live in more
  than one width (the canvas, the deck) use **container queries**, not
  media queries.
- **Verified widths:** 400, 900 and 1440, with no horizontal page overflow
  at any of them.

### Focus and states

- **Focus ring:** `outline: 3px solid var(--md-secondary); outline-offset:
  2px`. It is visible, never removed, and replaces the app's box-shadow
  ring inside the scope.
- **State layers:** a `::before` filled with `currentColor` at 8% opacity
  on hover and 10–12% on press, over the same corners.
- **Disabled:** on-surface at 10% for the container and 38% for the
  content.
- **Programmatic focus targets** (the heading a new step moves focus to)
  carry `data-tour-focus` and no ring. The screen already shows where you
  are.

---

## 5. Components

| Class / component | What it is |
|---|---|
| `.mx-btn` + `--m` / `--l` + `--filled` / `--tonal` / `--elevated` / `--inverse` | Buttons. Height 40 / 56 / 72, a pill that tightens on press, a state layer, 20 / 24 / 28px icons. **One filled button per view.** |
| `.mx-group` | A connected button group (the carousel's arrows): two halves sharing a 4px seam with 8px inner corners; the pressed half widens from 64 to 76px |
| `.mx-icon-btn` (`--tonal`) | A 48px round icon button with a state layer; the tonal 40px one is the theme toggle |
| `.mx-chip` | 28px, tertiary-container: the Simulation badge |
| `.mx-hero` | The hero on primary-container, running under the 64px bar (`--mx-bar-height`), with an extra-extra-large foot |
| `[data-arkademy-bar]` + `HeroBarWatch` | The top app bar: hero-colored at rest, surface-container once the hero has scrolled away |
| `.mx-item` | A carousel card on surface-container, 32px corners, that owns the canvas rules |
| `ExampleGallery` | The horizontal gallery: snap, a connected arrow group, paging by card width |
| `CanvasGrid` + `CanvasLink` | The canvas and its CSS-only sentence↔block linking |
| `.mx-inverse`, `.mx-code` | The inverse panel (the prompt) and the code well inside it |
| `.mx-badge` (`--s` / `--m` / `--xl`) | A company badge: its shape plus the brand-face initial in `--ink` |
| `.mx-bubble--asker` / `--question` / `--hint` | The Arkademy's voice: soft and raised, Inclusive Sans |
| `.mx-bubble--answer` / `--open` / `--aside` | The company's voice: tinted by side; dashed for an open answer; a muted aside |
| `.mx-deck`, `.mx-tile` | The face-down deck and tiles that flip |
| `.mx-pips` | The step indicator: ahead (a ring), current (a long pill), turned (a ringed tile), done (a small tile in its side's color) |
| `.mx-tour-bottom` | The sticky bottom bar: Back (tonal), Continue (a 64/72 filled CTA), key hints |

---

## 6. Patterns

**The hero that contains the header.** The bar is sticky and drawn in the
hero's color, and the hero has a negative top margin of the bar's height, so
at the top they read as one block. With the title come the subtitle (plain
face), the actions (one large filled button and one medium elevated one) and
an accent cluster of expressive shapes that spring in once. There are no
breadcrumbs.

**A sectioned page.** Sections are 80–112px apart (`mt-20 sm:mt-28`). Each
one gets a headline-l or display title in `--md-primary` or on-surface, with
optionally an expressive shape above it as a mark. Prose stays in
`max-w-prose`, with a lede then body-l in on-surface-variant.

**A horizontal gallery.** Use `[overflow-x:auto] overscroll-x-contain
overscroll-y-auto`, never `.overflow-x-auto`: `globals.css` traps the
vertical wheel on that class. The scroller must be `relative`, or `sr-only`
spans escape it and widen the page. Cards snap to the start, sized
`w-[min(88%,52rem)]`.

**Linked reading (paragraph ↔ canvas).** Wrap both in `CanvasLink`; mark
sentences with `data-kind` and blocks with `data-block`, both carrying
`data-question`. The base rules tint and outline the linked pair. Inside
`.mx-item` (or the tour's end), the rest recedes to 30% and the block lifts.
It is all CSS `:has()`, with hover only where `(hover: hover)` and the same
on `:focus-within`, so it stays a server component.

**The conversation.** The asker sits on the left: an inverse-surface cookie
with a "?", then raised bubbles that join with small inner corners (8 / 10px)
and keep large outer ones (28 / 36px). The company answers on the right: its
badge, then answers stacked and mirrored, the first taking the tail. Each
answer's note opens with a click (`SourcedNote`). New bubbles are announced
through an `aria-live` region, and focus lands on the question.

**A step-by-step flow.**
- **Model:** a pure step model in `lib/arkademy/*`, with an address for
  every stage (`?step=N`, `&beat=canvas`, `?step=end`).
- **Navigation:** real links, plus `pushState`.
- **Keys:** Enter or Space on Continue, ←/→ between steps.
- **Focus:** moves to the new screen's heading.
- **Bars:** a top bar (leave, who, the stepper, the theme) and a sticky
  bottom bar (Back, plus Continue or the final choices).
- **Skip:** the first press while a screen is still arriving shows it
  whole; the next press moves on.

**Reveal by flipping.** Face-down tiles sit in the canvas layout; their backs
are primary with a dotted pattern, the slot number and a cookie. The current
tile is lifted, flips on the spring with a burst of its side's tint behind
it, then takes the lifted ring. The back is `aria-hidden`; the face is in the
accessibility tree.

**The end of a flow.** The paragraph flows in word by word, then the
interactive canvas, then the two choices, one beat apart. On desktop the
paragraph and canvas sit side by side; on a phone they stack and the view
follows the reveal until the reader scrolls.

---

## 7. Recipes

### A new page

1. Wrap the page in `data-m3="expressive"` and add the font `<style>`.
   Import the base sheet, and create a page sheet scoped to your own
   attribute if you need one.
2. Pick the one loud thing. Give it `--md-primary` (a filled button) or
   primary-container (a hero). Everything else uses surfaces, tonal
   containers or plain text.
3. Set titles with the brand-face classes and everything else with the
   plain classes. Grep for digits inside brand-face elements.
4. Use the shape scale tokens. If pieces join, connect them (outer 22px,
   joints 5px, 3px gaps).
5. Put motion behind `no-preference`. Use springs for spatial moves,
   `--mx-effects` for opacity and color, and stage entrances on the
   cadence (lead, beat, tight). Don't use timers that move the reader on.
6. Verify (§ 8).

### Redesigning an existing page

1. List its parts and map each one to a pattern above. A part without a
   pattern is a design decision to bring to the owner, not to improvise.
2. Remove chrome that repeats something: breadcrumbs under a hero, kickers
   above a stepper, bullets in lists that already have spacing.
3. Replace hard-coded colors and Tailwind palette classes with roles
   (`text-(--md-on-surface-variant)`, `bg-(--md-secondary-container)`).
   shadcn components follow on their own through the remapped tokens.
4. Keep the behavior: URLs, no-JS rendering, keyboard support and tests.
   Source-asserting test suites read JSX text, so update them truthfully
   when you move markup.

### Do / don't

| Do | Don't |
|---|---|
| Use soft raised surfaces for conversational UI | Put long text on primary or red |
| Use Inclusive Sans for everything you read | Use DynaPuff in bubbles, paragraphs or digits |
| Use one filled button per view | Put two filled buttons side by side |
| Recede the others to show the focus | Highlight by adding more color |
| Use a fixed rhythm (pop · pop-pop) | Use reading-time delays or auto-advance |
| Give items a capital and spacing | Use bullets and indents inside blocks |
| Use connected shapes for joined pieces | Use the same radius inside and out |
| Use roles and tokens | Use hex values or `bg-red-500` |
| Write `[overflow-x:auto]` on a `relative` scroller | Use `.overflow-x-auto` |

---

## 8. Verifying a page

- **Screenshots** with Playwright at 400, 900 and 1440, light and dark,
  plus a reduced-motion pass. For motion, shoot a frame sequence every
  100ms through one transition and look at it as a contact sheet.
- **Contrast:** measure AA on the pairs the page actually draws, in every
  scheme you ship.
- **Overflow:** `document.documentElement.scrollWidth - innerWidth` must be
  0 at 400px.
- **Fonts:** `document.fonts.check()` can return false for a face that did
  load (Cherry Bomb One did). Check by measured text width instead.
- **Stale dev server:** `next dev` serves old code without warning. Before
  trusting a shot, `curl` the page and grep for what you just changed. If
  it's missing, kill the server, `rm -rf .next/dev` and restart.
- **No JavaScript:** load the page with JS off. Every step and section must
  still render.

---

## 9. Where things live

| File | Holds |
|---|---|
| `app/arkademy/business-model-canvas/m3-expressive.css` | Roles for the 4 schemes × light and dark, shape, motion, type, the bar, the hero, buttons, chip, carousel and canvas rules |
| `app/arkademy/business-model-canvas/tour/m3-tour.css` | The tour: stage, bars, pips, bubbles, deck and tiles, the end, motion |
| `components/arkademy/m3-fonts.ts`, `m3-font-options.ts` | The faces and `M3_FONT_CSS` (the preview face list) |
| `components/arkademy/m3-schemes.ts`, `SchemePicker.tsx` | The preview schemes and the picker |
| `components/arkademy/ExpressiveShape.tsx`, `example-accents.ts` | The shape library and each company's badge |
| `components/arkademy/HeroBarWatch.tsx`, `ArkademyHeaderSlot.tsx` | The bar's color on scroll; dropping the shell header on the tour |
| `lib/arkademy/tour-stage.ts` | The step model, URLs, cadence and the end's fit (pure, tested) |
| `lib/arkademy/canvas-link.ts` | The linked-hover rules, generated per question |

**Known debts:** the four non-default brand faces and three non-default
schemes exist only for review links. Drop them once nobody compares any more.
