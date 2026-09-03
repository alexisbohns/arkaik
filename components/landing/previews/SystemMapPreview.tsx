"use client";

import { useMemo } from "react";
import { buildProductUsageIndex, resolveMapDisplay, type MapDefinition } from "@arkaik/schema";
import { SystemCanvas } from "@/components/graph/SystemCanvas";
import { FIXTURES } from "@/components/landing/fixtures";
import type { PreviewProps } from "@/components/landing/previews/types";
import { resolveProductScope, type ProductGraph } from "@/lib/utils/product-scope";

const [ANCHOR_ID] = FIXTURES["system-map"].nodeIds!;

const DEFINITION: MapDefinition = {
  id: "landing-system",
  kind: "system",
  title: "System",
  root_node_id: ANCHOR_ID,
  layout: { algorithm: "layered" },
};

/** The system tiers around one data model of Arkaik's own map, tiered, read-only. */
export function SystemMapPreview({ bundle }: PreviewProps) {
  const props = useMemo(() => {
    const nodesById = new Map(bundle.nodes.map((node) => [node.id, node]));
    const scope = resolveProductScope(bundle, null);
    const graph: ProductGraph = { edges: bundle.edges, nodesById, usageIndex: buildProductUsageIndex(bundle.nodes, bundle.edges) };
    return { scope, productScope: { scope, graph }, display: resolveMapDisplay(DEFINITION, bundle.project) };
  }, [bundle]);

  return (
    <SystemCanvas
      definition={DEFINITION}
      dataNodes={bundle.nodes}
      dataEdges={bundle.edges}
      display={props.display}
      productScope={props.productScope}
      layoutMode="tiered"
      minimapColor={props.display.minimap_color}
      readOnly
    />
  );
}
