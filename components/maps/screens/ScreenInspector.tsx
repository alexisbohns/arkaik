"use client";

import type { KeyboardEvent } from "react";
import { ExternalLinkIcon, HistoryIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  PLATFORM_ICONS,
  SPECIES_ICONS,
  STATUS_LABELS,
  STATUS_STYLES,
  SYSTEM_LAYER_STYLES,
} from "@/components/graph/nodes/node-styles";
import type { WallSelection } from "@/components/graph/nodes/wall-node-data";
import { INSPECTOR_FOCUSABLE, SCREEN_INSPECTOR_ID } from "@/components/graph/nodes/wall-inspector";
import { cn } from "@/lib/utils";
import { inspectorRows, stripLinks, type InspectorTone } from "@/lib/utils/screen-inspector";
import type { Wall } from "@/lib/utils/screen-wall";

export interface ScreenInspectorProps {
  wall: Wall;
  selection: WallSelection;
  /** "Open panel" and the Touches list. */
  onOpenPanel: (nodeId: string) => void;
  /** "Also in …". */
  onGoToStrip: (stripId: string) => void;
}

/** The state word's badge: green for a current live shot, amber for a gap, muted otherwise. Colour is never alone: the word says it. */
const TONE_STYLES: Record<InspectorTone, string> = {
  live: "border-tone-green/40 text-tone-green",
  gap: "border-tone-amber/50 text-tone-amber",
  quiet: "border-border text-muted-foreground",
};

const TOUCH_KINDS: Record<"api-endpoint" | "data-model", string> = {
  "api-endpoint": "Endpoint",
  "data-model": "Data model",
};

/**
 * The Screens map's quick inspector (docs/superpowers/specs/2026-11-11-screens-map-design.md
 * § Interaction): for the selected frame's view, one row per platform of the
 * wall (state, shot date, who recorded it, why it may be stale, how it went
 * live where the journal can tell), the strips it appears in, the endpoints and
 * data models it touches (the keyboard twin of the chips), and "Open panel".
 *
 * A named region (`SCREEN_INSPECTOR_ID`): the selected frame controls and is
 * described by it, Tab from that frame enters it and Shift+Tab from its first
 * control returns to the frame.
 *
 * Not a panel kind: an overlay in the canvas cell, outside React Flow, so the
 * wheel scrolls it instead of zooming the wall. Top-right and 320px wide; in a
 * container narrower than 40rem, a bottom sheet above the bar, at most half the
 * cell tall — `INSPECTOR_SHEET_REM` and `INSPECTOR_SHEET_MAX_H` in
 * lib/utils/screen-inspector.ts, which the selection camera reads too (a test
 * holds these literals to them). It scrolls vertically only (the overscroll trap in globals.css
 * catches `.overflow-x-auto`). Its wording comes from lib/utils/screen-inspector.ts.
 */
export function ScreenInspector({ wall, selection, onOpenPanel, onGoToStrip }: ScreenInspectorProps) {
  const screen = wall.screens.get(selection.viewId);
  if (!screen) return null;
  const rows = inspectorRows(wall, screen);
  const { current, also } = stripLinks(wall, screen, selection.stripId);

  // Tab from the selected frame lands on the first control here (WallFrameNode);
  // Shift+Tab from that control goes back to the frame rather than to whatever
  // precedes the inspector in the page.
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab" || !event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
    const first = event.currentTarget.querySelector<HTMLElement>(INSPECTOR_FOCUSABLE);
    if (event.target !== first) return;
    const frame = document.querySelector<HTMLElement>(`[data-wall-frame="${CSS.escape(selection.frameId)}"]`);
    if (!frame) return;
    event.preventDefault();
    frame.focus({ preventScroll: true });
  };

  return (
    <section
      id={SCREEN_INSPECTOR_ID}
      role="region"
      aria-label={`${screen.title} on the wall`}
      onKeyDown={handleKeyDown}
      className={cn(
        "absolute top-3 right-3 z-20 flex max-h-[calc(100%-6rem)] w-80 flex-col gap-3 overflow-y-auto rounded-xl border bg-card p-4 text-sm shadow-lg",
        "@max-[40rem]:top-auto @max-[40rem]:bottom-[72px] @max-[40rem]:left-3 @max-[40rem]:max-h-[50%] @max-[40rem]:w-auto",
      )}
    >
      <header className="flex flex-col gap-1">
        <h2 className="text-base leading-tight font-semibold break-words">{screen.title}</h2>
        {current && <p className="text-xs text-muted-foreground">In {current.title}</p>}
        {also.length > 0 && (
          <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span>Also in</span>
            {also.map((link) => (
              <Button
                key={link.stripId}
                type="button"
                variant="link"
                size="sm"
                className="h-auto cursor-pointer p-0 text-xs"
                onClick={() => onGoToStrip(link.stripId)}
              >
                {link.title}
              </Button>
            ))}
          </p>
        )}
      </header>

      <ul aria-label="Platforms" className="flex flex-col gap-2">
        {rows.map((row) => {
          const PlatformIcon = PLATFORM_ICONS[row.platform];
          return (
            <li key={row.platform} data-platform={row.platform} className="flex flex-col gap-1 rounded-lg border p-2">
              <div className="flex items-center gap-2">
                <PlatformIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="font-medium">{row.platformLabel}</span>
                {row.status && <span className="text-xs text-muted-foreground">{row.status}</span>}
                <span className={cn("ml-auto rounded-md border px-1.5 py-0.5 text-xs font-medium", TONE_STYLES[row.tone])}>
                  {row.word}
                </span>
              </div>
              {row.shot && <p className="text-xs text-muted-foreground">{row.shot}</p>}
              {row.stale && (
                <p className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                  <HistoryIcon className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 break-words">{row.stale}</span>
                </p>
              )}
              {row.proof && <p className="text-xs break-words text-muted-foreground">{row.proof}</p>}
            </li>
          );
        })}
      </ul>

      {screen.touches.length > 0 && (
        <div className="flex flex-col gap-1">
          <h3 className="text-xs font-medium text-muted-foreground">Touches</h3>
          <ul className="flex flex-col gap-0.5">
            {screen.touches.map((touch) => {
              const Icon = SPECIES_ICONS[touch.species];
              return (
                <li key={touch.nodeId}>
                  <button
                    type="button"
                    data-touch={touch.nodeId}
                    className="flex w-full cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => onOpenPanel(touch.nodeId)}
                  >
                    <Icon className={cn("size-3.5 shrink-0", SYSTEM_LAYER_STYLES[touch.species].icon)} aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">{touch.title}</span>
                    <span className="sr-only">
                      , {TOUCH_KINDS[touch.species]}, {STATUS_LABELS[touch.status]}
                    </span>
                    <span className={cn("size-2 shrink-0 rounded-full", STATUS_STYLES[touch.status].dot)} aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="cursor-pointer self-start"
        onClick={() => onOpenPanel(screen.viewId)}
      >
        <ExternalLinkIcon aria-hidden="true" />
        Open panel
      </Button>
    </section>
  );
}
