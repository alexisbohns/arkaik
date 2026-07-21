"use client";

import type { ValueId } from "@arkaik/schema";
import { VALUES, VALUE_TIERS_CONFIG } from "@/lib/config/values";
import { VALUE_ICON_COMPONENTS } from "@/lib/config/value-icons";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface ValuePickerProps {
  selected: ValueId[];
  onChange: (next: ValueId[]) => void;
}

export function ValuePicker({ selected, onChange }: ValuePickerProps) {
  const selectedSet = new Set(selected);
  function toggle(id: ValueId) {
    const next = new Set(selectedSet);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(VALUES.filter((v) => next.has(v.id)).map((v) => v.id));
  }
  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex flex-col gap-3">
        {VALUE_TIERS_CONFIG.map((tier) => (
          <div key={tier.id} className="flex flex-col gap-1.5">
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{tier.label}</span>
            <div className="flex flex-wrap gap-1.5">
              {VALUES.filter((v) => v.tier === tier.id).map((v) => {
                const Icon = VALUE_ICON_COMPONENTS[v.id];
                const on = selectedSet.has(v.id);
                return (
                  <Tooltip key={v.id}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggle(v.id)}
                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors ${on ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:bg-muted/60"}`}
                      >
                        <Icon className="size-3" />
                        {v.label}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top">{v.description}</TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </TooltipProvider>
  );
}
