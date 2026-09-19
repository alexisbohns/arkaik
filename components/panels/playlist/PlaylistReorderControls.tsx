"use client";

import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The row's group name, **per nesting depth**.
 *
 * A single `group/row` would be wrong, and visibly so: `group-hover/row:` compiles
 * to `.group\/row:hover &`, a plain descendant selector, so it matches *every*
 * ancestor carrying the name — not the nearest one. A playlist nests rows inside
 * rows (a condition's branches, a junction's cases), so hovering a top-level
 * entry lit up the arrows on every row inside it at once.
 *
 * Naming the group by depth makes the selector exact: a depth-1 row's arrows
 * answer only to a depth-1 ancestor, and the depth-0 row it sits in cannot reach
 * them. The names must be written out in full for Tailwind to see them —
 * `group/row-${depth}` is a string it never scans.
 *
 * Four levels, then the name repeats. A playlist five branches deep would bleed
 * again; nothing in any bundle comes close, and the old indent helper this
 * replaced stopped at three.
 */
const ROW_GROUPS = ["group/row0", "group/row1", "group/row2", "group/row3"] as const;

const REVEALS = [
  "group-hover/row0:opacity-100 group-data-[active=true]/row0:opacity-100",
  "group-hover/row1:opacity-100 group-data-[active=true]/row1:opacity-100",
  "group-hover/row2:opacity-100 group-data-[active=true]/row2:opacity-100",
  "group-hover/row3:opacity-100 group-data-[active=true]/row3:opacity-100",
] as const;

function level(depth: number): number {
  return Math.min(Math.max(depth, 0), ROW_GROUPS.length - 1);
}

/** The group name a row at this depth announces itself under. */
export function rowGroupClass(depth: number): string {
  return ROW_GROUPS[level(depth)];
}

interface PlaylistReorderControlsProps {
  index: number;
  total: number;
  depth: number;
  onMove: (delta: -1 | 1) => Promise<void> | void;
}

/**
 * Nudge an entry one step up or down.
 *
 * **Positioned over the rail, never in the row.** The arrows are absolute,
 * centred on the rail column, one just above the index tile and one just below
 * it, so they overlay the hairline connector rather than taking space in the
 * layout. That is the whole reason they sit here: controls that appear on hover
 * *inside* a row reflow it the moment the pointer arrives, and the text the
 * reader was aiming at moves out from under the cursor.
 *
 * **Exactly one row at a time.** A row's arrows light on hover, and — because
 * touch has no hover — on a tap, which the list records as `data-active`. Both
 * are single-valued by construction: the pointer is over one row, and a tap
 * moves the marked row rather than adding one.
 *
 * That is why nothing here answers to *focus inside the row*. It is the obvious
 * third trigger and it was the wrong one: the index tile lives in the row, so
 * clicking it and pressing Escape leaves Radix's restored focus parked there,
 * and that row stays lit while the pointer moves on to light another — two rows
 * offering to move at once, saying nothing about which one would. `focus-within`
 * did it, and `:has(:focus-visible)` did it too, because Chrome reads a focus
 * restored after a keypress as keyboard focus. For the same reason a mouse press
 * *clears* `data-active` instead of setting it (`PlaylistEntryList`): a mouse
 * already has hover and has never needed the latch.
 *
 * The keyboard keeps its path regardless. The buttons stay in the DOM and stay
 * tabbable at rest, and each reveals *itself* on `focus-visible` — tab to an
 * arrow and there it is. What is gone is only the courtesy of showing a row's
 * arrows before you have reached them.
 *
 * The first entry has no up arrow and the last none down — absent, not disabled.
 * A greyed-out button that only appears on hover is chrome announcing its own
 * uselessness.
 */
export function PlaylistReorderControls({ index, total, depth, onMove }: PlaylistReorderControlsProps) {
  const base = cn(
    "absolute left-1/2 z-10 flex size-5 -translate-x-1/2 cursor-pointer items-center justify-center",
    "rounded-full border border-border bg-background text-muted-foreground shadow-sm",
    "opacity-0 transition-opacity hover:text-foreground",
    REVEALS[level(depth)],
    "focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  );

  return (
    <>
      {index > 0 && (
        // -22px: clear of the tile with a 2px breath, so the number stays
        // readable while the arrow is up. Any further and it collides with the
        // entry above once a row is only two lines tall.
        <button type="button" aria-label="Move up" className={cn(base, "-top-[1.375rem]")} onClick={() => void onMove(-1)}>
          <ArrowUpIcon className="size-3" aria-hidden="true" />
        </button>
      )}
      {index < total - 1 && (
        // 26px: the 24px tile plus the same 2px breath, so the pair reads as
        // symmetrical around the number.
        <button type="button" aria-label="Move down" className={cn(base, "top-[1.625rem]")} onClick={() => void onMove(1)}>
          <ArrowDownIcon className="size-3" aria-hidden="true" />
        </button>
      )}
    </>
  );
}
