import type { ReactNode } from "react";
import { PreviewErrorBoundary } from "./PreviewErrorBoundary";

interface PreviewFrameProps {
  /** In-app path shown in the bar, e.g. "Project › Delivery"; from the catalogue. */
  breadcrumb: string;
  /** Fixed body height in px, from the catalogue. */
  height: number;
  /** The one-line source line under the frame. */
  caption: string;
  children: ReactNode;
}

/**
 * The app-chrome frame every preview sits in (spec § Preview frame): two muted
 * dots, the breadcrumb, a LIVE pill; body at the app radius plus 2px with a
 * soft shadow; a caption line beneath. The frame owns height and overflow so
 * previews never set their own outer size, and it holds no copy of its own —
 * breadcrumb and caption arrive as props.
 */
export function PreviewFrame({ breadcrumb, height, caption, children }: PreviewFrameProps) {
  const [root, ...rest] = breadcrumb.split(" › ");
  return (
    <figure className="m-0">
      <div className="overflow-hidden rounded-[calc(var(--radius)+2px)] border bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.12)]">
        <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
          <span aria-hidden className="size-2 rounded-full bg-border" />
          <span aria-hidden className="size-2 rounded-full bg-border" />
          <span className="ml-1.5">
            Arkaik <span aria-hidden>›</span> {root}
            {rest.map((crumb, i) => (
              <span key={crumb}>
                {" "}
                <span aria-hidden>›</span>{" "}
                <span className={i === rest.length - 1 ? "font-medium text-foreground" : undefined}>
                  {crumb}
                </span>
              </span>
            ))}
          </span>
          <span className="ml-auto rounded-full bg-foreground px-2 py-0.5 font-mono text-[10px] tracking-[0.12em] text-background">
            LIVE
          </span>
        </div>
        <div className="relative overflow-hidden" style={{ height }}>
          <PreviewErrorBoundary>{children}</PreviewErrorBoundary>
        </div>
      </div>
      <figcaption className="mt-2 text-xs text-muted-foreground">{caption}</figcaption>
    </figure>
  );
}
