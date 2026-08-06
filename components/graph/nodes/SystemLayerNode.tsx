"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { SPECIES } from "@/lib/config/species";
import type { StatusId } from "@/lib/config/statuses";
import type { NodeMetadata } from "@/lib/data/types";
import { StatusBadge } from "@/components/layout/StatusBadge";
import { SPECIES_GRAPH_ICONS } from "@/lib/config/species-icons";
import { STATUS_GHOST_STYLES, SYSTEM_LAYER_STYLES, type SystemLayerSpecies } from "./node-styles";

/**
 * The parallel-layer card, once — `DataModelNode` and `ApiEndpointNode` were two
 * byte-identical 39-line files differing only in icon, accent color and fallback
 * label (audit `factorization-8`).
 *
 * A factory rather than one component reading `data.species`, because React Flow
 * keys `nodeTypes` by name and the two registrations must stay distinct: the
 * icon and the accent are then resolved once per species at module load, not on
 * every canvas render, and a card cannot render an accent its `nodeType` did not
 * ask for.
 *
 * Every axis it varies on is read from a shared table — the glyph from the
 * canvas species vocabulary, the accent from {@link SYSTEM_LAYER_STYLES} (which
 * the minimap fill reads too), the label from `SPECIES`. A third parallel-layer
 * species is a line in each of those, not a third copy of this file.
 */
function makeSystemLayerNode(species: SystemLayerSpecies) {
  const Icon = SPECIES_GRAPH_ICONS[species];
  const { border, icon } = SYSTEM_LAYER_STYLES[species];
  // The species' own singular label — what the card falls back to when a node
  // reaches the canvas with no title of its own.
  const fallbackLabel = SPECIES.find((entry) => entry.id === species)?.label ?? species;

  function SystemLayerNode({ data }: NodeProps) {
    const status = (data.status as StatusId) ?? "idea";
    const label = String(data.label ?? fallbackLabel);
    const blockedBy = (data.metadata as NodeMetadata | undefined)?.blocked_by;
    const ghostClass = STATUS_GHOST_STYLES[status];

    return (
      <>
        <Handle type="target" position={Position.Top} className="opacity-0" />
        <div
          aria-label={label}
          className={`flex flex-col gap-2 w-48 px-3 py-2.5 rounded-lg bg-background border-2 ${border} shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${ghostClass.wrapper} ${ghostClass.border}`}
        >
          <div className="flex items-center gap-2">
            <Icon className={`w-4 h-4 shrink-0 ${icon}`} />
            <span title={label} className="text-sm font-medium leading-tight line-clamp-2 flex-1">
              {label}
            </span>
          </div>
          <StatusBadge status={status} blockedBy={blockedBy} className="self-start" />
        </div>
        <Handle type="source" position={Position.Bottom} className="opacity-0" />
      </>
    );
  }

  // Named per species, so React DevTools and error stacks still say which card
  // is on screen — the one thing a shared implementation would otherwise cost.
  SystemLayerNode.displayName = `SystemLayerNode(${species})`;

  /** Memoized — see FlowNode: spotlight hovers must not re-render card internals. */
  return memo(SystemLayerNode);
}

export const DataModelNode = makeSystemLayerNode("data-model");
export const ApiEndpointNode = makeSystemLayerNode("api-endpoint");
