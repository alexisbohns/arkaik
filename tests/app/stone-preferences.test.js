#!/usr/bin/env node

/**
 * The reader's stone preference (lib/stones/preferences.ts): parsing a stored
 * record key by key, applying it to <html>, and the inline boot script that
 * does the same before first paint.
 *
 * Transpiled like playlist-utils.test.js. preferences.ts imports the generated
 * registry by a relative path, so both are transpiled into the same build dir
 * and no alias rewriting is needed.
 */

const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ts = require("typescript");

const ROOT = path.join(__dirname, "..", "..");
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
fs.mkdirSync(BUILD_DIR, { recursive: true });
fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));
transpile("lib/stones/stones-registry.generated.ts", "stones-registry.generated.js");
transpile("lib/stones/preferences.ts", "preferences.js");
const prefs = require(path.join(BUILD_DIR, "preferences.js"));
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

if (failures) {
  console.error(`\n${failures} failing`);
  process.exit(1);
}
