"use client";

import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { SPECIES_ICONS } from "@/components/graph/nodes/node-styles";
import type { SpeciesId } from "@/lib/config/species";

interface SpeciesBadgeProps {
  species: SpeciesId;
  label: string;
  description?: string;
  showLabel?: boolean;
  onClick?: (e: React.MouseEvent) => void;
}

export function SpeciesBadge({ species, label, description, showLabel = false, onClick }: SpeciesBadgeProps) {
  const SpeciesIcon = SPECIES_ICONS[species];

  return (
    <HoverCard openDelay={250}>
      <HoverCardTrigger asChild>
        <abbr
          tabIndex={0}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted/60 shrink-0 no-underline cursor-default"
          aria-label={`About ${label}`}
          onClick={onClick}
        >
          <SpeciesIcon className="size-3.5" />
          {showLabel && <span>{label}</span>}
        </abbr>
      </HoverCardTrigger>
      <HoverCardContent className="w-64 p-3" align="start">
        <div className="flex items-start gap-2">
          <SpeciesIcon className="mt-0.5 size-4 text-muted-foreground" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">{label}</p>
            <p className="text-xs text-muted-foreground">
              {description ?? "No species description available."}
            </p>
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

interface EntityIdProps {
  id: string;
}

export function EntityId({ id }: EntityIdProps) {
  return (
    <span className="rounded bg-muted px-2 py-1 font-mono text-[11px] text-muted-foreground">
      {id}
    </span>
  );
}
