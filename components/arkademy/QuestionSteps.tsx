import { CircleDashedIcon } from "lucide-react";

import type { QuestionStatus } from "@/lib/arkademy/canvas";
import type { BmcQuestion } from "@/lib/arkademy/schema";
import { cn } from "@/lib/utils";

interface QuestionStepsProps {
  questions: readonly Pick<BmcQuestion, "key" | "block">[];
  /** One per question, in the same order. */
  statuses: readonly QuestionStatus[];
  /** 1–9. */
  current: number;
  onSelect: (step: number) => void;
}

const STATUS_WORDS: Record<QuestionStatus, string> = {
  answered: "answered",
  open: "left open on purpose",
  empty: "not answered yet",
};

/**
 * Your own canvas's nine questions as a row of numbered buttons: filled when
 * answered, dashed when left open on purpose, plain when not answered yet;
 * the current one ringed. Nine 36px targets fit a 400px screen in one row.
 * No hooks; the screen passes the handler.
 */
export function QuestionSteps({ questions, statuses, current, onSelect }: QuestionStepsProps) {
  return (
    <nav aria-label="Questions">
      <ol className="flex flex-wrap gap-1 sm:gap-1.5">
        {questions.map((question, i) => {
          const status = statuses[i] ?? "empty";
          const step = i + 1;
          const isCurrent = step === current;
          return (
            <li key={question.key}>
              <button
                type="button"
                onClick={() => onSelect(step)}
                aria-current={isCurrent ? "step" : undefined}
                aria-label={`Question ${step}: ${question.block}, ${STATUS_WORDS[status]}`}
                title={question.block}
                data-status={status}
                className={cn(
                  "relative flex size-9 cursor-pointer items-center justify-center rounded-full border font-mono text-xs tabular-nums outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  status === "answered" && "border-transparent bg-primary text-primary-foreground hover:bg-primary/85",
                  status === "open" && "border-dashed border-muted-foreground text-muted-foreground hover:text-foreground",
                  status === "empty" && "bg-background text-muted-foreground hover:border-foreground/40 hover:text-foreground",
                  isCurrent && "ring-2 ring-ring ring-offset-2 ring-offset-background",
                )}
              >
                {step}
                {status === "open" && (
                  // A second cue besides the dashed border: the paragraph's own "left open on purpose" icon.
                  <CircleDashedIcon
                    aria-hidden="true"
                    className="absolute -top-1 -right-1 size-3.5 rounded-full bg-background text-muted-foreground"
                  />
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
