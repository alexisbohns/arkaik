import type { MouseEvent } from "react";

import { cn } from "@/lib/utils";

/** How a question stands in the canvas the rail walks through. */
export type StepStatus = "answered" | "open" | "empty";

export interface StepRailItem {
  /** The canvas block's title: "Channels". */
  block: string;
  status: StepStatus;
  /** Drawn filled: a step already walked (the tour), or answered (your canvas). */
  reached: boolean;
}

interface StepRailProps {
  /** Nine, in question order. */
  steps: readonly StepRailItem[];
  /** 1–9. */
  current: number;
  /** Each step's own address (`?step=N`), so a step can be opened in a new tab or shared. */
  hrefFor: (step: number) => string;
  /** A plain click goes to the step without leaving the page. */
  onSelect: (step: number) => void;
  /** The `nav`'s accessible name. Default "Tour steps". */
  label?: string;
  className?: string;
}

const STATUS_WORDS: Record<StepStatus, string> = {
  answered: "answered",
  open: "left open on purpose",
  empty: "not answered",
};

/**
 * The nine steps as numbered links in one row: "Step 3: Channels, answered",
 * the current one marked `aria-current="step"`. A plain click is intercepted
 * and handed to `onSelect`; a modified click (new tab, new window) follows the
 * link. A question left open on purpose is round with a dashed outline throughout.
 *
 * No hooks: the tour renders it, and your own canvas (part 4) can.
 */
export function StepRail({ steps, current, hrefFor, onSelect, label = "Tour steps", className }: StepRailProps) {
  function follow(event: MouseEvent<HTMLAnchorElement>, step: number) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onSelect(step);
  }

  return (
    <nav aria-label={label} className={className}>
      <ol className="flex flex-wrap gap-1">
        {steps.map((item, i) => {
          const step = i + 1;
          const isCurrent = step === current;
          return (
            <li key={step}>
              <a
                href={hrefFor(step)}
                data-tour-keep-focus=""
                onClick={(event) => follow(event, step)}
                aria-label={`Step ${step}: ${item.block}, ${STATUS_WORDS[item.status]}`}
                aria-current={isCurrent ? "step" : undefined}
                title={item.block}
                className={cn(
                  "flex size-7 items-center justify-center rounded-md border font-mono text-xs tabular-nums transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  // Left open on purpose: a dashed border at full muted-foreground (4.52:1 light,
                  // 7.77:1 dark) and a round shape, so the status has two cues.
                  item.status === "open" && "rounded-full border-dashed border-muted-foreground",
                  isCurrent
                    ? "border-foreground bg-foreground text-background"
                    : item.reached
                      ? "bg-muted text-foreground hover:border-foreground/40"
                      : "bg-background text-muted-foreground hover:border-foreground/40 hover:text-foreground",
                )}
              >
                {step}
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
