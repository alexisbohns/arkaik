#!/usr/bin/env node

/**
 * Part C of the stake architecture (docs/superpowers/specs/2026-11-22-stake-architecture-parts-5-6-design.md):
 * the stored inputs of the proof. Every Kritik criterion carries a version, a
 * stake stores how long its verification holds and the criterion version it was
 * last verified against, and the validator warns on the shapes that cannot hold.
 *
 * Run: npm run test:criterion-version
 */

const fs = require("fs");
const path = require("path");
const { loadSchema } = require("./load-schema");

const {
  kritikCriterionVersion,
  mergeKritikLibrary,
  stakeMetadataWith,
  stakeReverifyDaysOf,
  stakeVerifiedCriterionVersionOf,
  parseBundle,
  validateBundle,
} = loadSchema();

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`PASS: ${name}`);
  else {
    failures += 1;
    console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// --- The pack ----------------------------------------------------------------

const pack = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "packages", "kritik-library", "framework.json"), "utf8"));
const unversioned = pack.criteria.filter((criterion) => !Number.isInteger(criterion.version) || criterion.version < 1);
check("every pack criterion has an integer version of at least 1", unversioned.length === 0, unversioned.map((c) => c.id).join(", "));
check("the pack's own version did not move for it (a saved plan stays current)", pack.version === "0.1.0", pack.version);

// --- kritikCriterionVersion --------------------------------------------------

check("the real pack reads version 1 for a criterion", kritikCriterionVersion("SAF-01", pack) === 1);
check("a criterion that carries a later version reads it", kritikCriterionVersion("X-01", { criteria: [{ id: "X-01", domain: "X", version: 3 }] }) === 3);
const synthesized = { criteria: [{ id: "SAF-01", domain: "SAF", weight: 1 }], domains: [], version: "0" };
check("a synthesized library (no versions) reads 1, the baseline", kritikCriterionVersion("SAF-01", synthesized) === 1);
check("an unknown criterion reads undefined", kritikCriterionVersion("ZZZ-99", pack) === undefined);
check("no library reads undefined, never throws", kritikCriterionVersion("SAF-01", undefined) === undefined && kritikCriterionVersion("SAF-01", null) === undefined);
check("a library with no criteria array reads undefined", kritikCriterionVersion("SAF-01", {}) === undefined);
for (const bad of ["2", 0, -1, 1.5, NaN, null, {}]) {
  const library = { criteria: [{ id: "X-01", domain: "X", version: bad }] };
  check(`a malformed version (${JSON.stringify(bad)}) reads the baseline, not a guess`, kritikCriterionVersion("X-01", library) === 1);
}
check("a hole in the criteria array is skipped, not thrown on", kritikCriterionVersion("X-01", { criteria: [null, { id: "X-01", domain: "X", version: 2 }] }) === 2);

// --- mergeKritikLibrary ------------------------------------------------------

const merged = mergeKritikLibrary(pack, {
  criteria: [
    { id: "SAF-01", domain: "SAF", name: "Replaced locally" },
    { id: "SAF-02", domain: "SAF", name: "Replaced and versioned", version: 4 },
    { id: "X-01", domain: "SAF", name: "A custom one" },
  ],
});
const mergedById = (id) => merged.criteria.find((criterion) => criterion.id === id);
check("an overlay replacing a pack criterion without a version keeps the pack's", mergedById("SAF-01").name === "Replaced locally" && mergedById("SAF-01").version === 1);
check("…and the replacement still supersedes the rest of the criterion", mergedById("SAF-01").definition === undefined);
check("an overlay that states its own version keeps it", mergedById("SAF-02").version === 4);
check("a purely custom criterion gets no invented version (it reads the baseline)", mergedById("X-01").version === undefined && kritikCriterionVersion("X-01", merged) === 1);
const packBefore = pack.criteria.find((criterion) => criterion.id === "SAF-01");
check("the pack is not mutated by the merge", packBefore.name !== "Replaced locally" && packBefore.version === 1);
const bumped = { ...pack, criteria: pack.criteria.map((c) => (c.id === "SAF-01" ? { ...c, version: 2 } : c)) };
check("an overlay replacement keeps a bumped pack version, not the baseline", mergeKritikLibrary(bumped, { criteria: [{ id: "SAF-01", domain: "SAF" }] }).criteria.find((c) => c.id === "SAF-01").version === 2);

// --- stakeMetadataWith -------------------------------------------------------

const kritikLink = { source: "kritik", id: "SAF-01" };
const requirement = { stake_species: "requirement", catalog: kritikLink };
const withVersion = stakeMetadataWith(requirement, { verified_criterion_version: 2, reverify_every_days: 30 });
check("a requirement linked to Kritik keeps its verified version and interval", withVersion.verified_criterion_version === 2 && withVersion.reverify_every_days === 30);
check("undefined clears the interval", !("reverify_every_days" in stakeMetadataWith(withVersion, { reverify_every_days: undefined })));
check("undefined clears the verified version", !("verified_criterion_version" in stakeMetadataWith(withVersion, { verified_criterion_version: undefined })));
check("a patch naming one field keeps the other", stakeMetadataWith(withVersion, { reverify_every_days: 7 }).verified_criterion_version === 2);
check("changing the species to a user-facing one drops the verified version", !("verified_criterion_version" in stakeMetadataWith(withVersion, { stake_species: "need" })));
check("…and keeps the interval, which any species may carry", stakeMetadataWith(withVersion, { stake_species: "need" }).reverify_every_days === 30);
check("clearing the catalog link drops the verified version", !("verified_criterion_version" in stakeMetadataWith(withVersion, { catalog: undefined })));
check("a values link (which stops fitting) drops the verified version", !("verified_criterion_version" in stakeMetadataWith(withVersion, { catalog: { source: "values", id: "saves-time" } })));
check("a stake with no species yet cannot hold a verified version", !("verified_criterion_version" in stakeMetadataWith({ catalog: kritikLink, verified_criterion_version: 1 }, {})));
check("a stake with no Kritik link cannot be given a verified version", !("verified_criterion_version" in stakeMetadataWith({ stake_species: "risk" }, { verified_criterion_version: 1 })));
const moved = stakeMetadataWith(withVersion, { catalog: { source: "kritik", id: "SAF-02" } });
check("moving the link to another criterion drops the verified version", moved.catalog.id === "SAF-02" && !("verified_criterion_version" in moved));
check("…unless the same change states the version it was verified against", stakeMetadataWith(withVersion, { catalog: { source: "kritik", id: "SAF-02" }, verified_criterion_version: 3 }).verified_criterion_version === 3);
check("restating the same link keeps the verified version", stakeMetadataWith(withVersion, { catalog: { source: "kritik", id: "SAF-01" } }).verified_criterion_version === 2);
const frozen = JSON.stringify(withVersion);
stakeMetadataWith(withVersion, { stake_species: "need" });
check("stakeMetadataWith never mutates its input", JSON.stringify(withVersion) === frozen);
for (const species of ["requirement", "risk", "defect"]) {
  check(`a ${species} may hold a verified version`, stakeMetadataWith({ stake_species: species, catalog: kritikLink }, { verified_criterion_version: 5 }).verified_criterion_version === 5);
}

// --- The readers -------------------------------------------------------------

check("the interval reads a positive number", stakeReverifyDaysOf({ metadata: { reverify_every_days: 30 } }) === 30);
check("…and reads undefined for 0, a string, or nothing", [0, -1, "30", null, undefined].every((raw) => stakeReverifyDaysOf({ metadata: { reverify_every_days: raw } }) === undefined) && stakeReverifyDaysOf({}) === undefined);
check("the verified version reads a positive integer", stakeVerifiedCriterionVersionOf({ metadata: { verified_criterion_version: 2 } }) === 2);
check("…and reads undefined for 0, 1.5, a string, or nothing", [0, 1.5, "2", null].every((raw) => stakeVerifiedCriterionVersionOf({ metadata: { verified_criterion_version: raw } }) === undefined) && stakeVerifiedCriterionVersionOf({}) === undefined);

// --- The three warnings ------------------------------------------------------

const bundleWith = (md, species = "stake") => ({
  schema_version: 3,
  project: { id: "p1", title: "P", created_at: "2026-11-22T00:00:00.000Z", updated_at: "2026-11-22T00:00:00.000Z" },
  nodes: [
    { id: "V-a", project_id: "p1", species: "view", title: "A", status: "live", platforms: ["web"], ...(species === "view" ? { metadata: md } : {}) },
    ...(species === "stake" ? [{ id: "STK-a", project_id: "p1", species: "stake", title: "A stake", status: "idea", platforms: [], metadata: md }] : []),
  ],
  edges: species === "stake" ? [{ id: "e-STK-a-V-a", project_id: "p1", source_id: "STK-a", target_id: "V-a", edge_type: "concerns" }] : [],
});
const rulesOf = (md, species) => validateBundle(bundleWith(md, species)).findings.map((f) => `${f.severity}:${f.rule}`);
const quality = { stake_species: "requirement", catalog: kritikLink };

check("a clean stake with both fields raises none of the three", !rulesOf({ ...quality, reverify_every_days: 30, verified_criterion_version: 1 }).some((r) => /reverify|criterion-version/.test(r)));
for (const bad of [0, -3, "30", null, NaN, {}]) {
  check(`reverify_every_days ${JSON.stringify(bad)} warns stake-reverify-invalid`, rulesOf({ ...quality, reverify_every_days: bad }).includes("warning:stake-reverify-invalid"));
}
for (const ok of [1, 30, 0.5]) {
  check(`reverify_every_days ${ok} is a positive number and does not warn`, !rulesOf({ ...quality, reverify_every_days: ok }).includes("warning:stake-reverify-invalid"));
}
for (const bad of [0, 1.5, -1, "2", null]) {
  check(`verified_criterion_version ${JSON.stringify(bad)} warns stake-criterion-version-invalid`, rulesOf({ ...quality, verified_criterion_version: bad }).includes("warning:stake-criterion-version-invalid"));
}
check("verified_criterion_version 2 does not warn", !rulesOf({ ...quality, verified_criterion_version: 2 }).includes("warning:stake-criterion-version-invalid"));
check("a version on a stake with no catalog link warns stake-criterion-version-unlinked", rulesOf({ stake_species: "requirement", verified_criterion_version: 1 }).includes("warning:stake-criterion-version-unlinked"));
check("a version beside a values link warns stake-criterion-version-unlinked", rulesOf({ stake_species: "need", catalog: { source: "values", id: "saves-time" }, verified_criterion_version: 1 }).includes("warning:stake-criterion-version-unlinked"));
check("an invalid version on an unlinked stake raises the shape warning, not also the link one", !rulesOf({ stake_species: "requirement", verified_criterion_version: 0 }).includes("warning:stake-criterion-version-unlinked"));
check("all three are warnings, never errors", validateBundle(bundleWith({ stake_species: "need", reverify_every_days: 0, verified_criterion_version: 0.5 })).valid);
check("both fields are stake-only: a view carrying them warns stake-species-wrong-species", ["reverify_every_days", "verified_criterion_version"].every((field) => validateBundle(bundleWith({ [field]: 3 }, "view")).findings.some((f) => f.rule === "stake-species-wrong-species" && f.path.endsWith(field))));
check("the fields parse (they are optional metadata)", parseBundle(bundleWith({ ...quality, reverify_every_days: 30, verified_criterion_version: 2 })).success);

if (failures > 0) {
  console.log(`\n${failures} criterion version test(s) failed.`);
  process.exit(1);
}
console.log("\nAll criterion version tests passed.");
