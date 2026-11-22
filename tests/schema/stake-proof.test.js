#!/usr/bin/env node

/**
 * The proof reader (docs/rfcs/stake-architecture.md § 14, part D): the two
 * halves of a stake's proof, the platforms they are read on, and the state the
 * ladder derives, all from facts that already exist (nodes, edges, journal
 * events, the quality section) and an injected `now`.
 *
 * What this covers: one case per rung of the ladder for each species family
 * (user-facing, quality with acceptances, requirement against Kritik), the
 * per-platform cases of call 5, product scope narrowing the platforms, an
 * archived stake deriving no state, the requirement's Kritik pass, both kinds
 * of staleness, a fixture-level run over the Pebbles seed, and the promise that
 * the reader never throws on malformed input.
 *
 * Run: npm run test:stake-proof
 */

const fs = require("fs");
const path = require("path");
const { loadSchema } = require("./load-schema");

const { deriveStakeProof, deriveStakeProofs, proofEventsOf, PROOF_EVENT_TYPES, STAKE_STATES, DEFAULT_TARGET_LEVEL } = loadSchema();

let failures = 0;
function assert(cond, message, detail) {
  if (cond) console.log(`PASS: ${message}`);
  else {
    failures++;
    console.log(`FAIL: ${message}${detail ? ` - ${detail}` : ""}`);
  }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const P = "p1";
const NOW = "2026-06-01T00:00:00.000Z";
const DAY = 86_400_000;
const daysBefore = (n) => new Date(Date.parse(NOW) - n * DAY).toISOString();

const node = (id, species, extra = {}) => ({ id, project_id: P, species, title: id, status: "idea", platforms: [], ...extra });
const edge = (source_id, target_id, edge_type) => ({ id: `e-${source_id}-${target_id}`, project_id: P, source_id, target_id, edge_type });
const decision = (id, status, extra = {}) =>
  node(id, "decision", {
    status: { proposed: "discovery", approved: "backlog", enacted: "live", rejected: "archived", deprecated: "archived", superseded: "archived" }[status],
    metadata: { decision_status: status, ...extra },
  });
let eventCounter = 0;
const event = (type, fields = {}) => ({ id: `01E${String(++eventCounter).padStart(5, "0")}`, ts: NOW, type, ...fields });
const moved = (node_id, to, ts, extra = {}) => event("node.status_changed", { node_id, from: "development", to, ts, ...extra });

/**
 * A stake with one option that a decision selected, and one acceptance that
 * addresses the option. Everything the ladder reads can be varied from here.
 */
function userGraph({ kind = "friction", status = "discovery", acceptance = {}, decide = "approved", stakeMetadata = {}, withAcceptance = true } = {}) {
  const nodes = [
    node("V-a", "view", { status: "live", platforms: ["web", "ios"] }),
    node("STK-slow", "stake", { title: "Slow reveal", status, metadata: { stake_species: kind, ...stakeMetadata } }),
    node("OPT-a", "option", { title: "Skip the reveal", status: "discovery" }),
  ];
  const edges = [edge("STK-slow", "V-a", "concerns"), edge("OPT-a", "STK-slow", "addresses")];
  if (withAcceptance) {
    nodes.push(node("AC-a1", "acceptance", { status: "backlog", platforms: ["web", "ios"], ...acceptance }));
    edges.push(edge("AC-a1", "OPT-a", "addresses"), edge("AC-a1", "V-a", "covers"));
  }
  if (decide !== null) {
    nodes.push(decision("DEC-pick", decide, { decided_at: "2026-02-01" }));
    edges.push(edge("DEC-pick", "STK-slow", "impacts"), edge("DEC-pick", "OPT-a", "generates"));
  }
  return { nodes, edges };
}

const proof = (graph, extra = {}) => deriveStakeProof({ stakeId: "STK-slow", nodes: graph.nodes, edges: graph.edges, now: NOW, ...extra });
const stateOf = (graph, extra = {}) => proof(graph, extra)?.state;
const cellOf = (result, platform) => result.cells.find((cell) => cell.platform === platform);

// --- The vocabulary -----------------------------------------------------------

assert(same(STAKE_STATES, ["raised", "considered", "promised", "verified-not-delivered", "partly-addressed", "addressed"]), "the six derived states, in the RFC's order");
assert(
  same(PROOF_EVENT_TYPES, [
    "node.created",
    "node.status_changed",
    "decision.status_changed",
    "quality.finding.opened",
    "quality.finding.resolved",
    "quality.finding.accepted",
    "quality.assessment.scored",
  ]),
  "the proof reads a stable list of seven event types",
);
assert(DEFAULT_TARGET_LEVEL === 3, "the target level a score is read against is 3");
assert(deriveStakeProof({ stakeId: "AC-x", nodes: [node("AC-x", "acceptance")], edges: [], now: NOW }) === null, "a node that is not a stake derives no proof (null)");
assert(deriveStakeProof({ stakeId: "STK-missing", nodes: [], edges: [], now: NOW }) === null, "an id that names nothing derives no proof (null)");

// --- The ladder, user-facing kinds (friction: both halves required) ------------

{
  const bare = { nodes: [node("STK-slow", "stake", { status: "idea", metadata: { stake_species: "friction" } })], edges: [] };
  const result = proof(bare);
  assert(result.state === "raised", "rung 6: a bare stake is raised", result.state);
  assert(result.stake_id === "STK-slow" && result.stake_species === "friction" && result.answer_type === "enhancement", "the proof names the stake, its kind and the answer type it asks for");
  assert(result.delivery === "required", "a friction requires delivery");
  assert(same(result.definition_of_done, []) && result.answer === undefined, "a bare stake has no answer and no definition of done");
  assert(result.cells.length === 1 && result.cells[0].platform === null && !result.cells[0].verified && !result.cells[0].delivered && !result.cells[0].stale, "with no platform in sight there is one platform-less cell, holding nothing");
  assert(result.reasons.length > 0 && result.reasons.every((reason) => typeof reason === "string"), "the reasons say why, in words");
}
{
  const withOption = userGraph({ decide: null, withAcceptance: false });
  assert(stateOf(withOption) === "considered", "rung 5: an option that addresses the stake makes it considered");
  const archivedOption = userGraph({ decide: null, withAcceptance: false });
  archivedOption.nodes.find((n) => n.id === "OPT-a").status = "archived";
  assert(stateOf(archivedOption) === "considered", "an archived option still means the stake was considered");

  const candidate = userGraph({ decide: null, withAcceptance: false });
  candidate.nodes = candidate.nodes.filter((n) => n.id !== "OPT-a");
  candidate.edges = candidate.edges.filter((e) => e.source_id !== "OPT-a");
  candidate.nodes.push(node("AC-c", "acceptance", { status: "idea", platforms: ["web"] }));
  candidate.edges.push(edge("AC-c", "STK-slow", "addresses"));
  assert(stateOf(candidate) === "considered", "a candidate acceptance (idea) that addresses the stake makes it considered");
  candidate.nodes.find((n) => n.id === "AC-c").status = "development";
  assert(stateOf(candidate) === "raised", "an acceptance in development that nobody chose is neither a candidate nor a promise: raised");

  const bare = { nodes: [node("STK-slow", "stake", { metadata: { stake_species: "need" } })], edges: [] };
  const weighed = { assessments: [{ matrix: "m", subject: "STK-slow", criterion: "c", level: 2 }] };
  assert(stateOf(bare, { weighing: weighed }) === "considered", "a user-facing stake with a weighing assessment of its own is considered");
  assert(stateOf(bare, { weighing: { assessments: [{ matrix: "m", subject: "STK-other", criterion: "c", level: 2 }] } }) === "raised", "an assessment of another subject does not count");
  const mattered = { nodes: [node("STK-slow", "stake", { metadata: { stake_species: "need", felt: "wanted", matters: 3 } })], edges: [] };
  assert(stateOf(mattered) === "considered", "a user-facing stake with a matters score is considered");
  const bug = { nodes: [node("STK-slow", "stake", { metadata: { stake_species: "bug", felt: "expected", matters: 4 } })], edges: [] };
  assert(stateOf(bug, { weighing: weighed }) === "considered", "a bug scored on matters is considered too");
}
{
  const promised = proof(userGraph());
  assert(promised.state === "promised", "rung 4: a decision chose an option and the answer has a definition of done: promised", promised.state);
  assert(same(promised.answer, { decision_id: "DEC-pick", option_id: "OPT-a" }), "the answer names the decision and the option");
  assert(same(promised.definition_of_done, ["AC-a1"]), "the definition of done is the acceptances addressing the answer option");
  assert(same(promised.cells.map((cell) => cell.platform), ["web", "ios"]), "the platforms concerned are the acceptance's, in platform order");
  assert(promised.cells.every((cell) => !cell.verified && !cell.delivered), "nothing is verified or delivered at backlog");

  assert(stateOf(userGraph({ decide: "proposed" })) === "considered", "a proposed decision settles nothing: only considered");
  assert(stateOf(userGraph({ decide: "rejected" })) === "considered", "a rejected decision reopens the stake: considered");
  assert(stateOf(userGraph({ decide: null })) === "considered", "an option and an acceptance with no decision: considered, not promised");
  const noDod = userGraph({ withAcceptance: false });
  assert(stateOf(noDod) === "considered", "a decision whose answer has no acceptance is not promised yet: no definition of done");
  assert(proof(noDod).answer?.option_id === "OPT-a", "though the answer is still named");
  const archivedDod = userGraph({ acceptance: { status: "archived" } });
  assert(stateOf(archivedDod) === "considered", "an archived acceptance is no definition of done");
}
{
  const direct = userGraph({ decide: null, withAcceptance: false });
  direct.nodes = direct.nodes.filter((n) => n.id !== "OPT-a");
  direct.edges = direct.edges.filter((e) => e.source_id !== "OPT-a");
  direct.nodes.push(node("AC-quick", "acceptance", { status: "backlog", platforms: ["web"] }));
  direct.edges.push(edge("AC-quick", "STK-slow", "addresses"));
  assert(stateOf(direct) === "raised", "an acceptance that addresses the stake directly, chosen by nobody, is a candidate only when idea or discovery");
  direct.nodes.push(decision("DEC-quick", "approved"));
  direct.edges.push(edge("DEC-quick", "AC-quick", "generates"));
  const result = proof(direct);
  assert(result.state === "promised" && same(result.definition_of_done, ["AC-quick"]), "the quick win: an acceptance a decision generates and that addresses the stake is a promise, with no option", result.state);
  assert(result.answer === undefined, "and there is no answer, because no option was chosen");
  direct.nodes.find((n) => n.id === "AC-quick").status = "live";
  direct.edges = direct.edges.filter((e) => e.source_id !== "DEC-quick");
  assert(stateOf(direct) === "addressed", "an acceptance already live that addresses the stake is a promise by itself, and the stake is addressed");
}
{
  const merged = proof(userGraph({ acceptance: { status: "releasing" } }));
  assert(merged.state === "verified-not-delivered", "rung 2: merged everywhere, live nowhere: verified, not delivered", merged.state);
  assert(merged.cells.every((cell) => cell.verified && !cell.delivered), "every platform is verified and none delivered");
  assert(stateOf(userGraph({ acceptance: { status: "live", platforms: ["web", "ios"] } })) === "addressed", "rung 1: live on every platform: addressed");
  const live = proof(userGraph({ acceptance: { status: "live" } }));
  assert(live.cells.every((cell) => cell.verified && cell.delivered && !cell.stale), "addressed means verified and delivered on every cell");
  assert(stateOf(userGraph({ acceptance: { status: "development" } })) === "promised", "in development: still only promised");
  assert(stateOf(userGraph({ acceptance: { status: "archived" } })) !== "addressed", "an archived acceptance never proves anything");
}
{
  // Need and bug read exactly as friction does (both halves required).
  for (const kind of ["bug", "need"]) {
    assert(stateOf(userGraph({ kind, acceptance: { status: "releasing" } })) === "verified-not-delivered", `a ${kind} needs delivery too: merged only is verified, not delivered`);
    assert(stateOf(userGraph({ kind, acceptance: { status: "live" } })) === "addressed", `a ${kind} live everywhere is addressed`);
    assert(proof(userGraph({ kind })).delivery === "required", `a ${kind} requires delivery`);
  }
}

// --- Per-platform cases (call 5) ------------------------------------------------

{
  const some = proof(userGraph({ acceptance: { status: "backlog", metadata: { platformStatuses: { web: "releasing", ios: "backlog" } } } }));
  assert(some.state === "partly-addressed", "verified on web only: partly addressed", some.state);
  assert(cellOf(some, "web").verified && !cellOf(some, "web").delivered, "web is verified, not delivered");
  assert(!cellOf(some, "ios").verified, "ios is not verified");

  const live = proof(userGraph({ acceptance: { status: "backlog", metadata: { platformStatuses: { web: "live", ios: "development" } } } }));
  assert(live.state === "partly-addressed", "delivered on web only: partly addressed", live.state);
  assert(cellOf(live, "web").verified && cellOf(live, "web").delivered, "web is verified and delivered");

  const crossed = proof(userGraph({ acceptance: { status: "backlog", metadata: { platformStatuses: { web: "releasing", ios: "live" } } } }));
  assert(crossed.state === "partly-addressed", "verified on one platform, delivered on the other: neither rule above holds, so partly addressed", crossed.state);
  assert(cellOf(crossed, "web").verified && !cellOf(crossed, "web").delivered && cellOf(crossed, "ios").verified && cellOf(crossed, "ios").delivered, "each cell says which half it has");

  const mergedAll = proof(userGraph({ acceptance: { status: "backlog", metadata: { platformStatuses: { web: "releasing", ios: "releasing" } } } }));
  assert(mergedAll.state === "verified-not-delivered", "a per-platform entry at releasing everywhere reads like a base status of releasing");

  // Two acceptances: the platforms concerned are the union, and each platform needs every acceptance that applies there.
  const two = userGraph({ acceptance: { status: "live", platforms: ["web"] } });
  two.nodes.push(node("AC-a2", "acceptance", { status: "live", platforms: ["ios"] }));
  two.edges.push(edge("AC-a2", "OPT-a", "addresses"), edge("AC-a2", "V-a", "covers"));
  const union = proof(two);
  assert(same(union.definition_of_done, ["AC-a1", "AC-a2"]) && same(union.cells.map((c) => c.platform), ["web", "ios"]), "the platforms concerned are the union of the acceptances' platforms");
  assert(union.state === "addressed", "each acceptance live on its own platform: addressed");
  two.nodes.find((n) => n.id === "AC-a2").status = "development";
  const half = proof(two);
  assert(half.state === "partly-addressed" && cellOf(half, "web").delivered && !cellOf(half, "ios").verified, "one acceptance live on web, the other in development on ios: partly addressed");
  const shared = userGraph({ acceptance: { status: "live", platforms: ["web", "ios"] } });
  shared.nodes.push(node("AC-a2", "acceptance", { status: "releasing", platforms: ["web"] }));
  shared.edges.push(edge("AC-a2", "OPT-a", "addresses"));
  const mixed = proof(shared);
  assert(cellOf(mixed, "web").verified && !cellOf(mixed, "web").delivered && cellOf(mixed, "ios").delivered, "web needs both acceptances live and one is only releasing; ios has only the live one");
}

// --- Product scope narrows the platforms (call 8) --------------------------------

{
  const graph = userGraph({ acceptance: { status: "backlog", platforms: ["web", "ios"], metadata: { platformStatuses: { web: "live", ios: "development" } } } });
  const project = { metadata: { products: [{ id: "site", title: "Site", platforms: ["web"] }, { id: "app", title: "App", platforms: ["web", "ios"] }] } };
  const everywhere = proof(graph, { project, productId: null });
  assert(same(everywhere.cells.map((c) => c.platform), ["web", "ios"]) && everywhere.state === "partly-addressed", "under All products both platforms are concerned: partly addressed");
  const site = proof(graph, { project, productId: "site" });
  assert(same(site.cells.map((c) => c.platform), ["web"]) && site.state === "addressed", "scoped to a web-only product, ios is out of scope and the stake is addressed", `${site.cells.map((c) => c.platform)} ${site.state}`);
  const app = proof(graph, { project, productId: "app" });
  assert(same(app.cells.map((c) => c.platform), ["web", "ios"]), "scoped to a product that ships both, both platforms stay");
  const unknown = proof(graph, { project, productId: "ghost" });
  assert(same(unknown.cells.map((c) => c.platform), ["web", "ios"]), "an unknown product id degrades to no narrowing");

  // The acceptance's own product governs over the scope (the app's rule): a web-only admin acceptance does not grow an ios cell.
  const owned = userGraph({ acceptance: { status: "live", platforms: ["web", "ios"], metadata: { product: "site" } } });
  const ownedProof = proof(owned, { project, productId: null });
  assert(same(ownedProof.cells.map((c) => c.platform), ["web"]), "an acceptance that belongs to a product reads through that product's platforms");

  // Every platform of the acceptance outside the scope: one platform-less cell on the base status.
  const gone = userGraph({ acceptance: { status: "live", platforms: ["ios"] } });
  const goneProof = proof(gone, { project, productId: "site" });
  assert(goneProof.cells.length === 1 && goneProof.cells[0].platform === null, "a definition of done that resolves no platform in scope gets one platform-less cell");
  assert(goneProof.cells[0].verified && goneProof.cells[0].delivered, "read on the acceptance's base status");
}

// --- Archived: no state (call 11) --------------------------------------------------

{
  const result = proof(userGraph({ status: "archived", acceptance: { status: "live" } }));
  assert(result.state === null, "an archived stake derives no state, even when everything it asked for is live");
  assert(result.stake_id === "STK-slow" && result.answer?.option_id === "OPT-a", "but it stays readable: the answer is still named");
  assert(result.reasons.some((reason) => /archived/i.test(reason)), "and the reasons say it is archived");
}

// --- Defect, risk: the verified half only (§ 8) ------------------------------------

{
  const risk = proof(userGraph({ kind: "risk", acceptance: { status: "releasing" } }));
  assert(risk.delivery === "not-required" && risk.answer_type === "mitigation", "a risk does not require delivery and asks for a mitigation");
  assert(risk.state === "addressed", "a risk is addressed once verified, with nothing delivered", risk.state);
  assert(stateOf(userGraph({ kind: "risk", acceptance: { status: "development" } })) === "promised", "a mitigation still in development: promised");
  assert(stateOf(userGraph({ kind: "risk", acceptance: { status: "backlog", metadata: { platformStatuses: { web: "releasing", ios: "backlog" } } } })) === "partly-addressed", "a risk verified on one platform only: partly addressed");

  const defect = proof(userGraph({ kind: "defect", acceptance: { status: "releasing" } }));
  assert(defect.delivery === "optional" && defect.answer_type === "resolution", "a defect's delivery is optional, and it asks for a resolution");
  assert(defect.state === "addressed", "a defect verified but not delivered is addressed: delivery is reported, never required", defect.state);
  assert(proof(userGraph({ kind: "defect", acceptance: { status: "live" } })).cells.every((cell) => cell.delivered), "and the cells still report the delivery when there is one");
  assert(stateOf(userGraph({ kind: "defect", acceptance: { status: "development" } })) === "promised", "a defect not yet verified: promised");
}

// --- Requirement: the Kritik pass (call 7) ------------------------------------------

const T0 = "2026-01-10T00:00:00.000Z"; // the stake was raised
const after = "2026-02-15T00:00:00.000Z";
const before = "2026-01-01T00:00:00.000Z";

function requirementGraph({ decide = "approved", withLink = true, extra = {} } = {}) {
  const nodes = [
    node("V-checkout", "view", { status: "live", platforms: ["web"] }),
    node("V-elsewhere", "view", { status: "live", platforms: ["web"] }),
    node("STK-slow", "stake", {
      title: "Checkout is safe",
      status: "discovery",
      metadata: { stake_species: "requirement", ...(withLink ? { catalog: { source: "kritik", id: "SAF-01" } } : {}), ...extra },
    }),
    node("OPT-r", "option", { status: "discovery" }),
  ];
  const edges = [edge("STK-slow", "V-checkout", "concerns"), edge("OPT-r", "STK-slow", "addresses")];
  if (decide !== null) {
    nodes.push(decision("DEC-pick", decide, { decided_at: "2026-02-01" }));
    edges.push(edge("DEC-pick", "STK-slow", "impacts"), edge("DEC-pick", "OPT-r", "generates"));
  }
  return { nodes, edges };
}
const raisedEvents = [event("node.created", { node_id: "STK-slow", species: "stake", title: "Checkout is safe", ts: T0 })];
const assessment = (level, ts, surface = "web", criterion_id = "SAF-01") => ({ criterion_id, surface, level, evidence: "x", audit_id: "a", ts });
const finding = (id, status, node_ids, criterion_id = "SAF-01") => ({ id, criterion_id, surface: "web", title: id, detail: "", evidence: "", impact: 3, likelihood: 3, cost: "S", status, ...(node_ids ? { node_ids } : {}) });
const section = (assessments = [], findings = []) => ({ framework_version: "0.1.0", profile: { surfaces: [] }, assessments, findings });
const opened = (finding_id, node_ids, ts = after, criterion_id = "SAF-01") =>
  event("quality.finding.opened", { finding_id, criterion_id, surface: "web", severity: "high", priority: "P1", title: finding_id, ...(node_ids ? { node_ids } : {}), ts });
const resolved = (finding_id, ts, extra = {}) => event("quality.finding.resolved", { finding_id, ts, ...extra });
const scored = (level, ts, surface = "web", criterion_id = "SAF-01") => event("quality.assessment.scored", { audit_id: "a", criterion_id, surface, level, evidence: "x", ts });
const req = (graph, extra = {}) => proof(graph, { events: raisedEvents, ...extra });

{
  const raised = proof(requirementGraph({ decide: null, withLink: false }), { events: raisedEvents });
  assert(raised.state === "considered", "a requirement with an option is considered", raised.state);
  const bare = { nodes: [node("STK-slow", "stake", { metadata: { stake_species: "requirement" } })], edges: [] };
  assert(stateOf(bare) === "raised", "a requirement with no option and no link is raised");
  const linked = { nodes: [node("STK-slow", "stake", { metadata: { stake_species: "requirement", catalog: { source: "kritik", id: "SAF-01" } } })], edges: [] };
  assert(stateOf(linked) === "considered", "a requirement that names a Kritik criterion is considered: the link is the evaluation by reference");
  const valuesLink = { nodes: [node("STK-slow", "stake", { metadata: { stake_species: "requirement", catalog: { source: "values", id: "saves-time" } } })], edges: [] };
  assert(stateOf(valuesLink) === "raised", "a values link on a requirement is the wrong catalog and counts for nothing");
  const risk = { nodes: [node("STK-slow", "stake", { metadata: { stake_species: "risk", catalog: { source: "kritik", id: "SAF-02" } } })], edges: [] };
  assert(stateOf(risk) === "considered", "a risk or a defect with a Kritik link is considered too");
  const weighedRequirement = { nodes: [node("STK-slow", "stake", { metadata: { stake_species: "requirement", matters: 4 } })], edges: [] };
  assert(stateOf(weighedRequirement, { weighing: { assessments: [{ matrix: "m", subject: "STK-slow", criterion: "c", level: 1 }] } }) === "raised", "matters and weighing are for the user-facing kinds only");

  const promised = req(requirementGraph());
  assert(promised.state === "promised", "a decision chose an option and the criterion is the definition of done: promised", promised.state);
  assert(same(promised.definition_of_done, []), "a requirement's definition of done is its criterion, so no acceptance id is listed");
  assert(promised.delivery === "optional" && promised.answer_type === "diligence", "a requirement's delivery is optional, and it asks for diligence");
  assert(promised.cells.length === 1 && promised.cells[0].platform === null, "a requirement has one platform-less cell");
  assert(stateOf(requirementGraph({ withLink: false, decide: "approved" }), { events: raisedEvents }) === "considered", "a decision with no criterion to check against has no definition of done: considered");
}
{
  // The pass: no open finding at the anchor, and a fresh score at the target on every surface.
  const graph = requirementGraph();
  const passing = req(graph, { quality: section([assessment(3, after)]) });
  assert(passing.state === "addressed", "no finding and a score of 3 after the stake was raised: addressed", passing.state);
  assert(passing.cells[0].verified && !passing.cells[0].stale, "the cell is verified");
  assert(req(graph, { quality: section([assessment(4, after)]) }).state === "addressed", "a score above the target passes too");
  assert(req(graph, { quality: section([assessment(2, after)]) }).state === "promised", "a score of 2 is below the target: still promised");
  assert(req(graph, { quality: section([]) }).state === "promised", "a finding-free criterion with no score at all is not verified");
  assert(req(graph, {}).state === "promised", "no quality data at all: not verified");

  assert(req(graph, { quality: section([assessment(3, before)]) }).state === "promised", "a score dated before the stake was raised is ignored");
  assert(req(graph, { quality: section([assessment(3, T0)]) }).state === "promised", "a score at the very moment it was raised is not after it");
  assert(req(graph, { quality: section([assessment(4, before), assessment(2, after)]) }).state === "promised", "a stale high score does not rescue a fresh low one");
  assert(req(graph, { quality: section([assessment(3, after, "web", "SAF-02")]) }).state === "promised", "a score of another criterion counts for nothing");

  // The raised date: the node.created event, else the earliest evidence date, else unknown (every score counts).
  assert(proof(graph, { quality: section([assessment(3, before)]) }).state === "addressed", "with no way to date the stake, every score counts");
  const withEvidence = requirementGraph({ extra: { evidence: [{ quote: "q", date: "2026-03-01" }, { quote: "later", date: "2026-04-01" }] } });
  assert(proof(withEvidence, { quality: section([assessment(3, after)]) }).state === "promised", "else the earliest evidence date raised it: a score before 2026-03-01 is ignored");
  assert(proof(withEvidence, { quality: section([assessment(3, "2026-03-05T00:00:00.000Z")]) }).state === "addressed", "and one after it counts");
  assert(proof(withEvidence, { events: raisedEvents, quality: section([assessment(3, after)]) }).state === "addressed", "node.created wins over the evidence date");

  // Scores from the journal.
  assert(req(graph, { events: [...raisedEvents, scored(3, after)] }).state === "addressed", "a quality.assessment.scored event is a score");
  assert(req(graph, { events: [...raisedEvents, scored(3, before)] }).state === "promised", "an event dated before the stake was raised is ignored");
  assert(req(graph, { events: [...raisedEvents, scored(4, "2026-02-01T00:00:00.000Z")], quality: section([assessment(2, after)]) }).state === "promised", "the latest score wins across the section and the journal");
  assert(req(graph, { events: [...raisedEvents, scored(2, "2026-02-01T00:00:00.000Z")], quality: section([assessment(3, after)]) }).state === "addressed", "and the other way round");

  // Latest per surface: every surface scored after the raise must be at the target.
  const surfaces = req(graph, { quality: section([assessment(3, after, "web"), assessment(2, after, "ios")]) });
  assert(surfaces.state === "promised", "the latest score on a surface below the target blocks, whatever the other surfaces say");
  const recovered = req(graph, { events: [...raisedEvents, scored(2, "2026-02-01T00:00:00.000Z", "ios"), scored(3, "2026-03-01T00:00:00.000Z", "ios")], quality: section([assessment(3, after, "web")]) });
  assert(recovered.state === "addressed", "a surface re-scored up to the target no longer blocks");
  const slipped = req(graph, { events: [...raisedEvents, scored(3, "2026-02-01T00:00:00.000Z", "ios"), scored(2, "2026-03-01T00:00:00.000Z", "ios")], quality: section([assessment(3, after, "web")]) });
  assert(slipped.state === "promised", "and one re-scored down blocks again");
}
{
  // The findings: open at the anchor blocks, elsewhere does not, the section's status wins over the replay.
  const graph = requirementGraph();
  const scores = [assessment(3, after)];
  assert(req(graph, { quality: section(scores, [finding("F-1", "open", ["V-checkout"])]) }).state === "promised", "an open finding at the stake's anchor blocks the pass");
  assert(req(graph, { quality: section(scores, [finding("F-1", "open", ["V-elsewhere"])]) }).state === "addressed", "an open finding elsewhere does not");
  assert(req(graph, { quality: section(scores, [finding("F-1", "open")]) }).state === "addressed", "an open finding that names no node is not at the anchor");
  assert(req(graph, { quality: section(scores, [finding("F-1", "open", ["V-checkout"], "SAF-02")]) }).state === "addressed", "an open finding of another criterion at the anchor does not");
  for (const status of ["resolved", "refuted", "accepted-risk"]) {
    assert(req(graph, { quality: section(scores, [finding("F-1", status, ["V-checkout"])]) }).state === "addressed", `a ${status} finding at the anchor no longer blocks`);
  }
  assert(req(graph, { quality: section(scores, [finding("F-1", undefined, ["V-checkout"])]) }).state === "promised", "a finding with no status reads open");

  // The journal replay, for a finding the section does not hold.
  const openEvent = opened("F-9", ["V-checkout"]);
  assert(req(graph, { events: [...raisedEvents, openEvent], quality: section(scores) }).state === "promised", "an opened event at the anchor blocks when the section does not hold the finding");
  assert(req(graph, { events: [...raisedEvents, opened("F-9", ["V-elsewhere"])], quality: section(scores) }).state === "addressed", "an opened event elsewhere does not");
  assert(req(graph, { events: [...raisedEvents, openEvent, resolved("F-9", "2026-03-01T00:00:00.000Z")], quality: section(scores) }).state === "addressed", "a resolved event closes it: the event names no criterion, so it is joined to the opened one by finding id");
  assert(req(graph, { events: [...raisedEvents, openEvent, event("quality.finding.accepted", { finding_id: "F-9", reason: "ok", ts: "2026-03-01T00:00:00.000Z" })], quality: section(scores) }).state === "addressed", "an accepted event closes it too");
  assert(req(graph, { events: [...raisedEvents, openEvent, resolved("F-9", "2026-03-01T00:00:00.000Z"), opened("F-9", ["V-checkout"], "2026-04-01T00:00:00.000Z")], quality: section(scores) }).state === "promised", "a finding opened again after it was resolved blocks again");
  assert(req(graph, { events: [...raisedEvents, resolved("F-unknown", "2026-03-01T00:00:00.000Z")], quality: section(scores) }).state === "addressed", "a close for a finding nothing opened is harmless");
  // The section's status overrides the replay.
  assert(req(graph, { events: [...raisedEvents, openEvent], quality: section(scores, [finding("F-9", "resolved", ["V-checkout"])]) }).state === "addressed", "the section says resolved: it overrides an opened event with no close");
  assert(req(graph, { events: [...raisedEvents, openEvent, resolved("F-9", "2026-03-01T00:00:00.000Z")], quality: section(scores, [finding("F-9", "open", ["V-checkout"])]) }).state === "promised", "the section says open: it overrides a resolved event");

  // A stake with no anchor: nothing narrows the finding to a place, so every open finding of the criterion counts.
  const unanchored = requirementGraph();
  unanchored.edges = unanchored.edges.filter((e) => e.edge_type !== "concerns");
  assert(req(unanchored, { quality: section(scores, [finding("F-1", "open", ["V-elsewhere"])]) }).state === "promised", "an unanchored requirement is blocked by any open finding of its criterion");
}

// --- Staleness (calls 7 and 9) -------------------------------------------------------

{
  // An acceptance: the latest node.status_changed into releasing or live, per platform.
  const interval = { reverify_every_days: 30 };
  const base = (acceptance = {}) => userGraph({ stakeMetadata: interval, acceptance: { status: "live", platforms: ["web"], ...acceptance } });
  const fresh = proof(base(), { events: [moved("AC-a1", "live", daysBefore(10), { platform: "web" })] });
  assert(fresh.state === "addressed" && !fresh.cells[0].stale, "a check 10 days ago, 30 days allowed: not stale");
  assert(fresh.cells[0].checked_at === daysBefore(10), "the cell reports the date of the check it rests on", fresh.cells[0].checked_at);
  const old = proof(base(), { events: [moved("AC-a1", "live", daysBefore(100), { platform: "web" })] });
  assert(old.cells[0].stale && !old.cells[0].verified && old.cells[0].delivered, "a check 100 days ago: stale, so no longer verified, while the delivery is still in hand");
  assert(old.state === "promised", "a stale verification with delivery in hand falls back to promised", old.state);
  assert(proof(base(), { events: [] }).state === "promised", "no dated check at all is stale once an interval is set");
  assert(proof(base(), { events: [] }).cells[0].checked_at === undefined, "and there is no checked_at to report");
  assert(proof(userGraph({ acceptance: { status: "live", platforms: ["web"] } }), { events: [] }).state === "addressed", "without an interval nothing ever expires, with or without events");
  assert(proof(base(), { events: [moved("AC-a1", "live", daysBefore(100), { platform: "web" }), moved("AC-a1", "live", daysBefore(5), { platform: "web" })] }).state === "addressed", "a new check restarts the clock: the latest one counts");
  assert(proof(base(), { events: [moved("AC-a1", "releasing", daysBefore(100), { platform: "web" }), moved("AC-a1", "live", daysBefore(5), { platform: "web" })] }).state === "addressed", "a move into releasing and a move into live are both checks");
  assert(proof(base(), { events: [moved("AC-a1", "development", daysBefore(2), { platform: "web" }), moved("AC-a1", "live", daysBefore(100), { platform: "web" })] }).state === "promised", "a move out of releasing or live is not a check");
  assert(proof(base(), { events: [moved("AC-other", "live", daysBefore(1), { platform: "web" })] }).state === "promised", "another acceptance's move is not this one's check");
  assert(proof(base(), { events: [moved("AC-a1", "live", daysBefore(1), { platform: "ios" })] }).state === "promised", "a check on another platform is not this platform's");
  assert(proof(base(), { events: [moved("AC-a1", "live", daysBefore(5))] }).state === "addressed", "a platform-less event counts for a platform with no entry of its own");
  const ownEntry = base({ metadata: { platformStatuses: { web: "live" } } });
  assert(proof(ownEntry, { events: [moved("AC-a1", "live", daysBefore(5))] }).state === "promised", "but not for a platform that has its own entry");
  assert(proof(base(), { events: [moved("AC-a1", "live", daysBefore(100)), moved("AC-a1", "live", daysBefore(5), { platform: "web" })] }).state === "addressed", "a platform event and a platform-less one: the latest that applies counts");
  assert(proof(base(), { events: [{ ...moved("AC-a1", "prioritized", daysBefore(1), { platform: "web" }) }, moved("AC-a1", "live", daysBefore(3), { platform: "web" })] }).state === "addressed", "a legacy status id in an event is normalised, not trusted blindly");

  // Two acceptances on a platform: the cell takes the oldest of their latest checks.
  const two = base();
  two.nodes.push(node("AC-a2", "acceptance", { status: "live", platforms: ["web"] }));
  two.edges.push(edge("AC-a2", "OPT-a", "addresses"));
  const mixed = proof(two, { events: [moved("AC-a1", "live", daysBefore(5), { platform: "web" }), moved("AC-a2", "live", daysBefore(60), { platform: "web" })] });
  assert(mixed.cells[0].stale && mixed.cells[0].checked_at === daysBefore(60), "the cell takes the oldest check among the acceptances that apply");
  assert(proof(two, { events: [moved("AC-a1", "live", daysBefore(5), { platform: "web" })] }).cells[0].stale, "an acceptance with no dated check makes the cell stale");

  // Per platform: one platform stale, the other fresh.
  const duo = userGraph({ stakeMetadata: interval, acceptance: { status: "live", platforms: ["web", "ios"] } });
  const partly = proof(duo, { events: [moved("AC-a1", "live", daysBefore(5), { platform: "web" }), moved("AC-a1", "live", daysBefore(90), { platform: "ios" })] });
  assert(cellOf(partly, "ios").stale && !cellOf(partly, "web").stale, "staleness is read per platform");
  assert(partly.state === "partly-addressed", "web fresh and ios stale: partly addressed", partly.state);
  const allStale = proof(duo, { events: [moved("AC-a1", "live", daysBefore(90), { platform: "web" }), moved("AC-a1", "live", daysBefore(90), { platform: "ios" })] });
  assert(allStale.state === "promised", "stale everywhere: promised");

  // The interval, exactly: stale only once strictly older than the interval.
  assert(proof(base(), { events: [moved("AC-a1", "live", daysBefore(30), { platform: "web" })] }).state === "addressed", "a check exactly one interval old has not lapsed");
  assert(proof(base(), { events: [moved("AC-a1", "live", new Date(Date.parse(daysBefore(30)) - 1).toISOString(), { platform: "web" })] }).state === "promised", "a millisecond older has");
  // `now` is an argument: the same graph at two instants.
  const events = [moved("AC-a1", "live", "2026-05-01T00:00:00.000Z", { platform: "web" })];
  assert(proof(base(), { events, now: "2026-05-15T00:00:00.000Z" }).state === "addressed", "the same graph read at an earlier now is fresh");
  assert(proof(base(), { events, now: "2026-07-15T00:00:00.000Z" }).state === "promised", "and at a later now has lapsed");
  assert(proof(base(), { events, now: new Date("2026-07-15T00:00:00.000Z") }).state === "promised", "now may be a Date");
  assert(proof(base(), { events, now: Date.parse("2026-07-15T00:00:00.000Z") }).state === "promised", "or a number of milliseconds");
  assert(proof(base(), { events, now: "not a date" }).state === "addressed", "an unreadable now cannot expire anything");
  // Invalid intervals read as never expiring.
  for (const bad of [0, -5, "30", null, NaN]) {
    assert(proof(userGraph({ stakeMetadata: { reverify_every_days: bad }, acceptance: { status: "live", platforms: ["web"] } }), { events: [] }).state === "addressed", `an interval of ${JSON.stringify(bad)} is not a number of days: it never expires`);
  }
  // The proof only goes stale when there is a proof to go stale.
  const unproven = proof(userGraph({ stakeMetadata: interval, acceptance: { status: "development", platforms: ["web"] } }), { events: [] });
  assert(!unproven.cells[0].stale && unproven.state === "promised", "an acceptance that was never verified is not stale, only unproven");
}
{
  // A requirement: the latest score or finding closure on the criterion.
  const interval = { reverify_every_days: 30 };
  const graph = requirementGraph({ extra: interval });
  const fresh = req(graph, { quality: section([assessment(3, daysBefore(10))]) });
  assert(fresh.state === "addressed" && fresh.cells[0].checked_at === daysBefore(10), "a requirement scored 10 days ago, 30 allowed: addressed, with the date of the score");
  const old = req(graph, { quality: section([assessment(3, daysBefore(100))]), events: [event("node.created", { node_id: "STK-slow", species: "stake", title: "x", ts: daysBefore(200) })] });
  assert(old.state === "promised" && old.cells[0].stale, "a requirement scored 100 days ago has lapsed: promised");
  const closedLater = req(graph, {
    events: [event("node.created", { node_id: "STK-slow", species: "stake", title: "x", ts: daysBefore(200) }), opened("F-9", ["V-checkout"], daysBefore(150)), resolved("F-9", daysBefore(3))],
    quality: section([assessment(3, daysBefore(100))]),
  });
  assert(closedLater.state === "addressed" && closedLater.cells[0].checked_at === daysBefore(3), "a finding closed 3 days ago is a recent check even if the score is old");
  assert(req(graph, { quality: section([assessment(3, daysBefore(10), "web")]), events: [...raisedEvents, scored(3, daysBefore(70), "ios")] }).state === "addressed", "the latest check over all the surfaces counts");

  // The criterion version.
  const library = (version) => ({ version: "0.1.0", criteria: [{ id: "SAF-01", ...(version === undefined ? {} : { version }) }] });
  const versioned = requirementGraph({ extra: { verified_criterion_version: 1 } });
  const scores = section([assessment(3, after)]);
  assert(req(versioned, { quality: scores, library: library(1) }).state === "addressed", "verified against version 1, the library is at 1: not stale");
  const newer = req(versioned, { quality: scores, library: library(2) });
  assert(newer.state === "promised" && newer.cells[0].stale, "the library's criterion moved to version 2: stale, so promised", newer.state);
  assert(req(requirementGraph(), { quality: scores, library: library(2) }).state === "addressed", "no stored version: not stale on that axis");
  assert(req(versioned, { quality: scores }).state === "addressed", "no library: not stale on that axis");
  assert(req(versioned, { quality: scores, library: { criteria: [{ id: "SAF-99", version: 9 }] } }).state === "addressed", "a library that does not carry the criterion: not stale");
  assert(req(versioned, { quality: scores, library: library(undefined) }).state === "addressed", "a library criterion with no version reads 1: not newer than 1");
  assert(req(requirementGraph({ extra: { verified_criterion_version: 3 } }), { quality: scores, library: library(2) }).state === "addressed", "verified against a newer version than the library holds: not stale");
  assert(req(requirementGraph({ extra: { verified_criterion_version: 1.5 } }), { quality: scores, library: library(2) }).state === "addressed", "a stored version that is not an integer is ignored");
  // The version axis needs no interval.
  assert(req(versioned, { quality: scores, library: library(2) }).cells[0].stale, "the version axis works with no reverify interval set");
}

// --- Considered / promised across the ladder for a requirement's direct promise --------

{
  const graph = requirementGraph({ decide: null });
  graph.nodes.push(node("AC-rq", "acceptance", { status: "live", platforms: ["web"] }));
  graph.edges.push(edge("AC-rq", "STK-slow", "addresses"));
  const direct = req(graph, { quality: section([assessment(3, after)]) });
  assert(direct.state === "addressed", "a live acceptance addressing a requirement is a promise: with the Kritik pass, addressed", direct.state);
  const failing = req(graph, { quality: section([assessment(2, after)]) });
  assert(failing.state === "partly-addressed" && failing.cells[0].delivered && !failing.cells[0].verified, "failing the pass with the acceptance already live: delivery is read separately and the ladder files it under partly addressed", failing.state);
  const mergedOnly = requirementGraph({ decide: null });
  mergedOnly.nodes.push(node("AC-rq", "acceptance", { status: "releasing", platforms: ["web"] }), node("DEC-rq", "decision", { status: "backlog", metadata: { decision_status: "approved" } }));
  mergedOnly.edges.push(edge("AC-rq", "STK-slow", "addresses"), edge("DEC-rq", "AC-rq", "generates"));
  assert(req(mergedOnly, { quality: section([assessment(2, after)]) }).state === "promised", "but a promise that is only merged is not delivered: promised");
}
{
  // A requirement verified with no decision and no promise: nothing was ever promised, so it is not addressed.
  const graph = requirementGraph({ decide: null });
  const result = req(graph, { quality: section([assessment(3, after)]) });
  assert(result.state === "partly-addressed", "a requirement whose check passes but that nobody answered is partly addressed, not addressed", result.state);
}

// --- Events: the reader keeps its own types, and tolerates the rest -------------------

{
  const mixedEvents = [
    event("request.filed", { title: "x" }),
    event("deliverable.shipped", { title: "y", node_ids: ["AC-a1"] }),
    moved("AC-a1", "live", daysBefore(5), { platform: "web" }),
  ];
  const kept = proofEventsOf(mixedEvents);
  assert(kept.length === 1 && kept[0].type === "node.status_changed", "proofEventsOf keeps only the proof event types");
  assert(same(proofEventsOf([moved("AC-a1", "live", "2026-03-01T00:00:00.000Z"), moved("AC-a1", "live", "2026-01-01T00:00:00.000Z")]).map((e) => e.ts), ["2026-01-01T00:00:00.000Z", "2026-03-01T00:00:00.000Z"]), "and orders them by time");
  assert(same(proofEventsOf(undefined), []) && same(proofEventsOf("nope"), []), "no events, or something that is not a list, is an empty list");
  assert(same(proofEventsOf([null, 3, "x", {}, { type: 4 }, [], event("node.created", { node_id: "N" })]).map((e) => e.type), ["node.created"]), "stray values in the list are skipped");
  const noise = proof(userGraph({ stakeMetadata: { reverify_every_days: 30 }, acceptance: { status: "live", platforms: ["web"] } }), { events: [...mixedEvents, moved("AC-a1", "live", daysBefore(100))] });
  assert(noise.state === "addressed", "an event of another type changes nothing: the latest check is the platform one from 5 days ago");
  // deliverable.shipped is not proof: it never counts as a check.
  const shipped = proof(userGraph({ stakeMetadata: { reverify_every_days: 30 }, acceptance: { status: "live", platforms: ["web"] } }), {
    events: [event("deliverable.shipped", { title: "y", node_ids: ["AC-a1"], platform: "web", ts: daysBefore(1) })],
  });
  assert(shipped.state === "promised", "a shipped deliverable is the changelog's trace, never a check");
}

// --- Lenient and total ---------------------------------------------------------------

{
  const graph = userGraph({ stakeMetadata: { reverify_every_days: 30 }, acceptance: { status: "live", platforms: ["web"] } });
  const garbage = [
    null,
    undefined,
    42,
    "text",
    [],
    {},
    { type: "node.status_changed" },
    { type: "node.status_changed", node_id: 5, to: {}, ts: {} },
    { type: "node.status_changed", node_id: "AC-a1", to: "live", ts: "garbage", platform: "mars" },
    { type: "node.created", node_id: "STK-slow", ts: "garbage" },
    { type: "quality.finding.opened", finding_id: null, node_ids: "V-checkout" },
    { type: "quality.finding.resolved", finding_id: { a: 1 }, ts: 7 },
    { type: "quality.assessment.scored", criterion_id: "SAF-01", level: "high", surface: 9, ts: "garbage" },
    { type: "decision.status_changed", node_id: "DEC-pick", from: 1, to: 2 },
  ];
  let threw = null;
  try {
    const result = proof(graph, { events: garbage, quality: { assessments: "x", findings: 3 }, weighing: { assessments: [null, 1, "x"] }, library: { criteria: "nope" } });
    assert(STAKE_STATES.includes(result.state), "garbage events and sections still derive a state", String(result.state));
    for (const input of [
      { stakeId: "STK-slow", nodes: [null, undefined, 3, { id: "STK-slow", species: "stake" }], edges: [null, 5, {}], now: NOW },
      { stakeId: "STK-slow", nodes: [{ id: "STK-slow", species: "stake", metadata: "oops", platforms: "web", status: 4 }], edges: [], now: NOW },
      { stakeId: "STK-slow", nodes: undefined, edges: undefined, now: undefined },
      { stakeId: "STK-slow", nodes: graph.nodes, edges: graph.edges, now: NOW, project: { metadata: { products: [null, 3, { id: "x" }, { id: "y", platforms: "web" }] } }, productId: "y" },
      { stakeId: "STK-slow", nodes: graph.nodes, edges: graph.edges, now: {}, events: "nope", quality: "nope", weighing: 3, library: 4 },
    ]) {
      deriveStakeProof(input);
    }
    const malformedNode = {
      nodes: [
        node("STK-slow", "stake", { metadata: { stake_species: "friction" } }),
        { id: "OPT-a", species: "option", title: "o" },
        { id: "AC-bad", species: "acceptance", status: "live", metadata: { platformStatuses: "x" } },
        { id: "DEC-bad", species: "decision" },
      ],
      edges: [edge("OPT-a", "STK-slow", "addresses"), edge("AC-bad", "OPT-a", "addresses"), edge("DEC-bad", "STK-slow", "impacts"), edge("DEC-bad", "OPT-a", "generates")],
    };
    deriveStakeProof({ stakeId: "STK-slow", ...malformedNode, now: NOW });
  } catch (error) {
    threw = error;
  }
  assert(threw === null, "malformed events, sections, nodes and dates never throw", threw ? String(threw.stack) : "");
  assert(deriveStakeProof({ stakeId: "STK-slow", nodes: [{ id: "STK-slow", species: "stake" }], edges: [], now: NOW })?.state === "raised", "a stake with no metadata at all is raised");
  const unknownKind = proof({ nodes: [node("STK-slow", "stake", { metadata: { stake_species: "wish" } })], edges: [] });
  assert(unknownKind.state === "raised" && unknownKind.stake_species === undefined && unknownKind.delivery === "required", "an unknown kind reads as a stake with no kind: the strictest delivery, no answer type");
}

// --- Several stakes at once ----------------------------------------------------------

{
  const graph = userGraph({ acceptance: { status: "live" } });
  graph.nodes.push(node("STK-two", "stake", { metadata: { stake_species: "need" } }));
  const all = deriveStakeProofs({ nodes: graph.nodes, edges: graph.edges, now: NOW });
  assert(same(all.map((p) => p.stake_id), ["STK-slow", "STK-two"]), "deriveStakeProofs returns one proof per stake, in node order");
  assert(all[0].state === "addressed" && all[1].state === "raised", "each read on its own");
  assert(same(all[0], proof(graph)), "and equal to the single read");
}

// --- The Pebbles seed: every stake derives a state without throwing ---------------------

{
  const seed = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "seed", "pebbles.json"), "utf8"));
  const stakes = seed.nodes.filter((n) => n.species === "stake");
  assert(stakes.length > 0, "the seed has at least one stake to read", String(stakes.length));
  const proofs = deriveStakeProofs({
    nodes: seed.nodes,
    edges: seed.edges,
    events: seed.journal,
    now: "2026-11-22T00:00:00.000Z",
    project: seed.project,
    productId: null,
    quality: seed.quality,
    weighing: seed.weighing,
  });
  assert(proofs.length === stakes.length, "one proof per stake in the seed", `${proofs.length} of ${stakes.length}`);
  assert(proofs.every((p) => p.state === null || STAKE_STATES.includes(p.state)), "every state is one of the six, or null for an archived stake");
  assert(proofs.every((p) => Array.isArray(p.cells) && p.cells.length >= 1 && Array.isArray(p.reasons)), "every proof has at least one cell and its reasons");
  const slow = proofs.find((p) => p.stake_id === "STK-pebble-reveal-too-slow");
  assert(slow !== undefined && slow.state !== undefined, "the seed's friction stake derives a state", String(slow?.state));
  console.log(`      the seed's stakes: ${proofs.map((p) => `${p.stake_id}=${p.state}`).join(", ")}`);
}

if (failures > 0) {
  console.log(`\n${failures} test(s) failed.`);
  process.exit(1);
}
console.log("\nAll stake proof tests passed.");
