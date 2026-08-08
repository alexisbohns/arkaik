"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export interface SectionRowProps {
  title: string;
  /** The section's mark — big and muted, the Pyramid element card's idiom. */
  icon: LucideIcon;
  /** The section's headline number, or a sentence when it has none to give. */
  subtitle?: ReactNode;
  /** What question this section answers, in one line. */
  description?: string;
  /** Jump-off target, when the section has a working surface behind it. */
  href?: string;
  linkLabel?: string;
  className?: string;
  /**
   * Pin the heading while its own content scrolls past. Opt-in: it only earns
   * its keep when a section is taller than the viewport, and on a page of short
   * sections a heading that detaches from its row is just movement.
   */
  stickyHeader?: boolean;
  children?: ReactNode;
}

/**
 * The two-column section: heading on the left, content on the right.
 *
 * No border and no card background — rows sit inside one surface separated by
 * hairlines (`divide-y` on their container), because a stack of full-width
 * bordered boxes is a stack of lids rather than a document. The left column is
 * width-capped rather than a fraction so the content column keeps the same left
 * edge down the page whatever the viewport does; below `md` the two columns
 * stack.
 *
 * Born on the Overview (`OverviewSection`) and lifted here when the Changelog
 * adopted the same shape for its milestones — one shell, so the two pages
 * cannot drift into two different ideas of the same row.
 */
export function SectionRow({
  title,
  icon: Icon,
  subtitle,
  description,
  href,
  linkLabel,
  className,
  stickyHeader = false,
  children,
}: SectionRowProps) {
  return (
    <section className={`grid gap-4 py-6 md:grid-cols-[minmax(0,17rem)_1fr] md:gap-8 ${className ?? ""}`}>
      {/* Sticky against `--surface-sticky-top`, which `PageSurface` sets to the
          height of its pinned toolbar — so the heading stops below the band
          rather than under it. `self-start` is what makes it stick at all: a
          grid item stretches to its row by default, and a full-height box has
          nowhere to travel. It releases with its own section, because a sticky
          element is bounded by its parent. */}
      <div
        className={`flex min-w-0 flex-col gap-3 ${
          stickyHeader ? "md:sticky md:top-(--surface-sticky-top) md:self-start md:pb-6" : ""
        }`}
      >
        <Icon className="size-7 text-muted-foreground" aria-hidden="true" />
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold leading-tight">{title}</h2>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
          {subtitle && <p className="text-xs font-medium text-foreground/80">{subtitle}</p>}
        </div>
        {href && linkLabel && (
          <Link href={href} className="text-xs text-muted-foreground transition-colors hover:text-foreground">
            {linkLabel} →
          </Link>
        )}
      </div>
      {/* `min-w-0` on a grid child, or a wide body (the pyramid, a gauge list)
          pushes the column past its track instead of scrolling inside it. */}
      {/* `flex-col gap-3` matches the card body: a body of two blocks relies on
          that gap for its spacing, and a bare block would collapse them. */}
      <div className="flex min-w-0 flex-col gap-3">{children}</div>
    </section>
  );
}
