"use client";

import { useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { StatusId } from "@/lib/config/statuses";
import type { PlatformId } from "@/lib/config/platforms";
import { STATUS_STYLES, STATUS_LABELS, PLATFORM_DOT_STYLES, PLATFORM_LABELS } from "./node-styles";

export function ScenarioNode({ data }: NodeProps) {
  const status = (data.status as StatusId) ?? "idea";
  const label = String(data.label ?? "Scenario");
  const platforms = (data.platforms as PlatformId[]) ?? [];
  const [expanded, setExpanded] = useState(false);
  const { badge, dot } = STATUS_STYLES[status] ?? STATUS_STYLES.idea;

  return (
    <>
      <Handle type="target" position={Position.Top} className="opacity-0" />
      <div
        role="button"
        tabIndex={0}
        aria-label={label}
        aria-expanded={expanded}
        className="flex flex-col gap-2 w-56 px-4 py-3 rounded-xl bg-background border-2 border-border shadow-md cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => setExpanded((prev) => !prev)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded((prev) => !prev);
          }
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <span title={label} className="text-sm font-semibold leading-tight line-clamp-1 flex-1">
            {label}
          </span>
          {expanded ? (
            <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" />
          )}
        </div>
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
