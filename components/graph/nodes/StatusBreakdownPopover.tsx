"use client";

import type { LucideIcon } from "lucide-react";
import type { StatusSegment } from "@/lib/utils/platform-status";
import { STATUS_ICONS, STATUS_LABELS, STATUS_STYLES } from "./node-styles";

interface StatusBreakdownPopoverProps {
  /** "Android", or "All platforms" for the global ring. */
  title: string;
  icon?: LucideIcon;
  segments: readonly StatusSegment[];
  footer: string;
}

/** The body of a status ring's hover card: one line per status actually present. */
export function StatusBreakdownPopover({ title, icon: Icon, segments, footer }: StatusBreakdownPopoverProps) {
  const present = segments.filter((segment) => segment.count > 0);

  return (
    <div className="flex flex-col gap-2">
      <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
        {Icon && <Icon className="size-3.5 text-muted-foreground" />}
        {title}
      </p>

      {present.length === 0 ? (
        <p className="text-xs text-muted-foreground">No delivery statuses yet.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {present.map((segment) => {
            const StatusIcon = STATUS_ICONS[segment.status];
            return (
              <li key={segment.status} className="flex items-center gap-2 text-xs">
                <StatusIcon className={`size-3.5 shrink-0 ${STATUS_STYLES[segment.status].badge}`} />
                <span className="flex-1 truncate text-muted-foreground">{STATUS_LABELS[segment.status]}</span>
                <span className="font-medium tabular-nums text-foreground">{segment.count}</span>
                <span className="w-9 text-right tabular-nums text-muted-foreground">{segment.percentage}%</span>
              </li>
            );
          })}
        </ul>
      )}

      <p className="border-t pt-1.5 text-[11px] text-muted-foreground">{footer}</p>
    </div>
  );
}
