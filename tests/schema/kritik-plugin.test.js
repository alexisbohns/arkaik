#!/usr/bin/env node

/**
 * The Kritik plugin channel (docs/rfcs/kritik.md § 5-6, issue #382 phase B):
 * the overlay merge in @arkaik/schema, and the three generated scripts run
 * end-to-end the way a consuming repo runs them.
 *
 * The second half is the part worth having. It builds a throwaway repo in a
 * temp dir, writes the Pebbles pilot audit into it from the committed fixture,
 * and drives `init-profile.js` → `compute-matrix.js` → `scaffold-criterion.js`
 * as separate Node processes with no `node_modules` on the path — which is the
 * only way to find out whether the zero-dependency claim is still true. A
 * bundling regression that broke these scripts would otherwise surface for the
 * first time in someone else's repository.
 *
 * The matrix assertion is the same golden as tests/schema/quality.test.js, but
 * reached through the shipped artifacts rather than through the module: the
 * scripts must reproduce the pilot's committed matrix exactly.
 */

const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { loadSchema } = require("./load-schema");

const ROOT = path.join(__dirname, "..", "..");
const SCRIPTS = path.join(ROOT, "plugin-kritik", "scripts");
const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures/quality/pilot-2026-08.json"), "utf8"));

const { mergeKritikLibrary, applicableCells } = loadSchema();

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`PASS: ${name}`);
  else {
    failures++;
    console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Run a generated script in `cwd`; returns stdout, or throws with stderr attached. */
function run(script, args, cwd) {
  return execFileSync(process.execPath, [path.join(SCRIPTS, script), ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}
/** Run expecting a non-zero exit; returns the stderr the user would see. */
function runExpectingFailure(script, args, cwd) {
  try {
    run(script, args, cwd);
    return null;
  } catch (err) {
    return String(err.stderr ?? "");
  }
}

// --- mergeKritikLibrary ------------------------------------------------------

const pack = {
  version: "0.1.0",
  domains: [{ code: "SEC", name: "Security" }],
  criteria: [
    { id: "SEC-01", domain: "SEC", weight: 3, applies_to: ["web", "ios"] },
    { id: "SEC-02", domain: "SEC", weight: 1, applies_to: ["web"] },
  ],
  scales: { caps: { critical_open: "D", high_open: "B" } },
};

check("no overlay returns the pack itself", mergeKritikLibrary(pack, null) === pack);
check("a non-object overlay returns the pack itself", mergeKritikLibrary(pack, undefined) === pack);

const merged = mergeKritikLibrary(pack, {
  extends: "0.1.0",
  domains: [{ code: "RIT", name: "Ritual integrity" }],
  criteria: [{ id: "X-01", domain: "RIT", weight: 2, applies_to: ["web"] }],
});
check("overlay criteria append after the pack's", eq(merged.criteria.map((c) => c.id), ["SEC-01", "SEC-02", "X-01"]));
check("overlay domains append after the pack's", eq(merged.domains.map((d) => d.code), ["SEC", "RIT"]));
check("the pack version wins — an overlay does not own it", merged.version === "0.1.0");
check("merge does not mutate the pack", pack.criteria.length === 2 && pack.domains.length === 1);

const overridden = mergeKritikLibrary(pack, { criteria: [{ id: "SEC-01", domain: "SEC", weight: 1 }] });
check("a matching id replaces in place, keeping pack order", eq(overridden.criteria.map((c) => c.id), ["SEC-01", "SEC-02"]));
check("replacement is whole, never a field merge", overridden.criteria[0].applies_to === undefined && overridden.criteria[0].weight === 1);
check("a matching domain code replaces in place", mergeKritikLibrary(pack, { domains: [{ code: "SEC", name: "Renamed" }] }).domains[0].name === "Renamed");
check("overlay scales shallow-merge over the pack's", eq(
  mergeKritikLibrary(pack, { scales: { grades: { A: 90 } } }).scales,
  { caps: { critical_open: "D", high_open: "B" }, grades: { A: 90 } },
));
check("a criterion with no id is skipped rather than corrupting the library", mergeKritikLibrary(pack, { criteria: [{ domain: "SEC" }] }).criteria.length === 2);
check("a malformed criteria value degrades to the pack", mergeKritikLibrary(pack, { criteria: "nope" }).criteria.length === 2);

// --- applicableCells ---------------------------------------------------------

check("applies_to intersects the selected surfaces", eq(
  applicableCells(pack, ["web", "ios", "admin"]),
  [{ criterion_id: "SEC-01", surfaces: ["web", "ios"] }, { criterion_id: "SEC-02", surfaces: ["web"] }],
));
check("a single-surface project collapses every cell set to one column", eq(
  applicableCells(pack, ["web"]),
  [{ criterion_id: "SEC-01", surfaces: ["web"] }, { criterion_id: "SEC-02", surfaces: ["web"] }],
));
check("a criterion applying to no selected surface drops out entirely", eq(applicableCells(pack, ["admin"]), []));
check("a retired criterion is never scheduled", eq(
  applicableCells({ criteria: [{ id: "SEC-02", domain: "SEC", applies_to: ["web"], superseded_by: "SEC-12" }] }, ["web"]),
  [],
));
check("a criterion with no applies_to widens rather than vanishing", eq(
  applicableCells({ criteria: [{ id: "X-01", domain: "RIT" }] }, ["web", "ios"]),
  [{ criterion_id: "X-01", surfaces: ["web", "ios"] }],
));
check("cross-surface is never scheduled as a column", eq(
  applicableCells({ criteria: [{ id: "X-01", domain: "RIT" }] }, ["web", "cross-surface"]),
  [{ criterion_id: "X-01", surfaces: ["web"] }],
));

// --- the generated scripts, end to end ---------------------------------------

const repo = fs.mkdtempSync(path.join(os.tmpdir(), "kritik-e2e-"));
try {
  const surfaces = fixture.section.profile.surfaces;
  const weights = fixture.section.profile.domain_weights ?? {};

  // 1. init-profile.js — the install-time surface picker.
  const profileArgs = [];
  for (const surface of surfaces) {
    profileArgs.push("--surface", `${surface.id}:${surface.title}${surface.platform ? `:${surface.platform}` : ""}`);
  }
  for (const [code, weight] of Object.entries(weights)) profileArgs.push("--weight", `${code}=${weight}`);
  run("init-profile.js", profileArgs, repo);

  const written = JSON.parse(fs.readFileSync(path.join(repo, "docs/quality/profile.json"), "utf8"));
  check("init-profile writes the surfaces it was given, in order", eq(written.surfaces.map((s) => s.id), surfaces.map((s) => s.id)));
  check("init-profile carries the platform mapping only where there is one", eq(
    written.surfaces.map((s) => s.platform ?? null),
    surfaces.map((s) => s.platform ?? null),
  ));
  check("init-profile carries the domain weights", eq(written.domain_weights, weights));

  const refused = runExpectingFailure("init-profile.js", ["--surface", "web:Web"], repo);
  check("init-profile refuses to clobber an existing profile", refused !== null && refused.includes("already exists"));
  check("the refusal explains what changing surfaces costs", refused.includes("invalidates every score"));

  const reserved = runExpectingFailure("init-profile.js", ["--surface", "cross-surface:X", "--force"], repo);
  check("init-profile rejects the reserved cross-surface id", reserved !== null && reserved.includes("reserved"));
  const badPlatform = runExpectingFailure("init-profile.js", ["--surface", "db:DB:postgres", "--force"], repo);
  check("init-profile rejects a platform that is not an Arkaik platform", badPlatform !== null && badPlatform.includes("not an Arkaik platform"));
  const badId = runExpectingFailure("init-profile.js", ["--surface", "Web App:x", "--force"], repo);
  check("init-profile rejects a non-kebab-case surface id", badId !== null && badId.includes("kebab-case"));

  // 2. compute-matrix.js — the roll-up, reproducing the pilot's committed matrix.
  const auditDir = path.join(repo, "docs/quality/audits/2026-08");
  fs.mkdirSync(auditDir, { recursive: true });
  fs.writeFileSync(path.join(auditDir, "scores.json"), JSON.stringify({
    audit_id: "2026-08",
    commit: fixture._source.commit,
    framework_version: fixture.section.framework_version,
    assessments: fixture.section.assessments,
  }));
  fs.writeFileSync(path.join(auditDir, "findings.json"), JSON.stringify({
    audit_id: "2026-08",
    findings: fixture.section.findings,
  }));

  const printed = run("compute-matrix.js", [], repo);
  const produced = JSON.parse(fs.readFileSync(path.join(auditDir, "matrix.json"), "utf8"));
  check("compute-matrix reproduces the pilot's matrix through the shipped script", eq(produced.matrix, fixture.expected.matrix));
  check("compute-matrix reproduces the pilot's surface roll-ups", eq(produced.overall, fixture.expected.overall));
  check("compute-matrix reproduces the pilot's open-finding counts", eq(produced.finding_counts, fixture.expected.finding_counts));
  check("compute-matrix carries the audited commit into the matrix", produced.commit === fixture._source.commit);
  check("compute-matrix defaults to the newest audit with no argument", produced.audit_id === "2026-08");
  check("the printed table marks a capped cell with an asterisk", /\(\w\*\)/.test(printed), printed.split("\n")[2]);
  check("the report leads with the P0 lane, not the matrix alone", printed.includes("P0 — fix first:"));

  // 3. scaffold-criterion.js — the overlay, and that it behaves like a pack criterion.
  const collision = runExpectingFailure("scaffold-criterion.js", [
    "--id", "SEC-01", "--domain", "SEC", "--name", "x", "--question", "y?", "--applies-to", "web",
    ...["l0", "l1", "l2", "l3", "l4"].flatMap((k) => ["--anchor", `${k}=a`]),
  ], repo);
  check("scaffold refuses to shadow a pack id by accident", collision !== null && collision.includes("already a pack criterion"));

  const partial = runExpectingFailure("scaffold-criterion.js", [
    "--id", "X-01", "--domain", "SEC", "--name", "x", "--question", "y?", "--applies-to", "web", "--anchor", "l0=a",
  ], repo);
  check("scaffold requires all five level anchors", partial !== null && partial.includes("missing anchors l1, l2, l3, l4"));

  const unknownDomain = runExpectingFailure("scaffold-criterion.js", [
    "--id", "X-01", "--domain", "RIT", "--name", "x", "--question", "y?", "--applies-to", "web",
    ...["l0", "l1", "l2", "l3", "l4"].flatMap((k) => ["--anchor", `${k}=a`]),
  ], repo);
  check("scaffold refuses a domain nobody declared", unknownDomain !== null && unknownDomain.includes("not a pack domain"));

  run("scaffold-criterion.js", [
    "--id", "X-01", "--domain", "RIT", "--domain-name", "Ritual integrity",
    "--name", "Streaks survive a timezone move", "--question", "Does a streak stay correct across a timezone change?",
    "--applies-to", "web,ios", "--weight", "2", "--impact", "4",
    ...["l0", "l1", "l2", "l3"].flatMap((k) => ["--anchor", `${k}=level ${k}`]),
    "--anchor", "l4=A CI harness replays a timezone move and blocks merge on drift.",
    "--signal", "No client computes a boundary from an unnormalized local date.",
  ], repo);

  const overlay = JSON.parse(fs.readFileSync(path.join(repo, "docs/quality/criteria.custom.json"), "utf8"));
  check("scaffold writes the criterion into the overlay", overlay.criteria.length === 1 && overlay.criteria[0].id === "X-01");
  check("scaffold defines the project's new domain alongside it", eq(overlay.domains, [{ code: "RIT", name: "Ritual integrity" }]));
  check("scaffold records the pack version the overlay was authored against", overlay.extends === fixture.section.framework_version);
  check("scaffold generates an issue skeleton for the custom criterion", typeof overlay.criteria[0].issue.body_skeleton === "string");

  const duplicate = runExpectingFailure("scaffold-criterion.js", ["--from", path.join(repo, "docs/quality/criteria.custom.json")], repo);
  check("scaffold refuses to silently replace an overlay criterion", duplicate !== null);

  // The custom criterion must now score and roll up exactly like a pack one.
  const scores = JSON.parse(fs.readFileSync(path.join(auditDir, "scores.json"), "utf8"));
  scores.assessments.push(
    { criterion_id: "X-01", surface: "web", level: 2, evidence: "lib/streak.ts:44", audit_id: "2026-08", ts: "2026-08-26T00:00:00.000Z" },
    { criterion_id: "X-01", surface: "ios", level: 4, evidence: "StreakStore.swift:71", audit_id: "2026-08", ts: "2026-08-26T00:00:00.000Z" },
  );
  fs.writeFileSync(path.join(auditDir, "scores.json"), JSON.stringify(scores));
  run("compute-matrix.js", [], repo);
  const withCustom = JSON.parse(fs.readFileSync(path.join(auditDir, "matrix.json"), "utf8"));
  check("the custom criterion gets its own matrix row", Boolean(withCustom.matrix.RIT));
  check("the custom row scores by its own weight and anchors", withCustom.matrix.RIT.web?.score === 50 && withCustom.matrix.RIT.ios?.score === 100);
  check("the custom row is N/A where applies_to excludes the surface", withCustom.matrix.RIT.android === null && withCustom.matrix.RIT.supabase === null);
  check("adding a domain leaves every pack row untouched", eq(withCustom.matrix.SEC, fixture.expected.matrix.SEC));

  const issue = run("scaffold-criterion.js", ["--emit-issue", "X-01", "--surface", "web", "--level", "2"], repo);
  check("the custom criterion emits a prefilled issue skeleton", issue.includes("Title: [Quality] X-01"));
  check("the skeleton fills the surface it was asked for", issue.includes("**Surface:** web"));
  check("the skeleton quotes the target level's own anchor", issue.includes("level l3"));
  check("the skeleton labels the issue with the surface", /Labels:.*\bweb\b/.test(issue));

  const packIssue = run("scaffold-criterion.js", ["--emit-issue", "SEC-01", "--surface", "ios"], repo);
  check("a pack criterion emits its skeleton through the same path", packIssue.includes("Title: [Quality] SEC-01"));

  // A pack bump must leave the overlay alone. Simulate one by scoring against a
  // library whose version moved and whose criteria grew.
  const packed = JSON.parse(fs.readFileSync(path.join(ROOT, "plugin-kritik/skills/kritik/references/library.json"), "utf8"));
  const bumped = { ...packed, version: "0.2.0", criteria: [...packed.criteria, { id: "SEC-99", domain: "SEC", weight: 1, applies_to: ["web"] }] };
  const after = mergeKritikLibrary(bumped, overlay);
  check("a pack bump leaves the custom criterion intact", Boolean(after.criteria.find((c) => c.id === "X-01")));
  check("a pack bump leaves the custom domain intact", Boolean(after.domains.find((d) => d.code === "RIT")));
  check("a pack bump's new criteria arrive alongside it", Boolean(after.criteria.find((c) => c.id === "SEC-99")));

  // --- what the plugin actually ships ---------------------------------------

  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "plugin-kritik/.claude-plugin/plugin.json"), "utf8"));
  const skill = fs.readFileSync(path.join(ROOT, "plugin-kritik/skills/kritik/SKILL.md"), "utf8");
  const skillVersion = skill.match(/^version:\s*(\S+)\s*$/m)?.[1];
  check("the manifest version is stamped from the skill frontmatter", manifest.version === skillVersion, `${manifest.version} vs ${skillVersion}`);
  check("the shipped skill is a byte-for-byte copy of its canonical source", skill === fs.readFileSync(path.join(ROOT, "docs/kritik-skill/skill.md"), "utf8"));
  check("the shipped pack is a byte-for-byte copy of the canonical pack", eq(packed, JSON.parse(fs.readFileSync(path.join(ROOT, "packages/kritik-library/framework.json"), "utf8"))));
  check("the shipped meta-model is a byte-for-byte copy of the SPEC",
    fs.readFileSync(path.join(ROOT, "plugin-kritik/skills/kritik/references/framework.md"), "utf8") ===
    fs.readFileSync(path.join(ROOT, "packages/kritik-library/SPEC.md"), "utf8"));

  const marketplace = JSON.parse(fs.readFileSync(path.join(ROOT, ".claude-plugin/marketplace.json"), "utf8"));
  const entry = marketplace.plugins.find((p) => p.name === "kritik");
  check("the marketplace lists kritik alongside arkaik", Boolean(entry) && entry.source === "./plugin-kritik");

  // The whole point of bundling: these run where there is no node_modules.
  for (const script of ["compute-matrix.js", "scaffold-criterion.js", "init-profile.js"]) {
    const source = fs.readFileSync(path.join(SCRIPTS, script), "utf8");
    check(`${script} bundles to a zero-dependency artifact`, !/require\((['"])(?!node:)/.test(source));
    check(`${script} is executable and shebanged`, source.startsWith("#!/usr/bin/env node"));
  }

  // A fresh repo must be told what to do, not handed a stack trace.
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), "kritik-bare-"));
  try {
    const noAudits = runExpectingFailure("compute-matrix.js", [], bare);
    check("compute-matrix in a repo with no audits says so plainly", noAudits !== null && noAudits.includes("no audits directory"));
    const wrongId = runExpectingFailure("compute-matrix.js", ["2026-08"], bare);
    check("compute-matrix names the file it could not find", wrongId !== null && wrongId.includes("no scores.json at"));
    fs.mkdirSync(path.join(bare, "docs/quality/audits/2026-01"), { recursive: true });
    fs.writeFileSync(path.join(bare, "docs/quality/audits/2026-01/scores.json"), JSON.stringify({ assessments: [] }));
    const stillNoProfile = runExpectingFailure("compute-matrix.js", [], bare);
    check("compute-matrix with no profile points at init-profile.js", stillNoProfile !== null && stillNoProfile.includes("init-profile.js"));
  } finally {
    fs.rmSync(bare, { recursive: true, force: true });
  }
} finally {
  fs.rmSync(repo, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nAll Kritik plugin tests passed" : `\n${failures} Kritik plugin test(s) failed`);
process.exit(failures === 0 ? 0 : 1);
