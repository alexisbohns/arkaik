"use client";

import { useCallback } from "react";
import { toast } from "sonner";

import type { Node } from "@/lib/data/types";
import { useNodes } from "@/lib/hooks/useNodes";
import { useProjectPanels } from "@/lib/hooks/useProjectPanels";
import { duplicateNodeDraft } from "@/lib/utils/node-duplicate";

/**
 * Write the copy `DuplicateNodeDialog` just named, then open its panel.
 *
 * Called in exactly one place — `ProjectPanels`, which owns the dialog for the
 * whole stack. A hook rather than a function on that component because the two
 * things it needs are hooks: `addNode` from `useNodes(projectId)` and `openNode`
 * from `useProjectPanels()`. Reading `useNodes` here costs nothing; it is a
 * projection of one cached bundle entry, so this joins the surface's own read
 * rather than fetching again.
 *
 * It mints nothing. The name and the id are the reader's, decided in the dialog
 * and passed through — see `duplicateNodeDraft` for why that is not a detail.
 *
 * Failure is reported and swallowed: a rejected write leaves the panel behind
 * the dialog exactly as it was, and there is nothing pending recovery. (That is
 * the opposite of the split dialog, which rethrows so a failure keeps the
 * reader's typed rows on screen.)
 */
export function useDuplicateNode(projectId: string) {
  const { addNode } = useNodes(projectId);
  const { openNode } = useProjectPanels();

  return useCallback(
    async (node: Node, named: { id: string; title: string }) => {
      try {
        const created = await addNode(duplicateNodeDraft(node, named));
        toast.success(`Duplicated as "${created.title}".`);
        openNode({ nodeId: created.id });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        toast.error(`Unable to duplicate this node: ${message}`);
      }
    },
    [addNode, openNode],
  );
}
