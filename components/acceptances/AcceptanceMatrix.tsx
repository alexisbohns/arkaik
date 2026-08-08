"use client";

import { useMemo, useState } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import type { Node, Edge, ProjectBundle } from "@/lib/data/types";
import { resolvePlatformStatus, hasParityGap } from "@arkaik/schema";
import { groupAcceptancesByAnchor, UNANCHORED_GROUP_LABEL } from "@/lib/utils/acceptance-matrix";
import { type PlatformId } from "@/lib/config/platforms";
import { useEffectiveProduct } from "@/lib/hooks/useProductScope";
import { SPECIES_GRAPH_ICONS } from "@/lib/config/species-icons";
import { ValueBadge } from "@/components/values/ValueBadge";
import { EntityId } from "@/components/graph/nodes/EntityBadges";
import { StatusMark } from "@/components/graph/nodes/StatusMark";
import { cn } from "@/lib/utils";

interface AcceptanceMatrixProps {
  acceptances: Node[];
  edges: Edge[];
  nodesById: ReadonlyMap<string, Node>;
  onSelect: (node: Node) => void;
  projectId: string;
  /** The bundle products live on. `undefined` until `useProject` resolves. */
  project: ProjectBundle | undefined;
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

export function AcceptanceMatrix({ acceptances, edges, nodesById, onSelect, projectId, project }: AcceptanceMatrixProps) {
  const scope = useEffectiveProduct(projectId, project);
  const { groups } = useMemo(() => groupAcceptancesByAnchor(acceptances, edges, nodesById), [acceptances, edges, nodesById]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

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

  if (groups.length === 0) {
    return <p className="p-6 text-sm text-muted-foreground">No acceptances match these filters.</p>;
  }

  return (
    <div className="flex flex-col">
      {groups.map((group) => {
        const key = group.anchorId ?? "__unanchored__";
        const isCollapsed = collapsed.has(key);
        const AnchorIcon = group.anchorSpecies ? SPECIES_GRAPH_ICONS[group.anchorSpecies] : null;
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
              onClick={() => setCollapsed((prev) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; })}
              aria-expanded={!isCollapsed}
            >
              {isCollapsed ? <ChevronRightIcon className="size-4 shrink-0" /> : <ChevronDownIcon className="size-4 shrink-0" />}
              {AnchorIcon && <AnchorIcon className="size-4 shrink-0 text-muted-foreground" />}
              <span className="truncate font-medium">{group.anchorNode ? group.anchorNode.title : UNANCHORED_GROUP_LABEL}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {/* "Unanchored · no anchor" said it twice; the heading already says it. */}
                {group.anchorSpecies ? `· ${group.anchorSpecies} ` : ""}· {group.acceptances.length} acceptance{group.acceptances.length === 1 ? "" : "s"}
                {group.gapCount > 0 && <span className="text-amber-600"> · {group.gapCount} gap{group.gapCount === 1 ? "" : "s"}</span>}
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
