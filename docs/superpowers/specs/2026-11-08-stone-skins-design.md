# Stone skins — design

Arkaik gets a material accent: natural stone textures, grown from layered
Perlin noise, that carry the special actions, the active sidebar row and
checked checkboxes. The exploration lives in the "Arkaik Gem Accents"
artifact (Round 5 is the source of truth for every value below).

## Decisions

- **Readers pick.** Every stone ships. Each reader chooses a light stone, a
  dark stone and a radius, saved in their browser. Default: **Calacatta +
  Onyx**, radius **12px**.
- **Special actions only.** Ordinary buttons stay zinc. The stone appears on a
  chosen set of actions, every active sidebar row, and every checked checkbox.
- **Radius touches stone elements only**: stone buttons and sidebar menu rows.
  Arkaik's global `--radius` is untouched.
- **The picker lives in Project Settings → Display**, labelled as applying to
  every project in this browser.

## The stones

Light stones: Carrara, Calacatta, Rosa, Rose Quartz, Travertine, Pumice.
Dark stones: Onyx, Lava, Nero, Basalt, Verde, Amethyst.

Each stone has: a texture tile (an SVG of `feTurbulence` layers, contour
veins, drawn veins or facets), a label ink (`#FFFFFF` on dark stones,
`#18181B` on light ones), an icon tone (a colour, or a 3-stop gradient), a
`polish` flag, and two contrast floors measured on what is drawn: label ≥ 4.5:1,
icon ≥ 3:1 (light stones' icon against white, dark stones' against `#18181B`). On the active sidebar row an icon sits on its own stone rather than the page, where Travertine's and Pumice's #EE5E39 falls to about 2.7:1; that is accepted, because the row's label carries the meaning and the orange is Lava's exact accent.

## Roles

A stone's role depends on the theme:

| | Light theme | Dark theme |
|---|---|---|
| **Primary** (special-action button, checkbox) | dark stone | light stone |
| **Secondary** (secondary button, sidebar row, its icon) | light stone | dark stone |

The darker stone always carries the primary action on a light surface and the
lighter one on a dark surface, because that is where each gives the most
contrast.

## Architecture

### Generated artifacts (`npm run generate`, CI drift-checked)

`scripts/generate/generate-stones.js` reads the stone definitions in
`scripts/generate/lib/stones.js` (data + the SVG builder, ported verbatim from
the artifact) and writes:

- `public/stones/<id>.svg` — one texture tile per stone.
- `app/stones.generated.css` — per-stone tokens, scoped by attribute:
  `:root[data-stone-light="calacatta"] { --stone-light-fill; --stone-light-ink;
  --stone-light-icon-1..3; --stone-light-polish }`, and the same for
  `data-stone-dark` with `--stone-dark-*`.
- `lib/stones/stones-registry.generated.ts` — `{ id, name, side, swatch }[]`
  for the picker, plus `DEFAULT_STONES`.

### Hand-written CSS (`app/stones.css`)

- Role mapping: `:root { --stone-primary-*: var(--stone-dark-*);
  --stone-secondary-*: var(--stone-light-*) }` and the reverse under `.dark`.
- Material: a dark stone on a light surface is raised slightly (inset top light,
  inset bottom shade, small drop shadow); a light stone on a light surface sits
  flush (1px hairline, near-zero shadow); polished stones get a top sheen.
- `--stone-radius` defaults to `12px` on `:root`.

### Icon tone

Stone icons stroke with an SVG gradient paint server, `url(#stone-icon)`,
defined once in a hidden `<svg>` (`components/stones/StoneDefs.tsx`, mounted
in the root layout like `WobbleFilters`). Its three stops read
`var(--stone-secondary-icon-1..3)`, so the tone follows the skin and the theme
with no JavaScript. Icons get the tone, not the texture: a 1.5px stroke at 16px
cannot show texture.

### Skin selection

`<html>` carries `data-stone-light`, `data-stone-dark` and
`style="--stone-radius: …"`. The server renders the defaults. A tiny inline
script in `<head>` (before paint) applies the stored choice, so there is no
flash. `useStonePreferences` (global, `localStorage` key `arkaik:stones`)
follows the `useDisplayPreferences` store pattern: SSR-safe, survives a
throwing `localStorage`, and replaces an unknown id or out-of-range radius with
its default key by key. Writing a preference updates the attributes on `<html>`
immediately.

## Components

- **Button** (`components/ui/button.tsx`): variants `stone` (primary role) and
  `stone-secondary` (secondary role): stone fill, stone ink, material rules,
  `rounded-[var(--stone-radius)]`, brightness lift on hover. Existing sizes,
  focus ring and disabled state unchanged.
- **Applied to** `stone`: Create project, the per-section create split button,
  Create node (Delivery and Library headers, New node form), Create acceptance,
  Create decision, Publish (PublishDialog), Import into arkaik (public
  snapshot), Copy prompt (the Generate flow's main action), Start building
  (landing). `stone-secondary`: Generate with AI, which sits beside Create
  project on the Projects page.
- **Sidebar** (`components/ui/sidebar.tsx`, `SidebarMenuButton` and
  `SidebarMenuSubButton`): active row shows the secondary stone at 78% opacity
  with a hairline (`rgb(0 0 0 / .06)` light, `rgb(255 255 255 / .07)` dark),
  radius `min(var(--stone-radius), 15px)`, and its icon stroked with
  `url(#stone-icon)`. The Docs sidebar inherits it.
- **Checkbox** (`components/ui/checkbox.tsx`): checked and indeterminate fill
  with the primary stone and its ink.

Not built: the outlined stone button and stone icon chips (no chosen action
needs them).

## Picker

A **Stones** section in `DisplayPreferencesPanel`: light-stone and dark-stone
swatch buttons (`aria-pressed`), a radius slider (0–18px, 18 shown as "pill"),
a live preview of a light pane and a dark pane (a `.dark` wrapper) each showing
the primary button, the secondary button and an active sidebar row, and a
"Reset to default" link shown only when the choice differs from the default.

## Testing

- `tests/app/stones.test.js`: every stone's label and icon floors pass; the
  registry ids match the generated CSS selectors and the SVG files; generation
  is deterministic.
- `tests/app/stone-preferences.test.js`: the preference parser degrades key by
  key (unknown id, bad radius, non-object, throwing storage).
- CI drift check covers `public/stones`, `app/stones.generated.css` and
  `lib/stones/stones-registry.generated.ts`.
- Visual check in Playwright for parts 2 and 3 (light and dark, default and a
  changed skin).

## Shipping

A stack of three parts:

1. **Stone tokens**: generator, textures, tokens, role mapping, `StoneDefs`,
   default attributes, CI drift entry, tests. No visible change; no Lab Note.
2. **Stones on special actions**: button variants, sidebar row, checkbox, the
   chosen actions. Lab Note.
3. **Pick your stones**: preferences hook, boot script, the Display picker.
   Lab Note.
