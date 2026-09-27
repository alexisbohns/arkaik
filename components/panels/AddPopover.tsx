"use client";

import type { ReactNode } from "react";
import { PlusIcon } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { iconChipVariants } from "@/components/layout/IconChip";
import { cn } from "@/lib/utils";

/**
 * The "add one here" gesture, wherever a panel offers one: a dashed icon chip
 * that opens a floating card holding a search.
 *
 * Extracted from `AddEntryButton`, which had it first and had it right. What is
 * shared is the part that would drift — the trigger's look, the card's width and
 * padding, and the presentation the list inside takes ({@link
 * ADD_POPOVER_COMBOBOX}) — and nothing else. The rows are not shared: a
 * playlist's list carries structure rows and cycle rules that a relation line
 * has no use for, and a relation line searches a species set the playlist does
 * not know about. Each call site keeps its own `Combobox` and hands it here.
 *
 * **A popover, not an inline block.** `RelationLine` first shipped this inline,
 * on the reasoning that a floated list inside a scrolling panel body would need
 * portalling to escape the scroll container. That was wrong twice over: Radix
 * portals popover content by default, so the problem was already solved in the
 * dependency; and the inline version cost the thing the relation line exists to
 * save — an open line left a bare, untouched search field sitting in the layout,
 * and its suggestions pushed the panel content down and ran over whatever was
 * behind them with no surface of their own. A card floats, dismisses on a click
 * anywhere else, and reads against any background.
 *
 * **Focus is Radix's.** `PopoverContent` focuses its first tabbable child on
 * open — the search field — and returns focus to the trigger on close, from
 * every close path including a programmatic one. The trigger's `aria-expanded`,
 * `aria-controls` and `aria-haspopup` are Radix's too. None of it is re-derived
 * here.
 */
interface AddPopoverProps {
  /** Names the trigger — "Add step", "Add to Covers". Also its tooltip. */
  label: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The list. Spread {@link ADD_POPOVER_COMBOBOX} onto it. */
  children: ReactNode;
}

/**
 * What a `Combobox` looks like inside an {@link AddPopover}.
 *
 * `inline` means inline *within the card* — the card is already the floating
 * surface, so a second layer of floating inside it would be one too many.
 * `search` puts the magnifier in the field, which is what says the field is a
 * search rather than the value being added.
 */
export const ADD_POPOVER_COMBOBOX = {
  search: true,
  placement: "inline",
  className: "flex flex-col gap-2",
  listClassName: "max-h-72 overflow-y-auto",
} as const;

export function AddPopover({ label, open, onOpenChange, children }: AddPopoverProps) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          title={label}
          className={cn(
            // The primitive, not a ghost `Button`: this is the same "not filled
            // in yet" tile as the playlist's next position and the canvas's add
            // affordances. `interactive` carries the focus ring; the hover is
            // the caller's, and this is the caller for both of them.
            iconChipVariants({ variant: "dashed", interactive: true }),
            "border-border text-muted-foreground",
            "hover:border-solid hover:bg-muted hover:text-foreground",
          )}
        >
          <PlusIcon className="size-3.5" aria-hidden="true" />
        </button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-80 p-2">
        {children}
      </PopoverContent>
    </Popover>
  );
}
