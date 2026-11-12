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

/** A sentence in pieces, so a page can render a note's source as a link. */
export type ParagraphPart = { kind: "text"; text: string } | { kind: "note"; note: UseNote };

export type ParagraphSegment =
  | { kind: "sentence"; question: BmcQuestionKey; text: string; parts: ParagraphPart[] }
  | { kind: "gap"; question: BmcQuestionKey; open: boolean; text: string };

/** Every sentence after the first one that names the subject. */
export const SUBJECT_PRONOUN = "It";
/** The subject when the name is empty. */
export const DEFAULT_SUBJECT = "This product";

/** Trims and drops trailing full stops and whitespace; other punctuation stays. */
export function cleanAnswer(text: string): string {
  return text.trim().replace(/[.\s]+$/, "");
}

/** The separator placed before item `i` (1 ≤ i < count) of a joined list. */
function separatorBefore(i: number, count: number, semicolon: boolean): string {
  if (i < count - 1) return semicolon ? "; " : ", ";
  return semicolon ? "; and " : " and ";
}

/** " and " as a word: an item holding it cannot be told apart from the list's own last "and". */
const AND_WORD = /(?:^|\s)and(?:\s|$)/;

/**
 * Whether a list of answers joins with semicolons: when any cleaned answer
 * contains a comma or "and" as a word, or carries a note. A comma-joined list
 * of such items cannot be read back into its items. Looks at whether an
 * answer has a note, never at the note's own text.
 */
export function joinsWithSemicolons(answers: readonly { text: string; note?: UseNote }[]): boolean {
  return answers.some((answer) => answer.note !== undefined || answer.text.includes(",") || AND_WORD.test(answer.text));
}

/**
 * `a`, `a and b`, `a, b and c`; in the semicolon case (`joinsWithSemicolons`)
 * `a; and b`, `a; b; and c`. The texts are taken as given (clean them first).
 * Pass `semicolon` when the answers carry notes, which plain texts cannot show.
 */
export function joinAnswers(
  texts: readonly string[],
  semicolon: boolean = joinsWithSemicolons(texts.map((text) => ({ text }))),
): string {
  return texts.map((text, i) => (i === 0 ? text : separatorBefore(i, texts.length, semicolon) + text)).join("");
}

/** A note's date as the pages print it: the source's own date, or "read on …" for an undated page. */
export function noteDate(note: UseNote): string {
  return note.source.dateKind === "accessed" ? `read on ${note.source.date}` : note.source.date;
}

/** The plain form of what goes inside a note's parentheses: `text; source, date`. */
export function noteText(note: UseNote): string {
  return `${note.text}; ${note.source.name}, ${noteDate(note)}`;
}

function pushText(parts: ParagraphPart[], text: string): void {
  if (text === "") return;
  const last = parts[parts.length - 1];
  if (last && last.kind === "text") last.text += text;
  else parts.push({ kind: "text", text });
}

function partsText(parts: readonly ParagraphPart[]): string {
  return parts.map((part) => (part.kind === "text" ? part.text : noteText(part.note))).join("");
}

export function composeParagraph(input: {
  questions: readonly BmcQuestion[]; // the document's nine, canonical order
  state: readonly CanvasQuestionState[]; // nine, canonical order (matched by key)
  subject: string; // company name, or the visitor's product name
  through?: number; // 1–9, default 9: questions after it are omitted
}): ParagraphSegment[] {
  const byKey = new Map(input.state.map((question) => [question.key, question]));
  const subject = input.subject.trim() || DEFAULT_SUBJECT;
  const through = input.through ?? input.questions.length;
  let subjectUsed = false;
  const segments: ParagraphSegment[] = [];

  for (const question of input.questions.slice(0, Math.max(0, through))) {
    const state = byKey.get(question.key);
    // An answer that cleans to nothing ("...") reads as no answer at all.
    const answers = (state?.answers ?? [])
      .map((answer) => ({ text: cleanAnswer(answer.text), note: answer.note }))
      .filter((answer) => answer.text !== "");

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
    const parts: ParagraphPart[] = [];
    pushText(parts, before);
    answers.forEach((answer, i) => {
      if (i > 0) pushText(parts, separatorBefore(i, answers.length, semicolon));
      pushText(parts, answer.text);
      if (answer.note) {
        pushText(parts, " (");
        parts.push({ kind: "note", note: answer.note });
        pushText(parts, ")");
      }
    });
    pushText(parts, after);
    segments.push({ kind: "sentence", question: question.key, text: partsText(parts), parts });
  }
  return segments;
}

/** The paragraph as plain text: the sentences joined by single spaces, gaps left out. */
export function paragraphText(segments: readonly ParagraphSegment[]): string {
  return segments
    .filter((segment) => segment.kind === "sentence")
    .map((segment) => segment.text)
    .join(" ");
}
