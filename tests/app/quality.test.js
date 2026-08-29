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

const { filterFindings, groupByPriority, EMPTY_QUALITY_FILTERS, deriveQualityMatrix, cellKey, parseCellKey } =
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
// stored finding (RFC §3.2). `foldResolvedFindings` is the projection that
// makes the appended fact visible without a rewrite — pinned here against the
// two consumers a stale `open` status actually breaks: the matrix's
// anti-averaging cap, and the node badge.

const { foldResolvedFindings } = loadQuality();

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
  foldResolvedFindings(untouched, [RESOLVED_EVENT("F-other")]) === untouched,
  "no matching event returns the SAME object",
);
assert(foldResolvedFindings(untouched, []) === untouched, "an empty journal returns the same object");
assert(
  foldResolvedFindings(undefined, [RESOLVED_EVENT("F-1")]) === undefined,
  "an undefined section stays undefined",
);

const folded = foldResolvedFindings(foldSection([openCritical]), [RESOLVED_EVENT("F-1")]);
assert(
  folded.findings[0].status === "resolved",
  `a matched finding reads resolved (${JSON.stringify(folded.findings[0])})`,
);
assert(folded.findings[0].resolved_by === "https://github.com/acme/app/pull/7", "resolved_by lands on the finding");
assert(openCritical.status === "open", "the input was not mutated");

for (const status of ["refuted", "accepted-risk"]) {
  const decided = foldResolvedFindings(foldSection([{ ...openCritical, status }]), [RESOLVED_EVENT("F-1")]);
  assert(decided.findings[0].status === status, `a ${status} finding survives the fold`);
}

const noUrl = foldResolvedFindings(foldSection([openCritical]), [RESOLVED_EVENT("F-1", { resolved_by: undefined })]);
assert(noUrl.findings[0].resolved_by === undefined, "no resolved_by on the event leaves none on the finding");

// The pair that makes the fold matter: a capped cell uncaps, and the node
// badge clears, once the Critical behind them is folded resolved.
const badged = { ...openCritical, node_ids: ["V-home"] };
const before = deriveQualityMatrix({ quality: foldSection([badged]) });
const after = deriveQualityMatrix({ quality: foldResolvedFindings(foldSection([badged]), [RESOLVED_EVENT("F-1")]) });
assert(
  before.matrix.SEC.web.capped === true && after.matrix.SEC.web.capped === false,
  `the cap lifts once the Critical resolves (${JSON.stringify(before.matrix.SEC.web)} -> ${JSON.stringify(after.matrix.SEC.web)})`,
);
assert(
  buildNodeFindingIndex(foldSection([badged])).size === 1 &&
    buildNodeFindingIndex(foldResolvedFindings(foldSection([badged]), [RESOLVED_EVENT("F-1")])).size === 0,
  "the node badge clears",
);

console.log(failures === 0 ? "\nAll quality projections OK" : `\n${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
