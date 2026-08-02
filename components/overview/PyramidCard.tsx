"use client";

import { PlatformRingSet } from "@/components/graph/nodes/PlatformRingSet";
import { VALUE_TIERS_CONFIG } from "@/lib/config/values";
import { mergeRollups } from "@/lib/utils/platform-status";
import type { PyramidTier } from "@/lib/utils/pyramid";
import { OverviewSection } from "./OverviewSection";

const TIER_LABEL = new Map(VALUE_TIERS_CONFIG.map((t) => [t.id, t.label]));

interface PyramidCardProps {
  tiers: PyramidTier[];
  projectId: string;
}

/** Value delivery at a glance — one ring set per tier (spec §9.3). */
export function PyramidCard({ tiers, projectId }: PyramidCardProps) {
  return (
    <OverviewSection title="Value pyramid" href={`/project/${projectId}/pyramid`} linkLabel="Pyramid">
      <div className="flex flex-col gap-2.5">
        {tiers.map((tier) => {
          const rollup = mergeRollups(...tier.elements.map((element) => element.rollup));
          // Elements addressed, not acceptances summed: an acceptance carrying two
          // values from the same tier would be counted twice by a naive sum, so the
          // one number that is exactly true here is how many of the tier's elements
          // anything speaks to at all.
          const addressed = tier.elements.filter((element) => element.acceptanceCount > 0).length;

          return (
            <div key={tier.tier} className="flex items-center justify-between gap-3">
              <span className="truncate text-xs text-muted-foreground">
                {TIER_LABEL.get(tier.tier)}
                <span className="ml-1.5 opacity-70">
                  {addressed}/{tier.elements.length}
                </span>
              </span>
              <PlatformRingSet
                rollup={rollup}
                count={addressed}
                size="sm"
                countLabel="elements addressed"
                platformCountLabel="platform statuses"
              />
            </div>
          );
        })}
      </div>
    </OverviewSection>
  );
}
