import { Ban } from "lucide-react";
import type { StatusId } from "@/lib/config/statuses";
import { normalizeBlockedBy } from "@/lib/utils/blocked";
import { cn } from "@/lib/utils";
import { STATUS_STYLES, STATUS_ICONS, STATUS_LABELS } from "@/components/graph/nodes/node-styles";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface StatusBadgeProps {
  status: StatusId;
  /** Non-empty = blocked at this status; shown as a red overlay + tooltip suffix. */
  blockedBy?: string;
  className?: string;
}

export function StatusBadge({ status, blockedBy, className }: StatusBadgeProps) {
  const { badge } = STATUS_STYLES[status] ?? STATUS_STYLES.idea;
  const Icon = STATUS_ICONS[status] ?? STATUS_ICONS.idea;
  const label = STATUS_LABELS[status] ?? status;
  // One home for "what counts as blocked" — lib/utils/blocked.ts.
  const blockedReason = normalizeBlockedBy(blockedBy);
  const blocked = blockedReason !== undefined;

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={cn("relative inline-flex items-center", className)}>
            <Icon className={cn("w-4 h-4", badge)} aria-hidden="true" />
            {blocked && (
              <Ban
                className="absolute -right-1 -bottom-1 w-2.5 h-2.5 text-red-500"
                aria-hidden="true"
              />
            )}
            <span className="sr-only">{blocked ? `${label} (blocked)` : label}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">
          {blocked ? `${label} — blocked by: ${blockedReason}` : label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
