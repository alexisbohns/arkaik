import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Package } from "lucide-react";
import type { StatusId } from "@/lib/config/statuses";
import { StatusBadge } from "@/components/layout/StatusBadge";

export function ProductNode({ data }: NodeProps) {
  const status = (data.status as StatusId) ?? "idea";
  const label = String(data.label ?? "Product");
  const expanded = Boolean(data.expanded);
  const onToggle = data.onToggle as (() => void) | undefined;

  return (
    <>
      <Handle type="target" position={Position.Top} className="opacity-0" />
      <div
        role="button"
        tabIndex={0}
        aria-label={label}
        aria-expanded={expanded}
        className="flex w-40 h-40 flex-col items-center justify-center rounded-full bg-primary text-primary-foreground border-4 border-border shadow-xl cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => onToggle?.()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle?.();
          }
        }}
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
