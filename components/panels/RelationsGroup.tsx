"use client";

import { cn } from "@/lib/utils";
import { PanelGroup } from "@/components/panels/PanelGroup";
import {
  ConnectionsSection,
  FindingsSection,
  InvocationSection,
  RefsSection,
} from "@/components/panels/NodeRelationSections";
import { CoversSection } from "@/components/panels/AcceptanceEditor";
import { AcceptancesSection } from "@/components/panels/AcceptancesSection";
import { SEVERITY_CHIP, SEVERITY_LABEL } from "@/components/quality/quality-styles";
import { worstOpenFindingFor, type FindingRow } from "@/lib/utils/quality";
import { findWhereUsed, crossLayerConnections } from "@/lib/utils/where-used";
import { acceptancesCovering } from "@arkaik/schema";
import type { Node, Edge } from "@/lib/data/types";
import type { ProductScope } from "@/lib/utils/product-scope";
import type { AcceptanceIntake } from "@/lib/hooks/useAcceptanceIntake";

interface RelationsGroupProps {
  node: Node;
  scope: ProductScope;
  allNodes?: Node[];
  allEdges?: Edge[];
  onNavigate?: (node: Node) => void;
  onCreateAcceptanceForAnchor?: (anchor: Node, title: string) => Promise<Node>;
  intake?: AcceptanceIntake;
  findings?: FindingRow[];
  onOpenCriterion?: (criterionId: string, surface: string) => void;
}

/**
 * Everything this node is attached to, in one region.
 *
 * Covers, Acceptances, Invocation, References, Findings and Connections were six
 * sibling sections in a flat column, indistinguishable in weight from the fields
 * that say what the record *is*. They are all the same kind of thing — the
 * record pointing at other records — and as one named region a reader can shut
 * them all at once and read the record itself.
 *
 * **The bar carries the findings chip.** Moving Findings into a group costs it
 * the position it held on a stated argument — that an open critical finding is
 * the most urgent thing the panel can say — and the chip is that argument
 * surviving the move. It is on the bar, so it shows whether the group is open or
 * shut.
 *
 * **Renders nothing when every child would.** A bar over six empty sections
 * promises a reader something to open and then opens onto nothing. Each child
 * already returns `null` when empty, but a parent cannot see that, so the
 * emptiness test is made here from the same inputs the children use.
 */
export function RelationsGroup({
  node,
  scope,
  allNodes,
  allEdges,
  onNavigate,
  onCreateAcceptanceForAnchor,
  intake,
  findings,
  onOpenCriterion,
}: RelationsGroupProps) {
  const isAnchor = node.species === "view" || node.species === "flow";
  const openFindings = findings && onOpenCriterion ? worstOpenFindingFor(findings, node.id) : null;

  // Each child's emptiness, asked here from the inputs the child itself reads.
  // The duplication is deliberate. The alternative is each section reporting its
  // own count upward — six components that must both render `null` and report
  // zero, and two chances each for the two answers to disagree. Asking the same
  // shared helpers the sections ask (`findWhereUsed`, `crossLayerConnections`,
  // `acceptancesCovering`, `worstOpenFindingFor`) keeps the two readings of
  // "empty" pinned to one implementation apiece.
  //
  // `hasCovers` and `hasAcceptances` are true whenever the write affordance
  // exists, even with an empty list: those two sections carry a create/attach
  // control, so an empty list is still something to show a writer — it is where
  // the first anchor or the first acceptance gets made.
  const hasRefs = (node.metadata?.refs ?? []).length > 0;
  const hasFindings = openFindings !== null;
  const hasCovers =
    node.species === "acceptance" &&
    Boolean(allEdges) &&
    (intake !== undefined ||
      (allEdges ?? []).some((e) => e.edge_type === "covers" && e.source_id === node.id));
  const hasAcceptances =
    isAnchor && Boolean(allNodes && allEdges) &&
    (onCreateAcceptanceForAnchor !== undefined ||
      acceptancesCovering(node.id, allNodes ?? [], allEdges ?? []).length > 0);
  const hasInvocation = isAnchor && Boolean(allNodes) && findWhereUsed(node.id, allNodes ?? []).length > 0;
  const hasConnections =
    Boolean(allNodes && allEdges && onNavigate) &&
    crossLayerConnections(node, allNodes ?? [], allEdges ?? []).length > 0;

  if (!hasCovers && !hasAcceptances && !hasInvocation && !hasRefs && !hasFindings && !hasConnections) {
    return null;
  }

  return (
    <PanelGroup
      title="Relations"
      meta={
        openFindings && (
          <span
            className={cn(
              "rounded border px-1.5 py-0.5 text-[11px] font-medium",
              SEVERITY_CHIP[openFindings.severity],
            )}
          >
            {SEVERITY_LABEL[openFindings.severity]} {openFindings.count}
          </span>
        )
      }
    >
      {/* Every child behind its own `has*` flag, including the two that decide
          their own emptiness (References, Findings). Consistency is worth more
          than the two lines it saves: read down this list and the render order
          is the emptiness test's order, term for term, so a child that stops
          agreeing with its flag is visible here rather than only on screen. */}
      {hasCovers && allEdges && (
        <CoversSection
          node={node}
          allNodes={allNodes ?? []}
          allEdges={allEdges}
          scope={scope}
          onNavigate={onNavigate}
          intake={intake}
        />
      )}
      {hasAcceptances && allNodes && allEdges && (
        <AcceptancesSection
          node={node}
          scope={scope}
          allNodes={allNodes}
          allEdges={allEdges}
          onNavigate={onNavigate}
          onCreate={onCreateAcceptanceForAnchor}
        />
      )}
      {hasInvocation && allNodes && onNavigate && (
        <InvocationSection node={node} allNodes={allNodes} onNavigate={onNavigate} />
      )}
      {hasRefs && <RefsSection node={node} />}
      {hasFindings && findings && onOpenCriterion && (
        <FindingsSection node={node} findings={findings} onOpenCriterion={onOpenCriterion} />
      )}
      {hasConnections && allNodes && allEdges && onNavigate && (
        <ConnectionsSection
          node={node}
          allNodes={allNodes}
          allEdges={allEdges}
          onNavigate={onNavigate}
        />
      )}
    </PanelGroup>
  );
}
