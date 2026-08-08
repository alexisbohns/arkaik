"use client";

import { GaugeIcon } from "lucide-react";
import { PlatformGaugeList } from "@/components/graph/nodes/PlatformGaugeList";
import { PLATFORM_LABELS } from "@/components/graph/nodes/node-styles";
import type { PlatformId } from "@/lib/config/platforms";
import type { PlatformStatusRollup } from "@/lib/utils/platform-status";
import { useOverviewLayoutContext } from "./OverviewLayoutContext";
import { OverviewSection } from "./OverviewSection";
import { PlatformWheelTiles } from "./PlatformWheelTiles";

interface PlatformGaugesCardProps {
  rollup: PlatformStatusRollup;
  /** Platforms with any counted work, in config order (getRollupPlatforms). */
  platforms: PlatformId[];
  projectId: string;
}

/** The flow cards' delivery gauges at product scale — every view, per platform. */
export function PlatformGaugesCard({ rollup, platforms, projectId }: PlatformGaugesCardProps) {
  // The tiles need a platform each to be tiles at all. At one platform the row
  // would show a single tile, which reads as "the other two failed to load"
  // rather than "there is only one" — the same reason `PlatformAvailability`
  // drops to a bar below two platforms. So the wheels are the multi-platform
  // rendition only, and one platform keeps the gauge in both displays.
  const asTiles = useOverviewLayoutContext() === "rows" && platforms.length >= 2;

  return (
    <OverviewSection
      title="Platform delivery"
      icon={GaugeIcon}
      description="Which platforms the product is actually shipped on, view by view."
      subtitle={
        platforms.length === 0
          ? "No counted view work yet."
          : `Every view's delivery status across ${platforms.length} platform${platforms.length === 1 ? "" : "s"}`
      }
      href={`/project/${projectId}/delivery`}
      linkLabel="Delivery"
    >
      {platforms.length > 0 &&
        (asTiles ? (
          <PlatformWheelTiles rollup={rollup} platforms={platforms} countLabel="views" />
        ) : (
          <>
            <PlatformGaugeList rollup={rollup} platforms={platforms} showLabels />
            <div className="flex flex-wrap items-center gap-2">
              {platforms.map((platform) => (
                <span key={platform} className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                  {PLATFORM_LABELS[platform]} {rollup.totals[platform] ?? 0}
                </span>
              ))}
            </div>
          </>
        ))}
    </OverviewSection>
  );
}
