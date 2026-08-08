"use client";

import { useMemo } from "react";
import { HandshakeIcon, LightbulbIcon, ScaleIcon } from "lucide-react";
import { orderEvents } from "@arkaik/schema";
import { PageError } from "@/components/layout/PageError";
import { PageLoading } from "@/components/layout/PageLoading";
import { PageShell } from "@/components/layout/PageShell";
import { PageSurface } from "@/components/layout/PageSurface";
import { SectionRow } from "@/components/layout/SectionRow";
import { DecisionStatusBadge } from "@/components/layout/DecisionStatusBadge";
import { EmptyState } from "@/components/ui/empty-state";
import { useEdges } from "@/lib/hooks/useEdges";
import { useNodes } from "@/lib/hooks/useNodes";
import { useEffectiveProduct } from "@/lib/hooks/useProductScope";
import { useProject } from "@/lib/hooks/useProject";
import { useProjectId } from "@/lib/hooks/useProjectId";
import { useJournal } from "@/lib/hooks/useJournal";
import { useProjectPanels } from "@/lib/hooks/useProjectPanels";
import { computeBacklog, computeCommitments } from "@/lib/utils/journal";
import { BacklogItemRow, FeedRow } from "@/components/journal/FeedRow";
import type { DecisionStatusId } from "@/lib/config/decision-statuses";
import { productScopeMetaLabel } from "@/lib/utils/product-scope";

/**
 * Design: the funnel that runs *before* anything ships — open backlog, the
 * commitments made against it, and the decisions that closed the questions.
 *
 * It used to be the left column of the Changelog, which was the wrong home: a
 * changelog answers "what shipped", and none of this has shipped. Same rows
 * shell as the Overview (`SectionRow`) — heading left, content right.
 */
export default function DesignPage() {
  const id = useProjectId();

  const { project: projectBundle, loading: projectLoading, error: projectError, reload: reloadProject } = useProject(id);
  const { nodes: dataNodes, loading: nodesLoading, error: nodesError, reload: reloadNodes } = useNodes(id);
  const { edges: dataEdges, error: edgesError, reload: reloadEdges } = useEdges(id);
  const { journal, loading: journalLoading, error: journalError, reload: reloadJournal } = useJournal(id);
  const { openNode } = useProjectPanels();
  // Display only — the design funnel itself stays unscoped; this just fills the
  // header's meta line with the same scope name every other surface shows.
  const scope = useEffectiveProduct(id, projectBundle);

  const nodesById = useMemo(() => new Map(dataNodes.map((node) => [node.id, node])), [dataNodes]);

  const backlog = useMemo(
    () => computeBacklog(journal, { existingNodeIds: new Set(dataNodes.map((node) => node.id)) }),
    [journal, dataNodes],
  );

  const commitments = useMemo(() => computeCommitments(journal).reverse(), [journal]);

  const decisionEvents = useMemo(
    () => orderEvents(journal.filter((event) => event.type === "decision.status_changed")).reverse(),
    [journal],
  );

  if (projectLoading || nodesLoading || journalLoading) {
    return <PageLoading label="design" />;
  }

  // Before `isEmpty`, never after (#362): an unread journal is `[]`, which is
  // exactly what a project that has never filed an idea has.
  const loadError = projectError ?? nodesError ?? edgesError ?? journalError;
  if (loadError) {
    return (
      <PageError
        label="design"
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
      title="Design"
      meta={productScopeMetaLabel(scope)}
      allNodes={dataNodes}
      allEdges={dataEdges}
      scope={scope}
      journal={journal}
    >
      <PageSurface contentClassName="flex flex-col divide-y">
        {isEmpty ? (
          <EmptyState message="No journal yet. Ideas, commitments and decisions appear here once history is recorded." />
        ) : (
          <>
            <SectionRow
              title="Backlog"
              icon={LightbulbIcon}
              description="Ideas and requests filed but not yet committed to."
              subtitle={`${backlog.items.length} open`}
            >
              {backlog.items.length === 0 ? (
                <p className="text-sm text-muted-foreground">No open ideas or requests.</p>
              ) : (
                <div className="flex flex-col gap-0.5">
                  {backlog.items.map((item) => (
                    <BacklogItemRow key={item.id} item={item} />
                  ))}
                </div>
              )}
            </SectionRow>

            <SectionRow
              title="Commitments"
              icon={HandshakeIcon}
              description="What the team said it would do, and when it said so."
              subtitle={`${commitments.length} recorded`}
            >
              {commitments.length === 0 ? (
                <p className="text-sm text-muted-foreground">No commitments yet.</p>
              ) : (
                <div className="flex flex-col gap-0.5">
                  {commitments.map((event) => (
                    <FeedRow key={event.id} event={event} nodesById={nodesById} />
                  ))}
                </div>
              )}
            </SectionRow>

            <SectionRow
              title="Decisions"
              icon={ScaleIcon}
              description="Every status change on a decision, newest first."
              subtitle={`${decisionEvents.length} change${decisionEvents.length === 1 ? "" : "s"}`}
              href={`/project/${id}/decisions`}
              linkLabel="Decision Log"
            >
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
                      onOpen={
                        typeof event.node_id === "string"
                          ? () => openNode({ nodeId: event.node_id as string })
                          : undefined
                      }
                    />
                  ))}
                </div>
              )}
            </SectionRow>
          </>
        )}
      </PageSurface>
    </PageShell>
  );
}
