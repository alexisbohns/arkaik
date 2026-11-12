import { displayAnswers, joinAnswers } from "./paragraph";
import type { CanvasQuestionState } from "./paragraph";
import { BMC_QUESTION_KEYS } from "./schema";
import type { BmcQuestion, Company } from "./schema";
import { bmcTourPath } from "./tools";

/**
 * The tour (docs/superpowers/specs/2026-11-12-arkademy-bmc-design.md § "The
 * tour"): one example's canvas built in nine steps. Each step has phases — the
 * question appears; its answers arrive one by one; the paragraph gains the
 * step's sentence and the canvas block fills; the step holds for reading —
 * and this module is their clock, as pure functions: the timeline of a step,
 * what a step shows at a given time, and the player's reducer. The React side
 * (lib/hooks/useTourPlayer.ts) only schedules one timeout to the next phase.
 *
 * Imports only its siblings, like every module in lib/arkademy/.
 */

/** The steps of a tour: one per question. */
const STEP_COUNT = BMC_QUESTION_KEYS.length;

/**
 * How long each phase lasts. A phase that has something to read lasts at
 * least its floor and otherwise `readMsPerChar` per character of what it
 * shows: the question's prompt, then each answer's wording (a note is not
 * counted; Pause is there for it). Rehearsed on the fictional fixture (short
 * wordings: a step of about 6 s) and on a stress example (140-character
 * wordings: about 4.5 s per answer).
 */
export const TOUR_TIMING = {
  questionMs: 1200,
  answerMs: 900,
  readMsPerChar: 30,
  sentenceMs: 900,
  dwellMs: 2400,
} as const;

/** One step's phase boundaries, in milliseconds from the step's start. */
export interface StepTimeline {
  /** When each answer arrives, in display order. */
  answersAt: number[];
  /** The paragraph gains the sentence (or the gap) and the canvas block fills. */
  sentenceAt: number;
  /** The new sentence's highlight has faded in; the step holds from here. */
  dwellAt: number;
  /** The step is complete; while playing, the next one starts. */
  total: number;
}

function readingMs(floor: number, characters: number): number {
  return Math.max(floor, Math.round(characters * TOUR_TIMING.readMsPerChar));
}

/**
 * A step's timeline from the length of its question's prompt and of each
 * answer's wording. With no answer, the sentence (the gap) follows the
 * question directly.
 */
export function stepTimeline(promptLength: number, answerLengths: readonly number[]): StepTimeline {
  const answersAt: number[] = [];
  let at = readingMs(TOUR_TIMING.questionMs, promptLength);
  for (const length of answerLengths) {
    answersAt.push(at);
    at += readingMs(TOUR_TIMING.answerMs, length);
  }
  const dwellAt = at + TOUR_TIMING.sentenceMs;
  return { answersAt, sentenceAt: at, dwellAt, total: dwellAt + TOUR_TIMING.dwellMs };
}

/**
 * The nine timelines of an example, in question order. Answers are measured
 * as every page shows them (`displayAnswers`: cleaned, empties dropped).
 */
export function tourTimelines(
  questions: readonly Pick<BmcQuestion, "key" | "prompt">[],
  state: readonly CanvasQuestionState[],
): StepTimeline[] {
  const byKey = new Map(state.map((question) => [question.key, question]));
  return questions.map((question) =>
    stepTimeline(
      question.prompt.length,
      displayAnswers(byKey.get(question.key)).map((answer) => answer.text.length),
    ),
  );
}

/** What a step shows `elapsed` ms after it started. */
export interface StepView {
  visibleAnswers: number;
  sentenceShown: boolean;
  complete: boolean;
}

export function stepView(timeline: StepTimeline, elapsed: number): StepView {
  return {
    visibleAnswers: timeline.answersAt.filter((at) => at <= elapsed).length,
    sentenceShown: elapsed >= timeline.sentenceAt,
    complete: elapsed >= timeline.total,
  };
}

/**
 * The next moment after `elapsed` at which the step looks different — an
 * answer arrives, the sentence appears, the step ends — or null once the step
 * is complete. `dwellAt` changes nothing on screen, so it is not one.
 */
export function nextBoundary(timeline: StepTimeline, elapsed: number): number | null {
  const after = [...timeline.answersAt, timeline.sentenceAt, timeline.total].filter((at) => at > elapsed);
  return after.length === 0 ? null : Math.min(...after);
}

export interface TourState {
  /** 1–9. */
  step: number;
  playing: boolean;
  /** Milliseconds into the step, at the last phase boundary reached. */
  elapsed: number;
  /** The last step played to its end. */
  ended: boolean;
  /**
   * Arrived without `?step=` and nothing has happened yet: the tour plays
   * unless the reader prefers reduced motion (`resolveTourState`). The server
   * cannot know that preference, so the decision waits for the client.
   */
  autoplay: boolean;
}

export type TourAction =
  | { type: "play" }
  | { type: "pause" }
  | { type: "next" }
  | { type: "back" }
  | { type: "goto"; step: number }
  | { type: "tick"; ms: number }
  | { type: "hidden" };

/**
 * Where a tour starts: without a step, step 1 at its first phase, waiting to
 * autoplay; with `?step=N`, step N complete and paused — a link to a step is
 * a citation.
 */
export function initialTourState(timelines: readonly StepTimeline[], step: number | null): TourState {
  if (step === null || step < 1 || step > timelines.length) {
    return { step: 1, playing: false, elapsed: 0, ended: false, autoplay: true };
  }
  return { step, playing: false, elapsed: timelines[step - 1].total, ended: false, autoplay: false };
}

/**
 * Settles a pending autoplay: playing from the first phase, or — under
 * reduced motion — the step complete and paused. Every other state is
 * returned as it is. The screen renders the resolved state and the reducer
 * acts on it, so the decision needs no effect.
 */
export function resolveTourState(
  state: TourState,
  timelines: readonly StepTimeline[],
  reducedMotion: boolean,
): TourState {
  if (!state.autoplay) return state;
  return reducedMotion
    ? { ...state, playing: false, elapsed: timelines[state.step - 1].total, autoplay: false }
    : { ...state, playing: true, autoplay: false };
}

/**
 * The player's reducer over one example's nine timelines.
 *
 * - `tick` advances `elapsed` while playing; past a step's total the next
 *   step starts at 0; past the last one the tour ends, paused.
 * - `next`, `back`, `goto`: while playing, the target starts from its first
 *   phase and keeps playing; while paused, it shows complete. `back` on step 1
 *   and `next` on the last step do nothing. Each clears `ended`.
 * - `play`: after the end (or on the last step complete), from step 1; on a
 *   complete step, the next one; otherwise it resumes.
 * - `pause` and `hidden` (the page was hidden) stop and keep `elapsed`; the
 *   tour never resumes by itself.
 */
export function createTourReducer(
  timelines: readonly StepTimeline[],
  reducedMotion = false,
): (state: TourState, action: TourAction) => TourState {
  const steps = timelines.length;
  const total = (step: number) => timelines[step - 1].total;
  const enter = (state: TourState, step: number): TourState => ({
    ...state,
    step,
    elapsed: state.playing ? 0 : total(step),
    ended: false,
  });

  return (current, action) => {
    const state = resolveTourState(current, timelines, reducedMotion);
    switch (action.type) {
      case "tick": {
        if (!state.playing) return state;
        const elapsed = state.elapsed + action.ms;
        if (elapsed < total(state.step)) return { ...state, elapsed };
        if (state.step < steps) return { ...state, step: state.step + 1, elapsed: 0 };
        return { ...state, playing: false, elapsed: total(state.step), ended: true };
      }
      case "next":
        return state.step < steps ? enter(state, state.step + 1) : state;
      case "back":
        return state.step > 1 ? enter(state, state.step - 1) : state;
      case "goto":
        return Number.isInteger(action.step) && action.step >= 1 && action.step <= steps
          ? enter(state, action.step)
          : state;
      case "play": {
        if (state.playing) return state;
        const complete = state.elapsed >= total(state.step);
        if (state.ended || (complete && state.step === steps)) {
          return { step: 1, playing: true, elapsed: 0, ended: false, autoplay: false };
        }
        if (complete) return { ...state, step: state.step + 1, playing: true, elapsed: 0 };
        return { ...state, playing: true };
      }
      case "pause":
      case "hidden":
        return state.playing ? { ...state, playing: false } : state;
    }
  };
}

/** `?step=N` as a step, N an integer from 1 to 9; anything else reads as absent. */
export function parseStepParam(raw: string | string[] | undefined): number | null {
  if (typeof raw !== "string" || !/^[1-9][0-9]*$/.test(raw)) return null;
  const step = Number(raw);
  return step <= STEP_COUNT ? step : null;
}

/** An example's tour, optionally at a step: the address every step link and `replaceState` use. */
export function tourHref(companyId: string, step?: number): string {
  return step === undefined ? bmcTourPath(companyId) : `${bmcTourPath(companyId)}?step=${step}`;
}

function possessive(name: string): string {
  return `${name}'s`;
}

/**
 * What the live region says when a step starts — once per step, never per
 * answer: "Step 3 of 9, Channels. How do they find out…? Tidewise's answers:
 * app stores and word of mouth."
 */
export function stepAnnouncement(input: {
  step: number;
  question: Pick<BmcQuestion, "block" | "prompt">;
  company: Pick<Company, "name">;
  state: CanvasQuestionState;
}): string {
  const { step, question, company, state } = input;
  const answers = displayAnswers(state).map((answer) => answer.text);
  const head = `Step ${step} of ${STEP_COUNT}, ${question.block}. ${question.prompt}`;
  if (answers.length > 0) {
    const noun = answers.length === 1 ? "answer" : "answers";
    return `${head} ${possessive(company.name)} ${noun}: ${joinAnswers(answers)}.`;
  }
  return state.open
    ? `${head} ${company.name} leaves this open on purpose.`
    : `${head} ${company.name} has not answered this one.`;
}

/** What the live region says when the last step has played. */
export function tourEndAnnouncement(company: Pick<Company, "name">): string {
  return `End of the tour: ${possessive(company.name)} nine answers, read back as one paragraph.`;
}
