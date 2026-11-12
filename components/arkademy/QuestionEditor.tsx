"use client";

import { useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { ArrowDownIcon, ArrowUpIcon, ChevronLeftIcon, ChevronRightIcon, PlusIcon, XIcon } from "lucide-react";

import { ARKADEMY_KICKER } from "@/components/arkademy/QuestionCard";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { duplicateAnswers, hasWords, oneLine, type DraftAnswer } from "@/lib/arkademy/canvas";
import { ANSWER_MAX_LENGTH, MAX_ANSWERS_PER_QUESTION, type BmcQuestion } from "@/lib/arkademy/schema";
import { cn } from "@/lib/utils";

/** The ids the screen focuses: the question's heading and its add field. */
export const QUESTION_TITLE_ID = "canvas-question-title";
export const ADD_ANSWER_ID = "canvas-add-answer";
const NEXT_ID = "canvas-next";
const answerFieldId = (id: string) => `canvas-answer-${id}`;
const moveButtonId = (id: string, offset: -1 | 1) => `canvas-answer-${id}-${offset < 0 ? "up" : "down"}`;

export type AddResult = "added" | "duplicate" | "full" | "empty";

interface QuestionEditorProps {
  question: BmcQuestion;
  /** 1–9. */
  step: number;
  total: number;
  /** This question's answers, in display order. */
  answers: readonly DraftAnswer[];
  /** Left open on purpose. */
  open: boolean;
  /** What this question adds to the paragraph, drawn by the screen. */
  preview: ReactNode;
  onAdd: (text: string) => AddResult;
  onEdit: (id: string, text: string) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, offset: -1 | 1) => void;
  onSetOpen: (open: boolean) => void;
  onBack: () => void;
  /** `fromKeyboard`: Enter on the empty add field, or Next pressed from the keyboard; focus then lands in the next question's add field. */
  onNext: (fromKeyboard: boolean) => void;
}

/** A field that grows with its words and never takes a line break: an answer is one line of the paragraph. */
const FIELD = "min-h-9 resize-none py-1.5 [field-sizing:content]";

/** Enter, outside an input method's composition. */
function isEnter(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
  return event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing;
}

function focusById(id: string) {
  document.getElementById(id)?.focus();
}

/**
 * The current question of your own canvas, in edit mode (spec § "Editing"):
 * "Question N of 9 · block", the question as the card's `h2`, its hint, one
 * field per answer (reword in place, reorder, remove), the add field, "Leave
 * this open on purpose" while there is no answer, the sentence this question
 * adds to the paragraph, and Back / Next.
 *
 * The screen keys it by question, so the add field's text starts empty on
 * every question. Keyboard handling lives on the fields themselves.
 */
export function QuestionEditor({
  question,
  step,
  total,
  answers,
  open,
  preview,
  onAdd,
  onEdit,
  onRemove,
  onMove,
  onSetOpen,
  onBack,
  onNext,
}: QuestionEditorProps) {
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<"duplicate" | "empty" | null>(null);
  const full = answers.length >= MAX_ANSWERS_PER_QUESTION;
  // An edit can repeat an earlier answer: the field is marked and named, never emptied.
  const duplicates = duplicateAnswers(answers);
  const left = ANSWER_MAX_LENGTH - text.length;

  function add() {
    if (text.trim() === "") {
      focusById(ADD_ANSWER_ID);
      return;
    }
    const result = onAdd(text);
    if (result === "duplicate" || result === "empty") setProblem(result);
    if (result !== "added") return;
    setText("");
    // The fifth answer disables the add field, which would drop the keyboard's focus.
    if (answers.length + 1 >= MAX_ANSWERS_PER_QUESTION) focusById(NEXT_ID);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    add();
  }

  function onAddKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!isEnter(event)) return;
    event.preventDefault();
    if (text.trim() === "") onNext(true);
    else add();
  }

  function remove(id: string, position: number) {
    const next = answers[position + 1] ?? answers[position - 1];
    flushSync(() => onRemove(id));
    focusById(next ? answerFieldId(next.id) : ADD_ANSWER_ID);
  }

  function move(id: string, offset: -1 | 1, from: "button" | "field") {
    flushSync(() => onMove(id, offset));
    const button = document.getElementById(moveButtonId(id, offset));
    if (from === "button" && button instanceof HTMLButtonElement && !button.disabled) button.focus();
    else focusById(answerFieldId(id));
  }

  function onAnswerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>, id: string) {
    if (isEnter(event)) {
      event.preventDefault();
      focusById(ADD_ANSWER_ID);
    } else if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      move(id, event.key === "ArrowUp" ? -1 : 1, "field");
    }
  }

  const help = full
    ? "Five answers is the most a question takes."
    : problem === "duplicate"
      ? "That answer is already here."
      : problem === "empty"
        ? "An answer needs words, not only punctuation."
      : left <= 20
        ? `${left} ${left === 1 ? "character" : "characters"} left.`
        : answers.length === 0
          ? "Enter adds it. Enter on an empty field goes to the next question."
          : "Enter adds another. Enter on an empty field goes to the next question.";

  return (
    <Card className="min-w-0 gap-5 p-4 sm:p-6">
      <div>
        <p className={ARKADEMY_KICKER}>
          Question {step} of {total} · {question.block}
        </p>
        <h2
          id={QUESTION_TITLE_ID}
          tabIndex={-1}
          className="mt-2 text-xl font-semibold tracking-tight text-balance outline-none sm:text-2xl"
        >
          {question.prompt}
        </h2>
        {question.hint && <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{question.hint}</p>}
      </div>

      {answers.length > 0 && (
        <ol aria-label="Your answers" className="flex flex-col gap-2">
          {answers.map((answer, i) => {
            const repeats = duplicates.get(answer.id);
            return (
              <li key={answer.id} className="flex flex-wrap items-start gap-x-1.5 gap-y-1">
                <span aria-hidden="true" className="w-4 shrink-0 pt-2 font-mono text-[11px] text-muted-foreground tabular-nums">
                  {i + 1}
                </span>
                <Textarea
                  id={answerFieldId(answer.id)}
                  rows={1}
                  value={answer.text}
                  maxLength={ANSWER_MAX_LENGTH}
                  aria-label={`Answer ${i + 1} of ${answers.length}`}
                  aria-invalid={repeats !== undefined || undefined}
                  aria-describedby={repeats !== undefined ? `${answerFieldId(answer.id)}-repeats` : undefined}
                  onChange={(event) => onEdit(answer.id, event.target.value)}
                  onBlur={(event) => {
                    // A field emptied, or left with only punctuation ("..."), is no answer.
                    if (!hasWords(event.target.value)) onRemove(answer.id);
                  }}
                  onKeyDown={(event) => onAnswerKeyDown(event, answer.id)}
                  className={cn(FIELD, "min-w-60 flex-1")}
                />
                {/* Beside the field when it keeps 15rem, under it on a phone. */}
                <div className="ml-auto flex shrink-0">
                  <Button
                    id={moveButtonId(answer.id, -1)}
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-9 text-muted-foreground"
                    aria-label={`Move answer ${i + 1} up`}
                    disabled={i === 0}
                    onClick={() => move(answer.id, -1, "button")}
                  >
                    <ArrowUpIcon />
                  </Button>
                  <Button
                    id={moveButtonId(answer.id, 1)}
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-9 text-muted-foreground"
                    aria-label={`Move answer ${i + 1} down`}
                    disabled={i === answers.length - 1}
                    onClick={() => move(answer.id, 1, "button")}
                  >
                    <ArrowDownIcon />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-9 text-muted-foreground"
                    aria-label={`Remove answer ${i + 1}`}
                    onClick={() => remove(answer.id, i)}
                  >
                    <XIcon />
                  </Button>
                </div>
                {repeats !== undefined && (
                  <p id={`${answerFieldId(answer.id)}-repeats`} className="basis-full pl-5.5 text-xs text-foreground">
                    Same as answer {repeats}.
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}

      <div>
        <form onSubmit={submit} className="flex items-start gap-2">
          <Textarea
            id={ADD_ANSWER_ID}
            rows={1}
            value={text}
            maxLength={ANSWER_MAX_LENGTH}
            disabled={full}
            placeholder={answers.length === 0 ? "Type an answer" : "Add another answer"}
            aria-label={answers.length === 0 ? "Your answer" : "Another answer"}
            aria-describedby="canvas-add-help"
            onChange={(event) => {
              setText(oneLine(event.target.value));
              setProblem(null);
            }}
            onKeyDown={onAddKeyDown}
            className={FIELD}
          />
          <Button type="submit" variant="outline" disabled={full} className="shrink-0">
            <PlusIcon aria-hidden="true" />
            Add
          </Button>
        </form>
        <p
          id="canvas-add-help"
          className={cn("mt-1.5 text-xs text-muted-foreground", (full || problem !== null) && "text-foreground")}
        >
          {help}
        </p>
      </div>

      {answers.length === 0 && (
        <div
          className={cn(
            "flex items-start gap-3 rounded-lg border p-3",
            open ? "border-dashed border-muted-foreground/45" : "border-transparent bg-muted/50",
          )}
        >
          <Checkbox
            id="canvas-open"
            checked={open}
            onCheckedChange={(checked) => onSetOpen(checked === true)}
            className="mt-0.5 cursor-pointer"
          />
          <div className="min-w-0">
            <Label htmlFor="canvas-open" className="cursor-pointer leading-snug">
              Leave this open on purpose
            </Label>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {open
                ? "Your paragraph says so. Untick it, or add an answer, to answer it after all."
                : "A model can choose not to answer a question yet. Your paragraph will say so."}
            </p>
          </div>
        </div>
      )}

      <div className="rounded-lg bg-muted/50 px-3 py-2.5">
        <p className="font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">In your paragraph</p>
        <div className="mt-1">{preview}</div>
      </div>

      <div className="flex items-center justify-between gap-2 border-t pt-4">
        <Button type="button" variant="ghost" onClick={onBack} disabled={step === 1}>
          <ChevronLeftIcon aria-hidden="true" />
          Back
        </Button>
        <Button id={NEXT_ID} type="button" variant="outline" onClick={(event) => onNext(event.detail === 0)}>
          {step === total ? "Read your paragraph" : "Next question"}
          <ChevronRightIcon aria-hidden="true" />
        </Button>
      </div>
    </Card>
  );
}
