"use client";

import { memo } from "react";
import type { Node, NodeProps } from "@xyflow/react";
import { ChevronRightIcon } from "lucide-react";
import { SPECIES_GRAPH_ICONS } from "@/lib/config/species-icons";
import type { WallJumpData } from "./wall-node-data";

const FlowIcon = SPECIES_GRAPH_ICONS.flow;

/**
 * A sub-flow entry: the sub-flow's views are not inlined into this strip — the
 * tile flies the camera to the sub-flow's own strip and rings its header.
 * `pointer-events-auto` for the reason given in `WallFrameNode`.
 */
function WallJumpNodeComponent({ data }: NodeProps<Node<WallJumpData, "wallJump">>) {
  const { flowId, title, screenCount, onJump } = data;
  const screens = `${screenCount} screen${screenCount === 1 ? "" : "s"}`;

  return (
    <button
      type="button"
      onClick={() => onJump(flowId)}
      aria-label={`Go to ${title}, ${screens}`}
      className="group/wall-jump pointer-events-auto flex h-full w-full cursor-pointer flex-col justify-between rounded-lg border bg-card p-3 text-left shadow-sm transition-colors outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <FlowIcon className="size-3.5 shrink-0" aria-hidden="true" />
        {screens}
      </span>
      <span className="flex items-end justify-between gap-1">
        <span className="line-clamp-2 text-xs font-medium leading-tight">{title}</span>
        <ChevronRightIcon
          className="size-4 shrink-0 text-muted-foreground transition-transform group-hover/wall-jump:translate-x-0.5"
          aria-hidden="true"
        />
      </span>
    </button>
  );
}

export const WallJumpNode = memo(WallJumpNodeComponent);
