import type { NodeProps } from "@xyflow/react";

export function ProductNode({ data }: NodeProps) {
  return (
    <div className="rounded border px-3 py-2 bg-background text-sm font-medium">
      {String(data.label)}
    </div>
  );
}
