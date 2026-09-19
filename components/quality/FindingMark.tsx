"use client";

import type { ReactNode } from "react";
import { CheckIcon, ShieldIcon, XIcon } from "lucide-react";
import type { FindingStatus } from "@arkaik/schema";
import type { FindingRow } from "@/lib/utils/quality";
import { ScaleChip } from "@/components/quality/ScaleChip";
import {
  FINDING_STATUS_GLOSS,
  FINDING_STATUS_LABEL,
  FINDING_STATUS_TILE,
  PRIORITY_GLOSS,
  PRIORITY_TERM,
  PRIORITY_TILE,
} from "@/components/quality/quality-styles";
import { iconChipVariants } from "@/components/layout/IconChip";
import { cn } from "@/lib/utils";

/** Every status other than `open` — the ones that get a verdict mark. */
type DecidedStatus = Exclude<FindingStatus, "open">;

/**
 * The rail's square, shared by both marks so they sit on the same axis.
 *
 * This used to be a verbatim copy of the Changelog's tile, declared here
 * because the constant lived in a changelog component. Both are the one chip
 * now. `bare` because each mark brings its own lane or verdict colour.
 */
const MARK_CLASS = iconChipVariants({ variant: "bare" });

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

/**
 * One finding, as a square you can scan.
 *
 * On an open finding it is the priority and nothing else: the digit alone,
 * because `P` repeated down a column of squares is a letter nobody reads twice.
 * The chip's own gloss says what the lane means, which is what the section
 * heading used to say.
 *
 * On a decided one the priority gives way to the verdict — a green tick reads
 * down the rail as "answered" at the same glance the red squares read as
 * "owed", and the lane it was filed in moves into the gloss.
 *
 * A component rather than two blocks inlined in the board, because the finding
 * panel's header wears the identical mark: it is how the panel says it is the
 * thing the reader clicked. Two copies would part company the first time a
 * status tile changed.
 */
export function FindingMark({ row, className }: { row: FindingRow; className?: string }) {
  if (row.open) {
    return (
      <ScaleChip
        term={PRIORITY_TERM[row.priority]}
        hint={PRIORITY_GLOSS[row.priority]}
        className={cn(
          MARK_CLASS,
          "text-xs font-semibold tabular-nums",
          PRIORITY_TILE[row.priority],
          className,
        )}
      >
        {row.priority.slice(1)}
      </ScaleChip>
    );
  }

  // Safe, and load-bearing now that this is exported rather than inlined in
  // the board: `buildFindingRows` derives both fields from the one stored
  // status — `open` is `isOpenFinding`, which is `(status ?? "open") ===
  // "open"` — so `!row.open` means the status is not `open`. A hand-built row
  // that breaks that renders an undefined term, no tile and no glyph, silently.
  const status = row.status as DecidedStatus;

  return (
    <ScaleChip
      term={`${FINDING_STATUS_LABEL[status]} — filed ${row.priority}`}
      hint={FINDING_STATUS_GLOSS[status]}
      className={cn(MARK_CLASS, FINDING_STATUS_TILE[status], className)}
    >
      {STATUS_ICON[status]}
    </ScaleChip>
  );
}
