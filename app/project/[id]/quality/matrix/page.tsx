"use client";

import { useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { QualityFrame } from "@/components/quality/QualityFrame";
import { QualityMatrixSections } from "@/components/quality/QualityMatrixSections";
import { useAddressedBottomPanel } from "@/lib/hooks/useAddressedBottomPanel";
import { useEffectiveProduct } from "@/lib/hooks/useProductScope";
import { useProjectId } from "@/lib/hooks/useProjectId";
import { useProjectPanels } from "@/lib/hooks/useProjectPanels";
import { useQualityData } from "@/lib/hooks/useQualityData";
import { useQueryWriter } from "@/lib/hooks/useQueryWriter";
import { cellPanelKey, isCellEntry } from "@/lib/utils/project-panels";
import { cellKey, parseCellKey } from "@/lib/utils/quality";

/**
 * The open cell's address, and the one param this page owns.
 *
 * Deliberately outside `useQualityFilters`' `KEYS` — this page has no filter
 * bar, and even on the Findings page, where `?cell=` *is* a filter, "Clear
 * filters" deleting a panel's address would shut the document you were reading.
 * Same value, two readings: a link between the pages carries the selection
 * intact either way.
 */
const CELL_PARAM = "cell";

/**
 * The matrix: every domain's standing on every audited surface.
 *
 * The findings that explain a cell are one click away in a panel, not a
 * page-scroll away below the grid. That is the whole reorganisation: the grid
 * stays put while the panel refreshes, so sweeping the cards — which is what
 * this page is for — costs nothing.
 */
export default function ProjectQualityMatrixPage() {
  const id = useProjectId();
  const searchParams = useSearchParams();
  const writeQuery = useQueryWriter();
  const { entries, openCell, closeAt } = useProjectPanels();

  const data = useQualityData(id);
  const scope = useEffectiveProduct(id, data.project);

  const cellParam = searchParams.get(CELL_PARAM);
  // Validated through the parser the cards encode with, so a hand-typed
  // `?cell=SEC` cannot leave a card lit up for a cell nothing can open.
  // Destructured to primitives on purpose: `parseCellKey` returns a fresh
  // object every render, and a callback closing over it would change identity
  // on every pass and re-run the sync effect for nothing.
  const cell = parseCellKey(cellParam);
  const cellDomain = cell?.domain ?? null;
  const cellSurface = cell?.surface ?? null;
  const addressed = cellDomain && cellSurface ? cellPanelKey(cellDomain, cellSurface) : null;

  /**
   * The cell panel this page owns: the one at the *bottom* of the stack.
   *
   * Only depth 0 is addressed, because only a click on this surface opens one
   * there. A panel opened from inside another sits higher and is not this
   * param's business — the same way a node panel below the top is not
   * `?node=`'s.
   */
  const bottom = entries[0];
  const openKey = bottom && isCellEntry(bottom) ? bottom.key : null;

  const open = useCallback(() => {
    // Depth 0, explicitly. `openCell` defaults to `previous.length`, which
    // appends — right for a panel summoned from the header, wrong for a gallery
    // that lives on this surface. On the default, sweeping five cards leaves
    // five panels.
    if (cellDomain && cellSurface) openCell(cellDomain, cellSurface, 0);
  }, [cellDomain, cellSurface, openCell]);

  useAddressedBottomPanel({ params: [CELL_PARAM], addressed, open, openKey });

  const handleSelectCell = useCallback(
    (domain: string, surface: string) => {
      const key = cellKey(domain, surface);
      const isOpen = cellParam === key;

      // Opened *and* addressed in one gesture — both halves, both ways. The
      // stack is not left to the sync effect, which would put a router
      // transition between the click and the panel; the write is what makes the
      // panel survive a Back. Clicking the lit card is the close gesture, and
      // dropping the address alone would leave the panel open with nothing
      // naming it.
      if (isOpen) closeAt(0);
      else openCell(domain, surface, 0);

      writeQuery((params) => {
        if (isOpen) params.delete(CELL_PARAM);
        else params.set(CELL_PARAM, key);
      });
    },
    [cellParam, closeAt, openCell, writeQuery],
  );

  return (
    <QualityFrame
      title="Matrix"
      meta={`${data.matrix.surfaces.length} surfaces · ${data.matrix.domains.length} domains · ${data.rows.length} findings`}
      data={data}
      scope={scope}
    >
      <QualityMatrixSections
        matrix={data.matrix}
        section={data.section}
        library={data.library}
        activeCell={cell ? cellParam : null}
        onSelectCell={handleSelectCell}
      />
    </QualityFrame>
  );
}
