import type { Ref } from "react";

import { ParagraphView } from "@/components/arkademy/ParagraphView";
import { SourcedNote } from "@/components/arkademy/SourcedNote";
import { Card } from "@/components/ui/card";
import { displayAnswers, type CanvasQuestionState, type ParagraphSegment } from "@/lib/arkademy/paragraph";
import type { BmcQuestion, Company } from "@/lib/arkademy/schema";
import { cn } from "@/lib/utils";

/** The small mono labels of the tour (the landing's kicker style). */
export const ARKADEMY_KICKER = "font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase";

/**
 * Something that arrives during a step is added to the page when it arrives
 * (never before, so a reader never meets it early) and fades in once, with a
 * short rise, from `@starting-style`. Nothing is reserved for what has not
 * arrived: the content below moves as answers arrive; the controls sit above
 * the card (fixed to the bottom on phones), so they never move.
 */
const ARRIVAL =
  "motion-safe:transition-[opacity,translate] motion-safe:duration-500 motion-safe:ease-out motion-safe:starting:translate-y-1 motion-safe:starting:opacity-0";

interface QuestionCardProps {
  question: BmcQuestion;
  /** 1–9. */
  number: number;
  total: number;
  company: Pick<Company, "name">;
  /** The example's answers to this question (shown through `displayAnswers`), or that it is left open. */
  state: CanvasQuestionState;
  /** How many answers have arrived; only those are on the page, with an "N of M" count until all are. */
  visibleAnswers: number;
  /** This question's segment of the paragraph: its sentence, or its gap. */
  sentence: ParagraphSegment | undefined;
  /** The sentence (or, for a question without answers, the open note and the gap) has arrived. */
  sentenceShown: boolean;
  /** The `h2`'s id. */
  headingId: string;
  ref?: Ref<HTMLDivElement>;
  className?: string;
}

/**
 * One question of an example, read-only (the tour): "Question 3 of 9 ·
 * Channels", the question as the card's `h2`, its hint, the example's answers
 * arriving one by one — a noted answer followed by its note's marker
 * (`SourcedNote`) — and, last, the sentence the paragraph gains from them. A question left open on purpose
 * says so instead of listing answers. Your own canvas (part 4) edits in a card
 * of its own.
 *
 * No hooks: a client screen renders it with the player's view.
 */
export function QuestionCard({
  question,
  number,
  total,
  company,
  state,
  visibleAnswers,
  sentence,
  sentenceShown,
  headingId,
  ref,
  className,
}: QuestionCardProps) {
  const answers = displayAnswers(state);
  // The sentence's notes are already markers in the answer list just above.
  const plainSentence =
    sentence?.kind === "sentence" ? { ...sentence, parts: sentence.parts.filter((part) => part.kind === "text") } : sentence;
  const answered = answers.length > 0;
  return (
    <Card ref={ref} className={cn("min-w-0 scroll-mt-4 gap-5 p-4 sm:p-6", className)}>
      <div>
        <p className={ARKADEMY_KICKER}>
          Question {number} of {total} · {question.block}
        </p>
        <h2 id={headingId} className="mt-2 text-xl leading-snug font-semibold tracking-tight text-balance sm:text-2xl">
          {question.prompt}
        </h2>
        {question.hint && <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{question.hint}</p>}
      </div>

      {answered ? (
        <div>
          <p className={ARKADEMY_KICKER}>
            {company.name}&apos;s {answers.length === 1 ? "answer" : "answers"}
            {visibleAnswers < answers.length && (
              <span className="tabular-nums">
                {" "}
                · {visibleAnswers} of {answers.length}
              </span>
            )}
          </p>
          {visibleAnswers > 0 && (
            <ul className="mt-2 flex flex-col gap-2">
              {answers.slice(0, visibleAnswers).map((answer, i) => (
                <li
                  key={`${question.key}-${i}`}
                  className={cn("rounded-lg border bg-background px-3 py-2 text-[15px] leading-snug break-words", ARRIVAL)}
                >
                  {answer.text}
                  {answer.note && <SourcedNote note={answer.note} answer={answer.text} />}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        sentenceShown && (
          <div
            key={question.key}
            className={cn(
              "rounded-lg border border-dashed border-muted-foreground/45 px-3 py-2.5 text-sm leading-relaxed",
              ARRIVAL,
            )}
          >
            {state.open ? (
              <>
                <p className="font-medium">{company.name} leaves this open on purpose.</p>
                <p className="mt-1 text-muted-foreground">
                  Not knowing yet is an answer too: the paragraph keeps the gap in view instead of filling it.
                </p>
              </>
            ) : (
              <p className="text-muted-foreground">{company.name} has not answered this one.</p>
            )}
          </div>
        )
      )}

      {plainSentence && sentenceShown && (
        <div key={`${question.key}-sentence`} className={cn("border-t pt-4", ARRIVAL)}>
          <p className={ARKADEMY_KICKER}>In the paragraph</p>
          <ParagraphView segments={[plainSentence]} className="mt-2" />
        </div>
      )}
    </Card>
  );
}
