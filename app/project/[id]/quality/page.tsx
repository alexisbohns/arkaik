"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { deriveQualityMatrix, resolveKritikLibrary } from "@arkaik/schema";
import { PageError } from "@/components/layout/PageError";
import { PageLoading } from "@/components/layout/PageLoading";
import { PageShell } from "@/components/layout/PageShell";
import { PageSurface } from "@/components/layout/PageSurface";
import { FindingsBoard } from "@/components/quality/FindingsBoard";
import { QualityFilterBar } from "@/components/quality/QualityFilterBar";
import { QualityMatrix } from "@/components/quality/QualityMatrix";
import { useQualityFilters } from "@/components/quality/quality-filters";
import { EmptyState } from "@/components/ui/empty-state";
import { useEdges } from "@/lib/hooks/useEdges";
import { useNodes } from "@/lib/hooks/useNodes";
import { useEffectiveProduct } from "@/lib/hooks/useProductScope";
import { useProject } from "@/lib/hooks/useProject";
import { useProjectId } from "@/lib/hooks/useProjectId";
import { useQueryWriter } from "@/lib/hooks/useQueryWriter";
import { NODE_PANEL_PARAM, useProjectPanels } from "@/lib/hooks/useProjectPanels";
import { criterionPanelKey, isCriterionEntry } from "@/lib/utils/project-panels";
import { buildFindingRows, filterFindings, groupByPriority } from "@/lib/utils/quality";

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

export default function ProjectQualityPage() {
  const id = useProjectId();

  const { entries, openNode, openCriterion } = useProjectPanels();
  const searchParams = useSearchParams();
  // The page's own writer for the two params below. Same hook the filter bar
  // writes through, which is the whole reason two writers can share this URL:
  // it reads the live query at call time rather than a closed-over snapshot.
  const writeQuery = useQueryWriter();
  const { filters, setFilters } = useQualityFilters();

  const { nodes: dataNodes, loading: nodesLoading, error: nodesError, reload: reloadNodes } = useNodes(id);
  const { edges: dataEdges, loading: edgesLoading, error: edgesError, reload: reloadEdges } = useEdges(id);
  const { project: projectBundle, error: projectError, reload: reloadProject } = useProject(id);
  const scope = useEffectiveProduct(id, projectBundle);

  const section = projectBundle?.quality;
  const library = useMemo(() => resolveKritikLibrary(section), [section]);
  const matrix = useMemo(() => deriveQualityMatrix({ quality: section }, library), [section, library]);

  // Split rather than chained, and the split is the point:
  // `react-hooks/preserve-manual-memoization` is an error here and it refuses a
  // single memo wrapping the whole build-narrow-group chain. Each of these is
  // an opaque imported call over the props that are also its deps, which is the
  // shape the rule accepts. They are real memoization either way — the React
  // Compiler does not run in this build (see the plan's ground rules) — and the
  // pilot audit is 246 findings, sorted and copied on every pass.
  const rows = useMemo(() => buildFindingRows(section, library), [section, library]);
  const filtered = useMemo(() => filterFindings(rows, filters), [rows, filters]);
  const groups = useMemo(() => groupByPriority(filtered), [filtered]);

  const nodesById = useMemo(() => new Map(dataNodes.map((node) => [node.id, node])), [dataNodes]);
  // The project's audit targets, not a constant: the filter bar's surface menu
  // offers exactly what the profile declared, so a surface this project never
  // audited is never offered as a way to narrow to nothing.
  const surfaces = useMemo(() => section?.profile?.surfaces ?? [], [section]);
  const domains = useMemo(() => library?.domains ?? [], [library]);

  // ---- `?criterion=` <-> the criterion panel ---------------------------------

  const criterionParam = searchParams.get(CRITERION_PARAM);
  const surfaceParam = searchParams.get(CRITERION_SURFACE_PARAM);
  const addressParam = searchParams.get(NODE_PANEL_PARAM);

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
  const stackDepth = entries.length;

  const clearCriterion = useCallback(() => {
    writeQuery((params) => {
      params.delete(CRITERION_PARAM);
      params.delete(CRITERION_SURFACE_PARAM);
    });
  }, [writeQuery]);

  /**
   * The address as of the previous pass, and whether we have ever *seen* the
   * addressed panel actually open.
   *
   * Both exist to answer one question the URL alone cannot: the panel is gone
   * and `?criterion=` still names it — was it closed, or was it wiped?
   *
   * `reconcileArrival`'s rule is that a missing `?node=` closes the **whole**
   * stack, so opening a linked node out of the criterion panel and then
   * pressing Back — or closing that node panel, which republishes an empty
   * address — takes the criterion panel down with it. That is pre-existing
   * behaviour the Raw panel has had since it landed, and it is out of scope
   * here; putting the panel back is this effect's job. It comes back
   * **remounted**, so whatever the reader had scrolled to inside it is lost.
   *
   * The two cases land in the identical state — no panel, a live
   * `?criterion=` — and differ only in whether the *address* moved on the same
   * pass. `lastAddress` is that discriminator; `seen` keeps the very first pass
   * (and React's StrictMode double-invoke, which repeats it with the address
   * already recorded) from reading a panel that has not mounted yet as a panel
   * the reader closed.
   */
  const lastAddress = useRef<string | null | undefined>(undefined);
  const seen = useRef<string | null>(null);

  useEffect(() => {
    const addressMoved = lastAddress.current !== addressParam;
    lastAddress.current = addressParam;

    if (!criterionParam || !addressed) {
      seen.current = null;
      return;
    }

    if (openKey === addressed) {
      // From here on a disappearance is meaningful: we know it was open.
      seen.current = addressed;
      return;
    }

    // A *different* criterion sits at the bottom. That is the one frame between
    // a click in the criteria strip opening the new panel and the query write
    // landing, and the stack is the fresher of the two. Acting on the stale URL
    // here would reopen the criterion the reader just navigated away from.
    if (openKey !== null) return;

    // Restored only into an *empty* stack. A stack with something else at the
    // bottom means somebody else owns depth 0 — a finding's linked node opened
    // from the board, which replaced this panel on purpose, or a node restored
    // from a `?node=` that arrived alongside `?criterion=` on a cold load.
    // Opening at depth 0 truncates, so restoring over either would destroy the
    // panel the reader is actually looking at.
    if (stackDepth === 0 && (addressMoved || seen.current !== addressed)) {
      // Depth 0, explicitly. `openCriterion` defaults to `previous.length`,
      // which appends — right for Raw, invoked from the header, wrong for a
      // strip that lives on this surface. On the default, criterion A then B
      // leaves `[A, B]` and the stack grows with every click.
      openCriterion(criterionParam, surfaceParam ?? undefined, 0);
      return;
    }

    // Nothing wiped it and nothing else took its slot, so the reader closed it.
    // The address goes with it — left behind, the effect above would faithfully
    // reopen the panel on the next pass and the close button would do nothing.

    if (seen.current === addressed) {
      seen.current = null;
      clearCriterion();
    }
  }, [
    addressed,
    addressParam,
    clearCriterion,
    criterionParam,
    openCriterion,
    openKey,
    stackDepth,
    surfaceParam,
  ]);

  const handleOpenCriterion = useCallback(
    (criterionId: string, surface: string) => {
      // Opened *and* addressed in one gesture. The open is not left to the
      // effect above, which would put a router transition between the click and
      // the panel; the write is what makes the panel survive a Back.
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
  // criteria strip follows. Deeper links out of the node itself are the node
  // panel's own business and open above it.
  const handleOpenNode = useCallback((nodeId: string) => openNode({ nodeId }, 0), [openNode]);

  const handleSelectCell = useCallback(
    (cell: string | null) => setFilters({ ...filters, cell }),
    [filters, setFilters],
  );

  if (nodesLoading || edgesLoading) {
    return <PageLoading label="quality" />;
  }

  // Before the empty state, never after (#362, audit `quality-frontend-2`): a
  // project whose bundle failed to read has no `quality` section either, and
  // would otherwise be told to go install a plugin and run an audit it may well
  // have run already. See `components/layout/PageError.tsx`.
  const loadError = nodesError ?? edgesError ?? projectError;
  if (loadError) {
    return (
      <PageError
        label="quality"
        message={loadError}
        onRetry={() => {
          void reloadNodes();
          void reloadEdges();
          void reloadProject();
        }}
      />
    );
  }

  if (!section) {
    return (
      <PageShell title="Quality" allNodes={dataNodes} allEdges={dataEdges} scope={scope}>
        <PageSurface>
          <EmptyState
            message={
              <>
                No quality audit yet. Three steps to the matrix: install the{" "}
                <code className="font-mono text-xs">kritik@arkaik</code> plugin, run an audit over a
                surface, then import the bundle it writes back.
              </>
            }
          />
        </PageSurface>
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Quality"
      meta={`${matrix.surfaces.length} surfaces · ${rows.length} findings · ${filtered.length} shown`}
      /* The page renders no nodes of its own, but `ProjectPanels` resolves node
         entries against this data — without it, following a finding into its
         linked node opens a panel that cannot find its node. */
      allNodes={dataNodes}
      allEdges={dataEdges}
      scope={scope}
      /* The only two props the criterion panel needs: `ProjectPanels` derives
         each criterion's findings from them itself, once per stack. */
      qualitySection={section}
      qualityLibrary={library}
    >
      <PageSurface
        /* One scrollport holding both sections, so the board's priority
           headings pin against the toolbar's hairline as you scroll past the
           matrix — `fill` puts the toolbar outside the scrolling box, which is
           what `FindingsBoard`'s sticky `0px` fallback is written against. */
        fill
        contentClassName="overflow-y-auto"
        toolbar={
          <QualityFilterBar
            filters={filters}
            onChange={setFilters}
            surfaces={surfaces}
            domains={domains}
          />
        }
      >
        <div className="p-4">
          <QualityMatrix
            matrix={matrix}
            section={section}
            library={library}
            activeCell={filters.cell}
            onSelectCell={handleSelectCell}
            onOpenCriterion={handleOpenCriterion}
          />
        </div>

        {rows.length === 0 ? (
          // An audit that found nothing is not a filter that matched nothing,
          // and only this page can tell them apart: `FindingsBoard` sees four
          // empty groups either way and says "No findings match these filters."
          // — which would greet a clean audit by blaming the reader for it. The
          // matrix above still renders, because the scores are the point and a
          // project can legitimately be scored with no findings raised.
          <div className="px-4 pb-4">
            <EmptyState message="Nothing to fix. This audit scored the surfaces above and raised no findings at all." />
          </div>
        ) : (
          <FindingsBoard
            groups={groups}
            nodesById={nodesById}
            onOpenNode={handleOpenNode}
            onOpenCriterion={handleOpenCriterion}
          />
        )}
      </PageSurface>
    </PageShell>
  );
}
