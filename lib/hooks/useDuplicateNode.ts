"use client";

import { useCallback } from "react";
import { toast } from "sonner";

import type { Node } from "@/lib/data/types";
import { useNodes } from "@/lib/hooks/useNodes";
import { useProjectPanels } from "@/lib/hooks/useProjectPanels";
import { generateNodeId } from "@/lib/utils/id";
import { duplicateNodeDraft } from "@/lib/utils/node-duplicate";

/**
 * The `onDuplicate` every writable surface hands its panels: copy this record
 * under a fresh id, then open the copy.
 *
 * A hook rather than a helper each page wires itself. The three parts that
 * looked per-surface are not: all six writable pages read `addNode` from
 * `useNodes(projectId)`, `openNode` from `useProjectPanels()`, and mint ids
 * against their own node list — so a per-page handler was the same fourteen
 * lines six times, and the first pass at it shipped only three of the six
 * because nothing made the other three visible. A reader who meets a different
 * menu on every page cannot infer the rule, because there is none.
 *
 * Reading `useNodes` here costs nothing: it is a projection of one cached
 * bundle entry, so this call joins the page's own rather than fetching again.
 *
 * `generateNodeId` disambiguates against the ids already in use with `-2`,
 * `-3`, … suffixes, which is exactly what a second duplicate of the same record
 * needs.
 *
 * Failure is reported and swallowed: a rejected write leaves the original panel
 * exactly as it was, which is the whole of what the reader needs from it — no
 * rows were typed and nothing is pending recovery. (That is the opposite of the
 * split dialog, which rethrows so a failure keeps the reader's rows on screen.)
 */
export function useDuplicateNode(projectId: string) {
  const { nodes, addNode } = useNodes(projectId);
  const { openNode } = useProjectPanels();

  return useCallback(
    async (node: Node) => {
      try {
        const created = await addNode(
          duplicateNodeDraft(node, generateNodeId(node.species, node.title, nodes.map((n) => n.id))),
        );
        toast.success(`Duplicated as "${created.title}".`);
        openNode({ nodeId: created.id });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        toast.error(`Unable to duplicate this node: ${message}`);
      }
    },
    [addNode, nodes, openNode],
  );
}
