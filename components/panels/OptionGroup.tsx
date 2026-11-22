"use client";

import { useId } from "react";
import {
  OPTION_LIFECYCLE_STATUSES,
  acceptancesAddressing,
  answerTypesOf,
  isCandidate,
  isPromise,
  optionClosureFor,
  optionSuggestedByOf,
  stakesAddressedBy,
  type OptionClosure,
} from "@arkaik/schema";

import { StatusSelectItems } from "@/components/layout/StatusSelectItems";
import { PanelGroup } from "@/components/panels/PanelGroup";
import { PanelSection } from "@/components/panels/PanelSection";
import { Select, SelectContent, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ANSWER_TYPE_LABELS } from "@/lib/config/answer-types";
import type { StatusId } from "@/lib/config/statuses";
import type { Edge, Node } from "@/lib/data/types";

type OnUpdate = (id: string, patch: Partial<Omit<Node, "id" | "project_id">>) => Promise<void> | void;

interface OptionGroupProps {
  node: Node;
  allNodes?: Node[];
  allEdges?: Edge[];
  /** Absent on a read-only surface (the Changelog): the group then shows facts and offers nothing. */
  onUpdate?: OnUpdate;
}

/** One line for where an option stands on a stake, read from the stake's decision. */
function closureText(closure: OptionClosure): string {
  if (closure.state === "selected") return "Selected";
  if (closure.state === "closed") return closure.reason ? `Closed: ${closure.reason}` : "Closed";
  return "Open";
}

/**
 * An option's own facts: the answer type it gives (read from the kind of stake
 * it addresses, never stored), where it stands on each stake it addresses
 * (selected, closed with the reason, or open, all read from the stake's decision),
 * the acceptances that address it and whether each reads as a promise or still a
 * candidate, the request it was suggested by (read only), and where it stands in
 * its stored lifecycle (idea, discovery, archived; whether it was selected or
 * closed is read from its decision, never typed in). The stake it addresses is
 * not listed as a relation here: it is the `addresses` line of the Relations
 * group.
 */
export function OptionGroup({ node, allNodes, allEdges, onUpdate }: OptionGroupProps) {
  const fieldId = useId();
  const readOnly = !onUpdate;
  const types = allNodes && allEdges ? answerTypesOf(node.id, allNodes, allEdges) : [];
  const addressed = allNodes && allEdges ? stakesAddressedBy(node.id, allNodes, allEdges) : [];
  const suggestedBy = optionSuggestedByOf(node);
  const acceptances = allNodes && allEdges ? acceptancesAddressing(node.id, allNodes, allEdges) : [];
  const lifecycle = OPTION_LIFECYCLE_STATUSES as readonly StatusId[];
  // A hand-edited status outside the stored lifecycle stays visible so the
  // select can show it; the validator is what says it is wrong.
  const statusOptions = lifecycle.includes(node.status) ? lifecycle : [...lifecycle, node.status];

  return (
    <PanelGroup
      title="Option"
      meta={types.length > 0 ? <span>{types.map((type) => ANSWER_TYPE_LABELS[type]).join(", ")}</span> : undefined}
    >
      <PanelSection title="Answer">
        <p className="text-sm" data-option-answer="">
          {types.length > 0 ? types.map((type) => ANSWER_TYPE_LABELS[type]).join(", ") : "Not set"}
        </p>
        <p className="text-xs text-muted-foreground">
          {addressed.length === 0
            ? "An option answers a stake: link it to one from Relations."
            : types.length === 0
              ? "The stake it addresses has no kind yet, so the answer cannot be read."
              : types.length > 1
                ? "This option addresses stakes that ask for different answers. Split it into one option per answer."
                : "Read from the kind of stake it addresses, never stored here."}
        </p>
      </PanelSection>

      {addressed.length > 0 && allNodes && allEdges && (
        <PanelSection title="Closure">
          <ul className="space-y-1" data-option-closure="">
            {addressed.map((stake) => {
              const closure = optionClosureFor(node.id, stake.id, allNodes, allEdges);
              return (
                <li key={stake.id} className="text-sm" data-option-closure-state={closure.state}>
                  <span className="font-medium">{closureText(closure)}</span>
                  <span className="text-muted-foreground"> on {stake.title}</span>
                  {closure.competing.length > 0 && (
                    <span className="block text-xs text-muted-foreground">
                      More than one decision settles this stake. Showing the latest.
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-muted-foreground">Read from the decision on each stake, never stored here.</p>
        </PanelSection>
      )}

      {acceptances.length > 0 && allNodes && allEdges && (
        <PanelSection title="Acceptances">
          <ul className="space-y-1" data-option-acceptances="">
            {acceptances.map((acceptance) => (
              <li key={acceptance.id} className="text-sm">
                <span>{acceptance.title}</span>
                <span className="text-muted-foreground">
                  {" "}
                  {isPromise(acceptance, allNodes, allEdges)
                    ? "Promise"
                    : isCandidate(acceptance, allNodes, allEdges)
                      ? "Candidate"
                      : acceptance.status}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            A promise is one a decision chose, or one already live. A candidate is an idea nobody has chosen yet.
          </p>
        </PanelSection>
      )}

      {suggestedBy && (
        <PanelSection title="Suggested by">
          <p className="break-all font-mono text-xs" data-option-suggested-by="">
            {suggestedBy}
          </p>
          <p className="text-xs text-muted-foreground">The request that seeded this option.</p>
        </PanelSection>
      )}

      <PanelSection title="Lifecycle">
        {readOnly ? (
          <p className="text-sm">{node.status}</p>
        ) : (
          <Select value={node.status} onValueChange={(value) => void onUpdate?.(node.id, { status: value as StatusId })}>
            <SelectTrigger id={`${fieldId}-status`} aria-label="Option lifecycle">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <StatusSelectItems only={statusOptions} />
            </SelectContent>
          </Select>
        )}
        <p className="text-xs text-muted-foreground">
          Stored: idea, discovery or archived. Selected and closed are read from the decision, never typed in.
        </p>
      </PanelSection>
    </PanelGroup>
  );
}
