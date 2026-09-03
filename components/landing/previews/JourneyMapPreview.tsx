"use client";

import dynamic from "next/dynamic";
import { useCallback, useMemo, useState } from "react";
import { buildProductUsageIndex, resolveMapDisplay, type MapDefinition } from "@arkaik/schema";
import { FIXTURES } from "@/components/landing/fixtures";
import type { PreviewProps } from "@/components/landing/previews/types";
import { computeViewApiRelations, resolveJourneySelection } from "@/lib/utils/journey-graph";
import { resolveProductScope, type ProductGraph } from "@/lib/utils/product-scope";

// Client-only: the canvas styles itself by the resolved theme, which the server
// cannot know, and React Flow is not needed for first paint.
const JourneyCanvas = dynamic(() => import("@/components/graph/JourneyCanvas").then((m) => m.JourneyCanvas), { ssr: false });

const [ROOT_FLOW_ID] = FIXTURES["journey-map"].nodeIds!;

const DEFINITION: MapDefinition = { id: "landing-journey", kind: "journey", title: "Journey", root_node_id: ROOT_FLOW_ID };

/**
 * One flow of Arkaik's own journey, expanded, read-only. Every input is a pure
 * function over the bundle — the same ones `JourneyMap` calls through hooks.
 */
export function JourneyMapPreview({ bundle }: PreviewProps) {
  const props = useMemo(() => {
    const dataNodes = bundle.nodes;
    const dataEdges = bundle.edges;
    const nodesById = new Map(dataNodes.map((node) => [node.id, node]));
    const scope = resolveProductScope(bundle, null);
    const graph: ProductGraph = { edges: dataEdges, nodesById, usageIndex: buildProductUsageIndex(dataNodes, dataEdges) };
    const selection = resolveJourneySelection({ definition: DEFINITION, dataNodes, dataEdges, project: bundle.project, scope, graph });
    return {
      scope,
      selection,
      display: resolveMapDisplay(DEFINITION, bundle.project),
      viewApiRelationsByViewId: computeViewApiRelations(dataEdges, nodesById),
      expandedFlows: new Set([ROOT_FLOW_ID]),
      dataEdges,
    };
  }, [bundle]);

  // Re-frame once ELK lands: the canvas's one-time fitView runs over the
  // {0,0} placeholders, which would leave the preview zoomed onto one card.
  const [fitSignal, setFitSignal] = useState(0);
  const reframe = useCallback(() => setFitSignal((value) => value + 1), []);

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
