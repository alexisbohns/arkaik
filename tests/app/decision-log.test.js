#!/usr/bin/env node

/**
 * The Decision Log model (lib/utils/decision-log.ts): every rule the log
 * renders — heads and the chains nested under them, what a filter or a search
 * flattens, which date a row shows, what a superseded row keeps, which related
 * nodes count, why an empty log is empty, and the page-level facts (counts,
 * latest, open calls).
 */

const fs = require("fs");
const { loadDecisionLog, BUILD_DIR } = require("./load-decision-log");

const { buildDecisionLog, decidedDate, formatDecidedInstant, createdTsFrom } = loadDecisionLog();

let failures = 0;
function assert(cond, message) {
  if (cond) console.log(`PASS: ${message}`);
  else {
    failures++;
    console.log(`FAIL: ${message}`);
  }
}

const dec = (id, status, decided_at, extra = {}) => ({
  id,
  project_id: "p",
  species: "decision",
  title: `Title ${id}`,
  description: `Why ${id}`,
  status: "live",
  platforms: [],
  metadata: { decision_status: status, ...(decided_at ? { decided_at } : {}), ...(extra.metadata ?? {}) },
  ...extra.node,
});
const edge = (source_id, edge_type, target_id) => ({ id: `${source_id}-${edge_type}-${target_id}`, project_id: "p", source_id, target_id, edge_type });

// A 3-deep chain: C supersedes B supersedes A; D stands alone; E is proposed and newest.
const A = dec("DEC-a", "superseded", "2026-01-10");
const B = dec("DEC-b", "superseded", "2026-02-10");
const C = dec("DEC-c", "enacted", "2026-03-10", { metadata: { context: "because", consequences: "  " } });
const D = dec("DEC-d", "enacted", "2026-02-20");
const E = dec("DEC-e", "proposed", "2026-04-01");
const V = { id: "V-home", project_id: "p", species: "view", title: "Home", status: "live", platforms: [] };
const decisions = [A, B, C, D, E];
const allNodes = [...decisions, V];
const allEdges = [
  edge("DEC-c", "supersedes", "DEC-b"),
  edge("DEC-b", "supersedes", "DEC-a"),
  edge("DEC-d", "impacts", "V-home"),
  edge("DEC-d", "impacts", "V-ghost"), // no node answers to it
];

const base = { decisions, allNodes, allEdges, statusFilter: "all", detailed: true };

// --- heads and chains ----------------------------------------------------------

let log = buildDecisionLog(base);
assert(log.entries.map((e) => e.row.id).join() === "DEC-e,DEC-c,DEC-d", "heads only, newest first");
const c = log.entries.find((e) => e.row.id === "DEC-c");
assert(c.chain.map((r) => r.id).join() === "DEC-b,DEC-a", "a head carries its transitive chain, newest first");
assert(log.chains === 1 && log.shown === 5 && !log.flat, "one chain; every decision shown; not flat");

// A pure cycle has no head: both members still surface at the top level.
const X = dec("DEC-x", "enacted", "2026-01-01");
const Y = dec("DEC-y", "enacted", "2026-01-02");
const cyc = buildDecisionLog({
  ...base,
  decisions: [X, Y],
  allNodes: [X, Y],
  allEdges: [edge("DEC-x", "supersedes", "DEC-y"), edge("DEC-y", "supersedes", "DEC-x")],
});
assert(cyc.entries.length === 2, "a supersedes cycle with no head surfaces its members instead of losing them");

// --- flattening ----------------------------------------------------------------

log = buildDecisionLog({ ...base, statusFilter: "superseded" });
assert(log.flat && log.entries.map((e) => e.row.id).join() === "DEC-b,DEC-a", "a status filter flattens to matching rows");
assert(log.entries.every((e) => e.chain.length === 0) && log.chains === 0, "flat rows carry no chain");

log = buildDecisionLog({ ...base, search: "  dec-D " });
assert(log.flat && log.entries.map((e) => e.row.id).join() === "DEC-d", "search matches the id, trimmed and case-blind");
log = buildDecisionLog({ ...base, search: "why dec-a" });
assert(log.entries.map((e) => e.row.id).join() === "DEC-a", "search matches the description");

// --- rows ----------------------------------------------------------------------

log = buildDecisionLog(base);
const rowA = log.entries.find((e) => e.row.id === "DEC-c").chain.find((r) => r.id === "DEC-a");
assert(rowA.superseded && !rowA.showDescription, "a superseded decision keeps its title and loses its prose");
const rowD = log.entries.find((e) => e.row.id === "DEC-d").row;
assert(rowD.showDescription && rowD.showMeta, "detailed shows prose and the meta line");
assert(rowD.impacted.map((n) => n.id).join() === "V-home", "an impacts target no node answers to is dropped");
const rowC = log.entries.find((e) => e.row.id === "DEC-c").row;
assert(rowC.hasContext && !rowC.hasConsequences, "whitespace-only reasoning does not count as written");
assert(rowC.supersedes.map((n) => n.id).join() === "DEC-b", "a row knows what it directly supersedes");
assert(rowA.supersededBy.map((n) => n.id).join() === "DEC-b", "and what directly superseded it");
const compact = buildDecisionLog({ ...base, detailed: false }).entries[0].row;
assert(!compact.showDescription && !compact.showMeta, "compact hides prose and the meta line");

// --- dates ---------------------------------------------------------------------

const undated = dec("DEC-u", "proposed", undefined);
const journal = [
  { type: "node.created", node_id: "DEC-u", ts: "2026-05-01T09:00:00.000Z" },
  { type: "node.created", node_id: "DEC-u", ts: "2026-06-01T09:00:00.000Z" },
];
assert(createdTsFrom(journal).get("DEC-u") === "2026-05-01T09:00:00.000Z", "the first node.created wins");
log = buildDecisionLog({ ...base, decisions: [undated, D], allNodes: [undated, D], journal });
const rowU = log.entries.find((e) => e.row.id === "DEC-u").row;
assert(rowU.dateSource === "recorded" && rowU.instant.startsWith("2026-05-01"), "no decided_at: the created ts, said as recorded");
assert(log.entries[0].row.id === "DEC-u", "a full instant and a bare date sort on one line");
assert(rowD.dateSource === "decided", "decided_at is said as decided");
const bare = buildDecisionLog({ ...base, decisions: [dec("DEC-n", "proposed")], allNodes: [] }).entries[0].row;
assert(bare.dateLabel === null && bare.dateSource === null && bare.instant === "", "no date at all is null, not a guess");
const local = decidedDate("2026-01-05");
assert(local.getFullYear() === 2026 && local.getMonth() === 0 && local.getDate() === 5, "a bare date is a LOCAL date");
assert(formatDecidedInstant("not a date") === "not a date", "an unparseable instant comes back as written");

// --- empty, counts, latest, open -----------------------------------------------

const none = buildDecisionLog({ ...base, decisions: [], allNodes: [] });
assert(none.empty === "no-decisions" && /No decisions yet/.test(none.emptyMessage), "no decisions at all");
assert(buildDecisionLog({ ...base, statusFilter: "rejected" }).empty === "no-status-match", "a filter that matches nothing");
assert(buildDecisionLog({ ...base, search: "zzz" }).empty === "no-search-match", "a search that matches nothing");

log = buildDecisionLog({ ...base, statusFilter: "superseded" });
const counts = Object.fromEntries(log.counts.map((x) => [x.status, x.count]));
assert(log.total === 5 && counts.superseded === 2 && counts.enacted === 2 && counts.rejected === 0, "counts are unfiltered, zeros included");
assert(log.counts.map((x) => x.status).join() === "proposed,approved,enacted,rejected,deprecated,superseded", "counts follow the vocabulary's order");
assert(log.latest.id === "DEC-e", "latest is the newest decision, filter or not");
assert(log.open.map((r) => r.id).join() === "DEC-e", "open calls are the proposed decisions");

fs.rmSync(BUILD_DIR, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll decision-log tests passed");
