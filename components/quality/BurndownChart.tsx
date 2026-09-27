"use client";

import { useMemo, useState, type PointerEvent } from "react";
import type { FindingsBurndown } from "@arkaik/schema";
import { SEVERITY_DOT, SEVERITY_FILL, SEVERITY_LABEL } from "@/components/quality/quality-styles";
import { cn } from "@/lib/utils";
import {
  BURNDOWN_SEVERITIES,
  burndownGeometry,
  burndownPointAt,
  describeBurndownCause,
  describeBurndownTrend,
  describeBurndownDetail,
  describeClosedSince,
} from "@/lib/utils/quality";

/** The sparkline's box. `preserveAspectRatio="none"` stretches it to the card; strokes do not scale. */
const SPARK = { width: 120, height: 24 } as const;
/** The full chart's box — wide enough that a week of closes reads as steps, not a smear. */
const FULL = { width: 600, height: 72 } as const;

/**
 * Open findings over time, as one quiet line — the Overall cards' footnote.
 *
 * One series, muted, never the severity colours: a card is 160px wide, and
 * four stacked bands at that size are a smudge. The card's count already
 * says what is open *now*; this says which way it has been going, fitted to
 * its own range so a handful of closes is visible at all. Audits are the
 * faint ticks. Renders nothing without history, so a card whose surface no
 * event ever touched keeps the shape it always had.
 */
export function BurndownSparkline({ burndown, className }: { burndown: FindingsBurndown; className?: string }) {
  const geometry = useMemo(() => burndownGeometry(burndown.points, SPARK.width, SPARK.height, { fitLine: true }), [burndown.points]);
  if (burndown.points.length === 0) return null;

  return (
    <svg
      viewBox={`0 0 ${SPARK.width} ${SPARK.height}`}
      preserveAspectRatio="none"
      className={cn("h-5 w-full overflow-visible text-muted-foreground", className)}
      role="img"
      aria-label={describeBurndownTrend(burndown)}
    >
      {geometry.ticks.map((x, index) => (
        <line
          key={`${x}-${index}`}
          x1={x}
          x2={x}
          y1={0}
          y2={SPARK.height}
          className="stroke-foreground/15"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      <path d={geometry.line} fill="none" stroke="currentColor" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/**
 * The closed-since sentence: `20 closed since the 2026-08 audit · 180 open`.
 *
 * This is the line issue #441 exists for. The matrix scores what the code is,
 * and does not move until a re-audit; this says what was *done* in the
 * meantime, the day it was done. The `title` splits "closed" into fixes and
 * accepted risks, and names what opened.
 */
export function ClosedSinceLine({
  burndown,
  openNow,
  className,
}: {
  burndown: FindingsBurndown;
  openNow: number;
  className?: string;
}) {
  const text = describeClosedSince(burndown, openNow);
  if (text === null) return null;
  return (
    <span className={className} title={describeBurndownDetail(burndown) ?? undefined}>
      {text}
    </span>
  );
}

/**
 * Open findings over time, stacked by severity — the project-wide burndown.
 *
 * - **Stacked worst-first from the baseline**, so the red is what the eye
 *   reaches first and what a good week visibly shrinks.
 * - **Severity colours are the dots' own** (`SEVERITY_FILL`), with a
 *   surface-coloured gap between bands and a legend carrying the live
 *   numbers: colour is never the only thing telling High from Medium.
 * - **Audits are ticks.** At a tick the line may jump either way — an audit
 *   re-baselines to what it counted, which is how a finding closed by hand
 *   stops drifting.
 * - **Hover** snaps to the step under the pointer and names the reading and
 *   what caused it.
 */
export function BurndownChart({
  burndown,
  caption,
  className,
}: {
  burndown: FindingsBurndown;
  /** What the chart is narrowed to, e.g. "on web · SEC". */
  caption?: string;
  className?: string;
}) {
  const geometry = useMemo(() => burndownGeometry(burndown.points, FULL.width, FULL.height), [burndown.points]);
  const [hover, setHover] = useState<{ index: number; x: number } | null>(null);

  if (burndown.points.length === 0) return null;

  const latest = burndown.points[burndown.points.length - 1];
  const shown = hover === null ? null : burndown.points[hover.index];

  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width === 0) return;
    const ratio = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    setHover({ index: burndownPointAt(geometry.xs, ratio * FULL.width), x: ratio });
  };

  return (
    <figure className={cn("flex flex-col gap-2", className)}>
      <figcaption className="text-xs text-muted-foreground">
        Open findings over time{caption ? ` ${caption}` : ""}
      </figcaption>
      <div className="relative">
        <svg
          viewBox={`0 0 ${FULL.width} ${FULL.height}`}
          preserveAspectRatio="none"
          className="h-18 w-full touch-none"
          role="img"
          aria-label={describeBurndownTrend(burndown)}
          onPointerMove={onPointerMove}
          onPointerLeave={() => setHover(null)}
        >
          <line
            x1={0}
            x2={FULL.width}
            y1={FULL.height}
            y2={FULL.height}
            className="stroke-border"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
          {geometry.bands.map((band) => (
            <path
              key={band.severity}
              d={band.path}
              className={cn(SEVERITY_FILL[band.severity], "stroke-background")}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {geometry.ticks.map((x, index) => (
            <line
              key={`${x}-${index}`}
              x1={x}
              x2={x}
              y1={0}
              y2={FULL.height}
              className="stroke-foreground/40"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {hover !== null && (
            <line
              x1={hover.x * FULL.width}
              x2={hover.x * FULL.width}
              y1={0}
              y2={FULL.height}
              className="stroke-foreground"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>

        {shown !== null && hover !== null && (
          <div
            className="pointer-events-none absolute bottom-full z-10 mb-1 w-max max-w-64 -translate-x-1/2 rounded-md border bg-popover px-2 py-1.5 text-[11px] text-popover-foreground shadow-md"
            // Clamped so the tooltip never leaves the chart at either edge.
            style={{ left: `clamp(4rem, ${hover.x * 100}%, calc(100% - 4rem))` }}
            aria-hidden="true"
          >
            <div className="font-medium tabular-nums">{shown.ts.slice(0, 10) || "unknown date"}</div>
            <div className="truncate text-muted-foreground">{describeBurndownCause(shown)}</div>
            <SeverityCounts open={shown.open} className="mt-1" />
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <SeverityCounts open={latest.open} />
        <span className="flex items-center gap-1">
          <span className="h-3 w-px bg-foreground/40" aria-hidden="true" />
          audit
        </span>
      </div>
    </figure>
  );
}

/** A severity legend carrying the numbers: dot, name, count — worst first. */
function SeverityCounts({ open, className }: { open: FindingsBurndown["points"][number]["open"]; className?: string }) {
  return (
    <span className={cn("flex flex-wrap items-center gap-x-3 gap-y-1", className)}>
      {BURNDOWN_SEVERITIES.map((severity) => (
        <span key={severity} className="flex items-center gap-1">
          <span className={cn("size-2 rounded-full", SEVERITY_DOT[severity])} aria-hidden="true" />
          <span>{SEVERITY_LABEL[severity]}</span>
          <span className="font-medium tabular-nums text-foreground">{open[severity]}</span>
        </span>
      ))}
    </span>
  );
}
