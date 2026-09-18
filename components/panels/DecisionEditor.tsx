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
import { BlockedByField } from "@/components/panels/BlockedByField";
import { PANEL_GUTTER } from "@/components/panels/PanelSection";
import { cn } from "@/lib/utils";
import type { Node, NodeMetadata } from "@/lib/data/types";
import { type DecisionStatusId } from "@/lib/config/decision-statuses";
import { decisionStatusOf, decisionUpdatePatch } from "@/lib/utils/decision";

const AUTOSAVE_DELAY_MS = 350;

interface DecisionEditorProps {
  node: Node;
  allNodes: Node[];
  onUpdate: (id: string, patch: Partial<Omit<Node, "id" | "project_id">>) => Promise<void> | void;
  onNavigate?: (node: Node) => void;
}

/**
 * One debounced metadata text field (context / consequences / decided_at).
 *
 * Mirrors `NodeFields`' description/blocked_by autosave: compare against a
 * last-saved ref rather than the prop directly, so a concurrent edit to a
 * DIFFERENT field (which also patches `metadata` wholesale) never fires a
 * duplicate save and never clobbers this one's pending save — the reschedule
 * on every keystroke is itself load-bearing, not incidental.
 *
 * Spreads `metadataRef.current` — the shared latest-metadata base owned by
 * `DecisionEditor` — rather than `node.metadata` directly. See that ref's own
 * comment for why: `onUpdate` is not optimistic, so `node.metadata` can still
 * be stale while this save is in flight.
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
 * they are relations, not fields, so they render as `DecisionLinksSection` in
 * the Relations group. `allNodes` stays because `BlockedByField` resolves
 * blockers against it; `allEdges` went with the links, which were the only
 * thing here that read an edge.
 */
export function DecisionEditor({ node, allNodes, onUpdate, onNavigate }: DecisionEditorProps) {
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

  // Shared latest-metadata base for every wholesale-metadata writer below —
  // the three debounced text fields plus the status transition. `onUpdate` is
  // NOT optimistic, so if field A's save is still in flight when field B's
  // 350ms timer fires, `node.metadata` in B's closure is stale and a spread
  // from it would silently drop A's edit. Seeded from the node prop and kept
  // in sync when it changes (e.g. an external update lands); every writer
  // reads this ref as its spread base and writes its result back into it
  // before calling `onUpdate`, so the four writers never race each other.
  const metadataRef = useRef<NodeMetadata | undefined>(node.metadata);
  useEffect(() => {
    metadataRef.current = node.metadata;
  }, [node.metadata]);

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
      {/* A decision's own, rendered here rather than by `NodeFields` — which
          omits it for this species. What holds a decision up belongs with the
          circumstances that produced it, not above the title. */}
      <BlockedByField
        node={node}
        onUpdate={onUpdate}
        allNodes={allNodes}
        onNavigate={onNavigate}
        metadataRef={metadataRef}
      />
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
