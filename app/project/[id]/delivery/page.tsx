"use client";

import { useMemo, useState } from "react";
import { PlusIcon } from "lucide-react";
import { DeliveryBoard } from "@/components/delivery/DeliveryBoard";
import { DeliveryFilterBar, type DeliveryPlatformFilter } from "@/components/delivery/DeliveryFilterBar";
import { PageSurface } from "@/components/layout/PageSurface";
import { NewNodeForm, type NewNodeFormData } from "@/components/panels/NewNodeForm";
import { PageError } from "@/components/layout/PageError";
import { PageLoading } from "@/components/layout/PageLoading";
import { PageShell } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SPECIES, type SpeciesId } from "@/lib/config/species";
import {
  DEFAULT_COUNTED_STATUS_PRESET_ID,
  getCountedStatuses,
  STATUSES,
  type StatusId,
} from "@/lib/config/statuses";
import type { Node as DataNode } from "@/lib/data/types";
import { useEdges } from "@/lib/hooks/useEdges";
import { useJournal } from "@/lib/hooks/useJournal";
import { useAcceptanceIntake } from "@/lib/hooks/useAcceptanceIntake";
import { useProjectId } from "@/lib/hooks/useProjectId";
import { useProjectPanels } from "@/lib/hooks/useProjectPanels";
import { useNodes } from "@/lib/hooks/useNodes";
import { useEffectiveProduct, useProductList } from "@/lib/hooks/useProductScope";
import { useProject } from "@/lib/hooks/useProject";
import { computeDeliveryItems, groupItemsByStatus, type DeliveryItem } from "@/lib/utils/delivery";
import { generateNodeId } from "@/lib/utils/id";
import { productScopeMetaLabel, type ProductGraph } from "@/lib/utils/product-scope";
import { matchesSearch } from "@/lib/utils/search";
import { buildProductUsageIndex } from "@arkaik/schema";

const SPECIES_LABEL_BY_ID = Object.fromEntries(
  SPECIES.map((species) => [species.id, species.label]),
) as Record<SpeciesId, string>;

const SPECIES_DESCRIPTION_BY_ID = Object.fromEntries(
  SPECIES.map((species) => [species.id, species.description]),
) as Record<SpeciesId, string>;

const STATUS_LABEL_BY_ID = Object.fromEntries(
  STATUSES.map((status) => [status.id, status.label]),
) as Record<StatusId, string>;

/** All eight statuses in lifecycle order — the "All statuses" column set. */
const ALL_STATUS_COLUMNS: StatusId[] = [...STATUSES]
  .sort((a, b) => a.order - b.order)
  .map((status) => status.id);

export default function ProjectDeliveryPage() {
  const id = useProjectId();

  const [platformFilter, setPlatformFilter] = useState<DeliveryPlatformFilter>("all");
  const [speciesFilter, setSpeciesFilter] = useState<SpeciesId[]>(["view"]);
  const [showAllStatuses, setShowAllStatuses] = useState(false);
  const [search, setSearch] = useState("");
  const [newNodeOpen, setNewNodeOpen] = useState(false);

  const { openNode } = useProjectPanels();

  const { nodes: dataNodes, loading: nodesLoading, error: nodesError, reload: reloadNodes, updateNode, addNode, applyMutations } = useNodes(id);
  const { edges: dataEdges, loading: edgesLoading, error: edgesError, reload: reloadEdges, syncEdges } = useEdges(id);
  const intake = useAcceptanceIntake({
    projectId: id,
    nodes: dataNodes,
    edges: dataEdges,
    applyMutations,
    syncEdges,
  });
  const { project: projectBundle, error: projectError, reload: reloadProject } = useProject(id);
  const { journal, error: journalError, reload: reloadJournal } = useJournal(id);
  // The shell's scope, narrowed by this surface's own `?product=` when it has
  // one (#315). `projectBundle` is `undefined` until `useProject`'s effect
  // lands, and a scope resolved from nothing declares no products — which
  // resolves to every platform and every node, i.e. today's board. So the first
  // render is already correct and nothing flashes when the bundle arrives, and
  // an override cannot apply before the bundle can validate it.
  const scope = useEffectiveProduct(id, projectBundle);
  const productList = useProductList(scope);

  const nodesById = useMemo(() => new Map(dataNodes.map((node) => [node.id, node])), [dataNodes]);

  // Built once per snapshot — `buildProductUsageIndex` is a graph traversal and
  // must never run per node. The board renders nothing until `edgesLoading` is
  // false, so no reader ever sees the empty-edge answer.
  const usageIndex = useMemo(() => buildProductUsageIndex(dataNodes, dataEdges), [dataNodes, dataEdges]);
  const productGraph = useMemo<ProductGraph>(
    () => ({ edges: dataEdges, nodesById, usageIndex }),
    [dataEdges, nodesById, usageIndex],
  );

  const statusColumns = useMemo<readonly StatusId[]>(
    () => (showAllStatuses ? ALL_STATUS_COLUMNS : getCountedStatuses(DEFAULT_COUNTED_STATUS_PRESET_ID)),
    [showAllStatuses],
  );

  const columns = useMemo(() => {
    const searched = dataNodes.filter((node) => matchesSearch(node, search));
    const items = computeDeliveryItems(searched, speciesFilter, { scope, graph: productGraph });
    const grouped = groupItemsByStatus(
      items,
      statusColumns,
      platformFilter === "all" ? undefined : platformFilter,
    );

    return statusColumns.map((status) => ({
      status,
      label: STATUS_LABEL_BY_ID[status] ?? status,
      items: grouped.get(status) ?? [],
    }));
  }, [dataNodes, platformFilter, productGraph, scope, search, speciesFilter, statusColumns]);

  const totalItems = useMemo(() => columns.reduce((sum, column) => sum + column.items.length, 0), [columns]);

  function handleToggleSpecies(species: SpeciesId) {
    setSpeciesFilter((previous) =>
      previous.includes(species) ? previous.filter((entry) => entry !== species) : [...previous, species],
    );
  }

  function handleSelectItem(item: DeliveryItem) {
    openNode({ nodeId: item.node.id, initialPlatform: item.platform });
  }

  async function handleNodeUpdate(nodeId: string, patch: Partial<Omit<DataNode, "id" | "project_id">>) {
    await updateNode(nodeId, patch);
  }

  async function handleCreateNodeFromPanel(species: "flow" | "view", title: string) {
    return addNode({
      id: generateNodeId(species, title, nodesById.keys()),
      project_id: id,
      title,
      species,
      status: "idea",
      platforms: [],
    });
  }

  async function handleCreateNode(data: NewNodeFormData) {
    await addNode({
      id: generateNodeId(data.species, data.title, nodesById.keys()),
      project_id: id,
      title: data.title,
      species: data.species,
      status: data.status,
      platforms: data.platforms,
      metadata: data.metadata,
    });

    setNewNodeOpen(false);
  }

  if (nodesLoading || edgesLoading) {
    return <PageLoading label="delivery board" />;
  }

  // Before the empty state, never after (#362): a failed read leaves the board
  // with zero items, and "No delivery items match. Pick a species, widen the
  // platform filter, or create a node." then sends the reader to fiddle with
  // filters that were never the problem.
  const loadError = nodesError ?? edgesError ?? projectError ?? journalError;
  if (loadError) {
    return (
      <PageError
        label="delivery board"
        message={loadError}
        onRetry={() => {
          void reloadNodes();
          void reloadEdges();
          void reloadProject();
          void reloadJournal();
        }}
      />
    );
  }

  return (
    <>
      <PageShell
        title="Delivery"
        meta={productScopeMetaLabel(scope)}
        action={{
          label: "New node",
          icon: PlusIcon,
          onClick: () => setNewNodeOpen(true),
        }}
        allNodes={dataNodes}
        allEdges={dataEdges}
        scope={scope}
        journal={journal}
        onUpdate={handleNodeUpdate}
        onCreateNode={handleCreateNodeFromPanel}
        intake={intake}
      >
        <PageSurface
          // The board is the same filling-pane case as the Library's table, and
          // was broken the same way: it asks for `min-h-0 flex-1`, so inside a
          // scrolling column — whose height is whatever its content needs — it
          // was handed no height to fit into. Its columns therefore never
          // overflowed, never scrolled, and the horizontal scrollport it *does*
          // own swallowed the vertical wheel under `overscroll-behavior:
          // contain`. Given a bounded pane it fits, and each column scrolls.
          fill={totalItems > 0}
          contentClassName={totalItems > 0 ? "flex p-4 md:p-6" : "flex flex-col gap-4"}
          toolbar={
            <DeliveryFilterBar
              platform={platformFilter}
              species={speciesFilter}
              showAllStatuses={showAllStatuses}
              search={search}
              onPlatformChange={setPlatformFilter}
              onToggleSpecies={handleToggleSpecies}
              onShowAllStatusesChange={setShowAllStatuses}
              onSearchChange={setSearch}
              projectId={id}
              project={projectBundle}
            />
          }
        >
          {totalItems === 0 ? (
            /* Advice the reader can act on: under a scoped product the platform
               filter is hidden (arity ≤ 1), so pointing at it is a dead end —
               the thing actually narrowing the board is the product. */
            <EmptyState
              message={
                scope.productId === null
                  ? "No delivery items match. Pick a species, widen the platform filter, or create a node."
                  : "No delivery items match. Pick a species, try another product, or create a node."
              }
              action={
                <Button size="sm" className="cursor-pointer" onClick={() => setNewNodeOpen(true)}>
                  <PlusIcon className="size-4" />
                  Create node
                </Button>
              }
            />
          ) : (
            <DeliveryBoard
              columns={columns}
              speciesLabelById={SPECIES_LABEL_BY_ID}
              speciesDescriptionById={SPECIES_DESCRIPTION_BY_ID}
              onSelectItem={handleSelectItem}
            />
          )}
        </PageSurface>
      </PageShell>

      <NewNodeForm
        open={newNodeOpen}
        onOpenChange={setNewNodeOpen}
        onSubmit={handleCreateNode}
        products={productList}
        defaultProductId={scope.productId}
      />
    </>
  );
}
