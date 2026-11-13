"use client";

import type { FindingSeverity } from "@arkaik/schema";
import { ScaleChip } from "@/components/quality/ScaleChip";
import { SEVERITY_HINT, SEVERITY_LABEL } from "@/components/quality/quality-styles";

interface RiskBadgeProps {
  impact: number;
  likelihood: number;
  /** `impact × likelihood`, as the projection computed it — never recomputed here. */
  risk: number;
  /** The band the score fell into. `severityOf` decided it; this only paints it. */
  severity: FindingSeverity;
}

/**
 * The risk score and the band it bought, as one squircle leading the finding:
 * the number large, the band's word under it, both in the severity's tone.
 *
 * It was a two-halved pill at the end of the card's meta line, and that put
 * the one figure the board is sorted by in the last place a reader looks. As
 * the card's leading mark it is what the eye meets first down a lane, the way
 * the node panel leads a relation tile with its species — and it is still one
 * fact, not two: the band *is* the score, read through the pack's thresholds.
 *
 * Hover or focus opens the bill — impact × likelihood = risk, and the band —
 * so "why is this a 12" is answered where the 12 is. The tone is the
 * `data-kq-severity` attribute `app/m3/quality.css` maps to a hue, from
 * `row.severity`, never from `row.risk`: `severityOf` is the pack's answer,
 * and the day a pack moves a bucket the colour must follow the band, not
 * re-derive it.
 */
export function RiskBadge({ impact, likelihood, risk, severity }: RiskBadgeProps) {
  return (
    <span className="kq-riskwrap" data-kq-severity={severity}>
      <ScaleChip
        term={`${SEVERITY_LABEL[severity]} — risk ${risk}`}
        hint={SEVERITY_HINT[severity]}
        className="kq-riskbadge"
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
        <span className="kq-riskbadge-n">{risk}</span>
        <span className="kq-riskbadge-w">{SEVERITY_LABEL[severity]}</span>
      </ScaleChip>
    </span>
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
