import { resolveKritikLibrary } from "@arkaik/schema";
import { FeedRow } from "@/components/journal/FeedRow";
import { ReadOnlyFindingsBoard } from "@/components/landing/previews/client/ReadOnlyFindingsBoard";
import type { PreviewProps } from "@/components/landing/previews/types";
import type { Node } from "@/lib/data/types";
import { buildFindingRows, buildSurfaceTitles } from "@/lib/utils/quality";

/**
 * Nothing on this preview names a node.
 *
 * The board used to take a map of every node its findings referenced, for the
 * linked-node chips — those moved to the finding panel, which this preview does
 * not render. `FeedRow` still requires the prop, but it only ever reads it to
 * resolve an event's `node_id`, and every event here is a `quality.*` one:
 * `describeJournalEvent` prints those from the finding, criterion, surface and
 * audit ids they carry, and consults the map for none of them.
 *
 * So it is empty rather than built. Walking every finding's `nodeIds` against
 * every node in the bundle, to hand the result to a reader that cannot use it,
 * is work that looks load-bearing and is not — and the next person to touch
 * this would have had to re-derive that before daring to delete it.
 */
const NO_NODES = new Map<string, Node>();

/**
 * The real board over the fixture's findings, worst first, then the quality
 * facts from the journal as feed rows — a signal a CI run tripped and a
 * finding a merged PR resolved. A server component.
 */
export function FindingsBoardPreview({ bundle }: PreviewProps) {
  const section = bundle.quality;
  const library = resolveKritikLibrary(section);
  const rows = buildFindingRows(section, library);
  const surfaceTitles = buildSurfaceTitles(section);
  const events = (bundle.journal ?? []).filter((event) => event.type.startsWith("quality."));

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden p-4">
      <div className="min-h-0 flex-1 [overflow:auto]">
        <ReadOnlyFindingsBoard rows={rows} surfaceTitles={surfaceTitles} />
      </div>
      <ul className="divide-y border-t pt-1">
        {events.map((event) => <li key={event.id}><FeedRow event={event} nodesById={NO_NODES} /></li>)}
      </ul>
    </div>
  );
}
