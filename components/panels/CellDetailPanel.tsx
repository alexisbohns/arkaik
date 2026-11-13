"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { KritikLibrary, QualityMatrixCell, QualitySection, QualityTrend } from "@arkaik/schema";
import type { ReactNode } from "react";
import { FindingsBoard } from "@/components/quality/FindingsBoard";
import { CriteriaList } from "@/components/quality/CriteriaList";
import { GradeTrack } from "@/components/quality/GradeTrack";
import { DomainGlyph, QualitySeal, plural } from "@/components/quality/QualitySeal";
import { DeltaArrow } from "@/components/quality/SurfaceScoreCard";
import { EmptyState } from "@/components/ui/empty-state";
import { FIELD_LABEL_CLASS } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import {
  EMPTY_QUALITY_FILTERS,
  buildCellCriteria,
  buildCellHistory,
  cellHistoryStep,
  buildSurfaceTitles,
  cellKey,
  describeDelta,
  filterFindings,
  type FindingRow,
} from "@/lib/utils/quality";

interface CellDetailPanelProps {
  domain: string;
  surface: string;
  library?: KritikLibrary;
  section?: QualitySection;
  /**
   * The cell as `deriveQualityMatrix` scored it, derived once per stack by
   * `ProjectPanels`. Passed rather than recomputed here: the score, the grade
   * and the cap are the matrix's answers, and a second sum in this panel would
   * be a second answer to the number the card the reader clicked already shows.
   * `null` when this domain was not scored on this surface.
   */
  cell: QualityMatrixCell | null;
  /**
   * The recorded audits (`deriveQualityTrend`), for the arrow beside the
   * restated score and the History section below. Absent on a page that read
   * no journal, and then the panel is the panel it was.
   */
  trend?: QualityTrend;
  /**
   * Every finding in the section, denormalized once by `ProjectPanels` — not
   * this cell's. The panel narrows and groups them itself, through the very
   * functions the Findings page uses, so the two cannot disagree about what
   * belongs to a cell.
   */
  findings: FindingRow[];
  projectId: string;
  onOpenFinding: (findingId: string) => void;
  onOpenCriterion: (criterionId: string, surface: string) => void;
}

/** The domain's display name, falling back to its code. */
function domainNameOf(domain: string, library?: KritikLibrary): string {
  return library?.domains?.find((candidate) => candidate?.code === domain)?.name ?? domain;
}

/** A surface id as the profile titles it; the raw id when the profile has moved on. */
function surfaceTitleOf(surface: string, section?: QualitySection): string {
  return section?.profile?.surfaces?.find((candidate) => candidate?.id === surface)?.title ?? surface;
}

/**
 * The cell panel's header: the domain's mark on a cookie seal, its name, and
 * the surface as a chip — the node panel's seal header, read for a cell. The
 * domain code moved into the name's tooltip: the mark already says which
 * domain at a glance, and the name says it in words.
 *
 * The header frame takes the cell's grade hue from the summary below it
 * (`app/m3/quality.css`, through `:has()`), so header and hero agree on a
 * colour without this component being told the grade.
 */
export function CellDetailPanelHeader({
  domain,
  surface,
  library,
  section,
}: Pick<CellDetailPanelProps, "domain" | "surface" | "library" | "section">) {
  const domainName = domainNameOf(domain, library);
  return (
    // `display: contents`: a hook for the panel stylesheet, not a box —
    // the header row stays `PanelStack`'s.
    <div className="contents" data-quality-panel-header="cell">
      <span className="kq-scope kq-cellhead">
        <QualitySeal className="kq-cellhead-seal">
          <DomainGlyph code={domain} className="size-[1.1rem]" />
        </QualitySeal>
        <span className="kq-cellhead-name" title={`${domain} · ${domainName}`}>
          {domainName}
        </span>
        <span className="kq-cellhead-chip">{surfaceTitleOf(surface, section)}</span>
      </span>
    </div>
  );
}

/**
 * One of the panel's sections under a headline title — the node panel's
 * headline groups: a bold title after a cookie mark, no hairline between.
 */
function CellSection({ id, title, count, children }: { id: string; title: string; count?: number; children: ReactNode }) {
  return (
    <section className="kq-scope kq-cellsec" data-cell-section={id}>
      <h3 className="kq-cellsec-title">
        {title}
        {count !== undefined && <span className="kq-cellsec-count">{count}</span>}
      </h3>
      {children}
    </section>
  );
}

/**
 * One matrix cell: what was scored, and what is wrong.
 *
 * The panel exists so the Matrix page can stay a matrix. Clicking a card used
 * to filter a board a full page-scroll below it — you lost the grid to read the
 * answer, and lost the answer to pick the next cell. Here the grid stays put
 * and the panel refreshes in place, which is the one gesture the page is for.
 *
 * It is deliberately the *same* board the Findings page renders, fed the same
 * filter set with a cell pinned. The redundancy is real and it is bounded:
 * `FindingsBoard` and `filterFindings` have exactly one implementation each, and this panel is a preset of them with a criteria list
 * on top.
 *
 * Addressless in the stack — see the head of `lib/utils/project-panels.ts`. The
 * Matrix page owns `?cell=`.
 *
 * The gutter is `px-4`, not the panel modules' usual `px-6`: this panel is two
 * full-bleed lists — `CriteriaList` and `FindingsBoard`, both shared with the
 * Findings page and both built on that rhythm — and a header indented past the
 * rows it heads reads as a header belonging to something else.
 */
export function CellDetailPanel({
  domain,
  surface,
  library,
  section,
  cell,
  trend,
  findings,
  projectId,
  onOpenFinding,
  onOpenCriterion,
}: CellDetailPanelProps) {
  const key = cellKey(domain, surface);
  const delta = trend && cell ? trend.deltaCell(domain, surface) : undefined;
  const movement = describeDelta(delta);

  // Split for the reason every quality surface splits its memos:
  // `react-hooks/preserve-manual-memoization` accepts an opaque imported call
  // over the props that are also its deps, and refuses a chain wrapped in one.
  const criteria = useMemo(
    () => buildCellCriteria(section, library, domain, surface),
    [section, library, domain, surface],
  );
  const narrowed = useMemo(
    () => filterFindings(findings, { ...EMPTY_QUALITY_FILTERS, cell: key }),
    [findings, key],
  );
  const surfaceTitles = useMemo(() => buildSurfaceTitles(section), [section]);
  const history = useMemo(() => buildCellHistory(trend, domain, surface), [trend, domain, surface]);

  const openFindings = narrowed.filter((row) => row.open).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto" data-quality-panel="cell">
      {/*
        The card the reader clicked, restated as the panel's hero: the score
        huge over "/ 100", the grade a lifted step on its track, in the cell's
        own grade tint. `data-kq-cell-grade` is what lets the header frame
        above pick the same hue up.
      */}
      <div className="kq-scope kq-cellhero" data-cell-summary="" data-kq-cell-grade={cell?.grade} data-kq-grade={cell?.grade}>
        {cell ? (
          <>
            <span className="kq-cellhero-score">
              <span className="kq-cellhero-numeral">{cell.score}</span>
              <span className="kq-cellhero-of">/ 100</span>
            </span>
            <GradeTrack grade={cell.grade} capped={cell.capped} size="lg" />
          </>
        ) : (
          <span className="kq-card-gap">Not scored</span>
        )}
        <span className="kq-facts">
          <span className="kq-fact">{plural(criteria.length, "criterion", "criteria")} scored</span>
          <span className="kq-fact" data-strong={openFindings > 0 || undefined}>
            {plural(openFindings, "open finding", "open findings")}
          </span>
        </span>
        {(cell?.capped || movement) && (
          <span className="kq-sentences">
            {/* The arrow, in words — the same sentence the tile's label
                carries, here where a reader can actually see it. */}
            {movement && <span>{movement.charAt(0).toUpperCase() + movement.slice(1)}.</span>}
            {/* The `*` on the tile is a footnote nobody carries between
                screens, so the panel says it in words as well. */}
            {cell?.capped && <span>* An open Critical or High capped this grade below the band its score earned.</span>}
          </span>
        )}
      </div>

      <CellSection id="criteria" title="Criteria" count={criteria.length}>
        <CriteriaList criteria={criteria} surface={surface} onOpenCriterion={onOpenCriterion} />
      </CellSection>

      {history.length > 0 && (
        // The cell's journal section, by analogy with the node panel's History
        // (#433), and drawn like it: a tinted spine, a cookie per audit, the
        // latest one inked, the score leading. Every recorded audit's reading
        // of this cell, oldest first, so the panel answers "from where we
        // started" and not only "where we are". Absent until an audit has been
        // recorded — a list of nothing would be a heading over the advice to
        // run `matrix --record`.
        <CellSection id="history" title="History">
          <ol className="kq-feed">
            {history.map((row, index) => (
              <li key={`${row.auditId}-${row.ts}`} className="kq-feed-row" data-last={index === history.length - 1 || undefined}>
                <span className="kq-feed-score">{row.score === null ? "—" : row.score}</span>
                <DeltaArrow delta={cellHistoryStep(history, index)} />
                <span className="kq-feed-audit" title={row.commit}>
                  {row.auditId}
                  {row.commit ? ` · ${row.commit.slice(0, 7)}` : ""}
                </span>
                <span className="kq-feed-date">{row.ts.slice(0, 10)}</span>
              </li>
            ))}
          </ol>
        </CellSection>
      )}

      <section className="flex flex-col gap-2 border-t py-4" data-cell-section="findings">
        <h3 className={cn(FIELD_LABEL_CLASS, "px-4")}>Findings</h3>
        {narrowed.length === 0 ? (
          // The cell's own good news, not a filter that matched nothing: this
          // panel applies exactly one filter and the reader chose it by
          // clicking the card.
          <div className="px-4">
            <EmptyState message="No findings were raised in this cell." />
          </div>
        ) : (
          <FindingsBoard
            rows={narrowed}
            surfaceTitles={surfaceTitles}
            onOpenFinding={onOpenFinding}
            onOpenCriterion={onOpenCriterion}
          />
        )}
      </section>

      <div className="border-t px-4 py-4" data-cell-section="footer">
        <Link
          href={`/project/${projectId}/quality/findings?cell=${encodeURIComponent(key)}`}
          className="text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          Open these findings full width →
        </Link>
      </div>
    </div>
  );
}
