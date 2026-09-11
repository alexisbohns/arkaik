"use client";

import { useMemo, useState } from "react";
import { MilestoneIcon, PackageIcon } from "lucide-react";
import { orderEvents } from "@arkaik/schema";
import { PageError } from "@/components/layout/PageError";
import { PageLoading } from "@/components/layout/PageLoading";
import { PageShell } from "@/components/layout/PageShell";
import { PageSurface } from "@/components/layout/PageSurface";
import { SectionRow } from "@/components/layout/SectionRow";
import { ChangelogFilterBar } from "@/components/journal/ChangelogFilterBar";
import { DeliverableChips, DeliverableHoverCard, ICON_TILE } from "@/components/journal/DeliverableHoverCard";
import { EmptyState } from "@/components/ui/empty-state";
import { useEdges } from "@/lib/hooks/useEdges";
import { useNodes } from "@/lib/hooks/useNodes";
import { useEffectiveProduct } from "@/lib/hooks/useProductScope";
import { useProject } from "@/lib/hooks/useProject";
import { useProjectId } from "@/lib/hooks/useProjectId";
import { useJournal } from "@/lib/hooks/useJournal";
import { computeDeliverables, type Deliverable } from "@/lib/utils/journal";
import { listYears, matchesPeriod, type Period } from "@/lib/utils/changelog-period";
import { formatEventDate } from "@/components/journal/describe-event";
import { PLATFORM_LABELS } from "@/components/graph/nodes/node-styles";
import { productScopeMetaLabel } from "@/lib/utils/product-scope";
import type { Node, ReleaseTaggedEvent } from "@/lib/data/types";

/**
 * The shipped mark on the rail: the shared boxed-icon tile, nudged up by 2px so
 * the 24px box centres on the 20px first line of the title beside it. Same tile
 * as the marks under the row (`DeliverableChips`) — one box, three placements.
 */
const SHIP_MARK = `${ICON_TILE} -mt-0.5`;

/**
 * The deliverables of one milestone, drawn as a timeline: a rail of marks down
 * the left, one entry each, newest first.
 *
 * There is deliberately no card per deliverable. The old page nested a bordered
 * row inside a bordered release card inside a bordered section — three lids for
 * one fact. The rail carries the grouping instead, and `detailed` decides
 * whether each entry says more than its title.
 */
function DeliverableTimeline({
  deliverables,
  nodesById,
  detailed,
}: {
  deliverables: readonly Deliverable[];
  nodesById: Map<string, Node>;
  detailed: boolean;
}) {
  return (
    <ol className="flex flex-col">
      {deliverables.map((deliverable, index) => (
        <li key={deliverable.deliverable_id} className="grid grid-cols-[auto_1fr] gap-x-3">
          {/* The rail. The connector is `flex-1` inside a stretched grid cell,
              so it runs to the bottom of the entry however tall it grows — and
              is absent on the last one, which would otherwise trail into
              nothing.
              The breathing room below each entry belongs to the *content*
              column, never to the `<li>`: a grid child stretches to the content
              box, so padding on the row would end the connector above the gap
              and leave the dots unlinked.

              The node on the rail is the *shipped* mark — a package, in the
              green the `live` status already uses, because what the rail plots
              is delivery: each node is one thing that reached users. It is
              deliberately not a link. The pull request has its own mark under
              the row, in the forge's purple, and one glyph that both stood for
              "shipped" and navigated to GitHub was doing two jobs badly.

              What the rail mark does carry is the preview: hovering it opens
              the deliverable's card, whose substance — the summary and the
              touched nodes' current status — has nothing to do with the URL,
              and so is there whether or not a link exists. */}
          <div className="flex flex-col items-center">
            <DeliverableHoverCard deliverable={deliverable} nodesById={nodesById}>
              <span className={`${SHIP_MARK} bg-green-500/10 text-green-600 dark:text-green-400`}>
                <PackageIcon className="size-3" aria-hidden="true" />
              </span>
            </DeliverableHoverCard>
            {index < deliverables.length - 1 && <span className="w-px flex-1 bg-border" aria-hidden="true" />}
          </div>

          <div className={`flex min-w-0 flex-col gap-1 ${index < deliverables.length - 1 ? "pb-4" : ""}`}>
            <div className="flex items-baseline justify-between gap-3">
              <p className="truncate text-sm font-medium">{deliverable.title}</p>
              <span className="shrink-0 text-xs text-muted-foreground">{formatEventDate(deliverable.ts)}</span>
            </div>

            {detailed && deliverable.summary && (
              <p className="text-xs text-muted-foreground">{deliverable.summary}</p>
            )}
            {detailed && <DeliverableChips deliverable={deliverable} nodesById={nodesById} />}
          </div>
        </li>
      ))}
    </ol>
  );
}

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
      meta={productScopeMetaLabel(scope)}
      allNodes={dataNodes}
      allEdges={dataEdges}
      scope={scope}
      history
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
      <PageSurface
        contentClassName="flex flex-col divide-y"
        toolbar={
          isEmpty ? undefined : (
            <ChangelogFilterBar
              years={years}
              year={period.year}
              month={period.month}
              detailed={detailed}
              onYearChange={(year) => setPeriod((previous) => ({ ...previous, year }))}
              onMonthChange={(month) => setPeriod((previous) => ({ ...previous, month }))}
              onDetailedChange={setDetailed}
            />
          )
        }
      >
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
