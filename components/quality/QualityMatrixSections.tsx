"use client";

import { useId, useMemo } from "react";
import { LayersIcon } from "lucide-react";
import {
  isOpenFinding,
  type FindingsBurndown,
  type JournalEvent,
  type KritikLibrary,
  type QualityMatrix,
  type QualitySection,
  type QualityTrend,
} from "@arkaik/schema";
import { ExpressiveShape } from "@/components/arkademy/ExpressiveShape";
import { BurndownChart, BurndownDetail, BurndownSparkline } from "@/components/quality/BurndownChart";
import { MatrixDomains, type MatrixView } from "@/components/quality/MatrixDomains";
import { QualityLegend } from "@/components/quality/QualityLegend";
import { plural } from "@/components/quality/QualitySeal";
import { SurfaceScoreCard } from "@/components/quality/SurfaceScoreCard";
import { buildDomainSections, buildSurfaceBurndowns, buildSurfaceGauges, describeDelta } from "@/lib/utils/quality";

interface QualityMatrixSectionsProps {
  matrix: QualityMatrix;
  section?: QualitySection;
  library?: KritikLibrary;
  /**
   * The recorded audits, for the arrow on every card. Optional so the landing
   * preview and a page whose journal has not arrived render the matrix as it
   * always did — without a trend there is no arrow, not a broken one.
   */
  trend?: QualityTrend;
  /**
   * The project-wide findings burndown, and the events it was replayed from —
   * the second so each surface card can replay its own slice. Optional for the
   * reason `trend` is: without them the Overall section is what it was.
   */
  burndown?: FindingsBurndown;
  burndownEvents?: readonly JournalEvent[];
  /** The open cell as `cellKey` encodes it, or `null`. Owned by the URL. */
  activeCell: string | null;
  onSelectCell: (domain: string, surface: string) => void;
  /** The domains' layout, owned by the URL (`?matrix=worst`). Absent = the heatmap. */
  view?: MatrixView;
  /** Absent where the layout is not the reader's to change: no switch is drawn. */
  onViewChange?: (view: MatrixView) => void;
}

/**
 * The comparative matrix: what is still open and the surface roll-up first,
 * then every domain on every surface (`MatrixDomains`), then the key.
 *
 * Nothing here scores anything. `deriveQualityMatrix` produced every number,
 * `gradeOf` bands the roll-up, and the caps were applied before this component
 * saw a cell — which is why a grade can read a letter worse than its score, and
 * why the legend has to say so.
 */
export function QualityMatrixSections({
  matrix,
  section,
  library,
  trend,
  burndown,
  burndownEvents,
  activeCell,
  onSelectCell,
  view = "heatmap",
  onViewChange,
}: QualityMatrixSectionsProps) {
  // The pilot's section is 338 assessments and 246 findings, and both of these
  // walk the whole of it. Split rather than chained for the reason the pages
  // state: `react-hooks/preserve-manual-memoization` accepts an opaque imported
  // call over its own deps and refuses a chain wrapped in one memo.
  const sections = useMemo(() => buildDomainSections(matrix, section, library, trend), [matrix, section, library, trend]);
  const gauges = useMemo(() => buildSurfaceGauges(matrix, section, library, trend), [matrix, section, library, trend]);
  const findings = section?.findings;
  const surfaceBurndowns = useMemo(
    () => (burndownEvents ? buildSurfaceBurndowns(burndownEvents, matrix.surfaces, { findings, library }) : null),
    [burndownEvents, matrix.surfaces, findings, library],
  );
  // Every open finding in the section, not the cards' sum: a finding on a
  // surface the profile no longer lists is on no card, but it is on the line
  // the burndown draws, and the sentence must close on the chart's number.
  const openNow = useMemo(() => (findings ?? []).filter(isOpenFinding).length, [findings]);
  const titleId = useId();

  return (
    <div className="flex flex-col" data-quality-page="matrix">
      {/*
        The surface roll-up, promoted from the old table's `tfoot` to the top
        of the page: a summary read *before* the detail is a summary, read
        after it is a twelfth domain. It is banded straight off its score with
        no caps re-applied — `deriveQualityMatrix` deliberately declined to
        fold them in here, since a cap shapes the cell you act on and folding
        it into the roll-up too would punish one finding twice.

        Under it, as the page's one loud number: what is still open. The
        scores only move on a re-audit; the open count moves the day a finding
        closes (issue #441), so it is the figure a reader comes back to see
        change. The sentence under it is the breakdown — what was resolved,
        accepted and opened since the audit — rather than the closed-since
        line, which would end on the number the hero has just said.
      */}
      <section className="kq-scope kq-hero" aria-labelledby={titleId}>
        <ExpressiveShape shape="sunny" className="kq-hero-shape" />
        <div className="kq-hero-head">
          <span className="kq-hero-kicker">
            <LayersIcon className="size-4" aria-hidden="true" />
            <h2 id={titleId}>Overall</h2>
            <span>· {plural(matrix.surfaces.length, "surface", "surfaces")}, every domain weighed together</span>
          </span>
          <p className="kq-hero-number">
            <span className="kq-hero-numeral">{openNow}</span>
            <span className="kq-hero-unit">open findings</span>
          </p>
          {burndown && <BurndownDetail burndown={burndown} />}
        </div>
        <div className="kq-gauges">
          {gauges.map((gauge) => {
            const surfaceBurndown = surfaceBurndowns?.get(gauge.surface);
            return (
              <SurfaceScoreCard
                key={gauge.surface}
                title={gauge.title}
                score={gauge.score}
                grade={gauge.grade}
                delta={gauge.delta}
                meta={`${gauge.openFindings} open`}
                footer={surfaceBurndown && <BurndownSparkline burndown={surfaceBurndown} />}
                label={
                  gauge.score === null
                    ? `${gauge.title} — nothing scored`
                    : `${gauge.title} — ${gauge.score} out of 100, grade ${gauge.grade}` +
                      (describeDelta(gauge.delta) ? `, ${describeDelta(gauge.delta)}` : "") +
                      ` — ${gauge.openFindings} open findings`
                }
              />
            );
          })}
        </div>
        {burndown && <BurndownChart burndown={burndown} className="kq-hero-chart" />}
      </section>

      <MatrixDomains
        sections={sections}
        activeCell={activeCell}
        onSelectCell={onSelectCell}
        view={view}
        onViewChange={onViewChange}
      />

      <QualityLegend library={library} />
    </div>
  );
}
