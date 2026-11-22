#!/usr/bin/env node

/**
 * The generalised signal (docs/rfcs/stake-architecture.md part 2): `request.filed`
 * grows optional fields, a stake carries `metadata.evidence[]`, and the readers
 * (backlog, node timeline, cross-check, validator) treat the two halves of the
 * signal <-> stake link as one.
 */

const fs = require("fs");
const path = require("path");
const { loadSchema } = require("./load-schema");

const {
  SIGNAL_SOURCE_KINDS,
  STAKE_EVIDENCE_VOICES,
  makeEvent,
  computeBacklog,
  computeNodeTimeline,
  signalSourceKindOf,
  signalStakeIds,
  stakeEvidenceOf,
  stakeEvidenceEventIds,
  crossCheckJournal,
  parseBundle,
  validateBundle,
  RequestFiledEventSchema,
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
const ids = (events) => events.map((e) => e.id).join(",");

// --- Vocabulary --------------------------------------------------------------
assert(
  same(SIGNAL_SOURCE_KINDS, ["ticket", "interview", "form", "feedback", "audit-finding", "idea", "benchmark", "other"]),
  "eight signal source kinds",
);
assert(same(STAKE_EVIDENCE_VOICES, ["person", "maintainer", "agent"]), "three evidence voices");
assert(signalSourceKindOf({ source_kind: "interview" }) === "interview", "signalSourceKindOf reads a known kind");
assert(signalSourceKindOf({}) === undefined && signalSourceKindOf({ source_kind: "gossip" }) === undefined, "an absent or unknown kind reads as none");
assert(same(signalStakeIds({ stake_ids: ["STK-a", "", 3, "STK-b"] }), ["STK-a", "STK-b"]), "signalStakeIds keeps non-empty strings");
assert(same(signalStakeIds({}), []), "signalStakeIds of a legacy request is empty");

// --- The event schema --------------------------------------------------------
const ENV = { id: "01SIG", ts: "2026-11-22T10:00:00.000Z", actor: "arkaik-mcp" };
{
  const legacy = RequestFiledEventSchema.safeParse({ ...ENV, type: "request.filed", title: "Add search", source: "beta-feedback" });
  assert(legacy.success, "a legacy request.filed (title, source) is still valid");
  const full = RequestFiledEventSchema.safeParse({
    ...ENV,
    type: "request.filed",
    title: "Reveal is slow",
    description: "Heard twice",
    source: "beta-feedback",
    source_kind: "interview",
    verbatim: "It takes forever to show my pebble",
    provenance: "observed",
    stake_ids: ["STK-slow-reveal"],
    finding_id: "F-2026-08-SEC-web-01",
    criterion_id: "SAF-01",
    url: "https://example.com/1",
  });
  assert(full.success, "request.filed accepts every new optional field", JSON.stringify(full.error?.issues));
  assert(full.data.verbatim === "It takes forever to show my pebble" && full.data.stake_ids[0] === "STK-slow-reveal", "new fields survive a parse");
  assert(!RequestFiledEventSchema.safeParse({ ...ENV, type: "request.filed", title: "x", source_kind: "gossip" }).success, "an unknown source_kind is rejected");
  assert(!RequestFiledEventSchema.safeParse({ ...ENV, type: "request.filed", title: "x", provenance: "guessed" }).success, "an unknown provenance is rejected");
  assert(!RequestFiledEventSchema.safeParse({ ...ENV, type: "request.filed", title: "x", stake_ids: "STK-a" }).success, "stake_ids must be an array");
  assert(RequestFiledEventSchema.safeParse({ ...ENV, type: "request.filed", title: "x", source: "anything free" }).success, "source stays a free string");
  assert(!RequestFiledEventSchema.safeParse({ ...ENV, type: "request.filed" }).success, "title stays required");

  const made = makeEvent("request.filed", { title: "From a form", source_kind: "form", provenance: "anticipated" }, { actor: "t" });
  assert(made.source_kind === "form" && made.provenance === "anticipated", "makeEvent writes the new fields");
  let threw = false;
  try {
    makeEvent("request.filed", { title: "x", source_kind: "nope" });
  } catch {
    threw = true;
  }
  assert(threw, "makeEvent refuses a bad source_kind");
}

// --- Stake evidence helpers ---------------------------------------------------
const stakeNode = (id, evidence) => ({ id, species: "stake", metadata: { stake_species: "need", ...(evidence ? { evidence } : {}) } });
{
  assert(stakeEvidenceOf({ metadata: {} }).length === 0 && stakeEvidenceOf({}).length === 0, "no evidence reads as empty");
  assert(stakeEvidenceOf({ metadata: { evidence: [{ quote: "a" }, "stray", null, [1]] } }).length === 1, "stray scalars are skipped");
  const set = stakeEvidenceEventIds([
    stakeNode("STK-a", [{ event_id: "E1" }, { quote: "no event" }, { event_id: "" }]),
    stakeNode("STK-b", [{ event_id: "E2" }]),
    { id: "V-x", species: "view", metadata: { evidence: [{ event_id: "E3" }] } },
  ]);
  assert(same([...set].sort(), ["E1", "E2"]), "only stake evidence event ids are collected", [...set].join());
}

// --- Backlog: a signal is closed three ways -----------------------------------
const signals = [
  { id: "S1", ts: "2026-11-22T01:00:00.000Z", type: "request.filed", title: "open" },
  { id: "S2", ts: "2026-11-22T02:00:00.000Z", type: "request.filed", title: "linked by node_id", node_id: "V-a" },
  { id: "S3", ts: "2026-11-22T03:00:00.000Z", type: "request.filed", title: "names a stake", stake_ids: ["STK-a"] },
  { id: "S4", ts: "2026-11-22T04:00:00.000Z", type: "request.filed", title: "cited as evidence" },
  { id: "S5", ts: "2026-11-22T05:00:00.000Z", type: "request.filed", title: "names a stake that is gone", stake_ids: ["STK-gone"] },
  { id: "S6", ts: "2026-11-22T06:00:00.000Z", type: "request.filed", title: "an empty stake_ids names nothing", stake_ids: [] },
];
{
  const existing = new Set(["V-a", "STK-a", "STK-b"]);
  const evidenced = stakeEvidenceEventIds([stakeNode("STK-b", [{ event_id: "S4" }])]);
  const backlog = computeBacklog(signals, { existingNodeIds: existing, evidencedEventIds: evidenced });
  assert(ids(backlog.items) === "S1,S5,S6", "node_id, an existing stake_ids entry and a citing stake all close a signal", ids(backlog.items));

  const noEvidence = computeBacklog(signals, { existingNodeIds: existing });
  assert(ids(noEvidence.items) === "S1,S4,S5,S6", "without evidence ids a cited signal stays open (the caller supplies them)", ids(noEvidence.items));

  // A deleted stake reopens its signal.
  const deleted = computeBacklog(signals, { existingNodeIds: new Set(["V-a"]), evidencedEventIds: new Set() });
  assert(ids(deleted.items).includes("S3"), "a signal reopens when its stake no longer exists");

  // Derived existence (no snapshot): the journal's own node.created closes stake_ids.
  const withCreate = [
    { id: "N1", ts: "2026-11-22T00:00:00.000Z", type: "node.created", node_id: "STK-a", species: "stake", title: "A" },
    ...signals,
  ];
  assert(!ids(computeBacklog(withCreate).items).includes("S3"), "a stake created in the journal closes a signal naming it");

  // Evidence closes by event id whatever the item's type: a cited idea is closed too.
  const ideaCited = computeBacklog(
    [
      { id: "I1", ts: "2026-11-22T01:00:00.000Z", type: "idea.proposed", title: "open idea" },
      { id: "I2", ts: "2026-11-22T02:00:00.000Z", type: "idea.proposed", title: "cited idea" },
    ],
    { existingNodeIds: new Set(["STK-b"]), evidencedEventIds: new Set(["I2"]) },
  );
  assert(ids(ideaCited.items) === "I1", "an idea.proposed a stake cites as evidence is closed", ids(ideaCited.items));

  const legacy = computeBacklog([{ id: "L1", ts: "2026-01-01T00:00:00.000Z", type: "request.filed", title: "old", source: "user" }]);
  assert(legacy.requests.length === 1, "a legacy request is still an open request");
}

// --- Node timeline: a stake lists its signals either way -----------------------
{
  const events = [
    ...signals,
    { id: "S7", ts: "2026-11-22T07:00:00.000Z", type: "node.updated", node_id: "STK-a", changes: {} },
  ];
  const named = computeNodeTimeline(events, "STK-a");
  assert(ids(named) === "S3,S7", "a signal naming the stake in stake_ids reaches its timeline", ids(named));
  const cited = computeNodeTimeline(events, "STK-b", { evidenceEventIds: new Set(["S4"]) });
  assert(ids(cited) === "S4", "a signal the stake cites as evidence reaches its timeline", ids(cited));
  const none = computeNodeTimeline(events, "STK-b");
  assert(none.length === 0, "without evidence ids and without stake_ids a stake's timeline is empty");
  const other = computeNodeTimeline(events, "V-a");
  assert(ids(other) === "S2", "a node's timeline is unchanged by stake_ids on other signals");
}

// --- Cross-check: a dangling stake_ids is a warning, never an error --------------
{
  const bundle = {
    nodes: [{ id: "STK-a", status: "idea" }],
    edges: [],
    journal: [
      { id: "J0", ts: "2026-11-22T00:00:00.000Z", type: "journal.baseline", node_ids: ["STK-a"] },
      { id: "J1", ts: "2026-11-22T01:00:00.000Z", type: "request.filed", title: "x", stake_ids: ["STK-a", "STK-ghost"] },
    ],
  };
  const findings = crossCheckJournal(bundle);
  const dangling = findings.filter((f) => f.rule === "journal-dangling-stake-ref");
  assert(dangling.length === 1 && dangling[0].severity === "warning" && dangling[0].path === "journal[1].stake_ids[1]", "only the unknown stake is flagged, as a warning", JSON.stringify(dangling));
  assert(!findings.some((f) => f.severity === "error"), "a dangling stake_ids adds no error");
}

// --- Parse boundary and validator for metadata.evidence --------------------------
const bundleWith = (md, species = "stake") => ({
  schema_version: 3,
  project: { id: "p1", title: "P", created_at: "2026-11-22T00:00:00.000Z", updated_at: "2026-11-22T00:00:00.000Z" },
  nodes: [
    { id: "V-a", project_id: "p1", species: "view", title: "A", status: "live", platforms: ["web"] },
    species === "stake"
      ? { id: "STK-a", project_id: "p1", species: "stake", title: "S", status: "idea", platforms: [], metadata: md }
      : { id: "V-b", project_id: "p1", species: "view", title: "B", status: "live", platforms: ["web"], metadata: md },
  ],
  edges: species === "stake" ? [{ id: "e1", project_id: "p1", source_id: "STK-a", target_id: "V-a", edge_type: "concerns" }] : [],
});
{
  const good = bundleWith({ stake_species: "need", evidence: [{ event_id: "E1", quote: "q", voice: "person", date: "2026-11-20" }, { quote: "bare" }] });
  const parsed = parseBundle(good);
  assert(parsed.success, "a stake with evidence parses", JSON.stringify(parsed.error?.issues));
  assert(parsed.data.nodes[1].metadata.evidence.length === 2 && parsed.data.nodes[1].metadata.evidence[0].voice === "person", "evidence survives parse");
  assert(!parseBundle(bundleWith({ stake_species: "need", evidence: [{ voice: "robot" }] })).success, "an unknown voice is a parse error");
  assert(!parseBundle(bundleWith({ stake_species: "need", evidence: "E1" })).success, "evidence must be an array");

  const rules = (b) => validateBundle(b).findings.map((f) => `${f.severity}:${f.rule}`);
  assert(!rules(good).some((r) => r.includes("wrong-species")), "evidence on a stake draws no warning");
  const onView = bundleWith({ evidence: [{ quote: "q" }] }, "view");
  assert(rules(onView).includes("warning:stake-species-wrong-species") && validateBundle(onView).valid, "evidence on a non-stake warns and never errors");
}

// --- The fixtures ------------------------------------------------------------------
{
  const load = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, "..", "fixtures", name), "utf8"));
  const valid = validateBundle(load("signal-valid.json"));
  assert(valid.valid && valid.findings.filter((f) => f.severity === "warning").length === 0, "signal-valid.json is valid with no warnings", JSON.stringify(valid.findings));
  const warned = validateBundle(load("signal-warnings.json"));
  const rules = new Set(warned.findings.map((f) => f.rule));
  assert(warned.valid && rules.has("journal-dangling-stake-ref") && rules.has("stake-species-wrong-species"), "signal-warnings.json warns and stays valid", [...rules].join());
}

if (failures > 0) {
  console.log(`\n${failures} signal test(s) failed`);
  process.exit(1);
}
console.log("\nAll signal tests passed.");
