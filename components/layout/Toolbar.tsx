import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface ToolbarProps {
  children: ReactNode;
  className?: string;
}

/**
 * The one toolbar skin in the app: a segment of the surface it sits on.
 *
 * Material 3's segmented look, not a band with a rule under it: the toolbar is
 * its own `bg-card` piece, 4px of page background away from the content below
 * it, and the corners say which pieces belong together — 14px where the group
 * meets the outside, 4px where two of its pieces meet. The toolbar only draws
 * the 4px. `PageSurface` owns the slot, so it rounds the top of the first bar
 * and lays the gaps; a toolbar never knows whether it is first.
 *
 * The row is `justify-between`, which is the layout every bar here wants: a
 * "what am I looking at" cluster on the left, a "how do I see it" cluster on the
 * right. Use {@link ToolbarGroup} for those clusters rather than hand-rolling
 * the same flex row per bar. A bar with a single child gets left alignment for
 * free; a bar that genuinely needs another distribution can override with
 * `className` (tailwind-merge lets the caller win).
 *
 * Stacking two of these — a filter bar with a selection bar beneath it — is the
 * intended way to grow a toolbar, not nesting rows inside one band: each bar is
 * its own segment, and the whole stack pins as one via {@link PageSurface}.
 *
 * `data-slot="toolbar"` is the scope app/m3/controls.css skins: inside it the
 * outline and ghost buttons and the search field become 40px tonal pills (no
 * stroke), and a pressed toggle settles into a squircle. 16px between
 * clusters, 8px inside one: the controls grew, the gaps between them did not.
 */
export function Toolbar({ children, className }: ToolbarProps) {
  return (
    <div
      data-slot="toolbar"
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-sm bg-card p-3",
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
 *
 * A search cluster should grow from a real basis (`flex-[1_1_16rem]`), not
 * `flex-1`'s zero: from zero it never forces the bar to wrap, so on a phone it
 * gets squeezed to nothing and stacks its own icon over its field. From 16rem
 * the bar wraps first, and search keeps a full row of its own.
 */
export function ToolbarGroup({ children, className }: ToolbarProps) {
  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-2", className)}>
      {children}
    </div>
  );
}
