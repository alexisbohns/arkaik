#!/usr/bin/env node

/**
 * Direct unit tests for `packages/cli/src/lib/bootstrap/journal-merge.ts` —
 * the journal algebra `merge.ts` uses: event key construction, order-
 * sensitivity, and the de-duplicating merge of a base journal with freshly-
 * derived events.
 *
 * Loaded via ./load-bootstrap-lib.js (transpiled to CommonJS so this also
 * works under CI's Node 20 — see that file's comment), same as
 * bootstrap-era-window.test.js and bootstrap-body-budget.test.js — no CLI
 * build needed. Extracted specifically
 * because it had zero direct coverage before this: every behavior here was
 * previously reachable only through a full CLI-spawn-plus-fixture round trip
 * in tests/cli/bootstrap-merge.test.js, which is exactly how a coordinator
 * review round found `canonicalJson` treating an explicitly-`undefined`
 * property differently from an absent one — a two-line direct test here,
 * versus a four-step fixture with a hand-edited bundle through the CLI.
 */
const { loadBootstrapModule } = require("./load-bootstrap-lib");

const { sortEvents, canonicalJson, isOrderSensitive, eventKey, mergeJournal } = loadBootstrapModule("journal-merge");

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`PASS: ${name}`);
  } else {
    failures++;
    console.log(`FAIL: ${name}${detail ? `\n${detail}` : ""}`);
  }
}

// --- sortEvents: ts then id ---
{
  const events = [
    { id: "b", ts: "2026-01-02T00:00:00.000Z" },
    { id: "a", ts: "2026-01-01T00:00:00.000Z" },
    { id: "a", ts: "2026-01-02T00:00:00.000Z" },
  ];
  const sorted = sortEvents(events);
  check("sorts by ts first", sorted[0].ts === "2026-01-01T00:00:00.000Z", JSON.stringify(sorted));
  check("ties-break by id ascending", sorted[1].id === "a" && sorted[2].id === "b", JSON.stringify(sorted));
  check("does not mutate the input array", events[0].id === "b", JSON.stringify(events));
}
{
  // Missing ts/id sort as empty string rather than throwing.
  const sorted = sortEvents([{ id: "x" }, { ts: "2026-01-01T00:00:00.000Z", id: "y" }]);
  check("missing ts sorts first (as empty string)", sorted[0].id === "x", JSON.stringify(sorted));
}

// --- canonicalJson: key-order independence ---
{
  const a = canonicalJson({ x: 1, y: 2 });
  const b = canonicalJson({ y: 2, x: 1 });
  check("key order does not affect canonicalJson output", a === b, `${a} vs ${b}`);
}
{
  const a = canonicalJson([{ x: 1, y: 2 }, { z: 3 }]);
  const b = canonicalJson([{ y: 2, x: 1 }, { z: 3 }]);
  check("key-order independence holds recursively inside arrays", a === b, `${a} vs ${b}`);
}
{
  // ARRAY order (not object key order) is semantically significant and must
  // still distinguish.
  const a = canonicalJson([1, 2]);
  const b = canonicalJson([2, 1]);
  check("array element order still distinguishes (unlike object keys)", a !== b, `${a} vs ${b}`);
}

// --- canonicalJson: the actual bug found and fixed in round 3 ---
{
  // An object with an explicitly-undefined property must canonicalize
  // IDENTICALLY to the same object without that property at all — matching
  // JSON.stringify's own behavior (which drops an undefined-valued key
  // entirely). The original version of this function emitted the literal
  // token `undefined` for such a key, so an event round-tripped through
  // JSON.stringify (which drops the key) could never compare equal to
  // itself in object form (which still carried the key, as `undefined`).
  const withUndefined = canonicalJson({ a: 1, b: undefined });
  const without = canonicalJson({ a: 1 });
  check(
    "an explicitly-undefined property canonicalizes identically to an absent one (matches JSON.stringify)",
    withUndefined === without,
    `${withUndefined} vs ${without}`,
  );
  check(
    "canonicalJson never emits the literal string 'undefined'",
    !withUndefined.includes("undefined"),
    withUndefined,
  );
}
{
  // The concrete shape this bites in practice: a freshly-minted event object
  // built with an optional field spread in as `undefined` (e.g.
  // `{ ...payload, platform: someOptionalValue }` where the value is
  // `undefined`) must canonicalize the same as its own JSON.stringify ->
  // JSON.parse round trip (which is what a base event read back from disk
  // actually looks like).
  const fresh = { type: "node.created", node_id: "V-home", platform: undefined };
  const roundTripped = JSON.parse(JSON.stringify(fresh));
  check(
    "a freshly-minted event with an undefined field equals its own JSON.stringify round-trip",
    canonicalJson(fresh) === canonicalJson(roundTripped),
    `${canonicalJson(fresh)} vs ${canonicalJson(roundTripped)}`,
  );
}
{
  // Array holes / explicit `undefined` elements render as `null`, matching
  // JSON.stringify's own array behavior (JSON.stringify([undefined]) === "[null]").
  const withHole = canonicalJson([1, undefined, 3]);
  check("an undefined array element canonicalizes as null (matches JSON.stringify)", withHole === "[1,null,3]", withHole);
}

// --- isOrderSensitive ---
{
  check(
    "decision.status_changed is always order-sensitive",
    isOrderSensitive({ type: "decision.status_changed", node_id: "DEC-x" }) === true,
  );
  check(
    "node.status_changed with no platform is order-sensitive",
    isOrderSensitive({ type: "node.status_changed", node_id: "V-x" }) === true,
  );
  check(
    "node.status_changed WITH a platform is NOT order-sensitive (crossCheckJournal doesn't cross-check it)",
    isOrderSensitive({ type: "node.status_changed", node_id: "V-x", platform: "ios" }) === false,
  );
  check("node.created is not order-sensitive", isOrderSensitive({ type: "node.created", node_id: "V-x" }) === false);
  check("deliverable.shipped is not order-sensitive", isOrderSensitive({ type: "deliverable.shipped" }) === false);
}

// --- eventKey: distinguishes on every identifying field, non-string values are key-order-independent ---
{
  const ts = "2026-01-05T00:00:00.000Z";
  const a = eventKey({ type: "node.status_changed", node_id: "V-home", from: "idea", to: "backlog" }, ts);
  const b = eventKey({ type: "node.status_changed", node_id: "V-home", from: "backlog", to: "live" }, ts);
  check("different from/to at the same ts produce different keys", a !== b, `${a} vs ${b}`);
}
{
  const ts = "2026-01-05T00:00:00.000Z";
  const a = eventKey({ type: "release.tagged", version: "1.0.0", platform: "ios" }, ts);
  const b = eventKey({ type: "release.tagged", version: "1.0.0", platform: "android" }, ts);
  check("release.tagged keys on platform", a !== b, `${a} vs ${b}`);
}
{
  // node.updated's `from`/`to` are typed `unknown` in the schema and can
  // legally be objects — the key must not depend on incidental key order in
  // those objects (round 3: `stringify` used to route through raw
  // JSON.stringify, which is key-order DEPENDENT).
  const ts = "2026-01-05T00:00:00.000Z";
  const a = eventKey({ type: "node.updated", node_id: "V-home", from: { x: 1, y: 2 } }, ts);
  const b = eventKey({ type: "node.updated", node_id: "V-home", from: { y: 2, x: 1 } }, ts);
  check("object-valued from/to fields are key-order-independent", a === b, `${a} vs ${b}`);
}
{
  // idea.proposed/request.filed have no node_id/deliverable_id/version at
  // all — title is the only thing left to distinguish two of them sharing a ts.
  const ts = "2026-01-05T00:00:00.000Z";
  const a = eventKey({ type: "idea.proposed", title: "Dark mode" }, ts);
  const b = eventKey({ type: "idea.proposed", title: "Bulk export" }, ts);
  check("idea.proposed keys on title when node_id is absent", a !== b, `${a} vs ${b}`);
}

// --- mergeJournal: dedup, base-wins, conflict detection ---
{
  const base = [{ id: "01A", ts: "2026-01-01T00:00:00.000Z", type: "node.created", node_id: "V-x" }];
  const fresh = [{ id: "01A", ts: "2026-01-01T00:00:00.000Z", type: "node.created", node_id: "V-x" }];
  const { journal, added, conflicts } = mergeJournal(base, fresh);
  check("identical re-derivation is a no-op (no growth, no conflict)", journal.length === 1 && added === 0 && conflicts.length === 0, JSON.stringify({ journal, added, conflicts }));
}
{
  const base = [{ id: "01A", ts: "2026-01-01T00:00:00.000Z", type: "deliverable.shipped", summary: "Original" }];
  const fresh = [{ id: "01A", ts: "2026-01-01T00:00:00.000Z", type: "deliverable.shipped", summary: "Corrected" }];
  const { journal, added, conflicts } = mergeJournal(base, fresh);
  check("base wins on a genuine content divergence", journal[0].summary === "Original", JSON.stringify(journal));
  check("the divergence is reported as a conflict", conflicts.length === 1 && conflicts[0].id === "01A", JSON.stringify(conflicts));
  check("added stays 0 (base's copy already occupies the id)", added === 0, String(added));
}
{
  // The exact false-positive this whole extraction exists to prevent: an
  // event object with an undefined-valued key must NOT be reported as
  // diverging from its own JSON.stringify round-trip (which lacks the key).
  const base = [JSON.parse(JSON.stringify({ id: "01A", ts: "2026-01-01T00:00:00.000Z", type: "node.created", node_id: "V-x", platform: undefined }))];
  const fresh = [{ id: "01A", ts: "2026-01-01T00:00:00.000Z", type: "node.created", node_id: "V-x", platform: undefined }];
  const { conflicts } = mergeJournal(base, fresh);
  check("an undefined-valued key does not cause a false conflict against its own round-trip", conflicts.length === 0, JSON.stringify(conflicts));
}
{
  const base = [];
  const fresh = [
    { id: "01A", ts: "2026-01-02T00:00:00.000Z", type: "node.created", node_id: "V-b" },
    { id: "01B", ts: "2026-01-01T00:00:00.000Z", type: "node.created", node_id: "V-a" },
  ];
  const { journal, added } = mergeJournal(base, fresh);
  check("brand-new events are all added", added === 2, String(added));
  check("output is ts-ordered regardless of input order", journal[0].node_id === "V-a" && journal[1].node_id === "V-b", JSON.stringify(journal));
}
{
  // Events with no id (or a non-string id) are silently skipped, not fatal —
  // callers (merge.ts) never produce these, but the function shouldn't crash.
  const { journal, added } = mergeJournal([], [{ ts: "2026-01-01T00:00:00.000Z", type: "node.created" }, { id: 5, ts: "x" }]);
  check("events with no usable id are skipped, not crashed on", journal.length === 0 && added === 0, JSON.stringify({ journal, added }));
}

process.exit(failures === 0 ? 0 : 1);
