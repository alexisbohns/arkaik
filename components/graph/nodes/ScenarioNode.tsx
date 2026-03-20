"use client";

import { Handle, Position, NodeToolbar, type NodeProps } from "@xyflow/react";
import { ChevronDown, ChevronRight, PlusCircle } from "lucide-react";
import type { StatusId } from "@/lib/config/statuses";
import type { PlatformId } from "@/lib/config/platforms";
import { StatusBadge } from "@/components/layout/StatusBadge";
import { PlatformDots } from "@/components/layout/PlatformDots";
import { STATUS_GHOST_STYLES } from "./node-styles";
import { useToolbarHover } from "@/lib/hooks/useToolbarHover";

export function ScenarioNode({ data }: NodeProps) {
  const status = (data.status as StatusId) ?? "idea";
  const label = String(data.label ?? "Scenario");
  const platforms = (data.platforms as PlatformId[]) ?? [];
  const expanded = Boolean(data.expanded);
  const onToggle = data.onToggle as (() => void) | undefined;
  const onAddChild = data.onAddChild as (() => void) | undefined;
  const ghostClass = STATUS_GHOST_STYLES[status];
  const { isHovered, nodeProps, toolbarProps } = useToolbarHover();

  return (
    <>
      {onAddChild && (
        <NodeToolbar isVisible={isHovered} position={Position.Top} offset={8}>
          <button
            type="button"
            {...toolbarProps}
            onClick={(e) => { e.stopPropagation(); onAddChild(); }}
            className="flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-background border border-border shadow-sm hover:bg-muted transition-colors"
          >
            <PlusCircle className="w-3 h-3" />
            Add child
          </button>
        </NodeToolbar>
      )}
      <Handle type="target" position={Position.Top} className="opacity-0" />
      <div
        role="button"
        tabIndex={0}
        aria-label={label}
        aria-expanded={expanded}
        className={`flex flex-col gap-2 w-56 px-4 py-3 rounded-xl bg-background border-2 border-border shadow-md cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${ghostClass.wrapper} ${ghostClass.border}`}
        onClick={() => onToggle?.()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle?.();
          }
        }}
        {...nodeProps}
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
          <StatusBadge status={status} />
          <PlatformDots platforms={platforms} />
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="opacity-0" />
    </>
  );
}
