#!/usr/bin/env node

/**
 * The tour's pure side (lib/arkademy/tour.ts): a step's timeline and what it
 * shows at a given time, the player's reducer, the `?step=` parser and the
 * tour's address, and what the live region says. DB-free, so it runs in CI's
 * `build` job. Then the screen itself, rendered on the server in Node, and
 * source checks: no window keydown listener, and the cover links every
 * example to its tour.
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
    "announce: the end",
    tourEndAnnouncement(company),
    "End of the tour: Tidewise's nine answers, read back as one paragraph.",
  );
}

// --- the screen, rendered on the server --------------------------------------------
// Through tests/app/load-arkademy-tsx.js (a require hook: .tsx transpiled in
// memory, "@/" resolved to the repo root), as the paragraph suite does. What
// renderToStaticMarkup returns is the HTML a visitor gets before any script
// runs: the arrival state of each kind of address.
{
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const { requireTsx } = require("./load-arkademy-tsx");
  const { CanvasWalk } = requireTsx("components/arkademy/CanvasWalk.tsx");

  const tide = exampleCanvas(index, "tidewise");
  const walk = (initialStep) =>
    renderToStaticMarkup(
      React.createElement(CanvasWalk, {
        mode: "tour",
        company: tide.company,
        questions,
        state: tide.questions,
        initialStep,
        next: { name: "Inkwell", href: tourHref("inkwell") },
        examplesHref: "/arkademy/business-model-canvas#examples",
      }),
    );
  const live = (html) => (/<p aria-live="polite"[^>]*>([^<]*)<\/p>/.exec(html) ?? [null, ""])[1].replace(/&#x27;/g, "'");
  const current = (html) => (/<a[^>]*aria-label="([^"]*)"[^>]*aria-current="step"/.exec(html) ?? [null, ""])[1];

  const arrival = walk(null);
  check("screen, no step: the play button offers to pause (autoplay)", arrival.includes('aria-label="Pause the tour"'));
  same("screen, no step: step 1 is current", current(arrival), "Step 1: Customer segments, answered");
  check(
    "screen, no step: the answer has not arrived — kept in place, hidden",
    /<li aria-hidden="true"[^>]*>people who fish from the shore/.test(arrival),
  );
  check("screen, no step: the paragraph is still empty", arrival.includes("The paragraph starts with the first question"));
  check("screen, no step: the block is being answered", arrival.includes('aria-label="Customer segments, being answered"'));
  same(
    "screen, no step: the live region holds step 1",
    live(arrival),
    "Step 1 of 9, Customer segments. Who is this for? Tidewise's answer: people who fish from the shore.",
  );
  check("screen: the player handles its own keys", arrival.includes('aria-keyshortcuts="ArrowLeft ArrowRight Home End Space K"'));
  check("screen: a step link is a real address", arrival.includes('href="/arkademy/business-model-canvas/tour/tidewise?step=5"'));
  check("screen: a step left open is named so", arrival.includes('aria-label="Step 5: Revenue streams, left open on purpose"'));
  check("screen: Back on step 1 stays focusable", /aria-disabled="true"[^>]*>[\s\S]{0,400}?Back/.test(arrival));
  check("screen, no step: no end card", !arrival.includes("End of the tour"));

  const open = walk(5);
  check("screen, step 5: paused", open.includes('aria-label="Play the tour"'));
  same("screen, step 5: step 5 is current", current(open), "Step 5: Revenue streams, left open on purpose");
  check("screen, step 5: says it is left open on purpose", open.includes("Tidewise leaves this open on purpose."));
  check("screen, step 5: nothing waits to arrive", !open.includes('aria-hidden="true" class="rounded-lg border border-dashed'));
  check("screen, step 5: the paragraph ends on the gap", /data-kind="gap"[^>]*>[\s\S]*?left open on purpose: where the money comes from/.test(open));
  check("screen, step 5: the block says so too", open.includes("Left open on purpose."));

  const noted = walk(6);
  check("screen, step 6: the note is a marker after its answer", noted.includes('aria-label="Source note for public tide data"'));
  same(
    "screen, step 6: one marker in the card, one in the paragraph — the card's sentence has none",
    noted.split('aria-label="Source note for public tide data"').length - 1,
    2,
  );

  const last = walk(9);
  check("screen, step 9: the end card", last.includes("End of the tour") && last.includes("Next example: Inkwell"));
  check("screen, step 9: play starts over", last.includes('aria-label="Replay the tour"'));
  check("screen, step 9: back to the gallery", last.includes('href="/arkademy/business-model-canvas#examples"'));
  const withAction = renderToStaticMarkup(
    React.createElement(CanvasWalk, {
      mode: "tour",
      company: tide.company,
      questions,
      state: tide.questions,
      initialStep: 9,
      next: null,
      examplesHref: "/arkademy/business-model-canvas#examples",
      endActions: React.createElement("a", { href: "/part-4" }, "Start your own"),
    }),
  );
  check("screen, step 9: the page's end actions come first in the end card", /End of the tour[\s\S]*Start your own[\s\S]*All examples/.test(withAction));
  check("screen, step 9: no next example with a single example", !withAction.includes("Next example"));
}

// --- source checks: no window keydown, replaceState only, the cover links each tour -----
{
  const hook = fs.readFileSync(path.join(ROOT, "lib", "hooks", "useTourPlayer.ts"), "utf8");
  check("hook: no keydown listener on window or document", !/addEventListener\(\s*["']keydown["']/.test(hook));
  check("hook: the URL is rewritten with replaceState, never pushState", hook.includes("history.replaceState(") && !hook.includes("history.pushState("));
  const cover = fs.readFileSync(path.join(ROOT, "app", "arkademy", "business-model-canvas", "page.tsx"), "utf8");
  check("cover: each example links to its tour", cover.includes("tourHref(example.company.id)"));
  check("cover: the hero's Play a tour goes to the examples", cover.includes('href="#examples"'));
  check("cover: no link to your own canvas yet (part 4)", !cover.includes("BMC_YOURS_PATH"));
}

cleanup();
if (failures > 0) {
  console.log(`\n${failures} arkademy-tour test(s) failed`);
  process.exit(1);
}
console.log("\nAll arkademy-tour tests passed.");
