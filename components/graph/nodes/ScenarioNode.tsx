import type { NodeProps } from "@xyflow/react";

export function ScenarioNode({ data }: NodeProps) {
  return (
    <div className="rounded border px-3 py-2 bg-background text-sm font-medium">
      {String(data.label)}
    </div>
  );
}
