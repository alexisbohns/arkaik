"use client";

import { memo, type KeyboardEvent } from "react";
import type { Node, NodeProps } from "@xyflow/react";
import type { PlatformId } from "@/lib/config/platforms";
import { cellWord, type PlatformCell } from "@/lib/utils/screen-wall";
import { CAPTION_GAP, CAPTION_H, FRAME_H } from "@/lib/utils/screen-wall-layout";
import { formatShotDate } from "@/lib/utils/screenshot-ops";
import { PLATFORM_LABELS, STATUS_LABELS } from "./node-styles";
import type { WallFrameData } from "./wall-node-data";
import { WallShot, useWallDetail } from "./WallShot";

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
  const { frameId, viewId, stripId, stripTitle, screen, lens, platforms, shotWidth, armContext, onActivate, onAspect } =
    data;
  const detailed = useWallDetail();
  // Part 2 draws one platform per frame. The lens is never "side" here — the
  // stored-lens reader accepts platform ids only — and the fallback keeps the
  // type total rather than asserting it.
  const platform: PlatformId = lens === "side" ? (platforms[0] ?? "web") : lens;
  const cell = screen.cells[platform];
  const date = cell?.shot?.ts ? formatShotDate(cell.shot.ts) : undefined;
  const word = cell ? cellWord(cell) : "Absent";

  const where = sentence(armContext ? `${screen.title}, ${stripTitle}, ${armContext}` : `${screen.title}, ${stripTitle}`);
  const label = `${where} ${sentence(`${PLATFORM_LABELS[platform]}: ${cellPhrase(cell)}`)}`;

  const activate = () => onActivate(frameId, viewId, stripId);
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    activate();
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={label}
      onClick={activate}
      onKeyDown={handleKeyDown}
      className="group/wall-frame pointer-events-auto flex h-full w-full cursor-pointer flex-col items-center rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background"
    >
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
      <div
        className="flex w-full min-w-0 flex-col justify-center gap-0.5 px-1"
        style={{ marginTop: CAPTION_GAP, height: CAPTION_H }}
      >
        {detailed && (
          <>
            <span className="truncate text-xs font-medium leading-tight" title={screen.title}>
              {screen.title}
            </span>
            <span className="truncate text-[11px] leading-tight text-muted-foreground">
              {date && cell?.shot ? `${word} · ${date}` : word}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

/** Memoized: a camera move re-renders the canvas, never an unchanged frame. */
export const WallFrameNode = memo(WallFrameNodeComponent);
