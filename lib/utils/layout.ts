import type { Node } from "@xyflow/react";

const HORIZONTAL_SPACING = 200;
const VERTICAL_SPACING = 100;

export function autoLayout(nodes: Node[]): Node[] {
  return nodes.map((node, index) => ({
    ...node,
    position: {
      x: (index % 4) * HORIZONTAL_SPACING,
      y: Math.floor(index / 4) * VERTICAL_SPACING,
    },
  }));
}
