import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageSurfaceProps {
  toolbar?: ReactNode;
  children: ReactNode;
  fill?: boolean;
  maxWidth?: string;
  contentClassName?: string;
}

/**
 * How far below the scrollport's top edge a pinned toolbar ends.
 *
 * `Toolbar` is `p-3` around a row whose tallest control is a 40px M3 pill
 * (app/m3/controls.css), plus the 4px gap that separates it from the content:
 * `1.5rem + 2.5rem + 4px`. Published as `--surface-sticky-top` so anything
 * else that wants to pin inside this scrollport — a section heading, a table
 * header — clears the toolbar without each one hard-coding the same number.
 * One place to fix, here, beside the toolbar slot that causes it.
 *
 * The number assumes one bar that did not wrap. A toolbar squeezed onto two
 * lines (narrow viewport, two open panels), or a second bar stacked under it,
 * is taller than this, and anything pinned against the variable will tuck
 * under it until the stack shrinks back.
 */
const TOOLBAR_STICKY_TOP = "calc(4rem + 4px)";

/**
 * The toolbar slot: its bars stacked 4px apart, the first one rounded on top
 * where the group meets the outside. Every bar is a direct child — a page that
 * passes two passes a fragment — so the first-child rule finds the top one.
 */
const TOOLBAR_STACK = "flex flex-col gap-1 [&>:first-child]:rounded-t-xl";

/**
 * The content segment under a toolbar: a 4px top where it meets the bar, the
 * cell's own 14px at the bottom.
 */
const CONTENT_SEGMENT = "rounded-t-sm rounded-b-xl bg-card";

/**
 * The layout every project surface shares: no padding on the surface, a toolbar
 * at its top edge, and the content below — scrolling under it, or filling the
 * pane with `fill`.
 *
 * With a toolbar, the surface is drawn in segments (Material 3): the bar and
 * the content are each their own card, 4px of page background apart. A rule
 * between two parts of one box said the same thing less clearly. The cell
 * around the surface would paint over that gap, so the root carries
 * `data-surface-segments` and `PanelStack` drops the cell's fill while a
 * segmented surface is inside. Without a toolbar there is nothing to separate,
 * and the markup is exactly what it was.
 *
 * Why it is built this way, and why the box is `flex-1` rather than `h-full`:
 * `docs/superpowers/knowledge/ui.md` § Page surfaces.
 */
export function PageSurface({
  toolbar,
  children,
  fill,
  maxWidth,
  contentClassName,
}: PageSurfaceProps) {
  if (fill) {
    return (
      <div
        data-surface-segments={toolbar ? "" : undefined}
        className={cn("flex min-h-0 flex-1 flex-col overflow-hidden", toolbar && "gap-1")}
      >
        {toolbar && <div className={cn("shrink-0", TOOLBAR_STACK)}>{toolbar}</div>}
        <div className={cn("min-h-0 min-w-0 flex-1", toolbar && CONTENT_SEGMENT, contentClassName)}>
          {children}
        </div>
      </div>
    );
  }

  if (!toolbar) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto" style={{ "--surface-sticky-top": "0px" } as CSSProperties}>
        <div className={cn("mx-auto w-full", maxWidth)}>
          <div className={cn("p-4 md:p-6", contentClassName)}>{children}</div>
        </div>
      </div>
    );
  }

  // The pinned stack paints the page background under its bars and across the
  // gap below them: content scrolling up must vanish at the gap, not show
  // through it. `min-h-full` + `flex-1` stretch the content card to the bottom
  // of the cell when the content is short.
  return (
    <div
      data-surface-segments=""
      className="flex min-h-0 flex-1 flex-col overflow-y-auto"
      style={{ "--surface-sticky-top": TOOLBAR_STICKY_TOP } as CSSProperties}
    >
      <div className={cn("mx-auto flex min-h-full w-full flex-col", maxWidth)}>
        <div className={cn("sticky top-0 z-10 bg-background pb-1", TOOLBAR_STACK)}>{toolbar}</div>
        <div className={cn("flex-1 p-4 md:p-6", CONTENT_SEGMENT, contentClassName)}>{children}</div>
      </div>
    </div>
  );
}
