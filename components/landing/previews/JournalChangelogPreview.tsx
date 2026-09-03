import { FeedRow } from "@/components/journal/FeedRow";
import { FIXTURES } from "@/components/landing/fixtures";
import type { PreviewProps } from "@/components/landing/previews/types";
import type { Node } from "@/lib/data/types";
import { computeChangelog, computeNodeTimeline } from "@/lib/utils/journal";

const [TIMELINE_NODE_ID] = FIXTURES["journal-changelog"].nodeIds!;
const [FROM_VERSION, TO_VERSION] = FIXTURES["journal-changelog"].versions!;

/**
 * Left: one view's timeline. Right: what changed between Arkaik's last two
 * releases. Both are projections over the self-map's own journal. A server
 * component: only the props the leaf renders cross to the client.
 */
export function JournalChangelogPreview({ bundle }: PreviewProps) {
  const journal = bundle.journal ?? [];
  const nodesById = new Map(bundle.nodes.map((node) => [node.id, node]));
  const timeline = computeNodeTimeline(journal, TIMELINE_NODE_ID).slice(-5);
  const changelog = computeChangelog(journal, TO_VERSION, { fromVersion: FROM_VERSION, nodesById }).events.slice(0, 5);
  const title = nodesById.get(TIMELINE_NODE_ID)?.title ?? TIMELINE_NODE_ID;

  // `FeedRow` resolves titles through `event.node_id` only (describe-event.ts),
  // so the map that crosses to the client holds just the nodes these ten
  // events name — a handful, not the whole seed.
  const referenced = new Map<string, Node>();
  for (const event of [...timeline, ...changelog]) {
    const node = typeof event.node_id === "string" ? nodesById.get(event.node_id) : undefined;
    if (node) referenced.set(node.id, node);
  }

  return (
    <div className="grid h-full gap-4 overflow-hidden p-4 lg:grid-cols-2">
      <div className="min-w-0">
        <p className="mb-2 truncate text-xs font-medium text-muted-foreground">{title}</p>
        <ul className="divide-y">
          {timeline.map((event) => <li key={event.id}><FeedRow event={event} nodesById={referenced} /></li>)}
        </ul>
      </div>
      <div className="min-w-0">
        <p className="mb-2 text-xs font-medium text-muted-foreground">{FROM_VERSION} → {TO_VERSION}</p>
        <ul className="divide-y">
          {changelog.map((event) => <li key={event.id}><FeedRow event={event} nodesById={referenced} /></li>)}
        </ul>
      </div>
    </div>
  );
}
