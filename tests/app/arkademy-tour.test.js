#!/usr/bin/env node

/**
 * The tour's pure side. lib/arkademy/tour.ts: the `?step=` parser your own
 * canvas shares, and the timed player the tour used to run (its timeline,
 * reducer and live-region text, kept while lib/hooks/useTourPlayer.ts still
 * imports them). lib/arkademy/tour-stage.ts: the tour as the reader moves it
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
  TOUR_TIMING,
  stepTimeline,
  tourTimelines,
  stepView,
  nextBoundary,
  initialTourState,
  resolveTourState,
  createTourReducer,
  parseStepParam,
  tourHref,
  stepAnnouncement,
  tourEndAnnouncement,
  TOUR_KEEP_FOCUS_ATTRIBUTE,
  keyKeepsFocus,
  elapsedAfterPause,
  stepFromSearch,
  searchForStep,
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

// --- the timing ---------------------------------------------------------------------
same("timing: the values the rehearsal settled", TOUR_TIMING, {
  questionMs: 1200,
  answerMs: 900,
  readMsPerChar: 30,
  sentenceMs: 900,
  dwellMs: 2400,
});

// --- stepTimeline: short wordings sit on the floors -------------------------------------
for (let count = 0; count <= 5; count++) {
  const t = stepTimeline(10, Array(count).fill(10));
  same(
    `timeline: ${count} short answer(s) arrive on the floor`,
    t.answersAt,
    Array.from({ length: count }, (_, i) => 1200 + i * 900),
  );
  same(`timeline: ${count} short answer(s), sentence`, t.sentenceAt, 1200 + count * 900);
  same(`timeline: ${count} short answer(s), dwell`, t.dwellAt, 1200 + count * 900 + 900);
  same(`timeline: ${count} short answer(s), total`, t.total, 1200 + count * 900 + 900 + 2400);
}
same("timeline: an open question lasts 4.5 s", stepTimeline(16, []).total, 4500);
same("timeline: a three-answer step on the floors lasts 7.2 s", stepTimeline(16, [12, 20, 9]).total, 7200);

// --- stepTimeline: long wordings take their reading time ----------------------------------
{
  const t = stepTimeline(55, [140, 30, 31]);
  same("timeline: a 55-character prompt reads for 1650 ms", t.answersAt[0], 1650);
  same("timeline: a 140-character answer reads for 4200 ms", t.answersAt[1], 1650 + 4200);
  same("timeline: 30 characters sit exactly on the floor", t.answersAt[2], 1650 + 4200 + 900);
  same("timeline: 31 characters read for 930 ms", t.sentenceAt, 1650 + 4200 + 900 + 930);
  same("timeline: total", t.total, 1650 + 4200 + 900 + 930 + 900 + 2400);
}

// --- tourTimelines on the fixture ------------------------------------------------------
{
  const tide = exampleCanvas(index, "tidewise");
  const timelines = tourTimelines(questions, tide.questions);
  same("timelines: nine, one per question", timelines.length, 9);
  same("timelines: Tidewise's open rev step has no answer", timelines[4].answersAt, []);
  same("timelines: Tidewise's ch step has two answers", timelines[2].answersAt.length, 2);
  const crumb = exampleCanvas(index, "crumb-and-co");
  same("timelines: Crumb & Co's ka step has five answers", tourTimelines(questions, crumb.questions)[6].answersAt.length, 5);
  same(
    "timelines: an answer that cleans to nothing is not counted",
    tourTimelines(questions.slice(0, 1), [{ key: "seg", answers: [{ text: "..." }, { text: "a" }], open: false }])[0]
      .answersAt.length,
    1,
  );
  same(
    "timelines: a question missing from the state has no answer",
    tourTimelines(questions.slice(0, 1), [])[0].answersAt,
    [],
  );
}

// --- stepView just before and at each boundary -------------------------------------------
{
  const t = stepTimeline(10, [10, 10, 10]); // answers at 1200, 2100, 3000; sentence 3900; total 7200
  same("view: at 0", stepView(t, 0), { visibleAnswers: 0, sentenceShown: false, complete: false });
  same("view: just before the first answer", stepView(t, 1199).visibleAnswers, 0);
  same("view: at the first answer", stepView(t, 1200).visibleAnswers, 1);
  same("view: just before the second", stepView(t, 2099).visibleAnswers, 1);
  same("view: at the third", stepView(t, 3000).visibleAnswers, 3);
  same("view: just before the sentence", stepView(t, 3899).sentenceShown, false);
  same("view: at the sentence", stepView(t, 3900), { visibleAnswers: 3, sentenceShown: true, complete: false });
  same("view: just before the end", stepView(t, 7199).complete, false);
  same("view: at the end", stepView(t, 7200), { visibleAnswers: 3, sentenceShown: true, complete: true });
  const open = stepTimeline(10, []);
  same("view: an open step shows its gap at 1200", stepView(open, 1200), { visibleAnswers: 0, sentenceShown: true, complete: false });
}

// --- nextBoundary -------------------------------------------------------------------
{
  const t = stepTimeline(10, [10, 10]); // 1200, 2100; sentence 3000; total 6300
  same("boundary: from 0, the first answer", nextBoundary(t, 0), 1200);
  same("boundary: from an answer, the next", nextBoundary(t, 1200), 2100);
  same("boundary: from the last answer, the sentence", nextBoundary(t, 2100), 3000);
  same("boundary: from the sentence, the end (the dwell changes nothing)", nextBoundary(t, 3000), 6300);
  same("boundary: complete", nextBoundary(t, 6300), null);
  same("boundary: an open step goes from 0 to its gap", nextBoundary(stepTimeline(10, []), 0), 1200);
}

// --- the reducer ---------------------------------------------------------------------
// Three steps would do, but the tour always has nine: totals 4500 (open) or 5400 (one answer).
const timelines = Array.from({ length: 9 }, (_, i) => stepTimeline(10, i === 4 ? [] : [10]));
const T = (step) => timelines[step - 1].total;
const reduce = createTourReducer(timelines);
const at = (step, elapsed, playing, ended = false) => ({ step, playing, elapsed, ended, autoplay: false });

same("initial: no step waits to autoplay at step 1", initialTourState(timelines, null), {
  step: 1,
  playing: false,
  elapsed: 0,
  ended: false,
  autoplay: true,
});
same("initial: ?step=5 is step 5 complete and paused", initialTourState(timelines, 5), at(5, T(5), false));
same("initial: an out-of-range step reads as none", initialTourState(timelines, 12).autoplay, true);

const arrived = initialTourState(timelines, null);
same("resolve: autoplay plays from the first phase", resolveTourState(arrived, timelines, false), at(1, 0, true));
same("resolve: under reduced motion, step 1 complete and paused", resolveTourState(arrived, timelines, true), at(1, T(1), false));
// A tour opened in a background tab waits: the autoplay stays pending while the page is
// hidden, and plays from the first phase once it is seen.
same("resolve: hidden at arrival, paused and still waiting to autoplay", resolveTourState(arrived, timelines, false, true), {
  step: 1,
  playing: false,
  elapsed: 0,
  ended: false,
  autoplay: true,
});
same("resolve: seen at last, it plays", resolveTourState(resolveTourState(arrived, timelines, false, true), timelines, false, false), at(1, 0, true));
same("resolve: reduced motion wins over hidden", resolveTourState(arrived, timelines, true, true), at(1, T(1), false));
same("reducer: a tick while hidden and waiting does nothing", createTourReducer(timelines, false, true)(arrived, { type: "tick", ms: 1200 }).playing, false);
same("resolve: a settled state is returned as it is", resolveTourState(at(3, 900, false), timelines, true), at(3, 900, false));

same("tick: moves elapsed while playing", reduce(at(2, 0, true), { type: "tick", ms: 1200 }), at(2, 1200, true));
same("tick: does nothing while paused", reduce(at(2, 0, false), { type: "tick", ms: 1200 }), at(2, 0, false));
same("tick: across a step's end, the next step from 0", reduce(at(2, 2100, true), { type: "tick", ms: T(2) - 2100 }), at(3, 0, true));
same("tick: past the end too", reduce(at(2, 2100, true), { type: "tick", ms: 99999 }), at(3, 0, true));
same("tick: across the last step's end, ended and paused", reduce(at(9, 2100, true), { type: "tick", ms: T(9) }), at(9, T(9), false, true));
same("tick: the first tick settles autoplay", reduce(arrived, { type: "tick", ms: 1200 }), at(1, 1200, true));

same("next: while playing, the next step from 0", reduce(at(3, 2000, true), { type: "next" }), at(4, 0, true));
same("next: while paused, the next step complete", reduce(at(3, 2000, false), { type: "next" }), at(4, T(4), false));
same("next: on the last step does nothing", reduce(at(9, 100, true), { type: "next" }), at(9, 100, true));
same("back: while playing, the previous step from 0", reduce(at(3, 2000, true), { type: "back" }), at(2, 0, true));
same("back: while paused, the previous step complete", reduce(at(3, 2000, false), { type: "back" }), at(2, T(2), false));
same("back: on step 1 does nothing", reduce(at(1, 100, false), { type: "back" }), at(1, 100, false));
same("goto: while playing, from 0", reduce(at(3, 2000, true), { type: "goto", step: 7 }), at(7, 0, true));
same("goto: while paused, complete", reduce(at(3, 2000, false), { type: "goto", step: 7 }), at(7, T(7), false));
same("goto: out of range does nothing", reduce(at(3, 2000, false), { type: "goto", step: 10 }), at(3, 2000, false));
same("goto: not an integer does nothing", reduce(at(3, 2000, false), { type: "goto", step: 2.5 }), at(3, 2000, false));
same("goto: clears ended", reduce(at(9, T(9), false, true), { type: "goto", step: 4 }), at(4, T(4), false));
same("back: clears ended", reduce(at(9, T(9), false, true), { type: "back" }), at(8, T(8), false));

same("play: after the end, from step 1", reduce(at(9, T(9), false, true), { type: "play" }), at(1, 0, true));
same("play: on the last step complete, from step 1", reduce(at(9, T(9), false), { type: "play" }), at(1, 0, true));
same("play: on a complete step, the next one", reduce(at(4, T(4), false), { type: "play" }), at(5, 0, true));
same("play: mid-step, resumes", reduce(at(4, 1200, false), { type: "play" }), at(4, 1200, true));
same("play: while playing does nothing", reduce(at(4, 1200, true), { type: "play" }), at(4, 1200, true));
same("pause: stops and keeps elapsed", reduce(at(4, 1200, true), { type: "pause" }), at(4, 1200, false));
// Time spent in the phase is kept: Play then waits only for what is left of it.
same("pause: keeps the time spent in the phase", reduce(at(4, 1200, true), { type: "pause", ms: 500 }), at(4, 1700, false));
same("pause: never crosses the phase's end (it stops 1 ms short)", reduce(at(4, 1200, true), { type: "pause", ms: 5000 }), at(4, 2099, false));
same("hidden: keeps the time spent too", reduce(at(4, 1200, true), { type: "hidden", ms: 300 }), at(4, 1500, false));
same("pause: a negative time counts as none", reduce(at(4, 1200, true), { type: "pause", ms: -40 }), at(4, 1200, false));
{
  const t = stepTimeline(10, [10, 10]); // 1200, 2100; sentence 3000; total 6300
  same("resume: 800 ms into the 900 ms answer phase", elapsedAfterPause(t, 1200, 800), 2000);
  same("resume: the next boundary from there is the phase's end", nextBoundary(t, 2000), 2100);
  same("resume: a step already complete stays as it is", elapsedAfterPause(t, 6300, 500), 6300);
}
same("hidden: stops and keeps elapsed", reduce(at(4, 1200, true), { type: "hidden" }), at(4, 1200, false));
same("hidden: while paused does nothing", reduce(at(4, 1200, false), { type: "hidden" }), at(4, 1200, false));
same("pause: on arrival stops the autoplay at its first phase", reduce(arrived, { type: "pause" }), at(1, 0, false));

{
  const reduced = createTourReducer(timelines, true);
  same("reduced: next on arrival shows step 2 complete, paused", reduced(arrived, { type: "next" }), at(2, T(2), false));
  same("reduced: play on arrival goes on to step 2, playing", reduced(arrived, { type: "play" }), at(2, 0, true));
}

// A whole tour played by ticks to each boundary ends paused on step 9.
{
  let state = resolveTourState(arrived, timelines, false);
  let steps = 0;
  let guard = 0;
  while (state.playing && guard++ < 1000) {
    const timeline = timelines[state.step - 1];
    const target = nextBoundary(timeline, state.elapsed);
    const before = state.step;
    state = reduce(state, { type: "tick", ms: target - state.elapsed });
    if (state.step !== before) steps++;
  }
  same("a whole tour: eight step changes, then ended on step 9", { steps, state }, { steps: 8, state: at(9, T(9), false, true) });
}

// --- where focus goes on a navigation key -------------------------------------------------
{
  // A stand-in for an element: `closest` answers for the selectors it is "inside".
  const element = (...inside) => ({ closest: (selector) => (inside.includes(selector) ? {} : null) });
  const marked = `[${TOUR_KEEP_FOCUS_ATTRIBUTE}]`;
  same("focus: the attribute", TOUR_KEEP_FOCUS_ATTRIBUTE, "data-tour-keep-focus");
  same("focus: a step link or a control keeps it", keyKeepsFocus(element(marked)), true);
  same("focus: an end-card link does not (it may unmount)", keyKeepsFocus(element()), false);
  same("focus: a note marker does not", keyKeepsFocus(element("[data-note-marker]")), false);
  same("focus: no target does not", keyKeepsFocus(null), false);
  same("focus: a target without closest (a text node) does not", keyKeepsFocus({}), false);
}

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
// The step an address names: exactly one valid `step`, else none — the player starts from the
// address the browser shows, so Back to a tour lands on the step that was being watched.
same("search: one step", stepFromSearch("?step=3"), 3);
same("search: among other parameters", stepFromSearch("?ref=x&step=7"), 7);
same("search: none", stepFromSearch(""), null);
same("search: two steps read as none", stepFromSearch("?step=3&step=5"), null);
for (const bad of ["0", "10", "-1", "3.5", "abc", ""]) same(`search: step=${bad} reads as none`, stepFromSearch(`?step=${bad}`), null);
same("restore: a watched step comes back complete and paused", initialTourState(timelines, stepFromSearch("?step=3")), at(3, T(3), false));
// The address the player writes for its step: null when it already says so.
same("address: arrival with no step stays clean", searchForStep("", 1), null);
same("address: the step it shows needs no write", searchForStep("?step=4", 4), null);
same("address: a new step is written", searchForStep("", 2), "?step=2");
same("address: other parameters are kept", searchForStep("?ref=x&step=2", 3), "?ref=x&step=3");
same("address: back to step 1 after moving names it", searchForStep("?step=2", 1), "?step=1");
for (const bad of ["?step=3&step=5", "?step=0", "?step=10", "?step=-1", "?step=3.5", "?step=abc"]) {
  same(`address: ${bad} on step 1 drops the step`, searchForStep(bad, 1), "");
}
same("address: an invalid step among others drops only it", searchForStep("?ref=x&step=abc", 1), "?ref=x");
same("address: two steps on a later step become one", searchForStep("?step=3&step=5", 4), "?step=4");
same("href: no step", tourHref("tidewise"), "/arkademy/business-model-canvas/tour/tidewise");
same("href: a step", tourHref("tidewise", 4), "/arkademy/business-model-canvas/tour/tidewise?step=4");

// --- what the live region says ------------------------------------------------------------
{
  const tide = exampleCanvas(index, "tidewise");
  const company = tide.company;
  same(
    "announce: an answered step names each answer, never its note",
    stepAnnouncement({ step: 3, question: questions[2], company, state: tide.questions[2] }),
    "Step 3 of 9, Channels. How do they find out about it, and how do they get it? Tidewise's answers: anglers swapping tips on the pier and app store search.",
  );
  same(
    "announce: one answer",
    stepAnnouncement({ step: 1, question: questions[0], company, state: tide.questions[0] }),
    "Step 1 of 9, Customer segments. Who is this for? Tidewise's answer: people who fish from the shore.",
  );
  same(
    "announce: a step left open on purpose",
    stepAnnouncement({ step: 5, question: questions[4], company, state: tide.questions[4] }),
    "Step 5 of 9, Revenue streams. Where does the money come from? Tidewise leaves this open on purpose.",
  );
  same(
    "announce: a step not answered",
    stepAnnouncement({ step: 5, question: questions[4], company, state: { key: "rev", answers: [], open: false } }),
    "Step 5 of 9, Revenue streams. Where does the money come from? Tidewise has not answered this one.",
  );
  same(
    "announce: while playing, the step and its question only",
    stepAnnouncement({ step: 3, question: questions[2], company, state: tide.questions[2], answers: false }),
    "Step 3 of 9, Channels. How do they find out about it, and how do they get it?",
  );
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
// the keyboard-shortcuts suite's to refuse, and the address the player writes is
// searchForStep's, tested above.
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
