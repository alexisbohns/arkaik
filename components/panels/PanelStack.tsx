"use client";

import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
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
import { visibleFrom, type PanelEntry } from "@/lib/utils/panel-stack";

/** Kept in step with `.arkaik-panel-exit` in app/globals.css. */
const EXIT_DURATION_MS = 160;

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
  /** The surface behind the stack — the breadcrumb's first crumb. */
  rootLabel: string;
  labelOf: (entry: PanelEntry<T>) => string;
  /** Panel header content, left of the close button. */
  renderHeader: (entry: PanelEntry<T>, index: number) => ReactNode;
  /** Panel body. Owns its own scroll container. */
  renderBody: (entry: PanelEntry<T>, index: number) => ReactNode;
  onCloseAt: (index: number) => void;
  onUnwindTo: (depth: number) => void;
}

/**
 * The push-panel stack: non-modal columns pushed in from the right, trailed by
 * a breadcrumb, popped one at a time with Escape. Content-agnostic — it knows
 * about entries, never about what they show.
 *
 * It renders the two topmost panels (one below 768px) and no more. Deeper
 * entries stay mounted but `hidden`, so a scroll position or an in-progress
 * edit is still there when unwinding brings the panel back.
 */
export function PanelStack<T>({
  entries,
  rootLabel,
  labelOf,
  renderHeader,
  renderBody,
  onCloseAt,
  onUnwindTo,
}: PanelStackProps<T>) {
  const isMobile = useIsMobile();
  const maxVisible = isMobile ? 1 : 2;
  const firstVisible = visibleFrom(entries.length, maxVisible);

  const topPanelRef = useRef<HTMLElement | null>(null);
  const restoreFocusRef = useRef(false);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [closing, setClosing] = useState<PanelEntry<T> | null>(null);

  /**
   * Close from a control inside the stack. Two things the stack owns and its
   * callers shouldn't have to: sliding the departing column back out, and
   * keeping focus in the stack rather than dropping it on the document body.
   *
   * Only a close that takes the top gets the exit animation. Closing further
   * down slides the panels above it into place, and animating the one that
   * left would read as the wrong column leaving.
   */
  const runClose = useCallback(
    (close: () => void, removesTop: boolean, source: HTMLElement | null) => {
      restoreFocusRef.current = source?.contains(document.activeElement) ?? false;

      if (removesTop) {
        setClosing(entries[entries.length - 1] ?? null);
        if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
        exitTimerRef.current = setTimeout(() => setClosing(null), EXIT_DURATION_MS);
      }

      close();
    },
    [entries],
  );

  useEffect(
    () => () => {
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!restoreFocusRef.current) return;
    restoreFocusRef.current = false;
    topPanelRef.current?.focus();
  }, [entries]);

  useEffect(() => {
    if (entries.length === 0) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.repeat) return;
      if (isEditableElement(event.target)) return;
      if (document.querySelector(OPEN_OVERLAY_SELECTOR)) return;

      event.preventDefault();
      runClose(() => onUnwindTo(entries.length - 1), true, topPanelRef.current);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [entries.length, onUnwindTo, runClose]);

  // A panel re-opened before its exit finished is live again, not a ghost.
  const departing =
    closing && !entries.some((entry) => entry.instanceId === closing.instanceId) ? closing : null;

  if (entries.length === 0 && !departing) {
    return null;
  }

  const panelClassName =
    "flex w-full min-w-0 flex-col border-l bg-background outline-none [&[hidden]]:hidden md:w-96";

  return (
    <aside
      aria-label="Node details"
      className="fixed inset-y-0 right-0 z-40 flex w-full flex-col shadow-lg md:w-auto"
    >
      {/* The breadcrumb strip is opaque, not translucent like the app's other
          headers: it sits over the surface's own toolbar, whose buttons must
          not bleed through it. */}
      {entries.length > 0 && (
        <Breadcrumb className="shrink-0 border-b border-l bg-background px-3 py-2">
          <BreadcrumbList className="flex-nowrap overflow-x-auto whitespace-nowrap text-xs">
            <BreadcrumbItem>
              <button
                type="button"
                className="cursor-pointer transition-colors hover:text-foreground"
                onClick={() => runClose(() => onUnwindTo(0), true, topPanelRef.current)}
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
                      <BreadcrumbPage className="max-w-40 truncate">{labelOf(entry)}</BreadcrumbPage>
                    ) : (
                      <button
                        type="button"
                        className="max-w-40 cursor-pointer truncate transition-colors hover:text-foreground"
                        onClick={() =>
                          runClose(() => onUnwindTo(index + 1), true, topPanelRef.current)
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
      )}

      <div className="flex min-h-0 flex-1">
        {entries.map((entry, index) => {
          const isTop = index === entries.length - 1;

          return (
            <section
              key={entry.instanceId}
              ref={isTop ? topPanelRef : undefined}
              hidden={index < firstVisible}
              tabIndex={-1}
              aria-label={labelOf(entry)}
              className={cn(panelClassName, "arkaik-panel-enter")}
            >
              <header className="flex shrink-0 items-center justify-between gap-2 border-b p-6">
                <div className="flex min-w-0 items-center gap-2">{renderHeader(entry, index)}</div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0 cursor-pointer"
                  aria-label={`Close ${labelOf(entry)}`}
                  onClick={(event) =>
                    runClose(
                      () => onCloseAt(index),
                      isTop,
                      event.currentTarget.closest("section"),
                    )
                  }
                >
                  <XIcon className="size-4" />
                </Button>
              </header>
              {renderBody(entry, index)}
            </section>
          );
        })}

        {departing && (
          <section
            key={departing.instanceId}
            aria-hidden
            className={cn(panelClassName, "pointer-events-none arkaik-panel-exit")}
          >
            <header className="flex shrink-0 items-center justify-between gap-2 border-b p-6">
              <div className="flex min-w-0 items-center gap-2">
                {renderHeader(departing, entries.length)}
              </div>
            </header>
            {renderBody(departing, entries.length)}
          </section>
        )}
      </div>
    </aside>
  );
}
