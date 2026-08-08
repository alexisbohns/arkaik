"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface OverviewSectionProps {
  title: string;
  /** The card's species mark — big and muted, the Pyramid element card's idiom. */
  icon: LucideIcon;
  /** The card's headline number, or a sentence when it has none to give. */
  subtitle?: ReactNode;
  /** Jump-off target — the Overview links into the working surfaces (vision.md § IA). */
  href?: string;
  linkLabel?: string;
  className?: string;
  /** Optional: a card whose whole answer fits in the subtitle has no body. */
  children?: ReactNode;
}

/**
 * The dashboard's shared card shell.
 *
 * The header is the Pyramid element card's header (`PyramidElementCard`): one
 * large icon over a real title with a quiet line beneath it. That line is where
 * a card's summary numbers belong — "412 nodes · 980 edges" is what the reader
 * came for, so it sits under the title rather than as the first row of the body.
 */
export function OverviewSection({
  title,
  icon: Icon,
  subtitle,
  href,
  linkLabel,
  className,
  children,
}: OverviewSectionProps) {
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
