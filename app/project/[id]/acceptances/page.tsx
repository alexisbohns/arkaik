"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { PlusIcon } from "lucide-react";
import { deriveNodeId } from "@arkaik/schema";
import type { Node as DataNode } from "@/lib/data/types";
import { useNodes } from "@/lib/hooks/useNodes";
import { useEdges } from "@/lib/hooks/useEdges";
import { useProject } from "@/lib/hooks/useProject";
import { useJournal } from "@/lib/hooks/useJournal";
import { useAcceptanceFilters } from "@/components/acceptances/acceptance-filters";
import { filterAcceptances } from "@/lib/utils/acceptance-matrix";
import { AcceptanceFilterBar } from "@/components/acceptances/AcceptanceFilterBar";
import { AcceptanceMatrix } from "@/components/acceptances/AcceptanceMatrix";
import { NodeDetailPanel } from "@/components/panels/NodeDetailPanel";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";

export default function ProjectAcceptancesPage() {
  const params = useParams();
  const id = Array.isArray(params.id) ? params.id[0] : params.id ?? "";

  const [selectedNode, setSelectedNode] = useState<DataNode | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  const { nodes: dataNodes, loading: nodesLoading, updateNode, addNode } = useNodes(id);
  const { edges: dataEdges, loading: edgesLoading } = useEdges(id);
  const { project: projectBundle } = useProject(id);
  const { journal } = useJournal(id);
  const { filters, setFilters } = useAcceptanceFilters();

  const acceptances = useMemo(
    () => dataNodes.filter((node) => node.species === "acceptance"),
    [dataNodes],
  );
  const nodesById = useMemo(
    () => new Map(dataNodes.map((node) => [node.id, node])),
    [dataNodes],
  );
  const anchorOptions = useMemo(
    () =>
      dataNodes
        .filter((node) => node.species === "view" || node.species === "flow")
        .map((node) => ({ id: node.id, title: node.title }))
        .sort((a, b) => a.title.localeCompare(b.title)),
    [dataNodes],
  );
  const filtered = useMemo(
    () => filterAcceptances(acceptances, dataEdges, filters),
    [acceptances, dataEdges, filters],
  );

  function handleSelectNode(node: DataNode) {
    setSelectedNode(node);
    setPanelOpen(true);
  }

  async function handleNodeUpdate(nodeId: string, patch: Partial<Omit<DataNode, "id" | "project_id">>) {
    const updatedNode = await updateNode(nodeId, patch);
    setSelectedNode(updatedNode);
  }

  async function handleCreateAcceptance(title: string) {
    const created = await addNode({
      id: deriveNodeId("acceptance", title, dataNodes.map((node) => node.id)),
      project_id: id,
      species: "acceptance",
      title,
      status: "idea",
      platforms: ["web", "ios", "android"],
      metadata: {},
    });
    handleSelectNode(created);
  }

  if (nodesLoading || edgesLoading) {
    return (
      <div className="h-full w-full flex items-center justify-center">
        <span className="text-muted-foreground text-sm">Loading acceptances...</span>
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <SidebarTrigger className="-ml-1 cursor-pointer" />
        <Separator orientation="vertical" className="mx-1 h-4" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{projectBundle?.project.title ?? "Untitled project"}</p>
          <p className="truncate text-xs text-muted-foreground">
            Acceptances · {acceptances.length} total · {filtered.length} shown
          </p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <Button
            size="sm"
            className="cursor-pointer"
            onClick={() => {
              const title = window.prompt("Acceptance title (the What):");
              if (title && title.trim()) void handleCreateAcceptance(title.trim());
            }}
          >
            <PlusIcon className="size-4" />
            New acceptance
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-4 md:p-6">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4">
          <AcceptanceFilterBar filters={filters} onChange={setFilters} anchorOptions={anchorOptions} />
          <AcceptanceMatrix
            acceptances={filtered}
            edges={dataEdges}
            nodesById={nodesById}
            onSelect={handleSelectNode}
          />
        </div>
      </div>

      <NodeDetailPanel
        open={panelOpen}
        onOpenChange={setPanelOpen}
        node={selectedNode ?? undefined}
        onUpdate={handleNodeUpdate}
        allNodes={dataNodes}
        allEdges={dataEdges}
        journal={journal}
        onNavigate={setSelectedNode}
      />
    </div>
  );
}
