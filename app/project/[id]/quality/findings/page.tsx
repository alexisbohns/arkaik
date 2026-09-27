"use client";

import { useCallback, useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { deriveFindingsBurndown } from "@arkaik/schema";
import { BurndownChart, ClosedSinceLine } from "@/components/quality/BurndownChart";
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
import { burndownFilterOf, countOpenFindings, filterFindings } from "@/lib/utils/quality";

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
 * hand-typed, and the finding wins — stated once, in `effectiveCriterion`
 * below, rather than left for two syncs to fight over.
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

  // The burndown under the filter bar's surface and domain (or its cell) —
  // the one narrowing a count over time can honour; see `burndownFilterOf`.
  // Split into primitives so a search keystroke does not replay the journal.
  const { surface: burnSurface, domain: burnDomain } = burndownFilterOf(filters);
  const findings = data.section?.findings;
  const burndown = useMemo(
    () =>
      deriveFindingsBurndown(data.events, {
        ...(burnSurface !== undefined ? { surface: burnSurface } : {}),
        ...(burnDomain !== undefined ? { domain: burnDomain } : {}),
        findings,
        library: data.library,
      }),
    [data.events, burnSurface, burnDomain, findings, data.library],
  );
  const openNow = useMemo(
    () => countOpenFindings(data.rows, { surface: burnSurface, domain: burnDomain }),
    [data.rows, burnSurface, burnDomain],
  );
  const burnCaption = [burnSurface && `on ${data.surfaceTitles.get(burnSurface) ?? burnSurface}`, burnDomain]
    .filter(Boolean)
    .join(" · ");

  const findingParam = searchParams.get(FINDING_PARAM);
  const criterionParam = searchParams.get(CRITERION_PARAM);
  const surfaceParam = searchParams.get(CRITERION_SURFACE_PARAM);

  /**
   * The criterion this page will actually honour: none, while a finding is
   * addressed.
   *
   * The precedence lives here, in one value, rather than being re-expressed by
   * everything that depends on it. It was written twice — once in `addressed`
   * and once as a `!findingParam` guard in `open` — and both were load-bearing,
   * which is two things that had to keep agreeing about which param wins.
   */
  const effectiveCriterion = findingParam ? null : criterionParam;

  /**
   * The panel the URL names, keyed the way the stack keys it. A finding first,
   * via `effectiveCriterion`: the two params are written mutually exclusive, so
   * a URL carrying both is hand-typed, and this is what settles it.
   */
  const addressed = findingParam
    ? findingPanelKey(findingParam)
    : effectiveCriterion
      ? criterionPanelKey(effectiveCriterion, surfaceParam ?? undefined)
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
   * The row `?finding=` names — the page's existence check. Resolved from the
   * page's own rows because the page has to know whether the id names anything
   * before it opens a panel or clears the param. A `?finding=` naming nothing
   * opens nothing — see the effect below, which is what stops that being
   * permanent.
   *
   * `null` on a cold load too, for as long as the project is in flight, and
   * `useAddressedBottomPanel` survives that on its own: its restore branch
   * re-fires while `seen.current !== addressed`, so the pass on which the rows
   * land is the pass that opens the panel, and the branch that would clear a
   * stale address never runs because nothing was ever seen open.
   *
   * Memoized, which the Matrix page achieves by destructuring `parseCellKey`
   * to primitives and for the same stated reason: `open` closes over this, so
   * an identity that changed every pass would re-run the sync effect for
   * nothing. It happens to be stable anyway — `useQualityData` memoizes `rows`,
   * so `find` returns the same object — but that is an invariant of another
   * module, and this page should not be the thing that depends on it silently.
   */
  const addressedRow = useMemo(
    () => (findingParam ? data.rows.find((row) => row.id === findingParam) ?? null : null),
    [data.rows, findingParam],
  );

  const open = useCallback(() => {
    // Depth 0, explicitly. Both openers default to `previous.length`, which
    // appends — right for Raw, invoked from the header, wrong for a board that
    // lives on this surface. On the default, clicking A then B leaves `[A, B]`
    // and the stack grows with every click.
    if (addressedRow && findingParam) openFinding(findingParam, 0);
    else if (effectiveCriterion) openCriterion(effectiveCriterion, surfaceParam ?? undefined, 0);
  }, [addressedRow, effectiveCriterion, findingParam, openCriterion, openFinding, surfaceParam]);

  useAddressedBottomPanel({
    params: [FINDING_PARAM, CRITERION_PARAM, CRITERION_SURFACE_PARAM],
    addressed,
    open,
    openKey,
  });

  // A `?finding=` that names nothing, once the audit has actually arrived.
  //
  // Nothing else clears it: `open` is a permanent no-op without a row, so the
  // hook never sees the panel open, so its own "the reader closed it" branch —
  // which is gated on having seen it — can never fire. Left alone the dead
  // param rides along into every later write on this page, and, because it
  // wins the precedence above, it suppresses a perfectly resolvable
  // `?criterion=` sitting beside it. A stale link would show the board with no
  // panel and no explanation, and a shared one would keep doing it.
  //
  // Dropping it is deliberate rather than opening the panel onto its own "no
  // finding with that id" body: that body is for a finding that vanishes under
  // a panel already open, where the reader is owed an account of something
  // that was just there. An address that never resolved has nothing to account
  // for — the honest answer is the board, with a URL that matches it.
  //
  // `data.project` rather than `data.loading`, which only covers nodes and
  // edges: `rows` is derived from `project.quality`, so it is legitimately
  // empty while `loading` is already false.
  //
  // This param and no other, which is why it is not the hook's own `clear`:
  // that deletes every key it was given, so on `?finding=<gone>&criterion=X`
  // it would take the resolvable criterion down with the dead finding — the
  // exact case this effect exists to rescue. Dropping only `?finding=` lets
  // `effectiveCriterion` see the criterion on the very next pass, and the
  // hook opens it.
  useEffect(() => {
    if (findingParam && data.project && !addressedRow) {
      writeQuery((params) => params.delete(FINDING_PARAM));
    }
  }, [addressedRow, data.project, findingParam, writeQuery]);

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
    (findingId: string) => {
      openFinding(findingId, 0);
      writeQuery((params) => {
        params.set(FINDING_PARAM, findingId);
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
        <>
          {burndown.points.length > 0 && (
            // Above the board and scrolled away with it: the board's sticky
            // priority headings pin to the scrollport's top, and this is the
            // context read once on arrival, not a header to keep in view.
            <div className="flex flex-col gap-1 border-b p-4">
              <ClosedSinceLine burndown={burndown} openNow={openNow} className="text-xs font-medium text-foreground/80" />
              <BurndownChart burndown={burndown} caption={burnCaption || undefined} className="max-w-3xl" />
            </div>
          )}
          <FindingsBoard
            rows={filtered}
            surfaceTitles={data.surfaceTitles}
            onOpenFinding={handleOpenFinding}
            onOpenCriterion={handleOpenCriterion}
          />
        </>
      )}
    </QualityFrame>
  );
}
