"use client";

import { useEffect, useRef, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import type { Node, Edge } from "@/lib/data/types";
import { DECISION_STATUSES, type DecisionStatusId } from "@/lib/config/decision-statuses";
import {
  DECISION_STATUS_ICONS,
  DECISION_STATUS_STYLES,
} from "@/components/graph/nodes/node-styles";
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
 * DIFFERENT field (which also patches `metadata` wholesale) never reschedules
 * or clobbers this one's pending save.
 */
function useDebouncedMetadataField(
  node: Node,
  key: "context" | "consequences" | "decided_at",
  onUpdate: DecisionEditorProps["onUpdate"],
) {
  const stored = typeof node.metadata?.[key] === "string" ? (node.metadata?.[key] as string) : "";
  const [value, setValue] = useState(stored);
  const lastSavedRef = useRef(stored);

  useEffect(() => {
    const trimmed = value.trim();
    if (trimmed === lastSavedRef.current) return;
    const timeout = setTimeout(() => {
      lastSavedRef.current = trimmed;
      const next: Record<string, unknown> = { ...(node.metadata ?? {}) };
      if (trimmed === "") delete next[key];
      else next[key] = trimmed;
      void onUpdate(node.id, { metadata: next });
    }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timeout);
  }, [value, key, node.id, node.metadata, onUpdate]);

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
  const decisionStatus = decisionStatusOf(node);
  const [context, setContext] = useDebouncedMetadataField(node, "context", onUpdate);
  const [consequences, setConsequences] = useDebouncedMetadataField(node, "consequences", onUpdate);
  const [decidedAt, setDecidedAt] = useDebouncedMetadataField(node, "decided_at", onUpdate);
  const connections = decisionConnections(node, allNodes, allEdges);

  // One write path for a transition: decisionUpdatePatch bundles the metadata
  // write with the lifecycle sync so diffNodeUpdate derives both events.
  function handleStatusChange(value: DecisionStatusId) {
    void onUpdate(node.id, decisionUpdatePatch(node, value));
  }

  return (
    <div className="px-6 flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Decision status</span>
        <Select value={decisionStatus} onValueChange={(v) => handleStatusChange(v as DecisionStatusId)}>
          <SelectTrigger aria-label="Decision status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DECISION_STATUSES.map((s) => {
              const Icon = DECISION_STATUS_ICONS[s.id];
              return (
                <SelectItem key={s.id} value={s.id}>
                  <span className="inline-flex items-center gap-2">
                    <Icon className={`size-3.5 ${DECISION_STATUS_STYLES[s.id].badge}`} />
                    {s.label}
                  </span>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">Context — why</span>
        <textarea
          value={context}
          onChange={(e) => setContext(e.target.value)}
          placeholder="What made this decision necessary?"
          aria-label="Context"
          rows={4}
          className="rounded-md border bg-background px-2 py-1.5 text-sm"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">Consequences — how</span>
        <textarea
          value={consequences}
          onChange={(e) => setConsequences(e.target.value)}
          placeholder="What follows from it — trade-offs, obligations, follow-ups?"
          aria-label="Consequences"
          rows={4}
          className="rounded-md border bg-background px-2 py-1.5 text-sm"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">Decided on</span>
        <Input
          type="date"
          value={decidedAt}
          onChange={(e) => setDecidedAt(e.target.value)}
          aria-label="Decided on"
        />
      </div>
      {(connections.supersedes.length > 0 ||
        connections.supersededBy.length > 0 ||
        connections.generates.length > 0 ||
        connections.impacts.length > 0) && (
        <div className="flex flex-col gap-3">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Decision links</span>
          <LinkedNodeList label="Supersedes" nodes={connections.supersedes} onNavigate={onNavigate} />
          <LinkedNodeList label="Superseded by" nodes={connections.supersededBy} onNavigate={onNavigate} />
          <LinkedNodeList label="Generated acceptances" nodes={connections.generates} onNavigate={onNavigate} />
          <LinkedNodeList label="Impacts" nodes={connections.impacts} onNavigate={onNavigate} />
        </div>
      )}
    </div>
  );
}
