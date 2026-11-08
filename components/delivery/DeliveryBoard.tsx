"use client";

import { useEffect, useRef } from "react";
import { PlatformItemCard } from "@/components/delivery/PlatformItemCard";
import { STATUS_ICONS, STATUS_STYLES } from "@/components/graph/nodes/node-styles";
import type { StatusId } from "@/lib/config/statuses";
import type { DeliveryItem } from "@/lib/utils/delivery";
import { cn } from "@/lib/utils";

interface DeliveryBoardProps {
  columns: { status: StatusId; label: string; items: DeliveryItem[] }[];
  speciesLabelById: Record<string, string>;
  speciesDescriptionById: Record<string, string | undefined>;
  onSelectItem: (item: DeliveryItem) => void;
  /** One-line cards — see `PlatformItemCard`. */
  compact?: boolean;
  /** Extra classes on the board — a frame, where it is not the surface itself (the landing preview). */
  className?: string;
}

/** Quiet time after which the next wheel event starts a new gesture. */
const GESTURE_IDLE_MS = 160;
/** `WheelEvent.deltaMode` 1 is lines (Firefox with a mouse); a line is ~16px. */
const LINE_HEIGHT_PX = 16;

/** What a wheel gesture moves — chosen once, on its first event. */
type WheelTarget =
  | { kind: "board" }
  | { kind: "column"; element: HTMLElement };

/**
 * Wheel handling for the board: one axis per gesture, never both.
 *
 * The board scrolls sideways and each column scrolls down, so a trackpad swipe
 * that is not perfectly straight used to move both at once — the column under
 * the cursor took the vertical part and the board took the horizontal part,
 * and the board drifted diagonally. A gesture is a stream of wheel events with
 * no begin or end, so it is delimited by time: the first event after a quiet
 * {@link GESTURE_IDLE_MS} picks the target from its dominant axis, and every
 * event until the wheel goes quiet again drives only that target, with only
 * that axis's delta. Momentum scrolling arrives as more wheel events, so it
 * stays on the same rail.
 *
 * The target, picked on the gesture's first event:
 * - **mostly horizontal** (a sideways swipe, shift+wheel) → the board;
 * - **mostly vertical, over a column that can still move that way** → that
 *   column. It keeps the gesture even once it hits its end, so a fling down a
 *   short column stops there instead of veering off sideways;
 * - **mostly vertical otherwise** → the board, sideways. A plain mouse wheel
 *   only ever sends vertical delta, and this is how a mouse-only reader reaches
 *   a column past the edge of the window.
 *
 * Both are driven here, with `preventDefault`, rather than left to the browser:
 * a column's `overflow-y: auto` implicitly claims its x-axis too (a non-
 * `visible` overflow on one axis forces `auto` on the other), so native
 * chaining would never hand a horizontal delta from a column up to the board —
 * and leaving either axis native is exactly what let the two run together.
 *
 * A native listener, not React's `onWheel` — React attaches wheel listeners as
 * passive, which silently drops `preventDefault`.
 */
function useBoardWheelPan(boardRef: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;

    let target: WheelTarget | null = null;
    let lastEventAt = -Infinity;

    function canScrollVertically(element: HTMLElement, deltaY: number) {
      return (
        (deltaY > 0 && element.scrollTop + element.clientHeight < element.scrollHeight - 1) ||
        (deltaY < 0 && element.scrollTop > 0)
      );
    }

    function handleWheel(event: WheelEvent) {
      const scale = event.deltaMode === 1 ? LINE_HEIGHT_PX : 1;
      // Shift turns a vertical wheel sideways on every platform; some browsers
      // already swap the deltas for it, some do not, so normalise here.
      const deltaX = (event.shiftKey && event.deltaX === 0 ? event.deltaY : event.deltaX) * scale;
      const deltaY = (event.shiftKey && event.deltaX === 0 ? 0 : event.deltaY) * scale;
      if (deltaX === 0 && deltaY === 0) return;

      if (event.timeStamp - lastEventAt > GESTURE_IDLE_MS) target = null;
      lastEventAt = event.timeStamp;

      if (target === null) {
        const column = (event.target as HTMLElement).closest<HTMLElement>("[data-delivery-column-list]");
        target =
          Math.abs(deltaY) > Math.abs(deltaX) && column && canScrollVertically(column, deltaY)
            ? { kind: "column", element: column }
            : { kind: "board" };
      }

      if (target.kind === "column") {
        target.element.scrollTop += deltaY;
        event.preventDefault();
        return;
      }

      // The board takes whichever axis the gesture is made of — sideways as is,
      // or a vertical wheel turned sideways — but never both components summed.
      const delta = Math.abs(deltaX) >= Math.abs(deltaY) ? deltaX : deltaY;
      // Nothing to pan: leave the event to the browser, so a page around a
      // board that fits (the landing preview) still scrolls under the cursor.
      // There is no second axis to mix with here — the board cannot move.
      if (board!.scrollWidth <= board!.clientWidth) return;
      board!.scrollLeft += delta;
      event.preventDefault();
    }

    board.addEventListener("wheel", handleWheel, { passive: false });
    return () => board.removeEventListener("wheel", handleWheel);
  }, [boardRef]);
}

/** Status columns of (node × platform) items — the product-centered board. */
export function DeliveryBoard({
  columns,
  speciesLabelById,
  speciesDescriptionById,
  onSelectItem,
  compact = false,
  className,
}: DeliveryBoardProps) {
  const boardRef = useRef<HTMLDivElement>(null);
  useBoardWheelPan(boardRef);

  return (
    // No frame of its own: the board IS the surface, flush to its edges under
    // the toolbar — a bordered card here was a box drawn inside the box.
    <div ref={boardRef} className={cn("flex min-h-0 flex-1 gap-3 overflow-x-auto p-3", className)}>
      {columns.map(({ status, label, items }) => {
        const StatusIcon = STATUS_ICONS[status];

        return (
          // Each column is its own wash of the status's colour, so the board
          // reads as lanes at a glance; the cards inside sit on it unframed.
          <section
            key={status}
            className={cn("flex w-72 shrink-0 flex-col overflow-hidden rounded-xl", STATUS_STYLES[status].surface)}
          >
            <header className="flex items-center gap-2 px-3 pt-3 pb-1">
              <StatusIcon className={`size-4 ${STATUS_STYLES[status].badge}`} aria-hidden="true" />
              <h2 className="text-sm font-medium">{label}</h2>
              <span className="ml-auto rounded-full px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
                {items.length}
              </span>
            </header>
            <div
              data-delivery-column-list
              className={cn("flex min-h-0 flex-1 flex-col overflow-y-auto p-2", compact ? "gap-1" : "gap-2")}
            >
              {items.length === 0 ? (
                <div className="rounded-lg border border-dashed border-foreground/15 p-4 text-center">
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
                    compact={compact}
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
