#!/usr/bin/env node

/**
 * The quality trend (issue #442): `quality.audit.completed` replayed into
 * snapshots, and the live matrix's movement against the newest of them.
 *
 * Pure and fs-free — the module imports only `orderEvents` and `rollUpSurface`
 * at runtime — so this runs in CI's fast build job beside the other quality
 * suites. The golden at the end replays the Pebbles pilot's committed matrix
 * as one event and asserts the snapshot rolls up to the same `overall`, which
 * is what pins `rollUpSurface` as the one loop both readers share.
 */

const fs = require("fs");
const path = require("path");
const { loadSchema } = require("./load-schema");

const ROOT = path.join(__dirname, "..", "..");
const {
  deriveQualityTrend,
  deriveQualityMatrix,
  trendRows,
  formatDelta,
  frameworkMajor,
  rollUpSurface,
  auditCompletedInput,
  makeEvent,
} = loadSchema();

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`PASS: ${name}`);
  else { failures++; console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

let counter = 0;
/** A stamped audit event; `id` is monotonic so ties on `ts` order by insertion. */
const audit = (auditId, ts, scores, over = {}) => ({
  id: `01EVT${String(++counter).padStart(4, "0")}`,
  ts,
  type: "quality.audit.completed",
  audit_id: auditId,
  framework_version: "1.0.0",
  scores,
  counts: { critical: 0, high: 1, medium: 0, low: 0, info: 0 },
  ...over,
});
const live = (scores, framework_version = "1.0.0") => {
  const matrix = {};
  const overall = {};
  for (const surface of Object.keys(scores)) {
    for (const domain of Object.keys(scores[surface])) {
      (matrix[domain] ??= {})[surface] = { score: scores[surface][domain] };
    }
    overall[surface] = rollUpSurface(scores[surface]);
  }
  return { matrix, overall, framework_version };
};

// --- zero, one, two, three audits -------------------------------------------

const none = deriveQualityTrend([]);
check("no audits: no snapshots, no latest, no previous", none.snapshots.length === 0 && none.latest === null && none.previous === null);
check("no audits: a cell delta is the empty reading", eq(none.deltaCell("SEC", "web"), { previous: null, delta: null }));
check("no audits: a roll-up delta is the empty reading", eq(none.deltaOverall("web"), { previous: null, delta: null }));

const one = deriveQualityTrend(
  [audit("2026-08", "2026-08-01T00:00:00.000Z", { web: { SEC: 66, PRF: 50 } })],
  undefined,
  live({ web: { SEC: 72, PRF: 50 } }),
);
check("one audit is one snapshot", one.snapshots.length === 1 && one.latest?.audit_id === "2026-08");
check("the live matrix that differs from the only audit compares against it", one.previous?.audit_id === "2026-08");
check("a moved cell reads up 6 from 66", eq(one.deltaCell("SEC", "web"), { previous: 66, delta: 6, audit_id: "2026-08" }));
check("an unmoved cell reads a zero delta, not a missing one", eq(one.deltaCell("PRF", "web"), { previous: 50, delta: 0, audit_id: "2026-08" }));
check("a domain the audit never scored has no earlier reading", eq(one.deltaCell("A11Y", "web"), { previous: null, delta: null }));
check("the roll-up moves with its cells", one.deltaOverall("web").previous === 58 && one.deltaOverall("web").delta === 3);

const two = deriveQualityTrend(
  [
    audit("2026-08", "2026-08-01T00:00:00.000Z", { web: { SEC: 60 } }),
    audit("2026-09", "2026-09-01T00:00:00.000Z", { web: { SEC: 70 } }),
  ],
  undefined,
  live({ web: { SEC: 75 } }),
);
check("two audits: oldest first", two.snapshots.map((s) => s.audit_id).join(",") === "2026-08,2026-09");
check("two audits: the live matrix compares against the newest", two.previous?.audit_id === "2026-09" && two.deltaCell("SEC", "web").delta === 5);

const three = deriveQualityTrend(
  [
    audit("2026-09", "2026-09-01T00:00:00.000Z", { web: { SEC: 70 } }),
    audit("2026-07", "2026-07-01T00:00:00.000Z", { web: { SEC: 40 } }),
    audit("2026-08", "2026-08-01T00:00:00.000Z", { web: { SEC: 60 } }),
  ],
);
check("three audits arrive out of order and sort by ts", three.snapshots.map((s) => s.audit_id).join(",") === "2026-07,2026-08,2026-09");
check("without a live matrix, previous is simply the newest", three.previous?.audit_id === "2026-09");
check("without a live matrix there is nothing to delta", eq(three.deltaCell("SEC", "web"), { previous: 70, delta: null, audit_id: "2026-09" }));

// --- ordering is by ts, never by audit id -----------------------------------

const scoped = deriveQualityTrend([
  audit("2026-09", "2026-09-01T00:00:00.000Z", { web: { SEC: 70 } }),
  audit("2026-09-scoped", "2026-09-15T00:00:00.000Z", { web: { SEC: 74 } }),
  audit("2026-10", "2026-10-01T00:00:00.000Z", { web: { SEC: 80 } }),
]);
check(
  "a scoped re-audit sorts by when it happened, not by its id",
  scoped.snapshots.map((s) => s.audit_id).join(",") === "2026-09,2026-09-scoped,2026-10",
  scoped.snapshots.map((s) => s.audit_id).join(","),
);

// --- the same audit id recorded twice ---------------------------------------

const rerun = deriveQualityTrend(
  [
    audit("2026-08", "2026-08-01T00:00:00.000Z", { web: { SEC: 60 } }),
    audit("2026-09", "2026-09-01T00:00:00.000Z", { web: { SEC: 65 } }),
    audit("2026-09", "2026-09-03T00:00:00.000Z", { web: { SEC: 70 } }),
  ],
  undefined,
  live({ web: { SEC: 78 } }),
);
check("a re-run --record keeps one snapshot per audit id", rerun.snapshots.length === 2);
check("the latest record of an audit id wins", rerun.latest?.scores.web.SEC === 70 && rerun.latest?.ts === "2026-09-03T00:00:00.000Z");
check("two records of one audit never read as a flat trend", trendRows(rerun).rows.every((row) => row.cells.web.delta !== 0));

// --- the baseline rule: the live matrix against the snapshot before the newest

const justRecorded = deriveQualityTrend(
  [
    audit("2026-08", "2026-08-01T00:00:00.000Z", { web: { SEC: 60, PRF: 40 } }),
    audit("2026-09", "2026-09-01T00:00:00.000Z", { web: { SEC: 70, PRF: 40 } }),
  ],
  undefined,
  live({ web: { SEC: 70, PRF: 40 } }),
);
check("a live matrix equal to the newest snapshot compares against the one before it", justRecorded.previous?.audit_id === "2026-08");
check("so the arrow right after --record still shows the audit's movement", eq(justRecorded.deltaCell("SEC", "web"), { previous: 60, delta: 10, audit_id: "2026-08" }));
check("and a cell that did not move reads unchanged", justRecorded.deltaCell("PRF", "web").delta === 0);

const drifted = deriveQualityTrend(
  [
    audit("2026-08", "2026-08-01T00:00:00.000Z", { web: { SEC: 60 } }),
    audit("2026-09", "2026-09-01T00:00:00.000Z", { web: { SEC: 70 } }),
  ],
  undefined,
  live({ web: { SEC: 72 } }),
);
check("a live matrix that has moved since the newest snapshot compares against the newest", drifted.previous?.audit_id === "2026-09" && drifted.deltaCell("SEC", "web").delta === 2);

const firstJustRecorded = deriveQualityTrend(
  [audit("2026-08", "2026-08-01T00:00:00.000Z", { web: { SEC: 60 } })],
  undefined,
  live({ web: { SEC: 60 } }),
);
check("a first audit the live matrix matches has no baseline — no arrow, not an unchanged one", firstJustRecorded.previous === null && eq(firstJustRecorded.deltaCell("SEC", "web"), { previous: null, delta: null }));

// A cell set differing only in which cells exist is a different cell set.
const widened = deriveQualityTrend(
  [audit("2026-08", "2026-08-01T00:00:00.000Z", { web: { SEC: 60 } })],
  undefined,
  live({ web: { SEC: 60, PRF: 50 } }),
);
check("a live matrix with a cell the newest snapshot lacks differs from it", widened.previous?.audit_id === "2026-08" && widened.deltaCell("SEC", "web").delta === 0);

// --- framework major bump ----------------------------------------------------

const bumped = deriveQualityTrend(
  [
    audit("2026-08", "2026-08-01T00:00:00.000Z", { web: { SEC: 60 } }, { framework_version: "1.4.0" }),
    audit("2026-09", "2026-09-01T00:00:00.000Z", { web: { SEC: 70 } }, { framework_version: "2.0.0" }),
    audit("2026-10", "2026-10-01T00:00:00.000Z", { web: { SEC: 75 } }, { framework_version: "2.1.0" }),
  ],
  undefined,
  live({ web: { SEC: 80 } }, "3.0.0"),
);
check("the oldest snapshot is comparable by default", bumped.snapshots[0].comparable === true);
check("a snapshot across a major bump is marked not comparable", bumped.snapshots[1].comparable === false);
check("a minor bump stays comparable", bumped.snapshots[2].comparable === true);
const bumpedRows = trendRows(bumped).rows;
check("no delta is read across the major boundary", bumpedRows[1].cells.web.delta === null && bumpedRows[2].cells.web.delta === 5, JSON.stringify(bumpedRows.map((r) => r.cells.web)));
check(
  "a live matrix on another major than its baseline reads the previous score but no delta",
  eq(bumped.deltaCell("SEC", "web"), { previous: 75, delta: null, audit_id: "2026-10" }),
  JSON.stringify(bumped.deltaCell("SEC", "web")),
);
check("frameworkMajor reads a leading integer and nothing else", frameworkMajor("2.1.0") === 2 && frameworkMajor("v3") === 3 && frameworkMajor("next") === null && frameworkMajor(undefined) === null);

const versionless = deriveQualityTrend(
  [
    audit("2026-08", "2026-08-01T00:00:00.000Z", { web: { SEC: 60 } }, { framework_version: undefined }),
    audit("2026-09", "2026-09-01T00:00:00.000Z", { web: { SEC: 70 } }),
  ],
);
check("a snapshot with no version is compared leniently rather than refused", versionless.snapshots[1].comparable === true);

// --- lenient and total -------------------------------------------------------

const malformed = deriveQualityTrend([
  audit("2026-08", "2026-08-01T00:00:00.000Z", "not scores", { counts: "nope" }),
  audit("2026-09", "2026-09-01T00:00:00.000Z", { web: { SEC: "70", PRF: 50, A11Y: NaN }, ios: [1, 2], android: null }),
  { id: "01X", ts: "2026-09-02T00:00:00.000Z", type: "quality.audit.completed" },
  { id: "01Y", ts: "2026-09-03T00:00:00.000Z", type: "quality.finding.opened", finding_id: "F-1" },
  null,
  "junk",
]);
check("a malformed scores payload is a snapshot with no cells, never a throw", malformed.snapshots[0].audit_id === "2026-08" && eq(malformed.snapshots[0].scores, {}) && eq(malformed.snapshots[0].overall, {}));
check("malformed counts fall back to zeros", eq(malformed.snapshots[0].counts, { critical: 0, high: 0, medium: 0, low: 0, info: 0 }));
check("non-numeric cells are dropped, numeric ones kept", eq(malformed.snapshots[1].scores, { web: { PRF: 50 } }), JSON.stringify(malformed.snapshots[1].scores));
check("an event with no audit_id keys by its own id", malformed.snapshots[2].audit_id === "01X");
check("other event types and non-events are ignored", malformed.snapshots.length === 3);

// --- unknown surface in a payload -------------------------------------------

const stranger = deriveQualityTrend(
  [audit("2026-08", "2026-08-01T00:00:00.000Z", { web: { SEC: 60 }, legacy: { SEC: 20 } })],
  { domain_weights: { SEC: 2 } },
  live({ web: { SEC: 66 } }),
);
check("a surface the profile no longer declares still rolls up in its snapshot", stranger.latest?.overall.legacy === 20);
check("a snapshot cell the live matrix lacks keeps its reading but has no delta", eq(stranger.deltaCell("SEC", "legacy"), { previous: 20, delta: null, audit_id: "2026-08" }));
check("a live cell the snapshot never scored has no reading", eq(stranger.deltaCell("PRF", "web"), { previous: null, delta: null }));
check("trendRows lists surfaces in order of first appearance", eq(trendRows(stranger).surfaces, ["web", "legacy"]));
check("trendRows narrows to one surface", eq(trendRows(stranger, { surface: "web" }).surfaces, ["web"]));
check("trendRows can read one domain instead of the roll-up", trendRows(stranger, { domain: "SEC" }).rows[0].cells.web.score === 60);
check("trendRows reads null for a domain the row did not score", trendRows(stranger, { domain: "PRF" }).rows[0].cells.web.score === null);

// --- overall uses the profile's weights -------------------------------------

const weighted = deriveQualityTrend(
  [audit("2026-08", "2026-08-01T00:00:00.000Z", { web: { SEC: 100, PRF: 0 } })],
  { domain_weights: { SEC: 3 } },
);
check("overall is the weighted mean under domain_weights", weighted.latest?.overall.web === 75, String(weighted.latest?.overall.web));
check("rollUpSurface treats a missing weight as 1 and nothing as null", rollUpSurface({ SEC: 100, PRF: 0 }) === 50 && rollUpSurface({}) === null);

// --- formatDelta -------------------------------------------------------------

check("formatDelta spells up, down, flat and nothing", formatDelta(6) === "▲ +6" && formatDelta(-3) === "▼ −3" && formatDelta(0) === "=" && formatDelta(null) === null && formatDelta(undefined) === null);

// --- golden: the pilot matrix replayed as one event rolls up identically ------

const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures/quality/pilot-2026-08.json"), "utf8"));
const pack = JSON.parse(fs.readFileSync(path.join(ROOT, "packages/kritik-library/framework.json"), "utf8"));
const library = { version: pack.version, domains: pack.domains, criteria: pack.criteria, scales: pack.scales };
const section = fixture.section;
const matrix = deriveQualityMatrix({ quality: section }, library);
const event = makeEvent("quality.audit.completed", auditCompletedInput(matrix, { audit_id: "2026-08", framework_version: matrix.framework_version ?? "0.1.0", commit: "abc123" }).payload, { actor: "test" });
const golden = deriveQualityTrend([event], section.profile, matrix);

check("the golden replay yields one snapshot with the pilot's commit", golden.snapshots.length === 1 && golden.latest?.commit === "abc123");
check("the snapshot's overall equals deriveQualityMatrix.overall, surface for surface", eq(golden.latest?.overall, matrix.overall), `${JSON.stringify(golden.latest?.overall)} vs ${JSON.stringify(matrix.overall)}`);
check("the snapshot's counts are the matrix's finding counts", eq(golden.latest?.counts, matrix.finding_counts));
check("a live matrix that IS the only recorded audit has no baseline", golden.previous === null && golden.deltaCell("SEC", "web").previous === null);

const goldenMoved = deriveQualityTrend([event], section.profile, { ...matrix, matrix: { ...matrix.matrix, SEC: { ...matrix.matrix.SEC, web: { ...matrix.matrix.SEC.web, score: matrix.matrix.SEC.web.score + 4 } } } });
check("one cell moving makes the recorded audit the baseline again", goldenMoved.previous?.audit_id === "2026-08" && goldenMoved.deltaCell("SEC", "web").delta === 4);

console.log(failures === 0 ? "\nAll quality-trend tests OK" : `\n${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
