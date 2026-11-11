"use client";

import { memo } from "react";
import Link from "next/link";
import type { Node, NodeProps } from "@xyflow/react";
import { SPECIES_GRAPH_ICONS } from "@/lib/config/species-icons";
import { useProjectId } from "@/lib/hooks/useProjectId";
import type { WallHeaderData } from "./wall-node-data";
import { wallDimClass } from "./WallFrameNode";

/**
 * A strip's header: the flow's name as the strip's `h2` (the page's `h1` is
 * `PageShell`'s), a button on it that opens the flow's panel, and the R9
 * counts line. "Not in a flow" has no flow to open, so its title is plain
 * text; with no flow in scope at all it also carries the pointer to the
 * Journey map, drawn just above the header.
 *
 * The counts line follows the title directly: the header spans its whole
 * strip, so anything pushed to its far end is off screen on arrival for every
 * strip wider than the canvas. The rest of the header stays empty.
 *
 * A jump tile that lands here rings the header: an outline for as long as
 * `ringVersion` is non-zero (the controller clears it after 2s), pulsing only
 * when motion is allowed.
 *
 * The button and the link carry `pointer-events-auto`: React Flow turns
 * pointer events off on a node with nothing selectable, draggable or handled
 * (see `WallFrameNode`), and the rest of the header lets the pane take a drag.
 */
function WallHeaderNodeComponent({ data }: NodeProps<Node<WallHeaderData, "wallHeader">>) {
  const { flowId, title, countsLine, note, ringVersion, onOpenFlow } = data;
  const projectId = useProjectId();
  const Icon = flowId === null ? SPECIES_GRAPH_ICONS.view : SPECIES_GRAPH_ICONS.flow;

  return (
    <div className={wallDimClass(data.dimmed, "soft")} data-dimmed={data.dimmed ? "true" : "false"}>
      <div className="relative h-full w-full">
        {note === "no-flows" && (
          <p className="absolute bottom-full left-0 mb-2 w-full text-xs text-muted-foreground">
            No flows yet, so these screens aren&apos;t lined up.{" "}
            <Link
              href={`/project/${projectId}/maps/journey`}
              className="pointer-events-auto font-medium text-foreground underline underline-offset-2"
            >
              Put them in order on the Journey map.
            </Link>
          </p>
        )}
        {ringVersion > 0 && (
          <span
            key={ringVersion}
            aria-hidden="true"
            className="pointer-events-none absolute -inset-1 rounded-xl ring-2 ring-primary motion-safe:animate-pulse"
          />
        )}
        <div className="flex h-full w-full items-center gap-3 rounded-lg border bg-card px-3 shadow-sm">
          <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <h2 className="min-w-0 truncate text-sm font-semibold">
            {flowId !== null && onOpenFlow ? (
              <button
                type="button"
                onClick={() => onOpenFlow(flowId)}
                className="pointer-events-auto max-w-full cursor-pointer truncate rounded-sm text-left underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              >
                {title}
              </button>
            ) : (
              title
            )}
          </h2>
          <span className="-ml-1 shrink-0 text-xs tabular-nums text-muted-foreground">{countsLine}</span>
        </div>
      </div>
    </div>
  );
}

export const WallHeaderNode = memo(WallHeaderNodeComponent);
