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

// --- planWeighingEvents: assessments -----------------------------------------

const plan = planWeighingEvents(undefined, [NODE, VIEW], [assess({ model: "claude" })], ctx({ scorerKind: "agent", actor: "arkaik-mcp" }));
check("a valid assessment plans one event", plan.ok === true && plan.events.length === 1 && plan.assessments.length === 1);
const row = plan.assessments[0];
check("the scorer is stamped by the caller, with the model", eq(row.scorer, { kind: "agent", id: "arkaik-mcp", model: "claude" }));
check("the matrix defaults to value", row.matrix === "value");
check("the basis is read off the graph: fingerprint and the set's full version", row.basis.fingerprint === acceptanceFingerprint(NODE) && row.basis.set_version === "1.0.0");
check("the row's ts is the event's ts", row.ts === NOW.toISOString() && plan.events[0].ts === NOW.toISOString());
check("the event carries the assessment flat, with the writer as actor", plan.events[0].type === "weighing.assessment.recorded" && plan.events[0].actor === "arkaik-mcp" && plan.events[0].level === 2 && plan.events[0].scorer.kind === "agent");
check("the event validates against its strict schema", KnownJournalEventSchema.safeParse(plan.events[0]).success);
check("a human session stamps a human", planWeighingEvents(undefined, [NODE], [assess()], ctx()).assessments[0].scorer.kind === "human");

// on_behalf_of (not yet run — D14)
const behalf = planWeighingEvents(undefined, [NODE], [assess()], ctx({ scorerKind: "agent", actor: "arkaik-agent", onBehalfOf: "42" }));
check("a writer that knows whose hands these are stamps scorer.on_behalf_of, on the row and on the event", behalf.ok === true && behalf.assessments[0].scorer.on_behalf_of === "42" && behalf.events[0].scorer.on_behalf_of === "42" && KnownJournalEventSchema.safeParse(behalf.events[0]).success);
check("…and stamps nothing when it does not know", !("on_behalf_of" in plan.assessments[0].scorer));
check("an email is refused: sidecars are committed to repos", planWeighingEvents(undefined, [NODE], [assess()], ctx({ onBehalfOf: "me@example.com" })).refusals?.[0].reason === "invalid_on_behalf_of");

const refused = (inputs) => planWeighingEvents(undefined, [NODE, VIEW], inputs, ctx());
check("an unknown subject is refused", refused([assess({ subject: "AC-nope" })]).refusals?.[0].reason === "unknown_subject");
check("a view is not a subject of the value matrix", refused([assess({ subject: "V-home" })]).refusals?.[0].reason === "unknown_subject");
check("an unknown criterion is refused", refused([assess({ criterion: "teleports" })]).refusals?.[0].reason === "unknown_criterion");
check("a level of 4 is refused", refused([assess({ level: 4 })]).refusals?.[0].reason === "level_out_of_range");
check("a level of −3 is accepted — the scale is signed", refused([assess({ level: -3 })]).ok === true);
check("a level of 0 is accepted — weighed and unrelated", refused([assess({ level: 0 })]).ok === true);
check("an unknown matrix is refused", refused([assess({ matrix: "nope" })]).refusals?.[0].reason === "unknown_matrix");
const batch = refused([assess(), assess({ criterion: "teleports" }), assess({ level: 9 })]);
check("one bad entry refuses the whole batch, each naming its index", batch.ok === false && eq(batch.refusals.map((r) => r.index), [1, 2]));

const retired = { sets: [], matrices: [], assessments: [] };
check("an empty section changes nothing about planning", planWeighingEvents(retired, [NODE], [assess()], ctx()).ok === true);

// --- planWeighingEvents: the positioning -------------------------------------

const positioning = (over = {}) => ({
  id: "positioning",
  version: "1.0.0",
  subject: "acceptance",
  scale: { min: -3, max: 3, anchors: {} },
  role: "positioning",
  status: "draft",
  extends: "value-contribution@1",
  criteria: [{ id: "reduces-anxiety", weight: 3, anchors: { 3: "removes a worry the user names", 0: "nothing to do with worry" } }],
  ...over,
});
const saved = planWeighingEvents(undefined, [NODE], [{ type: "weighing.set.saved", set: positioning() }], ctx());
check("a positioning plans one set.saved event", saved.ok === true && saved.events.length === 1 && saved.events[0].type === "weighing.set.saved" && saved.events[0].set.id === "positioning");
check("the saved set validates against its strict schema", KnownJournalEventSchema.safeParse(saved.events[0]).success);
check("a positioning with an unknown element is refused", planWeighingEvents(undefined, [NODE], [{ type: "weighing.set.saved", set: positioning({ criteria: [{ id: "teleports" }] }) }], ctx()).refusals?.[0].reason === "invalid_set");
check("a weight of 0 is refused", planWeighingEvents(undefined, [NODE], [{ type: "weighing.set.saved", set: positioning({ criteria: [{ id: "connects", weight: 0 }] }) }], ctx()).refusals?.[0].reason === "invalid_set");
check("only the positioning can be saved in this slice", planWeighingEvents(undefined, [NODE], [{ type: "weighing.set.saved", set: positioning({ id: "my-set", role: undefined }) }], ctx()).refusals?.[0].reason === "invalid_set");
check("a positioning extending nothing is refused", planWeighingEvents(undefined, [NODE], [{ type: "weighing.set.saved", set: positioning({ extends: "nope@1" }) }], ctx()).refusals?.[0].reason === "invalid_set");

// --- foldWeighingEvents ------------------------------------------------------

const ev = (planResult) => planResult.events;
const section = { sets: [], matrices: [], assessments: [] };
check("no weighing events: the SAME section comes back", foldWeighingEvents(section, [makeEvent("node.created", { node_id: "x", species: "view", title: "x" })]) === section);
check("no section and no events stays undefined", foldWeighingEvents(undefined, []) === undefined);
const fromNothing = foldWeighingEvents(undefined, ev(plan));
check("a project with only events still folds, from nothing", fromNothing.assessments.length === 1 && fromNothing.sets.length === 0 && fromNothing.matrices.length === 0);
check("the folded row is the planned row", same(fromNothing.assessments[0], row));

const later = planWeighingEvents(undefined, [NODE], [assess({ level: 3 })], ctx({ scorerKind: "agent", actor: "arkaik-mcp", now: new Date("2026-11-15T11:00:00.000Z") }));
const folded = foldWeighingEvents(fromNothing, ev(later));
check("a later event from the same scorer kind replaces the cell", folded.assessments.length === 1 && folded.assessments[0].level === 3);
const humanEvent = planWeighingEvents(undefined, [NODE], [assess({ level: -1 })], ctx({ now: new Date("2026-11-15T12:00:00.000Z") }));
const both = foldWeighingEvents(folded, ev(humanEvent));
check("a human's event lands beside the agent's, not over it", both.assessments.length === 2 && both.assessments.some((a) => a.scorer?.kind === "human" && a.level === -1) && both.assessments.some((a) => a.scorer?.kind === "agent" && a.level === 3));
check("the fold does not mutate the stored section", fromNothing.assessments.length === 1 && fromNothing.assessments[0].level === 2);
check("the fold keeps unknown top-level keys on the section", foldWeighingEvents({ ...section, extra: 7 }, ev(plan)).extra === 7);

const setFolded = foldWeighingEvents(section, ev(saved));
check("a set event adds the set", setFolded.sets.length === 1 && setFolded.sets[0].status === "draft");
const activated = planWeighingEvents(undefined, [NODE], [{ type: "weighing.set.saved", set: positioning({ status: "active" }) }], ctx({ now: new Date("2026-11-15T13:00:00.000Z") }));
const reFolded = foldWeighingEvents(setFolded, ev(activated));
check("a later set event replaces the set by id — latest wins", reFolded.sets.length === 1 && reFolded.sets[0].status === "active");
const junk = [
  { id: "01J", ts: "2026-11-15T10:00:00.000Z", type: "weighing.assessment.recorded", subject: "AC-a" },
  { id: "01K", ts: "2026-11-15T10:00:00.000Z", type: "weighing.set.saved", set: "nope" },
];
check("malformed events are skipped, never thrown on", foldWeighingEvents(section, junk).assessments.length === 0);

// --- It all validates --------------------------------------------------------

const bundle = {
  schema_version: 3,
  project: { id: "p", title: "P", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" },
  nodes: [{ id: "AC-a", project_id: "p", species: "acceptance", title: "Accept an invite", status: "live", platforms: ["web"], metadata: NODE.metadata }],
  edges: [],
};
check("a folded section raises no weighing warning", validateBundle({ ...bundle, weighing: both }).warnings.filter((w) => w.rule.startsWith("weighing")).length === 0);

fs.rmSync(BUILD_DIR, { recursive: true, force: true });
if (failures > 0) {
  console.log(`\n${failures} weighing-events test(s) failed.`);
  process.exit(1);
}
console.log("\nAll weighing-events tests passed.");
