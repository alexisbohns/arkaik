#!/usr/bin/env node

/**
 * The order of `metadata.values` is a claim (lib/utils/value-order.ts): the
 * weighing panel lists claims in it and the promise's fingerprint hashes it, so
 * the value picker must keep the order the author picked them in.
 *
 * Loads the one-file util with `ts.transpileModule` — it imports nothing.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, ".test-build-value-order");

fs.rmSync(BUILD_DIR, { recursive: true, force: true });
fs.mkdirSync(BUILD_DIR, { recursive: true });
fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));
const source = fs.readFileSync(path.join(ROOT, "lib", "utils", "value-order.ts"), "utf8");
const { outputText } = ts.transpileModule(source, {
  fileName: "value-order.ts",
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
});
fs.writeFileSync(path.join(BUILD_DIR, "value-order.js"), outputText);
const { keepClaimOrder } = require(path.join(BUILD_DIR, "value-order.js"));

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`PASS: ${name}`);
  else {
    failures++;
    console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// The model's canonical order puts `saves-time` (functional) before `nostalgia` (emotional).
const CANON = ["saves-time", "connects", "reduces-anxiety", "nostalgia"];

check("a first pick is the list", eq(keepClaimOrder([], new Set(["nostalgia"]), CANON), ["nostalgia"]));
check("a second pick goes LAST, even when the model files it earlier", eq(keepClaimOrder(["nostalgia"], new Set(["nostalgia", "saves-time"]), CANON), ["nostalgia", "saves-time"]));
check("removing the first promotes the second", eq(keepClaimOrder(["nostalgia", "saves-time"], new Set(["saves-time"]), CANON), ["saves-time"]));
check("the rest keep their places when one in the middle leaves", eq(keepClaimOrder(["connects", "nostalgia", "saves-time"], new Set(["connects", "saves-time"]), CANON), ["connects", "saves-time"]));
check("several added at once take the model's order, after what was there", eq(keepClaimOrder(["nostalgia"], new Set(["nostalgia", "reduces-anxiety", "saves-time"]), CANON), ["nostalgia", "saves-time", "reduces-anxiety"]));
check("nothing changed is the same list", eq(keepClaimOrder(["connects", "saves-time"], new Set(["connects", "saves-time"]), CANON), ["connects", "saves-time"]));
check("it does not mutate its input", (() => { const input = ["nostalgia"]; keepClaimOrder(input, new Set(["nostalgia", "connects"]), CANON); return eq(input, ["nostalgia"]); })());

fs.rmSync(BUILD_DIR, { recursive: true, force: true });
if (failures > 0) {
  console.log(`\n${failures} value-order test(s) failed.`);
  process.exit(1);
}
console.log("\nAll value-order tests passed.");
