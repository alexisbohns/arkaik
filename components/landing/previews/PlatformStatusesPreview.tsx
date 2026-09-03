import { PlatformList } from "@/components/graph/nodes/PlatformList";
import { StatusBadge } from "@/components/layout/StatusBadge";
import { FIXTURES } from "@/components/landing/fixtures";
import type { PreviewProps } from "@/components/landing/previews/types";
import { addNodeToRollup, createEmptyRollup, getEffectivePlatformStatuses, getRollupDisplayStatus } from "@/lib/utils/platform-status";

const [VIEW_ID] = FIXTURES["platform-statuses"].nodeIds!;

/**
 * One view of the Pebbles example: its rollup badge above, its per-platform
 * marks below — the same primitives the node cards and the detail panel draw.
 * A server component: only the props the leaf renders cross to the client.
 */
export function PlatformStatusesPreview({ bundle }: PreviewProps) {
  const node = bundle.nodes.find((n) => n.id === VIEW_ID);
  if (!node) return null;
  const platformStatuses = getEffectivePlatformStatuses(node, bundle.nodes, bundle.edges);
  const displayStatus = getRollupDisplayStatus(addNodeToRollup(createEmptyRollup(), node), node.status);
  const blockedBy = typeof node.metadata?.blocked_by === "string" ? node.metadata.blocked_by : undefined;

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
      <div className="flex items-center gap-3">
        <span className="text-base font-medium">{node.title}</span>
        <StatusBadge status={displayStatus} blockedBy={blockedBy} />
      </div>
      <PlatformList platforms={node.platforms} platformStatuses={platformStatuses} />
    </div>
  );
}
