"use client";

import { SpeciesBadge, EntityId } from "@/components/graph/nodes/EntityBadges";
import { PLATFORM_ICONS, PLATFORM_LABELS } from "@/components/graph/nodes/node-styles";
import type { DeliveryItem } from "@/lib/utils/delivery";

interface PlatformItemCardProps {
  item: DeliveryItem;
  speciesLabel: string;
  speciesDescription?: string;
  onClick: () => void;
}

/** A slim (node × platform) card for the Delivery board. No status badge —
 * the column the card sits in says it. */
export function PlatformItemCard({ item, speciesLabel, speciesDescription, onClick }: PlatformItemCardProps) {
  const PlatformIcon = PLATFORM_ICONS[item.platform];

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-lg border bg-card p-2.5 text-left transition-colors hover:bg-accent/50 cursor-pointer"
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
