import type { ElkLayoutOptions } from "@/lib/utils/elk-layout";

export type SystemLayoutMode = "tiered" | "organic";

// Tiered: views feed APIs feed data models — pin the tiers regardless of edge
// shape (spike-verified partitioning; orphans stay in their tier).
export const SYSTEM_TIERED_LAYOUT_OPTIONS: ElkLayoutOptions = {
  algorithm: "layered",
  direction: "DOWN",
  layoutEdgeTypes: ["calls", "displays", "queries"],
  partitionByNodeType: { view: 0, apiEndpoint: 1, dataModel: 2 },
};

// Organic: force-directed structure with overlap removal — at whole-product
// scale the tiered rendition degenerates into an unreadably wide ribbon
// (docs/spec/maps.md § MapDefinition, layout.algorithm).
export const SYSTEM_ORGANIC_LAYOUT_OPTIONS: ElkLayoutOptions = {
  algorithm: "organic",
  layoutEdgeTypes: ["calls", "displays", "queries"],
};

export function systemLayoutOptions(mode: SystemLayoutMode): ElkLayoutOptions {
  return mode === "tiered" ? SYSTEM_TIERED_LAYOUT_OPTIONS : SYSTEM_ORGANIC_LAYOUT_OPTIONS;
}
