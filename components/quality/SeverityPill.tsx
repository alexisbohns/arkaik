"use client";

import type { FindingSeverity } from "@arkaik/schema";
import { ScaleChip } from "@/components/quality/ScaleChip";
import {
  SEVERITY_CHIP,
  SEVERITY_HINT,
  SEVERITY_LABEL,
  SEVERITY_SCORE,
} from "@/components/quality/quality-styles";
import { cn } from "@/lib/utils";

interface SeverityPillProps {
  impact: number;
  likelihood: number;
  /** `impact × likelihood`, as the projection computed it — never recomputed here. */
  risk: number;
  /** The band the score fell into. `severityOf` decided it; this only paints it. */
  severity: FindingSeverity;
}

/**
 * The risk score and the band it bought, as one pill: `12 | High`.
 *
 * They were two chips with two glosses, and that was one fact wearing two
 * badges — the band *is* the score, read through the pack's thresholds, and a
 * reader who hovered one of them got half the story. Split at a hairline inside
 * a single pill they read as what they are: the number, and what the number
 * means. One popover then has somewhere to put the whole bill.
 */
export function SeverityPill({ impact, likelihood, risk, severity }: SeverityPillProps) {
  return (
    <ScaleChip
      term={`${SEVERITY_LABEL[severity]} — risk ${risk}`}
      hint={SEVERITY_HINT[severity]}
      className={cn(
        // `overflow-hidden` is what lets the score half's tint reach the pill's
        // rounded corners instead of squaring them off.
        "inline-flex items-stretch overflow-hidden rounded border font-medium",
        SEVERITY_CHIP[severity],
      )}
      body={
        <dl className="mt-2 flex flex-col gap-1 text-xs">
          <Line label="Impact" value={String(impact)} />
          <Line label="Likelihood" value={`× ${likelihood}`} />
          <div className="my-0.5 border-t" />
          <Line label="Risk" value={String(risk)} strong />
          <Line label="Severity" value={SEVERITY_LABEL[severity]} strong />
        </dl>
      }
    >
      <span className={cn("px-1 tabular-nums", SEVERITY_SCORE[severity])}>{risk}</span>
      <span className="px-1">{SEVERITY_LABEL[severity]}</span>
    </ScaleChip>
  );
}

/** One line of the bill: label left, figure right, the figures aligned. */
function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className={strong ? "font-medium" : "text-muted-foreground"}>{label}</dt>
      <dd className={`tabular-nums ${strong ? "font-semibold" : "text-muted-foreground"}`}>{value}</dd>
    </div>
  );
}
