import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface StickyToolbarProps {
  children: ReactNode;
  className?: string;
}

/**
 * The band a scrolling surface keeps at its top — a search or filter row that
 * stays put while the list moves under it, so rows pass behind the bar instead
 * of being sliced off against the panel's edge.
 *
 * It contributes no background of its own: whatever it wraps must be opaque, or
 * the list will show through it as it scrolls past. Every bar used here is a
 * `bg-card` block already, so the band stays out of their way.
 *
 * Pinned at `top-0`, which means flush with the scroll container's inner edge —
 * so the surface should not carry top padding, or the bar detaches from the
 * edge it is meant to be pinned to and rows ride up through the gap.
 */
export function StickyToolbar({ children, className }: StickyToolbarProps) {
  return (
    <div
      className={cn(
        "sticky top-0 z-10 mb-3",
        className,
      )}
    >
      {children}
    </div>
  );
}
