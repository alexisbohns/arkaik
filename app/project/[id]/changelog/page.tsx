"use client";

import { useMemo, useState } from "react";
import { MilestoneIcon, PackageIcon } from "lucide-react";
import { orderEvents } from "@arkaik/schema";
import { PageError } from "@/components/layout/PageError";
import { PageLoading } from "@/components/layout/PageLoading";
import { PageShell } from "@/components/layout/PageShell";
import { PageSurface } from "@/components/layout/PageSurface";
import { SectionRow } from "@/components/layout/SectionRow";
import { ChangelogRail } from "@/components/journal/ChangelogRail";
import { DeliverableTimeline } from "@/components/journal/DeliverableTimeline";
import { EmptyState } from "@/components/ui/empty-state";
import { useEdges } from "@/lib/hooks/useEdges";
import { useNodes } from "@/lib/hooks/useNodes";
import { useEffectiveProduct } from "@/lib/hooks/useProductScope";
import { useProject } from "@/lib/hooks/useProject";
import { useProjectId } from "@/lib/hooks/useProjectId";
import { useJournal } from "@/lib/hooks/useJournal";
import { computeDeliverables } from "@/lib/utils/journal";
import { ALL_PERIODS, listYears, matchesPeriod, type Period } from "@/lib/utils/changelog-period";
import { formatEventDate } from "@/components/journal/describe-event";
import { PLATFORM_LABELS } from "@/components/graph/nodes/node-styles";
import type { ReleaseTaggedEvent } from "@/lib/data/types";

function countLabel(count: number): string {
  return `${count} deliverable${count === 1 ? "" : "s"}`;
}

/**
 * The Changelog: what shipped, milestone by milestone.
 *
 * One section per milestone in the Overview's rows shape — the release on the
 * left, its deliverables as a timeline on the right. The design funnel that
 * used to share this screen (backlog, commitments, decisions) has its own page;
 * none of it had shipped, which is the one thing a changelog is about.
 */
/**
 * What this page reads. A projection, so it must stay in step with what the
 * page renders — and with its empty state, which now says "no releases, nothing
 * shipped" rather than "no journal": the events that would contradict a
 * broader claim are no longer read.
 */
const CHANGELOG_EVENT_TYPES = ["deliverable.shipped", "release.tagged"] as const;

export default function ChangelogPage() {
  const id = useProjectId();

  const { project: projectBundle, loading: projectLoading, error: projectError, reload: reloadProject } = useProject(id);
  const { nodes: dataNodes, loading: nodesLoading, error: nodesError, reload: reloadNodes } = useNodes(id);
  const { edges: dataEdges, error: edgesError, reload: reloadEdges } = useEdges(id);
  // The page renders shipped work and the releases it falls under, and nothing
  // else: on a hosted project the rest of the journal never crosses the wire
  // (`computeDeliverables` reads exactly these two types, and the release
  // filter below reads one of them).
  const {
    journal,
    loading: journalLoading,
    error: journalError,
    reload: reloadJournal,
  } = useJournal(id, { types: CHANGELOG_EVENT_TYPES });
  // Display only — the changelog itself stays unscoped; this just fills the
  // header's meta line with the same scope name every other surface shows.
  const scope = useEffectiveProduct(id, projectBundle);

  const [period, setPeriod] = useState<Period>({ year: null, month: null });
  const [detailed, setDetailed] = useState(true);

  const nodesById = useMemo(() => new Map(dataNodes.map((node) => [node.id, node])), [dataNodes]);

  const deliverables = useMemo(() => computeDeliverables(journal), [journal]);

  const releaseTags = useMemo(() => {
    const tags = orderEvents(
      journal.filter((event): event is ReleaseTaggedEvent => event.type === "release.tagged"),
    );
    // A re-tagged version resolves to its latest occurrence (latest content);
    // keep the last occurrence per version, most-recent first by each version's
    // first appearance — a re-tag updates a milestone in place rather than
    // reshuffling the page.
    const byVersion = new Map<string, ReleaseTaggedEvent>();
    for (const tag of tags) byVersion.set(tag.version, tag);
    return [...byVersion.values()].reverse();
  }, [journal]);

  // The year menu offers the years the timeline actually has — milestones and
  // unreleased work alike, so a filter can never be offered that empties the
  // page on its own.
  const years = useMemo(
    () => listYears([...releaseTags.map((tag) => tag.ts), ...deliverables.map((d) => d.ts)]),
    [deliverables, releaseTags],
  );

  const unreleased = useMemo(
    () =>
      deliverables
        .filter((d) => d.releaseVersion === null && matchesPeriod(d.ts, period))
        .reverse(),
    [deliverables, period],
  );

  // A milestone is filtered by its own tag date, not by its deliverables': the
  // milestone is the thing the reader picked a month to look at, and a release
  // tagged in March keeps the February work it shipped.
  const milestones = useMemo(
    () =>
      releaseTags
        .filter((tag) => matchesPeriod(tag.ts, period))
        .map((tag) => ({
          tag,
          deliverables: deliverables.filter((d) => d.releaseVersion === tag.version).reverse(),
        })),
    [deliverables, period, releaseTags],
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
  const isFiltered = period.year !== null || period.month !== null;
  const nothingInPeriod = unreleased.length === 0 && milestones.length === 0;

  return (
    <PageShell
      title="Changelog"
      allNodes={dataNodes}
      allEdges={dataEdges}
      scope={scope}
      history
      rail={
        isEmpty ? undefined : (
          <ChangelogRail
            years={years}
            year={period.year}
            month={period.month}
            detailed={detailed}
            onYearChange={(year) => setPeriod((previous) => ({ ...previous, year }))}
            onMonthChange={(month) => setPeriod((previous) => ({ ...previous, month }))}
            onDetailedChange={setDetailed}
            onReset={() => setPeriod(ALL_PERIODS)}
          />
        )
      }
    >
      <PageSurface contentClassName="flex flex-col divide-y">
        {isEmpty ? (
          <EmptyState message="No releases tagged yet, and nothing shipped since." />
        ) : nothingInPeriod ? (
          <EmptyState
            message={
              isFiltered
                ? "Nothing shipped in that period. Widen the year or month filter."
                : "No releases tagged yet, and nothing shipped since."
            }
          />
        ) : (
          <>
            {/* Unreleased first: it is the milestone that has not happened yet,
                and it sits where the next one will. */}
            {unreleased.length > 0 && (
              <SectionRow
                title="Unreleased"
                icon={PackageIcon}
                description="Shipped since the last tag, not yet in a release."
                subtitle={countLabel(unreleased.length)}
                stickyHeader
              >
                <DeliverableTimeline deliverables={unreleased} nodesById={nodesById} detailed={detailed} />
              </SectionRow>
            )}

            {milestones.map(({ tag, deliverables: shipped }) => (
              <SectionRow
                key={tag.id}
                title={tag.version}
                icon={MilestoneIcon}
                stickyHeader
                description={tag.notes}
                subtitle={[
                  formatEventDate(tag.ts),
                  tag.platform ? (PLATFORM_LABELS[tag.platform] ?? tag.platform) : null,
                  countLabel(shipped.length),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              >
                {shipped.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No deliverables recorded for this release.</p>
                ) : (
                  <DeliverableTimeline deliverables={shipped} nodesById={nodesById} detailed={detailed} />
                )}
              </SectionRow>
            ))}
          </>
        )}
      </PageSurface>
    </PageShell>
  );
}
