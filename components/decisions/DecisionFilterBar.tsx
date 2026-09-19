"use client";

import { ListChevronsDownUpIcon, ListChevronsUpDownIcon } from "lucide-react";
import { Toolbar, ToolbarGroup } from "@/components/layout/Toolbar";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DECISION_STATUSES, type DecisionStatusId } from "@/lib/config/decision-statuses";

export type DecisionStatusFilter = DecisionStatusId | "all";

interface DecisionFilterBarProps {
  status: DecisionStatusFilter;
  onStatusChange: (status: DecisionStatusFilter) => void;
  /** Total decisions, for the "All" pill. */
  total: number;
  /** How many decisions carry each status. Missing means zero. */
  counts: ReadonlyMap<DecisionStatusId, number>;
  /** True while every decision shows its rationale and its edge chips. */
  detailed: boolean;
  onDetailedChange: (detailed: boolean) => void;
}

/**
 * The Decision Log's toolbar: which decisions, and how much of each.
 *
 * These pills are not new — they were a row floating at the top of the scrolling
 * column, which meant the one control on the surface scrolled away from the list
 * it filters. Moving them into the shared `Toolbar` is what the other surfaces
 * already do, and it puts the count beside the filter that produced it.
 *
 * The counts stay on the pills rather than moving to the page header's `meta`.
 * "4 proposed" next to the button that shows you those four is a reason to click;
 * the same number in the header is a fact with nothing to do.
 *
 * The detail toggle is the Changelog's, down to the glyph pair and the
 * border-only treatment: both surfaces are a timeline whose entries carry prose
 * under the title, and a reader scanning for one decision among forty wants the
 * same fold there as here. It sits in its own group so the band's
 * `justify-between` pushes it to the far edge — the pills answer "which
 * decisions", the toggle answers "how much of each", and they are not the same
 * question.
 */
export function DecisionFilterBar({
  status,
  onStatusChange,
  total,
  counts,
  detailed,
  onDetailedChange,
}: DecisionFilterBarProps) {
  const toggleLabel = detailed ? "Collapse decision details" : "Expand decision details";

  return (
    <Toolbar>
      <ToolbarGroup className="gap-1.5">
        <Button
          type="button"
          variant={status === "all" ? "default" : "outline"}
          size="sm"
          aria-pressed={status === "all"}
          onClick={() => onStatusChange("all")}
        >
          All · {total}
        </Button>
        {DECISION_STATUSES.map((entry) => (
          <Button
            key={entry.id}
            type="button"
            variant={status === entry.id ? "default" : "outline"}
            size="sm"
            aria-pressed={status === entry.id}
            // Clicking the active pill clears back to All — the pills are one
            // filter with a default, not seven independent toggles.
            onClick={() => onStatusChange(status === entry.id ? "all" : entry.id)}
          >
            {entry.label} · {counts.get(entry.id) ?? 0}
          </Button>
        ))}
      </ToolbarGroup>

      <ToolbarGroup>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon"
              variant="outline"
              aria-pressed={detailed}
              aria-label={toggleLabel}
              onClick={() => onDetailedChange(!detailed)}
              // Border only, no fill: the pills beside it darken to say "this
              // is the filter in force", and this button filters nothing — it
              // opens and shuts the prose and chips under each decision.
              className="bg-transparent dark:bg-transparent"
            >
              {detailed ? <ListChevronsDownUpIcon className="size-4" /> : <ListChevronsUpDownIcon className="size-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{toggleLabel}</TooltipContent>
        </Tooltip>
      </ToolbarGroup>
    </Toolbar>
  );
}
