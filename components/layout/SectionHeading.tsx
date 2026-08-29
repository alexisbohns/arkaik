"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export interface SectionHeadingProps {
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
  /**
   * `"stacked"` — the mark above the title, for a heading that owns a column of
   * its own (`SectionRow`). `"inline"` — the mark beside the title and the
   * subtitle pushed to the end of the line, for a heading that sits *above* its
   * content across the full width.
   *
   * The Matrix page needs the second, and needs it for a layout reason rather
   * than a taste one: its content is a horizontally scrolling gallery, and a
   * gallery confined to the `1fr` remainder beside a 17rem heading is a gallery
   * that shows two cards once a panel opens.
   */
  orientation?: "stacked" | "inline";
  className?: string;
}

/**
 * A section's heading: mark, title, what it answers, its headline number.
 *
 * Extracted from `SectionRow`'s left column so the Matrix page can put the same
 * heading *above* its content instead of beside it. One heading treatment, two
 * arrangements — the alternative was a second heading that looked almost like
 * this one and drifted the first time either was touched.
 */
export function SectionHeading({
  title,
  icon: Icon,
  subtitle,
  description,
  href,
  linkLabel,
  orientation = "stacked",
  className,
}: SectionHeadingProps) {
  if (orientation === "inline") {
    return (
      <div className={`flex min-w-0 items-start gap-3 ${className ?? ""}`}>
        <Icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 className="text-sm font-semibold leading-tight">{title}</h2>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
        {subtitle && (
          <p className="shrink-0 whitespace-nowrap text-xs font-medium text-foreground/80">{subtitle}</p>
        )}
        {href && linkLabel && (
          <Link
            href={href}
            className="shrink-0 whitespace-nowrap text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {linkLabel} →
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className={`flex min-w-0 flex-col gap-3 ${className ?? ""}`}>
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
  );
}
