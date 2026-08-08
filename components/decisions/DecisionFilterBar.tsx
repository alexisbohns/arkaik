"use client";

import { Toolbar, ToolbarGroup } from "@/components/layout/Toolbar";
import { Button } from "@/components/ui/button";
import { DECISION_STATUSES, type DecisionStatusId } from "@/lib/config/decision-statuses";

export type DecisionStatusFilter = DecisionStatusId | "all";

interface DecisionFilterBarProps {
  status: DecisionStatusFilter;
  onStatusChange: (status: DecisionStatusFilter) => void;
  /** Total decisions, for the "All" pill. */
  total: number;
  /** How many decisions carry each status. Missing means zero. */
  counts: ReadonlyMap<DecisionStatusId, number>;
}

/**
 * The Decision Log's toolbar: the status pills, and nothing else yet.
 *
 * These pills are not new — they were a row floating at the top of the scrolling
 * column, which meant the one control on the surface scrolled away from the list
 * it filters. Moving them into the shared `Toolbar` is what the other surfaces
 * already do, and it puts the count beside the filter that produced it.
 *
 * The counts stay on the pills rather than moving to the page header's `meta`.
 * "4 proposed" next to the button that shows you those four is a reason to click;
 * the same number in the header is a fact with nothing to do.
 */
export function DecisionFilterBar({ status, onStatusChange, total, counts }: DecisionFilterBarProps) {
  return (
    <Toolbar className="justify-start">
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
    </Toolbar>
  );
}
