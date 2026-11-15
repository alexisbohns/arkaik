/**
 * The weighing write path (docs/rfcs/weighing.md): the events, the fold that
 * reads them back, and the one planner every writer goes through — the hosted
 * route, the browser provider and the MCP tools. Pure and DB-free.
 *
 * Run: npm run test:weighing-events
 */

const assert = require("assert");
const fs = require("fs");
const { loadSchema, BUILD_DIR } = require("./load-schema");

const {
  acceptanceFingerprint,
  foldWeighingEvents,
  parseWeighingEventInputs,
  planWeighingEvents,
  WEIGHING_FOLD_TYPES,
  JOURNAL_EVENT_SCHEMAS,
  KnownJournalEventSchema,
  makeEvent,
  validateBundle,
} = loadSchema();

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`PASS: ${name}`);
  else {
    failures++;
    console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** Key-order-insensitive: an event round-trips through zod, which reorders. */
const same = (a, b) => {
  try {
    assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
    return true;
  } catch {
    return false;
  }
};

const NODE = { id: "AC-a", species: "acceptance", title: "Accept an invite", metadata: { gherkin: "Given a link", values: ["connects"] } };
const VIEW = { id: "V-home", species: "view", title: "Home" };
const NOW = new Date("2026-11-15T10:00:00.000Z");
const assess = (over = {}) => ({ type: "weighing.assessment.recorded", subject: "AC-a", criterion: "connects", level: 2, confidence: 2, evidence: "the title says so", ...over });
const ctx = (over = {}) => ({ actor: "arkaik-app", scorerKind: "human", now: NOW, ...over });

// --- The vocabulary ----------------------------------------------------------

check("two event types fold", eq([...WEIGHING_FOLD_TYPES], ["weighing.assessment.recorded", "weighing.set.saved"]));
check("both have a strict schema", Boolean(JOURNAL_EVENT_SCHEMAS["weighing.assessment.recorded"]) && Boolean(JOURNAL_EVENT_SCHEMAS["weighing.set.saved"]));

// --- parseWeighingEventInputs ------------------------------------------------

check("a minimal assessment parses", Array.isArray(parseWeighingEventInputs({ events: [assess()] })));
check("a body with no events array is an error", typeof parseWeighingEventInputs({}).error === "string");
check("an empty batch is an error", typeof parseWeighingEventInputs({ events: [] }).error === "string");
check("51 entries is an error", typeof parseWeighingEventInputs({ events: Array.from({ length: 51 }, () => assess()) }).error === "string");
check("an unknown type is an error", typeof parseWeighingEventInputs({ events: [{ type: "quality.finding.resolved", finding_id: "x" }] }).error === "string");
check("a fractional level is an error", typeof parseWeighingEventInputs({ events: [assess({ level: 1.5 })] }).error === "string");
check("a confidence of 4 is an error", typeof parseWeighingEventInputs({ events: [assess({ confidence: 4 })] }).error === "string");
check("an empty subject is an error", typeof parseWeighingEventInputs({ events: [assess({ subject: "" })] }).error === "string");
for (const stamped of ["scorer", "basis", "ts"]) {
  check(`a caller-supplied ${stamped} is refused — the server stamps it`, /stamped by the server/.test(parseWeighingEventInputs({ events: [assess({ [stamped]: stamped === "ts" ? "2026-01-01T00:00:00.000Z" : { kind: "human", id: "me" } })] }).error ?? ""));
}
check("refs must be non-empty strings", typeof parseWeighingEventInputs({ events: [assess({ refs: ["ok", ""] })] }).error === "string");
check("a set needs an id, version and subject", typeof parseWeighingEventInputs({ events: [{ type: "weighing.set.saved", set: { id: "positioning" } }] }).error === "string");

fs.rmSync(BUILD_DIR, { recursive: true, force: true });
if (failures > 0) {
  console.log(`\n${failures} weighing-events test(s) failed.`);
  process.exit(1);
}
console.log("\nAll weighing-events tests passed.");
