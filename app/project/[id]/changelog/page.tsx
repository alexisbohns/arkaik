"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { MilestoneIcon, PackageIcon } from "lucide-react";
import { orderEvents } from "@arkaik/schema";
import { PageError } from "@/components/layout/PageError";
import { PageLoading } from "@/components/layout/PageLoading";
import { PageShell } from "@/components/layout/PageShell";
import { PageSurface } from "@/components/layout/PageSurface";
import { ChangelogRail } from "@/components/journal/ChangelogRail";
import { ReleaseDetail } from "@/components/journal/ReleaseDetail";
import { ReleaseList } from "@/components/journal/ReleaseList";
import { ReleasePicker } from "@/components/journal/ReleasePicker";
import type { ReleaseEntry } from "@/components/journal/release-entry";
import { EmptyState } from "@/components/ui/empty-state";
import { useEdges } from "@/lib/hooks/useEdges";
import { useNodes } from "@/lib/hooks/useNodes";
import { useEffectiveProduct } from "@/lib/hooks/useProductScope";
import { useProject } from "@/lib/hooks/useProject";
import { useProjectId } from "@/lib/hooks/useProjectId";
import { useQueryWriter } from "@/lib/hooks/useQueryWriter";
import { useJournal } from "@/lib/hooks/useJournal";
import { computeDeliverables } from "@/lib/utils/journal";
import { RELEASE_PARAM, UNRELEASED_KEY, resolveSelectedRelease } from "@/lib/utils/changelog-releases";
import { ALL_PERIODS, listYears, matchesPeriod, type Period } from "@/lib/utils/changelog-period";
import { formatEventDate } from "@/components/journal/describe-event";
import { PLATFORM_LABELS } from "@/components/graph/nodes/node-styles";
import type { ReleaseTaggedEvent } from "@/lib/data/types";

function countLabel(count: number): string {
  return `${count} deliverable${count === 1 ? "" : "s"}`;
}

/**
 * What this page reads. A projection, so it must stay in step with what the
 * page renders — and with its empty state, which now says "no releases, nothing
 * shipped" rather than "no journal": the events that would contradict a
 * broader claim are no longer read.
 */
const CHANGELOG_EVENT_TYPES = ["deliverable.shipped", "release.tagged"] as const;

/**
 * The Changelog: what shipped, milestone by milestone.
 *
 * Master-detail: the releases down the left, the selected one on the right as
 * a timeline of its deliverables. The selection lives in `?release=`, so a
 * release is a link you can share. When the surface is under 48rem — a node
 * panel halves it on a wide screen too — the list folds into a picker above
 * the release. The design funnel that used to share this screen (backlog,
 * commitments, decisions) has its own page; none of it had shipped, which is
 * the one thing a changelog is about.
 */
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

  // One list for the three views of it — the column, the picker, the detail —
  // so a release reads the same wherever it is drawn. Unreleased first: it is
  // the milestone that has not happened yet, and it sits where the next one
  // will.
  const entries = useMemo<ReleaseEntry[]>(
    () => [
      ...(unreleased.length > 0
        ? [
            {
              key: UNRELEASED_KEY,
              title: "Unreleased",
              icon: PackageIcon,
              subtitle: countLabel(unreleased.length),
              meta: "Not tagged yet",
              count: unreleased.length,
              description: "Shipped since the last tag, not yet in a release.",
              deliverables: unreleased,
            },
          ]
        : []),
      ...milestones.map(({ tag, deliverables: shipped }) => {
        const meta = [formatEventDate(tag.ts), tag.platform ? (PLATFORM_LABELS[tag.platform] ?? tag.platform) : null]
          .filter(Boolean)
          .join(" · ");
        return {
          key: tag.version,
          title: tag.version,
          icon: MilestoneIcon,
          subtitle: `${meta} · ${countLabel(shipped.length)}`,
          meta,
          count: shipped.length,
          description: tag.notes,
          deliverables: shipped,
        };
      }),
    ],
    [milestones, unreleased],
  );

  const searchParams = useSearchParams();
  const writeQuery = useQueryWriter();
  const selectedKey = resolveSelectedRelease(
    entries.map((entry) => entry.key),
    searchParams.get(RELEASE_PARAM),
  );
  const selected = entries.find((entry) => entry.key === selectedKey) ?? null;
  // Written even when it equals the default row: a link should say what it
  // shows. `replace`, not `push` — picking a release is not a navigation.
  const selectRelease = (key: string) => writeQuery((params) => params.set(RELEASE_PARAM, key));

  if (projectLoading || nodesLoading || journalLoading) {
    return <PageLoading label="changelog" />;
  }

  // Before `isEmpty`, never after (#362): an unread journal is `[]`, which is
  // the same thing a project that has never shipped has — and this page's empty
  // sentence ("No releases tagged yet, and nothing shipped since.")
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

  return (
    <PageShell
      title="Changelog"
      allNodes={dataNodes}
      allEdges={dataEdges}
      scope={scope}
      history
      // No pane around the page: the release list is its own stack of cards,
      // and a card around cards is the box-in-a-box this repo took out.
      surfaceBare
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
      <PageSurface fill contentClassName="flex flex-col">
        {/* `selected` is null exactly when the list is empty — nothing tagged,
            or nothing in the period — so it doubles as the empty check. */}
        {isEmpty || !selected ? (
          <div className="p-4 md:p-6">
            <EmptyState
              message={
                !isEmpty && isFiltered
                  ? "Nothing shipped in that period. Widen the year or month filter."
                  : "No releases tagged yet, and nothing shipped since."
              }
            />
          </div>
        ) : (
          // The surface, not the viewport, decides the layout: a node panel
          // halves the surface on a wide screen too. Under 48rem of surface the
          // list folds into a picker above the release.
          <div className="@container flex min-h-0 flex-1 flex-col">
            <div className="pb-3 @3xl:hidden">
              <ReleasePicker entries={entries} value={selected.key} onChange={selectRelease} />
            </div>
            <div className="flex min-h-0 flex-1 gap-3">
              <ReleaseList
                entries={entries}
                selectedKey={selected.key}
                onSelect={selectRelease}
                className="hidden w-72 shrink-0 overflow-y-auto @3xl:flex"
              />
              {/* The release is a pane of its own — a card beside the list, the
                  way a node panel sits beside a surface. Keyed by the release
                  so the scroller remounts at the top: one shared node would
                  open the next release wherever the last one was left, past
                  its heading. */}
              <div key={selected.key} className="min-w-0 flex-1 overflow-y-auto rounded-xl bg-card p-4 md:p-6">
                <ReleaseDetail entry={selected} nodesById={nodesById} detailed={detailed} />
              </div>
            </div>
          </div>
        )}
      </PageSurface>
    </PageShell>
  );
}
