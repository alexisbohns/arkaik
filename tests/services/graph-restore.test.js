#!/usr/bin/env node

/**
 * The pure half of hosted restore: optimistic-concurrency matching, the delta
 * a caller sees before a destructive replace, and the one "tier-limited" rule
 * that needs no database row (docs/superpowers/plans/2026-08-04-bootstrap-method.md
 * Task 10). No database involved anywhere in this file — these are the rules,
 * not the SQL, and they run in CI's fast `build` job for exactly that reason.
 *
 * Loaded via load-graph-restore.js (see that file for why a bare
 * `require(".../restore.ts")` is not used here).
 */

const { loadGraphRestore } = require("./load-graph-restore");
const { versionMatches, computeBundleDelta, checkHostedEntityLimit } = loadGraphRestore();

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`PASS: ${name}`);
  } else {
    failures++;
    console.log(`FAIL: ${name}${detail ? `\n${detail}` : ""}`);
  }
}

// ---------------------------------------------------------------------------
// versionMatches — fails CLOSED (probe 1: this is the whole ballgame for
// optimistic concurrency vs. "replace whatever is there")
// ---------------------------------------------------------------------------

check("exact match passes", versionMatches("v7", "v7") === true);
check("quoted header matches", versionMatches('"v7"', "v7") === true);
check("mismatch fails", versionMatches("v6", "v7") === false);
check("missing If-Match fails closed", versionMatches(undefined, "v7") === false);
check("null If-Match fails closed", versionMatches(null, "v7") === false);
check("empty If-Match fails closed", versionMatches("", "v7") === false);
check("whitespace-only If-Match fails closed", versionMatches("   ", "v7") === false);
check("an empty quoted value fails closed", versionMatches('""', "v7") === false);
check("wildcard is not accepted", versionMatches("*", "v7") === false);
check("a quoted wildcard is not accepted either", versionMatches('"*"', "v7") === false);
check(
  "a weak ETag never matches, even carrying the right value",
  versionMatches('W/"v7"', "v7") === false,
  "RFC 7232 requires STRONG comparison for If-Match; a weak validator is excluded from strong comparison by definition",
);
check(
  "a lowercase weak marker is rejected the same way",
  versionMatches('w/"v7"', "v7") === false,
);
check(
  "a multi-value If-Match (valid HTTP: a comma-separated list) is refused, not parsed",
  versionMatches('"v6", "v7"', "v7") === false,
  "this endpoint's only client always states the ONE version it read; a caller offering several candidates is hedging across guesses, the opposite of that",
);
check("case differences fail — byte-exact compare", versionMatches("V7", "v7") === false);
check("surrounding whitespace around the header is tolerated", versionMatches('  "v7"  ', "v7") === true);
check(
  "internal whitespace inside the token is NOT tolerated",
  versionMatches("v 7", "v7") === false,
);

// ---------------------------------------------------------------------------
// computeBundleDelta — the baseline shape from the plan's own draft test
// ---------------------------------------------------------------------------

const prev = {
  nodes: [{ id: "V-a", title: "A" }, { id: "V-b", title: "B" }],
  edges: [{ id: "e-1" }],
  journal: [{ id: "01A", type: "node.created" }],
};
const next = {
  nodes: [{ id: "V-a", title: "A renamed" }, { id: "V-c", title: "C" }],
  edges: [{ id: "e-1" }, { id: "e-2" }],
  journal: [{ id: "01A", type: "node.created" }, { id: "01B", type: "node.created" }],
};
const delta = computeBundleDelta(prev, next);
check("added nodes counted", delta.nodesAdded === 1, JSON.stringify(delta));
check("removed nodes counted", delta.nodesRemoved === 1, JSON.stringify(delta));
check("changed nodes counted", delta.nodesChanged === 1, JSON.stringify(delta));
check("added edges counted", delta.edgesAdded === 1, JSON.stringify(delta));
check("removed edges counted", delta.edgesRemoved === 0, JSON.stringify(delta));
check("added events counted", delta.eventsAdded === 1, JSON.stringify(delta));
check("dropped events counted", delta.eventsDropped === 0, JSON.stringify(delta));
check(
  "a clean fixture flags nothing as malformed",
  delta.nodesMalformed === 0 && delta.edgesMalformed === 0 && delta.eventsMalformed === 0,
  JSON.stringify(delta),
);

const shrinking = computeBundleDelta(next, prev);
check("a restore that drops history is visible", shrinking.eventsDropped === 1, JSON.stringify(shrinking));

// ---------------------------------------------------------------------------
// nodesChanged / edgesChanged / eventsChanged must ignore object KEY ORDER,
// but NOT array element order (probe 3)
// ---------------------------------------------------------------------------
//
// Postgres jsonb does not preserve object key order at all — it reorders
// pairs by key length, then lexicographically (Postgres docs, "JSON Types":
// jsonb "does not preserve … the order of object keys"). A node read back
// out of storage and the "same" node freshly assembled by the CLI can hold
// byte-identical field values in a different key order. A naive
// JSON.stringify equality check would call that "changed" — and since EVERY
// node in a bundle round-tripped through Postgres is subject to this, it
// would make nodesChanged read as "all of them" on literally every restore, a
// number a human stops trusting fast. These assertions are the regression
// test for that specific failure mode, not a generic deep-equal smoke test.

const reordered = computeBundleDelta(
  { nodes: [{ id: "V-a", title: "A", status: "live", platforms: ["web"] }], edges: [], journal: [] },
  { nodes: [{ platforms: ["web"], status: "live", id: "V-a", title: "A" }], edges: [], journal: [] },
);
check(
  "identical fields in a different top-level key order do NOT count as changed",
  reordered.nodesChanged === 0,
  JSON.stringify(reordered),
);

const nestedReordered = computeBundleDelta(
  {
    nodes: [{ id: "F-1", metadata: { playlist: { entries: [{ type: "view", view_id: "V-a" }] } } }],
    edges: [],
    journal: [],
  },
  {
    nodes: [{ metadata: { playlist: { entries: [{ view_id: "V-a", type: "view" }] } }, id: "F-1" }],
    edges: [],
    journal: [],
  },
);
check(
  "nested object key order (e.g. metadata.playlist.entries[i]) is also ignored",
  nestedReordered.nodesChanged === 0,
  JSON.stringify(nestedReordered),
);

const arrayOrderMatters = computeBundleDelta(
  {
    nodes: [
      {
        id: "F-1",
        metadata: { playlist: { entries: [{ type: "view", view_id: "V-a" }, { type: "view", view_id: "V-b" }] } },
      },
    ],
    edges: [],
    journal: [],
  },
  {
    nodes: [
      {
        id: "F-1",
        metadata: { playlist: { entries: [{ type: "view", view_id: "V-b" }, { type: "view", view_id: "V-a" }] } },
      },
    ],
    edges: [],
    journal: [],
  },
);
check(
  "array ELEMENT order still counts as a real change (e.g. a playlist reorder)",
  arrayOrderMatters.nodesChanged === 1,
  JSON.stringify(arrayOrderMatters),
);

const edgeReordered = computeBundleDelta(
  { nodes: [], edges: [{ id: "e-1", source_id: "A", target_id: "B", kind: "composes" }], journal: [] },
  { nodes: [], edges: [{ kind: "composes", target_id: "B", id: "e-1", source_id: "A" }], journal: [] },
);
check("edgesChanged is also key-order-insensitive", edgeReordered.edgesChanged === 0, JSON.stringify(edgeReordered));

// ---------------------------------------------------------------------------
// eventsChanged — counting by id alone is not sufficient to make a rewrite
// visible (probe 4, the safety-critical number)
// ---------------------------------------------------------------------------
//
// eventsAdded/eventsDropped are presence-only by design: "dropped" means the
// id is gone, full stop. But `merge` can legitimately rewrite an event's
// payload while keeping its id — and with ONLY added/dropped exposed, that
// rewrite contributes zero to both numbers and is completely invisible to
// whoever is reading the dry-run delta before authorizing a destructive
// write. eventsChanged is what turns "invisible" into "a number to look at."

const rewritten = computeBundleDelta(
  { nodes: [], edges: [], journal: [{ id: "01A", type: "node.status_changed", to: "live" }] },
  { nodes: [], edges: [], journal: [{ id: "01A", type: "node.status_changed", to: "shipped" }] },
);
check(
  "an event with the SAME id but a different payload is neither added nor dropped...",
  rewritten.eventsAdded === 0 && rewritten.eventsDropped === 0,
  JSON.stringify(rewritten),
);
check(
  "...but IS surfaced as eventsChanged rather than disappearing silently",
  rewritten.eventsChanged === 1,
  JSON.stringify(rewritten),
);

// ---------------------------------------------------------------------------
// computeBundleDelta — malformed / hostile input (probe 2). This runs on a
// caller-supplied bundle, so this is the normal case, not the edge case.
// ---------------------------------------------------------------------------

check(
  "absent nodes/edges/journal on both sides does not throw and counts as empty",
  (() => {
    const d = computeBundleDelta({}, {});
    return d.nodesAdded === 0 && d.nodesMalformed === 0;
  })(),
);
check(
  "null nodes/edges/journal does not throw",
  (() => {
    const d = computeBundleDelta(
      { nodes: null, edges: null, journal: null },
      { nodes: null, edges: null, journal: null },
    );
    return d.nodesAdded === 0;
  })(),
);
check(
  "a non-array nodes/edges field is treated as empty, not thrown",
  (() => {
    const d = computeBundleDelta({ nodes: "not-an-array" }, { nodes: {}, edges: 5 });
    return d.nodesAdded === 0 && d.nodesRemoved === 0 && d.edgesAdded === 0;
  })(),
);

const missingId = computeBundleDelta(
  { nodes: [], edges: [], journal: [] },
  { nodes: [{ title: "no id here" }, { id: "V-ok", title: "fine" }], edges: [], journal: [] },
);
check(
  "a node with no `id` is not silently dropped from every count — it is flagged malformed",
  missingId.nodesMalformed === 1,
  JSON.stringify(missingId),
);
check(
  "the id-less node does not also inflate nodesAdded (it cannot be tracked by id at all)",
  missingId.nodesAdded === 1, // only V-ok
  JSON.stringify(missingId),
);

const nonStringId = computeBundleDelta(
  { nodes: [], edges: [], journal: [] },
  { nodes: [{ id: 123, title: "numeric id" }], edges: [], journal: [] },
);
check("a non-string id counts as malformed, not a valid new node", nonStringId.nodesMalformed === 1, JSON.stringify(nonStringId));
check("a non-string id contributes 0 to nodesAdded", nonStringId.nodesAdded === 0, JSON.stringify(nonStringId));

const duplicateId = computeBundleDelta(
  { nodes: [], edges: [], journal: [] },
  { nodes: [{ id: "V-dup", title: "first" }, { id: "V-dup", title: "second" }], edges: [], journal: [] },
);
check(
  "a duplicate id within one bundle is flagged malformed rather than silently collapsed",
  duplicateId.nodesMalformed === 1,
  JSON.stringify(duplicateId),
);

check(
  "a fully hostile shape on both sides never throws",
  (() => {
    computeBundleDelta(null, undefined);
    computeBundleDelta({ nodes: 5, edges: true, journal: "x" }, {});
    computeBundleDelta({ nodes: [null, undefined, 42, "x", { id: "ok" }] }, { nodes: [] });
    return true;
  })(),
);

// ---------------------------------------------------------------------------
// checkHostedEntityLimit — the one piece of "owner-only, tier-limited" that
// needs no database row at all (probe 5)
// ---------------------------------------------------------------------------
//
// Ownership genuinely requires a DB read (who owns this stored project row?)
// and stays out of this module — that's Task 11's job. But "does this
// bundle's entity count fit the tier" needs nothing but the bundle's own
// counts and the already-pure HOSTED_LIMITS table, so it is drawn on this
// side of the line.

const withinLimit = checkHostedEntityLimit({ nodes: new Array(10).fill({ id: "x" }), edges: [] }, "synk");
check("a small bundle fits the synk tier", withinLimit.ok === true, JSON.stringify(withinLimit));

const overLimit = checkHostedEntityLimit(
  { nodes: new Array(6000).fill(0).map((_, i) => ({ id: `n${i}` })), edges: [] },
  "synk",
);
check("a 6000-entity bundle exceeds the synk tier's 5000-entity cap", overLimit.ok === false, JSON.stringify(overLimit));
check("the limit reflects HOSTED limits, not the Synk backup limits (5000, not 250)", overLimit.limit === 5000, JSON.stringify(overLimit));
check("actual reflects nodes + edges combined", overLimit.actual === 6000, JSON.stringify(overLimit));

const klub = checkHostedEntityLimit(
  { nodes: new Array(50000).fill(0).map((_, i) => ({ id: `n${i}` })), edges: [] },
  "klub",
);
check("klub has no cap", klub.ok === true, JSON.stringify(klub));

const unknownTier = checkHostedEntityLimit({ nodes: [{ id: "x" }], edges: [] }, "not-a-real-tier");
check(
  "an unrecognized tier falls back to the safest (synk) floor, not an open cap",
  unknownTier.limit === 5000,
  JSON.stringify(unknownTier),
);

const missingArrays = checkHostedEntityLimit({}, "synk");
check("a bundle with no nodes/edges at all counts as zero entities, not a crash", missingArrays.actual === 0, JSON.stringify(missingArrays));

process.exit(failures === 0 ? 0 : 1);
