#!/usr/bin/env node

/**
 * Decision-status editing helpers (lib/utils/decision.ts) — the `blocked.ts`
 * pattern applied to `metadata.decision_status`.
 *
 * The load-bearing assertion is `decisionUpdatePatch`: a decision transition
 * writes the metadata change and the lifecycle sync in the SAME patch, so the
 * journal derivation (diffNodeUpdate) sees both in one `updateNode` call and
 * emits `decision.status_changed` + `node.status_changed` together
 * (spec §4). Two separate `updateNode` calls would split that into two writes
 * and this is where that would be caught.
 */

const fs = require("fs");
const { loadDecisionUtils, BUILD_DIR } = require("./load-decision-utils");

const { withDecisionStatus, decisionUpdatePatch } = loadDecisionUtils();

let failures = 0;
function assert(cond, message) {
  if (cond) console.log(`PASS: ${message}`);
  else {
    failures++;
    console.log(`FAIL: ${message}`);
  }
}

// --- withDecisionStatus -------------------------------------------------------

const meta = { context: "why", refs: [{ id: "r1" }] };
const next = withDecisionStatus(meta, "approved");
assert(next.decision_status === "approved", "sets decision_status");
assert(next.context === "why" && Array.isArray(next.refs), "carries the rest of the metadata through");

assert(
  withDecisionStatus(undefined, "proposed").decision_status === "proposed",
  "withDecisionStatus survives undefined metadata rather than throwing",
);

// --- decisionUpdatePatch -------------------------------------------------------

const node = { id: "DEC-x", status: "discovery", metadata: { decision_status: "proposed", context: "why" } };
const patch = decisionUpdatePatch(node, "approved");
assert(patch.status === "backlog", "patch syncs lifecycle status (approved → backlog)");
assert(patch.metadata.decision_status === "approved", "patch writes decision_status");
assert(patch.metadata.context === "why", "patch keeps sibling metadata");

fs.rmSync(BUILD_DIR, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll decision-utils tests passed");
