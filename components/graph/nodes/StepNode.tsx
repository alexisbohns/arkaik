"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { StatusId } from "@/lib/config/statuses";
import type { PlatformId } from "@/lib/config/platforms";
import { PLATFORMS } from "@/lib/config/platforms";
import { PLATFORM_BORDER_STYLES } from "./node-styles";
import { StatusBadge } from "@/components/layout/StatusBadge";
import { PlatformDots } from "@/components/layout/PlatformDots";

const ALL_PLATFORM_IDS = PLATFORMS.map((p) => p.id);

export function StepNode({ data }: NodeProps) {
  const status = (data.status as StatusId) ?? "idea";
  const label = String(data.label ?? "Step");
  const platforms = (data.platforms as PlatformId[]) ?? [];

  const isAllPlatforms = ALL_PLATFORM_IDS.every((p) => platforms.includes(p));
  const singlePlatform = !isAllPlatforms && platforms.length === 1 ? platforms[0] : null;
  const borderClass = singlePlatform ? PLATFORM_BORDER_STYLES[singlePlatform] : "border-border";

  return (
    <>
      <Handle type="target" position={Position.Top} className="opacity-0" />
      <div className="relative">
        {isAllPlatforms && (
          <>
            <div className="absolute inset-0 rounded-lg border-2 border-border bg-background opacity-60 translate-x-2 translate-y-2" />
            <div className="absolute inset-0 rounded-lg border-2 border-border bg-background opacity-80 translate-x-1 translate-y-1" />
          </>
        )}
        <div
          role="img"
          aria-label={label}
          className={`relative flex flex-col gap-2 w-44 px-3 py-2.5 rounded-lg bg-background border-2 ${borderClass} shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
        >
          <span title={label} className="text-sm font-medium leading-tight line-clamp-2">
            {label}
          </span>
          <div className="flex items-center justify-between gap-2">
            <StatusBadge status={status} />
            <PlatformDots platforms={platforms} />
          </div>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="opacity-0" />
    </>
  );
}
