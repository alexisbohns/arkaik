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

// =========================== filterFindings ==================================

const { filterFindings, groupByPriority, EMPTY_QUALITY_FILTERS, deriveQualityMatrix } = loadQuality();

assert(
  filterFindings(rows, EMPTY_QUALITY_FILTERS).length === 246,
  "the empty filter set narrows nothing",
);

const critical = filterFindings(rows, { ...EMPTY_QUALITY_FILTERS, severity: "critical" });
assert(
  critical.every((row) => row.severity === "critical") && critical.length > 0,
  "severity narrows to that severity",
);

const web = filterFindings(rows, { ...EMPTY_QUALITY_FILTERS, surface: "web" });
assert(web.every((row) => row.surface === "web") && web.length > 0, "surface narrows to that surface");

const both = filterFindings(rows, { ...EMPTY_QUALITY_FILTERS, severity: "critical", surface: "web" });
assert(
  both.every((row) => row.severity === "critical" && row.surface === "web"),
  "severity and surface compose",
);
assert(both.length <= Math.min(critical.length, web.length), "composing filters never widens");

// Search reaches title, criterion id and evidence.
const searched = filterFindings(rows, { ...EMPTY_QUALITY_FILTERS, search: "SEC-03" });
assert(searched.length > 0, "search finds by criterion id");
assert(
  filterFindings(rows, { ...EMPTY_QUALITY_FILTERS, search: "zzzznotpresent" }).length === 0,
  "a search matching nothing yields nothing",
);
assert(
  filterFindings(rows, { ...EMPTY_QUALITY_FILTERS, search: "sec-03" }).length === searched.length,
  "search is case-insensitive",
);

// The cell filter must agree with the matrix that drew the cell.
const matrix = deriveQualityMatrix({ quality: section }, pack);
const cellRows = filterFindings(rows, { ...EMPTY_QUALITY_FILTERS, cell: "SEC|web" });
const cellCounts = matrix.matrix.SEC.web.findings;
const openCellRows = cellRows.filter((row) => row.open);
assert(
  openCellRows.filter((row) => row.severity === "high").length === cellCounts.high &&
    openCellRows.filter((row) => row.severity === "medium").length === cellCounts.medium,
  "the cell filter selects exactly the open findings deriveQualityMatrix counted in that cell",
);

// Status: the board can show resolved work, the matrix never counts it.
const resolved = filterFindings(rows, { ...EMPTY_QUALITY_FILTERS, status: "resolved" });
assert(resolved.every((row) => row.status === "resolved"), "status narrows to that status");

// =========================== groupByPriority =================================

const groups = groupByPriority(rows);
assert(groups.length === 4, "there are always four priority groups");
assert(
  groups.map((group) => group.priority).join(",") === "P0,P1,P2,P3",
  "groups are ordered P0 first",
);
assert(
  groups.reduce((total, group) => total + group.rows.length, 0) === rows.length,
  "every row lands in exactly one group",
);

const emptyGroups = groupByPriority([]);
assert(
  emptyGroups.length === 4 && emptyGroups.every((group) => group.rows.length === 0),
  "empty groups are retained so the board can say 'none at this priority'",
);

console.log(failures === 0 ? "\nAll quality projections OK" : `\n${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
