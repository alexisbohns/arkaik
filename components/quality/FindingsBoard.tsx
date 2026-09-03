"use client";

import type { ReactNode } from "react";
import { CheckIcon, ShieldIcon, XIcon } from "lucide-react";
import type { FindingStatus } from "@arkaik/schema";
import type { Node } from "@/lib/data/types";
import type { FindingRow } from "@/lib/utils/quality";
import { EmptyState } from "@/components/ui/empty-state";
import { FindingCard } from "@/components/quality/FindingCard";
import { ScaleChip } from "@/components/quality/ScaleChip";
import {
  FINDING_STATUS_GLOSS,
  FINDING_STATUS_LABEL,
  FINDING_STATUS_TILE,
  PRIORITY_GLOSS,
  PRIORITY_TERM,
  PRIORITY_TILE,
} from "@/components/quality/quality-styles";
import { cn } from "@/lib/utils";

/** Every status other than `open` — the ones that get a verdict mark. */
type DecidedStatus = Exclude<FindingStatus, "open">;

/** The rail's 24px square, shared by both marks so they sit on the same axis. */
const MARK_CLASS = "inline-flex size-6 shrink-0 items-center justify-center rounded-md";

/**
 * The verdict, as a glyph. A tick for the fix, a cross for the defect that was
 * not one, a shield for the risk somebody chose to carry — three different
 * answers, and three different marks, because "not open" is not one state.
 */
const STATUS_ICON: Record<DecidedStatus, ReactNode> = {
  resolved: <CheckIcon className="size-3.5" aria-hidden="true" />,
  refuted: <XIcon className="size-3.5" aria-hidden="true" />,
  "accepted-risk": <ShieldIcon className="size-3.5" aria-hidden="true" />,
};

interface FindingsBoardProps {
  /** Every finding to show, already filtered and sorted — worst first. */
  rows: FindingRow[];
  nodesById: ReadonlyMap<string, Node>;
  /** `surface id -> title`, built once on the page and handed to every entry. */
  surfaceTitles: ReadonlyMap<string, string>;
  onOpenNode: (nodeId: string) => void;
  onOpenCriterion: (criterionId: string, surface: string) => void;
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
 */
export function FindingsBoard({
  rows,
  nodesById,
  surfaceTitles,
  onOpenNode,
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
              {/* On an open finding the mark is the priority and nothing else:
                  the digit alone, because `P` repeated down a column of squares
                  is a letter nobody reads twice. The chip's own gloss says what
                  the lane means, which is what the section heading used to say.

                  On a decided one the priority gives way to the verdict — a
                  green tick reads down the rail as "answered" at the same
                  glance the red squares read as "owed", and the lane it was in
                  moves into the gloss. */}
              {row.open ? (
                <ScaleChip
                  term={PRIORITY_TERM[row.priority]}
                  hint={PRIORITY_GLOSS[row.priority]}
                  className={cn(MARK_CLASS, "text-xs font-semibold tabular-nums", PRIORITY_TILE[row.priority])}
                >
                  {row.priority.slice(1)}
                </ScaleChip>
              ) : (
                <ScaleChip
                  term={`${FINDING_STATUS_LABEL[row.status]} — filed ${row.priority}`}
                  hint={FINDING_STATUS_GLOSS[row.status as DecidedStatus]}
                  className={cn(MARK_CLASS, FINDING_STATUS_TILE[row.status as DecidedStatus])}
                >
                  {STATUS_ICON[row.status as DecidedStatus]}
                </ScaleChip>
              )}
              {!last && <span className="w-px flex-1 bg-border" aria-hidden="true" />}
            </div>

            <div className={cn("min-w-0", !last && "pb-4")}>
              <FindingCard
                row={row}
                nodesById={nodesById}
                surfaceTitles={surfaceTitles}
                onOpenNode={onOpenNode}
                onOpenCriterion={onOpenCriterion}
              />
            </div>
          </li>
        );
      })}
    </ol>
  );
}
