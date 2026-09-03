"use client";

import { useMemo } from "react";
import { FeedRow } from "@/components/journal/FeedRow";
import { FIXTURES } from "@/components/landing/fixtures";
import type { PreviewProps } from "@/components/landing/previews/types";
import { computeChangelog, computeNodeTimeline } from "@/lib/utils/journal";

const [TIMELINE_NODE_ID] = FIXTURES["journal-changelog"].nodeIds!;
const [FROM_VERSION, TO_VERSION] = FIXTURES["journal-changelog"].versions!;

/**
 * Left: one view's timeline. Right: what changed between Arkaik's last two
 * releases. Both are projections over the self-map's own journal.
 */
export function JournalChangelogPreview({ bundle }: PreviewProps) {
  const props = useMemo(() => {
    const journal = bundle.journal ?? [];
    const nodesById = new Map(bundle.nodes.map((node) => [node.id, node]));
    const timeline = computeNodeTimeline(journal, TIMELINE_NODE_ID).slice(-5);
    const changelog = computeChangelog(journal, TO_VERSION, { fromVersion: FROM_VERSION, nodesById });
    return { nodesById, timeline, changelog, title: nodesById.get(TIMELINE_NODE_ID)?.title ?? TIMELINE_NODE_ID };
  }, [bundle]);

  return (
    <div className="grid h-full gap-4 overflow-hidden p-4 lg:grid-cols-2">
      <div className="min-w-0">
        <p className="mb-2 truncate text-xs font-medium text-muted-foreground">{props.title}</p>
        <ul className="divide-y">
          {props.timeline.map((event) => <li key={event.id}><FeedRow event={event} nodesById={props.nodesById} /></li>)}
        </ul>
      </div>
      <div className="min-w-0">
        <p className="mb-2 text-xs font-medium text-muted-foreground">{FROM_VERSION} → {TO_VERSION}</p>
        <ul className="divide-y">
          {props.changelog.events.slice(0, 5).map((event) => <li key={event.id}><FeedRow event={event} nodesById={props.nodesById} /></li>)}
        </ul>
      </div>
    </div>
  );
}
