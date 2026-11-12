import { cleanAnswer, displayAnswers } from "./paragraph";
import type { CanvasAnswer, CanvasQuestionState } from "./paragraph";
import { ANSWER_MAX_LENGTH, BMC_QUESTION_KEYS, MAX_ANSWERS_PER_QUESTION } from "./schema";
import type { BmcQuestionKey } from "./schema";
import { BMC_YOURS_PATH } from "./tools";

/**
 * Your own canvas (spec § "Your own canvas"): the visitor's draft and the pure
 * reducer every edit goes through. The draft lives in this browser only
 * (canvas-storage.ts parses and serialises it; lib/hooks/useCanvasDraft.ts is
 * its one reader and writer). Imports only its siblings, like every module in
 * lib/arkademy/.
 *
 * The reducer is pure: answer ids are sequential (`a1`, `a2`, …) rather than
 * random, and `updatedAt` is stamped by the store that writes, not here.
 */

/** The visitor's product name, the paragraph's subject. Empty reads as "This product". */
export const NAME_MAX_LENGTH = 60;

export interface DraftAnswer {
  /** Unique within the draft, for React keys and edits: `a1`, `a2`, … */
  id: string;
  question: BmcQuestionKey;
  /** As typed, at most ANSWER_MAX_LENGTH, one line. Trimmed when composed, stored and exported. */
  text: string;
  /** The library entity this answer was added from. Kept when the visitor rewords it. */
  inspiration?: { entity: string; documentVersion: number };
}

export interface CanvasDraft {
  name: string; // ≤ NAME_MAX_LENGTH
  answers: DraftAnswer[]; // per question, in display order
  open: BmcQuestionKey[]; // canonical order, never a question with answers
  updatedAt: string; // ISO 8601, or "" for a draft never written
}

export type DraftAction =
  | { type: "rename"; name: string }
  | { type: "add"; question: BmcQuestionKey; text: string }
  | { type: "addInspiration"; question: BmcQuestionKey; entity: string; text: string; documentVersion: number } // text: the inspiration's `answer`
  | { type: "edit"; id: string; text: string } // a blank text is kept while its field has focus; the field removes it on blur
  | { type: "remove"; id: string }
  | { type: "move"; id: string; offset: -1 | 1 } // within its question
  | { type: "setOpen"; question: BmcQuestionKey; open: boolean }
  | { type: "reset" }
  | { type: "replace"; draft: CanvasDraft }; // another tab wrote

export type QuestionStatus = "answered" | "open" | "empty";

export function emptyDraft(): CanvasDraft {
  return { name: "", answers: [], open: [], updatedAt: "" };
}

/** Line breaks and tabs become single spaces: every draft text is one line. */
export function oneLine(text: string): string {
  return text.replace(/\s*[\r\n\t]+\s*/g, " ");
}

/** The first `max` UTF-16 units, never splitting a surrogate pair. */
export function cutText(text: string, max: number): string {
  if (text.length <= max) return text;
  const code = text.charCodeAt(max - 1);
  return text.slice(0, code >= 0xd800 && code <= 0xdbff ? max - 1 : max);
}

/**
 * The characters part 1's schema refuses in any text (`textCharacterProblem`
 * in schema.ts): C0 controls but tab and line feed, DEL and C1, the line and
 * paragraph separators, zero-width characters and bidirectional controls.
 * A visitor's name or answer would otherwise carry, say, a right-to-left
 * override that flips the rest of the paragraph. The suite checks this list
 * against the schema's own, code point by code point.
 */
const TEXT_CONTROLS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u2028\u2029\u200B-\u200D\u2060-\u2064\uFEFF\u180E\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;
const LONE_HIGH_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g;
const LONE_LOW_SURROGATE = /(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** Text without the control characters the schema refuses, and without lone surrogates. */
export function stripTextControls(text: string): string {
  return text.replace(TEXT_CONTROLS, "").replace(LONE_HIGH_SURROGATE, "").replace(LONE_LOW_SURROGATE, "$1");
}

/** A typed or pasted answer as the draft keeps it: one line, no control characters, at most ANSWER_MAX_LENGTH. */
export function fitAnswer(text: string): string {
  return cutText(stripTextControls(oneLine(text)), ANSWER_MAX_LENGTH);
}

/** The product's name as the draft keeps it: one line, no control characters, at most NAME_MAX_LENGTH. */
export function fitName(name: string): string {
  return cutText(stripTextControls(oneLine(name)), NAME_MAX_LENGTH);
}

/**
 * Whether a text says anything once cleaned the way the paragraph cleans it
 * (`cleanAnswer`): "..." or "!" does not. Such a text is never an answer.
 */
export function hasWords(text: string): boolean {
  return cleanAnswer(text) !== "";
}

/** The answers of one question, in display order (blank ones included). */
export function answersOf(draft: CanvasDraft, question: BmcQuestionKey): DraftAnswer[] {
  return draft.answers.filter((answer) => answer.question === question);
}

function sameText(a: string, b: string): boolean {
  return a.trim().toLocaleLowerCase("en") === b.trim().toLocaleLowerCase("en");
}

/** Whether a question already holds this text, compared trimmed and case-insensitively. */
export function hasAnswerText(draft: CanvasDraft, question: BmcQuestionKey, text: string): boolean {
  return answersOf(draft, question).some((answer) => sameText(answer.text, text));
}

/** The id the next answer gets: one more than the highest `aN` in use. */
export function nextAnswerId(answers: readonly { id: string }[]): string {
  let highest = 0;
  for (const answer of answers) {
    const match = /^a(\d{1,9})$/.exec(answer.id);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `a${highest + 1}`;
}

function inCanonicalOrder(keys: Iterable<BmcQuestionKey>): BmcQuestionKey[] {
  const set = new Set(keys);
  return BMC_QUESTION_KEYS.filter((key) => set.has(key));
}

function withAnswer(draft: CanvasDraft, answer: DraftAnswer): CanvasDraft {
  return {
    ...draft,
    answers: [...draft.answers, answer],
    open: draft.open.filter((key) => key !== answer.question),
  };
}

/** Room for one more non-duplicate answer in this question. */
function canAdd(draft: CanvasDraft, question: BmcQuestionKey, text: string): boolean {
  return (
    hasWords(text) &&
    answersOf(draft, question).length < MAX_ANSWERS_PER_QUESTION &&
    !hasAnswerText(draft, question, text)
  );
}

/**
 * Every edit of your own canvas. Returns the same object when the action
 * changes nothing (an add at five answers, a duplicate, an unknown id, setOpen
 * on a question with answers), so the store knows there is nothing to save.
 */
export function draftReducer(draft: CanvasDraft, action: DraftAction): CanvasDraft {
  switch (action.type) {
    case "rename": {
      const name = fitName(action.name);
      return name === draft.name ? draft : { ...draft, name };
    }
    case "add": {
      const text = fitAnswer(action.text.trim()).trim();
      if (!canAdd(draft, action.question, text)) return draft;
      return withAnswer(draft, { id: nextAnswerId(draft.answers), question: action.question, text });
    }
    case "addInspiration": {
      const chosen = answersOf(draft, action.question).some((answer) => answer.inspiration?.entity === action.entity);
      const text = fitAnswer(oneLine(action.text).trim()).trim();
      if (chosen || !canAdd(draft, action.question, text)) return draft;
      return withAnswer(draft, {
        id: nextAnswerId(draft.answers),
        question: action.question,
        text,
        inspiration: { entity: action.entity, documentVersion: action.documentVersion },
      });
    }
    case "edit": {
      const text = fitAnswer(action.text);
      const target = draft.answers.find((answer) => answer.id === action.id);
      if (!target || target.text === text) return draft;
      return { ...draft, answers: draft.answers.map((answer) => (answer.id === action.id ? { ...answer, text } : answer)) };
    }
    case "remove": {
      const answers = draft.answers.filter((answer) => answer.id !== action.id);
      return answers.length === draft.answers.length ? draft : { ...draft, answers };
    }
    case "move": {
      const from = draft.answers.findIndex((answer) => answer.id === action.id);
      if (from < 0) return draft;
      const question = draft.answers[from].question;
      let to = from + action.offset;
      while (to >= 0 && to < draft.answers.length && draft.answers[to].question !== question) to += action.offset;
      if (to < 0 || to >= draft.answers.length) return draft;
      const answers = draft.answers.slice();
      [answers[from], answers[to]] = [answers[to], answers[from]];
      return { ...draft, answers };
    }
    case "setOpen": {
      const isOpen = draft.open.includes(action.question);
      if (action.open === isOpen) return draft;
      if (action.open && answersOf(draft, action.question).some((answer) => hasWords(answer.text))) return draft;
      const open = action.open
        ? inCanonicalOrder([...draft.open, action.question])
        : draft.open.filter((key) => key !== action.question);
      return { ...draft, open };
    }
    case "reset":
      return draftIsEmpty(draft) && draft.answers.length === 0 ? draft : emptyDraft();
    case "replace":
      return action.draft;
  }
}

/** Nothing worth keeping: no name, no answer with words, nothing left open. */
export function draftIsEmpty(draft: CanvasDraft): boolean {
  return (
    draft.name.trim() === "" && draft.open.length === 0 && draft.answers.every((answer) => !hasWords(answer.text))
  );
}

/**
 * The draft as the paragraph and the canvas grid read it: nine questions in
 * canonical order, answers trimmed, blank ones left out, each carrying its
 * entity id when it came from an inspiration. Never a note.
 */
export function draftState(draft: CanvasDraft): CanvasQuestionState[] {
  return BMC_QUESTION_KEYS.map((key) => {
    const answers: CanvasAnswer[] = [];
    for (const answer of answersOf(draft, key)) {
      const text = answer.text.trim();
      if (!hasWords(text)) continue;
      answers.push(answer.inspiration ? { text, entity: answer.inspiration.entity } : { text });
    }
    return { key, answers, open: answers.length === 0 && draft.open.includes(key) };
  });
}

/** As every page shows it: answered when an answer survives `displayAnswers` ("..." does not). */
export function questionStatus(question: CanvasQuestionState): QuestionStatus {
  if (displayAnswers(question).length > 0) return "answered";
  return question.open ? "open" : "empty";
}

/** The step (1–9) a visit lands on without `?step=`: the first question neither answered nor open, else 1. */
export function firstUnfinishedStep(draft: CanvasDraft): number {
  const index = draftState(draft).findIndex((question) => questionStatus(question) === "empty");
  return index < 0 ? 1 : index + 1;
}

/** Your own canvas, optionally at a step. */
export function yoursHref(step?: number): string {
  return step === undefined ? BMC_YOURS_PATH : `${BMC_YOURS_PATH}?step=${step}`;
}
