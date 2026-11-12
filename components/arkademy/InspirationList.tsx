"use client";

import { useState, type MouseEvent } from "react";
import { LightbulbIcon, PlusIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { companiesLine, INSPIRATIONS_SHOWN, type Inspiration } from "@/lib/arkademy/inspirations";
import { cn } from "@/lib/utils";

interface InspirationListProps {
  /** `availableInspirations` for the current question: not yet on the canvas. */
  items: readonly Inspiration[];
  /** The question holds five answers: every button is disabled. */
  full: boolean;
  /** The event tells a keyboard activation (`detail` 0) from a pointer click. */
  onAdd: (inspiration: Inspiration, event: MouseEvent<HTMLButtonElement>) => void;
  id?: string;
  className?: string;
}

/**
 * Beside the question (below it on narrow screens): what the examples
 * answered, as the library's neutral labels, most shared first, each naming
 * the examples that use it. One click adds it as an answer the visitor can
 * reword. Six first, then "Show all N". The screen renders it only for a
 * question some example answers, and keys it by question, so "Show all"
 * folds again on the next question.
 */
export function InspirationList({ items, full, onAdd, id, className }: InspirationListProps) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? items : items.slice(0, INSPIRATIONS_SHOWN);
  return (
    <section id={id} aria-labelledby="canvas-inspirations-title" className={cn("min-w-0", className)}>
      <h2 id="canvas-inspirations-title" className="flex items-center gap-1.5 text-sm font-semibold">
        <LightbulbIcon aria-hidden="true" className="size-4 text-muted-foreground" />
        Inspirations
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        What the examples answered. Add one, then make it yours.
      </p>
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Every inspiration for this question is on your canvas.
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-1.5">
          {shown.map((item) => {
            const users = companiesLine(item.companies);
            return (
              <li key={item.entity}>
                <button
                  type="button"
                  disabled={full}
                  onClick={(event) => onAdd(item, event)}
                  aria-label={`Add “${item.label}”, used by ${users}`}
                  className="flex w-full cursor-pointer items-start gap-2 rounded-lg border bg-background px-3 py-2 text-left transition-colors outline-none hover:border-foreground/25 hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <PlusIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 break-words">
                    <span className="block text-sm leading-snug">{item.label}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{users}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {items.length > INSPIRATIONS_SHOWN && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-2 text-muted-foreground"
          aria-expanded={showAll}
          onClick={() => setShowAll(!showAll)}
        >
          {showAll ? "Show fewer" : `Show all ${items.length}`}
        </Button>
      )}
      {full && items.length > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">Remove an answer to add one of these.</p>
      )}
    </section>
  );
}
