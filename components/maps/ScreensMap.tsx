"use client";

import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ImageOffIcon, TriangleAlertIcon } from "lucide-react";
import { buildProductUsageIndex, type MapDefinition } from "@arkaik/schema";
import type { CanvasFocus } from "@/components/graph/Canvas";
import { ScreensCanvas } from "@/components/graph/ScreensCanvas";
import { WALL_BAR_INSET, type WallCameraRequest } from "@/components/graph/WallCamera";
import { PLATFORM_LABELS } from "@/components/graph/nodes/node-styles";
import { PageError } from "@/components/layout/PageError";
import { PageLoading } from "@/components/layout/PageLoading";
import { PageShell } from "@/components/layout/PageShell";
import { ScreensBar } from "@/components/maps/screens/ScreensBar";
import {
  aspectFrom,
  getAspectSnapshot,
  getServerAspectSnapshot,
  reportAspect,
  subscribeAspects,
} from "@/components/maps/screens/aspect-cache";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import type { JournalEvent, Node as DataNode } from "@/lib/data/types";
import { useAcceptanceIntake } from "@/lib/hooks/useAcceptanceIntake";
import { useDisplayPreferences } from "@/lib/hooks/useDisplayPreferences";
import { useEdges } from "@/lib/hooks/useEdges";
import { useJournal } from "@/lib/hooks/useJournal";
import { useNodeRelations } from "@/lib/hooks/useNodeRelations";
import { useNodes } from "@/lib/hooks/useNodes";
import { useProject } from "@/lib/hooks/useProject";
import { useEffectiveProduct } from "@/lib/hooks/useProductScope";
import { useProjectPanels } from "@/lib/hooks/useProjectPanels";
import { generateNodeId } from "@/lib/utils/id";
import { platformAvailabilityShape, type ProductGraph } from "@/lib/utils/product-scope";
import { buildWall, resolveLens, stripIdOf, type WallLens } from "@/lib/utils/screen-wall";
import { layoutWall, openingViewport, type AspectOf } from "@/lib/utils/screen-wall-layout";
import { STALENESS_EVENT_TYPES } from "@/lib/utils/screenshot-staleness";

interface ScreensMapProps {
  projectId: string;
  definition: MapDefinition;
}

/** A failed journal read draws the wall with no events: nothing stale, no proof. */
const NO_EVENTS: readonly JournalEvent[] = [];

/** The zoom range for framing a whole strip: a jump tile's target. */
const STRIP_ZOOM = { minZoom: 0.4, maxZoom: 1 } as const;

/** How long a jumped-to strip's header stays rung. */
const RING_MS = 2000;

/**
 * The Screens map's controller (docs/spec/maps.md § Built-in Maps): every flow
 * as a strip of its screens, each frame showing what is live on the chosen
 * platform. `SystemMap`'s twin in shape — data hooks, the wall model, the
 * camera and the panel wiring here; drawing in `ScreensCanvas`.
 *
 * Read-only: nothing on the wall writes. A frame opens the view's panel and
 * centres itself (the System map's grammar), a header opens its flow's panel,
 * and the panel is where editing already works — which is why the shell gets
 * the same write props the other maps pass it.
 *
 * The lens is a preference of the person reading (`useDisplayPreferences`),
 * not of the product: nothing is written to the bundle and there is no Display
 * popover. The rendered lens is always `resolveLens(stored, wall)`, so a scope
 * change never shows a lens the scope lacks, and nothing is written back until
 * the reader chooses.
 */
export function ScreensMap({ projectId, definition }: ScreensMapProps) {
  const { openNode } = useProjectPanels();
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

  // Measured proportions, shared by every visit in this tab. `aspectOf`
  // answers only for the slot's current value (see aspect-cache).
  const aspects = useSyncExternalStore(subscribeAspects, getAspectSnapshot, getServerAspectSnapshot);
  const aspectOf = useMemo<AspectOf>(
    () => (viewId, platform) => {
      const value = wall.screens.get(viewId)?.cells[platform]?.shot?.value;
      return value === undefined ? undefined : aspectFrom(aspects, viewId, platform, value);
    },
    [aspects, wall],
  );
  const layout = useMemo(() => layoutWall(wall, lens, aspectOf), [aspectOf, lens, wall]);

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
  const [camera, setCamera] = useState<WallCameraRequest | null>(null);
  const hasStrip = wall.strips.length > 0 && layout.strips.has(wall.strips[0].id);
  if (ready && camera === null && hasStrip && (!pillsUp || pillsBottom !== null)) {
    const insets = { top: pillsUp ? (pillsBottom ?? 0) : 0, bottom: WALL_BAR_INSET };
    setCamera({ version: 1, viewport: (size) => openingViewport(layout, size, insets) });
  }

  // The frame a click activated, centred in whatever canvas the panel leaves.
  const [focus, setFocus] = useState<CanvasFocus | null>(null);
  const handleFrameActivate = useCallback(
    (frameId: string, viewId: string) => {
      openNode({ nodeId: viewId });
      setFocus((previous) => ({ nodeId: frameId, version: (previous?.version ?? 0) + 1 }));
    },
    [openNode],
  );

  const handleOpenNode = useCallback((nodeId: string) => openNode({ nodeId }), [openNode]);

  // A jump tile flies to its target strip and rings the header for 2s. Named,
  // and kept a plain controller function, because later parts call it from
  // inside this controller too (⌘K flies to a flow through it). The ring
  // clears itself from a timer started here — never from an effect — and only
  // if no later jump replaced it. Part 4 adds `selectFrame` beside it.
  const [ring, setRing] = useState<{ stripId: string; version: number } | null>(null);
  const ringSequence = useRef(0);
  const jumpToFlow = useCallback(
    (flowId: string): void => {
      const stripId = stripIdOf(flowId);
      const rect = layout.strips.get(stripId);
      if (!rect) return;
      setCamera((previous) => ({ version: (previous?.version ?? 0) + 1, rect, ...STRIP_ZOOM }));
      ringSequence.current += 1;
      const version = ringSequence.current;
      setRing({ stripId, version });
      window.setTimeout(() => {
        setRing((current) => (current?.version === version ? null : current));
      }, RING_MS);
    },
    [layout],
  );

  const handleLensChange = useCallback(
    (next: WallLens) => setPreferences({ screensLens: next }),
    [setPreferences],
  );

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

  const showBar = platformAvailabilityShape(wall.platforms) === "rings";
  const announcement =
    lens === "side" ? "Showing every platform side by side." : `Showing ${PLATFORM_LABELS[lens]}.`;

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
          />
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
          {showBar && (
            <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center px-3">
              <ScreensBar
                platforms={wall.platforms}
                lens={lens}
                onLensChange={handleLensChange}
                announcement={announcement}
              />
            </div>
          )}
        </div>
      )}
    </PageShell>
  );
}
