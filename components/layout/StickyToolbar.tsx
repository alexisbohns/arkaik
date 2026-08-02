import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface StickyToolbarProps {
  children: ReactNode;
  className?: string;
}

/**
 * The band a scrolling surface keeps at its top — a search or filter row that
 * stays put while the list moves under it.
 *
 * It owns the surface's top and side padding rather than inheriting it, because
 * a bar inset from the scroll container's edges leaves a gap above itself once
 * it sticks, and rows ride up through that gap in full view. Spanning the whole
 * column instead means content passes *behind* the bar and fades out under it,
 * rather than being sliced off at the panel's edge.
 *
 * A scrolling surface using this should carry only `px` and `pb` of its own —
 * the top padding is this component's, or the band floats away from the edge it
 * is supposed to be pinned to.
 */
export function StickyToolbar({ children, className }: StickyToolbarProps) {
  return (
    <div
      className={cn(
        "sticky top-0 z-10 px-4 py-4 backdrop-blur md:px-6 md:py-6",
        // Translucent rather than solid: what is passing underneath should read
        // as hidden by the bar, not as having stopped existing at its edge.
        "bg-background/80",
        className,
      )}
    >
      {children}
    </div>
  );
}
