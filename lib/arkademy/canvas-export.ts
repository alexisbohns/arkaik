import { questionStatus } from "./canvas";
import type { QuestionStatus } from "./canvas";
import { composeParagraph, DEFAULT_SUBJECT, displayAnswers, paragraphText } from "./paragraph";
import type { CanvasQuestionState } from "./paragraph";
import { BMC_TOOL_ID } from "./schema";
import type { BmcQuestion, BmcQuestionKey, BmcTool } from "./schema";

/**
 * Your own canvas's three exports (spec § "Exports"), pure: the paragraph as
 * plain text, the canvas as Markdown, and the canvas as a JSON file that reads
 * on its own (each question travels with its block title and its wording).
 * Every one is built from `draftState` and reads answers through
 * `displayAnswers`, as the paragraph and the grid do, so what is exported is
 * exactly what is shown.
 */

/** What the exports need of the tool: its title and its nine questions. */
export type CanvasTool = Pick<BmcTool, "title" | "questions">;

export interface CanvasExport {
  format: "arkaik.arkademy.canvas";
  formatVersion: 1;
  tool: "business-model-canvas";
  name: string;
  exportedAt: string; // ISO 8601
  documentVersion: number; // the library version this page was served with
  paragraph: string;
  questions: {
    key: BmcQuestionKey;
    block: string;
    prompt: string;
    state: QuestionStatus;
    answers: { text: string; entity?: string }[];
  }[];
}

/** Copy the paragraph: what the paragraph says, gaps left out. */
export function canvasParagraphText(input: { tool: CanvasTool; name: string; state: readonly CanvasQuestionState[] }): string {
  return paragraphText(composeParagraph({ questions: input.tool.questions, state: input.state, subject: input.name }));
}

/**
 * A visitor's text made safe inside the Markdown export: backslashes and
 * backticks escaped anywhere, and a line-opening `#`, `-`, `+`, `*`, `>` or
 * `1.` / `1)` escaped so it reads as words, not as a heading, a list, a quote
 * or code. A deliberate departure from "answers as typed": the document's
 * structure must stay the canvas's own.
 */
export function markdownText(text: string): string {
  return text
    .replace(/[\\`]/g, "\\$&")
    .replace(/^(\s*)([#>+*-])/, "$1\\$2")
    .replace(/^(\s*\d+)([.)])/, "$1\\$2");
}

function stateFor(state: readonly CanvasQuestionState[], question: BmcQuestion): CanvasQuestionState {
  return state.find((entry) => entry.key === question.key) ?? { key: question.key, answers: [], open: false };
}

/**
 * Copy as Markdown: a `#` title, the paragraph (left out when empty), then a
 * `##` section per question in canonical order — its answers as a list, or
 * "_Left open on purpose._", or "_Not answered yet._". A single trailing newline.
 */
export function canvasMarkdown(input: { tool: CanvasTool; name: string; state: readonly CanvasQuestionState[] }): string {
  const title = input.name.trim() || DEFAULT_SUBJECT;
  const blocks = [`# ${markdownText(title)}: ${input.tool.title}`];
  const paragraph = canvasParagraphText(input);
  if (paragraph !== "") blocks.push(markdownText(paragraph));
  for (const question of input.tool.questions) {
    const entry = stateFor(input.state, question);
    const status = questionStatus(entry);
    blocks.push(`## ${question.block}`);
    if (status === "answered") blocks.push(displayAnswers(entry).map((answer) => `- ${markdownText(answer.text)}`).join("\n"));
    else blocks.push(status === "open" ? "_Left open on purpose._" : "_Not answered yet._");
  }
  return `${blocks.join("\n\n")}\n`;
}

/** Download JSON: the canvas with its questions' words, so the file reads on its own. */
export function canvasJson(input: {
  tool: CanvasTool;
  name: string;
  state: readonly CanvasQuestionState[];
  documentVersion: number;
  exportedAt: string;
}): CanvasExport {
  return {
    format: "arkaik.arkademy.canvas",
    formatVersion: 1,
    tool: BMC_TOOL_ID,
    name: input.name.trim(),
    exportedAt: input.exportedAt,
    documentVersion: input.documentVersion,
    paragraph: canvasParagraphText(input),
    questions: input.tool.questions.map((question) => {
      const entry = stateFor(input.state, question);
      return {
        key: question.key,
        block: question.block,
        prompt: question.prompt,
        state: questionStatus(entry),
        answers: displayAnswers(entry).map((answer) =>
          answer.entity ? { text: answer.text, entity: answer.entity } : { text: answer.text },
        ),
      };
    }),
  };
}

/** The file's text: two-space indentation and a trailing newline. */
export function canvasJsonText(canvas: CanvasExport): string {
  return `${JSON.stringify(canvas, null, 2)}\n`;
}

/** `acme-bakery-business-model-canvas.json`, or `business-model-canvas.json` for a name with no letters or digits. */
export function canvasFilename(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return slug === "" ? `${BMC_TOOL_ID}.json` : `${slug}-${BMC_TOOL_ID}.json`;
}
