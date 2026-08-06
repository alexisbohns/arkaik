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
import type { Node, Edge, NodeMetadata } from "@/lib/data/types";
import { type DecisionStatusId } from "@/lib/config/decision-statuses";
import { decisionStatusOf, decisionUpdatePatch } from "@/lib/utils/decision";

const AUTOSAVE_DELAY_MS = 350;

interface DecisionEditorProps {
  node: Node;
  allNodes: Node[];
  allEdges: Edge[];
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

/** The decision → node lists the three edge types define (spec §5). */
function decisionConnections(node: Node, allNodes: Node[], allEdges: Edge[]) {
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
        {nodes.map((n) =>
          onNavigate ? (
            <button
              key={n.id}
              type="button"
              onClick={() => onNavigate(n)}
              className="flex items-center gap-2 text-sm text-left rounded-md px-2 py-1.5 hover:bg-muted transition-colors w-full"
            >
              <span className="text-xs text-muted-foreground shrink-0 w-24 truncate">{n.id}</span>
              <span className="flex-1 truncate">{n.title}</span>
            </button>
          ) : (
            <span key={n.id} className="px-2 py-1.5 text-sm truncate">
              {n.title}
            </span>
          ),
        )}
      </div>
    </div>
  );
}

/**
 * The decision species' editor section: decision status (via the synced
 * `decisionUpdatePatch`, never a bare metadata write — see `lib/utils/decision.ts`),
 * context/consequences/decided-on as debounced metadata fields, and the
 * supersedes/generates/impacts links spec §5 defines.
 */
export function DecisionEditor({ node, allNodes, allEdges, onUpdate, onNavigate }: DecisionEditorProps) {
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
  const connections = decisionConnections(node, allNodes, allEdges);

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
    <div className="px-6 flex flex-col gap-5">
      <Field label="Decision status" htmlFor={`${fieldId}-status`}>
        <Select value={decisionStatus} onValueChange={(v) => handleStatusChange(v as DecisionStatusId)}>
          <SelectTrigger id={`${fieldId}-status`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <StatusSelectItems vocabulary="decision-status" />
          </SelectContent>
        </Select>
      </Field>
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
      <Field label="Decided on" htmlFor={`${fieldId}-decided-at`}>
        <Input
          id={`${fieldId}-decided-at`}
          type="date"
          value={decidedAt}
          onChange={(e) => setDecidedAt(e.target.value)}
        />
      </Field>
      {(connections.supersedes.length > 0 ||
        connections.supersededBy.length > 0 ||
        connections.generates.length > 0 ||
        connections.impacts.length > 0) && (
        // A group of lists rather than a control, so no `htmlFor` — and `gap-3`,
        // which is the spacing the four lists were already given.
        <Field label="Decision links" className="gap-3">
          <LinkedNodeList label="Supersedes" nodes={connections.supersedes} onNavigate={onNavigate} />
          <LinkedNodeList label="Superseded by" nodes={connections.supersededBy} onNavigate={onNavigate} />
          <LinkedNodeList label="Generated acceptances" nodes={connections.generates} onNavigate={onNavigate} />
          <LinkedNodeList label="Impacts" nodes={connections.impacts} onNavigate={onNavigate} />
        </Field>
      )}
    </div>
  );
}
