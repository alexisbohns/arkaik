"use client";

import { PanelSection } from "@/components/panels/PanelSection";
import { EntityRow } from "@/components/graph/nodes/EntityRow";
import { RefList } from "@/components/graph/nodes/RefBadges";
import { SPECIES } from "@/lib/config/species";
import { SEVERITY_CHIP, SEVERITY_LABEL } from "@/components/quality/quality-styles";
import { EMPTY_QUALITY_FILTERS, filterFindings, type FindingRow } from "@/lib/utils/quality";
import { findWhereUsed, crossLayerConnections } from "@/lib/utils/where-used";
import { cn } from "@/lib/utils";
import type { Node, Edge } from "@/lib/data/types";

/**
 * The four cross-reference sections of a node panel — Invocation, References,
 * Findings and Connections — and the row component the first and the last share.
 *
 * A module of their own only because `RelationsGroup` renders them and
 * `NodeDetailPanel` renders `RelationsGroup`: left where they were, the two
 * files would import each other, and a cycle is not something to defend.
 */

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
