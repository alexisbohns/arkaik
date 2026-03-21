"use client";

import type { PlatformId } from "@/lib/config/platforms";
import { PLATFORMS } from "@/lib/config/platforms";
import type { PlatformStatusRollup } from "@/lib/utils/platform-status";
import { getPlatformRollupSegments } from "@/lib/utils/platform-status";
import { PLATFORM_ICONS, PLATFORM_LABELS, STATUS_STYLES } from "./node-styles";

interface PlatformGaugeListProps {
  rollup?: PlatformStatusRollup;
  platforms?: PlatformId[];
  compact?: boolean;
  showLabels?: boolean;
}

export function PlatformGaugeList({
  rollup = { counts: {}, totals: {} },
  platforms = [],
  compact = false,
  showLabels = false,
}: PlatformGaugeListProps) {
  const activePlatforms = PLATFORMS.filter(
    (platform) => platforms.includes(platform.id) || Boolean(rollup.counts[platform.id]),
  );

  if (activePlatforms.length === 0) {
    return null;
  }

  return (
    <div className={`flex flex-col ${compact ? "gap-2" : "gap-2.5"}`}>
      {activePlatforms.map((platform) => {
        const Icon = PLATFORM_ICONS[platform.id];
        const segments = getPlatformRollupSegments(rollup, platform.id);
        const hasData = segments.some((segment) => segment.count > 0);

        return (
          <div key={platform.id} className="flex items-center gap-2">
            <Icon
              className={`${compact ? "h-3.5 w-3.5" : "h-4 w-4"} shrink-0 text-muted-foreground`}
              aria-label={PLATFORM_LABELS[platform.id]}
            />
            {showLabels && (
              <span className="min-w-0 truncate text-xs text-muted-foreground">{PLATFORM_LABELS[platform.id]}</span>
            )}
            <div className="flex h-3 flex-1 overflow-hidden rounded-sm bg-muted">
              {hasData ? (
                segments.map((segment) => {
                  if (segment.count === 0) return null;
                  return (
                    <div
                      key={segment.status}
                      className={STATUS_STYLES[segment.status].dot}
                      style={{ width: `${segment.ratio * 100}%` }}
                      title={`${segment.status}: ${segment.percentage}%`}
                    />
                  );
                })
              ) : (
                <div className="h-full w-full bg-muted-foreground/25" title="No counted statuses" />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}