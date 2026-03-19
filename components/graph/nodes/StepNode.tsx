"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { StatusId } from "@/lib/config/statuses";
import type { PlatformId } from "@/lib/config/platforms";
import { PLATFORMS } from "@/lib/config/platforms";
import { STATUS_STYLES, STATUS_LABELS, PLATFORM_DOT_STYLES, PLATFORM_LABELS } from "./node-styles";

const ALL_PLATFORM_IDS = PLATFORMS.map((p) => p.id);

const PLATFORM_BORDER_STYLES: Record<PlatformId, string> = {
  web: "border-green-500",
  ios: "border-blue-500",
  android: "border-purple-500",
};

export function StepNode({ data }: NodeProps) {
  const status = (data.status as StatusId) ?? "idea";
  const label = String(data.label ?? "Step");
  const platforms = (data.platforms as PlatformId[]) ?? [];
  const { badge, dot } = STATUS_STYLES[status] ?? STATUS_STYLES.idea;

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
            <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${badge}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
              {STATUS_LABELS[status]}
            </span>
            {platforms.length > 0 && (
              <div className="flex items-center gap-1">
                {platforms.map((platform) => (
                  <span
                    key={platform}
                    title={PLATFORM_LABELS[platform]}
                    className={`w-2 h-2 rounded-full ${PLATFORM_DOT_STYLES[platform]}`}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="opacity-0" />
    </>
  );
}
