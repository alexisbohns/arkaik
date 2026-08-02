"use client";

import { Fragment, useCallback, useEffect, useRef, type ReactNode } from "react";
import { XIcon } from "lucide-react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { isEditableElement } from "@/lib/utils/keyboard";
import { visibleWindow, type PanelEntry } from "@/lib/utils/panel-stack";

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
  /** The surface's name, for the breadcrumb's first crumb. */
  rootLabel: string;
  labelOf: (entry: PanelEntry<T>) => string;
  /** Panel header content, left of the close button. */
  renderHeader: (entry: PanelEntry<T>, index: number) => ReactNode;
  /** Panel body. Owns its own scroll container. */
  renderBody: (entry: PanelEntry<T>, index: number) => ReactNode;
  onCloseAt: (index: number) => void;
  onUnwindTo: (depth: number) => void;
  /** Fires when the columns change, so a canvas can re-frame itself. */
  onLayoutChange?: () => void;
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
  rootLabel,
  labelOf,
  renderHeader,
  renderBody,
  onCloseAt,
  onUnwindTo,
  onLayoutChange,
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
  const runClose = useCallback((close: () => void, source: HTMLElement | null) => {
    restoreFocusRef.current = source?.contains(document.activeElement) ?? false;
    close();
  }, []);

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
      runClose(() => onUnwindTo(entries.length - 1), topPanelRef.current);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [entries.length, onUnwindTo, runClose]);

  const cellClassName =
    "flex min-w-0 min-h-0 flex-col overflow-hidden rounded-xl border bg-background [&[hidden]]:hidden";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {entries.length > 0 && (
        <div className="flex shrink-0 items-center gap-3 border-b px-4 py-2">
          <Breadcrumb className="min-w-0 flex-1">
            <BreadcrumbList className="flex-nowrap overflow-x-auto whitespace-nowrap text-xs">
              <BreadcrumbItem>
                <button
                  type="button"
                  className="cursor-pointer transition-colors hover:text-foreground"
                  onClick={() => runClose(() => onUnwindTo(0), topPanelRef.current)}
                >
                  {rootLabel}
                </button>
              </BreadcrumbItem>
              {entries.map((entry, index) => {
                const isLast = index === entries.length - 1;

                // The separator is a sibling `<li>`, never a child of one.
                return (
                  <Fragment key={entry.instanceId}>
                    <BreadcrumbSeparator />
                    <BreadcrumbItem>
                      {isLast ? (
                        <BreadcrumbPage className="max-w-48 truncate">
                          {labelOf(entry)}
                        </BreadcrumbPage>
                      ) : (
                        <button
                          type="button"
                          className="max-w-48 cursor-pointer truncate transition-colors hover:text-foreground"
                          onClick={() =>
                            runClose(() => onUnwindTo(index + 1), topPanelRef.current)
                          }
                        >
                          {labelOf(entry)}
                        </button>
                      )}
                    </BreadcrumbItem>
                  </Fragment>
                );
              })}
            </BreadcrumbList>
          </Breadcrumb>
          <span className="hidden shrink-0 text-xs text-muted-foreground md:inline">
            esc closes the last panel
          </span>
        </div>
      )}

      <div
        className={cn(
          "relative grid min-h-0 flex-1 gap-3 p-3",
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
          aria-label={rootLabel}
          className={cn(
            cellClassName,
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
              className={cn(cellClassName, "outline-none arkaik-panel-enter")}
            >
              <header className="flex shrink-0 items-center justify-between gap-2 border-b p-6">
                <div className="flex min-w-0 items-center gap-2">{renderHeader(entry, index)}</div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0 cursor-pointer"
                  aria-label={`Close ${labelOf(entry)}`}
                  onClick={(event) =>
                    runClose(() => onCloseAt(index), event.currentTarget.closest("section"))
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
