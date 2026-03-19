"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { StatusId } from "@/lib/config/statuses";
import type { PlatformId } from "@/lib/config/platforms";
import { StatusBadge } from "@/components/layout/StatusBadge";
import { PlatformDots } from "@/components/layout/PlatformDots";

export function FlowNode({ data }: NodeProps) {
  const status = (data.status as StatusId) ?? "idea";
  const label = String(data.label ?? "Flow");
  const platforms = (data.platforms as PlatformId[]) ?? [];

  return (
    <>
      <Handle type="target" position={Position.Top} className="opacity-0" />
      <div
        aria-label={label}
        className="flex flex-col gap-2 w-48 px-3 py-2.5 rounded-lg bg-background border-2 border-violet-400 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span title={label} className="text-sm font-medium leading-tight line-clamp-2">
          {label}
        </span>
        <div className="flex items-center justify-between gap-2">
          <StatusBadge status={status} />
          <PlatformDots platforms={platforms} />
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="opacity-0" />
    </>
  );
}
