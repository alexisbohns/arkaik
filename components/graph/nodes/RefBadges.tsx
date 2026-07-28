"use client";

import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { StatusBadge } from "@/components/layout/StatusBadge";
import {
  PLATFORM_ICONS,
  REF_TYPE_ICONS,
  REF_TYPE_ICON_FALLBACK,
  REF_TYPE_LABELS,
  REF_TYPE_LABEL_FALLBACK,
} from "@/components/graph/nodes/node-styles";
import { PLATFORMS } from "@/lib/config/platforms";
import type { Ref } from "@/lib/data/types";

function formatSyncedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;

  const diffDays = Math.round((Date.now() - date.getTime()) / 86_400_000);
  if (diffDays <= 0) return "synced today";
  if (diffDays === 1) return "synced 1 day ago";
  if (diffDays < 30) return `synced ${diffDays} days ago`;
  return `synced ${date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}`;
}

interface RefBadgeProps {
  refItem: Ref;
}

export function RefBadge({ refItem }: RefBadgeProps) {
  const Icon = REF_TYPE_ICONS[refItem.type] ?? REF_TYPE_ICON_FALLBACK;
  const label = REF_TYPE_LABELS[refItem.type] ?? REF_TYPE_LABEL_FALLBACK;
  const title = refItem.title || refItem.url;
  const hasDetail = Boolean(refItem.external_status || refItem.synced_at);

  // A PR that names several platforms (`AC-x@ios and AC-x@android`) mirrors as
  // one ref PER platform, all sharing the PR's url and title — so without the
  // scope shown here those rows are byte-identical and the list looks duplicated
  // rather than per-platform. Refs are keyed by the invisible `id`, which tells
  // the reader nothing.
  const platform = refItem.platform
    ? PLATFORMS.find((p) => p.id === refItem.platform)
    : undefined;
  const PlatformIcon = platform ? PLATFORM_ICONS[platform.id] : null;

  const link = (
    <a
      href={refItem.url}
      target="_blank"
      rel="nofollow noreferrer"
      className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted transition-colors"
    >
      <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="truncate">{title}</span>
      {platform && PlatformIcon && (
        <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
          <PlatformIcon className="size-3" aria-hidden="true" />
          {platform.label}
        </span>
      )}
    </a>
  );

  return (
    <div className="flex items-center gap-1">
      {hasDetail ? (
        <HoverCard openDelay={250}>
          <HoverCardTrigger asChild>{link}</HoverCardTrigger>
          <HoverCardContent className="w-64 p-3" align="start">
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">{label}</p>
              {platform && <p className="text-xs text-muted-foreground">Platform: {platform.label}</p>}
              {refItem.external_status && (
                <p className="text-xs text-muted-foreground">Status: {refItem.external_status}</p>
              )}
              {refItem.synced_at && (
                <p className="text-xs text-muted-foreground">{formatSyncedAt(refItem.synced_at)}</p>
              )}
            </div>
          </HoverCardContent>
        </HoverCard>
      ) : (
        link
      )}
      {refItem.status_mapped && <StatusBadge status={refItem.status_mapped} className="shrink-0" />}
    </div>
  );
}

interface RefListProps {
  refs?: Ref[];
}

export function RefList({ refs }: RefListProps) {
  if (!refs || refs.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-0.5">
      {refs.map((refItem) => (
        <RefBadge key={refItem.id} refItem={refItem} />
      ))}
    </div>
  );
}
