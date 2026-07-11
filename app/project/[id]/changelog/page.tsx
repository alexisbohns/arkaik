"use client";

import { useMemo } from "react";
import { useParams } from "next/navigation";
import { LightbulbIcon, MessageSquareTextIcon, TagIcon } from "lucide-react";
import { orderEvents } from "@arkaik/schema";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useNodes } from "@/lib/hooks/useNodes";
import { useProject } from "@/lib/hooks/useProject";
import { useJournal } from "@/lib/hooks/useJournal";
import { computeBacklog, computeChangelog, type Backlog, type Changelog } from "@/lib/utils/journal";
import { describeJournalEvent, formatEventDate } from "@/components/journal/describe-event";
import { PLATFORM_LABELS } from "@/components/graph/nodes/node-styles";
import type { Node, ReleaseTaggedEvent } from "@/lib/data/types";

interface ReleaseEntry {
  tag: ReleaseTaggedEvent;
  changelog: Changelog;
}

function ReleaseCard({ entry, nodesById }: { entry: ReleaseEntry; nodesById: Map<string, Node> }) {
  const { tag, changelog } = entry;

  return (
    <div className="rounded-xl border bg-card p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <TagIcon className="size-4 text-muted-foreground" aria-hidden="true" />
          <span className="text-sm font-semibold">{changelog.toVersion}</span>
          {changelog.platform && (
            <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
              {PLATFORM_LABELS[changelog.platform]}
            </span>
          )}
        </div>
        <span className="text-xs text-muted-foreground">{formatEventDate(tag.ts)}</span>
      </div>
      {tag.notes && <p className="text-sm text-muted-foreground">{tag.notes}</p>}
      {changelog.events.length === 0 ? (
        <p className="text-xs text-muted-foreground">No changes recorded for this release.</p>
      ) : (
        <div className="flex flex-col gap-0.5">
          {changelog.events.map((event) => {
            const { icon: Icon, text, meta } = describeJournalEvent(event, nodesById);

            return (
              <div key={event.id} className="flex items-start gap-2 rounded-md px-2 py-1.5 text-sm">
                <Icon className="size-3.5 shrink-0 text-muted-foreground mt-0.5" aria-hidden="true" />
                <div className="flex-1 min-w-0">
                  <p className="truncate">{text}</p>
                  {meta && <p className="text-xs text-muted-foreground truncate">{meta}</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function BacklogList({ backlog }: { backlog: Backlog }) {
  if (backlog.items.length === 0) {
    return <p className="text-sm text-muted-foreground">No open ideas or requests.</p>;
  }

  return (
    <div className="flex flex-col gap-0.5">
      {backlog.items.map((item) => {
        const Icon = item.type === "idea.proposed" ? LightbulbIcon : MessageSquareTextIcon;

        return (
          <div key={item.id} className="flex items-start gap-2 rounded-md border px-3 py-2 text-sm">
            <Icon className="size-3.5 shrink-0 text-muted-foreground mt-0.5" aria-hidden="true" />
            <div className="flex-1 min-w-0">
              <p className="truncate font-medium">{item.title}</p>
              {item.description && <p className="text-xs text-muted-foreground truncate">{item.description}</p>}
            </div>
            <span className="text-xs text-muted-foreground shrink-0">
              {item.type === "idea.proposed" ? "Idea" : "Request"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function ChangelogPage() {
  const params = useParams();
  const id = Array.isArray(params.id) ? params.id[0] : params.id ?? "";

  const { project: projectBundle, loading: projectLoading } = useProject(id);
  const { nodes: dataNodes, loading: nodesLoading } = useNodes(id);
  const { journal, loading: journalLoading } = useJournal(id);

  const nodesById = useMemo(() => new Map(dataNodes.map((node) => [node.id, node])), [dataNodes]);

  const releases = useMemo<ReleaseEntry[]>(() => {
    const tags = orderEvents(
      journal.filter((event): event is ReleaseTaggedEvent => event.type === "release.tagged"),
    );
    // A re-tagged version resolves to its latest occurrence (computeChangelog's own rule);
    // keep the last one per version, most-recent release first.
    const byVersion = new Map<string, ReleaseTaggedEvent>();
    for (const tag of tags) byVersion.set(tag.version, tag);

    return [...byVersion.values()].reverse().map((tag) => ({
      tag,
      changelog: computeChangelog(journal, tag.version, { nodesById }),
    }));
  }, [journal, nodesById]);

  const backlog = useMemo(
    () => computeBacklog(journal, { existingNodeIds: new Set(dataNodes.map((node) => node.id)) }),
    [journal, dataNodes],
  );

  if (projectLoading || nodesLoading || journalLoading) {
    return (
      <div className="h-full w-full flex items-center justify-center">
        <span className="text-muted-foreground text-sm">Loading changelog...</span>
      </div>
    );
  }

  const isEmpty = journal.length === 0;

  return (
    <div className="h-full w-full flex flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <SidebarTrigger className="-ml-1 cursor-pointer" />
        <Separator orientation="vertical" className="mx-1 h-4" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{projectBundle?.project.title ?? "Untitled project"}</p>
          <p className="truncate text-xs text-muted-foreground">Changelog</p>
        </div>
        {projectBundle?.project.version && (
          <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            <span>Current version</span>
            <span className="rounded-full border px-2 py-0.5 font-medium text-foreground">
              {projectBundle.project.version}
            </span>
          </div>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-4 md:p-6">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
          {isEmpty ? (
            <div className="rounded-xl border border-dashed p-10 text-center">
              <p className="text-sm text-muted-foreground">
                No journal yet. Releases and updates will appear here once history is recorded.
              </p>
            </div>
          ) : (
            <>
              <section className="flex flex-col gap-4">
                <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Releases</h2>
                {releases.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No releases tagged yet.</p>
                ) : (
                  <div className="flex flex-col gap-6">
                    {releases.map((entry) => (
                      <ReleaseCard key={entry.tag.id} entry={entry} nodesById={nodesById} />
                    ))}
                  </div>
                )}
              </section>

              <section className="flex flex-col gap-3">
                <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Backlog</h2>
                <BacklogList backlog={backlog} />
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
