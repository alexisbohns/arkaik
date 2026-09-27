"use client";

import { InboxIcon, LightbulbIcon, MessageSquareTextIcon } from "lucide-react";
import type { Backlog } from "@/lib/utils/journal";
import { OverviewSection } from "./OverviewSection";

const MAX_ROWS = 5;

interface BacklogCardProps {
  backlog: Backlog;
  projectId: string;
  /**
   * The journal has not been read yet. The card keeps its empty layout with a
   * placeholder subtitle rather than claiming the backlog is clear.
   */
  pending?: boolean;
  /**
   * The journal read failed. The message takes the placeholder's slot so the
   * card never claims the backlog is clear over a journal it could not read.
   */
  error?: string | null;
}

/** Open ideas and requests — journal items not yet realized as nodes. */
export function BacklogCard({ backlog, projectId, pending = false, error = null }: BacklogCardProps) {
  const overflow = backlog.items.length - MAX_ROWS;
  const unavailable = pending || error !== null;

  return (
    <OverviewSection
      title="Backlog"
      icon={InboxIcon}
      description="What the journal has recorded as wanted but not yet drawn into the graph."
      subtitle={
        pending
          ? "…"
          : error !== null
            ? error
            : backlog.items.length === 0
              ? "No open ideas or requests."
              : `${backlog.items.length} open — ${backlog.ideas.length} idea${backlog.ideas.length === 1 ? "" : "s"}, ${backlog.requests.length} request${backlog.requests.length === 1 ? "" : "s"}`
      }
      href={`/project/${projectId}/design`}
      linkLabel="Design"
    >
      {!unavailable && backlog.items.length > 0 && (
        <>
          <div className="flex flex-col gap-0.5">
            {backlog.items.slice(0, MAX_ROWS).map((item) => {
              const Icon = item.type === "idea.proposed" ? LightbulbIcon : MessageSquareTextIcon;

              return (
                <div key={item.id} className="flex items-start gap-2 rounded-md border px-3 py-2 text-sm">
                  <Icon className="size-3.5 shrink-0 text-muted-foreground mt-0.5" aria-hidden="true" />
                  <p className="min-w-0 flex-1 truncate font-medium">{item.title}</p>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {item.type === "idea.proposed" ? "Idea" : "Request"}
                  </span>
                </div>
              );
            })}
          </div>
          {overflow > 0 && (
            <p className="text-xs text-muted-foreground">
              +{overflow} more on the Design page
            </p>
          )}
        </>
      )}
    </OverviewSection>
  );
}
