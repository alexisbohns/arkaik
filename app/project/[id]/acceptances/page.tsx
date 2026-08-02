"use client";

import { useMemo } from "react";
import { useParams } from "next/navigation";
import { PlusIcon } from "lucide-react";
import { toast } from "sonner";
import type { Node as DataNode } from "@/lib/data/types";
import { useNodes } from "@/lib/hooks/useNodes";
import { useEdges } from "@/lib/hooks/useEdges";
import { useProjectPanels } from "@/lib/hooks/useProjectPanels";
import { useProject } from "@/lib/hooks/useProject";
import { useJournal } from "@/lib/hooks/useJournal";
import { useEffectiveProduct } from "@/lib/hooks/useProductScope";
import { useAcceptanceFilters } from "@/components/acceptances/acceptance-filters";
import { filterAcceptances } from "@/lib/utils/acceptance-matrix";
import { AcceptanceFilterBar } from "@/components/acceptances/AcceptanceFilterBar";
import { AcceptanceMatrix } from "@/components/acceptances/AcceptanceMatrix";
import { PageShell } from "@/components/layout/PageShell";
import { generateNodeId } from "@/lib/utils/id";

export default function ProjectAcceptancesPage() {
  const params = useParams();
  const id = Array.isArray(params.id) ? params.id[0] : params.id ?? "";

  const { openNode } = useProjectPanels();

  const { nodes: dataNodes, loading: nodesLoading, updateNode, addNode, applyMutations } = useNodes(id);
  const { edges: dataEdges, loading: edgesLoading, syncEdges } = useEdges(id);
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
  // The product scope is not a filter-bar control, so it is layered on here
  // rather than read from the URL: the bar owns what the reader typed, the
  // shell owns which app they are looking at. Membership lives on nodes, so
  // this narrows correctly even before `useProject` has resolved the bundle.
  const scope = useEffectiveProduct(id, projectBundle);
  const scopedFilters = useMemo(
    () => ({ ...filters, product: scope.productId }),
    [filters, scope.productId],
  );
  const filtered = useMemo(
    () => filterAcceptances(acceptances, dataEdges, nodesById, scopedFilters),
    [acceptances, dataEdges, nodesById, scopedFilters],
  );

  function handleSelectNode(node: DataNode) {
    openNode({ nodeId: node.id });
  }

  async function handleNodeUpdate(nodeId: string, patch: Partial<Omit<DataNode, "id" | "project_id">>) {
    await updateNode(nodeId, patch);
  }

  async function handleCreateAcceptance(title: string) {
    const created = await addNode({
      id: generateNodeId("acceptance", title, nodesById.keys()),
      project_id: id,
      species: "acceptance",
      title,
      status: "idea",
      // seed all platforms so a new acceptance renders in the parity matrix immediately (library/delivery seed []).
      platforms: ["web", "ios", "android"],
      metadata: {},
    });
    handleSelectNode(created);
    return created;
  }

  /**
   * An acceptance and the `covers` edge anchoring it are one thing, so they are
   * written as one atomic batch. This previously created the node, created the
   * edge, and hand-rolled a rollback of the node when the edge failed — a
   * compensating delete that could itself fail and leave the orphan behind.
   */
  async function handleCreateAcceptanceForAnchor(anchor: DataNode, title: string): Promise<DataNode> {
    const created: DataNode = {
      id: generateNodeId("acceptance", title, nodesById.keys()),
      project_id: id,
      species: "acceptance",
      title,
      status: "idea",
      platforms: ["web", "ios", "android"],
      metadata: {},
    };

    const result = await applyMutations([
      { op: "create_node", node: created },
      {
        op: "create_edge",
        edge: {
          id: `e-${created.id}-${anchor.id}`,
          project_id: id,
          source_id: created.id,
          target_id: anchor.id,
          edge_type: "covers",
        },
      },
    ]);
    syncEdges(result.edges);

    handleSelectNode(created);
    return created;
  }

  if (nodesLoading || edgesLoading) {
    return (
      <div className="h-full w-full flex items-center justify-center">
        <span className="text-muted-foreground text-sm">Loading acceptances...</span>
      </div>
    );
  }

  return (
    <PageShell
      title="Acceptances"
      meta={`${acceptances.length} total · ${filtered.length} shown`}
      action={{
        label: "New acceptance",
        icon: PlusIcon,
        // Lightweight create affordance: acceptances are primarily created at scale by
        // the retro-population agents (via MCP), so this surface uses a simple prompt
        // rather than the richer NewNodeForm dialog the library/delivery pages use.
        onClick: async () => {
          const title = window.prompt("Acceptance title (the What):");
          if (!title || !title.trim()) return;
          try {
            await handleCreateAcceptance(title.trim());
          } catch (err) {
            toast.error("Couldn't create the acceptance.");
            console.error(err);
          }
        },
      }}
      allNodes={dataNodes}
      allEdges={dataEdges}
      scope={scope}
      journal={journal}
      onUpdate={handleNodeUpdate}
      onCreateAcceptanceForAnchor={handleCreateAcceptanceForAnchor}
    >
      <div className="h-full overflow-auto p-4 md:p-6">
        <div className="flex w-full flex-col gap-4">
          <AcceptanceFilterBar
            filters={filters}
            onChange={setFilters}
            anchorOptions={anchorOptions}
            projectId={id}
            project={projectBundle}
          />
          <AcceptanceMatrix
            acceptances={filtered}
            edges={dataEdges}
            nodesById={nodesById}
            onSelect={handleSelectNode}
            projectId={id}
            project={projectBundle}
          />
        </div>
      </div>
    </PageShell>
  );
}
