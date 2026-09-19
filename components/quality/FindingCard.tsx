"use client";

import { CROSS_SURFACE_ID } from "@arkaik/schema";
import type { FindingRow } from "@/lib/utils/quality";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { AcceptedRiskCallout } from "@/components/quality/AcceptedRiskCallout";
import { FindingScales } from "@/components/quality/FindingScales";

interface FindingCardProps {
  row: FindingRow;
  /**
   * `surface id -> title`, built once on the page. The card names the surface
   * the way the matrix's column header and the Surface menu name it; the id
   * itself stays one hover away, and is the fallback for a surface the profile
   * never titled.
   */
  surfaceTitles: ReadonlyMap<string, string>;
  /** Opens the finding's own panel. The card's whole reason to be a control. */
  onOpenFinding: (row: FindingRow) => void;
  /**
   * Opens the criterion this finding answers to — and, by its absence, says the
   * reader is already inside it.
   *
   * The criterion chip is a control, not a label: in the criterion panel it
   * would re-open the panel it is drawn in, under a heading that already names
   * the same criterion. So an omitted handler drops the chip and the name with
   * it, rather than leaving a dead button behind.
   */
  onOpenCriterion?: (criterionId: string, surface: string) => void;
}

/**
 * One finding, as a line you can triage from.
 *
 * It used to expand in place to everything the audit recorded, and that was the
 * one entity in this app read without a panel. Several screens of detail,
 * evidence and identifiers pushed the rest of the board off the bottom exactly
 * when a reader was working down it. All of that now lives in
 * `FindingDetailPanel`, and the title is the control that opens it.
 *
 * What stays on the card is what a reader triages from without opening
 * anything: the title, the criterion and surface it answers to, and the scales.
 *
 * The severity treatment comes from `row.severity`, never from `row.risk`. They
 * agree today, and the day a pack moves a bucket they would stop agreeing —
 * with the colour saying one thing and the lane the board sorted it into saying
 * another. `severityOf` is the pack's answer; this only paints it.
 *
 * No card chrome. The entry sits on the timeline's rail, and a bordered box per
 * entry inside a rail that is already the grouping is the second lid the
 * Changelog dropped for the same reason.
 */
export function FindingCard({ row, surfaceTitles, onOpenFinding, onOpenCriterion }: FindingCardProps) {
  const acceptedRisk = row.status === "accepted-risk";
  // What the accepted-risk callout shows: a finding carries no dedicated note
  // field, so the rationale is the refutation pass's note when it wrote one and
  // the filed detail otherwise. `||` rather than `??`, because `""` is not a
  // note somebody wrote — a verification carrying an empty one would otherwise
  // draw the bordered callout around an empty paragraph.
  const acceptedNote = acceptedRisk ? row.verification?.note || row.detail : undefined;

  return (
    <article
      className={cn(
        "flex min-w-0 flex-col gap-1",
        // Resolved and refuted findings are history, not work. Dimmed rather
        // than dropped, because the board is also where somebody checks what
        // was already answered — and the status filter is how you hide them.
        !row.open && "opacity-70",
      )}
    >
      {/* The name first, on the line the rail's square centres against, and the
          control that opens the finding. */}
      <button
        type="button"
        onClick={() => onOpenFinding(row)}
        className="w-full text-left text-sm font-medium leading-relaxed hover:underline focus-visible:underline hover:underline-offset-4 focus-visible:underline-offset-4"
      >
        {row.title}
      </button>

      {/* The reference, on its own line: which criterion this finding answers
          to, and on which surface. It is what somebody quotes when they file it
          or argue it, so it is not left to fight for space in a meta line with
          five numbers in it.

          Outside the title button, because the criterion in it is a control of
          its own and a button inside a button is not markup a browser will
          honour. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        {onOpenCriterion && (
          <>
            <button
              type="button"
              onClick={() => onOpenCriterion(row.criterionId, row.surface)}
              className="rounded bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] transition-colors hover:bg-muted hover:text-foreground"
              title={`Open ${row.criterionName}`}
            >
              {row.criterionId}
            </button>
            {row.criterionName !== row.criterionId && (
              <span className="max-w-[24rem] truncate">{row.criterionName}</span>
            )}
          </>
        )}
        {/* A finding that belongs to no single surface is called that, in a
            badge, rather than left to read as a surface id nobody titled —
            `cross-surface` is a findings-only lens and no profile declares it,
            so the fallback below would print the raw slug. It is also the row a
            reader is most likely to mistake for the surface they are scoped to.

            Everywhere else: the profile's title, the same word the matrix
            column header and the Surface menu use. The id is on the hover. */}
        {row.surface === CROSS_SURFACE_ID ? (
          <Badge variant="outline" className="font-normal">
            Cross-surface
          </Badge>
        ) : (
          <span title={row.surface}>
            {onOpenCriterion && "· "}
            {surfaceTitles.get(row.surface) ?? row.surface}
          </span>
        )}
      </div>

      {/* The scales, on the third line: severity and cost as chips that gloss
          themselves, with the numbers severity is read from between them.

          The priority is not repeated here: it is the square on the rail. */}
      <FindingScales row={row} />

      {/*
        An accepted risk is a decision, so it reads as one — the decision log's
        bordered row with its status stated. It stays on the card rather than
        moving to the panel with everything else: the whole point of the status
        is that somebody already weighed this and said "not now", and a reader
        scanning the board must not have to open a panel to learn it.
      */}
      <AcceptedRiskCallout note={acceptedNote} className="mt-1" />
    </article>
  );
}
