#!/usr/bin/env node

/**
 * The playlist editor's pure half (lib/utils/playlist.ts): moving an entry
 * inside its own list, and the count a collapsed condition or junction shows.
 *
 * Transpiled the same way as load-command-palette.js — the module has no value
 * imports, so this needs no bundler, no DOM and no database.
 */

const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, `.test-build-playlist-${process.pid}`);

function loadPlaylist() {
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));

  const source = fs.readFileSync(path.join(ROOT, "lib", "utils", "playlist.ts"), "utf8");
  const { outputText } = ts.transpileModule(source, {
    fileName: "playlist.ts",
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });

  const outPath = path.join(BUILD_DIR, "playlist.js");
  fs.writeFileSync(outPath, outputText);
  delete require.cache[outPath];
  return require(outPath);
}

const { moveEntry, countBranchChildren, describeBranchCount } = loadPlaylist();

const view = (id) => ({ type: "view", view_id: id });
const titles = (entries) => entries.map((entry) => entry.view_id);

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

console.log("moveEntry");

test("moves an entry down", () => {
  const entries = [view("a"), view("b"), view("c")];
  assert.deepEqual(titles(moveEntry(entries, 0, 2)), ["b", "c", "a"]);
});

test("moves an entry up", () => {
  const entries = [view("a"), view("b"), view("c")];
  assert.deepEqual(titles(moveEntry(entries, 2, 0)), ["c", "a", "b"]);
});

test("a one-step nudge swaps neighbours", () => {
  const entries = [view("a"), view("b"), view("c")];
  assert.deepEqual(titles(moveEntry(entries, 1, 2)), ["a", "c", "b"]);
});

test("leaves the input untouched", () => {
  const entries = [view("a"), view("b")];
  moveEntry(entries, 0, 1);
  assert.deepEqual(titles(entries), ["a", "b"]);
});

// The identity return is the contract, not an optimization: the caller writes
// the whole node's metadata, so a fresh-but-equal array costs a round trip.
test("returns the SAME array for a move to the same position", () => {
  const entries = [view("a"), view("b")];
  assert.equal(moveEntry(entries, 1, 1), entries);
});

test("returns the SAME array when the target is out of range", () => {
  const entries = [view("a"), view("b")];
  assert.equal(moveEntry(entries, 0, 2), entries);
  assert.equal(moveEntry(entries, 0, -1), entries);
});

test("returns the SAME array when the source is out of range", () => {
  const entries = [view("a"), view("b")];
  assert.equal(moveEntry(entries, 5, 0), entries);
  assert.equal(moveEntry(entries, -1, 0), entries);
});

test("an empty list cannot be reordered", () => {
  const entries = [];
  assert.equal(moveEntry(entries, 0, 0), entries);
});

console.log("countBranchChildren");

test("a condition always has two branches", () => {
  const entry = { type: "condition", label: "Has account?", if_true: [view("a")], if_false: [] };
  assert.deepEqual(countBranchChildren(entry), { groups: 2, entries: 1 });
});

test("a junction counts its cases and their entries", () => {
  const entry = {
    type: "junction",
    label: "Payment",
    cases: [
      { label: "Card", entries: [view("a"), view("b")] },
      { label: "Voucher", entries: [view("c")] },
    ],
  };
  assert.deepEqual(countBranchChildren(entry), { groups: 2, entries: 3 });
});

// Direct children only: a shut row answers "how much unfolds here", not "how
// big is this subtree".
test("nested entries are not counted", () => {
  const inner = { type: "condition", label: "Inner", if_true: [view("x"), view("y")], if_false: [] };
  const entry = { type: "condition", label: "Outer", if_true: [inner], if_false: [] };
  assert.deepEqual(countBranchChildren(entry), { groups: 2, entries: 1 });
});

test("a view or flow entry branches into nothing", () => {
  assert.equal(countBranchChildren(view("a")), null);
  assert.equal(countBranchChildren({ type: "flow", flow_id: "F-x" }), null);
});

test("missing branch arrays count as empty", () => {
  assert.deepEqual(countBranchChildren({ type: "condition", label: "c" }), { groups: 2, entries: 0 });
  assert.deepEqual(countBranchChildren({ type: "junction", label: "j" }), { groups: 0, entries: 0 });
});

console.log("describeBranchCount");

test("a condition reads in branches", () => {
  const entry = { type: "condition", label: "c", if_true: [view("a")], if_false: [view("b"), view("c")] };
  assert.equal(describeBranchCount(entry), "2 branches · 3 entries");
});

test("a junction reads in cases", () => {
  const entry = { type: "junction", label: "j", cases: [{ label: "Card", entries: [view("a")] }] };
  assert.equal(describeBranchCount(entry), "1 case · 1 entry");
});

// Every noun here pluralises irregularly; appending `s` gets all three wrong.
test("plurals are not built by appending s", () => {
  const entry = { type: "junction", label: "j", cases: [] };
  assert.equal(describeBranchCount(entry), "0 cases · 0 entries");
  assert.ok(!describeBranchCount(entry).includes("casess"));

  const condition = { type: "condition", label: "c", if_true: [], if_false: [] };
  assert.equal(describeBranchCount(condition), "2 branches · 0 entries");
});

test("a view entry has nothing to say", () => {
  assert.equal(describeBranchCount(view("a")), null);
});

fs.rmSync(BUILD_DIR, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} failing`);
  process.exit(1);
}
console.log("\nAll playlist util tests passed.");
