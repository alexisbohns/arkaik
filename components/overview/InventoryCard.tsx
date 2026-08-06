"use client";

import Link from "next/link";
import { STATUS_LABELS, STATUS_STYLES } from "@/components/graph/nodes/node-styles";
import { STATUSES } from "@/lib/config/statuses";
import { SPECIES_NAV_ICONS, SPECIES_PLURALS } from "@/lib/config/species-icons";
import type { Inventory } from "@/lib/utils/coverage";
import { OverviewSection } from "./OverviewSection";

interface InventoryCardProps {
  inventory: Inventory;
  projectId: string;
}

/** The census: what the graph holds, by species and status. */
export function InventoryCard({ inventory, projectId }: InventoryCardProps) {
  return (
    <OverviewSection title="Inventory" href={`/project/${projectId}/library`} linkLabel="Library">
      <p className="text-xs text-muted-foreground">
        {inventory.nodeCount} nodes · {inventory.edgeCount} edges · {inventory.journalEventCount} journal events
      </p>
      <div className="flex flex-col gap-0.5">
        {inventory.species.map((entry) => {
          const Icon = SPECIES_NAV_ICONS[entry.species];

          return (
            <Link
              key={entry.species}
              href={`/project/${projectId}/library?species=${entry.species}`}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted"
            >
              <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="flex-1">{SPECIES_PLURALS[entry.species]}</span>
              <span className="flex items-center gap-2">
                {STATUSES.map(({ id: status }) => {
                  const count = entry.byStatus[status];
                  if (!count) return null;
                  return (
                    <span
                      key={status}
                      className="flex items-center gap-1 text-xs text-muted-foreground"
                      title={`${STATUS_LABELS[status]}: ${count}`}
                    >
                      <span className={`size-2 rounded-full ${STATUS_STYLES[status].dot}`} />
                      {count}
                    </span>
                  );
                })}
              </span>
              <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">{entry.total}</span>
            </Link>
          );
        })}
      </div>
    </OverviewSection>
  );
}
