"use client";

import { useMemo } from "react";
import { useParams } from "next/navigation";
import { buildProductUsageIndex, computeMapSubgraph, computeParityGaps, listMaps } from "@arkaik/schema";
import { BacklogCard } from "@/components/overview/BacklogCard";
import { DeliverySnapshotCard } from "@/components/overview/DeliverySnapshotCard";
import { HealthCard } from "@/components/overview/HealthCard";
import { InventoryCard } from "@/components/overview/InventoryCard";
import { MapsCard, type MapsCardEntry } from "@/components/overview/MapsCard";
import { ParityCard } from "@/components/overview/ParityCard";
import { PlatformGaugesCard } from "@/components/overview/PlatformGaugesCard";
import { PyramidCard } from "@/components/overview/PyramidCard";
import { ReleasePulseCard } from "@/components/overview/ReleasePulseCard";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useEdges } from "@/lib/hooks/useEdges";
import { useJournal } from "@/lib/hooks/useJournal";
import { useNodes } from "@/lib/hooks/useNodes";
import { useEffectiveProduct } from "@/lib/hooks/useProductScope";
import { useProject } from "@/lib/hooks/useProject";
import { EMPTY_FILTERS, filterAcceptances } from "@/lib/utils/acceptance-matrix";
import {
  computeDeliverySnapshot,
  computeHealthIndicators,
  computeInventory,
  computeProductRollup,
  computeReleasePulse,
} from "@/lib/utils/coverage";
import { computeBacklog } from "@/lib/utils/journal";
import { getRollupPlatforms } from "@/lib/utils/platform-status";
import { mapScopedNodes, type ProductGraph } from "@/lib/utils/product-scope";
import { computeScopedPyramidTiers } from "@/lib/utils/pyramid";

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

  // The shell's scope, never a URL param (§ Decision 2). `projectBundle` is
  // `undefined` until `useProject`'s effect lands, and a scope resolved from
  // nothing declares no products — every platform, every node, i.e. today's
  // Overview. So the first render is already right and nothing flashes.
  const scope = useEffectiveProduct(id, projectBundle);

  const nodesById = useMemo(
    () => new Map(dataNodes.map((node) => [node.id, node])),
    [dataNodes],
  );

  // Built once per snapshot — `buildProductUsageIndex` is a graph traversal and
  // must never run per node. The page renders nothing until `edgesLoading` is
  // false, so no reader ever sees the empty-edge answer; membership derived
  // from anchors and consumers would otherwise be wrong for one frame.
  const usageIndex = useMemo(() => buildProductUsageIndex(dataNodes, dataEdges), [dataNodes, dataEdges]);
  const productGraph = useMemo<ProductGraph>(
    () => ({ edges: dataEdges, nodesById, usageIndex }),
    [dataEdges, nodesById, usageIndex],
  );

  const inventory = useMemo(
    () => computeInventory(dataNodes, dataEdges, journal),
    [dataEdges, dataNodes, journal],
  );

  const rollup = useMemo(
    () => computeProductRollup(dataNodes, dataEdges, undefined, { scope, graph: productGraph }),
    [dataEdges, dataNodes, productGraph, scope],
  );
  // Already the scope's own platforms by construction — every surviving view was
  // clipped to its product's menu — so this stays "platforms with counted work",
  // which is what the gauges have always drawn.
  const gaugePlatforms = useMemo(() => getRollupPlatforms(rollup), [rollup]);

  const releases = useMemo(
    () => computeReleasePulse(journal, { nodesById }),
    [journal, nodesById],
  );

  const backlog = useMemo(
    () => computeBacklog(journal, { existingNodeIds: new Set(dataNodes.map((node) => node.id)) }),
    [dataNodes, journal],
  );

  // Species and status columns stay at their defaults (views, counted preset);
  // only the scope is new, and it is the board's own, so the snapshot and the
  // board it summarises expand the same items.
  const snapshot = useMemo(
    () => computeDeliverySnapshot(dataNodes, undefined, undefined, { scope, graph: productGraph }),
    [dataNodes, productGraph, scope],
  );

  const acceptances = useMemo(
    () => dataNodes.filter((node) => node.species === "acceptance"),
    [dataNodes],
  );
  // Parity reads the acceptances the scope contains, resolved anchors-first like
  // everywhere else (§ Decision 5) — an admin acceptance is not an end-user
  // parity gap. `ParityCard` itself decides whether parity is a question at all.
  const scopedAcceptances = useMemo(
    () => filterAcceptances(acceptances, dataEdges, nodesById, { ...EMPTY_FILTERS, product: scope.productId }),
    [acceptances, dataEdges, nodesById, scope.productId],
  );
  const parityGaps = useMemo(() => computeParityGaps(scopedAcceptances), [scopedAcceptances]);
  const pyramidTiers = useMemo(
    () => computeScopedPyramidTiers(acceptances, dataEdges, nodesById, scope),
    [acceptances, dataEdges, nodesById, scope],
  );

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
      // Counted through the same restriction the canvas draws through, so the
      // card can never advertise a node count the map does not show
      // (docs/spec/maps.md § MapDefinition).
      const subgraph = computeMapSubgraph(
        definition,
        mapScopedNodes(definition, dataNodes, scope, productGraph),
        dataEdges,
      );
      return { definition, nodeCount: subgraph.nodes.length, edgeCount: subgraph.edges.length };
    });
  }, [dataEdges, dataNodes, productGraph, projectBundle, scope]);

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
              <ParityCard gaps={parityGaps} platforms={scope.platforms} projectId={id} />
              <PyramidCard tiers={pyramidTiers} platforms={scope.platforms} projectId={id} />
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
