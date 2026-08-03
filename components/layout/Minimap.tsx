"use client";

import { useCallback } from "react";
import { MiniMap as ReactFlowMinimap, type Node } from "@xyflow/react";
import { useTheme } from "next-themes";
import type { MapMinimapColorMode } from "@arkaik/schema";
import type { SpeciesId } from "@/lib/config/species";
import type { StatusId } from "@/lib/config/statuses";
import { SPECIES_TO_NODE_TYPE } from "@/lib/utils/graph-build";
import { SPECIES_MINIMAP_FILL, STATUS_MINIMAP_FILL } from "@/components/graph/nodes/node-styles";

/**
 * React Flow node type → species, derived from the forward map rather than
 * spelled out again, so registering a species can't leave the minimap behind.
 */
const NODE_TYPE_TO_SPECIES = Object.fromEntries(
  Object.entries(SPECIES_TO_NODE_TYPE).map(([species, nodeType]) => [nodeType, species as SpeciesId]),
) as Record<string, SpeciesId>;

interface MinimapProps {
  /**
   * What a node's fill encodes (docs/spec/maps.md § Display Options). Defaults
   * to status, matching DEFAULT_MAP_DISPLAY — a bird's-eye view is most often
   * asked where the product stands.
   */
  colorBy?: MapMinimapColorMode;
}

export function Minimap({ colorBy = "status" }: MinimapProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  /**
   * A function, not a string: React Flow only funnels a string `nodeColor`
   * into the `--xy-minimap-node-background-color-props` CSS variable, which is
   * one fill for the whole map. Per-node color has to come from here.
   */
  const nodeColor = useCallback((node: Node) => {
    const fallback = isDark ? "#94a3b8" : "#64748b";

    if (colorBy === "species") {
      const species = node.type ? NODE_TYPE_TO_SPECIES[node.type] : undefined;
      return species ? SPECIES_MINIMAP_FILL[species] : fallback;
    }

    const status = node.data?.status as StatusId | undefined;
    return (status && STATUS_MINIMAP_FILL[status]) || fallback;
  }, [colorBy, isDark]);

  return (
    <ReactFlowMinimap
      bgColor={isDark ? "#111827" : "#f8fafc"}
      nodeColor={nodeColor}
      nodeStrokeColor={nodeColor}
      // The mask paints everything *outside* the viewport. Transparent meant the
      // focus zone was carried by its 1.5px stroke alone — invisible on a dense
      // map. Dimming the surroundings is what makes "you are here" readable.
      maskColor={isDark ? "rgba(17, 24, 39, 0.65)" : "rgba(148, 163, 184, 0.35)"}
      maskStrokeColor={isDark ? "#60a5fa" : "#3b82f6"}
      nodeStrokeWidth={2}
      pannable
      zoomable
    />
  );
}
