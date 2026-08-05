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
 *
 * Coordinator review, round 1 — five real findings, all reflected below:
 * an unbounded-recursion crash (depth-cap test), a factually wrong "lowercase
 * hex" version comment (fixtures below use realistic decimal versions, not
 * "v7"), `limit: Infinity` leaking onto the success path (klub.limit === null
 * test), a boolean collapsing three different client errors into one "false"
 * (classifyIfMatch tests), and `nodesMalformed` summing both sides instead of
 * being one-directional (the dedicated prev-only-malformed test).
 */

const { loadGraphRestore } = require("./load-graph-restore");
const { versionMatches, classifyIfMatch, classifyDryRun, computeBundleDelta, checkHostedEntityLimit } =
  loadGraphRestore();

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
// classifyIfMatch / versionMatches — fails CLOSED (probe 1), and distinguishes
// WHY a non-match happened (coordinator finding 4)
//
// Fixtures use realistic DECIMAL versions ("7", "6"), not "v7" — the version
// column is `bigint`, surfaced as `String(row.version)`; it is never hex.
// ---------------------------------------------------------------------------

check("exact match passes", versionMatches("7", "7") === true);
check("quoted header matches", versionMatches('"7"', "7") === true);
check("mismatch fails", versionMatches("6", "7") === false);
check("missing If-Match fails closed", versionMatches(undefined, "7") === false);
check("null If-Match fails closed", versionMatches(null, "7") === false);
check("empty If-Match fails closed", versionMatches("", "7") === false);
check("whitespace-only If-Match fails closed", versionMatches("   ", "7") === false);
check("an empty quoted value fails closed", versionMatches('""', "7") === false);
check("wildcard is not accepted", versionMatches("*", "7") === false);
check("a quoted wildcard is not accepted either", versionMatches('"*"', "7") === false);
check(
  "a weak ETag never matches, even carrying the right value",
  versionMatches('W/"7"', "7") === false,
  "RFC 9110 §13.1.1 requires STRONG comparison for If-Match; §8.8.3.2 excludes weak validators from strong comparison by definition",
);
check("a lowercase weak marker is rejected the same way", versionMatches('w/"7"', "7") === false);
check(
  "a multi-value If-Match (valid HTTP: a comma-separated list) is refused, not parsed",
  versionMatches('"6", "7"', "7") === false,
  "this endpoint's only client always states the ONE version it read; a caller offering several candidates is hedging across guesses, the opposite of that",
);
check("surrounding whitespace around the header is tolerated", versionMatches('  "7"  ', "7") === true);
check("internal whitespace inside the token is NOT tolerated", versionMatches("7 1", "71") === false);
check(
  "no numeric coercion — a differently-formatted version does not match (comparison is a byte-exact string compare, not numeric)",
  versionMatches('"07"', "7") === false,
);
check("multi-digit decimal versions compare correctly", versionMatches("103", "103") === true);

// --- classifyIfMatch: the four outcomes, and which one each shape gets ---

check("absent: missing header", classifyIfMatch(undefined, "7") === "absent");
check("absent: null header", classifyIfMatch(null, "7") === "absent");
check("absent: empty header", classifyIfMatch("", "7") === "absent");
check("absent: whitespace-only header", classifyIfMatch("   ", "7") === "absent");
check("unsupported: bare wildcard", classifyIfMatch("*", "7") === "unsupported");
check("unsupported: quoted wildcard", classifyIfMatch('"*"', "7") === "unsupported");
check("unsupported: weak ETag", classifyIfMatch('W/"7"', "7") === "unsupported");
check("unsupported: multi-value list", classifyIfMatch('"6", "7"', "7") === "unsupported");
check("unsupported: empty quoted value", classifyIfMatch('""', "7") === "unsupported");
check("stale: well-formed but wrong version", classifyIfMatch("6", "7") === "stale");
check("stale: no numeric coercion (differently-formatted, not just wrong)", classifyIfMatch('"07"', "7") === "stale");
check("match: bare correct version", classifyIfMatch("7", "7") === "match");
check("match: quoted correct version", classifyIfMatch('"7"', "7") === "match");
check(
  "versionMatches is exactly classifyIfMatch === 'match'",
  versionMatches("7", "7") === (classifyIfMatch("7", "7") === "match") &&
    versionMatches("6", "7") === (classifyIfMatch("6", "7") === "match") &&
    versionMatches("*", "7") === (classifyIfMatch("*", "7") === "match"),
);

// ---------------------------------------------------------------------------
// classifyDryRun — fails CLOSED in the OPPOSITE direction from If-Match: an
// unrecognized token must never silently fall back to the destructive
// (non-dry-run) branch. Coordinator finding 1 on Task 11's route: the first
// version accepted only "1"/"true" and treated everything else — a bare
// `?dryRun`, "yes", "on", a typo — as authorization to write.
// ---------------------------------------------------------------------------

check("absent (param not sent at all) defaults to a REAL write, not a preview", (() => {
  const r = classifyDryRun(null);
  return r.ok === true && r.dryRun === false;
})());
check("bare ?dryRun (empty string value) means preview", (() => {
  const r = classifyDryRun("");
  return r.ok === true && r.dryRun === true;
})());
check("\"1\" means preview", (() => {
  const r = classifyDryRun("1");
  return r.ok === true && r.dryRun === true;
})());
check("\"true\" means preview", (() => {
  const r = classifyDryRun("true");
  return r.ok === true && r.dryRun === true;
})());
check("\"0\" means a real write (explicit opt-out, not just absent)", (() => {
  const r = classifyDryRun("0");
  return r.ok === true && r.dryRun === false;
})());
check("\"false\" means a real write", (() => {
  const r = classifyDryRun("false");
  return r.ok === true && r.dryRun === false;
})());
check(
  "an unrecognized token (\"yes\") is REFUSED, not silently treated as a real write",
  classifyDryRun("yes").ok === false,
);
check("\"on\" is also refused", classifyDryRun("on").ok === false);
check("\"TRUE\" (wrong case) is refused, not case-folded", classifyDryRun("TRUE").ok === false);
check("a stray \" 1 \" with whitespace is refused, not trimmed and accepted", classifyDryRun(" 1 ").ok === false);

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
check(
  "before/after totals reflect raw array lengths on each side",
  delta.nodesBefore === 2 && delta.nodesAfter === 2 && delta.edgesBefore === 1 && delta.edgesAfter === 2 &&
    delta.eventsBefore === 1 && delta.eventsAfter === 2,
  JSON.stringify(delta),
);

const shrinking = computeBundleDelta(next, prev);
check("a restore that drops history is visible", shrinking.eventsDropped === 1, JSON.stringify(shrinking));

// ---------------------------------------------------------------------------
// Before/after totals — the reconciliation line (coordinator finding 6)
// ---------------------------------------------------------------------------

const identical = { nodes: [{ id: "V-a" }, { id: "V-b" }, { id: "V-c" }], edges: [], journal: [] };
const noopDelta = computeBundleDelta(identical, identical);
check(
  "identical bundles report zero for every delta count...",
  noopDelta.nodesAdded === 0 && noopDelta.nodesRemoved === 0 && noopDelta.nodesChanged === 0 && noopDelta.nodesMalformed === 0,
  JSON.stringify(noopDelta),
);
check(
  "...but the totals still reconcile — 'replacing 3 nodes with 3', not indistinguishable from empty-to-empty",
  noopDelta.nodesBefore === 3 && noopDelta.nodesAfter === 3,
  JSON.stringify(noopDelta),
);

const shrunk = computeBundleDelta(
  { nodes: [{ id: "V-a" }, { id: "V-b" }], edges: [], journal: [] },
  { nodes: [{ id: "V-a" }], edges: [], journal: [] },
);
check(
  "totals reconcile on a shrinking restore too — 'replacing 2 nodes with 1'",
  shrunk.nodesBefore === 2 && shrunk.nodesAfter === 1 && shrunk.nodesRemoved === 1,
  JSON.stringify(shrunk),
);

// ---------------------------------------------------------------------------
// nodesMalformed / edgesMalformed / eventsMalformed — INCOMING bundle only,
// not both sides summed (coordinator finding 5)
// ---------------------------------------------------------------------------

const malformedOnlyInOutgoing = computeBundleDelta(
  { nodes: [{ title: "already stored, no id — should never happen, but if it did..." }, { id: "V-x" }], edges: [], journal: [] },
  { nodes: [{ id: "V-x" }], edges: [], journal: [] },
);
check(
  "malformed entries in the OUTGOING (prev) bundle do NOT count — only the incoming bundle's shape is the caller's decision to make",
  malformedOnlyInOutgoing.nodesMalformed === 0,
  JSON.stringify(malformedOnlyInOutgoing),
);

const malformedOnlyInIncoming = computeBundleDelta(
  { nodes: [{ id: "V-x" }], edges: [], journal: [] },
  { nodes: [{ id: "V-x" }, { title: "no id — this one SHOULD count" }], edges: [], journal: [] },
);
check(
  "malformed entries in the INCOMING (next) bundle DO count",
  malformedOnlyInIncoming.nodesMalformed === 1,
  JSON.stringify(malformedOnlyInIncoming),
);

// ---------------------------------------------------------------------------
// nodesChanged / edgesChanged / eventsChanged must ignore object KEY ORDER,
// but NOT array element order (probe 3)
// ---------------------------------------------------------------------------
//
// Postgres jsonb does not preserve object key order — shorter keys sort
// before longer ones, with a byte-comparison (not lexicographic) tie-break
// among equal-length keys. A node read back out of storage and the "same"
// node freshly assembled by the CLI can hold byte-identical field values in
// a different key order. A naive JSON.stringify equality check would call
// that "changed" — and since EVERY node in a bundle round-tripped through
// Postgres is subject to this, it would make nodesChanged read as "all of
// them" on literally every restore, a number a human stops trusting fast.
// These assertions are the regression test for that specific failure mode.

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
// Depth cap — unbounded recursion is reachable via `metadata` and must not
// crash the one endpoint whose failure mode must never be an unhandled 500
// (coordinator finding 1)
// ---------------------------------------------------------------------------

function deeplyNested(depth) {
  let obj = { leaf: true };
  for (let i = 0; i < depth; i += 1) obj = { nested: obj };
  return obj;
}

// Two SEPARATE deep structures, deliberately not the same object reference:
// deepEqualIgnoringKeyOrder's `a === b` fast path would otherwise short-circuit
// at depth 0 (reference equality) and never actually recurse — which would
// make this test pass for the wrong reason and prove nothing about the depth
// cap. Same shape, same values, distinct objects, so the comparator is forced
// to walk all the way down (and hit the cap) to find out.
let deepError = null;
let deepDelta = null;
try {
  deepDelta = computeBundleDelta(
    { nodes: [{ id: "V-deep", metadata: deeplyNested(10000) }], edges: [], journal: [] },
    { nodes: [{ id: "V-deep", metadata: deeplyNested(10000) }], edges: [], journal: [] },
  );
} catch (err) {
  deepError = err;
}
check(
  "10,000 levels of nested metadata does not throw a RangeError",
  deepError === null,
  deepError ? `${deepError.name}: ${deepError.message}` : "",
);
check(
  "past the depth cap, two DISTINCT-but-equal-shaped values are conservatively reported as CHANGED, not silently equal",
  deepDelta !== null && deepDelta.nodesChanged === 1,
  deepDelta ? JSON.stringify(deepDelta) : "(threw, see above)",
);

// ---------------------------------------------------------------------------
// eventsChanged — counting by id alone is not sufficient to make a rewrite
// visible (probe 4, the safety-critical number)
// ---------------------------------------------------------------------------

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
    return d.nodesAdded === 0 && d.nodesMalformed === 0 && d.nodesBefore === 0 && d.nodesAfter === 0;
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

check(
  "an empty-string id is malformed, not a valid empty key",
  computeBundleDelta({ nodes: [], edges: [], journal: [] }, { nodes: [{ id: "" }], edges: [], journal: [] }).nodesMalformed === 1,
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
// needs no database row at all (probe 5), and does not leak Infinity onto
// the success path (coordinator finding 3)
// ---------------------------------------------------------------------------

const withinLimit = checkHostedEntityLimit({ nodes: new Array(10).fill({ id: "x" }), edges: [] }, "synk");
check("a small bundle fits the synk tier", withinLimit.ok === true, JSON.stringify(withinLimit));
check("a bounded tier's limit is a plain number", withinLimit.limit === 5000, JSON.stringify(withinLimit));

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
check("klub has no cap (ok: true at 50,000 entities)", klub.ok === true, JSON.stringify(klub));
check(
  "klub's uncapped limit is null, never Infinity — Infinity must never reach a response body, including the SUCCESS path",
  klub.limit === null,
  JSON.stringify(klub),
);
check("Infinity does not leak through JSON.stringify either, once normalized", JSON.parse(JSON.stringify(klub)).limit === null);

const unknownTier = checkHostedEntityLimit({ nodes: [{ id: "x" }], edges: [] }, "not-a-real-tier");
check(
  "an unrecognized tier falls back to the safest (synk) floor, not an open cap",
  unknownTier.limit === 5000,
  JSON.stringify(unknownTier),
);

const missingArrays = checkHostedEntityLimit({}, "synk");
check("a bundle with no nodes/edges at all counts as zero entities, not a crash", missingArrays.actual === 0, JSON.stringify(missingArrays));

process.exit(failures === 0 ? 0 : 1);
