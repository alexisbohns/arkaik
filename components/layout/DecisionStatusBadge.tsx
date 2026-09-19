import type { DecisionStatusId } from "@/lib/config/decision-statuses";
import { cn } from "@/lib/utils";
import {
  DECISION_STATUS_STYLES,
  DECISION_STATUS_ICONS,
  DECISION_STATUS_LABELS,
  DECISION_STATUS_TILE,
} from "@/components/graph/nodes/node-styles";
import { ICON_TILE } from "@/components/journal/DeliverableHoverCard";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface DecisionStatusBadgeProps {
  status: DecisionStatusId;
  /** Show the label text next to the icon (a table cell doesn't). */
  showLabel?: boolean;
  /**
   * How the status is drawn.
   *
   * `inline` is the bare glyph in the status colour, for a row that already has
   * a shape of its own. `tile` is the boxed mark a timeline rail carries — the
   * same 24px square as the Changelog's shipped mark and the Findings board's
   * verdicts, so a decision on a rail sits on the same axis as everything else
   * this app plots.
   */
  variant?: "inline" | "tile";
  className?: string;
}

export function DecisionStatusBadge({
  status,
  showLabel = false,
  variant = "inline",
  className,
}: DecisionStatusBadgeProps) {
  const { badge } = DECISION_STATUS_STYLES[status] ?? DECISION_STATUS_STYLES.proposed;
  const Icon = DECISION_STATUS_ICONS[status] ?? DECISION_STATUS_ICONS.proposed;
  const label = DECISION_STATUS_LABELS[status] ?? status;
  const tile = DECISION_STATUS_TILE[status] ?? DECISION_STATUS_TILE.proposed;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {variant === "tile" ? (
          // The colour rides on the box, and the glyph inside it takes the
          // box's foreground — the rule every mark in this app follows (see
          // `DeliverableHoverCard`'s `FORGE_TILE`). A label beside a tile stays
          // system foreground for the same reason.
          <span className={cn("inline-flex items-center gap-2", className)}>
            <span className={cn(ICON_TILE, tile)}>
              <Icon className="size-3" aria-hidden="true" />
            </span>
            {showLabel ? <span className="text-xs font-medium">{label}</span> : <span className="sr-only">{label}</span>}
          </span>
        ) : (
          <span className={cn("inline-flex items-center gap-1.5", className)}>
            <Icon className={cn("w-4 h-4", badge)} aria-hidden="true" />
            {showLabel ? <span className={cn("text-xs font-medium", badge)}>{label}</span> : <span className="sr-only">{label}</span>}
          </span>
        )}
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}
