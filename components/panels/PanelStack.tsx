"use client";

import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { isEditableElement } from "@/lib/utils/keyboard";
import { unwindDoomed, visibleWindow, type PanelEntry } from "@/lib/utils/panel-stack";

/**
 * Escape belongs to whatever layer is on top, and Radix marks its open layers
 * in the DOM. With a dialog, popover, or select open over a panel, Escape is
 * theirs — the stack stays put.
 */
const OPEN_OVERLAY_SELECTOR = [
  "[role='dialog'][data-state='open']",
  "[role='alertdialog'][data-state='open']",
  "[role='listbox'][data-state='open']",
  "[role='menu'][data-state='open']",
].join(", ");

interface PanelStackProps<T> {
  entries: PanelEntry<T>[];
  /** The surface — canvas, board, list. It is the grid's first cell, not a backdrop. */
  children: ReactNode;
  labelOf: (entry: PanelEntry<T>) => string;
  /** Panel header content, left of the close button. */
  renderHeader: (entry: PanelEntry<T>, index: number) => ReactNode;
  /** Panel body. Owns its own scroll container. */
  renderBody: (entry: PanelEntry<T>, index: number) => ReactNode;
  onCloseAt: (index: number) => void;
  onUnwindTo: (depth: number) => void;
  /** Fires when the columns change, so a canvas can re-frame itself. */
  onLayoutChange?: () => void;
  /** The surface cell's accessible name. */
  surfaceLabel: string;
  /**
   * Whether the surface renders as a card — a background and a border of its own.
   *
   * Off by default, because most surfaces are already made of cards, tables and
   * blocks, and wrapping those in another card just draws a box around boxes. A
   * canvas is the exception: it has no internal edges, so it needs the cell's.
   * Panels are always cards — they are a distinct thing laid over the page's
   * subject, and the border is what says so.
   */
  surfaceCard?: boolean;
  /** Per-entry visual accent. "editing" draws a dashed destructive border. */
  accentOf?: (entry: PanelEntry<T>, index: number) => "editing" | null | undefined;
  /**
   * Asked for every panel a close would destroy, in the order given — top-down.
   * Not a pure predicate: returning false vetoes and *defers*, and that panel
   * is expected to raise its own confirm and call `resume` once the user has
   * answered.
   *
   * Only the first veto is ever consulted. `resume` commits the whole close and
   * skips every guard not yet asked, so with two vetoing panels in one doomed
   * set the second is destroyed without being asked. That bypass is load-bearing
   * — a panel clears its dirty flag with `setState` and resumes before React has
   * committed it, so a re-guarded resume would read the stale flag and veto
   * forever. Unreachable today: there is one raw panel and node panels never
   * veto. If a second vetoing panel ever ships, the fix is for `commit` to
   * resume the loop from the next index rather than bypass wholesale.
   */
  requestCloseAt?: (index: number, resume: () => void) => boolean;
}

/**
 * The push-panel grid: the surface and its panels are columns side by side,
 * newest on the right. Nothing overlays anything — opening a panel narrows the
 * surface rather than covering it, and the surface slides out of the window
 * once the trail is deep enough to need the room.
 *
 * Two columns, one below 768px. Cells outside the window stay mounted but
 * `hidden`, so a scroll position or an in-progress edit is still there when
 * unwinding brings them back.
 */
export function PanelStack<T>({
  entries,
  children,
  labelOf,
  renderHeader,
  renderBody,
  onCloseAt,
  onUnwindTo,
  onLayoutChange,
  surfaceLabel,
  surfaceCard = false,
  accentOf,
  requestCloseAt,
}: PanelStackProps<T>) {
  const isMobile = useIsMobile();
  const { surfaceVisible, firstVisiblePanel, columnCount } = visibleWindow(
    entries.length,
    isMobile ? 1 : 2,
  );

  const topPanelRef = useRef<HTMLElement | null>(null);
  const restoreFocusRef = useRef(false);

  // Closing a panel with focus inside it would drop focus on the document body
  // and lose the tab position. Hand it to whatever panel is on top afterwards.
  //
  // `doomed` is every panel this close destroys, highest first: an unwind takes
  // a whole suffix, the close button takes exactly one. Each call site says
  // which it is rather than leaving the stack to infer it.
  const runClose = useCallback(
    (doomed: number[], close: () => void, source: HTMLElement | null) => {
      // Captured before asking, not inside `commit`: a veto opens a dialog that
      // takes focus, so by the time the user resumes, focus is in the dialog
      // and the answer would always be no.
      const hadFocus = source?.contains(document.activeElement) ?? false;

      // Single-shot: a panel that resumes twice would commit twice, and the
      // second pass publishes another history entry — leaving one Back unable
      // to undo the close.
      let committed = false;
      const commit = () => {
        if (committed) return;
        committed = true;
        restoreFocusRef.current = hadFocus;
        close();
      };

      if (requestCloseAt) {
        for (const index of doomed) {
          if (!requestCloseAt(index, commit)) return;
        }
      }

      commit();
    },
    [requestCloseAt],
  );

  useEffect(() => {
    if (!restoreFocusRef.current) return;
    restoreFocusRef.current = false;
    topPanelRef.current?.focus();
  }, [entries]);

  // A narrower — or newly revealed — surface is a layout change its content may
  // need to react to; a canvas re-frames rather than showing a clipped corner.
  const layoutKey = `${columnCount}:${surfaceVisible}`;
  const lastLayoutRef = useRef(layoutKey);
  useEffect(() => {
    if (lastLayoutRef.current === layoutKey) return;
    lastLayoutRef.current = layoutKey;
    onLayoutChange?.();
  }, [layoutKey, onLayoutChange]);

  useEffect(() => {
    if (entries.length === 0) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.repeat) return;
      if (isEditableElement(event.target)) return;
      if (document.querySelector(OPEN_OVERLAY_SELECTOR)) return;

      event.preventDefault();
      runClose(
        unwindDoomed(entries.length - 1, entries.length),
        () => onUnwindTo(entries.length - 1),
        topPanelRef.current,
      );
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [entries.length, onUnwindTo, runClose]);

  // The radius and the clip belong to every cell — they define the column's
  // shape, and the clip is what keeps a canvas or a long trail inside it. Only
  // the skin is optional.
  const cellClassName =
    "flex min-w-0 min-h-0 flex-col overflow-hidden bg-card rounded-xl [&[hidden]]:hidden";
  const cardClassName = "bg-card";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className={cn(
          // `grid-rows-1` is load-bearing, not decoration. The default
          // `grid-auto-rows: auto` sizes the single row to its tallest cell, so a
          // long list grew the row past the container, the cell grew with it, and
          // every `h-full`/`flex-1` scroller inside measured the *grown* cell —
          // which is why the Acceptances and Library surfaces could not scroll at
          // all. `minmax(0, 1fr)` pins the row to the container instead, and the
          // cells' own `overflow-hidden` then has something real to clip against.
          "relative grid min-h-0 flex-1 grid-rows-1 gap-3 p-3",
          columnCount === 1 ? "grid-cols-1" : "grid-cols-2",
        )}
      >
        {/*
          The surface leaves the window by going invisible and absolute, not
          `display:none` like the panels: a React Flow canvas measures its
          container, and a zero-sized one renders NaN geometry. Keeping a real
          box also keeps the ELK layout and the viewport intact underneath.
        */}
        <section
          aria-label={surfaceLabel}
          className={cn(
            cellClassName,
            surfaceCard && cardClassName,
            "relative",
            !surfaceVisible && "pointer-events-none invisible absolute inset-3 -z-10",
          )}
        >
          {children}
        </section>

        {entries.map((entry, index) => {
          const isTop = index === entries.length - 1;

          return (
            <section
              key={entry.instanceId}
              ref={isTop ? topPanelRef : undefined}
              hidden={index < firstVisiblePanel}
              tabIndex={-1}
              aria-label={labelOf(entry)}
              className={cn(
                cellClassName,
                cardClassName,
                "outline-none arkaik-panel-enter",
                accentOf?.(entry, index) === "editing" && "border-dashed border-destructive",
              )}
            >
              <header className="flex shrink-0 items-center justify-between gap-2 border-b p-6">
                <div className="flex min-w-0 items-center gap-2">{renderHeader(entry, index)}</div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0 cursor-pointer"
                  aria-label={`Close ${labelOf(entry)}`}
                  onClick={(event) =>
                    runClose([index], () => onCloseAt(index), event.currentTarget.closest("section"))
                  }
                >
                  <XIcon className="size-4" />
                </Button>
              </header>
              {renderBody(entry, index)}
            </section>
          );
        })}
      </div>
    </div>
  );
}
