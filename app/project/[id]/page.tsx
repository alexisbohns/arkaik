"use client";

import { useParams } from "next/navigation";
import { type Edge, type Node } from "@xyflow/react";
import { Canvas } from "@/components/graph/Canvas";
import { useNodes } from "@/lib/hooks/useNodes";
import { useEdges } from "@/lib/hooks/useEdges";
import type { Node as DataNode, Edge as DataEdge } from "@/lib/data/types";
import type { SpeciesId } from "@/lib/config/species";

const SPECIES_TO_NODE_TYPE: Record<SpeciesId, string> = {
  product: "product",
  scenario: "scenario",
  flow: "flow",
  view: "step",
  token: "step",
  state: "step",
  component: "step",
  section: "step",
  "data-model": "dataModel",
  "api-endpoint": "apiEndpoint",
};

function toXYNode(node: DataNode): Node {
  return {
    id: node.id,
    type: SPECIES_TO_NODE_TYPE[node.species] ?? "step",
    position: { x: node.position_x, y: node.position_y },
    data: {
      label: node.title,
      status: node.status,
      platforms: node.platforms,
    },
  };
}

function toXYEdge(edge: DataEdge): Edge {
  return {
    id: edge.id,
    source: edge.source_id,
    target: edge.target_id,
  };
}

export default function ProjectCanvasPage() {
  const params = useParams();
  const id = Array.isArray(params.id) ? params.id[0] : params.id ?? "";

  const { nodes: dataNodes, loading: nodesLoading } = useNodes(id);
  const { edges: dataEdges, loading: edgesLoading } = useEdges(id);

  if (nodesLoading || edgesLoading) {
    return (
      <div className="h-screen w-full flex items-center justify-center">
        <span className="text-muted-foreground text-sm">Loading graph…</span>
      </div>
    );
  }

  const nodes: Node[] = dataNodes.map(toXYNode);
  const edges: Edge[] = dataEdges.map(toXYEdge);

  return (
    <div className="h-screen w-full">
      <Canvas nodes={nodes} edges={edges} />
    </div>
  );
}
