"use client";

import { useState } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import type { Node, Edge } from "@/lib/data/types";
import { resolvePlatformStatus, hasParityGap } from "@arkaik/schema";
import { groupAcceptancesByAnchor } from "@/lib/utils/acceptance-matrix";
import { PLATFORMS } from "@/lib/config/platforms";
import { STATUS_ICONS, STATUS_STYLES, STATUS_LABELS, SPECIES_ICONS } from "@/components/graph/nodes/node-styles";
import { ValueBadge } from "@/components/values/ValueBadge";
import { EntityId } from "@/components/graph/nodes/EntityBadges";

interface AcceptanceMatrixProps {
  acceptances: Node[];
  edges: Edge[];
  nodesById: ReadonlyMap<string, Node>;
  onSelect: (node: Node) => void;
}

function PlatformCell({ acceptance, platformId }: { acceptance: Node; platformId: (typeof PLATFORMS)[number]["id"] }) {
  const status = resolvePlatformStatus(acceptance, platformId);
  if (!status) return <span className="text-muted-foreground/40" aria-label="Not applicable">—</span>;
  const Icon = STATUS_ICONS[status];
  return <Icon className={`size-4 ${STATUS_STYLES[status].badge}`} aria-label={`${platformId}: ${STATUS_LABELS[status]}`} />;
}

export function AcceptanceMatrix({ acceptances, edges, nodesById, onSelect }: AcceptanceMatrixProps) {
  const { groups } = groupAcceptancesByAnchor(acceptances, edges, nodesById);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  if (groups.length === 0) {
    return <p className="text-sm text-muted-foreground">No acceptances match these filters.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => {
        const key = group.anchorId ?? "__product__";
        const isCollapsed = collapsed.has(key);
        const AnchorIcon = group.anchorSpecies ? SPECIES_ICONS[group.anchorSpecies] : null;
        return (
          <section key={key} className="rounded-xl border">
            <button
              type="button"
              className="flex w-full items-center gap-2 border-b px-3 py-2 text-left"
              onClick={() => setCollapsed((prev) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; })}
              aria-expanded={!isCollapsed}
            >
              {isCollapsed ? <ChevronRightIcon className="size-4" /> : <ChevronDownIcon className="size-4" />}
              {AnchorIcon && <AnchorIcon className="size-4 text-muted-foreground" />}
              <span className="font-medium">{group.anchorNode ? group.anchorNode.title : "Product-level"}</span>
              <span className="text-xs text-muted-foreground">
                · {group.anchorSpecies ?? "no anchor"} · {group.acceptances.length} acceptance{group.acceptances.length === 1 ? "" : "s"}
                {group.gapCount > 0 && <span className="text-amber-600"> · {group.gapCount} gap{group.gapCount === 1 ? "" : "s"}</span>}
              </span>
            </button>

            {!isCollapsed && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground">
                    <th className="px-3 py-1.5 text-left font-normal">Acceptance</th>
                    <th className="px-3 py-1.5 text-left font-normal">Values</th>
                    {PLATFORMS.map((p) => <th key={p.id} className="px-2 py-1.5 text-center font-normal">{p.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {group.acceptances.map((acc) => (
                    <tr
                      key={`${key}-${acc.id}`}
                      tabIndex={0}
                      onClick={() => onSelect(acc)}
                      onKeyDown={(e) => { if (e.key === "Enter") onSelect(acc); }}
                      className={`cursor-pointer border-t hover:bg-muted/40 ${hasParityGap(acc) ? "border-l-2 border-l-amber-500" : ""}`}
                    >
                      <td className="px-3 py-2">
                        <div className="flex flex-col gap-0.5">
                          <span>{acc.title}</span>
                          <EntityId id={acc.id} />
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {(acc.metadata?.values ?? []).map((v) => <ValueBadge key={v} valueId={v} />)}
                        </div>
                      </td>
                      {PLATFORMS.map((p) => (
                        <td key={p.id} className="px-2 py-2 text-center">
                          <span className="inline-flex justify-center"><PlatformCell acceptance={acc} platformId={p.id} /></span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        );
      })}
    </div>
  );
}
