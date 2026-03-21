"use client";

import { Handle, Position, NodeToolbar, type NodeProps } from "@xyflow/react";
import { ChevronDown, ChevronRight, Info, PlusCircle } from "lucide-react";
import type { StatusId } from "@/lib/config/statuses";
import type { PlatformId } from "@/lib/config/platforms";
import type { PlatformStatusRollup } from "@/lib/utils/platform-status";
import { PLATFORMS } from "@/lib/config/platforms";
import { StageIcon } from "@/components/layout/StageIcon";
import { STATUS_GHOST_STYLES } from "./node-styles";
import { useToolbarHover } from "@/lib/hooks/useToolbarHover";
import { PlatformGaugeList } from "./PlatformGaugeList";

export function FlowNode({ data }: NodeProps) {
  const status = (data.status as StatusId) ?? "idea";
  const label = String(data.label ?? "Flow");
  const platforms = (data.platforms as PlatformId[]) ?? [];
  const platformRollup = (data.platformRollup as PlatformStatusRollup | undefined) ?? { counts: {}, totals: {} };
  const expanded = Boolean(data.expanded);
  const stage = data.metadata ? (data.metadata as Record<string, unknown>).stage as string | undefined : undefined;
  const onToggle = data.onToggle as (() => void) | undefined;
  const onOpenDetails = data.onOpenDetails as (() => void) | undefined;
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
        className={`flex flex-col gap-3 w-60 px-4 py-3 rounded-xl bg-background border-2 border-border shadow-sm cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${ghostClass.wrapper} ${ghostClass.border}`}
        onClick={(e) => {
          e.stopPropagation();
          onToggle?.();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle?.();
          }
        }}
        {...nodeProps}
      >
        <div className="flex items-center justify-between gap-1">
          <span title={label} className="text-sm font-medium leading-tight line-clamp-2 flex-1">
            {label}
          </span>
          <div className="flex items-center gap-1">
            {stage && <StageIcon stage={stage} />}
            {onOpenDetails && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenDetails();
                }}
                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                aria-label={`Open details for ${label}`}
              >
                <Info className="w-3.5 h-3.5" />
              </button>
            )}
            {expanded ? (
              <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" />
            )}
          </div>
        </div>
        <PlatformGaugeList rollup={platformRollup} platforms={platforms.length > 0 ? platforms : PLATFORMS.map((platform) => platform.id)} compact />
      </div>
      <Handle type="source" position={Position.Bottom} className="opacity-0" />
      <Handle type="source" position={Position.Right} id="right" className="opacity-0" />
    </>
  );
}
