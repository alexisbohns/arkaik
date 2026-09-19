"use client";

import { useState } from "react";
import { MousePointerClickIcon, Trash2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { iconChipVariants } from "@/components/layout/IconChip";
import { cn } from "@/lib/utils";

/**
 * A junction case's tile, and the blue it is drawn in.
 *
 * Exported because the add-a-case tile at the foot of the same rail is the same
 * colour in dashes — one constant, so "a case" cannot come to mean two hues.
 * Blue at a tenth of its strength behind a full-strength glyph, the way the
 * Changelog's ship mark and the forge mark are built.
 */
export const CASE_TILE = "bg-blue-500/10 text-blue-600 dark:text-blue-400";

interface JunctionCaseMenuProps {
  /** Zero-based, for the label only; cases are never reordered. */
  index: number;
  total: number;
  onRemove: () => Promise<void> | void;
}

/**
 * The mark on a junction's case rail: the case itself, and the menu that
 * deletes it.
 *
 * **A case is a node, not a labelled box.** A junction's cases used to be a
 * stack of bordered boxes, each with a red trash can on its right — the only
 * destructive control left on the surface after the playlist's own moved into
 * the index menu, and the loudest thing in the region by some distance. Here a
 * case sits on a rail of its own, exactly as a step does, and the delete lives
 * behind its mark for the same reason it lives behind a step's number: a
 * gesture you make once in the life of a case should not be one stray click
 * away for its whole life.
 *
 * The glyph is a pointer clicking, because that is what a case *is* — the branch
 * the person using the product chooses. It is deliberately not the junction's
 * own `SplitIcon`: the junction is the fork, a case is one road out of it, and
 * repeating the fork glyph on every road would say "junction" five times and
 * "which road" never.
 */
export function JunctionCaseMenu({ index, total, onRemove }: JunctionCaseMenuProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Case ${index + 1} of ${total} — options`}
          className={cn(
            iconChipVariants({ variant: "bare", interactive: true }),
            CASE_TILE,
            "hover:bg-blue-500/20",
          )}
        >
          <MousePointerClickIcon className="size-3" aria-hidden="true" />
        </button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-48 p-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-full cursor-pointer justify-start text-destructive hover:text-destructive"
          onClick={() => {
            setOpen(false);
            void onRemove();
          }}
        >
          <Trash2Icon className="size-4" />
          Remove case
        </Button>
      </PopoverContent>
    </Popover>
  );
}
