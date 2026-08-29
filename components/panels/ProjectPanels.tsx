"use client";

import { useCallback, useEffect, useMemo, type ReactNode } from "react";
import Link from "next/link";
import { EntityId } from "@/components/graph/nodes/EntityBadges";
import { PanelStack } from "@/components/panels/PanelStack";
import {
  CriterionDetailPanel,
  CriterionDetailPanelHeader,
} from "@/components/panels/CriterionDetailPanel";
import { NodeDetailPanel, NodeDetailPanelHeader } from "@/components/panels/NodeDetailPanel";
import { RawBundlePanel } from "@/components/panels/RawBundlePanel";
import { EmptyState } from "@/components/ui/empty-state";
import type { KritikLibrary, QualitySection } from "@arkaik/schema";
import type { PlatformId } from "@/lib/config/platforms";
import type { Edge, JournalEvent, Node } from "@/lib/data/types";
import { useProjectPanels } from "@/lib/hooks/useProjectPanels";
import { useProjectId } from "@/lib/hooks/useProjectId";
import type { PanelEntry } from "@/lib/utils/panel-stack";
import type { PanelDescriptor } from "@/lib/utils/project-panels";
import { buildFindingRows } from "@/lib/utils/quality";
import { resolveProductScope, type ProductScope } from "@/lib/utils/product-scope";
import type { AcceptanceIntake } from "@/lib/hooks/useAcceptanceIntake";

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
   * mounted by pages that carry no nodes at all — Settings, Maps — where the
   * only panel is the raw bundle and there is nothing to scope.
   */
  scope?: ProductScope;
  journal?: JournalEvent[];
  onUpdate?: (id: string, patch: Partial<Omit<Node, "id" | "project_id">>) => Promise<void> | void;
  onDelete?: (nodeId: string) => void;
  onCreateNode?: (species: "flow" | "view", title: string) => Promise<Node>;
  onCreateAcceptanceForAnchor?: (anchor: Node, title: string) => Promise<Node>;
  /**
   * The acceptance decompose gestures (`useAcceptanceIntake`), forwarded to
   * every acceptance panel this grid opens. Omitted by pages whose panels are
   * read-only, and then the Covers list is the read-only list it always was.
   */
  intake?: AcceptanceIntake;
  onZoomShot?: (node: Node, platform: PlatformId) => void;
  /**
   * The project's Kritik state, for criterion panels.
   *
   * Absent on every page but Quality, which is the only one that opens one —
   * and a criterion panel with neither is still a panel: it says the pack is
   * not here rather than rendering blank headings. Passing them from the page
   * rather than reading `useProject` here keeps this component free of a data
   * dependency that nine of its ten callers would pay for and never use.
   */
  qualitySection?: QualitySection;
  qualityLibrary?: KritikLibrary;
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
  intake,
  onZoomShot,
  qualitySection,
  qualityLibrary,
}: ProjectPanelsProps) {
  const { entries, openNode, openCriterion, closeAt, unwindTo, pruneMissingNodes, panelStates } =
    useProjectPanels();

  const projectId = useProjectId();

  const nodesById = useMemo(() => new Map(allNodes.map((node) => [node.id, node])), [allNodes]);

  // Denormalized here rather than inside the criterion panel, which cannot
  // memoize it: `react-hooks/preserve-manual-memoization` is an error, and it
  // refuses the memo that would wrap the whole derivation down there — see the
  // note in `CriterionDetailPanel`. Once per stack rather than once per open
  // criterion is also the right altitude for it: the rows are a property of the
  // section, not of any one criterion. Every page but Quality passes no section
  // at all, and `buildFindingRows` over an absent one is two empty maps and an
  // empty array, so the nine callers that will never open a criterion panel pay
  // effectively nothing for it.
  const qualityFindings = useMemo(
    () => buildFindingRows(qualitySection, qualityLibrary),
    [qualitySection, qualityLibrary],
  );

  // An empty list is the loading window, not a deleted project — pruning then
  // would close a panel restored from `?node=` before its node ever arrived.
  // It is also what every page that passes no nodes at all looks like.
  useEffect(() => {
    if (nodesById.size === 0) return;
    pruneMissingNodes(new Set(nodesById.keys()));
  }, [nodesById, pruneMissingNodes]);

  // Branching on `kind` rather than on the key keeps one way to spot a raw
  // entry: the key/kind equivalence is an invariant the union does not enforce,
  // so a second test of it is a second thing that can drift. A criterion's key
  // is namespaced, so it is also the one kind whose key is not something a
  // reader should ever be shown.
  const labelOf = useCallback(
    (entry: PanelEntry<PanelDescriptor>) => {
      if (entry.payload.kind === "raw") return "Raw bundle";
      if (entry.payload.kind === "criterion") return entry.payload.criterionId;
      return nodesById.get(entry.key)?.title ?? entry.key;
    },
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

        if (entry.payload.kind === "criterion")
          return (
            <CriterionDetailPanelHeader
              criterionId={entry.payload.criterionId}
              surface={entry.payload.surface}
              library={qualityLibrary}
              section={qualitySection}
            />
          );

        const node = nodesById.get(entry.key);
        return node ? <NodeDetailPanelHeader node={node} /> : <EntityId id={entry.key} />;
      }}
      renderBody={(entry, index) => {
        if (entry.payload.kind === "raw") {
          return <RawBundlePanel projectId={projectId} instanceId={entry.instanceId} />;
        }

        if (entry.payload.kind === "criterion") {
          return (
            <CriterionDetailPanel
              criterionId={entry.payload.criterionId}
              surface={entry.payload.surface}
              library={qualityLibrary}
              section={qualitySection}
              findings={qualityFindings}
              // From this panel's own depth, like every other navigation in the
              // stack: following a finding into the graph opens the node ABOVE
              // the criterion rather than in place of it, which is what depth 0
              // would do.
              //
              // Sitting above it is not the same as surviving it, and no
              // comment here should promise that it is. Opening the node
              // publishes `?node=`; Back — or closing that node panel, which
              // republishes an empty address — hands `reconcileArrival` a
              // missing id, and a missing id closes the *whole* stack, this
              // criterion with it. One address, and a criterion is not it. Raw
              // has had the identical behaviour since it landed. What brings
              // the panel back is the Quality page's own `?criterion=` sync,
              // and it comes back remounted, so the reader loses their scroll
              // position in it.
              onOpenNode={(nodeId) => openNode({ nodeId }, index + 1)}
            />
          );
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
              <EmptyState
                message="This page has no node with that id — it may live on another surface, or it may no longer exist."
                action={
                  <Link
                    href={`/project/${projectId}/library`}
                    className="text-sm underline underline-offset-4"
                  >
                    Look for it in the Library
                  </Link>
                }
              />
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
            intake={intake}
            onZoomShot={onZoomShot}
            findings={qualityFindings}
            // From this panel's own depth, the rule the criterion panel's
            // `onOpenNode` above already follows: a criterion opened out of a
            // node sits ABOVE that node rather than replacing it, so the trail
            // still reads back to the node the reader came from.
            onOpenCriterion={(criterionId, surface) => openCriterion(criterionId, surface, index + 1)}
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
