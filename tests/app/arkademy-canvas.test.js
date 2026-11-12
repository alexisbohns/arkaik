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
  const { inspirationCatalog, availableInspirations, answerFromLabel, inspirationAnswer, companiesLine, INSPIRATIONS_SHOWN } = A;
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
    Object.values(catalog).every((list) => list.every((item) => Object.keys(item).join() === "entity,label,answer,companies")),
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
  same(
    "available: an answer typed with closing punctuation still matches its label",
    availableInspirations(channels, [{ text: "Word of mouth!" }]).map((i) => i.entity),
    ["app-stores"],
  );

  same("answerFromLabel: sentence case lowered", answerFromLabel("A product map that stays true"), "a product map that stays true");
  same("answerFromLabel: a name with an inner capital kept", answerFromLabel("GitHub sponsors"), "GitHub sponsors");
  same("answerFromLabel: an acronym kept", answerFromLabel("AWS credits"), "AWS credits");
  same("answerFromLabel: already lower", answerFromLabel("word of mouth"), "word of mouth");
  same("answerFromLabel: one capital letter alone is lowered", answerFromLabel("X"), "x");
  same("answerFromLabel: accents", answerFromLabel("École partners"), "école partners");
  same("answerFromLabel: trimmed", answerFromLabel("  Hosting "), "hosting");

  // A name that is capitalised by its first letter alone (Broadcom, Apple) is
  // told apart by the companies' own wordings of the entity, which sit
  // mid-sentence: a capital there is a name's.
  same(
    "inspirationAnswer: a name the wordings capitalise keeps its capital",
    inspirationAnswer("Broadcom and Google for TPU capacity", ["Broadcom and Google for TPU capacity"]),
    "Broadcom and Google for TPU capacity",
  );
  same(
    "inspirationAnswer: found anywhere in a wording, punctuation aside",
    inspirationAnswer("Apple App Store and Google Play", ["the Apple and Google app stores"]),
    "Apple App Store and Google Play",
  );
  same(
    "inspirationAnswer: a common first word is lowered",
    inspirationAnswer("Third-party AI model providers", ["third-party AI model providers", "AI providers"]),
    "third-party AI model providers",
  );
  same("inspirationAnswer: no wording, the label rule alone", inspirationAnswer("Word of mouth", []), "word of mouth");
  same("inspirationAnswer: an inner capital needs no wording", inspirationAnswer("GitHub", []), "GitHub");
  check(
    "catalog: each answer is its label's answer (the fixture holds no name)",
    Object.values(catalog).every((list) => list.every((item) => item.answer === answerFromLabel(item.label))),
  );
  const named = JSON.parse(JSON.stringify(validation.document));
  named.entities.push({ id: "brine-co", kind: "partner", label: "Brine & Sons for salt" });
  named.uses.push({ tool: "business-model-canvas", company: "tidewise", question: "kp", entity: "brine-co", text: "Brine & Sons, who sell the salt", order: 1 });
  same(
    "catalog: a name keeps its capital in the answer",
    inspirationCatalog(A.indexArkademy(named)).kp.find((item) => item.entity === "brine-co").answer,
    "Brine & Sons for salt",
  );

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
    draftReducer(five, { type: "addInspiration", question: "ka", entity: "order-taking", text: "taking orders", documentVersion: 1 }) === five,
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
    { type: "addInspiration", question: "ch", entity: "word-of-mouth", text: " word of mouth ", documentVersion: 7 },
  ]);
  same("addInspiration: the inspiration's answer, trimmed, entity and version kept", inspired.answers, [
    { id: "a1", question: "ch", text: "word of mouth", inspiration: { entity: "word-of-mouth", documentVersion: 7 } },
  ]);
  same("addInspiration clears open", inspired.open, []);
  check(
    "addInspiration: the same entity twice is refused",
    draftReducer(inspired, { type: "addInspiration", question: "ch", entity: "word-of-mouth", text: "word of mouth", documentVersion: 7 }) === inspired,
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
    { type: "addInspiration", question: "ch", entity: "app-stores", text: "app stores", documentVersion: 2 },
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

// --- an answer that cleans to nothing ------------------------------------------------------
{
  const { draftReducer, emptyDraft, draftIsEmpty, repairDraft, serializeDraft } = A;
  const start = emptyDraft();
  check("add: only punctuation is refused (\"...\")", draftReducer(start, { type: "add", question: "seg", text: "..." }) === start);
  check("add: \"!\" is refused", draftReducer(start, { type: "add", question: "seg", text: " ! " }) === start);
  check(
    "addInspiration: a text that cleans to nothing is refused",
    draftReducer(start, { type: "addInspiration", question: "seg", entity: "x", text: "…", documentVersion: 1 }) === start,
  );
  const typing = { name: "", answers: [{ id: "a1", question: "seg", text: "..." }], open: [], updatedAt: "" };
  check("a draft whose only answer is \"...\" is empty", draftIsEmpty(typing));
  same("such an answer is not stored", JSON.parse(serializeDraft(typing)).draft.answers, []);
  same("nor read back from storage", repairDraft({ answers: [{ id: "a1", question: "seg", text: "?!" }] }).answers, []);
  same(
    "setOpen is not refused by an answer that cleans to nothing",
    draftReducer(typing, { type: "setOpen", question: "seg", open: true }).open,
    ["seg"],
  );
}

// --- duplicates, as the paragraph reads them ---------------------------------------------
{
  const { draftReducer, emptyDraft, hasAnswerText, duplicateAnswers } = A;
  const one = draftReducer(emptyDraft(), { type: "add", question: "seg", text: "bakers" });
  check("add: \"bakers.\" duplicates \"bakers\"", draftReducer(one, { type: "add", question: "seg", text: "bakers." }) === one);
  check("add: \"Bakers!\" duplicates \"bakers\"", draftReducer(one, { type: "add", question: "seg", text: "Bakers!" }) === one);
  check("hasAnswerText: cleaned and case-folded", hasAnswerText(one, "seg", "  BAKERS?  "));
  check("hasAnswerText: other words are not a duplicate", !hasAnswerText(one, "seg", "bakers at dawn"));
  const two = draftReducer(one, { type: "add", question: "seg", text: "millers" });
  const edited = draftReducer(two, { type: "edit", id: "a2", text: "Bakers." });
  same("edit: a duplicate is kept as typed (the field is marked, not emptied)", edited.answers[1].text, "Bakers.");
  same("duplicateAnswers: each later duplicate names the answer it repeats (1-based)", [...duplicateAnswers(edited.answers).entries()], [["a2", 1]]);
  same("duplicateAnswers: none", [...duplicateAnswers(two.answers).entries()], []);
  same(
    "duplicateAnswers: blank and punctuation-only answers are not duplicates of each other",
    [...duplicateAnswers([{ id: "a1", question: "seg", text: "..." }, { id: "a2", question: "seg", text: "!" }]).entries()],
    [],
  );
}

// --- Enter, outside an input method's composition ------------------------------------------
{
  const { isPlainEnter } = A;
  const key = (over) => ({ key: "Enter", shiftKey: false, keyCode: 13, isComposing: false, ...over });
  check("Enter", isPlainEnter(key({})));
  check("not while composing", !isPlainEnter(key({ isComposing: true })));
  check("not the Enter that confirms an input-method word on Safari (keyCode 229, after compositionend)", !isPlainEnter(key({ keyCode: 229 })));
  check("not Shift+Enter", !isPlainEnter(key({ shiftKey: true })));
  check("not another key", !isPlainEnter(key({ key: "a", keyCode: 65 })));
}

// --- what the live region says after each action ----------------------------------------------
{
  const { canvasAnnouncement } = A;
  same("added", canvasAnnouncement({ kind: "added", text: "bakers", count: 2 }), "Added: bakers. 2 of 5 answers.");
  same("added, the fifth", canvasAnnouncement({ kind: "added", text: "millers", count: 5 }), "Added: millers. That is five answers, the most a question takes.");
  same("refused as a duplicate", canvasAnnouncement({ kind: "duplicate", text: "Bakers!" }), "Not added: Bakers! is already an answer.");
  same("refused, only punctuation", canvasAnnouncement({ kind: "empty" }), "Not added: an answer needs words, not only punctuation.");
  same("refused at five", canvasAnnouncement({ kind: "full" }), "Not added: five answers is the most a question takes.");
  same("moved", canvasAnnouncement({ kind: "moved", text: "bakers", position: 1, count: 3 }), "Moved bakers to position 1 of 3.");
  same("removed", canvasAnnouncement({ kind: "removed", text: "bakers" }), "Removed: bakers.");
  same("removed, an empty field", canvasAnnouncement({ kind: "removed", text: "  " }), "Removed the empty answer.");
  same("left open", canvasAnnouncement({ kind: "open", block: "Revenue streams" }), "Revenue streams left open on purpose.");
  same("undone", canvasAnnouncement({ kind: "unopen", block: "Revenue streams" }), "Revenue streams is no longer left open.");
  same("started over", canvasAnnouncement({ kind: "reset" }), "Your canvas is empty again.");
}

// --- control characters (the ones part 1's schema refuses in text) ----------------------
{
  const { stripTextControls, draftReducer, emptyDraft, textCharacterProblem, repairDraft } = A;
  let leaks = [];
  for (let code = 0; code <= 0xffff; code++) {
    const char = String.fromCharCode(code);
    const stripped = stripTextControls(`a${char}b`).replace(/[\r\n\t]/g, " ");
    if (textCharacterProblem(stripped) !== null) leaks.push(code.toString(16));
  }
  same("every code point the schema refuses is stripped (lone surrogates included)", leaks.slice(0, 5), []);
  same("ordinary text is untouched", stripTextControls("Café crème — 24/7, 😀 & co"), "Café crème — 24/7, 😀 & co");
  same("rename: a right-to-left override is stripped", draftReducer(emptyDraft(), { type: "rename", name: "\u202EAcme\u202C" }).name, "Acme");
  same(
    "add: a zero-width space and an isolate are stripped",
    draftReducer(emptyDraft(), { type: "add", question: "seg", text: "\u200Bbakers\u2066 at dawn" }).answers[0].text,
    "bakers at dawn",
  );
  const withAnswer = draftReducer(emptyDraft(), { type: "add", question: "seg", text: "bakers" });
  same("edit: stripped too", draftReducer(withAnswer, { type: "edit", id: "a1", text: "bak\u200Fers" }).answers[0].text, "bakers");
  same(
    "a stored draft is stripped when read",
    repairDraft({ name: "\u202Ex", answers: [{ id: "a1", question: "seg", text: "y\u0007" }], open: [] }),
    { name: "x", answers: [{ id: "a1", question: "seg", text: "y" }], open: [], updatedAt: "" },
  );
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

// --- exports -------------------------------------------------------------------------
{
  const { canvasMarkdown, canvasJson, canvasJsonText, canvasFilename, canvasParagraphText, draftState, emptyDraft } = A;
  const toolPart = { title: tool.title, questions: tool.questions };
  const draft = {
    name: "  Tidy Harbour ",
    answers: [
      { id: "a1", question: "seg", text: "people who fish from the shore " },
      { id: "a2", question: "ch", text: "app stores", inspiration: { entity: "app-stores", documentVersion: 4 } },
      { id: "a3", question: "ch", text: "harbour noticeboards." },
      { id: "a4", question: "vp", text: "..." },
    ],
    open: ["rev"],
    updatedAt: "",
  };
  const state = draftState(draft);

  same(
    "paragraph text",
    canvasParagraphText({ tool: toolPart, name: draft.name, state }),
    "Tidy Harbour is for people who fish from the shore. It reaches them through app stores and harbour noticeboards.",
  );
  same(
    "markdown, byte-exact: answered, open and empty questions, a name",
    canvasMarkdown({ tool: toolPart, name: draft.name, state }),
    [
      "# Tidy Harbour: Business Model Canvas",
      "",
      "Tidy Harbour is for people who fish from the shore. It reaches them through app stores and harbour noticeboards.",
      "",
      "## Customer segments",
      "",
      "- people who fish from the shore",
      "",
      "## Value propositions",
      "",
      "_Not answered yet._",
      "",
      "## Channels",
      "",
      "- app stores",
      "- harbour noticeboards",
      "",
      "## Customer relationships",
      "",
      "_Not answered yet._",
      "",
      "## Revenue streams",
      "",
      "_Left open on purpose._",
      "",
      "## Key resources",
      "",
      "_Not answered yet._",
      "",
      "## Key activities",
      "",
      "_Not answered yet._",
      "",
      "## Key partners",
      "",
      "_Not answered yet._",
      "",
      "## Cost structure",
      "",
      "_Not answered yet._",
      "",
    ].join("\n"),
  );
  const unnamed = canvasMarkdown({ tool: toolPart, name: " ", state: draftState(emptyDraft()) });
  check("markdown without a name: the default subject, no paragraph line", unnamed.startsWith("# This product: Business Model Canvas\n\n## Customer segments\n\n_Not answered yet._\n\n## Value"));
  check("markdown: a single trailing newline", unnamed.endsWith("_Not answered yet._\n") && !unnamed.endsWith("\n\n"));
  same("markdown: nine sections", (unnamed.match(/^## /gm) ?? []).length, 9);

  const exported = canvasJson({ tool: toolPart, name: draft.name, state, documentVersion: 4, exportedAt: "2026-11-12T10:00:00.000Z" });
  same("json: header", [exported.format, exported.formatVersion, exported.tool, exported.name, exported.documentVersion, exported.exportedAt], [
    "arkaik.arkademy.canvas",
    1,
    "business-model-canvas",
    "Tidy Harbour",
    4,
    "2026-11-12T10:00:00.000Z",
  ]);
  same("json: the paragraph", exported.paragraph, canvasParagraphText({ tool: toolPart, name: draft.name, state }));
  same("json: nine questions with their words", exported.questions.map((q) => [q.key, q.state]), [
    ["seg", "answered"],
    ["vp", "empty"],
    ["ch", "answered"],
    ["cr", "empty"],
    ["rev", "open"],
    ["kr", "empty"],
    ["ka", "empty"],
    ["kp", "empty"],
    ["cost", "empty"],
  ]);
  same("json: a question", exported.questions[2], {
    key: "ch",
    block: "Channels",
    prompt: "How do they find out about it, and how do they get it?",
    state: "answered",
    answers: [{ text: "app stores", entity: "app-stores" }, { text: "harbour noticeboards" }],
  });
  const text = canvasJsonText(exported);
  check("json text: two-space indentation, trailing newline", text.startsWith('{\n  "format": "arkaik.arkademy.canvas",') && text.endsWith("}\n"));
  same("json text parses back", JSON.parse(text), exported);

  same("markdown and json: answers as shown, cleaned", [canvasMarkdown({ tool: toolPart, name: draft.name, state }).includes("- harbour noticeboards\n"), exported.questions[1].state], [true, "empty"]);
  same("filename: a name", canvasFilename("Tidy Harbour"), "tidy-harbour-business-model-canvas.json");
  same("filename: accents", canvasFilename("Café Crème"), "cafe-creme-business-model-canvas.json");
  same("filename: punctuation only", canvasFilename("!!! ???"), "business-model-canvas.json");
  same("filename: empty", canvasFilename(""), "business-model-canvas.json");
  same("filename: long names cut, no trailing dash", canvasFilename(`${"a".repeat(59)} b`), `${"a".repeat(59)}-business-model-canvas.json`);
}

// --- the components, rendered on the server ------------------------------------------
// Through tests/app/load-arkademy-tsx.js (part 2's require hook). What the
// server sends before the stored draft is read, and the markup each piece's
// behaviour lives in.
{
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const { requireTsx } = require("./load-arkademy-tsx");
  // YourCanvas takes ARKADEMY_SECTION_TITLE from ArkademyChrome.tsx, which
  // imports lib/fonts.ts; next/font only runs inside Next's compiler, so this
  // suite answers it with a font whose class is empty.
  const Module = require("module");
  const load = Module._load;
  Module._load = function loadWithFontStub(request, ...rest) {
    if (request === "next/font/google") return new Proxy({}, { get: () => () => ({ className: "", variable: "", style: {} }) });
    return load.call(this, request, ...rest);
  };
  const render = (component, props) => renderToStaticMarkup(React.createElement(component, props));
  const { YourCanvas } = requireTsx("components/arkademy/YourCanvas.tsx");
  const { StartYourOwnButton } = requireTsx("components/arkademy/StartYourOwnButton.tsx");
  const { QuestionEditor } = requireTsx("components/arkademy/QuestionEditor.tsx");
  const { QuestionSteps } = requireTsx("components/arkademy/QuestionSteps.tsx");
  const { InspirationList } = requireTsx("components/arkademy/InspirationList.tsx");
  const { CanvasToolbar } = requireTsx("components/arkademy/CanvasToolbar.tsx");
  const noop = () => {};

  const server = render(YourCanvas, {
    tool: { title: tool.title, questions: tool.questions },
    catalog: A.inspirationCatalog(index),
    documentVersion: 1,
    initialStep: null,
  });
  check("server: the skeleton, named for assistive technology", server.includes('aria-label="Loading your canvas"'));
  check("server: no draft in the HTML (it lives in the browser)", !server.includes("canvas-question-title") && !server.includes("canvas-name"));

  const start = render(StartYourOwnButton, {});
  check("cover action: the server says Start your own", start.includes(">Start your own</a>") && start.includes('href="/arkademy/business-model-canvas/yours"'));

  const editorProps = (answers, step = 1, open = false) => ({
    question: tool.questions[step - 1],
    step,
    total: 9,
    answers,
    open,
    preview: null,
    onAdd: () => "added",
    onEdit: noop,
    onRemove: noop,
    onMove: noop,
    onSetOpen: noop,
    onBack: noop,
    onNext: noop,
  });
  const empty = render(QuestionEditor, editorProps([]));
  const emptyText = empty.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
  check("editor: the kicker names the step and the block", emptyText.includes("Question 1 of 9 · Customer segments"));
  check("editor: the question is the card's h2", /<h2\b[^>]*>Who is this for\?<\/h2>/.test(empty));
  check("editor: no answer, so it can be left open", empty.includes("Leave this open on purpose"));
  check("editor: Back disabled on the first question", /<button[^>]*disabled=""[^>]*>.*?Back<\/button>/.test(empty));
  const fiveAnswers = ["a", "b", "c", "d", "e"].map((text, i) => ({ id: `a${i + 1}`, question: "ka", text }));
  const five = render(QuestionEditor, editorProps(fiveAnswers, 7));
  check("editor: five answers disable the add field", /<textarea[^>]*id="canvas-add-answer"[^>]*disabled=""/.test(five));
  check("editor: and say why", five.includes("Five answers is the most a question takes."));
  check("editor: with answers, no open checkbox", !five.includes("Leave this open on purpose"));
  check("editor: the first cannot move up, the last cannot move down", /aria-label="Move answer 1 up" disabled=""/.test(five) && /aria-label="Move answer 5 down" disabled=""/.test(five));
  check("editor: the ninth question's Next reads the paragraph", render(QuestionEditor, editorProps([], 9)).includes("Read your paragraph"));

  const steps = render(QuestionSteps, {
    questions: tool.questions,
    statuses: ["answered", "empty", "empty", "empty", "open", "empty", "empty", "empty", "empty"],
    current: 2,
    onSelect: noop,
  });
  check("steps: each named with its state", steps.includes('aria-label="Question 1: Customer segments, answered"') && steps.includes('aria-label="Question 5: Revenue streams, left open on purpose"') && steps.includes('aria-label="Question 2: Value propositions, not answered yet"'));
  same("steps: one current", (steps.match(/aria-current="step"/g) ?? []).length, 1);

  const many = Array.from({ length: 9 }, (_, i) => ({ entity: `e-${i}`, label: `label ${i}`, companies: [{ id: "c", name: "Crumb & Co" }] }));
  const list = render(InspirationList, { items: many, full: false, onAdd: noop });
  same("inspirations: six first", (list.match(/<li>/g) ?? []).length, 6);
  check("inspirations: then Show all", list.includes("Show all 9"));
  check("inspirations: each names its companies", list.includes('aria-label="Add “label 0”, used by Crumb &amp; Co"'));
  const fullList = render(InspirationList, { items: many.slice(0, 2), full: true, onAdd: noop });
  same("inspirations: disabled at five answers", (fullList.match(/<button[^>]*disabled=""/g) ?? []).length, 2);

  const bare = render(CanvasToolbar, { paragraph: "", markdown: "", hasContent: false, onDownload: noop, onStartOver: noop, focusAfterStartOver: "canvas-name" });
  same("toolbar: nothing to export or clear, every button disabled", (bare.match(/<button[^>]*disabled=""/g) ?? []).length, 4);
  const ready = render(CanvasToolbar, { paragraph: "It is.", markdown: "# x\n", hasContent: true, onDownload: noop, onStartOver: noop, focusAfterStartOver: "canvas-name" });
  same("toolbar: with a canvas, none disabled", (ready.match(/disabled=""/g) ?? []).length, 0);
}

cleanup();
if (failures > 0) {
  console.log(`\n${failures} arkademy-canvas test(s) failed`);
  process.exit(1);
}
console.log("\nAll arkademy-canvas tests passed.");
