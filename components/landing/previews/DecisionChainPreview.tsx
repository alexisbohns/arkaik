"use client";

import { useMemo } from "react";
import { DecisionLog } from "@/components/decisions/DecisionLog";
import { FIXTURES } from "@/components/landing/fixtures";
import type { PreviewProps } from "@/components/landing/previews/types";
import { sliceBundle } from "@/lib/landing/slice";

/** Two Pebbles decisions, one superseding the other, as the real log draws them. */
export function DecisionChainPreview({ bundle }: PreviewProps) {
  const slice = useMemo(() => sliceBundle(bundle, FIXTURES["decision-chain"].nodeIds!), [bundle]);
  return (
    <div className="h-full overflow-hidden p-3">
      <DecisionLog decisions={slice.nodes} allEdges={slice.edges} journal={slice.journal} onSelect={() => {}} statusFilter="all" />
    </div>
  );
}
