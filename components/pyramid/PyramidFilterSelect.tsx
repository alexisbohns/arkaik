"use client";

import { CircleCheckBigIcon, CircleDashedIcon, LayersIcon, type LucideIcon } from "lucide-react";
import { FilterSelectTrigger } from "@/components/layout/FilterSelectTrigger";
import { Select, SelectContent, SelectItem } from "@/components/ui/select";
import { cn } from "@/lib/utils";

/** Which slice of the 30 elements to show. Most are unserved most of the time. */
export type PyramidFilterStep = "empty" | "all" | "addressed";

// CircleCheckBig is STATUS_ICONS.live in node-styles.ts — the repo's existing
// "delivered" mark, reused here so "addressed" reads the same way.
const FILTER_STEPS: readonly { id: PyramidFilterStep; label: string; icon: LucideIcon }[] = [
  { id: "all", label: "All values", icon: LayersIcon },
  { id: "addressed", label: "Addressed only", icon: CircleCheckBigIcon },
  { id: "empty", label: "Empty only", icon: CircleDashedIcon },
];

interface PyramidFilterSelectProps {
  /**
   * A smaller, borderless trigger for a card header — it takes its border only
   * once it holds a non-default value, which is the one state worth a glance.
   */
  compact?: boolean;
  value: PyramidFilterStep;
  onChange: (step: PyramidFilterStep) => void;
  /** How many elements each step shows, read in the menu where the choice is made. */
  counts: Record<PyramidFilterStep, number>;
}

/**
 * The values directory's step filter, as the icon menu every filter band here
 * uses (`DecisionFilterBar`, `AcceptanceFilterBar`). The trigger wears the
 * current step's glyph, so the slice being shown reads without opening it.
 */
export function PyramidFilterSelect({ value, onChange, counts, compact = false }: PyramidFilterSelectProps) {
  const current = FILTER_STEPS.find((step) => step.id === value) ?? FILTER_STEPS[0];
  const CurrentIcon = current.icon;

  return (
    <Select value={value} onValueChange={(next) => onChange(next as PyramidFilterStep)}>
      <FilterSelectTrigger
        icon={<CurrentIcon />}
        label="Value elements"
        active={value !== "all"}
        className={compact ? cn("size-7 shadow-none", !(value !== "all") && "border-transparent hover:bg-muted") : undefined}
        valueLabel={current.label}
      />
      <SelectContent align={compact ? "end" : "start"}>
        {FILTER_STEPS.map(({ id, label, icon: Icon }) => (
          <SelectItem key={id} value={id}>
            <span className="inline-flex items-center gap-2">
              <Icon className="size-3.5 text-muted-foreground" />
              {label} · {counts[id]}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
