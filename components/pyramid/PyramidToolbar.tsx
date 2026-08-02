"use client";

import { CircleCheckBigIcon, CircleDashedIcon, LayersIcon, LayoutGridIcon, ListIcon } from "lucide-react";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";

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
}

export function PyramidToolbar({
  viewMode,
  filterStep,
  onViewModeChange,
  onFilterStepChange,
}: PyramidToolbarProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card/70 p-3">
      <SegmentedControl
        options={FILTER_STEPS}
        value={filterStep}
        onChange={onFilterStepChange}
        ariaLabel="Which value elements to show"
      />
      <SegmentedControl
        options={VIEW_MODES}
        value={viewMode}
        onChange={onViewModeChange}
        ariaLabel="Display mode"
      />
    </div>
  );
}
