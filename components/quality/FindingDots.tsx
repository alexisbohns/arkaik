import type { QualityMatrixCell } from "@arkaik/schema";
import { SEVERITY_DOT } from "@/components/quality/quality-styles";
import { cn } from "@/lib/utils";

/**
 * The severities a cell tallies. `QualityMatrixCell.findings` has no `info`
 * key — the pack's lowest bucket is a note, not a defect a cell should carry —
 * so this is read off the cell's own shape rather than off `FINDING_SEVERITIES`,
 * which would produce a fifth dot that is always absent.
 */
export const CELL_SEVERITIES = ["critical", "high", "medium", "low"] as const;

/** At most this many dots per severity; the true count stays in the label. */
export const MAX_DOTS = 4;

/**
 * One dot per open finding, worst severity first, {@link MAX_DOTS} at most
 * each.
 *
 * `aria-hidden`, and it must stay that way: the dots are a glance, and the
 * counts they cap are spelled out in full in the card's accessible name.
 */
export function FindingDots({ findings }: { findings: QualityMatrixCell["findings"] }) {
  const shown = CELL_SEVERITIES.flatMap((severity) =>
    Array.from({ length: Math.min(findings[severity], MAX_DOTS) }, (_, index) => ({
      key: `${severity}-${index}`,
      severity,
    })),
  );
  if (shown.length === 0) return null;

  return (
    <span className="flex flex-wrap items-center justify-center gap-0.5" aria-hidden="true">
      {shown.map((dot) => (
        <span key={dot.key} className={cn("size-1.5 rounded-full", SEVERITY_DOT[dot.severity])} />
      ))}
    </span>
  );
}
