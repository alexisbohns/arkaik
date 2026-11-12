#!/usr/bin/env node

/**
 * The Arkademy library document (lib/arkademy/): the schema's field rules,
 * the referential rules and warnings of validateArkademyDocument, the format
 * upgrade, and the index the pages read. DB-free, so it runs in CI's `build`
 * job.
 *
 * Every invalid case is the fictional fixture (tests/fixtures/arkademy/
 * document.json) mutated in memory, so each one breaks exactly one rule and
 * the fixture itself stays the single valid example.
 */

const fs = require("fs");
const path = require("path");
const { loadArkademy, cleanup } = require("./load-arkademy");

const ROOT = path.join(__dirname, "..", "..");
const FIXTURE = path.join(ROOT, "tests", "fixtures", "arkademy", "document.json");

const ark = loadArkademy();
const {
  ARKADEMY_FORMAT_VERSION,
  BMC_TOOL_ID,
  BMC_QUESTION_KEYS,
  ENTITY_KINDS,
  BMC_QUESTION_KIND,
  ANSWER_MAX_LENGTH,
  MAX_ANSWERS_PER_QUESTION,
  MAX_DOCUMENT_BYTES,
  PROMPT_TOKEN,
  NOTE_MAX_LENGTH,
  NOTE_DATE_KINDS,
  arkademyDocumentSchema,
  validateArkademyDocument,
  upgradeArkademyDocument,
  formatFindingPath,
  documentByteLength,
  wordingWarnings,
  templateProblems,
} = ark;

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`PASS: ${name}`);
  else {
    failures++;
    console.log(`FAIL: ${name}${detail === undefined ? "" : ` — ${detail}`}`);
  }
}

const fixture = () => JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
const doc0 = fixture();
const useIndex = (company, question, order) =>
  doc0.uses.findIndex((use) => use.company === company && use.question === question && use.order === order);
const entityIndex = (id) => doc0.entities.findIndex((entity) => entity.id === id);

function mutate(fn) {
  const doc = fixture();
  fn(doc);
  return validateArkademyDocument(doc);
}
const show = (result) => JSON.stringify(result.ok ? { ok: true, warnings: result.warnings } : result.errors);
function expectError(name, fn, findingPath) {
  const result = mutate(fn);
  check(name, !result.ok && result.errors.some((finding) => finding.path === findingPath), show(result));
}
function expectOk(name, fn) {
  const result = mutate(fn);
  check(name, result.ok === true, show(result));
}
function expectWarning(name, fn, findingPath) {
  const result = mutate(fn);
  check(name, result.ok === true && result.warnings.some((finding) => finding.path === findingPath), show(result));
}
function expectNoWarning(name, fn, findingPath) {
  const result = mutate(fn);
  check(name, result.ok === true && !result.warnings.some((finding) => finding.path === findingPath), show(result));
}

// --- The contract's names ----------------------------------------------------
check("the format is version 1", ARKADEMY_FORMAT_VERSION === 1);
check("the BMC tool id", BMC_TOOL_ID === "business-model-canvas");
check(
  "the nine question keys in canonical order",
  JSON.stringify(BMC_QUESTION_KEYS) === JSON.stringify(["seg", "vp", "ch", "cr", "rev", "kr", "ka", "kp", "cost"]),
);
check("nine entity kinds", ENTITY_KINDS.length === 9);
check(
  "each question names its kind, and each kind is used once",
  BMC_QUESTION_KEYS.every((key) => ENTITY_KINDS.includes(BMC_QUESTION_KIND[key])) &&
    new Set(BMC_QUESTION_KEYS.map((key) => BMC_QUESTION_KIND[key])).size === 9,
);
check(
  "the limits",
  ANSWER_MAX_LENGTH === 140 && MAX_ANSWERS_PER_QUESTION === 5 && MAX_DOCUMENT_BYTES === 1048576,
);
check("the prompt token", PROMPT_TOKEN === "{{paragraph}}");
check("the zod schema is exported", typeof arkademyDocumentSchema.safeParse === "function");
check(
  "the schema revision starts at 1 (bump it when the schema gets stricter without a format bump)",
  ark.ARKADEMY_SCHEMA_REVISION === 1,
  String(ark.ARKADEMY_SCHEMA_REVISION),
);

// --- The fixture -------------------------------------------------------------
const valid = validateArkademyDocument(fixture());
check("the fixture validates", valid.ok === true, show(valid));
check(
  "the fixture's only warning is its unused entity",
  valid.ok &&
    valid.warnings.length === 1 &&
    valid.warnings[0].level === "warning" &&
    valid.warnings[0].path === `entities[${entityIndex("pop-up-stalls")}]`,
  show(valid),
);
check(
  "the parse keeps the fixture's content and key order",
  valid.ok && JSON.stringify(valid.document) === JSON.stringify(doc0),
);
{
  const shuffled = fixture();
  const company = shuffled.companies[0];
  shuffled.companies[0] = Object.fromEntries(Object.entries(company).reverse());
  shuffled.tools[0] = Object.fromEntries(Object.entries(shuffled.tools[0]).reverse());
  const result = validateArkademyDocument(shuffled);
  check(
    "the parse puts keys in the schema's order, so the text is canonical",
    JSON.stringify(shuffled) !== JSON.stringify(doc0) && result.ok && JSON.stringify(result.document) === JSON.stringify(doc0),
  );
}

// --- Paths and sizes ---------------------------------------------------------
check("a path with indices", formatFindingPath(["uses", 12, "entity"]) === "uses[12].entity");
check("a nested path", formatFindingPath(["tools", 0, "questions", 3, "key"]) === "tools[0].questions[3].key");
check("the document's own path", formatFindingPath([]) === "$");
check(
  "the size is the UTF-8 length of the compact JSON",
  documentByteLength(doc0) === Buffer.byteLength(JSON.stringify(doc0), "utf8"),
);

// --- Structure ---------------------------------------------------------------
expectError("formatVersion 2 is refused", (doc) => (doc.formatVersion = 2), "formatVersion");
expectError("an unknown top-level key is refused", (doc) => (doc.extra = true), "$");
expectError("an unknown key in a use is refused", (doc) => (doc.uses[0].weight = 1), "uses[0]");
expectError("an unknown key in a question is refused", (doc) => (doc.tools[0].questions[2].hints = "x"), "tools[0].questions[2]");
expectError("two tools are refused in format 1", (doc) => doc.tools.push(doc.tools[0]), "tools");
expectError("a document with no company is refused", (doc) => (doc.companies = []), "companies");
expectError("a tool with no example is refused", (doc) => (doc.tools[0].examples = []), "tools[0].examples");
expectError("a missing open list is refused", (doc) => delete doc.open, "open");

// --- Field constraints at their bounds -----------------------------------------
const pad = (length) => "x".repeat(length);
expectOk("a use's text of 140 characters passes", (doc) => (doc.uses[0].text = pad(140)));
expectError("a use's text of 141 characters fails", (doc) => (doc.uses[0].text = pad(141)), "uses[0].text");
expectError("an empty use text fails", (doc) => (doc.uses[0].text = ""), "uses[0].text");
expectOk("an entity label of 140 characters passes", (doc) => (doc.entities[0].label = pad(140)));
expectError("an entity label of 141 characters fails", (doc) => (doc.entities[0].label = pad(141)), "entities[0].label");
expectError("a newline in a use's text fails", (doc) => (doc.uses[0].text = "two\nlines"), "uses[0].text");
expectError("a carriage return in a label fails", (doc) => (doc.entities[0].label = "two\rlines"), "entities[0].label");
expectError("a leading space fails", (doc) => (doc.uses[0].text = " households"), "uses[0].text");
expectError("a trailing space fails", (doc) => (doc.companies[0].name = "Crumb & Co "), "companies[0].name");
for (const mark of [".", "!", "?", ";", ":", ","]) {
  expectError(`a wording ending in "${mark}" fails`, (doc) => (doc.uses[0].text = `households nearby${mark}`), "uses[0].text");
  expectError(`a label ending in "${mark}" fails`, (doc) => (doc.entities[0].label = `households nearby${mark}`), "entities[0].label");
}
expectOk("a comma inside a wording passes", (doc) => (doc.uses[0].text = "bread, still warm"));
expectOk("a company name of 40 characters passes", (doc) => (doc.companies[0].name = pad(40)));
expectError("a company name of 41 characters fails", (doc) => (doc.companies[0].name = pad(41)), "companies[0].name");
expectError("an empty note fails", (doc) => (doc.companies[1].note = ""), "companies[1].note");
expectError("a note of 401 characters fails", (doc) => (doc.companies[0].note = pad(401)), "companies[0].note");
expectError("a non-boolean simulation fails", (doc) => (doc.companies[0].simulation = "yes"), "companies[0].simulation");
const unused = entityIndex("pop-up-stalls");
expectOk("a slug of 64 characters passes", (doc) => (doc.entities[unused].id = pad(64)));
expectError("a slug of 65 characters fails", (doc) => (doc.entities[unused].id = pad(65)), `entities[${unused}].id`);
expectError("a slug with a capital fails", (doc) => (doc.entities[unused].id = "Pop-up"), `entities[${unused}].id`);
expectError("a slug with a double hyphen fails", (doc) => (doc.entities[unused].id = "pop--up"), `entities[${unused}].id`);
expectError("a slug ending in a hyphen fails", (doc) => (doc.entities[unused].id = "pop-up-"), `entities[${unused}].id`);
expectError("an unknown entity kind fails", (doc) => (doc.entities[unused].kind = "competitor"), `entities[${unused}].kind`);
expectError("a negative order fails", (doc) => (doc.uses[0].order = -1), "uses[0].order");
expectError("a fractional order fails", (doc) => (doc.uses[0].order = 1.5), "uses[0].order");
expectOk("an empty hint passes", (doc) => (doc.tools[0].questions[0].hint = ""));
expectError("a hint of 301 characters fails", (doc) => (doc.tools[0].questions[0].hint = pad(301)), "tools[0].questions[0].hint");
expectError("a block title of 41 characters fails", (doc) => (doc.tools[0].questions[0].block = pad(41)), "tools[0].questions[0].block");
expectError("a gap of 61 characters fails", (doc) => (doc.tools[0].questions[0].gap = pad(61)), "tools[0].questions[0].gap");
expectError("a title of 61 characters fails", (doc) => (doc.tools[0].title = pad(61)), "tools[0].title");
expectError("a tagline of 161 characters fails", (doc) => (doc.tools[0].tagline = pad(161)), "tools[0].tagline");
expectError("a headline of 121 characters fails", (doc) => (doc.tools[0].pitch.headline = pad(121)), "tools[0].pitch.headline");
expectError(
  "seven pitch paragraphs fail",
  (doc) => (doc.tools[0].pitch.body = Array.from({ length: 7 }, () => "A paragraph.")),
  "tools[0].pitch.body",
);
expectError("a pitch paragraph of 801 characters fails", (doc) => (doc.tools[0].pitch.body[0] = pad(801)), "tools[0].pitch.body[0]");
expectOk("a newline inside a pitch paragraph passes", (doc) => (doc.tools[0].pitch.body[0] = "one\ntwo"));
expectError("a newline in the headline fails", (doc) => (doc.tools[0].pitch.headline = "one\ntwo"), "tools[0].pitch.headline");
expectOk("a prompt without the token passes", (doc) => (doc.tools[0].prompt.text = "Just a prompt."));
expectError(
  "a second prompt token fails",
  (doc) => (doc.tools[0].prompt.text = `${PROMPT_TOKEN}\n\n${PROMPT_TOKEN}`),
  "tools[0].prompt.text",
);
expectError("a prompt of 4001 characters fails", (doc) => (doc.tools[0].prompt.text = pad(4001)), "tools[0].prompt.text");

// --- Templates ---------------------------------------------------------------
const SENTENCE = "tools[0].questions[0].sentence";
expectError("a template without {L} fails", (doc) => (doc.tools[0].questions[0].sentence = "{S} is for people."), SENTENCE);
expectError("a template with {L} twice fails", (doc) => (doc.tools[0].questions[0].sentence = "{S} is for {L} and {L}."), SENTENCE);
expectError("{S} twice fails", (doc) => (doc.tools[0].questions[0].sentence = "{S} and {S} are for {L}."), SENTENCE);
expectError("{S} anywhere but the start fails", (doc) => (doc.tools[0].questions[0].sentence = "Made for {L}, says {S}."), SENTENCE);
expectError("a template opening with {L} fails", (doc) => (doc.tools[0].questions[4].sentence = "{L} pays."), "tools[0].questions[4].sentence");
expectError("an unknown token fails", (doc) => (doc.tools[0].questions[0].sentence = "{S} is for {X} and {L}."), SENTENCE);
expectError(
  "a plural that adds {S} fails",
  (doc) => (doc.tools[0].questions[8].sentencePlural = "{S} spends most on {L}."),
  "tools[0].questions[8].sentencePlural",
);
expectError(
  "a plural that drops {S} fails",
  (doc) => (doc.tools[0].questions[0].sentencePlural = "It is for {L}."),
  "tools[0].questions[0].sentencePlural",
);
expectOk("a plural that keeps {S} passes", (doc) => (doc.tools[0].questions[0].sentencePlural = "{S} is for {L} alike."));
expectError(
  "a plural template is checked like a sentence",
  (doc) => (doc.tools[0].questions[8].sentencePlural = "The main costs are many."),
  "tools[0].questions[8].sentencePlural",
);
for (const broken of ["{S} is for {{L}}.", "{S} is for {L}}.", "{S} is for {{L}.", "{S} is for {L} {.", "{S} is for {L} }.", "{S} is {for {L}.", "{S} is for {L} {}.", "{{S}} is for {L}."]) {
  expectError(`a stray brace fails: ${broken}`, (doc) => (doc.tools[0].questions[0].sentence = broken), SENTENCE);
}
expectError("a stray brace in a plural fails", (doc) => (doc.tools[0].questions[8].sentencePlural = "The main costs are {L}}."), "tools[0].questions[8].sentencePlural");
check(
  "a doubled token is one problem: the stray braces",
  templateProblems("{S} is for {{L}}.").length === 1 && /brace/.test(templateProblems("{S} is for {{L}}.")[0] ?? ""),
  JSON.stringify(templateProblems("{S} is for {{L}}.")),
);
check("templateProblems passes a sound template", templateProblems("{S} is for {L}.").length === 0);
check("templateProblems names every broken rule", templateProblems("{X} {S}").length === 3, JSON.stringify(templateProblems("{X} {S}")));

// --- Notes on a use ----------------------------------------------------------
const noted = doc0.uses.findIndex((use) => use.note !== undefined);
const NOTE = `uses[${noted}].note`;
check("the fixture has a use with a sourced note", noted >= 0 && doc0.uses[noted].note.source.url.startsWith("https://"));
check("the note limit", NOTE_MAX_LENGTH === 200);
check("the two date kinds", JSON.stringify(NOTE_DATE_KINDS) === JSON.stringify(["published", "accessed"]));
const accessed = doc0.uses.findIndex((use) => use.note !== undefined && use.note.source.dateKind === "accessed");
check(
  "the fixture has a note of each date kind",
  doc0.uses[noted].note.source.dateKind === "published" && accessed >= 0,
);
expectOk("a note text of 200 characters passes", (doc) => (doc.uses[noted].note.text = pad(200)));
expectError("a note text of 201 characters fails", (doc) => (doc.uses[noted].note.text = pad(201)), `${NOTE}.text`);
expectError("an empty note text fails", (doc) => (doc.uses[noted].note.text = ""), `${NOTE}.text`);
expectError("a newline in a note fails", (doc) => (doc.uses[noted].note.text = "two\nlines"), `${NOTE}.text`);
expectError("parentheses in a note fail", (doc) => (doc.uses[noted].note.text = "412 harbours (and counting)"), `${NOTE}.text`);
for (const mark of [".", "!", "?", ";", ":", ","]) {
  expectError(`a note ending in "${mark}" fails`, (doc) => (doc.uses[noted].note.text = `412 harbours${mark}`), `${NOTE}.text`);
}
expectOk("a figure inside a note passes", (doc) => (doc.uses[noted].note.text = "about $5.6B, up 40% in a year"));
expectError("a note without a source fails", (doc) => delete doc.uses[noted].note.source, `${NOTE}.source`);
expectError("an unknown key in a note fails", (doc) => (doc.uses[noted].note.author = "x"), NOTE);
expectError("an unknown key in a source fails", (doc) => (doc.uses[noted].note.source.page = 3), `${NOTE}.source`);
expectError("a source without a dateKind fails", (doc) => delete doc.uses[noted].note.source.dateKind, `${NOTE}.source.dateKind`);
expectError(
  "an unknown dateKind fails",
  (doc) => (doc.uses[noted].note.source.dateKind = "retrieved"),
  `${NOTE}.source.dateKind`,
);
expectOk("an accessed date passes", (doc) => (doc.uses[noted].note.source.dateKind = "accessed"));
expectOk("a source name of 80 characters passes", (doc) => (doc.uses[noted].note.source.name = pad(80)));
expectError("a source name of 81 characters fails", (doc) => (doc.uses[noted].note.source.name = pad(81)), `${NOTE}.source.name`);
expectError(
  "parentheses in a source name fail (it is set inside the note's parentheses)",
  (doc) => (doc.uses[noted].note.source.name = "Tidewise (press release)"),
  `${NOTE}.source.name`,
);
expectError("a closing parenthesis alone in a source name fails", (doc) => (doc.uses[noted].note.source.name = "Tidewise)"), `${NOTE}.source.name`);
expectOk("a source name with a comma passes", (doc) => (doc.uses[noted].note.source.name = "Tidewise, press release"));
expectError("an http source fails", (doc) => (doc.uses[noted].note.source.url = "http://tidewise.example/harbours"), `${NOTE}.source.url`);
expectError("a source that is not a URL fails", (doc) => (doc.uses[noted].note.source.url = "tidewise harbours"), `${NOTE}.source.url`);
{
  const URL_PATH = `${NOTE}.source.url`;
  const setUrl = (url) => (doc) => (doc.uses[noted].note.source.url = url);
  expectError("a source URL with a username fails", setUrl("https://reader@tidewise.example/harbours"), URL_PATH);
  expectError("a source URL with a username and password fails", setUrl("https://reader:secret@tidewise.example/harbours"), URL_PATH);
  expectError("a source URL with an empty password fails", setUrl("https://reader:@tidewise.example/harbours"), URL_PATH);
  expectError("an upper-case host is not the written form", setUrl("https://Tidewise.example/harbours"), URL_PATH);
  expectError("an upper-case scheme is not the written form", setUrl("HTTPS://tidewise.example/harbours"), URL_PATH);
  expectError("the default port is not the written form", setUrl("https://tidewise.example:443/harbours"), URL_PATH);
  expectError("a dot segment is not the written form", setUrl("https://tidewise.example/a/../harbours"), URL_PATH);
  expectError("an unencoded space is not the written form", setUrl("https://tidewise.example/tide tables"), URL_PATH);
  expectError("a backslash is not the written form", setUrl("https:\\\\tidewise.example\\harbours"), URL_PATH);
  expectError("a single slash after the scheme is not the written form", setUrl("https:/tidewise.example/harbours"), URL_PATH);
  expectError("an unencoded non-ASCII path is not the written form", setUrl("https://tidewise.example/marée"), URL_PATH);
  expectError("a bare origin with a query but no slash is not the written form", setUrl("https://tidewise.example?a=1"), URL_PATH);
  expectOk("a bare origin without its trailing slash passes", setUrl("https://tidewise.example"));
  expectOk("a bare origin with its trailing slash passes", setUrl("https://tidewise.example/"));
  expectOk("a percent-encoded path, a query and a fragment pass", setUrl("https://tidewise.example/mar%C3%A9e?year=2026#tables"));
  expectOk("a non-default port passes", setUrl("https://tidewise.example:8443/harbours"));
  const message = mutate(setUrl("https://reader:secret@tidewise.example/harbours"));
  check(
    "the URL message never echoes the URL",
    !message.ok && message.errors.every((finding) => !finding.message.includes("secret") && !finding.message.includes("tidewise")),
    show(message),
  );
}
expectOk("a source URL of 500 characters passes", (doc) => (doc.uses[noted].note.source.url = `https://tidewise.example/${pad(475)}`));
expectError(
  "a source URL of 501 characters fails",
  (doc) => (doc.uses[noted].note.source.url = `https://tidewise.example/${pad(476)}`),
  `${NOTE}.source.url`,
);
expectError("a date in another format fails", (doc) => (doc.uses[noted].note.source.date = "02/03/2026"), `${NOTE}.source.date`);
expectError("a date that does not exist fails", (doc) => (doc.uses[noted].note.source.date = "2026-02-30"), `${NOTE}.source.date`);
expectOk("the 29th of February of a leap year passes", (doc) => (doc.uses[noted].note.source.date = "2028-02-29"));
{
  const doc = fixture();
  const date = doc.uses[noted].note.source.date;
  const sameDay = validateArkademyDocument(doc, { now: new Date(`${date}T12:00:00Z`) });
  check(
    "a note dated today is not in the future",
    sameDay.ok && !sameDay.warnings.some((finding) => finding.path === `${NOTE}.source.date`),
    show(sameDay),
  );
  const early = validateArkademyDocument(doc, { now: new Date("2026-01-01T12:00:00Z") });
  check(
    "a note dated after today is a warning, not an error",
    early.ok && early.warnings.some((finding) => finding.path === `${NOTE}.source.date`),
    show(early),
  );
}
expectWarning("a note dated far ahead warns on today's clock", (doc) => (doc.uses[noted].note.source.date = "2999-01-01"), `${NOTE}.source.date`);
expectWarning(
  "an accessed date in the future warns too",
  (doc) => (doc.uses[accessed].note.source.date = "2999-01-01"),
  `uses[${accessed}].note.source.date`,
);

// --- Characters no text field may hold ------------------------------------------
// Postgres refuses NUL and lone surrogates in jsonb, so they must fail `check`
// rather than crash `publish`; the invisible ones would pass the trim and
// single-line rules while breaking what a reader sees.
{
  const refused = [
    ["NUL", "\u0000"],
    ["a bell (C0)", "\u0007"],
    ["U+001F (C0)", "\u001f"],
    ["a vertical tab", "\u000b"],
    ["DEL", "\u007f"],
    ["a C1 control (NEL)", "\u0085"],
    ["U+2028 LINE SEPARATOR", "\u2028"],
    ["U+2029 PARAGRAPH SEPARATOR", "\u2029"],
    ["a zero-width space", "\u200b"],
    ["a zero-width non-joiner", "\u200c"],
    ["a zero-width joiner", "\u200d"],
    ["a word joiner", "\u2060"],
    ["a byte-order mark inside text", "\ufeff"],
    ["a left-to-right mark", "\u200e"],
    ["a right-to-left mark", "\u200f"],
    ["an Arabic letter mark", "\u061c"],
    ["a right-to-left override", "\u202e"],
    ["a left-to-right embedding", "\u202a"],
    ["a first-strong isolate", "\u2068"],
    ["a pop directional isolate", "\u2069"],
    ["a lone high surrogate", "\ud800"],
    ["a lone low surrogate", "\udc00"],
  ];
  for (const [name, char] of refused) {
    expectError(`${name} inside a use's text fails`, (doc) => (doc.uses[0].text = `house${char}holds`), "uses[0].text");
  }
  expectError("a lone surrogate at the end fails", (doc) => (doc.uses[0].text = "households\ud83c"), "uses[0].text");
  expectError("a reversed surrogate pair fails", (doc) => (doc.uses[0].text = "house\udc00\ud800holds"), "uses[0].text");
  expectError("zero-width-only text fails", (doc) => (doc.uses[0].text = "\u200b"), "uses[0].text");
  expectError("a zero-width-only label fails", (doc) => (doc.entities[0].label = "\u200b\u200b"), "entities[0].label");
  expectError("a tab in a single-line field fails", (doc) => (doc.companies[0].name = "Crumb\t& Co"), "companies[0].name");
  expectError("NUL in a company's one-liner fails", (doc) => (doc.companies[0].oneLiner = "bread\u0000"), "companies[0].oneLiner");
  expectError("NUL in a hint fails", (doc) => (doc.tools[0].questions[0].hint = "a\u0000b"), "tools[0].questions[0].hint");
  expectError("a zero-width space in a note fails", (doc) => (doc.uses[noted].note.text = "412\u200b harbours"), `${NOTE}.text`);
  expectError("a zero-width space in a source name fails", (doc) => (doc.uses[noted].note.source.name = "Tide\u200bwise"), `${NOTE}.source.name`);
  expectError(
    "a bidi override in a source URL fails, though new URL() would encode it",
    (doc) => (doc.uses[noted].note.source.url = "https://tidewise.example/\u202eharbours"),
    `${NOTE}.source.url`,
  );
  expectError("NUL in a template fails", (doc) => (doc.tools[0].questions[0].sentence = "{S} is for {L}\u0000."), SENTENCE);
  expectError("NUL in a pitch paragraph fails", (doc) => (doc.tools[0].pitch.body[0] = "one\u0000two"), "tools[0].pitch.body[0]");
  expectError("a carriage return in a pitch paragraph fails", (doc) => (doc.tools[0].pitch.body[0] = "one\r\ntwo"), "tools[0].pitch.body[0]");
  expectError("U+2028 in the prompt fails", (doc) => (doc.tools[0].prompt.text = "one\u2028two"), "tools[0].prompt.text");
  expectOk("a tab inside a pitch paragraph passes", (doc) => (doc.tools[0].pitch.body[0] = "one\ttwo"));
  expectOk("a newline and a tab inside the prompt pass", (doc) => (doc.tools[0].prompt.text = "one\n\ttwo"));
  expectOk("accents pass", (doc) => (doc.uses[0].text = "crème brûlée lovers"));
  expectOk("an emoji (a well-formed surrogate pair) passes", (doc) => (doc.uses[0].text = "bread lovers \ud83c\udf5e"));
  expectOk("a no-break space inside text passes", (doc) => (doc.uses[0].text = "households\u00a0nearby"));
  expectOk("a narrow no-break space (French typography) passes", (doc) => (doc.companies[0].oneLiner = "Du pain\u202f!"));
  const message = mutate((doc) => (doc.uses[0].text = "house\u200bholds"));
  check(
    "the message names the code point, never echoes the text",
    !message.ok && message.errors.some((finding) => /U\+200B/.test(finding.message) && !finding.message.includes("house")),
    show(message),
  );
}

// --- Keys JSON.parse would lose ------------------------------------------------
{
  const withProto = (place) => {
    const doc = fixture();
    const target = place(doc);
    Object.defineProperty(target, "__proto__", { value: { x: 1 }, enumerable: true, configurable: true, writable: true });
    return validateArkademyDocument(doc);
  };
  const top = withProto((doc) => doc);
  check(
    "a __proto__ key at the top is refused with its path",
    !top.ok && top.errors.some((finding) => finding.path === "__proto__"),
    show(top),
  );
  const inUse = withProto((doc) => doc.uses[2]);
  check("a __proto__ key in a use is refused with its path", !inUse.ok && inUse.errors.some((finding) => finding.path === "uses[2].__proto__"), show(inUse));
  const deep = withProto((doc) => doc.uses[noted].note.source);
  check(
    "a __proto__ key deep in a note is refused with its path",
    !deep.ok && deep.errors.some((finding) => finding.path === `${NOTE}.source.__proto__`),
    show(deep),
  );
  const parsed = JSON.parse('{"__proto__": 1}');
  check("JSON.parse keeps __proto__ as an own key (what the walk relies on)", Object.hasOwn(parsed, "__proto__"));

  const { duplicateJsonKeys } = ark;
  check("duplicateJsonKeys is exported", typeof duplicateJsonKeys === "function");
  if (typeof duplicateJsonKeys === "function") {
    const text = fs.readFileSync(FIXTURE, "utf8");
    check("the fixture has no duplicate key", duplicateJsonKeys(text).length === 0, JSON.stringify(duplicateJsonKeys(text)));
    check(
      "a repeated top-level key, with its path",
      JSON.stringify(duplicateJsonKeys('{"open": [], "formatVersion": 1, "open": []}').map((f) => f.path)) === JSON.stringify(["open"]),
      JSON.stringify(duplicateJsonKeys('{"open": [], "formatVersion": 1, "open": []}')),
    );
    const nested = '{"uses": [{"text": "a"}, {"text": "b", "order": 1, "text": "c"}], "x": {"y": {"z": 1, "z": 2}}}';
    check(
      "repeated keys in an array item and deep in objects, each with its path",
      JSON.stringify(duplicateJsonKeys(nested).map((f) => f.path)) === JSON.stringify(["uses[1].text", "x.y.z"]),
      JSON.stringify(duplicateJsonKeys(nested)),
    );
    check("the same key in two objects is no repeat", duplicateJsonKeys('[{"a": 1}, {"a": 2}, {"b": {"a": 3}}]').length === 0);
    check("an escaped spelling of a key is the same key", duplicateJsonKeys('{"a": 1, "\\u0061": 2}').length === 1);
    check(
      "braces, quotes and colons inside strings do not confuse it",
      duplicateJsonKeys('{"a": "}{\\":,[", "b": ["{\\"a\\": 1}"], "c": {"a": "x"}}').length === 0,
    );
    check("a repeat is an error finding", duplicateJsonKeys('{"a": 1, "a": 2}')[0]?.level === "error");
  }
}

// --- Referential errors ------------------------------------------------------
expectError(
  "rule 1: a repeated company id",
  (doc) => doc.companies.push({ ...doc.companies[2], name: "Inkwell again" }),
  "companies[3].id",
);
expectError(
  "rule 1: a repeated entity id",
  (doc) => doc.entities.push({ id: "word-of-mouth", kind: "channel", label: "recommendations" }),
  `entities[${doc0.entities.length}].id`,
);
expectError(
  "rule 2: questions out of canonical order",
  (doc) => {
    const [first, second] = doc.tools[0].questions;
    doc.tools[0].questions[0] = second;
    doc.tools[0].questions[1] = first;
  },
  "tools[0].questions[0].key",
);
expectError("rule 2: eight questions", (doc) => doc.tools[0].questions.pop(), "tools[0].questions");
expectError("rule 3: an example naming no company", (doc) => doc.tools[0].examples.push("nobody"), "tools[0].examples[3]");
expectError("rule 3: a repeated example", (doc) => doc.tools[0].examples.push("tidewise"), "tools[0].examples[3]");
expectError(
  "rule 4: a use by a company that is not an example",
  (doc) => {
    doc.companies.push({ id: "spare", name: "Spare", oneLiner: "Not an example", simulation: false });
    doc.uses[0].company = "spare";
  },
  "uses[0].company",
);
expectError("rule 4: a use naming no entity", (doc) => (doc.uses[0].entity = "nothing-here"), "uses[0].entity");
expectError(
  "rule 4: a use whose entity is of another kind",
  (doc) => (doc.uses[useIndex("crumb-and-co", "seg", 0)].entity = "word-of-mouth"),
  `uses[${useIndex("crumb-and-co", "seg", 0)}].entity`,
);
expectError(
  "rule 5: a sixth answer to one question",
  (doc) => {
    doc.entities.push({ id: "oven-cleaning", kind: "activity", label: "cleaning the ovens" });
    doc.uses.push({ tool: BMC_TOOL_ID, company: "crumb-and-co", question: "ka", entity: "oven-cleaning", text: "cleaning the ovens", order: 5 });
  },
  `uses[${doc0.uses.length}]`,
);
expectError(
  "rule 5: a repeated order",
  (doc) => (doc.uses[useIndex("crumb-and-co", "ka", 1)].order = 0),
  `uses[${useIndex("crumb-and-co", "ka", 1)}].order`,
);
expectError(
  "rule 5: a repeated entity",
  (doc) => (doc.uses[useIndex("crumb-and-co", "ka", 1)].entity = "overnight-baking"),
  `uses[${useIndex("crumb-and-co", "ka", 1)}].entity`,
);
expectError(
  "rule 6: an open question by a company that is not an example",
  (doc) => (doc.open[0].company = "nobody"),
  "open[0].company",
);
expectError("rule 6: a repeated open question", (doc) => doc.open.push({ ...doc.open[0] }), "open[1]");
expectError(
  "rule 6: an open question the company also answers",
  (doc) => doc.open.push({ tool: BMC_TOOL_ID, company: "crumb-and-co", question: "seg" }),
  "open[1]",
);
expectError("rule 6: an unknown question key", (doc) => (doc.open[0].question = "risk"), "open[0].question");
{
  const result = mutate((doc) => (doc.tools[0].pitch.body[0] = "x".repeat(MAX_DOCUMENT_BYTES)));
  check(
    "rule 7: a document over the size limit is refused before it is parsed",
    !result.ok && result.errors.length === 1 && result.errors[0].path === "$" && /limit/.test(result.errors[0].message),
    show(result),
  );
}

// --- Warnings ----------------------------------------------------------------
expectWarning(
  "an example that neither answers nor leaves open a question",
  (doc) => (doc.open = []),
  "tools[0].examples[1]",
);
expectWarning(
  "a company the tool does not list among its examples",
  (doc) => doc.companies.push({ id: "spare", name: "Spare", oneLiner: "Not an example", simulation: false }),
  "companies[3]",
);
expectWarning(
  "a company dropped from the examples, with its uses and open questions",
  (doc) => {
    doc.tools[0].examples = doc.tools[0].examples.filter((id) => id !== "inkwell");
    doc.uses = doc.uses.filter((use) => use.company !== "inkwell");
    doc.open = doc.open.filter((open) => open.company !== "inkwell");
  },
  `companies[${doc0.companies.findIndex((company) => company.id === "inkwell")}]`,
);
expectWarning(
  "two entities of one kind sharing a label, whatever the case",
  (doc) => (doc.entities[unused].label = "Word of Mouth"),
  `entities[${unused}].label`,
);
expectWarning("a wording opening with The", (doc) => (doc.uses[0].text = "The households nearby"), "uses[0].text");
expectWarning("a wording in the first person", (doc) => (doc.uses[0].text = "households near our shop"), "uses[0].text");
expectWarning("a wording opening with and", (doc) => (doc.uses[0].text = "and the households nearby"), "uses[0].text");
// Labels are sentence-case chips: the opener, first-person and conjunction
// heuristics are for a use's wording only (spec § "Referential rules").
expectNoWarning("a label opening with We draws no warning", (doc) => (doc.entities[0].label = "We deliver"), "entities[0].label");
expectNoWarning("a label opening with The draws no warning", (doc) => (doc.entities[0].label = "The households nearby"), "entities[0].label");
expectNoWarning("a label in the first person draws no warning", (doc) => (doc.entities[0].label = "households near our shop"), "entities[0].label");
expectNoWarning("a label opening with and draws no warning", (doc) => (doc.entities[0].label = "and the households nearby"), "entities[0].label");
check("labelWarnings is exported", typeof ark.labelWarnings === "function");
check("labelWarnings ignores an opener", typeof ark.labelWarnings === "function" && ark.labelWarnings("We deliver").length === 0);
check("labelWarnings still flags a figure", typeof ark.labelWarnings === "function" && ark.labelWarnings("40% of households").length === 1);
expectWarning("a wording holding a percentage", (doc) => (doc.uses[0].text = "40% of households nearby"), "uses[0].text");
expectWarning("a wording holding a currency sign", (doc) => (doc.uses[0].text = "households paying $5 a week"), "uses[0].text");
expectWarning("a label holding a currency code", (doc) => (doc.entities[0].label = "households spending EUR 20"), "entities[0].label");
expectWarning("a wording holding a press claim", (doc) => (doc.uses[0].text = "reportedly the most loyal households"), "uses[0].text");
expectWarning("a wording quoting a source", (doc) => (doc.uses[0].text = "households, according to the survey"), "uses[0].text");
check("a digit alone is not a figure", wordingWarnings("a 3-step setup").length === 0);
check("a pound sign is a currency", wordingWarnings("bread at £2").length === 1);
check("the opener rule is case-sensitive", wordingWarnings("the households nearby").length === 0);
check("US is not a pronoun", wordingWarnings("households across the US").length === 0);
check("I is a pronoun", wordingWarnings("what I bake").length === 1);
check("a pronoun must be a whole word", wordingWarnings("business users").length === 0);

// --- Format upgrades ---------------------------------------------------------
{
  const doc = fixture();
  const same = upgradeArkademyDocument(doc, 1);
  check("format 1 needs no upgrade", same.ok === true && same.document === doc);
  const newer = upgradeArkademyDocument(doc, 2);
  check("a newer format is refused", newer.ok === false && /newer/.test(newer.message), JSON.stringify(newer));
  check("format 99 is refused", upgradeArkademyDocument(doc, 99).ok === false);
  check("format 0 is refused", upgradeArkademyDocument(doc, 0).ok === false);
  check("a fractional format is refused", upgradeArkademyDocument(doc, 1.5).ok === false);
}

// --- The index -----------------------------------------------------------------
{
  const { indexArkademy } = ark;
  const document = fixture();
  const index = indexArkademy(document);
  check("index: the document and its tool", index.document === document && index.tool === document.tools[0]);
  check("index: a company by id", index.company("tidewise")?.name === "Tidewise");
  check("index: an unknown company", index.company("nobody") === undefined);
  check("index: an entity by id", index.entity("word-of-mouth")?.kind === "channel");
  check("index: an unknown entity", index.entity("nothing-here") === undefined);
  check(
    "index: uses come back sorted by order, not file order",
    JSON.stringify(index.uses("tidewise", "ch").map((use) => use.text)) ===
      JSON.stringify(["anglers swapping tips on the pier", "app store search"]),
    JSON.stringify(index.uses("tidewise", "ch").map((use) => use.text)),
  );
  check(
    "index: all five answers of a full question",
    JSON.stringify(index.uses("crumb-and-co", "ka").map((use) => use.order)) === JSON.stringify([0, 1, 2, 3, 4]),
  );
  const copy = index.uses("tidewise", "ch");
  copy.pop();
  check("index: uses returns a fresh array each call", index.uses("tidewise", "ch").length === 2);
  check("index: an unanswered question has no uses", index.uses("tidewise", "rev").length === 0);
  check("index: an open question", index.isOpen("tidewise", "rev") === true);
  check("index: an answered question is not open", index.isOpen("crumb-and-co", "rev") === false);
  check(
    "index: an entity every example uses",
    JSON.stringify(index.usersOf("word-of-mouth")) === JSON.stringify(["crumb-and-co", "tidewise", "inkwell"]),
  );
  check("index: an entity two examples share", JSON.stringify(index.usersOf("app-stores")) === JSON.stringify(["tidewise", "inkwell"]));
  check("index: the other shared entity", JSON.stringify(index.usersOf("subscriptions")) === JSON.stringify(["crumb-and-co", "inkwell"]));
  check("index: an unused entity has no users", index.usersOf("pop-up-stalls").length === 0);
  const reordered = fixture();
  reordered.tools[0].examples = ["inkwell", "tidewise", "crumb-and-co"];
  check(
    "index: users follow the tool's example order",
    JSON.stringify(indexArkademy(reordered).usersOf("word-of-mouth")) === JSON.stringify(["inkwell", "tidewise", "crumb-and-co"]),
  );
}

// --- The upload script's check, spawned with no database ---------------------
{
  const { spawnSync } = require("child_process");
  const os = require("os");
  const UPLOAD = path.join(ROOT, "scripts", "arkademy", "upload.js");
  const env = { ...process.env };
  delete env.DATABASE_URL;
  delete env.ARKADEMY_CONTENT;
  const run = (...args) => spawnSync(process.execPath, [UPLOAD, ...args], { encoding: "utf8", env });

  const ok = run("check", FIXTURE);
  check("upload check: the fixture exits 0", ok.status === 0, ok.stderr || ok.stdout);
  check("upload check: it prints the fixture's warning", /entities\[\d+\]/.test(ok.stdout), ok.stdout);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arkademy-check-"));
  try {
    const brokenFile = path.join(dir, "broken.json");
    const broken = fixture();
    broken.uses[0].entity = "nothing-here";
    fs.writeFileSync(brokenFile, JSON.stringify(broken));
    const bad = run("check", brokenFile);
    check("upload check: a broken copy exits 1", bad.status === 1, `${bad.status} ${bad.stderr}`);
    check("upload check: it names the path", bad.stderr.includes("uses[0].entity"), bad.stderr);

    const nulFile = path.join(dir, "nul.json");
    const withNul = fixture();
    withNul.uses[0].text = "house\u0000holds";
    fs.writeFileSync(nulFile, JSON.stringify(withNul));
    const nul = run("check", nulFile);
    check(
      "upload check: a NUL in a text is refused by check, with its path and no stack trace",
      nul.status === 1 && nul.stderr.includes("uses[0].text") && /U\+0000/.test(nul.stderr) && !/\n\s+at /.test(nul.stderr),
      `${nul.status} ${nul.stderr}`,
    );

    const dupFile = path.join(dir, "duplicate.json");
    const dupText = JSON.stringify(fixture(), null, 2).replace('"formatVersion": 1,', '"formatVersion": 1,\n  "open": [],');
    fs.writeFileSync(dupFile, dupText);
    const dup = run("check", dupFile);
    check("upload check: a repeated key is refused with its path", dup.status === 1 && /\bopen\b/.test(dup.stderr) && /repeat/.test(dup.stderr), `${dup.status} ${dup.stderr}`);
    const protoFile = path.join(dir, "proto.json");
    fs.writeFileSync(protoFile, JSON.stringify(fixture()).replace('{"tool":"business-model-canvas",', '{"__proto__": {"x": 1}, "tool":"business-model-canvas",'));
    const proto = run("check", protoFile);
    check("upload check: a __proto__ key is refused with its path", proto.status === 1 && proto.stderr.includes("uses[0].__proto__"), `${proto.status} ${proto.stderr}`);

    const notJson = path.join(dir, "not-json.json");
    fs.writeFileSync(notJson, "{ nope");
    check("upload check: a file that is not JSON exits 1", run("check", notJson).status === 1);
    check("upload check: a missing file exits 1", run("check", path.join(dir, "missing.json")).status === 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  check("upload: no command prints the usage and exits 2", run().status === 2);
  check("upload: an option a command does not take exits 2", run("check", "--yes").status === 2);
  check("upload: the script cleans up its build directory", leftoverBuildDirs().length === 0, JSON.stringify(leftoverBuildDirs()));
}

// --- The upload script's helpers, required in-process ---------------------------
// Requiring upload.js builds nothing: lib/arkademy/ is loaded on first use.
const upload = require(path.join(ROOT, "scripts", "arkademy", "upload.js"));
{
  const { describeError } = upload;
  check("describeError is exported", typeof describeError === "function");
  if (typeof describeError === "function") {
    check("an error's message", describeError(new Error("password authentication failed")) === "password authentication failed");
    const refused = Object.assign(new AggregateError([
      Object.assign(new Error("connect ECONNREFUSED ::1:5999"), { code: "ECONNREFUSED" }),
      Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5999"), { code: "ECONNREFUSED" }),
    ], ""), { code: "ECONNREFUSED" });
    check(
      "an aggregate error with no message: its errors' messages, joined",
      describeError(refused) === "connect ECONNREFUSED ::1:5999; connect ECONNREFUSED 127.0.0.1:5999",
      describeError(refused),
    );
    check("an error with only a code", describeError(Object.assign(new Error(""), { code: "ETIMEDOUT" })) === "ETIMEDOUT");
    check("an empty aggregate falls back to its code", describeError(Object.assign(new AggregateError([], ""), { code: "ENETUNREACH" })) === "ENETUNREACH");
    check("nothing at all still says something", describeError(new Error("")).length > 0 && describeError(undefined).length > 0);
  }
}
{
  const { spawnSync } = require("child_process");
  const UPLOAD = path.join(ROOT, "scripts", "arkademy", "upload.js");
  // Port 1 on this machine: nothing listens, so the driver is refused at once.
  const env = { ...process.env, DATABASE_URL: "postgres://nobody@localhost:1/nothing" };
  delete env.PGHOST;
  const result = spawnSync(process.execPath, [UPLOAD, "status"], { encoding: "utf8", env });
  check(
    "upload: an unreachable database names the reason",
    result.status === 1 && /could not connect to localhost: \S/.test(result.stderr) && /ECONNREFUSED/.test(result.stderr),
    `${result.status} ${result.stderr}`,
  );
}

// --- parseArgs ------------------------------------------------------------------
{
  const { parseArgs } = upload;
  const parse = (...argv) => {
    try {
      return { args: parseArgs(argv) };
    } catch (err) {
      return { code: err.code, message: err.message };
    }
  };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const usage = (name, result, pattern) =>
    check(name, result.code === 2 && (pattern === undefined || pattern.test(result.message)), JSON.stringify(result));

  check("parseArgs: check with a file", same(parse("check", "a.json").args, { command: "check", file: "a.json", note: null, yes: false }), JSON.stringify(parse("check", "a.json")));
  check("parseArgs: check with no file", parse("check").args?.file === null);
  check(
    "parseArgs: publish with a note and --yes",
    same(parse("publish", "a.json", "--note", "first cut", "--yes").args, { command: "publish", file: "a.json", note: "first cut", yes: true }),
    JSON.stringify(parse("publish", "a.json", "--note", "first cut", "--yes")),
  );
  check("parseArgs: --note=value", parse("publish", "--note=first cut").args?.note === "first cut");
  check("parseArgs: --note=--yes is a note, not the flag", parse("publish", "--note=--yes").args?.note === "--yes" && parse("publish", "--note=--yes").args?.yes === false);
  check("parseArgs: an empty --note= is an empty note", parse("publish", "--note=").args?.note === "");
  usage("parseArgs: --note --yes does not take --yes as the note", parse("publish", "--note", "--yes"), /--note needs a value/);
  usage("parseArgs: --note at the end needs a value", parse("publish", "--note"), /--note needs a value/);
  check("parseArgs: rollback --to 3", parse("rollback", "--to", "3").args?.to === 3);
  check("parseArgs: rollback --to=3 --yes", parse("rollback", "--to=3", "--yes").args?.to === 3 && parse("rollback", "--to=3", "--yes").args?.yes === true);
  check("parseArgs: rollback with no --to", parse("rollback").args?.to === undefined);
  check("parseArgs: the largest version Postgres can hold", parse("rollback", "--to", "2147483647").args?.to === 2147483647);
  usage("parseArgs: --to past what Postgres can hold", parse("rollback", "--to", "99999999999"), /--to/);
  usage("parseArgs: --to one past int4", parse("rollback", "--to", "2147483648"), /--to/);
  usage("parseArgs: --to 0", parse("rollback", "--to", "0"), /--to/);
  usage("parseArgs: --to -1", parse("rollback", "--to", "-1"), /--to/);
  usage("parseArgs: --to 1.5", parse("rollback", "--to", "1.5"), /--to/);
  usage("parseArgs: --to --yes does not take --yes as the version", parse("rollback", "--to", "--yes"), /--to needs a value/);
  usage("parseArgs: no command", parse());
  usage("parseArgs: --help", parse("--help"));
  usage("parseArgs: an unknown command", parse("push"), /unknown command/);
  usage("parseArgs: two files", parse("check", "a.json", "b.json"), /unexpected argument/);
  usage("parseArgs: status takes no file", parse("status", "a.json"), /unexpected argument/);
  usage("parseArgs: status takes no --yes", parse("status", "--yes"), /takes no --yes/);
  usage("parseArgs: check takes no --note", parse("check", "--note", "x"), /takes no --note/);
  usage("parseArgs: publish takes no --to", parse("publish", "--to", "2"), /takes no --to/);
}

// --- The production write guard ---------------------------------------------------
// Local or remote is decided from the host and database the driver will
// actually use (pg's resolved Client), never from a second parse of the URL.
{
  const { databaseTarget, isLocalHost, announce } = upload;
  check("databaseTarget, isLocalHost and announce are exported", [databaseTarget, isLocalHost, announce].every((fn) => typeof fn === "function"));
  if ([databaseTarget, isLocalHost, announce].every((fn) => typeof fn === "function")) {
    const withEnv = (vars, fn) => {
      const saved = {};
      for (const key of Object.keys(vars)) {
        saved[key] = process.env[key];
        if (vars[key] === undefined) delete process.env[key];
        else process.env[key] = vars[key];
      }
      try {
        return fn();
      } finally {
        for (const key of Object.keys(saved)) {
          if (saved[key] === undefined) delete process.env[key];
          else process.env[key] = saved[key];
        }
      }
    };
    const target = (url, env = {}) => withEnv({ PGHOST: undefined, PGDATABASE: undefined, ...env }, () => databaseTarget(url));
    const cases = [
      ["a ?host= parameter overrides the URL's host", "postgres://u:pw@localhost/db?host=prod.example", {}, "prod.example", false],
      ["PGHOST fills a URL with no host", "postgres:///db", { PGHOST: "prod.example" }, "prod.example", false],
      ["no host at all is localhost", "postgres:///db", {}, "localhost", true],
      ["localhost with a port", "postgres://u@localhost:5931/db", {}, "localhost", true],
      ["127.0.0.1", "postgres://u@127.0.0.1/db", {}, "127.0.0.1", true],
      ["any 127/8 address", "postgres://u@127.0.0.2/db", {}, "127.0.0.2", true],
      ["::1", "postgres://u@[::1]/db", {}, "[::1]", true],
      ["a Unix socket in the host", "postgres://u@%2Ftmp%2Fpg/db", {}, "/tmp/pg", true],
      ["a Unix socket in ?host=", "postgres://u@db.example/db?host=/var/run/postgresql", {}, "/var/run/postgresql", true],
      ["a remote host", "postgres://u:pw@ep-cool-name.eu-central-1.aws.neon.tech/neondb", {}, "ep-cool-name.eu-central-1.aws.neon.tech", false],
      ["a name that merely starts with localhost", "postgres://u@localhost.prod.example/db", {}, "localhost.prod.example", false],
      ["PGHOST does not override a URL's own host", "postgres://u@localhost/db", { PGHOST: "prod.example" }, "localhost", true],
    ];
    for (const [name, url, env, host, local] of cases) {
      const resolved = target(url, env);
      check(`guard: ${name}`, resolved.host === host && resolved.local === local, JSON.stringify({ host: resolved.host, local: resolved.local }));
    }
    check("guard: the database is the driver's", target("postgres://u@localhost/arkaik_test").database === "arkaik_test");
    check("guard: PGDATABASE fills a URL with none", target("postgres://u@localhost", { PGDATABASE: "fromenv" }).database === "fromenv");
    check("isLocalHost: the long form of ::1", isLocalHost("0:0:0:0:0:0:0:1") && isLocalHost("[::1]") && isLocalHost("::ffff:127.0.0.1"));
    check("isLocalHost: LOCALHOST in capitals", isLocalHost("LOCALHOST"));
    check("isLocalHost: neither 10.0.0.1 nor 0.0.0.0 nor an empty host", !isLocalHost("10.0.0.1") && !isLocalHost("0.0.0.0") && !isLocalHost(""));

    const captured = [];
    const realLog = console.log;
    const attempt = (url, env, options) => {
      console.log = (line) => captured.push(String(line));
      try {
        announce(target(url, env), options);
        return { ok: true };
      } catch (err) {
        return { ok: false, code: err.code, message: err.message };
      } finally {
        console.log = realLog;
      }
    };
    captured.length = 0;
    const hidden = attempt("postgres://u:pw@localhost/db?host=prod.example", {}, { writes: true, yes: false });
    check(
      "guard: a ?host= override refuses a write without --yes",
      !hidden.ok && hidden.code === 1 && /prod\.example is not this machine/.test(hidden.message),
      JSON.stringify(hidden),
    );
    check("guard: and announces the host the driver will use", captured.some((line) => /on prod\.example/.test(line)) && !captured.some((line) => /on localhost/.test(line)), JSON.stringify(captured));
    check("guard: the announcement never holds the password", captured.every((line) => !line.includes("pw")), JSON.stringify(captured));
    captured.length = 0;
    const viaEnv = attempt("postgres:///db", { PGHOST: "prod.example" }, { writes: true, yes: false });
    check("guard: PGHOST refuses a write without --yes", !viaEnv.ok && /prod\.example is not this machine/.test(viaEnv.message), JSON.stringify(viaEnv));
    check("guard: --yes lets a remote write through", attempt("postgres:///db", { PGHOST: "prod.example" }, { writes: true, yes: true }).ok);
    check("guard: a read needs no --yes", attempt("postgres:///db", { PGHOST: "prod.example" }, { writes: false }).ok);
    check("guard: a local write needs no --yes", attempt("postgres://u@localhost:5931/db", {}, { writes: true, yes: false }).ok);
    check("guard: a socket write needs no --yes", attempt("postgres://u@%2Ftmp%2Fpg/db", {}, { writes: true, yes: false }).ok);
  }

  const { spawnSync } = require("child_process");
  const UPLOAD = path.join(ROOT, "scripts", "arkademy", "upload.js");
  for (const [name, env] of [
    ["?host=", { DATABASE_URL: "postgres://u:pw@localhost/db?host=prod.example" }],
    ["PGHOST", { DATABASE_URL: "postgres:///db", PGHOST: "prod.example" }],
  ]) {
    const result = spawnSync(process.execPath, [UPLOAD, "publish", FIXTURE], { encoding: "utf8", env: { ...process.env, PGHOST: "", ...env } });
    check(
      `upload: publish through ${name} to another host refuses without --yes`,
      result.status === 1 && /database: db on prod\.example/.test(result.stdout) && /prod\.example is not this machine; add --yes/.test(result.stderr),
      `${result.status} ${result.stdout.split("\n").slice(-2).join(" / ")} ${result.stderr}`,
    );
  }
}

// --- Where the production connection string lives ------------------------------
// Next loads .env.production.local for every local `next build`/`next start`,
// so a production DATABASE_URL kept there would point a local production
// server at production. The guide's file is one Next never loads.
{
  const { spawnSync } = require("child_process");
  const os = require("os");
  const UPLOAD = path.join(ROOT, "scripts", "arkademy", "upload.js");
  const env = { ...process.env };
  delete env.DATABASE_URL;
  const unset = spawnSync(process.execPath, [UPLOAD, "status"], { encoding: "utf8", env });
  check(
    "upload: the hint names .env.arkademy-prod, never .env.production.local",
    unset.status === 1 && unset.stderr.includes("--env-file=.env.arkademy-prod") && !unset.stderr.includes(".env.production.local"),
    unset.stderr,
  );
  const guide = fs.readFileSync(path.join(ROOT, "docs", "arkademy.md"), "utf8");
  check("the operator guide keeps the production URL in .env.arkademy-prod", guide.includes("--env-file=.env.arkademy-prod") && !guide.includes("--env-file=.env.production.local"));

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arkademy-env-"));
  try {
    fs.writeFileSync(path.join(dir, ".env.arkademy-prod"), "ARKADEMY_ENV_PROBE=loaded\n");
    const probe = `
      const { loadEnvConfig } = require(${JSON.stringify(require.resolve("@next/env", { paths: [ROOT] }))});
      const seen = [];
      for (const dev of [false, true]) {
        const { loadedEnvFiles } = loadEnvConfig(${JSON.stringify(dir)}, dev, { info() {}, error() {} }, true);
        seen.push(...loadedEnvFiles.map((file) => file.path));
      }
      process.stdout.write(JSON.stringify({ seen, probe: process.env.ARKADEMY_ENV_PROBE ?? null }));
    `;
    const out = spawnSync(process.execPath, ["-e", probe], { encoding: "utf8", env: { ...env, NODE_ENV: "production" } });
    let parsed = null;
    try {
      parsed = JSON.parse(out.stdout);
    } catch {}
    check("Next never loads .env.arkademy-prod (production or development)", parsed && parsed.seen.length === 0 && parsed.probe === null, out.stdout + out.stderr);
    fs.writeFileSync(path.join(dir, ".env.production.local"), "ARKADEMY_ENV_PROBE=loaded\n");
    const control = spawnSync(process.execPath, ["-e", probe], { encoding: "utf8", env: { ...env, NODE_ENV: "production" } });
    check("…while it does load .env.production.local (the control)", /\.env\.production\.local/.test(control.stdout), control.stdout + control.stderr);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const ignored = spawnSync("git", ["check-ignore", "-q", ".env.arkademy-prod"], { cwd: ROOT });
  check("git ignores .env.arkademy-prod", ignored.status === 0, String(ignored.status));
}

// --- Files the script cannot read as a document ----------------------------------
{
  const { spawnSync } = require("child_process");
  const os = require("os");
  const UPLOAD = path.join(ROOT, "scripts", "arkademy", "upload.js");
  const env = { ...process.env };
  delete env.DATABASE_URL;
  const run = (...args) => spawnSync(process.execPath, [UPLOAD, ...args], { encoding: "utf8", env });
  const noStack = (result) => !/\n\s+at /.test(result.stderr);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arkademy-files-"));
  try {
    const bom = path.join(dir, "bom.json");
    fs.writeFileSync(bom, `\ufeff${JSON.stringify(fixture())}`);
    const withBom = run("check", bom);
    check(
      "upload: a byte-order mark gets its own message",
      withBom.status === 1 && /byte-order mark/.test(withBom.stderr) && !/is not JSON/.test(withBom.stderr) && noStack(withBom),
      `${withBom.status} ${withBom.stderr}`,
    );
    const folder = path.join(dir, "folder.json");
    fs.mkdirSync(folder);
    const isDir = run("check", folder);
    check(
      "upload: a directory gets its own message",
      isDir.status === 1 && /is a directory/.test(isDir.stderr) && !/is not JSON/.test(isDir.stderr) && noStack(isDir),
      `${isDir.status} ${isDir.stderr}`,
    );
    const locked = path.join(dir, "locked.json");
    fs.writeFileSync(locked, JSON.stringify(fixture()));
    fs.chmodSync(locked, 0o000);
    let readable = true;
    try {
      fs.readFileSync(locked);
    } catch {
      readable = false;
    }
    if (readable) {
      console.log("SKIP: upload: an unreadable file (this user reads any file)");
    } else {
      const unreadable = run("check", locked);
      check(
        "upload: an unreadable file gets its own message",
        unreadable.status === 1 && /cannot be read/.test(unreadable.stderr) && /EACCES/.test(unreadable.stderr) && !/is not JSON/.test(unreadable.stderr) && noStack(unreadable),
        `${unreadable.status} ${unreadable.stderr}`,
      );
    }
    fs.chmodSync(locked, 0o600);
    const latin1 = path.join(dir, "latin1.json");
    fs.writeFileSync(latin1, Buffer.concat([Buffer.from('{"a": "cr'), Buffer.from([0xe8]), Buffer.from('me"}')]));
    const badUtf8 = run("check", latin1);
    check("upload: a file that is not UTF-8 says so", badUtf8.status === 1 && /not UTF-8/.test(badUtf8.stderr) && noStack(badUtf8), `${badUtf8.status} ${badUtf8.stderr}`);
    const notJson = path.join(dir, "not-json.json");
    fs.writeFileSync(notJson, "{ nope");
    const plain = run("check", notJson);
    check("upload: a file that is not JSON still says so", plain.status === 1 && /is not JSON/.test(plain.stderr) && noStack(plain), `${plain.status} ${plain.stderr}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const bigTo = spawnSync(process.execPath, [UPLOAD, "rollback", "--to", "99999999999"], {
    encoding: "utf8",
    env: { ...env, DATABASE_URL: "postgres://nobody@localhost:1/nothing" },
  });
  check("upload: --to 99999999999 is a usage mistake, not a stack trace", bigTo.status === 2 && noStack(bigTo), `${bigTo.status} ${bigTo.stderr}`);
  const noteYes = run("publish", FIXTURE, "--note", "--yes");
  check("upload: publish --note --yes is a usage mistake", noteYes.status === 2 && /--note needs a value/.test(noteYes.stderr), `${noteYes.status} ${noteYes.stderr}`);
}

// --- Making a write live: the revalidate call ------------------------------------
async function revalidationCalls() {
  const { requestRevalidation, revalidationLine } = upload;
  check("requestRevalidation and revalidationLine are exported", typeof requestRevalidation === "function" && typeof revalidationLine === "function");
  if (typeof requestRevalidation !== "function" || typeof revalidationLine !== "function") return;
  const SECRET = "s3cret-value-never-printed";
  const calls = [];
  const answering = (status) => async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(null, { status: status === 204 ? 204 : status });
  };

  calls.length = 0;
  const none = await requestRevalidation({ siteUrl: undefined, secret: undefined, fetchImpl: answering(204) });
  check("revalidate: with neither variable, nothing is called", none.status === "unconfigured" && calls.length === 0, JSON.stringify(none));
  const noneLine = revalidationLine(none);
  check(
    "revalidate: and the line says how long and how to set the two variables",
    /within an hour/.test(noneLine) && /2 minutes/.test(noneLine) && /ARKADEMY_SITE_URL/.test(noneLine) && /ARKADEMY_REVALIDATE_SECRET/.test(noneLine) && !/live now/.test(noneLine),
    noneLine,
  );
  const half = await requestRevalidation({ siteUrl: "https://arkaik.example", secret: undefined, fetchImpl: answering(204) });
  check("revalidate: one variable alone is not enough, and the line names the missing one", half.status === "unconfigured" && /ARKADEMY_REVALIDATE_SECRET is not set/.test(revalidationLine(half)), revalidationLine(half));

  calls.length = 0;
  const live = await requestRevalidation({ siteUrl: "https://arkaik.example", secret: SECRET, fetchImpl: answering(204) });
  check("revalidate: a 204 means live now", live.status === "live" && /^live now/.test(revalidationLine(live)), JSON.stringify(live));
  const call = calls[0];
  check(
    "revalidate: one POST to /api/arkademy/revalidate with the bearer token, redirects not followed",
    calls.length === 1 &&
      call.url === "https://arkaik.example/api/arkademy/revalidate" &&
      call.init.method === "POST" &&
      new Headers(call.init.headers).get("authorization") === `Bearer ${SECRET}` &&
      call.init.redirect === "manual",
    JSON.stringify(calls),
  );
  check("revalidate: a site URL with a trailing slash or a path still reaches the route", (await (async () => {
    calls.length = 0;
    await requestRevalidation({ siteUrl: "https://arkaik.example/some/page/", secret: SECRET, fetchImpl: answering(204) });
    return calls[0]?.url === "https://arkaik.example/api/arkademy/revalidate";
  })()));

  for (const [status, pattern] of [
    [401, /secret does not match/],
    [404, /not set on that deployment/],
    [500, /answered 500/],
    [308, /answered 308/],
  ]) {
    const failed = await requestRevalidation({ siteUrl: "https://arkaik.example", secret: SECRET, fetchImpl: answering(status) });
    const line = revalidationLine(failed);
    check(`revalidate: a ${status} is a failure that says why and how long`, failed.status === "failed" && pattern.test(line) && /within an hour/.test(line) && !/^live now/.test(line), line);
  }
  const thrown = await requestRevalidation({
    siteUrl: "https://arkaik.example",
    secret: SECRET,
    fetchImpl: async () => {
      throw Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("getaddrinfo ENOTFOUND arkaik.example"), { code: "ENOTFOUND" }) });
    },
  });
  check("revalidate: a network failure says why", thrown.status === "failed" && /ENOTFOUND/.test(revalidationLine(thrown)), revalidationLine(thrown));

  calls.length = 0;
  const plain = await requestRevalidation({ siteUrl: "http://arkaik.example", secret: SECRET, fetchImpl: answering(204) });
  check("revalidate: http to another machine is refused before the secret leaves", plain.status === "failed" && calls.length === 0 && /https/.test(revalidationLine(plain)), revalidationLine(plain));
  const local = await requestRevalidation({ siteUrl: "http://localhost:4931", secret: SECRET, fetchImpl: answering(204) });
  check("revalidate: http to this machine is fine", local.status === "live", JSON.stringify(local));
  const junk = await requestRevalidation({ siteUrl: "not a url", secret: SECRET, fetchImpl: answering(204) });
  check("revalidate: a site URL that is not a URL is a failure, not a crash", junk.status === "failed", JSON.stringify(junk));
  const lines = [none, half, live, plain, thrown].map(revalidationLine).join("\n");
  check("revalidate: no line ever holds the secret", !lines.includes(SECRET));
}

// --- Two runs at once ---------------------------------------------------------
// Each run builds lib/arkademy/ into a directory of its own and removes only
// that one, so concurrent runs never delete each other's modules.
async function concurrentRuns() {
  const { spawn } = require("child_process");
  const UPLOAD = path.join(ROOT, "scripts", "arkademy", "upload.js");
  const env = { ...process.env };
  delete env.DATABASE_URL;
  const once = () =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, [UPLOAD, "check", FIXTURE], { env });
      let stderr = "";
      child.stderr.on("data", (chunk) => (stderr += chunk));
      child.on("close", (status) => resolve({ status, stderr }));
    });
  const runs = await Promise.all(Array.from({ length: 6 }, once));
  check(
    "upload: six checks at once all succeed",
    runs.every((run) => run.status === 0),
    JSON.stringify(runs.filter((run) => run.status !== 0)).slice(0, 400),
  );
  check("upload: and leave no build directory behind", leftoverBuildDirs().length === 0, JSON.stringify(leftoverBuildDirs()));
}

function leftoverBuildDirs() {
  return fs.readdirSync(path.join(ROOT, "scripts", "arkademy")).filter((name) => name.startsWith(".build"));
}

revalidationCalls()
  .then(concurrentRuns)
  .then(() => {
    cleanup();
    if (failures > 0) {
      console.log(`\n${failures} arkademy-schema test(s) failed`);
      process.exit(1);
    }
    console.log("\nAll arkademy-schema tests passed.");
  });
