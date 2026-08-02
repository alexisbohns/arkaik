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
    <div className="flex min-h-0 flex-1 overflow-x-auto border bg-card rounded-xl">
      {columns.map(({ status, label, items }) => {
        const StatusIcon = STATUS_ICONS[status];

        return (
          <section key={status} className="flex w-72 shrink-0 flex-col px-2">
            <header className="flex items-center gap-2 rounded-b-xl bg-background border border-t-0 px-3 py-2.5">
              <StatusIcon className={`size-4 ${STATUS_STYLES[status].badge}`} aria-hidden="true" />
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
