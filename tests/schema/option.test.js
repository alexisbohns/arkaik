#!/usr/bin/env node

/**
 * The option species (docs/rfcs/stake-architecture.md § 14, part A): registration,
 * the `addresses` edge, the widened decision edges, the two metadata fields, the
 * answer-type table, the readers, and the validator's warnings.
 */

const fs = require("fs");
const path = require("path");
const { loadSchema } = require("./load-schema");

const schema = loadSchema();
const {
  SPECIES_IDS,
  SPECIES_PREFIXES,
  EDGE_TYPE_IDS,
  edgeTypesForSpeciesPair,
  isValidEdgeSemantic,
  deriveNodeId,
  parseBundle,
  validateBundle,
  STAKE_SPECIES_IDS,
  STAKE_LIFECYCLE_STATUSES,
  OPTION_LIFECYCLE_STATUSES,
  ANSWER_TYPE_IDS,
  ANSWER_TYPE_FOR_STAKE_SPECIES,
  answerTypeForStake,
  optionSuggestedByOf,
  closedOptionsOf,
  stakesAddressedBy,
  optionsAddressing,
  answerTypesOf,
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
assert(SPECIES_IDS.includes("option") && SPECIES_IDS[SPECIES_IDS.length - 1] === "option", "option is a species id, appended last");
assert(SPECIES_PREFIXES.option === "OPT-", "option nodes get the OPT- prefix");
assert(deriveNodeId("option", "Skip the reveal") === "OPT-skip-the-reveal", "deriveNodeId builds an OPT- id");
assert(EDGE_TYPE_IDS[EDGE_TYPE_IDS.length - 1] === "addresses", "addresses is an edge type, appended last");

// --- The addresses edge -----------------------------------------------------
for (const [s, t] of [
  ["option", "stake"],
  ["acceptance", "stake"],
  ["acceptance", "option"],
]) {
  assert(isValidEdgeSemantic("addresses", s, t), `addresses runs ${s} to ${t}`);
}
for (const [s, t] of [
  ["stake", "option"],
  ["option", "option"],
  ["option", "view"],
  ["decision", "option"],
  ["decision", "stake"],
  ["view", "stake"],
]) {
  assert(!isValidEdgeSemantic("addresses", s, t), `addresses does not run ${s} to ${t}`);
}
assert(same(edgeTypesForSpeciesPair("option", "stake"), ["addresses"]), "option to stake offers addresses and only addresses");
assert(same(edgeTypesForSpeciesPair("acceptance", "stake"), ["addresses"]), "acceptance to stake offers addresses");
assert(same(edgeTypesForSpeciesPair("acceptance", "option"), ["addresses"]), "acceptance to option offers addresses");

// --- The widened decision edges ---------------------------------------------
assert(isValidEdgeSemantic("generates", "decision", "option"), "generates now reaches an option");
assert(isValidEdgeSemantic("generates", "decision", "acceptance"), "generates still reaches an acceptance");
assert(!isValidEdgeSemantic("generates", "decision", "stake"), "generates does not reach a stake");
assert(isValidEdgeSemantic("impacts", "decision", "stake"), "impacts now reaches a stake");
assert(!isValidEdgeSemantic("impacts", "decision", "option"), "impacts does not reach an option");
assert(!isValidEdgeSemantic("impacts", "decision", "acceptance"), "impacts still does not reach an acceptance");
assert(same(edgeTypesForSpeciesPair("decision", "option"), ["generates"]), "decision to option offers generates only");
assert(same(edgeTypesForSpeciesPair("decision", "stake"), ["impacts"]), "decision to stake offers impacts only");
for (const target of SPECIES_IDS) {
  const both = isValidEdgeSemantic("generates", "decision", target) && isValidEdgeSemantic("impacts", "decision", target);
  assert(!both, `generates and impacts stay disjoint by pair for decision to ${target}`);
}

// --- Vocabulary -------------------------------------------------------------
assert(same(OPTION_LIFECYCLE_STATUSES, STAKE_LIFECYCLE_STATUSES), "an option stores the same three statuses as a stake");
assert(same(OPTION_LIFECYCLE_STATUSES, ["idea", "discovery", "archived"]), "stored lifecycle is idea, discovery, archived");
assert(same(ANSWER_TYPE_IDS, ["fix", "enhancement", "feature", "diligence", "mitigation", "resolution"]), "six answer types");
assert(Object.keys(ANSWER_TYPE_FOR_STAKE_SPECIES).length === STAKE_SPECIES_IDS.length, "every stake species has an answer type");
assert(
  same(
    STAKE_SPECIES_IDS.map((s) => ANSWER_TYPE_FOR_STAKE_SPECIES[s]),
    ["fix", "enhancement", "feature", "diligence", "mitigation", "resolution"],
  ),
  "bug fix, friction enhancement, need feature, requirement diligence, risk mitigation, defect resolution",
);
assert(new Set(Object.values(ANSWER_TYPE_FOR_STAKE_SPECIES)).size === ANSWER_TYPE_IDS.length, "the six species map onto the six answer types one to one");

// --- Readers ----------------------------------------------------------------
assert(answerTypeForStake({ metadata: { stake_species: "risk" } }) === "mitigation", "answerTypeForStake reads the stake kind");
assert(answerTypeForStake({ metadata: {} }) === undefined && answerTypeForStake({}) === undefined, "a stake with no kind has no answer type");
assert(optionSuggestedByOf({ metadata: { suggested_by: "evt-1" } }) === "evt-1", "optionSuggestedByOf reads the field");
assert(optionSuggestedByOf({ metadata: { suggested_by: "" } }) === undefined, "an empty suggested_by reads as none");
assert(optionSuggestedByOf({ metadata: { suggested_by: 4 } }) === undefined && optionSuggestedByOf({}) === undefined, "a non-string or missing suggested_by reads as none");

assert(
  same(
    closedOptionsOf({ metadata: { closed_options: [{ option_id: "OPT-a", reason: "too slow" }, { option_id: "OPT-b" }, "x", null, { reason: "r" }, { option_id: "", reason: "r" }] } }),
    [{ option_id: "OPT-a", reason: "too slow" }],
  ),
  "closedOptionsOf keeps well-formed entries only",
);
assert(same(closedOptionsOf({}), []) && same(closedOptionsOf({ metadata: { closed_options: "nope" } }), []), "closedOptionsOf on nothing is empty");
assert(
  same(closedOptionsOf({ metadata: { closed_options: [{ option_id: "OPT-a", reason: "" }] } }), [{ option_id: "OPT-a", reason: "" }]),
  "closedOptionsOf keeps an entry whose reason is empty (a reason is required, but an empty one still names a loser)",
);

const nodes = [
  { id: "STK-a", species: "stake", metadata: { stake_species: "friction" } },
  { id: "STK-b", species: "stake", metadata: { stake_species: "bug" } },
  { id: "STK-c", species: "stake", metadata: {} },
  { id: "OPT-1", species: "option" },
  { id: "OPT-2", species: "option" },
  { id: "OPT-3", species: "option" },
  { id: "AC-1", species: "acceptance" },
  { id: "V-x", species: "view" },
];
const edges = [
  { source_id: "OPT-1", target_id: "STK-a", edge_type: "addresses" },
  { source_id: "OPT-1", target_id: "STK-b", edge_type: "addresses" },
  { source_id: "OPT-2", target_id: "STK-a", edge_type: "addresses" },
  { source_id: "OPT-3", target_id: "STK-c", edge_type: "addresses" },
  { source_id: "AC-1", target_id: "STK-a", edge_type: "addresses" },
  { source_id: "AC-1", target_id: "OPT-1", edge_type: "addresses" },
  { source_id: "OPT-1", target_id: "V-x", edge_type: "calls" },
  { source_id: "STK-a", target_id: "V-x", edge_type: "concerns" },
];
assert(same(stakesAddressedBy("OPT-1", nodes, edges).map((n) => n.id), ["STK-a", "STK-b"]), "stakesAddressedBy lists the stakes an option addresses, in edge order");
assert(same(stakesAddressedBy("OPT-2", nodes, edges).map((n) => n.id), ["STK-a"]), "stakesAddressedBy for a one-stake option");
assert(same(stakesAddressedBy("OPT-9", nodes, edges), []), "stakesAddressedBy for an unknown option is empty");
assert(same(stakesAddressedBy("AC-1", nodes, edges).map((n) => n.id), ["STK-a"]), "stakesAddressedBy skips an acceptance's edge to an option");
assert(same(optionsAddressing("STK-a", nodes, edges).map((n) => n.id), ["OPT-1", "OPT-2"]), "optionsAddressing lists options only, not the acceptance");
assert(same(optionsAddressing("STK-b", nodes, edges).map((n) => n.id), ["OPT-1"]), "optionsAddressing for a one-option stake");
assert(same(optionsAddressing("STK-zzz", nodes, edges), []), "optionsAddressing for an unknown stake is empty");
assert(same(answerTypesOf("OPT-1", nodes, edges), ["fix", "enhancement"]), "answerTypesOf lists the distinct types, in canonical order");
assert(same(answerTypesOf("OPT-2", nodes, edges), ["enhancement"]), "answerTypesOf for a one-type option");
assert(same(answerTypesOf("OPT-3", nodes, edges), []), "answerTypesOf skips a stake with no kind");
{
  const dup = [...edges, { source_id: "OPT-2", target_id: "STK-a", edge_type: "addresses" }];
  assert(same(stakesAddressedBy("OPT-2", nodes, dup).map((n) => n.id), ["STK-a"]), "a repeated edge lists the stake once");
}

// --- Parse boundary ---------------------------------------------------------
const bundleWith = (optMd, decMd = {}, extra = {}) => ({
  schema_version: 3,
  project: { id: "p1", title: "P", created_at: "2026-11-22T00:00:00.000Z", updated_at: "2026-11-22T00:00:00.000Z" },
  nodes: [
    { id: "V-a", project_id: "p1", species: "view", title: "A", status: "live", platforms: ["web"] },
    { id: "STK-a", project_id: "p1", species: "stake", title: "A stake", status: "discovery", platforms: [], metadata: { stake_species: "friction" } },
    { id: "OPT-a", project_id: "p1", species: "option", title: "An option", status: "idea", platforms: [], metadata: optMd },
    { id: "DEC-a", project_id: "p1", species: "decision", title: "A decision", status: "discovery", platforms: [], metadata: decMd },
  ],
  edges: [
    { id: "e-STK-a-V-a", project_id: "p1", source_id: "STK-a", target_id: "V-a", edge_type: "concerns" },
    { id: "e-OPT-a-STK-a", project_id: "p1", source_id: "OPT-a", target_id: "STK-a", edge_type: "addresses" },
  ],
  ...extra,
});
{
  const good = bundleWith({ suggested_by: "evt-1" }, { closed_options: [{ option_id: "OPT-a", reason: "too slow" }] });
  const parsed = parseBundle(good);
  assert(parsed.success, "an option bundle parses", JSON.stringify(parsed.error?.issues));
  assert(parsed.data.nodes[2].metadata.suggested_by === "evt-1", "suggested_by survives parse");
  assert(parsed.data.nodes[3].metadata.closed_options[0].reason === "too slow", "closed_options survives parse");
  assert(!parseBundle(bundleWith({ suggested_by: 7 })).success, "a non-string suggested_by is a parse error");
  assert(!parseBundle(bundleWith({}, { closed_options: [{ option_id: "OPT-a" }] })).success, "a closed option without a reason is a parse error");
  assert(!parseBundle(bundleWith({}, { closed_options: "OPT-a" })).success, "closed_options must be an array");
}

// --- Validator --------------------------------------------------------------
const rules = (bundle) => validateBundle(bundle).findings.map((f) => `${f.severity}:${f.rule}`);
{
  const clean = validateBundle(bundleWith({}));
  assert(clean.valid && clean.findings.length === 0, "an option addressing a stake, with platforms [], validates clean", JSON.stringify(clean.findings));

  const noPlatformsKey = bundleWith({});
  delete noPlatformsKey.nodes[2].platforms;
  assert(validateBundle(noPlatformsKey).valid, "an option is exempt from platforms-non-empty");

  const live = bundleWith({});
  live.nodes[2].status = "live";
  assert(rules(live).includes("warning:option-lifecycle"), "a live option warns (option-lifecycle)");
  for (const status of ["idea", "discovery", "archived"]) {
    const ok = bundleWith({});
    ok.nodes[2].status = status;
    assert(!rules(ok).includes("warning:option-lifecycle"), `an option at ${status} does not warn`);
  }

  const orphan = bundleWith({});
  orphan.edges = orphan.edges.filter((e) => e.edge_type !== "addresses");
  assert(rules(orphan).includes("warning:option-unaddressed") && validateBundle(orphan).valid, "an option with no addresses edge warns, and stays valid");

  const toOption = bundleWith({});
  toOption.nodes.push({ id: "OPT-b", project_id: "p1", species: "option", title: "B", status: "idea", platforms: [] });
  toOption.edges = [
    ...toOption.edges.filter((e) => e.edge_type !== "addresses"),
    { id: "e-OPT-b-OPT-a", project_id: "p1", source_id: "OPT-b", target_id: "OPT-a", edge_type: "addresses" },
  ];
  assert(!validateBundle(toOption).valid, "option to option is an edge-semantics error");

  const mixed = bundleWith({});
  mixed.nodes.push({ id: "STK-b", project_id: "p1", species: "stake", title: "B", status: "idea", platforms: [], metadata: { stake_species: "bug" } });
  mixed.edges.push({ id: "e-STK-b-V-a", project_id: "p1", source_id: "STK-b", target_id: "V-a", edge_type: "concerns" });
  mixed.edges.push({ id: "e-OPT-a-STK-b", project_id: "p1", source_id: "OPT-a", target_id: "STK-b", edge_type: "addresses" });
  assert(rules(mixed).includes("warning:option-mixed-answer-types"), "an option addressing a friction and a bug warns (option-mixed-answer-types)");

  const sameType = bundleWith({});
  sameType.nodes.push({ id: "STK-b", project_id: "p1", species: "stake", title: "B", status: "idea", platforms: [], metadata: { stake_species: "friction" } });
  sameType.edges.push({ id: "e-STK-b-V-a", project_id: "p1", source_id: "STK-b", target_id: "V-a", edge_type: "concerns" });
  sameType.edges.push({ id: "e-OPT-a-STK-b", project_id: "p1", source_id: "OPT-a", target_id: "STK-b", edge_type: "addresses" });
  assert(!rules(sameType).includes("warning:option-mixed-answer-types"), "two stakes of one answer type do not warn");

  const wrong = bundleWith({}, {});
  wrong.nodes[0].metadata = { suggested_by: "evt-1", closed_options: [] };
  const wrongRules = rules(wrong);
  assert(wrongRules.filter((r) => r === "warning:option-field-wrong-species").length === 2, "suggested_by and closed_options on a view warn twice (option-field-wrong-species)");
  const swapped = bundleWith({ closed_options: [] }, { suggested_by: "evt-1" });
  assert(rules(swapped).filter((r) => r === "warning:option-field-wrong-species").length === 2, "closed_options on an option and suggested_by on a decision warn");

  // Decision rules.
  const decided = () => {
    const b = bundleWith({}, { decision_status: "approved", closed_options: [] });
    b.nodes[3].status = "backlog";
    b.edges.push({ id: "e-DEC-a-STK-a", project_id: "p1", source_id: "DEC-a", target_id: "STK-a", edge_type: "impacts" });
    b.edges.push({ id: "e-DEC-a-OPT-a", project_id: "p1", source_id: "DEC-a", target_id: "OPT-a", edge_type: "generates" });
    return b;
  };
  const ok = validateBundle(decided());
  assert(ok.valid && ok.findings.length === 0, "an approved decision that impacts a stake and generates the option addressing it validates clean", JSON.stringify(ok.findings));

  const twoStakes = decided();
  twoStakes.nodes.push({ id: "STK-b", project_id: "p1", species: "stake", title: "B", status: "idea", platforms: [], metadata: { stake_species: "friction" } });
  twoStakes.edges.push({ id: "e-STK-b-V-a", project_id: "p1", source_id: "STK-b", target_id: "V-a", edge_type: "concerns" });
  twoStakes.edges.push({ id: "e-DEC-a-STK-b", project_id: "p1", source_id: "DEC-a", target_id: "STK-b", edge_type: "impacts" });
  assert(rules(twoStakes).includes("warning:decision-multiple-stakes"), "a decision impacting two stakes warns (decision-multiple-stakes)");

  const twoOptions = decided();
  twoOptions.nodes.push({ id: "OPT-b", project_id: "p1", species: "option", title: "B", status: "idea", platforms: [] });
  twoOptions.edges.push({ id: "e-OPT-b-STK-a", project_id: "p1", source_id: "OPT-b", target_id: "STK-a", edge_type: "addresses" });
  twoOptions.edges.push({ id: "e-DEC-a-OPT-b", project_id: "p1", source_id: "DEC-a", target_id: "OPT-b", edge_type: "generates" });
  assert(rules(twoOptions).includes("warning:decision-multiple-options"), "a decision generating two options warns (decision-multiple-options)");

  const notAddressing = decided();
  notAddressing.edges = notAddressing.edges.filter((e) => e.edge_type !== "addresses");
  assert(rules(notAddressing).includes("warning:decision-option-not-addressing"), "a generated option that does not address the impacted stake warns (decision-option-not-addressing)");

  const noStakeYet = decided();
  noStakeYet.edges = noStakeYet.edges.filter((e) => e.edge_type !== "impacts");
  assert(!rules(noStakeYet).includes("warning:decision-option-not-addressing"), "a decision that impacts no stake has nothing to compare, so no not-addressing warning");

  const twoDecisions = decided();
  twoDecisions.nodes.push({ id: "DEC-b", project_id: "p1", species: "decision", title: "B", status: "live", platforms: [], metadata: { decision_status: "enacted" } });
  twoDecisions.edges.push({ id: "e-DEC-b-STK-a", project_id: "p1", source_id: "DEC-b", target_id: "STK-a", edge_type: "impacts" });
  assert(rules(twoDecisions).includes("warning:stake-multiple-decisions"), "a stake impacted by an approved and an enacted decision warns (stake-multiple-decisions)");
  const supersededOne = decided();
  supersededOne.nodes.push({ id: "DEC-b", project_id: "p1", species: "decision", title: "B", status: "archived", platforms: [], metadata: { decision_status: "superseded" } });
  supersededOne.edges.push({ id: "e-DEC-b-STK-a", project_id: "p1", source_id: "DEC-b", target_id: "STK-a", edge_type: "impacts" });
  assert(!rules(supersededOne).includes("warning:stake-multiple-decisions"), "a superseded decision beside an approved one does not warn");
  const proposedOne = decided();
  proposedOne.nodes.push({ id: "DEC-b", project_id: "p1", species: "decision", title: "B", status: "discovery", platforms: [], metadata: { decision_status: "proposed" } });
  proposedOne.edges.push({ id: "e-DEC-b-STK-a", project_id: "p1", source_id: "DEC-b", target_id: "STK-a", edge_type: "impacts" });
  assert(!rules(proposedOne).includes("warning:stake-multiple-decisions"), "a proposed decision beside an approved one does not warn");

  const unknownLoser = decided();
  unknownLoser.nodes[3].metadata.closed_options = [{ option_id: "OPT-ghost", reason: "gone" }, { option_id: "V-a", reason: "not an option" }];
  assert(rules(unknownLoser).filter((r) => r === "warning:decision-closed-option-unknown").length === 2, "a closed option naming no option warns, once per entry");
  const knownLoser = decided();
  knownLoser.nodes.push({ id: "OPT-b", project_id: "p1", species: "option", title: "B", status: "archived", platforms: [] });
  knownLoser.edges.push({ id: "e-OPT-b-STK-a", project_id: "p1", source_id: "OPT-b", target_id: "STK-a", edge_type: "addresses" });
  knownLoser.nodes[3].metadata.closed_options = [{ option_id: "OPT-b", reason: "slower" }];
  const known = validateBundle(knownLoser);
  assert(known.valid && known.findings.length === 0, "a closed option naming a real option validates clean", JSON.stringify(known.findings));
}

// --- Journal: suggested_by dangling -----------------------------------------
{
  const journal = (id) => [
    { id, ts: "2026-11-22T10:00:00.000Z", type: "node.created", node_id: "V-a", species: "view", title: "A" },
  ];
  const noJournal = bundleWith({ suggested_by: "evt-missing" });
  assert(!rules(noJournal).includes("warning:option-suggested-by-dangling"), "no journal, no dangling check");
  const dangling = bundleWith({ suggested_by: "evt-missing" }, {}, { journal: journal("evt-1") });
  const result = validateBundle(dangling);
  assert(result.findings.some((f) => f.rule === "option-suggested-by-dangling" && f.severity === "warning"), "a suggested_by naming no journal event is a warning (option-suggested-by-dangling)");
  const found = bundleWith({ suggested_by: "evt-1" }, {}, { journal: journal("evt-1") });
  assert(!rules(found).includes("warning:option-suggested-by-dangling"), "a suggested_by naming a journal event does not warn");
}

// --- Fixtures ---------------------------------------------------------------
{
  const load = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, "..", "fixtures", name), "utf8"));
  const valid = validateBundle(load("option-valid.json"));
  assert(valid.valid && valid.findings.length === 0, "option-valid.json validates with no findings", JSON.stringify(valid.findings));
  assert(parseBundle(load("option-valid.json")).success, "option-valid.json parses");
  const warned = new Set(validateBundle(load("option-warnings.json")).findings.map((f) => f.rule));
  for (const rule of [
    "option-lifecycle",
    "option-unaddressed",
    "option-mixed-answer-types",
    "option-field-wrong-species",
    "decision-multiple-stakes",
    "decision-multiple-options",
    "decision-option-not-addressing",
    "stake-multiple-decisions",
    "decision-closed-option-unknown",
    "option-suggested-by-dangling",
    "product-membership-wrong-species",
  ]) {
    assert(warned.has(rule), `option-warnings.json raises ${rule}`);
  }
  assert(validateBundle(load("option-warnings.json")).valid, "option-warnings.json is valid (warnings only)");
  assert(!validateBundle(load("option-invalid-edge.json")).valid, "option-invalid-edge.json is invalid");
}

if (failures > 0) {
  console.log(`\n${failures} option test(s) failed.`);
  process.exit(1);
}
console.log("\nAll option tests passed.");
