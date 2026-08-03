"use client";

import type { ReactNode } from "react";
import type { StatusId } from "@/lib/config/statuses";
import type { StatusSegment } from "@/lib/utils/platform-status";
import { STATUS_STYLES } from "./node-styles";

/** Circumference is 2πr ≈ 100, so stroke-dasharray takes literal percentages. */
const RADIUS = 15.9155;
const CIRCUMFERENCE = 100;

const SIZE_STYLES = {
  // `gap` must exceed `stroke`: round caps extend each arc by stroke/2 at both
  // ends, so a hole narrower than the stroke width renders as an overlap rather
  // than a gap. stroke + 1.5 leaves ~1.5 units of real background between arcs.
  sm: { box: "size-[30px]", stroke: 4.5, gap: 6 },
  lg: { box: "size-[46px]", stroke: 4, gap: 5.5 },
} as const;

export type StatusRingSize = keyof typeof SIZE_STYLES;

interface StatusRingProps {
  segments: readonly StatusSegment[];
  size?: StatusRingSize;
  /** Accessible name for the ring — the platform, or "All platforms". */
  label: string;
  /** Center content: an acceptance count or a platform icon. */
  children?: ReactNode;
  /** Nodes behind this ring carrying `metadata.blocked_by`; > 0 draws the notch. */
  blockedCount?: number;
}

/**
 * A stacked donut of delivery statuses. Segments arrive in display order
 * (`compareStatusesForDisplay`) and are drawn clockwise from 12 o'clock; an
 * all-zero list renders the muted track alone, which is how an unserved value
 * element reads.
 *
 * blocked is a node-level flag (`metadata.blocked_by`), not a segment: when
 * `blockedCount` > 0 a small amber notch marks the ring (cycle 3 closed the
 * cycle-1 deferral).
 */
export function StatusRing({ segments, size = "lg", label, children, blockedCount = 0 }: StatusRingProps) {
  const { box, stroke, gap } = SIZE_STYLES[size];
  const drawn = segments.filter((segment) => segment.count > 0);
  // One status means no neighbour to separate from — the ring closes completely.
  const arcGap = drawn.length > 1 ? gap : 0;

  const arcs: { status: StatusId; length: number; offset: number; className: string }[] = [];
  let consumed = 0;
  for (const segment of drawn) {
    const span = segment.ratio * CIRCUMFERENCE;
    arcs.push({
      status: segment.status,
      length: Math.min(Math.max(span - arcGap, 0.5), CIRCUMFERENCE),
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
          className="stroke-muted-foreground/25"
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
      {blockedCount > 0 && (
        <span
          className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-amber-500 ring-2 ring-background"
          title={`${blockedCount} blocked`}
          role="img"
          aria-label={`${blockedCount} blocked`}
        />
      )}
    </div>
  );
}
