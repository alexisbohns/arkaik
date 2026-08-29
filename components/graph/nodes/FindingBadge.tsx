"use client";

import type { NodeFindingSummary } from "@/lib/utils/quality";
import { SEVERITY_CHIP, SEVERITY_LABEL } from "@/components/quality/quality-styles";
import { cn } from "@/lib/utils";

interface FindingBadgeProps {
  summary: NodeFindingSummary | undefined;
  className?: string;
}

/**
 * The open findings filed against one node, as a count in its worst severity's
 * colour.
 *
 * Worst rather than a breakdown: a card is read at a glance across a canvas, and
 * "3, and the worst is critical" is the whole decision a reader makes there. The
 * per-severity split is one click away in the node panel and on the board.
 *
 * The colours are `quality-styles`', so a node that says critical is wearing the
 * same red the board and the matrix use — the canvas is a fourth surface for the
 * same scale, not a fourth opinion about it.
 */
export function FindingBadge({ summary, className }: FindingBadgeProps) {
  // The common case even on an audited project, and it has to cost nothing: a
  // canvas draws hundreds of these and almost none of them are badges.
  if (!summary || summary.total === 0) return null;

  const label = `${summary.total} open finding${summary.total === 1 ? "" : "s"}, worst: ${SEVERITY_LABEL[summary.worst].toLowerCase()}`;

  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full border px-1.5 text-[10px] font-semibold tabular-nums",
        SEVERITY_CHIP[summary.worst],
        className,
      )}
    >
      {summary.total}
    </span>
  );
}
