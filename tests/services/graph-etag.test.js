#!/usr/bin/env node

/**
 * The hosted graph API's read validators (lib/services/graph/etag.ts): the
 * `W/"…"` format, the per-route composites, and the weak `If-None-Match`
 * comparison a 304 hangs on.
 *
 * DB-free on purpose. `etag.ts` has no runtime imports — its only import is a
 * `type` — so it transpiles and runs on its own, the way
 * tests/app/changelog-period.test.js loads its module. That keeps these rules
 * pinned by the fast `build` job, not only by the Postgres-backed
 * tests/services/graph-api.test.js, where they are exercised end to end.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, ".test-build-graph-etag");

function loadEtag() {
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));

  const source = fs.readFileSync(path.join(ROOT, "lib", "services", "graph", "etag.ts"), "utf8");
  const { outputText } = ts.transpileModule(source, {
    fileName: "etag.ts",
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });
  fs.writeFileSync(path.join(BUILD_DIR, "etag.js"), outputText);
  return require(path.join(BUILD_DIR, "etag.js"));
}

const {
  formatReadEtag,
  snapshotEtag,
  journalEtag,
  bundleEtag,
  readResponseHeaders,
  ifNoneMatchSatisfied,
} = loadEtag();

let failures = 0;
function assert(cond, message, detail) {
  if (cond) console.log(`PASS: ${message}`);
  else {
    failures++;
    console.error(`FAIL: ${message}${detail === undefined ? "" : ` — ${detail}`}`);
  }
}

const validators = (version, eventCount, qualityEventCount) => ({
  version,
  eventCount,
  qualityEventCount,
});

// --- The format -------------------------------------------------------------
assert(formatReadEtag(["7"]) === 'W/"7"', "one part is a weak, quoted tag");
assert(formatReadEtag(["7", "42"]) === 'W/"7.42"', "parts are joined with a dot");
assert(
  formatReadEtag(["9007199254740993", "0"]) === 'W/"9007199254740993.0"',
  "a bigint past 2^53 survives verbatim — the parts are strings, never Number()ed",
);

// --- The per-route composites ----------------------------------------------
assert(snapshotEtag(validators("3", "12", "4")) === 'W/"3"', "/nodes and /edges validate on the version alone");
assert(journalEtag(validators("3", "12", "4")) === 'W/"3.12"', "/journal and /export add the whole event count");
assert(bundleEtag(validators("3", "12", "4")) === 'W/"3.4"', "the bundle GET adds the quality-decision count only");
assert(
  journalEtag(validators("3", "13", "4")) !== journalEtag(validators("3", "12", "4")) &&
    bundleEtag(validators("3", "13", "4")) === bundleEtag(validators("3", "12", "4")),
  "an append that is not a quality decision moves the journal validator and leaves the bundle's alone",
);
assert(
  bundleEtag(validators("3", "13", "5")) !== bundleEtag(validators("3", "12", "4")),
  "a quality decision moves the bundle validator without a version bump",
);
assert(
  snapshotEtag(validators("4", "12", "4")) !== snapshotEtag(validators("3", "12", "4")),
  "a mutation's version bump moves the snapshot validators",
);

// --- The response headers ---------------------------------------------------
const headers = readResponseHeaders('W/"3.4"');
assert(headers.ETag === 'W/"3.4"', "the ETag header carries the validator");
assert(
  headers["Cache-Control"] === "private, no-cache",
  "private (every body is owner-scoped) and no-cache (revalidate, never reuse blind)",
  headers["Cache-Control"],
);
assert(headers.Vary === "Authorization", "Vary: Authorization — a bearer token selects the owner");

// --- The weak comparison ----------------------------------------------------
assert(ifNoneMatchSatisfied('W/"3.4"', 'W/"3.4"') === true, "the same weak tag matches");
assert(ifNoneMatchSatisfied('"3.4"', 'W/"3.4"') === true, "a strong tag matches its weak twin (weak comparison)");
assert(ifNoneMatchSatisfied('W/"3.4"', '"3.4"') === true, "…and the other way round");
assert(ifNoneMatchSatisfied('w/"3.4"', 'W/"3.4"') === true, "the W/ prefix is case-insensitive");
assert(ifNoneMatchSatisfied('W/"3.5"', 'W/"3.4"') === false, "a different validator does not match");
assert(ifNoneMatchSatisfied('W/"4.4"', 'W/"3.4"') === false, "a moved version does not match");
assert(ifNoneMatchSatisfied('W/"3"', 'W/"3.4"') === false, "a prefix of the tag is not the tag");

// --- Lists, wildcards, and nothing at all -----------------------------------
assert(ifNoneMatchSatisfied('W/"1", W/"3.4"', 'W/"3.4"') === true, "a comma list matches on any member");
assert(
  ifNoneMatchSatisfied('  W/"1" ,   "3.4"  ', 'W/"3.4"') === true,
  "members are trimmed, and may be strong or weak",
);
assert(ifNoneMatchSatisfied('W/"1", W/"2"', 'W/"3.4"') === false, "a list of misses is a miss");
assert(ifNoneMatchSatisfied("*", 'W/"3.4"') === true, "* matches any current representation");
assert(ifNoneMatchSatisfied(null, 'W/"3.4"') === false, "no header never matches — the caller sends the body");
assert(ifNoneMatchSatisfied("", 'W/"3.4"') === false, "an empty header never matches");
assert(ifNoneMatchSatisfied("   ", 'W/"3.4"') === false, "a blank header never matches");
assert(ifNoneMatchSatisfied(",,", 'W/"3.4"') === false, "a list of empty members never matches");
assert(
  ifNoneMatchSatisfied("3.4", 'W/"3.4"') === false,
  "an unquoted value is not an entity-tag — a malformed member simply misses",
);

fs.rmSync(BUILD_DIR, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} graph etag test(s) failed`);
  process.exit(1);
}
console.log("\nAll graph etag tests passed");
