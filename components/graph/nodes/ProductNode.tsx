"use client";

import { Handle, Position, NodeToolbar, type NodeProps } from "@xyflow/react";
import { Package, PlusCircle } from "lucide-react";
import type { StatusId } from "@/lib/config/statuses";
import { StatusBadge } from "@/components/layout/StatusBadge";
import { STATUS_GHOST_STYLES } from "./node-styles";
import { useToolbarHover } from "@/lib/hooks/useToolbarHover";

export function ProductNode({ data }: NodeProps) {
  const status = (data.status as StatusId) ?? "idea";
  const label = String(data.label ?? "Product");
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
        className={`flex w-40 h-40 flex-col items-center justify-center rounded-full bg-primary text-primary-foreground border-4 border-border shadow-xl cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${ghostClass.wrapper} ${ghostClass.border}`}
        onClick={() => onToggle?.()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle?.();
          }
        }}
        {...nodeProps}
      >
        <Package className="w-8 h-8 mb-1 shrink-0" />
        <span title={label} className="text-sm font-bold text-center px-4 leading-tight line-clamp-2">
          {label}
        </span>
        <StatusBadge status={status} className="mt-2" />
      </div>
      <Handle type="source" position={Position.Bottom} className="opacity-0" />
    </>
  );
}
