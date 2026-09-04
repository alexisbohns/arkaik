import { resolveKritikLibrary } from "@arkaik/schema";
import { FeedRow } from "@/components/journal/FeedRow";
import { ReadOnlyFindingsBoard } from "@/components/landing/previews/client/ReadOnlyFindingsBoard";
import type { PreviewProps } from "@/components/landing/previews/types";
import type { Node } from "@/lib/data/types";
import { buildFindingRows, buildSurfaceTitles } from "@/lib/utils/quality";

/**
 * The real board over the fixture's findings, worst first, then the quality
 * facts from the journal as feed rows — a signal a CI run tripped and a
 * finding a merged PR resolved. A server component; the map that crosses to
 * the client holds only the nodes the findings name.
 */
export function FindingsBoardPreview({ bundle }: PreviewProps) {
  const section = bundle.quality;
  const library = resolveKritikLibrary(section);
  const rows = buildFindingRows(section, library);
  const surfaceTitles = buildSurfaceTitles(section);
  const events = (bundle.journal ?? []).filter((event) => event.type.startsWith("quality."));

  const referenced = new Map<string, Node>();
  const byId = new Map(bundle.nodes.map((node) => [node.id, node]));
  for (const row of rows) for (const id of row.nodeIds) {
    const node = byId.get(id);
    if (node) referenced.set(id, node);
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden p-4">
      <div className="min-h-0 flex-1 [overflow:auto]">
        <ReadOnlyFindingsBoard rows={rows} nodesById={referenced} surfaceTitles={surfaceTitles} />
      </div>
      <ul className="divide-y border-t pt-1">
        {events.map((event) => <li key={event.id}><FeedRow event={event} nodesById={referenced} /></li>)}
      </ul>
    </div>
  );
}
