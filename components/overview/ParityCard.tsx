"use client";

import { TriangleAlertIcon } from "lucide-react";
import type { AcceptanceParityGap } from "@arkaik/schema";
import { PLATFORM_LABELS } from "@/components/graph/nodes/node-styles";
import type { PlatformId } from "@/lib/config/platforms";
import { platformAvailabilityShape } from "@/lib/utils/product-scope";
import { OverviewSection } from "./OverviewSection";

interface ParityCardProps {
  gaps: AcceptanceParityGap[];
  /** The scope's effective platforms — below two, parity is not a question. */
  platforms: PlatformId[];
  projectId: string;
}

/**
 * Where platforms disagree — acceptances shipped on some platforms, not others
 * (spec §3.5).
 *
 * **Parity is the one card the arity rule silences rather than reshapes.** Every
 * other surface has something to say about a single-platform product: the gauges
 * draw one bar, the pyramid one track. "At parity" and "behind" are relations
 * *between* platforms, so with fewer than two in scope the question does not
 * apply, and answering it — "No parity gaps" over a scope that structurally
 * cannot have one — would read as a clean bill of health nobody earned. The
 * threshold is `platformAvailabilityShape`'s and not a second `>= 2` written
 * here, so this card can never disagree with the shapes around it.
 */
export function ParityCard({ gaps, platforms, projectId }: ParityCardProps) {
  if (platformAvailabilityShape(platforms) === "bar") {
    return (
      <OverviewSection title="Platform parity" href={`/project/${projectId}/acceptances`} linkLabel="Acceptances">
        <p className="text-sm text-muted-foreground">
          Parity compares platforms, and fewer than two are in scope — nothing to compare.
        </p>
      </OverviewSection>
    );
  }

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
