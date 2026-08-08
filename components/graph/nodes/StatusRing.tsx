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
  xs: { box: "size-[22px]", stroke: 5, gap: 6.5 },
  sm: { box: "size-[30px]", stroke: 4.5, gap: 6 },
  lg: { box: "size-[46px]", stroke: 4, gap: 5.5 },
} as const;

export type StatusRingSize = keyof typeof SIZE_STYLES;

/**
 * One arc of a {@link Ring}: a share of the whole and the Tailwind `stroke-*`
 * class to draw it in. Zero-share arcs are dropped by the ring itself.
 */
export interface RingArc {
  key: string;
  ratio: number;
  className: string;
}

interface RingProps {
  arcs: readonly RingArc[];
  size?: StatusRingSize;
  /** Accessible name for the ring — the platform, "All platforms", parity… */
  label: string;
  /** Center content: a count, a platform icon, a stethoscope. */
  children?: ReactNode;
  /** Draws the amber corner notch, labelled with this text. */
  notchLabel?: string;
}

/**
 * The donut itself, in the one geometry every ring in the app shares: arcs drawn
 * clockwise from 12 o'clock over a muted track, separated by a gap wide enough
 * that round caps do not overlap, with a slot in the middle.
 *
 * It is split out from {@link StatusRing} because the delivery statuses are not
 * the only thing worth drawing this way — the acceptance matrix draws parity in
 * the same wheel — and a second hand-rolled donut would have drifted in stroke
 * width, gap and cap the first time either was tuned.
 */
export function Ring({ arcs, size = "lg", label, children, notchLabel }: RingProps) {
  const { box, stroke, gap } = SIZE_STYLES[size];
  const drawn = arcs.filter((arc) => arc.ratio > 0);
  // One arc means no neighbour to separate from — the ring closes completely.
  const arcGap = drawn.length > 1 ? gap : 0;

  const segments: { key: string; length: number; offset: number; className: string }[] = [];
  let consumed = 0;
  for (const arc of drawn) {
    const span = arc.ratio * CIRCUMFERENCE;
    segments.push({
      key: arc.key,
      length: Math.min(Math.max(span - arcGap, 0.5), CIRCUMFERENCE),
      offset: consumed,
      className: arc.className,
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
        {segments.map((segment) => (
          <circle
            key={segment.key}
            cx="18"
            cy="18"
            r={RADIUS}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${segment.length} ${CIRCUMFERENCE - segment.length}`}
            strokeDashoffset={-segment.offset}
            className={segment.className}
          />
        ))}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">{children}</div>
      {notchLabel && (
        <span
          className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-amber-500 ring-2 ring-background"
          title={notchLabel}
          role="img"
          aria-label={notchLabel}
        />
      )}
    </div>
  );
}

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
 * cycle-1 deferral). The count flows from node-built rollups (addNodeToRollup
 * / addEffectiveNodeToRollup); status-only aggregations (pyramid,
 * directly-covering acceptances) deliberately don't carry it yet.
 */
export function StatusRing({ segments, size = "lg", label, children, blockedCount = 0 }: StatusRingProps) {
  const arcs: RingArc[] = segments.map((segment: { status: StatusId; ratio: number }) => ({
    key: segment.status,
    ratio: segment.ratio,
    className: STATUS_STYLES[segment.status].stroke,
  }));

  return (
    <Ring
      arcs={arcs}
      size={size}
      label={label}
      notchLabel={blockedCount > 0 ? `${blockedCount} blocked` : undefined}
    >
      {children}
    </Ring>
  );
}
