/**
 * The Decision Log as data: every rule the log encodes, in one pure function,
 * so the page and the log render a model instead of re-deriving it — which
 * decisions head a supersedes chain and which nest under them, what a filter
 * or a search does to that nesting, which date a row shows and where it came
 * from, what a superseded row keeps, which related nodes are describable, and
 * why an empty log is empty.
 *
 * Plain functions, called plainly: the React compiler memoises the call site,
 * and its lint refuses a `useMemo` around an imported call.
 */
import type { Edge, JournalEvent, Node } from "@/lib/data/types";
import { decisionStatusOf, type DecisionStatusId } from "@/lib/utils/decision";
import { DECISION_STATUSES } from "@/lib/config/decision-statuses";

/** Which status the log shows; `"all"` is also what keeps the chains nested. */
export type DecisionStatusFilter = DecisionStatusId | "all";

export const DECISION_STATUS_LABEL = Object.fromEntries(DECISION_STATUSES.map((s) => [s.id, s.label])) as Record<
  DecisionStatusId,
  string
>;

/* ───────────────────────────── dates ───────────────────────────── */

/** Each node's `node.created` journal ts, by node id (the first one wins). */
export function createdTsFrom(journal: readonly JournalEvent[] | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const event of journal ?? []) {
    if (event.type === "node.created" && typeof event.node_id === "string" && !map.has(event.node_id)) {
      map.set(event.node_id, event.ts);
    }
  }
  return map;
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
export function decidedInstant(node: Node, createdTs: Map<string, string>): string {
  const decidedAt = typeof node.metadata?.decided_at === "string" ? node.metadata.decided_at : undefined;
  return decidedAt ?? createdTs.get(node.id) ?? "";
}

/**
 * Where a row's date came from: the authored `decided_at`, or only the
 * record's creation in the journal — a different claim ("decided on" vs
 * "recorded on"), which a row may draw differently. Null when it has neither.
 */
export function decidedSource(node: Node, createdTs: Map<string, string>): "decided" | "recorded" | null {
  if (typeof node.metadata?.decided_at === "string") return "decided";
  return createdTs.has(node.id) ? "recorded" : null;
}

/** A short date ("Jul 30, 2026"); the raw string back if it does not parse. */
function formatShortDate(date: Date, raw: string): string {
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/**
 * A decided instant as a local Date, or null.
 *
 * `decided_at` is a bare `YYYY-MM-DD` and a journal `ts` is a full instant, so
 * the two cannot go through one parser: `new Date("2026-01-05")` is UTC
 * midnight, which in every timezone west of Greenwich is the 4th. A date-only
 * string is therefore built as a *local* date.
 */
export function decidedDate(instant: string): Date | null {
  if (!instant) return null;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(instant);
  const date = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(instant);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** A decided instant as a date to read (see {@link decidedDate} for the date-only rule). */
export function formatDecidedInstant(instant: string): string {
  return formatShortDate(decidedDate(instant) ?? new Date(Number.NaN), instant);
}

/* ───────────────────────────── the row ───────────────────────────── */

export interface DecisionRowModel {
  node: Node;
  id: string;
  title: string;
  description: string | undefined;
  status: DecisionStatusId;
  statusLabel: string;
  /** Sort key: `decided_at`, else the created ts, else "". */
  instant: string;
  /** The date to show, or null when the decision has none at all. */
  dateLabel: string | null;
  /** Whether that date is the authored `decided_at` or only the record's creation. */
  dateSource: "decided" | "recorded" | null;
  /**
   * A superseded decision keeps its title and loses its prose: what it once
   * argued has been argued again by its successor, and the rationale a reader
   * wants is that one. What stays is the fact that the choice was made and
   * then replaced — a title, a date, and what it still touches.
   */
  superseded: boolean;
  /** Detailed, not superseded, and has a description: only then is the prose shown. */
  showDescription: boolean;
  /** The id and related chips show only while the log is detailed. */
  showMeta: boolean;
  /**
   * The `impacts` / `generates` targets, resolved to nodes. A target no node
   * answers to is dropped rather than shown as a bare id — the rule
   * `DeliverableHoverCard` states for its own list: a popover naming an id it
   * cannot describe, under a count that promised something to read, is worse
   * than a chip that never appeared. A count therefore means "nodes I can tell
   * you about".
   */
  impacted: Node[];
  generated: Node[];
  /** Whether the panel's why and how are written — a row can say it has its reasoning. */
  hasContext: boolean;
  hasConsequences: boolean;
  /** The decisions this one directly supersedes, and directly superseded by (resolved). */
  supersedes: Node[];
  supersededBy: Node[];
}

/* ───────────────────────────── the log ───────────────────────────── */

export interface DecisionLogEntry {
  row: DecisionRowModel;
  /** What this head transitively supersedes, newest first; empty while the log is flat. */
  chain: DecisionRowModel[];
}

export interface DecisionLogModel {
  /** Every decision on the page, unfiltered. */
  total: number;
  /** Per status, in the vocabulary's order, zeros included. */
  counts: { status: DecisionStatusId; label: string; count: number }[];
  /** A status filter or a search is active: rows are flat, never nested. */
  flat: boolean;
  /** What the log renders, newest first. */
  entries: DecisionLogEntry[];
  /** How many decisions the entries show, chains included. */
  shown: number;
  /** Why the log is empty, when it is. */
  empty: null | "no-decisions" | "no-status-match" | "no-search-match";
  /** The sentence that says so. */
  emptyMessage: string | null;
  /** How many heads carry a chain (zero while flat). */
  chains: number;
  /** The newest dated decision, filter or not. */
  latest: DecisionRowModel | null;
  /** The decisions still `proposed`, newest first — the calls waiting to be made. */
  open: DecisionRowModel[];
}

/**
 * Whether a decision answers the toolbar's search box.
 *
 * Title, description and id, because those are the three things anyone knows
 * about a decision they are trying to find again: what it said, why, or the
 * `DEC-…` someone pasted at them.
 */
function matchesQuery(node: Node, query: string): boolean {
  if (query === "") return true;
  return (
    node.title.toLowerCase().includes(query) ||
    (node.description ?? "").toLowerCase().includes(query) ||
    node.id.toLowerCase().includes(query)
  );
}

export interface BuildDecisionLogInput {
  decisions: Node[];
  allEdges: Edge[];
  allNodes: Node[];
  journal?: JournalEvent[];
  statusFilter: DecisionStatusFilter;
  search?: string;
  detailed: boolean;
}

const EMPTY_MESSAGE: Record<NonNullable<DecisionLogModel["empty"]>, string> = {
  "no-decisions": "No decisions yet. Decisions record the why, what, and how of the choices that shaped this product.",
  "no-status-match": "No decisions with this status.",
  "no-search-match": "No decisions match this search.",
};

export function buildDecisionLog({
  decisions,
  allEdges,
  allNodes,
  journal,
  statusFilter,
  search = "",
  detailed,
}: BuildDecisionLogInput): DecisionLogModel {
  const createdTs = createdTsFrom(journal);
  const byNewest = (a: Node, b: Node) => decidedInstant(b, createdTs).localeCompare(decidedInstant(a, createdTs));
  const byId = new Map(allNodes.map((node) => [node.id, node]));
  const decisionsById = new Map(decisions.map((d) => [d.id, d]));

  // `supersedes` edges point new → old (source supersedes target). Derived
  // views of the same edges: who a decision directly supersedes (to walk
  // chains downward from a head), who directly supersedes it, and which
  // decisions carry an incoming edge at all (to tell a head — nothing
  // supersedes it — from the rest). Built once for the whole log rather than
  // per row: the rows are rebuilt on every filter change.
  const directlySupersedes = new Map<string, string[]>();
  const directlySupersededBy = new Map<string, string[]>();
  const hasIncomingSupersedes = new Set<string>();
  const related = new Map<string, { impacted: Node[]; generated: Node[] }>();
  for (const edge of allEdges) {
    if (edge.edge_type === "supersedes") {
      directlySupersedes.set(edge.source_id, [...(directlySupersedes.get(edge.source_id) ?? []), edge.target_id]);
      directlySupersededBy.set(edge.target_id, [...(directlySupersededBy.get(edge.target_id) ?? []), edge.source_id]);
      hasIncomingSupersedes.add(edge.target_id);
      continue;
    }
    const key = edge.edge_type === "impacts" ? "impacted" : edge.edge_type === "generates" ? "generated" : null;
    if (key === null) continue;
    const target = byId.get(edge.target_id);
    if (target === undefined) continue;
    const entry = related.get(edge.source_id) ?? { impacted: [], generated: [] };
    entry[key].push(target);
    related.set(edge.source_id, entry);
  }
  const resolve = (ids: string[] | undefined) =>
    (ids ?? []).map((id) => byId.get(id)).filter((n): n is Node => n !== undefined);

  const rowOf = (node: Node): DecisionRowModel => {
    const status = decisionStatusOf(node);
    const superseded = status === "superseded";
    const instant = decidedInstant(node, createdTs);
    return {
      node,
      id: node.id,
      title: node.title,
      description: node.description || undefined,
      status,
      statusLabel: DECISION_STATUS_LABEL[status] ?? status,
      instant,
      dateLabel: instant ? formatDecidedInstant(instant) : null,
      dateSource: decidedSource(node, createdTs),
      superseded,
      showDescription: Boolean(detailed && !superseded && node.description),
      showMeta: detailed,
      impacted: related.get(node.id)?.impacted ?? [],
      generated: related.get(node.id)?.generated ?? [],
      hasContext: typeof node.metadata?.context === "string" && node.metadata.context.trim() !== "",
      hasConsequences: typeof node.metadata?.consequences === "string" && node.metadata.consequences.trim() !== "",
      supersedes: resolve(directlySupersedes.get(node.id)),
      supersededBy: resolve(directlySupersededBy.get(node.id)),
    };
  };

  // Chain heads (spec §5) are decisions nothing supersedes. Each head's chain
  // is every decision it transitively supersedes, found by walking
  // `directlySupersedes` depth-first from the head with a *shared* visited set
  // across all heads — so a decision two chains could both reach nests under
  // whichever head's DFS gets to it first, which is simply head order
  // (newest-first) and then edge order. The shared set also doubles as cycle
  // protection: a node already claimed is never re-entered, so an A⇄B loop
  // cannot recurse forever.
  const heads = decisions.filter((d) => !hasIncomingSupersedes.has(d.id)).sort(byNewest);
  const headIds = new Set(heads.map((d) => d.id));
  const visited = new Set<string>();
  const chainsByHead = new Map<string, Node[]>();
  function collect(nodeId: string, into: Node[]) {
    for (const predecessorId of directlySupersedes.get(nodeId) ?? []) {
      if (visited.has(predecessorId)) continue;
      const predecessor = decisionsById.get(predecessorId);
      if (!predecessor) continue;
      visited.add(predecessorId);
      into.push(predecessor);
      collect(predecessorId, into);
    }
  }
  for (const head of heads) {
    const chain: Node[] = [];
    collect(head.id, chain);
    chain.sort(byNewest);
    chainsByHead.set(head.id, chain);
  }

  // A filter of either kind shows flat matching rows: a query that matches a
  // superseded decision but not its head has nowhere to nest it, and nesting it
  // under a head the reader did not ask for would answer a question they did
  // not put. Unfiltered, the heads — plus any decision no head's DFS reached:
  // a pure cycle (A supersedes B, B supersedes A) leaves every member with an
  // incoming edge, so neither is a head, and without this both would vanish.
  const query = search.trim().toLowerCase();
  const flat = statusFilter !== "all" || query !== "";
  const topLevel = flat
    ? decisions
        .filter((d) => statusFilter === "all" || decisionStatusOf(d) === statusFilter)
        .filter((d) => matchesQuery(d, query))
        .sort(byNewest)
    : [...heads, ...decisions.filter((d) => !headIds.has(d.id) && !visited.has(d.id))].sort(byNewest);

  const entries: DecisionLogEntry[] = topLevel.map((node) => ({
    row: rowOf(node),
    chain: flat ? [] : (chainsByHead.get(node.id) ?? []).map(rowOf),
  }));

  const countOf = new Map<DecisionStatusId, number>();
  for (const d of decisions) countOf.set(decisionStatusOf(d), (countOf.get(decisionStatusOf(d)) ?? 0) + 1);

  const empty: DecisionLogModel["empty"] =
    decisions.length === 0
      ? "no-decisions"
      : entries.length === 0
        ? query === ""
          ? "no-status-match"
          : "no-search-match"
        : null;

  const newestFirst = decisions.map(rowOf).sort((a, b) => b.instant.localeCompare(a.instant));

  return {
    total: decisions.length,
    counts: DECISION_STATUSES.map((s) => ({ status: s.id, label: s.label, count: countOf.get(s.id) ?? 0 })),
    flat,
    entries,
    shown: entries.reduce((n, e) => n + 1 + e.chain.length, 0),
    empty,
    emptyMessage: empty === null ? null : EMPTY_MESSAGE[empty],
    chains: entries.filter((e) => e.chain.length > 0).length,
    latest: newestFirst.find((r) => r.instant !== "") ?? null,
    open: newestFirst.filter((r) => r.status === "proposed"),
  };
}
