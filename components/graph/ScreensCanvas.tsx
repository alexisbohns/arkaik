"use client";

import { useEffect, useMemo, useRef } from "react";
import { useReactFlow, useStoreApi, type BuiltInEdge, type Edge, type Node } from "@xyflow/react";
import { Canvas, type CanvasFocus } from "@/components/graph/Canvas";
import { WALL_BAR_INSET, WallCamera, type WallCameraRequest } from "@/components/graph/WallCamera";
import type {
  AspectReport,
  WallChipData,
  WallFrameData,
  WallHeaderData,
  WallJumpData,
  WallMarkerData,
  WallSelection,
} from "@/components/graph/nodes/wall-node-data";
import type { PlatformId } from "@/lib/config/platforms";
import type { StatusId } from "@/lib/config/statuses";
import { getRollupDisplayStatus, type PlatformStatusCounts } from "@/lib/utils/platform-status";
import type { ProductScope } from "@/lib/utils/product-scope";
import { frameBoxOf, frameDimmed, planChips } from "@/lib/utils/screen-inspector";
import {
  isGapCell,
  isGapFrame,
  lensPlatforms,
  stripCountsLine,
  type Wall,
  type WallItem,
  type WallLens,
  type WallScreen,
} from "@/lib/utils/screen-wall";
import type { WallBox, WallLayout } from "@/lib/utils/screen-wall-layout";

export interface ScreensCanvasProps {
  wall: Wall;
  layout: WallLayout;
  lens: WallLens;
  scope: ProductScope;
  /**
   * An arrow-key move (part 4): the frame to focus, panned to only when it is
   * not wholly on screen (`FrameFocusFollower`). No longer handed to `Canvas`.
   */
  focus: CanvasFocus | null;
  camera: WallCameraRequest | null;
  /** The strip a jump tile just landed on: its header rings while this is set. */
  ring: { stripId: string; version: number } | null;
  onFrameActivate: (frameId: string, viewId: string, stripId: string) => void;
  /** A header's flow panel; a touch chip's node panel. */
  onOpenNode: (nodeId: string) => void;
  onJump: (flowId: string) => void;
  onAspect: AspectReport;
  /** Gaps only: everything but stale shots and live screens with no shot fades. */
  gapsOnly: boolean;
  /** The selected frame: ringed, with its touch chips and edges fanned out under it. */
  selection: WallSelection | null;
  onPaneClick: () => void;
  onFrameMove: (frameId: string, dir: "left" | "right" | "up" | "down") => void;
}

/** Every wall node is inert to React Flow: focus and activation live on the element inside. */
const INERT = { draggable: false, connectable: false, selectable: false, focusable: false } as const;

const NO_ROWS: readonly PlatformId[] = [];

/** Gaps only: the views whose frames stay lit — live on a lens platform with a stale shot or none. */
function keptViews(wall: Wall, lens: WallLens): ReadonlySet<string> {
  const kept = new Set<string>();
  for (const viewId of wall.screens.keys()) {
    if (isGapFrame(wall, viewId, lens)) kept.add(viewId);
  }
  return kept;
}

/** Inside a lit side-by-side frame, the rows that are not gaps themselves (drawn at 35%). */
function fadedRows(wall: Wall, viewId: string, lens: WallLens): readonly PlatformId[] {
  if (lens !== "side") return NO_ROWS;
  const screen = wall.screens.get(viewId);
  if (!screen) return NO_ROWS;
  return lensPlatforms(wall, lens).filter((platform) => {
    const cell = screen.cells[platform];
    return cell === undefined || !isGapCell(cell);
  });
}

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

/** The touch chips and edges of the selected frame (part 4). */
interface TouchLayer {
  nodes: Node[];
  edges: Edge[];
}
const NO_TOUCHES: TouchLayer = { nodes: [], edges: [] };

/**
 * Follows an arrow-key move (`focus`): pans to the frame only when it is not
 * wholly inside the canvas above the bar, at the current zoom, then focuses it
 * once React Flow has mounted it (`onlyRenderVisibleElements` mounts nothing
 * off-screen), retrying over up to five animation frames. Rendered inside
 * <ReactFlow> because it needs the instance and the store. The work starts in
 * a timeout and marks the version handled there, as CameraFocus does, so
 * StrictMode's effect replay cannot swallow a move.
 */
function FrameFocusFollower({ target, layout }: { target: CanvasFocus | null; layout: WallLayout }) {
  const reactFlow = useReactFlow();
  const store = useStoreApi();
  const layoutRef = useRef(layout);
  const handled = useRef(0);

  useEffect(() => {
    layoutRef.current = layout;
  }, [layout]);

  useEffect(() => {
    if (!target || target.version === handled.current) return;
    let cancelled = false;
    let frame = 0;
    let settle: ReturnType<typeof setTimeout> | undefined;

    const start = setTimeout(() => {
      handled.current = target.version;
      const box = layoutRef.current.boxes.find((candidate) => candidate.id === target.nodeId);
      if (!box) return;

      const { width, height, transform } = store.getState();
      const [tx, ty, zoom] = transform;
      const left = box.x * zoom + tx;
      const top = box.y * zoom + ty;
      const visible =
        left >= 0 && top >= 0 && left + box.width * zoom <= width && top + box.height * zoom <= height - WALL_BAR_INSET;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const duration = visible || reduce ? 0 : 300;
      if (!visible) {
        void reactFlow.setCenter(box.x + box.width / 2, box.y + box.height / 2, { zoom, duration, interpolate: "linear" });
      }

      let attempts = 0;
      const focusWhenMounted = () => {
        if (cancelled) return;
        const element = document.querySelector<HTMLElement>(`[data-wall-frame="${CSS.escape(target.nodeId)}"]`);
        if (element) {
          element.focus({ preventScroll: true });
          return;
        }
        attempts += 1;
        if (attempts < 5) frame = requestAnimationFrame(focusWhenMounted);
      };
      settle = setTimeout(() => {
        frame = requestAnimationFrame(focusWhenMounted);
      }, duration);
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(start);
      if (settle !== undefined) clearTimeout(settle);
      cancelAnimationFrame(frame);
    };
  }, [reactFlow, store, target]);

  return null;
}

/**
 * The Screens map's presentational half — `SystemCanvas`'s twin: the wall
 * model and its layout in, React Flow nodes out, drawn by `Canvas`. Every
 * position and size comes from the layout (`WallBox`), so React Flow and the
 * Minimap know each node's box before measuring it, which is what lets
 * `onlyRenderVisibleElements` keep off-screen shots unmounted.
 *
 * No edges but the selected frame's touch edges (to its chips), no connect, no
 * drag, no spotlight, and no `onNodeClick`: frames, headers, jump tiles and
 * chips activate from their own elements. The first camera is
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
  gapsOnly,
  selection,
  onPaneClick,
  onFrameMove,
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

  const kept = useMemo(() => (gapsOnly ? keptViews(wall, lens) : null), [gapsOnly, lens, wall]);

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
          dimmed: kept !== null && !strip.viewIds.some((viewId) => kept.has(viewId)),
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
          dimmed: frameDimmed(kept, item.viewId, item.id, selection),
          dimmedRows: kept !== null && kept.has(item.viewId) ? fadedRows(wall, item.viewId, lens) : NO_ROWS,
          selected: selection?.frameId === box.id,
          onMove: onFrameMove,
        };
        nodes.push({ ...place(box), type: "wallFrame", data });
      } else if (item.kind === "jump") {
        const data: WallJumpData = {
          flowId: item.flowId,
          title: item.title,
          screenCount: item.screenCount,
          onJump,
          dimmed: kept !== null,
        };
        nodes.push({ ...place(box), type: "wallJump", data });
      } else if (item.kind === "arm") {
        const data: WallMarkerData = {
          variant: "arm",
          branch: item.branch,
          label: item.label,
          arm: item.arm,
          empty: item.empty,
          dimmed: kept !== null,
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
          dimmed: kept !== null,
        };
        nodes.push({ ...place(box), type: "wallMarker", data });
      } else {
        const data: WallMarkerData = {
          variant: "empty",
          branch: null,
          label: "",
          arm: "",
          empty: true,
          dimmed: kept !== null,
        };
        nodes.push({ ...place(box), type: "wallMarker", data });
      }
    }
    return nodes;
  }, [itemsById, kept, layout, lens, onAspect, onFrameActivate, onFrameMove, onJump, onOpenNode, selection, stripsById, wall]);

  const nodes = useMemo(() => {
    if (!ring) return baseNodes;
    return baseNodes.map((node) =>
      node.type === "wallHeader" && node.id === ring.stripId
        ? { ...node, data: { ...(node.data as WallHeaderData), ringVersion: ring.version } }
        : node,
    );
  }, [baseNodes, ring]);

  const touchLayer = useMemo<TouchLayer>(() => {
    if (!selection) return NO_TOUCHES;
    const frame = frameBoxOf(layout, selection.frameId);
    const screen = wall.screens.get(selection.viewId);
    if (!frame || !screen || screen.touches.length === 0) return NO_TOUCHES;

    const plan = planChips(frame, screen.touches);
    return {
      nodes: plan.chips.map((chip): Node => {
        const data: WallChipData =
          chip.kind === "touch"
            ? { kind: "touch", frameId: frame.id, touch: chip.touch, onOpen: onOpenNode }
            : { kind: "more", frameId: frame.id, viewId: selection.viewId, count: chip.count, onOpen: onOpenNode };
        return {
          id: chip.id,
          type: "wallChip",
          position: { x: chip.rect.x, y: chip.rect.y },
          width: chip.rect.width,
          height: chip.rect.height,
          zIndex: 1000,
          draggable: false,
          connectable: false,
          selectable: false,
          focusable: false,
          domAttributes: { "aria-hidden": true },
          data,
        };
      }),
      edges: plan.edges.map(
        (edge): BuiltInEdge => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          sourceHandle: "touch",
          targetHandle: "touch",
          // A tidy tree: the frame's handle sits TOUCH_TRUNK_X in from its left
          // corner and every chip TOUCH_STUB to the right of it, so React
          // Flow's step edge with no offset runs straight down the shared trunk
          // and turns right into the chip on one rounded corner.
          type: "smoothstep",
          pathOptions: { offset: 0, borderRadius: 6 },
          zIndex: 1000,
          focusable: false,
          selectable: false,
          deletable: false,
          domAttributes: { "aria-hidden": true },
          style: { stroke: "hsl(var(--muted-foreground))", strokeWidth: 1.25 },
        }),
      ),
    };
  }, [layout, onOpenNode, selection, wall]);

  const shownNodes = useMemo(
    () => (touchLayer.nodes.length > 0 ? [...nodes, ...touchLayer.nodes] : nodes),
    [nodes, touchLayer],
  );

  return (
    // Attribute selectors, not `.react-flow__minimap`: inside an arbitrary
    // variant Tailwind reads `_` as a space, so the class name would never
    // match. Important (`!`), because React Flow's stylesheet is unlayered and
    // its `display: flex` on the controls beats any utility in a layer.
    <div className="@container h-full w-full @max-[60rem]:[&_[class*=minimap]]:hidden! @max-[40rem]:[&_[class*=controls]]:hidden!">
      <Canvas
        nodes={shownNodes}
        edges={touchLayer.edges}
        scope={scope}
        minimapColor="status"
        initialFit={false}
        onlyRenderVisibleElements
        focus={null}
        onPaneClick={onPaneClick}
      >
        <WallCamera request={camera} />
        <FrameFocusFollower target={focus} layout={layout} />
      </Canvas>
    </div>
  );
}
