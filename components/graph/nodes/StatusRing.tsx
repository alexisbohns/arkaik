"use client";

import type { ReactNode } from "react";
import type { StatusSegment } from "@/lib/utils/platform-status";
import { STATUS_STYLES } from "./node-styles";

/** Circumference is 2πr ≈ 100, so stroke-dasharray takes literal percentages. */
const RADIUS = 15.9155;
const CIRCUMFERENCE = 100;
/** Percentage points shaved off each arc so neighbouring statuses stay distinguishable. */
const ARC_GAP = 1.6;

const SIZE_STYLES = {
  sm: { box: "size-[30px]", stroke: 4.5 },
  lg: { box: "size-[46px]", stroke: 4 },
} as const;

export type StatusRingSize = keyof typeof SIZE_STYLES;

interface StatusRingProps {
  segments: readonly StatusSegment[];
  size?: StatusRingSize;
  /** Accessible name for the ring — the platform, or "All platforms". */
  label: string;
  /** Center content: an acceptance count or a platform icon. */
  children?: ReactNode;
}

/**
 * A stacked donut of delivery statuses. Segments arrive in display order
 * (`compareStatusesForDisplay`) and are drawn clockwise from 12 o'clock; an
 * all-zero list renders the muted track alone, which is how an unserved value
 * element reads.
 */
export function StatusRing({ segments, size = "lg", label, children }: StatusRingProps) {
  const { box, stroke } = SIZE_STYLES[size];

  const arcs: { status: string; length: number; offset: number; className: string }[] = [];
  let consumed = 0;
  for (const segment of segments) {
    if (segment.count === 0) continue;
    const span = segment.ratio * CIRCUMFERENCE;
    arcs.push({
      status: segment.status,
      length: Math.max(span - ARC_GAP, 0.5),
      offset: consumed,
      className: STATUS_STYLES[segment.status].stroke,
    });
    consumed += span;
  }

  return (
    <div className={`relative shrink-0 ${box}`}>
      <svg viewBox="0 0 36 36" className="size-full -rotate-90" role="img" aria-label={label}>
        <circle
          cx="18"
          cy="18"
          r={RADIUS}
          fill="none"
          strokeWidth={stroke}
          className="stroke-muted-foreground/20"
        />
        {arcs.map((arc) => (
          <circle
            key={arc.status}
            cx="18"
            cy="18"
            r={RADIUS}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${arc.length} ${CIRCUMFERENCE - arc.length}`}
            strokeDashoffset={-arc.offset}
            className={arc.className}
          />
        ))}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  );
}
