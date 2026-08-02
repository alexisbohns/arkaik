"use client";

import { useEffect, useMemo } from "react";
import { EntityId } from "@/components/graph/nodes/EntityBadges";
import { PanelStack } from "@/components/panels/PanelStack";
import { NodeDetailPanel, NodeDetailPanelHeader } from "@/components/panels/NodeDetailPanel";
import type { PlatformId } from "@/lib/config/platforms";
import type { Edge, JournalEvent, Node } from "@/lib/data/types";
import { useNodePanels, type NodePanelEntry } from "@/lib/hooks/useNodePanels";

interface NodeDetailStackProps {
  /** The surface behind the stack — the breadcrumb's first crumb. */
  rootLabel: string;
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
  rootLabel,
  allNodes,
  allEdges,
  journal,
  onUpdate,
  onDelete,
  onCreateNode,
  onCreateAcceptanceForAnchor,
  onZoomShot,
}: NodeDetailStackProps) {
  const { entries, openNode, closeAt, unwindTo, pruneMissing } = useNodePanels();

  const nodesById = useMemo(() => new Map(allNodes.map((node) => [node.id, node])), [allNodes]);

  // An empty list is the loading window, not a deleted project — pruning then
  // would close a panel restored from `?node=` before its node ever arrived.
  useEffect(() => {
    if (nodesById.size === 0) return;
    pruneMissing(new Set(nodesById.keys()));
  }, [nodesById, pruneMissing]);

  return (
    <PanelStack<NodePanelEntry["payload"]>
      entries={entries}
      rootLabel={rootLabel}
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
    />
  );
}
