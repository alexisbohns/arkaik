#!/usr/bin/env node

/**
 * The stone skins (docs/superpowers/specs/2026-11-08-stone-skins-design.md):
 * the definitions every generated artifact is derived from, and the contrast
 * floors each stone has to clear. Contrast is measured on each stone's declared
 * darkest and lightest tones: a label against both (4.5:1), and an icon tone
 * against the page surface (3:1) — white for light stones, Arkaik's #18181B for
 * dark. On the active sidebar row the icon sits on its own stone and can fall
 * below 3:1 (Travertine and Pumice keep Lava's exact #EE5E39); that is accepted
 * because the row's text label carries the meaning.
 */

const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const { STONES, DEFAULT_STONES, stoneSVG } = require(path.join(ROOT, "data", "stones.js"));

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

test("every texture is a standalone SVG document", () => {
  for (const s of STONES) {
    const svg = stoneSVG(s);
    assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'), `${s.id}: opens as an SVG document`);
    assert.ok(svg.endsWith("</svg>"), `${s.id}: closes the SVG`);
  }
});

test("the generated artifacts match the definitions", () => {
  const css = fs.readFileSync(path.join(ROOT, "dist", "stones.generated.css"), "utf8");
  const registry = fs.readFileSync(path.join(ROOT, "dist", "stones-registry.generated.ts"), "utf8");
  const dir = path.join(ROOT, "dist", "svg");
  for (const s of STONES) {
    assert.ok(css.includes(`:root[data-stone-${s.side}="${s.id}"]`), `${s.id}: CSS block`);
    assert.ok(registry.includes(`id: "${s.id}"`), `${s.id}: registry row`);
    assert.equal(fs.readFileSync(path.join(dir, `${s.id}.svg`), "utf8"), stoneSVG(s) + "\n", `${s.id}: SVG tile`);
  }
  assert.deepEqual(fs.readdirSync(dir).sort(), STONES.map((s) => `${s.id}.svg`).sort(), "no stale tiles");
  assert.ok(css.includes(`:root,\n:root[data-stone-light="${DEFAULT_STONES.light}"]`), "default light stone also applies with no attribute");
  assert.ok(css.includes(`:root,\n:root[data-stone-dark="${DEFAULT_STONES.dark}"]`), "default dark stone also applies with no attribute");
});

if (failures) {
  console.error(`\n${failures} failing`);
  process.exit(1);
}
