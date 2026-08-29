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
  className?: string;
}

/**
 * A section's heading: mark, title, what it answers, its headline number —
 * always in that order, stacked.
 *
 * Extracted from `SectionRow`'s left column so the Quality matrix could put the
 * same heading *above* its content instead of beside it. There is deliberately
 * one arrangement rather than two: the Overview, the Design page, the Changelog
 * and the matrix all show the same four parts, and the moment the mark moved
 * beside the title on one of them the four pages read as four ideas. Where the
 * heading sits is the caller's business (a column, or full width above a
 * gallery); how it reads is not.
 */
export function SectionHeading({
  title,
  icon: Icon,
  subtitle,
  description,
  href,
  linkLabel,
  className,
}: SectionHeadingProps) {
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
