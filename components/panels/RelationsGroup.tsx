"use client";

import { cn } from "@/lib/utils";
import { PanelGroup } from "@/components/panels/PanelGroup";
import {
  ConnectionsSection,
  CoversSection,
  DecisionLinksSection,
  FindingsSection,
  InvocationSection,
  RefsSection,
  decisionConnections,
  hasDecisionLinkRows,
} from "@/components/panels/NodeRelationSections";
import { AcceptancesSection } from "@/components/panels/AcceptancesSection";
import { SEVERITY_CHIP, SEVERITY_LABEL } from "@/components/quality/quality-styles";
import { worstOpenFindingFor, type FindingRow } from "@/lib/utils/quality";
import { findWhereUsed, crossLayerConnections } from "@/lib/utils/where-used";
import type { Node, Edge } from "@/lib/data/types";
import type { ProductScope } from "@/lib/utils/product-scope";
import type { AcceptanceIntake } from "@/lib/hooks/useAcceptanceIntake";
import type { NodeRelations } from "@/lib/hooks/useNodeRelations";

interface RelationsGroupProps {
  node: Node;
  scope: ProductScope;
  allNodes?: Node[];
  allEdges?: Edge[];
  onNavigate?: (node: Node) => void;
  onCreateAcceptanceForAnchor?: (anchor: Node, title: string) => Promise<Node>;
  intake?: AcceptanceIntake;
  /**
   * Writing a node's relations (`useNodeRelations`). Absent on a read-only
   * surface, which is what makes every line here read-only and drops the empty
   * ones.
   */
  relations?: NodeRelations;
  findings?: FindingRow[];
  onOpenCriterion?: (criterionId: string, surface: string) => void;
}

/**
 * Everything this node is attached to, in one region.
 *
 * Acceptances, Invocation, References, Findings and Connections were five
 * sibling sections in a flat column, indistinguishable in weight from the fields
 * that say what the record *is* — and Covers was worse off still: a labelled
 * field buried inside `AcceptanceEditor`, so the one species whose covers list
 * is its whole point had it filed among its controls rather than among its
 * cross-references. Decision links was the same mistake in `DecisionEditor`,
 * paid off here. All seven are the same kind of thing — the record pointing at
 * other records — and as one named region a reader can shut them all at once and
 * read the record itself.
 *
 * **The bar carries the findings chip.** Moving Findings into a group costs it
 * the position it held on a stated argument — that an open critical finding is
 * the most urgent thing the panel can say — and the chip is that argument
 * surviving the move. It is on the bar, so it shows whether the group is open or
 * shut.
 *
 * **Renders nothing when every child would.** A bar over seven empty sections
 * promises a reader something to open and then opens onto nothing. Most children
 * already return `null` when empty, but a parent cannot see that, so the
 * emptiness test is made here from the same inputs the children use.
 *
 * Two of them never return `null` — Covers and Acceptances both have a sentence
 * for the empty case, and both sentences are facts about the graph rather than
 * empty states ("this acceptance is an orphan", "nothing verifies this view").
 * Their flags therefore ask only whether the section can render at all.
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
  // own count upward — seven components that must both render `null` and report
  // zero, and two chances each for the two answers to disagree. Asking the same
  // shared helpers the sections ask (`findWhereUsed`, `crossLayerConnections`,
  // `worstOpenFindingFor`) keeps the two readings of "empty" pinned to one
  // implementation apiece.
  //
  // `hasCovers` and `hasAcceptances` ask no question about content at all, and
  // so need no helper: their sections never render nothing. Both say something
  // about an empty list — "Unanchored (covers nothing)", "No acceptances cover
  // this view yet." — and both of those are facts about the graph rather than
  // empty states. See each one below.
  // A content flag, not a can-it-render one: `DecisionLinksSection` returns
  // `null` when all four of its lists are empty, exactly as the `Field` it was
  // did behind its condition. A decision that links to nothing has no sentence
  // to say about it the way an unanchored acceptance does — "Decision links"
  // over four absent lists would be an empty state, not a fact about the graph.
  //
  // `onNavigate` is deliberately NOT in the flag, because the section does not
  // require it: a linked row without it still shows the title and the id chip,
  // which is what the read-only decision panel showed before the move. The rule
  // is that the flag carries every prop the render guard needs, and this guard
  // needs `allNodes` and `allEdges` only.
  const hasDecisionLinks =
    node.species === "decision" &&
    Boolean(allNodes && allEdges) &&
    hasDecisionLinkRows(decisionConnections(node, allNodes ?? [], allEdges ?? []));
  const hasRefs = (node.metadata?.refs ?? []).length > 0;
  const hasFindings = openFindings !== null;
  // Every acceptance has a covers story, including "none" — so this asks only
  // whether the section can be rendered at all, never whether it found anything.
  //
  // The narrower test (an anchor exists, or `intake` offers the attach gesture) hid
  // the whole group on a read-only acceptance that covers nothing and has no
  // other relation, taking "Unanchored (covers nothing)" with it. That line is
  // not an empty state, it is a finding: an acceptance anchored to nothing is an
  // orphan, and a reader who cannot see it said has no way to tell an orphan
  // from a panel that simply does not list covers. The group's "render nothing
  // when every child would" rule is about sections with nothing to say, and this
  // one always has something.
  //
  // Both lists, not just the edges: `CoversSection` resolves each `covers` edge
  // to a node to name it, so with edges in hand and nodes absent every lookup
  // would miss and the section would report "Unanchored" about an acceptance
  // that is anchored. Unreachable today — the one call site passes both — but
  // the guard should be the one the child actually needs.
  const hasCovers = node.species === "acceptance" && Boolean(allNodes && allEdges);
  // The same rule as `hasCovers`, for the same reason: `AcceptancesSection`
  // never returns null — it says "No acceptances cover this view yet." — so an
  // anchor with none still has something to show, and on a read-only surface the
  // narrower test took that line away along with, sometimes, the whole bar. An
  // anchor nothing verifies is a gap in the graph, not an absence of content.
  const hasAcceptances = isAnchor && Boolean(allNodes && allEdges);
  // `onNavigate` as well as the nodes, matching `hasConnections` below and the
  // guard the child is actually rendered behind: `InvocationSection` takes it as
  // required, because a list of flows that cannot be opened is a list of names.
  // Without it in the flag, a view whose only relation is an invocation would
  // pass the emptiness test and open a bar onto nothing — the one failure this
  // whole computation exists to prevent.
  const hasInvocation =
    isAnchor && Boolean(allNodes && onNavigate) && findWhereUsed(node.id, allNodes ?? []).length > 0;
  const hasConnections =
    Boolean(allNodes && allEdges && onNavigate) &&
    crossLayerConnections(node, allNodes ?? [], allEdges ?? []).length > 0;

  if (
    !hasCovers &&
    !hasAcceptances &&
    !hasInvocation &&
    !hasDecisionLinks &&
    !hasRefs &&
    !hasFindings &&
    !hasConnections
  ) {
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
      {hasCovers && allNodes && allEdges && (
        <CoversSection
          node={node}
          allNodes={allNodes}
          allEdges={allEdges}
          hasProducts={scope.productsById.size > 0}
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
      {/* First among a decision's relations, per the spec's per-species table:
          its four link lists, then References, Findings and Connections. */}
      {hasDecisionLinks && allNodes && allEdges && (
        <DecisionLinksSection
          node={node}
          allNodes={allNodes}
          allEdges={allEdges}
          onNavigate={onNavigate}
        />
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
