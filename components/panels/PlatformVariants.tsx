"use client";

import type { PlatformId } from "@/lib/config/platforms";
import { PLATFORMS } from "@/lib/config/platforms";
import {
  PLATFORM_ICONS,
  PLATFORM_LABELS,
  STATUS_ICONS,
  STATUS_STYLES,
} from "@/components/graph/nodes/node-styles";
import type { PlatformStatusMap } from "@/lib/data/types";
import type { StatusId } from "@/lib/config/statuses";
import { STATUSES } from "@/lib/config/statuses";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";

export interface PlatformVariantsProps {
  platforms?: PlatformId[];
  statuses?: PlatformStatusMap;
  notes?: Partial<Record<PlatformId, string>>;
  onStatusChange?: (platform: PlatformId, value: StatusId | undefined) => void;
  onNotesChange?: (platform: PlatformId, value: string) => void;
}

export function PlatformVariants({
  platforms = [],
  statuses = {},
  notes = {},
  onStatusChange,
  onNotesChange,
}: PlatformVariantsProps) {
  const activePlatforms = PLATFORMS.filter((platform) => platforms.includes(platform.id));

  if (activePlatforms.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
        Select at least one platform to configure platform-specific statuses.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {activePlatforms.map((platform) => {
        const PlatformIcon = PLATFORM_ICONS[platform.id];
        const currentStatus = statuses[platform.id];
        const currentNotes = notes[platform.id] ?? "";

        return (
          <div key={platform.id} className="flex flex-col gap-3 rounded-md border border-border p-3">
            <div className="flex items-center gap-2">
              <PlatformIcon className="size-4 text-muted-foreground" />
              <span className="text-sm font-medium text-foreground">{PLATFORM_LABELS[platform.id]}</span>
            </div>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Status
                </label>
                <Select
                  value={currentStatus ?? ""}
                  onValueChange={(value) => {
                    if (value === "unset") {
                      onStatusChange?.(platform.id, undefined);
                    } else {
                      onStatusChange?.(platform.id, value as StatusId);
                    }
                  }}
                >
                  <SelectTrigger aria-label={`Status for ${PLATFORM_LABELS[platform.id]}`}>
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unset">
                      <span className="text-xs text-muted-foreground">Unset</span>
                    </SelectItem>
                    {STATUSES.map((status) => {
                      const StatusIcon = STATUS_ICONS[status.id];

                      return (
                        <SelectItem key={status.id} value={status.id}>
                          <span className="inline-flex items-center gap-2">
                            <StatusIcon className={`size-3.5 ${STATUS_STYLES[status.id].badge}`} />
                            {status.label}
                          </span>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor={`platform-notes-${platform.id}`}
                  className="text-xs font-medium text-muted-foreground uppercase tracking-wide"
                >
                  Notes
                </label>
                <textarea
                  id={`platform-notes-${platform.id}`}
                  value={currentNotes}
                  onChange={(e) => onNotesChange?.(platform.id, e.target.value)}
                  placeholder={`Notes for ${PLATFORM_LABELS[platform.id]}…`}
                  rows={2}
                  className="border-input bg-transparent text-sm text-foreground leading-relaxed resize-none rounded-md border px-3 py-2 outline-none placeholder:text-muted-foreground focus:ring-[3px] focus:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
