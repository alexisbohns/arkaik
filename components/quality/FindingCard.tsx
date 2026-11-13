"use client";

import { ShieldIcon } from "lucide-react";
import { buildFindingModel, verdictRepeatsStatus, type FindingRow } from "@/lib/utils/quality";
import { cn } from "@/lib/utils";
import { RiskBadge } from "@/components/quality/RiskBadge";
import { ScaleChip } from "@/components/quality/ScaleChip";
import {
  COST_HINT,
  COST_TERM,
  FINDING_STATUS_LABEL,
  VERDICT_LABEL,
} from "@/components/quality/quality-styles";

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
  onOpenFinding: (findingId: string) => void;
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
 * anything, in the order they ask it: how bad (the risk badge, leading — the
 * figure the board is sorted by, see `RiskBadge`), what (the title), where (the
 * criterion and the surface), what it costs and what the review said, and —
 * for an accepted risk — the decision itself.
 *
 * No card chrome of its own: the board's deck tile is the card, and a tile
 * inside a tile is the second lid the Changelog dropped for the same reason.
 * The rules — the accepted-risk note, the surface's name, whether the status is
 * said — are `buildFindingModel`'s (lib/utils/quality.ts), the same the finding
 * panel renders from.
 */
export function FindingCard({ row, surfaceTitles, onOpenFinding, onOpenCriterion }: FindingCardProps) {
  const model = buildFindingModel(row, { surfaceTitles });
  const verdict = row.verification?.verdict;

  return (
    <article
      className="kq-scope kq-fcard"
      // Resolved and refuted findings are history, not work. Dimmed rather
      // than dropped, because the board is also where somebody checks what
      // was already answered — and the status filter is how you hide them.
      data-decided={!row.open || undefined}
    >
      <RiskBadge impact={row.impact} likelihood={row.likelihood} risk={row.risk} severity={row.severity} />
      <div className="kq-fcard-main">
        {/* The name, and the control that opens the finding. */}
        <button type="button" className="kq-fcard-title" onClick={() => onOpenFinding(row.id)}>
          {row.title}
        </button>

        {/* The reference, on its own line: which criterion this finding answers
            to, and on which surface. It is what somebody quotes when they file
            it or argue it. Outside the title button, because the criterion in
            it is a control of its own and a button inside a button is not
            markup a browser will honour. */}
        <span className="kq-fref">
          {onOpenCriterion && (
            <>
              <button
                type="button"
                className="kq-fref-id"
                onClick={() => onOpenCriterion(row.criterionId, row.surface)}
                title={`Open ${row.criterionName}`}
              >
                {row.criterionId}
              </button>
              {model.hasCriterionName && <span className="kq-fref-name">{row.criterionName}</span>}
            </>
          )}
          {/* A finding that belongs to no single surface is called that, in a
              tonal chip, rather than left to read as a surface id nobody
              titled — `cross-surface` is a findings-only lens no profile
              declares, and it is the row a reader is most likely to mistake
              for the surface they are scoped to. Everywhere else: the
              profile's title, the matrix's own word; the id is on the hover. */}
          {model.crossSurface ? (
            <span className="kq-fref-cross">{model.surfaceTitle}</span>
          ) : (
            <span className="kq-fref-surface" title={row.surface}>
              {model.surfaceTitle}
            </span>
          )}
        </span>

        <span className="kq-fscales">
          <ScaleChip term={COST_TERM[row.cost]} hint={COST_HINT[row.cost]} className="kq-cost">
            <span className="kq-cost-word">cost</span> {row.cost}
          </ScaleChip>
          {/* Not when it only repeats the status word: a refuted finding's
              REFUTED verdict is the same decision, said twice. */}
          {verdict && !verdictRepeatsStatus(row) && <span className="kq-verdict">{VERDICT_LABEL[verdict]}</span>}
          {/* The word for a decided finding, pushed to the end — tinted for
              `resolved` alone, the one status that means the defect is gone.
              Not for an accepted risk: the block below states it, as the
              decision it is. */}
          {model.showStatus && (
            <span className="kq-status" data-resolved={row.status === "resolved" || undefined}>
              {FINDING_STATUS_LABEL[row.status]}
            </span>
          )}
        </span>

        {/*
          An accepted risk is a decision, so it reads as one, in the amber its
          status owns. It stays on the card rather than moving to the panel
          with everything else: somebody already weighed this and said "not
          now", and a reader scanning the board must not have to open a panel
          to learn it. A decision recorded with no rationale still says so —
          the gap shown, never the status hidden.
        */}
        {model.acceptedNote !== undefined && (
          <div className="kq-accepted">
            <span className="kq-accepted-badge">
              <ShieldIcon className="size-3.5" aria-hidden="true" />
              {FINDING_STATUS_LABEL["accepted-risk"]}
            </span>
            <p className={cn(model.acceptedNote.trim() === "" && "italic")}>
              {model.acceptedNote.trim() === "" ? "No rationale was recorded with this decision." : model.acceptedNote}
            </p>
          </div>
        )}
      </div>
    </article>
  );
}
