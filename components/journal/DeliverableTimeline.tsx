"use client";

import { PackageIcon } from "lucide-react";
import { DeliverableChips, DeliverableHoverCard } from "@/components/journal/DeliverableHoverCard";
import { formatEventDate } from "@/components/journal/describe-event";
import { iconChipVariants } from "@/components/layout/IconChip";
import type { Node } from "@/lib/data/types";
import type { Deliverable } from "@/lib/utils/journal";

/**
 * The shipped mark on the rail: the shared chip, told it leads a line of text
 * so it centres on the 20px title beside it rather than 2px below it. Same box
 * as the marks under the row (`DeliverableChips`) — one geometry, three
 * placements.
 */
const SHIP_MARK = iconChipVariants({ variant: "bare", lead: true });

/**
 * The deliverables of one milestone, drawn as a timeline: a rail of marks down
 * the left, one entry each, newest first.
 *
 * There is deliberately no card per deliverable. The old page nested a bordered
 * row inside a bordered release card inside a bordered section — three lids for
 * one fact. The rail carries the grouping instead, and `detailed` decides
 * whether each entry says more than its title.
 */
export function DeliverableTimeline({
  deliverables,
  nodesById,
  detailed,
}: {
  deliverables: readonly Deliverable[];
  nodesById: Map<string, Node>;
  detailed: boolean;
}) {
  return (
    <ol className="flex flex-col">
      {deliverables.map((deliverable, index) => (
        <li key={deliverable.deliverable_id} className="grid grid-cols-[auto_1fr] gap-x-3">
          {/* The rail. The connector is `flex-1` inside a stretched grid cell,
              so it runs to the bottom of the entry however tall it grows — and
              is absent on the last one, which would otherwise trail into
              nothing.
              The breathing room below each entry belongs to the *content*
              column, never to the `<li>`: a grid child stretches to the content
              box, so padding on the row would end the connector above the gap
              and leave the dots unlinked.

              The node on the rail is the *shipped* mark — a package, in the
              green the `live` status already uses, because what the rail plots
              is delivery: each node is one thing that reached users. It is
              deliberately not a link. The pull request has its own mark under
              the row, in the forge's purple, and one glyph that both stood for
              "shipped" and navigated to GitHub was doing two jobs badly.

              What the rail mark does carry is the preview: hovering it opens
              the deliverable's card, whose substance — the summary and the
              touched nodes' current status — has nothing to do with the URL,
              and so is there whether or not a link exists. */}
          <div className="flex flex-col items-center">
            <DeliverableHoverCard deliverable={deliverable} nodesById={nodesById}>
              <span className={`${SHIP_MARK} bg-green-500/10 text-green-600 dark:text-green-400`}>
                <PackageIcon className="size-3" aria-hidden="true" />
              </span>
            </DeliverableHoverCard>
            {index < deliverables.length - 1 && <span className="w-px flex-1 bg-border" aria-hidden="true" />}
          </div>

          <div className={`flex min-w-0 flex-col gap-1 ${index < deliverables.length - 1 ? "pb-4" : ""}`}>
            <div className="flex items-baseline justify-between gap-3">
              <p className="truncate text-sm font-medium">{deliverable.title}</p>
              <span className="shrink-0 text-xs text-muted-foreground">{formatEventDate(deliverable.ts)}</span>
            </div>

            {detailed && deliverable.summary && (
              <p className="text-xs text-muted-foreground">{deliverable.summary}</p>
            )}
            {detailed && <DeliverableChips deliverable={deliverable} nodesById={nodesById} />}
          </div>
        </li>
      ))}
    </ol>
  );
}
