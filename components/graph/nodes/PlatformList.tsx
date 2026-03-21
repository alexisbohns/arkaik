"use client";

import type { PlatformId } from "@/lib/config/platforms";
import { PLATFORMS } from "@/lib/config/platforms";
import type { PlatformStatusMap } from "@/lib/data/types";
import { PLATFORM_ICONS, STATUS_ICONS, STATUS_STYLES, STATUS_LABELS } from "./node-styles";

interface PlatformListProps {
  platforms: PlatformId[];
  platformStatuses?: PlatformStatusMap;
}

export function PlatformList({ platforms, platformStatuses = {} }: PlatformListProps) {
  if (platforms.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 text-xs">
      {PLATFORMS.map((platform) => {
        if (!platforms.includes(platform.id)) return null;
        const Icon = PLATFORM_ICONS[platform.id];
        const status = platformStatuses[platform.id];
        const StatusIcon = status ? STATUS_ICONS[status] : null;
        const statusLabel = status ? STATUS_LABELS[status] : "Unset";
        const statusClass = status ? STATUS_STYLES[status].badge : "text-muted-foreground/40";
        return (
          <div
            key={platform.id}
            className="flex items-center gap-2 leading-none"
          >
            <Icon className="w-3 h-3 text-muted-foreground shrink-0" />
            <span className="text-muted-foreground truncate">{platform.label}</span>
            {StatusIcon ? (
              <span title={statusLabel} className="ml-auto shrink-0">
                <StatusIcon
                  className={`h-3.5 w-3.5 ${statusClass}`}
                  aria-label={`Status: ${statusLabel}`}
                />
              </span>
            ) : (
              <span
                title={statusLabel}
                className="ml-auto h-2.5 w-2.5 shrink-0 rounded-full bg-muted-foreground/30"
                aria-label={`Status: ${statusLabel}`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
