"use client";

import { type Edge, type Node } from "@xyflow/react";
import { Canvas } from "@/components/graph/Canvas";

const initialNodes: Node[] = [
  {
    id: "1",
    type: "product",
    position: { x: 350, y: 50 },
    data: { label: "Pebbles", status: "live" },
  },
  {
    id: "2",
    type: "scenario",
    position: { x: 100, y: 250 },
    data: { label: "Record a full Pebble", status: "in-development", platforms: ["ios", "android"] },
  },
  {
    id: "3",
    type: "scenario",
    position: { x: 450, y: 250 },
    data: { label: "Browse & Discover", status: "live", platforms: ["web", "ios", "android"] },
  },
  {
    id: "4",
    type: "scenario",
    position: { x: 800, y: 250 },
    data: { label: "Onboarding", status: "planned" },
  },
];

const initialEdges: Edge[] = [
  { id: "e1-2", source: "1", target: "2" },
  { id: "e1-3", source: "1", target: "3" },
  { id: "e1-4", source: "1", target: "4" },
];

export default function ProjectCanvasPage() {
  return (
    <div className="h-screen w-full">
      <Canvas nodes={initialNodes} edges={initialEdges} />
    </div>
  );
}
