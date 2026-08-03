#!/usr/bin/env node

/**
 * The decision species and its status enum (cycle 2 of the self-map program,
 * docs/superpowers/specs/2026-08-03-decisions-species-design.md). Decision
 * statuses are NOT lifecycle statuses — they live in metadata.decision_status
 * and sync to the global lifecycle via lifecycleStatusForDecision.
 */

const { loadSchema } = require("./load-schema");

const {
  SPECIES_IDS,
  SPECIES_PREFIXES,
  DECISION_STATUS_IDS,
  lifecycleStatusForDecision,
  decisionStatusOf,
} = loadSchema();

let failures = 0;
function assert(cond, message) {
  if (cond) console.log(`PASS: ${message}`);
  else {
    failures++;
    console.log(`FAIL: ${message}`);
  }
}

// --- Species registration ---------------------------------------------------
assert(SPECIES_IDS.includes("decision"), "decision is a species id");
assert(SPECIES_PREFIXES.decision === "DEC-", "decision nodes get the DEC- prefix");

// --- The decision-status vocabulary -----------------------------------------
assert(
  JSON.stringify(DECISION_STATUS_IDS) ===
    JSON.stringify(["proposed", "approved", "enacted", "rejected", "deprecated", "superseded"]),
  "six decision statuses in path order (actual renamed enacted)",
);

// --- Lifecycle sync mapping (spec §2) ---------------------------------------
assert(lifecycleStatusForDecision("proposed") === "discovery", "proposed syncs to discovery");
assert(lifecycleStatusForDecision("approved") === "backlog", "approved syncs to backlog (agreed, not yet reality)");
assert(lifecycleStatusForDecision("enacted") === "live", "enacted syncs to live");
assert(lifecycleStatusForDecision("rejected") === "archived", "rejected syncs to archived");
assert(lifecycleStatusForDecision("deprecated") === "archived", "deprecated syncs to archived");
assert(lifecycleStatusForDecision("superseded") === "archived", "superseded syncs to archived");

// --- Reading a node's decision status ---------------------------------------
assert(
  decisionStatusOf({ metadata: { decision_status: "approved" } }) === "approved",
  "decisionStatusOf reads metadata.decision_status",
);
assert(
  decisionStatusOf({ metadata: {} }) === "proposed",
  "a decision without decision_status reads as proposed (spec §9)",
);
assert(decisionStatusOf({}) === "proposed", "missing metadata reads as proposed");
assert(
  decisionStatusOf({ metadata: { decision_status: "not-a-status" } }) === "proposed",
  "an unknown stored value falls back to proposed — render, never crash",
);

// --- Metadata fields parse and round-trip ------------------------------------
const { parseBundle, DecisionStatusSchema } = loadSchema();

const decisionNode = {
  id: "DEC-two-axes-stay",
  project_id: "p1",
  species: "decision",
  title: "Two axes stay",
  status: "live",
  platforms: [],
  metadata: {
    decision_status: "enacted",
    context: "Exposure and delivery lifecycle kept getting conflated.",
    consequences: "The stage axis keeps expressing exposure; statuses stay a pure delivery lifecycle.",
    decided_at: "2026-08-03",
  },
};

const bundle = {
  schema_version: 3,
  project: {
    id: "p1",
    title: "P",
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-03T00:00:00.000Z",
  },
  nodes: [decisionNode],
  edges: [],
};

const parsed = parseBundle(bundle);
assert(parsed.success, `bundle parses (${JSON.stringify(parsed.error?.issues)})`);
assert(parsed.data.nodes[0].metadata.decision_status === "enacted", "decision_status survives parse");
assert(parsed.data.nodes[0].metadata.decided_at === "2026-08-03", "decided_at survives parse");

assert(DecisionStatusSchema.safeParse("enacted").success, "DecisionStatusSchema accepts enacted");
assert(!DecisionStatusSchema.safeParse("actual").success, "DecisionStatusSchema rejects actual (renamed enacted)");

const badStatus = JSON.parse(JSON.stringify(bundle));
badStatus.nodes[0].metadata.decision_status = "actual";
const badParsed = parseBundle(badStatus);
assert(!badParsed.success, "an unknown decision_status is a parse error (spec §7 — same posture as unknown lifecycle status)");

// --- decision.status_changed: event schema + derivation ----------------------
const { KnownJournalEventSchema, diffNodeUpdate, toJournalEvents, crossCheckJournal } = loadSchema();

const evt = {
  id: "01J0000000000000000000TEST",
  ts: "2026-08-03T12:00:00.000Z",
  type: "decision.status_changed",
  node_id: "DEC-two-axes-stay",
  from: "approved",
  to: "enacted",
};
assert(KnownJournalEventSchema.safeParse(evt).success, "decision.status_changed validates strictly");
assert(
  !KnownJournalEventSchema.safeParse({ ...evt, to: "live" }).success,
  "from/to must be decision statuses, not lifecycle statuses",
);

// diffNodeUpdate derives it from a metadata.decision_status delta — one
// derivation shared by app, MCP and CLI dual-writers.
const current = {
  id: "DEC-two-axes-stay",
  project_id: "p1",
  species: "decision",
  title: "Two axes stay",
  status: "backlog",
  platforms: [],
  metadata: { decision_status: "approved", context: "ctx" },
};
const events = diffNodeUpdate(current, {
  status: "live",
  metadata: { decision_status: "enacted", context: "ctx" },
});
const decisionEvents = events.filter((e) => e.type === "decision.status_changed");
const statusEvents = events.filter((e) => e.type === "node.status_changed");
const updatedEvents = events.filter((e) => e.type === "node.updated");
assert(decisionEvents.length === 1, "one decision.status_changed derived");
assert(
  decisionEvents[0].payload.from === "approved" && decisionEvents[0].payload.to === "enacted",
  "decision.status_changed carries from/to",
);
assert(statusEvents.length === 1, "the synced lifecycle move still emits node.status_changed");
assert(updatedEvents.length === 0, "decision_status does NOT also appear as a node.updated field path");

// First-ever assignment: prev side defaults to proposed (a decision without
// the field reads as proposed), keeping both endpoints valid enum members.
const fresh = { ...current, metadata: { context: "ctx" } };
const firstAssign = diffNodeUpdate(fresh, { metadata: { context: "ctx", decision_status: "proposed" } });
assert(
  firstAssign.filter((e) => e.type === "decision.status_changed").length === 0,
  "writing proposed onto an implicit proposed derives nothing",
);
const firstReal = diffNodeUpdate(fresh, { metadata: { context: "ctx", decision_status: "approved" } });
const firstEvt = firstReal.find((e) => e.type === "decision.status_changed");
assert(firstEvt && firstEvt.payload.from === "proposed", "first assignment's from defaults to proposed");

// makeEvent path: the stamped event validates against the strict schema.
const stamped = toJournalEvents([{ type: "decision.status_changed", payload: { node_id: "DEC-x", from: "proposed", to: "approved" } }], "test");
assert(stamped.length === 1 && stamped[0].actor === "test", "toJournalEvents stamps the envelope");

// crossCheckJournal: last decision.status_changed.to must agree with the
// snapshot's decision_status (by value, the journal's rule 3).
const ccBundle = JSON.parse(JSON.stringify(bundle));
ccBundle.journal = [
  { id: "01J0000000000000000000AAAA", ts: "2026-08-01T00:00:00.000Z", type: "node.created", node_id: "DEC-two-axes-stay", species: "decision", title: "Two axes stay" },
  { id: "01J0000000000000000000BBBB", ts: "2026-08-02T00:00:00.000Z", type: "decision.status_changed", node_id: "DEC-two-axes-stay", from: "proposed", to: "approved" },
];
const findings = crossCheckJournal(ccBundle);
assert(
  findings.some((f) => String(f.message).includes("decision")),
  "journal saying approved vs snapshot enacted is a cross-check finding",
);
ccBundle.journal.push({ id: "01J0000000000000000000CCCC", ts: "2026-08-03T00:00:00.000Z", type: "decision.status_changed", node_id: "DEC-two-axes-stay", from: "approved", to: "enacted" });
assert(
  !crossCheckJournal(ccBundle).some((f) => String(f.message).includes("decision")),
  "agreeing journal produces no decision finding",
);

// Regression: a decision created, transitioned, then legitimately deleted
// must not be flagged — it has no snapshot entry to disagree with, and
// node.deleted carries no cascade obligation for a decision-status check.
const deletedBundle = {
  schema_version: 3,
  project: { id: "p1", title: "P", created_at: "2026-08-01T00:00:00.000Z", updated_at: "2026-08-03T00:00:00.000Z" },
  nodes: [],
  edges: [],
  journal: [
    { id: "01J0000000000000000000DDDA", ts: "2026-08-01T00:00:00.000Z", type: "node.created", node_id: "DEC-gone", species: "decision", title: "Gone" },
    { id: "01J0000000000000000000DDDB", ts: "2026-08-02T00:00:00.000Z", type: "decision.status_changed", node_id: "DEC-gone", from: "proposed", to: "approved" },
    { id: "01J0000000000000000000DDDC", ts: "2026-08-03T00:00:00.000Z", type: "node.deleted", node_id: "DEC-gone" },
  ],
};
assert(
  !crossCheckJournal(deletedBundle).some((f) => f.rule === "journal-decision-status-mismatch"),
  "a decision deleted after its last transition produces no decision-status-mismatch finding",
);

// --- Validator rules (spec §7) — warnings, never bricks ----------------------
const { validateBundle } = loadSchema();

const wrongSpecies = JSON.parse(JSON.stringify(bundle));
wrongSpecies.nodes.push({
  id: "V-settings",
  project_id: "p1",
  species: "view",
  title: "Settings",
  status: "live",
  platforms: ["web"],
  metadata: { decision_status: "approved" },
});
const wsResult = validateBundle(wrongSpecies);
assert(wsResult.valid, "decision_status on a view is not an error");
assert(
  wsResult.warnings.some((f) => f.rule === "decision-status-wrong-species"),
  "…but it is a decision-status-wrong-species warning",
);

const mismatch = JSON.parse(JSON.stringify(bundle));
mismatch.nodes[0].status = "idea"; // enacted should sync to live
const mmResult = validateBundle(mismatch);
assert(mmResult.valid, "a lifecycle/decision-status mismatch is not an error");
assert(
  mmResult.warnings.some((f) => f.rule === "decision-lifecycle-mismatch"),
  "…but it is a decision-lifecycle-mismatch warning",
);

const clean = validateBundle(bundle);
assert(
  !clean.warnings.some((f) => f.rule.startsWith("decision-")),
  "a well-formed decision produces no decision warnings",
);
assert(
  !clean.errors.some((f) => f.rule === "platforms-non-empty"),
  "a decision's empty platforms array is not a platforms-non-empty error",
);

process.exit(failures > 0 ? 1 : 0);
