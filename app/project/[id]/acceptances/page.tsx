"use client";

import { useMemo, useState } from "react";
import { PlusIcon } from "lucide-react";
import { toast } from "sonner";
import type { Node as DataNode, NodeMetadata } from "@/lib/data/types";
import { useNodes } from "@/lib/hooks/useNodes";
import { useEdges } from "@/lib/hooks/useEdges";
import { useProjectId } from "@/lib/hooks/useProjectId";
import { useProjectPanels } from "@/lib/hooks/useProjectPanels";
import { useProject } from "@/lib/hooks/useProject";
import { useJournal } from "@/lib/hooks/useJournal";
import { useAcceptanceIntake } from "@/lib/hooks/useAcceptanceIntake";
import { useEffectiveProduct, useProductList } from "@/lib/hooks/useProductScope";
import { useAcceptanceFilters } from "@/components/acceptances/acceptance-filters";
import { filterAcceptances } from "@/lib/utils/acceptance-matrix";
import { AcceptanceFilterBar } from "@/components/acceptances/AcceptanceFilterBar";
import { PageSurface } from "@/components/layout/PageSurface";
import { AcceptanceMatrix } from "@/components/acceptances/AcceptanceMatrix";
import { PageError } from "@/components/layout/PageError";
import { PageLoading } from "@/components/layout/PageLoading";
import { PageShell } from "@/components/layout/PageShell";
import { NewAcceptanceForm, type NewAcceptanceFormData } from "@/components/panels/NewAcceptanceForm";
import { generateNodeId } from "@/lib/utils/id";

export default function ProjectAcceptancesPage() {
  const id = useProjectId();

  const { openNode } = useProjectPanels();

  const { nodes: dataNodes, loading: nodesLoading, error: nodesError, reload: reloadNodes, updateNode, addNode, applyMutations } = useNodes(id);
  const { edges: dataEdges, loading: edgesLoading, error: edgesError, reload: reloadEdges, syncEdges } = useEdges(id);
  const { project: projectBundle, error: projectError, reload: reloadProject } = useProject(id);
  const { journal, error: journalError, reload: reloadJournal } = useJournal(id);
  const intake = useAcceptanceIntake({
    projectId: id,
    nodes: dataNodes,
    edges: dataEdges,
    applyMutations,
    syncEdges,
  });
  const { filters, setFilters } = useAcceptanceFilters();
  const [newAcceptanceOpen, setNewAcceptanceOpen] = useState(false);

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
  // The product scope *is* read from the URL now (#315), but not by the filter
  // bar's own hook: `useEffectiveProduct` owns `?product=` and
  // `useAcceptanceFilters` deliberately does not list it in `KEYS`, so Clear
  // cannot widen the surface back out. The bar owns what the reader typed; the
  // scope owns which app they are looking at. Membership lives on nodes, so this
  // narrows correctly even before `useProject` has resolved the bundle.
  const scope = useEffectiveProduct(id, projectBundle);
  const productList = useProductList(scope);
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

  /**
   * `metadata` carries the product the create dialog collected, and is the only
   * thing this path gained: everything else about a new acceptance — idea
   * status, every platform — is still decided here rather than asked for. It is
   * threaded through rather than written as a second create path so the anchored
   * variant below stays the *only* other way an acceptance is born.
   */
  async function handleCreateAcceptance(title: string, metadata: NodeMetadata = {}) {
    const created = await addNode({
      id: generateNodeId("acceptance", title, nodesById.keys()),
      project_id: id,
      species: "acceptance",
      title,
      status: "idea",
      // seed all platforms so a new acceptance renders in the parity matrix immediately (library/delivery seed []).
      platforms: ["web", "ios", "android"],
      metadata,
    });
    handleSelectNode(created);
    return created;
  }

  async function handleNewAcceptance({ title, metadata }: NewAcceptanceFormData) {
    setNewAcceptanceOpen(false);
    try {
      await handleCreateAcceptance(title, metadata ?? {});
    } catch (err) {
      toast.error("Couldn't create the acceptance.");
      console.error(err);
    }
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
    return <PageLoading label="acceptances" />;
  }

  // Before the matrix, never after (#362): with no nodes the header reads
  // "0 total · 0 shown" and the matrix draws its own empty body — a project
  // whose entire acceptance coverage looks deleted rather than unread.
  const loadError = nodesError ?? edgesError ?? projectError ?? journalError;
  if (loadError) {
    return (
      <PageError
        label="acceptances"
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
        title="Acceptances"
        meta={`${acceptances.length} total · ${filtered.length} shown`}
        action={{
          label: "New acceptance",
          icon: PlusIcon,
          // A dialog rather than the `window.prompt` this used to be: a prompt
          // returns a string and nothing else, so an acceptance created under a
          // named scope carried no product and vanished from the scope it was
          // created in. `NewAcceptanceForm` is the smallest surface that can ask.
          onClick: () => setNewAcceptanceOpen(true),
        }}
        allNodes={dataNodes}
        allEdges={dataEdges}
        scope={scope}
        journal={journal}
        onUpdate={handleNodeUpdate}
        onCreateAcceptanceForAnchor={handleCreateAcceptanceForAnchor}
        intake={intake}
      >
        <PageSurface
          /* The matrix is the surface: flush anchor groups running to the
             panel's edges, each heading pinning as you scroll past it. It needs
             the scrollport to be the pane rather than a padded column, or the
             headings would pin against a padding edge instead of the toolbar's
             hairline. */
          fill
          contentClassName="overflow-y-auto"
          toolbar={
            <AcceptanceFilterBar
              filters={filters}
              onChange={setFilters}
              anchorOptions={anchorOptions}
              projectId={id}
              project={projectBundle}
            />
          }
        >
          <AcceptanceMatrix
            acceptances={filtered}
            edges={dataEdges}
            nodesById={nodesById}
            onSelect={handleSelectNode}
            projectId={id}
            project={projectBundle}
          />
        </PageSurface>
      </PageShell>
      <NewAcceptanceForm
        open={newAcceptanceOpen}
        onOpenChange={setNewAcceptanceOpen}
        onSubmit={handleNewAcceptance}
        products={productList}
        defaultProductId={scope.productId}
      />
    </>
  );
}
