"use client";

import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";
import { SPECIES_ICONS, STATUS_LABELS, STATUS_STYLES, SYSTEM_LAYER_STYLES } from "./node-styles";
import type { WallChipData } from "./wall-node-data";

const CHIP_CLASS =
  "nodrag nopan pointer-events-auto flex h-full w-full cursor-pointer items-center gap-2 rounded-md border bg-card px-2 text-left text-xs shadow-sm hover:bg-accent motion-safe:animate-[arkaik-panel-in_180ms_ease-out]";

/**
 * One touch chip under the selected frame on the Screens map
 * (docs/superpowers/specs/2026-11-11-screens-map-design.md § Interaction): an
 * API endpoint or data model the view touches, or "+N more". A click opens that
 * node's panel; "+N more" opens the view's.
 *
 * A canvas node, so it moves with the camera; ScreensCanvas gives it
 * `zIndex: 1000` so the column draws over the next strip. Hidden from assistive
 * technology and out of the tab order: the inspector's Touches list holds the
 * same nodes as buttons. The fan-in plays only without a reduced-motion
 * preference (`motion-safe:`). The hidden handle on its left is where the touch
 * edge from the frame lands.
 *
 * `pointer-events-auto` is load-bearing, as on `WallFrameNode`: React Flow
 * gives an inert node `pointer-events: none`, so without it a click would fall
 * through to the pane and clear the selection.
 */
function WallChipNodeComponent({ data }: NodeProps<Node<WallChipData, "wallChip">>) {
  const target = <Handle type="target" position={Position.Left} id="touch" isConnectable={false} className="opacity-0" />;

  if (data.kind === "more") {
    return (
      <div className="relative h-full w-full">
        {target}
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          className={cn(CHIP_CLASS, "justify-center font-medium text-muted-foreground")}
          onClick={() => data.onOpen(data.viewId)}
        >
          +{data.count} more
        </button>
      </div>
    );
  }

  const { touch } = data;
  const Icon = SPECIES_ICONS[touch.species];
  return (
    <div className="relative h-full w-full">
      {target}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        title={`${touch.title} · ${STATUS_LABELS[touch.status]}`}
        className={CHIP_CLASS}
        onClick={() => data.onOpen(touch.nodeId)}
      >
        <Icon className={cn("size-3.5 shrink-0", SYSTEM_LAYER_STYLES[touch.species].icon)} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{touch.title}</span>
        <span className={cn("size-2 shrink-0 rounded-full", STATUS_STYLES[touch.status].dot)} aria-hidden="true" />
      </button>
    </div>
  );
}

export const WallChipNode = memo(WallChipNodeComponent);
