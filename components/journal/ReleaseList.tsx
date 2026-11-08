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
 * The Changelog's left column: every release the filters left, newest first,
 * Unreleased on top. Selecting one fills the detail column beside it.
 */
export function ReleaseList({ entries, selectedKey, onSelect, className }: ReleaseListProps) {
  return (
    <nav aria-label="Releases" className={cn("flex-col", className)}>
      <ol className="flex flex-col gap-0.5 p-2">
        {entries.map((entry) => {
          const selected = entry.key === selectedKey;
          const Icon = entry.icon;
          return (
            <li key={entry.key}>
              <button
                type="button"
                aria-current={selected ? "true" : undefined}
                onClick={() => onSelect(entry.key)}
                className={cn(
                  "flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  selected
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
              >
                <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-sm font-medium">{entry.title}</span>
                  <span className="truncate text-xs text-muted-foreground">{entry.subtitle}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
