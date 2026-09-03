"use client";

import { Lightbulb, FileText, GitBranch } from "lucide-react";
import { USE_CASES, type UseCase } from "@/lib/prompts/types";
import { cn } from "@/lib/utils";

const USE_CASE_ICONS = {
  "from-pitch": Lightbulb,
  "from-plan": FileText,
  "extend-map": GitBranch,
} as const;

interface UseCasePickerProps {
  onSelect: (useCase: UseCase) => void;
  /** Highlight one card without a hover — the marketing preview's "selected" state. */
  selected?: UseCase | null;
  className?: string;
}

/**
 * The three ways to start a map from a prompt, as cards. The generate page
 * renders it as its first screen; the marketing page renders it as a preview
 * with a fixed `selected` and a no-op `onSelect`. Labels and descriptions are
 * `USE_CASES`' own — this component holds no copy.
 */
export function UseCasePicker({ onSelect, selected = null, className }: UseCasePickerProps) {
  return (
    <div className={cn("grid w-full gap-4 sm:grid-cols-3", className)}>
      {USE_CASES.map((uc) => {
        const Icon = USE_CASE_ICONS[uc.id];
        const isSelected = selected === uc.id;
        return (
          <button
            key={uc.id}
            type="button"
            onClick={() => onSelect(uc.id)}
            aria-pressed={isSelected}
            className={cn(
              "flex flex-col items-start gap-3 rounded-xl border bg-card p-6 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isSelected && "border-foreground",
            )}
          >
            <Icon className="size-6 text-primary" />
            <div>
              <div className="font-medium">{uc.label}</div>
              <p className="mt-1 text-sm text-muted-foreground">{uc.description}</p>
            </div>
          </button>
        );
      })}
    </div>
  );
}
