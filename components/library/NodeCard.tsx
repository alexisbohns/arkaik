"use client";

import { GitBranchIcon, SplitIcon } from "lucide-react";
import type { Node } from "@/lib/data/types";
import type { PlatformStatusMap } from "@/lib/data/types";
import type { PlatformStatusRollup } from "@/lib/utils/platform-status";
import type { SpeciesId } from "@/lib/config/species";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PlatformGaugeList } from "@/components/graph/nodes/PlatformGaugeList";
import { PlatformList } from "@/components/graph/nodes/PlatformList";
import {
  PLATFORM_ICONS,
  PLATFORM_LABELS,
  SPECIES_ICONS,
} from "@/components/graph/nodes/node-styles";
import { SpeciesBadge, EntityId } from "@/components/graph/nodes/EntityBadges";

export interface PlaylistPreviewItem {
  type: "view" | "flow" | "condition" | "junction";
  label: string;
}

interface NodeCardProps {
  node: Node;
  speciesLabel: string;
  speciesDescription?: string;
  viewPlatformStatuses?: PlatformStatusMap;
  flowRollup?: PlatformStatusRollup;
  playlistPreview: PlaylistPreviewItem[];
  usedInCount: number;
  onClick: () => void;
}

function PlaylistItemIcon({ type }: { type: PlaylistPreviewItem["type"] }) {
  if (type === "condition") {
    return <GitBranchIcon className="size-3.5 text-muted-foreground" />;
  }

  if (type === "junction") {
    return <SplitIcon className="size-3.5 text-muted-foreground" />;
  }

  const SpeciesIcon = SPECIES_ICONS[type as SpeciesId];
  return <SpeciesIcon className="size-3.5 text-muted-foreground" />;
}

export function NodeCard({
  node,
  speciesLabel,
  speciesDescription,
  viewPlatformStatuses,
  flowRollup,
  playlistPreview,
  usedInCount,
  onClick,
}: NodeCardProps) {
  const previewItems = playlistPreview.slice(0, 5);

  return (
    <button type="button" className="w-full text-left" onClick={onClick}>
      <Card className="h-full gap-3 py-4 transition-colors hover:bg-muted/40">
        <CardHeader className="gap-2 px-4">
          <CardTitle className="line-clamp-2 text-base leading-tight">{node.title}</CardTitle>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <SpeciesBadge
              species={node.species}
              label={speciesLabel}
              description={speciesDescription}
              onClick={(e) => { e.stopPropagation(); }}
            />
            <EntityId id={node.id} />
          </div>
        </CardHeader>

        <CardContent className="space-y-2 px-4 pb-1 text-xs">
          {node.species === "view" && (
            <div className="space-y-1.5">
              <span className="text-muted-foreground">Platforms</span>
              <PlatformList platforms={node.platforms} platformStatuses={viewPlatformStatuses} />
            </div>
          )}

          {node.species === "flow" && flowRollup && (
            <div className="space-y-1.5">
              <span className="text-muted-foreground">Platforms</span>
              <PlatformGaugeList rollup={flowRollup} platforms={node.platforms} showLabels />
            </div>
          )}

          {node.species !== "view" && node.species !== "flow" && (
            <div className="space-y-1.5">
              <span className="text-muted-foreground">Platforms</span>
              {node.platforms.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2">
                  {node.platforms.map((platformId) => {
                    const PlatformIcon = PLATFORM_ICONS[platformId];
                    return (
                      <span key={platformId} className="inline-flex items-center gap-1.5 text-muted-foreground">
                        <PlatformIcon className="size-3.5" />
                        {PLATFORM_LABELS[platformId]}
                      </span>
                    );
                  })}
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground">No platforms selected.</p>
              )}
            </div>
          )}

          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Used in</span>
            <span>{usedInCount > 0 ? `${usedInCount} flow${usedInCount === 1 ? "" : "s"}` : "-"}</span>
          </div>

          {node.species === "flow" && (
            <div className="space-y-1">
              <span className="text-muted-foreground">Playlist</span>
              {previewItems.length > 0 ? (
                <ul className="space-y-1 text-[11px]">
                  {previewItems.map((item, index) => (
                    <li key={`${node.id}-preview-${index}`} className="inline-flex w-full items-center gap-1.5 truncate text-muted-foreground">
                      <PlaylistItemIcon type={item.type} />
                      <span className="truncate">{item.label}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[11px] text-muted-foreground">No entries yet.</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </button>
  );
}
