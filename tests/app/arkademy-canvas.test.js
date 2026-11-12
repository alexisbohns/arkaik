#!/usr/bin/env node

/**
 * Your own canvas's pure side (lib/arkademy/): the inspirations, the draft's
 * reducer, browser storage's parse and serialise, and the three exports.
 * DB-free, so it runs in CI's `build` job.
 *
 * Cases that the fictional fixture (tests/fixtures/arkademy/document.json)
 * does not hold are built in memory; the fixture itself is never edited.
 */

const fs = require("fs");
const path = require("path");
const { loadArkademy, cleanup } = require("./load-arkademy");

const ROOT = path.join(__dirname, "..", "..");
const FIXTURE = path.join(ROOT, "tests", "fixtures", "arkademy", "document.json");

const A = loadArkademy();

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`PASS: ${name}`);
  else {
    failures++;
    console.log(`FAIL: ${name}${detail === undefined ? "" : ` — ${detail}`}`);
  }
}
function same(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, `expected ${e}, got ${a}`);
}

const document = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
const validation = A.validateArkademyDocument(document, { now: new Date("2026-11-12T00:00:00Z") });
check("the fixture validates", validation.ok, JSON.stringify(validation.errors));
const tool = document.tools[0];
const index = A.indexArkademy(validation.document);

// --- inspirations -------------------------------------------------------------------
{
  const { inspirationCatalog, availableInspirations, answerFromLabel, companiesLine, INSPIRATIONS_SHOWN } = A;
  const catalog = inspirationCatalog(index);
  same("catalog: one list per question, canonical order", Object.keys(catalog), A.BMC_QUESTION_KEYS);
  same(
    "catalog: channels, most shared first, the unused stall absent",
    catalog.ch.map((item) => item.entity),
    ["word-of-mouth", "app-stores"],
  );
  same(
    "catalog: companies in example order, with their names",
    catalog.ch[0].companies,
    [
      { id: "crumb-and-co", name: "Crumb & Co" },
      { id: "tidewise", name: "Tidewise" },
      { id: "inkwell", name: "Inkwell" },
    ],
  );
  same("catalog: an entity's neutral label, never a company's wording", catalog.ch[1].label, "app stores");
  same(
    "catalog: a tie on companies sorts by label",
    catalog.ka.map((item) => item.label),
    [
      "baking overnight",
      "packing orders",
      "planning delivery rounds",
      "shipping small improvements",
      "sourcing flour",
      "taking orders",
      "updating the tables every season",
    ],
  );
  same("catalog: shared revenue first", catalog.rev.map((item) => item.entity), ["subscriptions"]);
  check("catalog: only entities of the question's kind", catalog.seg.every((item) => item.entity !== "word-of-mouth"));
  check(
    "catalog: an inspiration carries no note",
    Object.values(catalog).every((list) => list.every((item) => Object.keys(item).join() === "entity,label,companies")),
  );

  // Ties on label too sort by id; labels compare without case or accents.
  const tie = JSON.parse(JSON.stringify(validation.document));
  tie.entities.push({ id: "b-zz", kind: "partner", label: "Local millers" }, { id: "a-zz", kind: "partner", label: "local millers" });
  tie.uses.push(
    { tool: "business-model-canvas", company: "tidewise", question: "kp", entity: "b-zz", text: "the mill", order: 1 },
    { tool: "business-model-canvas", company: "inkwell", question: "kp", entity: "a-zz", text: "a mill", order: 1 },
  );
  same(
    "catalog: same count and same label (any case) fall back to the id",
    inspirationCatalog(A.indexArkademy(tie)).kp.map((item) => item.entity),
    ["cloud-host", "harbour-offices", "a-zz", "b-zz", "local-millers"],
  );

  same("show six before Show all", INSPIRATIONS_SHOWN, 6);

  const channels = catalog.ch;
  same(
    "available: drops an entity already added",
    availableInspirations(channels, [{ text: "telling friends", inspiration: { entity: "word-of-mouth" } }]).map((i) => i.entity),
    ["app-stores"],
  );
  same(
    "available: drops a label typed as an answer, any case",
    availableInspirations(channels, [{ text: "  App Stores " }]).map((i) => i.entity),
    ["word-of-mouth"],
  );
  same("available: nothing to drop", availableInspirations(channels, []).length, 2);

  same("answerFromLabel: sentence case lowered", answerFromLabel("A product map that stays true"), "a product map that stays true");
  same("answerFromLabel: a name with an inner capital kept", answerFromLabel("GitHub sponsors"), "GitHub sponsors");
  same("answerFromLabel: an acronym kept", answerFromLabel("AWS credits"), "AWS credits");
  same("answerFromLabel: already lower", answerFromLabel("word of mouth"), "word of mouth");
  same("answerFromLabel: one capital letter alone is lowered", answerFromLabel("X"), "x");
  same("answerFromLabel: accents", answerFromLabel("École partners"), "école partners");
  same("answerFromLabel: trimmed", answerFromLabel("  Hosting "), "hosting");

  same("companiesLine: one", companiesLine([{ name: "Crumb & Co" }]), "Crumb & Co");
  same("companiesLine: two", companiesLine([{ name: "A" }, { name: "B" }]), "A and B");
  same("companiesLine: three", companiesLine([{ name: "A" }, { name: "B" }, { name: "C" }]), "A, B and C");
  same(
    "companiesLine: four or more",
    companiesLine([{ name: "Notion" }, { name: "Figma" }, { name: "C" }, { name: "D" }]),
    "Notion, Figma and 2 more",
  );
}

// --- the draft and its reducer -------------------------------------------------------
{
  const { draftReducer, emptyDraft, draftState, draftIsEmpty, firstUnfinishedStep, questionStatus } = A;
  const { yoursHref, nextAnswerId, NAME_MAX_LENGTH } = A;
  const run = (actions, start = emptyDraft()) => actions.reduce((draft, action) => draftReducer(draft, action), start);

  same("empty draft", emptyDraft(), { name: "", answers: [], open: [], updatedAt: "" });
  check("empty draft is empty", draftIsEmpty(emptyDraft()));

  const one = run([{ type: "add", question: "seg", text: "  bakers who open at dawn.  " }]);
  same("add: trimmed, sequential id", one.answers, [{ id: "a1", question: "seg", text: "bakers who open at dawn." }]);
  const blank = run([{ type: "add", question: "seg", text: "   " }]);
  same("add: blank refused", blank.answers.length, 0);
  same("add: one line", run([{ type: "add", question: "vp", text: "fresh\nbread\r\nat\tdawn" }]).answers[0].text, "fresh bread at dawn");
  same("add: cut to 140", run([{ type: "add", question: "vp", text: "x".repeat(200) }]).answers[0].text.length, 140);
  const emoji = "😀".repeat(80); // 160 UTF-16 units
  check("add: a cut never splits a surrogate pair", !/[\uD800-\uDBFF]$/.test(run([{ type: "add", question: "vp", text: emoji }]).answers[0].text));
  same(
    "add: a duplicate (any case) refused",
    run([
      { type: "add", question: "seg", text: "Bakers" },
      { type: "add", question: "seg", text: " bakers " },
    ]).answers.length,
    1,
  );
  same(
    "add: the same words in another question are fine",
    run([
      { type: "add", question: "seg", text: "bakers" },
      { type: "add", question: "kr", text: "bakers" },
    ]).answers.length,
    2,
  );

  const five = run(["a", "b", "c", "d", "e"].map((text) => ({ type: "add", question: "ka", text })));
  same("five answers", five.answers.length, 5);
  check("a sixth is refused, same object", draftReducer(five, { type: "add", question: "ka", text: "f" }) === five);
  check(
    "a sixth inspiration is refused too",
    draftReducer(five, { type: "addInspiration", question: "ka", entity: "order-taking", label: "Taking orders", documentVersion: 1 }) === five,
  );

  const opened = run([{ type: "setOpen", question: "rev", open: true }]);
  same("setOpen: on", opened.open, ["rev"]);
  same("setOpen: canonical order", run([{ type: "setOpen", question: "cost", open: true }], opened).open, ["rev", "cost"]);
  same("add clears open", run([{ type: "add", question: "rev", text: "tips" }], opened).open, []);
  const answeredOne = run([{ type: "add", question: "rev", text: "tips" }]);
  check("setOpen refused with answers, same object", draftReducer(answeredOne, { type: "setOpen", question: "rev", open: true }) === answeredOne);
  same("setOpen: off", run([{ type: "setOpen", question: "rev", open: false }], opened).open, []);
  check("setOpen: unchanged is the same object", draftReducer(opened, { type: "setOpen", question: "rev", open: true }) === opened);

  const inspired = run([
    { type: "setOpen", question: "ch", open: true },
    { type: "addInspiration", question: "ch", entity: "word-of-mouth", label: "Word of mouth", documentVersion: 7 },
  ]);
  same("addInspiration: label made an answer, entity and version kept", inspired.answers, [
    { id: "a1", question: "ch", text: "word of mouth", inspiration: { entity: "word-of-mouth", documentVersion: 7 } },
  ]);
  same("addInspiration clears open", inspired.open, []);
  check(
    "addInspiration: the same entity twice is refused",
    draftReducer(inspired, { type: "addInspiration", question: "ch", entity: "word-of-mouth", label: "Word of mouth", documentVersion: 7 }) === inspired,
  );
  const reworded = run([{ type: "edit", id: "a1", text: "neighbours telling neighbours" }], inspired);
  same("rewording keeps the inspiration", reworded.answers[0], {
    id: "a1",
    question: "ch",
    text: "neighbours telling neighbours",
    inspiration: { entity: "word-of-mouth", documentVersion: 7 },
  });

  const edited = run([{ type: "edit", id: "a1", text: "" }], one);
  same("edit to blank keeps the answer while its field has focus", edited.answers.length, 1);
  same("a blank answer is not in the state", draftState(edited)[0].answers, []);
  same("…and the field removes it", run([{ type: "remove", id: "a1" }], edited).answers, []);
  same("edit: kept as typed, spaces included", run([{ type: "edit", id: "a1", text: "bakers " }], one).answers[0].text, "bakers ");
  check("edit: unknown id is the same object", draftReducer(one, { type: "edit", id: "a9", text: "x" }) === one);
  check("remove: unknown id is the same object", draftReducer(one, { type: "remove", id: "a9" }) === one);

  const mixed = run([
    { type: "add", question: "ka", text: "first" },
    { type: "add", question: "seg", text: "someone" },
    { type: "add", question: "ka", text: "second" },
    { type: "add", question: "ka", text: "third" },
  ]);
  same(
    "move: down, past another question's answer",
    run([{ type: "move", id: "a1", offset: 1 }], mixed).answers.filter((a) => a.question === "ka").map((a) => a.text),
    ["second", "first", "third"],
  );
  same(
    "move: up",
    run([{ type: "move", id: "a4", offset: -1 }], mixed).answers.filter((a) => a.question === "ka").map((a) => a.text),
    ["first", "third", "second"],
  );
  check("move: the first up is the same object", draftReducer(mixed, { type: "move", id: "a1", offset: -1 }) === mixed);
  check("move: the last down is the same object", draftReducer(mixed, { type: "move", id: "a4", offset: 1 }) === mixed);
  same("ids keep counting after a removal", nextAnswerId(run([{ type: "remove", id: "a4" }], mixed).answers), "a4");
  same("ids follow the highest", nextAnswerId([{ id: "a2" }, { id: "x" }, { id: "a10" }]), "a11");

  same("rename: kept as typed", run([{ type: "rename", name: "Acme " }]).name, "Acme ");
  same("rename: cut to 60", run([{ type: "rename", name: "n".repeat(80) }]).name.length, NAME_MAX_LENGTH);
  same("rename: one line", run([{ type: "rename", name: "Acme\nBakery" }]).name, "Acme Bakery");

  same("reset", run([{ type: "reset" }], inspired), emptyDraft());
  const empty = emptyDraft();
  check("reset of an empty draft is the same object", draftReducer(empty, { type: "reset" }) === empty);
  const other = { name: "Other tab", answers: [], open: ["kp"], updatedAt: "2026-11-12T10:00:00.000Z" };
  check("replace: takes the other tab's draft", draftReducer(inspired, { type: "replace", draft: other }) === other);

  const full = run([
    { type: "rename", name: "Tidy" },
    { type: "add", question: "seg", text: "  people who fish  " },
    { type: "addInspiration", question: "ch", entity: "app-stores", label: "App stores", documentVersion: 2 },
    { type: "setOpen", question: "rev", open: true },
  ]);
  const state = draftState(full);
  same("state: nine, canonical", state.map((q) => q.key), A.BMC_QUESTION_KEYS);
  same("state: trimmed text", state[0].answers, [{ text: "people who fish" }]);
  same("state: entity from the inspiration", state[2].answers, [{ text: "app stores", entity: "app-stores" }]);
  same("state: open", state[4], { key: "rev", answers: [], open: true });
  same("status: answered, open, empty", [state[0], state[4], state[5]].map(questionStatus), ["answered", "open", "empty"]);
  const dots = run([{ type: "add", question: "seg", text: "..." }]);
  same("status: an answer that cleans to nothing is not an answer", questionStatus(draftState(dots)[0]), "empty");
  same("first unfinished: such a question is still unfinished", firstUnfinishedStep(dots), 1);
  check("a name alone is not empty", !draftIsEmpty(run([{ type: "rename", name: "Tidy" }])));
  check("an open question alone is not empty", !draftIsEmpty(opened));

  same("first unfinished: empty draft", firstUnfinishedStep(emptyDraft()), 1);
  same("first unfinished: after seg", firstUnfinishedStep(one), 2);
  same(
    "first unfinished: open counts as finished",
    firstUnfinishedStep(run([{ type: "setOpen", question: "vp", open: true }], one)),
    3,
  );
  const allDone = run(A.BMC_QUESTION_KEYS.map((question) => ({ type: "add", question, text: `answer ${question}` })));
  same("first unfinished: all done is step 1", firstUnfinishedStep(allDone), 1);

  same("yoursHref", [yoursHref(), yoursHref(4)], [
    "/arkademy/business-model-canvas/yours",
    "/arkademy/business-model-canvas/yours?step=4",
  ]);
}

cleanup();
if (failures > 0) {
  console.log(`\n${failures} arkademy-canvas test(s) failed`);
  process.exit(1);
}
console.log("\nAll arkademy-canvas tests passed.");
