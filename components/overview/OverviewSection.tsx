"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useOverviewLayoutContext } from "./OverviewLayoutContext";

interface OverviewSectionProps {
  title: string;
  /** The card's species mark — big and muted, the Pyramid element card's idiom. */
  icon: LucideIcon;
  /** The card's headline number, or a sentence when it has none to give. */
  subtitle?: ReactNode;
  /**
   * What question this section answers, in one line. Drawn only by the rows
   * display, whose left column is wide enough to say it; the card's header has
   * room for the numbers and nothing else.
   */
  description?: string;
  /** Jump-off target — the Overview links into the working surfaces (vision.md § IA). */
  href?: string;
  linkLabel?: string;
  className?: string;
  /** Optional: a card whose whole answer fits in the subtitle has no body. */
  children?: ReactNode;
}

/**
 * The dashboard's shared section, in whichever shell the reader picked.
 *
 * Both shells carry the same header material — icon, title, summary line,
 * jump-off link — and differ only in where they put it: stacked above the body
 * in a card, or beside it in a row. Cards call this and never choose; the
 * choice is the page's, read from `OverviewLayoutContext`.
 */
export function OverviewSection(props: OverviewSectionProps) {
  return useOverviewLayoutContext() === "rows" ? <OverviewRow {...props} /> : <OverviewCard {...props} />;
}

/**
 * The card shell.
 *
 * The header is the Pyramid element card's header (`PyramidElementCard`): one
 * large icon over a real title with a quiet line beneath it. That line is where
 * a card's summary numbers belong — "412 nodes · 980 edges" is what the reader
 * came for, so it sits under the title rather than as the first row of the body.
 */
function OverviewCard({ title, icon: Icon, subtitle, href, linkLabel, className, children }: OverviewSectionProps) {
  return (
    <section className={`flex flex-col gap-3 rounded-xl border bg-card p-4 ${className ?? ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-3">
          <Icon className="size-7 text-muted-foreground" aria-hidden="true" />
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold leading-tight">{title}</h2>
            {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
          </div>
        </div>
        {href && linkLabel && (
          <Link href={href} className="shrink-0 text-xs text-muted-foreground transition-colors hover:text-foreground">
            {linkLabel} →
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

/**
 * The row shell: heading on the left, content on the right.
 *
 * No border and no card background — the rows sit inside one surface separated
 * by hairlines (`divide-y` on their container), because nine bordered boxes
 * stacked full-width is a stack of lids rather than a document. The left column
 * is width-capped rather than a fraction so the content column keeps the same
 * left edge down the page whatever the viewport does; below `md` the two
 * columns stack and the row reads exactly like today's card.
 */
function OverviewRow({
  title,
  icon: Icon,
  subtitle,
  description,
  href,
  linkLabel,
  className,
  children,
}: OverviewSectionProps) {
  return (
    <section className={`grid gap-4 py-6 md:grid-cols-[minmax(0,17rem)_1fr] md:gap-8 ${className ?? ""}`}>
      <div className="flex min-w-0 flex-col gap-3">
        <Icon className="size-7 text-muted-foreground" aria-hidden="true" />
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold leading-tight">{title}</h2>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
          {subtitle && <p className="text-xs font-medium text-foreground/80">{subtitle}</p>}
        </div>
        {href && linkLabel && (
          <Link
            href={href}
            className="text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {linkLabel} →
          </Link>
        )}
      </div>
      {/* `min-w-0` on a grid child, or a wide body (the pyramid, a gauge list)
          pushes the column past its track instead of scrolling inside it. */}
      {/* Same `flex-col gap-3` as the card's body: a card whose body is two
          blocks (a gauge list and its chips) relies on that gap for its
          spacing, and a bare block here would collapse them together. */}
      <div className="flex min-w-0 flex-col gap-3">{children}</div>
    </section>
  );
}
