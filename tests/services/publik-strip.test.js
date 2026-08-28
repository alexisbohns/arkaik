#!/usr/bin/env node

/**
 * What a Publik snapshot withholds by default (lib/services/publik.ts →
 * `stripJournal`, `stripQuality`).
 *
 * Deliberately DATABASE-FREE, and therefore in CI's fast `build` job rather
 * than the Postgres-backed `services` one — the same reasoning as
 * tests/services/publik-ip.test.js. Both functions are pure object rewrites;
 * nothing about them needs a migrated schema, and a regression here should fail
 * on a laptop with no Postgres running.
 *
 * What is actually at stake: `POST /api/publik` is unauthenticated and stores
 * whatever it is handed, verbatim and immutably, behind a public URL. A Kritik
 * quality section (docs/rfcs/kritik.md § 4.1) lists open, unfixed findings with
 * their severity, their evidence, and the file paths to reach them. Publishing
 * that is not publishing a quality report — it is publishing a roadmap, which
 * is why § 8.3 makes it opt-in. The assertions below are about exactly one
 * thing: that neither section can leave the server unless the caller asked for
 * it, and that asking for one never implies the other.
 */

const { loadPublikApi } = require("./load-publik-api");

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`PASS: ${name}`);
  else {
    failures++;
    console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const { publik } = loadPublikApi();
const { stripJournal, stripQuality } = publik;

const bundle = () => ({
  schema_version: 3,
  project: { id: "p", title: "P", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" },
  nodes: [{ id: "V-a", project_id: "p", species: "view", title: "A", status: "live", platforms: ["web"] }],
  edges: [],
  journal: [{ id: "01A", ts: "2026-01-01T00:00:00.000Z", type: "node.created", node_id: "V-a", species: "view", title: "A" }],
  quality: {
    framework_version: "0.1.0",
    profile: { surfaces: [{ id: "web", title: "Web" }] },
    assessments: [{ criterion_id: "SEC-01", surface: "web", level: 1, evidence: "middleware.ts:12", audit_id: "2026-08", ts: "2026-08-26T00:00:00.000Z" }],
    findings: [{ id: "F-1", criterion_id: "SEC-01", surface: "web", title: "Session never revoked server-side", detail: "d", evidence: "middleware.ts:12", impact: 5, likelihood: 4, cost: "S", status: "open" }],
  },
});

// --- stripQuality ------------------------------------------------------------

const source = bundle();
const withoutQuality = stripQuality(source);
const everythingElse = { ...bundle() };
delete everythingElse.quality;
check("stripQuality removes the quality section", !("quality" in withoutQuality));
check("stripQuality keeps every other key verbatim", JSON.stringify(withoutQuality) === JSON.stringify(everythingElse));
check("stripQuality does not mutate its input", "quality" in source);
check("stripQuality on a bundle with no quality section is a no-op", (() => {
  const plain = stripQuality({ project: { id: "p" }, nodes: [], edges: [] });
  return !("quality" in plain) && plain.project.id === "p";
})());

// --- the two strips are independent -----------------------------------------

const journalOnly = stripQuality(bundle());
check("opting into the journal does not publish the quality section", "journal" in journalOnly && !("quality" in journalOnly));
const qualityOnly = stripJournal(bundle());
check("opting into quality does not publish the journal", "quality" in qualityOnly && !("journal" in qualityOnly));
const neither = stripQuality(stripJournal(bundle()));
check("the default withholds both", !("journal" in neither) && !("quality" in neither) && neither.nodes.length === 1);

// --- what the default actually protects --------------------------------------

check("no finding evidence survives the default strip", !JSON.stringify(neither).includes("middleware.ts:12"));
check("no finding title survives the default strip", !JSON.stringify(neither).includes("Session never revoked"));

console.log(failures === 0 ? "\nAll Publik strip tests passed" : `\n${failures} Publik strip test(s) failed`);
process.exit(failures === 0 ? 0 : 1);
