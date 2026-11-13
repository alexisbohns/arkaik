"use client";

import type { ReactNode } from "react";
import { formatDelta, type QualityGrade, type QualityMatrixCell, type ScoreDelta } from "@arkaik/schema";
import { FindingDots, CELL_SEVERITIES } from "@/components/quality/FindingDots";
import { GradeTrack } from "@/components/quality/GradeTrack";
import { SEVERITY_LABEL } from "@/components/quality/quality-styles";
import { cn } from "@/lib/utils";
import { describeDelta } from "@/lib/utils/quality";

interface SurfaceScoreCardProps {
  /** The surface's title, named at the top of the card. */
  title: string;
  /** `null` when nothing was scored here — the card says so and is inert. */
  score: number | null;
  grade: QualityGrade | null;
  /** An open Critical or High pushed the grade below its score's band. */
  capped?: boolean;
  /** Open findings by severity, as dots. Omitted on the roll-up cards. */
  findings?: QualityMatrixCell["findings"];
  /**
   * The score against the last recorded audit. Draws `▲ +6`, `▼ −3` or `=`
   * beside the title; nothing at all when there is no earlier reading, so a
   * first audit does not render as "unchanged".
   */
  delta?: ScoreDelta;
  /** A line under the track — the roll-up's open-finding count. */
  meta?: string;
  /**
   * A footnote under the meta — the roll-up cards' burndown sparkline. Last on
   * the card: it is the history behind the numbers above it, read after them.
   */
  footer?: ReactNode;
  /** The card's accessible name — every number on it, in words. */
  label: string;
}

/**
 * What a cell says, spelled out for a tile's accessible name and its `title`.
 *
 * It is also where the dot cap is made harmless: the dots stop at four, this
 * does not, so a cell with nine open Criticals still reports nine to anyone who
 * hovers or listens.
 */
export function cellLabel(
  domainName: string,
  surfaceTitle: string,
  cell: QualityMatrixCell,
  delta?: ScoreDelta,
): string {
  const findings = CELL_SEVERITIES.filter((severity) => cell.findings[severity] > 0)
    .map((severity) => `${cell.findings[severity]} ${SEVERITY_LABEL[severity].toLowerCase()}`)
    .join(", ");
  // The arrow spelled out, with the score it was read against — the glyph
  // alone says "up", the label says "up 6 from 66 at the 2026-08 audit".
  const movement = describeDelta(delta);

  return [
    `${domainName} on ${surfaceTitle}`,
    `${cell.score} out of 100, grade ${cell.grade}${cell.capped ? ", capped by an open finding" : ""}` +
      (movement ? `, ${movement}` : ""),
    `${cell.criteria} criteria scored`,
    findings === "" ? "no open findings" : `open findings: ${findings}`,
  ].join(" — ");
}

/**
 * Which way a score moved since the last recorded audit, and by how much, as
 * a small tonal chip. A footnote to the number, not a second number — and
 * tinted by direction with the positive and negative tones, never the severity
 * palette, since a delta is not a finding: a cell that dropped three points
 * has not raised a Critical. Renders nothing when there is no delta to draw: a
 * first audit is a first audit, and a reading across a framework major bump is
 * not comparable.
 *
 * `aria-hidden`: every label it sits under spells the movement out, and a
 * glyph read aloud as "black up-pointing triangle" helps nobody.
 */
export function DeltaArrow({ delta, className }: { delta?: ScoreDelta; className?: string }) {
  const amount = delta?.delta ?? null;
  const text = formatDelta(amount);
  if (text === null || amount === null) return null;
  return (
    <span className={cn("kq-delta", className)} data-dir={amount > 0 ? "up" : amount < 0 ? "down" : "flat"} aria-hidden="true">
      {text}
    </span>
  );
}

/**
 * One surface's standing, as a card: the Overall row's roll-up, and the
 * Overview's Quality section, which renders this same component from the same
 * gauges so the two cannot disagree.
 *
 * Read top-down: the title leads (the first question is *which surface is
 * this*), with its movement beside it; then the score as the card's figure;
 * then the grade as the lifecycle track's connected A–E steps, the one in
 * force lit; then what is open. A raised tile with no border — the grade
 * lives in the track, where it means something, not smeared across the card,
 * so a row of five is still a row of names and numbers rather than a wall of
 * colour.
 *
 * The matrix's own cells are not this card: the heatmap and the worst-first
 * bands draw tiles of their own, because there a tile is the structure, not a
 * card placed in it.
 *
 * A fixed width in a gallery (`app/m3/quality.css`), not a flexible one: the
 * cards are meant to be *compared*, and a card that widens because its surface
 * has a long title says louder. A grid that sizes them evenly sets it back to
 * `auto`.
 */
export function SurfaceScoreCard({
  title,
  score,
  grade,
  capped = false,
  findings,
  delta,
  meta,
  footer,
  label,
}: SurfaceScoreCardProps) {
  const scored = score !== null;
  const body = scored ? (
    <>
      <span className="kq-card-row kq-card-top">
        {/* Foreground-neutral, never the grade's colour: the title is the
            card's name, and a name tinted by its own diagnosis reads as part
            of the verdict. */}
        <span className="kq-card-title" title={title}>
          {title}
        </span>
        <DeltaArrow delta={delta} />
      </span>
      <span className="kq-card-score">{score}</span>
      <GradeTrack grade={grade ?? "C"} capped={capped} size="sm" />
      <span className="kq-card-row kq-card-foot">
        {findings && <FindingDots findings={findings} />}
        {meta && <span className="kq-card-meta">{meta}</span>}
      </span>
      {footer}
    </>
  ) : (
    <>
      <span className="kq-card-title" title={title}>
        {title}
      </span>
      <span className="kq-card-gap">Not scored</span>
      {meta && <span className="kq-card-meta">{meta}</span>}
    </>
  );

  // Never a button: a roll-up card is a summary of cells that are themselves
  // the buttons, and the Overview's card links to this page as a whole.
  // `role="img"` with the label, so the card is read as one sentence rather
  // than as a score, five letters and a count.
  return (
    <div
      className="kq-scope kq-card"
      data-kq-grade={scored ? (grade ?? "C") : undefined}
      data-unscored={scored ? undefined : ""}
      role="img"
      aria-label={label}
      title={label}
    >
      {body}
    </div>
  );
}
