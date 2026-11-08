"use client";

import { SpeciesBadge, EntityId } from "@/components/graph/nodes/EntityBadges";
import { PLATFORM_ICONS, PLATFORM_LABELS } from "@/components/graph/nodes/node-styles";
import { SPECIES_GRAPH_ICONS } from "@/lib/config/species-icons";
import type { DeliveryItem } from "@/lib/utils/delivery";

interface PlatformItemCardProps {
  item: DeliveryItem;
  speciesLabel: string;
  speciesDescription?: string;
  onClick: () => void;
  /** One line — `[species] Title ··· [platform]` — instead of the two-line card. */
  compact?: boolean;
}

/** A slim (node × platform) card for the Delivery board. No status badge —
 * the column the card sits in says it. */
export function PlatformItemCard({ item, speciesLabel, speciesDescription, onClick, compact = false }: PlatformItemCardProps) {
  const PlatformIcon = PLATFORM_ICONS[item.platform];

  if (compact) {
    const SpeciesIcon = SPECIES_GRAPH_ICONS[item.node.species];
    return (
      // Glyphs only, so the title gets the whole line and clamps to it. The
      // glyphs are plain icons, not the detailed card's hover badge: that one
      // is focusable, and a focus stop inside a button is a nested control.
      // The button's own label spells out what the glyphs abbreviate.
      <button
        type="button"
        onClick={onClick}
        aria-label={`${item.node.title} — ${speciesLabel}, ${PLATFORM_LABELS[item.platform]}`}
        title={item.node.title}
        className="flex w-full cursor-pointer items-center gap-2 rounded-md bg-card px-2.5 py-1.5 text-left transition-colors hover:bg-card/80 dark:bg-muted dark:hover:bg-muted/80"
      >
        <SpeciesIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-sm">{item.node.title}</span>
        <PlatformIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      // No border: the card is set apart by sitting solid on its column's
      // tinted wash. In dark mode the card colour is the darkest surface, so
      // the card takes `muted` instead to stay the raised layer.
      className="w-full cursor-pointer rounded-lg bg-card p-2.5 text-left transition-colors hover:bg-card/80 dark:bg-muted dark:hover:bg-muted/80"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 flex-1 truncate text-sm font-medium">{item.node.title}</p>
        <span
          className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground"
          title={PLATFORM_LABELS[item.platform]}
        >
          <PlatformIcon className="size-3.5" aria-hidden="true" />
          {PLATFORM_LABELS[item.platform]}
        </span>
      </div>
      <div className="mt-1.5 flex items-center gap-1.5">
        <SpeciesBadge species={item.node.species} label={speciesLabel} description={speciesDescription} />
        <EntityId id={item.node.id} />
      </div>
    </button>
  );
}
