#!/usr/bin/env node

/**
 * The tour's pure side. lib/arkademy/tour.ts: the `?step=` parser your own
 * canvas shares, the tour's address and what the live region says at its
 * end. lib/arkademy/tour-stage.ts: the tour as the reader moves it
 * — its stages, their addresses, the step indicator's pips, what the live
 * region says. DB-free, so it runs in CI's `build` job. Then every kind of
 * screen, rendered on the server in Node from its address alone, and the
 * cover's actions, read from its syntax tree.
 *
 * Cases the fictional fixture (tests/fixtures/arkademy/document.json) does not
 * hold are built in memory; the fixture itself is never edited.
 */

const fs = require("fs");
const path = require("path");
const { loadArkademy, cleanup } = require("./load-arkademy");

const ROOT = path.join(__dirname, "..", "..");
const FIXTURE = path.join(ROOT, "tests", "fixtures", "arkademy", "document.json");

const {
  indexArkademy,
  validateArkademyDocument,
  exampleCanvas,
  parseStepParam,
  tourHref,
  tourEndAnnouncement,
  composeParagraph,
  paragraphText,
  TOUR_STAGE_COUNT,
  TOUR_STEPS,
  tourStageAt,
  tourStageIndex,
  tourStageKey,
  nextTourStage,
  previousTourStage,
  tilesFaceUp,
  tourStageStep,
  tourPips,
  parseTourStage,
  tourStageFromSearch,
  searchForTourStage,
  tourStageHref,
  askAnnouncement,
  turnAnnouncement,
  ownsArkademyChrome,
  TOUR_CADENCE,
  askCadence,
  TOUR_END_CADENCE,
  endCadence,
  wordTurn,
  paragraphFit,
  TOUR_END_FIT,
  splitWords,
  isWord,
  paragraphWords,
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
const questions = document.tools[0].questions;
const index = indexArkademy(validation.document);

// --- parseStepParam and tourHref -------------------------------------------------------------
same('step: "1"', parseStepParam("1"), 1);
same('step: "9"', parseStepParam("9"), 9);
same('step: "0"', parseStepParam("0"), null);
same('step: "10"', parseStepParam("10"), null);
same('step: "3abc"', parseStepParam("3abc"), null);
same('step: "03"', parseStepParam("03"), null);
same('step: " 3"', parseStepParam(" 3"), null);
same('step: ""', parseStepParam(""), null);
same("step: an array", parseStepParam(["3", "4"]), null);
same("step: undefined", parseStepParam(undefined), null);
same("href: no step", tourHref("tidewise"), "/arkademy/business-model-canvas/tour/tidewise");
same("href: a step", tourHref("tidewise", 4), "/arkademy/business-model-canvas/tour/tidewise?step=4");

// --- what the live region says at the end ---------------------------------------------------
{
  const company = exampleCanvas(index, "tidewise").company;
  same(
    "announce: the end",
    tourEndAnnouncement(company),
    "End of the tour: Tidewise's nine answers, read back as one paragraph.",
  );
}

// --- the step-by-step tour (lib/arkademy/tour-stage.ts) ------------------------------------
// The reader moves the tour: the opening, two beats per question (asked, then turned face up on
// the deck), the end. No clock: every stage is an address.
{
  same("stages: the opening, two beats per question, the end", TOUR_STAGE_COUNT, 20);
  same("stages: nine steps", TOUR_STEPS, 9);
  const line = Array.from({ length: TOUR_STAGE_COUNT }, (_, i) => tourStageAt(i));
  same("stages: first the opening", line[0], { kind: "opening" });
  same("stages: then question 1 asked", line[1], { kind: "question", step: 1, beat: "ask" });
  same("stages: then its tile turned", line[2], { kind: "question", step: 1, beat: "canvas" });
  same("stages: question 3 asked is the fifth", line[5], { kind: "question", step: 3, beat: "ask" });
  same("stages: question 9 turned", line[18], { kind: "question", step: 9, beat: "canvas" });
  same("stages: last the end", line[19], { kind: "end" });
  same("stages: an index past either end is clamped", [tourStageAt(-4), tourStageAt(99), tourStageAt(NaN)], [{ kind: "opening" }, { kind: "end" }, { kind: "opening" }]);
  same("stages: every stage's index is its place", line.map(tourStageIndex), line.map((_, i) => i));
  same("stages: keys name each one once", new Set(line.map(tourStageKey)).size, TOUR_STAGE_COUNT);
  same("stages: keys", [tourStageKey(line[0]), tourStageKey(line[5]), tourStageKey(line[6]), tourStageKey(line[19])], ["opening", "3-ask", "3-canvas", "end"]);

  // Continue walks the whole line, one stage at a time, and stops at the end; Back walks it home.
  const walked = [];
  for (let stage = line[0]; stage; stage = nextTourStage(stage)) walked.push(tourStageKey(stage));
  same("continue: visits every stage in order, then stops", walked, line.map(tourStageKey));
  const home = [];
  for (let stage = line[19]; stage; stage = previousTourStage(stage)) home.push(tourStageKey(stage));
  same("back: the same line backwards", home, line.map(tourStageKey).reverse());
  same("continue: none after the end", nextTourStage({ kind: "end" }), null);
  same("back: none before the opening", previousTourStage({ kind: "opening" }), null);

  // The deck: what lies face up on each screen.
  same("face up: none at the opening", tilesFaceUp({ kind: "opening" }), 0);
  same("face up: the earlier ones while a question is asked", tilesFaceUp({ kind: "question", step: 4, beat: "ask" }), 3);
  same("face up: this one too once turned", tilesFaceUp({ kind: "question", step: 4, beat: "canvas" }), 4);
  same("face up: all nine at the end", tilesFaceUp({ kind: "end" }), 9);
  same("step: of a beat", tourStageStep({ kind: "question", step: 7, beat: "canvas" }), 7);
  same("step: none at the opening or the end", [tourStageStep({ kind: "opening" }), tourStageStep({ kind: "end" })], [null, null]);

  // The step indicator's pips.
  same("pips: all ahead at the opening", tourPips({ kind: "opening" }), Array(9).fill("ahead"));
  same(
    "pips: question 3 asked",
    tourPips({ kind: "question", step: 3, beat: "ask" }),
    ["done", "done", "current", "ahead", "ahead", "ahead", "ahead", "ahead", "ahead"],
  );
  same(
    "pips: question 3 turned — its pip becomes a tile",
    tourPips({ kind: "question", step: 3, beat: "canvas" }),
    ["done", "done", "turned", "ahead", "ahead", "ahead", "ahead", "ahead", "ahead"],
  );
  same("pips: all done at the end", tourPips({ kind: "end" }), Array(9).fill("done"));

  // The address: what the server and the client both read.
  same("parse: no step is the opening", parseTourStage(undefined), { kind: "opening" });
  same("parse: step=end", parseTourStage("end"), { kind: "end" });
  same("parse: step=end ignores a beat", parseTourStage("end", "canvas"), { kind: "end" });
  same("parse: step=3 is asked", parseTourStage("3"), { kind: "question", step: 3, beat: "ask" });
  same("parse: step=3&beat=canvas is turned", parseTourStage("3", "canvas"), { kind: "question", step: 3, beat: "canvas" });
  same("parse: an unknown beat is asked", parseTourStage("3", "flip"), { kind: "question", step: 3, beat: "ask" });
  same("parse: two beats read as none", parseTourStage("3", ["canvas", "canvas"]), { kind: "question", step: 3, beat: "ask" });
  for (const bad of ["0", "10", "03", "3.5", "-1", "abc", "", " 3", "END"]) {
    same(`parse: step=${JSON.stringify(bad)} is the opening`, parseTourStage(bad, "canvas"), { kind: "opening" });
  }
  same("parse: two steps read as none", parseTourStage(["3", "4"]), { kind: "opening" });
  same("search: a turned beat", tourStageFromSearch("?step=3&beat=canvas"), { kind: "question", step: 3, beat: "canvas" });
  same("search: among other parameters", tourStageFromSearch("scheme=basalt-neutral&step=7"), { kind: "question", step: 7, beat: "ask" });
  same("search: two steps read as the opening", tourStageFromSearch("?step=3&step=4"), { kind: "opening" });
  same("search: two beats read as asked", tourStageFromSearch("?step=3&beat=canvas&beat=canvas"), { kind: "question", step: 3, beat: "ask" });
  same("search: the end", tourStageFromSearch("?step=end"), { kind: "end" });
  same("write: the opening carries no step", searchForTourStage("?step=4&beat=canvas", { kind: "opening" }), "");
  same("write: an asked beat carries no beat", searchForTourStage("?step=4&beat=canvas", { kind: "question", step: 5, beat: "ask" }), "?step=5");
  same("write: a turned beat", searchForTourStage("", { kind: "question", step: 5, beat: "canvas" }), "?step=5&beat=canvas");
  same("write: the end", searchForTourStage("?step=9&beat=canvas", { kind: "end" }), "?step=end");
  same(
    "write: other parameters are kept (the preview's scheme and font)",
    searchForTourStage("?scheme=basalt-neutral&step=2&font=yatra-one", { kind: "question", step: 2, beat: "canvas" }),
    "?scheme=basalt-neutral&font=yatra-one&step=2&beat=canvas",
  );
  same("write: a repeated step is replaced by one", searchForTourStage("?step=3&step=4", { kind: "question", step: 4, beat: "ask" }), "?step=4");
  for (const stage of line) {
    same(`write then read: ${tourStageKey(stage)}`, tourStageFromSearch(searchForTourStage("?font=x", stage)), stage);
  }
  same("href: a stage of a tour", tourStageHref("tidewise", { kind: "question", step: 2, beat: "canvas" }), "/arkademy/business-model-canvas/tour/tidewise?step=2&beat=canvas");
  same("href: the opening", tourStageHref("tidewise", { kind: "opening" }, "?scheme=x&step=4"), "/arkademy/business-model-canvas/tour/tidewise?scheme=x");
}

// --- the route that draws its own chrome --------------------------------------------------
same("chrome: a tour's screen draws its own", ownsArkademyChrome(["business-model-canvas", "tour", "tidewise"]), true);
same("chrome: the cover keeps the Arkademy's header", ownsArkademyChrome(["business-model-canvas"]), false);
same("chrome: your own canvas keeps it", ownsArkademyChrome(["business-model-canvas", "yours"]), false);
same("chrome: the shell keeps it", ownsArkademyChrome([]), false);

// --- the rhythm: pop · pop-pop · pop · pop-pop --------------------------------------------
{
  const c = TOUR_CADENCE;
  same("cadence: the tempo", c, { leadMs: 100, beatMs: 450, tightMs: 150, popMs: 440 });
  const three = askCadence(true, 3);
  same("cadence: pop — the asker", three.asker, 100);
  same("cadence: one beat, then pop-pop — the question, its explanation tight behind", [three.question - three.asker, three.hint - three.question], [450, 150]);
  same("cadence: one beat, then pop — the company", three.company - three.hint, 450);
  same("cadence: one beat, then the answers in one tight run", [three.replies[0] - three.company, three.replies[1] - three.replies[0], three.replies[2] - three.replies[1]], [450, 150, 150]);
  check("cadence: three answers play in 2–2.5 s", three.done >= 2000 && three.done <= 2500, three.done);
  same("cadence: done once the last has popped", three.done, three.replies[2] + c.popMs);
  same("cadence: the same tempo whatever the words' length (no reading time)", askCadence(true, 3), three);
  const bare = askCadence(false, 1);
  same("cadence: no explanation, no bubble — the company a beat after the question", [bare.hint, bare.company - bare.question], [null, 450]);
  same("cadence: no reply, done after the company", askCadence(true, 0).done, askCadence(true, 0).company + c.popMs);

  same("end cadence: the numbers", TOUR_END_CADENCE, { leadMs: 300, wordMs: 30, minTickMs: 25, revealCapMs: 3500, wordFadeMs: 260, canvasAfterMs: 450, choicesAfterMs: 450 });
  const short = endCadence(110);
  same("end cadence: a short paragraph flows a word every 30 ms", [short.runSize, short.runMs], [1, 30]);
  const long = endCadence(329);
  same("end cadence: a long one flows in runs, ticks at least 25 ms apart", [long.runSize, long.runMs >= 25], [3, true]);
  for (const words of [110, 148, 253, 296, 329, 1000]) {
    const e = endCadence(words);
    check(`end cadence: ${words} words flow within 3.5 s`, wordTurn(e, words - 1) - e.start <= 3500, wordTurn(e, words - 1) - e.start);
  }
  same("end cadence: a word's turn is its run's", [wordTurn(long, 0), wordTurn(long, 2), wordTurn(long, 3)], [300, 300, 300 + long.runMs]);
  same("end cadence: the canvas a beat after the last word, the choices a beat after", [long.canvas - long.paragraphDone, long.choices - long.canvas], [450, 450]);

  same("fit: the thresholds", TOUR_END_FIT, { m: 1000, l: 1400, xl: 1700 });
  const seg = (n) => [{ kind: "sentence", question: "seg", text: "x".repeat(n), parts: [] }];
  same("fit: by length", [seg(900), seg(1200), seg(1600), seg(2100)].map(paragraphFit), ["s", "m", "l", "xl"]);
  same("fit: gap pills count, with the spaces between", paragraphFit([...seg(999), { kind: "gap", question: "vp", open: true, text: "x" }]), "m");

  same("words: pieces keep their spaces", splitWords("on a  pier"), ["on ", "a  ", "pier"]);
  same("words: a leading space is its own piece", splitWords(" and app"), [" ", "and ", "app"]);
  check("words: the pieces give the text back", ["Tidewise is for people.", " x  y ", ""].every((t) => splitWords(t).join("") === t));
  same("words: a space-only piece is no word", [isWord(" "), isWord("a ")], [false, true]);
  const tideSegs = composeParagraph({ questions, state: exampleCanvas(index, "tidewise").questions, subject: "Tidewise" });
  const counted = tideSegs.reduce((sum, seg) => sum + (seg.kind === "gap" ? 1 : seg.parts.reduce((n, part) => n + (part.kind === "note" ? 1 : splitWords(part.text).filter(isWord).length), 0)), 0);
  same("words: a paragraph counts each word, each note marker and each gap once", paragraphWords(tideSegs), counted);
}

// --- what the live region says on each screen ---------------------------------------------
{
  const tide = exampleCanvas(index, "tidewise");
  const company = tide.company;
  same(
    "ask: the place, the hint, then the answers (the question itself has focus)",
    askAnnouncement({ step: 3, question: questions[2], company, state: tide.questions[2] }),
    `Question 3 of 9, Channels. ${questions[2].hint} Tidewise's answers: anglers swapping tips on the pier and app store search.`,
  );
  same(
    "ask: one answer",
    askAnnouncement({ step: 1, question: questions[0], company, state: tide.questions[0] }),
    `Question 1 of 9, Customer segments. ${questions[0].hint} Tidewise's answer: people who fish from the shore.`,
  );
  same(
    "ask: left open on purpose",
    askAnnouncement({ step: 5, question: questions[4], company, state: tide.questions[4] }),
    `Question 5 of 9, Revenue streams. ${questions[4].hint} Tidewise leaves this open on purpose.`,
  );
  same(
    "ask: not answered, and no hint",
    askAnnouncement({ step: 5, question: { ...questions[4], hint: "" }, company, state: { key: "rev", answers: [], open: false } }),
    "Question 5 of 9, Revenue streams. Tidewise has not answered this one.",
  );
  same(
    "turn: the tile's face, and how many are up",
    turnAnnouncement({ step: 3, question: questions[2], state: tide.questions[2] }),
    "Channels turned face up on the canvas: anglers swapping tips on the pier and app store search. 3 of 9 blocks face up.",
  );
  same(
    "turn: a tile left open",
    turnAnnouncement({ step: 5, question: questions[4], state: tide.questions[4] }),
    "Revenue streams turned face up on the canvas: left open on purpose. 5 of 9 blocks face up.",
  );
  same(
    "turn: the last one",
    turnAnnouncement({ step: 9, question: questions[8], state: { key: "cost", answers: [], open: false } }),
    "Cost structure turned face up on the canvas: not answered yet. All nine blocks are face up.",
  );
}

// --- the screen, rendered on the server --------------------------------------------
// Through tests/app/load-arkademy-tsx.js (a require hook: .tsx transpiled in
// memory, "@/" resolved to the repo root), as the paragraph suite does. What
// renderToStaticMarkup returns is the HTML a visitor gets before any script
// runs — every screen of the tour, from its address alone. Outside Next's
// router `useSearchParams` has nothing to read, so the screen reads the
// `search` the page passes it, as the server does.
let endHtml = "";
{
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const { requireTsx } = require("./load-arkademy-tsx");
  const { TourStage } = requireTsx("components/arkademy/TourStage.tsx");

  const tide = exampleCanvas(index, "tidewise");
  const COVER = "/arkademy/business-model-canvas";
  const TOUR = "/arkademy/business-model-canvas/tour/tidewise";
  const screen = (search, example = tide) =>
    renderToStaticMarkup(
      React.createElement(TourStage, {
        company: example.company,
        questions,
        state: example.questions,
        accent: { shape: "cookie9", tone: "" },
        toolTitle: "Business Model Canvas",
        coverHref: COVER,
        search,
      }),
    );
  const decode = (html) => html.replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"');
  const linkTo = (html, label) => {
    const match = new RegExp(`<a[^>]*href="([^"]*)"[^>]*>(?:(?!</a>)[\\s\\S])*${label}`).exec(decode(html));
    return match ? match[1] : null;
  };
  const live = (html) => (/<p aria-live="polite"[^>]*>([^<]*)<\/p>/.exec(html) ?? [null, ""])[1];
  const h1s = (html) => (html.match(/<h1[\s>]/g) ?? []).length;
  const current = (html) => (/<a[^>]*aria-current="step"[^>]*aria-label="([^"]*)"|<a[^>]*aria-label="([^"]*)"[^>]*aria-current="step"/.exec(html) ?? []).slice(1).find(Boolean) ?? null;
  // The words a reader sees: no-script note fallbacks dropped, no space before punctuation.
  const text = (html) =>
    decode(html.replace(/<noscript>[\s\S]*?<\/noscript>/g, "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").replace(/ ([.,;:])/g, "$1"));

  // The opening.
  const opening = screen("");
  same("opening: one h1, the company", h1s(opening), 1);
  check("opening: the h1 is the company's name", /<h1[^>]*>Tidewise<\/h1>/.test(opening));
  check("opening: the one-liner", opening.includes(tide.company.oneLiner));
  same("opening: Start goes to question 1", linkTo(opening, "Start the tour"), `${TOUR}?step=1`);
  same("opening: no step is current", current(opening), null);
  check("opening: the deck lies face down, a picture only", /<div aria-hidden="true" class="mx-deck/.test(opening));
  check("opening: no answer is on the page yet", !opening.includes("app store search") && !opening.includes("public tide data"));
  same("opening: the live region starts empty", live(opening), "");
  check("opening: a Simulation chip only for a simulation", !opening.includes("Simulation"));
  const crumbOpening = screen("", exampleCanvas(index, "crumb-and-co"));
  check("opening: a simulation says so, and carries its note", crumbOpening.includes("Simulation") && crumbOpening.includes("every number behind it is invented"));

  // A question, asked.
  const ask = screen("step=3");
  same("ask: one h1, the company", h1s(ask), 1);
  check(
    "ask: the question is the screen's h2, ready for focus, its place read first by assistive technology only",
    /<h2 id="tour-question" tabindex="-1" data-tour-focus=""[^>]*><span class="sr-only">Question 3 of 9, Channels: <\/span>How do they find out about it, and how do they get it\?<\/h2>/.test(ask),
  );
  check("ask: no visible kicker — the stepper is the one place shown", !/Question 3 of 9 ·/.test(ask));
  // The guided pace: each element's turn, in order — asker, question, hint, company, answers.
  const turns = [...ask.matchAll(/--mx-at:(\d+)ms/g)].map((m) => Number(m[1]));
  const pace = askCadence(true, 2);
  same("ask: the screen writes the cadence's turns, in order", turns, [pace.asker, pace.question, pace.hint, pace.company, ...pace.replies]);
  check("ask: the asker speaks first, with a bubble style of its own for both messages", /mx-chat__asker[\s\S]*mx-bubble--asker mx-bubble--question[\s\S]*mx-bubble--asker mx-bubble--hint/.test(ask));
  check("ask: then its hint", ask.includes(questions[2].hint));
  check("ask: the answers, in order", /anglers swapping tips on the pier[\s\S]*app store search/.test(ask));
  same("ask: answers are a list named for the company", /<ul aria-label="Tidewise&#x27;s answers"/.test(ask), true);
  same("ask: Continue turns its tile", linkTo(ask, "Continue"), `${TOUR}?step=3&beat=canvas`);
  same("ask: Back goes to the previous tile", linkTo(ask, "Back"), `${TOUR}?step=2&beat=canvas`);
  same("ask: its pip is current", current(ask), "Question 3: Channels");
  check("ask: no deck on this screen", !ask.includes("mx-deck"));
  check("ask: a pip is a real address", decode(ask).includes(`href="${TOUR}?step=7"`));
  const first = screen("step=1");
  same("ask: Back from question 1 goes to the opening", linkTo(first, "Back"), TOUR);
  const noted = screen("step=6");
  same("ask: a noted answer carries its note's marker, once", noted.split('aria-label="Source note for public tide data"').length - 1, 1);
  const open = screen("step=5");
  check("ask: a question left open is an open answer, dashed", /mx-bubble--open[^>]*>[\s\S]*?left open on purpose: where the money comes from/.test(open), text(open));
  check("ask: and says so", open.includes("Tidewise leaves this open on purpose."));
  check("ask: no answer list for it", !open.includes("Tidewise&#x27;s answers"));

  // A question's tile, turned.
  const turn = screen("step=3&beat=canvas");
  same("turn: Continue asks the next question", linkTo(turn, "Continue"), `${TOUR}?step=4`);
  check("turn: no visible kicker or count", !turn.includes("face up</p>") && /<h2 id="tour-turn" class="sr-only">Question 3 of 9, Channels, on the canvas: 3 of 9 blocks face up<\/h2>/.test(turn));
  same("turn: Back asks this one again", linkTo(turn, "Back"), `${TOUR}?step=3`);
  same("turn: its pip is current, and face up", current(turn), "Question 3: Channels, face up");
  check("turn: the deck is named for what is up", turn.includes('aria-label="Tidewise&#x27;s canvas, 3 of 9 blocks face up"'));
  same("turn: one tile turning", (turn.match(/data-tile="turning"/g) ?? []).length, 1);
  same("turn: the earlier ones face up", (turn.match(/data-tile="up"/g) ?? []).length, 2);
  same("turn: the later ones face down", (turn.match(/data-tile="down"/g) ?? []).length, 6);
  check("turn: a face-down tile is hidden whole", /<div class="mx-tile" data-question="cr"[^>]*data-tile="down"[^>]*aria-hidden="true"/.test(turn));
  check("turn: the turning tile's heading takes focus", /<h3 id="tour-deck--ch" tabindex="-1" data-tour-focus=""/.test(turn));
  check("turn: its face is read, its back is not", /data-tile="turning"[\s\S]*?role="group" aria-labelledby="tour-deck--ch"[\s\S]*?app store search[\s\S]*?<div class="mx-tile__back" aria-hidden="true">/.test(turn));
  check("turn: no later answer leaks from a face-down tile", !turn.includes("public tide data") && !turn.includes("returning"));
  const openTurn = screen("step=5&beat=canvas");
  check("turn: a tile left open is marked open and says so", /data-question="rev"[^>]*data-tile="turning" data-open=""[\s\S]*?Left open on purpose\./.test(openTurn));

  // The end.
  endHtml = screen("step=end");
  // Sentence by sentence: the gap pill (left open on purpose) sits between two of them.
  const sentences = composeParagraph({ questions, state: tide.questions, subject: "Tidewise" }).filter((segment) => segment.kind === "sentence");
  same("end: the fixture's paragraph has eight sentences", sentences.length, 8);
  for (const sentence of sentences) check(`end: the paragraph says "${sentence.text}"`, text(endHtml).includes(paragraphText([sentence])));
  check("end: and keeps its gap in view", endHtml.includes("left open on purpose: where the money comes from"));
  // Word by word, inside the sentences: the words are a picture for the eye, the sentence is read whole.
  const words = (endHtml.match(/class="mx-word"/g) ?? []).length;
  const tideSegments = composeParagraph({ questions, state: tide.questions, subject: "Tidewise" });
  same("end: one turn per word, gap pill and note marker", words, paragraphWords(tideSegments));
  check("end: the words sit inside their sentence's span", /<span data-question="seg" data-kind="sentence"><span class="sr-only">[^<]*<\/span><span aria-hidden="true"><span class="mx-word"/.test(endHtml));
  const ending = endCadence(paragraphWords(tideSegments));
  const wordTurns = [...endHtml.matchAll(/--mx-word-at:(\d+)ms/g)].map((m) => Number(m[1]));
  same("end: the words' turns follow the cadence's runs", wordTurns.slice(0, 3), [0, 1, 2].map((i) => wordTurn(ending, i)));
  check("end: the canvas enters only after the last word", endHtml.includes(`mx-end__canvas mx-pop" style="--mx-at:${ending.canvas}ms"`) && ending.canvas > wordTurns[wordTurns.length - 1]);
  check("end: the choices after the canvas", endHtml.includes(`--mx-at:${ending.choices}ms`) && ending.choices > ending.canvas);
  // Without the visual words (hidden from assistive technology), the paragraph reads whole, once.
  const readable = text(endHtml.replace(/<span aria-hidden="true">(?:<span[^>]*>[^<]*<\/span>|[^<])*<\/span>/g, ""));
  for (const sentence of sentences) check(`end: read whole, once: "${sentence.text.slice(0, 30)}…"`, readable.split(paragraphText([sentence])).length === 2);
  check("end: without JavaScript every entrance is off", endHtml.includes("<noscript><style>.mx-tour *"));
  check("end: paragraph and canvas side by side in one card", /class="mx-item mx-end__card[\s\S]*mx-end__paragraph[\s\S]*mx-end__canvas/.test(endHtml));
  check("end: then the whole canvas, every block", ["seg", "vp", "ch", "cr", "rev", "kr", "ka", "kp", "cost"].every((key) => endHtml.includes(`id="tour-canvas--${key}"`)));
  check("end: paragraph and canvas linked as on the cover", /class="mx-item[^"]*"[\s\S]*data-canvas-link=""/.test(endHtml));
  check("end: the paragraph comes before the canvas", endHtml.indexOf(tide.questions[0].answers[0].text) < endHtml.indexOf('id="tour-canvas--seg"'));
  same("end: back to the cover", linkTo(endHtml, "Back to the cover"), COVER);
  same("end: or start your own", linkTo(endHtml, "Start your own"), "/arkademy/business-model-canvas/yours");
  check("end: no Continue", !endHtml.includes("Continue"));
  same("end: Back turns to the last tile", linkTo(endHtml, "Back"), `${TOUR}?step=9&beat=canvas`);
  same("end: every pip face up", (endHtml.match(/, face up"/g) ?? []).length, 9);

  // The address carries the preview's scheme and font through every link.
  const kept = decode(screen("scheme=basalt-neutral&step=2"));
  check("links: Continue keeps the scheme", kept.includes(`href="${TOUR}?scheme=basalt-neutral&step=2&beat=canvas"`));
  check("links: Back keeps it", kept.includes(`href="${TOUR}?scheme=basalt-neutral&step=1&beat=canvas"`));
  check("links: a pip keeps it", kept.includes(`href="${TOUR}?scheme=basalt-neutral&step=9"`));
  // Every screen: one h1, no empty href, nothing on a timer to wait for.
  for (const search of ["", "step=1", "step=1&beat=canvas", "step=9&beat=canvas", "step=end"]) {
    const html = screen(search);
    check(`screen ${search || "(opening)"}: one h1`, h1s(html) === 1);
    check(`screen ${search || "(opening)"}: every link has an address`, !/<a(?![^>]*href=")[^>]*>/.test(html) && !/href="#?"/.test(html));
  }
}

// --- the cover's actions, read from its syntax tree ------------------------------------------
// The cover is an async server page over the database, so it is not rendered here; its tree
// is read instead, which survives formatting and reordering. A window keydown listener is
// the keyboard-shortcuts suite's to refuse.
{
  const ts = require("typescript");
  const file = path.join(ROOT, "app", "arkademy", "business-model-canvas", "page.tsx");
  const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found = { examplesHref: false, tourHref: 0, yours: false };
  (function visit(node) {
    if (ts.isJsxAttribute(node) && node.name.getText() === "href" && node.initializer && ts.isStringLiteral(node.initializer)) {
      if (node.initializer.text === "#examples") found.examplesHref = true;
    }
    if (ts.isCallExpression(node) && node.expression.getText() === "tourHref") found.tourHref++;
    if (ts.isIdentifier(node) && node.text === "BMC_YOURS_PATH") found.yours = true;
    ts.forEachChild(node, visit);
  })(source);
  check("cover: the hero's Play a tour goes to the examples", found.examplesHref);
  check("cover: each example card links to its tour", found.tourHref >= 1);
  // Part 4: the cover's actions row leads with your own canvas, and the tour's end card offers it.
  const coverText = fs.readFileSync(file, "utf8");
  // The Material cover draws it as its own button: StartYourOwnLink, StartYourOwnButton's words unstyled.
  const startAt = Math.max(coverText.indexOf("<StartYourOwnButton"), coverText.indexOf("<StartYourOwnLink"));
  check(
    "cover: Start your own leads the hero's actions, before Play a tour (part 4)",
    found.yours || (startAt >= 0 && startAt < coverText.lastIndexOf("Play a tour")),
  );
  check("tour: the end offers your own canvas (part 4)", endHtml.includes('href="/arkademy/business-model-canvas/yours"'));
}

cleanup();
if (failures > 0) {
  console.log(`\n${failures} arkademy-tour test(s) failed`);
  process.exit(1);
}
console.log("\nAll arkademy-tour tests passed.");
