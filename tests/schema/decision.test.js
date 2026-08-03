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

process.exit(failures > 0 ? 1 : 0);
