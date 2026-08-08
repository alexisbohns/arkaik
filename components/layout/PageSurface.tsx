import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageSurfaceProps {
  /**
   * The bar — one {@link Toolbar}, or several stacked — pinned to the surface's
   * top edge. Omitting it is allowed: a surface with no controls still wants the
   * same scroll and padding contract as one that has them.
   */
  toolbar?: ReactNode;
  /** The content. Scrolls under the toolbar, or fills it — see `fill`. */
  children: ReactNode;
  /**
   * Hand the content the whole area under the toolbar, unpadded, and let it own
   * its own scrolling — the filling-pane mode.
   *
   * This is for a single child that *is* the surface: a table, a board, a canvas.
   * Such a child has its own header to keep in view and its own scrollport to
   * keep it in, and wrapping it in a padded scrolling column gives it two — an
   * outer one it does not control and an inner one it does, with a band of dead
   * padding between them where the wheel behaves differently than it does over
   * the child. Off by default: a grid of cards or a stack of sections genuinely
   * is a scrolling column, and wants the padding and the sticky bar.
   */
  fill?: boolean;
  /**
   * A centred reading column, e.g. `"max-w-6xl"`. Applies to the toolbar too, so
   * the bar's hairline lines up with the content it filters instead of running
   * past it. Ignored under `fill`, which by definition takes the full width.
   */
  maxWidth?: string;
  /** Extra classes on the content block — usually a `flex`/`grid` layout. */
  contentClassName?: string;
}

/**
 * The layout every project surface shares: **no padding on the surface itself**,
 * a toolbar flush against its top edge, and the content below.
 *
 * The padding placement is the whole point. A padded surface pushes the bar off
 * the edge it is pinned to, and rows then ride up through the gap as they scroll
 * past; giving the padding to the content puts the hairline exactly where the
 * clipping happens.
 *
 * ## Two modes, one edge
 *
 * Scrolling-column (default) — the surface is the scrollport, the toolbar is
 * `sticky` inside it, and the content carries the padding. Filling-pane
 * (`fill`) — the surface does not scroll at all, the toolbar is simply the first
 * flex row, and the content takes the rest and scrolls itself. The toolbar looks
 * and sits identically either way; only what happens below it differs.
 *
 * ## Why the box is `flex-1`, not `h-full`
 *
 * `h-full` resolves against the panel cell, and the cell is a grid item that
 * auto-sizes to its content — so a tall list grew the cell, the scroller matched
 * the grown cell, and nothing ever scrolled. (`PanelStack` now pins the row to
 * the viewport height, which is the other half of that fix.) `min-h-0 flex-1`
 * asks for "whatever is left" instead of a percentage of something that moves,
 * and cannot regress the same way.
 *
 * Overflow is `y`-only in the scrolling mode: a toolbar that scrolls sideways out
 * of its own surface is unusable, and every bar here wraps rather than growing
 * wider.
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
        {/* `shrink-0`, not `sticky`: nothing scrolls past it here, and a flex row
            that can shrink would be squeezed by the pane below it. */}
        {toolbar && <div className="shrink-0">{toolbar}</div>}
        <div className={cn("min-h-0 min-w-0 flex-1", contentClassName)}>{children}</div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className={cn("mx-auto w-full", maxWidth)}>
        {/* Inside the scroller, because that is what `sticky` pins against —
            and above the content in z-order, because rows have to pass behind
            it. It needs no background of its own: `Toolbar` is opaque. */}
        {toolbar && <div className="sticky top-0 z-10">{toolbar}</div>}
        <div className={cn("p-4 md:p-6", contentClassName)}>{children}</div>
      </div>
    </div>
  );
}
