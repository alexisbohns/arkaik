"use client";

import { useState } from "react";
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

export interface PlatformVariantsProps {
  statuses?: PlatformStatusMap;
  notes?: Partial<Record<PlatformId, string>>;
  onStatusChange?: (platform: PlatformId, value: StatusId | undefined) => void;
  onNotesChange?: (platform: PlatformId, value: string) => void;
}

export function PlatformVariants({
  statuses = {},
  notes = {},
  onStatusChange,
  onNotesChange,
}: PlatformVariantsProps) {
  const [activeTab, setActiveTab] = useState<PlatformId>(PLATFORMS[0].id);
  const currentStatus = statuses[activeTab];
  const currentNotes = notes[activeTab] ?? "";

  return (
    <div className="flex flex-col gap-3">
      <div role="tablist" className="flex border-b border-border">
        {PLATFORMS.map((p) => {
          const PlatformIcon = PLATFORM_ICONS[p.id];

          return (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={p.id === activeTab}
              onClick={() => setActiveTab(p.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors border-b-2 -mb-px ${
                p.id === activeTab
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <PlatformIcon className="size-3.5" />
              {PLATFORM_LABELS[p.id]}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Status
          </label>
          <Select
            value={currentStatus ?? ""}
            onValueChange={(value) => {
              if (value === "unset") {
                onStatusChange?.(activeTab, undefined);
              } else {
                onStatusChange?.(activeTab, value as StatusId);
              }
            }}
          >
            <SelectTrigger aria-label={`Status for ${PLATFORM_LABELS[activeTab]}`}>
              <SelectValue placeholder="No status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unset">
                <span className="text-muted-foreground">No status</span>
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
            htmlFor={`platform-notes-${activeTab}`}
            className="text-xs font-medium text-muted-foreground uppercase tracking-wide"
          >
            Notes
          </label>
          <textarea
            id={`platform-notes-${activeTab}`}
            value={currentNotes}
            onChange={(e) => onNotesChange?.(activeTab, e.target.value)}
            placeholder={`Notes for ${PLATFORM_LABELS[activeTab]}…`}
            rows={3}
            className="border-input bg-transparent text-sm text-foreground leading-relaxed resize-none rounded-md border px-3 py-2 outline-none placeholder:text-muted-foreground focus:ring-[3px] focus:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>
      </div>
    </div>
  );
}
