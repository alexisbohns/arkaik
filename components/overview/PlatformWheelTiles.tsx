"use client";

import { PlatformRing, sortRingPlatforms } from "@/components/graph/nodes/PlatformRingSet";
import { PLATFORM_LABELS } from "@/components/graph/nodes/node-styles";
import type { PlatformId } from "@/lib/config/platforms";
import type { PlatformStatusRollup } from "@/lib/utils/platform-status";

interface PlatformWheelTilesProps {
  rollup: PlatformStatusRollup;
  /** Platforms with any counted work — the caller's list, re-sorted to ring order. */
  platforms: PlatformId[];
  /** Names what a tile's number counts. */
  countLabel?: string;
}

/**
 * One tile per platform: its delivery wheel, its name, and what it counts.
 *
 * The rows display's answer to the stacked gauge bars. A bar reads as a
 * proportion and nothing else, which is the right shape squeezed into a card;
 * given a full-width row, the wheel the rest of the app already uses for
 * delivery says the same thing in the idiom every other surface speaks, and the
 * tile gives it the label a bare ring has to be hovered for.
 *
 * The wheel itself is `PlatformRing` — this component owns the chrome around it
 * and nothing about the ring.
 */
export function PlatformWheelTiles({ rollup, platforms, countLabel = "views" }: PlatformWheelTilesProps) {
  return (
    <div className="flex flex-wrap gap-3">
      {sortRingPlatforms(platforms).map((platform) => {
        const total = rollup.totals[platform] ?? 0;

        return (
          <div
            key={platform}
            className="flex min-w-[9rem] flex-1 items-center gap-3 rounded-lg border bg-card px-3 py-2.5"
          >
            <PlatformRing rollup={rollup} platform={platform} size="lg" platformCountLabel={countLabel} />
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium">{PLATFORM_LABELS[platform]}</span>
              <span className="text-xs tabular-nums text-muted-foreground">
                {total} {countLabel}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
