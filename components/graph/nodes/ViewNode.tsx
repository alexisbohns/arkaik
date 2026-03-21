"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { StatusId } from "@/lib/config/statuses";
import type { PlatformId } from "@/lib/config/platforms";
import type { PlatformStatusMap } from "@/lib/data/types";
import { STATUS_GHOST_STYLES } from "./node-styles";
import { PlatformList } from "./PlatformList";

export function ViewNode({ data }: NodeProps) {
  const status = (data.status as StatusId) ?? "idea";
  const label = String(data.label ?? "View");
  const platforms = (data.platforms as PlatformId[]) ?? [];
  const platformStatuses = (data.platformStatuses as PlatformStatusMap | undefined) ?? {};
  const ghostClass = STATUS_GHOST_STYLES[status];

  return (
    <>
      <Handle type="target" position={Position.Top} id="top" className="opacity-0" />
      <Handle type="target" position={Position.Left} id="left" className="opacity-0" />
      <div className={`relative ${ghostClass.wrapper}`}>
        <div
          role="img"
          aria-label={label}
          className={`relative flex flex-col gap-3 w-56 px-4 py-3 rounded-xl bg-background border-2 border-border shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${ghostClass.border}`}
        >
          <span title={label} className="text-sm font-medium leading-tight line-clamp-2">
            {label}
          </span>
          {platforms.length > 0 && (
            <div className="text-xs flex-1 min-w-0">
              <PlatformList platforms={platforms} platformStatuses={platformStatuses} />
            </div>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} id="bottom" className="opacity-0" />
      <Handle type="source" position={Position.Right} id="right" className="opacity-0" />
    </>
  );
}
