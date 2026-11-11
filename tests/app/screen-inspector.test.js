#!/usr/bin/env node

/**
 * The Screens map's quick inspector and touch reveal
 * (docs/superpowers/specs/2026-11-11-screens-map-design.md § Interaction):
 * how lib/utils/screen-inspector.ts words a screen's platform cells, which
 * strips it links to, where the touch chips go, and what a selection or a cold
 * `?node=` load frames. The wall is built by hand here: buildWall's own rules
 * are tests/app/screen-wall.test.js's job.
 *
 * Dates go through formatShotDate (toLocaleDateString), so every expected date
 * is computed the same way rather than pinned.
 */

const assert = require("node:assert/strict");
const { loadScreenInspector } = require("./load-screen-inspector");

const {
  shotLine,
  staleLine,
  proofLine,
  inspectorRows,
  stripLinks,
  frameInStrip,
  cellWord,
  formatShotDate,
  LOOSE_STRIP_ID,
} = loadScreenInspector();

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures++;
    console.error(`  ✗ ${name}\n    ${error.message}`);
  }
}

const day = (ts) => formatShotDate(ts);

function cell(platform, state, overrides = {}) {
  return { platform, state, status: null, shot: null, staleBecause: [], proof: null, ...overrides };
}
function shot(source, ts, overrides = {}) {
  return { value: "data:image/png;base64,AA==", form: "data", source, ts, commit: null, ...overrides };
}
function reason(id, ts, label) {
  return { eventId: id, ts, kind: "status", nodeId: "V-a", label };
}

const T1 = "2026-10-01T10:00:00.000Z";
const T2 = "2026-10-05T10:00:00.000Z";
const T3 = "2026-10-15T09:00:00.000Z";

const screenA = {
  viewId: "V-a",
  title: "Check-in sheet",
  cells: {
    web: cell("web", "live-current", { status: "live", shot: shot("ci", T1, { commit: "a1b2c3d" }), proof: { kind: "hand", ts: T1, actor: "alexis", detail: null } }),
    ios: cell("ios", "live-stale", {
      status: "live",
      shot: shot("manual", T1),
      staleBecause: [reason("e3", T3, "AC-x moved to Live on iOS"), reason("e2", T2, "Pull request merged"), reason("e1", T1, "Shipped: Weekly wrap")],
      proof: { kind: "deploy", ts: T3, actor: "arkaik-ci", detail: "TestFlight build 412" },
    }),
    android: cell("android", "not-live", { status: "development", shot: shot(null, null) }),
  },
  touches: [],
  stripIds: ["strip:F-checkin", "strip:F-weekly", LOOSE_STRIP_ID],
};

const wall = {
  strips: [
    { id: "strip:F-checkin", flowId: "F-checkin", title: "Daily check-in", items: [{ kind: "frame", id: "V-a@F-checkin:0", viewId: "V-a" }], viewIds: ["V-a"] },
    {
      id: "strip:F-weekly",
      flowId: "F-weekly",
      title: "Weekly wrap",
      items: [
        { kind: "arm", id: "arm:F-weekly:0.0", branch: "condition", label: "Has a streak?", arm: "Yes", first: true, empty: false },
        { kind: "frame", id: "V-a@F-weekly:0.0.0", viewId: "V-a" },
        { kind: "frame", id: "V-a@F-weekly:1", viewId: "V-a" },
      ],
      viewIds: ["V-a"],
    },
    { id: LOOSE_STRIP_ID, flowId: null, title: "Not in a flow", items: [{ kind: "frame", id: "V-a@loose", viewId: "V-a" }], viewIds: ["V-a"] },
  ],
  screens: new Map([["V-a", screenA]]),
  platforms: ["web", "ios", "android"],
  empty: null,
  anyShot: true,
};

console.log("screen inspector: wording");

test("a CI shot reads its date and From CI", () => {
  assert.equal(shotLine(screenA.cells.web), `Shot ${day(T1)} · From CI`);
});

test("a manual shot reads Recorded by hand", () => {
  assert.equal(shotLine(screenA.cells.ios), `Shot ${day(T1)} · Recorded by hand`);
});

test("a slot with no provenance reads Legacy shot, with no date to give", () => {
  assert.equal(shotLine(screenA.cells.android), "Legacy shot");
});

test("an empty slot has no shot line, and a malformed date is left out rather than printed", () => {
  assert.equal(shotLine(cell("web", "live-no-shot", { status: "live" })), null);
  assert.equal(shotLine(cell("web", "live-current", { shot: shot("ci", "not a date") })), "From CI");
});

test("the stale line is the newest reason, its date, and how many more", () => {
  assert.equal(staleLine(screenA.cells.ios), `AC-x moved to Live on iOS · ${day(T3)} · and 2 more`);
  assert.equal(
    staleLine(cell("ios", "live-stale", { staleBecause: [reason("e9", T2, "Pull request merged")] })),
    `Pull request merged · ${day(T2)}`,
  );
  assert.equal(staleLine(screenA.cells.web), null);
});

test("proof: a deploy names its date and its evidence", () => {
  assert.equal(proofLine(screenA.cells.ios), `Live from a deploy · ${day(T3)} · TestFlight build 412`);
  assert.equal(
    proofLine(cell("ios", "live-current", { proof: { kind: "deploy", ts: T3, actor: "arkaik-ci", detail: null } })),
    `Live from a deploy · ${day(T3)}`,
  );
});

test("proof: by hand, with or without a recorded move", () => {
  assert.equal(proofLine(screenA.cells.web), `Live, set by hand · ${day(T1)}`);
  assert.equal(proofLine(cell("web", "live-current", { proof: { kind: "hand", ts: null, actor: null, detail: null } })), "Live, set by hand");
});

test("proof: unknown says so, and a cell that is not live has no proof line", () => {
  assert.equal(
    proofLine(cell("web", "live-no-shot", { proof: { kind: "unknown", ts: null, actor: null, detail: null } })),
    "No record of how this went live",
  );
  assert.equal(proofLine(screenA.cells.android), null);
});

test("one row per platform of the wall, in the wall's order, worded by the model's cellWord", () => {
  const rows = inspectorRows(wall, screenA);
  assert.deepEqual(rows.map((row) => row.platform), ["web", "ios", "android"]);
  assert.deepEqual(rows.map((row) => row.platformLabel), ["Web", "iOS", "Android"]);
  assert.deepEqual(rows.map((row) => row.word), [screenA.cells.web, screenA.cells.ios, screenA.cells.android].map(cellWord));
  assert.deepEqual(rows.map((row) => row.tone), ["live", "gap", "quiet"]);
  assert.deepEqual(rows.map((row) => row.state), ["live-current", "live-stale", "not-live"]);
});

test("a row names the status only when its word does not already say it", () => {
  const rows = inspectorRows(wall, screenA);
  assert.equal(rows[0].status, null, "Live says Live");
  assert.equal(rows[1].status, "Live", "Stale is still Live");
  assert.equal(rows[2].status, null, "a not-live word is the status label itself");
  const absent = inspectorRows({ ...wall, platforms: ["web"] }, { ...screenA, cells: { web: cell("web", "absent", { status: "live" }) } });
  assert.equal(absent[0].status, null, "an absent platform names no status");
});

test("rows carry the shot, stale and proof lines; a platform with no cell is left out", () => {
  const rows = inspectorRows(wall, screenA);
  assert.equal(rows[1].shot, shotLine(screenA.cells.ios));
  assert.equal(rows[1].stale, staleLine(screenA.cells.ios));
  assert.equal(rows[1].proof, proofLine(screenA.cells.ios));
  const partial = inspectorRows(wall, { ...screenA, cells: { ios: screenA.cells.ios } });
  assert.deepEqual(partial.map((row) => row.platform), ["ios"]);
});

test("strip links: the strip it was selected in, then the others in strip order", () => {
  const { current, also } = stripLinks(wall, screenA, "strip:F-weekly");
  assert.deepEqual(current, { stripId: "strip:F-weekly", title: "Weekly wrap" });
  assert.deepEqual(also, [
    { stripId: "strip:F-checkin", title: "Daily check-in" },
    { stripId: LOOSE_STRIP_ID, title: "Not in a flow" },
  ]);
});

test("strip links skip an id the wall does not have", () => {
  const { current, also } = stripLinks(wall, { ...screenA, stripIds: ["strip:F-checkin", "strip:gone"] }, "strip:F-gone");
  assert.equal(current, null);
  assert.deepEqual(also, [{ stripId: "strip:F-checkin", title: "Daily check-in" }]);
});

test("frameInStrip finds the view's first frame in that strip, past markers", () => {
  assert.equal(frameInStrip(wall, "strip:F-weekly", "V-a"), "V-a@F-weekly:0.0.0");
  assert.equal(frameInStrip(wall, LOOSE_STRIP_ID, "V-a"), "V-a@loose");
  assert.equal(frameInStrip(wall, "strip:F-weekly", "V-b"), null);
  assert.equal(frameInStrip(wall, "strip:nope", "V-a"), null);
});

// --- chips, selection and cold load (Task 2) ---

if (failures) {
  console.error(`\n${failures} failing`);
  process.exit(1);
}
console.log("\nAll screen inspector tests passed");
