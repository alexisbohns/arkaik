"use client";

import type { Edge, Node } from "@/lib/data/types";
import type { ProductScope } from "@/lib/utils/product-scope";
import { PromiseMarks } from "@/components/acceptances/kit";
import { useAcceptancePanel } from "@/lib/hooks/useAcceptancePanel";

/**
 * Where an acceptance stands, in its header: the promise's marks — one glyph
 * meter per platform in scope — after the id, in the same grammar every
 * acceptances surface draws (colour = status, platform = glyph, not applicable
 * = absence).
 *
 * A sibling of the header row, not a child: `data-acceptance-marks` is what the
 * stylesheet keys on (app/m3/acceptances-panel.css) to let the row wrap, and, in
 * a very narrow panel, to break the marks onto a line of their own.
 */
export function AcceptanceHeaderMarks({
  node,
  allNodes,
  allEdges,
  scope,
  readOnly,
}: {
  node: Node;
  allNodes?: Node[];
  allEdges?: Edge[];
  scope?: Pick<ProductScope, "isMultiPlatform" | "platforms">;
  readOnly: boolean;
}) {
  const { promise } = useAcceptancePanel({ node, allNodes, allEdges, scope, readOnly });
  return (
    <span className="kap-hdr" data-acceptance-marks role="group" aria-label="Availability">
      <PromiseMarks promise={promise} size="sm" />
    </span>
  );
}
