"use client";

import { memo } from "react";
import type { Node, NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";
import type { WallMarkerData } from "./wall-node-data";
import { wallDimClass } from "./WallFrameNode";

/**
 * The thin things between frames, all `aria-hidden` (a frame that starts an
 * arm names the arm in its own label):
 *
 * - `arm` — a branch's arm begins: a rule with the arm and the branch written
 *   up its side ("Yes · Has a streak?"); dashed when the arm lists nothing.
 * - `end` — the branch closes: a short bracket.
 * - `empty` — a flow whose playlist lists nothing: one ghost the width of a
 *   frame, so the strip is not a bare header.
 */
function markerBody({ variant, label, arm, empty }: WallMarkerData) {
  if (variant === "empty") {
    return (
      <div
        aria-hidden="true"
        className="flex h-full w-full items-center justify-center rounded-md border-2 border-dashed border-border px-4 text-center text-xs text-muted-foreground"
      >
        No screens in this flow yet
      </div>
    );
  }

  if (variant === "end") {
    return (
      <div aria-hidden="true" className="flex h-full w-full items-stretch justify-center py-8">
        <span className="w-1.5 rounded-r-sm border-y-2 border-r-2 border-muted-foreground/40" />
      </div>
    );
  }

  return (
    <div aria-hidden="true" className="flex h-full w-full items-stretch justify-center gap-1">
      <span
        className={cn(
          "w-0 border-l-2",
          empty ? "border-dashed border-muted-foreground/40" : "border-muted-foreground/60",
        )}
      />
      <span
        className="truncate text-[10px] font-medium text-muted-foreground [writing-mode:vertical-rl]"
        title={`${arm} · ${label}`}
      >
        {arm} · {label}
      </span>
    </div>
  );
}

/** Gaps only fades every marker (none is ever a gap): the dim wrapper is the node's one outer element. */
function WallMarkerNodeComponent({ data }: NodeProps<Node<WallMarkerData, "wallMarker">>) {
  return (
    <div className={wallDimClass(data.dimmed)} data-dimmed={data.dimmed ? "true" : "false"}>
      {markerBody(data)}
    </div>
  );
}

export const WallMarkerNode = memo(WallMarkerNodeComponent);
