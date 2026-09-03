"use client";

import dynamic from "next/dynamic";
import { useCallback, useMemo, useState } from "react";
import { buildProductUsageIndex, resolveMapDisplay, type MapDefinition } from "@arkaik/schema";
import { FIXTURES } from "@/components/landing/fixtures";
import type { PreviewProps } from "@/components/landing/previews/types";
import { resolveProductScope, type ProductGraph } from "@/lib/utils/product-scope";

// Client-only, for the same reason as JourneyMapPreview.
const SystemCanvas = dynamic(() => import("@/components/graph/SystemCanvas").then((m) => m.SystemCanvas), { ssr: false });

const [ANCHOR_ID] = FIXTURES["system-map"].nodeIds!;

const DEFINITION: MapDefinition = {
  id: "landing-system",
  kind: "system",
  title: "System",
  root_node_id: ANCHOR_ID,
  // One hop around the anchor: the views and endpoints that touch this model.
  depth: 1,
  layout: { algorithm: "organic" },
};

/** The system tiers around one data model of Arkaik's own map, organic around the anchor, read-only. */
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
      minimapColor={props.display.minimap_color}
      fitSignal={fitSignal}
      onLayoutVersion={reframe}
      readOnly
    />
  );
}
