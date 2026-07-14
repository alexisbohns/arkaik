"use client";

import Link from "next/link";
import { CircleCheckBigIcon, TriangleAlertIcon } from "lucide-react";
import type { HealthIndicator, HealthIndicatorId } from "@/lib/utils/coverage";
import { OverviewSection } from "./OverviewSection";

// Where each indicator's evidence lives — link targets are presentation,
// the labels/counts come from the projection (lib/utils/coverage.ts).
const INDICATOR_PATHS: Record<HealthIndicatorId, string> = {
  "unreachable-from-root": "/maps/system",
  "views-without-screenshot": "/library?species=view",
  "nodes-without-description": "/library",
  "disconnected-nodes": "/library",
  "open-backlog": "/changelog",
};

interface HealthCardProps {
  indicators: HealthIndicator[];
  projectId: string;
}

/** Doc-health: where the living documentation is thin. Zero is the goal state. */
export function HealthCard({ indicators, projectId }: HealthCardProps) {
  return (
    <OverviewSection title="Health">
      <div className="flex flex-col gap-0.5">
        {indicators.map((indicator) => {
          const healthy = indicator.count === 0;
          const Icon = healthy ? CircleCheckBigIcon : TriangleAlertIcon;

          return (
            <Link
              key={indicator.id}
              href={`/project/${projectId}${INDICATOR_PATHS[indicator.id]}`}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted"
            >
              <Icon
                className={`size-3.5 shrink-0 ${healthy ? "text-green-500" : "text-amber-500"}`}
                aria-hidden="true"
              />
              <span className={`flex-1 ${healthy ? "text-muted-foreground" : ""}`}>{indicator.label}</span>
              <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                {indicator.count}
                {indicator.total !== undefined ? `/${indicator.total}` : ""}
              </span>
            </Link>
          );
        })}
      </div>
    </OverviewSection>
  );
}
