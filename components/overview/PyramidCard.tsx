"use client";

import { PlatformGaugeList } from "@/components/graph/nodes/PlatformGaugeList";
import { VALUE_TIERS_CONFIG } from "@/lib/config/values";
import { PLATFORMS } from "@/lib/config/platforms";
import { mergeRollups } from "@/lib/utils/platform-status";
import type { PyramidTier } from "@/lib/utils/pyramid";
import { OverviewSection } from "./OverviewSection";

const TIER_LABEL = new Map(VALUE_TIERS_CONFIG.map((t) => [t.id, t.label]));
const ALL_PLATFORMS = PLATFORMS.map((p) => p.id);

interface PyramidCardProps {
  tiers: PyramidTier[];
  projectId: string;
}

/** Value delivery at a glance — four tier gauges (spec §9.3). */
export function PyramidCard({ tiers, projectId }: PyramidCardProps) {
  return (
    <OverviewSection title="Value pyramid" href={`/project/${projectId}/pyramid`} linkLabel="Pyramid">
      <div className="flex flex-col gap-3">
        {tiers.map((tier) => {
          const rollup = mergeRollups(...tier.elements.map((element) => element.rollup));
          const served = tier.elements.reduce((sum, element) => sum + element.acceptanceCount, 0);
          return (
            <div key={tier.tier} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{TIER_LABEL.get(tier.tier)}</span>
                <span>{served}</span>
              </div>
              <PlatformGaugeList rollup={rollup} platforms={ALL_PLATFORMS} compact />
            </div>
          );
        })}
      </div>
    </OverviewSection>
  );
}
