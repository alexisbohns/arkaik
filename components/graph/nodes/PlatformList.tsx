"use client";

import type { PlatformId } from "@/lib/config/platforms";
import { PLATFORMS } from "@/lib/config/platforms";
import { PLATFORM_ICONS, STATUS_STYLES, STATUS_LABELS } from "./node-styles";
import type { StatusId } from "@/lib/config/statuses";

interface PlatformListProps {
  platforms: PlatformId[];
  status?: StatusId;
}

export function PlatformList({ platforms, status = "idea" }: PlatformListProps) {
  if (platforms.length === 0) return null;

  const { dot: statusDot } = STATUS_STYLES[status] ?? STATUS_STYLES.idea;
  const statusLabel = STATUS_LABELS[status];

  return (
    <div className="flex flex-col gap-1 text-xs">
      {PLATFORMS.map((platform) => {
        if (!platforms.includes(platform.id)) return null;
        const Icon = PLATFORM_ICONS[platform.id];
        return (
          <div
            key={platform.id}
            className="flex items-center gap-2 leading-none"
          >
            <Icon className="w-3 h-3 text-muted-foreground shrink-0" />
            <span className="text-muted-foreground truncate">{platform.label}</span>
            <span
              title={statusLabel}
              className={`w-1.5 h-1.5 rounded-full ${statusDot} shrink-0 ml-auto`}
              aria-label={`Status: ${statusLabel}`}
            />
          </div>
        );
      })}
    </div>
  );
}
