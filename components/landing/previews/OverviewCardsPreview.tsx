import { PlatformGaugesCard } from "@/components/overview/PlatformGaugesCard";
import { ReleasePulseCard } from "@/components/overview/ReleasePulseCard";
import { OverviewGridLayout } from "@/components/landing/previews/client/OverviewGridLayout";
import type { PreviewProps } from "@/components/landing/previews/types";
import { computeProductRollup, computeReleasePulse } from "@/lib/utils/coverage";
import { getRollupPlatforms } from "@/lib/utils/platform-status";

/**
 * The gauges row and the release pulse, from the Pebbles example: the gauges
 * need two platforms to draw rings and the self-map is web-only. A server
 * component: only the props the leaf renders cross to the client.
 */
export function OverviewCardsPreview({ bundle }: PreviewProps) {
  const rollup = computeProductRollup(bundle.nodes, bundle.edges);
  const nodesById = new Map(bundle.nodes.map((node) => [node.id, node]));
  const platforms = getRollupPlatforms(rollup);
  const releases = computeReleasePulse(bundle.journal ?? [], { nodesById }).slice(0, 3);

  return (
    // Grid, not rows: the rows rendition assumes the Overview page's own grid.
    <OverviewGridLayout>
      <div className="grid h-full gap-4 overflow-hidden p-4 lg:grid-cols-2">
        <PlatformGaugesCard rollup={rollup} platforms={platforms} projectId={bundle.project.id} />
        <ReleasePulseCard releases={releases} projectId={bundle.project.id} />
      </div>
    </OverviewGridLayout>
  );
}
