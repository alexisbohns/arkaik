"use client";

import { TriangleAlertIcon } from "lucide-react";
import type { AcceptanceParityGap } from "@arkaik/schema";
import { PLATFORM_LABELS } from "@/components/graph/nodes/node-styles";
import { OverviewSection } from "./OverviewSection";

interface ParityCardProps {
  gaps: AcceptanceParityGap[];
  projectId: string;
}

/** Where platforms disagree — acceptances shipped on some platforms, not others (spec §3.5). */
export function ParityCard({ gaps, projectId }: ParityCardProps) {
  return (
    <OverviewSection title="Platform parity" href={`/project/${projectId}/acceptances?parity_gap=1`} linkLabel="Acceptances">
      {gaps.length === 0 ? (
        <p className="text-sm text-muted-foreground">No parity gaps — every acceptance ships evenly across its platforms.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-sm">
            <TriangleAlertIcon className="size-4 text-amber-500" />
            <span className="font-medium">{gaps.length}</span>
            <span className="text-muted-foreground">acceptance{gaps.length === 1 ? "" : "s"} with a parity gap</span>
          </div>
          <ul className="flex flex-col gap-2 text-xs">
            {[...gaps].sort((a, b) => Object.keys(b.missing).length - Object.keys(a.missing).length).slice(0, 4).map((gap) => (
              <li key={gap.node_id} className="flex flex-col gap-1">
                <span className="truncate font-medium">{gap.title}</span>
                <span className="text-muted-foreground">
                  {gap.delivered.map((p) => PLATFORM_LABELS[p]).join(", ")} shipped ·{" "}
                  {(Object.keys(gap.missing) as (keyof typeof PLATFORM_LABELS)[]).map((p) => PLATFORM_LABELS[p]).join(", ")} lagging
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </OverviewSection>
  );
}
