"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";

const DIAMOND_INNER = 80;
const DIAMOND_OUTER = Math.round(DIAMOND_INNER * Math.SQRT2);

export function ConditionNode({ data }: NodeProps) {
  const label = String(data.label ?? "Condition");

  return (
    <div className="relative" style={{ width: DIAMOND_OUTER, height: DIAMOND_OUTER }}>
      <Handle type="target" position={Position.Top} className="opacity-0" />
      <div
        aria-hidden="true"
        className="absolute bg-background border-2 border-amber-400"
        style={{
          width: DIAMOND_INNER,
          height: DIAMOND_INNER,
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%) rotate(45deg)",
        }}
      />
      <div
        aria-label={label}
        className="absolute inset-0 flex items-center justify-center"
      >
        <span
          title={label}
          className="text-xs font-medium text-center leading-tight line-clamp-3 px-4"
        >
          {label}
        </span>
      </div>
      <Handle type="source" position={Position.Bottom} className="opacity-0" />
    </div>
  );
}
