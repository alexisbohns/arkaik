"use client";

import { useMemo, type ReactNode } from "react";
import Link from "next/link";
import { ExternalLinkIcon, PackageIcon, ScaleIcon, TagIcon } from "lucide-react";
import { orderEvents } from "@arkaik/schema";
import { PageError } from "@/components/layout/PageError";
import { PageLoading } from "@/components/layout/PageLoading";
import { PageShell } from "@/components/layout/PageShell";
import { DecisionStatusBadge } from "@/components/layout/DecisionStatusBadge";
import { EmptyState } from "@/components/ui/empty-state";
import { useEdges } from "@/lib/hooks/useEdges";
import { useNodes } from "@/lib/hooks/useNodes";
import { useEffectiveProduct } from "@/lib/hooks/useProductScope";
import { useProject } from "@/lib/hooks/useProject";
import { useProjectId } from "@/lib/hooks/useProjectId";
import { useJournal } from "@/lib/hooks/useJournal";
import { useProjectPanels } from "@/lib/hooks/useProjectPanels";
import {
  computeBacklog,
  computeCommitments,
  computeDeliverables,
  type Backlog,
  type Deliverable,
} from "@/lib/utils/journal";
import { formatEventDate } from "@/components/journal/describe-event";
import { BacklogItemRow, FeedRow } from "@/components/journal/FeedRow";
import type { DecisionStatusId } from "@/lib/config/decision-statuses";
import { PLATFORM_LABELS } from "@/components/graph/nodes/node-styles";
import { productScopeMetaLabel } from "@/lib/utils/product-scope";
import type { Node, ReleaseTaggedEvent } from "@/lib/data/types";

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
              aria-label={`Open pull request: ${deliverable.title}`}
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
              {PLATFORM_LABELS[tag.platform] ?? tag.platform}
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

/**
 * The backlog column. The row itself now lives in `components/journal/FeedRow`
 * beside the feed row it was a near-copy of (audit `factorization-4`) — what is
 * left here is this page's own framing: the "nothing open" sentence, which the
 * overview's `BacklogCard` words differently.
 */
function BacklogList({ backlog }: { backlog: Backlog }) {
  if (backlog.items.length === 0) {
    return <p className="text-sm text-muted-foreground">No open ideas or requests.</p>;
  }

  return (
    <div className="flex flex-col gap-0.5">
      {backlog.items.map((item) => (
        <BacklogItemRow key={item.id} item={item} />
      ))}
    </div>
  );
}

function SectionHeading({ children }: { children: ReactNode }) {
  return <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{children}</h3>;
}

export default function ChangelogPage() {
  const id = useProjectId();

  const { project: projectBundle, loading: projectLoading, error: projectError, reload: reloadProject } = useProject(id);
  const { nodes: dataNodes, loading: nodesLoading, error: nodesError, reload: reloadNodes } = useNodes(id);
  const { edges: dataEdges, error: edgesError, reload: reloadEdges } = useEdges(id);
  const { journal, loading: journalLoading, error: journalError, reload: reloadJournal } = useJournal(id);
  const { openNode } = useProjectPanels();
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
    // A re-tagged version resolves to its latest occurrence (latest content);
    // keep the last occurrence per version, most-recent first by each
    // version's first appearance — a re-tag updates a card in place rather
    // than reshuffling.
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
    return <PageLoading label="changelog" />;
  }

  // Before `isEmpty`, never after (#362): an unread journal is `[]`, which is
  // the same thing a project that has never shipped has — and this page's empty
  // sentence ("Releases and updates will appear here once history is recorded")
  // would then quietly deny every release the project has ever tagged.
  const loadError = projectError ?? nodesError ?? edgesError ?? journalError;
  if (loadError) {
    return (
      <PageError
        label="changelog"
        message={loadError}
        onRetry={() => {
          void reloadProject();
          void reloadNodes();
          void reloadEdges();
          void reloadJournal();
        }}
      />
    );
  }

  const isEmpty = journal.length === 0;

  return (
    <PageShell
      title="Changelog"
      meta={productScopeMetaLabel(scope)}
      allNodes={dataNodes}
      allEdges={dataEdges}
      scope={scope}
      journal={journal}
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
          <EmptyState message="No journal yet. Releases and updates will appear here once history is recorded." />
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
                        onOpen={typeof event.node_id === "string" ? () => openNode({ nodeId: event.node_id as string }) : undefined}
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
