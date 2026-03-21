import { BaseEdge, getStraightPath, useInternalNode, type EdgeProps, type InternalNode } from "@xyflow/react";

/** Returns the point where the line from the node's center toward (targetX, targetY) exits the node's rectangular border. */
function getBorderIntersection(node: InternalNode, targetX: number, targetY: number): { x: number; y: number } {
  const { positionAbsolute } = node.internals;
  const hw = (node.measured.width ?? 0) / 2;
  const hh = (node.measured.height ?? 0) / 2;
  const cx = positionAbsolute.x + hw;
  const cy = positionAbsolute.y + hh;

  const dx = targetX - cx;
  const dy = targetY - cy;

  if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return { x: cx, y: cy };

  const scaleX = hw / Math.abs(dx + 0.001);
  const scaleY = hh / Math.abs(dy + 0.001);
  const scale = Math.min(scaleX, scaleY);

  return { x: cx + dx * scale, y: cy + dy * scale };
}

export function FloatingDottedEdge({ id, source, target }: EdgeProps) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);

  if (!sourceNode || !targetNode) return null;

  const sourceCx = sourceNode.internals.positionAbsolute.x + (sourceNode.measured.width ?? 0) / 2;
  const sourceCy = sourceNode.internals.positionAbsolute.y + (sourceNode.measured.height ?? 0) / 2;
  const targetCx = targetNode.internals.positionAbsolute.x + (targetNode.measured.width ?? 0) / 2;
  const targetCy = targetNode.internals.positionAbsolute.y + (targetNode.measured.height ?? 0) / 2;

  const { x: sx, y: sy } = getBorderIntersection(sourceNode, targetCx, targetCy);
  const { x: tx, y: ty } = getBorderIntersection(targetNode, sourceCx, sourceCy);

  const [edgePath] = getStraightPath({ sourceX: sx, sourceY: sy, targetX: tx, targetY: ty });

  return (
    <BaseEdge
      id={id}
      path={edgePath}
      style={{ strokeDasharray: "6,3", stroke: "hsl(var(--muted-foreground))", strokeWidth: 1.5, opacity: 0.6 }}
    />
  );
}
