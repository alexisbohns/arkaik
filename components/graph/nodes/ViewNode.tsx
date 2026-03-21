"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { CloudDownload, CloudUpload, Info } from "lucide-react";
import type { StatusId } from "@/lib/config/statuses";
import type { PlatformId } from "@/lib/config/platforms";
import type { PlatformStatusMap } from "@/lib/data/types";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { STATUS_GHOST_STYLES, STATUS_ICONS, STATUS_LABELS, STATUS_STYLES, PLATFORM_ICONS, PLATFORM_LABELS } from "./node-styles";

type ViewCardVariant = "compact" | "large";

interface ViewApiRelation {
  apiId: string;
  title: string;
  status: StatusId;
  edgeType: string;
}

function ApiPopoverButton({
  icon,
  label,
  relations,
}: {
  icon: typeof CloudDownload;
  label: string;
  relations: ViewApiRelation[];
}) {
  const Icon = icon;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-9 min-w-9 items-center justify-center rounded-full border border-border bg-muted/40 px-3 text-muted-foreground transition-colors hover:bg-muted"
          onClick={(event) => event.stopPropagation()}
          aria-label={label}
        >
          <Icon className="size-4" />
          {relations.length > 0 && <span className="ml-1 text-[10px] font-semibold">{relations.length}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72" align="start" onClick={(event) => event.stopPropagation()}>
        <div className="flex flex-col gap-2">
          <h4 className="text-sm font-semibold">{label}</h4>
          {relations.length === 0 ? (
            <p className="text-xs text-muted-foreground">No APIs connected.</p>
          ) : (
            <ul className="space-y-2">
              {relations.map((relation) => {
                const StatusIcon = STATUS_ICONS[relation.status] ?? STATUS_ICONS.idea;
                return (
                  <li key={relation.apiId} className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate" title={relation.title}>{relation.title}</span>
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      <StatusIcon className={`size-3 ${STATUS_STYLES[relation.status].badge}`} />
                      {STATUS_LABELS[relation.status]}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function PlatformStatusIcon({ platform, status }: { platform: PlatformId; status: StatusId }) {
  const PlatformIcon = PLATFORM_ICONS[platform];
  const statusStyles = STATUS_STYLES[status] ?? STATUS_STYLES.idea;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-muted/30 transition-colors hover:bg-muted"
          onClick={(event) => event.stopPropagation()}
          aria-label={`${PLATFORM_LABELS[platform]} status`}
        >
          <PlatformIcon className={`size-4 ${statusStyles.badge}`} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-60" align="end" onClick={(event) => event.stopPropagation()}>
        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-semibold">{PLATFORM_LABELS[platform]}</p>
          <p className="text-xs text-muted-foreground">Status: {STATUS_LABELS[status]}</p>
          <p className="text-xs text-muted-foreground">Screenshot support coming soon.</p>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function InlineStatusIcon({ status }: { status: StatusId }) {
  const StatusIcon = STATUS_ICONS[status] ?? STATUS_ICONS.idea;
  const statusStyles = STATUS_STYLES[status] ?? STATUS_STYLES.idea;

  return <StatusIcon className={`size-5 ${statusStyles.badge}`} aria-label={STATUS_LABELS[status]} />;
}

export function ViewNode({ data }: NodeProps) {
  const status = (data.status as StatusId) ?? "idea";
  const label = String(data.label ?? "View");
  const platforms = (data.platforms as PlatformId[]) ?? [];
  const platformStatuses = (data.platformStatuses as PlatformStatusMap | undefined) ?? {};
  const viewCardVariant = (data.viewCardVariant as ViewCardVariant | undefined) ?? "compact";
  const apiInbound = (data.apiInbound as ViewApiRelation[] | undefined) ?? [];
  const apiOutbound = (data.apiOutbound as ViewApiRelation[] | undefined) ?? [];
  const coverUrl = typeof data.coverUrl === "string" ? data.coverUrl : undefined;
  const onOpenDetails = data.onOpenDetails as (() => void) | undefined;
  const ghostClass = STATUS_GHOST_STYLES[status];
  const showLargeVariant = viewCardVariant === "large";
  const hasInboundApi = apiInbound.length > 0;
  const hasOutboundApi = apiOutbound.length > 0;
  const hasAnyApi = hasInboundApi || hasOutboundApi;

  return (
    <>
      <Handle type="target" position={Position.Top} id="top" className="opacity-0" />
      <Handle type="target" position={Position.Left} id="left" className="opacity-0" />
      <div className={`relative ${ghostClass.wrapper}`}>
        <div
          role="img"
          aria-label={label}
          className={`relative flex flex-col gap-3 ${showLargeVariant ? "w-[260px]" : "w-56"} px-4 py-3 rounded-xl bg-background border-2 border-border shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${ghostClass.border}`}
        >
          <div className="flex items-start justify-between gap-2">
            <span title={label} className="text-sm font-medium leading-tight line-clamp-2">
              {label}
            </span>
            {onOpenDetails && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 text-muted-foreground"
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenDetails();
                }}
                aria-label={`Open details for ${label}`}
              >
                <Info className="size-4" />
              </Button>
            )}
          </div>

          {showLargeVariant && coverUrl && (
            <div
              role="img"
              aria-label={`${label} cover`}
              className="h-28 overflow-hidden rounded-md border border-border bg-muted bg-cover bg-center"
              style={{ backgroundImage: `url(${coverUrl})` }}
            />
          )}

          {showLargeVariant && platforms.length > 0 && (
            <div className="space-y-2">
              {platforms.map((platform) => {
                const PlatformIcon = PLATFORM_ICONS[platform];
                const platformStatus = platformStatuses[platform] ?? status;

                return (
                  <div key={platform} className="flex items-center justify-between gap-2 text-xs">
                    <span className="inline-flex items-center gap-2">
                      <PlatformIcon className="size-4 text-muted-foreground" />
                      {PLATFORM_LABELS[platform]}
                    </span>
                    <InlineStatusIcon status={platformStatus} />
                  </div>
                );
              })}
            </div>
          )}

          {!showLargeVariant && <div className="h-2" />}

          <div className="mt-auto flex items-center justify-between gap-3">
            {hasAnyApi ? (
              <div className="flex items-center gap-2">
                {hasInboundApi && <ApiPopoverButton icon={CloudDownload} label="Inbound APIs" relations={apiInbound} />}
                {hasOutboundApi && <ApiPopoverButton icon={CloudUpload} label="Outbound APIs" relations={apiOutbound} />}
              </div>
            ) : <div />}
            {!showLargeVariant && platforms.length > 0 && (
              <div className="flex items-center gap-2">
                {platforms.map((platform) => {
                  const platformStatus = platformStatuses[platform] ?? status;
                  return <PlatformStatusIcon key={platform} platform={platform} status={platformStatus} />;
                })}
              </div>
            )}
          </div>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} id="bottom" className="opacity-0" />
      <Handle type="source" position={Position.Right} id="right" className="opacity-0" />
    </>
  );
}
