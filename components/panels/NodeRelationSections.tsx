/**
 * Every relation section of a node panel — Covers, Invocation, Decision links,
 * References, Findings and Connections — plus the row component two of them
 * share and the attach config Covers hands its relation line. (Acceptances is
 * the exception, and only because `AcceptancesSection` was already a module of
 * its own.)
 *
 * A module of their own because `RelationsGroup` renders them all and
 * `NodeDetailPanel` renders `RelationsGroup`: left where they were, those files
 * would import each other, and a cycle is not something to defend. Covers is
 * here for the same reason and not only for tidiness — it came out of
 * `AcceptanceEditor`, which `NodeDetailPanel` rendered then and which Parts 3
 * and 4 have since dismantled entirely, so an import edge from the group into
 * that file was a cycle waiting for its second half. The failure it would cause is an
 * undefined component at runtime, with nothing from the compiler.
 *
 * So the rule this module keeps: a section that `RelationsGroup` renders lives
 * here, not in the editor it was cut from.
 */

"use client";

import { useMemo } from "react";
import { toast } from "sonner";

import { PanelSection } from "@/components/panels/PanelSection";
import { RelationLine, RelationRowItem } from "@/components/panels/RelationLine";
import { EntityRow } from "@/components/graph/nodes/EntityRow";
import { RefList } from "@/components/graph/nodes/RefBadges";
import { SPECIES } from "@/lib/config/species";
import { SEVERITY_CHIP, SEVERITY_LABEL } from "@/components/quality/quality-styles";
import { EMPTY_QUALITY_FILTERS, filterFindings, type FindingRow } from "@/lib/utils/quality";
import { findWhereUsed, crossLayerConnections, coveredAnchorsOf } from "@/lib/utils/where-used";
import { attachEmptiesMembership } from "@/lib/utils/acceptance-intake";
import type { AcceptanceIntake } from "@/lib/hooks/useAcceptanceIntake";
import { cn } from "@/lib/utils";
import type { Node, Edge } from "@/lib/data/types";
import type { SpeciesId } from "@arkaik/schema";

export interface InvocationSectionProps {
  node: Node;
  allNodes: Node[];
  onNavigate: (node: Node) => void;
}

export function InvocationSection({ node, allNodes, onNavigate }: InvocationSectionProps) {
  const usages = findWhereUsed(node.id, allNodes);

  if (usages.length === 0) {
    return null;
  }

  return (
    <PanelSection title="Invocation">
      <div className="flex flex-col gap-0.5">
        {usages.map((flow) => (
          <ConnectionItem key={flow.id} node={flow} onNavigate={onNavigate} />
        ))}
      </div>
    </PanelSection>
  );
}

export function RefsSection({ node }: { node: Node }) {
  const refs = node.metadata?.refs;

  if (!refs || refs.length === 0) {
    return null;
  }

  return (
    <PanelSection title="References">
      <RefList refs={refs} />
    </PanelSection>
  );
}

export interface FindingsSectionProps {
  node: Node;
  findings: FindingRow[];
  onOpenCriterion: (criterionId: string, surface: string) => void;
}

/**
 * The audit's open findings against this node, worst first.
 *
 * Open only, matching the canvas badge exactly: both ask `row.open`, so a node
 * wearing a red "3" opens onto three rows and never onto a resolved fourth the
 * reader has to work out is history.
 *
 * The order is `filterFindings`' own — the board's comparator, run with the
 * filter set that narrows nothing. A `sort` written here would be a second
 * opinion on which finding is worse than which, and the two lists would read
 * differently the day a pack moved a bucket.
 */
export function FindingsSection({ node, findings, onOpenCriterion }: FindingsSectionProps) {
  const own = filterFindings(
    findings.filter((row) => row.open && row.nodeIds.includes(node.id)),
    EMPTY_QUALITY_FILTERS,
  );

  if (own.length === 0) {
    return null;
  }

  return (
    <PanelSection title="Findings">
      <div className="flex flex-col gap-0.5">
        {own.map((row) => (
          // Into the criterion, not into the finding: a finding has no panel of
          // its own, and the criterion is where its question, its bands and its
          // siblings on the same surface live.
          <button
            key={row.id}
            type="button"
            onClick={() => onOpenCriterion(row.criterionId, row.surface)}
            className="flex items-center gap-2 text-sm text-left rounded-md px-2 py-1.5 hover:bg-muted transition-colors w-full"
            title={`Open ${row.criterionName}`}
          >
            <span
              className={cn(
                "shrink-0 rounded border px-1.5 py-0.5 text-[11px] font-medium",
                SEVERITY_CHIP[row.severity],
              )}
            >
              {SEVERITY_LABEL[row.severity]}
            </span>
            <span className="flex-1 truncate">{row.title}</span>
            <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">
              {row.criterionId}
            </span>
          </button>
        ))}
      </div>
    </PanelSection>
  );
}

export interface ConnectionsSectionProps {
  node: Node;
  allNodes: Node[];
  allEdges: Edge[];
  onNavigate: (node: Node) => void;
}

export function ConnectionsSection({ node, allNodes, allEdges, onNavigate }: ConnectionsSectionProps) {
  // `crossLayerConnections` rather than the walk this section used to carry:
  // `RelationsGroup` has to ask whether there are any rows here to decide
  // whether its bar exists at all, and a second copy of the walk is a second
  // chance to disagree. The exclusions and the reason for each are in its
  // docblock, where the code now lives.
  const uniqueCrossLayerNodes = crossLayerConnections(node, allNodes, allEdges);

  if (uniqueCrossLayerNodes.length === 0) {
    return null;
  }

  return (
    <PanelSection title="Connections">
      <div className="flex flex-col gap-0.5">
        {uniqueCrossLayerNodes.map((n) => (
          <ConnectionItem key={n.id} node={n} onNavigate={onNavigate} />
        ))}
      </div>
    </PanelSection>
  );
}

/**
 * One cross-reference row: the entity chip, then the title, then what kind of
 * thing it is.
 *
 * The two-control shape — chip, then a button over the rest — belongs to
 * `EntityRow`; see there for why it cannot be one button.
 *
 * The leading gutter used to hold a `badge` string — the flow's id from
 * Invocation, the species label from Connections, which the trailing span was
 * already saying. The chip replaces both: the id it carried is now in the hover
 * card and one click from the clipboard, and the duplicated label is gone.
 */
function ConnectionItem({
  node,
  onNavigate,
}: {
  node: Node;
  onNavigate: (node: Node) => void;
}) {
  const speciesConfig = SPECIES.find((s) => s.id === node.species);
  return (
    <EntityRow node={node} onOpen={() => onNavigate(node)}>
      <span className="min-w-0 flex-1 truncate">{node.title}</span>
      <span className="shrink-0 text-xs text-muted-foreground">
        {speciesConfig?.label ?? node.species}
      </span>
    </EntityRow>
  );
}

/**
 * The decision → node lists the three edge types define (spec §5).
 *
 * Exported so `RelationsGroup` can ask whether this section has any rows
 * without a second *implementation* of the walk — the same arrangement
 * `crossLayerConnections` has with `ConnectionsSection`, and for the same
 * reason: two implementations are two chances for the bar and the section to
 * disagree about whether there is anything here. The bar and the section do
 * each call this on the same render, which is a walk run twice over a handful
 * of edges; what must not be duplicated is the definition. Passing the rows
 * down instead would reunite the two at the cost of the flag, which is the
 * disagreement `hasDecisionLinkRows` exists to prevent.
 */
export function decisionConnections(node: Node, allNodes: Node[], allEdges: Edge[]) {
  const byId = new Map(allNodes.map((n) => [n.id, n]));
  const resolve = (ids: string[]) => ids.map((id) => byId.get(id)).filter((n): n is Node => !!n);
  return {
    supersedes: resolve(
      allEdges.filter((e) => e.edge_type === "supersedes" && e.source_id === node.id).map((e) => e.target_id),
    ),
    supersededBy: resolve(
      allEdges.filter((e) => e.edge_type === "supersedes" && e.target_id === node.id).map((e) => e.source_id),
    ),
    generates: resolve(
      allEdges.filter((e) => e.edge_type === "generates" && e.source_id === node.id).map((e) => e.target_id),
    ),
    impacts: resolve(
      allEdges.filter((e) => e.edge_type === "impacts" && e.source_id === node.id).map((e) => e.target_id),
    ),
  };
}

/** Whether any of the four lists has a row — the emptiness test this section and
 *  `RelationsGroup`'s `hasDecisionLinks` flag both run. */
export function hasDecisionLinkRows(links: ReturnType<typeof decisionConnections>) {
  return (
    links.supersedes.length > 0 ||
    links.supersededBy.length > 0 ||
    links.generates.length > 0 ||
    links.impacts.length > 0
  );
}

function LinkedNodeList({
  label,
  nodes,
  onNavigate,
}: {
  label: string;
  nodes: Node[];
  onNavigate?: (node: Node) => void;
}) {
  if (nodes.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex flex-col gap-0.5">
        {/* The id is the chip, not a truncated 96px gutter of monospace text —
            see `EntityChip`. The chip is there whether or not the row navigates:
            copying an id is useful on a read-only panel too, and the hover card
            is the only place the full id and title are still readable. */}
        {nodes.map((n) => (
          <EntityRow key={n.id} node={n} onOpen={onNavigate && (() => onNavigate(n))}>
            <span className="min-w-0 flex-1 truncate">{n.title}</span>
          </EntityRow>
        ))}
      </div>
    </div>
  );
}

export interface DecisionLinksSectionProps {
  node: Node;
  allNodes: Node[];
  allEdges: Edge[];
  onNavigate?: (node: Node) => void;
}

/**
 * What this decision supersedes, is superseded by, generates and impacts —
 * spec §5's four link lists.
 *
 * Lifted out of `DecisionEditor` for the reason Covers was lifted out of
 * `AcceptanceEditor`: these are relations, not fields. They say what this record
 * points at, which is what References, Findings and Connections say too, and the
 * spec's per-species table puts them first among a decision's relations. Left in
 * the editor they were the one species' cross-references filed among its
 * controls; left in that *file* they would have been an import edge from
 * `RelationsGroup` into a panel-body editor, which is the cycle this module
 * exists to break.
 *
 * A `PanelSection` rather than the `Field` it was: inside a group this is a
 * level-four section with a heading, not a labelled control, and there is no
 * single control for a label to point at anyway. `gap-3` is the spacing the four
 * lists were already given.
 *
 * Returns `null` when all four are empty, exactly as the `Field` did behind its
 * condition — there is no sentence to say about a decision that links to
 * nothing, so an empty heading here would be an empty state rather than a fact
 * about the graph.
 */
export function DecisionLinksSection({ node, allNodes, allEdges, onNavigate }: DecisionLinksSectionProps) {
  const connections = decisionConnections(node, allNodes, allEdges);

  if (!hasDecisionLinkRows(connections)) {
    return null;
  }

  return (
    <PanelSection title="Decision links" className="gap-3">
      <LinkedNodeList label="Supersedes" nodes={connections.supersedes} onNavigate={onNavigate} />
      <LinkedNodeList label="Superseded by" nodes={connections.supersededBy} onNavigate={onNavigate} />
      <LinkedNodeList label="Generated acceptances" nodes={connections.generates} onNavigate={onNavigate} />
      <LinkedNodeList label="Impacts" nodes={connections.impacts} onNavigate={onNavigate} />
    </PanelSection>
  );
}

interface CoversSectionProps {
  node: Node;
  allNodes: Node[];
  allEdges: Edge[];
  /**
   * Whether the project declares any product at all — the one thing this
   * section ever asked the whole `ProductScope` for, passed through to
   * the attach combobox's triage warning. A boolean rather than the scope,
   * because a component that takes a scope reads as one that shows products,
   * and this one does not.
   */
  hasProducts: boolean;
  onNavigate?: (node: Node) => void;
  intake?: AcceptanceIntake;
}

/**
 * The views and flows this acceptance covers — and, where the surface can
 * write, the gestures that change that list.
 *
 * Lifted out of `AcceptanceEditor` because it is a relation, not a field: it
 * says what this record points at, which is what References, Findings and
 * Connections say too, and it belongs beside them — in the Relations group, and
 * so in this module. Leaving it in the editor would have made the acceptance the
 * one species whose covers list sat apart from the rest of its
 * cross-references — under "Per-platform status", of all things. Leaving it in
 * that *file* would have been the same mistake at a remove: `RelationsGroup`
 * importing from an editor that no longer renders it is the import edge this
 * module exists to break.
 *
 * A `RelationLine` rather than the `Field` it was: inside a group this is a
 * level-four section with a heading, not a labelled control, and there is no
 * single control for a label to point at anyway. The line supplies the rest —
 * the `+` that reveals the search, and the rule that an empty writable relation
 * costs one line.
 */
export function CoversSection({ node, allNodes, allEdges, hasProducts, onNavigate, intake }: CoversSectionProps) {
  const nodesById = useMemo(() => new Map(allNodes.map((n) => [n.id, n])), [allNodes]);
  // `coveredAnchorsOf`, not a walk of its own: `AcceptanceMembershipField` asks
  // the same question for its Product hint's anchor count, and the two answers have to be
  // the same list or the hint counts anchors this section does not show. The
  // map stays because the attach config resolves the id the combobox returns.
  const coveredAnchors = useMemo(
    () => coveredAnchorsOf(node, allNodes, allEdges),
    [node, allNodes, allEdges],
  );
  // Memoised because it is a dependency of the combobox's candidate memo, and
  // that memo fuzzy-scores every node in the project. A fresh array here would
  // miss it on every render — which is exactly what hoisting `ANCHOR_SPECIES`
  // out of the render was meant to prevent, cancelled one prop over.
  const excludeIds = useMemo(() => coveredAnchors.map((anchor) => anchor.id), [coveredAnchors]);

  /**
   * Run one intake gesture, reporting a failure instead of swallowing it.
   *
   * Every one of them is a write to a store the panel does not own, and a
   * rejected batch otherwise leaves the list looking unchanged with nothing
   * saying why — the same treatment `AcceptancesSection` gives its create.
   *
   * It answers whether the write landed, not just whether it complained: the
   * relation line closes on success and stays open on failure, and a toast
   * over a line that shut and dropped the typed query is a worse account of
   * what happened than no toast at all.
   */
  async function run(action: () => Promise<void>, failure: string): Promise<boolean> {
    try {
      await action();
      return true;
    } catch (err) {
      toast.error(failure);
      console.error(err);
      return false;
    }
  }

  return (
    <RelationLine
      label="Covers"
      add={
        intake &&
        attachAnchorConfig({
          node,
          allNodes,
          allEdges,
          nodesById,
          hasProducts,
          intake,
          run,
          excludeIds,
        })
      }
    >
      {coveredAnchors.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {intake
            ? "Unanchored — an idea in intake. Attach it to a view or a flow above."
            : "Unanchored (covers nothing)."}
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {coveredAnchors.map((anchor) => (
            <RelationRowItem
              key={anchor.id}
              node={anchor}
              onNavigate={onNavigate}
              onRemove={
                intake &&
                (() => void run(() => intake.detach(node, anchor.id), "Couldn't detach that node."))
              }
              removeLabel={`Stop covering ${anchor.title}`}
            />
          ))}
        </ul>
      )}
    </RelationLine>
  );
}

/**
 * The species a `covers` edge may anchor to, as a module constant.
 *
 * Not an inline `["view", "flow"]`: the combobox memoises its candidate list on
 * this array's identity, and a fresh array on every render would make that
 * memo dead weight.
 */
const ANCHOR_SPECIES: readonly SpeciesId[] = ["view", "flow"];

interface AttachAnchorConfigArgs {
  node: Node;
  allNodes: Node[];
  allEdges: Edge[];
  nodesById: Map<string, Node>;
  /**
   * Whether the project declares any product at all. The triage warning below
   * is gated on it rather than on the membership computation alone: a project
   * that has never heard of products can still carry a stray `metadata.product`
   * from an import, and a toast naming "All products" there would introduce a
   * word the whole feature promises such a project never sees.
   */
  hasProducts: boolean;
  intake: AcceptanceIntake;
  /** Runs one write, reporting `false` when it failed. */
  run: (action: () => Promise<void>, failure: string) => Promise<boolean>;
  /**
   * The ids of the anchors already covered — what the list must not offer
   * again. Memoised by the caller; see the note where it is built.
   */
  excludeIds: readonly string[];
}

/**
 * Attach this acceptance to a view or a flow — one that exists, or one created
 * in the same gesture. Not a component: the `add` config its relation line
 * takes, because the `+` on the line now owns when the search appears.
 *
 * One `NodeSearchCombobox` over both anchor species, with no select in front of
 * it. It keeps the rule the insert dialog states for "an existing node, or a new
 * one by that name" — the create row appears only once something is typed that
 * no node of an admissible species already answers to — but asks for one
 * decision instead of two, since the search result already says which species
 * was picked. The playlist editor's Add step popover reached that conclusion
 * first, for a list that plays both; Covers has now joined it.
 *
 * **Attaching an unassigned anchor is allowed and announced.** An acceptance
 * anchored only to unassigned views derives an empty membership, so this gesture
 * can move an idea filed under one app back into the "All products" inbox
 * (§ Decision 5, the interaction the spec left open). Blocking it would be
 * wrong — the anchor is the truth and triage is the honest place for an
 * acceptance whose anchors are themselves in triage — but letting it happen in
 * silence means watching the acceptance vanish from the scope you were standing
 * in. So it is written, and then said. A node created here inherits the
 * acceptance's product precisely so the common path never trips this.
 */
function attachAnchorConfig({
  node,
  allNodes,
  allEdges,
  nodesById,
  hasProducts,
  intake,
  run,
  excludeIds,
}: AttachAnchorConfigArgs) {
  function announceTriage(anchor: Pick<Node, "id" | "species" | "title" | "metadata">) {
    if (!hasProducts) return;
    // Evaluated against the edges as they were BEFORE the write — the predicate
    // asks what this attach did, and the answer needs the graph it acted on.
    if (!attachEmptiesMembership(node, anchor, allEdges, nodesById)) return;
    toast.warning(`"${anchor.title}" has no product, so this acceptance now appears under All products only.`);
  }

  return {
    counterpartSpecies: ANCHOR_SPECIES,
    allNodes,
    excludeIds,
    onSelect: (anchorId: string) => {
      const anchor = nodesById.get(anchorId);
      // Nothing to attach to, so nothing happened: `false` keeps the line open
      // rather than closing it over a gesture that did not land.
      if (!anchor) return false;
      void run(async () => {
        await intake.attach(node, anchor);
        announceTriage(anchor);
      }, "Couldn't attach that node.");
    },
    onCreate: (species: SpeciesId, title: string) =>
      run(async () => {
        // `intake.createAnchor` takes the narrow anchor species; the grammar
        // admits nothing else on this line, so the cast is the type system
        // catching up with `ANCHOR_SPECIES` above.
        const created = await intake.createAnchor(node, species as "view" | "flow", title);
        if (created) toast.success(`Created "${created.title}" and attached it.`);
      }, `Couldn't create the ${species}.`),
  };
}
