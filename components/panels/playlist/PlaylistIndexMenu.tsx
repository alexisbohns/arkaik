"use client";

import { useState, type FormEvent } from "react";
import { Trash2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { iconChipVariants } from "@/components/layout/IconChip";
import { cn } from "@/lib/utils";

interface PlaylistIndexMenuProps {
  /** Zero-based position in its own list. Displayed one-based. */
  index: number;
  total: number;
  /** Zero-based target. Already clamped; never equal to `index`. */
  onMoveTo: (target: number) => Promise<void> | void;
  onRemove: () => Promise<void> | void;
}

/**
 * The mark on the playlist rail: the entry's position, and the menu that
 * changes or deletes it.
 *
 * **The number is the control.** A playlist row used to carry three icon
 * buttons on its right — up, down, delete — visible on every row whether or not
 * anyone was reordering anything, with the destructive one sitting a pixel from
 * the others. Here the two rare, deliberate gestures (jump to a position,
 * remove) live behind the one glyph that is already about position, and the two
 * frequent, incremental ones (nudge up, nudge down) live on hover
 * (`PlaylistReorderControls`). Nothing destructive is ever one stray click away.
 *
 * The tile is the shared chip — the same box the Changelog's ship mark and the
 * Findings rail's priority square use — so the rails in this app cannot drift
 * into several sizes of the same idea.
 */
export function PlaylistIndexMenu({ index, total, onMoveTo, onRemove }: PlaylistIndexMenuProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(String(index + 1));

  /**
   * Enter, or the Move button. Deliberately **not** blur: the input is the
   * first thing in the popover and Radix closes on Escape by unmounting it, so
   * a blur commit would turn "never mind" into a move — the one outcome Escape
   * exists to avoid.
   */
  function commit(event: FormEvent) {
    event.preventDefault();

    const parsed = Number.parseInt(draft, 10);
    setOpen(false);
    if (!Number.isFinite(parsed)) return;

    const target = Math.min(Math.max(parsed, 1), total) - 1;
    if (target === index) return;
    void onMoveTo(target);
  }

  return (
    <Popover
      open={open}
      // Reopening shows the entry's *current* position, not whatever was last
      // typed — the row may have moved since, and a stale number in a field
      // labelled "Move to position" is an instruction to undo someone's edit.
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setDraft(String(index + 1));
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Entry ${index + 1} of ${total} — position and remove`}
          className={cn(
            iconChipVariants({ interactive: true }),
            "text-xs font-semibold tabular-nums",
            "hover:bg-accent hover:text-accent-foreground",
          )}
        >
          {index + 1}
        </button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-56 flex flex-col gap-3">
        <form onSubmit={commit} className="flex flex-col gap-2">
          <label className="text-xs font-medium text-muted-foreground" htmlFor={`playlist-position-${index}`}>
            Move to position
          </label>
          <div className="flex items-center gap-2">
            <Input
              id={`playlist-position-${index}`}
              type="number"
              min={1}
              max={total}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              className="h-8"
            />
            <Button type="submit" size="sm" className="cursor-pointer">
              Move
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">1–{total}</p>
        </form>

        <Separator />

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
          Remove entry
        </Button>
      </PopoverContent>
    </Popover>
  );
}
