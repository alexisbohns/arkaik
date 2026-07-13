"use client";

import { PlatformItemCard } from "@/components/delivery/PlatformItemCard";
import { STATUS_ICONS, STATUS_STYLES } from "@/components/graph/nodes/node-styles";
import type { StatusId } from "@/lib/config/statuses";
import type { DeliveryItem } from "@/lib/utils/delivery";

interface DeliveryBoardProps {
  columns: { status: StatusId; label: string; items: DeliveryItem[] }[];
  speciesLabelById: Record<string, string>;
  speciesDescriptionById: Record<string, string | undefined>;
  onSelectItem: (item: DeliveryItem) => void;
}

/** Status columns of (node × platform) items — the product-centered board. */
export function DeliveryBoard({ columns, speciesLabelById, speciesDescriptionById, onSelectItem }: DeliveryBoardProps) {
  return (
    <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-2">
      {columns.map(({ status, label, items }) => {
        const StatusIcon = STATUS_ICONS[status];

        return (
          <section key={status} className="flex w-72 shrink-0 flex-col rounded-xl border bg-card/50">
            <header className="flex items-center gap-2 border-b px-3 py-2.5">
              <StatusIcon className={`size-4 ${STATUS_STYLES[status].dot}`} aria-hidden="true" />
              <h2 className="text-sm font-medium">{label}</h2>
              <span className="ml-auto rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                {items.length}
              </span>
            </header>
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
              {items.length === 0 ? (
                <div className="rounded-lg border border-dashed p-4 text-center">
                  <p className="text-xs text-muted-foreground">Nothing here</p>
                </div>
              ) : (
                items.map((item) => (
                  <PlatformItemCard
                    key={`${item.node.id}:${item.platform}`}
                    item={item}
                    speciesLabel={speciesLabelById[item.node.species] ?? item.node.species}
                    speciesDescription={speciesDescriptionById[item.node.species]}
                    onClick={() => onSelectItem(item)}
                  />
                ))
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
