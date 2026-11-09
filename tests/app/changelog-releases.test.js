#!/usr/bin/env node

/**
 * The Changelog's selected release (lib/utils/changelog-releases.ts): which
 * release the detail column shows, given what the URL asks for and what the
 * filters left in the list. Transpiled like changelog-period.test.js — the
 * module has no imports, so no bundler and no alias table.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, ".test-build-changelog-releases");

function load() {
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));

  const source = fs.readFileSync(path.join(ROOT, "lib", "utils", "changelog-releases.ts"), "utf8");
  const { outputText } = ts.transpileModule(source, {
    fileName: "changelog-releases.ts",
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });
  fs.writeFileSync(path.join(BUILD_DIR, "changelog-releases.js"), outputText);
  return require(path.join(BUILD_DIR, "changelog-releases.js"));
}

const { UNRELEASED_KEY, RELEASE_PARAM, resolveSelectedRelease } = load();

let failures = 0;
function assert(cond, message) {
  if (cond) console.log(`PASS: ${message}`);
  else {
    failures++;
    console.error(`FAIL: ${message}`);
  }
}

assert(UNRELEASED_KEY === "unreleased", "the unreleased entry's key is 'unreleased'");
assert(RELEASE_PARAM === "release", "the selection lives in ?release=");

const keys = [UNRELEASED_KEY, "v1.4.0", "v1.3.2"];

assert(resolveSelectedRelease(keys, "v1.3.2") === "v1.3.2", "a requested key that is listed is selected");
assert(resolveSelectedRelease(keys, null) === UNRELEASED_KEY, "no request selects the first row");
assert(
  resolveSelectedRelease(keys, "v0.9.0") === UNRELEASED_KEY,
  "a request the filters hid (or a stale link) falls back to the first row",
);
assert(resolveSelectedRelease([], "v1.4.0") === null, "an empty list selects nothing");
assert(resolveSelectedRelease([], null) === null, "an empty list with no request selects nothing");
assert(resolveSelectedRelease(["v2.0.0"], "") === "v2.0.0", "an empty ?release= is treated as no request");

fs.rmSync(BUILD_DIR, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nAll changelog-releases tests passed.");
