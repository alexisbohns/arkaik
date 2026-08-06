"use client";

import { useMemo, useState } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import type { Node, Edge, ProjectBundle } from "@/lib/data/types";
import { resolvePlatformStatus, hasParityGap } from "@arkaik/schema";
import { groupAcceptancesByAnchor, UNANCHORED_GROUP_LABEL } from "@/lib/utils/acceptance-matrix";
import { PLATFORMS, type PlatformId } from "@/lib/config/platforms";
import { useEffectiveProduct } from "@/lib/hooks/useProductScope";
import { STATUS_ICONS, STATUS_STYLES, STATUS_LABELS } from "@/components/graph/nodes/node-styles";
import { SPECIES_GRAPH_ICONS } from "@/lib/config/species-icons";
import { ValueBadge } from "@/components/values/ValueBadge";
import { EntityId } from "@/components/graph/nodes/EntityBadges";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface AcceptanceMatrixProps {
  acceptances: Node[];
  edges: Edge[];
  nodesById: ReadonlyMap<string, Node>;
  onSelect: (node: Node) => void;
  projectId: string;
  /** The bundle products live on. `undefined` until `useProject` resolves. */
  project: ProjectBundle | undefined;
}

const PLATFORM_LABELS = new Map<PlatformId, string>(PLATFORMS.map((platform) => [platform.id, platform.label]));

/** One status column: a platform to resolve against, plus the heading it earns. */
interface StatusColumn {
  key: string;
  label: string;
  /** `null` only at arity 0, where there is no platform to resolve against. */
  platform: PlatformId | null;
}

/**
 * A cell's status: the column's platform when there is one, the acceptance's own
 * lifecycle status when there is not. Arity 0 is a product that does not track
 * availability at all (a CLI, a public API), so `status` *is* the whole answer —
 * `resolvePlatformStatus` has nothing to be asked about.
 */
function StatusCell({ acceptance, platform }: { acceptance: Node; platform: PlatformId | null }) {
  const status = platform === null ? acceptance.status : resolvePlatformStatus(acceptance, platform);
  if (!status) return <span className="text-muted-foreground/40" aria-label="Not applicable">—</span>;
  const Icon = STATUS_ICONS[status];
  const label = platform === null ? STATUS_LABELS[status] : `${platform}: ${STATUS_LABELS[status]}`;
  return <Icon className={`size-4 ${STATUS_STYLES[status].badge}`} aria-label={label} />;
}

export function AcceptanceMatrix({ acceptances, edges, nodesById, onSelect, projectId, project }: AcceptanceMatrixProps) {
  const scope = useEffectiveProduct(projectId, project);
  const { groups } = useMemo(() => groupAcceptancesByAnchor(acceptances, edges, nodesById), [acceptances, edges, nodesById]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  /**
   * The arity rule, in table form — the same one `PlatformAvailability` renders
   * as rings or a bar, read off the same `isMultiPlatform` so the two surfaces
   * cannot disagree. At ≥ 2 the columns are the scope's platforms. At ≤ 1 there
   * is one column headed `Status` and **no platform name in it**: scoped to a
   * web-only admin product the reader wants a status with no notion of platform,
   * and dropping the name is what makes arity 0 and arity 1 render identically
   * rather than approximately so.
   *
   * A project that declares no products resolves to every platform, so this is
   * exactly today's header — including on the first render, before `useProject`
   * has resolved and while `project` is still `undefined`.
   */
  const statusColumns = useMemo<StatusColumn[]>(() => {
    if (scope.isMultiPlatform) {
      return scope.platforms.map((platform) => ({
        key: platform,
        label: PLATFORM_LABELS.get(platform) ?? platform,
        platform,
      }));
    }
    return [{ key: "status", label: "Status", platform: scope.platforms[0] ?? null }];
  }, [scope]);

  if (groups.length === 0) {
    return <p className="text-sm text-muted-foreground">No acceptances match these filters.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => {
        const key = group.anchorId ?? "__unanchored__";
        const isCollapsed = collapsed.has(key);
        const AnchorIcon = group.anchorSpecies ? SPECIES_GRAPH_ICONS[group.anchorSpecies] : null;
        return (
          <section key={key} className="rounded-xl border bg-card overflow-hidden">
            <button
              type="button"
              className="flex w-full items-center gap-2 border-b px-3 py-2 text-left"
              onClick={() => setCollapsed((prev) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; })}
              aria-expanded={!isCollapsed}
            >
              {isCollapsed ? <ChevronRightIcon className="size-4" /> : <ChevronDownIcon className="size-4" />}
              {AnchorIcon && <AnchorIcon className="size-4 text-muted-foreground" />}
              <span className="font-medium">{group.anchorNode ? group.anchorNode.title : UNANCHORED_GROUP_LABEL}</span>
              <span className="text-xs text-muted-foreground">
                {/* "Unanchored · no anchor" said it twice; the heading already says it. */}
                {group.anchorSpecies ? `· ${group.anchorSpecies} ` : ""}· {group.acceptances.length} acceptance{group.acceptances.length === 1 ? "" : "s"}
                {group.gapCount > 0 && <span className="text-amber-600"> · {group.gapCount} gap{group.gapCount === 1 ? "" : "s"}</span>}
              </span>
            </button>

            {/* `Table`, not a bare `<table>`: its container scrolls horizontally,
                and a product with four platforms is four status columns beside
                the title and the values — enough to run off a narrow viewport,
                where the hand-rolled version simply overflowed the page. Row
                hover and the rules between rows come from `TableRow` too; the
                overrides below are only what this matrix genuinely differs on —
                a compact header, and the amber left edge on a parity gap. */}
            {!isCollapsed && (
              <Table>
                <TableHeader>
                  {/* Inert: `TableRow` hovers, and a header row that lights up
                      under the pointer would read as clickable, which it isn't. */}
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="h-auto px-3 py-1.5 text-xs font-normal text-muted-foreground">Acceptance</TableHead>
                    <TableHead className="h-auto px-3 py-1.5 text-xs font-normal text-muted-foreground">Values</TableHead>
                    {statusColumns.map((column) => (
                      <TableHead key={column.key} className="h-auto px-2 py-1.5 text-center text-xs font-normal text-muted-foreground">
                        {column.label}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {group.acceptances.map((acc) => (
                    <TableRow
                      key={`${key}-${acc.id}`}
                      tabIndex={0}
                      onClick={() => onSelect(acc)}
                      onKeyDown={(e) => { if (e.key === "Enter") onSelect(acc); }}
                      className={`cursor-pointer ${hasParityGap(acc) ? "border-l-2 border-l-amber-500" : ""}`}
                    >
                      {/* The one cell that may wrap — a title is a sentence, and
                          `TableCell` is `whitespace-nowrap` by default. */}
                      <TableCell className="px-3 py-2 whitespace-normal">
                        <div className="flex flex-col gap-0.5">
                          <span>{acc.title}</span>
                          <EntityId id={acc.id} />
                        </div>
                      </TableCell>
                      <TableCell className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {(acc.metadata?.values ?? []).map((v) => <ValueBadge key={v} valueId={v} />)}
                        </div>
                      </TableCell>
                      {statusColumns.map((column) => (
                        <TableCell key={column.key} className="px-2 py-2 text-center">
                          <span className="inline-flex justify-center"><StatusCell acceptance={acc} platform={column.platform} /></span>
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </section>
        );
      })}
    </div>
  );
}
