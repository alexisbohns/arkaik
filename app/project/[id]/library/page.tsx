"use client";

import { useMemo, useState } from "react";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { PlusIcon } from "lucide-react";
import { LibraryFilterBar, type LibraryDisplayMode, type LibrarySpeciesFilter } from "@/components/library/LibraryFilterBar";
import { NodeCard } from "@/components/library/NodeCard";
import type { PlaylistPreviewItem } from "@/components/library/NodeCard";
import { NodeTable, type NodeSortKey, type NodeSortState } from "@/components/library/NodeTable";
import { NewNodeForm, type NewNodeFormData } from "@/components/panels/NewNodeForm";
import { NodeDetailPanel } from "@/components/panels/NodeDetailPanel";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { SPECIES, type SpeciesId } from "@/lib/config/species";
import { STATUSES, STATUS_ORDER } from "@/lib/config/statuses";
import type { Node as DataNode } from "@/lib/data/types";
import { useEdges } from "@/lib/hooks/useEdges";
import { useNodes } from "@/lib/hooks/useNodes";
import { useProject } from "@/lib/hooks/useProject";
import { findWhereUsed } from "@/lib/utils/where-used";
import { generateNodeId } from "@/lib/utils/id";
import {
  computePlaylistRollup,
  createEmptyRollup,
  getNodePlatformStatuses,
} from "@/lib/utils/platform-status";

const SPECIES_EMPTY_LABELS: Record<LibrarySpeciesFilter, string> = {
  all: "nodes",
  view: "views",
  flow: "flows",
  "data-model": "data models",
  "api-endpoint": "API endpoints",
};

const SPECIES_LABEL_BY_ID = Object.fromEntries(
  SPECIES.map((species) => [species.id, species.label]),
) as Record<SpeciesId, string>;

const SPECIES_DESCRIPTION_BY_ID = Object.fromEntries(
  SPECIES.map((species) => [species.id, species.description]),
) as Record<SpeciesId, string>;

const STATUS_LABEL_BY_ID = Object.fromEntries(
  STATUSES.map((status) => [status.id, status.label]),
) as Record<(typeof STATUSES)[number]["id"], string>;

function parseSpeciesFilter(value: string | null): LibrarySpeciesFilter {
  if (value === "all") return "all";
  if (SPECIES.some((species) => species.id === value)) {
    return value as SpeciesId;
  }
  return "all";
}

function playlistPreviewForNode(node: DataNode, allNodesById: Map<string, DataNode>): PlaylistPreviewItem[] {
  if (node.species !== "flow") return [];

  const entries = Array.isArray(node.metadata?.playlist?.entries)
    ? node.metadata.playlist.entries
    : [];

  return entries.map((entry) => {
    if (entry.type === "view") {
      return {
        type: "view",
        label: allNodesById.get(entry.view_id)?.title ?? entry.view_id,
      };
    }

    if (entry.type === "flow") {
      return {
        type: "flow",
        label: allNodesById.get(entry.flow_id)?.title ?? entry.flow_id,
      };
    }

    return {
      type: entry.type,
      label: entry.label,
    };
  });
}

function matchesSearch(node: DataNode, searchQuery: string) {
  if (!searchQuery) return true;
  const haystack = `${node.title} ${node.description ?? ""}`.toLowerCase();
  return haystack.includes(searchQuery.toLowerCase());
}

function sortNodes(
  nodes: DataNode[],
  sort: NodeSortState,
  usedInByNodeId: Record<string, number>,
): DataNode[] {
  const direction = sort.direction === "asc" ? 1 : -1;

  return [...nodes].sort((a, b) => {
    let comparison = 0;

    if (sort.key === "id") {
      comparison = a.id.localeCompare(b.id);
    }

    if (sort.key === "title") {
      comparison = a.title.localeCompare(b.title);
    }

    if (sort.key === "species") {
      comparison = (SPECIES_LABEL_BY_ID[a.species] ?? a.species).localeCompare(SPECIES_LABEL_BY_ID[b.species] ?? b.species);
    }

    if (sort.key === "status") {
      comparison = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    }

    if (sort.key === "usedIn") {
      comparison = (usedInByNodeId[a.id] ?? 0) - (usedInByNodeId[b.id] ?? 0);
    }

    if (comparison === 0) {
      comparison = a.title.localeCompare(b.title);
    }

    if (comparison === 0) {
      comparison = a.id.localeCompare(b.id);
    }

    return comparison * direction;
  });
}

export default function ProjectLibraryPage() {
  const params = useParams();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = Array.isArray(params.id) ? params.id[0] : params.id ?? "";

  const [selectedNode, setSelectedNode] = useState<DataNode | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [newNodeOpen, setNewNodeOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [displayMode, setDisplayMode] = useState<LibraryDisplayMode>("gallery");
  const [sort, setSort] = useState<NodeSortState>({
    key: "title",
    direction: "asc",
  });

  const speciesFilter = parseSpeciesFilter(searchParams.get("species"));

  const { nodes: dataNodes, loading: nodesLoading, updateNode, addNode } = useNodes(id);
  const { edges: dataEdges, loading: edgesLoading } = useEdges(id);
  const { project: projectBundle } = useProject(id);

  const nodesById = useMemo(
    () => new Map(dataNodes.map((node) => [node.id, node])),
    [dataNodes],
  );

  const usedInByNodeId = useMemo(
    () => Object.fromEntries(dataNodes.map((node) => [node.id, findWhereUsed(node.id, dataNodes).length])) as Record<string, number>,
    [dataNodes],
  );

  const visibleNodes = useMemo(() => {
    const filtered = dataNodes.filter((node) => {
      if (speciesFilter !== "all" && node.species !== speciesFilter) return false;
      return matchesSearch(node, search);
    });

    return sortNodes(filtered, sort, usedInByNodeId);
  }, [dataNodes, search, sort, speciesFilter, usedInByNodeId]);

  const emptyLabel = SPECIES_EMPTY_LABELS[speciesFilter];

  const flowRollupByNodeId = useMemo(
    () => Object.fromEntries(
      dataNodes
        .filter((node) => node.species === "flow")
        .map((flowNode) => {
          const entries = Array.isArray(flowNode.metadata?.playlist?.entries)
            ? flowNode.metadata.playlist.entries
            : [];
          return [flowNode.id, computePlaylistRollup(entries, nodesById)];
        }),
    ) as Record<string, ReturnType<typeof createEmptyRollup>>,
    [dataNodes, nodesById],
  );

  async function handleNodeUpdate(nodeId: string, patch: Partial<Omit<DataNode, "id" | "project_id">>) {
    const updatedNode = await updateNode(nodeId, patch);
    setSelectedNode(updatedNode);
  }

  function handleSelectNode(node: DataNode) {
    setSelectedNode(node);
    setPanelOpen(true);
  }

  function handleSortChange(key: NodeSortKey) {
    setSort((previous) => {
      if (previous.key !== key) {
        return { key, direction: "asc" };
      }

      return {
        key,
        direction: previous.direction === "asc" ? "desc" : "asc",
      };
    });
  }

  function handleSpeciesChange(nextSpecies: LibrarySpeciesFilter) {
    const nextParams = new URLSearchParams(searchParams.toString());

    if (nextSpecies === "all") {
      nextParams.delete("species");
    } else {
      nextParams.set("species", nextSpecies);
    }

    const nextQuery = nextParams.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname);
  }

  async function handleCreateNodeFromPanel(species: "flow" | "view", title: string) {
    return addNode({
      id: generateNodeId(species),
      project_id: id,
      title,
      species,
      status: "idea",
      platforms: [],
    });
  }

  async function handleCreateNode(data: NewNodeFormData) {
    await addNode({
      id: generateNodeId(data.species),
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
        <span className="text-muted-foreground text-sm">Loading library...</span>
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mx-1 h-4" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {projectBundle?.project.title ?? "Untitled project"}
          </p>
          <p className="truncate text-xs text-muted-foreground">Library</p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <Button size="sm" onClick={() => setNewNodeOpen(true)}>
            <PlusIcon className="size-4" />
            New node
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-4 md:p-6">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4">
          <LibraryFilterBar
            species={speciesFilter}
            search={search}
            displayMode={displayMode}
            onSpeciesChange={handleSpeciesChange}
            onSearchChange={setSearch}
            onDisplayModeChange={setDisplayMode}
          />

          {visibleNodes.length === 0 ? (
            <div className="rounded-xl border border-dashed p-10 text-center">
              <p className="text-sm text-muted-foreground">No {emptyLabel} yet. Create one to get started.</p>
              <div className="mt-4">
                <Button size="sm" onClick={() => setNewNodeOpen(true)}>
                  <PlusIcon className="size-4" />
                  Create node
                </Button>
              </div>
            </div>
          ) : displayMode === "gallery" ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {visibleNodes.map((node) => (
                <NodeCard
                  key={node.id}
                  node={node}
                  speciesLabel={SPECIES_LABEL_BY_ID[node.species] ?? node.species}
                  speciesDescription={SPECIES_DESCRIPTION_BY_ID[node.species]}
                  viewPlatformStatuses={node.species === "view" ? getNodePlatformStatuses(node) : undefined}
                  flowRollup={node.species === "flow" ? flowRollupByNodeId[node.id] : undefined}
                  playlistPreview={playlistPreviewForNode(node, nodesById)}
                  usedInCount={usedInByNodeId[node.id] ?? 0}
                  onClick={() => handleSelectNode(node)}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-xl border bg-card p-3">
              <NodeTable
                nodes={visibleNodes}
                sort={sort}
                speciesLabelById={SPECIES_LABEL_BY_ID}
                statusLabelById={STATUS_LABEL_BY_ID}
                usedInByNodeId={usedInByNodeId}
                onSortChange={handleSortChange}
                onSelectNode={handleSelectNode}
              />
            </div>
          )}
        </div>
      </div>

      <NodeDetailPanel
        open={panelOpen}
        onOpenChange={setPanelOpen}
        node={selectedNode ?? undefined}
        onUpdate={handleNodeUpdate}
        allNodes={dataNodes}
        allEdges={dataEdges}
        onNavigate={setSelectedNode}
        onCreateNode={handleCreateNodeFromPanel}
      />

      <NewNodeForm
        open={newNodeOpen}
        onOpenChange={setNewNodeOpen}
        onSubmit={handleCreateNode}
        defaultValues={speciesFilter !== "all" ? { species: speciesFilter } : undefined}
      />
    </div>
  );
}
