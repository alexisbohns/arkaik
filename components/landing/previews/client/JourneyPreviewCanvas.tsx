"use client";

import dynamic from "next/dynamic";
import { useCallback, useMemo, useState } from "react";
import { buildProductUsageIndex, resolveMapDisplay, type MapDefinition } from "@arkaik/schema";
import type { ProjectBundle } from "@/lib/data/types";
import { computeViewApiRelations, resolveJourneySelection } from "@/lib/utils/journey-graph";
import { resolveProductScope, type ProductGraph } from "@/lib/utils/product-scope";

// Client-only: the canvas styles itself by the resolved theme, which the server
// cannot know, and React Flow is not needed for first paint.
const JourneyCanvas = dynamic(() => import("@/components/graph/JourneyCanvas").then((m) => m.JourneyCanvas), { ssr: false });

interface JourneyPreviewCanvasProps {
  bundle: ProjectBundle;
  definition: MapDefinition;
  /** Flow ids to render expanded; empty for a collapsed top level. */
  expandedFlowIds: readonly string[];
}

/**
 * A read-only journey over a pre-sliced bundle. Every input is a pure function
 * over the bundle — the same ones `JourneyMap` calls through hooks. Shared by
 * the one-flow preview (A1) and the whole-product one (E2).
 */
export function JourneyPreviewCanvas({ bundle, definition, expandedFlowIds }: JourneyPreviewCanvasProps) {
  const props = useMemo(() => {
    const dataNodes = bundle.nodes;
    const dataEdges = bundle.edges;
    const nodesById = new Map(dataNodes.map((node) => [node.id, node]));
    const scope = resolveProductScope(bundle, null);
    const graph: ProductGraph = { edges: dataEdges, nodesById, usageIndex: buildProductUsageIndex(dataNodes, dataEdges) };
    // A definition without a root means "the whole product": every parentless
    // flow as a card. The anchor chain would otherwise fall through to the
    // project's front door (`project.root_node_id`, a view) and draw only its
    // own compose chain, so the project record is withheld from the anchor.
    const project = definition.root_node_id ? bundle.project : null;
    const selection = resolveJourneySelection({ definition, dataNodes, dataEdges, project, scope, graph });
    return {
      scope,
      selection,
      display: resolveMapDisplay(definition, bundle.project),
      viewApiRelationsByViewId: computeViewApiRelations(dataEdges, nodesById),
      expandedFlows: new Set(expandedFlowIds),
      dataEdges,
    };
  }, [bundle, definition, expandedFlowIds]);

  // Re-frame once ELK lands: the canvas's one-time fitView runs over the
  // {0,0} placeholders, which would leave the preview zoomed onto one card.
  const [fitSignal, setFitSignal] = useState(0);
  const reframe = useCallback(() => setFitSignal((value) => value + 1), []);

  // The fixture test is the gate; this `null` is not a fallback to design around.
  if (props.selection.emptyReason !== null) return null;

  return (
    <JourneyCanvas
      dataNodes={props.selection.nodes}
      dataEdges={props.dataEdges}
      nodesById={props.selection.nodesById}
      composeParentByChild={props.selection.composeParentByChild}
      explicitRootNode={props.selection.anchorNode}
      composeClosure={props.selection.composeClosure}
      expandedFlows={props.expandedFlows}
      display={props.display}
      viewApiRelationsByViewId={props.viewApiRelationsByViewId}
      scope={props.scope}
      fitSignal={fitSignal}
      onLayout={reframe}
      readOnly
    />
  );
}
