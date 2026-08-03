"use client";

import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { PLATFORMS, type PlatformId } from "@/lib/config/platforms";
import type { PlatformStatusRollup, StatusSegment } from "@/lib/utils/platform-status";
import { getPlatformRollupSegments, getRollupTotalSegments } from "@/lib/utils/platform-status";
import { PLATFORM_ICONS, PLATFORM_LABELS, STATUS_LABELS } from "./node-styles";
import { StatusBreakdownPopover } from "./StatusBreakdownPopover";
import { StatusRing, type StatusRingSize } from "./StatusRing";

// Rings read Web → Android → iOS, whatever order the caller hands them in — the
// ring set re-sorts by RING_ORDER so a scope that narrows the list can never
// reshuffle it. PLATFORMS' own order (web, ios, android) still drives the bar
// stacking in PlatformGaugeList's four remaining call sites, so it stays put;
// here it survives only as the default list when `platforms` is omitted.
const RING_ORDER: readonly PlatformId[] = ["web", "android", "ios"];
const rank = (id: PlatformId) => {
  const index = RING_ORDER.indexOf(id);
  return index === -1 ? RING_ORDER.length : index;
};

const TRIGGER_CLASS = "cursor-help";

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
  /**
   * The platforms to draw a ring for. Omitted means every platform the app
   * knows about, which is what every pre-product call site wants; a scoped
   * surface passes its own effective list instead.
   */
  platforms?: PlatformId[];
  size?: StatusRingSize;
  /** Names what `count` counts, for the popover footers. */
  countLabel?: string;
  /**
   * Names what a *platform* ring's footer counts, which is platform statuses —
   * not always the same unit as `count`. A merged rollup (e.g. a whole tier)
   * collapses element identity, so the per-platform number can't inherit a
   * label like "elements addressed". Defaults to `countLabel`, which is right
   * whenever the rollup covers a single element.
   */
  platformCountLabel?: string;
}

/**
 * Global + one ring per platform, each hover-revealing its status breakdown.
 * The global ring's arcs count platform *statuses* (one acceptance live on three
 * platforms contributes three), while its center shows the acceptance count —
 * both the footer and the accessible name state the two numbers together, so
 * neither a sighted nor a screen-reader user meets one without the other.
 */
export function PlatformRingSet({
  rollup,
  count,
  platforms,
  size = "lg",
  countLabel = "acceptances",
  platformCountLabel = countLabel,
}: PlatformRingSetProps) {
  const ringPlatforms = (platforms ?? PLATFORMS.map((platform) => platform.id))
    .slice()
    .sort((left, right) => rank(left) - rank(right));
  const totalSegments = getRollupTotalSegments(rollup);
  const statusTotal = totalSegments.reduce((sum, segment) => sum + segment.count, 0);
  const centerText = size === "lg" ? "text-sm" : "text-[11px]";
  const centerIcon = size === "lg" ? "size-4" : "size-3";

  return (
    <div className={`flex ${size === "lg" ? "gap-2.5" : "gap-2"}`}>
      <HoverCard openDelay={150}>
        <HoverCardTrigger asChild>
          <span className={TRIGGER_CLASS}>
            <StatusRing
              segments={totalSegments}
              size={size}
              label={describeRing(
                `All platforms, ${count} ${countLabel} across ${statusTotal} platform statuses`,
                totalSegments,
              )}
              blockedCount={rollup.blocked ?? 0}
            >
              <span className={`font-semibold tabular-nums ${centerText}`}>{count}</span>
            </StatusRing>
          </span>
        </HoverCardTrigger>
        <HoverCardContent className="w-60 p-3">
          <StatusBreakdownPopover
            title="All platforms"
            segments={totalSegments}
            footer={`${count} ${countLabel} · ${statusTotal} platform statuses`}
          />
        </HoverCardContent>
      </HoverCard>

      {ringPlatforms.map((platform) => {
        const segments = getPlatformRollupSegments(rollup, platform);
        // Summed from the segments, not read from `rollup.totals`, so the footer
        // count and the rows above it can never disagree.
        const platformTotal = segments.reduce((sum, segment) => sum + segment.count, 0);
        const Icon = PLATFORM_ICONS[platform];
        const label = PLATFORM_LABELS[platform];

        return (
          <HoverCard key={platform} openDelay={150}>
            <HoverCardTrigger asChild>
              <span className={TRIGGER_CLASS}>
                <StatusRing segments={segments} size={size} label={describeRing(label, segments)}>
                  <Icon className={`${centerIcon} text-muted-foreground`} />
                </StatusRing>
              </span>
            </HoverCardTrigger>
            <HoverCardContent className="w-60 p-3">
              <StatusBreakdownPopover
                title={label}
                icon={Icon}
                segments={segments}
                footer={`${platformTotal} ${platformCountLabel} on ${label}`}
              />
            </HoverCardContent>
          </HoverCard>
        );
      })}
    </div>
  );
}
