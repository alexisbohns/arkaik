"use client";

import { cn } from "@/lib/utils";
import type { ReleaseEntry } from "@/components/journal/release-entry";

interface ReleaseListProps {
  entries: readonly ReleaseEntry[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  className?: string;
}

/**
 * The corners of one row of a segmented list (Material 3): the group reads as
 * one rounded block — 16px on its outer corners, 4px where two rows meet — and
 * the selected row breaks out of it, rounded all around.
 */
function segmentShape(index: number, count: number, selected: boolean): string {
  if (selected) return "rounded-2xl";
  return cn("rounded-sm", index === 0 && "rounded-t-2xl", index === count - 1 && "rounded-b-2xl");
}

/**
 * The Changelog's left column: every release the filters left, newest first,
 * Unreleased on top. Selecting one fills the detail column beside it.
 *
 * A segmented list straight on the page background — each row its own card,
 * 4px apart, no rules between them. The rows carry no `bg-accent` hover: on a
 * card that fill is the card's own colour. A state layer (`after:`) darkens
 * whatever fill the row has instead, selected or not.
 */
export function ReleaseList({ entries, selectedKey, onSelect, className }: ReleaseListProps) {
  return (
    <nav aria-label="Releases" className={cn("flex-col", className)}>
      <ol className="flex flex-col gap-1">
        {entries.map((entry, index) => {
          const selected = entry.key === selectedKey;
          const Icon = entry.icon;
          return (
            <li key={entry.key}>
              <button
                type="button"
                aria-current={selected ? "true" : undefined}
                onClick={() => onSelect(entry.key)}
                className={cn(
                  "relative flex w-full items-center gap-4 px-4 py-3 text-left outline-none",
                  "transition-[border-radius,background-color] duration-200 ease-out",
                  "after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:transition-colors hover:after:bg-foreground/5",
                  "focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50",
                  segmentShape(index, entries.length, selected),
                  // The selected fill is the rail's active fill, doubled in the
                  // dark theme: there `foreground/10` over the page lands within
                  // a few points of `bg-card`, and the selection disappears.
                  selected
                    ? "bg-foreground/10 text-foreground dark:bg-foreground/20"
                    : "bg-card text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-5 shrink-0" aria-hidden="true" />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-sm font-medium text-foreground">{entry.title}</span>
                  <span className="truncate text-xs text-muted-foreground">{entry.meta}</span>
                </span>
                {/* The number alone is a glyph, not a sentence: the label
                    carries the words a screen reader needs. */}
                <span className="shrink-0 text-sm tabular-nums text-muted-foreground" aria-hidden="true">
                  {entry.count}
                </span>
                <span className="sr-only">
                  {entry.count} deliverable{entry.count === 1 ? "" : "s"}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
