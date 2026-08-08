import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageSurfaceProps {
  toolbar?: ReactNode;
  children: ReactNode;
  fill?: boolean;
  maxWidth?: string;
  contentClassName?: string;
}

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
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className={cn("mx-auto w-full", maxWidth)}>
        {toolbar && <div className="sticky top-0 z-10">{toolbar}</div>}
        <div className={cn("p-4 md:p-6", contentClassName)}>{children}</div>
      </div>
    </div>
  );
}
