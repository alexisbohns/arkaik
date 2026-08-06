"use client";

import { useMemo, useState, type ReactNode } from "react";
import { orderEvents } from "@arkaik/schema";
import { PageError } from "@/components/layout/PageError";
import { PageLoading } from "@/components/layout/PageLoading";
import { PageShell } from "@/components/layout/PageShell";
import { EmptyState } from "@/components/ui/empty-state";
import { useNodes } from "@/lib/hooks/useNodes";
import { useJournal } from "@/lib/hooks/useJournal";
import { useProjectId } from "@/lib/hooks/useProjectId";
import { FeedRow } from "@/components/journal/FeedRow";

/**
 * Event families for the filter chips. An unknown/forward-compatible type
 * matches no family and shows only under "All".
 */
const FAMILIES = [
  { id: "nodes", label: "Nodes", prefixes: ["node."] },
  { id: "edges", label: "Edges", prefixes: ["edge."] },
  { id: "decisions", label: "Decisions", prefixes: ["decision."] },
  { id: "delivery", label: "Delivery", prefixes: ["release.", "deliverable."] },
  { id: "intake", label: "Ideas & requests", prefixes: ["idea.", "request."] },
  { id: "refs", label: "References", prefixes: ["ref."] },
] as const;

type FamilyId = (typeof FAMILIES)[number]["id"];

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
  const { journal, loading: journalLoading, error: journalError, reload: reloadJournal } = useJournal(id);
  const [family, setFamily] = useState<FamilyId | null>(null);

  const nodesById = useMemo(() => new Map(dataNodes.map((node) => [node.id, node])), [dataNodes]);

  const events = useMemo(() => {
    const ordered = orderEvents(journal).reverse(); // newest first
    if (family === null) return ordered;
    const prefixes = FAMILIES.find((f) => f.id === family)?.prefixes ?? [];
    return ordered.filter((event) => prefixes.some((prefix) => event.type.startsWith(prefix)));
  }, [journal, family]);

  if (nodesLoading || journalLoading) {
    return <PageLoading label="history" />;
  }

  // Before the empty state, never after (#362): an unread journal is `[]`, and
  // "No journal yet. Every recorded event will appear here." over a project
  // with years of history is exactly the sentence this gate exists to prevent.
  const loadError = nodesError ?? journalError;
  if (loadError) {
    return (
      <PageError
        label="history"
        message={loadError}
        onRetry={() => {
          void reloadNodes();
          void reloadJournal();
        }}
      />
    );
  }

  return (
    <PageShell
      title="History"
      meta={`${journal.length} event${journal.length === 1 ? "" : "s"}`}
      allNodes={dataNodes}
      journal={journal}
    >
      <div className="h-full overflow-auto p-4 md:p-6">
        <div className="flex w-full flex-col gap-4">
          {journal.length === 0 ? (
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

              {events.length === 0 ? (
                <p className="text-sm text-muted-foreground">No events in this family.</p>
              ) : (
                <div className="flex flex-col gap-0.5">
                  {events.map((event) => (
                    <FeedRow key={event.id} event={event} nodesById={nodesById} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </PageShell>
  );
}
