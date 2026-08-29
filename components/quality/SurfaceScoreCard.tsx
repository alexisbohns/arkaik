"use client";

import type { QualityGrade, QualityMatrixCell } from "@arkaik/schema";
import { FindingDots, CELL_SEVERITIES } from "@/components/quality/FindingDots";
import { GRADE_TINT, SEVERITY_LABEL } from "@/components/quality/quality-styles";
import { cn } from "@/lib/utils";

interface SurfaceScoreCardProps {
  /** The surface's title, named under the score. */
  title: string;
  /** `null` when nothing was scored here — the card renders N/A and is inert. */
  score: number | null;
  grade: QualityGrade | null;
  /** An open Critical or High pushed the grade below its score's band. */
  capped?: boolean;
  /** Open findings by severity, as dots. Omitted on the roll-up cards. */
  findings?: QualityMatrixCell["findings"];
  /** A line under the title — the roll-up's open-finding count. */
  meta?: string;
  /** The card's accessible name; see {@link cellLabel}. */
  label: string;
  active?: boolean;
  onClick?: () => void;
}

/**
 * What a cell says, spelled out for the card's accessible name and its `title`.
 *
 * It is also where the dot cap is made harmless: the dots stop at four, this
 * does not, so a cell with nine open Criticals still reports nine to anyone who
 * hovers or listens.
 */
export function cellLabel(domainName: string, surfaceTitle: string, cell: QualityMatrixCell): string {
  const findings = CELL_SEVERITIES.filter((severity) => cell.findings[severity] > 0)
    .map((severity) => `${cell.findings[severity]} ${SEVERITY_LABEL[severity].toLowerCase()}`)
    .join(", ");

  return [
    `${domainName} on ${surfaceTitle}`,
    `${cell.score} out of 100, grade ${cell.grade}${cell.capped ? ", capped by an open finding" : ""}`,
    `${cell.criteria} criteria scored`,
    findings === "" ? "no open findings" : `open findings: ${findings}`,
  ].join(" — ");
}

/**
 * One surface's standing in one domain, as a card in a gallery.
 *
 * This is the old matrix table's cell, freed of the table. The table was the
 * problem it solves: eleven domains across five surfaces is a grid nobody can
 * read on a laptop, worse once a panel opens, and a wide scrollport shared by
 * every row means scrolling to reach `api` in one domain scrolls it out of
 * reach in the next. A gallery per domain scrolls independently, and the card
 * has room to name the surface it is about instead of relying on a header row
 * that scrolled away.
 *
 * A fixed width, not a flexible one: the cards are meant to be *compared*, and
 * a card that widens because its surface has a long title says louder.
 */
export function SurfaceScoreCard({
  title,
  score,
  grade,
  capped = false,
  findings,
  meta,
  label,
  active = false,
  onClick,
}: SurfaceScoreCardProps) {
  const body = (
    <>
      {score === null ? (
        <span className="text-sm text-muted-foreground">N/A</span>
      ) : (
        <>
          <span className="text-2xl font-semibold leading-none tabular-nums">{score}</span>
          <span className="text-[11px] font-medium leading-none">
            {grade}
            {capped && "*"}
          </span>
        </>
      )}
      {findings && <FindingDots findings={findings} />}
      <span className="w-full truncate text-center text-xs font-medium" title={title}>
        {title}
      </span>
      {meta && <span className="text-[10px] text-muted-foreground">{meta}</span>}
    </>
  );

  const shape = cn(
    "flex w-28 shrink-0 snap-start flex-col items-center justify-center gap-1.5 rounded-lg px-2 py-3",
    score === null ? "bg-muted/40 text-muted-foreground" : GRADE_TINT[grade ?? "C"],
  );

  // Not a button when there is nothing to open: an unscored cell has no
  // criteria to show and no findings to narrow to, and a roll-up card is a
  // summary of cards that are themselves the buttons.
  if (!onClick) {
    return (
      <div className={shape} aria-label={label} title={label} role="img">
        {body}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      title={label}
      className={cn(
        shape,
        "transition-all hover:ring-1 hover:ring-inset hover:ring-foreground/30",
        active && "ring-2 ring-inset ring-foreground/70",
      )}
    >
      {body}
    </button>
  );
}
