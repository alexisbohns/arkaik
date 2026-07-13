"use client";

import Link from "next/link";
import { NetworkIcon, PencilIcon, RouteIcon, Trash2Icon, MapIcon } from "lucide-react";
import type { MapDefinition } from "@arkaik/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const KIND_ICONS: Record<string, typeof MapIcon> = {
  journey: RouteIcon,
  system: NetworkIcon,
};

interface MapCardProps {
  definition: MapDefinition;
  href: string;
  nodeCount: number;
  edgeCount: number;
  /** Built-ins are neither editable nor deletable. */
  builtIn: boolean;
  renderable: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
}

export function MapCard({ definition, href, nodeCount, edgeCount, builtIn, renderable, onEdit, onDelete }: MapCardProps) {
  const KindIcon = KIND_ICONS[definition.kind] ?? MapIcon;

  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="flex min-w-0 items-center gap-2">
            <KindIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="truncate">{definition.title}</span>
          </CardTitle>
          <div className="flex shrink-0 items-center gap-1">
            <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
              {renderable ? definition.kind : `${definition.kind} (unrenderable)`}
            </span>
          </div>
        </div>
        {definition.description && <CardDescription>{definition.description}</CardDescription>}
      </CardHeader>
      <CardContent className="mt-auto flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          {nodeCount} node{nodeCount !== 1 ? "s" : ""} · {edgeCount} edge{edgeCount !== 1 ? "s" : ""}
          {definition.root_node_id && (
            <span className="ml-2 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">⌂ {definition.root_node_id}</span>
          )}
        </p>
        <div className="flex items-center gap-2">
          {renderable ? (
            <Button asChild size="sm" className="cursor-pointer">
              <Link href={href}>Open</Link>
            </Button>
          ) : (
            <Button size="sm" disabled title="Unknown map kind — preserved but not renderable">
              Open
            </Button>
          )}
          {!builtIn && onEdit && (
            <Button size="sm" variant="outline" className="cursor-pointer" onClick={onEdit} aria-label={`Edit ${definition.title}`}>
              <PencilIcon className="size-3.5" />
            </Button>
          )}
          {!builtIn && onDelete && (
            <Button size="sm" variant="outline" className="cursor-pointer" onClick={onDelete} aria-label={`Delete ${definition.title}`}>
              <Trash2Icon className="size-3.5" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
