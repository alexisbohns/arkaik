import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface ToolbarProps {
  children: ReactNode;
  className?: string;
}

/**
 * The one toolbar skin in the app: an opaque band, flush to the surface's edges,
 * separated from the content below by a single hairline.
 *
 * There is deliberately no border, radius or shadow. A toolbar is not a card
 * floating on the surface — it is the surface's own top edge, so it draws the
 * same `bg-card` as the panel it sits in and marks its bottom with `border-b`.
 * The rounded, bordered bar this replaced read as a control panel *inside* the
 * list, which is exactly the reading `border-b` removes.
 *
 * The row is `justify-between`, which is the layout every bar here wants: a
 * "what am I looking at" cluster on the left, a "how do I see it" cluster on the
 * right. Use {@link ToolbarGroup} for those clusters rather than hand-rolling
 * the same flex row per bar. A bar with a single child gets left alignment for
 * free; a bar that genuinely needs another distribution can override with
 * `className` (tailwind-merge lets the caller win).
 *
 * Stacking two of these — a filter bar with a selection bar beneath it — is the
 * intended way to grow a toolbar, not nesting rows inside one band: each band
 * keeps its own hairline, and the whole stack pins as one via
 * {@link PageSurface}.
 */
export function Toolbar({ children, className }: ToolbarProps) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 border-b bg-card p-3",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * A cluster of related controls inside a {@link Toolbar} — the unit
 * `justify-between` distributes. Wrapping is on: a toolbar narrowed by two open
 * panels has to fold rather than clip, and folding inside the groups keeps
 * related controls together as it does.
 */
export function ToolbarGroup({ children, className }: ToolbarProps) {
  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-2", className)}>
      {children}
    </div>
  );
}
