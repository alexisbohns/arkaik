"use client";

import { useEffect, useMemo, type ReactNode } from "react";
import { EntityId } from "@/components/graph/nodes/EntityBadges";
import { PanelStack } from "@/components/panels/PanelStack";
import { NodeDetailPanel, NodeDetailPanelHeader } from "@/components/panels/NodeDetailPanel";
import type { PlatformId } from "@/lib/config/platforms";
import type { Edge, JournalEvent, Node } from "@/lib/data/types";
import { useProjectPanels } from "@/lib/hooks/useProjectPanels";
import { isNodeEntry, type PanelDescriptor } from "@/lib/utils/project-panels";

interface NodeDetailStackProps {
  /** The surface — canvas, board, or list. The grid's first cell. */
  children: ReactNode;
  /** The surface's name, for the breadcrumb's first crumb. */
  rootLabel: string;
  /** Fires when the columns change, so a canvas can re-frame itself. */
  onLayoutChange?: () => void;
  allNodes: Node[];
  allEdges: Edge[];
  journal?: JournalEvent[];
  onUpdate?: (id: string, patch: Partial<Omit<Node, "id" | "project_id">>) => Promise<void> | void;
  onDelete?: (nodeId: string) => void;
  onCreateNode?: (species: "flow" | "view", title: string) => Promise<Node>;
  onCreateAcceptanceForAnchor?: (anchor: Node, title: string) => Promise<Node>;
  onZoomShot?: (node: Node, platform: PlatformId) => void;
}

/**
 * Binds the panel stack to nodes: it resolves each entry's id against the
 * surface's own data, renders `NodeDetailPanel` as the content, and turns
 * `onNavigate` into "push from my index" — which is the whole traversal model.
 *
 * Resolving by id rather than holding a node means an edit anywhere reaches
 * every panel showing that node, and a node deleted under the stack takes its
 * panels with it.
 */
export function NodeDetailStack({
  children,
  rootLabel,
  onLayoutChange,
  allNodes,
  allEdges,
  journal,
  onUpdate,
  onDelete,
  onCreateNode,
  onCreateAcceptanceForAnchor,
  onZoomShot,
}: NodeDetailStackProps) {
  const { entries, openNode, closeAt, unwindTo, pruneMissingNodes } = useProjectPanels();

  const nodesById = useMemo(() => new Map(allNodes.map((node) => [node.id, node])), [allNodes]);

  // An empty list is the loading window, not a deleted project — pruning then
  // would close a panel restored from `?node=` before its node ever arrived.
  useEffect(() => {
    if (nodesById.size === 0) return;
    pruneMissingNodes(new Set(nodesById.keys()));
  }, [nodesById, pruneMissingNodes]);

  return (
    <PanelStack<PanelDescriptor>
      entries={entries}
      rootLabel={rootLabel}
      onLayoutChange={onLayoutChange}
      labelOf={(entry) => nodesById.get(entry.key)?.title ?? entry.key}
      renderHeader={(entry) => {
        const node = nodesById.get(entry.key);
        return node ? <NodeDetailPanelHeader node={node} /> : <EntityId id={entry.key} />;
      }}
      renderBody={(entry, index) => {
        const node = nodesById.get(entry.key);
        if (!node) return null;

        return (
          <NodeDetailPanel
            node={node}
            initialPlatform={isNodeEntry(entry) ? entry.payload.initialPlatform : undefined}
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
