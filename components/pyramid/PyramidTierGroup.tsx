"use client";

import type { ReactNode } from "react";

interface PyramidTierGroupProps {
  label: string;
  /** Tier accent from VALUE_TIERS_CONFIG — a raw hex, not a Tailwind class. */
  color: string;
  elementCount: number;
  addressedCount: number;
  /** Icon controls drawn at the right end of the heading row — the family's own filter and sort. */
  actions?: ReactNode;
  children: ReactNode;
}

/**
 * One value family as a card: its heading, then its elements as rows with no
 * rules between them — the card is the grouping, and the hover fill is what
 * says a row is a target.
 */
export function PyramidTierGroup({
  label,
  color,
  elementCount,
  addressedCount,
  actions,
  children,
}: PyramidTierGroupProps) {
  return (
    <section className="flex flex-col rounded-xl bg-card p-2">
      <div className="flex items-center justify-between gap-2 pt-1 pr-1 pb-1 pl-3">
        <h2 className="flex min-w-0 items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <span className="h-3.5 w-[3px] shrink-0 rounded-full" style={{ backgroundColor: color }} />
          {label}
          {/* Addressed over total, the pyramid's own notation beside each tier. */}
          <span
            className="font-normal tabular-nums tracking-normal opacity-70"
            aria-label={`${addressedCount} of ${elementCount} elements addressed`}
          >
            {addressedCount}/{elementCount}
          </span>
        </h2>
        {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      </div>
      {children}
    </section>
  );
}
