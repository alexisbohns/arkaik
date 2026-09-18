"use client";

import { CheckIcon, HashIcon } from "lucide-react";

import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCopyId } from "@/lib/hooks/useCopyId";
import { cn } from "@/lib/utils";
import { SPECIES_GRAPH_ICONS } from "@/lib/config/species-icons";
import type { SpeciesId } from "@/lib/config/species";

interface SpeciesBadgeProps {
  species: SpeciesId;
  label: string;
  description?: string;
  showLabel?: boolean;
  onClick?: (e: React.MouseEvent) => void;
}

export function SpeciesBadge({ species, label, description, showLabel = false, onClick }: SpeciesBadgeProps) {
  const SpeciesIcon = SPECIES_GRAPH_ICONS[species];

  return (
    <HoverCard openDelay={250}>
      <HoverCardTrigger asChild>
        <abbr
          tabIndex={0}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted/60 shrink-0 no-underline cursor-help"
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

const ENTITY_ID_CLASS =
  "rounded bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground";

export function EntityId({ id }: EntityIdProps) {
  return <span className={ENTITY_ID_CLASS}>{id}</span>;
}

/**
 * The entity id in a **panel header**: the id spelled out at `lg` and up, a
 * copy-me chip below it.
 *
 * A panel header is one row that has to hold a species badge, an id and a close
 * button, and below `lg` a panel is at most half the window and often all of it.
 * There, a full `AC-sections-mirror-project-homes` either pushes the badge off
 * the row or truncates into a stub that is neither readable nor copyable. So it
 * collapses to a hash — "there is an id here" — that puts the whole thing on the
 * clipboard in one tap, which is what a narrow screen wants from an id anyway.
 *
 * Both renditions are in the DOM with a breakpoint deciding which shows, rather
 * than a `useIsMobile` branch: the header is server-rendered, and a hook-based
 * switch would hydrate the wrong one for a frame on every panel open.
 *
 * Deliberately NOT {@link EntityChip}: that one identifies a row inside a list
 * and wears the species glyph, which would be redundant here — the header
 * already carries a species badge two chips to the left.
 */
export function PanelHeaderEntityId({ id }: EntityIdProps) {
  const { copied, copy } = useCopyId(id);
  const Icon = copied ? CheckIcon : HashIcon;

  return (
    <>
      <span className={cn(ENTITY_ID_CLASS, "hidden lg:inline-block")}>{id}</span>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            // The id, spelled out: the tooltip is visual-only, so this label is
            // the only place a screen reader hears what the chip copies — and at
            // this width it is the only place the id exists at all.
            aria-label={`Copy ${id}`}
            onClick={copy}
            className={cn(
              "inline-flex shrink-0 cursor-pointer items-center rounded border border-border bg-muted/50 p-1 text-muted-foreground transition-colors lg:hidden",
              "hover:bg-muted hover:text-foreground",
              "outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
              copied && "text-green-500",
            )}
          >
            <Icon className="size-3" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <span className="font-mono">{id}</span>
        </TooltipContent>
      </Tooltip>
    </>
  );
}
