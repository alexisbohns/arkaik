#!/usr/bin/env node

/**
 * Qualification (docs/rfcs/stake-architecture.md part 3): species routing as a
 * table, merge candidates, and the pure plans that record a signal as a stake.
 * The plans are run through the real applyOps and validateBundle, as the
 * acceptance-intake tests do, so what they emit is what a writer would persist.
 */

const { loadSchema } = require("./load-schema");

const {
  QUALIFY_DOORS,
  QUALIFY_SCOPES,
  QUALIFY_FACINGS,
  QUALIFY_EXPECTATIONS,
  QUALIFY_THREATS,
  QUALIFY_BASES,
  ROUTING_QUESTIONS,
  MERGE_HIGH,
  MERGE_MEDIUM,
  MERGE_LOW,
  routeSpecies,
  findMergeCandidates,
  stakeAnchors,
  planSignalToStake,
  planSignalMerge,
  applyOps,
  validateBundle,
  stakeEvidenceOf,
  stakeSpeciesOf,
} = loadSchema();

let failures = 0;
function assert(cond, message, detail) {
  if (cond) console.log(`PASS: ${message}`);
  else {
    failures++;
    console.log(`FAIL: ${message}${detail ? ` - ${detail}` : ""}`);
  }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// --- The routing table ---------------------------------------------------------
{
  const cases = [
    [{ facing: "value", expectation: "broken" }, "bug"],
    [{ facing: "value", expectation: "as-designed" }, "friction"],
    [{ facing: "value", expectation: "absent" }, "need"],
    [{ facing: "quality", threat: "obligation" }, "requirement"],
    [{ facing: "quality", threat: "own-flaw" }, "defect"],
    [{ facing: "quality", threat: "mitigable-only" }, "risk"],
  ];
  for (const [facts, species] of cases) {
    const routing = routeSpecies({ scope: "product", door: "collect", ...facts });
    assert(routing.route === "stake" && routing.species === species, `collect door routes ${JSON.stringify(facts)} to ${species}`, JSON.stringify(routing));
    assert(routing.provenance === "observed" && routing.handToHuman.length === 0, `a stated ${species} through collect is observed and needs no hand-off`);
  }
  assert(same(QUALIFY_DOORS, ["collect", "imagine"]) && same(QUALIFY_SCOPES, ["product", "internal", "off-scope"]), "doors and scopes");
  assert(same(QUALIFY_FACINGS, ["value", "quality"]) && same(QUALIFY_BASES, ["stated", "inferred"]), "facings and bases");
  assert(same(QUALIFY_EXPECTATIONS, ["broken", "as-designed", "absent"]) && same(QUALIFY_THREATS, ["obligation", "own-flaw", "mitigable-only"]), "expectations and threats");
}

// The imagine door
{
  for (const expectation of ["broken", "as-designed"]) {
    const r = routeSpecies({ scope: "product", door: "imagine", facing: "value", expectation });
    assert(r.route === "refused" && r.species === undefined && r.rerouteAs === "need", `imagine refuses ${expectation} (reroute as need)`, JSON.stringify(r));
    assert(r.handToHuman.length > 0 && /need/.test(r.reasons.join(" ")), "a refusal is handed to a person and names need");
  }
  const need = routeSpecies({ scope: "product", door: "imagine", facing: "value", expectation: "absent" });
  assert(need.route === "stake" && need.species === "need" && need.provenance === "anticipated", "imagine accepts a need, anticipated");
  assert(need.handToHuman.length === 1 && /imagine/.test(need.handToHuman[0]), "an anticipated stake is handed to a person even with the default (stated) basis", JSON.stringify(need.handToHuman));
  const quality = routeSpecies({ scope: "product", door: "imagine", facing: "quality", threat: "obligation" });
  assert(quality.handToHuman.length === 1, "the quality-facing imagine route is handed over too");
  const both = routeSpecies({ scope: "product", door: "imagine", facing: "value", expectation: "absent", basis: "inferred" });
  assert(both.handToHuman.length === 2, "anticipated and inferred are two separate hand-offs");
  for (const [threat, species] of [["obligation", "requirement"], ["own-flaw", "defect"], ["mitigable-only", "risk"]]) {
    const r = routeSpecies({ scope: "product", door: "imagine", facing: "quality", threat });
    assert(r.route === "stake" && r.species === species && r.provenance === "anticipated", `imagine accepts a ${species}`);
  }
}

// Routed out, inferred, incomplete
{
  for (const scope of ["internal", "off-scope"]) {
    const r = routeSpecies({ scope, door: "collect", facing: "value", expectation: "broken" });
    assert(r.route === scope && r.species === undefined, `${scope} is routed out, whatever else was answered`);
    assert(r.handToHuman.length > 0, `a ${scope} item is always handed to a person`);
  }
  const inferred = routeSpecies({ scope: "product", door: "collect", facing: "value", expectation: "absent", basis: "inferred" });
  assert(inferred.route === "stake" && inferred.handToHuman.length === 1 && /inferred/.test(inferred.handToHuman[0]), "an inferred answer is handed to a person");
  const none = routeSpecies({});
  assert(none.route === "incomplete" && same(none.ask, ["scope"]), "nothing answered asks for scope first", JSON.stringify(none));
  assert(same(routeSpecies({ scope: "product" }).ask, ["door"]), "then the door");
  assert(same(routeSpecies({ scope: "product", door: "collect" }).ask, ["facing"]), "then the facing");
  assert(same(routeSpecies({ scope: "product", door: "collect", facing: "value" }).ask, ["expectation"]), "then the expectation");
  assert(same(routeSpecies({ scope: "product", door: "collect", facing: "quality" }).ask, ["threat"]), "or the threat");
  assert(routeSpecies({ scope: "nonsense", door: "collect" }).route === "incomplete", "an unknown answer reads as unanswered, never a guess");
  assert(routeSpecies({ scope: "product", door: "collect", facing: "value", expectation: "absent", threat: "own-flaw" }).species === "need", "a threat answer is ignored on a value-facing signal");
}

// The questions are the single source
{
  const ids = ROUTING_QUESTIONS.map((q) => q.id);
  assert(same(ids, ["scope", "door", "facing", "expectation", "threat", "basis"]), "six routing questions in asking order");
  assert(same(Object.keys(ROUTING_QUESTIONS[3].answers), [...QUALIFY_EXPECTATIONS]), "the expectation question lists exactly the accepted answers");
  assert(same(Object.keys(ROUTING_QUESTIONS[4].answers), [...QUALIFY_THREATS]), "the threat question lists exactly the accepted answers");
  assert(ROUTING_QUESTIONS[3].answers.broken === "bug" && ROUTING_QUESTIONS[4].answers["own-flaw"] === "defect", "the answers name their species");
}

// The skill text is hand-written; this keeps it in step with the table.
{
  const skill = require("fs").readFileSync(require("path").join(__dirname, "..", "..", "docs", "arkaik-skill", "skill.md"), "utf8");
  const missing = [];
  for (const q of ROUTING_QUESTIONS) {
    if (!skill.includes(`\`${q.id}\``)) missing.push(q.id);
    for (const answer of Object.keys(q.answers)) if (!skill.includes(answer)) missing.push(`${q.id}=${answer}`);
  }
  assert(missing.length === 0, "the skill's qualification section names every question and answer of the table", missing.join());
}

// --- Merge candidates -------------------------------------------------------------
const P = "p1";
const stake = (id, title, species, extra = {}) => ({
  id,
  project_id: P,
  species: "stake",
  title,
  status: extra.status ?? "idea",
  platforms: [],
  ...(extra.description !== undefined ? { description: extra.description } : {}),
  metadata: { stake_species: species, ...(extra.catalog ? { catalog: extra.catalog } : {}), ...(extra.evidence ? { evidence: extra.evidence } : {}) },
});
const view = (id, title) => ({ id, project_id: P, species: "view", title, status: "live", platforms: ["web"] });
const concerns = (from, to) => ({ id: `e-${from}-${to}`, project_id: P, source_id: from, target_id: to, edge_type: "concerns" });

{
  assert(MERGE_HIGH > MERGE_MEDIUM && MERGE_MEDIUM > MERGE_LOW && MERGE_LOW > 0, "merge thresholds are ordered");
  const nodes = [
    view("V-compose", "Compose a pebble"),
    view("V-profile", "Profile"),
    stake("STK-lost-draft", "A draft I started is kept when I leave the app", "need"),
    stake("STK-lost-draft-bug", "Lost draft when backgrounding the app", "bug"),
    stake("STK-slow-reveal", "Revealing a pebble feels slow", "friction"),
    stake("STK-slow-reveal-old", "Revealing pebbles feels slow", "friction", { status: "archived" }),
    stake("STK-consent", "Consent is asked before tracking", "requirement", { catalog: { source: "kritik", id: "PRV-01" } }),
    stake("STK-consent-profile", "Consent is asked before the profile tracks", "requirement", { catalog: { source: "kritik", id: "PRV-01" } }),
    { id: "V-decoy", project_id: P, species: "view", title: "A draft I started is kept when I leave the app", status: "live", platforms: ["web"] },
  ];
  const edges = [concerns("STK-lost-draft", "V-compose"), concerns("STK-consent", "V-compose"), concerns("STK-consent-profile", "V-profile")];

  assert(same(stakeAnchors("STK-lost-draft", edges), ["V-compose"]) && same(stakeAnchors("STK-slow-reveal", edges), []), "stakeAnchors reads outgoing concerns edges");

  const sig = { title: "I want my draft kept when I leave the app", species: "need", node_ids: ["V-compose"] };
  const found = findMergeCandidates(sig, nodes, { edges });
  assert(found.length >= 1 && found[0].stake_id === "STK-lost-draft", "the matching need ranks first", JSON.stringify(found));
  assert(found.every((c) => c.stake_species === "need"), "the species wall: a bug with the same words is never offered to a need", JSON.stringify(found.map((c) => c.stake_id)));
  assert(!found.some((c) => c.stake_id === "V-decoy"), "a node that is not a stake is never a candidate");
  assert(found[0].confidence !== "low" && found[0].reasons.length >= 2, "a shared anchor and shared words read as more than low", JSON.stringify(found[0]));

  const bug = findMergeCandidates({ title: "Lost draft when I background the app", species: "bug" }, nodes, { edges });
  assert(bug.length === 1 && bug[0].stake_id === "STK-lost-draft-bug", "the bug finds the bug");

  // A catalog id alone is not identity: with no shared anchor it is half weight and never reaches a merge.
  const unanchored = findMergeCandidates({ title: "Zebra giraffe", species: "requirement", catalog_id: "PRV-01" }, nodes, { edges });
  assert(unanchored.length === 2 && unanchored.every((c) => c.score < MERGE_MEDIUM && c.confidence === "low"), "an unanchored signal matching only a catalog id stays low", JSON.stringify(unanchored));
  assert(/no anchor/.test(unanchored[0].reasons.join(" ")), "and says the anchor could not confirm it");

  const unrelated = findMergeCandidates({ title: "Dark mode follows my phone", species: "need" }, nodes, { edges });
  assert(unrelated.length === 0, "an unrelated signal has no candidate", JSON.stringify(unrelated));

  // Archived is flagged, not hidden; the order is deterministic.
  const slow = findMergeCandidates({ title: "Revealing a pebble is slow", species: "friction" }, nodes, { edges });
  assert(slow.length === 2 && slow.some((c) => c.archived) && slow.some((c) => !c.archived), "an archived stake is returned, flagged", JSON.stringify(slow));
  const again = findMergeCandidates({ title: "Revealing a pebble is slow", species: "friction" }, [...nodes].reverse(), { edges });
  assert(same(slow.map((c) => c.stake_id), again.map((c) => c.stake_id)), "the order does not depend on input order");
  assert(slow.every((c, i) => i === 0 || slow[i - 1].score > c.score || (slow[i - 1].score === c.score && slow[i - 1].stake_id < c.stake_id)), "sorted by score then id");

  // Catalog id plus anchor: the same criterion at another anchor is weaker.
  const crit = findMergeCandidates({ title: "Tracking needs consent", species: "requirement", node_ids: ["V-compose"], catalog_id: "PRV-01" }, nodes, { edges });
  const here = crit.find((c) => c.stake_id === "STK-consent");
  const there = crit.find((c) => c.stake_id === "STK-consent-profile");
  assert(here !== undefined && there !== undefined && here.score > there.score, "the same criterion on the same anchor outranks the same criterion elsewhere", JSON.stringify(crit));
  assert(/different anchor/.test(there.reasons.join(" ")), "the weaker candidate says why");

  // Benchmarks are evidence, but flagged.
  const bench = findMergeCandidates({ ...sig, source_kind: "benchmark" }, nodes, { edges });
  assert(bench[0].countsAsEvidence === false && found[0].countsAsEvidence === true, "a benchmark candidate is flagged as not counting toward frequency");

  // Already cited.
  const cited = [...nodes.slice(0, 2), stake("STK-cited", "Anything at all", "need", { evidence: [{ event_id: "EV1" }] })];
  const hit = findMergeCandidates({ event_id: "EV1", title: "Unrelated words entirely", species: "need" }, cited);
  assert(hit.length === 1 && hit[0].alreadyCited && hit[0].score === 1, "a stake already citing the signal is a certain candidate");

  assert(findMergeCandidates(sig, nodes, { edges, limit: 1 }).length === 1, "limit caps the list");
}

// --- Plans, through the real applyOps and validator ---------------------------------
const baseNodes = [view("V-compose", "Compose a pebble"), { id: "AC-x", project_id: P, species: "acceptance", title: "x", status: "idea", platforms: ["web"] }];
const bundleOf = (nodes, edges) => ({
  schema_version: 3,
  project: { id: P, title: "P", created_at: "2026-11-22T00:00:00.000Z", updated_at: "2026-11-22T00:00:00.000Z" },
  nodes,
  edges,
});
const signal = { event_id: "01SIG", title: "Lost draft", verbatim: "I backgrounded the app and lost my pebble", date: "2026-11-22T10:00:00.000Z", voice: "person" };

{
  const plan = planSignalToStake({ projectId: P, signal, species: "need", provenance: "observed", anchors: ["V-compose"], title: "What I have filled in is kept", nodes: baseNodes, edges: [] });
  assert(plan.action === "create" && plan.stake_id === "STK-what-i-have-filled-in-is-kept", "create names the stake from its own wording", JSON.stringify(plan));
  assert(plan.ops.length === 2 && plan.ops[0].op === "create_node" && plan.ops[1].op === "create_edge", "one node, one edge per anchor");
  const node = plan.ops[0].node;
  assert(node.status === "idea" && same(node.platforms, []) && node.species === "stake", "a created stake lands at idea with no platforms");
  assert(node.metadata.stake_species === "need" && node.metadata.provenance === undefined, "observed is stored as absence");
  assert(same(node.metadata.evidence, [{ event_id: "01SIG", quote: signal.verbatim, voice: "person", date: signal.date }]), "the evidence entry carries event, quote, voice and date", JSON.stringify(node.metadata.evidence));
  assert(plan.ops[1].edge.edge_type === "concerns" && plan.ops[1].edge.source_id === plan.stake_id && plan.ops[1].edge.target_id === "V-compose", "the edge is a concerns edge from the stake to its anchor");
  assert(plan.handToHuman.length === 0, "wording and anchor given: nothing to hand over");

  const outcome = applyOps({ projectId: P, nodes: baseNodes, edges: [] }, plan.ops);
  const result = validateBundle(bundleOf(outcome.nodes, outcome.edges));
  assert(result.valid && !result.findings.some((f) => f.rule.startsWith("stake-")), "the planned bundle is valid with no stake warning", JSON.stringify(result.findings));

  // Re-running the plan against its own result is a no-op.
  const rerun = planSignalToStake({ projectId: P, signal, species: "need", provenance: "observed", anchors: ["V-compose"], nodes: outcome.nodes, edges: outcome.edges });
  assert(rerun.action === "noop" && rerun.ops.length === 0 && rerun.stake_id === plan.stake_id, "a signal a stake already cites is a noop");

  // Defaults and hand-offs.
  const bare = planSignalToStake({ projectId: P, signal: { title: "Hello there" }, species: "friction", provenance: "observed", nodes: baseNodes, edges: [] });
  assert(bare.action === "create" && bare.ops.length === 1 && bare.handToHuman.length === 2, "no anchor and no wording is handed to a person", JSON.stringify(bare.handToHuman));
  assert(bare.ops[0].node.metadata.evidence.length === 1 && bare.ops[0].node.metadata.evidence[0].event_id === undefined, "an inline signal still records an evidence entry, without an event id");
  assert(same(bare.ops[0].node.metadata.evidence, [{ quote: "Hello there" }]), "an inline signal with only a title never stores an empty evidence entry", JSON.stringify(bare.ops[0].node.metadata.evidence));

  // Re-qualifying a signal a stake cites under another species is a noop, handed to a person.
  const reSpecies = planSignalToStake({ projectId: P, signal, species: "friction", provenance: "observed", anchors: ["V-compose"], nodes: outcome.nodes, edges: outcome.edges });
  assert(reSpecies.action === "noop" && reSpecies.stake_id === plan.stake_id && reSpecies.handToHuman.length === 1, "a species mismatch on a noop is flagged", JSON.stringify(reSpecies));

  // Ids never collide.
  const second = planSignalToStake({ projectId: P, signal: { event_id: "01B", title: "x" }, species: "need", provenance: "observed", title: "What I have filled in is kept", nodes: outcome.nodes, edges: outcome.edges });
  assert(second.stake_id === "STK-what-i-have-filled-in-is-kept-2", "a second stake with the same words gets a suffixed id");

  // A catalog link of the right family is carried; anticipated is stored.
  const risk = planSignalToStake({ projectId: P, signal: { title: "Data leak", event_id: "01R" }, species: "risk", provenance: "anticipated", catalog: { source: "kritik", id: "SAF-01" }, nodes: baseNodes, edges: [] });
  assert(risk.ops[0].node.metadata.provenance === "anticipated" && same(risk.ops[0].node.metadata.catalog, { source: "kritik", id: "SAF-01" }), "anticipated and the catalog link are stored");
  assert(validateBundle(bundleOf(applyOps({ projectId: P, nodes: baseNodes, edges: [] }, risk.ops).nodes, [])).valid, "an unanchored stake is valid (it warns)");
}

// Refusals write nothing
{
  const refuse = (input) => planSignalToStake({ projectId: P, signal: { title: "t", event_id: "E" }, species: "need", provenance: "observed", nodes: baseNodes, edges: [], ...input });
  const cases = [
    ["an anticipated bug", { species: "bug", provenance: "anticipated" }],
    ["an anticipated friction", { species: "friction", provenance: "anticipated" }],
    ["a values link on a requirement", { species: "requirement", catalog: { source: "values", id: "saves-time" } }],
    ["a kritik link on a need", { species: "need", catalog: { source: "kritik", id: "SAF-01" } }],
    ["a missing anchor", { anchors: ["V-ghost"] }],
    ["an acceptance anchor", { anchors: ["AC-x"] }],
    ["an empty wording", { title: "   " }],
    ["a bogus value id", { species: "need", catalog: { source: "values", id: "bogus" } }],
    ["a kritik criterion id on a need", { species: "need", catalog: { source: "values", id: "PRV-01" } }],
  ];
  for (const [label, input] of cases) {
    const plan = refuse(input);
    assert(plan.action === "refused" && plan.ops.length === 0 && plan.reasons.length > 0, `refuses ${label}`, JSON.stringify(plan));
  }
}

// --- Merge plan ---------------------------------------------------------------------
{
  const target = { ...stake("STK-a", "A kept draft", "need", { evidence: [{ event_id: "OLD", quote: "before" }] }), metadata: { stake_species: "need", felt: "wanted", evidence: [{ event_id: "OLD", quote: "before" }] } };
  const nodes = [...baseNodes, target];
  const frozen = JSON.stringify(target);
  const plan = planSignalMerge({ signal, target, species: "need", nodes });
  assert(plan.action === "merge" && plan.ops.length === 1 && plan.ops[0].op === "update_node" && plan.ops[0].node_id === "STK-a", "a merge is one update_node");
  assert(JSON.stringify(target) === frozen, "the plan never mutates its input");
  const md = plan.ops[0].patch.metadata;
  assert(md.felt === "wanted" && md.stake_species === "need" && md.evidence.length === 2 && md.evidence[1].event_id === "01SIG", "the patch spreads the metadata and appends one entry", JSON.stringify(md));

  const outcome = applyOps({ projectId: P, nodes, edges: [] }, plan.ops);
  assert(validateBundle(bundleOf(outcome.nodes, [])).valid, "the merged bundle is valid");
  const merged = outcome.nodes.find((n) => n.id === "STK-a");
  assert(stakeEvidenceOf(merged).length === 2 && stakeSpeciesOf(merged) === "need", "the merged stake carries both entries");

  const rerun = planSignalMerge({ signal, target: merged, species: "need", nodes: outcome.nodes });
  assert(rerun.action === "noop" && rerun.ops.length === 0, "merging the same signal twice is a noop (de-duplicated by event id)");

  assert(planSignalMerge({ signal, target, species: "friction", nodes }).action === "refused", "a merge across species is refused");
  assert(planSignalMerge({ signal, target: baseNodes[0], nodes }).action === "refused", "a merge into a non-stake is refused");

  const archived = { ...target, status: "archived" };
  const reopen = planSignalMerge({ signal, target: archived, species: "need", nodes: [...baseNodes, archived] });
  assert(reopen.action === "merge" && reopen.handToHuman.length === 1, "merging into an archived stake is allowed and handed to a person");

  const other = stake("STK-b", "Other", "need", { evidence: [{ event_id: "01SIG" }] });
  const twice = planSignalMerge({ signal, target, species: "need", nodes: [...nodes, other] });
  assert(twice.action === "merge" && twice.handToHuman.length === 1, "a signal already cited elsewhere is flagged, not blocked");
}

if (failures > 0) {
  console.log(`\n${failures} qualify test(s) failed`);
  process.exit(1);
}
console.log("\nAll qualify tests passed.");
