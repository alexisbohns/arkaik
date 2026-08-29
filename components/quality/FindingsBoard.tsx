"use client";

import type { Node } from "@/lib/data/types";
import type { PriorityGroup } from "@/lib/utils/quality";
import { EmptyState } from "@/components/ui/empty-state";
import { FindingCard } from "@/components/quality/FindingCard";
import { PRIORITY_CHIP, PRIORITY_HINT } from "@/components/quality/quality-styles";
import { cn } from "@/lib/utils";

interface FindingsBoardProps {
  /** Every lane, worst first — `groupByPriority` keeps the empty ones. */
  groups: PriorityGroup[];
  nodesById: ReadonlyMap<string, Node>;
  /** `surface id -> title`, built once on the page and handed to every card. */
  surfaceTitles: ReadonlyMap<string, string>;
  onOpenNode: (nodeId: string) => void;
  onOpenCriterion: (criterionId: string, surface: string) => void;
}

/**
 * The findings, in vertical priority sections with pinning headings.
 *
 * Sections stacked down the page rather than kanban lanes across it, and that
 * is a layout decision with a reason: the matrix above is already wide enough
 * to need its own horizontal scrollport, and four columns beneath it would give
 * the page a second one while squeezing finding titles that routinely run past
 * a hundred characters. Down the page each title gets the full width.
 *
 * The heading treatment is `AcceptanceMatrix`'s anchor groups: flush to the
 * surface's edges, `bg-card` behind them because rows read straight through a
 * transparent pinned band, and each one pinning as you scroll past it. Without
 * that, a section heading scrolling away leaves a wall of cards with no way to
 * tell which lane you are reading.
 */
export function FindingsBoard({
  groups,
  nodesById,
  surfaceTitles,
  onOpenNode,
  onOpenCriterion,
}: FindingsBoardProps) {
  // Four headings each announcing nothing is a board that looks broken rather
  // than filtered — so when the whole set is empty, one sentence replaces all
  // of it. `every` is also the right answer for a `groups` that is itself
  // empty, which is what a page renders before its bundle resolves.
  if (groups.every((group) => group.rows.length === 0)) {
    return (
      <div className="p-4">
        <EmptyState message="No findings match these filters." />
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {groups.map((group) => (
        <section key={group.priority}>
          {/*
            Pinned against `--surface-sticky-top`, the variable `PageSurface`
            publishes so nothing has to hard-code the toolbar's height. The
            `0px` fallback is load-bearing rather than defensive: `PageSurface
            fill` — which is how the Quality page mounts, the toolbar being a
            sibling of the scrollport rather than inside it — does not set the
            variable at all, and `top: var(--undefined)` computes to `auto`,
            which is a sticky heading that does not stick. At `0px` it pins to
            the scrollport's own top edge, which in `fill` is exactly the
            toolbar's hairline.
          */}
          <h3 className="sticky top-[var(--surface-sticky-top,0px)] z-10 flex items-center gap-2 border-b bg-card px-4 py-2.5">
            <span className={cn("rounded border px-1.5 py-0.5 text-xs font-medium", PRIORITY_CHIP[group.priority])}>
              {group.priority}
            </span>
            <span className="text-sm text-muted-foreground">{PRIORITY_HINT[group.priority]}</span>
            <span className="ms-auto text-xs text-muted-foreground">
              {group.rows.length} finding{group.rows.length === 1 ? "" : "s"}
            </span>
          </h3>

          {group.rows.length === 0 ? (
            // Stated, not skipped: a lane that silently disappears when it is
            // empty reads as a lane that failed to load, and "none at this
            // priority" is the good news.
            <p className="px-4 py-3 text-sm text-muted-foreground">None at this priority.</p>
          ) : (
            <ul className="flex flex-col gap-2 p-4">
              {group.rows.map((row) => (
                <li key={row.id}>
                  <FindingCard
                    row={row}
                    nodesById={nodesById}
                    surfaceTitles={surfaceTitles}
                    onOpenNode={onOpenNode}
                    onOpenCriterion={onOpenCriterion}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
