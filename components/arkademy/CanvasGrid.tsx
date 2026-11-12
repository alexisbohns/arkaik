import { SourcedNote } from "@/components/arkademy/SourcedNote";
import { clampThrough, displayAnswers, type CanvasQuestionState } from "@/lib/arkademy/paragraph";
import type { BmcQuestion, BmcQuestionKey } from "@/lib/arkademy/schema";
import { cn } from "@/lib/utils";

/**
 * Where each block sits in the canonical canvas arrangement, at a container
 * width of 48rem or more. Literal class names, so Tailwind finds them.
 */
const AREA: Record<BmcQuestionKey, string> = {
  seg: "@3xl:[grid-area:seg]",
  vp: "@3xl:[grid-area:vp]",
  ch: "@3xl:[grid-area:ch]",
  cr: "@3xl:[grid-area:cr]",
  rev: "@3xl:[grid-area:rev]",
  kr: "@3xl:[grid-area:kr]",
  ka: "@3xl:[grid-area:ka]",
  kp: "@3xl:[grid-area:kp]",
  cost: "@3xl:[grid-area:cost]",
};

/** The canonical arrangement (the prototype's): kp ka vp cr seg over kr ch, cost beside rev. */
const CANONICAL =
  "@3xl:grid-cols-10 @3xl:[grid-template-areas:'kp_kp_ka_ka_vp_vp_cr_cr_seg_seg'_'kp_kp_kr_kr_vp_vp_ch_ch_seg_seg'_'cost_cost_cost_cost_cost_rev_rev_rev_rev_rev']";

/** How many answers a mini block lists before "+N more". */
export const CANVAS_MINI_ANSWERS = 3;

export interface CanvasGridProps {
  /** The document's nine questions, canonical order: each block's title and number. */
  questions: readonly Pick<BmcQuestion, "key" | "block">[];
  /** Nine, canonical order, matched by key (a key given twice takes its last entry). Answers are shown through `displayAnswers`. */
  state: readonly CanvasQuestionState[];
  /**
   * `full` (tour, your canvas): every answer, each note as a marker after its
   * answer (`SourcedNote`). `mini` (cover cards): three, then "+N more"; no notes.
   */
  density: "full" | "mini";
  /** Unique on the page: block headings get the ids `${idPrefix}--${key}` (two hyphens, which no slug holds). */
  idPrefix: string;
  /** Names the grid for assistive technology: "Tidewise's canvas". */
  label: string;
  /** 3 under a page's `h2`; 4 inside a card titled by an `h3` (the cover). Default 3. */
  headingLevel?: 3 | 4;
  /** The block that carries a ring: the current question (tour, your canvas). Never drawn faint. */
  current?: BmcQuestionKey;
  /**
   * The tour's block being answered, not filled yet: drawn at full strength
   * (never faint), its ring if it is also `current`, its heading shown and its
   * body empty — no answers, no "Not answered yet." — and named "<block>, being
   * answered" for assistive technology.
   */
  pending?: BmcQuestionKey;
  /**
   * 0–9 (tour): blocks after it are drawn faint with only their title. Default
   * 9. Clamped by `clampThrough`, as the paragraph is, so the two agree.
   */
  through?: number;
  /** Your own canvas (part 4): block titles become buttons that go to the question. */
  onSelectQuestion?: (question: BmcQuestionKey) => void;
}

/**
 * The nine blocks of a canvas. The grid adapts to its container, not the
 * window, so a cover card and a full page both read well: ten columns in the
 * canonical arrangement from 48rem, two in question order from 32rem (from
 * 20rem in the mini density, so a phone-width gallery card is half as tall),
 * one below. Nothing scrolls sideways. Source order is question order, which is
 * what a screen reader follows whatever the arrangement.
 *
 * No hooks and no "use client", like ParagraphView.
 */
export function CanvasGrid({
  questions,
  state,
  density,
  idPrefix,
  label,
  headingLevel = 3,
  current,
  pending,
  through,
  onSelectQuestion,
}: CanvasGridProps) {
  const Heading = headingLevel === 4 ? "h4" : "h3";
  const byKey = new Map(state.map((question) => [question.key, question]));
  const mini = density === "mini";
  const shown = clampThrough(through, questions.length);

  return (
    <div role="group" aria-label={label} className="@container">
      <div className={cn("grid grid-cols-1 gap-2 @lg:grid-cols-2", mini && "@xs:grid-cols-2", CANONICAL)}>
        {questions.map((question, i) => {
          const entry = byKey.get(question.key);
          // Cleaned, empties dropped: the same answers the paragraph reads.
          const answers = displayAnswers(entry);
          const isPending = question.key === pending;
          // A pending block does not reveal yet that its question is left open (no dashed border).
          const open = !isPending && answers.length === 0 && entry?.open === true;
          // Past `through`, faint with only the title; the current and the pending block never are.
          const faint = i >= shown && question.key !== current && !isPending;
          const listed = mini ? answers.slice(0, CANVAS_MINI_ANSWERS) : answers;
          // "--", which a slug never holds: "example-acme--cost" cannot be company "acme-cost"'s heading.
          const headingId = `${idPrefix}--${question.key}`;
          return (
            <div
              key={question.key}
              role="group"
              aria-labelledby={isPending ? undefined : headingId}
              aria-label={isPending ? `${question.block}, being answered` : undefined}
              data-question={question.key}
              data-faint={faint ? "" : undefined}
              data-pending={isPending ? "" : undefined}
              className={cn(
                "flex min-w-0 flex-col rounded-lg border bg-background",
                mini ? "gap-1.5 p-2.5" : "gap-2 p-3",
                AREA[question.key],
                open && "border-dashed border-muted-foreground/45",
                faint && "opacity-40",
                question.key === current && "ring-2 ring-ring",
              )}
            >
              <Heading
                id={headingId}
                className={cn("flex min-w-0 items-baseline gap-1.5 font-semibold wrap-anywhere", mini ? "text-xs" : "text-sm")}
              >
                <span className="font-mono text-[10px] font-normal text-muted-foreground tabular-nums">{i + 1}</span>
                {onSelectQuestion ? (
                  <button
                    type="button"
                    onClick={() => onSelectQuestion(question.key)}
                    className="min-w-0 cursor-pointer rounded-sm text-left outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    {question.block}
                  </button>
                ) : (
                  question.block
                )}
              </Heading>
              {faint || isPending ? null : answers.length > 0 ? (
                <>
                  <ul
                    className={cn(
                      "flex list-disc flex-col pl-4 break-words marker:text-muted-foreground",
                      mini ? "gap-1 text-xs leading-snug" : "gap-1.5 text-sm leading-snug",
                    )}
                  >
                    {listed.map((answer, j) => (
                      <li key={j}>
                        {answer.text}
                        {!mini && answer.note && <SourcedNote note={answer.note} answer={answer.text} />}
                      </li>
                    ))}
                  </ul>
                  {answers.length > listed.length && (
                    <p className="pl-4 text-[11px] text-muted-foreground">+{answers.length - listed.length} more</p>
                  )}
                </>
              ) : (
                <p className={cn("text-muted-foreground", mini ? "text-xs" : "text-sm")}>
                  {open ? "Left open on purpose." : "Not answered yet."}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
