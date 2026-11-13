# Stones — a parked kit

Arkaik's stone skins: twelve stone textures (six light, six dark) that painted
the app's special actions, checkboxes and active sidebar rows from November
2026 until the move to Material 3 Expressive's Basalt palette
(`docs/superpowers/specs/2026-11-13-basalt-core-theme-design.md`). The design
behind them is `docs/superpowers/specs/2026-11-08-stone-skins-design.md`.

**Status:** deprecated in Arkaik and imported by nothing. Kept whole so it can
move to its next home (probably Ariko) as a standalone kit.

## What's here

| Path | What it is |
|---|---|
| `data/stones.js` | The twelve stones: base color, tones, ink, polish, icon gradient, the SVG texture builder. Values were tuned by eye — never retune casually. |
| `generate.js` | Builds `dist/` from `data/`: `node kits/stones/generate.js`. |
| `dist/svg/<id>.svg` | One texture tile per stone. Serve this folder at `/stones/` (the CSS points there). |
| `dist/stones.generated.css` | Per-stone tokens (`--stone-light-*`, `--stone-dark-*`), scoped by `:root[data-stone-light\|dark="<id>"]`; the defaults (Calacatta + Onyx) also apply with no attribute. |
| `dist/stones-registry.generated.ts` | The stones' list and defaults, for a picker. |
| `css/stones.css` | Roles (primary / secondary stone per theme), the `.stone` surface, the active sidebar row's chip, forced-colors fallbacks. |
| `src/preferences.ts` | The reader's choice (`arkaik:stones` in localStorage): parsing, applying to `<html>`, and an inline boot script for before first paint. |
| `src/useStonePreferences.ts` | The React hook over it. |
| `src/StonePicker.tsx` | The Settings picker, with light and dark previews. |
| `src/StoneDefs.tsx` | The shared `#stone-icon` SVG gradient icons are stroked with. |
| `tests/*.test.js` | Contrast floors per stone; preference parsing and the boot script. Run with `node kits/stones/tests/<name>.test.js`. |

## Wiring it into a host (what Arkaik did)

1. Import `dist/stones.generated.css` then `css/stones.css`; serve `dist/svg/` at `/stones/`.
2. Put `data-stone-light` / `data-stone-dark` on `<html>`, run `stoneBootScript()` in `<head>`, render `<StoneDefs />` once.
3. Give buttons a stone variant: `stone stone-primary` / `stone stone-secondary`, radius `var(--stone-radius)`.

## Dependencies on the host

`src/StonePicker.tsx` expects the host's shadcn/ui `Button` (with `default` and
`secondary` variants), `cn` from `@/lib/utils`, and lucide-react. The rest is
plain TypeScript, CSS and Node.
