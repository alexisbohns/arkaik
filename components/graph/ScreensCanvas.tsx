"use client";

import { useMemo } from "react";
import type { Edge, Node } from "@xyflow/react";
import { Canvas, type CanvasFocus } from "@/components/graph/Canvas";
import { WallCamera, type WallCameraRequest } from "@/components/graph/WallCamera";
import type {
  AspectReport,
  WallFrameData,
  WallHeaderData,
  WallJumpData,
  WallMarkerData,
} from "@/components/graph/nodes/wall-node-data";
import type { PlatformId } from "@/lib/config/platforms";
import type { StatusId } from "@/lib/config/statuses";
import { getRollupDisplayStatus, type PlatformStatusCounts } from "@/lib/utils/platform-status";
import type { ProductScope } from "@/lib/utils/product-scope";
import { stripCountsLine, type Wall, type WallItem, type WallLens, type WallScreen } from "@/lib/utils/screen-wall";
import type { WallBox, WallLayout } from "@/lib/utils/screen-wall-layout";

export interface ScreensCanvasProps {
  wall: Wall;
  layout: WallLayout;
  lens: WallLens;
  scope: ProductScope;
  /** A frame click centres the frame through `CameraFocus` (the System map's grammar). */
  focus: CanvasFocus | null;
  camera: WallCameraRequest | null;
  /** The strip a jump tile just landed on: its header rings while this is set. */
  ring: { stripId: string; version: number } | null;
  onFrameActivate: (frameId: string, viewId: string, stripId: string) => void;
  /** A header's flow panel. */
  onOpenNode: (nodeId: string) => void;
  onJump: (flowId: string) => void;
  onAspect: AspectReport;
}

/** Every wall node is inert to React Flow: focus and activation live on the element inside. */
const INERT = { draggable: false, connectable: false, selectable: false, focusable: false } as const;

const NO_EDGES: Edge[] = [];

/**
 * The frame's Minimap fill: the lens platform's status; side by side, the
 * status `getRollupDisplayStatus` would report over the frame's rows.
 */
function frameStatus(screen: WallScreen, lens: WallLens, platforms: readonly PlatformId[]): StatusId | undefined {
  if (lens !== "side") return screen.cells[lens]?.status ?? undefined;
  const counts: PlatformStatusCounts = {};
  let fallback: StatusId | undefined;
  for (const platform of platforms) {
    const status = screen.cells[platform]?.status;
    if (!status) continue;
    counts[platform] = { [status]: 1 };
    fallback ??= status;
  }
  return fallback === undefined ? undefined : getRollupDisplayStatus({ counts, totals: {} }, fallback);
}

/**
 * The Screens map's presentational half — `SystemCanvas`'s twin: the wall
 * model and its layout in, React Flow nodes out, drawn by `Canvas`. Every
 * position and size comes from the layout (`WallBox`), so React Flow and the
 * Minimap know each node's box before measuring it, which is what lets
 * `onlyRenderVisibleElements` keep off-screen shots unmounted.
 *
 * No edges, no connect, no drag, no spotlight, and no `onNodeClick`: frames,
 * headers and jump tiles activate from their own elements. The first camera is
 * the controller's (`initialFit={false}`), so the whole wall never flashes at
 * an unreadable zoom.
 *
 * The wrapper is an `@container`: below 60rem of canvas the Minimap goes,
 * below 40rem the Controls too (the queries resolve against the controller's
 * own `@container`, the same box — an element cannot query itself).
 */
export function ScreensCanvas({
  wall,
  layout,
  lens,
  scope,
  focus,
  camera,
  ring,
  onFrameActivate,
  onOpenNode,
  onJump,
  onAspect,
}: ScreensCanvasProps) {
  const itemsById = useMemo(() => {
    const byId = new Map<string, { item: WallItem; previous: WallItem | undefined; armOf: WallItem | undefined }>();
    for (const strip of wall.strips) {
      let lastArm: WallItem | undefined;
      strip.items.forEach((item, index) => {
        if (item.kind === "arm") lastArm = item;
        byId.set(item.id, { item, previous: strip.items[index - 1], armOf: lastArm });
      });
    }
    return byId;
  }, [wall]);

  const stripsById = useMemo(() => new Map(wall.strips.map((strip) => [strip.id, strip])), [wall]);

  // Static per wall, lens and layout; the ring is merged below so a jump does
  // not rebuild every frame's data.
  const baseNodes = useMemo(() => {
    const nodes: Node[] = [];
    const place = (box: WallBox) => ({
      id: box.id,
      position: { x: box.x, y: box.y },
      width: box.width,
      height: box.height,
      ...INERT,
    });

    for (const box of layout.boxes) {
      const strip = stripsById.get(box.stripId);
      if (!strip) continue;

      if (box.kind === "header") {
        const data: WallHeaderData = {
          stripId: strip.id,
          flowId: strip.flowId,
          title: strip.title,
          countsLine: stripCountsLine(wall, strip, lens),
          note: strip.flowId === null && wall.empty === "no-flows" ? "no-flows" : null,
          ringVersion: 0,
          onOpenFlow: strip.flowId === null ? null : onOpenNode,
        };
        nodes.push({ ...place(box), type: "wallHeader", data });
        continue;
      }

      const entry = itemsById.get(box.id);
      if (!entry) continue;
      const { item, previous, armOf } = entry;

      if (item.kind === "frame") {
        const screen = wall.screens.get(item.viewId);
        if (!screen) continue;
        const data: WallFrameData = {
          frameId: item.id,
          viewId: item.viewId,
          stripId: strip.id,
          stripTitle: strip.title,
          screen,
          lens,
          platforms: wall.platforms,
          shotWidth: box.shotWidth ?? box.width,
          armContext: previous?.kind === "arm" ? `in ${previous.arm} of ${previous.label}` : null,
          status: frameStatus(screen, lens, wall.platforms),
          onActivate: onFrameActivate,
          onAspect,
        };
        nodes.push({ ...place(box), type: "wallFrame", data });
      } else if (item.kind === "jump") {
        const data: WallJumpData = {
          flowId: item.flowId,
          title: item.title,
          screenCount: item.screenCount,
          onJump,
        };
        nodes.push({ ...place(box), type: "wallJump", data });
      } else if (item.kind === "arm") {
        const data: WallMarkerData = {
          variant: "arm",
          branch: item.branch,
          label: item.label,
          arm: item.arm,
          empty: item.empty,
        };
        nodes.push({ ...place(box), type: "wallMarker", data });
      } else if (item.kind === "end") {
        const arm = armOf?.kind === "arm" ? armOf : undefined;
        const data: WallMarkerData = {
          variant: "end",
          branch: arm?.branch ?? null,
          label: arm?.label ?? "",
          arm: "",
          empty: false,
        };
        nodes.push({ ...place(box), type: "wallMarker", data });
      } else {
        const data: WallMarkerData = { variant: "empty", branch: null, label: "", arm: "", empty: true };
        nodes.push({ ...place(box), type: "wallMarker", data });
      }
    }
    return nodes;
  }, [itemsById, layout, lens, onAspect, onFrameActivate, onJump, onOpenNode, stripsById, wall]);

  const nodes = useMemo(() => {
    if (!ring) return baseNodes;
    return baseNodes.map((node) =>
      node.type === "wallHeader" && node.id === ring.stripId
        ? { ...node, data: { ...(node.data as WallHeaderData), ringVersion: ring.version } }
        : node,
    );
  }, [baseNodes, ring]);

  return (
    // Attribute selectors, not `.react-flow__minimap`: inside an arbitrary
    // variant Tailwind reads `_` as a space, so the class name would never
    // match. Important (`!`), because React Flow's stylesheet is unlayered and
    // its `display: flex` on the controls beats any utility in a layer.
    <div className="@container h-full w-full @max-[60rem]:[&_[class*=minimap]]:hidden! @max-[40rem]:[&_[class*=controls]]:hidden!">
      <Canvas
        nodes={nodes}
        edges={NO_EDGES}
        scope={scope}
        minimapColor="status"
        initialFit={false}
        onlyRenderVisibleElements
        focus={focus}
      >
        <WallCamera request={camera} />
      </Canvas>
    </div>
  );
}
