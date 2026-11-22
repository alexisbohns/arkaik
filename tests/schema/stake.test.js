#!/usr/bin/env node

/**
 * The stake species (docs/rfcs/stake-architecture.md, part 1): registration,
 * the `concerns` edge, the three metadata fields, their parse-boundary errors,
 * the validator's warnings, and the helpers the panel and the form write with.
 */

const fs = require("fs");
const path = require("path");
const { loadSchema } = require("./load-schema");

const schema = loadSchema();
const {
  SPECIES_IDS,
  SPECIES_PREFIXES,
  EDGE_TYPE_IDS,
  VALID_EDGE_SEMANTICS,
  edgeTypesForSpeciesPair,
  isValidEdgeSemantic,
  deriveNodeId,
  parseBundle,
  validateBundle,
  STAKE_SPECIES_IDS,
  STAKE_PROVENANCE_IDS,
  STAKE_LIFECYCLE_STATUSES,
  ANTICIPATED_STAKE_SPECIES,
  USER_FACING_STAKE_SPECIES,
  QUALITY_STAKE_SPECIES,
  STAKE_ANCHOR_SPECIES,
  STAKE_CATALOG_SOURCES,
  stakeSpeciesOf,
  stakeProvenanceOf,
  stakeCatalogOf,
  isUserFacingStakeSpecies,
  catalogSourceForStakeSpecies,
  stakeSpeciesFor,
  canBeAnticipated,
  stakeMetadataWith,
} = schema;

let failures = 0;
function assert(cond, message, detail) {
  if (cond) console.log(`PASS: ${message}`);
  else {
    failures++;
    console.log(`FAIL: ${message}${detail ? ` - ${detail}` : ""}`);
  }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// --- Registration -----------------------------------------------------------
assert(SPECIES_IDS.includes("stake") && SPECIES_IDS.indexOf("stake") === SPECIES_IDS.indexOf("decision") + 1, "stake is a species id, appended after decision");
assert(SPECIES_PREFIXES.stake === "STK-", "stake nodes get the STK- prefix");
assert(deriveNodeId("stake", "Slow reveal") === "STK-slow-reveal", "deriveNodeId builds an STK- id");
assert(EDGE_TYPE_IDS.indexOf("concerns") === EDGE_TYPE_IDS.indexOf("impacts") + 1, "concerns is an edge type, appended after impacts");

// --- The concerns edge ------------------------------------------------------
for (const target of ["flow", "view", "data-model", "api-endpoint"]) {
  assert(isValidEdgeSemantic("concerns", "stake", target), `concerns runs stake to ${target}`);
}
for (const target of ["acceptance", "decision", "stake"]) {
  assert(!isValidEdgeSemantic("concerns", "stake", target), `concerns does not run stake to ${target}`);
}
assert(!isValidEdgeSemantic("concerns", "view", "stake"), "concerns has no reverse direction");
assert(same(edgeTypesForSpeciesPair("stake", "view"), ["concerns"]), "stake to view offers concerns and only concerns");
assert(same(edgeTypesForSpeciesPair("decision", "view"), ["impacts"]), "impacts stays decision-only and disjoint");
assert(same(STAKE_ANCHOR_SPECIES, VALID_EDGE_SEMANTICS.concerns.map(([, t]) => t)), "STAKE_ANCHOR_SPECIES derives from the grammar");

// --- Vocabulary -------------------------------------------------------------
assert(same(STAKE_SPECIES_IDS, ["bug", "friction", "need", "requirement", "risk", "defect"]), "six stake species");
assert(same(STAKE_PROVENANCE_IDS, ["observed", "anticipated"]), "two provenances");
assert(same(STAKE_LIFECYCLE_STATUSES, ["idea", "discovery", "archived"]), "stored lifecycle is idea, discovery, archived");
assert(same(ANTICIPATED_STAKE_SPECIES, ["need", "requirement", "risk", "defect"]), "an anticipated stake is never a bug or a friction");
assert(same([...USER_FACING_STAKE_SPECIES, ...QUALITY_STAKE_SPECIES].sort(), [...STAKE_SPECIES_IDS].sort()), "user-facing and quality partition the six species");
assert(same(STAKE_CATALOG_SOURCES, ["kritik", "values"]), "catalog sources are kritik and values");
assert(isUserFacingStakeSpecies("bug") && !isUserFacingStakeSpecies("risk") && !isUserFacingStakeSpecies(undefined), "isUserFacingStakeSpecies");
assert(catalogSourceForStakeSpecies("need") === "values" && catalogSourceForStakeSpecies("defect") === "kritik", "catalog source follows the species family");

// --- Readers ----------------------------------------------------------------
assert(stakeSpeciesOf({ metadata: { stake_species: "risk" } }) === "risk", "stakeSpeciesOf reads the field");
assert(stakeSpeciesOf({ metadata: {} }) === undefined && stakeSpeciesOf({}) === undefined, "a missing stake_species reads as undefined");
assert(stakeSpeciesOf({ metadata: { stake_species: "nope" } }) === undefined, "an unknown stake_species reads as undefined");
assert(stakeProvenanceOf({}) === "observed", "absent provenance reads as observed");
assert(stakeProvenanceOf({ metadata: { provenance: "anticipated" } }) === "anticipated", "anticipated is read back");
assert(stakeProvenanceOf({ metadata: { provenance: "x" } }) === "observed", "an unknown provenance reads as observed");
assert(same(stakeCatalogOf({ metadata: { catalog: { source: "kritik", id: "SAF-01" } } }), { source: "kritik", id: "SAF-01" }), "stakeCatalogOf reads a link");
assert(stakeCatalogOf({ metadata: { catalog: { source: "nope", id: "x" } } }) === undefined, "an unknown catalog source reads as none");
assert(stakeCatalogOf({ metadata: { catalog: { source: "values", id: "" } } }) === undefined, "an empty catalog id reads as none");

// --- Write helpers ----------------------------------------------------------
assert(same(stakeSpeciesFor("anticipated"), ANTICIPATED_STAKE_SPECIES), "anticipated offers only anticipated species");
assert(same(stakeSpeciesFor("observed"), STAKE_SPECIES_IDS), "observed offers all six");
assert(!canBeAnticipated("bug") && !canBeAnticipated("friction") && canBeAnticipated("need") && canBeAnticipated(undefined), "canBeAnticipated");
{
  const before = { stake_species: "need", catalog: { source: "values", id: "saves-time" }, other: 1 };
  const frozen = JSON.stringify(before);
  const after = stakeMetadataWith(before, { stake_species: "risk" });
  assert(JSON.stringify(before) === frozen, "stakeMetadataWith never mutates its input");
  assert(after.stake_species === "risk" && after.other === 1, "stakeMetadataWith sets the species and carries the rest");
  assert(after.catalog === undefined, "moving to a quality species drops a values link");
  const kept = stakeMetadataWith(before, { stake_species: "friction" });
  assert(kept.catalog?.id === "saves-time", "moving within the user-facing family keeps the link");
  assert(stakeMetadataWith({ provenance: "anticipated" }, { provenance: "observed" }).provenance === undefined, "observed is stored as absence");
  assert(!("catalog" in stakeMetadataWith(before, { catalog: undefined })), "undefined clears a field");
  assert(stakeMetadataWith(undefined, { stake_species: "bug" }).stake_species === "bug", "undefined metadata is a fresh object");
}

// --- Parse boundary ---------------------------------------------------------
const bundleWith = (md, extra = {}) => ({
  schema_version: 3,
  project: { id: "p1", title: "P", created_at: "2026-11-22T00:00:00.000Z", updated_at: "2026-11-22T00:00:00.000Z" },
  nodes: [
    { id: "V-a", project_id: "p1", species: "view", title: "A", status: "live", platforms: ["web"] },
    { id: "STK-a", project_id: "p1", species: "stake", title: "A stake", status: "idea", platforms: [], metadata: md },
  ],
  edges: [{ id: "e-STK-a-V-a", project_id: "p1", source_id: "STK-a", target_id: "V-a", edge_type: "concerns" }],
  ...extra,
});
{
  const good = bundleWith({ stake_species: "need", provenance: "anticipated", catalog: { source: "values", id: "saves-time" } });
  const parsed = parseBundle(good);
  assert(parsed.success, "a stake bundle parses", JSON.stringify(parsed.error?.issues));
  const md = parsed.data.nodes[1].metadata;
  assert(md.stake_species === "need" && md.provenance === "anticipated" && md.catalog.id === "saves-time", "stake metadata survives parse");
  assert(!parseBundle(bundleWith({ stake_species: "idea" })).success, "an unknown stake_species is a parse error");
  assert(!parseBundle(bundleWith({ provenance: "guessed" })).success, "an unknown provenance is a parse error");
  assert(!parseBundle(bundleWith({ catalog: { source: "jira", id: "x" } })).success, "an unknown catalog source is a parse error");
  assert(!parseBundle(bundleWith({ catalog: { source: "kritik" } })).success, "a catalog link without an id is a parse error");
}

// --- Validator --------------------------------------------------------------
const rules = (bundle) => validateBundle(bundle).findings.map((f) => `${f.severity}:${f.rule}`);
{
  const clean = validateBundle(bundleWith({ stake_species: "bug" }));
  assert(clean.valid && clean.findings.length === 0, "an anchored, kinded stake with platforms [] validates clean", JSON.stringify(clean.findings));

  const noPlatformsKey = bundleWith({ stake_species: "bug" });
  delete noPlatformsKey.nodes[1].platforms;
  assert(validateBundle(noPlatformsKey).valid, "a stake is exempt from platforms-non-empty");

  const r = rules(bundleWith({}));
  assert(r.includes("warning:stake-species-missing") && validateBundle(bundleWith({})).valid, "a stake without stake_species is a warning, not an error");

  assert(rules(bundleWith({ stake_species: "need" }, { })).every((x) => !x.startsWith("error")), "no errors on a minimal stake");

  const live = bundleWith({ stake_species: "need" });
  live.nodes[1].status = "live";
  assert(rules(live).includes("warning:stake-lifecycle"), "a live stake warns (stake-lifecycle)");
  for (const status of ["idea", "discovery", "archived"]) {
    const ok = bundleWith({ stake_species: "need" });
    ok.nodes[1].status = status;
    assert(!rules(ok).includes("warning:stake-lifecycle"), `${status} is a stored stake status`);
  }

  assert(rules(bundleWith({ stake_species: "bug", provenance: "anticipated" })).includes("warning:stake-anticipated-species"), "an anticipated bug warns");
  assert(rules(bundleWith({ stake_species: "friction", provenance: "anticipated" })).includes("warning:stake-anticipated-species"), "an anticipated friction warns");
  assert(!rules(bundleWith({ stake_species: "risk", provenance: "anticipated" })).includes("warning:stake-anticipated-species"), "an anticipated risk is fine");

  assert(rules(bundleWith({ stake_species: "risk", catalog: { source: "values", id: "saves-time" } })).includes("warning:stake-catalog-mismatch"), "a risk linked to values warns");
  assert(rules(bundleWith({ stake_species: "bug", catalog: { source: "kritik", id: "SAF-01" } })).includes("warning:stake-catalog-mismatch"), "a bug linked to kritik warns");
  assert(!rules(bundleWith({ stake_species: "defect", catalog: { source: "kritik", id: "SAF-01" } })).includes("warning:stake-catalog-mismatch"), "a defect linked to kritik is fine");
  assert(!rules(bundleWith({ stake_species: "need", catalog: { source: "values", id: "saves-time" } })).includes("warning:stake-catalog-mismatch"), "a need linked to a value is fine");
  assert(rules(bundleWith({ stake_species: "need", catalog: { source: "values", id: "nope" } })).includes("warning:stake-catalog-unknown-value"), "an unknown value id warns");
  assert(!rules(bundleWith({ stake_species: "defect", catalog: { source: "kritik", id: "ANY-99" } })).includes("warning:stake-catalog-unknown-value"), "a Kritik id is not checked against the value pyramid");

  const orphan = bundleWith({ stake_species: "need" });
  orphan.edges = [];
  assert(rules(orphan).includes("warning:stake-unanchored") && validateBundle(orphan).valid, "a stake with no concerns edge warns, never errors");

  const wrong = bundleWith({ stake_species: "need" });
  wrong.nodes[0].metadata = { stake_species: "bug", provenance: "observed", catalog: { source: "values", id: "saves-time" } };
  const wrongRules = rules(wrong).filter((x) => x === "warning:stake-species-wrong-species");
  assert(wrongRules.length === 3, "stake fields on a view warn once each (stake-species-wrong-species)", String(wrongRules.length));

  const badEdge = bundleWith({ stake_species: "need" });
  badEdge.nodes.push({ id: "AC-a", project_id: "p1", species: "acceptance", title: "AC", status: "idea", platforms: ["web"], metadata: { gherkin: "g", values: ["saves-time"] } });
  badEdge.edges = [{ id: "e-STK-a-AC-a", project_id: "p1", source_id: "STK-a", target_id: "AC-a", edge_type: "concerns" }];
  assert(rules(badEdge).includes("error:edge-semantics"), "concerns to an acceptance is an edge-semantics error");

  const product = bundleWith({ stake_species: "need", product: "web" });
  const productFindings = validateBundle(product).findings.filter((f) => f.rule === "product-membership-wrong-species");
  assert(
    productFindings.length === 1 && !/derived from consumers/.test(productFindings[0].message),
    "a stored product on a stake warns without claiming membership is derived from consumers",
    productFindings[0]?.message,
  );
}

// --- Fixtures ---------------------------------------------------------------
{
  const load = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, "..", "fixtures", name), "utf8"));
  const valid = validateBundle(load("stake-valid.json"));
  assert(valid.valid && valid.findings.length === 0, "stake-valid.json validates with no findings", JSON.stringify(valid.findings));
  assert(parseBundle(load("stake-valid.json")).success, "stake-valid.json parses");
  const warned = new Set(validateBundle(load("stake-warnings.json")).findings.map((f) => f.rule));
  for (const rule of [
    "stake-species-missing",
    "stake-species-wrong-species",
    "stake-lifecycle",
    "stake-anticipated-species",
    "stake-catalog-mismatch",
    "stake-catalog-unknown-value",
    "stake-unanchored",
    "stake-reverify-invalid",
    "stake-criterion-version-invalid",
    "stake-criterion-version-unlinked",
    "product-membership-wrong-species",
  ]) {
    assert(warned.has(rule), `stake-warnings.json raises ${rule}`);
  }
  assert(validateBundle(load("stake-warnings.json")).valid, "stake-warnings.json is valid (warnings only)");
  assert(!validateBundle(load("stake-invalid-edge.json")).valid, "stake-invalid-edge.json is invalid");
}

if (failures > 0) {
  console.log(`\n${failures} stake test(s) failed.`);
  process.exit(1);
}
console.log("\nAll stake tests passed.");
