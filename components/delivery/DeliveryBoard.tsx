"use client";

import { useEffect, useRef } from "react";
import { PlatformItemCard } from "@/components/delivery/PlatformItemCard";
import { STATUS_ICONS, STATUS_STYLES } from "@/components/graph/nodes/node-styles";
import type { StatusId } from "@/lib/config/statuses";
import type { DeliveryItem } from "@/lib/utils/delivery";

interface DeliveryBoardProps {
  columns: { status: StatusId; label: string; items: DeliveryItem[] }[];
  speciesLabelById: Record<string, string>;
  speciesDescriptionById: Record<string, string | undefined>;
  onSelectItem: (item: DeliveryItem) => void;
}

/**
 * A plain mouse wheel only ever sends vertical delta, but the board's columns
 * sit side by side — so without this, a mouse-only user has no way to reach a
 * column past the edge of the window (a trackpad's horizontal swipe, or
 * shift+wheel, are the only native escape hatches). Column scroll still wins
 * whenever the column under the cursor has room left to move: this only takes
 * over once that column is exhausted, or was never scrollable to begin with.
 *
 * A genuine horizontal gesture (shift+wheel, a trackpad's horizontal swipe)
 * is driven directly rather than left to the browser's own scroll chaining:
 * a column's `overflow-y: auto` implicitly claims its x-axis too (per the
 * CSS rule that a non-`visible` overflow on one axis forces `visible` to
 * `auto` on the other), so once the cursor is over a column the browser
 * treats *it* as the horizontal scroll target and never chains the delta up
 * to the board — even though the column itself has nothing to move.
 *
 * A native listener, not React's `onWheel` — React attaches wheel listeners
 * as passive, which silently drops `preventDefault` and logs a console
 * warning on every tick.
 */
function useBoardWheelPan(boardRef: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;

    function handleWheel(event: WheelEvent) {
      if ((event.deltaX === 0 && event.deltaY === 0) || board!.scrollWidth <= board!.clientWidth) return;

      if (event.deltaX !== 0) {
        board!.scrollLeft += event.deltaX;
        event.preventDefault();
        return;
      }

      const columnList = (event.target as HTMLElement).closest<HTMLElement>("[data-delivery-column-list]");
      if (columnList) {
        const canColumnScroll =
          (event.deltaY > 0 && columnList.scrollTop + columnList.clientHeight < columnList.scrollHeight - 1) ||
          (event.deltaY < 0 && columnList.scrollTop > 0);
        if (canColumnScroll) return;
      }

      board!.scrollLeft += event.deltaY;
      event.preventDefault();
    }

    board.addEventListener("wheel", handleWheel, { passive: false });
    return () => board.removeEventListener("wheel", handleWheel);
  }, [boardRef]);
}

/** Status columns of (node × platform) items — the product-centered board. */
export function DeliveryBoard({ columns, speciesLabelById, speciesDescriptionById, onSelectItem }: DeliveryBoardProps) {
  const boardRef = useRef<HTMLDivElement>(null);
  useBoardWheelPan(boardRef);

  return (
    <div ref={boardRef} className="flex min-h-0 flex-1 overflow-x-auto border bg-card rounded-xl">
      {columns.map(({ status, label, items }) => {
        const StatusIcon = STATUS_ICONS[status];

        return (
          <section key={status} className="flex w-72 shrink-0 flex-col px-2">
            <header className="flex items-center gap-2 rounded-b-xl bg-background border border-t-0 px-3 py-2.5">
              <StatusIcon className={`size-4 ${STATUS_STYLES[status].badge}`} aria-hidden="true" />
              <h2 className="text-sm font-medium">{label}</h2>
              <span className="ml-auto rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                {items.length}
              </span>
            </header>
            <div data-delivery-column-list className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
              {items.length === 0 ? (
                <div className="rounded-lg border border-dashed p-4 text-center">
                  <p className="text-xs text-muted-foreground">Nothing here</p>
                </div>
              ) : (
                items.map((item) => (
                  <PlatformItemCard
                    key={`${item.node.id}:${item.platform}`}
                    item={item}
                    speciesLabel={speciesLabelById[item.node.species] ?? item.node.species}
                    speciesDescription={speciesDescriptionById[item.node.species]}
                    onClick={() => onSelectItem(item)}
                  />
                ))
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
