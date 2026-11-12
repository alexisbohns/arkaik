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

// --- browser storage -----------------------------------------------------------------
{
  const { readStoredDraft, serializeDraft, repairDraft, emptyDraft, draftReducer } = A;
  const { DRAFT_STORAGE_KEY, DRAFT_UNREADABLE_KEY, DRAFT_FORMAT, DRAFT_UPGRADES } = A;
  same("key", [DRAFT_STORAGE_KEY, DRAFT_UNREADABLE_KEY], ["arkaik:arkademy:bmc", "arkaik:arkademy:bmc:unreadable"]);
  same("format", DRAFT_FORMAT, 1);
  same("no upgrades at version 1", Object.keys(DRAFT_UPGRADES), []);

  same("null: none", readStoredDraft(null), { status: "none" });
  same("blank: none", readStoredDraft("  "), { status: "none" });

  const draft = {
    name: "Tidy",
    answers: [
      { id: "a1", question: "seg", text: "people who fish" },
      { id: "a2", question: "ch", text: "app stores", inspiration: { entity: "app-stores", documentVersion: 3 } },
    ],
    open: ["rev"],
    updatedAt: "2026-11-12T10:00:00.000Z",
  };
  const stored = JSON.stringify({ v: 1, draft });
  same("a valid v1", readStoredDraft(stored), { status: "ok", draft });
  same("serialize: the envelope", serializeDraft(draft), stored);
  same("serialize round trip", readStoredDraft(serializeDraft(draft)), { status: "ok", draft });
  same(
    "serialize: answers trimmed, blank ones left out",
    JSON.parse(
      serializeDraft({
        ...draft,
        answers: [
          { id: "a1", question: "seg", text: " people " },
          { id: "a3", question: "vp", text: "   " },
        ],
      }),
    ).draft.answers,
    [{ id: "a1", question: "seg", text: "people" }],
  );

  same("broken JSON: unreadable", readStoredDraft("{not json"), { status: "unreadable", raw: "{not json" });
  same("an array: unreadable", readStoredDraft("[1,2]").status, "unreadable");
  same("no v: unreadable", readStoredDraft(JSON.stringify({ draft })).status, "unreadable");
  same("a wrong shape: unreadable", readStoredDraft(JSON.stringify({ v: 1, draft: { name: "x" } })).status, "unreadable");
  same("a draft that is a string: unreadable", readStoredDraft(JSON.stringify({ v: 1, draft: "x" })).status, "unreadable");
  same("v: 0 is unreadable", readStoredDraft(JSON.stringify({ v: 0, draft })).status, "unreadable");

  const newer = readStoredDraft(JSON.stringify({ v: 2, draft }));
  same("v: 2 is newer", [newer.status, newer.v], ["newer", 2]);
  same("newer: shown as best this build can", newer.draft, draft);
  same(
    "newer with a shape this build cannot read: an empty canvas",
    readStoredDraft(JSON.stringify({ v: 3, draft: [] })).draft,
    emptyDraft(),
  );

  const repaired = readStoredDraft(
    JSON.stringify({
      v: 1,
      draft: {
        name: "N".repeat(70),
        answers: [
          { id: "a1", question: "nope", text: "unknown key" },
          { id: "a2", question: "seg", text: 42 },
          { id: "a3", question: "seg", text: "y".repeat(200) },
          ...["1", "2", "3", "4", "5", "6"].map((n) => ({ id: `k${n}`, question: "ka", text: `task ${n}` })),
          { id: "a3", question: "vp", text: "repeated id" },
          { question: "vp", text: "no id" },
          { id: "a9", question: "kp", text: "   " },
          { id: "a10", question: "ch", text: "bad inspiration", inspiration: { entity: "Not A Slug", documentVersion: 1 } },
        ],
        open: ["rev", "rev", "seg", "nope", 4],
        updatedAt: 12,
      },
    }),
  );
  same("repair: still ok", repaired.status, "ok");
  const r = repaired.draft;
  same("repair: name cut to 60", r.name.length, 60);
  same("repair: unknown key and non-string text dropped", r.answers.some((a) => a.text === "unknown key"), false);
  same("repair: a 200-character text cut to 140", r.answers.find((a) => a.id === "a3").text.length, 140);
  same("repair: six answers keep the first five", r.answers.filter((a) => a.question === "ka").map((a) => a.text), [
    "task 1",
    "task 2",
    "task 3",
    "task 4",
    "task 5",
  ]);
  same("repair: a repeated or missing id gets a new one", r.answers.filter((a) => a.question === "vp").map((a) => a.id), ["a11", "a12"]);
  same("repair: blank text dropped", r.answers.some((a) => a.question === "kp"), false);
  same("repair: a bad inspiration dropped, the answer kept", r.answers.find((a) => a.id === "a10"), {
    id: "a10",
    question: "ch",
    text: "bad inspiration",
  });
  same("repair: open deduplicated, keys with answers and unknown keys dropped", r.open, ["rev"]);
  same("repair: updatedAt not a string", r.updatedAt, "");
  same("repairDraft: not an object", repairDraft(null), null);

  // A repaired draft keeps working with the reducer.
  same("repaired ids keep counting", draftReducer(r, { type: "add", question: "kr", text: "boats" }).answers.at(-1).id, "a13");
}

cleanup();
if (failures > 0) {
  console.log(`\n${failures} arkademy-canvas test(s) failed`);
  process.exit(1);
}
console.log("\nAll arkademy-canvas tests passed.");
