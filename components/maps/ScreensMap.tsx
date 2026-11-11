"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ReactFlowProvider, useStore, useStoreApi } from "@xyflow/react";
import Link from "next/link";
import { ImageOffIcon, TriangleAlertIcon } from "lucide-react";
import { buildProductUsageIndex, type MapDefinition } from "@arkaik/schema";
import type { CanvasFocus } from "@/components/graph/Canvas";
import type { WallSelection } from "@/components/graph/nodes/wall-node-data";
import { ScreensCanvas } from "@/components/graph/ScreensCanvas";
import { WALL_BAR_INSET, WALL_CAMERA_PADDING, type WallCameraRequest } from "@/components/graph/WallCamera";
import { PageError } from "@/components/layout/PageError";
import { PageLoading } from "@/components/layout/PageLoading";
import { PageShell } from "@/components/layout/PageShell";
import { ScreenInspector } from "@/components/maps/screens/ScreenInspector";
import { ScreensBar } from "@/components/maps/screens/ScreensBar";
import {
  aspectFrom,
  getAspectSnapshot,
  getServerAspectSnapshot,
  reportAspect,
  shotKey,
  subscribeAspects,
} from "@/components/maps/screens/aspect-cache";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import type { JournalEvent, Node as DataNode } from "@/lib/data/types";
import { platformLabel, type PlatformId } from "@/lib/config/platforms";
import { useAcceptanceIntake } from "@/lib/hooks/useAcceptanceIntake";
import { useDisplayPreferences } from "@/lib/hooks/useDisplayPreferences";
import { useEdges } from "@/lib/hooks/useEdges";
import { useJournal } from "@/lib/hooks/useJournal";
import { useNodeRelations } from "@/lib/hooks/useNodeRelations";
import { usePlatformHotkeys } from "@/lib/hooks/usePlatformHotkeys";
import { useNodes } from "@/lib/hooks/useNodes";
import { useProject } from "@/lib/hooks/useProject";
import { useEffectiveProduct } from "@/lib/hooks/useProductScope";
import { useProjectPanels } from "@/lib/hooks/useProjectPanels";
import { GUARDED_HOTKEY, useShortcut } from "@/lib/hooks/useShortcut";
import { generateNodeId } from "@/lib/utils/id";
import { isEditableElement, OPEN_OVERLAY_SELECTOR } from "@/lib/utils/keyboard";
import type { ProductGraph } from "@/lib/utils/product-scope";
import {
  coldLoadTarget,
  frameBoxOf,
  frameInStrip,
  selectionBounds,
  selectionViewport,
  stripTitleRect,
} from "@/lib/utils/screen-inspector";
import { buildWall, gapCount, resolveLens, stripIdOf, type WallLens } from "@/lib/utils/screen-wall";
import {
  keepStripViewport,
  layoutWall,
  neighbourFrame,
  openingViewport,
  stripNearViewport,
  type AspectOf,
  type WallLayout,
} from "@/lib/utils/screen-wall-layout";
import { STALENESS_EVENT_TYPES } from "@/lib/utils/screenshot-staleness";

interface ScreensMapProps {
  projectId: string;
  definition: MapDefinition;
}

/** A failed journal read draws the wall with no events: nothing stale, no proof. */
const NO_EVENTS: readonly JournalEvent[] = [];

/** The zoom range for framing a whole strip: a jump tile's target. */
const STRIP_ZOOM = { minZoom: 0.4, maxZoom: 1 } as const;

/** Framing a selected frame and its chip column: the zoom range, and WallCamera's padding and bar inset. */
const SELECTION_FRAMING = {
  minZoom: 0.6,
  maxZoom: 1,
  padding: WALL_CAMERA_PADDING,
  barInset: WALL_BAR_INSET,
} as const;

/** How long a jumped-to strip's header stays rung. */
const RING_MS = 2000;

type FlowStore = ReturnType<typeof useStoreApi>;

/**
 * Reports, from inside the map's `ReactFlowProvider`, the React Flow store and
 * the strip the reader is in (`stripNearViewport` over `layout`) whenever that
 * changes — once per strip crossed, not per wheel step: the selector returns
 * an id. The controller sits above the provider, so this is how it learns
 * where the camera is.
 */
function WallViewportProbe({
  layout,
  onStore,
  onStrip,
}: {
  layout: WallLayout;
  onStore: (store: FlowStore) => void;
  onStrip: (stripId: string | null) => void;
}) {
  const store = useStoreApi();
  const stripId = useStore((state) =>
    state.width === 0 || state.height === 0
      ? null
      : stripNearViewport(
          layout,
          { x: state.transform[0], y: state.transform[1], zoom: state.transform[2] },
          { width: state.width, height: state.height },
        ),
  );
  useEffect(() => onStore(store), [onStore, store]);
  useEffect(() => onStrip(stripId), [onStrip, stripId]);
  return null;
}

const NO_PLATFORMS: readonly PlatformId[] = [];

/** The bar's live line: "Showing iOS. 4 gaps." / "Showing side by side, gaps only. 1 gap." */
function screensAnnouncement(lens: WallLens, gaps: number, gapsOnly: boolean): string {
  const shown = lens === "side" ? "side by side" : platformLabel(lens);
  return `Showing ${shown}${gapsOnly ? ", gaps only" : ""}. ${gaps} ${gaps === 1 ? "gap" : "gaps"}.`;
}

/**
 * The Screens map's controller (docs/spec/maps.md § Built-in Maps): every flow
 * as a strip of its screens, each frame showing what is live on the chosen
 * platform. `SystemMap`'s twin in shape — data hooks, the wall model, the
 * camera and the panel wiring here; drawing in `ScreensCanvas`.
 *
 * Read-only: nothing on the wall writes. A frame selects itself — the camera
 * frames it, its touch chips fan out under it and the quick inspector shows —
 * and a second activation opens the view's panel; a header opens its flow's
 * panel, and the panel is where editing already works — which is why the shell
 * gets the same write props the other maps pass it.
 *
 * The lens is a preference of the person reading (`useDisplayPreferences`),
 * not of the product: nothing is written to the bundle and there is no Display
 * popover. The rendered lens is always `resolveLens(stored, wall)`, so a scope
 * change never shows a lens the scope lacks, and nothing is written back until
 * the reader chooses.
 */
export function ScreensMap({ projectId, definition }: ScreensMapProps) {
  const { openNode, entries, addressedNodeId } = useProjectPanels();
  const {
    nodes: dataNodes,
    loading: nodesLoading,
    error: nodesError,
    reload: reloadNodes,
    updateNode,
    addNode,
    applyMutations,
  } = useNodes(projectId);
  const { edges: dataEdges, loading: edgesLoading, error: edgesError, reload: reloadEdges, syncEdges } =
    useEdges(projectId);
  const { project: projectBundle, loading: projectLoading, error: projectError, reload: reloadProject } =
    useProject(projectId);
  // Projected to the three types the staleness rule reads: the same cached
  // entry every open panel's caption shares.
  const {
    journal,
    loading: journalLoading,
    error: journalError,
    reload: reloadJournal,
  } = useJournal(projectId, { types: STALENESS_EVENT_TYPES });
  const intake = useAcceptanceIntake({ projectId, nodes: dataNodes, edges: dataEdges, applyMutations, syncEdges });
  const relations = useNodeRelations({ projectId, nodes: dataNodes, edges: dataEdges, applyMutations, syncEdges });
  const scope = useEffectiveProduct(projectId, projectBundle);
  const [preferences, setPreferences] = useDisplayPreferences(projectId);

  const nodesById = useMemo(() => new Map(dataNodes.map((node) => [node.id, node])), [dataNodes]);
  // Built once per snapshot — a graph traversal, never per node.
  const usageIndex = useMemo(() => buildProductUsageIndex(dataNodes, dataEdges), [dataEdges, dataNodes]);
  const productGraph = useMemo<ProductGraph>(
    () => ({ edges: dataEdges, nodesById, usageIndex }),
    [dataEdges, nodesById, usageIndex],
  );

  const events = journalError ? NO_EVENTS : journal;
  const wall = useMemo(
    () =>
      buildWall({
        nodes: dataNodes,
        edges: dataEdges,
        events,
        project: projectBundle?.project,
        definition,
        scope,
        graph: productGraph,
      }),
    [dataEdges, dataNodes, definition, events, productGraph, projectBundle?.project, scope],
  );
  const lens = resolveLens(preferences.screensLens, wall);
  const gapsOnly = preferences.screensGapsOnly;
  const gaps = useMemo(() => gapCount(wall, lens), [wall, lens]);

  // Measured proportions, shared by every visit in this tab. `aspectOf`
  // answers only for the slot's current shot, by its fingerprint (see aspect-cache).
  const aspects = useSyncExternalStore(subscribeAspects, getAspectSnapshot, getServerAspectSnapshot);
  const aspectOf = useMemo<AspectOf>(
    () => (viewId, platform) => {
      const shot = wall.screens.get(viewId)?.cells[platform]?.shot;
      return shot ? aspectFrom(aspects, viewId, platform, shotKey(shot)) : undefined;
    },
    [aspects, wall],
  );
  const layout = useMemo(() => layoutWall(wall, lens, aspectOf), [aspectOf, lens, wall]);

  // --- part 4: selection ---
  // Held as `picked`, read as `selection`: a frame that leaves the layout (a
  // scope or lens change) drops out here, during render, never in an effect.
  const [picked, setPicked] = useState<WallSelection | null>(null);
  const selection = useMemo(
    () => (picked && frameBoxOf(layout, picked.frameId) && wall.screens.has(picked.viewId) ? picked : null),
    [layout, picked, wall],
  );

  // Loading shows the loading page only until the map has been shown once.
  // After that a read going back to loading — an errored journal refetching on
  // Retry or on window focus — keeps the map up: the wall draws without the
  // journal, and swapping in the loading page would drop the canvas, its
  // camera and the reader's place. Latched during render, never in an effect.
  const loaded = !nodesLoading && !edgesLoading && !projectLoading && !journalLoading;
  const [shown, setShown] = useState(false);
  if (loaded && !shown) setShown(true);
  const ready = loaded || shown;

  // The pills at the top of the canvas (no shots yet; the journal failed).
  // Their bottom edge, measured, is the opening camera's top inset, so the
  // first header never sits under them — they wrap to two lines on a phone.
  const pillsUp = journalError !== null || !wall.anyShot;
  const [pillsBottom, setPillsBottom] = useState<number | null>(null);
  const measurePills = useCallback((element: HTMLDivElement | null) => {
    if (!element) return;
    const observer = new ResizeObserver(() => setPillsBottom(element.offsetTop + element.offsetHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // The first camera, and only the first: the first strip's header at the
  // top-left of the canvas, clear of the pills and the bottom bar, at a
  // readable zoom (`openingViewport`); jumps and frame clicks frame with
  // `frameViewport`. Once, as soon as there is a strip to show and the pills
  // (if up) are measured. Adjusted during render rather than in an effect (the
  // derived-state shape `useProjectPanels` uses): React discards this pass and
  // re-renders with the request, so the canvas never paints a frame without it.
  //
  // Part 4: a cold load whose `?node=` names a view or flow on the wall frames
  // that instead (`frameViewport`) — a view's first frame in strip order,
  // selected, or a flow's strip. `ProjectPanelsProvider` has already reconciled
  // the URL during render, so its panel is open too. It sets state directly
  // rather than calling `selectFrame`, because it runs during render.
  const [camera, setCamera] = useState<WallCameraRequest | null>(null);
  const hasStrip = wall.strips.length > 0 && layout.strips.has(wall.strips[0].id);
  const openingInsets = { top: pillsUp ? (pillsBottom ?? 0) : 0, bottom: WALL_BAR_INSET };
  if (ready && camera === null && hasStrip && (!pillsUp || pillsBottom !== null)) {
    const target = coldLoadTarget(wall, layout, addressedNodeId);
    const bounds =
      target?.kind === "frame"
        ? selectionBounds(wall, layout, target.selection.frameId, target.selection.viewId)
        : null;
    if (target?.kind === "frame" && bounds) {
      setPicked(target.selection);
      const inspector = entries.length === 0;
      setCamera({ version: 1, viewport: (size) => selectionViewport(bounds, size, { ...SELECTION_FRAMING, inspector }) });
    } else if (target) {
      setCamera({ version: 1, rect: target.rect, ...STRIP_ZOOM });
    } else {
      setCamera({ version: 1, viewport: (size) => openingViewport(layout, size, openingInsets) });
    }
  }

  // Where the reader is, for the lens and scope rules below: the React Flow
  // store (read in handlers, never during render) and the strip nearest the
  // viewport's vertical centre, as the probe last reported it.
  const flowStore = useRef<FlowStore | null>(null);
  const handleStore = useCallback((store: FlowStore) => {
    flowStore.current = store;
  }, []);
  const [viewedStrip, setViewedStrip] = useState<string | null>(null);

  // A product-scope change keeps the camera unless the reader's strip left the
  // wall with it; then the map opens again, at the top of the new wall. During
  // render, so `viewedStrip` is still the old layout's answer.
  const [seenProduct, setSeenProduct] = useState(scope.productId);
  if (seenProduct !== scope.productId) {
    setSeenProduct(scope.productId);
    if (camera !== null && hasStrip && viewedStrip !== null && !layout.strips.has(viewedStrip)) {
      setCamera({
        version: camera.version + 1,
        viewport: (size) => openingViewport(layout, size, openingInsets),
      });
    }
  }

  // The frame an arrow key moved to: focused, and panned to if off-screen.
  const [focus, setFocus] = useState<CanvasFocus | null>(null);

  // The one way to select (contract: part 5's ⌘K handler calls it too): select
  // the frame, frame it and its chips with the camera, and so show the
  // inspector. It never opens a panel.
  //
  // The camera is computed for the canvas size it runs at
  // (`selectionViewport`): beside a side inspector the card's width comes off
  // the canvas; above a bottom sheet (a canvas under 40rem) the sheet's height is
  // kept clear instead; with a panel open there is no inspector to make room
  // for. "Also in" passes the target strip's title area to frame with it.
  const frameSelection = useCallback(
    (frameId: string, viewId: string, stripId: string, withTitle: boolean): void => {
      setPicked({ frameId, viewId, stripId });
      const bounds = selectionBounds(wall, layout, frameId, viewId);
      if (!bounds) return;
      const framing = {
        ...SELECTION_FRAMING,
        inspector: entries.length === 0,
        header: withTitle ? stripTitleRect(layout, stripId) : null,
      };
      setCamera((previous) => ({
        version: (previous?.version ?? 0) + 1,
        viewport: (size) => selectionViewport(bounds, size, framing),
      }));
    },
    [entries.length, layout, wall],
  );
  const selectFrame = useCallback(
    (frameId: string, viewId: string, stripId: string): void => frameSelection(frameId, viewId, stripId, false),
    [frameSelection],
  );

  // Part 4 replaces part 2's click grammar: the first activation selects, a
  // second activation of the selected frame (click, Enter or Space) opens the panel.
  const handleFrameActivate = useCallback(
    (frameId: string, viewId: string, stripId: string) => {
      if (selection?.frameId === frameId) {
        openNode({ nodeId: viewId });
        return;
      }
      selectFrame(frameId, viewId, stripId);
    },
    [openNode, selectFrame, selection],
  );

  const handlePaneClick = useCallback(() => setPicked(null), []);

  // Arrow keys move focus only (spec § Keys); the canvas pans if the frame is off-screen.
  const handleFrameMove = useCallback(
    (frameId: string, dir: "left" | "right" | "up" | "down") => {
      const next = neighbourFrame(layout, frameId, dir);
      if (next) setFocus((previous) => ({ nodeId: next, version: (previous?.version ?? 0) + 1 }));
    },
    [layout],
  );

  const handleOpenNode = useCallback((nodeId: string) => openNode({ nodeId }), [openNode]);

  // A strip header's ring, whoever raises it (a jump tile, "Also in …"):
  // raised now, cleared RING_MS later from a timer started here — never from
  // an effect. A new ring replaces the last one and cancels its timer; the
  // timer is cancelled on unmount too. The version guard is kept as a belt.
  const [ring, setRing] = useState<{ stripId: string; version: number } | null>(null);
  const ringSequence = useRef(0);
  const ringTimer = useRef<number | undefined>(undefined);
  const ringStrip = useCallback((stripId: string): void => {
    ringSequence.current += 1;
    const version = ringSequence.current;
    setRing({ stripId, version });
    window.clearTimeout(ringTimer.current);
    ringTimer.current = window.setTimeout(() => {
      ringTimer.current = undefined;
      setRing((current) => (current?.version === version ? null : current));
    }, RING_MS);
  }, []);
  useEffect(() => () => window.clearTimeout(ringTimer.current), []);

  // A jump tile flies to its target strip and rings the header for 2s. Named,
  // and kept a plain controller function, because later parts call it from
  // inside this controller too (⌘K flies to a flow through it).
  const jumpToFlow = useCallback(
    (flowId: string): void => {
      const stripId = stripIdOf(flowId);
      const rect = layout.strips.get(stripId);
      if (!rect) return;
      setCamera((previous) => ({ version: (previous?.version ?? 0) + 1, rect, ...STRIP_ZOOM }));
      ringStrip(stripId);
    },
    [layout, ringStrip],
  );

  const inspectorRef = useRef<HTMLDivElement | null>(null);

  // The inspector stands aside while a panel is open (below). Opening one from
  // inside it — a Touches entry, "Open panel" — unmounts the element that had
  // focus, which would drop focus on the body. Focus moves to the selected
  // frame instead, which keeps its ring: Escape and Tab carry on from there.
  // Focus is tracked as it enters and leaves the inspector, because an element
  // removed from the page fires no blur.
  const focusInInspector = useRef(false);
  const inspectorShown = selection !== null && entries.length === 0;
  useLayoutEffect(() => {
    if (inspectorShown || !focusInInspector.current) return;
    focusInInspector.current = false;
    if (!selection) return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    document
      .querySelector<HTMLElement>(`[data-wall-frame="${CSS.escape(selection.frameId)}"]`)
      ?.focus({ preventScroll: true });
  }, [inspectorShown, selection]);

  // "Also in …": the same view, selected in another strip, whose header rings.
  const handleGoToStrip = useCallback(
    (stripId: string) => {
      if (!selection) return;
      const frameId = frameInStrip(wall, stripId, selection.viewId);
      if (!frameId) return;
      frameSelection(frameId, selection.viewId, stripId, true);
      ringStrip(stripId);
    },
    [frameSelection, ringStrip, selection, wall],
  );

  const clearSelection = useCallback(() => {
    if (!selection) return;
    const focusWasInInspector = inspectorRef.current?.contains(document.activeElement) ?? false;
    setPicked(null);
    if (focusWasInInspector) {
      document
        .querySelector<HTMLElement>(`[data-wall-frame="${CSS.escape(selection.frameId)}"]`)
        ?.focus({ preventScroll: true });
    }
  }, [selection]);

  // Escape clears the selection only with no panel open: while one is, Escape
  // is the panel stack's (PanelStack), which closes the top panel first. The
  // guards mirror PanelStack's, so Escape in a field, an open menu or the ⌘K
  // dialog is theirs.
  useShortcut(
    "close",
    (event) => {
      if (event.defaultPrevented || event.repeat) return;
      if (isEditableElement(event.target)) return;
      if (document.querySelector(OPEN_OVERLAY_SELECTOR)) return;
      event.preventDefault();
      clearSelection();
    },
    { ...GUARDED_HOTKEY, enabled: selection !== null && entries.length === 0 },
  );

  // A lens change reshapes every strip (Web is about three times as wide as
  // iOS), so it keeps the reader in the strip they were in: when the
  // viewport's centre would land outside that strip's new extent, pan along
  // it — same zoom, same height — to bring its start to the left edge.
  const handleLensChange = useCallback(
    (next: WallLens) => {
      const store = flowStore.current;
      if (store && next !== lens) {
        const { transform, width, height } = store.getState();
        const viewport = { x: transform[0], y: transform[1], zoom: transform[2] };
        const size = { width, height };
        const stripId = width > 0 && height > 0 ? stripNearViewport(layout, viewport, size) : null;
        const kept =
          stripId === null
            ? null
            : keepStripViewport(layoutWall(wall, next, aspectOf), stripId, viewport, size, WALL_CAMERA_PADDING);
        if (kept) setCamera((previous) => ({ version: (previous?.version ?? 0) + 1, viewport: () => kept }));
      }
      setPreferences({ screensLens: next });
    },
    [aspectOf, layout, lens, setPreferences, wall],
  );

  const handleGapsOnlyChange = useCallback(
    (next: boolean) => setPreferences({ screensGapsOnly: next }),
    [setPreferences],
  );

  // I / W / A over the lens. "all" is side by side: pressing the platform shown
  // goes side by side, pressing a platform from side by side shows it
  // (`nextPlatformFilter`'s toggle). Live only where the wall and the bar are:
  // a key that cannot act must not be registered as live, or it would
  // silently rewrite the stored lens. Above the loading early return, because
  // hooks run on every render.
  const lensChoices = wall.platforms.length >= 2 && wall.empty !== "nothing" ? wall.platforms : NO_PLATFORMS;
  usePlatformHotkeys({
    enabled: lensChoices.length >= 2,
    available: lensChoices.map((id) => ({ id })),
    current: lens === "side" ? "all" : lens,
    onSelect: (next) => handleLensChange(next === "all" ? "side" : next),
  });

  const handleNodeUpdate = useCallback(
    async (nodeId: string, patch: Partial<Omit<DataNode, "id" | "project_id">>) => {
      await updateNode(nodeId, patch);
    },
    [updateNode],
  );

  const handleCreateNodeFromPanel = useCallback(
    async (species: "flow" | "view", title: string) =>
      addNode({
        id: generateNodeId(species, title, nodesById.keys()),
        project_id: projectId,
        title,
        species,
        status: "idea",
        platforms: [],
      }),
    [addNode, nodesById, projectId],
  );

  if (!ready) {
    return <PageLoading label="screens" />;
  }

  // A blank wall would read as "nothing has screens" — the one thing a failed
  // read must never say (#362). The journal is the exception: without it the
  // wall still draws, and a notice says what it cannot know.
  const loadError = nodesError ?? edgesError ?? projectError;
  if (loadError) {
    return (
      <PageError
        label="screens"
        message={loadError}
        onRetry={() => {
          void reloadNodes();
          void reloadEdges();
          void reloadProject();
        }}
      />
    );
  }

  return (
    <PageShell
      title={definition.title}
      surfaceCard
      allNodes={dataNodes}
      allEdges={dataEdges}
      scope={scope}
      history
      onUpdate={handleNodeUpdate}
      onScreenshot={async (op) => {
        await applyMutations([op]);
      }}
      onCreateNode={handleCreateNodeFromPanel}
      intake={intake}
      relations={relations}
    >
      {wall.empty === "nothing" ? (
        <div className="h-full w-full flex items-center justify-center p-6">
          <EmptyState
            message="Nothing to put on the wall yet. Screens line up by flow — sketch one on the Journey map."
            action={
              <Button asChild size="sm" variant="outline" className="cursor-pointer">
                <Link href={`/project/${projectId}/maps/journey`}>Open the Journey map</Link>
              </Button>
            }
          />
        </div>
      ) : (
        <div className="@container relative h-full w-full">
          {/* The canvas's own React Flow store, lifted so the probe beside it can
              read where the camera is. Only the canvas: a panel's graph must
              never share it. */}
          <ReactFlowProvider>
            <ScreensCanvas
              wall={wall}
              layout={layout}
              lens={lens}
              scope={scope}
              focus={focus}
              camera={camera}
              ring={ring}
              onFrameActivate={handleFrameActivate}
              onOpenNode={handleOpenNode}
              onJump={jumpToFlow}
              onAspect={reportAspect}
              // Gaps only with nothing to fix fades nothing: a whole wall at
              // 15% would read as broken. The bar says why instead.
              gapsOnly={gapsOnly && gaps > 0}
              selection={selection}
              onPaneClick={handlePaneClick}
              onFrameMove={handleFrameMove}
            />
            <WallViewportProbe layout={layout} onStore={handleStore} onStrip={setViewedStrip} />
          </ReactFlowProvider>
          {pillsUp && (
            <div
              ref={measurePills}
              className="pointer-events-none absolute inset-x-0 top-3 z-10 flex flex-col items-center gap-2 px-3"
            >
              {journalError !== null && (
                <div
                  role="status"
                  className="pointer-events-auto flex max-w-full items-center gap-2 rounded-full border bg-card py-1 pr-1 pl-3 text-xs shadow-sm"
                >
                  <TriangleAlertIcon className="size-3.5 shrink-0 text-amber-500 dark:text-amber-400" aria-hidden="true" />
                  <span>Couldn&apos;t read the journal, so stale shots and deploy proof are unknown.</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 cursor-pointer rounded-full px-2 text-xs"
                    onClick={() => void reloadJournal()}
                  >
                    Retry
                  </Button>
                </div>
              )}
              {!wall.anyShot && (
                <div
                  role="status"
                  className="pointer-events-auto flex max-w-full items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-xs shadow-sm"
                >
                  <ImageOffIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span>
                    No screenshots yet. CI records them with <code className="font-mono">arkaik shot</code>, and
                    anyone can add one from a view&apos;s panel.
                  </span>
                </div>
              )}
            </div>
          )}
          {/* The inspector stands aside while any panel is open: the panel already
              says everything it would, and the narrowed canvas would turn it
              into a bottom sheet over the frame and its chips. The ring and the
              chips stay; closing the panel brings it back. */}
          {inspectorShown && (
            <div
              ref={inspectorRef}
              className="contents"
              onFocus={() => {
                focusInInspector.current = true;
              }}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) focusInInspector.current = false;
              }}
            >
              <ScreenInspector
                wall={wall}
                selection={selection}
                onOpenPanel={handleOpenNode}
                onGoToStrip={handleGoToStrip}
              />
            </div>
          )}
          <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex flex-col items-center gap-2 px-3">
            <ScreensBar
              platforms={wall.platforms}
              lens={lens}
              onLensChange={handleLensChange}
              announcement={screensAnnouncement(lens, gaps, gapsOnly)}
              gapsOnly={gapsOnly}
              gapCount={gaps}
              onGapsOnlyChange={handleGapsOnlyChange}
            />
          </div>
        </div>
      )}
    </PageShell>
  );
}
