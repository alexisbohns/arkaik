#!/usr/bin/env node

/**
 * Quality page projections (lib/utils/quality.ts), replayed against the Pebbles
 * pilot — the same golden that guards deriveQualityMatrix in tests/schema.
 *
 * The fixture's section carries no library on purpose: the pack is loaded from
 * packages/kritik-library/framework.json and passed explicitly, exactly as the
 * app does when a bundle keeps its pack as a sidecar.
 */

const fs = require("fs");
const path = require("path");
const { loadQuality } = require("./load-quality");

const ROOT = path.join(__dirname, "..", "..");
const fixture = JSON.parse(
  fs.readFileSync(path.join(ROOT, "tests/fixtures/quality/pilot-2026-08.json"), "utf8"),
);
const pack = JSON.parse(
  fs.readFileSync(path.join(ROOT, "packages/kritik-library/framework.json"), "utf8"),
);
const section = fixture.section;

const { buildFindingRows, severityOf, priorityOf } = loadQuality();

let failures = 0;
function assert(cond, message) {
  if (cond) console.log(`PASS: ${message}`);
  else {
    failures++;
    console.log(`FAIL: ${message}`);
  }
}

// =========================== buildFindingRows ================================

const rows = buildFindingRows(section, pack);

assert(rows.length === 246, "every finding produces a row (246)");

const derivedMismatches = fixture.expected_derived.filter((want) => {
  const row = rows.find((candidate) => candidate.id === want.id);
  return !row || row.severity !== want.severity || row.priority !== want.priority;
});
assert(
  derivedMismatches.length === 0,
  `severity + priority match the pilot's stored values for all ${fixture.expected_derived.length} findings`,
);

const first = rows.find((row) => row.id === "F-2026-08-SEC-supabase-01");
assert(first.domain === "SEC", "a row carries its criterion's domain code");
assert(first.risk === first.impact * first.likelihood, "risk is impact x likelihood");
assert(first.open === true, "an open finding reads as open");
assert(Array.isArray(first.nodeIds), "nodeIds is always an array, never undefined");

const linked = rows.filter((row) => row.nodeIds.length > 0);
assert(linked.length === 29, "29 rows carry linked node ids");

// A criterion id the pack does not define resolves to no domain, and the row
// still exists — the matrix cannot place it, the board must still list it.
const orphanRows = buildFindingRows(
  { findings: [{ id: "F-x", criterion_id: "ZZZ-99", surface: "web", title: "t", detail: "d", evidence: "e", impact: 3, likelihood: 3, cost: "M", status: "open" }] },
  pack,
);
assert(orphanRows.length === 1, "a finding whose criterion is unknown still produces a row");
assert(orphanRows[0].domain === "", "an unresolvable criterion yields an empty domain code");
assert(orphanRows[0].severity === severityOf(orphanRows[0], pack), "an orphan row is still scored");
assert(orphanRows[0].priority === priorityOf(orphanRows[0], pack), "an orphan row is still prioritised");

// Degradation: no library at all.
const bare = buildFindingRows(section, undefined);
assert(bare.length === 246, "rows build with no library at all");
assert(bare[0].criterionName !== undefined, "criterionName is defined even with no library");

// Absent section.
assert(buildFindingRows(undefined, pack).length === 0, "an absent section yields no rows");

console.log(failures === 0 ? "\nAll quality projections OK" : `\n${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
