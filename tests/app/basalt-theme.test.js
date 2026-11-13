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

const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The declarations of the first rule whose selector is exactly `selector`
 * (alone on its line, outside any comment).
 */
function block(css, selector) {
  const code = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const found = new RegExp(`^${escapeRe(selector)} \\{\\s*$`, "m").exec(code);
  assert.ok(found, `no "${selector} {" rule`);
  const open = code.indexOf("{", found.index);
  const close = code.indexOf("}", open);
  const vars = {};
  for (const m of code.slice(open + 1, close).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) vars[m[1]] = m[2].trim();
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
    assert.equal(names.length, 57, "the Arkademy block should declare 40 --md-*, --mx-on-inverse-btn and 16 shadcn tokens");
    for (const name of names) assert.equal(mine[name], theirs[name], `${name}`);
    const roles = (vars) => Object.keys(vars).filter((n) => n.startsWith("--md-")).sort();
    assert.deepEqual(roles(mine), roles(theirs), "the two copies declare different --md-* roles");
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
  assert.match(read("lib/font-sans.ts"), /variable:\s*"--font-inclusive-sans"/);
  assert.doesNotMatch(read("components/arkademy/m3-fonts.ts"), /Inclusive_Sans\(/);
});

test("the root layout preloads Inclusive Sans and no other face", () => {
  assert.doesNotMatch(read("lib/fonts.ts"), /Inclusive_Sans/);
  const layout = read("app/layout.tsx");
  assert.match(layout, /from "@\/lib\/font-sans"/);
  assert.doesNotMatch(layout, /from "@\/lib\/fonts"/);
  assert.doesNotMatch(layout, /m3-fonts/);
});

test("the Arkademy keeps its own scheme: every rule setting --background outranks :root and .dark", () => {
  const code = arkademy.replace(/\/\*[\s\S]*?\*\//g, "");
  let seen = 0;
  for (const m of code.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/(^|[;\s])--background\s*:/.test(m[2])) continue;
    seen++;
    const selector = m[1].trim();
    assert.match(selector, /^:root(\.dark)?:has\(/, `"${selector}" would not outrank basalt.css`);
  }
  assert.ok(seen >= 2, `only ${seen} --background rules found in the Arkademy sheet`);
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

console.log("basalt theme — status tones");

const FAMILIES = {
  neutral: ["#5D5E67", "#C6C6D0"],
  slate: ["#585E72", "#C0C6DD"],
  indigo: ["#485B99", "#B5C4FF"],
  ember: ["#8F4B39", "#FFB4A1"],
  plum: ["#7B4F7A", "#EAB6E7"],
  green: ["#3A6844", "#A0D3A7"],
  amber: ["#805520", "#F5BC7D"],
  red: ["#BA1A1A", "#FFB4AB"],
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

/** `fg` laid over `bg` at `alpha`, per sRGB channel, as a hex. */
function mix(fg, bg, alpha) {
  const channel = (hex, i) => parseInt(hex.slice(i, i + 2), 16);
  const hex = [1, 3, 5]
    .map((i) => Math.round(alpha * channel(fg, i) + (1 - alpha) * channel(bg, i)).toString(16).padStart(2, "0"))
    .join("");
  return `#${hex}`;
}

test("every tone reads as text on its own 10% tile (AA, 4.5:1)", () => {
  for (const [theme, vars] of [["light", LIGHT], ["dark", DARK]]) {
    for (const family of Object.keys(FAMILIES)) {
      const tone = vars[`--tone-${family}`];
      const tile = mix(tone, vars["--md-surface-container-low"], 0.1);
      const ratio = contrast(tone, tile);
      assert.ok(ratio >= 4.5, `${theme} ${family} on its tile ${tile}: ${ratio.toFixed(2)}:1`);
    }
  }
});

test("Tailwind knows every tone as a color", () => {
  const start = globals.indexOf("@theme inline {");
  assert.ok(start !== -1, "no @theme inline block");
  const theme = globals.slice(start, globals.indexOf("\n}", start));
  for (const family of Object.keys(FAMILIES)) {
    assert.match(theme, new RegExp(`--color-tone-${family}:\\s*var\\(--tone-${family}\\);`));
  }
});

/** The text of `export const NAME … = { … };` in a source file. */
function constant(source, name) {
  const start = source.indexOf(`export const ${name}`);
  assert.ok(start !== -1, `no export const ${name}`);
  return source.slice(start, source.indexOf("};", start));
}
const RAW_HUE = /\b(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/;
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

test("the minimap fills read their family's tone variable", () => {
  const src = constant(nodeStyles, "STATUS_MINIMAP_FILL");
  for (const [status, family] of Object.entries(STATUS_FAMILY)) {
    const row = src.split("\n").find((line) => line.trimStart().startsWith(`${status}:`));
    assert.ok(row && row.includes(`"var(--tone-${family})"`), `${status}: expected var(--tone-${family})`);
  }
});

test("decision statuses and their tiles wear their family's tone", () => {
  const styles = constant(nodeStyles, "DECISION_STATUS_STYLES");
  const tiles = constant(nodeStyles, "DECISION_STATUS_TILE");
  assert.doesNotMatch(styles, RAW_HUE);
  assert.doesNotMatch(tiles, RAW_HUE);
  for (const [status, family] of Object.entries(DECISION_FAMILY)) {
    const row = styles.split("\n").find((line) => line.trimStart().startsWith(`${status}:`));
    assert.ok(row, `no row for ${status}`);
    assert.ok(row.includes(`text-tone-${family}`) && row.includes(`bg-tone-${family}"`), `${status} style`);
    const tile = tiles.split("\n").find((line) => line.trimStart().startsWith(`${status}:`));
    assert.ok(tile, `no tile for ${status}`);
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

if (failures) {
  console.error(`\n${failures} failing`);
  process.exit(1);
}
console.log("\nall passing");
