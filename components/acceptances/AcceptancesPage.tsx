"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PlusIcon } from "lucide-react";
import { toast } from "sonner";
import type { Node as DataNode, NodeMetadata } from "@/lib/data/types";
import { useNodes } from "@/lib/hooks/useNodes";
import { useEdges } from "@/lib/hooks/useEdges";
import { useProjectId } from "@/lib/hooks/useProjectId";
import { useProjectPanels } from "@/lib/hooks/useProjectPanels";
import { useProject } from "@/lib/hooks/useProject";
import { useAcceptanceIntake } from "@/lib/hooks/useAcceptanceIntake";
import { useNodeRelations } from "@/lib/hooks/useNodeRelations";
import { useQueryWriter } from "@/lib/hooks/useQueryWriter";
import { useEffectiveProduct, useProductList } from "@/lib/hooks/useProductScope";
import { useAcceptanceFilters } from "@/components/acceptances/acceptance-filters";
import { filterAcceptances } from "@/lib/utils/acceptance-matrix";
import { AcceptanceFilterBar } from "@/components/acceptances/AcceptanceFilterBar";
import { PageSurface } from "@/components/layout/PageSurface";
import { AcceptancesDirectory } from "@/components/acceptances/AcceptancesDirectory";
import { DEFAULT_VIEW, DIRECTORY_VIEWS, viewFromParam, type DirectoryViewId } from "@/components/acceptances/directory-views";
import { ViewSwitch } from "@/components/acceptances/ViewSwitch";
import { ParityMonitor, ParityQuickChips } from "@/components/acceptances/ParityMonitor";
import { ValueLens } from "@/components/acceptances/ValueView";
import { buildAcceptancesModel } from "@/lib/utils/acceptances-model";
import { PageError } from "@/components/layout/PageError";
import { PageLoading } from "@/components/layout/PageLoading";
import { PageShell } from "@/components/layout/PageShell";
import { NewAcceptanceForm, type NewAcceptanceFormData } from "@/components/panels/NewAcceptanceForm";
import { generateNodeId } from "@/lib/utils/id";

/**
 * One page body, two homes. The Library's Acceptances is the directory; Parity is
 * a delivery MONITOR with its own page under Project. Both read the same model
 * (lib/utils/acceptances-model.ts), so a promise reads the same in each.
 */
export function AcceptancesPage({ mode }: { mode: "directory" | "monitor" }) {
  const id = useProjectId();

  const { openNode } = useProjectPanels();

  const { nodes: dataNodes, loading: nodesLoading, error: nodesError, reload: reloadNodes, updateNode, addNode, applyMutations } = useNodes(id);

  const { edges: dataEdges, loading: edgesLoading, error: edgesError, reload: reloadEdges, syncEdges } = useEdges(id);
  const { project: projectBundle, error: projectError, reload: reloadProject } = useProject(id);
  const intake = useAcceptanceIntake({
    projectId: id,
    nodes: dataNodes,
    edges: dataEdges,
    applyMutations,
    syncEdges,
  });
  const relations = useNodeRelations({
    projectId: id,
    nodes: dataNodes,
    edges: dataEdges,
    applyMutations,
    syncEdges,
  });
  const { filters, setFilters } = useAcceptanceFilters();
  const [newAcceptanceOpen, setNewAcceptanceOpen] = useState(false);
  // The directory's view is page state, read off the URL (`?view=`; Contents is its absence).
  const searchParams = useSearchParams();
  const writeQuery = useQueryWriter();
  const view = viewFromParam(searchParams.get("view"));
  const setView = (next: DirectoryViewId) =>
    writeQuery((params) => {
      if (next === DEFAULT_VIEW) params.delete("view");
      else params.set("view", next);
      // `mj` is the journey Contents opened in Mapping: it must not outlive that jump.
      params.delete("mj");
    });
  // Expansion, for the views whose parts fold: a view lands the way it says
  // (Mapping opens every journey, as its rail is the index), and the toolbar's
  // expand-all overrides that either way.
  const folds = DIRECTORY_VIEWS.find((v) => v.id === view)?.folds;
  const [expandOverride, setExpandOverride] = useState<boolean | null>(null);
  const allExpanded = expandOverride ?? folds?.openByDefault ?? false;

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
    syncEdges(result.edges, result.version);

    handleSelectNode(created);
    return created;
  }

  if (nodesLoading || edgesLoading) {
    return <PageLoading label={mode === "monitor" ? "parity" : "acceptances"} />;
  }

  // Before the directory, never after (#362): with no nodes the header reads
  // "0 total · 0 shown" and the directory draws its own empty body — a project
  // whose entire acceptance coverage looks deleted rather than unread.
  const loadError = nodesError ?? edgesError ?? projectError;
  if (loadError) {
    return (
      <PageError
        label="acceptances"
        message={loadError}
        onRetry={() => {
          void reloadNodes();
          void reloadEdges();
          void reloadProject();
        }}
      />
    );
  }

  // Every rule as data, once per render (a plain call: no memo over an imported call).
  const model = buildAcceptancesModel({
    nodes: dataNodes,
    edges: dataEdges,
    nodesById,
    filtered,
    scope,
    weighingSection: projectBundle?.weighing,
  });

  return (
    <>
      <PageShell
        title={mode === "monitor" ? "Parity" : "Acceptances"}
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
        history
        onUpdate={handleNodeUpdate}
        onScreenshot={async (op) => {
          await applyMutations([op]);
        }}
        onCreateAcceptanceForAnchor={handleCreateAcceptanceForAnchor}
        intake={intake}
        relations={relations}
      >
        <PageSurface
          /* The directory is the surface: its views run to the panel's edges and
             their headings pin as you scroll past them. It needs the scrollport
             to be the pane rather than a padded column, or they would pin against
             a padding edge instead of the toolbar's hairline. */
          fill
          contentClassName="overflow-y-auto"
          toolbar={
            <>
              {mode === "directory" && <ViewSwitch views={DIRECTORY_VIEWS} view={view} onViewChange={setView} model={model} />}
              {mode === "monitor" && <ParityQuickChips parity={model.parity} filters={filters} onFiltersChange={setFilters} />}
              <AcceptanceFilterBar
                filters={filters}
                onChange={setFilters}
                anchorOptions={anchorOptions}
                projectId={id}
                project={projectBundle}
                {...(mode === "directory" && folds ? { allExpanded, onToggleExpandAll: () => setExpandOverride(!allExpanded) } : {})}
              />
              {mode === "directory" && view === "value" && <ValueLens value={model.value} filters={filters} onFiltersChange={setFilters} />}
            </>
          }
        >
          {mode === "monitor" ? (
            <div data-acceptances-page data-acceptances-view="parity" className="flex min-h-full flex-col">
              <ParityMonitor parity={model.parity} onSelect={handleSelectNode} />
            </div>
          ) : (
            <AcceptancesDirectory model={model} view={view} allExpanded={allExpanded} onSelect={handleSelectNode} />
          )}
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
