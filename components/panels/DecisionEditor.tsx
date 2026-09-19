"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { StatusSelectItems } from "@/components/layout/StatusSelectItems";
import { PANEL_GUTTER } from "@/components/panels/PanelSection";
import { cn } from "@/lib/utils";
import type { Node, NodeMetadata } from "@/lib/data/types";
import { type DecisionStatusId } from "@/lib/config/decision-statuses";
import { decisionStatusOf, decisionUpdatePatch } from "@/lib/utils/decision";

const AUTOSAVE_DELAY_MS = 350;

interface DecisionEditorProps {
  node: Node;
  onUpdate: (id: string, patch: Partial<Omit<Node, "id" | "project_id">>) => Promise<void> | void;
  /**
   * The panel's shared latest-metadata write base — see `NodeDetailPanel`,
   * which owns it.
   *
   * This editor owned it until Blocked by became a relation line: that line is
   * rendered by `RelationsGroup`, a sibling of this component rather than a
   * child of it, so the base had to rise to the one component that renders
   * both. All four writers below still read and write it exactly as before.
   */
  metadataRef: React.MutableRefObject<NodeMetadata | undefined>;
}

/**
 * One debounced metadata text field (context / consequences / decided_at).
 *
 * Mirrors `NodeFields`' title/description autosave: compare against a
 * last-saved ref rather than the prop directly, so a concurrent edit to a
 * DIFFERENT field (which also patches `metadata` wholesale) never fires a
 * duplicate save and never clobbers this one's pending save — the reschedule
 * on every keystroke is itself load-bearing, not incidental.
 *
 * Spreads `metadataRef.current` — the panel's shared latest-metadata base —
 * rather than `node.metadata` directly. See that ref's own comment in
 * `NodeDetailPanel` for why: `onUpdate` is not optimistic, so `node.metadata`
 * can still be stale while a sibling's save is in flight.
 */
function useDebouncedMetadataField(
  node: Node,
  key: "context" | "consequences" | "decided_at",
  metadataRef: React.MutableRefObject<NodeMetadata | undefined>,
  onUpdate: DecisionEditorProps["onUpdate"],
) {
  const stored = typeof node.metadata?.[key] === "string" ? (node.metadata?.[key] as string) : "";
  const [value, setValue] = useState(stored);
  const lastSavedRef = useRef(stored.trim());

  useEffect(() => {
    const trimmed = value.trim();
    if (trimmed === lastSavedRef.current) return;
    const timeout = setTimeout(() => {
      lastSavedRef.current = trimmed;
      const next: NodeMetadata = { ...(metadataRef.current ?? {}) };
      if (trimmed === "") delete next[key];
      else next[key] = trimmed;
      metadataRef.current = next;
      void onUpdate(node.id, { metadata: next });
    }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timeout);
  }, [value, key, node.id, metadataRef, onUpdate]);

  return [value, setValue] as const;
}

/**
 * The decision species' editor section: decision status (via the synced
 * `decisionUpdatePatch`, never a bare metadata write — see `lib/utils/decision.ts`),
 * and context/consequences/decided-on as debounced metadata fields.
 *
 * The supersedes/generates/impacts links spec §5 defines are no longer here:
 * they are relations, not fields, so they render in the Relations group — as
 * four of the grammar-derived relation lines `relationLinesFor("decision")`
 * produces, not as a list this species has written out for it. Blocked by went
 * the same way — it was a field here, under "Context — why", and is now the
 * Relations group's first line on every species alike.
 *
 * What is left reads nothing but its own node: no `allNodes`, no `allEdges`,
 * no `onNavigate`. The edges went when the links did; the node list and the
 * navigate callback were the blocker's, and went with it.
 */
export function DecisionEditor({ node, onUpdate, metadataRef }: DecisionEditorProps) {
  // Per-mount: the panel stack keeps hidden panels mounted, so two decisions can
  // be open at once and a hand-written id would give both their labels the same
  // target.
  const fieldId = useId();
  // Set-then-save, like NodeFields' status select: onUpdate is not optimistic
  // (it awaits the provider before node.status/node.metadata reflect a write),
  // so a value read straight from `decisionStatusOf(node)` would revert to the
  // pre-change status for the round-trip's duration. Local state is the
  // optimistic display; remounting by key (`decision-${node.id}`) is still
  // what resets it when the panel switches to a different decision.
  const [decisionStatus, setDecisionStatus] = useState<DecisionStatusId>(decisionStatusOf(node));

  const [context, setContext] = useDebouncedMetadataField(node, "context", metadataRef, onUpdate);
  const [consequences, setConsequences] = useDebouncedMetadataField(node, "consequences", metadataRef, onUpdate);
  const [decidedAt, setDecidedAt] = useDebouncedMetadataField(node, "decided_at", metadataRef, onUpdate);

  // One write path for a transition: decisionUpdatePatch bundles the metadata
  // write with the lifecycle sync so diffNodeUpdate derives both events. Its
  // metadata base is the shared ref (not `node.metadata`) for the same reason
  // the text fields use it — a status change during a pending text save must
  // not clobber it, and vice versa.
  function handleStatusChange(value: DecisionStatusId) {
    setDecisionStatus(value);
    const patch = decisionUpdatePatch({ metadata: metadataRef.current }, value);
    metadataRef.current = patch.metadata;
    void onUpdate(node.id, patch);
  }

  return (
    <div className={cn(PANEL_GUTTER, "flex flex-col gap-5")}>
      {/* Where a decision *stands* and *when* it was taken, on one row at the
          top. They are the two facts a reader scans a decision for, they are
          both one control wide, and stacking them pushed "Decided on" below two
          four-row textareas — past the fold on a narrow panel. Two columns even
          on mobile: a select and a date input both hold their own at half a
          panel's width, and splitting them apart at a breakpoint would undo the
          pairing that is the point. */}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Decision status" htmlFor={`${fieldId}-status`}>
          <Select value={decisionStatus} onValueChange={(v) => handleStatusChange(v as DecisionStatusId)}>
            <SelectTrigger id={`${fieldId}-status`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <StatusSelectItems vocabulary="decision-status" />
            </SelectContent>
          </Select>
        </Field>
        <Field label="Decided on" htmlFor={`${fieldId}-decided-at`}>
          <Input
            id={`${fieldId}-decided-at`}
            type="date"
            value={decidedAt}
            onChange={(e) => setDecidedAt(e.target.value)}
          />
        </Field>
      </div>
      <Field label="Context — why" htmlFor={`${fieldId}-context`}>
        <Textarea
          id={`${fieldId}-context`}
          value={context}
          onChange={(e) => setContext(e.target.value)}
          placeholder="What made this decision necessary?"
          rows={4}
        />
      </Field>
      <Field label="Consequences — how" htmlFor={`${fieldId}-consequences`}>
        <Textarea
          id={`${fieldId}-consequences`}
          value={consequences}
          onChange={(e) => setConsequences(e.target.value)}
          placeholder="What follows from it — trade-offs, obligations, follow-ups?"
          rows={4}
        />
      </Field>
    </div>
  );
}
