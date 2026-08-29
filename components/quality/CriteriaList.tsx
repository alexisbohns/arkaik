"use client";

import { EntityId } from "@/components/graph/nodes/EntityBadges";
import { LevelMeter } from "@/components/quality/LevelMeter";
import type { CriterionRow } from "@/lib/utils/quality";

interface CriteriaListProps {
  criteria: CriterionRow[];
  /** The surface these were scored on — carried into the criterion panel. */
  surface: string;
  onOpenCriterion: (criterionId: string, surface: string) => void;
}

/**
 * The criteria behind one matrix cell.
 *
 * It answers the question a cell asks — *why* is this a C — and that answer is
 * a list, not a document. The document is one row further in, behind
 * {@link CriteriaListProps.onOpenCriterion}.
 *
 * Lifted out of the old `CriteriaStrip`, which lived between the matrix and the
 * board on one crowded page. The list survived the split; the strip's heading
 * and close button did not, because the panel that now holds it has both.
 */
export function CriteriaList({ criteria, surface, onOpenCriterion }: CriteriaListProps) {
  if (criteria.length === 0) {
    // Reachable only from a hand-typed `?cell=`, since an unscored cell renders
    // N/A and is not a button. Said in words anyway: an empty list under a
    // heading reads as a list that failed to load.
    return <p className="px-4 py-2.5 text-sm text-muted-foreground">Nothing was scored in this cell.</p>;
  }

  return (
    <ul>
      {criteria.map((row) => (
        <li key={row.criterionId}>
          <button
            type="button"
            onClick={() => onOpenCriterion(row.criterionId, surface)}
            className="flex w-full items-center gap-3 border-b px-4 py-2 text-left last:border-b-0 hover:bg-muted/50"
          >
            <EntityId id={row.criterionId} />
            <LevelMeter level={row.level} />
            <span className="min-w-0 flex-1 truncate text-sm">{row.name}</span>
            {row.openFindings > 0 && (
              <span className="shrink-0 text-xs text-muted-foreground">{row.openFindings} open</span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}
