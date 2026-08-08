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
 * `Toolbar` is `p-3` around a row whose tallest control is the 36px icon
 * button, plus its bottom hairline: `1.5rem + 2.25rem + 1px`. Published as
 * `--surface-sticky-top` so anything else that wants to pin inside this
 * scrollport — a section heading, a table header — clears the toolbar without
 * each one hard-coding the same number. One place to fix, here, beside the
 * toolbar slot that causes it.
 *
 * The number assumes the band did not wrap. A toolbar squeezed onto two lines
 * (narrow viewport, two open panels) is taller than this, and anything pinned
 * against the variable will tuck under it until the band unwraps.
 */
const TOOLBAR_STICKY_TOP = "calc(3.75rem + 1px)";

/**
 * The layout every project surface shares: no padding on the surface, a toolbar
 * flush to its top edge, and the content below — scrolling under it, or filling
 * the pane with `fill`.
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
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {toolbar && <div className="shrink-0">{toolbar}</div>}
        <div className={cn("min-h-0 min-w-0 flex-1", contentClassName)}>{children}</div>
      </div>
    );
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-y-auto"
      style={{ "--surface-sticky-top": toolbar ? TOOLBAR_STICKY_TOP : "0px" } as CSSProperties}
    >
      <div className={cn("mx-auto w-full", maxWidth)}>
        {toolbar && <div className="sticky top-0 z-10">{toolbar}</div>}
        <div className={cn("p-4 md:p-6", contentClassName)}>{children}</div>
      </div>
    </div>
  );
}
