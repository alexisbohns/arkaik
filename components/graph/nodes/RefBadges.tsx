"use client";

import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { StatusBadge } from "@/components/layout/StatusBadge";
import {
  REF_TYPE_ICONS,
  REF_TYPE_ICON_FALLBACK,
  REF_TYPE_LABELS,
  REF_TYPE_LABEL_FALLBACK,
} from "@/components/graph/nodes/node-styles";
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

  const link = (
    <a
      href={refItem.url}
      target="_blank"
      rel="nofollow noreferrer"
      className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted transition-colors"
    >
      <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="truncate">{title}</span>
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
