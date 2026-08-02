"use client";

import type { PlatformId } from "@/lib/config/platforms";
import { PLATFORMS } from "@/lib/config/platforms";
import type { PlatformStatusRollup } from "@/lib/utils/platform-status";
import { getPlatformRollupSegments } from "@/lib/utils/platform-status";
import { PLATFORM_ICONS, PLATFORM_LABELS, STATUS_STYLES } from "./node-styles";

interface PlatformGaugeListProps {
  rollup?: PlatformStatusRollup;
  /**
   * The platforms to draw a bar for — **authoritative**, and required.
   *
   * This list used to be unioned with whatever the rollup happened to carry,
   * which quietly let a platform outside the caller's scope back into the
   * display. Callers that want the rollup's own platforms included now say so
   * with `withRollupPlatforms` (see `FlowNode`, `NodeCard`, `NodeDetailPanel`),
   * so the widening is a decision at the call site rather than a rule baked in
   * here. It stays required because under membership-only semantics an omitted
   * list renders nothing at all — better a compile error than a blank gauge.
   */
  platforms: PlatformId[];
  compact?: boolean;
  showLabels?: boolean;
}

export function PlatformGaugeList({
  rollup = { counts: {}, totals: {} },
  platforms,
  compact = false,
  showLabels = false,
}: PlatformGaugeListProps) {
  // PLATFORMS drives the stacking order (web, ios, android) — the given list is
  // a membership test, never an ordering.
  const activePlatforms = PLATFORMS.filter((platform) => platforms.includes(platform.id));

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
              <span className="w-14 shrink-0 truncate text-xs text-muted-foreground">{PLATFORM_LABELS[platform.id]}</span>
            )}
            <div className="flex h-2 flex-1 overflow-hidden rounded-md bg-muted">
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