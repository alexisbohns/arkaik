"use client";

import type { ReactNode } from "react";
import { PyramidIcon } from "lucide-react";
import { SectionHeading } from "@/components/layout/SectionHeading";
import { ValuePyramidWheels } from "@/components/overview/ValuePyramidWheels";
import type { ValueId } from "@/lib/config/values";
import type { PyramidTier } from "@/lib/utils/pyramid";

interface PyramidSummaryPaneProps {
  /** The full scoped pyramid — never the filtered list's slice. */
  tiers: PyramidTier[];
  onSelectValue: (value: ValueId) => void;
  /** Drawn under the heading — the page's way back to a closed directory. */
  action?: ReactNode;
}

/**
 * The Pyramid page's surface: the Overview card's header and its wheel pyramid,
 * stood upright to fit a column.
 *
 * It draws every tier whatever the directory's filter says — the filter narrows
 * what to scan, the pyramid is the whole picture the scan sits inside. A wheel
 * opens its element's panel, exactly as a row in the directory does.
 */
export function PyramidSummaryPane({ tiers, onSelectValue, action }: PyramidSummaryPaneProps) {
  // Elements addressed, never acceptances summed — the Overview card's
  // arithmetic, for its reason: an acceptance carrying two values of one tier
  // would be counted twice by a naive sum.
  const elementCount = tiers.reduce((sum, tier) => sum + tier.elements.length, 0);
  const addressedCount = tiers.reduce(
    (sum, tier) => sum + tier.elements.filter((element) => element.acceptanceCount > 0).length,
    0,
  );

  return (
    <div className="flex flex-col gap-8">
      <SectionHeading
        title="Value pyramid"
        icon={PyramidIcon}
        description="What the product is worth to the people using it — and where it says nothing yet."
        subtitle={`${addressedCount}/${elementCount} elements addressed across ${tiers.length} tier${tiers.length === 1 ? "" : "s"}`}
      />
      {action}
      <ValuePyramidWheels
        tiers={tiers}
        orientation="vertical"
        onSelectValue={onSelectValue}
      />
    </div>
  );
}
