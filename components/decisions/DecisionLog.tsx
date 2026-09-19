"use client";

import { useMemo, type ReactNode } from "react";
import { DiamondPlusIcon, LoaderIcon } from "lucide-react";
import type { Node, Edge, JournalEvent } from "@/lib/data/types";
import type { StatusId } from "@/lib/config/statuses";
import { decisionStatusOf } from "@/lib/utils/decision";
import type { DecisionStatusFilter } from "@/components/decisions/DecisionFilterBar";
import { DecisionStatusBadge } from "@/components/layout/DecisionStatusBadge";
import { HoverPopover } from "@/components/layout/HoverPopover";
import { StatusBadge } from "@/components/layout/StatusBadge";
import { CopyIdChip } from "@/components/graph/nodes/EntityBadges";
import { EntityRow } from "@/components/graph/nodes/EntityRow";
import { formatEventDate } from "@/components/journal/describe-event";
import { ICON_CHIP_ROW, iconChipVariants } from "@/components/layout/IconChip";
import { cn } from "@/lib/utils";

interface DecisionLogProps {
  decisions: Node[];
  allEdges: Edge[];
  /**
   * The whole graph, for naming what a decision impacts and what it generated.
   * An array rather than a `Map` because the landing previews render this from
   * a server component, and a `Map` does not cross the RSC boundary.
   */
  allNodes: Node[];
  journal?: JournalEvent[];
  onSelect: (node: Node) => void;
  /**
   * False while the log is compact: titles, dates and marks only.
   *
   * The Changelog's toggle, applied to decisions — see `DecisionFilterBar`.
   * What it folds away is the prose and the chips, never the rail: a compact
   * log is still a log of statuses in order.
   */
  detailed: boolean;
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

/**
 * A decided instant as a date to read.
 *
 * `decided_at` is a bare `YYYY-MM-DD` and a journal `ts` is a full instant, so
 * the two cannot go through one parser: `new Date("2026-01-05")` is UTC
 * midnight, which in every timezone west of Greenwich renders as the 4th. A
 * date-only string is therefore built as a *local* date before it is formatted,
 * and only a real instant is handed to {@link formatEventDate}.
 */
function formatDecidedInstant(instant: string): string {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(instant);
  if (dateOnly === null) return formatEventDate(instant);
  const [, year, month, day] = dateOnly;
  return formatEventDate(new Date(Number(year), Number(month) - 1, Number(day)).toISOString());
}

/**
 * A decision's related nodes, as a popover behind a countable mark.
 *
 * Both of a decision's outward edges get one of these and they are deliberately
 * the same shape, because they answer the same kind of question about different
 * things: `impacts` names the surfaces a choice landed on, `generates` names the
 * promises it created. Spelling either list out on the row was the option not
 * taken — a decision touching nine views wrapped into three lines of grey text
 * and pushed the next decision off the screen, which is exactly what the
 * Changelog's `DeliverableChips` learned and fixed.
 *
 * So it is drawn as that same mark: {@link ICON_CHIP_ROW}'s tile with the count
 * *beside* it, not a number crammed into a bordered plate. The label is a word
 * as well as a number — "3 surfaces", not "3" — because two glyphs on one line
 * cannot both be self-evident, and the room is there once the count is outside
 * the box.
 *
 * **Both tiles are neutral.** The Changelog paints its forge mark purple
 * because the forge has an identity; these two have none to claim, and the one
 * thing colour means on a decision row is the status on the rail. A green
 * acceptance tile beside a green `enacted` mark would be two greens saying
 * different things at one glance. The glyph tells them apart, and the word
 * under the pointer confirms it.
 *
 * Rendered as an {@link EntityRow} per node, so every entry copies its own id
 * and opens its own panel — a popover that named a view but gave you no way to
 * go to it would just be a list to read and retype.
 */
function RelatedNodesChip({
  icon,
  label,
  unit,
  nodes,
  onSelect,
}: {
  icon: ReactNode;
  /** What the list is, for the heading and the accessible name. */
  label: string;
  /** The singular noun the count is of — pluralised here. */
  unit: string;
  nodes: readonly Node[];
  onSelect: (node: Node) => void;
}) {
  if (nodes.length === 0) return null;

  return (
    <HoverPopover
      trigger={
        <button
          type="button"
          // The visible label is "3 surfaces", which needs the list's name to
          // be unambiguous read out on its own.
          aria-label={`${label} (${nodes.length})`}
          className={cn(
            ICON_CHIP_ROW,
            "cursor-pointer text-muted-foreground hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
          )}
        >
          <span className={cn(iconChipVariants(), "group-hover:bg-accent")}>{icon}</span>
          {nodes.length} {unit}
          {nodes.length === 1 ? "" : "s"}
        </button>
      }
      className="p-1.5"
    >
      {/* A menu's geometry, not a card's: the panel keeps a thin padding and
          each row carries its own, so a row's hover fill is inset from the
          panel edge by that thin margin and the text still lines up with the
          heading. The rows used to pull themselves out of a `p-3` panel with a
          negative margin, which left the fill 4px from the edge under a
          heading sitting at 12px — two different left edges in a 288px box. */}
      <div className="flex flex-col gap-0.5">
        <p className="px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        {nodes.map((node) => (
          <EntityRow key={node.id} node={node} onOpen={() => onSelect(node)}>
            <span className="min-w-0 flex-1 truncate text-xs">{node.title}</span>
            <StatusBadge
              status={node.status as StatusId}
              blockedBy={typeof node.metadata?.blocked_by === "string" ? node.metadata.blocked_by : undefined}
              className="shrink-0"
            />
          </EntityRow>
        ))}
      </div>
    </HoverPopover>
  );
}

/**
 * One decision on the rail: the status as the mark, then what was decided.
 *
 * **No card.** The rows used to be bordered boxes inside the page's bordered
 * surface — the two-lids-for-one-fact stack the Changelog dropped when it built
 * this rail, and the Findings board and the Flow panel's playlist after it. The
 * rail carries the grouping; the mark carries the status, in the colour the
 * canvas already gives that status, so a log read top to bottom is a column of
 * verdicts before it is a column of titles.
 *
 * **The row is not one button.** Three of the things on it are controls — the
 * id copies, the two glyphs open panels — and a button inside a button is
 * markup no browser honours. So the title and description are the button that
 * opens the decision, and the meta line beside them is its own row of controls,
 * the division {@link EntityRow} draws for the same reason.
 *
 * **A superseded decision keeps its title and loses its prose.** What it once
 * argued has been argued again, one row up; the rationale you want is the
 * successor's. What stays is the fact that the choice was made and then
 * replaced — a title, a date, and what it still touches.
 */
function DecisionRow({
  node,
  createdTs,
  dimmed,
  connector,
  detailed,
  impacted,
  generated,
  onSelect,
  children,
}: {
  node: Node;
  createdTs: Map<string, string>;
  dimmed?: boolean;
  /** Whether anything follows on this rail, and so whether a line runs down to it. */
  connector: boolean;
  detailed: boolean;
  /** The nodes this decision's `impacts` edges point at. */
  impacted: readonly Node[];
  /** The acceptances its `generates` edges point at. */
  generated: readonly Node[];
  onSelect: (node: Node) => void;
  /** What this decision supersedes, drawn as its own rail underneath. */
  children?: ReactNode;
}) {
  const instant = decidedInstant(node, createdTs);
  const superseded = decisionStatusOf(node) === "superseded";
  const showDescription = detailed && !superseded && node.description;

  return (
    <li className={cn("grid grid-cols-[auto_1fr] gap-x-3", dimmed && "opacity-60")}>
      {/* The rail. The connector is `flex-1` inside a stretched grid cell, so
          it runs to the bottom of the entry however tall it grows — past a
          superseded chain nested under it — and is absent on the last one,
          which would otherwise trail into nothing.

          The breathing room below belongs to the *content* column, never to
          the `<li>`: a grid child stretches to its content box, so padding on
          the row would end the connector above the gap and leave the marks
          unlinked. */}
      <div className="flex flex-col items-center">
        {/* `lead`, because the title beside it is a `text-sm` line — the chip
            owns what that means; see `iconChipVariants`. */}
        <DecisionStatusBadge status={decisionStatusOf(node)} variant="tile" lead />
        {connector && <span className="w-px flex-1 bg-border" aria-hidden="true" />}
      </div>

      <div className={cn("flex min-w-0 flex-col gap-1", connector && "pb-4")}>
        {/* The 24px mark centres on this line, which is why the title sits at
            the top of the column with the date beside it — the Changelog's
            row, and the same `items-baseline` so a long title and a short date
            share one baseline rather than one box. */}
        <button
          type="button"
          onClick={() => onSelect(node)}
          className="group/decision flex min-w-0 cursor-pointer flex-col gap-1 text-left outline-none"
        >
          <span className="flex w-full min-w-0 items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-sm font-medium group-hover/decision:underline group-focus-visible/decision:underline">
              {node.title}
            </span>
            {instant && (
              <span className="shrink-0 text-xs text-muted-foreground">{formatDecidedInstant(instant)}</span>
            )}
          </span>
          {showDescription && (
            <span className="line-clamp-2 text-xs text-muted-foreground">{node.description}</span>
          )}
        </button>

        {/* The meta line: the id, then the two edges a decision owns. The id is
            a hash rather than the slug spelled out — every row on this page is
            a decision, so a column of `DEC-…` prefixes says the same word
            twenty times, and what anyone ever wanted from it was the clipboard.
            The tooltip is where it is readable. */}
        {detailed && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1">
            <CopyIdChip id={node.id} />
            <RelatedNodesChip
              icon={<LoaderIcon className="size-3" aria-hidden="true" />}
              label="Impacted surfaces"
              unit="surface"
              nodes={impacted}
              onSelect={onSelect}
            />
            <RelatedNodesChip
              icon={<DiamondPlusIcon className="size-3" aria-hidden="true" />}
              label="Generated acceptances"
              unit="acceptance"
              nodes={generated}
              onSelect={onSelect}
            />
          </div>
        )}

        {children}
      </div>
    </li>
  );
}

export function DecisionLog({ decisions, allEdges, allNodes, journal, onSelect, statusFilter, detailed }: DecisionLogProps) {
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

  /**
   * What each decision impacts, and what it generated — its `impacts` and
   * `generates` targets, resolved to nodes.
   *
   * Built once for the whole log rather than per row: a page of twenty
   * decisions would otherwise walk every edge twenty times, and the row is
   * rendered again on every filter change.
   *
   * A target no node answers to is dropped rather than shown as a bare id, the
   * rule `DeliverableHoverCard` states for its own list: a popover naming an id
   * it cannot describe, under a count that promised something to read, is worse
   * than a chip that never appeared. The count on the chip therefore means
   * "nodes I can tell you about".
   */
  const related = useMemo(() => {
    const byId = new Map(allNodes.map((node) => [node.id, node]));
    const map = new Map<string, { impacted: Node[]; generated: Node[] }>();
    for (const edge of allEdges) {
      const key = edge.edge_type === "impacts" ? "impacted" : edge.edge_type === "generates" ? "generated" : null;
      if (key === null) continue;
      const target = byId.get(edge.target_id);
      if (target === undefined) continue;
      const entry = map.get(edge.source_id) ?? { impacted: [], generated: [] };
      entry[key].push(target);
      map.set(edge.source_id, entry);
    }
    return map;
  }, [allEdges, allNodes]);

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

  // The log as one timeline — the Changelog's rail, applied to the choices that
  // shaped the product rather than to what shipped from them. A superseded
  // chain is a rail of its own inside its head's content column, so the nesting
  // is carried by the second line of marks rather than by an indent that lined
  // up with nothing.
  return (
    <ol className="flex flex-col">
      {topLevel.map((node, index) => {
        const chain = statusFilter === "all" ? (chainsByHead.get(node.id) ?? []) : [];
        return (
          <DecisionRow
            key={node.id}
            node={node}
            createdTs={createdTs}
            detailed={detailed}
            impacted={related.get(node.id)?.impacted ?? []}
            generated={related.get(node.id)?.generated ?? []}
            // The line runs on when another decision follows it *or* when
            // this one supersedes something: a chain nested in the content
            // column with nothing joining it to its head is two marks floating
            // at two indents, and the indent alone is not a relationship.
            connector={index < topLevel.length - 1 || chain.length > 0}
            onSelect={onSelect}
          >
            {chain.length > 0 && (
              <ol className="flex flex-col pt-2">
                {chain.map((old, oldIndex) => (
                  <DecisionRow
                    key={old.id}
                    node={old}
                    createdTs={createdTs}
                    dimmed
                    detailed={detailed}
                    impacted={related.get(old.id)?.impacted ?? []}
                    generated={related.get(old.id)?.generated ?? []}
                    connector={oldIndex < chain.length - 1}
                    onSelect={onSelect}
                  />
                ))}
              </ol>
            )}
          </DecisionRow>
        );
      })}
    </ol>
  );
}
