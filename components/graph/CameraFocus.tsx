"use client";

import { useEffect, useRef } from "react";
import { useReactFlow, useStore } from "@xyflow/react";

export interface CanvasFocus {
  nodeId: string;
  /** Changes once per click; each version centres once. */
  version: number;
}

/**
 * Centres the clicked card in the canvas at the current zoom — once the canvas
 * has its final size. Opening a panel narrows the canvas right after the
 * click; React Flow observes that resize and updates its store, so the
 * centring waits 120ms after the last width/height change and then runs one
 * animation. Rendered inside `<ReactFlow>` because the store hooks need it.
 */
export function CameraFocus({ focus }: { focus: CanvasFocus | null }) {
  const reactFlow = useReactFlow();
  const width = useStore((state) => state.width);
  const height = useStore((state) => state.height);
  const handled = useRef(0);

  useEffect(() => {
    if (!focus || focus.version === handled.current) return;
    const timer = setTimeout(() => {
      handled.current = focus.version;
      const node = reactFlow.getInternalNode(focus.nodeId);
      if (!node) return;
      const { x, y } = node.internals.positionAbsolute;
      const w = node.measured.width ?? 0;
      const h = node.measured.height ?? 0;
      // Linear: d3's default zoom interpolation dips the zoom mid-flight on a
      // long pan, which reads as the very zoom-out this exists to remove.
      void reactFlow.setCenter(x + w / 2, y + h / 2, { zoom: reactFlow.getZoom(), duration: 300, interpolate: "linear" });
    }, 120);
    return () => clearTimeout(timer);
  }, [focus, height, reactFlow, width]);

  return null;
}
