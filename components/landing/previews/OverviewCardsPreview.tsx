"use client";

import { useMemo } from "react";
import { OverviewLayoutProvider } from "@/components/overview/OverviewLayoutContext";
import { PlatformGaugesCard } from "@/components/overview/PlatformGaugesCard";
import { ReleasePulseCard } from "@/components/overview/ReleasePulseCard";
import type { PreviewProps } from "@/components/landing/previews/types";
import { computeProductRollup, computeReleasePulse } from "@/lib/utils/coverage";
import { getRollupPlatforms } from "@/lib/utils/platform-status";

/**
 * The gauges row and the release pulse, from the Pebbles example: the gauges
 * need two platforms to draw rings and the self-map is web-only.
 */
export function OverviewCardsPreview({ bundle }: PreviewProps) {
  const props = useMemo(() => {
    const rollup = computeProductRollup(bundle.nodes, bundle.edges);
    const nodesById = new Map(bundle.nodes.map((node) => [node.id, node]));
    return { rollup, platforms: getRollupPlatforms(rollup), releases: computeReleasePulse(bundle.journal ?? [], { nodesById }) };
  }, [bundle]);

  return (
    // Grid, not rows: the rows rendition assumes the Overview page's own grid.
    <OverviewLayoutProvider value="grid">
    <div className="grid h-full gap-4 overflow-hidden p-4 lg:grid-cols-2">
      <PlatformGaugesCard rollup={props.rollup} platforms={props.platforms} projectId={bundle.project.id} />
      <ReleasePulseCard releases={props.releases.slice(0, 3)} projectId={bundle.project.id} />
    </div>
    </OverviewLayoutProvider>
  );
}
