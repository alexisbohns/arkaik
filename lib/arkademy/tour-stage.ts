import { BMC_QUESTION_KEYS } from "./constants";
import { displayAnswers, joinAnswers, type CanvasQuestionState, type ParagraphSegment } from "./paragraph";
import type { BmcQuestion, Company } from "./schema";
import { bmcTourPath } from "./tools";

/**
 * The tour, read step by step (docs/superpowers/specs/2026-11-12-arkademy-bmc-design.md
 * § "The tour"): the reader moves it, nothing runs on a clock. One example's
 * tour is a line of stages —
 *
 *   the opening (the company, its one-liner),
 *   then, for each of the nine questions in canonical order, two beats:
 *     "ask"    — the question is asked, explained, and answered, in bubbles,
 *     "canvas" — the deck of nine tiles, this question's tile turned face up,
 *   then the end (the paragraph, the whole canvas, where to go next).
 *
 * Every stage has an address, so a reload, a shared link and the browser's
 * Back and Forward land on it, and the server renders it whole:
 *
 *   (no step)             the opening
 *   ?step=3               question 3, ask beat
 *   ?step=3&beat=canvas   question 3, canvas beat
 *   ?step=end             the end
 *
 * Anything else (a step out of range, two steps, an unknown beat) reads as the
 * nearest sensible stage, never as an error: see `parseTourStage`. Other
 * parameters (`?scheme=`, `?font=`) are left as they are.
 *
 * Pure, and imports only its siblings, like every module in lib/arkademy/.
 */

/** The nine questions, one per step. */
export const TOUR_STEPS = BMC_QUESTION_KEYS.length;

export type TourBeat = "ask" | "canvas";

export type TourStage =
  | { kind: "opening" }
  | { kind: "question"; step: number; beat: TourBeat }
  | { kind: "end" };

/** The opening, two beats per question, the end. */
export const TOUR_STAGE_COUNT = TOUR_STEPS * 2 + 2;

/** A stage's place in the line: 0 the opening, 1–18 the beats (step 3 ask is 5, canvas 6), 19 the end. */
export function tourStageIndex(stage: TourStage): number {
  if (stage.kind === "opening") return 0;
  if (stage.kind === "end") return TOUR_STAGE_COUNT - 1;
  return (stage.step - 1) * 2 + (stage.beat === "ask" ? 1 : 2);
}

/** The stage at a place in the line, clamped to it. */
export function tourStageAt(index: number): TourStage {
  const at = Math.min(Math.max(Math.trunc(Number.isFinite(index) ? index : 0), 0), TOUR_STAGE_COUNT - 1);
  if (at === 0) return { kind: "opening" };
  if (at === TOUR_STAGE_COUNT - 1) return { kind: "end" };
  return { kind: "question", step: Math.ceil(at / 2), beat: at % 2 === 1 ? "ask" : "canvas" };
}

/** Continue: the next stage, or null at the end. */
export function nextTourStage(stage: TourStage): TourStage | null {
  const index = tourStageIndex(stage);
  return index >= TOUR_STAGE_COUNT - 1 ? null : tourStageAt(index + 1);
}

/** Back: the previous stage, or null on the opening. */
export function previousTourStage(stage: TourStage): TourStage | null {
  const index = tourStageIndex(stage);
  return index <= 0 ? null : tourStageAt(index - 1);
}

/** A stable name per stage ("opening", "3-ask", "3-canvas", "end"): React's key for the stage's screen. */
export function tourStageKey(stage: TourStage): string {
  return stage.kind === "question" ? `${stage.step}-${stage.beat}` : stage.kind;
}

/**
 * How many tiles lie face up on the deck, from the first question: none at
 * the opening, the earlier ones while a question is asked, this one too once
 * its tile is turned (the canvas beat), all nine at the end.
 */
export function tilesFaceUp(stage: TourStage): number {
  if (stage.kind === "opening") return 0;
  if (stage.kind === "end") return TOUR_STEPS;
  return stage.beat === "canvas" ? stage.step : stage.step - 1;
}

/** The step a stage belongs to, or null for the opening and the end. */
export function tourStageStep(stage: TourStage): number | null {
  return stage.kind === "question" ? stage.step : null;
}

function single(raw: string | string[] | undefined): string | undefined {
  return typeof raw === "string" ? raw : undefined;
}

/**
 * The stage a `step` and a `beat` parameter name, as the server and the
 * client both read them. `step` is `end`, or an integer from 1 to 9 written
 * plainly ("3", never "03" or "3.0"); `beat` is `canvas` or absent (anything
 * else is the ask beat). No step, or one the parser refuses — repeated, out of
 * range, not a number — is the opening. The end ignores `beat`.
 */
export function parseTourStage(step: string | string[] | undefined, beat?: string | string[] | undefined): TourStage {
  const rawStep = single(step);
  if (rawStep === "end") return { kind: "end" };
  if (rawStep === undefined || !/^[1-9][0-9]*$/.test(rawStep)) return { kind: "opening" };
  const n = Number(rawStep);
  if (n > TOUR_STEPS) return { kind: "opening" };
  return { kind: "question", step: n, beat: single(beat) === "canvas" ? "canvas" : "ask" };
}

/** The stage an address's query string (`location.search`) names, read as `parseTourStage` reads it. */
export function tourStageFromSearch(search: string): TourStage {
  const params = new URLSearchParams(search);
  const steps = params.getAll("step");
  const beats = params.getAll("beat");
  return parseTourStage(steps.length === 1 ? steps[0] : undefined, beats.length === 1 ? beats[0] : undefined);
}

/**
 * The query string an address should carry to show `stage`, keeping every
 * other parameter: `step` and `beat` are rewritten (the opening carries
 * neither, the ask beat no `beat`). The result is `""` or starts with `?`.
 */
export function searchForTourStage(search: string, stage: TourStage): string {
  const params = new URLSearchParams(search);
  params.delete("step");
  params.delete("beat");
  if (stage.kind === "end") params.set("step", "end");
  if (stage.kind === "question") {
    params.set("step", String(stage.step));
    if (stage.beat === "canvas") params.set("beat", "canvas");
  }
  const query = params.toString();
  return query === "" ? "" : `?${query}`;
}

/** An example's tour at a stage — the address every Continue, Back and step link uses. */
export function tourStageHref(companyId: string, stage: TourStage, search = ""): string {
  return `${bmcTourPath(companyId)}${searchForTourStage(search, stage)}`;
}

/** What each pip of the step indicator shows for a stage. */
export type TourPipState = "done" | "current" | "turned" | "ahead";

/**
 * The nine pips of the step indicator: a question already turned face up is
 * `done`; the stage's own question is `current` while it is asked and
 * `turned` once its tile is (the pip takes the tile's shape); the rest are
 * `ahead`. At the end all nine are done.
 */
export function tourPips(stage: TourStage): TourPipState[] {
  const up = tilesFaceUp(stage);
  return Array.from({ length: TOUR_STEPS }, (_, i): TourPipState => {
    const step = i + 1;
    if (stage.kind === "question" && step === stage.step) return stage.beat === "ask" ? "current" : "turned";
    return step <= up ? "done" : "ahead";
  });
}

function possessive(name: string): string {
  return `${name}'s`;
}

/**
 * What the live region says when a question's bubbles arrive. Focus is on the
 * question itself (the reader hears it there), so this is what follows it:
 * where the tour is, the hint, then the answers — or that the company leaves
 * the question open on purpose.
 */
export function askAnnouncement(input: {
  step: number;
  question: Pick<BmcQuestion, "block" | "hint">;
  company: Pick<Company, "name">;
  state: CanvasQuestionState;
}): string {
  const { step, question, company, state } = input;
  const head = `Question ${step} of ${TOUR_STEPS}, ${question.block}.`;
  const hint = question.hint ? ` ${question.hint}` : "";
  const answers = displayAnswers(state).map((answer) => answer.text);
  if (answers.length > 0) {
    const noun = answers.length === 1 ? "answer" : "answers";
    return `${head}${hint} ${possessive(company.name)} ${noun}: ${joinAnswers(answers)}.`;
  }
  return state.open
    ? `${head}${hint} ${company.name} leaves this open on purpose.`
    : `${head}${hint} ${company.name} has not answered this one.`;
}

/** What the live region says when a question's tile is turned face up on the deck. */
export function turnAnnouncement(input: {
  step: number;
  question: Pick<BmcQuestion, "block">;
  state: CanvasQuestionState;
}): string {
  const { step, question, state } = input;
  const answers = displayAnswers(state).map((answer) => answer.text);
  const face =
    answers.length > 0 ? joinAnswers(answers) : state.open ? "left open on purpose" : "not answered yet";
  const count = step === TOUR_STEPS ? "All nine blocks are face up." : `${step} of ${TOUR_STEPS} blocks face up.`;
  return `${question.block} turned face up on the canvas: ${face}. ${count}`;
}

/**
 * Whether an address under /arkademy is the tour's interactive screen, which
 * draws its own top bar (leave, the company, the stepper, the theme) instead
 * of the Arkademy's header: the active segments below app/arkademy/layout.tsx
 * (`useSelectedLayoutSegments`), `business-model-canvas/tour/<example>`.
 */
export function ownsArkademyChrome(segments: readonly string[]): boolean {
  return segments[0] === "business-model-canvas" && segments[1] === "tour" && segments.length >= 3;
}

/* ── Cadence: the rhythm of a screen's entrances ───────────────────────────
 * The reader moves the tour; within a screen, what arrives arrives on a
 * fixed tempo — pop · pop-pop · pop · pop-pop — not at reading speed. These
 * are the CSS delays (milliseconds from the screen's mount) the screen writes
 * on each element. Nothing here advances a step: a press while a screen is
 * still arriving shows the rest at once (TourStage), the next press moves
 * on. Reduced motion, and a step back onto a screen, show it whole at once. */

/** The tempo: one beat between groups, a tight interval within one. */
export const TOUR_CADENCE = {
  /** Before the first pop. */
  leadMs: 100,
  /** Between two groups. */
  beatMs: 450,
  /** Within a group: the question and its explanation; one answer and the next. */
  tightMs: 150,
  /** A pop itself (the fast spring). */
  popMs: 440,
} as const;

/** When each element of a conversation beat arrives, in ms from the screen's mount. */
export interface AskCadence {
  asker: number;
  question: number;
  /** null without an explanation. */
  hint: number | null;
  company: number;
  /** One per reply bubble, in order: the answers, or the open answer and its aside. */
  replies: number[];
  /** Everything has arrived and settled. */
  done: number;
}

/**
 * The conversation's rhythm: pop (the asker's avatar) · pop-pop (the
 * question, its explanation hard on its heels) · pop (the company's avatar) ·
 * pop-pop… (its replies, one tight run). Three answers play in 2.3 s.
 */
export function askCadence(hasHint: boolean, replies: number): AskCadence {
  const c = TOUR_CADENCE;
  const asker = c.leadMs;
  const question = asker + c.beatMs;
  const hint = hasHint ? question + c.tightMs : null;
  const company = (hint ?? question) + c.beatMs;
  const at = Array.from({ length: Math.max(0, replies) }, (_, i) => company + c.beatMs + i * c.tightMs);
  const last = at.length > 0 ? at[at.length - 1] : company;
  return { asker, question, hint, company, replies: at, done: last + c.popMs };
}

/** The end's pace: the paragraph flowing in, in short runs of words, then the canvas, then the two choices. */
export const TOUR_END_CADENCE = {
  /** Before the first word. */
  leadMs: 300,
  /** A short paragraph flows in at a word per this… */
  wordMs: 30,
  /** …and a long one in runs of words, never more often than this. */
  minTickMs: 25,
  /** The whole paragraph's flow, at most. */
  revealCapMs: 3500,
  /** A word's own fade. */
  wordFadeMs: 260,
  /** After the last word, one beat, the canvas; one more, the choices. */
  canvasAfterMs: 450,
  choicesAfterMs: 450,
} as const;

export interface EndCadence {
  /** The first word. */
  start: number;
  /** How many words arrive together. */
  runSize: number;
  /** Between two runs. */
  runMs: number;
  /** The last word has faded in. */
  paragraphDone: number;
  canvas: number;
  choices: number;
}

/**
 * The end's timings for a paragraph of `words` words (`paragraphWords`, gap
 * pills and note markers counting one each): a word every 30 ms while that
 * fits in 3.5 s; past that, words arrive in runs (as few per run as keeps
 * each tick at least 25 ms apart) so the whole flow stays within 3.5 s. With
 * the library of 2026-11 (110 to 329 words): 3.3 to 3.5 s.
 */
export function endCadence(words: number): EndCadence {
  const c = TOUR_END_CADENCE;
  const count = Math.max(1, Math.floor(words));
  const runSize = count * c.wordMs <= c.revealCapMs ? 1 : Math.ceil((count * c.minTickMs) / c.revealCapMs);
  const runs = Math.ceil(count / runSize);
  const runMs = Math.floor(Math.min(c.wordMs * runSize, c.revealCapMs / runs));
  const paragraphDone = c.leadMs + (runs - 1) * runMs + c.wordFadeMs;
  const canvas = paragraphDone + c.canvasAfterMs;
  return { start: c.leadMs, runSize, runMs, paragraphDone, canvas, choices: canvas + c.choicesAfterMs };
}

/** A word's turn in the end's flow: its run's. */
export function wordTurn(cadence: Pick<EndCadence, "start" | "runSize" | "runMs">, index: number): number {
  return cadence.start + Math.floor(index / cadence.runSize) * cadence.runMs;
}

/**
 * A run of text cut into words, each keeping the spaces after it (and a run
 * of leading spaces kept as its own piece), so joining the pieces gives the
 * text back exactly.
 */
export function splitWords(text: string): string[] {
  return text.match(/\s+|\S+\s*/g) ?? [];
}

/** Whether a piece from `splitWords` is a word (not only spaces). */
export function isWord(piece: string): boolean {
  return /\S/.test(piece);
}

/**
 * How many steps a paragraph's word-by-word reveal takes: each word of its
 * sentences, each note marker, and each gap pill (whole, as one).
 */
export function paragraphWords(segments: readonly ParagraphSegment[]): number {
  let count = 0;
  for (const segment of segments) {
    if (segment.kind === "gap") {
      count += 1;
      continue;
    }
    for (const part of segment.parts) count += part.kind === "note" ? 1 : splitWords(part.text).filter(isWord).length;
  }
  return count;
}

/**
 * The end's paragraph, sized to fit: its length in characters (sentences and
 * gap pills, as shown) puts it in one of four sizes, so it fits beside the
 * canvas at 1440×900 (m3-tour.css `.mx-end__card[data-fit]`). With the
 * library of 2026-11: s for Arkaik and Pebbles, l for PayFit and Linear, xl
 * for Livestorm and Anthropic, m for the rest. Where it still cannot fit (a
 * phone, a short window), the screen follows the reveal (TourStage).
 */
export const TOUR_END_FIT = { m: 1000, l: 1400, xl: 1700 } as const;

export type TourEndFit = "s" | "m" | "l" | "xl";

export function paragraphFit(segments: readonly ParagraphSegment[]): TourEndFit {
  const characters = segments.reduce((sum, segment, i) => sum + segment.text.length + (i > 0 ? 1 : 0), 0);
  if (characters > TOUR_END_FIT.xl) return "xl";
  if (characters > TOUR_END_FIT.l) return "l";
  if (characters > TOUR_END_FIT.m) return "m";
  return "s";
}
