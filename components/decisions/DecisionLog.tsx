"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronDownIcon } from "lucide-react";
import type { Node, Edge, JournalEvent } from "@/lib/data/types";
import type { DecisionStatusFilter } from "@/components/decisions/DecisionFilterBar";
import { CopyIdChip } from "@/components/graph/nodes/EntityBadges";
import { DECISION_STATUS_ICONS } from "@/components/graph/nodes/node-styles";
import { ReasoningCue, RelatedTiles, Shape, StatusPill, StatusSeal, plural } from "@/components/decisions/DecisionMarks";
import type { DecisionGrouping } from "@/lib/hooks/useDisplayPreferences";
import {
  buildDecisionLog,
  decidedDate,
  type DecisionLogEntry,
  type DecisionLogModel,
  type DecisionRowModel,
} from "@/lib/utils/decision-log";

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
  /**
   * Free text matched against title, description and id. Optional — the landing
   * previews render a fixed log with no toolbar above it to type into.
   *
   * A search, like a status filter, flattens the chains: a query that matches a
   * superseded decision but not its head has nowhere to nest it, and nesting it
   * under a head the reader did not ask for would answer a question they did
   * not put. See `topLevel`.
   */
  search?: string;
  /**
   * By quarter (the default): a timeline, each replacement chain folded under
   * the decision that replaced it. By status: open calls first, every decision
   * under its own status — so chains unfold there, a chain spanning statuses.
   */
  grouping?: DecisionGrouping;
}


const MONTH = new Intl.DateTimeFormat(undefined, { month: "short" });
const DAY = new Intl.DateTimeFormat(undefined, { day: "numeric" });

/**
 * A row's date as a calendar stamp on the rail: month, day, year. A date that
 * is only the record's creation (no authored `decided_at`) wears the dashed
 * "open on purpose" outline instead of a fill, and a decision with no date at
 * all a dashed dash. The stamp is drawn for the eye; the title's sr text says
 * the date in words.
 */
function DateStamp({ row }: { row: DecisionRowModel }) {
  const date = decidedDate(row.instant);
  if (!date) {
    return (
      <span className="dc-when" data-empty="" aria-hidden="true">
        <span className="dc-when-month">—</span>
      </span>
    );
  }
  return (
    <span className="dc-when" data-source={row.dateSource ?? undefined} aria-hidden="true">
      <span className="dc-when-month">{MONTH.format(date)}</span>
      <span className="dc-when-day">{DAY.format(date)}</span>
      <span className="dc-when-year">{date.getFullYear()}</span>
    </span>
  );
}

/**
 * One decision on the rail: its date stamp, then what was decided.
 *
 * **No card.** The rail carries the grouping, the stamp carries the date, and
 * the status rides as the first chip of the line under the prose — so every
 * title starts on the same edge, which is what a column of decisions is read
 * by.
 *
 * **The row is not one button.** The id copies and the related tiles open
 * lists — a button inside a button is markup no browser honours. So the title
 * is the button that opens the decision, its hit area stretched over the row's
 * text, and the chip line sits above that hit area as its own controls. A
 * nested chain renders under the body, outside it, so its rows stay their own
 * buttons.
 *
 * **A superseded decision keeps its title and loses its prose** (the model's
 * rule). In a flat list — a filter, a search, the status grouping — a replaced
 * decision also says what replaced it, since there is no head above it to.
 *
 * `data-look="ledger"` is the row's look in app/m3/decisions.css.
 */
function DecisionRow({
  row,
  context,
  connector,
  onSelect,
  children,
}: {
  row: DecisionRowModel;
  /** head = top level (may carry a chain); chain = inside one; flat = a filtered, searched or status-grouped list. */
  context: "head" | "chain" | "flat";
  /** Whether anything follows on this rail, and so whether a line runs down to it. */
  connector: boolean;
  onSelect: (node: Node) => void;
  /** What this decision supersedes, drawn under it. */
  children?: ReactNode;
}) {
  const replacedBy = context === "flat" && row.supersededBy.length > 0 ? row.supersededBy : null;
  return (
    <li
      data-decision-row
      data-decision-status={row.status}
      data-decision-context={context}
      data-dc-status={row.status}
      data-look="ledger"
      data-connector={connector ? "" : undefined}
      data-dimmed={context === "chain" ? "" : undefined}
      data-detailed={row.showMeta ? "" : undefined}
      className="dc-row"
    >
      <div className="dc-row-rail">
        <DateStamp row={row} />
        {connector && <span className="dc-row-line" aria-hidden="true" />}
      </div>
      <div className="dc-row-body">
        <div className="dc-row-hit">
          <div className="dc-row-top">
            <button type="button" className="dc-row-title" onClick={() => onSelect(row.node)}>
              {row.title || row.id}
              <span className="sr-only">
                , {row.statusLabel}
                {row.dateLabel && `, ${row.dateSource === "recorded" ? "recorded" : "decided"} ${row.dateLabel}`}
              </span>
            </button>
          </div>
          {row.showDescription && <p className="dc-row-prose">{row.description}</p>}
          <div className="dc-row-meta">
            <StatusPill status={row.status} className="dc-row-pill" />
            {row.showMeta && (
              <>
                <CopyIdChip id={row.id} />
                <RelatedTiles row={row} onSelect={onSelect} />
                {context !== "chain" && !row.superseded && (
                  <ReasoningCue hasContext={row.hasContext} hasConsequences={row.hasConsequences} />
                )}
                {replacedBy && (
                  <span className="dc-row-replaced">
                    Replaced by{" "}
                    {replacedBy.map((node, i) => (
                      <span key={node.id}>
                        {i > 0 && ", "}
                        <button type="button" className="dc-inline-link" onClick={() => onSelect(node)}>
                          {node.title || node.id}
                        </button>
                      </span>
                    ))}
                  </span>
                )}
              </>
            )}
          </div>
        </div>
        {children}
      </div>
    </li>
  );
}

/**
 * What a head replaced, folded: one pill — the line's seals newest to oldest
 * and "Replaced 2 earlier decisions" — that opens to their rows. Folded by
 * default because a replaced decision's rationale has been argued again by its
 * successor; the line is there to be followed, not read past.
 */
function ReplacedChain({
  head,
  chain,
  onSelect,
}: {
  head: DecisionRowModel;
  chain: DecisionRowModel[];
  onSelect: (node: Node) => void;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="dc-chain" data-chain="pill" data-open={open ? "" : undefined}>
      <button type="button" className="dc-chain-pill" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        <span className="dc-chain-seals" aria-hidden="true">
          {[head, ...chain].map((row) => (
            <StatusSeal key={row.id} status={row.status} size="xs" />
          ))}
        </span>
        <span>Replaced {chain.length === 1 ? "an earlier decision" : `${chain.length} earlier decisions`}</span>
        <ChevronDownIcon aria-hidden="true" className="dc-chain-chevron" />
      </button>
      {open && (
        <ol data-decision-chain id={id} className="dc-chain-list">
          {chain.map((row, i) => (
            <DecisionRow key={row.id} row={row} context="chain" connector={i < chain.length - 1} onSelect={onSelect} />
          ))}
        </ol>
      )}
    </div>
  );
}

/** A group's mark: a cookie seal holding "Q4" or the status glyph, then its title and count. Sticky beside its rows on a wide log. */
function GroupMark({ seal, title, count }: { seal: ReactNode; title: string; count: number }) {
  return (
    <h3 className="dc-quarter-mark">
      <span className="dc-quarter-seal" aria-hidden="true">
        <Shape name="cookie9" />
        {seal}
      </span>
      <span className="dc-quarter-text">
        <span className="dc-quarter-year">{title}</span>
        <span className="dc-quarter-count">{plural(count, "decision")}</span>
      </span>
    </h3>
  );
}

/** Consecutive entries sharing a key, in the log's order. */
function runsBy<T>(items: T[], keyOf: (item: T) => string): { key: string; items: T[] }[] {
  const runs: { key: string; items: T[] }[] = [];
  for (const item of items) {
    const key = keyOf(item);
    const last = runs[runs.length - 1];
    if (last && last.key === key) last.items.push(item);
    else runs.push({ key, items: [item] });
  }
  return runs;
}

function quarterOf(row: DecisionRowModel): string {
  const date = decidedDate(row.instant);
  return date ? `${date.getFullYear()}-Q${Math.floor(date.getMonth() / 3) + 1}` : "undated";
}

export function DecisionLog({
  decisions,
  allEdges,
  allNodes,
  journal,
  onSelect,
  statusFilter,
  detailed,
  search = "",
  grouping = "quarter",
}: DecisionLogProps) {
  // Every rule (heads and chains, what a filter flattens, which date, what a
  // superseded row keeps) lives in the model; this renders it.
  const log = buildDecisionLog({ decisions, allEdges, allNodes, journal, statusFilter, search, detailed });

  if (log.empty !== null) {
    return (
      <div className="dc-empty" data-reason={log.empty}>
        <Shape name="flower" className="dc-empty-shape" />
        <p>{log.emptyMessage}</p>
      </div>
    );
  }
  return grouping === "status" ? (
    <LogByStatus log={log} onSelect={onSelect} />
  ) : (
    <LogByQuarter log={log} onSelect={onSelect} />
  );
}

/**
 * The log as a timeline in quarters, newest first: each quarter's mark on a
 * spine beside its decisions. A head's replacement chain folds under it; a
 * filter or a search flattens the log (the model's rule), and the quarters
 * still hold.
 */
function LogByQuarter({ log, onSelect }: { log: DecisionLogModel; onSelect: (node: Node) => void }) {
  return (
    <div className="dc-log" data-log="quarters">
      {runsBy(log.entries, (entry: DecisionLogEntry) => quarterOf(entry.row)).map(({ key, items }) => {
        const [year, quarter] = key === "undated" ? [null, null] : key.split("-");
        const count = items.reduce((n, entry) => n + 1 + entry.chain.length, 0);
        return (
          <section key={key} className="dc-quarter" aria-label={year ? `${quarter} ${year}` : "Undated"}>
            <GroupMark seal={<span>{quarter ?? "—"}</span>} title={year ? `${quarter} ${year}` : "Undated"} count={count} />
            <ol data-decision-log className="dc-quarter-list">
              {items.map(({ row, chain }, index) => (
                <DecisionRow
                  key={row.id}
                  row={row}
                  context={log.flat ? "flat" : "head"}
                  // The line runs on when another decision follows it *or*
                  // when this one replaced something folded under it.
                  connector={index < items.length - 1 || chain.length > 0}
                  onSelect={onSelect}
                >
                  {chain.length > 0 && <ReplacedChain head={row} chain={chain} onSelect={onSelect} />}
                </DecisionRow>
              ))}
            </ol>
          </section>
        );
      })}
    </div>
  );
}

/**
 * The log by status, open calls first, each group under the quarter's mark
 * with the status glyph in the cookie. Every decision sits under its OWN
 * status, so chains unfold here (a chain spans statuses): each replaced
 * decision is a flat row saying what replaced it, and a group's count is the
 * status key's count.
 */
function LogByStatus({ log, onSelect }: { log: DecisionLogModel; onSelect: (node: Node) => void }) {
  const rows = log.entries.flatMap((entry) => [entry.row, ...entry.chain]);
  const groups = log.counts
    .map(({ status, label }) => ({
      status,
      label,
      // Newest first, like the log: unfolded chain members are older than their heads.
      rows: rows
        .filter((row) => row.status === status)
        .sort((a, b) => b.instant.localeCompare(a.instant)),
    }))
    .filter((group) => group.rows.length > 0);
  return (
    <div className="dc-log" data-log="quarters" data-dc-grouping="status">
      {groups.map(({ status, label, rows: groupRows }) => {
        const Icon = DECISION_STATUS_ICONS[status];
        return (
          <section key={status} className="dc-quarter" aria-label={label}>
            <GroupMark
              seal={
                <span className="dc-group-glyph">
                  <Icon />
                </span>
              }
              title={label}
              count={groupRows.length}
            />
            <ol data-decision-log className="dc-quarter-list">
              {groupRows.map((row, index) => (
                <DecisionRow key={row.id} row={row} context="flat" connector={index < groupRows.length - 1} onSelect={onSelect} />
              ))}
            </ol>
          </section>
        );
      })}
    </div>
  );
}
