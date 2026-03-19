"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { StatusId } from "@/lib/config/statuses";
import type { PlatformId } from "@/lib/config/platforms";
import { STATUS_STYLES, STATUS_LABELS, PLATFORM_DOT_STYLES, PLATFORM_LABELS } from "./node-styles";

export function FlowNode({ data }: NodeProps) {
  const status = (data.status as StatusId) ?? "idea";
  const label = String(data.label ?? "Flow");
  const platforms = (data.platforms as PlatformId[]) ?? [];
  const { badge, dot } = STATUS_STYLES[status] ?? STATUS_STYLES.idea;

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
          <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${badge}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
            {STATUS_LABELS[status]}
          </span>
          {platforms.length > 0 && (
            <div className="flex items-center gap-1">
              {platforms.map((platform) => (
                <span
                  key={platform}
                  title={PLATFORM_LABELS[platform]}
                  className={`w-2 h-2 rounded-full ${PLATFORM_DOT_STYLES[platform]}`}
                />
              ))}
            </div>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="opacity-0" />
    </>
  );
}
