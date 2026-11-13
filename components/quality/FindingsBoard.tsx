"use client";

import { useMemo, type ReactNode } from "react";
import { LayersIcon } from "lucide-react";
import type { FindingPriority } from "@arkaik/schema";
import { groupFindingRuns, surfaceTitleOf, type FindingGroupKey, type FindingRow } from "@/lib/utils/quality";
import { EmptyState } from "@/components/ui/empty-state";
import { FindingCard } from "@/components/quality/FindingCard";
import { FindingMark } from "@/components/quality/FindingMark";
import { DomainGlyph, QualitySeal } from "@/components/quality/QualitySeal";
import { PRIORITY_HINT, SEVERITY_HINT, SEVERITY_LABEL } from "@/components/quality/quality-styles";

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
 * A lane's heading: a seal (the priority in its tone, the severity's dot, the
 * surface's layers, the domain's mark), the name, what it means, the count.
 * Sticky, so a reader thirty findings down still knows which lane they are in.
 */
function LaneHead({
  groupKey,
  value,
  sample,
  count,
  surfaceTitles,
}: {
  groupKey: FindingGroupKey;
  value: string;
  sample: FindingRow;
  count: number;
  surfaceTitles: ReadonlyMap<string, string>;
}) {
  let seal: ReactNode;
  let title: string;
  let hint: string | undefined;
  if (groupKey === "priority") {
    seal = <QualitySeal priority={value}>{value}</QualitySeal>;
    title = value;
    hint = PRIORITY_HINT[value as FindingPriority];
  } else if (groupKey === "severity") {
    seal = (
      <QualitySeal shape="cookie9">
        <span data-kq-severity={value} className="kq-sevdot" />
      </QualitySeal>
    );
    title = SEVERITY_LABEL[sample.severity];
    hint = SEVERITY_HINT[sample.severity];
  } else if (groupKey === "surface") {
    seal = (
      <QualitySeal>
        <LayersIcon className="size-4" />
      </QualitySeal>
    );
    title = surfaceTitleOf(sample.surface, surfaceTitles);
  } else {
    seal = (
      <QualitySeal>
        <DomainGlyph code={sample.domain} className="size-4" />
      </QualitySeal>
    );
    title = sample.domainName;
  }
  return (
    <h3 className="kq-lane-head" data-kq-priority={groupKey === "priority" ? value : undefined}>
      {seal}
      <span className="kq-lane-title">{title}</span>
      {hint && <span className="kq-lane-hint">{hint}</span>}
      <span className="kq-lane-count">{count}</span>
    </h3>
  );
}

/**
 * The findings, in lanes: the rows exactly as sorted, cut where the sort key
 * changes (`groupFindingRuns`), each run under a sticky seal and its rows a
 * connected deck of tiles.
 *
 * The order is whatever `filterFindings` sorted, which is the filter bar's
 * Sort; the lanes are a reading of that order, never a second one — no row
 * moves, nothing is filtered here. Sorted by priority (the default reads the
 * same), a lane is a priority and its seal says so in the lane's tone, so an
 * open finding needs no mark of its own: only a decided one keeps its
 * `FindingMark` (the tick, the cross, the shield), because "P1" over a fix
 * that shipped would read as work still owed. Sorted by anything else, every
 * tile keeps its mark, since the lane no longer says the priority.
 *
 * A row opens the finding's own panel; the board is the same component on the
 * Findings page, in the cell panel and in the criterion panel, so the three can
 * never disagree about what a finding looks like.
 */
export function FindingsBoard({
  rows,
  surfaceTitles,
  onOpenFinding,
  onOpenCriterion,
}: FindingsBoardProps) {
  const { key, runs } = useMemo(() => groupFindingRuns(rows), [rows]);

  if (rows.length === 0) {
    return (
      <div className="p-4">
        <EmptyState message="No findings match these filters." />
      </div>
    );
  }

  return (
    <div className="kq-scope kq-lanes">
      {runs.map((run, index) => (
        <section key={`${run.value}-${index}`} className="kq-lane">
          {key && (
            <LaneHead
              groupKey={key}
              value={run.value}
              sample={run.rows[0]}
              count={run.rows.length}
              surfaceTitles={surfaceTitles}
            />
          )}
          <ol className="kq-deck-list">
            {run.rows.map((row) => (
              <li key={row.id} className="kq-deck-tile">
                {(key !== "priority" || !row.open) && <FindingMark row={row} className="kq-deck-mark" />}
                <div className="min-w-0 flex-1">
                  <FindingCard
                    row={row}
                    surfaceTitles={surfaceTitles}
                    onOpenFinding={onOpenFinding}
                    onOpenCriterion={onOpenCriterion}
                  />
                </div>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
