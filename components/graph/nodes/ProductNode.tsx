import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Package } from "lucide-react";
import type { StatusId } from "@/lib/config/statuses";
import { STATUS_STYLES, STATUS_LABELS } from "./node-styles";

export function ProductNode({ data }: NodeProps) {
  const status = (data.status as StatusId) ?? "idea";
  const label = String(data.label ?? "Product");
  const { badge, dot } = STATUS_STYLES[status] ?? STATUS_STYLES.idea;

  return (
    <>
      <Handle type="target" position={Position.Top} className="opacity-0" />
      <div
        role="button"
        tabIndex={0}
        aria-label={label}
        className="flex w-40 h-40 flex-col items-center justify-center rounded-full bg-primary text-primary-foreground border-4 border-border shadow-xl cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") e.currentTarget.click();
        }}
      >
        <Package className="w-8 h-8 mb-1 shrink-0" />
        <span title={label} className="text-sm font-bold text-center px-4 leading-tight line-clamp-2">
          {label}
        </span>
        <span className={`mt-2 flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${badge}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
          {STATUS_LABELS[status]}
        </span>
      </div>
      <Handle type="source" position={Position.Bottom} className="opacity-0" />
    </>
  );
}
