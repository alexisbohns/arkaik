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
  {
    id: "5",
    type: "flow",
    position: { x: 0, y: 450 },
    data: { label: "Shape an Emotion", status: "planned", platforms: ["ios", "android"] },
  },
  {
    id: "6",
    type: "flow",
    position: { x: 200, y: 450 },
    data: { label: "Record Audio", status: "in-development", platforms: ["ios"] },
  },
  {
    id: "7",
    type: "flow",
    position: { x: 380, y: 450 },
    data: { label: "Browse Feed", status: "live", platforms: ["web", "ios", "android"] },
  },
  {
    id: "8",
    type: "dataModel",
    position: { x: 0, y: 650 },
    data: { label: "Pebble", status: "live" },
  },
  {
    id: "9",
    type: "dataModel",
    position: { x: 220, y: 650 },
    data: { label: "User", status: "live" },
  },
  {
    id: "10",
    type: "apiEndpoint",
    position: { x: 440, y: 650 },
    data: { label: "POST /pebbles", status: "live" },
  },
  {
    id: "11",
    type: "apiEndpoint",
    position: { x: 660, y: 650 },
    data: { label: "GET /feed", status: "in-development" },
  },
];

const initialEdges: Edge[] = [
  { id: "e1-2", source: "1", target: "2" },
  { id: "e1-3", source: "1", target: "3" },
  { id: "e1-4", source: "1", target: "4" },
  { id: "e2-5", source: "2", target: "5" },
  { id: "e2-6", source: "2", target: "6" },
  { id: "e3-7", source: "3", target: "7" },
  { id: "e6-8", source: "6", target: "8" },
  { id: "e6-10", source: "6", target: "10" },
  { id: "e7-9", source: "7", target: "9" },
  { id: "e7-11", source: "7", target: "11" },
];

export default function ProjectCanvasPage() {
  return (
    <div className="h-screen w-full">
      <Canvas nodes={initialNodes} edges={initialEdges} />
    </div>
  );
}
