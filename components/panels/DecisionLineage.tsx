"use client";

import type { Node } from "@/lib/data/types";
import type { DecisionLineageEntry, DecisionPanelModel } from "@/lib/utils/decision-panel";
import { PanelGroup } from "@/components/panels/PanelGroup";
import { PANEL_GUTTER } from "@/components/panels/PanelSection";
import { StatusSeal, plural } from "@/components/decisions/DecisionMarks";

const RELATION_WORD: Record<DecisionLineageEntry["relation"], string> = {
  successor: "Replaced it",
  self: "This decision",
  predecessor: "It replaced",
};

/**
 * A decision's replacement line, as a group above Relations: every decision
 * that replaced it (newest first), itself lifted out, then every decision it
 * replaced — each with its status, its date, and how many steps away it is.
 *
 * The Relations group below still holds the Supersedes / Superseded by lines,
 * because that is where the links are edited; this is the line read whole,
 * which those two one-hop lines cannot show. Drawn only when there is a line
 * (more than the decision itself).
 */
export function DecisionLineage({
  model,
  onNavigate,
}: {
  /** The committed record's model: its line, and whether it is replaced yet still on the road. */
  model: DecisionPanelModel;
  /** Opens a decision on the line. Absent where the surface cannot navigate: the titles are then text. */
  onNavigate?: (node: Node) => void;
}) {
  const { lineage } = model;
  return (
    <PanelGroup title="Lineage" meta={<span className="dc-group-meta">{plural(lineage.length, "decision")}</span>}>
      <div className={PANEL_GUTTER}>
        <ol className="dc-lineage" aria-label="Replacement line, newest first">
          {lineage.map((entry) => {
            const title = entry.node.title || entry.node.id;
            return (
              <li key={entry.node.id} className="dc-lineage-item" data-relation={entry.relation} data-dc-status={entry.status}>
                <StatusSeal status={entry.status} size={entry.relation === "self" ? "m" : "s"} />
                <span className="dc-lineage-body">
                  <span className="dc-lineage-kicker">
                    {RELATION_WORD[entry.relation]}
                    {entry.depth > 1 && <> · {entry.depth} steps away</>}
                  </span>
                  {entry.relation === "self" || !onNavigate ? (
                    <span className="dc-lineage-title">{title}</span>
                  ) : (
                    <button type="button" className="dc-lineage-title" onClick={() => onNavigate(entry.node)}>
                      {title}
                    </button>
                  )}
                  <span className="dc-lineage-meta">
                    {entry.statusLabel}
                    {entry.dateLabel && <> · {entry.dateLabel}</>}
                    {entry.relation === "self" && model.replacedButNotSuperseded && (
                      <span className="dc-lineage-flag"> · replaced, yet still {entry.statusLabel.toLowerCase()}</span>
                    )}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </PanelGroup>
  );
}
