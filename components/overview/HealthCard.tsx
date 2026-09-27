"use client";

import Link from "next/link";
import { CircleCheckBigIcon, HeartPulseIcon, TriangleAlertIcon } from "lucide-react";
import type { HealthIndicator, HealthIndicatorId } from "@/lib/utils/coverage";
import { OverviewSection } from "./OverviewSection";

// Where each indicator's evidence lives — link targets are presentation,
// the labels/counts come from the projection (lib/utils/coverage.ts).
const INDICATOR_PATHS: Record<HealthIndicatorId, string> = {
  "unreachable-from-root": "/maps/system",
  "views-without-screenshot": "/library?species=view",
  "nodes-without-description": "/library",
  "disconnected-nodes": "/library",
  "open-backlog": "/design",
};

interface HealthCardProps {
  indicators: HealthIndicator[];
  projectId: string;
  /**
   * The journal has not been read yet, so the open-backlog count — the one
   * indicator drawn from it — is unknown rather than zero. Its row shows a
   * placeholder and is left out of the headline until it lands.
   */
  backlogPending?: boolean;
  /**
   * The journal read failed, so the open-backlog count is unknown for good
   * until a retry. The row is left out of the headline the same way, and the
   * message takes the count's slot.
   */
  backlogError?: string | null;
}

/** Doc-health: where the living documentation is thin. Zero is the goal state. */
export function HealthCard({
  indicators,
  projectId,
  backlogPending = false,
  backlogError = null,
}: HealthCardProps) {
  const backlogUnavailable = backlogPending || backlogError !== null;
  const isUnavailable = (indicator: HealthIndicator) => backlogUnavailable && indicator.id === "open-backlog";
  // The headline is a ratio over the indicators actually evaluated: a pending
  // or failed row is in neither the numerator nor the denominator, so the
  // sentence is true at the moment it is shown rather than once the journal
  // lands. The zero branch says so with the same placeholder the row wears.
  const evaluated = indicators.filter((indicator) => !isUnavailable(indicator)).length;
  const flagged = indicators.filter((indicator) => !isUnavailable(indicator) && indicator.count > 0).length;

  return (
    <OverviewSection
      title="Health"
      icon={HeartPulseIcon}
      description="The graph's own soundness — what is orphaned, unanchored, or contradicting itself."
      subtitle={
        flagged === 0
          ? backlogPending
            ? "…"
            : backlogError !== null
              ? backlogError
              : "Every indicator is at zero — the documentation is whole."
          : `${flagged} of ${evaluated} indicator${evaluated === 1 ? "" : "s"} needs attention${
              backlogPending ? ", 1 pending" : backlogError !== null ? ", 1 unavailable" : ""
            }`
      }
    >
      <div className="flex flex-col gap-0.5">
        {indicators.map((indicator) => {
          const unavailable = isUnavailable(indicator);
          const pending = unavailable && backlogPending;
          const healthy = !unavailable && indicator.count === 0;
          const Icon = healthy ? CircleCheckBigIcon : TriangleAlertIcon;

          return (
            <Link
              key={indicator.id}
              href={`/project/${projectId}${INDICATOR_PATHS[indicator.id]}`}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted"
              aria-busy={pending || undefined}
            >
              {/* A pending or failed row wears neither verdict: an empty box
                  keeps the column aligned until the count is known. */}
              {unavailable ? (
                <span className="size-3.5 shrink-0" aria-hidden="true" />
              ) : (
                <Icon
                  className={`size-3.5 shrink-0 ${healthy ? "text-green-500" : "text-amber-500"}`}
                  aria-hidden="true"
                />
              )}
              <span className={`flex-1 ${healthy ? "text-muted-foreground" : ""}`}>{indicator.label}</span>
              {unavailable && !pending ? (
                <span className="text-xs text-muted-foreground">{backlogError}</span>
              ) : (
                <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                  {pending ? "…" : indicator.count}
                  {!pending && indicator.total !== undefined ? `/${indicator.total}` : ""}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </OverviewSection>
  );
}
