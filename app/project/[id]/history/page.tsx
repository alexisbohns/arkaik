"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { orderEvents } from "@arkaik/schema";
import { PageShell } from "@/components/layout/PageShell";
import { useNodes } from "@/lib/hooks/useNodes";
import { useJournal } from "@/lib/hooks/useJournal";
import { describeJournalEvent, formatEventDate } from "@/components/journal/describe-event";

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

export default function HistoryPage() {
  const params = useParams();
  const id = Array.isArray(params.id) ? params.id[0] : params.id ?? "";

  const { nodes: dataNodes, loading: nodesLoading } = useNodes(id);
  const { journal, loading: journalLoading } = useJournal(id);
  const [family, setFamily] = useState<FamilyId | null>(null);

  const nodesById = useMemo(() => new Map(dataNodes.map((node) => [node.id, node])), [dataNodes]);

  const events = useMemo(() => {
    const ordered = orderEvents(journal).reverse(); // newest first
    if (family === null) return ordered;
    const prefixes = FAMILIES.find((f) => f.id === family)?.prefixes ?? [];
    return ordered.filter((event) => prefixes.some((prefix) => event.type.startsWith(prefix)));
  }, [journal, family]);

  if (nodesLoading || journalLoading) {
    return (
      <div className="h-full w-full flex items-center justify-center">
        <span className="text-muted-foreground text-sm">Loading history...</span>
      </div>
    );
  }

  return (
    <PageShell title="History" meta={`${journal.length} event${journal.length === 1 ? "" : "s"}`}>
      <div className="h-full overflow-auto p-4 md:p-6">
        <div className="flex w-full flex-col gap-4">
          {journal.length === 0 ? (
            <div className="rounded-xl border border-dashed p-10 text-center">
              <p className="text-sm text-muted-foreground">
                No journal yet. Every recorded event will appear here.
              </p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setFamily(null)}
                  className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                    family === null ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  All
                </button>
                {FAMILIES.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => setFamily(family === entry.id ? null : entry.id)}
                    className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                      family === entry.id ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>

              {events.length === 0 ? (
                <p className="text-sm text-muted-foreground">No events in this family.</p>
              ) : (
                <div className="flex flex-col gap-0.5">
                  {events.map((event) => {
                    const { icon: Icon, text, meta } = describeJournalEvent(event, nodesById);

                    return (
                      <div key={event.id} className="flex items-start gap-2 rounded-md px-2 py-1.5 text-sm">
                        <Icon className="size-3.5 shrink-0 text-muted-foreground mt-0.5" aria-hidden="true" />
                        <div className="flex-1 min-w-0">
                          <p className="truncate">{text}</p>
                          {meta && <p className="text-xs text-muted-foreground truncate">{meta}</p>}
                        </div>
                        <span className="text-xs text-muted-foreground shrink-0">{formatEventDate(event.ts)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </PageShell>
  );
}
