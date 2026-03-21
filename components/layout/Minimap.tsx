"use client";

import { MiniMap as ReactFlowMinimap } from "@xyflow/react";
import { useTheme } from "next-themes";

export function Minimap() {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  return (
    <ReactFlowMinimap
      bgColor={isDark ? "#111827" : "#f8fafc"}
      nodeColor={isDark ? "#93c5fd" : "#1d4ed8"}
      nodeStrokeColor={isDark ? "#bfdbfe" : "#2563eb"}
      maskColor="transparent"
      maskStrokeColor={isDark ? "#60a5fa" : "#3b82f6"}
      nodeStrokeWidth={2}
    />
  );
}
