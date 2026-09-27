"use client";

import type { ReactNode } from "react";
import type { Node } from "@/lib/data/types";
import type { StatusId } from "@/lib/config/statuses";
import { EntityRow } from "@/components/graph/nodes/EntityRow";
import { HoverPopover } from "@/components/layout/HoverPopover";
import { StatusBadge } from "@/components/layout/StatusBadge";

interface RelatedNodesPopoverProps {
  /** The control that opens it — a count, a chip, a mark. Rendered `asChild`. */
  trigger: ReactNode;
  /** What the list is, as the panel's heading. */
  label: string;
  nodes: readonly Node[];
  onSelect: (node: Node) => void;
}

/**
 * A list of related nodes behind a countable mark — the Changelog's and the
 * Decision log's popover, lifted out of `DecisionLog` so the Library's table can
 * answer "used in 3 flows" the same way.
 *
 * Spelling such a list out in place was the option not taken wherever this is
 * used: a decision touching nine views, or a view used by six flows, wraps into
 * three lines of grey text and pushes the next row off the screen. So the count
 * is what the surface carries, and the names are one hover away.
 *
 * Every entry is an {@link EntityRow}, so it copies its own id and opens its own
 * panel — a popover that named a flow but gave you no way to go to it would just
 * be a list to read and retype. The trigger belongs to the caller, because that
 * is the one thing a table cell and a timeline row genuinely differ on.
 *
 * A caller passing an empty list should render nothing at all rather than a
 * trigger that opens onto an empty panel; the surfaces here say "-" instead.
 */
export function RelatedNodesPopover({ trigger, label, nodes, onSelect }: RelatedNodesPopoverProps) {
  return (
    <HoverPopover trigger={trigger} className="p-1.5">
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
