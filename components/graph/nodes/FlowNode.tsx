"use client";

import { Handle, Position, NodeToolbar, type NodeProps } from "@xyflow/react";
import { ChevronDown, ChevronRight, Info, PlusCircle, Split } from "lucide-react";
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
  const renderVariant = data.renderVariant as string | undefined;
  const branchKind = data.branchKind as string | undefined;
  const branchSummary = data.branchSummary as string | undefined;
  const onToggle = data.onToggle as (() => void) | undefined;
  const onOpenDetails = data.onOpenDetails as (() => void) | undefined;
  const onAddChild = data.onAddChild as (() => void) | undefined;
  const ghostClass = STATUS_GHOST_STYLES[status];
  const { isHovered, nodeProps, toolbarProps } = useToolbarHover();
  const isBranch = renderVariant === "branch";
  const isConditionBranch = isBranch && branchKind === "condition";
  const isInteractive = Boolean(onToggle);

  return (
    <>
      {onAddChild && !isBranch && (
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
      <Handle type="target" position={Position.Top} id="top" className="opacity-0" />
      <Handle type="target" position={Position.Left} id="left" className="opacity-0" />
      {isConditionBranch ? (
        <div
          role="group"
          aria-label={label}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-background border-2 border-dashed border-yellow-400 dark:border-yellow-500 shadow-sm"
          {...nodeProps}
        >
          <Split className="w-3.5 h-3.5 shrink-0 text-yellow-500 dark:text-yellow-400" />
          <span className="text-sm font-medium leading-tight whitespace-nowrap text-foreground">
            {label}
          </span>
        </div>
      ) : (
        <div
        role={isInteractive ? "button" : "group"}
        tabIndex={isInteractive ? 0 : -1}
        aria-label={label}
        aria-expanded={isInteractive ? expanded : undefined}
        className={`flex flex-col gap-3 ${isBranch ? "w-56 border-dashed bg-muted/20" : "w-60"} px-4 py-3 rounded-xl bg-background border-2 border-border shadow-sm ${isInteractive ? "cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ring" : "cursor-default"} ${ghostClass.wrapper} ${ghostClass.border}`}
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
        {isBranch && branchKind && (
          <span className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
            {branchKind}
          </span>
        )}
        <div className="flex items-center justify-between gap-1">
          <span title={label} className="text-sm font-medium leading-tight line-clamp-2 flex-1">
            {label}
          </span>
          <div className="flex items-center gap-1">
            {stage && !isBranch && <StageIcon stage={stage} />}
            {onOpenDetails && !isBranch && (
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
            {!isBranch && expanded ? (
              <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" />
            ) : !isBranch ? (
              <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" />
            ) : null}
          </div>
        </div>
        {isBranch && branchSummary ? (
          <p className="text-xs leading-relaxed text-muted-foreground line-clamp-3">
            {branchSummary}
          </p>
        ) : (
          <PlatformGaugeList rollup={platformRollup} platforms={platforms.length > 0 ? platforms : PLATFORMS.map((platform) => platform.id)} compact />
        )}
      </div>
      )}
      <Handle type="source" position={Position.Bottom} id="bottom" className="opacity-0" />
      <Handle type="source" position={Position.Right} id="right" className="opacity-0" />
    </>
  );
}
