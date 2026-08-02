"use client";

import { useCallback, useEffect, useMemo, type ReactNode } from "react";
import { EntityId } from "@/components/graph/nodes/EntityBadges";
import { PanelStack } from "@/components/panels/PanelStack";
import { NodeDetailPanel, NodeDetailPanelHeader } from "@/components/panels/NodeDetailPanel";
import type { PlatformId } from "@/lib/config/platforms";
import type { Edge, JournalEvent, Node } from "@/lib/data/types";
import { useProjectPanels } from "@/lib/hooks/useProjectPanels";
import { RAW_PANEL_KEY, type PanelDescriptor } from "@/lib/utils/project-panels";

interface ProjectPanelsProps {
  /** The surface — canvas, board, or list. The grid's first cell. */
  children: ReactNode;
  /** The surface's accessible name. */
  surfaceLabel: string;
  /** The legacy in-body breadcrumb row, for surfaces not yet on PageShell. */
  showBreadcrumbs?: boolean;
  /** The surface's name, for that legacy row's first crumb. */
  rootLabel: string;
  /** Fires when the columns change, so a canvas can re-frame itself. */
  onLayoutChange?: () => void;
  allNodes?: Node[];
  allEdges?: Edge[];
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
 * Binds the panel stack to what a panel can be. A node entry resolves its id
 * against the surface's own data and renders `NodeDetailPanel`; the raw entry
 * renders the bundle editor, which needs no surface data at all — which is why
 * pages with no nodes of their own can still host it.
 *
 * Resolving by id rather than holding a node means an edit anywhere reaches
 * every panel showing that node, and a node deleted under the stack takes its
 * panels with it.
 */
export function ProjectPanels({
  children,
  surfaceLabel,
  showBreadcrumbs,
  rootLabel,
  onLayoutChange,
  allNodes = NO_NODES,
  allEdges = NO_EDGES,
  journal,
  onUpdate,
  onDelete,
  onCreateNode,
  onCreateAcceptanceForAnchor,
  onZoomShot,
}: ProjectPanelsProps) {
  const { entries, openNode, closeAt, unwindTo, pruneMissingNodes, panelStates } =
    useProjectPanels();

  const nodesById = useMemo(() => new Map(allNodes.map((node) => [node.id, node])), [allNodes]);

  // An empty list is the loading window, not a deleted project — pruning then
  // would close a panel restored from `?node=` before its node ever arrived.
  // It is also what every page that passes no nodes at all looks like.
  useEffect(() => {
    if (nodesById.size === 0) return;
    pruneMissingNodes(new Set(nodesById.keys()));
  }, [nodesById, pruneMissingNodes]);

  const labelOf = useCallback(
    (entry: { key: string }) =>
      entry.key === RAW_PANEL_KEY ? "Raw bundle" : nodesById.get(entry.key)?.title ?? entry.key,
    [nodesById],
  );

  const canCloseAt = useCallback(
    (index: number) => {
      const entry = entries[index];
      if (!entry) return true;
      return panelStates[entry.instanceId]?.canClose() ?? true;
    },
    [entries, panelStates],
  );

  return (
    <PanelStack<PanelDescriptor>
      entries={entries}
      surfaceLabel={surfaceLabel}
      showBreadcrumbs={showBreadcrumbs}
      rootLabel={rootLabel}
      onLayoutChange={onLayoutChange}
      labelOf={labelOf}
      accentOf={(entry) => panelStates[entry.instanceId]?.accent}
      canCloseAt={canCloseAt}
      renderHeader={(entry) => {
        if (entry.payload.kind === "raw")
          return <span className="text-sm font-medium">Raw bundle</span>;

        const node = nodesById.get(entry.key);
        return node ? <NodeDetailPanelHeader node={node} /> : <EntityId id={entry.key} />;
      }}
      renderBody={(entry, index) => {
        if (entry.payload.kind === "raw") return null;

        const node = nodesById.get(entry.key);
        if (!node) return null;

        return (
          <NodeDetailPanel
            node={node}
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
