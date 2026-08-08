#!/usr/bin/env node

/**
 * The Changelog's year/month filter (lib/utils/changelog-period.ts) — the one
 * piece of that page with logic worth pinning: reading a period off an ISO
 * stamp without a timezone, and never dropping a stamp it cannot read.
 *
 * Transpiled the same way as load-command-palette.js: the module has no
 * imports, so this needs no bundler and no database.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_DIR = path.join(__dirname, ".test-build-changelog-period");

function loadPeriod() {
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.writeFileSync(path.join(BUILD_DIR, "package.json"), JSON.stringify({ type: "commonjs" }));

  const source = fs.readFileSync(path.join(ROOT, "lib", "utils", "changelog-period.ts"), "utf8");
  const { outputText } = ts.transpileModule(source, {
    fileName: "changelog-period.ts",
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });
  fs.writeFileSync(path.join(BUILD_DIR, "changelog-period.js"), outputText);
  return require(path.join(BUILD_DIR, "changelog-period.js"));
}

const { MONTH_LABELS, periodOf, matchesPeriod, listYears } = loadPeriod();

let failures = 0;
function assert(cond, message) {
  if (cond) console.log(`PASS: ${message}`);
  else {
    failures++;
    console.error(`FAIL: ${message}`);
  }
}

assert(MONTH_LABELS.length === 12 && MONTH_LABELS[0] === "January", "twelve months, January first");

// --- periodOf ---------------------------------------------------------------
assert(
  JSON.stringify(periodOf("2026-03-14T09:00:00.000Z")) === JSON.stringify({ year: 2026, month: 2 }),
  "an ISO stamp yields its calendar year and a zero-based month",
);
assert(
  JSON.stringify(periodOf("2026-01-01T00:30:00.000Z")) === JSON.stringify({ year: 2026, month: 0 }),
  "just past midnight UTC on Jan 1 stays January — no timezone rewind",
);
assert(periodOf("not-a-date") === null, "an unreadable stamp yields null");
assert(periodOf("2026-13-01T00:00:00Z") === null, "a month outside 1-12 yields null");

// --- matchesPeriod ----------------------------------------------------------
const MARCH_2026 = "2026-03-14T09:00:00.000Z";
assert(matchesPeriod(MARCH_2026, { year: null, month: null }), "no filter matches everything");
assert(matchesPeriod(MARCH_2026, { year: 2026, month: null }), "the right year matches");
assert(!matchesPeriod(MARCH_2026, { year: 2025, month: null }), "the wrong year does not");
assert(matchesPeriod(MARCH_2026, { year: null, month: 2 }), "month narrows on its own — 'every March'");
assert(!matchesPeriod(MARCH_2026, { year: null, month: 3 }), "the wrong month does not");
assert(matchesPeriod(MARCH_2026, { year: 2026, month: 2 }), "year and month together match");
assert(!matchesPeriod(MARCH_2026, { year: 2026, month: 4 }), "…and disagree the moment either does");
assert(
  matchesPeriod("not-a-date", { year: 2026, month: 2 }),
  "an unreadable stamp survives every filter rather than vanishing",
);

// --- listYears --------------------------------------------------------------
assert(
  JSON.stringify(listYears(["2024-05-01T00:00:00Z", "2026-01-01T00:00:00Z", "2024-11-01T00:00:00Z"])) ===
    JSON.stringify([2026, 2024]),
  "years are deduplicated and newest first",
);
assert(JSON.stringify(listYears(["nope"])) === JSON.stringify([]), "unreadable stamps offer no year");
assert(JSON.stringify(listYears([])) === JSON.stringify([]), "no timestamps, no years");

fs.rmSync(BUILD_DIR, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} changelog period test(s) failed`);
  process.exit(1);
}
console.log("\nAll changelog period tests passed");
