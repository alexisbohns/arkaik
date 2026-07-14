"use client";

import Link from "next/link";
import type { ReactNode } from "react";

interface OverviewSectionProps {
  title: string;
  /** Jump-off target — the Overview links into the working surfaces (vision.md § IA). */
  href?: string;
  linkLabel?: string;
  className?: string;
  children: ReactNode;
}

/** The dashboard's shared card shell — the changelog/delivery card idiom with a section header row. */
export function OverviewSection({ title, href, linkLabel, className, children }: OverviewSectionProps) {
  return (
    <section className={`flex flex-col gap-3 rounded-xl border bg-card p-4 ${className ?? ""}`}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{title}</h2>
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
