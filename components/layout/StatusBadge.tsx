import type { StatusId } from "@/lib/config/statuses";
import { cn } from "@/lib/utils";
import { STATUS_STYLES, STATUS_LABELS } from "@/components/graph/nodes/node-styles";

interface StatusBadgeProps {
  status: StatusId;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const { badge, dot } = STATUS_STYLES[status] ?? STATUS_STYLES.idea;

  return (
    <span
      className={cn(
        "flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium",
        badge,
        className
      )}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      {STATUS_LABELS[status]}
    </span>
  );
}
