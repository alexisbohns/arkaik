"use client";

/**
 * The Acceptances directory's body: the view the reader chose, drawn from the one
 * model (lib/utils/acceptances-model.ts). The page owns data, filters and the
 * view switch; this owns what goes under them.
 *
 * Expansion follows the shipped rule: the toolbar's expand-all is the baseline, a
 * journey the reader clicked is an exception to it, and flipping the toggle clears
 * the exceptions so the toggle always means what it says.
 */
import { useState } from "react";
import type { Node } from "@/lib/data/types";
import type { AcceptancesModel } from "@/lib/utils/acceptances-model";
import { useQueryWriter } from "@/lib/hooks/useQueryWriter";
import type { DirectoryViewId } from "./directory-views";
import { ContentsView } from "./ContentsView";
import { MappingView } from "./MappingView";

function useExceptions(allExpanded: boolean) {
  const [exceptions, setExceptions] = useState<Set<string>>(new Set());
  const [synced, setSynced] = useState(allExpanded);
  if (allExpanded !== synced) {
    setSynced(allExpanded);
    setExceptions(new Set());
  }
  const isCollapsed = (key: string) => (allExpanded ? exceptions.has(key) : !exceptions.has(key));
  const toggle = (key: string) =>
    setExceptions((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  return { isCollapsed, toggle };
}

export function AcceptancesDirectory({
  model,
  view,
  allExpanded,
  onSelect,
}: {
  model: AcceptancesModel;
  view: DirectoryViewId;
  allExpanded: boolean;
  onSelect: (node: Node) => void;
}) {
  const journeys = useExceptions(allExpanded);
  const writeQuery = useQueryWriter();

  // Contents → Mapping: unfold the journey, then switch view. Mapping scrolls to `?mj=` once drawn.
  const openJourney = (key: string) => {
    if (journeys.isCollapsed(key)) journeys.toggle(key);
    writeQuery((q) => {
      q.set("view", "mapping");
      q.set("mj", key);
    });
  };

  return (
    <div data-acceptances-page data-acceptances-view={view} className="flex min-h-full flex-col">
      {view === "mapping" ? (
        <MappingView mapping={model.mapping} onSelect={onSelect} isCollapsed={journeys.isCollapsed} onToggleJourney={journeys.toggle} />
      ) : (
        <ContentsView mapping={model.mapping} onSelect={onSelect} onOpenJourney={openJourney} />
      )}
    </div>
  );
}
