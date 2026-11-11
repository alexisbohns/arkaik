"use client";

import { memo, useContext, type KeyboardEvent } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { PlatformId } from "@/lib/config/platforms";
import { cn } from "@/lib/utils";
import { cellWord, type PlatformCell } from "@/lib/utils/screen-wall";
import {
  CAPTION_GAP,
  CAPTION_H,
  FRAME_H,
  SIDE_ROW_GAP,
  SIDE_TAG_GAP,
  SIDE_TAG_W,
  SIDE_WORD_GAP,
  SIDE_WORD_W,
} from "@/lib/utils/screen-wall-layout";
import { TOUCH_TRUNK_X } from "@/lib/utils/screen-inspector";
import { formatShotDate } from "@/lib/utils/screenshot-ops";
import { PLATFORM_ICONS, PLATFORM_LABELS, STATUS_LABELS, STATUS_STYLES } from "./node-styles";
import { INSPECTOR_FOCUSABLE, WallInspectorContext } from "./wall-inspector";
import type { WallFrameData } from "./wall-node-data";
import { WallMiniShot, WallShot, useWallDetail } from "./WallShot";

/** Arrow keys on a focused frame → the neighbour direction (spec § Keys). */
const ARROW_DIRECTIONS: Readonly<Record<string, "left" | "right" | "up" | "down">> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
};

/** "live, shot current, 11/3/2026" — one platform's reading, for the frame's accessible name. */
function cellPhrase(cell: PlatformCell | undefined): string {
  if (!cell || cell.state === "absent") return "not on this platform";
  const date = cell.shot?.ts ? formatShotDate(cell.shot.ts) : undefined;
  const dated = (text: string) => (date ? `${text}, ${date}` : text);
  if (cell.state === "live-current") return dated("live, shot current");
  if (cell.state === "live-stale") return dated("live, shot may be stale");
  if (cell.state === "live-no-shot") return "live, no shot yet";
  const status = cell.status === null ? "no status" : STATUS_LABELS[cell.status].toLowerCase();
  return cell.shot ? `${status}, has a shot` : status;
}

/** Ends a clause with a full stop unless it already ends in punctuation ("Has a streak?"). */
function sentence(text: string): string {
  return /[.?!]$/.test(text) ? text : `${text}.`;
}

/**
 * Gaps only (spec § Parts, part 3): what is not a gap fades — frames, markers
 * and jump tiles to 15% and greyscale, a header whose strip holds no gap to
 * 40%. Nothing becomes unclickable, and focus inside lifts the fade, so a
 * faded node never hides its focus ring.
 */
export function wallDimClass(dimmed: boolean, strength: "strong" | "soft" = "strong"): string {
  return cn(
    "h-full w-full transition-[opacity,filter] duration-200 motion-reduce:transition-none",
    dimmed && (strength === "strong" ? "opacity-15 grayscale" : "opacity-40"),
    dimmed && "focus-within:opacity-100 focus-within:grayscale-0",
  );
}

/**
 * The longest word the state column holds at `text-xs`. The column is
 * `SIDE_WORD_W` (72px), fixed by part 1's `sideGeometry`: "Discovery" and
 * "Releasing" (9 characters) fit it, "Development" — the longest status label
 * in lib/config/statuses.ts — does not. A longer word steps down to 11px,
 * still on one line, so every row's word starts and centres where the
 * others' do and none is cut to "Developme…" (Geist medium: 75px at 12px,
 * 66px at 11px with tight tracking).
 */
const SIDE_WORD_FIT = 9;

function sideWordSize(word: string): string {
  return word.length > SIDE_WORD_FIT ? "text-[11px] tracking-tight" : "text-xs";
}

function sideWordClass(cell: PlatformCell | undefined): string {
  if (!cell) return "text-muted-foreground";
  switch (cell.state) {
    case "live-current":
      return STATUS_STYLES.live.badge;
    case "live-stale":
    case "live-no-shot":
      return "text-amber-700 dark:text-amber-400";
    case "not-live":
      return cell.status === null ? "text-muted-foreground" : STATUS_STYLES[cell.status].badge;
    case "absent":
      return "text-muted-foreground";
  }
}

/** One platform's state as the frame's accessible description reads it. */
function sideSpokenWord(cell: PlatformCell | undefined): string {
  if (!cell || cell.state === "absent") return "not on this platform";
  switch (cell.state) {
    case "live-current":
      return "live";
    case "live-stale":
      return "stale";
    case "live-no-shot":
      return "live, no shot yet";
    case "not-live":
      return cell.status === null ? "no status" : cellWord(cell).toLowerCase();
  }
}

/** The frame's subject, as both lenses open their label: "Check-in sheet, Daily check-in[, in Yes of Has a streak?]." */
function frameSubject(data: Pick<WallFrameData, "screen" | "stripTitle" | "armContext">): string {
  const { screen, stripTitle, armContext } = data;
  return sentence(armContext ? `${screen.title}, ${stripTitle}, ${armContext}` : `${screen.title}, ${stripTitle}`);
}

/** "Check-in sheet, Daily check-in. Web: stale. iOS: live. Android: not on this platform." (spec § Accessibility). */
function sideAriaLabel(data: WallFrameData): string {
  const subject = frameSubject(data);
  const rows = data.platforms.map(
    (platform) => `${PLATFORM_LABELS[platform]}: ${sideSpokenWord(data.screen.cells[platform])}.`,
  );
  return [subject, ...rows].join(" ");
}

/** The caption's state line side by side, in the strip header's grammar: "2/3 live · 1 stale". */
function sideStateLine(data: WallFrameData): string {
  let on = 0;
  let live = 0;
  let stale = 0;
  let noShot = 0;
  for (const platform of data.platforms) {
    const cell = data.screen.cells[platform];
    if (!cell || cell.state === "absent") continue;
    on += 1;
    if (cell.state === "live-current" || cell.state === "live-stale" || cell.state === "live-no-shot") live += 1;
    if (cell.state === "live-stale") stale += 1;
    if (cell.state === "live-no-shot") noShot += 1;
  }
  return `${live}/${on} live` + (stale > 0 ? ` · ${stale} stale` : "") + (noShot > 0 ? ` · ${noShot} without a shot` : "");
}

/**
 * The side-by-side box (spec § Layout): one row per platform of the scope —
 * platform tag, mini, one-word state. Rows share FRAME_H with SIDE_ROW_GAP
 * between them; the mini column is what the layout left between the tag and
 * the word, so the box is exactly `data.shotWidth` wide.
 */
function WallSideBox({ data }: { data: WallFrameData }) {
  const rows = Math.max(data.platforms.length, 1);
  const rowHeight = (FRAME_H - (rows - 1) * SIDE_ROW_GAP) / rows;
  const column = Math.max(data.shotWidth - SIDE_TAG_W - SIDE_TAG_GAP - SIDE_WORD_GAP - SIDE_WORD_W, 1);

  return (
    <div
      className="flex shrink-0 flex-col"
      style={{ width: data.shotWidth, height: FRAME_H, rowGap: SIDE_ROW_GAP }}
      data-side-box=""
    >
      {data.platforms.map((platform) => {
        const cell = data.screen.cells[platform];
        const word = cell ? cellWord(cell) : "Absent";
        const faded = data.dimmedRows.includes(platform);
        const PlatformIcon = PLATFORM_ICONS[platform];
        return (
          <div
            key={platform}
            className={cn(
              "flex items-center transition-opacity duration-200 motion-reduce:transition-none",
              faded && "opacity-35",
            )}
            style={{ height: rowHeight }}
            data-platform={platform}
            data-word={word}
            data-row-dimmed={faded ? "true" : "false"}
          >
            <span
              className="flex shrink-0 items-center justify-center text-muted-foreground"
              style={{ width: SIDE_TAG_W }}
              title={PLATFORM_LABELS[platform]}
            >
              <PlatformIcon aria-hidden className="size-3.5" />
            </span>
            <div
              className="flex shrink-0 items-center"
              style={{ width: column, height: rowHeight, marginLeft: SIDE_TAG_GAP }}
            >
              <WallMiniShot
                viewId={data.viewId}
                platform={platform}
                cell={cell}
                height={rowHeight}
                maxWidth={column}
                onAspect={data.onAspect}
              />
            </div>
            <span
              className={cn("truncate font-medium", sideWordSize(word), sideWordClass(cell))}
              style={{ width: SIDE_WORD_W, marginLeft: SIDE_WORD_GAP }}
            >
              {word}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * One screen on the wall: the lens platform's shot (or its ghost) at the
 * frame's own proportions, captioned with the view's title and the state word.
 *
 * The whole frame is the control — `role="button"`, in the layout's reading
 * order — and it activates from its own element (click, Enter, Space), never
 * through `Canvas`'s `onNodeClick`: the React Flow node is built non-focusable
 * and non-selectable, so focus lives here. The image is decorative; this
 * element's `aria-label` says what the frame shows.
 *
 * `pointer-events-auto` is load-bearing: React Flow gives a node that is not
 * selectable, not draggable and has no node handlers `pointer-events: none`,
 * so without it no click would ever reach this element.
 */
function WallFrameNodeComponent({ data }: NodeProps<Node<WallFrameData, "wallFrame">>) {
  const { frameId, viewId, stripId, screen, lens, shotWidth, onActivate, onAspect } = data;
  const detailed = useWallDetail();
  // One platform per frame, or null side by side: the side box draws every
  // row of the scope itself (`WallSideBox`), so nothing below indexes a cell
  // by a lens that is not a platform.
  const platform: PlatformId | null = lens === "side" ? null : lens;
  const cell = platform === null ? undefined : screen.cells[platform];
  const date = cell?.shot?.ts ? formatShotDate(cell.shot.ts) : undefined;
  const word = cell ? cellWord(cell) : "Absent";

  const where = frameSubject(data);
  const label =
    platform === null
      ? sideAriaLabel(data)
      : `${where} ${sentence(`${PLATFORM_LABELS[platform]}: ${cellPhrase(cell)}`)}`;
  const stateLine = platform === null ? sideStateLine(data) : date && cell?.shot ? `${word} · ${date}` : word;

  // The selected frame is wired to the inspector while it shows: it controls
  // and is described by that region, and Tab moves straight into it (it sits
  // after the whole canvas in the page, so the natural order would walk every
  // other frame first). Shift+Tab from the inspector's first control comes
  // back here (ScreenInspector).
  const inspectorId = useContext(WallInspectorContext);
  const inspector = data.selected && inspectorId !== null ? inspectorId : undefined;

  const activate = () => onActivate(frameId, viewId, stripId);
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (inspector && event.key === "Tab" && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
      const first = document.getElementById(inspector)?.querySelector<HTMLElement>(INSPECTOR_FOCUSABLE);
      if (first) {
        event.preventDefault();
        first.focus();
      }
      return;
    }
    const direction = ARROW_DIRECTIONS[event.key];
    if (direction && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      data.onMove(data.frameId, direction);
      return;
    }
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    activate();
  };

  return (
    <div className={cn(wallDimClass(data.dimmed), "relative")} data-dimmed={data.dimmed ? "true" : "false"}>
      <div
        role="button"
        tabIndex={0}
        aria-label={label}
        aria-current={data.selected ? "true" : undefined}
        aria-controls={inspector}
        aria-describedby={inspector}
        data-wall-frame={data.frameId}
        onClick={activate}
        onKeyDown={handleKeyDown}
        className={cn(
          "group/wall-frame pointer-events-auto flex h-full w-full cursor-pointer flex-col items-center rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background",
          data.selected && "ring-2 ring-primary ring-offset-4 ring-offset-background",
        )}
      >
        {platform === null ? (
          <WallSideBox data={data} />
        ) : (
          <div className="shrink-0 rounded-md shadow-sm transition-shadow group-hover/wall-frame:shadow-md">
            <WallShot
              viewId={viewId}
              platform={platform}
              cell={cell}
              width={shotWidth}
              height={FRAME_H}
              onAspect={onAspect}
            />
          </div>
        )}
        <div
          className="flex w-full min-w-0 flex-col justify-center gap-0.5 px-1"
          style={{ marginTop: CAPTION_GAP, height: CAPTION_H }}
        >
          {detailed && (
            <>
              <span className="truncate text-xs font-medium leading-tight" title={screen.title}>
                {screen.title}
              </span>
              <span className="truncate text-[11px] leading-tight text-muted-foreground">{stateLine}</span>
            </>
          )}
        </div>
      </div>
      {/* The touch edges' trunk: on the bottom edge, TOUCH_TRUNK_X in from the left corner. */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="touch"
        isConnectable={false}
        className="opacity-0"
        style={{ left: TOUCH_TRUNK_X }}
      />
    </div>
  );
}

/** Memoized: a camera move re-renders the canvas, never an unchanged frame. */
export const WallFrameNode = memo(WallFrameNodeComponent);
