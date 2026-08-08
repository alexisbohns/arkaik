"use client";

import { useMemo, useState } from "react";
import { ChevronDownIcon, ChevronRightIcon, StethoscopeIcon } from "lucide-react";
import type { Node, Edge, ProjectBundle } from "@/lib/data/types";
import { resolvePlatformStatus, hasParityGap } from "@arkaik/schema";
import { groupAcceptancesByAnchor, UNANCHORED_GROUP_LABEL } from "@/lib/utils/acceptance-matrix";
import { type PlatformId } from "@/lib/config/platforms";
import { useEffectiveProduct } from "@/lib/hooks/useProductScope";
import { SPECIES_GRAPH_ICONS } from "@/lib/config/species-icons";
import { SPECIES } from "@/lib/config/species";
import { ValueBadge } from "@/components/values/ValueBadge";
import { EntityId, SpeciesBadge } from "@/components/graph/nodes/EntityBadges";
import { StatusMark } from "@/components/graph/nodes/StatusMark";
import { Ring } from "@/components/graph/nodes/StatusRing";
import { PlatformRings } from "@/components/graph/nodes/PlatformRingSet";
import { addNodeToRollup, createEmptyRollup, type PlatformStatusRollup } from "@/lib/utils/platform-status";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** The species glyph the canvas and the minimap already use for an acceptance. */
const AcceptanceIcon = SPECIES_GRAPH_ICONS.acceptance;

interface AcceptanceMatrixProps {
  acceptances: Node[];
  edges: Edge[];
  nodesById: ReadonlyMap<string, Node>;
  onSelect: (node: Node) => void;
  projectId: string;
  /** The bundle products live on. `undefined` until `useProject` resolves. */
  project: ProjectBundle | undefined;
  /**
   * The toolbar's expand-all toggle. Groups start collapsed — a project with a
   * few dozen anchors opened to a wall of rows you had to scroll past to see
   * what anchors even exist. This is the *baseline*: a heading clicked
   * afterwards is an exception to it, and flipping the toggle clears those
   * exceptions so the toggle always means what it says.
   */
  allExpanded: boolean;
}

/**
 * The availability strip for one acceptance: one {@link StatusMark} per tracked
 * platform, or a single one for the status itself when availability is not a
 * tracked dimension.
 *
 * This replaced a column per platform plus a header row to name them. The
 * headings were the reason the matrix needed a table at all, and with four
 * platforms beside a title and a values list they were also what pushed it into
 * horizontal scrolling on a narrow panel. A platform's identity is in its glyph,
 * so the heading was spending a whole row to repeat what each cell already said.
 *
 * The arity rule is the caller's: see `statusColumns`.
 */
function AvailabilityStrip({
  acceptance,
  platforms,
}: {
  acceptance: Node;
  platforms: readonly (PlatformId | null)[];
}) {
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      {platforms.map((platform) => (
        <StatusMark
          key={platform ?? "status"}
          platform={platform}
          // Arity 0 has no platform to resolve against, so the acceptance's own
          // lifecycle status *is* the whole answer — `resolvePlatformStatus` has
          // nothing to be asked about.
          status={platform === null ? acceptance.status : resolvePlatformStatus(acceptance, platform)}
        />
      ))}
    </span>
  );
}

export function AcceptanceMatrix({ acceptances, edges, nodesById, onSelect, projectId, project, allExpanded }: AcceptanceMatrixProps) {
  const scope = useEffectiveProduct(projectId, project);
  const { groups } = useMemo(() => groupAcceptancesByAnchor(acceptances, edges, nodesById), [acceptances, edges, nodesById]);
  // Groups whose state differs from `allExpanded` — the headings clicked since
  // the toggle last moved. Reset during render (React's documented pattern for
  // state derived from a prop) rather than in an effect, which would trip
  // react-hooks/set-state-in-effect and repaint an open group shut a frame late.
  const [exceptions, setExceptions] = useState<Set<string>>(new Set());
  const [syncedAll, setSyncedAll] = useState(allExpanded);
  if (allExpanded !== syncedAll) {
    setSyncedAll(allExpanded);
    setExceptions(new Set());
  }
  const toggleGroup = (key: string) =>
    setExceptions((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  /**
   * The arity rule, as a list of marks per row — the same one
   * `PlatformAvailability` renders as rings or a bar, read off the same
   * `isMultiPlatform` so the two surfaces cannot disagree. At ≥ 2 the marks are
   * the scope's platforms. At ≤ 1 there is a single mark and **no platform in
   * it**: scoped to a web-only admin product the reader wants a status with no
   * notion of platform, and dropping the platform is what makes arity 0 and
   * arity 1 render identically rather than approximately so.
   *
   * A project that declares no products resolves to every platform, so this is
   * exactly today's strip — including on the first render, before `useProject`
   * has resolved and while `project` is still `undefined`.
   */
  const statusColumns = useMemo<readonly (PlatformId | null)[]>(
    () => (scope.isMultiPlatform ? scope.platforms : [scope.platforms[0] ?? null]),
    [scope],
  );

  /**
   * Per group: the delivery rollup its platform wheels are drawn from, and
   * whether the whole group is live everywhere in scope.
   *
   * `allLive` is read off the acceptances rather than off the rollup because the
   * rollup counts only *delivery* statuses (`COUNTED_STATUS_PRESETS.delivery`) —
   * an all-idea group contributes nothing to it, and "no counted statuses" would
   * otherwise be indistinguishable from "all live" in a ratio.
   */
  const rollups = useMemo(() => {
    const byGroup = new Map<string, PlatformStatusRollup>();
    const allLive = new Map<string, boolean>();
    for (const group of groups) {
      const key = group.anchorId ?? "__unanchored__";
      byGroup.set(key, group.acceptances.reduce((rollup, acc) => addNodeToRollup(rollup, acc), createEmptyRollup()));
      allLive.set(
        key,
        group.acceptances.every((acc) =>
          statusColumns.every((platform) =>
            (platform === null ? acc.status : resolvePlatformStatus(acc, platform)) === "live",
          ),
        ),
      );
    }
    return { byGroup, allLive };
  }, [groups, statusColumns]);

  if (groups.length === 0) {
    return <p className="p-6 text-sm text-muted-foreground">No acceptances match these filters.</p>;
  }

  return (
    <div className="flex flex-col">
      {groups.map((group) => {
        const key = group.anchorId ?? "__unanchored__";
        const isCollapsed = allExpanded ? exceptions.has(key) : !exceptions.has(key);
        const anchorSpeciesConfig = group.anchorSpecies ? SPECIES.find((s) => s.id === group.anchorSpecies) : undefined;
        // Parity is binary per acceptance — every platform agrees, or one of
        // them doesn't — so its wheel is a two-arc share of the group, not a
        // status breakdown. It is also a question only a multi-platform scope
        // can ask: on one platform there is nothing for a second platform to
        // disagree with, so the parity wheel never appears there.
        const balancedCount = group.acceptances.length - group.gapCount;
        const balancedRatio = group.acceptances.length === 0 ? 1 : balancedCount / group.acceptances.length;
        const showParityWheel = scope.isMultiPlatform && group.gapCount > 0;
        const parityLabel = `${balancedCount} of ${group.acceptances.length} at parity · ${group.gapCount} gap${group.gapCount === 1 ? "" : "s"}`;
        // The one state with nothing left to read: every acceptance live on
        // every platform in scope. The wheels would all be a single full green
        // arc, so the stethoscope stands alone and says it in one glyph — the
        // same answer whether the scope has one platform or four.
        const allLive = rollups.allLive.get(key) ?? false;
        return (
          <section key={key}>
            {/*
              Sticky, and this is a consequence of going flush rather than a
              flourish: the bordered box used to be what told you which anchor
              you were reading under, and without it a group heading scrolled off
              leaves a wall of anonymous rows. `bg-card` is load-bearing for the
              same reason it is on the Library's table header — rows read
              straight through a transparent pinned band.
            */}
            <button
              type="button"
              className="sticky top-0 z-10 flex w-full items-center gap-2 border-b bg-card px-4 py-2.5 text-left hover:bg-muted/50"
              onClick={() => toggleGroup(key)}
              aria-expanded={!isCollapsed}
            >
              {isCollapsed ? <ChevronRightIcon className="size-4 shrink-0" /> : <ChevronDownIcon className="size-4 shrink-0" />}
              {/* The panel header's own species chip, not a bare glyph: it is
                  the one place in the app that explains a species, and the
                  heading needed exactly that once the meta line stopped
                  spelling the species out in words. */}
              {group.anchorSpecies && (
                <SpeciesBadge
                  species={group.anchorSpecies}
                  label={anchorSpeciesConfig?.label ?? group.anchorSpecies}
                  description={anchorSpeciesConfig?.description}
                />
              )}
              <span className="truncate font-medium">{group.anchorNode ? group.anchorNode.title : UNANCHORED_GROUP_LABEL}</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="cursor-help flex shrink-0 items-center gap-0.5 text-xs">
                      {group.acceptances.length}
                      <AcceptanceIcon className="size-3 text-muted-foreground" aria-hidden="true" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    {group.acceptances.length} acceptance{group.acceptances.length === 1 ? "" : "s"} anchored
                  </TooltipContent>
                </Tooltip>
              {/*
                The trailing read on the group, in the delivery surfaces' own
                wheels so a heading and a node card cannot mean different things
                by the same donut. Three shapes, and which one you get is a
                question of what is left to say:

                  · live everywhere in scope → the green stethoscope alone. Every
                    wheel would be one full green arc, and a column of them is
                    wallpaper rather than signal — on one platform or four, the
                    answer is the same and it fits in one glyph.
                  · otherwise → one wheel per platform in scope, each the group's
                    acceptances broken down by delivery status.
                  · and, when the scope has 2+ platforms and some acceptance
                    disagrees across them, the parity wheel leads them: green for
                    the share at parity, amber for the share with a gap.
              */}
              <span className="ms-auto flex shrink-0 items-center gap-2">
                {allLive ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <StethoscopeIcon
                        className="size-4 cursor-help text-green-600"
                        role="img"
                        aria-label="Live on every platform in scope"
                      />
                    </TooltipTrigger>
                    <TooltipContent side="top">Live on every platform in scope</TooltipContent>
                  </Tooltip>
                ) : (
                  <>
                    {showParityWheel && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="flex cursor-help items-center">
                            <Ring
                              size="xs"
                              label={parityLabel}
                              arcs={[
                                { key: "balanced", ratio: balancedRatio, className: "stroke-green-500" },
                                { key: "gap", ratio: 1 - balancedRatio, className: "stroke-amber-500" },
                              ]}
                            >
                              <StethoscopeIcon className="size-3 text-amber-600" aria-hidden="true" />
                            </Ring>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="top">{parityLabel}</TooltipContent>
                      </Tooltip>
                    )}
                    <PlatformRings
                      rollup={rollups.byGroup.get(key) ?? createEmptyRollup()}
                      platforms={[...scope.platforms]}
                      size="xs"
                    />
                  </>
                )}
              </span>
            </button>

            {!isCollapsed && (
              <ul>
                {group.acceptances.map((acc) => (
                  <li key={`${key}-${acc.id}`}>
                    {/*
                      A `button`, not a table row with click handlers: the row was
                      always a link to the acceptance's panel, and a real button
                      is focusable, Enter-activated and announced as such without
                      the `tabIndex`/`onKeyDown` pair the old row hand-rolled.

                      The amber left edge is the parity gap, unchanged — it is the
                      one thing that has to catch the eye down a flush list. It is
                      also never the only signal: the group heading counts the
                      gaps, and each mark names its status.
                    */}
                    <button
                      type="button"
                      onClick={() => onSelect(acc)}
                      className={cn(
                        "flex w-full justify-between items-center gap-3 border-b ps-10 pe-4 py-2.5 text-left hover:bg-muted/50",
                        hasParityGap(acc) && "border-l-2 border-l-amber-500",
                      )}
                    >
                      <span className="flex min-w-0 flex-col items-start gap-0.5">
                        <span className="truncate text-sm">{acc.title}</span>
                        <EntityId id={acc.id} />
                      </span>
                      <span className="gap-4 flex">
                        <span className="hidden shrink-0 flex-wrap justify-end gap-1 sm:flex">
                          {(acc.metadata?.values ?? []).map((v) => <ValueBadge key={v} valueId={v} />)}
                        </span>
                        <AvailabilityStrip acceptance={acc} platforms={statusColumns} />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
