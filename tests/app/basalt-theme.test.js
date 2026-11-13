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
    assert.ok(names.length > 50, `only ${names.length} declarations read from the Arkademy block`);
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
  const manifest = read("app/manifest.ts");
  assert.match(manifest, /background_color: "#F9F9F9"/);
  assert.match(manifest, /theme_color: "#F9F9F9"/);
  assert.doesNotMatch(manifest, /#f7f7f7/i);
});

if (failures) {
  console.error(`\n${failures} failing`);
  process.exit(1);
}
console.log("\nall passing");
