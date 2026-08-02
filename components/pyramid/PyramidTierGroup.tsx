"use client";

import type { ReactNode } from "react";

interface PyramidTierGroupProps {
  label: string;
  /** Tier accent from VALUE_TIERS_CONFIG — a raw hex, not a Tailwind class. */
  color: string;
  elementCount: number;
  addressedCount: number;
  children: ReactNode;
}

/** A titled tier section wrapping whichever view is active. */
export function PyramidTierGroup({
  label,
  color,
  elementCount,
  addressedCount,
  children,
}: PyramidTierGroupProps) {
  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <span className="h-3.5 w-[3px] shrink-0 rounded-full" style={{ backgroundColor: color }} />
        {label}
        <span className="font-normal normal-case tracking-normal opacity-70">
          · {elementCount} {elementCount === 1 ? "element" : "elements"} · {addressedCount} addressed
        </span>
      </h2>
      {children}
    </section>
  );
}
