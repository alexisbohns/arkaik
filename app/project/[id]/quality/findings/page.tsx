"use client";

import { useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { FindingsBoard } from "@/components/quality/FindingsBoard";
import { QualityFilterBar } from "@/components/quality/QualityFilterBar";
import { QualityFrame } from "@/components/quality/QualityFrame";
import { useQualityFilters } from "@/components/quality/quality-filters";
import { EmptyState } from "@/components/ui/empty-state";
import { useAddressedBottomPanel } from "@/lib/hooks/useAddressedBottomPanel";
import { useEffectiveProduct } from "@/lib/hooks/useProductScope";
import { useProjectId } from "@/lib/hooks/useProjectId";
import { useProjectPanels } from "@/lib/hooks/useProjectPanels";
import { useQualityData } from "@/lib/hooks/useQualityData";
import { useQueryWriter } from "@/lib/hooks/useQueryWriter";
import {
  criterionPanelKey,
  findingPanelKey,
  isCriterionEntry,
  isFindingEntry,
} from "@/lib/utils/project-panels";
import { filterFindings, type FindingRow } from "@/lib/utils/quality";

/**
 * The two panels this page can open at depth 0, and the surface a criterion is
 * read on.
 *
 * Owned by this page and deliberately outside `useQualityFilters`' `KEYS`, for
 * the reason `?product=` is outside `useAcceptanceFilters`': "Clear filters"
 * deletes every key in `KEYS`, and reading a finding is not a filter. Emptying
 * a search box must not shut the document you were searching in.
 *
 * They are also not the panel *stack's* address — `?node=` is, and it stays the
 * only one. See `lib/utils/project-panels.ts` for why neither a criterion nor a
 * finding is a location in this graph.
 *
 * `?finding=` and `?criterion=` are mutually exclusive: both name the panel at
 * depth 0, so opening either deletes the other. A URL carrying both is
 * hand-typed, and the finding wins — stated once, in `addressed` below, rather
 * than left for two syncs to fight over.
 */
const FINDING_PARAM = "finding";
const CRITERION_PARAM = "criterion";
const CRITERION_SURFACE_PARAM = "csurface";

/**
 * The findings, full width and fully filterable.
 *
 * The Matrix page's cell panel shows a slice of this same board — same
 * component, same `filterFindings`, with one cell
 * pinned. This page is the one you come to when the filter you want is not a
 * cell.
 */
export default function ProjectQualityFindingsPage() {
  const id = useProjectId();
  const searchParams = useSearchParams();
  // The page's own writer for the two params below. Same hook the filter bar
  // writes through, which is the whole reason two writers can share this URL:
  // it reads the live query at call time rather than a closed-over snapshot.
  const writeQuery = useQueryWriter();
  const { entries, openCriterion, openFinding } = useProjectPanels();
  const { filters, setFilters } = useQualityFilters();

  const data = useQualityData(id);
  const scope = useEffectiveProduct(id, data.project);

  const filtered = useMemo(() => filterFindings(data.rows, filters), [data.rows, filters]);

  const findingParam = searchParams.get(FINDING_PARAM);
  const criterionParam = searchParams.get(CRITERION_PARAM);
  const surfaceParam = searchParams.get(CRITERION_SURFACE_PARAM);

  /**
   * The panel the URL names, keyed the way the stack keys it. A finding first:
   * the two params are written mutually exclusive, and this is the one place
   * that settles a URL carrying both.
   */
  const addressed = findingParam
    ? findingPanelKey(findingParam)
    : criterionParam
      ? criterionPanelKey(criterionParam, surfaceParam ?? undefined)
      : null;

  /**
   * The panel this page owns: the one at the *bottom* of the stack, whichever
   * of the two kinds it is.
   *
   * Only depth 0 is addressed, because only a click on this surface opens one
   * there. A criterion or a finding opened from inside another panel sits
   * higher and is not this param's business — the same way a node panel below
   * the top is not `?node=`'s.
   */
  const bottom = entries[0];
  const openKey =
    bottom && (isFindingEntry(bottom) || isCriterionEntry(bottom)) ? bottom.key : null;

  /**
   * The row `?finding=` names. Resolved from the page's own rows rather than
   * carried in the URL: the address is an id, and the descriptor wants the
   * title. A `?finding=` naming nothing opens nothing here — the panel's own
   * "no finding with that id" body is for a finding that disappears *under* an
   * open panel, not for an address that never resolved.
   *
   * `null` on a cold load too, for as long as the project is in flight, and
   * `useAddressedBottomPanel` survives that on its own: its restore branch
   * re-fires while `seen.current !== addressed`, so the pass on which the rows
   * land is the pass that opens the panel, and the branch that would clear a
   * stale address never runs because nothing was ever seen open.
   */
  const addressedRow = findingParam
    ? data.rows.find((row) => row.id === findingParam) ?? null
    : null;

  const open = useCallback(() => {
    // Depth 0, explicitly. Both openers default to `previous.length`, which
    // appends — right for Raw, invoked from the header, wrong for a board that
    // lives on this surface. On the default, clicking A then B leaves `[A, B]`
    // and the stack grows with every click.
    if (addressedRow) openFinding(addressedRow, 0);
    else if (!findingParam && criterionParam) openCriterion(criterionParam, surfaceParam ?? undefined, 0);
  }, [addressedRow, criterionParam, findingParam, openCriterion, openFinding, surfaceParam]);

  useAddressedBottomPanel({
    params: [FINDING_PARAM, CRITERION_PARAM, CRITERION_SURFACE_PARAM],
    addressed,
    open,
    openKey,
  });

  const handleOpenCriterion = useCallback(
    (criterionId: string, surface: string) => {
      // Opened *and* addressed in one gesture. The open is not left to the sync
      // effect, which would put a router transition between the click and the
      // panel; the write is what makes the panel survive a Back.
      openCriterion(criterionId, surface, 0);
      writeQuery((params) => {
        params.set(CRITERION_PARAM, criterionId);
        if (surface) params.set(CRITERION_SURFACE_PARAM, surface);
        else params.delete(CRITERION_SURFACE_PARAM);
        // The other half of depth 0 goes with it: one slot, one address.
        params.delete(FINDING_PARAM);
      });
    },
    [openCriterion, writeQuery],
  );

  // Depth 0: a finding card is on the surface, so opening it is a surface click
  // and leaves exactly one panel open. Anything opened from inside the panel is
  // that panel's business and opens above it.
  const handleOpenFinding = useCallback(
    (row: FindingRow) => {
      openFinding(row, 0);
      writeQuery((params) => {
        params.set(FINDING_PARAM, row.id);
        params.delete(CRITERION_PARAM);
        params.delete(CRITERION_SURFACE_PARAM);
      });
    },
    [openFinding, writeQuery],
  );

  return (
    <QualityFrame
      title="Findings"
      meta={`${data.rows.length} findings · ${filtered.length} shown`}
      data={data}
      scope={scope}
      toolbar={
        <QualityFilterBar
          filters={filters}
          onChange={setFilters}
          surfaces={data.surfaces}
          domains={data.domains}
        />
      }
    >
      {data.rows.length === 0 ? (
        // An audit that found nothing is not a filter that matched nothing, and
        // only this page can tell them apart: `FindingsBoard` sees an empty
        // list either way and says "No findings match these filters." — which
        // would greet a clean audit by blaming the reader for it.
        <div className="p-4">
          <EmptyState message="Nothing to fix. This audit scored every surface and raised no findings at all." />
        </div>
      ) : (
        <FindingsBoard
          rows={filtered}
          surfaceTitles={data.surfaceTitles}
          onOpenFinding={handleOpenFinding}
          onOpenCriterion={handleOpenCriterion}
        />
      )}
    </QualityFrame>
  );
}
