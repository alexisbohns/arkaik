import { LIST_TOKEN, SUBJECT_TOKEN } from "./schema";
import type { BmcQuestion, BmcQuestionKey, UseNote } from "./schema";

/**
 * The paragraph rule (docs/superpowers/specs/2026-11-12-arkademy-bmc-design.md
 * § "The paragraph"): a canvas read back as one paragraph, a sentence per
 * answered question, a gap per question without answers. Pure — the cover,
 * the tour and your own canvas all render what this returns, and every copy
 * or export uses `paragraphText`.
 *
 * The words live in the document (each question's `sentence`, its optional
 * `sentencePlural`, its `gap`); only the joining and the subject rule live
 * here. Imports only its siblings, like every module in lib/arkademy/.
 */

export interface CanvasAnswer {
  text: string;
  entity?: string;
  /** A sourced fact about this example's case. Examples only; your own canvas has none. */
  note?: UseNote;
}

/** One question of a canvas, an example's or the visitor's own. */
export interface CanvasQuestionState {
  key: BmcQuestionKey;
  answers: CanvasAnswer[]; // in display order
  open: boolean; // left open on purpose; ignored when answers is non-empty
}

/**
 * A sentence in pieces, so a page knows where each note's marker goes: a
 * `note` part follows the answer it belongs to (`answer`, cleaned) and adds
 * nothing to the sentence's `text`.
 */
export type ParagraphPart = { kind: "text"; text: string } | { kind: "note"; note: UseNote; answer: string };

export type ParagraphSegment =
  | { kind: "sentence"; question: BmcQuestionKey; text: string; parts: ParagraphPart[] }
  | { kind: "gap"; question: BmcQuestionKey; open: boolean; text: string };

/** Every sentence after the first one that names the subject. */
export const SUBJECT_PRONOUN = "It";
/** The subject when the name is empty. */
export const DEFAULT_SUBJECT = "This product";

/**
 * Trims, then drops any run of whitespace and `. ! ? … ; : ,` at the end: the
 * sentence supplies its own punctuation, so "fast!" reads "… for fast." and
 * never "… for fast!.". Punctuation inside the answer, and a closing bracket
 * or quote at its end, stay.
 */
export function cleanAnswer(text: string): string {
  return text.trim().replace(/[\s.!?…;:,]+$/u, "");
}

/**
 * A question's answers as every page shows them: each cleaned (`cleanAnswer`),
 * those that clean to nothing dropped with their note, entity and note kept.
 * A question with none reads as unanswered (or left open, by its flag). The
 * paragraph and the canvas grid both read answers through this, so they
 * always agree.
 */
export function displayAnswers(question: CanvasQuestionState | undefined): CanvasAnswer[] {
  const shown: CanvasAnswer[] = [];
  for (const answer of question?.answers ?? []) {
    const text = cleanAnswer(answer.text);
    if (text !== "") shown.push({ ...answer, text });
  }
  return shown;
}

/**
 * The separator placed before item `i` (1 ≤ i < texts.length) of a joined
 * list. In the semicolon case, two items take "; and " only when one holds a
 * comma ("a, b; and c"); otherwise ", and " reads better ("flour and butter,
 * and wages") and still keeps the two apart.
 */
function separatorBefore(i: number, texts: readonly string[], semicolon: boolean): string {
  if (i < texts.length - 1) return semicolon ? "; " : ", ";
  if (!semicolon) return " and ";
  return texts.length === 2 && !texts.some((text) => text.includes(",")) ? ", and " : "; and ";
}

/**
 * "and" as a word, in any case, or "&" standing alone: an item holding one
 * cannot be told apart from the list's own last "and". "brand", "Sandbox",
 * "black-and-white" and "R&D" do not count.
 */
const AND_WORD = /(?:^|\s)(?:and|&)(?:\s|$)/i;

/**
 * Whether a list of answers joins with semicolons: when any cleaned answer
 * contains a comma, "and" as a word (any case) or a standalone "&" — a
 * comma-joined list of such items cannot be read back into its items. Notes
 * play no part: on screen a note is a marker that adds no words to the
 * sentence, so `note` is accepted and ignored, as is the note's own text.
 */
export function joinsWithSemicolons(answers: readonly { text: string; note?: UseNote }[]): boolean {
  return answers.some((answer) => answer.text.includes(",") || AND_WORD.test(answer.text));
}

/**
 * `a`, `a and b`, `a, b and c`; in the semicolon case (`joinsWithSemicolons`)
 * `a, and b` (two items, no comma in either), `a, b; and c` (two items, a
 * comma in one), `a; b; and c`. The texts are taken as given (clean them first).
 * `semicolon` overrides the rule when given.
 */
export function joinAnswers(
  texts: readonly string[],
  semicolon: boolean = joinsWithSemicolons(texts.map((text) => ({ text }))),
): string {
  return texts.map((text, i) => (i === 0 ? text : separatorBefore(i, texts, semicolon) + text)).join("");
}

/** A note's date as the pages print it: the source's own date, or "read on …" for an undated page. */
export function noteDate(note: UseNote): string {
  return note.source.dateKind === "accessed" ? `read on ${note.source.date}` : note.source.date;
}

/**
 * A note in plain text: `fact. Source: name, date` (`… read on date` for an
 * undated page). A full stop and the word "Source" rather than a semicolon,
 * which is the list's own separator, so in copied text a note never reads as
 * the end of a list item; a note's text never ends in punctuation (the schema
 * refuses it), so the full stop is never doubled.
 */
export function noteText(note: UseNote): string {
  return `${note.text}. Source: ${note.source.name}, ${noteDate(note)}`;
}

function pushText(parts: ParagraphPart[], text: string): void {
  if (text === "") return;
  const last = parts[parts.length - 1];
  if (last && last.kind === "text") last.text += text;
  else parts.push({ kind: "text", text });
}

/** A sentence's text from its parts: notes left out, or in parentheses after their answer. */
function partsText(parts: readonly ParagraphPart[], withNotes: boolean): string {
  return parts
    .map((part) => (part.kind === "text" ? part.text : withNotes ? ` (${noteText(part.note)})` : ""))
    .join("");
}

/**
 * How many questions, from the first, a paragraph or a grid shows for a
 * `through` value — the one clamp both use, so they never disagree. Omitted,
 * non-finite or past the last question: all of them. Below 1: none (the
 * tour's first step before its sentence arrives). A fraction rounds down.
 */
export function clampThrough(through: number | undefined, count: number): number {
  if (through === undefined || !Number.isFinite(through) || through > count) return count;
  if (through < 1) return 0;
  return Math.floor(through);
}

export function composeParagraph(input: {
  questions: readonly BmcQuestion[]; // the document's nine, canonical order
  state: readonly CanvasQuestionState[]; // nine, canonical order (matched by key)
  subject: string; // company name, or the visitor's product name
  through?: number; // 0–9, default 9: questions after it are omitted (clampThrough)
}): ParagraphSegment[] {
  // Matched by key; a key given twice takes its last entry, a missing one reads as unanswered.
  const byKey = new Map(input.state.map((question) => [question.key, question]));
  const subject = input.subject.trim() || DEFAULT_SUBJECT;
  const through = clampThrough(input.through, input.questions.length);
  let subjectUsed = false;
  const segments: ParagraphSegment[] = [];

  for (const question of input.questions.slice(0, through)) {
    const state = byKey.get(question.key);
    // An answer that cleans to nothing ("...") reads as no answer at all.
    const answers = displayAnswers(state);

    if (answers.length === 0) {
      const open = state?.open === true;
      segments.push({
        kind: "gap",
        question: question.key,
        open,
        text: `${open ? "left open on purpose: " : "open: "}${question.gap}`,
      });
      continue;
    }

    const template =
      answers.length >= 2 && question.sentencePlural !== undefined ? question.sentencePlural : question.sentence;
    // A valid template holds {L} once and {S}, if at all, at its very start.
    const [head, after = ""] = template.split(LIST_TOKEN);
    let before = head;
    if (before.includes(SUBJECT_TOKEN)) {
      // A function replacement is literal: a string one would read "$&", "$'",
      // "$`" and "$$" in a name as patterns. {L} is cut with split, also literal.
      const name = subjectUsed ? SUBJECT_PRONOUN : subject;
      before = before.replace(SUBJECT_TOKEN, () => name);
      subjectUsed = true;
    }

    const semicolon = joinsWithSemicolons(answers);
    const texts = answers.map((answer) => answer.text);
    const parts: ParagraphPart[] = [];
    pushText(parts, before);
    answers.forEach((answer, i) => {
      if (i > 0) pushText(parts, separatorBefore(i, texts, semicolon));
      pushText(parts, answer.text);
      if (answer.note) parts.push({ kind: "note", note: answer.note, answer: answer.text });
    });
    pushText(parts, after);
    segments.push({ kind: "sentence", question: question.key, text: partsText(parts, false), parts });
  }
  return segments;
}

/**
 * The paragraph as plain text: the sentences joined by single spaces, gaps
 * and notes left out. What every copy and export uses, and exactly the words
 * on screen.
 */
export function paragraphText(segments: readonly ParagraphSegment[]): string {
  return segments
    .filter((segment) => segment.kind === "sentence")
    .map((segment) => segment.text)
    .join(" ");
}

/**
 * The paragraph as plain text with its sources: as `paragraphText`, each note
 * in parentheses after its answer, in `noteText`'s form —
 * `… public tide data (predictions for 412 harbours. Source: Tidewise, 2026-03-02).`
 * For anything that must carry its sources in plain text.
 */
export function paragraphTextWithNotes(segments: readonly ParagraphSegment[]): string {
  return segments
    .filter((segment) => segment.kind === "sentence")
    .map((segment) => partsText(segment.parts, true))
    .join(" ");
}
