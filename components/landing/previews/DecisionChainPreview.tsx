import { FIXTURES } from "@/components/landing/fixtures";
import { ReadOnlyDecisionLog } from "@/components/landing/previews/client/ReadOnlyDecisionLog";
import type { PreviewProps } from "@/components/landing/previews/types";
import { sliceBundle } from "@/lib/landing/slice";

/**
 * Two Pebbles decisions, one superseding the other, as the real log draws
 * them. A server component: only the props the leaf renders cross to the
 * client.
 */
export function DecisionChainPreview({ bundle }: PreviewProps) {
  const slice = sliceBundle(bundle, FIXTURES["decision-chain"].nodeIds!);
  return (
    <div className="h-full overflow-hidden p-3">
      <ReadOnlyDecisionLog decisions={slice.nodes} allEdges={slice.edges} journal={slice.journal} statusFilter="all" />
    </div>
  );
}
