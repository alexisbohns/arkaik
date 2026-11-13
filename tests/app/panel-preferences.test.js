#!/usr/bin/env node
/**
 * The panel-look preference: the defensive parser, and the inline script that
 * puts the look on <html> before first paint. Both live in
 * lib/config/panel-preferences.ts, which imports nothing, so it is transpiled
 * and required as is.
 *
 * The script is the part worth pinning: it runs before React, in every page,
 * with whatever is in storage, so it must never throw and must only ever write
 * the one non-default value it knows.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ts = require("typescript");

const SOURCE = path.join(__dirname, "..", "..", "lib", "config", "panel-preferences.ts");
const { outputText } = ts.transpileModule(fs.readFileSync(SOURCE, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
});
const mod = { exports: {} };
new Function("module", "exports", outputText)(mod, mod.exports);
const { parsePanelPreferences, PANEL_PREFERENCES_SCRIPT, PANEL_PREFERENCES_KEY } = mod.exports;

let failures = 0;
function assert(cond, message) {
  if (cond) console.log(`PASS: ${message}`);
  else {
    failures++;
    console.log(`FAIL: ${message}`);
  }
}

assert(parsePanelPreferences(null).look === "expressive", "nothing stored is Expressive, the default");
assert(parsePanelPreferences('{"look":"calm"}').look === "calm", "a stored Calm look reads back");
assert(parsePanelPreferences('{"look":"loud"}').look === "expressive", "an unknown look falls back to the default");
assert(parsePanelPreferences("not json").look === "expressive", "garbage in storage falls back to the default");
assert(parsePanelPreferences("null").look === "expressive", "a stored null falls back to the default");

/** Runs the inline script against a fake document and storage; returns the attributes it set. */
function runScript(stored, { throwOnRead = false } = {}) {
  const attributes = {};
  const sandbox = {
    localStorage: {
      getItem(key) {
        if (throwOnRead) throw new Error("SecurityError");
        return key === PANEL_PREFERENCES_KEY ? stored : null;
      },
    },
    document: { documentElement: { setAttribute: (name, value) => (attributes[name] = value) } },
  };
  vm.runInNewContext(PANEL_PREFERENCES_SCRIPT, sandbox);
  return attributes;
}

assert(runScript('{"look":"calm"}')["data-panel-look"] === "calm", "the script puts a stored Calm look on <html>");
assert(!("data-panel-look" in runScript(null)), "with nothing stored, the script writes no attribute (Expressive)");
assert(!("data-panel-look" in runScript('{"look":"expressive"}')), "Expressive is the absence of the attribute");
assert(!("data-panel-look" in runScript("{oops")), "corrupt storage writes nothing and does not throw");
assert(!("data-panel-look" in runScript(null, { throwOnRead: true })), "storage that throws (private mode) is survived");

if (failures > 0) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nAll panel-preferences tests passed");
