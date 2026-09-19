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
 * The board's line, and only the board's: `FindingCard` is the single caller.
 * It was shared with the finding panel, which drew this markup character for
 * character — and the panel has since stopped using it, because the two places
 * are asking different questions. A card is one row in a list of twenty, where
 * the figures and their glosses are right to keep behind a `ScaleChip` hover;
 * a panel is the one finding the reader asked for, where making them hover to
 * learn why it is a P0 is making them work for the answer they opened it for.
 * So `FindingDetailPanel` spells the same numbers out as a `Risk` section,
 * unconditionally and as text, and this stays what it always was on the board.
 *
 * Still a component rather than a block inlined in the card. It is a clean
 * unit — the scales, in order, with the status pushed to the end — and the
 * next surface that wants a finding's numbers in a row should find one here
 * rather than write a third.
 *
 * Not merged with the criterion/surface line above it on the card, which looks
 * like the same shape and is not: the card's criterion chip is optional and
 * truncates.
 *
 * `className` is the caller's line-level spacing and lands last, so a caller
 * can override the wrapper without editing this file.
 *
 * The priority is not in here. It is the square on the rail — `FindingMark`,
 * the same component the finding panel's title block leads with.
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
