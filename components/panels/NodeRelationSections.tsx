/**
 * Every relation section of a node panel — Covers, Invocation, Decision links,
 * References, Findings and Connections — plus the row component two of them
 * share and the attach row Covers owns. (Acceptances is the exception, and only because
 * `AcceptancesSection` was already a module of its own.)
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

import { useState } from "react";
import { XIcon } from "lucide-react";
import { toast } from "sonner";

import { PanelSection } from "@/components/panels/PanelSection";
import { EntityRow } from "@/components/graph/nodes/EntityRow";
import { RefList } from "@/components/graph/nodes/RefBadges";
import { NodeSearchCombobox } from "@/components/panels/NodeSearchCombobox";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SPECIES } from "@/lib/config/species";
import { SPECIES_ICONS } from "@/components/graph/nodes/node-styles";
import { SEVERITY_CHIP, SEVERITY_LABEL } from "@/components/quality/quality-styles";
import { EMPTY_QUALITY_FILTERS, filterFindings, type FindingRow } from "@/lib/utils/quality";
import { findWhereUsed, crossLayerConnections, coveredAnchorsOf } from "@/lib/utils/where-used";
import { attachEmptiesMembership } from "@/lib/utils/acceptance-intake";
import type { AcceptanceIntake } from "@/lib/hooks/useAcceptanceIntake";
import { cn } from "@/lib/utils";
import type { Node, Edge } from "@/lib/data/types";

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
 * without walking the edges a second time — the same arrangement
 * `crossLayerConnections` has with `ConnectionsSection`, and for the same
 * reason: two walks are two chances for the bar and the section to disagree
 * about whether there is anything here.
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
   * `AttachAnchorRow`'s triage warning. A boolean rather than the scope,
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
 * A `PanelSection` rather than the `Field` it was: inside a group this is a
 * level-four section with a heading, not a labelled control, and there is no
 * single control for a label to point at anyway.
 */
export function CoversSection({ node, allNodes, allEdges, hasProducts, onNavigate, intake }: CoversSectionProps) {
  const nodesById = new Map(allNodes.map((n) => [n.id, n]));
  // `coveredAnchorsOf`, not a walk of its own: `AcceptanceMembershipField` asks
  // the same question for its Product hint's anchor count, and the two answers have to be
  // the same list or the hint counts anchors this section does not show. The
  // map stays because `AttachAnchorRow` resolves the id a combobox returns.
  const coveredAnchors = coveredAnchorsOf(node, allNodes, allEdges);

  /**
   * Run one intake gesture, reporting a failure instead of swallowing it.
   *
   * Every one of them is a write to a store the panel does not own, and a
   * rejected batch otherwise leaves the list looking unchanged with nothing
   * saying why — the same treatment `AcceptancesSection` gives its create.
   */
  async function run(action: () => Promise<void>, failure: string) {
    try {
      await action();
    } catch (err) {
      toast.error(failure);
      console.error(err);
    }
  }

  return (
    <PanelSection title="Covers">
      {coveredAnchors.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {intake
            ? "Unanchored — an idea in intake. Attach it to a view or a flow below."
            : "Unanchored (covers nothing)."}
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {coveredAnchors.map((anchor) => {
            const Icon = SPECIES_ICONS[anchor.species];
            return (
              <li key={anchor.id} className="flex items-center gap-1">
                <button type="button" className="inline-flex flex-1 items-center gap-2 text-left text-sm hover:underline" onClick={() => onNavigate?.(anchor)}>
                  <Icon className="size-3.5 text-muted-foreground" /> {anchor.title}
                </button>
                {intake && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0"
                    aria-label={`Stop covering ${anchor.title}`}
                    onClick={() => void run(() => intake.detach(node, anchor.id), "Couldn't detach that node.")}
                  >
                    <XIcon className="size-3.5" />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {intake && (
        <AttachAnchorRow
          node={node}
          allNodes={allNodes}
          allEdges={allEdges}
          nodesById={nodesById}
          hasProducts={hasProducts}
          intake={intake}
          run={run}
        />
      )}
    </PanelSection>
  );
}

interface AttachAnchorRowProps {
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
  run: (action: () => Promise<void>, failure: string) => Promise<void>;
}

/**
 * Attach this acceptance to a view or a flow — one that exists, or one created
 * in the same gesture.
 *
 * The species select plus `NodeSearchCombobox` is the shape the playlist editor
 * and the insert dialog already use for "an existing node, or a new one by that
 * name", and reusing it means the create affordance appears under exactly the
 * same rule everywhere: only once something is typed that no node of that
 * species already answers to.
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
function AttachAnchorRow({ node, allNodes, allEdges, nodesById, hasProducts, intake, run }: AttachAnchorRowProps) {
  const [species, setSpecies] = useState<"view" | "flow">("view");

  function announceTriage(anchor: Pick<Node, "id" | "species" | "title" | "metadata">) {
    if (!hasProducts) return;
    // Evaluated against the edges as they were BEFORE the write — the predicate
    // asks what this attach did, and the answer needs the graph it acted on.
    if (!attachEmptiesMembership(node, anchor, allEdges, nodesById)) return;
    toast.warning(`"${anchor.title}" has no product, so this acceptance now appears under All products only.`);
  }

  return (
    <div className="mt-1 grid gap-2 sm:grid-cols-[7rem_1fr] sm:items-center">
      <Select value={species} onValueChange={(value) => setSpecies(value as "view" | "flow")}>
        <SelectTrigger aria-label="Anchor species">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="view">View</SelectItem>
          <SelectItem value="flow">Flow</SelectItem>
        </SelectContent>
      </Select>
      <NodeSearchCombobox
        species={species}
        allNodes={allNodes}
        onSelect={(anchorId) => {
          const anchor = nodesById.get(anchorId);
          if (!anchor) return;
          void run(async () => {
            await intake.attach(node, anchor);
            announceTriage(anchor);
          }, "Couldn't attach that node.");
        }}
        onCreate={(title) =>
          run(async () => {
            const created = await intake.createAnchor(node, species, title);
            if (created) toast.success(`Created "${created.title}" and attached it.`);
          }, `Couldn't create the ${species}.`)
        }
      />
    </div>
  );
}
