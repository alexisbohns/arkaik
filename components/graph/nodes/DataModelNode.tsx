"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Database } from "lucide-react";
import type { StatusId } from "@/lib/config/statuses";
import { StatusBadge } from "@/components/layout/StatusBadge";
import { STATUS_GHOST_STYLES } from "./node-styles";

export function DataModelNode({ data }: NodeProps) {
  const status = (data.status as StatusId) ?? "idea";
  const label = String(data.label ?? "Data Model");
  const ghostClass = STATUS_GHOST_STYLES[status];

  return (
    <>
      <Handle type="target" position={Position.Top} className="opacity-0" />
      <div
        aria-label={label}
        className={`flex flex-col gap-2 w-48 px-3 py-2.5 rounded-lg bg-background border-2 border-amber-500 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${ghostClass.wrapper} ${ghostClass.border}`}
      >
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 shrink-0 text-amber-500" />
          <span title={label} className="text-sm font-medium leading-tight line-clamp-2 flex-1">
            {label}
          </span>
        </div>
        <StatusBadge status={status} className="self-start" />
      </div>
      <Handle type="source" position={Position.Bottom} className="opacity-0" />
    </>
  );
}
