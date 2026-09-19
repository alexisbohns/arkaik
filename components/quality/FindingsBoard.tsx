"use client";

import type { FindingRow } from "@/lib/utils/quality";
import { EmptyState } from "@/components/ui/empty-state";
import { FindingCard } from "@/components/quality/FindingCard";
import { FindingMark } from "@/components/quality/FindingMark";
import { cn } from "@/lib/utils";

interface FindingsBoardProps {
  /** Every finding to show, already filtered and sorted — worst first. */
  rows: FindingRow[];
  /** `surface id -> title`, built once on the page and handed to every entry. */
  surfaceTitles: ReadonlyMap<string, string>;
  /**
   * Opens one finding's own panel. Required: a board whose rows do nothing is
   * a list of headlines, which is what this board was before findings had a
   * panel — and the disclosure it replaced could not be optional either.
   */
  onOpenFinding: (findingId: string) => void;
  /** Passed straight through; omitted inside the criterion panel — see `FindingCard`. */
  onOpenCriterion?: (criterionId: string, surface: string) => void;
}

/**
 * The findings, as one timeline — the Changelog's rail, applied to work that
 * has not been done rather than work that shipped.
 *
 * There are no priority sections any more. Four pinned headings cut a list that
 * is already sorted worst-first into four lists that each had to re-announce
 * where you were, and three of them were usually the same answer: a lane
 * heading tells you nothing the marks down the rail do not. The rail carries
 * the priority instead — one square per finding, the lane's number in the
 * lane's colour — so a run of P0s reads as a run of red squares and the reader
 * scans the rail rather than the headings.
 *
 * The order is whatever `filterFindings` sorted, which is the filter bar's
 * Sort. That was true inside a lane before; now it is true of the whole page.
 *
 * A row opens the finding's own panel. It used to expand in place, which is
 * the gesture this rail was built to replace everywhere else on the page —
 * which is also why the board no longer needs the graph: the linked-node chips
 * went to the panel with everything else behind the disclosure.
 */
export function FindingsBoard({
  rows,
  surfaceTitles,
  onOpenFinding,
  onOpenCriterion,
}: FindingsBoardProps) {
  if (rows.length === 0) {
    return (
      <div className="p-4">
        <EmptyState message="No findings match these filters." />
      </div>
    );
  }

  return (
    <ol className="flex flex-col p-4">
      {rows.map((row, index) => {
        const last = index === rows.length - 1;
        return (
          <li key={row.id} className="grid grid-cols-[auto_1fr] gap-x-3">
            {/* The rail, built the way the Changelog builds it: the connector
                is `flex-1` in a stretched grid cell, so it runs the full height
                of an entry however far it expands, and is absent on the last
                one. The breathing room below belongs to the content column, not
                to the `<li>` — padding on the row would end the connector above
                the gap and leave the squares unlinked. */}
            <div className="flex flex-col items-center">
              <FindingMark row={row} />
              {!last && <span className="w-px flex-1 bg-border" aria-hidden="true" />}
            </div>

            <div className={cn("min-w-0", !last && "pb-4")}>
              <FindingCard
                row={row}
                surfaceTitles={surfaceTitles}
                onOpenFinding={onOpenFinding}
                onOpenCriterion={onOpenCriterion}
              />
            </div>
          </li>
        );
      })}
    </ol>
  );
}
