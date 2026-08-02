"use client";

import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { PLATFORMS, type PlatformId } from "@/lib/config/platforms";
import type { PlatformStatusRollup, StatusSegment } from "@/lib/utils/platform-status";
import { getPlatformRollupSegments, getRollupTotalSegments } from "@/lib/utils/platform-status";
import { PLATFORM_ICONS, PLATFORM_LABELS, STATUS_LABELS } from "./node-styles";
import { StatusBreakdownPopover } from "./StatusBreakdownPopover";
import { StatusRing, type StatusRingSize } from "./StatusRing";

// Rings read Web → Android → iOS. PLATFORMS' own order (web, ios, android) drives
// the bar stacking in PlatformGaugeList's four remaining call sites, so it stays put.
const RING_ORDER: readonly PlatformId[] = ["web", "android", "ios"];
const rank = (id: PlatformId) => {
  const index = RING_ORDER.indexOf(id);
  return index === -1 ? RING_ORDER.length : index;
};
const RING_PLATFORMS = [...PLATFORMS].sort((left, right) => rank(left.id) - rank(right.id));

/**
 * The ring's accessible name. Radix's hover card is mouse/focus-oriented, so this
 * string is the only path by which a screen reader gets the breakdown — it has to
 * carry the numbers, not just the platform name.
 */
function describeRing(title: string, segments: readonly StatusSegment[]): string {
  const present = segments.filter((segment) => segment.count > 0);
  if (present.length === 0) return `${title}: no delivery statuses yet`;

  const parts = present.map((segment) => `${segment.count} ${STATUS_LABELS[segment.status].toLowerCase()}`);
  return `${title}: ${parts.join(", ")}`;
}

interface PlatformRingSetProps {
  rollup: PlatformStatusRollup;
  /** Center of the global ring — the count the caller already computed. */
  count: number;
  size?: StatusRingSize;
  /** Names what `count` counts, for the popover footers. */
  countLabel?: string;
}

/**
 * Global + one ring per platform, each hover-revealing its status breakdown.
 * The global ring's arcs count platform *statuses* (one acceptance live on three
 * platforms contributes three), while its center shows the acceptance count —
 * the footer says both so the two numbers never look like a contradiction.
 */
export function PlatformRingSet({ rollup, count, size = "lg", countLabel = "acceptances" }: PlatformRingSetProps) {
  const totalSegments = getRollupTotalSegments(rollup);
  const statusTotal = totalSegments.reduce((sum, segment) => sum + segment.count, 0);
  const centerText = size === "lg" ? "text-sm" : "text-[11px]";
  const centerIcon = size === "lg" ? "size-4" : "size-3";

  return (
    <div className={`flex ${size === "lg" ? "gap-2.5" : "gap-2"}`}>
      <HoverCard openDelay={150}>
        <HoverCardTrigger asChild>
          <span tabIndex={0} className="cursor-help rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <StatusRing
              segments={totalSegments}
              size={size}
              label={describeRing(`All platforms, ${count} ${countLabel}`, totalSegments)}
            >
              <span className={`font-semibold tabular-nums ${centerText}`}>{count}</span>
            </StatusRing>
          </span>
        </HoverCardTrigger>
        <HoverCardContent className="w-60 p-3" align="center">
          <StatusBreakdownPopover
            title="All platforms"
            segments={totalSegments}
            footer={`${count} ${countLabel} · ${statusTotal} platform statuses`}
          />
        </HoverCardContent>
      </HoverCard>

      {RING_PLATFORMS.map((platform) => {
        const segments = getPlatformRollupSegments(rollup, platform.id);
        const platformTotal = rollup.totals[platform.id] ?? 0;
        const Icon = PLATFORM_ICONS[platform.id];
        const label = PLATFORM_LABELS[platform.id];

        return (
          <HoverCard key={platform.id} openDelay={150}>
            <HoverCardTrigger asChild>
              <span tabIndex={0} className="cursor-help rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <StatusRing segments={segments} size={size} label={describeRing(label, segments)}>
                  <Icon className={`${centerIcon} text-muted-foreground`} />
                </StatusRing>
              </span>
            </HoverCardTrigger>
            <HoverCardContent className="w-60 p-3" align="center">
              <StatusBreakdownPopover
                title={label}
                icon={Icon}
                segments={segments}
                footer={`${platformTotal} ${countLabel} on ${label}`}
              />
            </HoverCardContent>
          </HoverCard>
        );
      })}
    </div>
  );
}
