"use client";

import type { MaturityLevel } from "@arkaik/schema";
import type { CriterionRow } from "@/lib/utils/quality";

interface CriteriaListProps {
  criteria: CriterionRow[];
  /** The surface these were scored on — carried into the criterion panel. */
  surface: string;
  onOpenCriterion: (criterionId: string, surface: string) => void;
}

/** The level as four pips under its number — the number drawn twice, so `aria-hidden`. */
function LevelPips({ level }: { level: MaturityLevel }) {
  return (
    <span className="kq-pips" aria-hidden="true">
      {[1, 2, 3, 4].map((step) => (
        <span key={step} data-on={step <= level || undefined} />
      ))}
    </span>
  );
}

/**
 * The criteria behind one matrix cell.
 *
 * It answers the question a cell asks — *why* is this a D — and that answer is
 * a list, not a document. The document is one press further in, behind
 * {@link CriteriaListProps.onOpenCriterion}.
 *
 * A connected deck of tiles (the node panel's relation tiles, read for a
 * criterion): the level leads as a tinted squircle with its pips, so the rows
 * that pull the cell down are the ones the eye lands on; then the name, then
 * the id; open findings, when there are any, as a chip at the end.
 */
export function CriteriaList({ criteria, surface, onOpenCriterion }: CriteriaListProps) {
  if (criteria.length === 0) {
    // Reachable only from a hand-typed `?cell=`, since an unscored cell is not
    // a button. Said in words anyway: an empty list under a heading reads as a
    // list that failed to load.
    return <p className="kq-empty">Nothing was scored in this cell.</p>;
  }

  return (
    <ul className="kq-tiles">
      {criteria.map((row) => (
        <li key={row.criterionId}>
          <button
            type="button"
            className="kq-crit"
            onClick={() => onOpenCriterion(row.criterionId, surface)}
            aria-label={`${row.criterionId} ${row.name} — level ${row.level} of 4${row.openFindings > 0 ? `, ${row.openFindings} open` : ""}`}
          >
            <span className="kq-crit-level" data-level={row.level} aria-hidden="true">
              <span>L{row.level}</span>
              <LevelPips level={row.level} />
            </span>
            <span className="kq-crit-text">
              <span className="kq-crit-name">{row.name}</span>
              <span className="kq-crit-id">{row.criterionId}</span>
            </span>
            {row.openFindings > 0 && <span className="kq-crit-open">{row.openFindings} open</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}
