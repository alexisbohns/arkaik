"use client";

import type { Edge, Node } from "@/lib/data/types";
import { buildAcceptancePanel, type AcceptancePanelModel } from "@/lib/utils/acceptances-model";
import type { ProductScope } from "@/lib/utils/product-scope";
import { useProjectId } from "@/lib/hooks/useProjectId";
import { useWeighing } from "@/lib/hooks/useWeighing";

/**
 * The acceptance panel's model for one record — what the header marks, the
 * Platforms rows and the "You are here" trail all render, so none of them
 * re-derives a rule (`lib/utils/acceptances-model.ts`).
 *
 * A surface that hands the panel no graph still gets an answer about the node
 * alone: it just cannot say where the promise lives.
 */
export function useAcceptancePanel(params: {
  node: Node;
  allNodes?: Node[];
  allEdges?: Edge[];
  scope?: Pick<ProductScope, "isMultiPlatform" | "platforms">;
  readOnly: boolean;
}): AcceptancePanelModel {
  const { node, allNodes, allEdges, scope, readOnly } = params;
  const { section } = useWeighing(useProjectId());
  const platforms = scope?.platforms ?? node.platforms;
  return buildAcceptancePanel({
    node,
    nodes: allNodes ?? [node],
    edges: allEdges ?? [],
    scope: scope ?? { isMultiPlatform: platforms.length > 1, platforms },
    weighingSection: section,
    readOnly,
  });
}
