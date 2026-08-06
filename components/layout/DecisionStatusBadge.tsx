import type { DecisionStatusId } from "@/lib/config/decision-statuses";
import { cn } from "@/lib/utils";
import {
  DECISION_STATUS_STYLES,
  DECISION_STATUS_ICONS,
  DECISION_STATUS_LABELS,
} from "@/components/graph/nodes/node-styles";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface DecisionStatusBadgeProps {
  status: DecisionStatusId;
  /** Show the label text next to the icon (the log page does; table cells don't). */
  showLabel?: boolean;
  className?: string;
}

export function DecisionStatusBadge({ status, showLabel = false, className }: DecisionStatusBadgeProps) {
  const { badge } = DECISION_STATUS_STYLES[status] ?? DECISION_STATUS_STYLES.proposed;
  const Icon = DECISION_STATUS_ICONS[status] ?? DECISION_STATUS_ICONS.proposed;
  const label = DECISION_STATUS_LABELS[status] ?? status;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("inline-flex items-center gap-1.5", className)}>
          <Icon className={cn("w-4 h-4", badge)} aria-hidden="true" />
          {showLabel ? <span className={cn("text-xs font-medium", badge)}>{label}</span> : <span className="sr-only">{label}</span>}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}
