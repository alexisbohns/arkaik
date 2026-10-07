"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { JournalFamilyId } from "@arkaik/schema";
import { PageError } from "@/components/layout/PageError";
import { PageLoading } from "@/components/layout/PageLoading";
import { PageShell } from "@/components/layout/PageShell";
import { PageSurface } from "@/components/layout/PageSurface";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useNodes } from "@/lib/hooks/useNodes";
import { useJournalPages } from "@/lib/hooks/useJournalPages";
import { useJournalStats } from "@/lib/hooks/useJournalStats";
import { useProjectId } from "@/lib/hooks/useProjectId";
import { FeedRow } from "@/components/journal/FeedRow";

/**
 * The filter chips' labels. What each family MATCHES lives in the schema
 * (`JOURNAL_FAMILIES`, by type prefix), because the backend filters now: a
 * chip narrows the read itself, not one page of everything. An unknown or
 * forward-compatible type matches no family and shows only under "All".
 */
const FAMILIES: readonly { id: JournalFamilyId; label: string }[] = [
  { id: "nodes", label: "Nodes" },
  { id: "edges", label: "Edges" },
  { id: "decisions", label: "Decisions" },
  { id: "delivery", label: "Delivery" },
  { id: "intake", label: "Ideas & requests" },
  { id: "refs", label: "References" },
];

type FamilyId = JournalFamilyId;

/**
 * One filter chip.
 *
 * Extracted so the "All" pill and the six family pills cannot drift: they are
 * the same control, and the focus ring these hand-rolled buttons never had
 * (audit `shadcn-9`) is exactly the kind of fix that otherwise lands on one of
 * the two copies and not the other. The ring is `Button`'s, verbatim, so a
 * keyboard user sees the same treatment here as everywhere else — until the
 * Toggle primitive that audit item asks for exists and absorbs all four sites.
 */
function FamilyPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-3 py-1 text-xs transition-colors outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] ${
        active ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

export default function HistoryPage() {
  const id = useProjectId();

  const { nodes: dataNodes, loading: nodesLoading, error: nodesError, reload: reloadNodes } = useNodes(id);
  const [family, setFamily] = useState<FamilyId | null>(null);
  // The page reads its history a page at a time, newest first, and never the
  // whole journal (#429). The total in the header and the "no journal yet"
  // decision come from the aggregate, never from the pages loaded so far.
  const { stats, loading: statsLoading, error: statsError, reload: reloadStats } = useJournalStats(id);
  const families = useMemo(() => (family === null ? null : [family]), [family]);
  const {
    events,
    loading: eventsLoading,
    error: eventsError,
    reload: reloadEvents,
    hasMore,
    loadMore,
    loadingMore,
    loadMoreError,
  } = useJournalPages(id, families);
  const total = stats?.total ?? 0;

  const nodesById = useMemo(() => new Map(dataNodes.map((node) => [node.id, node])), [dataNodes]);

  // Not on the pages: switching chips loads a new filter, and that must
  // redraw the list, not the whole page.
  if (nodesLoading || statsLoading) {
    return <PageLoading label="history" />;
  }

  // Before the empty state, never after (#362): an unread journal is `[]`, and
  // "No journal yet. Every recorded event will appear here." over a project
  // with years of history is exactly the sentence this gate exists to prevent.
  const loadError = nodesError ?? statsError;
  if (loadError) {
    return (
      <PageError
        label="history"
        message={loadError}
        onRetry={() => {
          void reloadNodes();
          void reloadStats();
        }}
      />
    );
  }

  return (
    <PageShell
      title="History"
      meta={`${total} event${total === 1 ? "" : "s"}`}
      allNodes={dataNodes}
      history
    >
      <PageSurface contentClassName="flex flex-col gap-4">
        {total === 0 ? (
          <EmptyState message="No journal yet. Every recorded event will appear here." />
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              <FamilyPill active={family === null} onClick={() => setFamily(null)}>
                All
              </FamilyPill>
              {FAMILIES.map((entry) => (
                <FamilyPill
                  key={entry.id}
                  active={family === entry.id}
                  onClick={() => setFamily(family === entry.id ? null : entry.id)}
                >
                  {entry.label}
                </FamilyPill>
              ))}
            </div>

            {eventsLoading ? (
              <p className="text-sm text-muted-foreground" role="status">
                Loading history…
              </p>
            ) : eventsError !== null ? (
              <div className="flex items-center gap-3 text-sm text-destructive" role="alert">
                <span>{eventsError}</span>
                <Button size="sm" variant="outline" className="cursor-pointer" onClick={() => void reloadEvents()}>
                  Retry
                </Button>
              </div>
            ) : events.length === 0 ? (
              <p className="text-sm text-muted-foreground">No events in this family.</p>
            ) : (
              <>
                <div className="flex flex-col gap-0.5">
                  {events.map((event) => (
                    <FeedRow key={event.id} event={event} nodesById={nodesById} />
                  ))}
                </div>
                {hasMore && (
                  <div className="flex items-center gap-3">
                    <Button
                      size="sm"
                      variant="outline"
                      className="cursor-pointer"
                      disabled={loadingMore}
                      onClick={() => void loadMore()}
                    >
                      {loadingMore ? "Loading…" : "Load more"}
                    </Button>
                    {loadMoreError && (
                      <span className="text-xs text-destructive" role="status" aria-live="polite">
                        {loadMoreError}
                      </span>
                    )}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </PageSurface>
    </PageShell>
  );
}
