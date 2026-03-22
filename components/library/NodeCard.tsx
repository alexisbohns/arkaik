"use client";

import type { Node } from "@/lib/data/types";
import type { SpeciesId } from "@/lib/config/species";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/layout/StatusBadge";
import { PlatformDots } from "@/components/layout/PlatformDots";

interface NodeCardProps {
  node: Node;
  speciesLabel: string;
  playlistPreview: string[];
  usedInCount: number;
  onClick: () => void;
}

const SPECIES_BADGE_STYLES: Record<SpeciesId, string> = {
  flow: "bg-blue-500/10 text-blue-700",
  view: "bg-emerald-500/10 text-emerald-700",
  "data-model": "bg-amber-500/10 text-amber-700",
  "api-endpoint": "bg-cyan-500/10 text-cyan-700",
};

export function NodeCard({ node, speciesLabel, playlistPreview, usedInCount, onClick }: NodeCardProps) {
  const previewItems = playlistPreview.slice(0, 5);

  return (
    <button type="button" className="w-full text-left" onClick={onClick}>
      <Card className="h-full gap-3 py-4 transition-colors hover:bg-muted/40">
        <CardHeader className="gap-2 px-4">
          <div className="flex items-start justify-between gap-3">
            <CardTitle className="line-clamp-2 text-base leading-tight">{node.title}</CardTitle>
            <StatusBadge status={node.status} />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded bg-muted px-2 py-1 font-mono text-[11px]">{node.id}</span>
            <span className={`rounded px-2 py-1 font-medium ${SPECIES_BADGE_STYLES[node.species]}`}>
              {speciesLabel}
            </span>
          </div>
        </CardHeader>

        <CardContent className="space-y-2 px-4 pb-1 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Platforms</span>
            <PlatformDots platforms={node.platforms} />
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Used in</span>
            <span>{usedInCount > 0 ? `${usedInCount} flow${usedInCount === 1 ? "" : "s"}` : "-"}</span>
          </div>

          {node.species === "flow" && (
            <div className="space-y-1">
              <span className="text-muted-foreground">Playlist</span>
              {previewItems.length > 0 ? (
                <ul className="space-y-0.5 text-[11px]">
                  {previewItems.map((item, index) => (
                    <li key={`${node.id}-preview-${index}`} className="truncate">
                      {item}
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
