"use client";

import { useMemo } from "react";
import { useParams } from "next/navigation";
import { computeMapSubgraph, listMaps } from "@arkaik/schema";
import { BacklogCard } from "@/components/overview/BacklogCard";
import { DeliverySnapshotCard } from "@/components/overview/DeliverySnapshotCard";
import { HealthCard } from "@/components/overview/HealthCard";
import { InventoryCard } from "@/components/overview/InventoryCard";
import { MapsCard, type MapsCardEntry } from "@/components/overview/MapsCard";
import { PlatformGaugesCard } from "@/components/overview/PlatformGaugesCard";
import { ReleasePulseCard } from "@/components/overview/ReleasePulseCard";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useEdges } from "@/lib/hooks/useEdges";
import { useJournal } from "@/lib/hooks/useJournal";
import { useNodes } from "@/lib/hooks/useNodes";
import { useProject } from "@/lib/hooks/useProject";
import {
  computeDeliverySnapshot,
  computeHealthIndicators,
  computeInventory,
  computeProductRollup,
  computeReleasePulse,
} from "@/lib/utils/coverage";
import { computeBacklog } from "@/lib/utils/journal";
import { getRollupPlatforms } from "@/lib/utils/platform-status";

/**
 * The Overview: "Where does this product stand?" — the strategist reading
 * (vision.md § Core Product; docs/spec/maps.md § Overview Composition).
 * Pure projections from lib/utils/coverage.ts composed into one screen;
 * every card jumps off into the working surface that owns the detail.
 * Deliberately read-only.
 */
export default function OverviewPage() {
  const params = useParams();
  const id = Array.isArray(params.id) ? params.id[0] : params.id ?? "";

  const { nodes: dataNodes, loading: nodesLoading } = useNodes(id);
  const { edges: dataEdges, loading: edgesLoading } = useEdges(id);
  const { project: projectBundle, loading: projectLoading } = useProject(id);
  const { journal, loading: journalLoading } = useJournal(id);

  const nodesById = useMemo(
    () => new Map(dataNodes.map((node) => [node.id, node])),
    [dataNodes],
  );

  const inventory = useMemo(
    () => computeInventory(dataNodes, dataEdges, journal),
    [dataEdges, dataNodes, journal],
  );

  const rollup = useMemo(() => computeProductRollup(dataNodes, dataEdges), [dataNodes, dataEdges]);
  const gaugePlatforms = useMemo(() => getRollupPlatforms(rollup), [rollup]);

  const releases = useMemo(
    () => computeReleasePulse(journal, { nodesById }),
    [journal, nodesById],
  );

  const backlog = useMemo(
    () => computeBacklog(journal, { existingNodeIds: new Set(dataNodes.map((node) => node.id)) }),
    [dataNodes, journal],
  );

  const snapshot = useMemo(() => computeDeliverySnapshot(dataNodes), [dataNodes]);

  const health = useMemo(
    () =>
      computeHealthIndicators(dataNodes, dataEdges, journal, {
        rootNodeId: projectBundle?.project.root_node_id,
      }),
    [dataEdges, dataNodes, journal, projectBundle],
  );

  const maps = useMemo<MapsCardEntry[]>(() => {
    if (!projectBundle) return [];
    return listMaps(projectBundle.project).map((definition) => {
      const subgraph = computeMapSubgraph(definition, dataNodes, dataEdges);
      return { definition, nodeCount: subgraph.nodes.length, edgeCount: subgraph.edges.length };
    });
  }, [dataEdges, dataNodes, projectBundle]);

  if (nodesLoading || edgesLoading || projectLoading || journalLoading) {
    return (
      <div className="h-full w-full flex items-center justify-center">
        <span className="text-muted-foreground text-sm">Loading overview...</span>
      </div>
    );
  }

  const isEmpty = dataNodes.length === 0 && journal.length === 0;

  return (
    <div className="h-full w-full flex flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <SidebarTrigger className="-ml-1 cursor-pointer" />
        <Separator orientation="vertical" className="mx-1 h-4" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{projectBundle?.project.title ?? "Untitled project"}</p>
          <p className="truncate text-xs text-muted-foreground">Overview</p>
        </div>
        {projectBundle?.project.version && (
          <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            <span>Current version</span>
            <span className="rounded-full border px-2 py-0.5 font-medium text-foreground">
              {projectBundle.project.version}
            </span>
          </div>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-4 md:p-6">
        <div className="mx-auto grid w-full max-w-5xl gap-4 md:grid-cols-2">
          {isEmpty ? (
            <div className="rounded-xl border border-dashed p-10 text-center md:col-span-2">
              <p className="text-sm text-muted-foreground">
                Nothing here yet. Sketch the product on the Journey map or add nodes in the Library, and the
                Overview fills itself in.
              </p>
            </div>
          ) : (
            <>
              <PlatformGaugesCard rollup={rollup} platforms={gaugePlatforms} projectId={id} />
              <DeliverySnapshotCard snapshot={snapshot} projectId={id} />
              <ReleasePulseCard releases={releases} projectId={id} />
              <BacklogCard backlog={backlog} projectId={id} />
              <InventoryCard inventory={inventory} projectId={id} />
              <HealthCard indicators={health} projectId={id} />
              <MapsCard maps={maps} projectId={id} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
