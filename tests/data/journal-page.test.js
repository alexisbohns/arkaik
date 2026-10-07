#!/usr/bin/env node

/**
 * The History page's paging contract (packages/schema/src/journal-page.ts,
 * issue #429): families, the (ts, id) cursor, and `pageJournal`.
 *
 * The property that matters is parity with what the page showed before it
 * paginated: `orderEvents(journal).reverse()` filtered by family prefix. So
 * every walk below is checked against exactly that expression, over a journal
 * stored out of order with a backdated append, a timestamp tie broken by id,
 * an event with no timestamp and one of a type no family claims.
 */

const fs = require("fs");
const path = require("path");
const { loadSchema, BUILD_DIR: SCHEMA_BUILD_DIR } = require("../schema/load-schema");

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`PASS: ${name}`);
  else {
    failures++;
    console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const schema = loadSchema();
const {
  orderEvents,
  JOURNAL_FAMILIES,
  isJournalFamilyId,
  pageJournal,
  formatJournalCursor,
  parseJournalCursor,
  journalCursorOf,
} = schema;

const ev = (id, ts, type) => ({ id, ts, type, actor: "test" });
// Stored in arrival order, which is NOT time order: E is a backdated append
// (a merged PR's deliverable, minted with the merge time), C and D share a
// timestamp, G has no timestamp at all, H is a type no family claims.
const JOURNAL = [
  ev("01A", "2026-01-01T00:00:00Z", "node.created"),
  ev("01B", "2026-01-02T00:00:00Z", "edge.added"),
  ev("01D", "2026-01-03T00:00:00Z", "node.updated"),
  ev("01C", "2026-01-03T00:00:00Z", "idea.proposed"),
  ev("01F", "2026-01-05T00:00:00Z", "release.tagged"),
  ev("01E", "2026-01-01T12:00:00Z", "deliverable.shipped"),
  { id: "01G", type: "node.deleted", actor: "test" },
  ev("01H", "2026-01-06T00:00:00Z", "quality.audit.completed"),
  ev("01I", "2026-01-07T00:00:00Z", "ref.added"),
];

/** What the History page rendered before it paged. */
function before(families) {
  const ordered = orderEvents(JOURNAL).reverse();
  if (!families) return ordered;
  const prefixes = families.flatMap((f) => JOURNAL_FAMILIES[f]);
  return ordered.filter((e) => prefixes.some((p) => e.type.startsWith(p)));
}

/** Walk every page with `limit`, following `next`, and return the ids seen. */
function walk(limit, families) {
  const seen = [];
  let cursor = null;
  for (let guard = 0; guard < 100; guard++) {
    const page = pageJournal(JOURNAL, { before: cursor, limit, families });
    seen.push(...page.events.map((e) => e.id));
    if (page.next === null) return seen;
    cursor = parseJournalCursor(page.next);
    if (cursor === null) throw new Error(`unparseable next cursor ${page.next}`);
  }
  throw new Error("walk did not terminate");
}

const ids = (events) => events.map((e) => e.id).join(",");

// --- Families ------------------------------------------------------------------
check(
  "the six families the History chips draw, by prefix",
  JSON.stringify(Object.keys(JOURNAL_FAMILIES)) ===
    JSON.stringify(["nodes", "edges", "decisions", "delivery", "intake", "refs"]),
  JSON.stringify(Object.keys(JOURNAL_FAMILIES)),
);
check("isJournalFamilyId knows them and nothing else", isJournalFamilyId("delivery") && !isJournalFamilyId("quality") && !isJournalFamilyId("toString"));

// --- Walks match the unpaged list ---------------------------------------------------
for (const limit of [1, 2, 3, 100]) {
  check(
    `walking pages of ${limit} gives the unpaged order exactly — backdated, tied and ts-less events included`,
    walk(limit, null).join(",") === ids(before(null)),
    `${walk(limit, null).join(",")} vs ${ids(before(null))}`,
  );
}
check(
  "the backdated append sits where it HAPPENED, not where it arrived (precondition)",
  ids(before(null)).indexOf("01E") > ids(before(null)).indexOf("01B"),
  ids(before(null)),
);
for (const families of [["nodes"], ["delivery"], ["intake", "edges"], ["refs"]]) {
  check(
    `a ${families.join("+")} walk matches the page's old prefix filter`,
    walk(2, families).join(",") === ids(before(families)) && before(families).length > 0,
    `${walk(2, families).join(",")} vs ${ids(before(families))}`,
  );
}
check(
  "a type no family claims appears only in the unfiltered walk",
  walk(2, null).includes("01H") &&
    Object.keys(JOURNAL_FAMILIES).every((f) => !walk(2, [f]).includes("01H")),
);
check(
  "an empty family list is no filter, like an absent one",
  walk(3, []).join(",") === ids(before(null)),
);

// --- The page shape ------------------------------------------------------------------
{
  const first = pageJournal(JOURNAL, { before: null, limit: 3, families: null });
  check("a full first page has a next cursor", first.events.length === 3 && first.next !== null);
  const last = pageJournal(JOURNAL, { before: null, limit: JOURNAL.length, families: null });
  check("a page that reaches the end has none", last.events.length === JOURNAL.length && last.next === null);
  check("an empty journal is one empty page", JSON.stringify(pageJournal([], { before: null, limit: 5 })) === '{"events":[],"next":null}');
}

// --- The cursor --------------------------------------------------------------------
{
  const cursor = { ts: "2026-01-03T00:00:00Z", id: "01C" };
  check("a cursor round-trips", JSON.stringify(parseJournalCursor(formatJournalCursor(cursor))) === JSON.stringify(cursor));
  check(
    "an event's cursor keys a missing ts as empty, the way orderEvents sorts it",
    JSON.stringify(journalCursorOf({ id: "01G", type: "node.deleted" })) === JSON.stringify({ ts: "", id: "01G" }),
  );
  for (const bad of ["", "nope", "[]", '["a"]', '["a",1]', '{"ts":"a","id":"b"}', JSON.stringify(["a", "b", "c"]), JSON.stringify(["x".repeat(300), "b"])]) {
    check(`a malformed cursor is refused: ${bad.slice(0, 24)}`, parseJournalCursor(bad) === null);
  }
}

fs.rmSync(SCHEMA_BUILD_DIR, { recursive: true, force: true });
if (failures > 0) {
  console.log(`\n${failures} journal-page test(s) failed.`);
  process.exit(1);
}
console.log("\nAll journal-page tests passed.");
