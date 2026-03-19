import { BaseEdge, getStraightPath, type EdgeProps } from "@xyflow/react";

export function ComposeEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
}: EdgeProps) {
  const [edgePath] = getStraightPath({ sourceX, sourceY, targetX, targetY });
  return <BaseEdge path={edgePath} />;
}
