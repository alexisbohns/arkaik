"use client";

import type { ReactNode } from "react";
import { SectionHeading, type SectionHeadingProps } from "@/components/layout/SectionHeading";

export interface SectionRowProps
  extends Omit<SectionHeadingProps, "orientation" | "className"> {
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
 *
 * The heading itself is `SectionHeading`, shared with the Quality matrix, which
 * needs the same heading above its content rather than beside it.
 */
export function SectionRow({
  title,
  icon,
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
      <SectionHeading
        title={title}
        icon={icon}
        subtitle={subtitle}
        description={description}
        href={href}
        linkLabel={linkLabel}
        className={stickyHeader ? "md:sticky md:top-(--surface-sticky-top) md:self-start md:pb-6" : ""}
      />
      {/* `min-w-0` on a grid child, or a wide body (the pyramid, a gauge list)
          pushes the column past its track instead of scrolling inside it. */}
      {/* `flex-col gap-3` matches the card body: a body of two blocks relies on
          that gap for its spacing, and a bare block would collapse them. */}
      <div className="flex min-w-0 flex-col gap-3">{children}</div>
    </section>
  );
}
