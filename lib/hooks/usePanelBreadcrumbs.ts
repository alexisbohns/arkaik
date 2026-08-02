"use client";

import { useMemo } from "react";
import type { Node } from "@/lib/data/types";
import { useProjectPanels } from "@/lib/hooks/useProjectPanels";
import { buildPanelCrumbs } from "@/lib/utils/project-panels";

export interface PanelCrumb {
  label: string;
  /** Stable React key, carried through from `PanelCrumbSpec`. */
  id: string;
  /** Absent on the last crumb — you are already there. */
  onClick?: () => void;
}

const NO_NODES: Node[] = [];

/**
 * The panel trail, flattened for the header to render.
 *
 * `nodes` comes from the caller rather than a fetch of our own: `useNodes` holds
 * per-instance state, so a second copy here would show a node's old title in the
 * crumb after a rename went through the surface's copy.
 *
 * Labels and depths come from `buildPanelCrumbs`, which is pure and therefore
 * tested; what is left here is the React half — the context, the memoisation,
 * and binding each depth to `unwindTo`. Returns an empty list when nothing is
 * open, which is the header's signal to show the page's own meta line instead.
 */
export function usePanelBreadcrumbs(rootLabel: string, nodes: Node[] = NO_NODES): PanelCrumb[] {
  const { entries, unwindTo } = useProjectPanels();

  const titlesById = useMemo(
    () => new Map(nodes.map((node) => [node.id, node.title])),
    [nodes],
  );

  return useMemo(
    () =>
      buildPanelCrumbs(entries, rootLabel, (nodeId) => titlesById.get(nodeId)).map(
        ({ label, id, depth }) => ({
          label,
          id,
          onClick: depth === null ? undefined : () => unwindTo(depth),
        }),
      ),
    [entries, rootLabel, titlesById, unwindTo],
  );
}
