"use client";

import type { ReactNode } from "react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";

interface ScaleChipProps {
  /** What the chip says: `P0`, `Critical`. */
  children: ReactNode;
  /** The chip's own colours, from `quality-styles`. */
  className?: string;
  /** What the abbreviation stands for — the `<abbr title>` expansion. */
  term: string;
  /**
   * One line on what the bucket means, so the expansion is actionable. It is
   * also what a screen reader is given, which is why it stays a string even
   * when {@link body} draws something richer above it.
   */
  hint: string;
  /**
   * Anything the gloss shows *before* the hint — the risk chip's bill, above
   * all. Optional: most chips are a term and a sentence, and a slot they do not
   * fill costs them nothing.
   */
  body?: ReactNode;
}

/**
 * A severity or priority chip that explains itself.
 *
 * `P0` and `Critical` are the audit's vocabulary, not the reader's: the board
 * sorts by them and the matrix colours by them, and a reader who has not read
 * the pack spec has no way to learn what separates `P1` from `P2` short of
 * leaving the page. So the chip is the classical abbreviation gloss — the term
 * spelled out, then what it means — on hover and on focus, the way `<abbr>`
 * has always worked, rather than a legend somewhere else on the page.
 *
 * A `span` trigger rather than a button: these chips sit inside rows that are
 * themselves clickable, and a button nested in a button is markup a browser
 * will not honour. `tabIndex` keeps it reachable, which is what makes the gloss
 * available to a keyboard at all — Radix opens the card on focus.
 */
export function ScaleChip({ children, className, term, hint, body }: ScaleChipProps) {
  return (
    <HoverCard openDelay={150} closeDelay={80}>
      <HoverCardTrigger asChild>
        <span
          tabIndex={0}
          role="note"
          aria-label={`${term} — ${hint}`}
          className={cn(
            "cursor-help decoration-dotted underline-offset-2 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
            className,
          )}
        >
          {children}
        </span>
      </HoverCardTrigger>
      <HoverCardContent className="w-64 p-3">
        <p className="text-sm font-medium">{term}</p>
        {body}
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{hint}</p>
      </HoverCardContent>
    </HoverCard>
  );
}
