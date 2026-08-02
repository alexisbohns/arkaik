"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { PlusIcon } from "lucide-react";
import { DeliveryBoard } from "@/components/delivery/DeliveryBoard";
import { DeliveryFilterBar, type DeliveryPlatformFilter } from "@/components/delivery/DeliveryFilterBar";
import { NewNodeForm, type NewNodeFormData } from "@/components/panels/NewNodeForm";
import { PageShell } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/button";
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
import { useProjectPanels } from "@/lib/hooks/useProjectPanels";
import { useNodes } from "@/lib/hooks/useNodes";
import { computeDeliveryItems, groupItemsByStatus, type DeliveryItem } from "@/lib/utils/delivery";
import { generateNodeId } from "@/lib/utils/id";
import { matchesSearch } from "@/lib/utils/search";

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
  const params = useParams();
  const id = Array.isArray(params.id) ? params.id[0] : params.id ?? "";

  const [platformFilter, setPlatformFilter] = useState<DeliveryPlatformFilter>("all");
  const [speciesFilter, setSpeciesFilter] = useState<SpeciesId[]>(["view"]);
  const [showAllStatuses, setShowAllStatuses] = useState(false);
  const [search, setSearch] = useState("");
  const [newNodeOpen, setNewNodeOpen] = useState(false);

  const { openNode } = useProjectPanels();

  const { nodes: dataNodes, loading: nodesLoading, updateNode, addNode } = useNodes(id);
  const { edges: dataEdges, loading: edgesLoading } = useEdges(id);
  const { journal } = useJournal(id);

  const nodesById = useMemo(() => new Map(dataNodes.map((node) => [node.id, node])), [dataNodes]);

  const statusColumns = useMemo<readonly StatusId[]>(
    () => (showAllStatuses ? ALL_STATUS_COLUMNS : getCountedStatuses(DEFAULT_COUNTED_STATUS_PRESET_ID)),
    [showAllStatuses],
  );

  const columns = useMemo(() => {
    const searched = dataNodes.filter((node) => matchesSearch(node, search));
    const items = computeDeliveryItems(searched, speciesFilter);
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
  }, [dataNodes, platformFilter, search, speciesFilter, statusColumns]);

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
    return (
      <div className="h-full w-full flex items-center justify-center">
        <span className="text-muted-foreground text-sm">Loading delivery board...</span>
      </div>
    );
  }

  return (
    <>
      <PageShell
        title="Delivery"
        action={{
          label: "New node",
          icon: PlusIcon,
          onClick: () => setNewNodeOpen(true),
        }}
        allNodes={dataNodes}
        allEdges={dataEdges}
        journal={journal}
        onUpdate={handleNodeUpdate}
        onCreateNode={handleCreateNodeFromPanel}
      >
        <div className="flex h-full flex-col gap-4 overflow-auto p-4 md:p-6">
          <DeliveryFilterBar
            platform={platformFilter}
            species={speciesFilter}
            showAllStatuses={showAllStatuses}
            search={search}
            onPlatformChange={setPlatformFilter}
            onToggleSpecies={handleToggleSpecies}
            onShowAllStatusesChange={setShowAllStatuses}
            onSearchChange={setSearch}
          />

          {totalItems === 0 ? (
            <div className="rounded-xl border border-dashed p-10 text-center">
              <p className="text-sm text-muted-foreground">
                No delivery items match. Pick a species, widen the platform filter, or create a node.
              </p>
              <div className="mt-4">
                <Button size="sm" className="cursor-pointer" onClick={() => setNewNodeOpen(true)}>
                  <PlusIcon className="size-4" />
                  Create node
                </Button>
              </div>
            </div>
          ) : (
            <DeliveryBoard
              columns={columns}
              speciesLabelById={SPECIES_LABEL_BY_ID}
              speciesDescriptionById={SPECIES_DESCRIPTION_BY_ID}
              onSelectItem={handleSelectItem}
            />
          )}
        </div>
      </PageShell>

      <NewNodeForm open={newNodeOpen} onOpenChange={setNewNodeOpen} onSubmit={handleCreateNode} />
    </>
  );
}
