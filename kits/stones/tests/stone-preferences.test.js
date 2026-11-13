#!/usr/bin/env node

/**
 * The reader's stone preference (src/preferences.ts): parsing a stored
 * record key by key, applying it to <html>, and the inline boot script that
 * does the same before first paint.
 *
 * Transpiled like playlist-utils.test.js. preferences.ts imports the generated
 * registry by a relative path (../dist/), so both are transpiled into a build
 * dir with the same src/ and dist/ layout and no alias rewriting is needed.
 */

const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ts = require("typescript");

const ROOT = path.join(__dirname, "..");
const BUILD_DIR = path.join(__dirname, `.test-build-stone-prefs-${process.pid}`);

function transpile(rel, outName) {
  const source = fs.readFileSync(path.join(ROOT, rel), "utf8");
  const { outputText } = ts.transpileModule(source, {
    fileName: path.basename(rel),
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  });
  fs.writeFileSync(path.join(BUILD_DIR, outName), outputText);
}

fs.rmSync(BUILD_DIR, { recursive: true, force: true });
fs.mkdirSync(path.join(BUILD_DIR, "src"), { recursive: true });
fs.mkdirSync(path.join(BUILD_DIR, "dist"), { recursive: true });
fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));
transpile("dist/stones-registry.generated.ts", path.join("dist", "stones-registry.generated.js"));
transpile("src/preferences.ts", path.join("src", "preferences.js"));
const prefs = require(path.join(BUILD_DIR, "src", "preferences.js"));
fs.rmSync(BUILD_DIR, { recursive: true, force: true });

const {
  DEFAULT_STONE_PREFERENCES: D,
  parseStonePreferences,
  applyStonePreferences,
  radiusValue,
  isDefaultStonePreferences,
  stoneBootScript,
  STONE_STORAGE_KEY,
} = prefs;

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

function fakeRoot() {
  const attrs = {};
  const styleValues = {};
  return {
    attrs,
    styleValues,
    setAttribute: (k, v) => (attrs[k] = v),
    style: { setProperty: (k, v) => (styleValues[k] = v) },
  };
}

console.log("stone preferences");

test("defaults are Calacatta, Onyx and 12px", () => {
  assert.deepEqual(D, { light: "calacatta", dark: "onyx", radius: 12 });
  assert.ok(isDefaultStonePreferences(D));
});

test("anything that is not an object falls back to the defaults", () => {
  for (const raw of [null, undefined, "rosa", 7, true]) assert.deepEqual(parseStonePreferences(raw), D);
});

test("a valid record survives as is", () => {
  const p = { light: "rosa", dark: "lava", radius: 18 };
  assert.deepEqual(parseStonePreferences(p), p);
  assert.ok(!isDefaultStonePreferences(p));
});

test("each key degrades on its own", () => {
  assert.deepEqual(parseStonePreferences({ light: "granite", dark: "lava", radius: 4 }), { light: "calacatta", dark: "lava", radius: 4 });
  assert.deepEqual(parseStonePreferences({ light: "onyx", dark: "carrara", radius: 4 }), { light: "calacatta", dark: "onyx", radius: 4 });
  for (const radius of [-1, 19, Number.NaN, "8", null]) {
    assert.equal(parseStonePreferences({ light: "rosa", dark: "lava", radius }).radius, 12, `radius ${String(radius)}`);
  }
  assert.equal(parseStonePreferences({ radius: 7.6 }).radius, 8);
});

test("the top of the radius range is a pill", () => {
  assert.equal(radiusValue(0), "0px");
  assert.equal(radiusValue(12), "12px");
  assert.equal(radiusValue(18), "9999px");
});

test("applying writes both stones and the radius onto the root", () => {
  const root = fakeRoot();
  applyStonePreferences(root, { light: "rosequartz", dark: "amethyst", radius: 18 });
  assert.equal(root.attrs["data-stone-light"], "rosequartz");
  assert.equal(root.attrs["data-stone-dark"], "amethyst");
  assert.equal(root.styleValues["--stone-radius"], "9999px");
});

function runBoot(stored, { throws = false } = {}) {
  const root = fakeRoot();
  const context = {
    localStorage: {
      getItem: (key) => {
        if (throws) throw new Error("denied");
        assert.equal(key, STONE_STORAGE_KEY);
        return stored;
      },
    },
    document: { documentElement: root },
    JSON,
    Math,
  };
  vm.runInNewContext(stoneBootScript(), context);
  return root;
}

test("the boot script applies a stored choice", () => {
  const root = runBoot(JSON.stringify({ light: "travertine", dark: "lava", radius: 18 }));
  assert.equal(root.attrs["data-stone-light"], "travertine");
  assert.equal(root.attrs["data-stone-dark"], "lava");
  assert.equal(root.styleValues["--stone-radius"], "9999px");
});

test("the boot script ignores what it does not recognise", () => {
  const root = runBoot(JSON.stringify({ light: "granite", dark: "carrara", radius: 99 }));
  assert.deepEqual(root.attrs, {});
  assert.deepEqual(root.styleValues, {});
});

test("the boot script never throws", () => {
  assert.doesNotThrow(() => runBoot("{not json"));
  assert.doesNotThrow(() => runBoot(null));
  assert.doesNotThrow(() => runBoot(null, { throws: true }));
});

test("the boot script and the parser agree on every stored record", () => {
  const records = [
    { light: "rosa", dark: "lava", radius: 17.5 },
    { light: "rosa", dark: "lava", radius: 17.9 },
    { light: "rosa", dark: "lava", radius: 17.4 },
    { light: "rosa", dark: "lava", radius: -0.4 },
    { light: "rosa", dark: "lava", radius: 0.5 },
    { light: "granite", dark: "verde", radius: 3 },
    { light: "pumice", dark: "carrara", radius: 99 },
    { light: "carrara" },
    {},
  ];
  for (const record of records) {
    const boot = runBoot(JSON.stringify(record));
    const parsed = fakeRoot();
    applyStonePreferences(parsed, parseStonePreferences(record));
    // A key the boot script leaves unset keeps the server-rendered default.
    const booted = {
      light: boot.attrs["data-stone-light"] ?? D.light,
      dark: boot.attrs["data-stone-dark"] ?? D.dark,
      radius: boot.styleValues["--stone-radius"] ?? radiusValue(D.radius),
    };
    assert.deepEqual(
      booted,
      { light: parsed.attrs["data-stone-light"], dark: parsed.attrs["data-stone-dark"], radius: parsed.styleValues["--stone-radius"] },
      JSON.stringify(record),
    );
  }
});

if (failures) {
  console.error(`\n${failures} failing`);
  process.exit(1);
}
