"use client";

import type { ReactNode } from "react";
import { DiamondPlusIcon, LoaderIcon } from "lucide-react";
import type { Node, Edge, JournalEvent } from "@/lib/data/types";
import type { DecisionStatusFilter } from "@/components/decisions/DecisionFilterBar";
import { DecisionStatusBadge } from "@/components/layout/DecisionStatusBadge";
import { RelatedNodesPopover } from "@/components/layout/RelatedNodesPopover";
import { CopyIdChip } from "@/components/graph/nodes/EntityBadges";
import { buildDecisionLog, type DecisionRowModel } from "@/lib/utils/decision-log";
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
}

/**
 * A decision's related nodes, as a popover behind a countable mark.
 *
 * Both of a decision's outward edges get one of these and they are deliberately
 * the same shape, because they answer the same kind of question about different
 * things: `impacts` names the surfaces a choice landed on, `generates` names the
 * promises it created. The list itself is {@link RelatedNodesPopover}, the same
 * panel the Library's "Used in" column opens; what lives here is the trigger.
 *
 * It is drawn as the Changelog's mark: {@link ICON_CHIP_ROW}'s tile with the
 * count *beside* it, not a number crammed into a bordered plate. The label is a
 * word as well as a number — "3 surfaces", not "3" — because two glyphs on one
 * line cannot both be self-evident, and the room is there once the count is
 * outside the box.
 *
 * **Both tiles are neutral.** The Changelog paints its forge mark plum
 * because the forge has an identity; these two have none to claim, and the one
 * thing colour means on a decision row is the status on the rail. A green
 * acceptance tile beside a green `enacted` mark would be two greens saying
 * different things at one glance. The glyph tells them apart, and the word
 * under the pointer confirms it.
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
    <RelatedNodesPopover
      label={label}
      nodes={nodes}
      onSelect={onSelect}
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
    />
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
  row,
  dimmed,
  connector,
  onSelect,
  children,
}: {
  row: DecisionRowModel;
  dimmed?: boolean;
  /** Whether anything follows on this rail, and so whether a line runs down to it. */
  connector: boolean;
  onSelect: (node: Node) => void;
  /** What this decision supersedes, drawn as its own rail underneath. */
  children?: ReactNode;
}) {
  const { node } = row;

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
        <DecisionStatusBadge status={row.status} variant="tile" lead />
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
            {row.dateLabel && <span className="shrink-0 text-xs text-muted-foreground">{row.dateLabel}</span>}
          </span>
          {row.showDescription && (
            <span className="line-clamp-2 text-xs text-muted-foreground">{row.description}</span>
          )}
        </button>

        {/* The meta line: the id, then the two edges a decision owns. The id is
            a hash rather than the slug spelled out — every row on this page is
            a decision, so a column of `DEC-…` prefixes says the same word
            twenty times, and what anyone ever wanted from it was the clipboard.
            The tooltip is where it is readable. */}
        {row.showMeta && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1">
            <CopyIdChip id={node.id} />
            <RelatedNodesChip
              icon={<LoaderIcon className="size-3" aria-hidden="true" />}
              label="Impacted surfaces"
              unit="surface"
              nodes={row.impacted}
              onSelect={onSelect}
            />
            <RelatedNodesChip
              icon={<DiamondPlusIcon className="size-3" aria-hidden="true" />}
              label="Generated acceptances"
              unit="acceptance"
              nodes={row.generated}
              onSelect={onSelect}
            />
          </div>
        )}

        {children}
      </div>
    </li>
  );
}

export function DecisionLog({ decisions, allEdges, allNodes, journal, onSelect, statusFilter, detailed, search = "" }: DecisionLogProps) {
  // Every rule (heads and chains, what a filter flattens, which date, what a
  // superseded row keeps) lives in the model; this renders it.
  const log = buildDecisionLog({ decisions, allEdges, allNodes, journal, statusFilter, search, detailed });

  // No wrapper of its own now that the pills have moved out: the log is a single
  // block, and the page's content column already supplies the gap it used to add.
  if (log.empty !== null) {
    return <p className="py-8 text-center text-sm text-muted-foreground">{log.emptyMessage}</p>;
  }

  // The log as one timeline — the Changelog's rail, applied to the choices that
  // shaped the product rather than to what shipped from them. A superseded
  // chain is a rail of its own inside its head's content column, so the nesting
  // is carried by the second line of marks rather than by an indent that lined
  // up with nothing.
  return (
    <ol className="flex flex-col">
      {log.entries.map(({ row, chain }, index) => (
        <DecisionRow
          key={row.id}
          row={row}
          // The line runs on when another decision follows it *or* when
          // this one supersedes something: a chain nested in the content
          // column with nothing joining it to its head is two marks floating
          // at two indents, and the indent alone is not a relationship.
          connector={index < log.entries.length - 1 || chain.length > 0}
          onSelect={onSelect}
        >
          {chain.length > 0 && (
            <ol className="flex flex-col pt-2">
              {chain.map((old, oldIndex) => (
                <DecisionRow
                  key={old.id}
                  row={old}
                  dimmed
                  connector={oldIndex < chain.length - 1}
                  onSelect={onSelect}
                />
              ))}
            </ol>
          )}
        </DecisionRow>
      ))}
    </ol>
  );
}
