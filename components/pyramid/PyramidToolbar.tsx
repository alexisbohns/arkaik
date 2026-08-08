"use client";

import { CircleCheckBigIcon, CircleDashedIcon, LayersIcon, LayoutGridIcon, ListIcon } from "lucide-react";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { ProductOverrideSelector } from "@/components/layout/ProductOverrideSelector";
import { Toolbar, ToolbarGroup } from "@/components/layout/Toolbar";
import type { ProjectBundle } from "@/lib/data/types";

export type PyramidViewMode = "cards" | "list";
/** Which slice of the 30 elements to show. Most are unserved most of the time. */
export type PyramidFilterStep = "empty" | "all" | "addressed";

const VIEW_MODES: readonly SegmentedControlOption<PyramidViewMode>[] = [
  { id: "cards", label: "Cards", icon: LayoutGridIcon },
  { id: "list", label: "List", icon: ListIcon },
];

// CircleCheckBig is STATUS_ICONS.live in node-styles.ts — the repo's existing
// "delivered" mark, reused here so "addressed" reads the same way.
const FILTER_STEPS: readonly SegmentedControlOption<PyramidFilterStep>[] = [
  { id: "empty", label: "Empty only", icon: CircleDashedIcon },
  { id: "all", label: "All values", icon: LayersIcon },
  { id: "addressed", label: "Addressed only", icon: CircleCheckBigIcon },
];

interface PyramidToolbarProps {
  viewMode: PyramidViewMode;
  filterStep: PyramidFilterStep;
  onViewModeChange: (mode: PyramidViewMode) => void;
  onFilterStepChange: (step: PyramidFilterStep) => void;
  projectId: string;
  /** The bundle products live on. `undefined` until `useProject` resolves. */
  project: ProjectBundle | undefined;
}

export function PyramidToolbar({
  viewMode,
  filterStep,
  onViewModeChange,
  onFilterStepChange,
  projectId,
  project,
}: PyramidToolbarProps) {
  return (
    <Toolbar>
      {/* The control and the step filter are both "what am I looking at"; the
          view mode is "how" — so the toolbar's justify-between still separates
          two meaningful groups rather than three loose controls. */}
      <ToolbarGroup>
        <ProductOverrideSelector projectId={projectId} project={project} />
        <SegmentedControl
          options={FILTER_STEPS}
          value={filterStep}
          onChange={onFilterStepChange}
          ariaLabel="Which value elements to show"
        />
      </ToolbarGroup>
      <SegmentedControl
        options={VIEW_MODES}
        value={viewMode}
        onChange={onViewModeChange}
        ariaLabel="Display mode"
      />
    </Toolbar>
  );
}
