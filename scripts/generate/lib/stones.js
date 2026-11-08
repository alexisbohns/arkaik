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
