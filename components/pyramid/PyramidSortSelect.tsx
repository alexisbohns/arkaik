"use client";

import { ArrowDownAZIcon, ArrowDownWideNarrowIcon, type LucideIcon } from "lucide-react";
import { FilterSelectTrigger } from "@/components/layout/FilterSelectTrigger";
import { Select, SelectContent, SelectItem } from "@/components/ui/select";
import { cn } from "@/lib/utils";

/** How the values directory orders the elements inside each tier. */
export type PyramidSortOrder = "acceptances" | "alphabetical";

const SORT_ORDERS: readonly { id: PyramidSortOrder; label: string; icon: LucideIcon }[] = [
  { id: "acceptances", label: "Most acceptances", icon: ArrowDownWideNarrowIcon },
  { id: "alphabetical", label: "Alphabetical", icon: ArrowDownAZIcon },
];

interface PyramidSortSelectProps {
  /**
   * A smaller, borderless trigger for a card header — it takes its border only
   * once it holds a non-default value, which is the one state worth a glance.
   */
  compact?: boolean;
  value: PyramidSortOrder;
  onChange: (order: PyramidSortOrder) => void;
}

/**
 * The directory's sort, as the same icon menu as its filter beside it. The
 * trigger wears the current order's glyph, and reads as set only off the
 * default — by acceptances, the order that answers what the page asks.
 */
export function PyramidSortSelect({ value, onChange, compact = false }: PyramidSortSelectProps) {
  const current = SORT_ORDERS.find((order) => order.id === value) ?? SORT_ORDERS[0];
  const CurrentIcon = current.icon;

  return (
    <Select value={value} onValueChange={(next) => onChange(next as PyramidSortOrder)}>
      <FilterSelectTrigger
        icon={<CurrentIcon />}
        label="Sort"
        active={value !== "acceptances"}
        className={compact ? cn("size-7 shadow-none", !(value !== "acceptances") && "border-transparent hover:bg-muted") : undefined}
        valueLabel={current.label}
        forceValueLabel
      />
      <SelectContent align={compact ? "end" : "start"}>
        {SORT_ORDERS.map(({ id, label, icon: Icon }) => (
          <SelectItem key={id} value={id}>
            <span className="inline-flex items-center gap-2">
              <Icon className="size-3.5 text-muted-foreground" />
              {label}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
