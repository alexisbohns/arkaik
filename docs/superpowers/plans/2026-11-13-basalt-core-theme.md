# Basalt Core Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the core app off the stone skins and zinc/Geist onto Material 3 Expressive's Basalt · Neutral palette and Inclusive Sans, with palette-native status colors, a cookie12 menu badge, and the stone library parked in `kits/stones/`.

**Architecture:** One new sheet, `app/m3/basalt.css`, owns the M3 roles (copied from the Arkademy's `basalt-neutral` block), the shadcn token mapping, the eight status tone families and the menu badge. `globals.css` imports it and registers the tones with Tailwind (`text-tone-green`…). The Arkademy's own `:root:has([data-m3="expressive"])` rules outrank `:root`, so Ember keeps winning there. Stones are unwired from the app, then moved wholesale into `kits/stones/`, which nothing imports and the app's tooling ignores.

**Tech Stack:** Next.js 16 (App Router), Tailwind CSS v4 (`@theme inline`), shadcn/ui, `next/font/google`, plain Node test scripts (`node:assert/strict`, no framework).

**Spec:** `docs/superpowers/specs/2026-11-13-basalt-core-theme-design.md` — read it first.

**Working directory for every command:** `/Users/alexis/code/arkaik-basalt` (branch `feat/basalt-core-theme`). Dependencies are installed.

**Repo conventions you must follow:**
- Tests are plain Node scripts: `node tests/app/<name>.test.js`, each printing `✓`/`✗` lines and exiting non-zero on failure. Every script gets a `package.json` entry (`test:<name>`) and a CI step in `.github/workflows/ci.yml`.
- Tailwind reads source text: always write whole literal class strings (`text-tone-green`), never build them from pieces.
- Lint (`npm run lint`) and `npx tsc --noEmit` must pass after each task. CI also runs `npm run generate` then `git diff --exit-code` on generated artifacts.
- Commit messages end with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01DcsxQzN8fDvwUBsS9v7zuw
  ```

---

## File structure

| File | Responsibility | Task |
|---|---|---|
| `app/m3/basalt.css` (new) | Basalt M3 roles, shadcn mapping, status tones, the cookie12 menu badge | 1, 2, 3 |
| `app/globals.css` | imports `basalt.css`, registers tone colors and the sans font with Tailwind; loses the zinc blocks and the stone imports | 1, 2, 4 |
| `lib/font-sans.ts` (new) | declares `inclusiveSans` (with a CSS variable) alone, so the root layout preloads no other face; `lib/fonts.ts` is untouched | 1 |
| `components/arkademy/m3-fonts.ts` | imports `inclusiveSans` from `lib/font-sans.ts` instead of declaring it | 1 |
| `app/manifest.ts` | `background_color` / `theme_color` follow the Basalt light surface | 1 |
| `app/layout.tsx` | Inclusive Sans on `<html>`, Basalt `themeColor`; loses every stone hook | 1, 4 |
| `tests/app/basalt-theme.test.js` (new) | parity with the Arkademy's Basalt, contrast of tones, the status maps, the badge shape, no stone left in the app | 1–5 |
| `components/graph/nodes/node-styles.ts` | status / decision maps on `tone-*` classes, minimap hexes | 2 |
| `components/journal/DeliverableHoverCard.tsx`, `DeliverableTimeline.tsx` | changelog tiles on tones | 2 |
| `components/ui/sidebar.tsx` | row radius off `--stone-radius` | 3 |
| `components/ui/button.tsx`, `checkbox.tsx`, 12 call sites, `SectionCreateMenu.tsx`, `DisplayPreferencesPanel.tsx` | stones unwired | 4 |
| `scripts/generate/index.js`, `package.json`, `.github/workflows/ci.yml` | stone generation and tests leave the app's pipeline | 4 |
| `kits/stones/**` (moved) | the standalone stone kit + README | 5 |
| `tsconfig.json`, `eslint.config.mjs`, `app/globals.css` | ignore `kits/` | 5 |

---

### Task 1: The Basalt role layer and Inclusive Sans

**Files:**
- Create: `app/m3/basalt.css`
- Create: `tests/app/basalt-theme.test.js`
- Modify: `app/globals.css` (lines 1–69 and the `@theme inline` block's `--font-sans`)
- Create: `lib/font-sans.ts`
- Modify: `app/manifest.ts`
- Modify: `components/arkademy/m3-fonts.ts:1-25`
- Modify: `app/layout.tsx` (font imports, `<html className>`, `viewport.themeColor`)
- Modify: `package.json` (scripts), `.github/workflows/ci.yml` (one step)

- [ ] **Step 1: Write the failing test**

Create `tests/app/basalt-theme.test.js`:

```js
#!/usr/bin/env node

/**
 * The core app's Basalt theme (docs/superpowers/specs/2026-11-13-basalt-core-theme-design.md).
 *
 * app/m3/basalt.css must carry the Arkademy's Basalt · Neutral roles verbatim
 * (they come from one HCT solver run; a hand edit in one copy would drift), and
 * globals.css must hand Tailwind the Basalt tokens and Inclusive Sans instead
 * of the old zinc set and Geist. Later sections cover the status tones, the
 * menu badge and the stones' departure.
 */

const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

/** The declarations of the first rule whose selector is exactly `selector`. */
function block(css, selector) {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start !== -1, `no "${selector} {" rule`);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  const vars = {};
  for (const m of css.slice(open + 1, close).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) vars[m[1]] = m[2].trim();
  return vars;
}

function luminance(hex) {
  return [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((u) => (u <= 0.03928 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4))
    .reduce((sum, u, i) => sum + u * [0.2126, 0.7152, 0.0722][i], 0);
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (hi + 0.05) / (lo + 0.05);
}

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures++;
    console.error(`  ✗ ${name}\n    ${error.message}`);
  }
}

const basalt = read("app/m3/basalt.css");
const globals = read("app/globals.css");
const arkademy = read("app/arkademy/business-model-canvas/m3-expressive.css");
const LIGHT = block(basalt, ":root");
const DARK = block(basalt, ".dark");
const ARK_LIGHT = block(arkademy, ':root:has([data-m3="expressive"][data-scheme="basalt-neutral"])');
const ARK_DARK = block(arkademy, ':root.dark:has([data-m3="expressive"][data-scheme="basalt-neutral"])');

console.log("basalt theme — roles and fonts");

for (const [theme, mine, theirs] of [["light", LIGHT, ARK_LIGHT], ["dark", DARK, ARK_DARK]]) {
  test(`${theme}: every Arkademy Basalt role and shadcn token is copied verbatim`, () => {
    const names = Object.keys(theirs);
    assert.ok(names.length > 60, `only ${names.length} declarations read from the Arkademy block`);
    for (const name of names) assert.equal(mine[name], theirs[name], `${name}`);
  });

  test(`${theme}: the tokens the Arkademy never set are mapped to their roles`, () => {
    for (const name of [
      "--destructive", "--destructive-foreground",
      "--sidebar-background", "--sidebar-foreground", "--sidebar-primary", "--sidebar-primary-foreground",
      "--sidebar-accent", "--sidebar-accent-foreground", "--sidebar-border", "--sidebar-ring", "--sidebar",
    ]) assert.ok(mine[name], `${name} missing`);
    assert.equal(mine["--sidebar-background"], mine["--card"]);
    assert.equal(mine["--sidebar-foreground"], mine["--muted-foreground"]);
    assert.equal(mine["--sidebar-primary"], mine["--primary"]);
    assert.equal(mine["--sidebar-accent"], mine["--secondary"]);
    assert.equal(mine["--sidebar-border"], mine["--border"]);
    assert.equal(mine["--sidebar-ring"], mine["--ring"]);
    assert.equal(mine["--sidebar"], `hsl(${mine["--card"]})`);
  });
}

test("globals.css imports basalt.css and no longer carries the zinc set", () => {
  assert.match(globals, /@import "\.\/m3\/basalt\.css";/);
  assert.doesNotMatch(globals, /--background:\s*0 0% 97%/);
  assert.doesNotMatch(globals, /--primary:\s*240 5\.9% 10%/);
  assert.match(globals, /--radius:\s*0\.5rem/);
});

test("the sans font is Inclusive Sans; Geist Sans is gone, Geist Mono stays", () => {
  assert.match(globals, /--font-sans:\s*var\(--font-inclusive-sans\)/);
  assert.match(globals, /--font-mono:\s*var\(--font-geist-mono\)/);
  const layout = read("app/layout.tsx");
  assert.doesNotMatch(layout, /GeistSans/);
  assert.match(layout, /inclusiveSans\.variable/);
  assert.match(read("lib/fonts.ts"), /variable:\s*"--font-inclusive-sans"/);
  assert.doesNotMatch(read("components/arkademy/m3-fonts.ts"), /Inclusive_Sans\(/);
});

test("the installed app's title bar follows the Basalt surfaces", () => {
  const layout = read("app/layout.tsx");
  assert.match(layout, /color: "#F9F9F9"/);
  assert.match(layout, /color: "#131315"/);
});

if (failures) {
  console.error(`\n${failures} failing`);
  process.exit(1);
}
console.log("\nall passing");
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tests/app/basalt-theme.test.js`
Expected: FAIL — `ENOENT … app/m3/basalt.css` (thrown before any test runs).

- [ ] **Step 3: Create `app/m3/basalt.css`**

```css
/*
 * The core app's palette: Material 3 Expressive's Basalt · Neutral
 * (docs/superpowers/specs/2026-11-13-basalt-core-theme-design.md).
 *
 * The --md-* roles are the Arkademy's `basalt-neutral` scheme, copied verbatim
 * from app/arkademy/business-model-canvas/m3-expressive.css (one HCT solver
 * run, seed #A3A3AB; tests/app/basalt-theme.test.js holds the two copies
 * equal — never retune one by hand). The app's shadcn tokens are then mapped
 * onto those roles, exactly as the Arkademy maps them, so every ui/* component
 * follows without being touched.
 *
 * The Arkademy keeps its own scheme: its rules are keyed on
 * `:root:has([data-m3="expressive"])`, more specific than `:root`, so on its
 * pages Ember · Vibrant wins, light and dark.
 */
:root {
  --md-primary: #5B5E6C;
  --md-on-primary: #FFFFFF;
  --md-primary-container: #DFE1F2;
  --md-on-primary-container: #434654;
  --md-secondary: #5D5E67;
  --md-on-secondary: #FFFFFF;
  --md-secondary-container: #E2E2EC;
  --md-on-secondary-container: #45464F;
  --md-tertiary: #585E72;
  --md-on-tertiary: #FFFFFF;
  --md-tertiary-container: #DDE1F9;
  --md-on-tertiary-container: #414659;
  --md-error: #BA1A1A;
  --md-on-error: #FFFFFF;
  --md-error-container: #FFDAD5;
  --md-on-error-container: #93000A;
  --md-primary-fixed: #DFE1F2;
  --md-primary-fixed-dim: #C3C6D6;
  --md-on-primary-fixed: #181B27;
  --md-on-primary-fixed-variant: #434654;
  --md-tertiary-fixed: #DDE1F9;
  --md-tertiary-fixed-dim: #C1C6DD;
  --md-on-tertiary-fixed: #151B2C;
  --md-on-tertiary-fixed-variant: #414659;
  --md-surface: #F9F9F9;
  --md-surface-dim: #DCD9DA;
  --md-surface-bright: #F9F9F9;
  --md-surface-container-lowest: #FFFFFF;
  --md-surface-container-low: #F3F3F3;
  --md-surface-container: #EEEEEE;
  --md-surface-container-high: #E8E8E8;
  --md-surface-container-highest: #E5E2E3;
  --md-on-surface: #1B1B1D;
  --md-on-surface-variant: #474648;
  --md-outline: #787678;
  --md-outline-variant: #C8C6C7;
  --md-inverse-surface: #313032;
  --md-inverse-on-surface: #F1F1F1;
  --md-inverse-primary: #C3C6D6;
  --mx-on-inverse-btn: #181B27;
  --background: 0.0 0.0% 97.6%;
  --foreground: 240.0 3.6% 11.0%;
  --card: 0.0 0.0% 95.3%;
  --card-foreground: 240.0 3.6% 11.0%;
  --popover: 0.0 0.0% 93.3%;
  --popover-foreground: 240.0 3.6% 11.0%;
  --primary: 229.4 8.5% 39.0%;
  --primary-foreground: 0.0 0.0% 100.0%;
  --secondary: 240.0 20.8% 90.6%;
  --secondary-foreground: 234.0 6.8% 29.0%;
  --muted: 0.0 0.0% 91.0%;
  --muted-foreground: 270.0 1.4% 27.8%;
  --accent: 240.0 20.8% 90.6%;
  --accent-foreground: 234.0 6.8% 29.0%;
  --border: 330.0 1.8% 78.0%;
  --input: 300.0 0.8% 46.7%;
  --ring: 234.0 5.1% 38.4%;
  /* the tokens the Arkademy never needed: error, and the sidebar's set */
  --destructive: 0.0 75.5% 41.6%;
  --destructive-foreground: 0.0 0.0% 100.0%;
  --sidebar-background: 0.0 0.0% 95.3%;
  --sidebar-foreground: 270.0 1.4% 27.8%;
  --sidebar-primary: 229.4 8.5% 39.0%;
  --sidebar-primary-foreground: 0.0 0.0% 100.0%;
  --sidebar-accent: 240.0 20.8% 90.6%;
  --sidebar-accent-foreground: 234.0 6.8% 29.0%;
  --sidebar-border: 330.0 1.8% 78.0%;
  --sidebar-ring: 234.0 5.1% 38.4%;
  --sidebar: hsl(0.0 0.0% 95.3%);
}
.dark {
  --md-primary: #C3C6D6;
  --md-on-primary: #2D303D;
  --md-primary-container: #434654;
  --md-on-primary-container: #DFE1F2;
  --md-secondary: #C5C6D0;
  --md-on-secondary: #2E3038;
  --md-secondary-container: #45464F;
  --md-on-secondary-container: #E2E2EC;
  --md-tertiary: #C1C6DD;
  --md-on-tertiary: #2A3042;
  --md-tertiary-container: #414659;
  --md-on-tertiary-container: #DDE1F9;
  --md-error: #FFB3AA;
  --md-on-error: #690004;
  --md-error-container: #93000A;
  --md-on-error-container: #FFDAD5;
  --md-primary-fixed: #DFE1F2;
  --md-primary-fixed-dim: #C3C6D6;
  --md-on-primary-fixed: #181B27;
  --md-on-primary-fixed-variant: #434654;
  --md-tertiary-fixed: #DDE1F9;
  --md-tertiary-fixed-dim: #C1C6DD;
  --md-on-tertiary-fixed: #151B2C;
  --md-on-tertiary-fixed-variant: #414659;
  --md-surface: #131315;
  --md-surface-dim: #131315;
  --md-surface-bright: #39393A;
  --md-surface-container-lowest: #0E0E0F;
  --md-surface-container-low: #1B1B1D;
  --md-surface-container: #201F21;
  --md-surface-container-high: #2A2A2B;
  --md-surface-container-highest: #353436;
  --md-on-surface: #E5E2E3;
  --md-on-surface-variant: #C8C6C7;
  --md-outline: #929092;
  --md-outline-variant: #474648;
  --md-inverse-surface: #E5E2E3;
  --md-inverse-on-surface: #313032;
  --md-inverse-primary: #5B5E6C;
  --mx-on-inverse-btn: #FFFFFF;
  --background: 240.0 5.0% 7.8%;
  --foreground: 340.0 5.5% 89.2%;
  --card: 240.0 3.6% 11.0%;
  --card-foreground: 340.0 5.5% 89.2%;
  --popover: 270.0 3.1% 12.5%;
  --popover-foreground: 340.0 5.5% 89.2%;
  --primary: 230.5 18.8% 80.2%;
  --primary-foreground: 228.8 15.1% 20.8%;
  --secondary: 234.0 6.8% 29.0%;
  --secondary-foreground: 240.0 20.8% 90.6%;
  --muted: 240.0 1.2% 16.7%;
  --muted-foreground: 330.0 1.8% 78.0%;
  --accent: 234.0 6.8% 29.0%;
  --accent-foreground: 240.0 20.8% 90.6%;
  --border: 270.0 1.4% 27.8%;
  --input: 300.0 0.9% 56.9%;
  --ring: 234.5 10.5% 79.4%;
  --destructive: 6.4 100.0% 83.3%;
  --destructive-foreground: 357.7 100.0% 20.6%;
  --sidebar-background: 240.0 3.6% 11.0%;
  --sidebar-foreground: 330.0 1.8% 78.0%;
  --sidebar-primary: 230.5 18.8% 80.2%;
  --sidebar-primary-foreground: 228.8 15.1% 20.8%;
  --sidebar-accent: 234.0 6.8% 29.0%;
  --sidebar-accent-foreground: 240.0 20.8% 90.6%;
  --sidebar-border: 270.0 1.4% 27.8%;
  --sidebar-ring: 234.5 10.5% 79.4%;
  --sidebar: hsl(240.0 3.6% 11.0%);
}
```

Before saving, diff your `--md-*` and shadcn lines against the Arkademy's two `basalt-neutral` blocks (`app/arkademy/business-model-canvas/m3-expressive.css`, the rules starting `:root:has([data-m3="expressive"][data-scheme="basalt-neutral"]) {` and `:root.dark:has(…basalt-neutral…) {`). They must match character for character; the test checks it.

- [ ] **Step 4: Rewire `app/globals.css`**

Replace lines 1–69 (from `@import "tailwindcss";` through the closing `}` of the `.dark { … }` block) with:

```css
@import "tailwindcss";
@import "./wobble.generated.css";
@import "./stones.generated.css";
@import "./stones.css";
@import "./m3/basalt.css";

@custom-variant dark (&:is(.dark *));

/* Colors come from app/m3/basalt.css (Basalt · Neutral). Shape stays here. */
:root {
  --radius: 0.5rem;
}
```

(The two stone imports stay until Task 4 removes them.) Then in the `@theme inline` block change

```css
  --font-sans: var(--font-geist-sans);
```

to

```css
  --font-sans: var(--font-inclusive-sans);
```

- [ ] **Step 5: Move Inclusive Sans into `lib/fonts.ts`**

Replace the whole of `lib/fonts.ts` with:

```ts
import { Gochi_Hand, Inclusive_Sans } from "next/font/google";

/**
 * The handwritten accent, in one place.
 *
 * It started on the landing hero, then chapter titles wanted it, then the docs
 * page title did — and by then three modules each called `Gochi_Hand()` with
 * the same arguments. `next/font` keys its generated CSS off the call site, so
 * that is three class names for one typeface. One export, one class.
 */
export const gochiHand = Gochi_Hand({
  subsets: ["latin"],
  weight: "400",
});

/**
 * The reading face of the whole app (Tailwind's `font-sans`, through
 * `--font-inclusive-sans` on <html>) and the Arkademy's plain face
 * (components/arkademy/m3-fonts.ts reads `.style.fontFamily`). Declared once
 * here, for the same reason as `gochiHand`: one call site, one download.
 */
export const inclusiveSans = Inclusive_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inclusive-sans",
});
```

In `components/arkademy/m3-fonts.ts`:
- remove `Inclusive_Sans,` from the `next/font/google` import list;
- change `import { gochiHand } from "@/lib/fonts";` to `import { gochiHand, inclusiveSans } from "@/lib/fonts";`;
- delete the line `export const inclusiveSans = Inclusive_Sans({ subsets: ["latin"], display: "swap" });`;
- add, right after the imports, `export { inclusiveSans };` (other Arkademy modules import `inclusiveSans` from `m3-fonts`; check with `grep -rn "inclusiveSans" components app lib` and keep them compiling);
- in the doc comment, change "Inclusive Sans is the plain face (body, label, digits);" to "Inclusive Sans (declared in lib/fonts.ts, the whole app's reading face) is the plain face (body, label, digits);".

- [ ] **Step 6: Point `app/layout.tsx` at Inclusive Sans and the Basalt surfaces**

- Replace `import { GeistSans } from "geist/font/sans";` with `import { inclusiveSans } from "@/lib/fonts";` (keep the `GeistMono` import).
- Change the `<html className>` from `` `${GeistSans.variable} ${GeistMono.variable} h-full antialiased` `` to `` `${inclusiveSans.variable} ${GeistMono.variable} h-full antialiased` ``.
- Replace the `viewport` constant with:

```ts
// The installed app's title bar (app/manifest.ts) follows the system theme,
// on the Basalt surfaces (app/m3/basalt.css: --md-surface, light and dark).
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F9F9F9" },
    { media: "(prefers-color-scheme: dark)", color: "#131315" },
  ],
};
```

- [ ] **Step 7: Register the test**

In `package.json` `scripts`, add after `"test:stone-preferences": …,`:

```json
    "test:basalt-theme": "node tests/app/basalt-theme.test.js",
```

In `.github/workflows/ci.yml`, add after the `Stone preference tests` step (same indentation):

```yaml
      - name: Basalt theme tests
        run: npm run test:basalt-theme
```

- [ ] **Step 8: Run the test and the checks**

Run: `node tests/app/basalt-theme.test.js`
Expected: every line `✓`, ending `all passing`.

Run: `npx tsc --noEmit && npm run lint && npm run test:arkademy-canvas && npm run test:root-redirect`
Expected: no errors; both suites pass.

- [ ] **Step 9: Commit**

```bash
git add app/m3/basalt.css app/globals.css lib/fonts.ts components/arkademy/m3-fonts.ts app/layout.tsx tests/app/basalt-theme.test.js package.json .github/workflows/ci.yml
git commit -m "feat(theme): Basalt · Neutral roles and Inclusive Sans for the core app

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DcsxQzN8fDvwUBsS9v7zuw"
```

---

### Task 2: Status and changelog colors on palette tones

**Files:**
- Modify: `app/m3/basalt.css` (append to the `:root` and `.dark` rules)
- Modify: `app/globals.css` (`@theme inline`)
- Modify: `components/graph/nodes/node-styles.ts` (`STATUS_STYLES`, `STATUS_MINIMAP_FILL`, `DECISION_STATUS_STYLES`, `DECISION_STATUS_TILE`)
- Modify: `components/journal/DeliverableHoverCard.tsx:31` and `:195`
- Modify: `components/journal/DeliverableTimeline.tsx:62`
- Test: `tests/app/basalt-theme.test.js`

The families (spec § 3; T40 light, T80 dark, T60 minimap):

| Family | Light | Dark | Minimap |
|---|---|---|---|
| neutral | `#5D5E67` | `#C6C6D0` | `#8F909A` |
| slate | `#585E72` | `#C0C6DD` | `#8A90A6` |
| indigo | `#485B99` | `#B5C4FF` | `#7B8ED0` |
| ember | `#8F4B39` | `#FFB4A1` | `#CB7C67` |
| plum | `#7B4F7A` | `#EAB6E7` | `#B181AF` |
| green | `#3A6844` | `#A0D3A7` | `#6C9C73` |
| amber | `#805520` | `#F5BC7D` | `#B9874D` |
| red | `#BA1A1A` | `#FFB4AB` | `#FF5449` |

- [ ] **Step 1: Append the failing tests**

In `tests/app/basalt-theme.test.js`, insert this block just before the final `if (failures) {`:

```js
console.log("basalt theme — status tones");

const FAMILIES = {
  neutral: ["#5D5E67", "#C6C6D0", "#8F909A"],
  slate: ["#585E72", "#C0C6DD", "#8A90A6"],
  indigo: ["#485B99", "#B5C4FF", "#7B8ED0"],
  ember: ["#8F4B39", "#FFB4A1", "#CB7C67"],
  plum: ["#7B4F7A", "#EAB6E7", "#B181AF"],
  green: ["#3A6844", "#A0D3A7", "#6C9C73"],
  amber: ["#805520", "#F5BC7D", "#B9874D"],
  red: ["#BA1A1A", "#FFB4AB", "#FF5449"],
};
const STATUS_FAMILY = {
  idea: "neutral", discovery: "ember", backlog: "slate", development: "indigo",
  releasing: "plum", live: "green", archived: "neutral",
};
const DECISION_FAMILY = {
  proposed: "neutral", approved: "indigo", enacted: "green",
  rejected: "red", deprecated: "amber", superseded: "plum",
};

test("each family is declared per theme, with its T40 / T80 tone", () => {
  for (const [family, [light, dark]] of Object.entries(FAMILIES)) {
    assert.equal(LIGHT[`--tone-${family}`], light, `light ${family}`);
    assert.equal(DARK[`--tone-${family}`], dark, `dark ${family}`);
  }
});

test("every tone reads as text (AA, 4.5:1) on the surfaces it sits on", () => {
  for (const [theme, vars] of [["light", LIGHT], ["dark", DARK]]) {
    for (const family of Object.keys(FAMILIES)) {
      for (const surface of ["--md-surface", "--md-surface-container-low", "--md-surface-container"]) {
        const ratio = contrast(vars[`--tone-${family}`], vars[surface]);
        assert.ok(ratio >= 4.5, `${theme} ${family} on ${surface}: ${ratio.toFixed(2)}:1`);
      }
    }
  }
});

test("Tailwind knows every tone as a color", () => {
  for (const family of Object.keys(FAMILIES)) {
    assert.match(globals, new RegExp(`--color-tone-${family}:\\s*var\\(--tone-${family}\\);`));
  }
});

/** The text of `export const NAME … = { … };` in a source file. */
function constant(source, name) {
  const start = source.indexOf(`export const ${name}`);
  assert.ok(start !== -1, `no export const ${name}`);
  return source.slice(start, source.indexOf("};", start));
}
const RAW_HUE = /\b(?:gray|zinc|slate|violet|blue|purple|green|red|amber|rose|teal|sky|emerald)-\d{2,3}\b/;
const nodeStyles = read("components/graph/nodes/node-styles.ts");

test("statuses wear their family's tone, and no raw Tailwind hue", () => {
  const src = constant(nodeStyles, "STATUS_STYLES");
  assert.doesNotMatch(src, RAW_HUE);
  for (const [status, family] of Object.entries(STATUS_FAMILY)) {
    const row = src.split("\n").find((line) => line.trimStart().startsWith(`${status}:`));
    assert.ok(row, `no row for ${status}`);
    for (const cls of [`text-tone-${family}`, `bg-tone-${family}"`, `stroke-tone-${family}`, `bg-tone-${family}/10`]) {
      assert.ok(row.includes(cls), `${status}: missing ${cls}`);
    }
  }
});

test("the minimap fills are the families' T60 tones", () => {
  const src = constant(nodeStyles, "STATUS_MINIMAP_FILL");
  for (const [status, family] of Object.entries(STATUS_FAMILY)) {
    const row = src.split("\n").find((line) => line.trimStart().startsWith(`${status}:`));
    assert.ok(row && row.includes(`"${FAMILIES[family][2]}"`), `${status}: expected ${FAMILIES[family][2]}`);
  }
});

test("decision statuses and their tiles wear their family's tone", () => {
  const styles = constant(nodeStyles, "DECISION_STATUS_STYLES");
  const tiles = constant(nodeStyles, "DECISION_STATUS_TILE");
  assert.doesNotMatch(styles, RAW_HUE);
  assert.doesNotMatch(tiles, RAW_HUE);
  for (const [status, family] of Object.entries(DECISION_FAMILY)) {
    const row = styles.split("\n").find((line) => line.trimStart().startsWith(`${status}:`));
    assert.ok(row.includes(`text-tone-${family}`) && row.includes(`bg-tone-${family}"`), `${status} style`);
    const tile = tiles.split("\n").find((line) => line.trimStart().startsWith(`${status}:`));
    assert.ok(tile.includes(`"bg-tone-${family}/10 text-tone-${family}"`), `${status} tile`);
  }
});

test("the changelog's ship mark is green and the forge tile plum", () => {
  const timeline = read("components/journal/DeliverableTimeline.tsx");
  const hover = read("components/journal/DeliverableHoverCard.tsx");
  assert.match(timeline, /bg-tone-green\/10 text-tone-green/);
  assert.match(hover, /export const FORGE_TILE = "bg-tone-plum\/10 text-tone-plum";/);
  assert.match(hover, /group-hover:bg-tone-plum\/20/);
  assert.doesNotMatch(timeline + hover, /(?:green|purple)-[456]00/);
});
```

- [ ] **Step 2: Run it to verify the new tests fail**

Run: `node tests/app/basalt-theme.test.js`
Expected: the Task 1 tests pass; the seven new ones FAIL (e.g. `light neutral` expected `#5D5E67`, got `undefined`).

- [ ] **Step 3: Declare the tones in `app/m3/basalt.css`**

Inside the `:root { … }` rule, after `--sidebar: hsl(0.0 0.0% 95.3%);`, add:

```css
  /* Status tones (spec § 3): M3 tonal palettes on the expressive schemes'
   * hues, chroma capped at 40 so they stay calm beside Basalt. T40 here, T80
   * under .dark; the minimap's T60 twins live in node-styles.ts. */
  --tone-neutral: #5D5E67;
  --tone-slate: #585E72;
  --tone-indigo: #485B99;
  --tone-ember: #8F4B39;
  --tone-plum: #7B4F7A;
  --tone-green: #3A6844;
  --tone-amber: #805520;
  --tone-red: #BA1A1A;
```

Inside the `.dark { … }` rule, after `--sidebar: hsl(240.0 3.6% 11.0%);`, add:

```css
  --tone-neutral: #C6C6D0;
  --tone-slate: #C0C6DD;
  --tone-indigo: #B5C4FF;
  --tone-ember: #FFB4A1;
  --tone-plum: #EAB6E7;
  --tone-green: #A0D3A7;
  --tone-amber: #F5BC7D;
  --tone-red: #FFB4AB;
```

- [ ] **Step 4: Register them in `app/globals.css`**

In `@theme inline`, after `--color-sidebar-ring: hsl(var(--sidebar-ring));`, add:

```css
  /* Status tones (app/m3/basalt.css): text-tone-green, bg-tone-green/10, … */
  --color-tone-neutral: var(--tone-neutral);
  --color-tone-slate: var(--tone-slate);
  --color-tone-indigo: var(--tone-indigo);
  --color-tone-ember: var(--tone-ember);
  --color-tone-plum: var(--tone-plum);
  --color-tone-green: var(--tone-green);
  --color-tone-amber: var(--tone-amber);
  --color-tone-red: var(--tone-red);
```

- [ ] **Step 5: Rewrite the status maps in `components/graph/nodes/node-styles.ts`**

Replace the `STATUS_STYLES` constant (keep its doc comments above it) with:

```ts
export const STATUS_STYLES: Record<StatusId, { badge: string; dot: string; stroke: string; surface: string }> = {
  idea:        { badge: "text-tone-neutral", dot: "bg-tone-neutral", stroke: "stroke-tone-neutral", surface: "bg-tone-neutral/10" },
  discovery:   { badge: "text-tone-ember",   dot: "bg-tone-ember",   stroke: "stroke-tone-ember",   surface: "bg-tone-ember/10"   },
  backlog:     { badge: "text-tone-slate",   dot: "bg-tone-slate",   stroke: "stroke-tone-slate",   surface: "bg-tone-slate/10"   },
  development: { badge: "text-tone-indigo",  dot: "bg-tone-indigo",  stroke: "stroke-tone-indigo",  surface: "bg-tone-indigo/10"  },
  releasing:   { badge: "text-tone-plum",    dot: "bg-tone-plum",    stroke: "stroke-tone-plum",    surface: "bg-tone-plum/10"    },
  live:        { badge: "text-tone-green",   dot: "bg-tone-green",   stroke: "stroke-tone-green",   surface: "bg-tone-green/10"   },
  archived:    { badge: "text-tone-neutral", dot: "bg-tone-neutral", stroke: "stroke-tone-neutral", surface: "bg-tone-neutral/10" },
};
```

Add one sentence to the doc comment right above it: ` * Colors are the palette's status tones (app/m3/basalt.css), light and dark from one class.`

Replace `STATUS_MINIMAP_FILL` and its doc comment with:

```ts
/**
 * Status → minimap fill, the hex twin of {@link STATUS_STYLES}. Kept beside it
 * so a status can't read as one color on a card badge and another in the
 * minimap. SVG fill attributes can't read a CSS variable, so these are each
 * family's T60 tone — the midpoint that holds on a light and a dark minimap.
 */
export const STATUS_MINIMAP_FILL: Record<StatusId, string> = {
  idea:        "#8F909A", // neutral T60
  discovery:   "#CB7C67", // ember T60
  backlog:     "#8A90A6", // slate T60
  development: "#7B8ED0", // indigo T60
  releasing:   "#B181AF", // plum T60
  live:        "#6C9C73", // green T60
  archived:    "#8F909A", // neutral T60
};
```

Replace `DECISION_STATUS_STYLES` with:

```ts
export const DECISION_STATUS_STYLES: Record<DecisionStatusId, { badge: string; dot: string }> = {
  proposed:   { badge: "text-tone-neutral", dot: "bg-tone-neutral" },
  approved:   { badge: "text-tone-indigo",  dot: "bg-tone-indigo"  },
  enacted:    { badge: "text-tone-green",   dot: "bg-tone-green"   },
  rejected:   { badge: "text-tone-red",     dot: "bg-tone-red"     },
  deprecated: { badge: "text-tone-amber",   dot: "bg-tone-amber"   },
  superseded: { badge: "text-tone-plum",    dot: "bg-tone-plum"    },
};
```

Replace `DECISION_STATUS_TILE` with (the tone flips with the theme by itself, so the `dark:` classes go):

```ts
export const DECISION_STATUS_TILE: Record<DecisionStatusId, string> = {
  proposed:   "bg-tone-neutral/10 text-tone-neutral",
  approved:   "bg-tone-indigo/10 text-tone-indigo",
  enacted:    "bg-tone-green/10 text-tone-green",
  rejected:   "bg-tone-red/10 text-tone-red",
  deprecated: "bg-tone-amber/10 text-tone-amber",
  superseded: "bg-tone-plum/10 text-tone-plum",
};
```

Leave `SYSTEM_LAYER_STYLES`, `SPECIES_MINIMAP_FILL`, `PLATFORM_*` untouched (out of scope).

- [ ] **Step 6: The changelog tiles**

`components/journal/DeliverableHoverCard.tsx` line 31:

```ts
export const FORGE_TILE = "bg-tone-plum/10 text-tone-plum";
```

and in the same comment block above it, change "purple here means" to "plum here means" and "a purple word next to a purple box" to "a plum word next to a plum box". Line 195: change `"group-hover:bg-purple-500/20"` to `"group-hover:bg-tone-plum/20"`.

`components/journal/DeliverableTimeline.tsx` line 62: change `` `${SHIP_MARK} bg-green-500/10 text-green-600 dark:text-green-400` `` to `` `${SHIP_MARK} bg-tone-green/10 text-tone-green` ``.

Then check nothing else spelled these tiles: `grep -rn "purple-500/10\|green-500/10" components app` — any remaining hit in `components/journal` is a miss; report others without changing them (out of scope).

- [ ] **Step 7: Run the test and the checks**

Run: `node tests/app/basalt-theme.test.js`
Expected: `all passing`.

Run: `npx tsc --noEmit && npm run lint && npm run test:changelog-releases && npm run test:delivery`
Expected: clean, both suites pass.

- [ ] **Step 8: Commit**

```bash
git add app/m3/basalt.css app/globals.css components/graph/nodes/node-styles.ts components/journal/DeliverableHoverCard.tsx components/journal/DeliverableTimeline.tsx tests/app/basalt-theme.test.js
git commit -m "feat(theme): status, decision and changelog colors on Basalt's tones

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DcsxQzN8fDvwUBsS9v7zuw"
```

---

### Task 3: The cookie12 menu badge

**Files:**
- Modify: `app/m3/basalt.css` (append)
- Modify: `components/ui/sidebar.tsx:483` and `:693`
- Test: `tests/app/basalt-theme.test.js`

The stone chip in `app/stones.css` (the `[data-sidebar="menu-button"][data-active="true"]…::before` rules) stays in place until Task 4 deletes that file. Because `basalt.css` is imported **after** `stones.css` and its rules here are unlayered (stones.css wraps its chip in `@layer components`, and unlayered CSS beats layered CSS), the badge already wins from this task on.

- [ ] **Step 1: Append the failing test**

Insert before the final `if (failures) {`:

```js
console.log("basalt theme — the menu badge");

test("the active row's badge is the cookie12 shape, on secondary-container", () => {
  const shapes = read("components/arkademy/ExpressiveShape.tsx");
  const cookie12 = shapes.match(/cookie12:\s*"([^"]+)"/)[1];
  assert.ok(basalt.includes(`d='${cookie12}'`), "basalt.css's mask is not EXPRESSIVE_SHAPES.cookie12");
  const rule = basalt.slice(basalt.indexOf('[data-sidebar="menu-button"][data-active="true"]:has(> svg:first-child)::before'));
  assert.match(rule, /background:\s*var\(--md-secondary-container\)/);
  assert.match(rule, /-webkit-mask:/);
  assert.match(rule, /\bmask:/);
  assert.match(basalt, /stroke:\s*var\(--md-on-secondary-container\)/);
  assert.doesNotMatch(basalt, /#stone-icon/);
});

test("sidebar rows no longer read the stone radius", () => {
  assert.doesNotMatch(read("components/ui/sidebar.tsx"), /--stone-radius/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tests/app/basalt-theme.test.js`
Expected: the two new tests FAIL.

- [ ] **Step 3: Build the mask line from the shape's source**

The cookie12 path is ~3 KB; generate the CSS value rather than retyping it. The SVG keeps literal single quotes (legal inside a double-quoted CSS `url()`), so the path stays greppable as `d='…'`, which the test relies on:

```bash
node -e '
const src = require("fs").readFileSync("components/arkademy/ExpressiveShape.tsx", "utf8");
const d = src.match(/cookie12:\s*"([^"]+)"/)[1];
const svg = `%3Csvg xmlns=\x27http://www.w3.org/2000/svg\x27 viewBox=\x270 0 100 100\x27%3E%3Cpath d=\x27${d}\x27/%3E%3C/svg%3E`;
process.stdout.write(`url("data:image/svg+xml,${svg}")`);
' > "$TMPDIR/cookie12-mask.txt" && wc -c "$TMPDIR/cookie12-mask.txt"
```

Expected: about 3.3 KB, one line starting `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'`.

- [ ] **Step 4: Append the badge to `app/m3/basalt.css`**

Append the following, replacing `MASK` (both occurrences, and the custom property) with the exact one-line contents of `$TMPDIR/cookie12-mask.txt`:

```css

/*
 * The active sidebar row: an expressive badge behind the leading icon only —
 * M3 Expressive's cookie12 (components/arkademy/ExpressiveShape.tsx,
 * EXPRESSIVE_SHAPES.cookie12, copied as a mask; the test holds them equal) in
 * secondary-container, the icon in on-secondary-container. The label stays on
 * the bare sidebar.
 *
 * Geometry: every row pads its leading 16px icon by 8px (`p-2` / `px-2`, and
 * `!p-2` on the collapsed rail), so a 24px badge at `left: 4px` centres on the
 * icon in both the expanded and the icon-only sidebar. A row without a leading
 * icon gets no badge: there is nothing for it to hold.
 */
:root {
  --menu-badge-mask: MASK;
}
[data-sidebar="menu-button"][data-active="true"]:has(> svg:first-child),
[data-sidebar="menu-sub-button"][data-active="true"]:has(> svg:first-child) {
  position: relative;
  isolation: isolate;
}
[data-sidebar="menu-button"][data-active="true"]:has(> svg:first-child)::before,
[data-sidebar="menu-sub-button"][data-active="true"]:has(> svg:first-child)::before {
  content: "";
  position: absolute;
  top: 50%;
  left: 4px;
  width: 24px;
  height: 24px;
  translate: 0 -50%;
  z-index: -1;
  pointer-events: none;
  background: var(--md-secondary-container);
  -webkit-mask: var(--menu-badge-mask) center / contain no-repeat;
  mask: var(--menu-badge-mask) center / contain no-repeat;
}
[data-sidebar="menu-button"][data-active="true"] > svg,
[data-sidebar="menu-sub-button"][data-active="true"] > svg {
  stroke: var(--md-on-secondary-container);
}
/* Windows High Contrast: no mask, a system-colour tile, so the icon stays legible. */
@media (forced-colors: active) {
  [data-sidebar="menu-button"][data-active="true"]::before,
  [data-sidebar="menu-sub-button"][data-active="true"]::before {
    background: ButtonFace;
    -webkit-mask: none;
    mask: none;
  }
}
```

(The mask lives in one custom property so the 3 KB path appears once. The test's `d='…'` check reads it there.)

- [ ] **Step 5: Sidebar row radius**

In `components/ui/sidebar.tsx`, in both class strings (line 483, `sidebarMenuButtonVariants`, and line 693, the sub-button), replace `rounded-[min(var(--stone-radius),15px)]` with `rounded-md`.

- [ ] **Step 6: Run the test and the checks**

Run: `node tests/app/basalt-theme.test.js`
Expected: `all passing`.

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add app/m3/basalt.css components/ui/sidebar.tsx tests/app/basalt-theme.test.js
git commit -m "feat(theme): the active menu row sits on an expressive cookie12 badge

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DcsxQzN8fDvwUBsS9v7zuw"
```

---

### Task 4: The stones leave the app

**Files:**
- Modify: `components/ui/button.tsx` (variants, compound variant)
- Modify: `components/ui/checkbox.tsx` (class string, doc comment)
- Modify: `components/projects/SectionCreateMenu.tsx:70`, `:81-82`
- Modify (variant `stone` → default, `stone-secondary` → `secondary`): `app/page.tsx:62`, `app/projects/page.tsx:519,522`, `app/project/[id]/decisions/page.tsx:182`, `app/project/[id]/library/page.tsx:537`, `app/project/[id]/delivery/page.tsx:284`, `components/arkademy/StartYourOwnButton.tsx:18`, `components/panels/NewNodeForm.tsx:276`, `components/panels/NewAcceptanceForm.tsx:147`, `components/publik/ImportSnapshotButton.tsx:55`, `components/publik/PublishDialog.tsx:252`, `components/generate/PromptOutput.tsx:45,70`
- Modify: `app/layout.tsx`, `app/globals.css`, `components/settings/DisplayPreferencesPanel.tsx`, `components/layout/RightRail.tsx:15`, `app/arkademy/business-model-canvas/m3-expressive.css:10-12`
- Modify: `scripts/generate/index.js:20-22`, `package.json`, `.github/workflows/ci.yml`
- Test: `tests/app/basalt-theme.test.js`

**The files Task 5 parks** (`components/settings/StonePicker.tsx`, `components/stones/StoneDefs.tsx`, `lib/stones/*`, `lib/hooks/useStonePreferences.ts`, `app/stones.css`, `app/stones.generated.css`) stay where they are in this task, unimported. The test skips them; Task 5 moves them. One of them must still type-check once the button loses its stone variants: in `StonePicker.tsx` change `variant="stone"` → `variant="default"` and `variant="stone-secondary"` → `variant="secondary"` (the kit's README states it expects a host button with those two variants). Edit nothing else in those files.

- [ ] **Step 1: Append the failing test**

Insert before the final `if (failures) {`:

```js
console.log("basalt theme — no stone left in the app");

/** Every .ts/.tsx/.css file under the app's source roots. */
function sources(dir) {
  const out = [];
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sources(rel));
    else if (/\.(tsx?|css)$/.test(entry.name)) out.push(rel);
  }
  return out;
}

// The stone library itself, parked by the kit move (Task 5); until then it sits
// in the app unimported, and the kit test below proves it has left.
const PARKED = new Set([
  "components/settings/StonePicker.tsx", "components/stones/StoneDefs.tsx",
  "lib/stones/preferences.ts", "lib/stones/stones-registry.generated.ts",
  "lib/hooks/useStonePreferences.ts", "app/stones.css", "app/stones.generated.css",
]);

test("nothing in app/, components/, lib/ or hooks/ reads a stone token or class", () => {
  const offenders = ["app", "components", "lib", "hooks"]
    .filter((dir) => fs.existsSync(path.join(ROOT, dir)))
    .flatMap(sources)
    .filter((rel) => !PARKED.has(rel))
    .filter((rel) => /--stone-|\bstone-(?:primary|secondary|scope)|url\(#stone-icon\)|variant="stone|data-stone-|StoneDefs|stoneBootScript/.test(read(rel)));
  assert.deepEqual(offenders, []);
});

test("the stone sheets are no longer imported and the generator no longer runs", () => {
  assert.doesNotMatch(globals, /stones(?:\.generated)?\.css/);
  assert.doesNotMatch(read("scripts/generate/index.js"), /generate-stones/);
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.scripts["test:stones"], undefined);
  assert.equal(pkg.scripts["test:stone-preferences"], undefined);
  const ci = read(".github/workflows/ci.yml");
  assert.doesNotMatch(ci, /test:stone|public\/stones|stones\.generated|stones-registry/);
});
```

Note: `globals` is read once at the top of the file; this test runs in the same process, so it sees the file as it was when the script started — run the script *after* editing, as below.

- [ ] **Step 2: Run it to verify it fails**

Run: `node tests/app/basalt-theme.test.js`
Expected: both new tests FAIL (the first lists the offending files).

- [ ] **Step 3: Button**

In `components/ui/button.tsx`:
- delete the four lines from `// Special actions (docs/superpowers/specs/2026-11-08-stone-skins-design.md):` through `"stone-secondary": "stone stone-secondary",`;
- delete the four comment lines above `compoundVariants` (`// tailwind-merge (in \`cn\`) drops …` through `// last and still wins.`) and the whole `compoundVariants: [ … ],` entry.

- [ ] **Step 4: Call sites**

In each file listed under "Modify (variant …)", change `variant="stone"` to nothing (delete the attribute; `default` is the default variant) and `variant="stone-secondary"` to `variant="secondary"`. In `SectionCreateMenu.tsx` both buttons lose `variant="stone"`, and line 82's `border-[color-mix(in_srgb,var(--stone-primary-ink)_20%,transparent)]` becomes `border-primary-foreground/20`. In `StartYourOwnButton.tsx`'s doc comment, change "(the stone button)" to "(the filled button)". In `StonePicker.tsx` apply the two-line change described above.

Verify: `grep -rn 'variant="stone' app components` → no output.

- [ ] **Step 5: Checkbox**

In `components/ui/checkbox.tsx`, in the class string replace

```
data-[state=checked]:[background:var(--stone-primary-fill)] data-[state=checked]:text-[var(--stone-primary-ink)] data-[state=checked]:border-transparent data-[state=checked]:shadow-[inset_0_0_0_1px_rgb(0_0_0/0.18)] data-[state=indeterminate]:[background:var(--stone-primary-fill)] data-[state=indeterminate]:text-[var(--stone-primary-ink)] data-[state=indeterminate]:border-transparent data-[state=indeterminate]:shadow-[inset_0_0_0_1px_rgb(0_0_0/0.18)] forced-colors:data-[state=checked]:[background:Highlight] forced-colors:data-[state=indeterminate]:[background:Highlight]
```

with

```
data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground data-[state=checked]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground data-[state=indeterminate]:border-primary
```

and in the doc comment replace "Checked and indeterminate boxes fill with the primary stone (app/stones.css), so a ticked box reads as the same material as the special actions." with "Checked and indeterminate boxes fill with the primary role, like the filled button."

- [ ] **Step 6: Layout**

In `app/layout.tsx` delete: the `StoneDefs`, `DEFAULT_STONES` and `stoneBootScript` imports; the `data-stone-light` / `data-stone-dark` attributes; the whole `<head> … </head>` element (it holds only the stone boot comment and script); and `<StoneDefs />`.

- [ ] **Step 7: Stylesheets and comments**

- `app/globals.css`: delete `@import "./stones.generated.css";` and `@import "./stones.css";`.
- `components/settings/DisplayPreferencesPanel.tsx`: delete the `StonePicker` import, the `<div className="border-t pt-3"><StonePicker /></div>` block, and the doc comment's last paragraph ("The Stones section is the exception … every project in this browser.").
- `components/layout/RightRail.tsx:15`: "a tint follows every stone skin, light or dark." → "a tint follows the theme, light or dark."
- `app/arkademy/business-model-canvas/m3-expressive.css` lines 10–12: "the ember of the Travertine, Pumice and Lava stones (scripts/generate/lib/stones.js, their icon tone)" → "the ember of the Travertine, Pumice and Lava stones (now kits/stones/data/stones.js, their icon tone)".

- [ ] **Step 8: Pipeline**

- `scripts/generate/index.js`: delete the two comment lines `// Stone skins: …` / `// (docs/superpowers/…)` and the `"generate-stones.js",` entry.
- `package.json`: delete the `test:stones` and `test:stone-preferences` script lines.
- `.github/workflows/ci.yml`: delete the `Stone skin tests` and `Stone preference tests` steps (4 lines + the blank line after each), and remove ` public/stones app/stones.generated.css lib/stones/stones-registry.generated.ts` from the end of the drift-check `run:` line.

- [ ] **Step 9: Run everything**

Run: `node tests/app/basalt-theme.test.js`
Expected: `all passing`.

Run: `npx tsc --noEmit && npm run lint && npm run generate && git status --short`
Expected: tsc and lint clean; `generate` prints no `stones:` line; `git status` shows only the files this task edited (no regenerated artifact changed).

Run: `npm run test:arkademy-canvas && npm run test:project-panels && npm run test:panel-semantics && npm run test:product-scope`
Expected: all pass. If a source-asserting suite fails because it read a line this task changed, update the assertion truthfully to the new text — never weaken it.

- [ ] **Step 10: Commit**

```bash
git add -A app components lib scripts package.json .github tests
git commit -m "refactor(theme): the stone skins leave the app

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DcsxQzN8fDvwUBsS9v7zuw"
```

---

### Task 5: Park the stones in `kits/stones/`

**Files:**
- Move (git mv): see the table in Step 2
- Create: `kits/stones/README.md`
- Modify: `kits/stones/generate.js` (paths), the moved tests (paths), the moved `src/*` (relative imports)
- Modify: `tsconfig.json`, `eslint.config.mjs`, `app/globals.css`
- Delete: `components/stones/` and `lib/stones/` directories once empty
- Test: `tests/app/basalt-theme.test.js`

- [ ] **Step 1: Append the failing test**

Insert before the final `if (failures) {`:

```js
console.log("basalt theme — the stone kit");

test("the stone library lives in kits/stones/ and nowhere in the app", () => {
  for (const rel of [
    "kits/stones/README.md", "kits/stones/data/stones.js", "kits/stones/generate.js",
    "kits/stones/css/stones.css", "kits/stones/dist/stones.generated.css",
    "kits/stones/dist/stones-registry.generated.ts", "kits/stones/dist/svg/basalt.svg",
    "kits/stones/src/preferences.ts", "kits/stones/src/useStonePreferences.ts",
    "kits/stones/src/StonePicker.tsx", "kits/stones/src/StoneDefs.tsx",
    "kits/stones/tests/stones.test.js", "kits/stones/tests/stone-preferences.test.js",
  ]) assert.ok(fs.existsSync(path.join(ROOT, rel)), `${rel} missing`);
  for (const rel of [
    "public/stones", "app/stones.css", "app/stones.generated.css", "lib/stones",
    "components/stones", "components/settings/StonePicker.tsx", "lib/hooks/useStonePreferences.ts",
    "scripts/generate/generate-stones.js", "scripts/generate/lib/stones.js",
    "tests/app/stones.test.js", "tests/app/stone-preferences.test.js",
  ]) assert.ok(!fs.existsSync(path.join(ROOT, rel)), `${rel} still in the app`);
});

test("the app's tooling ignores the kit", () => {
  assert.ok(JSON.parse(read("tsconfig.json")).exclude.includes("kits"), "tsconfig exclude");
  assert.match(read("eslint.config.mjs"), /"kits\/\*\*"/);
  assert.match(globals, /@source not "\.\.\/kits";/);
});
```

- [ ] **Step 2: Run it to verify it fails, then move the files**

Run: `node tests/app/basalt-theme.test.js` — expected: the two new tests FAIL.

Then:

```bash
mkdir -p kits/stones/data kits/stones/dist kits/stones/css kits/stones/src kits/stones/tests
git mv scripts/generate/lib/stones.js kits/stones/data/stones.js
git mv scripts/generate/generate-stones.js kits/stones/generate.js
git mv public/stones kits/stones/dist/svg
git mv app/stones.generated.css kits/stones/dist/stones.generated.css
git mv lib/stones/stones-registry.generated.ts kits/stones/dist/stones-registry.generated.ts
git mv app/stones.css kits/stones/css/stones.css
git mv lib/stones/preferences.ts kits/stones/src/preferences.ts
git mv lib/hooks/useStonePreferences.ts kits/stones/src/useStonePreferences.ts
git mv components/settings/StonePicker.tsx kits/stones/src/StonePicker.tsx
git mv components/stones/StoneDefs.tsx kits/stones/src/StoneDefs.tsx
git mv tests/app/stones.test.js kits/stones/tests/stones.test.js
git mv tests/app/stone-preferences.test.js kits/stones/tests/stone-preferences.test.js
ls lib/stones components/stones 2>/dev/null; echo "(both should be gone or empty)"
```

If `lib/stones/` or `components/stones/` still exist and are empty, `rmdir` them; if they hold anything else, stop and report it.

- [ ] **Step 3: Repoint the kit's internal paths**

- `kits/stones/generate.js`: `require("./lib/stones")` → `require("./data/stones")`; `ROOT` becomes the kit (`const KIT = __dirname;`) and the three outputs become `path.join(KIT, "dist", "svg")`, `path.join(KIT, "dist", "stones.generated.css")`, `path.join(KIT, "dist", "stones-registry.generated.ts")`. Update the header comment's three artifact paths to the `dist/…` ones and "Roles are mapped in app/stones.css" (twice, including inside the generated-file banner string) to "Roles are mapped in css/stones.css". Update the `GENERATED by scripts/generate/generate-stones.js` banner strings to `GENERATED by kits/stones/generate.js`. Leave the `url("/stones/<id>.svg")` URLs as they are: the README says the host serves `dist/svg/` at `/stones/`.
- `kits/stones/src/preferences.ts`: its registry import becomes `"../dist/stones-registry.generated"`.
- `kits/stones/src/useStonePreferences.ts`: its `@/lib/stones/preferences` import becomes `"./preferences"`.
- `kits/stones/src/StonePicker.tsx`: `@/lib/hooks/useStonePreferences` → `"./useStonePreferences"`, `@/lib/stones/preferences` → `"./preferences"`, and any `@/lib/stones/stones-registry.generated` → `"../dist/stones-registry.generated"`. Imports of the app's own modules (`@/components/ui/*`, `@/lib/utils`) stay.
- `kits/stones/tests/stones.test.js`: `ROOT` → the kit (`path.join(__dirname, "..")`), and `require(path.join(ROOT, "scripts", "generate", "lib", "stones.js"))` → `require(path.join(ROOT, "data", "stones.js"))`; fix any other path it reads the same way (grep the file for `ROOT,`).
- `kits/stones/tests/stone-preferences.test.js`: `ROOT` → `path.join(__dirname, "..")`; `transpile("lib/stones/stones-registry.generated.ts", …)` → `transpile("dist/stones-registry.generated.ts", …)` and `transpile("lib/stones/preferences.ts", …)` → `transpile("src/preferences.ts", …)`; the transpiled `preferences.js` requires `"../dist/stones-registry.generated"`, so write the registry's output into a `dist/` subfolder of the build dir and preferences into a `src/` subfolder (create both). Adjust the `require(path.join(BUILD_DIR, …))` accordingly.

Run: `node kits/stones/generate.js && git status --short kits/stones/dist && node kits/stones/tests/stones.test.js && node kits/stones/tests/stone-preferences.test.js`
Expected: the generator rewrites `dist/` with **no diff** apart from the two banner lines you changed; both kit tests pass.

- [ ] **Step 4: Keep the app's tooling out of the kit**

- `tsconfig.json`: `"exclude": ["node_modules"]` → `"exclude": ["node_modules", "kits"]`.
- `eslint.config.mjs`: in `globalIgnores([…])`, after the `"arkademy-content/**",` line, add:
  ```js
    // Parked libraries waiting for a new home (kits/<name>/README.md): never
    // part of the app, and their app-relative imports are not resolved here.
    "kits/**",
  ```
- `app/globals.css`: after `@import "./m3/basalt.css";` add `@source not "../kits";`.

- [ ] **Step 5: Write `kits/stones/README.md`**

```markdown
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
```

- [ ] **Step 6: Run everything**

Run: `node tests/app/basalt-theme.test.js`
Expected: `all passing`.

Run: `npx tsc --noEmit && npm run lint && npm run generate && git status --short`
Expected: clean; `git status` lists only this task's moves and edits.

- [ ] **Step 7: Commit**

```bash
git add -A kits tsconfig.json eslint.config.mjs app components lib scripts tests public
git commit -m "chore(stones): park the stone skins in kits/stones, ready for Ariko

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DcsxQzN8fDvwUBsS9v7zuw"
```

---

### Task 6: Full verification (controller, not a subagent)

- [ ] Every CI test script: `grep -o 'npm run test:[a-z0-9-]*' .github/workflows/ci.yml | sort -u` and run each (skip `test:graph` family if Postgres isn't up; `test:mcp`/`test:cli` build workspaces and take a while).
- [ ] Dev server on a free port (`PORT=4530 npm run dev`), then Playwright screenshots at 400 / 900 / 1440, light and dark: `/projects`, a project's map, delivery, decisions, changelog, Settings, and `/arkademy/business-model-canvas` (Ember must still win there).
- [ ] Measure body text width to confirm Inclusive Sans; measure status text contrast as drawn.
- [ ] `document.documentElement.scrollWidth - innerWidth === 0` at 400px.
- [ ] Report to the owner with the screenshots and the port.
