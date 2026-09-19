"use client";

import { useMemo } from "react";

import { cn } from "@/lib/utils";
import { PanelGroup } from "@/components/panels/PanelGroup";
import {
  CoversSection,
  EdgeRelationLine,
  FindingsSection,
  InvocationSection,
  RefsSection,
} from "@/components/panels/NodeRelationSections";
import { AcceptancesSection } from "@/components/panels/AcceptancesSection";
import { BlockedByField } from "@/components/panels/BlockedByField";
import { SEVERITY_CHIP, SEVERITY_LABEL } from "@/components/quality/quality-styles";
import { worstOpenFindingFor, type FindingRow } from "@/lib/utils/quality";
import { relationLinesFor, relationRows } from "@/lib/utils/relation-lines";
import { findWhereUsed } from "@/lib/utils/where-used";
import { blockedByOf } from "@/lib/utils/blocked";
import type { Node, NodeMetadata, Edge } from "@/lib/data/types";
import type { ProductScope } from "@/lib/utils/product-scope";
import type { AcceptanceIntake } from "@/lib/hooks/useAcceptanceIntake";
import type { NodeRelations } from "@/lib/hooks/useNodeRelations";

interface RelationsGroupProps {
  node: Node;
  scope: ProductScope;
  allNodes?: Node[];
  allEdges?: Edge[];
  onNavigate?: (node: Node) => void;
  /**
   * Writing the node itself, for the one line that is a metadata key rather
   * than an edge: Blocked by. Absent on a read-only surface, and the line is
   * then a row or nothing.
   */
  onUpdate?: (id: string, patch: Partial<Omit<Node, "id" | "project_id">>) => Promise<void> | void;
  /**
   * The panel's shared latest-metadata write base, passed straight through to
   * `BlockedByField`. Required rather than optional: the component that renders
   * this group also renders `DecisionEditor`, whose four metadata writers that
   * line sits beside on a decision panel, so there is no caller for which
   * "nothing else on this panel writes metadata" holds. See `NodeDetailPanel`,
   * which owns it.
   */
  metadataRef: React.MutableRefObject<NodeMetadata | undefined>;
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
 * paid off here. They are all the same kind of thing — the record pointing at
 * other records — and as one named region a reader can shut them all at once and
 * read the record itself.
 *
 * **The edge lines come from the grammar, not from this file.**
 * `relationLinesFor(node.species)` is the list, so a panel gains a line the day
 * `VALID_EDGE_SEMANTICS` admits the pair and never because someone remembered
 * to add one here. The flat "Connections" list and the four hand-written
 * "Decision links" lists were the same lines, named worse: the first said what
 * *species* each counterpart was rather than what the relation is, so a view
 * that calls an endpoint and a view an endpoint calls back read identically.
 *
 * **The bar carries the findings chip.** Moving Findings into a group costs it
 * the position it held on a stated argument — that an open critical finding is
 * the most urgent thing the panel can say — and the chip is that argument
 * surviving the move. It is on the bar, so it shows whether the group is open or
 * shut.
 *
 * **Renders nothing when every child would.** A bar over a column of empty
 * sections promises a reader something to open and then opens onto nothing.
 * Most children already return `null` when empty, but a parent cannot see that,
 * so the emptiness test is made here from the same inputs the children use.
 *
 * The rule for an edge line is the one `RelationLine` states: the group renders
 * a line when it has rows, or when the surface can write — because a label with
 * a `+` on it is an invitation. On a read-only surface an empty line is dropped
 * entirely, because a bare label over nothing is an empty state. So a writable
 * panel shows every line its species has and the group is never empty there;
 * a read-only one shows only the lines that found something.
 *
 * Two children never return `null` — Covers and Acceptances both have a sentence
 * for the empty case, and both sentences are facts about the graph rather than
 * empty states ("this acceptance is an orphan", "nothing verifies this view").
 * Their flags therefore ask only whether the section can render at all.
 *
 * **Blocked by is the one line that is not an edge.** It is
 * `metadata.blocked_by` — a single free string that may name a node or say
 * anything at all — so it writes through `onUpdate` rather than `relations`,
 * and `BlockedByField` renders whatever `hasBlockedBy` lets through. It is
 * first because what holds a record up changes how the rest of it reads.
 */
export function RelationsGroup({
  node,
  scope,
  allNodes,
  allEdges,
  onNavigate,
  onUpdate,
  metadataRef,
  onCreateAcceptanceForAnchor,
  intake,
  relations,
  findings,
  onOpenCriterion,
}: RelationsGroupProps) {
  // Only a view or a flow appears in a playlist, so only one can be invoked.
  // The species test is redundant with what `findWhereUsed` can return and is
  // kept anyway, as its neighbours are: the flag states the condition the
  // section is rendered under rather than relying on a second function's range.
  const isAnchor = node.species === "view" || node.species === "flow";
  const openFindings = findings && onOpenCriterion ? worstOpenFindingFor(findings, node.id) : null;
  // One map for the whole group. Every relation line resolves a counterpart id
  // to a node — a decision panel has four of them — and a map per line is four
  // identical project-wide maps per render for one answer. It is also what lets
  // the emptiness test below resolve exactly the rows the lines will render,
  // rather than counting raw ids the children may then drop.
  const nodesById = useMemo(
    () => new Map((allNodes ?? []).map((candidate) => [candidate.id, candidate])),
    [allNodes],
  );

  // Each child's emptiness, asked here from the inputs the child itself reads.
  // The duplication is deliberate. The alternative is each section reporting its
  // own count upward — components that must both render `null` and report zero,
  // and two chances each for the two answers to disagree. Asking the same
  // shared helpers the sections ask (`relationRows`, `findWhereUsed`,
  // `worstOpenFindingFor`) keeps the two readings of "empty" pinned to one
  // implementation apiece.
  //
  // `hasCovers` and `hasAcceptances` ask no question about content at all, and
  // so need no helper: their sections never render nothing. Both say something
  // about an empty list — "Unanchored (covers nothing)", "No acceptances cover
  // this view yet." — and both of those are facts about the graph rather than
  // empty states. See each one below.
  const lines = relationLinesFor(node.species);
  // The `covers` lines keep their own components — one has the intake write
  // path and its triage announcement, the other has platform chips and a
  // display preference — so they are matched out of the generic list by id
  // rather than rendered by `EdgeRelationLine`. See `node-relations.ts` for why
  // covers is not a generic edge.
  const edgeLines = lines.filter((line) => line.edgeType !== "covers");
  const coversOut = lines.find((line) => line.id === "covers:out");
  const coversIn = lines.find((line) => line.id === "covers:in");

  // A line survives when it has a row it can actually render, or when this
  // surface can write one — `RelationLine`'s rule, applied where the decision
  // to render is made.
  //
  // `nodesById.has(...)`, not just a row count: `EdgeRelationLine` drops a row
  // whose counterpart it cannot resolve and returns `null` when none survive,
  // so counting raw ids here would let an edge pointing at an absent node keep
  // a line in the list — and open the bar onto nothing, the one failure this
  // whole computation exists to prevent. Unreachable while every surface
  // passes the full node list, but the two readings of "empty" are supposed to
  // be one, and sharing the map is what makes that true rather than claimed.
  const resolvedEdgeLines =
    allNodes && allEdges
      ? edgeLines.filter(
          (line) =>
            relations ||
            relationRows(node.id, line, allEdges).some((row) => nodesById.has(row.counterpartId)),
        )
      : [];

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
  // The species test is now the grammar's: `covers:out` is a line only a
  // species that may cover something has, which today is the acceptance and
  // tomorrow is whatever `VALID_EDGE_SEMANTICS` says.
  //
  // Both lists, not just the edges: `CoversSection` resolves each `covers` edge
  // to a node to name it, so with edges in hand and nodes absent every lookup
  // would miss and the section would report "Unanchored" about an acceptance
  // that is anchored. Unreachable today — the one call site passes both — but
  // the guard should be the one the child actually needs.
  const hasCovers = Boolean(coversOut) && Boolean(allNodes && allEdges);
  // The same rule as `hasCovers`, for the same reason: `AcceptancesSection`
  // never returns null — it says "No acceptances cover this view yet." — so an
  // anchor with none still has something to show, and on a read-only surface the
  // narrower test took that line away along with, sometimes, the whole bar. An
  // anchor nothing verifies is a gap in the graph, not an absence of content.
  const hasAcceptances = Boolean(coversIn) && Boolean(allNodes && allEdges);
  // `onNavigate` as well as the nodes, matching the guard the child is actually
  // rendered behind: `InvocationSection` takes it as required, because a list of
  // flows that cannot be opened is a list of names. Without it in the flag, a
  // view whose only relation is an invocation would pass the emptiness test and
  // open a bar onto nothing — the one failure this whole computation exists to
  // prevent.
  const hasInvocation =
    isAnchor && Boolean(allNodes && onNavigate) && findWhereUsed(node.id, allNodes ?? []).length > 0;

  // A line whenever anything can be said or done about it: a value to show, or
  // a way to set one. `blockedByOf` rather than a truthiness test on the raw
  // key, because the field renders through the same helper — a stored
  // whitespace-only value is nothing to either of them, and two readings of
  // "empty" that disagree are how a bar opens onto nothing.
  const hasBlockedBy = Boolean(onUpdate) || blockedByOf(node.metadata) !== undefined;

  if (
    !hasBlockedBy &&
    !hasCovers &&
    !hasAcceptances &&
    !hasInvocation &&
    resolvedEdgeLines.length === 0 &&
    !hasRefs &&
    !hasFindings
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
      {/* First, and on every species: what holds a record up changes how the
          rest of it reads. It is also the one line here that is not an edge —
          `metadata.blocked_by`, which is why it takes `onUpdate` and not
          `relations`. */}
      {hasBlockedBy && (
        <BlockedByField
          node={node}
          onUpdate={onUpdate}
          metadataRef={metadataRef}
          allNodes={allNodes}
          onNavigate={onNavigate}
        />
      )}
      {hasCovers && allNodes && allEdges && (
        <CoversSection
          node={node}
          nodesById={nodesById}
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
          nodesById={nodesById}
          scope={scope}
          allNodes={allNodes}
          allEdges={allEdges}
          onNavigate={onNavigate}
          onCreate={onCreateAcceptanceForAnchor}
          intake={intake}
        />
      )}
      {hasInvocation && allNodes && onNavigate && (
        <InvocationSection node={node} allNodes={allNodes} onNavigate={onNavigate} />
      )}
      {/* In `relationLinesFor`'s order, which is `RELATION_LINE_ORDER`'s —
          cross-layer first, then the decision links. One component per line,
          keyed on the line id rather than the index so a line that drops out on
          a read-only surface does not hand its state to its neighbour. */}
      {allNodes &&
        allEdges &&
        resolvedEdgeLines.map((line) => (
          <EdgeRelationLine
            key={line.id}
            node={node}
            line={line}
            nodesById={nodesById}
            allNodes={allNodes}
            allEdges={allEdges}
            onNavigate={onNavigate}
            relations={relations}
          />
        ))}
      {hasRefs && <RefsSection node={node} />}
      {hasFindings && findings && onOpenCriterion && (
        <FindingsSection node={node} findings={findings} onOpenCriterion={onOpenCriterion} />
      )}
    </PanelGroup>
  );
}
