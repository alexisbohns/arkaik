"use client";

import dynamic from "next/dynamic";
import { useCallback, useMemo, useState } from "react";
import { buildProductUsageIndex, resolveMapDisplay } from "@arkaik/schema";
import { SYSTEM_DEFINITION } from "@/components/landing/previews/definitions";
import type { PreviewProps } from "@/components/landing/previews/types";
import { resolveProductScope, type ProductGraph } from "@/lib/utils/product-scope";

// Client-only, for the same reason as JourneyMapPreview.
const SystemCanvas = dynamic(() => import("@/components/graph/SystemCanvas").then((m) => m.SystemCanvas), { ssr: false });

const DEFINITION = SYSTEM_DEFINITION;

/**
 * One hop around a data model of Arkaik's own map: the views that render it,
 * read-only. The bundle arrives already sliced to that hop (lib/landing/prepare.ts).
 */
export function SystemMapPreview({ bundle }: PreviewProps) {
  const props = useMemo(() => {
    const nodesById = new Map(bundle.nodes.map((node) => [node.id, node]));
    const scope = resolveProductScope(bundle, null);
    const graph: ProductGraph = { edges: bundle.edges, nodesById, usageIndex: buildProductUsageIndex(bundle.nodes, bundle.edges) };
    return { scope, productScope: { scope, graph }, display: resolveMapDisplay(DEFINITION, bundle.project) };
  }, [bundle]);

  // Re-frame once ELK lands: the canvas's one-time fitView runs over the
  // {0,0} placeholders, which would leave the preview zoomed onto one card.
  const [fitSignal, setFitSignal] = useState(0);
  const reframe = useCallback(() => setFitSignal((value) => value + 1), []);

  return (
    <SystemCanvas
      definition={DEFINITION}
      dataNodes={bundle.nodes}
      dataEdges={bundle.edges}
      display={props.display}
      productScope={props.productScope}
      layoutMode="organic"
      fitSignal={fitSignal}
      onLayoutVersion={reframe}
      readOnly
    />
  );
}
