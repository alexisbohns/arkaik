import type { ReactNode } from "react";

/**
 * A map's own controls, pinned to the canvas's top-right corner.
 *
 * They used to ride in the page header, which is gone; on a canvas the corner
 * is where controls that change the drawing belong anyway — beside what they
 * change, the way React Flow's own zoom controls and minimap sit on it. The
 * surface cell is `relative`, so this positions against the canvas itself.
 *
 * A bar in app/m3/controls.css's sense (`data-slot="toolbar"`), so its select
 * and buttons are the same tonal pills as a page's; `data-floating` makes them
 * a step denser and lifts them to elevation 1, opaque over the map.
 */
export function MapCanvasControls({ children }: { children: ReactNode }) {
  return (
    <div data-slot="toolbar" data-floating="" className="absolute top-3 right-3 z-10 flex items-center gap-2">
      {children}
    </div>
  );
}
