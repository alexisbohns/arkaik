"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { StatusId } from "@/lib/config/statuses";
import type { PlatformId } from "@/lib/config/platforms";
import { STATUS_GHOST_STYLES } from "./node-styles";
import { StatusBadge } from "@/components/layout/StatusBadge";
import { PlatformList } from "./PlatformList";

export function StepNode({ data }: NodeProps) {
  const status = (data.status as StatusId) ?? "idea";
  const label = String(data.label ?? "Step");
  const platforms = (data.platforms as PlatformId[]) ?? [];
  const ghostClass = STATUS_GHOST_STYLES[status];

  return (
    <>
      <Handle type="target" position={Position.Top} className="opacity-0" />
      <div className={`relative ${ghostClass.wrapper}`}>
        <div
          role="img"
          aria-label={label}
          className={`relative flex flex-col gap-2 w-52 px-3 py-2.5 rounded-lg bg-background border-2 border-border shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${ghostClass.border}`}
        >
          <span title={label} className="text-sm font-medium leading-tight line-clamp-2">
            {label}
          </span>
          <div className="flex items-center justify-between gap-2">
            <StatusBadge status={status} />
            {platforms.length > 0 && (
              <div className="text-xs flex-1 min-w-0">
                <PlatformList platforms={platforms} status={status} />
              </div>
            )}
          </div>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="opacity-0" />
    </>
  );
}
