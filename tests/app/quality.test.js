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

const { buildFindingRows, severityOf, priorityOf, resolveKritikLibrary } = loadQuality();

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

// NaN is a number to `typeof`, and a NaN risk renders as "NaN" and quietly
// disables the sort's risk tiebreak, since every comparison against it is false.
const nanRows = buildFindingRows(
  { findings: [{ id: "F-nan", criterion_id: "SEC-01", surface: "web", title: "t", detail: "d", evidence: "e", impact: NaN, likelihood: 3, cost: "M", status: "open" }] },
  pack,
);
assert(nanRows[0].impact === 0, "a NaN impact scores 0 rather than propagating");
assert(nanRows[0].risk === 0, "risk stays finite when a finding carries garbage");

// Degradation, lane 1: no library at all. Rows still build, but every one of
// them loses its domain, which is exactly why the page never calls this path
// directly — pinned here so the difference from the synthesized pack is visible.
const bare = buildFindingRows(section, undefined);
assert(bare.length === 246, "rows build with no library at all");
assert(bare[0].criterionName !== undefined, "criterionName is defined even with no library");
assert(bare.every((row) => row.domain === ""), "with no library at all every row loses its domain code");

// Degradation, lane 2: the path the page takes. A bundle whose pack lives
// outside the repo gets a library synthesized from the criterion ids
// themselves, and the domain axis has to survive that — `SEC-03` still means
// `SEC`, so the domain filter and the cell filter keep working.
const synthesized = resolveKritikLibrary(section, undefined);
const synthRows = buildFindingRows(section, synthesized);
assert(synthRows.length === 246, "rows build against a synthesized library");
assert(
  [...new Set(synthRows.map((row) => row.domain))].sort().join(",") ===
    "A11Y,AGT,ARC,GDP,PLT,PRF,PRV,REL,SAF,SEC,TST",
  "a synthesized library resolves the pilot's eleven real domain codes",
);

// Absent section.
assert(buildFindingRows(undefined, pack).length === 0, "an absent section yields no rows");

// =========================== filterFindings ==================================

const { filterFindings, EMPTY_QUALITY_FILTERS, deriveQualityMatrix, cellKey, parseCellKey } =
  loadQuality();

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

const p0 = filterFindings(rows, { ...EMPTY_QUALITY_FILTERS, priority: "P0" });
assert(p0.every((row) => row.priority === "P0") && p0.length > 0, "priority narrows to that lane");
assert(p0.length === rows.filter((row) => row.priority === "P0").length, "priority keeps every row in that lane");

const sec = filterFindings(rows, { ...EMPTY_QUALITY_FILTERS, domain: "SEC" });
assert(sec.every((row) => row.domain === "SEC") && sec.length > 0, "domain narrows to that domain");
assert(sec.length === rows.filter((row) => row.domain === "SEC").length, "domain keeps every row in that domain");

// The domain axis has to survive the synthesized-library path too: with no
// pack the codes come off the criterion ids, and a filter that only worked
// against the shipped pack would empty the board for a sidecar bundle.
const synthSec = filterFindings(synthRows, { ...EMPTY_QUALITY_FILTERS, domain: "SEC" });
assert(
  synthSec.length === sec.length && synthSec.every((row) => row.domain === "SEC"),
  "the domain filter works off a synthesized library, not just the shipped pack",
);
assert(
  filterFindings(bare, { ...EMPTY_QUALITY_FILTERS, domain: "SEC" }).length === 0,
  "with no library at all the domain filter matches nothing — the reason the page resolves one first",
);

// `useQualityFilters` hydrates the set from URL search params, so a key that
// was never applied is simply absent. Absent has to read as "do not narrow";
// it used to throw off `filters.search.trim()`.
assert(filterFindings(rows, {}).length === rows.length, "a filter set with no keys at all narrows nothing");
const noSearch = { ...EMPTY_QUALITY_FILTERS };
delete noSearch.search;
assert(
  filterFindings(rows, noSearch).length === rows.length,
  "a filter set carrying no `search` narrows nothing rather than throwing",
);

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

// The cell filter must agree with the matrix that drew the cell — on the whole
// tally, not just the severities that happen to be nonzero in one cell.
const matrix = deriveQualityMatrix({ quality: section }, pack);
const CELL_SEVERITIES = ["critical", "high", "medium", "low"];
const openInCell = (domain, surface) =>
  filterFindings(rows, { ...EMPTY_QUALITY_FILTERS, cell: cellKey(domain, surface) }).filter((row) => row.open);

const cellMismatches = [];
let cellsChecked = 0;
for (const domain of matrix.domains) {
  for (const surface of matrix.surfaces) {
    const cell = matrix.matrix[domain]?.[surface];
    if (!cell) continue;
    cellsChecked++;
    const open = openInCell(domain, surface);
    const tally = CELL_SEVERITIES.reduce((total, severity) => total + cell.findings[severity], 0);
    if (open.length !== tally) cellMismatches.push(`${domain}|${surface} total`);
    for (const severity of CELL_SEVERITIES) {
      if (open.filter((row) => row.severity === severity).length !== cell.findings[severity]) {
        cellMismatches.push(`${domain}|${surface} ${severity}`);
      }
    }
  }
}
assert(cellsChecked === 55, "every cell of the pilot's 11 x 5 matrix was cross-checked");
assert(
  cellMismatches.length === 0,
  `the cell filter selects exactly the open findings deriveQualityMatrix counted, in all ${cellsChecked} cells`,
);

// And explicitly on a cell that actually holds a critical, found by scanning
// rather than guessed: a cross-check whose only cell has no criticals cannot
// catch a severity the filter drops.
const criticalCell = matrix.domains
  .flatMap((domain) => matrix.surfaces.map((surface) => ({ domain, surface, cell: matrix.matrix[domain]?.[surface] })))
  .find((candidate) => candidate.cell && candidate.cell.findings.critical > 0);
assert(criticalCell !== undefined, "the pilot has a cell holding an open critical to cross-check");
const criticalCellRows = openInCell(criticalCell.domain, criticalCell.surface);
assert(
  criticalCellRows.length ===
    CELL_SEVERITIES.reduce((total, severity) => total + criticalCell.cell.findings[severity], 0),
  "the critical cell's row count is the sum of its four severity counts",
);
for (const severity of CELL_SEVERITIES) {
  assert(
    criticalCellRows.filter((row) => row.severity === severity).length === criticalCell.cell.findings[severity],
    `the critical cell agrees with the matrix on ${severity}`,
  );
}

// =========================== cellKey / parseCellKey ==========================

assert(cellKey("SEC", "web") === "SEC|web", "a cell key is domain, pipe, surface");
const roundTrip = parseCellKey(cellKey("A11Y", "ios"));
assert(roundTrip.domain === "A11Y" && roundTrip.surface === "ios", "a cell key round-trips");
assert(parseCellKey(null) === null, "no cell key is no cell");
assert(parseCellKey("SEC") === null, "a key with no separator is not a cell");
assert(parseCellKey("|web") === null, "a key with no domain is not a cell");
assert(parseCellKey("SEC|") === null, "a key with no surface is not a cell");

// A garbled key has to disable the cell filter, not blank the board: the key
// travels in the URL, where anyone can mangle it, and a page that answers a
// typo with zero findings reads as a page that failed to load.
assert(
  filterFindings(rows, { ...EMPTY_QUALITY_FILTERS, cell: "SEC" }).length === rows.length,
  "a garbled cell key disables the cell filter rather than emptying the board",
);

// =========================== sortFindings ====================================

const inOrder = (list, key) => list.every((row, index) => index === 0 || key(list[index - 1]).localeCompare(key(row)) <= 0);
const severityRank = (row) => ["critical", "high", "medium", "low", "info"].indexOf(row.severity);
const sortedBy = (sort) => filterFindings(rows, { ...EMPTY_QUALITY_FILTERS, sort });

const bySeverity = sortedBy("severity");
assert(
  bySeverity.length === rows.length && new Set(bySeverity.map((row) => row.id)).size === rows.length,
  "sorting is a permutation of the rows, never a filter",
);
assert(
  bySeverity.every((row, index) => index === 0 || severityRank(bySeverity[index - 1]) <= severityRank(row)),
  "the severity sort puts the worst severity first",
);
assert(
  bySeverity.every(
    (row, index) =>
      index === 0 ||
      severityRank(bySeverity[index - 1]) < severityRank(row) ||
      bySeverity[index - 1].risk >= row.risk,
  ),
  "inside a severity, the higher risk comes first",
);
assert(inOrder(sortedBy("surface"), (row) => row.surface), "the surface sort groups by surface, A to Z");
assert(inOrder(sortedBy("domain"), (row) => row.domain), "the domain sort groups by domain, A to Z");
assert(inOrder(sortedBy("priority"), (row) => row.priority), "the priority sort runs P0 to P3");
assert(
  new Set(["severity", "priority", "surface", "domain"].map((sort) => sortedBy(sort).map((row) => row.id).join(","))).size === 4,
  "each of the four sort modes yields a different order — none of them is inert",
);
assert(
  sortedBy("severity").map((row) => row.id).join(",") === bySeverity.map((row) => row.id).join(","),
  "the id tiebreak makes the order stable across runs",
);

// Status: the board can show resolved work, the matrix never counts it.
const resolved = filterFindings(rows, { ...EMPTY_QUALITY_FILTERS, status: "resolved" });
assert(resolved.every((row) => row.status === "resolved"), "status narrows to that status");

// The two filter sets are not the same set, and the difference is the point:
// EMPTY narrows nothing (three panels borrow it purely for the comparator),
// DEFAULT is what the board opens on — the triage queue, minus decided work.
const { DEFAULT_QUALITY_FILTERS } = loadQuality();
assert(EMPTY_QUALITY_FILTERS.status === "all", "EMPTY still narrows nothing on status");
assert(DEFAULT_QUALITY_FILTERS.status === "open", "the board's default narrows to open");
const defaulted = filterFindings(rows, DEFAULT_QUALITY_FILTERS);
assert(defaulted.every((row) => row.open), "the default set hides every decided finding");
assert(
  defaulted.length === filterFindings(rows, EMPTY_QUALITY_FILTERS).filter((row) => row.open).length,
  "and hides nothing else — same rows the open predicate keeps",
);
assert(
  defaulted.map((row) => row.id).join(",") ===
    filterFindings(rows, { ...DEFAULT_QUALITY_FILTERS, sort: "priority" }).map((row) => row.id).join(","),
  "the default sort is still priority — narrowing on status did not reorder the board",
);


// =========================== buildCellCriteria ===============================

const { buildCellCriteria, buildNodeFindingIndex, buildSurfaceGauges, buildSurfaceTitles } = loadQuality();

const secWeb = buildCellCriteria(section, pack, "SEC", "web");
assert(
  secWeb.length === matrix.matrix.SEC.web.criteria,
  "the cell's criterion rows match the count deriveQualityMatrix reported",
);
assert(
  secWeb.every((row) => row.level >= 0 && row.level <= 4),
  "every criterion row carries a maturity level in range",
);
assert(secWeb.every((row) => typeof row.criterionId === "string"), "every row names its criterion");
assert(
  buildCellCriteria(section, pack, "SEC", "nonexistent-surface").length === 0,
  "a surface nothing was scored on yields no criterion rows",
);

// deriveQualityMatrix clamps a level before it scores. Unclamped here, a
// `level: 7` would read "7" in the strip beside the cell the matrix had
// already scored 100/A.
const outOfRange = (level) =>
  buildCellCriteria(
    { assessments: [{ criterion_id: "SEC-01", surface: "web", level, evidence: "e", audit_id: "a", ts: "t" }], findings: [] },
    pack,
    "SEC",
    "web",
  )[0].level;
assert(outOfRange(7) === 4, "a level above the scale is clamped to 4, the way the matrix clamps it");
assert(outOfRange(-3) === 0, "a level below the scale is clamped to 0, the way the matrix clamps it");

// =========================== buildNodeFindingIndex ===========================

const nodeIndex = buildNodeFindingIndex(section, pack);
// 34 is nodes, not findings: 29 findings carry `node_ids`, and between them
// they name 34 distinct nodes. Pinned so a dedupe or a key regression shows up
// as a number rather than as a still-passing `> 0`.
assert(nodeIndex.size === 34, "the pilot's 29 linked findings name 34 distinct nodes");

const profiles = nodeIndex.get("DM-profiles");
assert(profiles !== undefined, "a node named by a finding is in the index");
assert(profiles.total > 0, "an indexed node has at least one open finding");
assert(
  profiles.counts[profiles.worst] > 0,
  "worst names a severity the node actually has",
);
assert(
  ["critical", "high", "medium", "low", "info"].indexOf(profiles.worst) ===
    Math.min(
      ...["critical", "high", "medium", "low", "info"]
        .map((severity, index) => (profiles.counts[severity] > 0 ? index : 99)),
    ),
  "worst is the most severe severity present",
);

// Only open findings decorate a node — a resolved finding is history.
const resolvedOnly = buildNodeFindingIndex(
  {
    findings: [
      { id: "F-r", criterion_id: "SEC-01", surface: "web", title: "t", detail: "d", evidence: "e", impact: 5, likelihood: 5, cost: "M", status: "resolved", node_ids: ["V-x"] },
    ],
  },
  pack,
);
assert(resolvedOnly.size === 0, "a resolved finding never decorates a node");

const linkedFinding = (nodeIds) => ({
  findings: [
    { id: "F-n", criterion_id: "SEC-01", surface: "web", title: "t", detail: "d", evidence: "e", impact: 5, likelihood: 5, cost: "M", status: "open", node_ids: nodeIds },
  ],
});

// One finding is one badge. A finding that names the same node twice used to
// make the badge read "2" for a single problem.
const duplicated = buildNodeFindingIndex(linkedFinding(["V-x", "V-x"]), pack);
assert(duplicated.size === 1, "a repeated node id yields one indexed node");
assert(duplicated.get("V-x").total === 1, "one finding counts once on a node it names twice");
assert(duplicated.get("V-x").counts.critical === 1, "the deduped count still lands in the right severity");

// Keys the canvas can never look up are worse than no key at all.
const messy = buildNodeFindingIndex(linkedFinding([null, 42, "V-ok"]), pack);
assert([...messy.keys()].join(",") === "V-ok", "only string node ids become index keys");

// The library only decides severity here, so the index has to build without
// one — the spec asked for it and nothing was checking it.
const noLibraryIndex = buildNodeFindingIndex(section, undefined);
assert(noLibraryIndex.size === nodeIndex.size, "the node index builds with no library at all");

// =========================== buildSurfaceTitles ==============================
//
// One map, built on the page and read by the matrix's column headers and by
// every finding card. The failure it exists to prevent is a reader clicking the
// "Database contract" column and then reading `supabase` on every card it
// returned — two vocabularies for one axis, one screen apart.

const surfaceTitles = buildSurfaceTitles(section);
assert(surfaceTitles.size === 5, `one entry per profile surface (got ${surfaceTitles.size})`);
assert(
  surfaceTitles.get("supabase") === "Database contract",
  "a surface reads as the profile titled it, not as its id",
);
assert(
  buildSurfaceGauges(matrix, section, pack).every(
    (gauge) => gauge.title === (surfaceTitles.get(gauge.surface) ?? gauge.surface),
  ),
  "the gauges' titles come from the same map, so the Overview and the board cannot disagree",
);
// `CROSS_SURFACE_ID` is a findings-only lens no profile declares, and 4 of the
// pilot's findings carry it. The card falls back to the id, which is legible
// English; a blank cell there would read as a finding filed against nothing.
assert(
  surfaceTitles.get("cross-surface") === undefined &&
    section.findings.some((finding) => finding.surface === "cross-surface"),
  "cross-surface is absent from the map, so a card filed against it falls back to the id",
);
assert(buildSurfaceTitles(undefined).size === 0, "no section is an empty map, not a throw");
assert(
  buildSurfaceTitles({ profile: { surfaces: [{ id: "db" }] } }).get("db") === "db",
  "a surface the profile never titled falls back to its own id",
);

// =========================== buildSurfaceGauges ==============================

const gauges = buildSurfaceGauges(matrix, section, pack);
assert(gauges.length === 5, "one gauge per profile surface");
assert(
  gauges.map((gauge) => gauge.surface).join(",") === "web,ios,android,admin,supabase",
  "gauges keep the profile's surface order",
);
assert(
  gauges.every((gauge) => gauge.score === matrix.overall[gauge.surface]),
  "a gauge's score is the matrix's own roll-up, not a second computation",
);
assert(gauges[0].title === "Web app", "a gauge takes its title from the profile");
assert(
  gauges.every((gauge) => gauge.score === null || gauge.grade !== null),
  "a gauge with a score always has a grade",
);

// The pilot scores all five surfaces, so the null branch never runs above and
// the assertion is vacuous there. A synthetic matrix exercises both halves —
// including a 0, which `||` instead of `??` would silently read as unscored.
const sparseMatrix = {
  surfaces: ["web", "unscored"],
  domains: [],
  matrix: {},
  overall: { web: 0 },
  finding_counts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
};
const sparseGauges = buildSurfaceGauges(sparseMatrix, undefined, pack);
const unscored = sparseGauges.find((gauge) => gauge.surface === "unscored");
assert(unscored.score === null && unscored.grade === null, "a surface nothing was scored on has no score and no grade");
const floored = sparseGauges.find((gauge) => gauge.surface === "web");
assert(floored.score === 0 && floored.grade === "E", "a surface that scored 0 is graded E, not left ungraded");
assert(unscored.title === "unscored", "a gauge with no profile entry falls back to the surface id");

// ================= the pack's scales, not the schema's defaults ==============
//
// Every assertion above scores against packages/kritik-library/framework.json,
// whose `scales.severity_buckets` and `scales.grades` are byte-identical to
// DEFAULT_SEVERITY_BUCKETS and DEFAULT_GRADE_BANDS in @arkaik/schema. Against
// that one pack, "reads the pack's scales" and "hardcodes the schema defaults"
// produce the same numbers, so the suite above cannot tell them apart: a
// quality.ts with the buckets and bands inlined passes all of it.
//
// These score the same fixture against packs whose scales are deliberately NOT
// the defaults, which is the only way the difference becomes observable. They
// are not redundant with anything above — they are what holds this module's
// central promise, that a project which moves a bucket moves the app with it.

const looseBuckets = {
  ...pack,
  scales: { ...pack.scales, severity_buckets: { ...pack.scales.severity_buckets, critical: [10, 25] } },
};

const borderline = {
  findings: [{ id: "F-scale", criterion_id: "SEC-01", surface: "web", title: "t", detail: "d", evidence: "e", impact: 5, likelihood: 2, cost: "M", status: "open" }],
};
assert(buildFindingRows(borderline, pack)[0].severity === "medium", "risk 10 is medium under the shipped pack");
assert(
  buildFindingRows(borderline, looseBuckets)[0].severity === "critical",
  "risk 10 is critical under a pack whose critical bucket starts at 10 — the pack decides severity",
);
assert(
  buildFindingRows(borderline, looseBuckets)[0].priority === "P0",
  "and the priority lane follows the pack's severity, not a restated one",
);
assert(
  buildFindingRows(section, looseBuckets).filter((row) => row.severity === "critical").length >
    rows.filter((row) => row.severity === "critical").length,
  "widening the critical bucket makes the pilot's board hold more criticals",
);

const lenientBands = { ...pack, scales: { ...pack.scales, grades: { A: 40, B: 30, C: 20, D: 10, E: 0 } } };
const harshBands = { ...pack, scales: { ...pack.scales, grades: { A: 99, B: 98, C: 97, D: 96, E: 0 } } };
assert(gauges.every((gauge) => gauge.grade === "D"), "the pilot's surfaces all grade D under the shipped pack");
assert(
  buildSurfaceGauges(matrix, section, lenientBands).every((gauge) => gauge.grade === "A"),
  "the same scores grade A under a pack that lowers the bands — the pack decides the grade",
);
assert(
  buildSurfaceGauges(matrix, section, harshBands).every((gauge) => gauge.grade === "E"),
  "and grade E under a pack that raises them",
);

// =========================== the fold (phase E) ===============================
//
// The webhook appends a `quality.finding.resolved` event and never rewrites the
// stored finding (RFC §3.2). `foldQualityEvents` is the projection that
// makes the appended fact visible without a rewrite — pinned here against the
// two consumers a stale `open` status actually breaks: the matrix's
// anti-averaging cap, and the node badge.

const { foldQualityEvents } = loadQuality();

const RESOLVED_EVENT = (findingId, over = {}) => ({
  id: `01J${findingId}`,
  ts: "2026-09-01T00:00:00.000Z",
  type: "quality.finding.resolved",
  finding_id: findingId,
  resolved_by: "https://github.com/acme/app/pull/7",
  ...over,
});

const foldSection = (findings) => ({
  framework_version: "0.1.0",
  profile: { surfaces: [{ id: "web", title: "Web" }] },
  assessments: [{ criterion_id: "SEC-01", surface: "web", level: 3, evidence: "e", audit_id: "2026-08", ts: "2026-08-01T00:00:00.000Z" }],
  findings,
});

const openCritical = { id: "F-1", criterion_id: "SEC-01", surface: "web", title: "t", detail: "d", evidence: "e", impact: 5, likelihood: 5, cost: "M", status: "open" };

const untouched = foldSection([openCritical]);
assert(
  foldQualityEvents(untouched, [RESOLVED_EVENT("F-other")]) === untouched,
  "no matching event returns the SAME object",
);
assert(foldQualityEvents(untouched, []) === untouched, "an empty journal returns the same object");
assert(
  foldQualityEvents(undefined, [RESOLVED_EVENT("F-1")]) === undefined,
  "an undefined section stays undefined",
);

const folded = foldQualityEvents(foldSection([openCritical]), [RESOLVED_EVENT("F-1")]);
assert(
  folded.findings[0].status === "resolved",
  `a matched finding reads resolved (${JSON.stringify(folded.findings[0])})`,
);
assert(folded.findings[0].resolved_by === "https://github.com/acme/app/pull/7", "resolved_by lands on the finding");
assert(openCritical.status === "open", "the input was not mutated");

for (const status of ["refuted", "accepted-risk"]) {
  const decided = foldQualityEvents(foldSection([{ ...openCritical, status }]), [RESOLVED_EVENT("F-1")]);
  assert(decided.findings[0].status === status, `a ${status} finding survives the fold`);
}

const noUrl = foldQualityEvents(foldSection([openCritical]), [RESOLVED_EVENT("F-1", { resolved_by: undefined })]);
assert(noUrl.findings[0].resolved_by === undefined, "no resolved_by on the event leaves none on the finding");


// A later url-less resolution must not erase the url an earlier one carried.
// `findingResolvedInput` omits `resolved_by` when it has none, so this shape
// is what `arkaik kritik finding resolve` produces without `--by`.
const keptUrl = foldQualityEvents(foldSection([openCritical]), [
  RESOLVED_EVENT("F-1"),
  RESOLVED_EVENT("F-1", { resolved_by: undefined }),
]);
assert(
  keptUrl.findings[0].resolved_by === "https://github.com/acme/app/pull/7",
  `a url-less re-resolution keeps the known PR (got ${keptUrl.findings[0].resolved_by})`,
);
const laterUrl = foldQualityEvents(foldSection([openCritical]), [
  RESOLVED_EVENT("F-1", { resolved_by: undefined }),
  RESOLVED_EVENT("F-1", { resolved_by: "https://github.com/acme/app/pull/9" }),
]);
assert(
  laterUrl.findings[0].resolved_by === "https://github.com/acme/app/pull/9",
  `a later named resolution still wins (got ${laterUrl.findings[0].resolved_by})`,
);
// A later NAMED resolution overwrites an earlier NAMED one too — the latest
// event that names a PR wins outright, not just the latest that upgrades an
// unnamed one.
const namedThenNamed = foldQualityEvents(foldSection([openCritical]), [
  RESOLVED_EVENT("F-1", { resolved_by: "https://github.com/acme/app/pull/1" }),
  RESOLVED_EVENT("F-1", { resolved_by: "https://github.com/acme/app/pull/2" }),
]);
assert(
  namedThenNamed.findings[0].resolved_by === "https://github.com/acme/app/pull/2",
  `named then named — the later name wins (got ${namedThenNamed.findings[0].resolved_by})`,
);
// The pair that makes the fold matter: a capped cell uncaps, and the node
// badge clears, once the Critical behind them is folded resolved.
const badged = { ...openCritical, node_ids: ["V-home"] };
const before = deriveQualityMatrix({ quality: foldSection([badged]) });
const after = deriveQualityMatrix({ quality: foldQualityEvents(foldSection([badged]), [RESOLVED_EVENT("F-1")]) });
assert(
  before.matrix.SEC.web.capped === true && after.matrix.SEC.web.capped === false,
  `the cap lifts once the Critical resolves (${JSON.stringify(before.matrix.SEC.web)} -> ${JSON.stringify(after.matrix.SEC.web)})`,
);
assert(
  buildNodeFindingIndex(foldSection([badged])).size === 1 &&
    buildNodeFindingIndex(foldQualityEvents(foldSection([badged]), [RESOLVED_EVENT("F-1")])).size === 0,
  "the node badge clears",
);

// ===================== the fold — accepted events (#400) ======================
//
// `quality.finding.accepted` maps an open finding to `accepted-risk`, the same
// way `acceptFinding` in packages/schema/src/quality-ops.ts does when the
// write happens synchronously. Events are walked in journal order and the
// FIRST decision on an open finding wins, mirroring the write route (a later
// task) which refuses events against a non-open finding.
{
  const section = {
    framework_version: "1",
    profile: { surfaces: [] },
    assessments: [],
    findings: [
      { id: "F-1", criterion_id: "SEC-01", surface: "web", title: "t", detail: "d", evidence: "e", impact: 4, likelihood: 4, cost: "M", status: "open" },
      { id: "F-2", criterion_id: "SEC-01", surface: "web", title: "t2", detail: "d2", evidence: "e", impact: 2, likelihood: 2, cost: "S", status: "resolved" },
    ],
  };
  const accepted = { id: "01B", ts: "2026-09-01T00:00:00.000Z", type: "quality.finding.accepted", finding_id: "F-1", reason: "owned risk" };
  const folded = foldQualityEvents(section, [accepted]);
  assert(folded.findings[0].status === "accepted-risk", "accepted event folds open finding to accepted-risk");
  assert(folded.findings[0].detail === "d\n\nAccepted risk: owned risk", "acceptance reason appended to detail");
  assert(
    foldQualityEvents(section, [{ ...accepted, finding_id: "F-2" }]) === section,
    "decided finding untouched by accepted event",
  );
  const resolvedAfter = { id: "01C", ts: "2026-09-02T00:00:00.000Z", type: "quality.finding.resolved", finding_id: "F-1", resolved_by: "https://pr/1" };
  assert(
    foldQualityEvents(section, [accepted, resolvedAfter]).findings[0].status === "accepted-risk",
    "first decision wins — resolve after accept is ignored",
  );
}

// A malformed `findings` array — a null entry, an object with no `id` — must
// not crash the fold. The old implementation returned the section unchanged
// on a non-empty journal that named no valid finding; a naive `finding.id`
// dereference while building the id index would throw instead, and
// `lib/data/local-provider.ts:164` calls this fold with no try/catch around
// it.
{
  const malformed = {
    framework_version: "1",
    profile: { surfaces: [] },
    assessments: [],
    findings: [null, { criterion_id: "SEC-01", surface: "web", title: "t", detail: "d", evidence: "e", impact: 1, likelihood: 1, cost: "S", status: "open" }],
  };
  const unrelated = { id: "01D", ts: "2026-09-01T00:00:00.000Z", type: "quality.finding.resolved", finding_id: "F-nonexistent", resolved_by: "https://pr/1" };
  assert(
    foldQualityEvents(malformed, [unrelated]) === malformed,
    "a null/id-less findings entry does not crash the fold, and an unrelated event returns the same object",
  );
}

// --- scores fold latest-wins (issue #473) ------------------------------------
//
// `quality.assessment.scored` is the other hosted write the fold makes
// visible, and it resolves conflicts the opposite way from a finding
// decision: a re-score is meant to replace what is there, so the LATEST
// event for a `(criterion_id, surface)` cell wins, not the first.
{
  const section = {
    profile: { surfaces: [{ id: "web", title: "Web" }] },
    assessments: [{ criterion_id: "SEC-01", surface: "web", level: 1, evidence: "old", audit_id: "2026-08" }],
    findings: [],
  };
  const scored = (id, criterion, level, audit = "2026-09-scoped") => ({
    id,
    ts: `2026-09-0${id.slice(-1)}T00:00:00.000Z`,
    type: "quality.assessment.scored",
    audit_id: audit,
    criterion_id: criterion,
    surface: "web",
    level,
    evidence: `ev ${id}`,
    scope: { since: "2026-08" },
  });
  const folded = foldQualityEvents(section, [
    scored("S1", "SEC-01", 2),
    scored("S2", "SEC-01", 3),
    scored("S3", "SEC-02", 4),
  ]);
  const byCell = Object.fromEntries(folded.assessments.map((a) => [a.criterion_id, a]));
  assert(
    byCell["SEC-01"].level === 3 && byCell["SEC-01"].evidence === "ev S2" && byCell["SEC-01"].audit_id === "2026-09-scoped",
    `a re-score replaces the stored level, latest wins (got ${JSON.stringify(byCell["SEC-01"])})`,
  );
  assert(byCell["SEC-02"].level === 4, `a cell the section never held is appended (got ${JSON.stringify(byCell["SEC-02"])})`);
  assert(
    section.assessments[0].level === 1 && section.assessments.length === 1,
    "the stored section is not mutated",
  );
  assert(
    foldQualityEvents(section, [{ ...scored("S4", "SEC-01", 9) }]) === section,
    "a malformed score is skipped",
  );
  assert(foldQualityEvents(section, []) === section, "nothing to fold returns the section by reference");
}

// --- the early return must not swallow a score on an empty section (fix, #473) --
//
// The identity contract for "nothing to fold" is that nothing got patched,
// not that the section already had findings or assessments to patch. A
// section with neither must still take its first score.
{
  const scoreEvent = {
    id: "E1",
    ts: "2026-09-01T00:00:00.000Z",
    type: "quality.assessment.scored",
    audit_id: "2026-09-scoped",
    criterion_id: "SEC-01",
    surface: "web",
    level: 2,
    evidence: "e",
  };

  const emptySection = { profile: { surfaces: [{ id: "web", title: "Web" }] }, assessments: [], findings: [] };
  const folded = foldQualityEvents(emptySection, [scoreEvent]);
  assert(
    Array.isArray(folded.assessments) && folded.assessments.length === 1 && folded.assessments[0].level === 2,
    `a section with empty findings/assessments still folds a score (got ${JSON.stringify(folded.assessments)})`,
  );

  const bareSection = { profile: { surfaces: [{ id: "web", title: "Web" }] } };
  const foldedBare = foldQualityEvents(bareSection, [scoreEvent]);
  assert(
    Array.isArray(foldedBare.assessments) && foldedBare.assessments.length === 1 && foldedBare.assessments[0].level === 2,
    `a section with no findings/assessments keys at all still folds a score (got ${JSON.stringify(foldedBare.assessments)})`,
  );
}

// --- ts is required on a scored event, commit rides along when present (fix, #473) --
{
  const section = { profile: { surfaces: [{ id: "web", title: "Web" }] }, assessments: [], findings: [] };
  const withCommit = {
    id: "E2",
    ts: "2026-09-05T00:00:00.000Z",
    type: "quality.assessment.scored",
    audit_id: "2026-09-scoped",
    criterion_id: "SEC-01",
    surface: "web",
    level: 3,
    evidence: "e",
    commit: "abc123",
  };
  const folded = foldQualityEvents(section, [withCommit]);
  assert(folded.assessments[0].ts === "2026-09-05T00:00:00.000Z", "ts is carried onto the folded row");
  assert(folded.assessments[0].commit === "abc123", "commit is carried onto the folded row when present");

  const { ts: _omit, ...noTs } = withCommit;
  assert(foldQualityEvents(section, [noTs]) === section, "a scored event with no ts is skipped");
}

// --- the restore guard: a scored event never undoes a newer stored audit (fix, #473) --
//
// A hosted scoped audit id always sorts after every known audit
// (`scopedAuditId` enforces it), so this never fires on an ordinary write —
// it protects a snapshot restored to a NEWER audit sitting next to a journal
// that still carries older hosted scores.
{
  const section = {
    profile: { surfaces: [{ id: "web", title: "Web" }] },
    assessments: [{ criterion_id: "SEC-01", surface: "web", level: 4, evidence: "newer", audit_id: "2026-10", ts: "2026-10-01T00:00:00.000Z" }],
    findings: [],
  };
  const olderScore = {
    id: "E4",
    ts: "2026-09-15T00:00:00.000Z",
    type: "quality.assessment.scored",
    audit_id: "2026-09-scoped",
    criterion_id: "SEC-01",
    surface: "web",
    level: 1,
    evidence: "stale",
    scope: { since: "2026-08" },
  };
  assert(
    foldQualityEvents(section, [olderScore]) === section,
    "a scored event whose audit_id sorts lexically before the stored row's is skipped — the stored row survives",
  );
}

// --- unkeyable and duplicate stored rows survive a fold untouched, in place (fix, #473) --
{
  const unkeyable = { surface: "web", level: 2, evidence: "no criterion_id", audit_id: "2026-08", ts: "2026-08-01T00:00:00.000Z" };
  const keyed = { criterion_id: "SEC-02", surface: "web", level: 1, evidence: "e", audit_id: "2026-08", ts: "2026-08-01T00:00:00.000Z" };
  const section = { profile: { surfaces: [{ id: "web", title: "Web" }] }, assessments: [unkeyable, keyed], findings: [] };
  const score = {
    id: "E5",
    ts: "2026-09-01T00:00:00.000Z",
    type: "quality.assessment.scored",
    audit_id: "2026-09-scoped",
    criterion_id: "SEC-02",
    surface: "web",
    level: 4,
    evidence: "rescored",
  };
  const folded = foldQualityEvents(section, [score]);
  assert(
    folded.assessments[0] === unkeyable,
    "a stored row with no string criterion_id/surface survives a fold untouched, at its original position",
  );
  assert(folded.assessments[1].level === 4, "the keyed cell is re-scored at its original position");
  assert(folded.assessments.length === 2, "no row is dropped or duplicated");
}
{
  const old1 = { criterion_id: "SEC-01", surface: "web", level: 1, evidence: "old1", audit_id: "2026-08a", ts: "2026-08-01T00:00:00.000Z" };
  const old2 = { criterion_id: "SEC-01", surface: "web", level: 2, evidence: "old2", audit_id: "2026-08b", ts: "2026-08-02T00:00:00.000Z" };
  const cellB = { criterion_id: "SEC-02", surface: "web", level: 1, evidence: "b", audit_id: "2026-08", ts: "2026-08-01T00:00:00.000Z" };
  const section = { profile: { surfaces: [{ id: "web", title: "Web" }] }, assessments: [old1, old2, cellB], findings: [] };

  const scoreB = {
    id: "E6",
    ts: "2026-09-01T00:00:00.000Z",
    type: "quality.assessment.scored",
    audit_id: "2026-09-scoped",
    criterion_id: "SEC-02",
    surface: "web",
    level: 3,
    evidence: "rescored b",
  };
  const foldedB = foldQualityEvents(section, [scoreB]);
  assert(
    foldedB.assessments[0] === old1 && foldedB.assessments[1] === old2,
    "scoring cell B leaves an unrelated cell A's duplicate stored rows untouched",
  );
  assert(foldedB.assessments[2].level === 3, "cell B itself is re-scored");

  const scoreA = {
    id: "E7",
    ts: "2026-09-02T00:00:00.000Z",
    type: "quality.assessment.scored",
    audit_id: "2026-09-scoped",
    criterion_id: "SEC-01",
    surface: "web",
    level: 4,
    evidence: "rescored a",
  };
  const foldedA = foldQualityEvents(section, [scoreA]);
  assert(foldedA.assessments[0] === old1, "the earlier duplicate for the rescored cell is left exactly as stored");
  assert(foldedA.assessments[1].level === 4, "only the LAST stored occurrence for the cell is replaced");
  assert(foldedA.assessments[2] === cellB, "an unrelated cell is untouched by the rescore");
}

// --- surface is part of the fold key (#473) -----------------------------------
{
  const web = { criterion_id: "SEC-01", surface: "web", level: 1, evidence: "web-old", audit_id: "2026-08", ts: "2026-08-01T00:00:00.000Z" };
  const ios = { criterion_id: "SEC-01", surface: "ios", level: 2, evidence: "ios-old", audit_id: "2026-08", ts: "2026-08-01T00:00:00.000Z" };
  const section = {
    profile: { surfaces: [{ id: "web", title: "Web" }, { id: "ios", title: "iOS" }] },
    assessments: [web, ios],
    findings: [],
  };

  const scoreIos = {
    id: "E8",
    ts: "2026-09-01T00:00:00.000Z",
    type: "quality.assessment.scored",
    audit_id: "2026-09-scoped",
    criterion_id: "SEC-01",
    surface: "ios",
    level: 4,
    evidence: "ios-new",
  };
  const foldedIos = foldQualityEvents(section, [scoreIos]);
  assert(foldedIos.assessments[0] === web, "scoring one surface leaves the other surface's row untouched");
  assert(
    foldedIos.assessments[1].level === 4 && foldedIos.assessments[1].surface === "ios",
    "the scored surface is updated",
  );

  const scoreWeb = {
    id: "E9",
    ts: "2026-09-01T00:00:00.000Z",
    type: "quality.assessment.scored",
    audit_id: "2026-09-scoped",
    criterion_id: "SEC-01",
    surface: "web",
    level: 3,
    evidence: "web-new",
  };
  const foldedWeb = foldQualityEvents(section, [scoreWeb]);
  assert(foldedWeb.assessments[1] === ios, "scoring the other surface leaves ios untouched");
  assert(
    foldedWeb.assessments[0].level === 3 && foldedWeb.assessments[0].surface === "web",
    "the scored surface is updated",
  );
}

// --- malformed quality.assessment.scored events are skipped (#473) -----------
{
  const section = {
    profile: { surfaces: [{ id: "web", title: "Web" }] },
    assessments: [{ criterion_id: "SEC-01", surface: "web", level: 1, evidence: "e", audit_id: "2026-08", ts: "2026-08-01T00:00:00.000Z" }],
    findings: [],
  };
  const base = {
    id: "E10",
    ts: "2026-09-01T00:00:00.000Z",
    type: "quality.assessment.scored",
    audit_id: "2026-09-scoped",
    criterion_id: "SEC-01",
    surface: "web",
    level: 3,
    evidence: "e",
  };
  const malformed = [
    ["level -1", { ...base, level: -1 }],
    ["level 2.5", { ...base, level: 2.5 }],
    ["level as a string", { ...base, level: "3" }],
    ["missing audit_id", { ...base, audit_id: undefined }],
    ["non-string evidence", { ...base, evidence: 7 }],
    ["missing criterion_id", { ...base, criterion_id: undefined }],
  ];
  for (const [label, event] of malformed) {
    assert(foldQualityEvents(section, [event]) === section, `a scored event with ${label} is skipped`);
  }
}

// --- a decision and a score in the same walk both land, independently (#473) --
{
  const openCritical2 = {
    id: "F-9",
    criterion_id: "SEC-01",
    surface: "web",
    title: "t",
    detail: "d",
    evidence: "e",
    impact: 5,
    likelihood: 5,
    cost: "M",
    status: "open",
  };
  const section = {
    profile: { surfaces: [{ id: "web", title: "Web" }] },
    assessments: [{ criterion_id: "SEC-01", surface: "web", level: 1, evidence: "e", audit_id: "2026-08", ts: "2026-08-01T00:00:00.000Z" }],
    findings: [openCritical2],
  };
  const decision = { id: "01Z", ts: "2026-09-01T00:00:00.000Z", type: "quality.finding.resolved", finding_id: "F-9", resolved_by: "https://pr/1" };
  const score = {
    id: "E11",
    ts: "2026-09-01T00:00:00.000Z",
    type: "quality.assessment.scored",
    audit_id: "2026-09-scoped",
    criterion_id: "SEC-01",
    surface: "web",
    level: 3,
    evidence: "e2",
  };
  const folded = foldQualityEvents(section, [decision, score]);
  assert(folded.findings[0].status === "resolved", "the decision in a mixed walk still lands");
  assert(folded.assessments[0].level === 3, "the score in a mixed walk still lands");

  const scoreOnly = foldQualityEvents(section, [score]);
  assert(scoreOnly.findings === section.findings, "a score-only fold does not touch or copy findings");
}

// --- position: a re-scored cell keeps its index in `assessments` (#473) ------
{
  const first = { criterion_id: "SEC-01", surface: "web", level: 1, evidence: "e1", audit_id: "2026-08", ts: "2026-08-01T00:00:00.000Z" };
  const second = { criterion_id: "SEC-02", surface: "web", level: 2, evidence: "e2", audit_id: "2026-08", ts: "2026-08-01T00:00:00.000Z" };
  const section = { profile: { surfaces: [{ id: "web", title: "Web" }] }, assessments: [first, second], findings: [] };
  const score = {
    id: "E12",
    ts: "2026-09-01T00:00:00.000Z",
    type: "quality.assessment.scored",
    audit_id: "2026-09-scoped",
    criterion_id: "SEC-02",
    surface: "web",
    level: 4,
    evidence: "e2-new",
  };
  const folded = foldQualityEvents(section, [score]);
  assert(folded.assessments[0] === first, "an unscored row keeps its position");
  assert(
    folded.assessments[1].criterion_id === "SEC-02" && folded.assessments[1].level === 4,
    "the re-scored cell keeps its own index rather than moving to the end",
  );
  assert(folded.assessments.length === 2, "no row is appended for a cell that already existed");
}

// --- consumer: deriveQualityMatrix reflects a re-scored cell (#473) ----------
{
  const rescoreSection = foldSection([]);
  const scoreDown = {
    id: "E13",
    ts: "2026-09-01T00:00:00.000Z",
    type: "quality.assessment.scored",
    audit_id: "2026-09-scoped",
    criterion_id: "SEC-01",
    surface: "web",
    level: 0,
    evidence: "regressed",
  };
  const beforeMatrix = deriveQualityMatrix({ quality: rescoreSection }, pack);
  const afterMatrix = deriveQualityMatrix({ quality: foldQualityEvents(rescoreSection, [scoreDown]) }, pack);
  assert(
    beforeMatrix.matrix.SEC.web.score !== afterMatrix.matrix.SEC.web.score,
    `a re-scored cell changes deriveQualityMatrix's reading of it (before ${beforeMatrix.matrix.SEC.web.score}, after ${afterMatrix.matrix.SEC.web.score})`,
  );
}

// ========================== buildDomainSections ==============================
//
// The Matrix page's stacked sections. What matters is that they are a *view* of
// deriveQualityMatrix and never a second scoring of it.

const { buildDomainSections } = loadQuality();
const sections = buildDomainSections(matrix, section, pack);

assert(
  sections.length === matrix.domains.length &&
    sections.every((row, index) => row.domain === matrix.domains[index]),
  "one section per matrix domain, in the matrix's own order",
);
assert(
  sections.every(
    (row) =>
      row.cards.length === matrix.surfaces.length &&
      row.cards.every((card, index) => card.surface === matrix.surfaces[index]),
  ),
  "one card per matrix surface, in the matrix's own order",
);
assert(
  sections.every((row) =>
    row.cards.every((card) => card.cell === (matrix.matrix[row.domain]?.[card.surface] ?? null)),
  ),
  "every card carries the matrix's own cell object, never a copy or a re-score",
);
assert(
  sections.every((row) => row.scored === row.cards.filter((card) => card.cell !== null).length),
  "scored counts the cells that exist, not the surfaces offered",
);

const secSection = sections.find((row) => row.domain === "SEC");
const secScores = secSection.cards.filter((card) => card.cell).map((card) => card.cell.score);
assert(
  secSection.average === Math.round(secScores.reduce((total, score) => total + score, 0) / secScores.length),
  `a section's average is the plain mean of its scored cells (SEC = ${secSection.average})`,
);
assert(
  secSection.name === "Security" && typeof secSection.description === "string" && secSection.description !== "",
  "a section takes its name and description from the pack's domain, not from its code",
);
assert(
  secSection.cards.every((card) => card.title === (section.profile.surfaces.find((s) => s.id === card.surface)?.title ?? card.surface)),
  "a card names its surface the way the profile titles it",
);

// A domain the audit never touched: not scored is not zero, and a heading that
// said "avg 0" would read as a failing domain rather than an unaudited one.
const unscoredDomain = buildDomainSections(
  { domains: ["ZZZ"], surfaces: ["web"], matrix: { ZZZ: { web: null } }, overall: { web: null } },
  section,
  pack,
);
assert(
  unscoredDomain[0].average === null && unscoredDomain[0].scored === 0,
  "a domain scored nowhere reports a null average, never a zero",
);
assert(
  unscoredDomain[0].name === "ZZZ",
  "a domain the pack does not define falls back to its own code",
);

// =========================== the trend arrow (#442) ==========================

const { buildCellHistory, describeDelta, deriveQualityTrend } = loadQuality();

const auditEvent = (auditId, ts, scores, over = {}) => ({
  id: `01T${ts.replace(/\D/g, "")}`,
  ts,
  type: "quality.audit.completed",
  audit_id: auditId,
  framework_version: "0.1.0",
  scores,
  counts: {},
  ...over,
});

// Two recorded audits below the live pilot matrix: the newest differs from the
// live cells (SEC on web moved up 6), so it is the baseline.
const liveSecWeb = matrix.matrix.SEC.web.score;
const webOverall = matrix.overall.web;
const trend = deriveQualityTrend(
  [
    auditEvent("2026-07", "2026-07-01T00:00:00.000Z", { web: { SEC: liveSecWeb - 10 } }, { commit: "aaaaaaa1" }),
    auditEvent("2026-08", "2026-08-01T00:00:00.000Z", { web: { SEC: liveSecWeb - 6, PRF: 40 } }, { commit: "bbbbbbb2" }),
  ],
  section.profile,
  matrix,
);
const withTrend = buildDomainSections(matrix, section, pack, trend);
const secWithTrend = withTrend.find((row) => row.domain === "SEC");
const liveSecWebCard = secWithTrend.cards.find((card) => card.surface === "web");
assert(
  liveSecWebCard.delta && liveSecWebCard.delta.previous === liveSecWeb - 6 && liveSecWebCard.delta.delta === 6 && liveSecWebCard.delta.audit_id === "2026-08",
  "a card carries its cell's delta against the newest recorded audit",
);
assert(describeDelta(liveSecWebCard.delta) === `up 6 from ${liveSecWeb - 6} at the 2026-08 audit`, "the label spells the previous score and the audit it came from");
const secIosCard = secWithTrend.cards.find((card) => card.surface === "ios");
assert(
  secIosCard.cell !== null && secIosCard.delta && secIosCard.delta.previous === null && secIosCard.delta.delta === null,
  "a scored cell the audits never recorded has an empty reading",
);
assert(describeDelta(secIosCard.delta) === null, "an empty reading describes nothing — a first audit is not 'unchanged'");
assert(
  withTrend.every((row) => row.cards.every((card) => card.cell !== null || card.delta === undefined)),
  "an unscored cell carries no delta at all",
);
assert(
  buildDomainSections(matrix, section, pack).every((row) => row.cards.every((card) => card.delta === undefined)),
  "without a trend the sections are exactly what they were",
);

const gaugesWithTrend = buildSurfaceGauges(matrix, section, pack, trend);
const webGauge = gaugesWithTrend.find((gauge) => gauge.surface === "web");
// The 2026-08 snapshot rolls up SEC and PRF with the profile's weights; the
// delta is the live roll-up minus that, whatever the number.
assert(
  webGauge.delta && typeof webGauge.delta.previous === "number" && webGauge.delta.delta === webOverall - webGauge.delta.previous,
  "the roll-up gauge carries the surface's delta against the same baseline",
);
assert(describeDelta({ previous: 66, delta: 0, audit_id: "2026-08" }) === "unchanged from 66 at the 2026-08 audit", "a zero delta reads as unchanged");
assert(describeDelta({ previous: 66, delta: -3, audit_id: "2026-08" }) === "down 3 from 66 at the 2026-08 audit", "a drop reads as down");
assert(describeDelta({ previous: 66, delta: null, audit_id: "2026-08" }).includes("not comparable"), "a reading across a framework major bump says why it has no arrow");
assert(describeDelta(undefined) === null && describeDelta({ previous: null, delta: null }) === null, "no reading, no sentence");

const history = buildCellHistory(trend, "SEC", "web");
assert(
  history.length === 2 && history[0].auditId === "2026-07" && history[1].auditId === "2026-08",
  "the cell's history lists every recorded audit, oldest first",
);
assert(history[0].score === liveSecWeb - 10 && history[1].score === liveSecWeb - 6 && history[1].commit === "bbbbbbb2", "each history row carries that audit's score and commit");
assert(buildCellHistory(trend, "PRF", "web")[0].score === null, "an audit that did not score the cell is an unscored row, not a zero");
assert(buildCellHistory(undefined, "SEC", "web").length === 0, "no trend, no history");

// --- worstOpenFindingFor ----------------------------------------------------

const { worstOpenFindingFor } = loadQuality();

{
  const rows = [
    { id: "F-a", nodeIds: ["V-login"], open: true, severity: "low", title: "a" },
    { id: "F-b", nodeIds: ["V-login"], open: true, severity: "critical", title: "b" },
    { id: "F-c", nodeIds: ["V-login"], open: false, severity: "critical", title: "c" },
    { id: "F-d", nodeIds: ["V-other"], open: true, severity: "critical", title: "d" },
  ];

  const found = worstOpenFindingFor(rows, "V-login");
  assert(found !== null, "worstOpenFindingFor returns a summary when the node has open findings");
  assert(found.count === 2, `it counts only this node's OPEN findings (got ${found && found.count})`);
  assert(
    found.severity === "critical",
    `it reports the worst severity among them (got ${found && found.severity})`,
  );

  assert(
    worstOpenFindingFor(rows, "V-nothing") === null,
    "a node with no findings gets null, not a zero",
  );
  assert(
    worstOpenFindingFor(
      [{ id: "F-e", nodeIds: ["V-x"], open: false, severity: "critical", title: "e" }],
      "V-x",
    ) === null,
    "a node whose every finding is closed gets null \u2014 the bar says nothing",
  );
  assert(worstOpenFindingFor([], "V-x") === null, "no rows at all gets null");
}

// --- describeAuditCompleted (issue #443) -----------------------------------

{
  const { describeAuditCompleted } = loadQuality();
  const full = describeAuditCompleted({ type: "quality.audit.completed", audit_id: "2026-08", framework_version: "1.0.0" });
  assert(full.text === "Audit 2026-08 completed" && full.meta === "Kritik 1.0.0", `a comprehensive audit reads as before (got ${JSON.stringify(full)})`);

  const scoped = describeAuditCompleted({
    type: "quality.audit.completed",
    audit_id: "2026-09-scoped",
    framework_version: "1.0.0",
    scope: { partial: true, cells: 12, since: "2026-08" },
  });
  assert(scoped.text === "Scoped re-audit of 12 cells", `a scoped audit leads with how much it looked at (got ${scoped.text})`);
  assert(
    scoped.meta === "2026-09-scoped · since 2026-08 · Kritik 1.0.0",
    `its meta names the audit, what it was measured from, and the pack (got ${scoped.meta})`,
  );

  const one = describeAuditCompleted({ audit_id: "2026-09-scoped", scope: { partial: true, cells: 1, since: "2026-08" } });
  assert(one.text === "Scoped re-audit of 1 cell" && one.meta === "2026-09-scoped · since 2026-08", `one cell is singular (got ${JSON.stringify(one)})`);

  const uncounted = describeAuditCompleted({ audit_id: "2026-09-scoped", scope: { partial: true, cells: "twelve" } });
  assert(
    uncounted.text === "Scoped re-audit 2026-09-scoped" && uncounted.meta === undefined,
    `a malformed count falls back to the audit id, never "of undefined cells" (got ${JSON.stringify(uncounted)})`,
  );

  const notPartial = describeAuditCompleted({ audit_id: "2026-08", scope: { partial: false, cells: 3 } });
  assert(notPartial.text === "Audit 2026-08 completed", `a scope that is not partial reads as a whole audit (got ${notPartial.text})`);
  assert(describeAuditCompleted({}).text === "Audit ? completed", "an event with nothing on it still renders");
}

// ================== the findings burndown (issue #441) =======================

{
  const {
    deriveFindingsBurndown,
    describeClosedSince,
    describeBurndownDetail,
    describeBurndownTrend,
    describeBurndownCause,
    burndownFilterOf,
    countOpenFindings,
    burndownGeometry,
    burndownPointAt,
  } = loadQuality();

  let n = 0;
  const ev = (day, type, payload) => ({ id: `01B${String(++n).padStart(4, "0")}`, ts: `2026-09-${String(day).padStart(2, "0")}T00:00:00.000Z`, type, ...payload });
  const open = (day, id, severity) => ev(day, "quality.finding.opened", { finding_id: id, severity, priority: "P2", surface: "web", criterion_id: "SEC-01", title: id });
  const resolve = (day, id) => ev(day, "quality.finding.resolved", { finding_id: id });
  const accept = (day, id) => ev(day, "quality.finding.accepted", { finding_id: id, reason: "owned" });
  const auditAt = (day, id, counts) => ev(day, "quality.audit.completed", { audit_id: id, framework_version: "1.0.0", counts });

  // --- the closed-since line: zero, one, many -------------------------------
  const base = [open(1, "F-1", "high"), open(1, "F-2", "high"), open(1, "F-3", "low"), auditAt(2, "2026-08", { high: 2, low: 1 })];

  const zero = deriveFindingsBurndown(base);
  assert(describeClosedSince(zero, 3) === "Nothing closed since the 2026-08 audit · 3 open", `zero closures reads as nothing closed (got ${describeClosedSince(zero, 3)})`);

  const one = deriveFindingsBurndown([...base, resolve(3, "F-1")]);
  assert(describeClosedSince(one, 2) === "1 closed since the 2026-08 audit · 2 open", `one closure (got ${describeClosedSince(one, 2)})`);

  const many = deriveFindingsBurndown([...base, resolve(3, "F-1"), resolve(4, "F-2"), accept(5, "F-3"), open(6, "F-4", "medium")]);
  assert(describeClosedSince(many, 1) === "3 closed since the 2026-08 audit · 1 open", `many closures count fixes and accepted risks together (got ${describeClosedSince(many, 1)})`);
  assert(
    describeBurndownDetail(many) === "2 resolved, 1 accepted as a risk, 1 opened since the 2026-08 audit",
    `the detail splits closes into fixes and risks (got ${describeBurndownDetail(many)})`,
  );

  const before = deriveFindingsBurndown([resolve(1, "F-x"), auditAt(2, "2026-08", {})]);
  assert(describeClosedSince(before, 0) === "Nothing closed since the 2026-08 audit · 0 open", "a close before the audit is not a close since it");

  const noAudit = deriveFindingsBurndown([open(1, "F-1", "high"), resolve(2, "F-1")]);
  assert(describeClosedSince(noAudit, 0) === "1 closed · 0 open", `with no audit recorded the line counts every close (got ${describeClosedSince(noAudit, 0)})`);
  assert(describeBurndownDetail(noAudit) === "1 resolved, 0 accepted as risks, 1 opened so far", `and its detail says so (got ${describeBurndownDetail(noAudit)})`);

  const nothing = deriveFindingsBurndown([]);
  assert(describeClosedSince(nothing, 12) === null, "no history, no line — not a claim that nothing closed");
  assert(describeBurndownDetail(nothing) === null, "no history, no detail");

  // --- the filter the burndown honours ---------------------------------------
  assert(JSON.stringify(burndownFilterOf({ surface: "all", domain: "all", cell: null })) === "{}", "no filter narrows nothing");
  assert(JSON.stringify(burndownFilterOf({ surface: "web", domain: "", cell: null })) === JSON.stringify({ surface: "web" }), "the surface menu narrows the surface");
  assert(JSON.stringify(burndownFilterOf({ surface: "all", domain: "SEC", cell: null })) === JSON.stringify({ domain: "SEC" }), "the domain menu narrows the domain");
  assert(
    JSON.stringify(burndownFilterOf({ surface: "api", domain: "PRF", cell: "SEC|web" })) === JSON.stringify({ surface: "web", domain: "SEC" }),
    "a cell wins over the separate menus",
  );

  const openRows = [
    { open: true, surface: "web", domain: "SEC" },
    { open: true, surface: "web", domain: "PRF" },
    { open: false, surface: "web", domain: "SEC" },
    { open: true, surface: "api", domain: "SEC" },
  ];
  assert(countOpenFindings(openRows) === 3, "the open count reads only open rows");
  assert(countOpenFindings(openRows, { surface: "web", domain: "SEC" }) === 1, "and narrows by surface and domain");
  assert(
    countOpenFindings([{ open: true, surface: "web", domain: "", criterionId: "ZZZ-01" }], { domain: "ZZZ" }) === 1,
    "a criterion the pack does not define is placed by its prefix, as the replay places it",
  );

  // --- geometry ----------------------------------------------------------------
  const geo = burndownGeometry(many.points, 100, 10);
  assert(geo.bands.map((b) => b.severity).join() === "critical,high,medium,low,info", "a band per severity, worst at the baseline, info on top");
  assert(geo.xs.length === many.points.length && geo.xs[0] === 0, "one x per point, starting at the left edge");
  assert(geo.xs.every((x, i) => i === 0 || x >= geo.xs[i - 1]), "x never runs backwards");
  assert(geo.xs[geo.xs.length - 1] < 100, "the newest reading keeps a visible stub at the right edge");
  assert(geo.max === 3, `the y axis scales to the tallest stack (got ${geo.max})`);
  assert(geo.ticks.length === 1 && geo.ticks[0] === geo.xs[3], "one tick, at the audit");
  assert(geo.line.startsWith("M0,6.67") && geo.line.includes("L0,0L18.8,0") && geo.line.endsWith("L94,6.67L100,6.67"), `the total steps up to the peak and back down to the last reading (got ${geo.line})`);

  const undated = burndownGeometry([{ ...many.points[0], ts: "" }, many.points[1], many.points[2]], 100, 10);
  assert(undated.xs.join() === "0,47,94", `an unparseable ts falls back to even spacing (got ${undated.xs.join()})`);
  const skewed = burndownGeometry(
    // In journal order, but the middle one is later in time than the last —
    // what two offsets in a hand-edited journal produce under string order.
    [{ ...many.points[0], ts: "2026-09-01T00:00:00Z" }, { ...many.points[1], ts: "2026-09-03T00:00:00Z" }, { ...many.points[2], ts: "2026-09-02T00:00:00Z" }],
    100,
    10,
  );
  assert(skewed.xs.every((x) => x >= 0 && x <= 100), `offsets that sort against time fall back to even spacing (got ${skewed.xs.join()})`);
  const single = burndownGeometry([many.points[0]], 100, 10);
  assert(single.line === "M0,0L100,0", `a single reading holds across the whole width (got ${single.line})`);
  assert(burndownGeometry([], 100, 10).bands.length === 0, "no points, no shapes");
  // `zero` runs 1, 2, 3, 3 open — its low is 1, not 0.
  const fitted = burndownGeometry(zero.points, 100, 10, { fitLine: true });
  const unfitted = burndownGeometry(zero.points, 100, 10);
  assert(fitted.line.startsWith("M0,10") && unfitted.line.startsWith("M0,6.67"), `a fitted line spans the whole height between its own low and high (got ${fitted.line})`);
  assert(fitted.bands[1].path === unfitted.bands[1].path, "fitting the line never moves the bands off zero");
  assert(burndownGeometry([many.points[0], many.points[0]], 100, 10, { fitLine: true }).line.startsWith("M0,5"), "a flat fitted line sits mid-height");

  assert(burndownPointAt([0, 10, 20], 15) === 1, "the hover reads the step under the pointer");
  assert(burndownPointAt([0, 10, 20], 20) === 2 && burndownPointAt([0, 10, 20], 99) === 2, "the newest step runs to the right edge");

  // --- words ----------------------------------------------------------------
  assert(
    describeBurndownTrend(many) === "Open findings: 1 on 2026-09-01, 1 on 2026-09-06 — 1 audit recorded",
    `the chart in words (got ${describeBurndownTrend(many)})`,
  );
  assert(describeBurndownTrend(nothing) === "Open findings: no history recorded", "an empty chart still has a name");
  assert(describeBurndownCause({ cause: { type: "accepted", id: "F-3" } }) === "F-3 accepted as a risk", "a cause in words");
  assert(describeBurndownCause({ cause: { type: "audit", id: "2026-08" } }) === "2026-08 audit recorded", "an audit in words");
}

console.log(failures === 0 ? "\nAll quality projections OK" : `\n${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
