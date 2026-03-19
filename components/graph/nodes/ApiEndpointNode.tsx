"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Plug } from "lucide-react";
import type { StatusId } from "@/lib/config/statuses";
import { STATUS_STYLES, STATUS_LABELS } from "./node-styles";

export function ApiEndpointNode({ data }: NodeProps) {
  const status = (data.status as StatusId) ?? "idea";
  const label = String(data.label ?? "API Endpoint");
  const { badge, dot } = STATUS_STYLES[status] ?? STATUS_STYLES.idea;

  return (
    <>
      <Handle type="target" position={Position.Top} className="opacity-0" />
      <div
        aria-label={label}
        className="flex flex-col gap-2 w-48 px-3 py-2.5 rounded-lg bg-background border-2 border-teal-500 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="flex items-center gap-2">
          <Plug className="w-4 h-4 shrink-0 text-teal-500" />
          <span title={label} className="text-sm font-medium leading-tight line-clamp-2 flex-1">
            {label}
          </span>
        </div>
        <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium self-start ${badge}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
          {STATUS_LABELS[status]}
        </span>
      </div>
      <Handle type="source" position={Position.Bottom} className="opacity-0" />
    </>
  );
}
