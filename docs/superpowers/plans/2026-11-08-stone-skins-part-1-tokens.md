# Stone skins — Part 1: stone tokens — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the twelve stone textures and their CSS tokens, mapped to primary/secondary roles that swap with the theme, with no visible change yet.

**Architecture:** Stone definitions (data + a deterministic SVG builder) live in `scripts/generate/lib/stones.js`. A new generator step writes one SVG tile per stone to `public/stones/`, per-stone CSS custom properties to `app/stones.generated.css`, and a typed registry to `lib/stones/stones-registry.generated.ts`. A hand-written `app/stones.css` maps the per-stone tokens onto roles (`--stone-primary-*`, `--stone-secondary-*`) for light and dark. A hidden `<svg>` gradient (`StoneDefs`) gives icons the stone's tone.

**Tech Stack:** Node (CommonJS generator scripts), Next.js App Router, Tailwind v4, plain CSS custom properties.

**Spec:** `docs/superpowers/specs/2026-11-08-stone-skins-design.md`

**Branch:** `feat/stones-tokens` (already created from `origin/main`). This is the bottom of a three-part stack; parts 2 and 3 stack on top.

---

## File map

- Create `scripts/generate/lib/stones.js` — stone data, ink constants, defaults, and `stoneSVG()`.
- Create `scripts/generate/generate-stones.js` — writes the three generated artifacts.
- Modify `scripts/generate/index.js` — run the new step.
- Generated (committed): `public/stones/*.svg`, `app/stones.generated.css`, `lib/stones/stones-registry.generated.ts`.
- Create `app/stones.css` — role mapping and shared constants.
- Modify `app/globals.css` — import both stone stylesheets.
- Create `components/stones/StoneDefs.tsx` — the shared icon gradient.
- Modify `app/layout.tsx` — mount `StoneDefs`, default `data-stone-*` attributes on `<html>`.
- Create `tests/app/stones.test.js`; modify `package.json` and `.github/workflows/ci.yml`.

---

### Task 1: Stone definitions and contrast floors

**Files:**
- Create: `scripts/generate/lib/stones.js`
- Test: `tests/app/stones.test.js`
- Modify: `package.json` (scripts)

- [ ] **Step 1: Write the failing test**

Create `tests/app/stones.test.js`:

```js
#!/usr/bin/env node

/**
 * The stone skins (docs/superpowers/specs/2026-11-08-stone-skins-design.md):
 * the definitions every generated artifact is derived from, and the contrast
 * floors each stone has to clear. Contrast is measured on what is drawn: a
 * label against every tone of its stone (4.5:1), and an icon tone against the
 * surface it sits on (3:1) — white for light stones, Arkaik's #18181B for dark.
 */

const assert = require("node:assert/strict");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const { STONES, DEFAULT_STONES, stoneSVG } = require(path.join(ROOT, "scripts", "generate", "lib", "stones.js"));

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
const worst = (colors, against) => Math.min(...colors.map((c) => contrast(c, against)));

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

console.log("stones");

test("six light stones and six dark stones, with unique ids", () => {
  assert.equal(STONES.filter((s) => s.side === "light").length, 6);
  assert.equal(STONES.filter((s) => s.side === "dark").length, 6);
  assert.equal(new Set(STONES.map((s) => s.id)).size, STONES.length);
});

test("the defaults name one stone of each side", () => {
  assert.equal(STONES.find((s) => s.id === DEFAULT_STONES.light)?.side, "light");
  assert.equal(STONES.find((s) => s.id === DEFAULT_STONES.dark)?.side, "dark");
});

test("every label clears 4.5:1 against every tone of its stone", () => {
  for (const s of STONES) {
    const ratio = worst(s.tones, s.ink);
    assert.ok(ratio >= 4.5, `${s.id}: label ${ratio.toFixed(2)}:1`);
  }
});

test("every icon tone clears 3:1 on the surface it sits on", () => {
  for (const s of STONES) {
    assert.equal(s.icon.length, 3, `${s.id}: three gradient stops`);
    const ratio = worst(s.icon, s.side === "light" ? "#FFFFFF" : "#18181B");
    assert.ok(ratio >= 3, `${s.id}: icon ${ratio.toFixed(2)}:1`);
  }
});

test("every texture is a deterministic standalone SVG", () => {
  for (const s of STONES) {
    const svg = stoneSVG(s);
    assert.equal(svg, stoneSVG(s), `${s.id}: same output twice`);
    assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'), `${s.id}: opens as an SVG document`);
    assert.ok(svg.endsWith("</svg>"), `${s.id}: closes the SVG`);
  }
});

if (failures) {
  console.error(`\n${failures} failing`);
  process.exit(1);
}
```

Add the script to `package.json`, directly after the `"test:search-score"` line:

```json
    "test:stones": "node tests/app/stones.test.js",
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:stones`
Expected: FAIL with `Cannot find module '.../scripts/generate/lib/stones.js'`.

- [ ] **Step 3: Write the definitions**

Create `scripts/generate/lib/stones.js`. The data and the builder are ported verbatim from the "Arkaik Gem Accents" artifact (Round 5); do not retune any value.

```js
"use strict";

/**
 * The stone skins (docs/superpowers/specs/2026-11-08-stone-skins-design.md).
 *
 * Each stone is a tile of layered noise drawn as a standalone SVG: broad
 * mottling, veins traced along a contour of the noise, drawn veins (a seamless
 * wavy band), crystal facets, then speckles and a fine grain. Every value here
 * was tuned by eye in the "Arkaik Gem Accents" artifact — change one only with
 * a reason, and rerun `npm run generate`.
 *
 * Fields:
 *   side    — "light" stones carry the secondary role in the light theme and
 *             the primary in the dark theme; "dark" stones the reverse.
 *   ink     — the label colour on the stone.
 *   polish  — whether the stone gets a top sheen.
 *   size    — the tile size in px (the CSS background-size).
 *   base    — the flat colour under the layers, and the CSS fallback.
 *   tones   — the stone's darkest and lightest drawn colours (contrast floors).
 *   icon    — three gradient stops for icons drawn in the stone's tone.
 *   layers  — the SVG layers, bottom to top (see stoneSVG).
 */

const INK_ON_LIGHT = "#18181B";
const INK_ON_DARK = "#FFFFFF";

const STONES = [
  {
    id: "carrara",
    name: "Carrara",
    side: "light",
    ink: INK_ON_LIGHT,
    polish: true,
    size: 320,
    base: "#F2F0ED",
    tones: ["#8C8A88", "#F2F0ED"],
    icon: ["#5E5C66", "#5E5C66", "#5E5C66"],
    layers: [
      { f: ".01", o: 3, color: "#DCD9D4", a: 3, b: -1.25 },
      { f: ".004 .01", o: 6, color: "#A09E9A", vein: { at: 0.5, w: 1 }, seed: 42 },
      { path: { y: 30, amp: 3.2, w: [0.4, 2.4], disp: 2, ef: 0.09, blur: 0.35, grain: 0.5, opacity: 0.9, color: "#A29F9A", seed: 7 } },
      { path: { y: 32.5, amp: 2.4, w: [0, 0.6], disp: 1.5, ef: 0.09, blur: 0.25, color: "#B5B2AD", opacity: 0.45, seed: 8 } },
      { f: ".009 .02", o: 5, color: "#C6C3BE", vein: { at: 0.44, w: 0 }, ch: "G", seed: 43 },
      { f: "1.5", o: 1, color: "#000000", a: 0.4, b: -0.17, seed: 34 },
    ],
  },
  {
    id: "calacatta",
    name: "Calacatta",
    side: "light",
    ink: INK_ON_LIGHT,
    polish: true,
    size: 320,
    base: "#F6F2EB",
    tones: ["#A08A6A", "#F6F2EB"],
    icon: ["#A0742E", "#7A5A36", "#5A3E3A"],
    layers: [
      { f: ".01", o: 3, color: "#E8E0D3", a: 3, b: -1.25, seed: 41 },
      { f: ".004 .01", o: 6, color: "#A08A6A", vein: { at: 0.5, w: 1 }, seed: 42 },
      { path: { y: 30, amp: 3.2, w: [0.4, 2.4], disp: 2, ef: 0.09, blur: 0.35, grain: 0.5, opacity: 0.9, color: "#A88F6E", seed: 7 } },
      { path: { y: 32.5, amp: 2.4, w: [0, 0.6], disp: 1.5, ef: 0.09, blur: 0.25, color: "#C8B89C", opacity: 0.45, seed: 8 } },
      { f: ".009 .02", o: 5, color: "#C8B89C", vein: { at: 0.44, w: 0 }, ch: "G", seed: 43 },
      { f: "1.5", o: 1, color: "#000000", a: 0.4, b: -0.17, seed: 44 },
    ],
  },
  {
    id: "rosa",
    name: "Rosa",
    side: "light",
    ink: INK_ON_LIGHT,
    polish: true,
    size: 320,
    base: "#F5E6E5",
    tones: ["#BF979C", "#F5E6E5"],
    icon: ["#A8697A", "#955A6B", "#834D5D"],
    layers: [
      { f: ".01", o: 3, color: "#EBD3D2", a: 3, b: -1.25, seed: 111 },
      { f: ".004 .01", o: 6, color: "#C29CA1", vein: { at: 0.5, w: 1 }, seed: 42 },
      { path: { y: 30, amp: 3.2, w: [0.4, 2.4], disp: 2, ef: 0.09, blur: 0.35, grain: 0.5, opacity: 0.9, color: "#C09A9F", seed: 7 } },
      { path: { y: 32.5, amp: 2.4, w: [0, 0.6], disp: 1.5, ef: 0.09, blur: 0.25, color: "#D2B2B6", opacity: 0.45, seed: 8 } },
      { f: ".009 .02", o: 5, color: "#DEC4C6", vein: { at: 0.44, w: 0 }, ch: "G", seed: 43 },
      { f: "1.5", o: 1, color: "#000000", a: 0.4, b: -0.17, seed: 112 },
    ],
  },
  {
    id: "rosequartz",
    name: "Rose Quartz",
    side: "light",
    ink: INK_ON_LIGHT,
    polish: false,
    size: 240,
    base: "#F5D9E0",
    tones: ["#E2A9B8", "#FBEDF0"],
    icon: ["#C94F7C", "#B8446F", "#A63B63"],
    layers: [
      { f: ".012", o: 4, color: "#ECBCC9", a: 4, b: -2, seed: 101 },
      { f: ".009", o: 3, color: "#FCF1F4", a: 5, b: -3, ch: "B", seed: 103 },
      { facets: { n: 4, light: "#FFFFFF", dark: "#D88AA2", a: [0.06, 0.3], edge: "#FFFFFF", edgeA: 0.3, seed: 104 } },
      { f: ".7", o: 1, color: "#FFFFFF", a: 18, b: -14.2, seed: 105 },
      { f: "1.4", o: 1, color: "#7A3048", a: 0.35, b: -0.15, seed: 106 },
    ],
  },
  {
    id: "travertine",
    name: "Travertine",
    side: "light",
    ink: INK_ON_LIGHT,
    polish: false,
    size: 320,
    base: "#F1E6D6",
    tones: ["#CBAA86", "#F1E6D6"],
    icon: ["#EE5E39", "#E5552F", "#D94C2A"],
    layers: [
      { f: ".002 .03", o: 3, color: "#E4D2B8", a: 4, b: -2.1, seed: 91 },
      { f: ".002 .03", o: 4, color: "#DDAE88", a: 6, b: -4, ch: "G", seed: 91 },
      { f: ".3", o: 2, color: "#B48C66", a: 9, b: -6.3, seed: 92 },
      { f: "1.5", o: 1, color: "#000000", a: 0.35, b: -0.15, seed: 93 },
    ],
  },
  {
    id: "pumice",
    name: "Pumice",
    side: "light",
    ink: INK_ON_LIGHT,
    polish: false,
    size: 260,
    base: "#E9E5DF",
    tones: ["#B5ADA2", "#EFECE7"],
    icon: ["#EE5E39", "#E5552F", "#D94C2A"],
    layers: [
      { f: ".02", o: 4, color: "#D7D0C6", a: 3, b: -1.4, seed: 94 },
      { f: ".012", o: 3, color: "#EED8C8", a: 3, b: -1.6, ch: "B", seed: 96 },
      { f: ".45", o: 2, color: "#B5ADA2", a: 6, b: -3.9, seed: 95 },
      { f: ".45", o: 2, color: "#7E766B", a: 10, b: -7.3, seed: 95 },
      { f: "1.5", o: 1, color: "#000000", a: 0.3, b: -0.13, seed: 97 },
    ],
  },
  {
    id: "onyx",
    name: "Onyx",
    side: "dark",
    ink: INK_ON_DARK,
    polish: true,
    size: 320,
    base: "#121214",
    tones: ["#121214", "#34343A"],
    icon: ["#E6E4E1", "#E6E4E1", "#E6E4E1"],
    layers: [
      { f: ".002 .012", o: 3, color: "#2E2E34", a: 3.5, b: -1.6 },
      { f: ".004 .01", o: 6, color: "#A3A09C", vein: { at: 0.5, w: 1 }, seed: 42 },
      { path: { y: 30, amp: 3.2, w: [0.4, 2.4], disp: 2, ef: 0.09, blur: 0.35, grain: 0.5, opacity: 0.9, color: "#9C9994", seed: 7 } },
      { path: { y: 32.5, amp: 2.4, w: [0, 0.6], disp: 1.5, ef: 0.09, blur: 0.25, color: "#76736F", opacity: 0.45, seed: 8 } },
      { f: ".009 .02", o: 5, color: "#4E4E55", vein: { at: 0.44, w: 0 }, ch: "G", seed: 43 },
      { f: "1.4", o: 1, color: "#000000", a: 0.8, b: -0.32, seed: 30 },
    ],
  },
  {
    id: "lava",
    name: "Lava",
    side: "dark",
    ink: INK_ON_DARK,
    polish: false,
    size: 220,
    base: "#3A3332",
    tones: ["#241E1D", "#5E3A30"],
    icon: ["#F26C45", "#EE5E39", "#E0512F"],
    layers: [
      { f: ".025", o: 3, color: "#6E2C20", a: 4, b: -2.1, ch: "B", seed: 2 },
      { f: ".22", o: 3, color: "#120F0F", a: 10, b: -6, seed: 8 },
      { f: ".6", o: 2, color: "#1A1515", a: 9, b: -5.4, ch: "G", seed: 8 },
      { f: ".9", o: 1, color: "#EE5E39", a: 14, b: -9.8, seed: 21 },
      { f: ".9", o: 1, color: "#F58A63", a: 20, b: -15.2, seed: 21 },
      { f: "1.6", o: 1, color: "#000000", a: 1, b: -0.42, seed: 33 },
    ],
  },
  {
    id: "nero",
    name: "Nero",
    side: "dark",
    ink: INK_ON_DARK,
    polish: true,
    size: 260,
    base: "#161618",
    tones: ["#0B0B0C", "#2C2C31"],
    icon: ["#BDBEC6", "#BDBEC6", "#BDBEC6"],
    layers: [
      { f: ".008", o: 4, color: "#2C2C31", a: 3.2, b: -1.45, seed: 51 },
      { f: ".012", o: 3, color: "#0B0B0C", a: 3, b: -1.4, ch: "G", seed: 51 },
      { f: ".006 .014", o: 6, color: "#5A5A62", vein: { at: 0.5, w: 0 }, seed: 52 },
      { f: ".004 .011", o: 6, color: "#6E6C69", vein: { at: 0.38, w: 0 }, ch: "G", seed: 55 },
      { f: "1.4", o: 1, color: "#000000", a: 0.9, b: -0.36, seed: 54 },
      { f: ".7", o: 1, color: "#5E626C", a: 10, b: -7.3, seed: 53 },
      { f: ".7", o: 1, color: "#F1F3F7", a: 20, b: -15.3, seed: 53 },
      { f: ".6", o: 1, color: "#C9B48A", a: 14, b: -11.4, ch: "B", seed: 59 },
    ],
  },
  {
    id: "basalt",
    name: "Basalt",
    side: "dark",
    ink: INK_ON_DARK,
    polish: false,
    size: 220,
    base: "#29292D",
    tones: ["#17171A", "#3A3A40"],
    icon: ["#A3A3AB", "#A3A3AB", "#A3A3AB"],
    layers: [
      { f: ".02", o: 4, color: "#3A3A40", a: 3.5, b: -1.6, seed: 61 },
      { f: ".035", o: 3, color: "#17171A", a: 3.5, b: -1.7, ch: "G", seed: 61 },
      { f: ".5", o: 2, color: "#0C0C0D", a: 10, b: -6.4, ch: "B", seed: 61 },
      { f: "1.6", o: 1, color: "#8A8A92", a: 1.4, b: -0.62, seed: 62 },
      { f: "1.6", o: 1, color: "#000000", a: 1, b: -0.42, ch: "G", seed: 62 },
    ],
  },
  {
    id: "verde",
    name: "Verde",
    side: "dark",
    ink: INK_ON_DARK,
    polish: true,
    size: 320,
    base: "#0D3022",
    tones: ["#06180F", "#1F5A40"],
    icon: ["#8FE0B5", "#7AD3A4", "#66C493"],
    layers: [
      { f: ".008", o: 4, color: "#1F5A40", a: 3.4, b: -1.5, seed: 71 },
      { f: ".012", o: 3, color: "#06180F", a: 3, b: -1.45, ch: "G", seed: 71 },
      { f: ".03", o: 3, color: "#2E8058", a: 4.5, b: -2.7, ch: "B", seed: 72 },
      { f: ".009 .02", o: 5, color: "#020A06", vein: { at: 0.44, w: 1, core: 1 }, ch: "G", seed: 43 },
      { f: ".004 .01", o: 6, color: "#CDE8D6", vein: { at: 0.5, w: 1, core: 1 }, seed: 42 },
      { path: { y: 30, amp: 3.2, w: [0.4, 2.4], disp: 2, ef: 0.09, blur: 0.35, grain: 0.5, opacity: 0.9, color: "#9ACDB0", seed: 7 } },
      { path: { y: 32.5, amp: 2.4, w: [0, 0.6], disp: 1.5, ef: 0.09, blur: 0.25, color: "#020A06", opacity: 0.45, seed: 8 } },
      { f: "1.4", o: 1, color: "#000000", a: 0.8, b: -0.32, seed: 73 },
    ],
  },
  {
    id: "amethyst",
    name: "Amethyst",
    side: "dark",
    ink: INK_ON_DARK,
    polish: false,
    size: 240,
    base: "#4A2273",
    tones: ["#24103A", "#7442AE"],
    icon: ["#D6B6FA", "#C9A2F5", "#B88BEE"],
    layers: [
      { f: ".012", o: 4, color: "#7442AE", a: 4, b: -2, seed: 81 },
      { f: ".016", o: 4, color: "#24103A", a: 4, b: -2.1, ch: "G", seed: 81 },
      { f: ".009", o: 3, color: "#D9C8EE", a: 5, b: -3.55, ch: "B", seed: 85 },
      { facets: { n: 4, light: "#C597F7", dark: "#14062A", a: [0.08, 0.34], edge: "#EAD9FF", edgeA: 0.07, seed: 86 } },
      { f: ".7", o: 1, color: "#EBDDFB", a: 18, b: -14.3, seed: 83 },
      { f: "1.4", o: 1, color: "#000000", a: 0.7, b: -0.28, seed: 84 },
    ],
  },
];

const DEFAULT_STONES = { light: "calacatta", dark: "onyx" };

const hex01 = (h) => [1, 3, 5].map((i) => +(parseInt(h.slice(i, i + 2), 16) / 255).toFixed(4));

/** A vein keeps a thin band of noise values: a table that is 1 at `at`, with `w` neighbours each side (solid within `core`). */
function veinTable({ at, w, core = 0, n = 61 }) {
  const t = Array(n).fill(0);
  const i = Math.round(at * (n - 1));
  t[i] = 1;
  for (let k = 1; k <= w; k++) {
    const v = k <= core ? 1 : 0.55;
    t[i - k] = v;
    t[i + k] = v;
  }
  return t.join(" ");
}

/** Seeded random, so every drawn layer is identical on every run. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A drawn vein: a seamless wavy band at height `y`, with varying width, irregular edges and an optional grain. */
function pathLayer({ y, amp = 2.5, w = [1.2, 2.6], color, opacity = 1, seed = 1, disp = 2.2, ef = 0.04, blur = 0, grain = 0 }, S, i) {
  const r = rng(seed);
  const TAU = Math.PI * 2;
  const waves = [1, 2, 3, 5].map((k) => ({ k, a: ((r() * 0.6 + 0.4) * (r() < 0.5 ? -1 : 1)) / (k * k), p: r() * TAU }));
  const norm = waves.reduce((m, q) => m + Math.abs(q.a), 0) || 1;
  const wp = [r() * TAU, r() * TAU];
  const yAt = (x) => y + (amp * waves.reduce((m, q) => m + q.a * Math.sin((TAU * q.k * x) / S + q.p), 0)) / norm;
  const wAt = (x) => w[0] + (w[1] - w[0]) * (0.5 + 0.3 * Math.sin((TAU * 2 * x) / S + wp[0]) + 0.2 * Math.sin((TAU * 3 * x) / S + wp[1]));
  const N = 96;
  const top = [];
  const bot = [];
  for (let j = 0; j <= N; j++) {
    const x = (S * j) / N;
    const c = yAt(x);
    const h = wAt(x) / 2;
    top.push(`${x.toFixed(1)},${(c - h).toFixed(2)}`);
    bot.unshift(`${x.toFixed(1)},${(c + h).toFixed(2)}`);
  }
  const defs =
    `<filter id="p${i}" filterUnits="userSpaceOnUse" x="0" y="0" width="${S}" height="${S}">` +
    `<feTurbulence type="fractalNoise" baseFrequency="${ef}" numOctaves="3" seed="${seed}" stitchTiles="stitch" result="n"/>` +
    `<feDisplacementMap in="SourceGraphic" in2="n" scale="${disp}" xChannelSelector="R" yChannelSelector="G" result="d"/>` +
    (blur ? `<feGaussianBlur in="d" stdDeviation="${blur}" result="d"/>` : "") +
    (grain
      ? `<feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="1" seed="${seed + 50}" stitchTiles="stitch"/>` +
        `<feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 ${grain * 2} 0 0 0 ${1 - grain * 1.6}" result="g"/>` +
        `<feComposite in="d" in2="g" operator="in"/>`
      : "") +
    `</filter>`;
  return { defs, svg: `<polygon points="${top.join(" ")} ${bot.join(" ")}" fill="${color}" opacity="${opacity}" filter="url(#p${i})"/>` };
}

/** Crystal facets: a seamless jittered triangle mesh, each plane a little lighter or darker than the stone. */
function facetLayer({ n = 5, light, dark, a = [0.05, 0.22], edge, edgeA = 0.16, seed = 1 }, S) {
  const r = rng(seed);
  const c = S / n;
  const J = [];
  for (let i = 0; i < n; i++) {
    J[i] = [];
    for (let j = 0; j < n; j++) J[i][j] = [(r() - 0.5) * c * 0.7, (r() - 0.5) * c * 0.7];
  }
  const P = (i, j) => [i * c + J[i % n][j % n][0], j * c + J[i % n][j % n][1]];
  let out = "";
  const tri = (pts) => {
    const lit = r() < 0.5;
    const op = a[0] + r() * (a[1] - a[0]);
    out +=
      `<polygon points="${pts.map((q) => q.map((v) => v.toFixed(1)).join(",")).join(" ")}" fill="${lit ? light : dark}" fill-opacity="${op.toFixed(2)}"` +
      (edge ? ` stroke="${edge}" stroke-opacity="${edgeA}" stroke-width=".6" stroke-linejoin="round"` : "") +
      "/>";
  };
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const A = P(i, j);
      const B = P(i + 1, j);
      const C = P(i + 1, j + 1);
      const D = P(i, j + 1);
      if (r() < 0.5) {
        tri([A, B, C]);
        tri([A, C, D]);
      } else {
        tri([A, B, D]);
        tri([B, C, D]);
      }
    }
  }
  // Drawn again shifted by a tile on each side, so facets crossing the tile edge stay whole.
  return `<g>${out}</g><g transform="translate(${-S} 0)">${out}</g><g transform="translate(0 ${-S})">${out}</g><g transform="translate(${-S} ${-S})">${out}</g>`;
}

/**
 * One stone as a standalone SVG tile. A noise layer is one feTurbulence channel
 * mapped to a colour with alpha = a·channel + b; a `vein` layer keeps a thin
 * band of the noise instead; `path` and `facets` layers are drawn geometry.
 */
function stoneSVG(s) {
  let defs = "";
  let body = "";
  s.layers.forEach((L, i) => {
    if (L.path) {
      const o = pathLayer(L.path, s.size, i);
      defs += o.defs;
      body += o.svg;
      return;
    }
    if (L.facets) {
      body += facetLayer(L.facets, s.size);
      return;
    }
    const ch = { R: [1, 0, 0], G: [0, 1, 0], B: [0, 0, 1] }[L.ch || "R"];
    const [r, g, b] = hex01(L.color);
    defs +=
      `<filter id="f${i}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">` +
      `<feTurbulence type="${L.type || "fractalNoise"}" baseFrequency="${L.f}" numOctaves="${L.o || 4}" seed="${L.seed || i + 1}" stitchTiles="stitch"/>` +
      (L.vein
        ? `<feColorMatrix type="matrix" values="0 0 0 0 ${r} 0 0 0 0 ${g} 0 0 0 0 ${b} ${ch.join(" ")} 0 0"/>` +
          `<feComponentTransfer><feFuncA type="table" tableValues="${veinTable(L.vein)}"/></feComponentTransfer></filter>`
        : `<feColorMatrix type="matrix" values="0 0 0 0 ${r} 0 0 0 0 ${g} 0 0 0 0 ${b} ${ch.map((x) => x * L.a).join(" ")} 0 ${L.b}"/></filter>`);
    body += `<rect width="100%" height="100%" filter="url(#f${i})"/>`;
  });
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${s.size}" height="${s.size}"><defs>${defs}</defs>` +
    `<rect width="100%" height="100%" fill="${s.base}"/>${body}</svg>`
  );
}

module.exports = { STONES, DEFAULT_STONES, INK_ON_LIGHT, INK_ON_DARK, stoneSVG };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:stones`
Expected: PASS — five `✓` lines, exit 0.

- [ ] **Step 5: Commit**

```bash
git add scripts/generate/lib/stones.js tests/app/stones.test.js package.json docs/superpowers/specs/2026-11-08-stone-skins-design.md docs/superpowers/plans/2026-11-08-stone-skins-part-*.md
git commit -m "feat(stones): stone definitions and their contrast floors"
```

---

### Task 2: Generate textures, tokens and the registry

**Files:**
- Create: `scripts/generate/generate-stones.js`
- Modify: `scripts/generate/index.js`
- Modify: `tests/app/stones.test.js`
- Modify: `.github/workflows/ci.yml`
- Generated: `public/stones/*.svg`, `app/stones.generated.css`, `lib/stones/stones-registry.generated.ts`

- [ ] **Step 1: Write the failing test**

In `tests/app/stones.test.js`, add `const fs = require("fs");` under the `path` require, and add this test directly before the `if (failures)` block:

```js
test("the generated artifacts match the definitions", () => {
  const css = fs.readFileSync(path.join(ROOT, "app", "stones.generated.css"), "utf8");
  const registry = fs.readFileSync(path.join(ROOT, "lib", "stones", "stones-registry.generated.ts"), "utf8");
  const dir = path.join(ROOT, "public", "stones");
  for (const s of STONES) {
    assert.ok(css.includes(`:root[data-stone-${s.side}="${s.id}"]`), `${s.id}: CSS block`);
    assert.ok(registry.includes(`id: "${s.id}"`), `${s.id}: registry row`);
    assert.equal(fs.readFileSync(path.join(dir, `${s.id}.svg`), "utf8"), stoneSVG(s) + "\n", `${s.id}: SVG tile`);
  }
  assert.deepEqual(fs.readdirSync(dir).sort(), STONES.map((s) => `${s.id}.svg`).sort(), "no stale tiles");
  assert.ok(css.includes(`:root,\n:root[data-stone-light="${DEFAULT_STONES.light}"]`), "default light stone also applies with no attribute");
  assert.ok(css.includes(`:root,\n:root[data-stone-dark="${DEFAULT_STONES.dark}"]`), "default dark stone also applies with no attribute");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:stones`
Expected: FAIL — `✗ the generated artifacts match the definitions` with `ENOENT ... app/stones.generated.css`.

- [ ] **Step 3: Write the generator**

Create `scripts/generate/generate-stones.js`:

```js
#!/usr/bin/env node
"use strict";

/**
 * Regenerates the stone skins (docs/superpowers/specs/2026-11-08-stone-skins-design.md)
 * from scripts/generate/lib/stones.js. Three committed artifacts, diff-checked
 * by CI like every other generated file:
 *
 *   - public/stones/<id>.svg                  → one texture tile per stone.
 *   - app/stones.generated.css                → per-stone tokens, scoped by
 *     `:root[data-stone-light|dark="<id>"]`; the default stones also apply
 *     with no attribute at all. Roles are mapped in app/stones.css.
 *   - lib/stones/stones-registry.generated.ts → the picker's list and defaults.
 *
 * Run via `npm run generate`.
 */

const fs = require("fs");
const path = require("path");
const { STONES, DEFAULT_STONES, INK_ON_DARK, stoneSVG } = require("./lib/stones");

const ROOT = path.resolve(__dirname, "..", "..");
const SVG_DIR = path.join(ROOT, "public", "stones");
const CSS_OUT = path.join(ROOT, "app", "stones.generated.css");
const REGISTRY_OUT = path.join(ROOT, "lib", "stones", "stones-registry.generated.ts");

/** The label's lift off the stone: a dark drop under white, a light catch under near-black. */
const textShadow = (ink) => (ink === INK_ON_DARK ? "0 1px 1px rgb(0 0 0 / .55)" : "0 1px 0 rgb(255 255 255 / .4)");

function cssBlock(s) {
  const p = `--stone-${s.side}`;
  const scoped = `:root[data-stone-${s.side}="${s.id}"]`;
  const selector = DEFAULT_STONES[s.side] === s.id ? `:root,\n${scoped}` : scoped;
  return (
    `${selector} {\n` +
    `  ${p}-fill: url("/stones/${s.id}.svg") 0 0 / ${s.size}px ${s.size}px, ${s.base};\n` +
    `  ${p}-ink: ${s.ink};\n` +
    `  ${p}-tsh: ${textShadow(s.ink)};\n` +
    `  ${p}-polish: ${s.polish ? 1 : 0};\n` +
    s.icon.map((c, i) => `  ${p}-icon-${i + 1}: ${c};\n`).join("") +
    `}\n`
  );
}

function registry() {
  const rows = STONES.map(
    (s) => `  { id: "${s.id}", name: "${s.name}", side: "${s.side}", base: "${s.base}", size: ${s.size} },`,
  ).join("\n");
  return (
    `/* GENERATED by scripts/generate/generate-stones.js — do not edit. */\n` +
    `/* Run \`npm run generate\` to refresh. */\n\n` +
    `export type StoneSide = "light" | "dark";\n\n` +
    `export interface StoneEntry {\n` +
    `  readonly id: string;\n` +
    `  readonly name: string;\n` +
    `  readonly side: StoneSide;\n` +
    `  readonly base: string;\n` +
    `  readonly size: number;\n` +
    `}\n\n` +
    `export const STONES: readonly StoneEntry[] = [\n${rows}\n];\n\n` +
    `export const DEFAULT_STONES = { light: "${DEFAULT_STONES.light}", dark: "${DEFAULT_STONES.dark}" } as const;\n`
  );
}

fs.mkdirSync(SVG_DIR, { recursive: true });
const wanted = new Set(STONES.map((s) => `${s.id}.svg`));
for (const file of fs.readdirSync(SVG_DIR)) {
  if (!wanted.has(file)) fs.rmSync(path.join(SVG_DIR, file));
}
for (const s of STONES) fs.writeFileSync(path.join(SVG_DIR, `${s.id}.svg`), stoneSVG(s) + "\n");

fs.writeFileSync(
  CSS_OUT,
  `/* GENERATED by scripts/generate/generate-stones.js — do not edit. */\n` +
    `/* Run \`npm run generate\` to refresh. Roles are mapped in app/stones.css. */\n\n` +
    STONES.map(cssBlock).join("\n"),
);

fs.mkdirSync(path.dirname(REGISTRY_OUT), { recursive: true });
fs.writeFileSync(REGISTRY_OUT, registry());

console.log(`stones: ${STONES.length} tiles, tokens and registry written`);
```

In `scripts/generate/index.js`, add the step directly after the `"generate-icon-wobble.js",` line:

```js
  // Stone skins: texture tiles, per-stone CSS tokens and the picker registry
  // (docs/superpowers/specs/2026-11-08-stone-skins-design.md).
  "generate-stones.js",
```

- [ ] **Step 4: Run the generator and the test**

Run: `node scripts/generate/generate-stones.js && npm run test:stones`
Expected: `stones: 12 tiles, tokens and registry written`, then six `✓` lines, exit 0.

- [ ] **Step 5: Wire CI**

In `.github/workflows/ci.yml`, append to the end of the `git diff --exit-code -- …` line in the "Fail on generated-artifact drift" step (after `lib/landing/generated`):

```
 public/stones app/stones.generated.css lib/stones/stones-registry.generated.ts
```

and add this step directly after the "Node-search ranking tests" step (same indentation as its siblings):

```yaml
      - name: Stone skin tests
        run: npm run test:stones
```

Run: `actionlint .github/workflows/ci.yml` if actionlint is installed locally (CI runs it on every workflow); otherwise check the step's indentation matches its neighbours.
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add scripts/generate/generate-stones.js scripts/generate/index.js tests/app/stones.test.js .github/workflows/ci.yml public/stones app/stones.generated.css lib/stones/stones-registry.generated.ts
git commit -m "feat(stones): generate texture tiles, tokens and the picker registry"
```

---

### Task 3: Role mapping, icon gradient and the default skin

**Files:**
- Create: `app/stones.css`
- Modify: `app/globals.css:1-2`
- Create: `components/stones/StoneDefs.tsx`
- Modify: `app/layout.tsx`

- [ ] **Step 1: Write the role mapping**

Create `app/stones.css`:

```css
/*
 * Stone skins — roles (docs/superpowers/specs/2026-11-08-stone-skins-design.md).
 *
 * Per-stone tokens come from stones.generated.css (--stone-light-* for the
 * chosen light stone, --stone-dark-* for the dark one). Here they become roles:
 * the primary role (special-action button, checkbox) takes the dark stone in
 * the light theme and the light stone in the dark theme, because that is where
 * each gives the most contrast; the secondary role (secondary button, active
 * sidebar row and its icon) takes the other.
 *
 * `.stone-scope-light` / `.stone-scope-dark` force one theme's roles on a
 * subtree, for previews that show both themes at once.
 */

:root {
  --stone-radius: 12px;
  /* A dark stone (or any stone on a dark surface) sits slightly raised. */
  --stone-raised: inset 0 1px 0 rgb(255 255 255 / .22), inset 0 -1px 0 rgb(0 0 0 / .28),
    0 1px 2px rgb(0 0 0 / .18), 0 4px 10px -6px rgb(0 0 0 / .45);
  /* A light stone on a light surface sits flush: a hairline, no lift. */
  --stone-flush: inset 0 0 0 1px rgb(0 0 0 / .07), 0 1px 1px rgb(0 0 0 / .04);
}

:root,
.stone-scope-light {
  --stone-primary-fill: var(--stone-dark-fill);
  --stone-primary-ink: var(--stone-dark-ink);
  --stone-primary-tsh: var(--stone-dark-tsh);
  --stone-primary-polish: var(--stone-dark-polish);
  --stone-primary-shadow: var(--stone-raised);
  --stone-primary-sheen: .32;
  --stone-secondary-fill: var(--stone-light-fill);
  --stone-secondary-ink: var(--stone-light-ink);
  --stone-secondary-tsh: var(--stone-light-tsh);
  --stone-secondary-polish: var(--stone-light-polish);
  --stone-secondary-shadow: var(--stone-flush);
  --stone-secondary-sheen: .16;
  --stone-icon-1: var(--stone-light-icon-1);
  --stone-icon-2: var(--stone-light-icon-2);
  --stone-icon-3: var(--stone-light-icon-3);
  --stone-row-hairline: rgb(0 0 0 / .06);
}

.dark,
.stone-scope-dark {
  --stone-primary-fill: var(--stone-light-fill);
  --stone-primary-ink: var(--stone-light-ink);
  --stone-primary-tsh: var(--stone-light-tsh);
  --stone-primary-polish: var(--stone-light-polish);
  --stone-primary-shadow: var(--stone-raised);
  --stone-primary-sheen: .32;
  --stone-secondary-fill: var(--stone-dark-fill);
  --stone-secondary-ink: var(--stone-dark-ink);
  --stone-secondary-tsh: var(--stone-dark-tsh);
  --stone-secondary-polish: var(--stone-dark-polish);
  --stone-secondary-shadow: var(--stone-raised);
  --stone-secondary-sheen: .32;
  --stone-icon-1: var(--stone-dark-icon-1);
  --stone-icon-2: var(--stone-dark-icon-2);
  --stone-icon-3: var(--stone-dark-icon-3);
  --stone-row-hairline: rgb(255 255 255 / .07);
}
```

In `app/globals.css`, replace the first two lines:

```css
@import "tailwindcss";
@import "./wobble.generated.css";
```

with:

```css
@import "tailwindcss";
@import "./wobble.generated.css";
@import "./stones.generated.css";
@import "./stones.css";
```

- [ ] **Step 2: Write the icon gradient**

Create `components/stones/StoneDefs.tsx`:

```tsx
/**
 * The shared paint server stone icons stroke with: `url(#stone-icon)`.
 *
 * Mounted once at the app root, like `WobbleFilters`. Its stops read
 * `--stone-icon-1..3`, which app/stones.css maps to the secondary stone's icon
 * tone for the current theme — so the gradient follows the reader's stones and
 * the theme with no JavaScript. `userSpaceOnUse` in lucide's 24×24 viewBox,
 * because an objectBoundingBox gradient paints nothing on a perfectly straight
 * stroke (its box has no height).
 *
 * A server component: static markup, no hydration cost.
 */
export function StoneDefs() {
  return (
    <svg aria-hidden="true" focusable="false" width="0" height="0" style={{ position: "absolute" }}>
      <defs>
        <linearGradient id="stone-icon" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="8" y2="24">
          <stop offset="0" style={{ stopColor: "var(--stone-icon-1)" }} />
          <stop offset="0.5" style={{ stopColor: "var(--stone-icon-2)" }} />
          <stop offset="1" style={{ stopColor: "var(--stone-icon-3)" }} />
        </linearGradient>
      </defs>
    </svg>
  );
}
```

- [ ] **Step 3: Mount it and set the default skin**

In `app/layout.tsx`:

Add the imports after the `WobbleBoil` import:

```tsx
import { StoneDefs } from "@/components/stones/StoneDefs";
import { DEFAULT_STONES } from "@/lib/stones/stones-registry.generated";
```

Add the two attributes to `<html>` (after `suppressHydrationWarning`):

```tsx
      data-stone-light={DEFAULT_STONES.light}
      data-stone-dark={DEFAULT_STONES.dark}
```

Mount `<StoneDefs />` directly after `<WobbleBoil />`.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npm run lint && npm run test:stones`
Expected: no type errors, no lint errors, tests pass.

Run: `npm run build`
Expected: build succeeds.

Run: `npm run generate && git status --short`
Expected: the full generator runs and leaves no changes beyond what this task already staged (no drift in wobble or other artifacts).

- [ ] **Step 5: Commit**

```bash
git add app/stones.css app/globals.css components/stones/StoneDefs.tsx app/layout.tsx
git commit -m "feat(stones): map stones to roles, add the icon gradient and the default skin"
```

---

## Part done when

- `npm run test:stones`, `npx tsc --noEmit`, `npm run lint`, `npm run build` all pass.
- `npm run generate` leaves the tree clean.
- No pixel of the app has changed (the tokens are defined but unused).
- PR: "feat(stones): stone tokens (part 1/3)", no Lab Note (add the `no-lab-note` label).
