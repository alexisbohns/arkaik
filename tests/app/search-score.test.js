#!/usr/bin/env node

/**
 * The shared subsequence scorer (lib/utils/search.ts `fuzzyScore`), which now
 * ranks two pickers: `NodeSearchCombobox` (relations, insert-between) and the
 * playlist's Add step list. One scorer, so the ordering cannot mean two things.
 *
 * Transpiled the same way as load-command-palette.js — the module's only import
 * is a type, so this needs no bundler, no DOM and no database.
 */

const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, `.test-build-search-${process.pid}`);

function loadSearch() {
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));

  const source = fs.readFileSync(path.join(ROOT, "lib", "utils", "search.ts"), "utf8");
  const { outputText } = ts.transpileModule(source, {
    fileName: "search.ts",
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });

  const outPath = path.join(BUILD_DIR, "search.js");
  fs.writeFileSync(outPath, outputText);
  delete require.cache[outPath];
  return require(outPath);
}

const { fuzzyScore } = loadSearch();

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL  ${name}`);
    console.error(`        ${error.message}`);
  }
}

console.log("fuzzyScore");

// -1 is the "not a match" signal both call sites filter on; a 0 would survive
// their `>= 0` filter and put every node in the list.
test("a query whose letters are not all present scores -1", () => {
  assert.equal(fuzzyScore("zzz", "Checkout"), -1);
  assert.equal(fuzzyScore("checkz", "Checkout"), -1);
});

test("letters must appear IN ORDER", () => {
  assert.ok(fuzzyScore("cho", "Checkout") >= 0);
  assert.equal(fuzzyScore("ohc", "Checkout"), -1);
});

test("an empty query matches everything", () => {
  assert.ok(fuzzyScore("", "Checkout") >= 0);
  assert.ok(fuzzyScore("   ", "Checkout") >= 0);
});

test("matching is case-insensitive", () => {
  assert.equal(fuzzyScore("CHECK", "checkout"), fuzzyScore("check", "CHECKOUT"));
});

test("an exact match beats every partial one", () => {
  const exact = fuzzyScore("checkout", "checkout");
  assert.ok(exact > fuzzyScore("checkout", "checkout flow"));
  assert.ok(exact > fuzzyScore("check", "checkout"));
});

test("a match at the start beats one in the middle", () => {
  assert.ok(fuzzyScore("col", "Collections") > fuzzyScore("col", "Recolour glyph"));
});

test("a consecutive run beats the same letters scattered", () => {
  assert.ok(fuzzyScore("cart", "Cart") > fuzzyScore("cart", "Create a route"));
});

test("a shorter candidate beats a longer one containing it", () => {
  assert.ok(fuzzyScore("coll", "Collections") > fuzzyScore("coll", "Collections administration screen"));
});

// The call sites search `${node.id} ${node.title}`, so an id-only query has to
// land somewhere >= 0 or typing an id would find nothing.
test("a query can match on the id half of the haystack", () => {
  assert.ok(fuzzyScore("V-checkout", "V-checkout Checkout") >= 0);
});

fs.rmSync(BUILD_DIR, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} failing`);
  process.exit(1);
}
console.log("\nAll search score tests passed.");
