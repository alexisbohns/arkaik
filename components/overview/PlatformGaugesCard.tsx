"use client";

import { GaugeIcon } from "lucide-react";
import { PlatformGaugeList } from "@/components/graph/nodes/PlatformGaugeList";
import { PLATFORM_LABELS } from "@/components/graph/nodes/node-styles";
import type { PlatformId } from "@/lib/config/platforms";
import type { PlatformStatusRollup } from "@/lib/utils/platform-status";
import { platformAvailabilityShape } from "@/lib/utils/product-scope";
import { useOverviewLayoutContext } from "./OverviewLayoutContext";
import { OverviewSection } from "./OverviewSection";
import { PlatformWheelTiles } from "./PlatformWheelTiles";

interface PlatformGaugesCardProps {
  rollup: PlatformStatusRollup;
  /** Platforms with any counted work, in config order (getRollupPlatforms). */
  platforms: PlatformId[];
  projectId: string;
}

/**
 * The flow cards' delivery gauges at product scale — every view, per platform.
 *
 * **Absent below two platforms**, on the same threshold and for the same reason
 * as `ParityCard`: this section exists to break delivery down *by platform*, and
 * with one platform the breakdown is the total. That total is what the Delivery
 * snapshot already says, in more useful detail — so the section is not a
 * shrunken version of itself here, it is a duplicate, and it goes.
 */
export function PlatformGaugesCard({ rollup, platforms, projectId }: PlatformGaugesCardProps) {
  const asTiles = useOverviewLayoutContext() === "rows";

  // The same threshold `ParityCard` is silenced by, read through the same
  // helper rather than a second `>= 2` written here.
  if (platformAvailabilityShape(platforms) === "bar") return null;

  return (
    <OverviewSection
      title="Platform delivery"
      icon={GaugeIcon}
      description="Which platforms the product is actually shipped on, view by view."
      subtitle={`Every view's delivery status across ${platforms.length} platforms`}
      href={`/project/${projectId}/delivery`}
      linkLabel="Delivery"
    >
      {asTiles ? (
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
      )}
    </OverviewSection>
  );
}
