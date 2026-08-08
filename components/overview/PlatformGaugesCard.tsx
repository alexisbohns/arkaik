"use client";

import { GaugeIcon } from "lucide-react";
import { PlatformGaugeList } from "@/components/graph/nodes/PlatformGaugeList";
import { PLATFORM_LABELS } from "@/components/graph/nodes/node-styles";
import type { PlatformId } from "@/lib/config/platforms";
import type { PlatformStatusRollup } from "@/lib/utils/platform-status";
import { OverviewSection } from "./OverviewSection";

interface PlatformGaugesCardProps {
  rollup: PlatformStatusRollup;
  /** Platforms with any counted work, in config order (getRollupPlatforms). */
  platforms: PlatformId[];
  projectId: string;
}

/** The flow cards' delivery gauges at product scale — every view, per platform. */
export function PlatformGaugesCard({ rollup, platforms, projectId }: PlatformGaugesCardProps) {
  return (
    <OverviewSection
      title="Platform delivery"
      icon={GaugeIcon}
      subtitle={
        platforms.length === 0
          ? "No counted view work yet."
          : `Every view's delivery status across ${platforms.length} platform${platforms.length === 1 ? "" : "s"}`
      }
      href={`/project/${projectId}/delivery`}
      linkLabel="Delivery"
    >
      {platforms.length > 0 && (
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
