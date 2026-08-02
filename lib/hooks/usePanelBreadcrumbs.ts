"use client";

import { useMemo } from "react";
import type { Node } from "@/lib/data/types";
import { useProjectPanels } from "@/lib/hooks/useProjectPanels";
import { RAW_PANEL_KEY } from "@/lib/utils/project-panels";

export interface PanelCrumb {
  label: string;
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
 * Returns an empty list when nothing is open, which is the header's signal to
 * show the page's own meta line instead.
 */
export function usePanelBreadcrumbs(rootLabel: string, nodes: Node[] = NO_NODES): PanelCrumb[] {
  const { entries, unwindTo } = useProjectPanels();

  const titlesById = useMemo(
    () => new Map(nodes.map((node) => [node.id, node.title])),
    [nodes],
  );

  return useMemo(() => {
    if (entries.length === 0) return [];

    const crumbs: PanelCrumb[] = [{ label: rootLabel, onClick: () => unwindTo(0) }];

    entries.forEach((entry, index) => {
      const label =
        entry.key === RAW_PANEL_KEY ? "Raw bundle" : titlesById.get(entry.key) ?? entry.key;
      const isLast = index === entries.length - 1;

      crumbs.push({ label, onClick: isLast ? undefined : () => unwindTo(index + 1) });
    });

    return crumbs;
  }, [entries, rootLabel, titlesById, unwindTo]);
}
