"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { LibraryFilterBar, type LibraryDisplayMode, type LibrarySpeciesFilter } from "@/components/library/LibraryFilterBar";
import { NodeCard } from "@/components/library/NodeCard";
import type { PlaylistPreviewItem } from "@/components/library/NodeCard";
import { LibrarySelectionBar } from "@/components/library/LibrarySelectionBar";
import { NodeTable, type NodeSortKey, type NodeSortState } from "@/components/library/NodeTable";
import { NewNodeForm, type NewNodeFormData } from "@/components/panels/NewNodeForm";
import { PageShell } from "@/components/layout/PageShell";
import { StickyToolbar } from "@/components/layout/StickyToolbar";
import { Button } from "@/components/ui/button";
import { SPECIES, type SpeciesId } from "@/lib/config/species";
import { STATUSES, STATUS_ORDER } from "@/lib/config/statuses";
import type { Node as DataNode } from "@/lib/data/types";
import { useEdges } from "@/lib/hooks/useEdges";
import { useProjectPanels } from "@/lib/hooks/useProjectPanels";
import { useNodes } from "@/lib/hooks/useNodes";
import { useEffectiveProduct, useProductList } from "@/lib/hooks/useProductScope";
import { useProject } from "@/lib/hooks/useProject";
import { useJournal } from "@/lib/hooks/useJournal";
import { useAcceptanceIntake } from "@/lib/hooks/useAcceptanceIntake";
import { findWhereUsed } from "@/lib/utils/where-used";
import { generateNodeId } from "@/lib/utils/id";
import {
  nodeInScope,
  productDisplayTitle,
  productLabelsOfNode,
  type ProductGraph,
} from "@/lib/utils/product-scope";
import { matchesSearch } from "@/lib/utils/search";
import { isBlocked } from "@/lib/utils/blocked";
import { applyProductPlan } from "@/lib/utils/apply-product-plan";
import { planProductMove } from "@/lib/utils/product-editing";
import {
  computeFlowPlatformRollup,
  createEmptyRollup,
  getEffectivePlatformStatuses,
} from "@/lib/utils/platform-status";
import { buildProductUsageIndex } from "@arkaik/schema";

const SPECIES_EMPTY_LABELS: Record<LibrarySpeciesFilter, string> = {
  all: "nodes",
  view: "views",
  flow: "flows",
  "data-model": "data models",
  "api-endpoint": "API endpoints",
  acceptance: "acceptances",
};

// The sidebar owns species selection; the header's second line mirrors it so
// the active filter stays visible on the page itself.
const SPECIES_META_LABELS: Record<SpeciesId, string> = {
  view: "Views",
  flow: "Flows",
  "data-model": "Data Models",
  "api-endpoint": "API Endpoints",
  acceptance: "Acceptances",
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
  const searchParams = useSearchParams();
  const id = Array.isArray(params.id) ? params.id[0] : params.id ?? "";

  const { openNode } = useProjectPanels();
  const [newNodeOpen, setNewNodeOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [blockedOnly, setBlockedOnly] = useState(false);
  const [displayMode, setDisplayMode] = useState<LibraryDisplayMode>("directory");
  const [sort, setSort] = useState<NodeSortState>({
    key: "title",
    direction: "asc",
  });

  const speciesFilter = parseSpeciesFilter(searchParams.get("species"));

  const { nodes: dataNodes, loading: nodesLoading, updateNode, addNode, applyMutations } = useNodes(id);
  const { edges: dataEdges, loading: edgesLoading, syncEdges } = useEdges(id);
  const intake = useAcceptanceIntake({
    projectId: id,
    nodes: dataNodes,
    edges: dataEdges,
    applyMutations,
    syncEdges,
  });
  const { project: projectBundle, updateProject } = useProject(id);
  const { journal } = useJournal(id);
  // The shell's scope, narrowed by this surface's own `?product=` when it has
  // one (#315). With no products declared it resolves to every platform and
  // every node, so a project that has never heard of products gets exactly
  // today's library.
  const scope = useEffectiveProduct(id, projectBundle);
  const productList = useProductList(scope);

  const nodesById = useMemo(
    () => new Map(dataNodes.map((node) => [node.id, node])),
    [dataNodes],
  );

  // Built once per snapshot — `buildProductUsageIndex` is a graph traversal and
  // must never run per card. The page renders nothing until `edgesLoading` is
  // false, so no reader ever sees the empty-edge answer (which would call every
  // data model an orphan).
  const usageIndex = useMemo(() => buildProductUsageIndex(dataNodes, dataEdges), [dataNodes, dataEdges]);
  const productGraph = useMemo<ProductGraph>(
    () => ({ edges: dataEdges, nodesById, usageIndex }),
    [dataEdges, nodesById, usageIndex],
  );

  const usedInByNodeId = useMemo(
    () => Object.fromEntries(dataNodes.map((node) => [node.id, findWhereUsed(node.id, dataNodes).length])) as Record<string, number>,
    [dataNodes],
  );

  const visibleNodes = useMemo(() => {
    const filtered = dataNodes.filter((node) => {
      if (speciesFilter !== "all" && node.species !== speciesFilter) return false;
      // One membership rule for every species, shared with Acceptances and
      // Delivery: flows and views by stored membership, acceptances by their
      // anchors, the system layer by reachability — and an unreached data model
      // stays visible in every scope rather than being buried (§ Decision 8).
      if (!nodeInScope(node, scope, productGraph)) return false;
      if (blockedOnly && !isBlocked(node)) return false;
      return matchesSearch(node, search);
    });

    return sortNodes(filtered, sort, usedInByNodeId);
  }, [blockedOnly, dataNodes, productGraph, scope, search, sort, speciesFilter, usedInByNodeId]);

  // `undefined` when the project declares no products, which is what makes the
  // badge and the table column disappear entirely rather than render blank.
  const productLabelsByNodeId = useMemo<Record<string, string[]> | undefined>(() => {
    if (scope.productsById.size === 0) return undefined;
    return Object.fromEntries(
      visibleNodes.map((node) => [node.id, productLabelsOfNode(node, scope, productGraph)]),
    );
  }, [productGraph, scope, visibleNodes]);

  /**
   * SELECTION ONLY EXISTS WHERE IT HAS SOMETHING TO DO (§ D6, degenerate case).
   *
   * Moving nodes between products is the only bulk action there is, so a project
   * declaring no products gets no checkboxes and no bar — a column of boxes
   * whose sole outcome is a bar reading "3 selected / Clear" is a control that
   * exists to be dismissed, and the guarantee that a product-less project looks
   * exactly as it did before products existed outranks a selection mechanism
   * with nothing to offer. When the second action arrives (bulk status, bulk
   * delete), this gate is the one line that changes, and the components below
   * already treat selection as general: they know nothing about products.
   */
  const selectionEnabled = productList.length > 0;

  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [moving, setMoving] = useState(false);

  function toggleSelected(nodeId: string) {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }

  /**
   * Select-all is a UNION, and un-select-all a SUBTRACTION — never a
   * replacement.
   *
   * The requirement is that ticking "all" while a species filter or a search is
   * active must not quietly select the nodes the filter is *hiding*; a bulk move
   * is exactly where an invisible selection does damage. Adding only the visible
   * ids satisfies that outright.
   *
   * *Rejected:* replacing the set with the visible ids, which satisfies the same
   * requirement and then silently destroys an off-screen selection — tick a
   * node, search for something else, tick "all", and the first node is gone with
   * no feedback but a changed count. Selection deliberately survives a filter
   * change (that is what makes the bar's count equal what the move will touch),
   * so a control labelled "all visible nodes" must not be the one thing that
   * reaches outside the visible list to delete.
   */
  function toggleAllVisible() {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      const allVisibleSelected =
        visibleNodes.length > 0 && visibleNodes.every((node) => previous.has(node.id));
      for (const node of visibleNodes) {
        if (allVisibleSelected) next.delete(node.id);
        else next.add(node.id);
      }
      return next;
    });
  }

  // Ids survive a filter change (an id hidden by a search is still selected),
  // so the bar resolves them against the full node list rather than the visible
  // one — it counts species, and a count of what is merely on screen would be a
  // different number from what the move will touch.
  const selectedNodes = useMemo(
    () => dataNodes.filter((node) => selectedIds.has(node.id)),
    [dataNodes, selectedIds],
  );

  // What the bar has to explain: "7 selected" over three ticked rows is an
  // unexplained number, and the only way out of it would be all-or-nothing
  // Clear. Counted here because the page is what owns the notion of "visible".
  const hiddenSelectedCount = useMemo(() => {
    const visibleIds = new Set(visibleNodes.map((node) => node.id));
    return selectedNodes.filter((node) => !visibleIds.has(node.id)).length;
  }, [selectedNodes, visibleNodes]);

  /**
   * A scope change is a change of subject, and the selection does not survive
   * it.
   *
   * Under All products a user can tick an Admin flow and an end-user view; on
   * switching to End-user app the Admin flow is neither shown nor mentioned by
   * any filter the user set, yet it would still be in the set and still be moved.
   * Worse, switching to a project state with no products at all flips
   * `selectionEnabled` false, which removes every checkbox and the bar — leaving
   * held ids with no surface able to show or clear them. Both cases are the same
   * bug, so both are cleared by the same subject key.
   *
   * Adjusted **during render** rather than in an effect, which is what React
   * documents for "reset state when a prop changes" and what
   * `react-hooks/set-state-in-effect` exists to push callers towards: an effect
   * would let one commit paint with the old selection still live under the new
   * scope, and would cost a second render every time. Setting state while
   * rendering *this* component restarts the render before anything is shown.
   */
  const [selectionSubject, setSelectionSubject] = useState(
    () => `${scope.productId ?? ""}:${selectionEnabled}`,
  );
  const currentSubject = `${scope.productId ?? ""}:${selectionEnabled}`;
  if (selectionSubject !== currentSubject) {
    setSelectionSubject(currentSubject);
    if (selectedIds.size > 0) setSelectedIds(new Set());
  }

  /**
   * ONE write, never a loop of single updates: `planProductMove` decides which
   * of the selected nodes can actually hold a membership, and `applyProductPlan`
   * commits every patch as a single atomic mutation. A per-node loop would leave
   * a half-moved shelf behind on the first failure.
   *
   * An empty plan is reported, not written — everything selected is already in
   * the target (or derives its product), and a silent no-op reads as a bug.
   */
  async function handleMoveToProduct(productId: string | null) {
    if (moving) return;
    setMoving(true);
    const plan = planProductMove(dataNodes, [...selectedIds], productId);
    try {
      if (plan.reassignments.length === 0) {
        toast.info("Those nodes are already there.");
      } else {
        await applyProductPlan(plan, {
          nodesById,
          projectMetadata: projectBundle?.project.metadata,
          updateProject,
          applyMutations,
        });
        const moved = plan.reassignments.length;
        toast.success(
          productId === null
            ? `${moved} node${moved === 1 ? "" : "s"} unassigned.`
            : `${moved} node${moved === 1 ? "" : "s"} moved.`,
        );
      }
      setSelectedIds(new Set());
    } catch (err) {
      console.error("[LibraryPage] Failed to move nodes:", err);
      toast.error(err instanceof Error ? err.message : "Could not move those nodes.");
    } finally {
      setMoving(false);
    }
  }

  const emptyLabel = SPECIES_EMPTY_LABELS[speciesFilter];
  // `title` is not validated by `resolveProducts`, so fall back to the id
  // rather than naming a blank product — the one rule, from its one home.
  const scopeLabel = scope.product ? productDisplayTitle(scope.product) : scope.productId;

  const flowRollupByNodeId = useMemo(
    () => Object.fromEntries(
      dataNodes
        .filter((node) => node.species === "flow")
        .map((flowNode) => [flowNode.id, computeFlowPlatformRollup(flowNode, nodesById, dataNodes, dataEdges)]),
    ) as Record<string, ReturnType<typeof createEmptyRollup>>,
    [dataNodes, dataEdges, nodesById],
  );

  async function handleNodeUpdate(nodeId: string, patch: Partial<Omit<DataNode, "id" | "project_id">>) {
    await updateNode(nodeId, patch);
  }

  function handleSelectNode(node: DataNode) {
    openNode({ nodeId: node.id });
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
        <span className="text-muted-foreground text-sm">Loading library...</span>
      </div>
    );
  }

  return (
    <>
      <PageShell
        title="Library"
        meta={speciesFilter === "all" ? undefined : SPECIES_META_LABELS[speciesFilter]}
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
        <div className="h-full overflow-auto">
          <div className="w-full">
            <StickyToolbar>
              <LibraryFilterBar
                search={search}
                displayMode={displayMode}
                blockedOnly={blockedOnly}
                onSearchChange={setSearch}
                onDisplayModeChange={setDisplayMode}
                onBlockedOnlyChange={setBlockedOnly}
                projectId={id}
                project={projectBundle}
              />
              {/* Inside the sticky band, not in the scrolling column: the bar
                  acts on rows the user ticked a screenful down, and a control
                  that scrolls away from its own selection is unreachable exactly
                  when it is needed. */}
              {selectionEnabled && (
                <LibrarySelectionBar
                  selected={selectedNodes}
                  hiddenCount={hiddenSelectedCount}
                  products={productList}
                  onClear={() => setSelectedIds(new Set())}
                  onMove={(productId) => void handleMoveToProduct(productId)}
                  busy={moving}
                />
              )}
            </StickyToolbar>

            <div className="flex flex-col gap-4 px-4 pb-4 md:px-6 md:pb-6">
            {visibleNodes.length === 0 ? (
              <div className="rounded-xl border border-dashed p-10 text-center">
                {/* An empty list under a named scope is not an empty project.
                    "No views yet" beside a library that holds forty of them
                    reads as data loss; say which product is empty instead. */}
                <p className="text-sm text-muted-foreground">
                  {scope.productId === null
                    ? `No ${emptyLabel} yet. Create one to get started.`
                    : `No ${emptyLabel} in ${scopeLabel}.`}
                </p>
                <div className="mt-4">
                  <Button size="sm" className="cursor-pointer" onClick={() => setNewNodeOpen(true)}>
                    <PlusIcon className="size-4" />
                    Create node
                  </Button>
                </div>
              </div>
            ) : displayMode === "gallery" ? (
              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {visibleNodes.map((node) => (
                  <li key={node.id}>
                    <NodeCard
                      node={node}
                      speciesLabel={SPECIES_LABEL_BY_ID[node.species] ?? node.species}
                      speciesDescription={SPECIES_DESCRIPTION_BY_ID[node.species]}
                      viewPlatformStatuses={node.species === "view" ? getEffectivePlatformStatuses(node, dataNodes, dataEdges) : undefined}
                      flowRollup={node.species === "flow" ? flowRollupByNodeId[node.id] : undefined}
                      playlistPreview={playlistPreviewForNode(node, nodesById)}
                      usedInCount={usedInByNodeId[node.id] ?? 0}
                      scope={scope}
                      productLabels={productLabelsByNodeId?.[node.id]}
                      selected={selectionEnabled ? selectedIds.has(node.id) : undefined}
                      onToggleSelected={toggleSelected}
                      onClick={() => handleSelectNode(node)}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <div className="rounded-xl border bg-card p-3">
                <NodeTable
                  nodes={visibleNodes}
                  sort={sort}
                  speciesLabelById={SPECIES_LABEL_BY_ID}
                  statusLabelById={STATUS_LABEL_BY_ID}
                  usedInByNodeId={usedInByNodeId}
                  scope={scope}
                  productLabelsByNodeId={productLabelsByNodeId}
                  selectedIds={selectionEnabled ? selectedIds : undefined}
                  onToggleSelected={toggleSelected}
                  onToggleAll={toggleAllVisible}
                  onSortChange={handleSortChange}
                  onSelectNode={handleSelectNode}
                />
              </div>
            )}
            </div>
          </div>
        </div>
      </PageShell>

      <NewNodeForm
        open={newNodeOpen}
        onOpenChange={setNewNodeOpen}
        onSubmit={handleCreateNode}
        defaultValues={speciesFilter !== "all" ? { species: speciesFilter } : undefined}
        products={productList}
        defaultProductId={scope.productId}
      />
    </>
  );
}
