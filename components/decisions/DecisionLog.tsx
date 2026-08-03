"use client";

import { useMemo, useState } from "react";
import type { Node, Edge, JournalEvent } from "@/lib/data/types";
import { DECISION_STATUSES, type DecisionStatusId } from "@/lib/config/decision-statuses";
import { decisionStatusOf } from "@/lib/utils/decision";
import { DecisionStatusBadge } from "@/components/layout/DecisionStatusBadge";
import { EntityId } from "@/components/graph/nodes/EntityBadges";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface DecisionLogProps {
  decisions: Node[];
  allEdges: Edge[];
  journal?: JournalEvent[];
  onSelect: (node: Node) => void;
}

/**
 * When a decision was made, for ordering: `decided_at` when present, else the
 * node's `node.created` journal ts, else empty (sorts last). Backfilled
 * history carries decided_at precisely because created-events all carry the
 * backfill date (spec §1).
 */
function decidedInstant(node: Node, createdTs: Map<string, string>): string {
  const decidedAt = typeof node.metadata?.decided_at === "string" ? node.metadata.decided_at : undefined;
  return decidedAt ?? createdTs.get(node.id) ?? "";
}

function DecisionRow({
  node,
  createdTs,
  dimmed,
  onSelect,
}: {
  node: Node;
  createdTs: Map<string, string>;
  dimmed?: boolean;
  onSelect: (node: Node) => void;
}) {
  const instant = decidedInstant(node, createdTs);
  return (
    <button
      type="button"
      onClick={() => onSelect(node)}
      className={cn(
        "flex w-full items-start gap-3 rounded-lg border bg-card px-4 py-3 text-left transition-colors hover:bg-muted",
        dimmed && "opacity-60",
      )}
    >
      <DecisionStatusBadge status={decisionStatusOf(node)} className="mt-0.5 shrink-0" />
      <span className="flex-1 min-w-0 flex flex-col gap-0.5">
        <span className="font-medium truncate">{node.title}</span>
        {node.description && (
          <span className="text-sm text-muted-foreground line-clamp-2">{node.description}</span>
        )}
      </span>
      <span className="flex flex-col items-end gap-1 shrink-0">
        <EntityId id={node.id} />
        {instant && <span className="text-xs text-muted-foreground">{instant.slice(0, 10)}</span>}
      </span>
    </button>
  );
}

export function DecisionLog({ decisions, allEdges, journal, onSelect }: DecisionLogProps) {
  const [statusFilter, setStatusFilter] = useState<DecisionStatusId | "all">("all");

  const createdTs = useMemo(() => {
    const map = new Map<string, string>();
    for (const event of journal ?? []) {
      if (event.type === "node.created" && typeof event.node_id === "string" && !map.has(event.node_id)) {
        map.set(event.node_id, event.ts);
      }
    }
    return map;
  }, [journal]);

  // The supersession chain (spec §5): a decision with an incoming `supersedes`
  // edge collapses under its successor rather than cluttering the top level.
  const supersededBy = useMemo(() => {
    const map = new Map<string, string>();
    for (const edge of allEdges) {
      if (edge.edge_type === "supersedes") map.set(edge.target_id, edge.source_id);
    }
    return map;
  }, [allEdges]);

  const supersedes = useMemo(() => {
    const map = new Map<string, Node[]>();
    const byId = new Map(decisions.map((d) => [d.id, d]));
    for (const [oldId, newId] of supersededBy) {
      const oldNode = byId.get(oldId);
      if (!oldNode) continue;
      map.set(newId, [...(map.get(newId) ?? []), oldNode]);
    }
    return map;
  }, [decisions, supersededBy]);

  const topLevel = useMemo(() => {
    const filtered =
      statusFilter === "all" ? decisions : decisions.filter((d) => decisionStatusOf(d) === statusFilter);
    return filtered
      .filter((d) => statusFilter !== "all" || !supersededBy.has(d.id))
      .sort((a, b) => decidedInstant(b, createdTs).localeCompare(decidedInstant(a, createdTs)));
  }, [decisions, statusFilter, supersededBy, createdTs]);

  const counts = useMemo(() => {
    const map = new Map<DecisionStatusId, number>();
    for (const d of decisions) {
      const s = decisionStatusOf(d);
      map.set(s, (map.get(s) ?? 0) + 1);
    }
    return map;
  }, [decisions]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-1.5">
        <Badge
          variant={statusFilter === "all" ? "default" : "outline"}
          className="cursor-pointer"
          onClick={() => setStatusFilter("all")}
        >
          All · {decisions.length}
        </Badge>
        {DECISION_STATUSES.map((s) => (
          <Badge
            key={s.id}
            variant={statusFilter === s.id ? "default" : "outline"}
            className="cursor-pointer"
            onClick={() => setStatusFilter(statusFilter === s.id ? "all" : s.id)}
          >
            {s.label} · {counts.get(s.id) ?? 0}
          </Badge>
        ))}
      </div>
      {topLevel.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          No decisions yet. Decisions record the why, what, and how of the choices that shaped this product.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {topLevel.map((node) => (
            <div key={node.id} className="flex flex-col gap-1.5">
              <DecisionRow node={node} createdTs={createdTs} onSelect={onSelect} />
              {statusFilter === "all" &&
                (supersedes.get(node.id) ?? []).map((old) => (
                  <div key={old.id} className="pl-8">
                    <DecisionRow node={old} createdTs={createdTs} dimmed onSelect={onSelect} />
                  </div>
                ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
