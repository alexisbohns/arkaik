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
import { criterionPanelKey, isCriterionEntry } from "@/lib/utils/project-panels";
import { filterFindings } from "@/lib/utils/quality";

/**
 * The criterion panel's address, and the surface it is read on.
 *
 * Owned by this page and deliberately outside `useQualityFilters`' `KEYS`, for
 * the reason `?product=` is outside `useAcceptanceFilters`': "Clear filters"
 * deletes every key in `KEYS`, and reading a criterion is not a filter.
 * Emptying a search box must not shut the document you were searching in.
 *
 * They are also not the panel *stack's* address — `?node=` is, and it stays the
 * only one. See `lib/utils/project-panels.ts` for why a criterion is library
 * content rather than a location in this graph.
 */
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
  const { entries, openNode, openCriterion } = useProjectPanels();
  const { filters, setFilters } = useQualityFilters();

  const data = useQualityData(id);
  const scope = useEffectiveProduct(id, data.project);

  const filtered = useMemo(() => filterFindings(data.rows, filters), [data.rows, filters]);

  const criterionParam = searchParams.get(CRITERION_PARAM);
  const surfaceParam = searchParams.get(CRITERION_SURFACE_PARAM);

  /** The panel `?criterion=` names, keyed the way the stack keys it. */
  const addressed = criterionParam
    ? criterionPanelKey(criterionParam, surfaceParam ?? undefined)
    : null;

  /**
   * The criterion panel this page owns: the one at the *bottom* of the stack.
   *
   * Only depth 0 is addressed, because only a click on this surface opens one
   * there. A criterion opened from inside a node panel sits higher and is not
   * this param's business — the same way a node panel below the top is not
   * `?node=`'s.
   */
  const bottom = entries[0];
  const openKey = bottom && isCriterionEntry(bottom) ? bottom.key : null;

  const open = useCallback(() => {
    // Depth 0, explicitly. `openCriterion` defaults to `previous.length`, which
    // appends — right for Raw, invoked from the header, wrong for a board that
    // lives on this surface. On the default, criterion A then B leaves `[A, B]`
    // and the stack grows with every click.
    if (criterionParam) openCriterion(criterionParam, surfaceParam ?? undefined, 0);
  }, [criterionParam, openCriterion, surfaceParam]);

  useAddressedBottomPanel({
    params: [CRITERION_PARAM, CRITERION_SURFACE_PARAM],
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
      });
    },
    [openCriterion, writeQuery],
  );

  // Depth 0: a finding card is on the surface, so following its linked node is
  // a surface click and leaves exactly one panel open — the same rule the
  // criterion link follows. Deeper links out of the node itself are the node
  // panel's own business and open above it.
  const handleOpenNode = useCallback((nodeId: string) => openNode({ nodeId }, 0), [openNode]);

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
          nodesById={data.nodesById}
          surfaceTitles={data.surfaceTitles}
          onOpenNode={handleOpenNode}
          onOpenCriterion={handleOpenCriterion}
        />
      )}
    </QualityFrame>
  );
}
