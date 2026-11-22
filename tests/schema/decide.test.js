#!/usr/bin/env node

/**
 * The decision (docs/rfcs/stake-architecture.md § 14, part B): the readers that
 * say which option answers a stake, whether an option is selected, closed or
 * open, and which acceptances read as promises, and the planner that writes a
 * decision selecting an option.
 *
 * The planner is proved against the real mutation core and validator: its ops go
 * through applyOps, the result through validateBundle with a journal embedded,
 * and nothing new may warn. That includes the supersede path, where the old
 * decision must move through update_node so the journal records
 * decision.status_changed and the journal cross-check stays clean.
 */

const { loadSchema } = require("./load-schema");

const schema = loadSchema();
const {
  isSettlingDecision,
  decisionsImpacting,
  settlingDecisionsFor,
  optionsGeneratedBy,
  answerFor,
  optionClosureFor,
  acceptancesAddressing,
  isPromise,
  isCandidate,
  promisesOf,
  candidatesFor,
  planSelectOption,
  applyOps,
  toJournalEvents,
  validateBundle,
  parseBundle,
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

const P = "p1";
const node = (id, species, extra = {}) => ({ id, project_id: P, species, title: id, status: "idea", platforms: [], ...extra });
const edge = (source_id, target_id, edge_type) => ({ id: `e-${source_id}-${target_id}`, project_id: P, source_id, target_id, edge_type });
const decision = (id, status, extra = {}) =>
  node(id, "decision", {
    status: { proposed: "discovery", approved: "backlog", enacted: "live", rejected: "archived", deprecated: "archived", superseded: "archived" }[status],
    metadata: { decision_status: status, ...extra },
  });

// A stake with three options, A, B and archived C; and one acceptance per role.
function baseGraph() {
  return {
    nodes: [
      node("V-a", "view", { status: "live", platforms: ["web"] }),
      node("STK-slow", "stake", { title: "Slow reveal", status: "discovery", metadata: { stake_species: "friction" } }),
      node("OPT-a", "option", { title: "Skip the reveal", status: "discovery" }),
      node("OPT-b", "option", { title: "Shorten the reveal", status: "idea" }),
      node("OPT-c", "option", { title: "Drop the reveal", status: "archived" }),
      node("STK-other", "stake", { status: "idea", metadata: { stake_species: "bug" } }),
      node("OPT-elsewhere", "option", { status: "idea" }),
      node("AC-a1", "acceptance", { platforms: ["web"], metadata: { gherkin: "Given a\nWhen b\nThen c" } }),
    ],
    edges: [
      edge("STK-slow", "V-a", "concerns"),
      edge("OPT-a", "STK-slow", "addresses"),
      edge("OPT-b", "STK-slow", "addresses"),
      edge("OPT-c", "STK-slow", "addresses"),
      edge("OPT-elsewhere", "STK-other", "addresses"),
      edge("STK-other", "V-a", "concerns"),
      edge("AC-a1", "OPT-a", "addresses"),
      edge("AC-a1", "V-a", "covers"),
    ],
  };
}
const withDecision = (g, dec, options = [], stakes = ["STK-slow"]) => ({
  nodes: [...g.nodes, dec],
  edges: [...g.edges, ...stakes.map((s) => edge(dec.id, s, "impacts")), ...options.map((o) => edge(dec.id, o, "generates"))],
});

// --- Settling decisions ------------------------------------------------------
for (const [status, settles] of [["proposed", false], ["approved", true], ["enacted", true], ["rejected", false], ["deprecated", false], ["superseded", false]]) {
  assert(isSettlingDecision({ metadata: { decision_status: status } }) === settles, `a ${status} decision ${settles ? "settles" : "does not settle"} its stake`);
}
assert(!isSettlingDecision({}), "a decision with no status reads proposed and settles nothing");
{
  const g = withDecision(withDecision(baseGraph(), decision("DEC-1", "approved"), ["OPT-a"]), decision("DEC-2", "proposed"), ["OPT-b"]);
  assert(same(decisionsImpacting("STK-slow", g.nodes, g.edges).map((n) => n.id), ["DEC-1", "DEC-2"]), "decisionsImpacting lists every status");
  assert(same(settlingDecisionsFor("STK-slow", g.nodes, g.edges).map((n) => n.id), ["DEC-1"]), "settlingDecisionsFor keeps approved and enacted only");
  assert(settlingDecisionsFor("STK-other", g.nodes, g.edges).length === 0, "another stake has no settling decision");
  assert(same(optionsGeneratedBy("DEC-1", g.nodes, g.edges).map((n) => n.id), ["OPT-a"]), "optionsGeneratedBy lists the generated option");
}

// --- The answer --------------------------------------------------------------
{
  const g = baseGraph();
  assert(answerFor("STK-slow", g.nodes, g.edges) === undefined, "no decision, no answer");
}
{
  const g = withDecision(baseGraph(), decision("DEC-1", "approved"), ["OPT-a"]);
  const answer = answerFor("STK-slow", g.nodes, g.edges);
  assert(answer?.option.id === "OPT-a" && answer.decision.id === "DEC-1" && answer.competing.length === 0, "an approved decision's option answers the stake");
}
{
  const g = withDecision(baseGraph(), decision("DEC-1", "proposed"), ["OPT-a"]);
  assert(answerFor("STK-slow", g.nodes, g.edges) === undefined, "a proposed decision gives no answer");
  const none = withDecision(baseGraph(), decision("DEC-2", "enacted"), []);
  assert(answerFor("STK-slow", none.nodes, none.edges) === undefined, "a settling decision that generates no option gives no answer");
}
{
  // Two settling decisions: the latest by decided_at wins and the other is named.
  let g = withDecision(baseGraph(), decision("DEC-old", "approved", { decided_at: "2026-01-01" }), ["OPT-a"]);
  g = withDecision(g, decision("DEC-new", "enacted", { decided_at: "2026-03-01" }), ["OPT-b"]);
  const answer = answerFor("STK-slow", g.nodes, g.edges);
  assert(answer?.option.id === "OPT-b" && same(answer.competing, ["DEC-old"]), "with two settling decisions the later decided_at wins and the other is named");
  // Ties and missing dates fall back to the id, never to node order.
  let t = withDecision(baseGraph(), decision("DEC-1", "approved"), ["OPT-a"]);
  t = withDecision(t, decision("DEC-2", "approved"), ["OPT-b"]);
  assert(answerFor("STK-slow", t.nodes, t.edges).decision.id === "DEC-2", "undated settling decisions order by id");
  const reversed = { nodes: [...t.nodes].reverse(), edges: [...t.edges].reverse() };
  assert(answerFor("STK-slow", reversed.nodes, reversed.edges).decision.id === "DEC-2", "the answer does not depend on node order");
  let junk = withDecision(baseGraph(), decision("DEC-9", "approved", { decided_at: "not a date" }), ["OPT-a"]);
  junk = withDecision(junk, decision("DEC-1", "approved", { decided_at: "2026-01-01" }), ["OPT-b"]);
  assert(answerFor("STK-slow", junk.nodes, junk.edges).decision.id === "DEC-1", "an unparseable decided_at reads as the oldest");
}

// --- Closure -----------------------------------------------------------------
{
  const g = baseGraph();
  const closure = optionClosureFor("OPT-a", "STK-slow", g.nodes, g.edges);
  assert(closure.state === "open" && closure.decision_id === undefined, "with no decision every option is open");
}
{
  const g = withDecision(
    baseGraph(),
    decision("DEC-1", "approved", { closed_options: [{ option_id: "OPT-b", reason: "Too fiddly." }, { option_id: "OPT-c" }, "stray"] }),
    ["OPT-a"],
  );
  const selected = optionClosureFor("OPT-a", "STK-slow", g.nodes, g.edges);
  assert(selected.state === "selected" && selected.decision_id === "DEC-1", "the generated option is selected");
  const closed = optionClosureFor("OPT-b", "STK-slow", g.nodes, g.edges);
  assert(closed.state === "closed" && closed.reason === "Too fiddly.", "another option is closed, with the decision's reason");
  const noReason = optionClosureFor("OPT-c", "STK-slow", g.nodes, g.edges);
  assert(noReason.state === "closed" && noReason.reason === undefined, "a closed option with no well-formed reason is closed with none");
}
for (const status of ["proposed", "rejected", "deprecated", "superseded"]) {
  const g = withDecision(baseGraph(), decision("DEC-1", status), ["OPT-a"]);
  assert(optionClosureFor("OPT-a", "STK-slow", g.nodes, g.edges).state === "open" && optionClosureFor("OPT-b", "STK-slow", g.nodes, g.edges).state === "open", `a ${status} decision reopens every option`);
}
{
  const g = withDecision(baseGraph(), decision("DEC-1", "enacted"), []);
  assert(optionClosureFor("OPT-a", "STK-slow", g.nodes, g.edges).state === "open", "a settling decision that generates nothing selects nothing");
}
{
  // Closure is per stake: a decision on STK-slow says nothing about STK-other.
  const g = withDecision(baseGraph(), decision("DEC-1", "approved"), ["OPT-a"]);
  assert(optionClosureFor("OPT-elsewhere", "STK-other", g.nodes, g.edges).state === "open", "a decision on one stake leaves another stake's options open");
  let amb = withDecision(baseGraph(), decision("DEC-1", "approved", { decided_at: "2026-01-01" }), ["OPT-a"]);
  amb = withDecision(amb, decision("DEC-2", "approved", { decided_at: "2026-02-01" }), ["OPT-b"]);
  const closure = optionClosureFor("OPT-a", "STK-slow", amb.nodes, amb.edges);
  assert(closure.state === "closed" && same(closure.competing, ["DEC-1"]), "an ambiguous stake reads the latest decision and names the other");
}

// --- A decision that settles several stakes ----------------------------------
{
  // DEC-multi settles STK-slow and STK-other and generates an option for each.
  const g = withDecision(baseGraph(), decision("DEC-multi", "approved"), ["OPT-a", "OPT-elsewhere"], ["STK-slow", "STK-other"]);
  assert(answerFor("STK-slow", g.nodes, g.edges)?.option.id === "OPT-a", "each stake reads its own option from a decision that settles two");
  assert(answerFor("STK-other", g.nodes, g.edges)?.option.id === "OPT-elsewhere", "and the other stake reads its own, not the first generated");
  assert(optionClosureFor("OPT-elsewhere", "STK-slow", g.nodes, g.edges).state === "closed", "an option of another stake is not selected for this one");
  assert(optionClosureFor("OPT-a", "STK-other", g.nodes, g.edges).state === "closed", "and the other way round");
  // A decision whose only generated option belongs to another stake answers nothing here.
  const stray = withDecision(baseGraph(), decision("DEC-x", "approved"), ["OPT-elsewhere"]);
  assert(answerFor("STK-slow", stray.nodes, stray.edges) === undefined, "a settling decision that generates only another stake's option gives no answer");
  assert(["OPT-a", "OPT-b"].every((id) => optionClosureFor(id, "STK-slow", stray.nodes, stray.edges).state === "open"), "and leaves every option of the stake open, not closed");
  // Two addressing options generated: both readers pick the same one.
  const two = withDecision(baseGraph(), decision("DEC-two", "approved"), ["OPT-b", "OPT-a"]);
  const picked = answerFor("STK-slow", two.nodes, two.edges)?.option.id;
  const states = ["OPT-a", "OPT-b"].map((id) => optionClosureFor(id, "STK-slow", two.nodes, two.edges).state);
  assert(picked === "OPT-b" && same(states, ["closed", "selected"]), "when a decision generates two options for a stake, both readers pick the same one", `${picked} ${states}`);
}

// --- Promises and candidates -------------------------------------------------
{
  const g = baseGraph();
  const ac = g.nodes.find((n) => n.id === "AC-a1");
  assert(isCandidate(ac, g.nodes, g.edges) && !isPromise(ac, g.nodes, g.edges), "an idea acceptance no decision chose is a candidate");
  assert(same(acceptancesAddressing("OPT-a", g.nodes, g.edges).map((n) => n.id), ["AC-a1"]), "acceptancesAddressing finds the acceptance on an option");
  assert(same(candidatesFor("STK-slow", g.nodes, g.edges).map((n) => n.id), ["AC-a1"]), "candidatesFor finds a candidate through an option");
  assert(promisesOf("STK-slow", g.nodes, g.edges).length === 0, "no decision, no promises");
}
{
  const g = withDecision(baseGraph(), decision("DEC-1", "approved"), ["OPT-a"]);
  const ac = g.nodes.find((n) => n.id === "AC-a1");
  assert(isPromise(ac, g.nodes, g.edges) && !isCandidate(ac, g.nodes, g.edges), "an acceptance addressing the chosen option reads as a promise");
  assert(same(promisesOf("STK-slow", g.nodes, g.edges).map((n) => n.id), ["AC-a1"]), "promisesOf lists the answer option's acceptances");
  assert(candidatesFor("STK-slow", g.nodes, g.edges).length === 0, "a chosen acceptance is no longer a candidate");
  const lost = withDecision(baseGraph(), decision("DEC-1", "approved"), ["OPT-b"]);
  assert(!isPromise(lost.nodes.find((n) => n.id === "AC-a1"), lost.nodes, lost.edges), "an acceptance addressing a closed option is not a promise");
  const proposed = withDecision(baseGraph(), decision("DEC-1", "proposed"), ["OPT-a"]);
  assert(!isPromise(proposed.nodes.find((n) => n.id === "AC-a1"), proposed.nodes, proposed.edges), "a proposed decision does not make a promise");
}
{
  // Generated directly by a decision, no option involved.
  const g = withDecision(baseGraph(), decision("DEC-1", "enacted"), []);
  g.edges.push(edge("DEC-1", "AC-a1", "generates"));
  assert(isPromise(g.nodes.find((n) => n.id === "AC-a1"), g.nodes, g.edges), "an acceptance an enacted decision generates directly is a promise");
  const unchosen = withDecision(baseGraph(), decision("DEC-1", "rejected"), []);
  unchosen.edges.push(edge("DEC-1", "AC-a1", "generates"));
  assert(!isPromise(unchosen.nodes.find((n) => n.id === "AC-a1"), unchosen.nodes, unchosen.edges), "a rejected decision's acceptance is not a promise");
}
{
  // Already live: the quick win nobody debated. Per platform, and never archived.
  const g = baseGraph();
  const live = { ...g.nodes.find((n) => n.id === "AC-a1"), status: "backlog", platforms: ["web", "ios"], metadata: { platformStatuses: { ios: "live" } } };
  assert(isPromise(live, g.nodes, g.edges), "an acceptance live on one platform it applies to is a promise");
  const base = { ...live, metadata: {}, status: "live" };
  assert(isPromise(base, g.nodes, g.edges), "an acceptance live by its base status is a promise");
  const notThere = { ...live, platforms: ["web"], metadata: { platformStatuses: {} } };
  assert(!isPromise(notThere, g.nodes, g.edges), "an acceptance at backlog is not a promise");
  assert(!isPromise({ ...base, status: "archived" }, g.nodes, g.edges), "an archived acceptance is never a promise");
  assert(!isCandidate({ ...live, status: "backlog", metadata: {} }, g.nodes, g.edges), "an acceptance at backlog is not a candidate either");
  assert(!isPromise(node("V-a", "view", { status: "live", platforms: ["web"] }), g.nodes, g.edges), "only an acceptance can be a promise");
  // A live acceptance addressing the stake directly is one of its promises.
  const direct = { nodes: [...g.nodes.filter((n) => n.id !== "AC-a1"), { ...base, id: "AC-quick" }], edges: [...g.edges, edge("AC-quick", "STK-slow", "addresses")] };
  assert(same(promisesOf("STK-slow", direct.nodes, direct.edges).map((n) => n.id), ["AC-quick"]), "a live acceptance addressing the stake directly is a promise of the stake");
}

// --- The planner: refusals ---------------------------------------------------
const plan = (g, extra = {}) =>
  planSelectOption({ projectId: P, stakeId: "STK-slow", optionId: "OPT-a", reason: "It removes the wait.", nodes: g.nodes, edges: g.edges, ...extra });
{
  const g = baseGraph();
  const refuses = (result, text, label) =>
    assert(result.action === "refused" && result.ops.length === 0 && result.reasons.some((r) => r.includes(text)), label, JSON.stringify(result.reasons));
  refuses(plan(g, { stakeId: "STK-nope" }), "No node", "a missing stake is refused");
  refuses(plan(g, { stakeId: "V-a" }), "not a stake", "a stake id naming a view is refused");
  refuses(plan(g, { optionId: "OPT-nope" }), "No node", "a missing option is refused");
  refuses(plan(g, { optionId: "AC-a1" }), "not an option", "an option id naming an acceptance is refused");
  refuses(plan(g, { optionId: "OPT-elsewhere" }), "does not address", "an option that addresses another stake is refused");
  refuses(plan(g, { optionId: "OPT-c" }), "archived", "an archived option is refused");
  refuses(plan(g, { reason: "   " }), "reason", "an empty reason is refused");
  refuses(plan(g, { status: "proposed" }), "approved or enacted", "a status other than approved or enacted is refused");
  refuses(plan(g, { closed: [{ option_id: "OPT-elsewhere", reason: "x" }] }), "does not address", "closing an option of another stake is refused");
  refuses(plan(g, { closed: [{ option_id: "OPT-a", reason: "x" }] }), "cannot also be closed", "closing the selected option is refused");
  const settled = withDecision(g, decision("DEC-1", "approved"), ["OPT-b"]);
  const again = plan(settled);
  assert(again.action === "refused" && again.reasons.some((r) => r.includes("DEC-1") && r.includes("supersede")), "a stake that already has a settling decision is refused without supersede", JSON.stringify(again.reasons));
  const proposedOnly = withDecision(g, decision("DEC-1", "proposed"), ["OPT-b"]);
  assert(plan(proposedOnly).action === "decide", "a proposed decision does not block a new one");
  const multi = plan(g, { stakeId: "STK-nope", reason: "" });
  assert(multi.reasons.length >= 2, "refusals are collected, not first-only");
}

// --- The planner: the plan ---------------------------------------------------
{
  const g = baseGraph();
  const result = plan(g, { closed: [{ option_id: "OPT-b", reason: "Too fiddly." }], decidedAt: "2026-11-22" });
  assert(result.action === "decide" && result.decision_id === 'DEC-select-skip-the-reveal-for-slow-reveal', "the plan names a derived DEC- id", result.decision_id);
  const [create, impacts, generates] = result.ops;
  assert(result.ops.length === 3 && create.op === "create_node" && impacts.op === "create_edge" && generates.op === "create_edge", "a plain decision is one node and two edges");
  const dec = create.node;
  assert(dec.species === "decision" && same(dec.platforms, []) && dec.status === "backlog", "the decision has no platforms and the lifecycle status of approved");
  assert(dec.metadata.decision_status === "approved" && dec.metadata.context === "It removes the wait." && dec.metadata.decided_at === "2026-11-22", "the decision carries status, context and date");
  assert(same(dec.metadata.closed_options, [{ option_id: "OPT-b", reason: "Too fiddly." }]), "closed_options lists the named loser, and not the archived option");
  assert(impacts.edge.edge_type === "impacts" && impacts.edge.source_id === dec.id && impacts.edge.target_id === "STK-slow" && impacts.edge.id === `e-${dec.id}-STK-slow`, "an impacts edge runs to the stake");
  assert(generates.edge.edge_type === "generates" && generates.edge.target_id === "OPT-a", "a generates edge runs to the option");
  assert(result.handToHuman.length === 0, "nothing to hand over when every loser has a reason");
}
{
  const g = baseGraph();
  const result = plan(g, { status: "enacted" });
  const dec = result.ops[0].node;
  assert(dec.status === "live" && dec.metadata.decision_status === "enacted", "an enacted decision is stored live");
  assert(!("decided_at" in dec.metadata), "decided_at is left out when none is given");
  assert(same(dec.metadata.closed_options, [{ option_id: "OPT-b", reason: 'Not selected: "Skip the reveal" was chosen.' }]), "an unnamed loser gets the default reason");
  assert(result.handToHuman.length === 1 && result.handToHuman[0].includes("OPT-b"), "a defaulted reason is handed to a human");
  const titled = plan(g, { title: "  Cut the wait  " });
  assert(titled.ops[0].node.title === "Cut the wait" && titled.decision_id === "DEC-cut-the-wait", "an explicit title is trimmed and used");
  const lone = planSelectOption({
    projectId: P, stakeId: "STK-other", optionId: "OPT-elsewhere", reason: "Only way.",
    nodes: g.nodes, edges: g.edges,
  });
  assert(lone.action === "decide" && !("closed_options" in lone.ops[0].node.metadata), "a sole option has nobody to close, so closed_options is left out");
  const clash = plan({ nodes: [...g.nodes, node("DEC-select-skip-the-reveal-for-slow-reveal", "decision")], edges: g.edges });
  assert(clash.decision_id === "DEC-select-skip-the-reveal-for-slow-reveal-2", "a taken decision id gets a counter");
}

// --- The planner: through applyOps and the validator -------------------------
function bundleOf(g, journal) {
  return {
    schema_version: 3,
    project: { id: P, title: "P", created_at: "2026-11-22T00:00:00.000Z", updated_at: "2026-11-22T00:00:00.000Z" },
    nodes: g.nodes,
    edges: g.edges,
    ...(journal !== undefined ? { journal } : {}),
  };
}
// Every finding as severity:rule@path, with a count, so a second instance of a rule the bundle already warns about shows up.
const findingCounts = (result) => {
  const counts = new Map();
  for (const f of result.findings) {
    const key = `${f.severity}:${f.rule}@${f.path ?? ""}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
};

function proveClean(label, g, journal, input) {
  const before = validateBundle(bundleOf(g, journal));
  const result = planSelectOption({ projectId: P, nodes: g.nodes, edges: g.edges, ...input });
  assert(result.action === "decide", `${label}: planned`, JSON.stringify(result.reasons));
  const outcome = applyOps({ projectId: P, nodes: g.nodes, edges: g.edges }, result.ops);
  const events = toJournalEvents(outcome.eventInputs, "test");
  const after = validateBundle(bundleOf({ nodes: outcome.nodes, edges: outcome.edges }, [...journal, ...events]));
  assert(after.valid, `${label}: the result is a valid bundle`, JSON.stringify(after.errors));
  const was = findingCounts(before);
  const novel = [...findingCounts(after)].filter(([key, count]) => count > (was.get(key) ?? 0)).map(([key]) => key);
  assert(novel.length === 0, `${label}: no new warnings`, novel.join(", "));
  assert(parseBundle(bundleOf({ nodes: outcome.nodes, edges: outcome.edges }, [...journal, ...events])).success, `${label}: the result parses`);
  return { result, outcome, events, after };
}
const createdEvents = (g) => toJournalEvents(applyOps({ projectId: P, nodes: [], edges: [] }, g.nodes.map((n) => ({ op: "create_node", node: n }))).eventInputs, "seed");

{
  const g = baseGraph();
  const seed = createdEvents(g);
  const { outcome } = proveClean("selecting an option", g, seed, { stakeId: "STK-slow", optionId: "OPT-a", reason: "It removes the wait.", closed: [{ option_id: "OPT-b", reason: "Too fiddly." }], decidedAt: "2026-11-22" });
  assert(answerFor("STK-slow", outcome.nodes, outcome.edges)?.option.id === "OPT-a", "the written decision reads back as the answer");
  assert(optionClosureFor("OPT-b", "STK-slow", outcome.nodes, outcome.edges).reason === "Too fiddly.", "and closes the loser with its reason");
  assert(promisesOf("STK-slow", outcome.nodes, outcome.edges).some((n) => n.id === "AC-a1"), "and makes the option's acceptance a promise");
}
{
  const g = baseGraph();
  proveClean("an enacted decision", g, createdEvents(g), { stakeId: "STK-slow", optionId: "OPT-b", reason: "Cheapest.", status: "enacted" });
}
{
  // The supersede path: the old decision moves through update_node, so the
  // journal records decision.status_changed and the cross-check stays clean.
  const first = baseGraph();
  const firstPlan = planSelectOption({ projectId: P, stakeId: "STK-slow", optionId: "OPT-a", reason: "It removes the wait.", nodes: first.nodes, edges: first.edges, decidedAt: "2026-11-01" });
  const afterFirst = applyOps({ projectId: P, nodes: first.nodes, edges: first.edges }, firstPlan.ops);
  const journal = [...createdEvents(first), ...toJournalEvents(afterFirst.eventInputs, "test")];
  const g = { nodes: afterFirst.nodes, edges: afterFirst.edges };
  assert(validateBundle(bundleOf(g, journal)).valid, "the first decision's bundle is valid");

  const blocked = planSelectOption({ projectId: P, stakeId: "STK-slow", optionId: "OPT-b", reason: "Cheaper.", nodes: g.nodes, edges: g.edges });
  assert(blocked.action === "refused", "a second decision without supersede is refused");

  const { result, outcome, events } = proveClean("superseding a decision", g, journal, { stakeId: "STK-slow", optionId: "OPT-b", reason: "Cheaper.", supersede: true, decidedAt: "2026-11-22" });
  const firstId = firstPlan.decision_id;
  assert(result.ops[0].op === "update_node" && result.ops[0].node_id === firstId, "the old decision is updated first, through update_node");
  assert(result.ops.some((o) => o.op === "create_edge" && o.edge.edge_type === "supersedes" && o.edge.source_id === result.decision_id && o.edge.target_id === firstId), "a supersedes edge runs new to old");
  assert(result.reasons.some((r) => r.includes(firstId)), "the plan says what it supersedes");
  assert(events.some((e) => e.type === "decision.status_changed" && e.node_id === firstId && e.from === "approved" && e.to === "superseded"), "the journal records decision.status_changed for the old decision");
  const old = outcome.nodes.find((n) => n.id === firstId);
  assert(old.metadata.decision_status === "superseded" && old.status === "archived" && old.metadata.context === "It removes the wait.", "the old decision is superseded, archived, and keeps its own fields");
  assert(settlingDecisionsFor("STK-slow", outcome.nodes, outcome.edges).length === 1, "exactly one decision settles the stake now");
  assert(answerFor("STK-slow", outcome.nodes, outcome.edges)?.option.id === "OPT-b", "the answer is the new option");
  assert(optionClosureFor("OPT-a", "STK-slow", outcome.nodes, outcome.edges).state === "closed", "the old option is now closed");
  assert(!isPromise(outcome.nodes.find((n) => n.id === "AC-a1"), outcome.nodes, outcome.edges), "and its acceptance stops reading as a promise");
  const cross = validateBundle(bundleOf({ nodes: outcome.nodes, edges: outcome.edges }, [...journal, ...events])).findings.filter((f) => f.rule.startsWith("journal-"));
  assert(cross.length === 0, "the journal cross-check is clean", JSON.stringify(cross));
}
{
  // supersede with nothing to supersede is harmless; and with an ambiguous stake it supersedes every settling decision.
  const g = baseGraph();
  const harmless = plan(g, { supersede: true });
  assert(harmless.action === "decide" && harmless.ops.length === 3, "supersede on a stake with no decision plans a plain decision");
  let amb = withDecision(g, decision("DEC-1", "approved", { decided_at: "2026-01-01" }), ["OPT-a"]);
  amb = withDecision(amb, decision("DEC-2", "approved", { decided_at: "2026-02-01" }), ["OPT-b"]);
  const result = plan(amb, { optionId: "OPT-b", supersede: true });
  assert(result.ops.filter((o) => o.op === "update_node").length === 2 && result.ops.filter((o) => o.op === "create_edge" && o.edge.edge_type === "supersedes").length === 2, "an ambiguous stake has every settling decision superseded");
  const outcome = applyOps({ projectId: P, nodes: amb.nodes, edges: amb.edges }, result.ops);
  assert(validateBundle(bundleOf({ nodes: outcome.nodes, edges: outcome.edges })).findings.every((f) => f.rule !== "stake-multiple-decisions"), "and the stake-multiple-decisions warning clears");
}

{
  // Superseding a decision that also settles another stake un-settles that stake: the plan says so.
  const g = withDecision(baseGraph(), decision("DEC-multi", "approved"), ["OPT-a", "OPT-elsewhere"], ["STK-slow", "STK-other"]);
  const result = plan(g, { optionId: "OPT-b", supersede: true });
  assert(result.action === "decide" && result.handToHuman.some((h) => h.includes("DEC-multi") && h.includes("STK-other")), "superseding a decision that settles another stake hands that to a human", JSON.stringify(result.handToHuman));
  const single = withDecision(baseGraph(), decision("DEC-1", "approved"), ["OPT-a"]);
  assert(plan(single, { optionId: "OPT-b", supersede: true }).handToHuman.every((h) => !h.includes("also settles")), "superseding a one-stake decision adds no such note");
}

if (failures > 0) {
  console.log(`\n${failures} test(s) failed.`);
  process.exit(1);
}
console.log("\nAll decision tests passed.");
