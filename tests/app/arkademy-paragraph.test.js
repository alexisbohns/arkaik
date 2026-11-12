#!/usr/bin/env node

/**
 * The cover's pure side (lib/arkademy/): the paragraph rule, an example's
 * canvas, the baseline prompt's display form, the tool paths and cards, each
 * page's metadata; then the components rendered on the server
 * (react-dom/server, through tests/app/load-arkademy-tsx.js) and the real
 * sitemap function's Arkademy URLs. DB-free, so it runs in CI's `build` job.
 *
 * Cases that the fictional fixture (tests/fixtures/arkademy/document.json)
 * does not hold are built in memory; the fixture itself is never edited.
 */

const fs = require("fs");
const path = require("path");
const { loadArkademy, cleanup } = require("./load-arkademy");

const ROOT = path.join(__dirname, "..", "..");
const FIXTURE = path.join(ROOT, "tests", "fixtures", "arkademy", "document.json");

const {
  BMC_QUESTION_KEYS,
  PROMPT_TOKEN,
  indexArkademy,
  validateArkademyDocument,
  SUBJECT_PRONOUN,
  DEFAULT_SUBJECT,
  cleanAnswer,
  joinAnswers,
  joinsWithSemicolons,
  noteDate,
  noteText,
  composeParagraph,
  paragraphText,
  paragraphTextWithNotes,
  clampThrough,
  displayAnswers,
  exampleCanvas,
  PROMPT_PLACEHOLDER,
  promptForDisplay,
  promptLines,
  ARKADEMY_PATH,
  ARKADEMY_TOOL_PATHS,
  BMC_YOURS_PATH,
  bmcTourPath,
  arkademyToolCards,
  ARKADEMY_SITE_URL,
  ARKADEMY_INTRO,
  BMC_FALLBACK_TITLE,
  arkademyShellMetadata,
  bmcCoverMetadata,
  bmcTourMetadata,
  bmcYoursMetadata,
} = loadArkademy();

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
const validation = validateArkademyDocument(document, { now: new Date("2026-11-12T00:00:00Z") });
check("the fixture validates", validation.ok, JSON.stringify(validation.errors));
const tool = document.tools[0];
const questions = tool.questions;
const index = indexArkademy(validation.document);

/** Nine questions, every one empty, with `answers` and `open` set per key. */
function state(answers = {}, open = []) {
  return BMC_QUESTION_KEYS.map((key) => ({
    key,
    answers: (answers[key] ?? []).map((answer) => (typeof answer === "string" ? { text: answer } : answer)),
    open: open.includes(key),
  }));
}
const sentences = (segments) => segments.filter((s) => s.kind === "sentence").map((s) => s.text);
const NOTE = {
  text: "about 40 tonnes a year",
  source: { name: "Example Mill, annual report", url: "https://mill.example/report", date: "2026-02-01", dateKind: "published" },
};
const UNDATED = {
  text: "listed as a partner",
  source: { name: "Example Mill, partners page", url: "https://mill.example/partners", date: "2026-10-01", dateKind: "accessed" },
};

// --- cleanAnswer -------------------------------------------------------------
same("clean: trims", cleanAnswer("  bread  "), "bread");
same("clean: drops a trailing full stop", cleanAnswer("bread."), "bread");
same("clean: drops dots and spaces mixed", cleanAnswer("bread . . "), "bread");
same("clean: drops a trailing exclamation mark", cleanAnswer("fast!"), "fast");
same("clean: drops a trailing question mark and a run of marks", cleanAnswer("really?!.. "), "really");
same("clean: drops a trailing ellipsis character", cleanAnswer("and more…"), "and more");
same("clean: drops a trailing semicolon, colon or comma", [cleanAnswer("a;"), cleanAnswer("b :"), cleanAnswer("c, ")], ["a", "b", "c"]);
same("clean: keeps punctuation inside", cleanAnswer("hey! you, there"), "hey! you, there");
same("clean: keeps a closing bracket, a percent sign and quotes", [cleanAnswer("maps (beta)"), cleanAnswer("50%"), cleanAnswer('"quoted"')], ["maps (beta)", "50%", '"quoted"']);
same("clean: keeps an inner full stop", cleanAnswer("v2.0 maps"), "v2.0 maps");
same("clean: only dots becomes empty", cleanAnswer("..."), "");
same("clean: only marks becomes empty", cleanAnswer(" ?! … "), "");

// --- joinAnswers and the semicolon triggers ------------------------------------
same("join: none", joinAnswers([]), "");
same("join: one", joinAnswers(["a"]), "a");
same("join: two", joinAnswers(["a", "b"]), "a and b");
same("join: three", joinAnswers(["a", "b", "c"]), "a, b and c");
same("join: four", joinAnswers(["a", "b", "c", "d"]), "a, b, c and d");
same("join: five", joinAnswers(["a", "b", "c", "d", "e"]), "a, b, c, d and e");
same("join: one item with a comma reads as itself", joinAnswers(["a, still"]), "a, still");
same("join: two, a comma inside", joinAnswers(["a, still", "b"]), "a, still; and b");
same("join: three, a comma inside", joinAnswers(["a", "b, still", "c"]), "a; b, still; and c");
same("join: five, a comma inside", joinAnswers(["a", "b", "c", "d", "e, f"]), "a; b; c; d; and e, f");
same("join: two, an 'and' inside and no comma: a comma before the last 'and'", joinAnswers(["flour and butter", "wages"]), "flour and butter, and wages");
same("join: two, a comma in the second", joinAnswers(["a", "b, still"]), "a; and b, still");
same("join: three, an 'and' inside", joinAnswers(["a", "rock and roll", "c"]), "a; rock and roll; and c");
same("join: 'and' inside a word is not 'and'", joinAnswers(["sandwiches", "brandy", "candles"]), "sandwiches, brandy and candles");
same("join: a hyphenated 'and' is not 'and'", joinAnswers(["black-and-white prints", "posters"]), "black-and-white prints and posters");
same("join: an explicit semicolon flag wins", joinAnswers(["a", "b", "c"], true), "a; b; and c");
same("join: an explicit semicolon flag on two items without a comma", joinAnswers(["a", "b"], true), "a, and b");
same("join: an explicit comma flag wins", joinAnswers(["a, b", "c"], false), "a, b and c");
check("semicolons: a plain list joins with commas", !joinsWithSemicolons([{ text: "a" }, { text: "b" }]));
check("semicolons: a comma triggers them", joinsWithSemicolons([{ text: "a, b" }, { text: "c" }]));
check("semicolons: 'and' as a word triggers them", joinsWithSemicolons([{ text: "a and b" }, { text: "c" }]));
check("semicolons: a capitalised 'And' triggers them", joinsWithSemicolons([{ text: "Rock And roll" }, { text: "c" }]));
check("semicolons: 'AND' triggers them", joinsWithSemicolons([{ text: "black AND white" }, { text: "c" }]));
check("semicolons: an 'And' at the start triggers them", joinsWithSemicolons([{ text: "And more" }, { text: "c" }]));
check("semicolons: ' & ' triggers them", joinsWithSemicolons([{ text: "Crumb & Co" }, { text: "c" }]));
check("semicolons: an '&' inside a word does not", !joinsWithSemicolons([{ text: "R&D" }, { text: "AT&T" }, { text: "c" }]));
check(
  "semicolons: 'and' inside a word does not, whatever its case",
  !joinsWithSemicolons([{ text: "brand" }, { text: "Sandbox" }, { text: "ANDROID apps" }, { text: "black-and-white" }]),
);
same("join: three, an 'And' inside", joinAnswers(["a", "Rock And Roll", "c"]), "a; Rock And Roll; and c");
same("join: three, an '&' inside", joinAnswers(["a", "Crumb & Co", "c"]), "a; Crumb & Co; and c");
// A note adds no words to the sentence on screen (it is a marker), so it plays no part in the join.
check("semicolons: a note does not trigger them", !joinsWithSemicolons([{ text: "a", note: NOTE }, { text: "c" }]));
check(
  "semicolons: nor does a note whose own text holds a comma and 'and'",
  !joinsWithSemicolons([{ text: "a", note: { ...NOTE, text: "flour, butter and eggs" } }, { text: "c" }]),
);

// --- notes -------------------------------------------------------------------
same("noteDate: published", noteDate(NOTE), "2026-02-01");
same("noteDate: accessed", noteDate(UNDATED), "read on 2026-10-01");
same("noteText: published", noteText(NOTE), "about 40 tonnes a year. Source: Example Mill, annual report, 2026-02-01");
same("noteText: accessed", noteText(UNDATED), "listed as a partner. Source: Example Mill, partners page, read on 2026-10-01");
check("noteText: no semicolon, the list's own separator", !noteText(NOTE).includes(";") && !noteText(UNDATED).includes(";"));

// --- composeParagraph: subject, pronoun, templates ------------------------------
{
  const all = state({
    seg: ["neighbours"],
    vp: ["warm bread."],
    ch: ["word of mouth"],
    cr: ["a newsletter"],
    rev: ["subscriptions"],
    kr: ["bakers"],
    ka: ["baking"],
    kp: ["millers"],
    cost: ["flour"],
  });
  const segments = composeParagraph({ questions, state: all, subject: "Crumb & Co" });
  same("compose: nine sentences in canonical order", segments.map((s) => s.question), BMC_QUESTION_KEYS);
  same("compose: the subject opens the first sentence", segments[0].text, "Crumb & Co is for neighbours.");
  same("compose: the pronoun after it, the answer cleaned", segments[1].text, `${SUBJECT_PRONOUN} offers warm bread.`);
  same("compose: a template without {S}", segments[4].text, "On money: subscriptions.");
  same("compose: the singular cost template at one answer", segments[8].text, "The main cost is flour.");
  same(
    "compose: a sentence with no note is one text part",
    segments[0].parts,
    [{ kind: "text", text: "Crumb & Co is for neighbours." }],
  );
}
{
  const segments = composeParagraph({ questions, state: state({ rev: ["fees"], kr: ["bakers"], ka: ["baking"] }), subject: "Crumb & Co" });
  same(
    "compose: a no-subject template first leaves the name for the next",
    sentences(segments),
    ["On money: fees.", "Crumb & Co relies on bakers.", "It spends its days on baking."],
  );
}
{
  const segments = composeParagraph({ questions, state: state({ seg: ["people"] }), subject: "   " });
  same("compose: an empty subject becomes the default", segments[0].text, `${DEFAULT_SUBJECT} is for people.`);
  const named = composeParagraph({ questions, state: state({ seg: ["people"] }), subject: "  Tidewise " });
  same("compose: the subject is trimmed", named[0].text, "Tidewise is for people.");
}
{
  const two = composeParagraph({ questions, state: state({ cost: ["flour", "wages"] }), subject: "X" });
  same("compose: sentencePlural at two answers", two[8].text, "The main costs are flour and wages.");
  const vp = composeParagraph({ questions, state: state({ vp: ["a", "b"] }), subject: "X" });
  same("compose: no sentencePlural keeps the sentence at two answers", vp[1].text, "X offers a and b.");
}

{
  // String.prototype.replace reads $&, $', $` and $$ in a string replacement as patterns.
  const cash = composeParagraph({ questions, state: state({ seg: ["people"] }), subject: "Ca$$h App" });
  same("compose: a $$ in the subject is literal", cash[0].text, "Ca$$h App is for people.");
  const pays = composeParagraph({ questions, state: state({ seg: ["people"] }), subject: "Pay$'s" });
  same("compose: a $' in the subject is literal", pays[0].text, "Pay$'s is for people.");
  const amp = composeParagraph({ questions, state: state({ seg: ["people"] }), subject: "$&$`" });
  same("compose: $& and $` in the subject are literal", amp[0].text, "$&$` is for people.");
  const list = composeParagraph({ questions, state: state({ seg: ["$& fans", "$$ savers", "$' and $`"] }), subject: "X" });
  same("compose: $ patterns in the list are literal", list[0].text, "X is for $& fans; $$ savers; and $' and $`.");
}

// --- gaps ----------------------------------------------------------------------
{
  const segments = composeParagraph({ questions, state: state({ seg: ["people"] }, ["rev"]), subject: "X" });
  same(
    "gap: open on purpose",
    segments[4],
    { kind: "gap", question: "rev", open: true, text: "left open on purpose: where the money comes from" },
  );
  same("gap: not answered", segments[1], { kind: "gap", question: "vp", open: false, text: "open: what it does for them" });
  const answered = composeParagraph({ questions, state: state({ rev: ["fees"] }, ["rev"]), subject: "X" });
  same("gap: answers win over an open flag", answered[4].kind, "sentence");
  const dots = composeParagraph({ questions, state: state({ seg: ["..."] }), subject: "X" });
  same("gap: an answer that cleans to nothing is no answer", dots[0].kind, "gap");
  const gapFirst = composeParagraph({ questions, state: state({ vp: ["bread"] }), subject: "X" });
  same("gap: a gap does not consume the subject", gapFirst[1].text, "X offers bread.");
}

// --- through --------------------------------------------------------------------
{
  const full = state({ seg: ["a"], vp: ["b"], ch: ["c"], cr: ["d"], rev: ["e"], kr: ["f"], ka: ["g"], kp: ["h"], cost: ["i"] });
  same("through 1: one segment", composeParagraph({ questions, state: full, subject: "X", through: 1 }).map((s) => s.question), ["seg"]);
  same(
    "through 4: four segments",
    composeParagraph({ questions, state: full, subject: "X", through: 4 }).map((s) => s.question),
    ["seg", "vp", "ch", "cr"],
  );
  same("through 9: all nine", composeParagraph({ questions, state: full, subject: "X", through: 9 }).length, 9);
  same("through omitted: all nine", composeParagraph({ questions, state: full, subject: "X" }).length, 9);
  same("through 0: no segment", composeParagraph({ questions, state: full, subject: "X", through: 0 }), []);
  same("through 10: all nine", composeParagraph({ questions, state: full, subject: "X", through: 10 }).length, 9);
  same("through NaN: all nine", composeParagraph({ questions, state: full, subject: "X", through: NaN }).length, 9);
  same("through -2: none", composeParagraph({ questions, state: full, subject: "X", through: -2 }).length, 0);
  same("clampThrough: omitted, NaN, Infinity, -Infinity, 10 mean all", [undefined, NaN, Infinity, -Infinity, 10].map((t) => clampThrough(t, 9)), [9, 9, 9, 9, 9]);
  same("clampThrough: 0, 0.5 and below mean none", [0, 0.5, -1].map((t) => clampThrough(t, 9)), [0, 0, 0]);
  same("clampThrough: in range, a fraction rounds down", [1, 4, 4.9, 9].map((t) => clampThrough(t, 9)), [1, 4, 4, 9]);
}

// --- notes in a sentence ---------------------------------------------------------
{
  const segments = composeParagraph({
    questions,
    state: state({ kp: [{ text: "two millers.", note: NOTE }, { text: "a co-op", note: UNDATED }] }),
    subject: "X",
  });
  const kp = segments[7];
  same("notes: the sentence's text leaves notes out, and they do not change the join", kp.text, "Its partners are two millers and a co-op.");
  same(
    "notes: parts put each note right after its answer, with the answer it belongs to",
    kp.parts,
    [
      { kind: "text", text: "Its partners are two millers" },
      { kind: "note", note: NOTE, answer: "two millers" },
      { kind: "text", text: " and a co-op" },
      { kind: "note", note: UNDATED, answer: "a co-op" },
      { kind: "text", text: "." },
    ],
  );
  const words = kp.parts.map((part) => (part.kind === "text" ? part.text : "")).join("");
  same("notes: the text parts concatenate to the text", words, kp.text);
  same(
    "notes: paragraphTextWithNotes puts each note in parentheses after its answer",
    paragraphTextWithNotes([kp]),
    "Its partners are two millers (about 40 tonnes a year. Source: Example Mill, annual report, 2026-02-01) and a co-op (listed as a partner. Source: Example Mill, partners page, read on 2026-10-01).",
  );
  const withNotes = kp.parts.map((part) => (part.kind === "text" ? part.text : ` (${noteText(part.note)})`)).join("");
  same("notes: the parts, notes in parentheses, concatenate to the with-notes text", withNotes, paragraphTextWithNotes([kp]));
  const one = composeParagraph({ questions, state: state({ kp: [{ text: "millers", note: NOTE }] }), subject: "X" });
  same("notes: a single noted answer", one[7].text, "Its partners are millers.");
  same(
    "notes: a single noted answer, with notes",
    paragraphTextWithNotes(one),
    "Its partners are millers (about 40 tonnes a year. Source: Example Mill, annual report, 2026-02-01).",
  );
  same("notes: paragraphText leaves them out", paragraphText(one), "Its partners are millers.");
}

// --- paragraphText --------------------------------------------------------------
{
  const segments = composeParagraph({ questions, state: state({ seg: ["people"], ch: ["ads"] }, ["vp"]), subject: "X" });
  same("text: sentences only, single spaces", paragraphText(segments), "X is for people. It reaches them through ads.");
  same("text: nothing answered is empty", paragraphText(composeParagraph({ questions, state: state(), subject: "X" })), "");
}

// --- exampleCanvas on the fixture ------------------------------------------------
{
  const crumb = exampleCanvas(index, "crumb-and-co");
  check("example: a known example", crumb !== null);
  same("example: the company", crumb.company.id, "crumb-and-co");
  same("example: nine questions in canonical order", crumb.questions.map((q) => q.key), BMC_QUESTION_KEYS);
  same(
    "example: answers in order with their entity ids",
    crumb.questions.find((q) => q.key === "ka").answers.map((a) => a.entity),
    ["overnight-baking", "delivery-rounds", "flour-sourcing", "order-packing", "order-taking"],
  );
  const tide = exampleCanvas(index, "tidewise");
  same(
    "example: uses stored out of order come back in order",
    tide.questions.find((q) => q.key === "ch").answers.map((a) => a.text),
    ["anglers swapping tips on the pier", "app store search"],
  );
  same("example: the open question", tide.questions.filter((q) => q.open).map((q) => q.key), ["rev"]);
  same("example: no other open question", crumb.questions.filter((q) => q.open).length, 0);
  const kr = tide.questions.find((q) => q.key === "kr").answers[0];
  same("example: a note travels with its answer", kr.note && kr.note.source.dateKind, "published");
  check("example: an answer without a note has no note key", !("note" in crumb.questions[0].answers[0]));
  same("example: an unknown company is null", exampleCanvas(index, "nobody"), null);

  const tidePara = composeParagraph({ questions, state: tide.questions, subject: tide.company.name });
  same(
    "example: Tidewise's paragraph",
    paragraphText(tidePara),
    "Tidewise is for people who fish from the shore. It offers tide times that work without signal. It reaches them through anglers swapping tips on the pier and app store search. It keeps them with a help page inside the app. It relies on public tide data. It spends its days on updating the tables every season. Its partners are harbour offices that share local data. The main cost is developer fees for the app stores.",
  );
  check(
    "example: Tidewise's paragraph with notes carries its source",
    paragraphTextWithNotes(tidePara).includes(
      "It relies on public tide data (predictions for 412 harbours, refreshed every season. Source: Tidewise, product page, 2026-03-02).",
    ),
  );
  same("example: Tidewise's open question is a gap", tidePara[4].text, "left open on purpose: where the money comes from");
  const crumbPara = composeParagraph({ questions, state: crumb.questions, subject: crumb.company.name });
  same(
    "example: Crumb & Co's two costs, one holding 'and', take a comma before the last 'and'",
    crumbPara[8].text,
    "The main costs are flour and butter, and night-shift wages.",
  );
  same(
    "example: Crumb & Co's five activities join with commas",
    crumbPara[6].text,
    "It spends its days on baking through the night, planning the delivery round, sourcing flour from nearby mills, packing each order by hand and taking orders by text message.",
  );
}

// --- the baseline prompt ----------------------------------------------------------
same("prompt: the placeholder", PROMPT_PLACEHOLDER, "[your paragraph]");
same("prompt: the token is shown as the placeholder", promptForDisplay(`Read ${PROMPT_TOKEN} now`), "Read [your paragraph] now");
same("prompt: a prompt without the token is unchanged", promptForDisplay("No token here"), "No token here");
same(
  "prompt: the fixture's lines",
  promptLines(tool.prompt.text),
  [
    "You are helping me think about a product.",
    "Here is its business model in one paragraph:",
    "",
    "[your paragraph]",
    "",
    "Ask me the one question that would change it most.",
  ],
);
same("prompt: CRLF lines", promptLines("a\r\nb"), ["a", "b"]);

// --- paths and the shell's cards ----------------------------------------------------
same("paths: the shell", ARKADEMY_PATH, "/arkademy");
same("paths: the cover", ARKADEMY_TOOL_PATHS["business-model-canvas"], "/arkademy/business-model-canvas");
same("paths: your own canvas", BMC_YOURS_PATH, "/arkademy/business-model-canvas/yours");
same("paths: a tour", bmcTourPath("crumb-and-co"), "/arkademy/business-model-canvas/tour/crumb-and-co");
same(
  "cards: one per tool with a path",
  arkademyToolCards(document),
  [
    {
      id: "business-model-canvas",
      href: "/arkademy/business-model-canvas",
      title: "Business Model Canvas",
      tagline: tool.tagline,
      exampleCount: 3,
    },
  ],
);
same(
  "cards: a tool without a path gets none",
  arkademyToolCards({ ...document, tools: [{ ...tool, id: "porter-five-forces" }] }),
  [],
);

// --- metadata -------------------------------------------------------------------
{
  same("site: the origin", ARKADEMY_SITE_URL, "https://arkaik.app");
  const shell = arkademyShellMetadata(true);
  same("shell: title", shell.title, "Arkademy | arkaik");
  same("shell: description", shell.description, ARKADEMY_INTRO);
  same("shell: canonical", shell.alternates.canonical, "https://arkaik.app/arkademy");
  same("shell: Open Graph URL is the canonical", shell.openGraph.url, "https://arkaik.app/arkademy");
  same("shell: Open Graph type and site", [shell.openGraph.type, shell.openGraph.siteName], ["website", "arkaik"]);
  same("shell: twitter card", shell.twitter.card, "summary");
  check("shell: indexed (no robots override)", !("robots" in shell));
  const shellDown = arkademyShellMetadata(false);
  same("shell without a library: not indexed", shellDown.robots, { index: false, follow: false });
  same("shell without a library: the same canonical", shellDown.alternates.canonical, "https://arkaik.app/arkademy");
  same("shell: a call without the flag is not indexed either", arkademyShellMetadata().robots, { index: false, follow: false });

  const cover = bmcCoverMetadata(tool);
  same("cover: title", cover.title, "Business Model Canvas | arkaik Arkademy");
  same("cover: description is the tagline", cover.description, tool.tagline);
  same("cover: canonical", cover.alternates.canonical, "https://arkaik.app/arkademy/business-model-canvas");
  same("cover: Open Graph URL", cover.openGraph.url, "https://arkaik.app/arkademy/business-model-canvas");
  check("cover: indexed (no robots override)", !("robots" in cover));
  const coverless = bmcCoverMetadata(null);
  same("cover without a document: fixed title", coverless.title, `${BMC_FALLBACK_TITLE} | arkaik Arkademy`);
  check("cover without a document: a fixed description", typeof coverless.description === "string" && coverless.description.length > 0);
  same("cover without a document: same canonical", coverless.alternates.canonical, cover.alternates.canonical);
  same("cover without a document: not indexed", coverless.robots, { index: false, follow: false });

  const company = document.companies.find((c) => c.id === "tidewise");
  const tour = bmcTourMetadata("tidewise", { tool, company });
  same("tour: title", tour.title, "Tidewise: Business Model Canvas tour | arkaik Arkademy");
  same("tour: description is the one-liner", tour.description, company.oneLiner);
  same("tour: canonical, without a step", tour.alternates.canonical, "https://arkaik.app/arkademy/business-model-canvas/tour/tidewise");
  same("tour: never indexed", tour.robots, { index: false, follow: false });
  const tourless = bmcTourMetadata("tidewise", null);
  same("tour without a document: fixed title", tourless.title, "Business Model Canvas tour | arkaik Arkademy");
  same("tour without a document: still not indexed", tourless.robots, { index: false, follow: false });
  same(
    "tour: an id is encoded into the canonical",
    bmcTourMetadata("a b", null).alternates.canonical,
    "https://arkaik.app/arkademy/business-model-canvas/tour/a%20b",
  );

  const yours = bmcYoursMetadata(tool);
  same("yours: title", yours.title, "Your Business Model Canvas | arkaik Arkademy");
  same("yours: canonical", yours.alternates.canonical, "https://arkaik.app/arkademy/business-model-canvas/yours");
  same("yours: never indexed", yours.robots, { index: false, follow: false });
  same("yours without a document: fixed title", bmcYoursMetadata(null).title, "Your Business Model Canvas | arkaik Arkademy");
}

// --- the components, rendered on the server -----------------------------------------
// Through tests/app/load-arkademy-tsx.js (a require hook: .tsx transpiled in
// memory, "@/" resolved to the repo root). renderToStaticMarkup is what a
// server page sends, minus hydration markers.
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { requireTsx } = require("./load-arkademy-tsx");
const { ParagraphView } = requireTsx("components/arkademy/ParagraphView.tsx");
const { SourcedNote, NoteContent } = requireTsx("components/arkademy/SourcedNote.tsx");
const { CanvasGrid } = requireTsx("components/arkademy/CanvasGrid.tsx");
const { ExampleCard } = requireTsx("components/arkademy/ExampleCard.tsx");

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', "#x27": "'", "#39": "'", nbsp: "\u00a0" };
/**
 * The text a reader gets from markup: tags dropped, entities decoded,
 * whitespace collapsed (as HTML renders it). `drop` removes whole elements
 * first, by a regex over the markup.
 */
function textOf(html, drop = []) {
  let rest = html;
  for (const pattern of drop) rest = rest.replace(pattern, "");
  return rest
    .replace(/<[^>]*>/g, "")
    .replace(/&(amp|lt|gt|quot|#x27|#39|nbsp);/g, (_, name) => ENTITIES[name])
    .replace(/\s+/g, " ")
    .trim();
}
const render = (component, props) => renderToStaticMarkup(React.createElement(component, props));
// Gaps are pills on screen and absent from paragraphText (rule 6): each is one
// element carrying data-kind="gap", with no element inside it.
const GAP_ELEMENT = /<(span|button)[^>]*data-kind="gap"[^>]*>[^<]*<\/\1>/g;
// A note's no-script fallback: shown only without JavaScript, so not part of the on-screen text.
const NOSCRIPT = /<noscript>[\s\S]*?<\/noscript>/g;
/** Each note marker's accessible name, in order. */
const markers = (html) =>
  [...html.matchAll(/<button[^>]*data-note-marker=""[^>]*>/g)].map((m) =>
    (/aria-label="([^"]*)"/.exec(m[0]) ?? [null, ""])[1].replace(/&#x27;/g, "'").replace(/&amp;/g, "&"),
  );
const noscripts = (html) => [...html.matchAll(/<noscript>([\s\S]*?)<\/noscript>/g)].map((m) => textOf(m[1]));

{
  // The on-screen text is paragraphText: markers add no text (their name is an
  // aria-label, their icon aria-hidden), the gaps and the no-script fallbacks
  // are excluded as stated above.
  for (const id of tool.examples) {
    const example = exampleCanvas(index, id);
    const segments = composeParagraph({ questions, state: example.questions, subject: example.company.name });
    const html = render(ParagraphView, { segments });
    same(`render: ${id}'s paragraph reads as paragraphText`, textOf(html, [GAP_ELEMENT, NOSCRIPT]), paragraphText(segments));
    const notes = segments.flatMap((segment) => (segment.kind === "sentence" ? segment.parts.filter((part) => part.kind === "note") : []));
    same(`render: ${id}'s markers, one per note, named for their answer`, markers(html), notes.map((part) => `Source note for ${part.answer}`));
    same(`render: ${id}'s no-script fallbacks hold each note in parentheses`, noscripts(html), notes.map((part) => `(${noteText(part.note)})`));
  }
  for (const note of [NOTE, UNDATED]) {
    same(`render: NoteContent reads as noteText (${note.source.dateKind})`, textOf(render(NoteContent, { note })), noteText(note));
    const html = render(SourcedNote, { note, answer: "two millers" });
    same(`render: SourcedNote adds no on-screen text (${note.source.dateKind})`, textOf(html, [NOSCRIPT]), "");
    same(`render: SourcedNote's marker is named for its answer (${note.source.dateKind})`, markers(html), ["Source note for two millers"]);
    same(`render: SourcedNote's no-script fallback (${note.source.dateKind})`, noscripts(html), [`(${noteText(note)})`]);
    check(
      `render: the source opens in a new tab, nofollow (${note.source.dateKind})`,
      html.includes(`href="${note.source.url}"`) && html.includes('target="_blank"') && html.includes('rel="noopener noreferrer nofollow"'),
    );
  }
}

// The grid draws the blocks after `through` faint, with the paragraph's own clamp.
{
  const example = exampleCanvas(index, "crumb-and-co");
  const grid = (props) =>
    render(CanvasGrid, { questions, state: example.questions, density: "full", idPrefix: "g", label: "Crumb", ...props });
  const faintKeys = (html) => [...html.matchAll(/data-question="([a-z]+)"[^>]*data-faint=""/g)].map((m) => m[1]);
  for (const [through, expected] of [
    [undefined, []],
    [0, BMC_QUESTION_KEYS],
    [1, BMC_QUESTION_KEYS.slice(1)],
    [9, []],
    [10, []],
    [NaN, []],
  ]) {
    const shown = composeParagraph({ questions, state: example.questions, subject: "X", through }).map((s) => s.question);
    same(`grid: through ${through} draws faint exactly the questions the paragraph omits`, faintKeys(grid({ through })), expected);
    same(
      `grid: through ${through} agrees with the paragraph`,
      BMC_QUESTION_KEYS.filter((key) => !faintKeys(grid({ through })).includes(key)),
      shown,
    );
  }
}

// --- the tour's grid: the current block, and a block being answered ------------------------
{
  const example = exampleCanvas(index, "crumb-and-co");
  const grid = (props) =>
    render(CanvasGrid, { questions, state: example.questions, density: "full", idPrefix: "t", label: "Crumb", ...props });
  const blockTag = (html, key) => new RegExp(`<div[^>]*data-question="${key}"[^>]*>`).exec(html)[0];
  const blockHtml = (html, key) => {
    const at = html.indexOf(blockTag(html, key));
    const next = html.indexOf("data-question=", at + blockTag(html, key).length);
    return html.slice(at, next === -1 ? undefined : html.lastIndexOf("<", next));
  };

  const current = grid({ through: 2, current: "cr" });
  check("current: the current block is never faint", !/data-faint/.test(blockTag(current, "cr")), blockTag(current, "cr"));
  check("current: it keeps its ring", /ring-2/.test(blockTag(current, "cr")));
  check("current: the blocks around it past through stay faint", /data-faint/.test(blockTag(current, "ch")) && /data-faint/.test(blockTag(current, "rev")));

  const vpTitle = questions.find((q) => q.key === "vp").block;
  const pending = grid({ through: 1, current: "vp", pending: "vp" });
  const tag = blockTag(pending, "vp");
  check("pending: drawn at full strength though past through", !/data-faint/.test(tag) && !/opacity-/.test(tag), tag);
  check("pending: with the current ring when current", /ring-2/.test(tag));
  check("pending: marked as pending", /data-pending=""/.test(tag));
  same("pending: its heading is shown, its body is empty", textOf(blockHtml(pending, "vp")), `2${vpTitle}`);
  check("pending: no answer listed though the state has some", !/<li/.test(blockHtml(pending, "vp")));
  check("pending: an accessible name says it is being answered", tag.includes(`aria-label="${vpTitle}, being answered"`), tag);
  const tide = exampleCanvas(index, "tidewise");
  const openPending = render(CanvasGrid, { questions, state: tide.questions, density: "full", idPrefix: "t", label: "T", through: 4, current: "rev", pending: "rev" });
  check("pending: an open question's block shows no dashed border yet", !/border-dashed/.test(blockTag(openPending, "rev")));
  check("pending: nor says it is left open", !/Left open on purpose/.test(blockHtml(openPending, "rev")));
  const notCurrent = grid({ through: 1, pending: "vp" });
  check("pending: without current, no ring", !/ring-2/.test(blockTag(notCurrent, "vp")));
  check("pending: the other blocks keep their own treatment", /data-faint/.test(blockTag(pending, "ch")) && !/data-faint/.test(blockTag(pending, "seg")));
}

// --- display answers: the paragraph and the grid read the same ones --------------------
{
  same(
    "displayAnswers: cleaned, empties dropped, entity and note kept",
    displayAnswers({ key: "seg", answers: [{ text: "..." }, { text: "  " }, { text: "fast.", entity: "speed", note: NOTE }], open: false }),
    [{ text: "fast", entity: "speed", note: NOTE }],
  );
  same("displayAnswers: a missing question has none", displayAnswers(undefined), []);
  same(
    "displayAnswers: a noted answer that cleans to nothing is dropped, note and all",
    displayAnswers({ key: "kp", answers: [{ text: " . ", note: NOTE }], open: false }),
    [],
  );

  const grid = (st) => render(CanvasGrid, { questions, state: st, density: "full", idPrefix: "g", label: "X" });
  // One block's markup: from its opening tag to the next block's.
  const block = (html, key) => {
    const at = html.lastIndexOf("<", html.indexOf(`data-question="${key}"`));
    const next = html.indexOf("data-question=", html.indexOf(`data-question="${key}"`) + 1);
    return html.slice(at, next === -1 ? undefined : html.lastIndexOf("<", next));
  };
  // A list item's on-screen text (a note's no-script fallback excluded).
  const items = (html) => [...html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((m) => textOf(m[1], [NOSCRIPT]));

  const messy = state({ seg: ["...", "  ", "fast."], vp: ["..."], rev: ["!"] }, ["rev"]);
  const html = grid(messy);
  same("grid: the canvas lists the cleaned answers only", items(block(html, "seg")), ["fast"]);
  same("grid: and the paragraph agrees", composeParagraph({ questions, state: messy, subject: "X" })[0].text, "X is for fast.");
  check("grid: a block whose only answer cleans to nothing is not answered yet", textOf(block(html, "vp")).endsWith("Not answered yet."), textOf(block(html, "vp")));
  check("grid: and it lists nothing", items(block(html, "vp")).length === 0);
  check("grid: an open block whose only answer cleans to nothing is left open", textOf(block(html, "rev")).endsWith("Left open on purpose."), textOf(block(html, "rev")));

  const withNote = state({ kp: [{ text: "two millers.", note: NOTE }, { text: "a co-op" }] });
  same("grid: the full density puts a marker after a noted answer", markers(grid(withNote)), ["Source note for two millers"]);
  same("grid: the list item's text is the answer alone", items(block(grid(withNote), "kp")), ["two millers", "a co-op"]);
  same(
    "grid: the mini density shows no note",
    markers(render(CanvasGrid, { questions, state: withNote, density: "mini", idPrefix: "g", label: "X" })),
    [],
  );
  const noted = grid(state({ kp: [{ text: "...", note: NOTE }] }));
  check("grid: a noted answer that cleans to nothing leaves no note behind", !noted.includes(NOTE.source.url));

  const missing = state({ seg: ["people"] }).filter((q) => q.key !== "vp");
  const missingHtml = grid(missing);
  same("missing key: the paragraph reads it as an open question", composeParagraph({ questions, state: missing, subject: "X" })[1], {
    kind: "gap",
    question: "vp",
    open: false,
    text: "open: what it does for them",
  });
  check("missing key: the grid says not answered yet", textOf(block(missingHtml, "vp")).endsWith("Not answered yet."));

  const duplicate = [...state({ seg: ["first"] }), { key: "seg", answers: [{ text: "second" }], open: false }];
  same("duplicate key: the paragraph takes the last entry", composeParagraph({ questions, state: duplicate, subject: "X" })[0].text, "X is for second.");
  same("duplicate key: so does the grid", items(block(grid(duplicate), "seg")), ["second"]);
}

// --- an example's card ------------------------------------------------------------------
{
  const crumb = exampleCanvas(index, "crumb-and-co");
  const card = render(ExampleCard, { company: crumb.company, questions, state: crumb.questions });
  const paragraphTag = /<p[^>]*class="([^"]*)"[^>]*>[^<]*<span[^>]*data-kind="sentence"/.exec(card);
  check("card: the paragraph is in the card", paragraphTag !== null);
  check("card: the paragraph spans the card (no width cap)", paragraphTag !== null && !/max-w-/.test(paragraphTag[1]), paragraphTag && paragraphTag[1]);
}

// Two companies whose ids differ by a block key ("acme" and "acme-cost") must not share an id on one page.
{
  const crumb = exampleCanvas(index, "crumb-and-co");
  const page = ["acme", "acme-cost"]
    .map((id) => render(ExampleCard, { company: { ...crumb.company, id, name: id }, questions, state: crumb.questions }))
    .join("");
  const ids = [...page.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
  same("ids: every id on a page of cards is unique", ids.filter((id, i) => ids.indexOf(id) !== i), []);
  check("ids: a block heading joins the prefix and the key with --", ids.includes("example-acme--cost"), JSON.stringify(ids.slice(0, 4)));
  const labelled = [...page.matchAll(/aria-labelledby="([^"]+)"/g)].map((m) => m[1]);
  check("ids: every aria-labelledby names an id on the page", labelled.every((id) => ids.includes(id)));
}

// --- the sitemap ------------------------------------------------------------------------
// The real function, required through the TSX loader, so a refactor of its
// source cannot fool the check and a tour URL built with bmcTourPath() is caught.
{
  const sitemap = requireTsx("app/sitemap.ts").default;
  const urls = sitemap().map((entry) => entry.url);
  const arkademy = urls.filter((url) => url === `${ARKADEMY_SITE_URL}${ARKADEMY_PATH}` || url.startsWith(`${ARKADEMY_SITE_URL}${ARKADEMY_PATH}/`));
  const covers = Object.values(ARKADEMY_TOOL_PATHS).map((p) => `${ARKADEMY_SITE_URL}${p}`);
  check("sitemap: lists the shell", urls.includes(`${ARKADEMY_SITE_URL}${ARKADEMY_PATH}`), JSON.stringify(arkademy));
  check("sitemap: lists the cover", urls.includes(`${ARKADEMY_SITE_URL}${ARKADEMY_TOOL_PATHS["business-model-canvas"]}`));
  same(
    "sitemap: under /arkademy, only the shell and the tools' covers (no tour, no canvas of your own)",
    arkademy.filter((url) => url !== `${ARKADEMY_SITE_URL}${ARKADEMY_PATH}` && !covers.includes(url)),
    [],
  );
  check("sitemap: no URL holds a tour path", !urls.some((url) => url.includes(bmcTourPath("x").replace(/x$/, ""))));
  check("sitemap: no URL is the canvas of your own", !urls.includes(`${ARKADEMY_SITE_URL}${BMC_YOURS_PATH}`));
}

cleanup();
if (failures > 0) {
  console.log(`\n${failures} arkademy-paragraph test(s) failed`);
  process.exit(1);
}
console.log("\nAll arkademy-paragraph tests passed.");
