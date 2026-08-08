"use client";

import { SquareKanbanIcon } from "lucide-react";
import { STATUS_ICONS, STATUS_LABELS, STATUS_STYLES } from "@/components/graph/nodes/node-styles";
import type { DeliverySnapshot } from "@/lib/utils/coverage";
import { OverviewSection } from "./OverviewSection";

interface DeliverySnapshotCardProps {
  snapshot: DeliverySnapshot;
  projectId: string;
}

/** The Delivery board's column totals without the board. */
export function DeliverySnapshotCard({ snapshot, projectId }: DeliverySnapshotCardProps) {
  return (
    <OverviewSection
      title="Delivery snapshot"
      icon={SquareKanbanIcon}
      description="How much of the product is shipped, and how much is still on its way."
      subtitle={
        snapshot.totalItems === 0
          ? "Nothing in flight yet."
          : `${snapshot.totalItems} view × platform item${snapshot.totalItems === 1 ? "" : "s"} in flight`
      }
      href={`/project/${projectId}/delivery`}
      linkLabel="Board"
    >
      {snapshot.totalItems > 0 && (
        <div className="flex flex-col gap-1.5">
          {snapshot.statuses.map(({ status, count }) => {
            const Icon = STATUS_ICONS[status] ?? STATUS_ICONS.idea;
            const style = STATUS_STYLES[status] ?? STATUS_STYLES.idea;

            return (
              <div
                key={status}
                className={`flex items-center gap-2 text-sm ${count === 0 ? "text-muted-foreground/60" : ""}`}
              >
                <Icon className={`size-3.5 shrink-0 ${style.badge}`} aria-hidden="true" />
                <span className="flex-1">{STATUS_LABELS[status]}</span>
                <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">{count}</span>
              </div>
            );
          })}
        </div>
      )}
    </OverviewSection>
  );
}
