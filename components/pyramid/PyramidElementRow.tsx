"use client";

import { PlatformAvailability } from "@/components/graph/nodes/PlatformAvailability";
import { ValueIcon } from "@/components/values/ValueBadge";
import type { PlatformId } from "@/lib/config/platforms";
import type { PyramidElement } from "@/lib/utils/pyramid";
import { cn } from "@/lib/utils";

interface PyramidElementRowProps {
  element: PyramidElement;
  label: string;
  description: string;
  /** The scope's effective platforms — `PlatformAvailability` owns the arity rule. */
  platforms: PlatformId[];
  /** Whether this element is the one open in the value panel beside the list. */
  selected: boolean;
  onSelect: () => void;
}

/**
 * One value element on one line, availability right-aligned.
 *
 * A button, not a link: the row selects the element into the page's
 * value panel rather than leaving the page. `aria-pressed` carries the
 * selection, the same way the fill shows it.
 *
 * No frame and no rule of its own — the tier card is the grouping, and the
 * hover fill is what marks a row as a target.
 */
export function PyramidElementRow({
  element,
  label,
  description,
  platforms,
  selected,
  onSelect,
}: PyramidElementRowProps) {
  const served = element.acceptanceCount > 0;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "group/row flex w-full cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-left transition-colors outline-none hover:bg-muted/40 focus-visible:bg-muted/60",
        selected && "bg-muted hover:bg-muted",
      )}
    >
      <span className={cn("flex min-w-0 flex-1 items-center gap-2.5", !served && !selected && "opacity-55")}>
        <ValueIcon valueId={element.value} className="size-4 shrink-0 text-muted-foreground" />
        <span className="flex min-w-0 flex-1 items-baseline gap-2.5">
          <span className="truncate text-sm font-medium">{label}</span>
          {/* Hover and keyboard focus only: at rest the list reads as thirty
              names, and the description is there for the row being considered.
              It takes the free space after the label, so showing it shifts
              nothing. Still yields entirely on a narrow panel. */}
          <span className="hidden truncate text-xs text-muted-foreground @xl:group-hover/row:inline @xl:group-focus-visible/row:inline">
            {description}
          </span>
        </span>
      </span>
      <PlatformAvailability
        rollup={element.rollup}
        platforms={platforms}
        count={element.acceptanceCount}
        size="sm"
        countLabel="acceptances"
        leadingCount
        narrowTrack
      />
    </button>
  );
}
