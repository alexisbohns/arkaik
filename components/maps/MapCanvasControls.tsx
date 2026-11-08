import type { ReactNode } from "react";

/**
 * A map's own controls, pinned to the canvas's top-right corner.
 *
 * They used to ride in the page header, which is gone; on a canvas the corner
 * is where controls that change the drawing belong anyway — beside what they
 * change, the way React Flow's own zoom controls and minimap sit on it. The
 * surface cell is `relative`, so this positions against the canvas itself.
 */
export function MapCanvasControls({ children }: { children: ReactNode }) {
  return <div className="absolute top-3 right-3 z-10 flex items-center gap-2">{children}</div>;
}
