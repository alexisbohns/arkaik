"use client";

import { useState, type MouseEvent } from "react";
import { ChevronRightIcon, LightbulbIcon, PlusIcon } from "lucide-react";

import { examplesPhrase, splitInspirations, type Inspiration } from "@/lib/arkademy/inspirations";
import { cn } from "@/lib/utils";

interface InspirationListProps {
  /** `availableInspirations` for the current question: not yet on the canvas. */
  items: readonly Inspiration[];
  /** The tool's example ids, in order: the "From one example" groups follow it. */
  examples: readonly string[];
  /** The question holds five answers: every button is disabled. */
  full: boolean;
  /** The event tells a keyboard activation (`detail` 0) from a pointer click. */
  onAdd: (inspiration: Inspiration, event: MouseEvent<HTMLButtonElement>) => void;
  /** Unique on the page (the list is drawn twice: beside the card, and inside it on a phone). */
  id: string;
  className?: string;
}

/**
 * What the examples answered, as the library's neutral labels. Shared first:
 * the entities two examples or more use, most shared first, each saying which
 * examples. The rest, each from a single example, wait behind one disclosure,
 * "From one example (N)", grouped by example. One click adds an inspiration
 * as an answer the visitor can reword. The screen renders it only for a
 * question some example answers, and keys it by question.
 */
export function InspirationList({ items, examples, full, onAdd, id, className }: InspirationListProps) {
  const [showSingles, setShowSingles] = useState(false);
  const { shared, single } = splitInspirations(items, examples);
  const singleCount = single.reduce((count, group) => count + group.items.length, 0);
  const titleId = `${id}-title`;
  const singlesId = `${id}-singles`;

  function button(item: Inspiration, line: boolean) {
    const where = examplesPhrase(item.companies);
    return (
      <li key={item.entity}>
        <button
          type="button"
          disabled={full}
          onClick={(event) => onAdd(item, event)}
          aria-label={`Add “${item.label}”, in ${where}`}
          className="flex w-full cursor-pointer items-start gap-2 rounded-lg border bg-background px-3 py-2 text-left transition-colors outline-none hover:border-foreground/25 hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <PlusIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 break-words">
            <span className="block text-sm leading-snug">{item.label}</span>
            {line && <span className="mt-0.5 block text-xs text-muted-foreground">In {where}</span>}
          </span>
        </button>
      </li>
    );
  }

  return (
    <section id={id} aria-labelledby={titleId} className={cn("min-w-0", className)}>
      <h2 id={titleId} className="flex items-center gap-1.5 text-sm font-semibold">
        <LightbulbIcon aria-hidden="true" className="size-4 text-muted-foreground" />
        Inspirations
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        What the examples answered. Add one, then make it yours.
      </p>
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Every inspiration for this question is on your canvas.</p>
      ) : (
        <>
          {shared.length > 0 ? (
            <ul className="mt-3 flex flex-col gap-1.5">{shared.map((item) => button(item, true))}</ul>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">No two examples share an answer here yet.</p>
          )}
          {singleCount > 0 && (
            <div className="mt-3">
              <button
                type="button"
                aria-expanded={showSingles}
                aria-controls={singlesId}
                onClick={() => setShowSingles(!showSingles)}
                className="flex cursor-pointer items-center gap-1 rounded-sm text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <ChevronRightIcon
                  aria-hidden="true"
                  className={cn("size-4 transition-transform", showSingles && "rotate-90")}
                />
                From one example ({singleCount})
              </button>
              {showSingles && (
                <div id={singlesId} className="mt-2 flex flex-col gap-3">
                  {single.map((group) => (
                    <div key={group.company.id}>
                      <h3 className="text-xs font-medium text-muted-foreground">In the {group.company.name} example</h3>
                      <ul className="mt-1.5 flex flex-col gap-1.5">{group.items.map((item) => button(item, false))}</ul>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
      {full && items.length > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">Remove an answer to add one of these.</p>
      )}
    </section>
  );
}
