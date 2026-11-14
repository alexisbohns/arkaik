#!/usr/bin/env node

/**
 * The decision panel's model (lib/utils/decision-panel.ts): the verdict's
 * facts, the replacement line through a decision (newest first, cycle-safe),
 * and the two honest-state flags the panel says out loud.
 */

const fs = require("fs");
const { loadDecisionLog, BUILD_DIR } = require("./load-decision-log");

const { buildDecisionPanel, committedDecisionPanel } = loadDecisionLog();

let failures = 0;
function assert(cond, message) {
  if (cond) console.log(`PASS: ${message}`);
  else {
    failures++;
    console.log(`FAIL: ${message}`);
  }
}

const dec = (id, status, decided_at) => ({
  id,
  project_id: "p",
  species: "decision",
  title: `Title ${id}`,
  status: "live",
  platforms: [],
  metadata: { decision_status: status, ...(decided_at ? { decided_at } : {}) },
});
const sup = (source_id, target_id) => ({ id: `${source_id}>${target_id}`, project_id: "p", source_id, target_id, edge_type: "supersedes" });

// D supersedes C supersedes B supersedes A: a four-deep line.
const A = dec("DEC-a", "superseded", "2026-01-01");
const B = dec("DEC-b", "superseded", "2026-02-01");
const C = dec("DEC-c", "enacted", "2026-03-01"); // replaced by D, yet still enacted
const D = dec("DEC-d", "enacted", "2026-04-01");
const allNodes = [A, B, C, D];
const allEdges = [sup("DEC-d", "DEC-c"), sup("DEC-c", "DEC-b"), sup("DEC-b", "DEC-a")];

const model = committedDecisionPanel(B, allNodes, allEdges, false);
assert(model.lineage.map((e) => e.node.id).join() === "DEC-d,DEC-c,DEC-b,DEC-a", "the whole line, newest first");
assert(model.lineage.map((e) => e.relation).join() === "successor,successor,self,predecessor", "each entry says how it relates");
assert(model.lineage[0].depth === 2 && model.lineage[3].depth === 1, "depth counts the hops from this decision");
assert(model.lineage[0].dateLabel !== null && model.decidedLabel !== null, "dates are read from decided_at");
assert(model.supersedes.map((n) => n.id).join() === "DEC-a" && model.supersededBy.map((n) => n.id).join() === "DEC-c", "direct neighbours, resolved");

assert(committedDecisionPanel(D, allNodes, allEdges, false).lineage.length === 4, "the head sees the line under it");
assert(committedDecisionPanel(dec("DEC-x", "proposed"), allNodes, allEdges, false).lineage.length === 1, "a decision alone is a line of one");

const cyc = committedDecisionPanel(A, [A, B], [sup("DEC-a", "DEC-b"), sup("DEC-b", "DEC-a")], false);
assert(cyc.lineage.length === 2, "a supersedes cycle lists each decision once");

assert(committedDecisionPanel(C, allNodes, allEdges, false).replacedButNotSuperseded, "replaced but still enacted is flagged");
assert(!committedDecisionPanel(B, allNodes, allEdges, false).replacedButNotSuperseded, "replaced and marked superseded is not");
assert(committedDecisionPanel(dec("DEC-o", "superseded"), [], [], false).supersededWithoutSuccessor, "superseded with no successor is flagged");

// The live model follows the editor, not the committed node.
const live = buildDecisionPanel(C, { status: "superseded", decidedAt: "", context: "why", consequences: "", allNodes, allEdges, readOnly: true });
assert(live.status === "superseded" && live.statusLabel === "Superseded", "the optimistic status wins");
assert(!live.replacedButNotSuperseded, "and settles the flag it raised");
assert(live.decidedLabel === null && live.context === "why" && live.readOnly, "typed values and the read-only flag ride through");

fs.rmSync(BUILD_DIR, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll decision-panel tests passed");
