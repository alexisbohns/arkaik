"use client";

import { SectionHeading } from "@/components/layout/SectionHeading";
import { DeliverableTimeline } from "@/components/journal/DeliverableTimeline";
import type { ReleaseEntry } from "@/components/journal/release-entry";
import type { Node } from "@/lib/data/types";

interface ReleaseDetailProps {
  entry: ReleaseEntry;
  nodesById: Map<string, Node>;
  detailed: boolean;
}

/**
 * The Changelog's right column: one release — the same heading its row used to
 * carry, above its deliverables. Capped in width: a timeline line running the
 * full width of a wide surface is a line nobody reads to the end.
 */
export function ReleaseDetail({ entry, nodesById, detailed }: ReleaseDetailProps) {
  return (
    <section aria-label={entry.title} className="flex max-w-3xl flex-col gap-6">
      <SectionHeading
        title={entry.title}
        icon={entry.icon}
        subtitle={entry.subtitle}
        description={entry.description}
      />
      {entry.deliverables.length === 0 ? (
        <p className="text-sm text-muted-foreground">No deliverables recorded for this release.</p>
      ) : (
        <DeliverableTimeline deliverables={entry.deliverables} nodesById={nodesById} detailed={detailed} />
      )}
    </section>
  );
}
