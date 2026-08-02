"use client";

import { useCallback, useEffect, useMemo, type ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { EntityId } from "@/components/graph/nodes/EntityBadges";
import { PanelStack } from "@/components/panels/PanelStack";
import { NodeDetailPanel, NodeDetailPanelHeader } from "@/components/panels/NodeDetailPanel";
import { RawBundlePanel } from "@/components/panels/RawBundlePanel";
import type { PlatformId } from "@/lib/config/platforms";
import type { Edge, JournalEvent, Node } from "@/lib/data/types";
import { useProjectPanels } from "@/lib/hooks/useProjectPanels";
import type { PanelEntry } from "@/lib/utils/panel-stack";
import type { PanelDescriptor } from "@/lib/utils/project-panels";
import { resolveProductScope, type ProductScope } from "@/lib/utils/product-scope";

interface ProjectPanelsProps {
  /** The surface — canvas, board, or list. The grid's first cell. */
  children: ReactNode;
  /** The surface's accessible name. */
  surfaceLabel: string;
  /** Whether the surface renders as a card. Off unless the surface is a canvas. */
  surfaceCard?: boolean;
  /** Fires when the columns change, so a canvas can re-frame itself. */
  onLayoutChange?: () => void;
  allNodes?: Node[];
  allEdges?: Edge[];
  /**
   * The surface's product scope, forwarded to every node panel it opens.
   *
   * A prop rather than a `useEffectiveProduct` call of its own, for the same
   * reason every surface takes one: a panel shows what the surface behind it
   * was showing, so when the deferred per-surface override lands the panel must
   * follow that surface and not the global. Optional because the shell is now
   * mounted by pages that carry no nodes at all — Settings, Changelog, Maps —
   * where the only panel is the raw bundle and there is nothing to scope.
   */
  scope?: ProductScope;
  journal?: JournalEvent[];
  onUpdate?: (id: string, patch: Partial<Omit<Node, "id" | "project_id">>) => Promise<void> | void;
  onDelete?: (nodeId: string) => void;
  onCreateNode?: (species: "flow" | "view", title: string) => Promise<Node>;
  onCreateAcceptanceForAnchor?: (anchor: Node, title: string) => Promise<Node>;
  onZoomShot?: (node: Node, platform: PlatformId) => void;
}

const NO_NODES: Node[] = [];
const NO_EDGES: Edge[] = [];
/**
 * All products, every platform — what `resolveProductScope` answers for a
 * project that declares none, and so exactly the pre-products behaviour. Built
 * once at module scope: it is a default prop value, and a fresh object per
 * render would defeat the memoized sections downstream of it.
 */
const UNSCOPED: ProductScope = resolveProductScope(undefined, null);

/**
 * Binds the panel stack to what a panel can be. A node entry resolves its id
 * against the surface's own data and renders `NodeDetailPanel`; the raw entry
 * renders `RawBundlePanel`, which needs no surface data at all — which is why
 * pages with no nodes of their own can still host it.
 *
 * Resolving by id rather than holding a node means an edit anywhere reaches
 * every panel showing that node, and a node deleted under the stack takes its
 * panels with it.
 */
export function ProjectPanels({
  children,
  surfaceLabel,
  surfaceCard,
  onLayoutChange,
  allNodes = NO_NODES,
  allEdges = NO_EDGES,
  scope = UNSCOPED,
  journal,
  onUpdate,
  onDelete,
  onCreateNode,
  onCreateAcceptanceForAnchor,
  onZoomShot,
}: ProjectPanelsProps) {
  const { entries, openNode, closeAt, unwindTo, pruneMissingNodes, panelStates } =
    useProjectPanels();

  const params = useParams();
  const projectId = Array.isArray(params.id) ? params.id[0] : params.id ?? "";

  const nodesById = useMemo(() => new Map(allNodes.map((node) => [node.id, node])), [allNodes]);

  // An empty list is the loading window, not a deleted project — pruning then
  // would close a panel restored from `?node=` before its node ever arrived.
  // It is also what every page that passes no nodes at all looks like.
  useEffect(() => {
    if (nodesById.size === 0) return;
    pruneMissingNodes(new Set(nodesById.keys()));
  }, [nodesById, pruneMissingNodes]);

  // Branching on `kind` rather than on the key keeps one way to spot a raw
  // entry: the key/kind equivalence is an invariant the union does not enforce,
  // so a second test of it is a second thing that can drift.
  const labelOf = useCallback(
    (entry: PanelEntry<PanelDescriptor>) =>
      entry.payload.kind === "raw" ? "Raw bundle" : nodesById.get(entry.key)?.title ?? entry.key,
    [nodesById],
  );

  const requestCloseAt = useCallback(
    (index: number, resume: () => void) => {
      const entry = entries[index];
      if (!entry) return true;
      return panelStates[entry.instanceId]?.requestClose(resume) ?? true;
    },
    [entries, panelStates],
  );

  return (
    <PanelStack<PanelDescriptor>
      entries={entries}
      surfaceLabel={surfaceLabel}
      surfaceCard={surfaceCard}
      onLayoutChange={onLayoutChange}
      labelOf={labelOf}
      accentOf={(entry) => panelStates[entry.instanceId]?.accent}
      requestCloseAt={requestCloseAt}
      renderHeader={(entry) => {
        if (entry.payload.kind === "raw")
          return <span className="truncate text-sm font-medium">Raw bundle</span>;

        const node = nodesById.get(entry.key);
        return node ? <NodeDetailPanelHeader node={node} /> : <EntityId id={entry.key} />;
      }}
      renderBody={(entry, index) => {
        if (entry.payload.kind === "raw") {
          return <RawBundlePanel projectId={projectId} instanceId={entry.instanceId} />;
        }

        const node = nodesById.get(entry.key);

        // Say so rather than dropping the entry. Suppression would collapse
        // three cases nothing here can tell apart — a page that carries no
        // nodes at all, a page whose nodes have not arrived yet (the same
        // window the prune above refuses to act in), and an id that names
        // nothing — and in every one of them the trail and the `?node=` URL
        // would still promise a panel the user cannot see. It also spares the
        // loading case a body that flickers in and out.
        if (!node)
          return (
            <div className="min-h-0 flex-1 overflow-y-auto p-6">
              <div className="rounded-xl border border-dashed p-10 text-center">
                <p className="text-sm text-muted-foreground">
                  This page has no node with that id — it may live on another surface, or it may no
                  longer exist.
                </p>
                <div className="mt-4">
                  <Link
                    href={`/project/${projectId}/library`}
                    className="text-sm underline underline-offset-4"
                  >
                    Look for it in the Library
                  </Link>
                </div>
              </div>
            </div>
          );

        return (
          <NodeDetailPanel
            node={node}
            scope={scope}
            initialPlatform={entry.payload.initialPlatform}
            onUpdate={onUpdate}
            onDelete={onDelete}
            allNodes={allNodes}
            allEdges={allEdges}
            journal={journal}
            onNavigate={(target) => openNode({ nodeId: target.id }, index + 1)}
            onCreateNode={onCreateNode}
            onCreateAcceptanceForAnchor={onCreateAcceptanceForAnchor}
            onZoomShot={onZoomShot}
          />
        );
      }}
      onCloseAt={closeAt}
      onUnwindTo={unwindTo}
    >
      {children}
    </PanelStack>
  );
}
