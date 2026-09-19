"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { PanelHeaderEntityId } from "@/components/graph/nodes/EntityBadges";
import { PanelStack } from "@/components/panels/PanelStack";
import { CellDetailPanel, CellDetailPanelHeader } from "@/components/panels/CellDetailPanel";
import {
  CriterionDetailPanel,
  CriterionDetailPanelHeader,
} from "@/components/panels/CriterionDetailPanel";
import { NodeDetailPanel, NodeDetailPanelHeader } from "@/components/panels/NodeDetailPanel";
import { RawBundlePanel } from "@/components/panels/RawBundlePanel";
import { SplitAcceptanceDialog } from "@/components/panels/SplitAcceptanceDialog";
import { DuplicateNodeDialog } from "@/components/panels/DuplicateNodeDialog";
import { EmptyState } from "@/components/ui/empty-state";
import { deriveQualityMatrix, type KritikLibrary, type QualitySection, type QualityTrend } from "@arkaik/schema";
import type { PlatformId } from "@/lib/config/platforms";
import type { Edge, Node } from "@/lib/data/types";
import { useProjectPanels } from "@/lib/hooks/useProjectPanels";
import { useProjectId } from "@/lib/hooks/useProjectId";
import { useDuplicateNode } from "@/lib/hooks/useDuplicateNode";
import type { PanelEntry } from "@/lib/utils/panel-stack";
import type { PanelDescriptor } from "@/lib/utils/project-panels";
import { buildFindingRows } from "@/lib/utils/quality";
import { resolveProductScope, type ProductScope } from "@/lib/utils/product-scope";
import { coveredAnchorsOf } from "@/lib/utils/where-used";
import { toast } from "sonner";
import type { AcceptanceIntake } from "@/lib/hooks/useAcceptanceIntake";
import type { NodeRelations } from "@/lib/hooks/useNodeRelations";

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
  /** Whether node panels carry a History section — see `PageShell`. */
  history?: boolean;
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
  /**
   * Writing a node's relations (`useNodeRelations`), forwarded to the detail
   * panel's Relations group. Absent on a read-only surface, which is what makes
   * every line there read-only and drops the empty ones.
   */
  relations?: NodeRelations;
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
  /**
   * The recorded audits, for the cell panel's arrow and History. Read by the
   * Quality page (`useQualityData`) and handed down rather than fetched here,
   * for the reason the section is: nine of this component's ten callers never
   * open a cell panel and should not pay for a journal projection on mount.
   */
  qualityTrend?: QualityTrend;
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
  history,
  onUpdate,
  onDelete,
  onCreateNode,
  onCreateAcceptanceForAnchor,
  intake,
  relations,
  onZoomShot,
  qualitySection,
  qualityLibrary,
  qualityTrend,
}: ProjectPanelsProps) {
  const { entries, openNode, openCriterion, closeAt, unwindTo, pruneMissingNodes, panelStates } =
    useProjectPanels();

  const projectId = useProjectId();

  // Duplicate's target, alongside the split dialog's and for the same reasons:
  // the trigger is a header item, the dialog has to be in the document, and
  // `PanelStack` renders header and body through two separate render props. One
  // dialog serves every open panel.
  //
  // No `onDuplicate` prop on this component or on `PageShell`: availability
  // follows `onUpdate`, so a surface whose panels can write can duplicate, and
  // no page wires anything. Six pages each wiring their own handler is what let
  // three of them ship without the item at all.
  const [duplicateTarget, setDuplicateTarget] = useState<Node | null>(null);
  const duplicateNode = useDuplicateNode(projectId);

  // The split dialog's state lives here, above both halves of the panel.
  // Its trigger is a header item and the dialog itself has to be in the
  // document, and `PanelStack` renders header and body through two separate
  // render props — so neither half can hold it. One dialog for the whole stack,
  // not one per open panel: two open acceptance panels used to mount two.
  const [splitTarget, setSplitTarget] = useState<Node | null>(null);

  const nodesById = useMemo(() => new Map(allNodes.map((node) => [node.id, node])), [allNodes]);

  // A set, rebuilt only when the nodes change. `nodesById.keys()` would be a
  // fresh one-shot iterator per render of THIS component — and the dialog
  // re-renders on every keystroke without it, so it would read an exhausted
  // iterator and find no id taken.
  const nodeIds = useMemo(() => new Set(nodesById.keys()), [nodesById]);

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

  // The scored matrix, once per stack, for the same reason the findings are
  // denormalized here: a cell panel must show the number the card it was opened
  // from shows, and the only way to guarantee that is for both to read one
  // `deriveQualityMatrix`. Over an absent section it is a walk of two empty
  // arrays, so the pages that never open a cell panel pay nothing for it.
  const qualityMatrix = useMemo(
    () => deriveQualityMatrix({ quality: qualitySection }, qualityLibrary),
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
      if (entry.payload.kind === "cell") return `${entry.payload.domain} × ${entry.payload.surface}`;
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

  // The acceptance the split dialog is standing in, re-resolved by id: the
  // state holds the node as it was when the menu item fired, and an edit
  // landing under an open dialog must not leave it seeding a stale title.
  const splitNode = splitTarget ? nodesById.get(splitTarget.id) ?? splitTarget : null;
  // What the dialog's sentence about what carries over needs. Its own walk,
  // through the same `coveredAnchorsOf` every other surface uses, so there is
  // one definition of what "covered" means — memoized because it is a walk of
  // every edge in the project, and without this it re-ran on every render for
  // as long as the dialog stayed open (a keystroke in it is a render here).
  const splitAnchorCount = useMemo(
    () => (splitNode ? coveredAnchorsOf(splitNode, allNodes, allEdges).length : 0),
    [splitNode, allNodes, allEdges],
  );

  return (
    <>
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

          if (entry.payload.kind === "cell")
            return (
              <CellDetailPanelHeader
                domain={entry.payload.domain}
                surface={entry.payload.surface}
                library={qualityLibrary}
                section={qualitySection}
              />
            );

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
          return node ? (
            <NodeDetailPanelHeader
              node={node}
              // Opens the dialog; it does not write. Gated on `onUpdate` — the
            // same say the surface has over every other edit in the panel.
            onDuplicate={onUpdate ? () => setDuplicateTarget(node) : undefined}
              onDelete={onDelete}
              // Acceptances only, and only where the decompose gestures exist:
              // splitting is a write, and a read-only surface passes no `intake`.
              onSplit={
                intake && node.species === "acceptance" ? () => setSplitTarget(node) : undefined
              }
            />
          ) : (
            <PanelHeaderEntityId id={entry.key} />
          );
        }}
        renderBody={(entry, index) => {
          if (entry.payload.kind === "raw") {
            return <RawBundlePanel projectId={projectId} instanceId={entry.instanceId} />;
          }

          if (entry.payload.kind === "cell") {
            const { domain, surface } = entry.payload;
            return (
              <CellDetailPanel
                domain={domain}
                surface={surface}
                library={qualityLibrary}
                section={qualitySection}
                cell={qualityMatrix.matrix[domain]?.[surface] ?? null}
                trend={qualityTrend}
                findings={qualityFindings}
                nodesById={nodesById}
                projectId={projectId}
                // Above this panel, never in place of it — the rule every other
                // navigation in the stack follows, and the reason the trail still
                // reads back to the cell the reader came from.
                onOpenNode={(nodeId) => openNode({ nodeId }, index + 1)}
                onOpenCriterion={(criterionId, criterionSurface) =>
                  openCriterion(criterionId, criterionSurface, index + 1)
                }
              />
            );
          }

          if (entry.payload.kind === "criterion") {
            return (
              <CriterionDetailPanel
                criterionId={entry.payload.criterionId}
                surface={entry.payload.surface}
                library={qualityLibrary}
                section={qualitySection}
                findings={qualityFindings}
                nodesById={nodesById}
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
              <div className="min-h-0 flex-1 overflow-y-auto p-5 lg:p-6">
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
              allNodes={allNodes}
              allEdges={allEdges}
              history={history}
              onNavigate={(target) => openNode({ nodeId: target.id }, index + 1)}
              onCreateNode={onCreateNode}
              onCreateAcceptanceForAnchor={onCreateAcceptanceForAnchor}
              intake={intake}
              relations={relations}
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
      <DuplicateNodeDialog
        node={duplicateTarget}
        onOpenChange={(next) => { if (!next) setDuplicateTarget(null); }}
        existingIds={nodeIds}
        onSubmit={duplicateNode}
      />
      {/* One dialog for the whole stack, a sibling of it rather than a child of
          any panel — two open acceptance panels used to mount two. */}
      {intake && splitNode && (
        <SplitAcceptanceDialog
          open
          onOpenChange={(next) => { if (!next) setSplitTarget(null); }}
          title={splitNode.title}
          anchorCount={splitAnchorCount}
          // Not `run`: the dialog has to know whether the write landed, so
          // that a failure leaves the rows on screen instead of discarding
          // them. Reported here all the same, then rethrown.
          onSubmit={async (titles) => {
            try {
              await intake.split(splitNode, titles);
            } catch (err) {
              toast.error("Couldn't split the acceptance.");
              console.error(err);
              throw err;
            }
          }}
        />
      )}
    </>
  );
}
