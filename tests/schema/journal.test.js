#!/usr/bin/env node

/**
 * Unit tests for the Format Level 2 journal layer (docs/spec/journal.md):
 * the ordering helper, the JSONL sidecar parser, the snapshot↔journal
 * cross-check in validateBundle, forward compatibility, and the per-type zod
 * schemas. Complements the fixture/parity tests (which gate end-to-end verdicts).
 */

const fs = require("fs");
const path = require("path");
const { loadSchema, BUILD_DIR } = require("./load-schema");

const ROOT = path.join(__dirname, "..", "..");

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`PASS: ${name}`);
  } else {
    failures++;
    console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function main() {
  const schema = loadSchema();
  const {
    validateBundle,
    orderEvents,
    parseJournalLines,
    crossCheckJournal,
    JournalEventSchema,
    KnownJournalEventSchema,
    NodeStatusChangedEventSchema,
    JOURNAL_EVENT_TYPES,
  } = schema;

  // --- orderEvents: by ts, tiebreak by id, tolerant of out-of-order input ---
  const unordered = [
    { id: "B", ts: "2026-01-02T00:00:00.000Z" },
    { id: "A", ts: "2026-01-01T00:00:00.000Z" },
    { id: "A2", ts: "2026-01-01T00:00:00.000Z" },
    { id: "A1", ts: "2026-01-01T00:00:00.000Z" },
  ];
  const ordered = orderEvents(unordered);
  check(
    "orderEvents sorts by ts then id",
    ordered.map((e) => e.id).join(",") === "A,A1,A2,B",
    ordered.map((e) => e.id).join(","),
  );
  check("orderEvents does not mutate input", unordered[0].id === "B");

  // --- parseJournalLines: one malformed line invalidates exactly that event ---
  const jsonl = [
    JSON.stringify({ id: "01A", ts: "2026-01-01T00:00:00.000Z", type: "node.created", node_id: "V-a", species: "view", title: "A" }),
    "{ this is not valid json",
    "",
    JSON.stringify({ id: "01B", ts: "2026-01-02T00:00:00.000Z", type: "node.deleted", node_id: "V-a" }),
  ].join("\n");
  const parsed = parseJournalLines(jsonl);
  check("parseJournalLines keeps the two well-formed events", parsed.events.length === 2, `got ${parsed.events.length}`);
  check("parseJournalLines reports exactly one malformed line", parsed.findings.length === 1, `got ${parsed.findings.length}`);
  check("parseJournalLines reports the offending line number (2)", parsed.findings[0]?.line === 2, `line ${parsed.findings[0]?.line}`);

  // A missing-envelope line is a shape finding on its own line, others still parse.
  const jsonl2 = [
    JSON.stringify({ ts: "2026-01-01T00:00:00.000Z", type: "node.created" }), // missing id
    JSON.stringify({ id: "01C", ts: "2026-01-01T00:00:00.000Z", type: "node.updated", node_id: "V-a", fields: ["title"] }),
  ].join("\n");
  const parsed2 = parseJournalLines(jsonl2);
  check("parseJournalLines flags missing-envelope line 1", parsed2.findings.length === 1 && parsed2.findings[0].line === 1);
  check("parseJournalLines still returns the valid event", parsed2.events.length === 1);

  // --- validateBundle: Level 2 fixture (snapshot + agreeing journal) passes ---
  const validL2 = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures/valid-level2.json"), "utf8"));
  const okResult = validateBundle(validL2);
  check("valid Level-2 fixture validates", okResult.valid, JSON.stringify(okResult.errors));

  // --- validateBundle: status disagreement is an error naming both sides ---
  const mismatch = JSON.parse(JSON.stringify(validL2));
  // Snapshot says V-home is "live"; make the journal's last transition end at "development".
  mismatch.journal = mismatch.journal.filter(
    (e) => !(e.type === "node.status_changed" && e.node_id === "V-home" && e.to === "live"),
  );
  const mismatchResult = validateBundle(mismatch);
  const statusErr = mismatchResult.errors.find((e) => e.rule === "journal-status-mismatch");
  check("status disagreement produces journal-status-mismatch error", Boolean(statusErr), JSON.stringify(mismatchResult.errors));
  check(
    "status-mismatch message names both sides (development + live)",
    Boolean(statusErr && statusErr.message.includes("development") && statusErr.message.includes("live")),
    statusErr?.message,
  );

  // --- cross-check: missing node.created is flagged ---
  const missingCreated = JSON.parse(JSON.stringify(validL2));
  missingCreated.journal = missingCreated.journal.filter((e) => !(e.type === "node.created" && e.node_id === "V-settings"));
  const mcFindings = crossCheckJournal(missingCreated);
  check(
    "missing node.created flagged for V-settings",
    mcFindings.some((f) => f.rule === "journal-missing-node-created" && f.message.includes("V-settings")),
    JSON.stringify(mcFindings),
  );

  // --- cross-check: dangling node reference is flagged ---
  const dangling = JSON.parse(JSON.stringify(validL2));
  dangling.journal.push({ id: "01ZZ", ts: "2026-01-06T00:00:00.000Z", type: "node.status_changed", node_id: "V-ghost", from: "idea", to: "development" });
  const dFindings = crossCheckJournal(dangling);
  check(
    "dangling node reference flagged",
    dFindings.some((f) => f.rule === "journal-dangling-node-ref" && f.message.includes("V-ghost")),
    JSON.stringify(dFindings),
  );

  // --- cascade: node.deleted removes edges without an explicit edge.removed ---
  // A view is created, an edge to it added, then the view is deleted. No
  // edge.removed is emitted (the cascade covers it) and nothing dangles.
  const cascade = {
    schema_version: 2,
    project: { id: "p", title: "Cascade", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-02T00:00:00.000Z" },
    nodes: [{ id: "V-keep", project_id: "p", species: "view", title: "Keep", status: "live", platforms: ["web"] }],
    edges: [],
    journal: [
      { id: "01C1", ts: "2026-01-01T00:00:00.000Z", type: "node.created", node_id: "V-keep", species: "view", title: "Keep" },
      { id: "01C2", ts: "2026-01-01T00:01:00.000Z", type: "node.created", node_id: "V-gone", species: "view", title: "Gone" },
      { id: "01C3", ts: "2026-01-01T00:02:00.000Z", type: "edge.added", edge_id: "e-V-keep-V-gone", source_id: "V-keep", target_id: "V-gone", edge_type: "composes" },
      { id: "01C4", ts: "2026-01-01T00:03:00.000Z", type: "node.status_changed", node_id: "V-keep", from: "idea", to: "live" },
      { id: "01C5", ts: "2026-01-01T00:04:00.000Z", type: "node.deleted", node_id: "V-gone" },
    ],
  };
  const cascadeFindings = crossCheckJournal(cascade);
  check("node.deleted cascade produces no cross-check findings", cascadeFindings.length === 0, JSON.stringify(cascadeFindings));

  // --- no journal / empty journal: cross-check is a no-op ---
  check("absent journal → no cross-check", crossCheckJournal({ nodes: [{ id: "V-a", status: "live" }], edges: [] }).length === 0);
  check("empty journal → no cross-check", crossCheckJournal({ journal: [], nodes: [{ id: "V-a", status: "live" }], edges: [] }).length === 0);

  // --- forward compatibility: unknown type + unknown fields survive the parse ---
  const unknownEvent = { id: "01F", ts: "2026-01-01T00:00:00.000Z", type: "some.future.event", weird_field: { nested: true }, v: 3 };
  const parseFwd = JournalEventSchema.safeParse(unknownEvent);
  check("JournalEventSchema accepts an unknown type", parseFwd.success, JSON.stringify(parseFwd.error?.issues));
  check(
    "JournalEventSchema preserves unknown fields",
    Boolean(parseFwd.success && parseFwd.data.weird_field && parseFwd.data.v === 3),
  );

  // A whole bundle with an unknown-type event still validates and round-trips it.
  const fwdBundle = JSON.parse(JSON.stringify(validL2));
  fwdBundle.journal.push({ id: "01FUT", ts: "2026-01-07T00:00:00.000Z", type: "some.future.event", custom: 1 });
  check("bundle with an unknown-type event still validates", validateBundle(fwdBundle).valid);

  // --- per-type schema modeling ---
  check("JOURNAL_EVENT_TYPES has the 12 v1 types", JOURNAL_EVENT_TYPES.length === 12, `got ${JOURNAL_EVENT_TYPES.length}`);
  const goodStatus = NodeStatusChangedEventSchema.safeParse({
    id: "01S", ts: "2026-01-01T00:00:00.000Z", type: "node.status_changed", node_id: "V-a", from: "idea", to: "live",
  });
  check("NodeStatusChangedEventSchema accepts a valid event", goodStatus.success, JSON.stringify(goodStatus.error?.issues));
  const badStatus = NodeStatusChangedEventSchema.safeParse({
    id: "01S", ts: "2026-01-01T00:00:00.000Z", type: "node.status_changed", node_id: "V-a", from: "idea", to: "not-a-status",
  });
  check("NodeStatusChangedEventSchema rejects an invalid status", !badStatus.success);
  const knownRejectsUnknown = KnownJournalEventSchema.safeParse({ id: "01U", ts: "2026-01-01T00:00:00.000Z", type: "some.future.event" });
  check("KnownJournalEventSchema (strict) rejects an unknown type", !knownRejectsUnknown.success);

  fs.rmSync(BUILD_DIR, { recursive: true, force: true });

  if (failures > 0) {
    console.log(`\n${failures} journal test(s) failed.`);
    process.exit(1);
  }
  console.log(`\nAll journal tests passed.`);
}

main();
