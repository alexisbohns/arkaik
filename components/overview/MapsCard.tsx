"use client";

import Link from "next/link";
import { MapPinnedIcon, NetworkIcon, RouteIcon, type LucideIcon } from "lucide-react";
import type { MapDefinition } from "@arkaik/schema";
import { OverviewSection } from "./OverviewSection";

export interface MapsCardEntry {
  definition: MapDefinition;
  nodeCount: number;
  edgeCount: number;
}

// The sidebar's map icon vocabulary (ProjectSidebar Maps group).
function mapIcon(definition: MapDefinition): LucideIcon {
  if (definition.id === "journey") return RouteIcon;
  if (definition.id === "system") return NetworkIcon;
  return MapPinnedIcon;
}

interface MapsCardProps {
  maps: MapsCardEntry[];
  projectId: string;
}

/** Every reading the project offers, with live subgraph sizes. */
export function MapsCard({ maps, projectId }: MapsCardProps) {
  return (
    <OverviewSection
      title="Maps"
      href={`/project/${projectId}/maps`}
      linkLabel="All maps"
      className="md:col-span-2"
    >
      {maps.length === 0 ? (
        <p className="text-sm text-muted-foreground">No maps yet.</p>
      ) : (
        <div className="grid gap-0.5 sm:grid-cols-2">
          {maps.map(({ definition, nodeCount, edgeCount }) => {
            const Icon = mapIcon(definition);

            return (
              <Link
                key={definition.id}
                href={`/project/${projectId}/maps/${definition.id}`}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted"
              >
                <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{definition.title}</span>
                <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                  {definition.kind}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {nodeCount} nodes · {edgeCount} edges
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </OverviewSection>
  );
}
