#!/usr/bin/env node

/**
 * Regression detection between two Kritik audits (issue #382 phase E).
 *
 * Pure and DB-free — the module imports nothing at runtime but ./quality — so
 * this runs in CI's fast build job beside the other quality suites.
 *
 * THE PACK BELOW IS NOT THE DEFAULT ONE, and that is the point. The shipped
 * pack's severity buckets are byte-identical to DEFAULT_SEVERITY_BUCKETS, so a
 * suite that scored against it could not tell "reads the pack's scales" from
 * "hardcodes the schema defaults" — a hole that survived from phase A to phase
 * D unnoticed. Scoring against retuned buckets is what makes the provenance
 * assertion real.
 */

const { loadSchema } = require("./load-schema");
const { detectRegressions, REGRESSION_SIGNALS } = loadSchema();

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`PASS: ${name}`);
  else { failures++; console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`); }
}

// Critical starts at 9 here, not 20: `impact 3 x likelihood 3` is Critical
// under this pack and Medium under the schema defaults.
const RETUNED = {
  version: "test-1.0",
  domains: [{ code: "SEC", name: "Security" }],
  criteria: [{ id: "SEC-01", domain: "SEC", weight: 1 }],
  scales: { severity_buckets: { critical: [9, 25], high: [6, 8], medium: [3, 5], low: [2, 2], info: [1, 1] } },
};
const DEFAULTS = {
  version: "test-defaults",
  domains: [{ code: "SEC", name: "Security" }],
  criteria: [{ id: "SEC-01", domain: "SEC", weight: 1 }],
};

const assess = (criterion, surface, level, audit) => ({
  criterion_id: criterion, surface, level, evidence: "e", audit_id: audit, ts: `${audit}-01T00:00:00.000Z`,
});
const find = (id, over = {}) => ({
  id, criterion_id: "SEC-01", surface: "web", title: `t ${id}`, detail: "d", evidence: "e",
  impact: 3, likelihood: 3, cost: "M", status: "open", ...over,
});

// --- level-drop --------------------------------------------------------------

const dropped = detectRegressions(
  { assessments: [assess("SEC-01", "web", 3, "2026-08")], findings: [] },
  { assessments: [assess("SEC-01", "web", 2, "2026-09")], findings: [] },
  RETUNED,
);
check("a level drop is a regression", dropped.length === 1 && dropped[0].kind === "level-drop", JSON.stringify(dropped));
check("the detail names both levels and both audits", dropped[0]?.detail === "level 3 → 2 (2026-08 → 2026-09)", dropped[0]?.detail);
check("the signal is the statement that no longer holds", dropped[0]?.signal === REGRESSION_SIGNALS["level-drop"]);

const climbed = detectRegressions(
  { assessments: [assess("SEC-01", "web", 2, "2026-08")], findings: [] },
  { assessments: [assess("SEC-01", "web", 3, "2026-09")], findings: [] },
  RETUNED,
);
check("an improvement is not a regression", climbed.length === 0, JSON.stringify(climbed));

// --- the guard, and its exemption -------------------------------------------

const unscored = detectRegressions(
  { assessments: [], findings: [] },
  { assessments: [assess("SEC-01", "web", 1, "2026-09")], findings: [find("F-1")] },
  RETUNED,
);
check("a cell scored in only one audit fires nothing", unscored.length === 0, JSON.stringify(unscored));

const reopened = detectRegressions(
  { assessments: [], findings: [find("F-1", { status: "resolved" })] },
  { assessments: [], findings: [find("F-1", { status: "open" })] },
  RETUNED,
);
check("a reopen fires with no cell reading at all", reopened.length === 1 && reopened[0].kind === "reopened-finding", JSON.stringify(reopened));
check("the reopen detail quotes the title", reopened[0]?.detail.includes("t F-1"), reopened[0]?.detail);

// --- new-severe-finding, scored against the RETUNED pack ---------------------

const both = [assess("SEC-01", "web", 3, "2026-08")];
const bothNext = [assess("SEC-01", "web", 3, "2026-09")];

const severe = detectRegressions(
  { assessments: both, findings: [] },
  { assessments: bothNext, findings: [find("F-2")] },
  RETUNED,
);
check("a new Critical on a comparable cell is a regression", severe.length === 1 && severe[0].kind === "new-severe-finding", JSON.stringify(severe));
check("the detail carries the pack's severity", severe[0]?.detail.includes("critical"), severe[0]?.detail);

// The other half of the provenance pair, and it guards the OPPOSITE direction
// from the assertion above — worth being exact about, because the whole point
// of this suite is knowing which assertion protects you.
//
// impact 3 x likelihood 3 is 9: Critical under RETUNED, Medium under the schema
// defaults. A mutant that hardcodes the DEFAULT buckets is killed by the
// RETUNED assertion above (it reports no regression where one is expected);
// this assertion still passes under such a mutant. What it catches is a mutant
// hardcoding buckets LOWER than the defaults, which would invent a regression
// here. Together they pin severity to the pack in both directions; neither
// does it alone.
const defaults = detectRegressions(
  { assessments: both, findings: [] },
  { assessments: bothNext, findings: [find("F-2")] },
  DEFAULTS,
);
check("the same finding is NOT severe under the default buckets", defaults.length === 0, JSON.stringify(defaults));

const carried = detectRegressions(
  { assessments: both, findings: [find("F-2")] },
  { assessments: bothNext, findings: [find("F-2")] },
  RETUNED,
);
check("a Critical carried forward is not re-reported", carried.length === 0, JSON.stringify(carried));

// --- every kind together -----------------------------------------------------

const all = detectRegressions(
  { assessments: both, findings: [find("F-3", { status: "resolved" })] },
  { assessments: [assess("SEC-01", "web", 1, "2026-09")], findings: [find("F-3"), find("F-4")] },
  RETUNED,
);
check("every kind fires together", new Set(all.map((r) => r.kind)).size === 3, JSON.stringify(all.map((r) => r.kind)));
check("every regression carries a cell", all.every((r) => r.criterion_id === "SEC-01" && r.surface === "web"), JSON.stringify(all));

process.exit(failures ? 1 : 0);
