"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { KritikLibrary, QualityMatrixCell, QualitySection } from "@arkaik/schema";
import { FindingsBoard } from "@/components/quality/FindingsBoard";
import { CriteriaList } from "@/components/quality/CriteriaList";
import { GradeScale } from "@/components/quality/GradeScale";
import { GRADE_BORDER } from "@/components/quality/quality-styles";
import { EmptyState } from "@/components/ui/empty-state";
import { FIELD_LABEL_CLASS } from "@/components/ui/field";
import type { Node } from "@/lib/data/types";
import { cn } from "@/lib/utils";
import {
  EMPTY_QUALITY_FILTERS,
  buildCellCriteria,
  buildSurfaceTitles,
  cellKey,
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
   * Every finding in the section, denormalized once by `ProjectPanels` — not
   * this cell's. The panel narrows and groups them itself, through the very
   * functions the Findings page uses, so the two cannot disagree about what
   * belongs to a cell.
   */
  findings: FindingRow[];
  nodesById: ReadonlyMap<string, Node>;
  projectId: string;
  onOpenNode: (nodeId: string) => void;
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

export function CellDetailPanelHeader({
  domain,
  surface,
  library,
  section,
}: Pick<CellDetailPanelProps, "domain" | "surface" | "library" | "section">) {
  return (
    <>
      <span className="inline-flex shrink-0 items-center rounded-md border border-border px-2 py-0.5 font-mono text-xs text-muted-foreground">
        {domain}
      </span>
      <span className="truncate text-sm font-medium">{domainNameOf(domain, library)}</span>
      <span className="shrink-0 text-xs text-muted-foreground">{surfaceTitleOf(surface, section)}</span>
    </>
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
  findings,
  nodesById,
  projectId,
  onOpenNode,
  onOpenCriterion,
}: CellDetailPanelProps) {
  const key = cellKey(domain, surface);
  const domainName = domainNameOf(domain, library);
  const surfaceTitle = surfaceTitleOf(surface, section);

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

  const openFindings = narrowed.filter((row) => row.open).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex items-center gap-4 border-b px-4 py-4">
        {cell && (
          // The card the reader clicked, restated: same border-and-scale
          // idiom, so the panel does not answer with a different-looking
          // object than the one that opened it.
          <span
            className={cn(
              "flex shrink-0 flex-col items-center justify-center gap-1.5 rounded-lg border bg-card px-3 py-2.5",
              GRADE_BORDER[cell.grade],
            )}
          >
            <span className="text-2xl font-semibold leading-none tabular-nums">{cell.score}</span>
            <GradeScale grade={cell.grade} capped={cell.capped} size="md" />
          </span>
        )}
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-sm font-medium">
            {domainName} <span className="text-muted-foreground">×</span> {surfaceTitle}
          </span>
          <span className="text-xs text-muted-foreground">
            {criteria.length} criteri{criteria.length === 1 ? "on" : "a"} scored ·{" "}
            {openFindings} open finding{openFindings === 1 ? "" : "s"}
          </span>
          {cell?.capped && (
            // The `*` on the card is a footnote nobody carries between screens,
            // so the panel says it in words instead of repeating the mark.
            <span className="text-xs text-muted-foreground">
              An open Critical or High capped this grade below the band its score earned.
            </span>
          )}
        </span>
      </div>

      <section className="flex flex-col gap-2 py-4">
        <span className={cn(FIELD_LABEL_CLASS, "px-4")}>Criteria</span>
        <CriteriaList criteria={criteria} surface={surface} onOpenCriterion={onOpenCriterion} />
      </section>

      <section className="flex flex-col gap-2 border-t py-4">
        <span className={cn(FIELD_LABEL_CLASS, "px-4")}>Findings</span>
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
            nodesById={nodesById}
            surfaceTitles={surfaceTitles}
            onOpenNode={onOpenNode}
            onOpenCriterion={onOpenCriterion}
          />
        )}
      </section>

      <div className="border-t px-4 py-4">
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
