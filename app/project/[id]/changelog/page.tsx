"use client";

import { useMemo, type ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ExternalLinkIcon,
  LightbulbIcon,
  MessageSquareTextIcon,
  PackageIcon,
  ScaleIcon,
  TagIcon,
} from "lucide-react";
import { orderEvents } from "@arkaik/schema";
import { PageShell } from "@/components/layout/PageShell";
import { DecisionStatusBadge } from "@/components/layout/DecisionStatusBadge";
import { useNodes } from "@/lib/hooks/useNodes";
import { useEffectiveProduct } from "@/lib/hooks/useProductScope";
import { useProject } from "@/lib/hooks/useProject";
import { useJournal } from "@/lib/hooks/useJournal";
import {
  computeBacklog,
  computeCommitments,
  computeDeliverables,
  type Backlog,
  type Deliverable,
} from "@/lib/utils/journal";
import { describeJournalEvent, formatEventDate } from "@/components/journal/describe-event";
import type { DecisionStatusId } from "@/lib/config/decision-statuses";
import { PLATFORM_LABELS } from "@/components/graph/nodes/node-styles";
import { productScopeMetaLabel } from "@/lib/utils/product-scope";
import type { Node, JournalEvent, ReleaseTaggedEvent } from "@/lib/data/types";

/** One deliverable row: title, note, PR link, touched-node chips. */
function DeliverableRow({ deliverable, nodesById }: { deliverable: Deliverable; nodesById: Map<string, Node> }) {
  return (
    <div className="flex items-start gap-2 rounded-md border px-3 py-2 text-sm">
      <PackageIcon className="size-3.5 shrink-0 text-muted-foreground mt-0.5" aria-hidden="true" />
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <div className="flex items-center gap-2 min-w-0">
          <p className="truncate font-medium">{deliverable.title}</p>
          {deliverable.url && (
            <a
              href={deliverable.url}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 text-muted-foreground hover:text-foreground"
              aria-label="Open pull request"
            >
              <ExternalLinkIcon className="size-3.5" />
            </a>
          )}
        </div>
        {deliverable.summary && <p className="text-xs text-muted-foreground">{deliverable.summary}</p>}
        {deliverable.node_ids.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-0.5">
            {deliverable.node_ids.map((id) => (
              <span key={id} className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                {nodesById.get(id)?.title ?? id}
              </span>
            ))}
          </div>
        )}
      </div>
      <span className="text-xs text-muted-foreground shrink-0">{formatEventDate(deliverable.ts)}</span>
    </div>
  );
}

/** A release card: version marker + note + its deliverables (not the raw feed). */
function ReleaseCard({
  tag,
  deliverables,
  nodesById,
}: {
  tag: ReleaseTaggedEvent;
  deliverables: Deliverable[];
  nodesById: Map<string, Node>;
}) {
  return (
    <div className="rounded-xl border bg-card p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <TagIcon className="size-4 text-muted-foreground" aria-hidden="true" />
          <span className="text-sm font-semibold">{tag.version}</span>
          {tag.platform && (
            <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
              {PLATFORM_LABELS[tag.platform]}
            </span>
          )}
        </div>
        <span className="text-xs text-muted-foreground">{formatEventDate(tag.ts)}</span>
      </div>
      {tag.notes && <p className="text-sm text-muted-foreground">{tag.notes}</p>}
      {deliverables.length === 0 ? (
        <p className="text-xs text-muted-foreground">No deliverables recorded for this release.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {deliverables.map((deliverable) => (
            <DeliverableRow key={deliverable.deliverable_id} deliverable={deliverable} nodesById={nodesById} />
          ))}
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

/** A commitment or decision feed row. */
function FeedRow({
  event,
  nodesById,
  trailing,
}: {
  event: JournalEvent;
  nodesById: Map<string, Node>;
  trailing?: ReactNode;
}) {
  const { icon: Icon, text, meta } = describeJournalEvent(event, nodesById);

  return (
    <div className="flex items-start gap-2 rounded-md px-2 py-1.5 text-sm">
      <Icon className="size-3.5 shrink-0 text-muted-foreground mt-0.5" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <p className="truncate">{text}</p>
        {meta && <p className="text-xs text-muted-foreground truncate">{meta}</p>}
      </div>
      {trailing}
      <span className="text-xs text-muted-foreground shrink-0">{formatEventDate(event.ts)}</span>
    </div>
  );
}

function SectionHeading({ children }: { children: ReactNode }) {
  return <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{children}</h3>;
}

export default function ChangelogPage() {
  const params = useParams();
  const id = Array.isArray(params.id) ? params.id[0] : params.id ?? "";

  const { project: projectBundle, loading: projectLoading } = useProject(id);
  const { nodes: dataNodes, loading: nodesLoading } = useNodes(id);
  const { journal, loading: journalLoading } = useJournal(id);
  // Display only — the changelog itself stays unscoped; this just fills the
  // header's meta line with the same scope name every other surface shows.
  const scope = useEffectiveProduct(id, projectBundle);

  const nodesById = useMemo(() => new Map(dataNodes.map((node) => [node.id, node])), [dataNodes]);

  const deliverables = useMemo(() => computeDeliverables(journal), [journal]);
  const unreleased = useMemo(
    () => deliverables.filter((d) => d.releaseVersion === null).reverse(),
    [deliverables],
  );

  const releases = useMemo(() => {
    const tags = orderEvents(
      journal.filter((event): event is ReleaseTaggedEvent => event.type === "release.tagged"),
    );
    // A re-tagged version resolves to its latest occurrence; keep the last one
    // per version, most-recent release first.
    const byVersion = new Map<string, ReleaseTaggedEvent>();
    for (const tag of tags) byVersion.set(tag.version, tag);

    return [...byVersion.values()].reverse().map((tag) => ({
      tag,
      deliverables: deliverables.filter((d) => d.releaseVersion === tag.version),
    }));
  }, [journal, deliverables]);

  const commitments = useMemo(() => computeCommitments(journal).reverse(), [journal]);

  const decisionEvents = useMemo(
    () => orderEvents(journal.filter((event) => event.type === "decision.status_changed")).reverse(),
    [journal],
  );

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
    <PageShell
      title="Changelog"
      meta={productScopeMetaLabel(scope)}
      headerExtra={
        projectBundle?.project.version ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Current version</span>
            <span className="rounded-full border px-2 py-0.5 font-medium text-foreground">
              {projectBundle.project.version}
            </span>
          </div>
        ) : null
      }
    >
      <div className="h-full overflow-auto p-4 md:p-6">
        {isEmpty ? (
          <div className="rounded-xl border border-dashed p-10 text-center">
            <p className="text-sm text-muted-foreground">
              No journal yet. Releases and updates will appear here once history is recorded.
            </p>
          </div>
        ) : (
          <div className="grid w-full gap-6 lg:grid-cols-2 items-start">
            {/* Design: the funnel — open backlog → commitments → decisions. */}
            <section className="rounded-xl border bg-card/50 p-4 flex flex-col gap-5">
              <h2 className="text-sm font-semibold">Design</h2>

              <div className="flex flex-col gap-3">
                <SectionHeading>Backlog</SectionHeading>
                <BacklogList backlog={backlog} />
              </div>

              <div className="flex flex-col gap-3">
                <SectionHeading>Commitments</SectionHeading>
                {commitments.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No commitments yet.</p>
                ) : (
                  <div className="flex flex-col gap-0.5">
                    {commitments.map((event) => (
                      <FeedRow key={event.id} event={event} nodesById={nodesById} />
                    ))}
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <SectionHeading>Decisions</SectionHeading>
                  <Link
                    href={`/project/${id}/decisions`}
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <ScaleIcon className="size-3.5" aria-hidden="true" />
                    Decision Log →
                  </Link>
                </div>
                {decisionEvents.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No decision activity yet.</p>
                ) : (
                  <div className="flex flex-col gap-0.5">
                    {decisionEvents.map((event) => (
                      <FeedRow
                        key={event.id}
                        event={event}
                        nodesById={nodesById}
                        trailing={
                          typeof event.to === "string" ? (
                            <DecisionStatusBadge status={event.to as DecisionStatusId} className="shrink-0" />
                          ) : undefined
                        }
                      />
                    ))}
                  </div>
                )}
              </div>
            </section>

            {/* Delivery: unreleased deliverables, then releases newest-first. */}
            <section className="rounded-xl border bg-card/50 p-4 flex flex-col gap-5">
              <h2 className="text-sm font-semibold">Delivery</h2>

              {unreleased.length > 0 && (
                <div className="flex flex-col gap-3">
                  <SectionHeading>Unreleased</SectionHeading>
                  <div className="flex flex-col gap-1.5">
                    {unreleased.map((deliverable) => (
                      <DeliverableRow key={deliverable.deliverable_id} deliverable={deliverable} nodesById={nodesById} />
                    ))}
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-3">
                <SectionHeading>Releases</SectionHeading>
                {releases.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No releases tagged yet.</p>
                ) : (
                  <div className="flex flex-col gap-4">
                    {releases.map((entry) => (
                      <ReleaseCard
                        key={entry.tag.id}
                        tag={entry.tag}
                        deliverables={entry.deliverables}
                        nodesById={nodesById}
                      />
                    ))}
                  </div>
                )}
              </div>
            </section>
          </div>
        )}
      </div>
    </PageShell>
  );
}
