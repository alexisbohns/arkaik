"use client";

import { PyramidIcon } from "lucide-react";
import { PlatformAvailability } from "@/components/graph/nodes/PlatformAvailability";
import type { PlatformId } from "@/lib/config/platforms";
import { VALUE_TIERS_CONFIG } from "@/lib/config/values";
import { mergeRollups } from "@/lib/utils/platform-status";
import type { PyramidTier } from "@/lib/utils/pyramid";
import { useOverviewLayoutContext } from "./OverviewLayoutContext";
import { OverviewSection } from "./OverviewSection";
import { ValuePyramidWheels } from "./ValuePyramidWheels";

const TIER_LABEL = new Map(VALUE_TIERS_CONFIG.map((t) => [t.id, t.label]));

interface PyramidCardProps {
  tiers: PyramidTier[];
  /** The scope's effective platforms — rings at two or more, one bar below. */
  platforms: PlatformId[];
  projectId: string;
}

/**
 * Value delivery at a glance — one availability set per tier (spec §9.3).
 *
 * `PlatformAvailability`, not `PlatformRingSet`, for the same reason the Pyramid
 * page's own element cards use it: the shape is the scope's business, and a card
 * that picked rings for itself would show three of them for a web-only product
 * two of whose rings can only ever be empty.
 */
export function PyramidCard({ tiers, platforms, projectId }: PyramidCardProps) {
  // Same "elements addressed" arithmetic as each row below, summed once for the
  // header — never acceptances, for the double-counting reason stated there.
  const elementCount = tiers.reduce((sum, tier) => sum + tier.elements.length, 0);
  const addressedCount = tiers.reduce(
    (sum, tier) => sum + tier.elements.filter((element) => element.acceptanceCount > 0).length,
    0,
  );
  // The wheel pyramid needs the width of a full row: thirty rings in seven
  // columns is a shape at 1fr and a smudge inside a half-width card.
  const asWheels = useOverviewLayoutContext() === "rows";

  return (
    <OverviewSection
      title="Value pyramid"
      icon={PyramidIcon}
      description="What the product is worth to the people using it — and where it says nothing yet."
      subtitle={`${addressedCount}/${elementCount} elements addressed across ${tiers.length} tier${tiers.length === 1 ? "" : "s"}`}
      href={`/project/${projectId}/pyramid`}
      linkLabel="Pyramid"
    >
      {asWheels ? (
        <ValuePyramidWheels
          tiers={tiers}
          hrefForValue={(value) => `/project/${projectId}/acceptances?value=${encodeURIComponent(value)}`}
        />
      ) : (
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
              <PlatformAvailability
                rollup={rollup}
                platforms={platforms}
                count={addressed}
                size="sm"
                countLabel="elements addressed"
                platformCountLabel="platform statuses"
              />
            </div>
          );
          })}
        </div>
      )}
    </OverviewSection>
  );
}
