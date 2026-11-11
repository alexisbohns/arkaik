"use client";

import { useEffect, useRef } from "react";
import { useReactFlow, useStore } from "@xyflow/react";
import { frameViewport, type Rect } from "@/lib/utils/screen-wall-layout";

/** One camera move on the Screens map: show `rect`, zoom kept within [minZoom, maxZoom]. */
export interface WallCameraRequest {
  /** Changes once per request; each version applies once. */
  version: number;
  /** In flow coordinates: a strip, or a frame with its chip column. */
  rect: Rect;
  minZoom: number;
  maxZoom: number;
}

/** Space kept around the framed rect, in screen px (`frameViewport`'s `padding`). */
export const WALL_CAMERA_PADDING = 32;
/** The bottom bar's height plus its gap, kept clear under the rect (`frameViewport`'s `bottomInset`). */
export const WALL_BAR_INSET = 72;

/**
 * Applies the Screens map's camera requests: frames a rectangle — a strip, a
 * selected frame — where `CameraFocus` can only centre a node at the current
 * zoom. `CameraFocus`'s twin in timing: opening a panel narrows the canvas
 * right after the click, so each request waits 120ms after the last store
 * width/height change and then runs one animation, linear (d3's default
 * interpolation dips the zoom mid-flight). Under reduced motion it jumps.
 * Rendered inside `<ReactFlow>` (as a `Canvas` child) because the store hooks
 * need it.
 */
export function WallCamera({ request }: { request: WallCameraRequest | null }) {
  const reactFlow = useReactFlow();
  const width = useStore((state) => state.width);
  const height = useStore((state) => state.height);
  const handled = useRef(0);

  useEffect(() => {
    if (!request || request.version === handled.current || width === 0 || height === 0) return;
    const timer = setTimeout(() => {
      handled.current = request.version;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const viewport = frameViewport(
        request.rect,
        { width, height },
        {
          padding: WALL_CAMERA_PADDING,
          bottomInset: WALL_BAR_INSET,
          minZoom: request.minZoom,
          maxZoom: request.maxZoom,
        },
      );
      void reactFlow.setViewport(viewport, { duration: reduce ? 0 : 300, interpolate: "linear" });
    }, 120);
    return () => clearTimeout(timer);
  }, [height, reactFlow, request, width]);

  return null;
}
