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
  WEIGHING_WRITE_LIMITS,
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
check("an entry that is not an object is an error", typeof parseWeighingEventInputs({ events: [null] }).error === "string");
check("the parser is the HTTP shape only: it does not judge a value (that is the planner's, so every writer gets it)", Array.isArray(parseWeighingEventInputs({ events: [assess({ level: 1.5, confidence: 7, subject: "" })] })));
for (const stamped of ["scorer", "basis", "ts"]) {
  check(`a caller-supplied ${stamped} is refused — the server stamps it`, /stamped by the server/.test(parseWeighingEventInputs({ events: [assess({ [stamped]: stamped === "ts" ? "2026-01-01T00:00:00.000Z" : { kind: "human", id: "me" } })] }).error ?? ""));
}
check("a set must be an object", typeof parseWeighingEventInputs({ events: [{ type: "weighing.set.saved", set: "nope" }] }).error === "string");

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

// on_behalf_of (D14)
const behalf = planWeighingEvents(undefined, [NODE], [assess()], ctx({ scorerKind: "agent", actor: "arkaik-agent", onBehalfOf: "42" }));
check("a writer that knows whose hands these are stamps scorer.on_behalf_of, on the row and on the event", behalf.ok === true && behalf.assessments[0].scorer.on_behalf_of === "42" && behalf.events[0].scorer.on_behalf_of === "42" && KnownJournalEventSchema.safeParse(behalf.events[0]).success);
check("…and stamps nothing when it does not know", !("on_behalf_of" in plan.assessments[0].scorer));
check("an email is refused: sidecars are committed to repos", planWeighingEvents(undefined, [NODE], [assess()], ctx({ onBehalfOf: "me@example.com" })).refusals?.[0].reason === "invalid_on_behalf_of");
const behalfOutcome = (value) => planWeighingEvents(undefined, [NODE], [assess()], ctx({ onBehalfOf: value })).ok === true;
check(
  "a git author name is accepted: spaces, accents, a hyphen, an apostrophe, non-Latin script",
  ["Alexis Bohns", "Anne-Claire Dupré", "José O'Brien", "李 雷", "alexisbohns", "u_1842"].every(behalfOutcome),
);
check(
  "anything with an @ is refused, whatever its shape",
  ["me@example.com", "Alexis <me@example.com>", "me @ example", "@alexis", "a@b"].every((value) => !behalfOutcome(value)),
);
check("a look-alike @ is refused too: the full-width and the small commercial at", ["me＠example.com", "me﹫example.com", "＠alexis"].every((value) => !behalfOutcome(value)));
check("an invisible format character is refused (a zero-width space, a bidi override, a byte-order mark)", ["Alexis\u200bBohns", "\u202eAlexis", "Alexis\u202eBohns", "\ufeffAlexis", "\u2066Alexis"].every((value) => !behalfOutcome(value)));
check("…but the zero-width joiner and non-joiner are names: a ZWJ emoji sequence, Persian and Indic spellings", ["Alex 👩\u200d💻", "می\u200cخواهم", "क्\u200dष", "Anne\u200dClaire"].every(behalfOutcome));
check("an empty, blank, control-character or over-long value is refused", ["", "   ", "Alexis\nBohns", "a\u0000b", "x".repeat(129)].every((value) => !behalfOutcome(value)) && behalfOutcome("x".repeat(128)));

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

// The planner is the ONE gate: a writer that never saw the HTTP parser (the browser provider, MCP) gets the same refusals, and never a throw.
const reasonOf = (inputs) => planWeighingEvents(undefined, [NODE], inputs, ctx()).refusals?.[0]?.reason;
check("a fractional level is refused, not thrown on", reasonOf([assess({ level: 1.5 })]) === "invalid_entry");
check("a string level is refused", reasonOf([assess({ level: "2" })]) === "invalid_entry");
check("a confidence of 4 is refused", reasonOf([assess({ confidence: 4 })]) === "invalid_entry");
check("a confidence of 7 is refused", reasonOf([assess({ confidence: 7 })]) === "invalid_entry");
check("a fractional confidence is refused", reasonOf([assess({ confidence: 1.5 })]) === "invalid_entry");
check("a missing confidence is refused", reasonOf([assess({ confidence: undefined })]) === "invalid_entry");
check("an empty subject is refused", reasonOf([assess({ subject: "" })]) === "invalid_entry");
check("an empty criterion is refused", reasonOf([assess({ criterion: "" })]) === "invalid_entry");
check("a non-string subject is refused", reasonOf([assess({ subject: 7 })]) === "invalid_entry");
check("an empty ref is refused", reasonOf([assess({ refs: ["ok", ""] })]) === "invalid_entry");
check("refs that are not an array are refused", reasonOf([assess({ refs: "AC-a" })]) === "invalid_entry");
check("a non-string run is refused", reasonOf([assess({ run: 5 })]) === "invalid_entry");
check("an entry that is not an object is refused", reasonOf([null]) === "invalid_entry");
check("an unknown type is refused", reasonOf([{ type: "quality.finding.resolved" }]) === "invalid_entry");
check("a set whose criteria are not an array is refused", planWeighingEvents(undefined, [NODE], [{ type: "weighing.set.saved", set: { id: "positioning", version: "1.0.0", subject: "acceptance", role: "positioning", extends: "value-contribution@1", criteria: "connects" } }], ctx()).refusals?.[0].reason === "invalid_set");
check("a set with no version is refused (it would be saved and then silently ignored)", planWeighingEvents(undefined, [NODE], [{ type: "weighing.set.saved", set: { id: "positioning", subject: "acceptance", role: "positioning", extends: "value-contribution@1", criteria: [] } }], ctx()).refusals?.[0].reason === "invalid_set");
check("a set that is not an object is refused", planWeighingEvents(undefined, [NODE], [{ type: "weighing.set.saved", set: null }], ctx()).refusals?.[0].reason === "invalid_set");
check("one structural refusal still refuses the whole batch, naming its index", eq(planWeighingEvents(undefined, [NODE], [assess(), assess({ confidence: 7 })], ctx()).refusals?.map((r) => r.index), [1]));

// Caps: the scale of what one writer can put in a journal row.
check("evidence of exactly 2000 characters is accepted", planWeighingEvents(undefined, [NODE], [assess({ evidence: "x".repeat(2000) })], ctx()).ok === true);
check("evidence of 2001 characters is refused", reasonOf([assess({ evidence: "x".repeat(2001) })]) === "invalid_entry");
check("50 refs are accepted", planWeighingEvents(undefined, [NODE], [assess({ refs: Array.from({ length: 50 }, (_, i) => `R-${i}`) })], ctx()).ok === true);
check("51 refs are refused", reasonOf([assess({ refs: Array.from({ length: 51 }, (_, i) => `R-${i}`) })]) === "invalid_entry");
check("a ref of 200 characters is accepted", planWeighingEvents(undefined, [NODE], [assess({ refs: ["r".repeat(200)] })], ctx()).ok === true);
check("a ref of 201 characters is refused", reasonOf([assess({ refs: ["r".repeat(201)] })]) === "invalid_entry");
for (const field of ["model", "run", "commit"]) {
  check(`${field} of exactly 200 characters is accepted`, planWeighingEvents(undefined, [NODE], [assess({ [field]: "m".repeat(200) })], ctx({ scorerKind: "agent" })).ok === true);
  check(`${field} of 201 characters is refused`, reasonOf([assess({ [field]: "m".repeat(201) })]) === "invalid_entry");
}
check("the caps are named: evidence, refs, ref and the model/run/commit fields", eq(WEIGHING_WRITE_LIMITS, { evidenceChars: 2000, refs: 50, refChars: 200, fieldChars: 200 }));
check("evidence that is blank after trimming is refused", ["   ", "\n\t "].every((evidence) => reasonOf([assess({ evidence })]) === "invalid_entry") && planWeighingEvents(undefined, [NODE], [assess({ evidence: " fine " })], ctx()).ok === true);

// The model is the agent's own account of itself: a human session has none to claim.
check("a human's scorer drops a supplied model", !("model" in planWeighingEvents(undefined, [NODE], [assess({ model: "claude" })], ctx()).assessments[0].scorer));
check("an agent's scorer keeps its model", planWeighingEvents(undefined, [NODE], [assess({ model: "claude" })], ctx({ scorerKind: "agent" })).assessments[0].scorer.model === "claude");

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
const setWith = (criteria) => planWeighingEvents(undefined, [NODE], [{ type: "weighing.set.saved", set: positioning({ criteria }) }], ctx());
check("anchors keyed by levels on the scale, with words, are accepted", setWith([{ id: "connects", anchors: { "3": "a", "0": "b", "-3": "c" } }]).ok === true);
check(
  "anchors that are not an object of words are refused, not fixed",
  [["not an object"], ["a", "b"], null, 5].every((anchors) => setWith([{ id: "connects", anchors }]).refusals?.[0].reason === "invalid_set"),
);
check("an anchor on a level off the scale, or not a level, or not written canonically, is refused", [{ "4": "x" }, { "-4": "x" }, { "1.5": "x" }, { three: "x" }, { "03": "x" }, { "-0": "x" }, { "+3": "x" }, { "00": "x" }].every((anchors) => setWith([{ id: "connects", anchors }]).refusals?.[0].reason === "invalid_set"));
check("an anchor whose words are empty or not a string is refused", [{ "3": "" }, { "3": "  " }, { "3": 3 }, { "3": null }].every((anchors) => setWith([{ id: "connects", anchors }]).refusals?.[0].reason === "invalid_set"));
check("a criterion that is not an object is refused", [null, 5, "connects"].every((entry) => setWith([entry]).refusals?.[0].reason === "invalid_set"));
check("a weight that is not a number is refused as given", ["3", true, NaN, Infinity].every((weight) => setWith([{ id: "connects", weight }]).refusals?.[0].reason === "invalid_set"));
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
check("an on_behalf_of stamp survives the fold: the row a reader sees names whom the agent acts for (D14)", foldWeighingEvents(undefined, behalf.events).assessments[0].scorer.on_behalf_of === "42");
check("…and a writer that stamped nothing leaves the folded scorer without the key", !("on_behalf_of" in fromNothing.assessments[0].scorer));

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
// A `rule` row is computed on read and never stored (D3): an event claiming to be one is not folded, whoever appended it.
const ruleEvent = { ...ev(plan)[0], id: "01RULE", scorer: { kind: "rule", id: "seed" } };
check("a rule-scored event is skipped by the fold", foldWeighingEvents(section, [ruleEvent]).assessments.length === 0);
check("…even beside a real one", foldWeighingEvents(section, [ruleEvent, ...ev(plan)]).assessments.length === 1);

// Latest wins by TIME, not by arrival: a stored row newer than the event survives it.
const stamp = (kind, ts, level) => ({ matrix: "value", subject: "AC-a", criterion: "connects", level, scorer: { kind, id: "x" }, confidence: 1, ts });
const stored = { sets: [], matrices: [], assessments: [stamp("agent", "2026-11-16T00:00:00.000Z", 3)] };
const olderEvent = { ...ev(plan)[0], id: "01OLD", scorer: { kind: "agent", id: "arkaik-mcp" }, level: 1, ts: "2026-11-15T10:00:00.000Z" };
check("a stored row newer than the folded event survives it", foldWeighingEvents(stored, [olderEvent]).assessments[0].level === 3);
check("an event newer than the stored row replaces it", foldWeighingEvents(stored, [{ ...olderEvent, ts: "2026-11-17T00:00:00.000Z" }]).assessments[0].level === 1);
check("on equal times the later event wins", foldWeighingEvents(stored, [{ ...olderEvent, ts: "2026-11-16T00:00:00.000Z" }]).assessments[0].level === 1);
check("an unparseable stored time counts as oldest: the event replaces it", foldWeighingEvents({ ...stored, assessments: [{ ...stored.assessments[0], ts: "yesterday" }] }, [olderEvent]).assessments[0].level === 1);
check("two events fold by their time, whatever order the journal holds them", foldWeighingEvents(section, [{ ...olderEvent, id: "01B", ts: "2026-11-15T12:00:00.000Z", level: 2 }, { ...olderEvent, id: "01A", ts: "2026-11-15T11:00:00.000Z", level: 0 }]).assessments[0].level === 2);

// A set goes by time too: a replayed older event does not undo a newer one folded before it.
const replayed = foldWeighingEvents(section, [...ev(activated), ...ev(saved)]);
check("an older set event replayed after a newer one does not overwrite it", replayed.sets.length === 1 && replayed.sets[0].status === "active");
check("…in either order the newest set event stands", foldWeighingEvents(section, [...ev(saved), ...ev(activated)]).sets[0].status === "active");
check("a stored set has no time, so an event replaces it whatever its ts", foldWeighingEvents({ ...section, sets: [positioning({ status: "active", title: "stored" })] }, ev(saved)).sets[0].status === "draft");
check("on equal times the later set event wins", foldWeighingEvents(section, [...ev(saved), { ...ev(activated)[0], ts: ev(saved)[0].ts }]).sets[0].status === "active");
check("an unparseable set event time counts as oldest: it does not overwrite a dated one", foldWeighingEvents(section, [...ev(activated), { ...ev(saved)[0], ts: "yesterday" }]).sets[0].status === "active");

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
