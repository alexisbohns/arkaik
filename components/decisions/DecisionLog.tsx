"use client";

import { useMemo } from "react";
import type { Node, Edge, JournalEvent } from "@/lib/data/types";
import { decisionStatusOf } from "@/lib/utils/decision";
import type { DecisionStatusFilter } from "@/components/decisions/DecisionFilterBar";
import { DecisionStatusBadge } from "@/components/layout/DecisionStatusBadge";
import { EntityId } from "@/components/graph/nodes/EntityBadges";
import { cn } from "@/lib/utils";

interface DecisionLogProps {
  decisions: Node[];
  allEdges: Edge[];
  journal?: JournalEvent[];
  onSelect: (node: Node) => void;
  /**
   * Which status to show, owned by the page so the toolbar can carry the control.
   *
   * The log used to own this state and render the pills itself, which put the one
   * filter on the surface inside the scrolling column it filters. `"all"` is
   * still the value that means "show the supersedes chains nested"; see
   * `topLevel`.
   */
  statusFilter: DecisionStatusFilter;
}

/**
 * When a decision was made, for ordering: `decided_at` when present, else the
 * node's `node.created` journal ts, else empty (sorts last). Backfilled
 * history carries decided_at precisely because created-events all carry the
 * backfill date (spec §1).
 *
 * The two sources differ in granularity — `decided_at` is a bare `YYYY-MM-DD`
 * date, `ts` is a full ISO-8601 instant — but a lexicographic compare stays
 * correct across them: a date string is exactly the prefix any same-day
 * instant would share, so it still sorts immediately before that instant and
 * on the correct side of every other day.
 */
function decidedInstant(node: Node, createdTs: Map<string, string>): string {
  const decidedAt = typeof node.metadata?.decided_at === "string" ? node.metadata.decided_at : undefined;
  return decidedAt ?? createdTs.get(node.id) ?? "";
}

function byNewest(createdTs: Map<string, string>) {
  return (a: Node, b: Node) => decidedInstant(b, createdTs).localeCompare(decidedInstant(a, createdTs));
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

export function DecisionLog({ decisions, allEdges, journal, onSelect, statusFilter }: DecisionLogProps) {
  const createdTs = useMemo(() => {
    const map = new Map<string, string>();
    for (const event of journal ?? []) {
      if (event.type === "node.created" && typeof event.node_id === "string" && !map.has(event.node_id)) {
        map.set(event.node_id, event.ts);
      }
    }
    return map;
  }, [journal]);

  // `supersedes` edges point new → old (source supersedes target). Two
  // derived views of the same edges: who a decision directly supersedes (to
  // walk chains downward from a head), and which decisions carry an incoming
  // edge at all (to tell a head — nothing supersedes it — from the rest).
  const directlySupersedes = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const edge of allEdges) {
      if (edge.edge_type !== "supersedes") continue;
      map.set(edge.source_id, [...(map.get(edge.source_id) ?? []), edge.target_id]);
    }
    return map;
  }, [allEdges]);

  const hasIncomingSupersedes = useMemo(() => {
    const set = new Set<string>();
    for (const edge of allEdges) {
      if (edge.edge_type === "supersedes") set.add(edge.target_id);
    }
    return set;
  }, [allEdges]);

  /**
   * Chain heads (spec §5) are decisions nothing supersedes. Each head's chain
   * is every decision it transitively supersedes, found by walking
   * `directlySupersedes` depth-first from the head with a *shared* visited
   * set across all heads — so a decision two chains could both reach nests
   * under whichever head's DFS gets to it first, which is simply head order
   * (newest-first) and then edge order within `directlySupersedes`. The
   * shared set also doubles as cycle protection: a node already claimed is
   * never re-entered, so an A⇄B loop cannot recurse forever.
   *
   * A decision can have an incoming `supersedes` edge and still never be
   * visited here — every member of a cycle with no external head does. Those
   * are surfaced separately in `topLevel` below rather than lost.
   */
  const { heads, headIds, chainsByHead, visited } = useMemo(() => {
    const byId = new Map(decisions.map((d) => [d.id, d]));
    const orderedHeads = decisions
      .filter((d) => !hasIncomingSupersedes.has(d.id))
      .sort(byNewest(createdTs));
    const headIds = new Set(orderedHeads.map((d) => d.id));

    const visited = new Set<string>();
    const chainsByHead = new Map<string, Node[]>();

    function collect(nodeId: string, into: Node[]) {
      for (const predecessorId of directlySupersedes.get(nodeId) ?? []) {
        if (visited.has(predecessorId)) continue;
        const predecessor = byId.get(predecessorId);
        if (!predecessor) continue;
        visited.add(predecessorId);
        into.push(predecessor);
        collect(predecessorId, into);
      }
    }

    for (const head of orderedHeads) {
      const chain: Node[] = [];
      collect(head.id, chain);
      chain.sort(byNewest(createdTs));
      chainsByHead.set(head.id, chain);
    }

    return { heads: orderedHeads, headIds, chainsByHead, visited };
  }, [decisions, directlySupersedes, hasIncomingSupersedes, createdTs]);

  const topLevel = useMemo(() => {
    if (statusFilter !== "all") {
      // A specific-status filter shows flat matching rows — nesting a chain
      // under a head that itself may not match the filter would be confusing.
      return decisions.filter((d) => decisionStatusOf(d) === statusFilter).sort(byNewest(createdTs));
    }
    // Heads plus any decision no head's DFS reached — a pure cycle (A
    // supersedes B, B supersedes A) leaves every member with an incoming
    // edge, so neither is a head; without this line both would vanish.
    const orphaned = decisions.filter((d) => !headIds.has(d.id) && !visited.has(d.id));
    return [...heads, ...orphaned].sort(byNewest(createdTs));
  }, [decisions, statusFilter, heads, headIds, visited, createdTs]);

  // No wrapper of its own now that the pills have moved out: the log is a single
  // block, and the page's content column already supplies the gap it used to add.
  if (decisions.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No decisions yet. Decisions record the why, what, and how of the choices that shaped this product.
      </p>
    );
  }

  if (topLevel.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">No decisions with this status.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {topLevel.map((node) => (
        <div key={node.id} className="flex flex-col gap-1.5">
          <DecisionRow node={node} createdTs={createdTs} onSelect={onSelect} />
          {statusFilter === "all" &&
            (chainsByHead.get(node.id) ?? []).map((old) => (
              <div key={old.id} className="pl-8">
                <DecisionRow node={old} createdTs={createdTs} dimmed onSelect={onSelect} />
              </div>
            ))}
        </div>
      ))}
    </div>
  );
}
