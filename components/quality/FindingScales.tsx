"use client";

import type { FindingRow } from "@/lib/utils/quality";
import { Badge } from "@/components/ui/badge";
import {
  COST_CHIP,
  COST_HINT,
  COST_TERM,
  FINDING_STATUS_LABEL,
  VERDICT_LABEL,
} from "@/components/quality/quality-styles";
import { ScaleChip } from "@/components/quality/ScaleChip";
import { SeverityPill } from "@/components/quality/SeverityPill";
import { cn } from "@/lib/utils";

/**
 * A finding's scales, as one meta line: severity, cost, the verdict when there
 * is one, and the status word pushed to the end.
 *
 * A component rather than a block written out in each place, for the reason
 * `FindingMark` is one: the card's third line and the panel's identity block
 * carried this markup character for character, down to the green tint the
 * `resolved` badge alone gets. Two copies would part company the first time a
 * scale gained a chip or a tint moved, and they would part company quietly —
 * the board and the panel a reader opens from it are never on screen together,
 * so nobody would see them disagree.
 *
 * Not merged with the criterion/surface line above it, which looks like the
 * same shape and is not: the card's criterion chip is optional and truncates,
 * the panel's is mandatory and wraps.
 *
 * `className` is the caller's line-level spacing and lands last, so a caller
 * can override the wrapper without editing this file.
 *
 * The priority is not in here. It is the square on the rail, and the mark in
 * the panel header — the same square, from `FindingMark`.
 */
export function FindingScales({ row, className }: { row: FindingRow; className?: string }) {
  const verdict = row.verification?.verdict;
  const acceptedRisk = row.status === "accepted-risk";

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground",
        className,
      )}
    >
      <SeverityPill
        impact={row.impact}
        likelihood={row.likelihood}
        risk={row.risk}
        severity={row.severity}
      />
      <span>· cost</span>
      <ScaleChip
        term={COST_TERM[row.cost]}
        hint={COST_HINT[row.cost]}
        className={cn("rounded border px-1 font-medium", COST_CHIP[row.cost])}
      >
        {row.cost}
      </ScaleChip>
      {verdict && <span>· {VERDICT_LABEL[verdict]}</span>}
      {/* The accepted-risk callout below states the status in its own badge,
          in the treatment that says it is a decision; a second badge up here
          would say it twice and more quietly. */}
      {/* The rail's mark is a glyph; this is the word for it, and the only
          copy of it a screen reader meets. Tinted to match the tick for
          `resolved` alone — the same rule the rail follows, and the reason
          the badge did not simply give way to the mark. */}
      {!row.open && !acceptedRisk && (
        <Badge
          variant="outline"
          className={cn(
            "ms-auto",
            row.status === "resolved" && "border-green-500/40 text-green-700 dark:text-green-400",
          )}
        >
          {FINDING_STATUS_LABEL[row.status]}
        </Badge>
      )}
    </div>
  );
}
