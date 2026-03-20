"use client";

import { useState } from "react";
import type { PlatformId } from "@/lib/config/platforms";
import { PLATFORMS } from "@/lib/config/platforms";
import { PLATFORM_DOT_STYLES, PLATFORM_LABELS } from "@/components/graph/nodes/node-styles";

export interface PlatformVariantsProps {
  notes?: Partial<Record<PlatformId, string>>;
  onNotesChange?: (platform: PlatformId, value: string) => void;
}

export function PlatformVariants({ notes = {}, onNotesChange }: PlatformVariantsProps) {
  const [activeTab, setActiveTab] = useState<PlatformId>(PLATFORMS[0].id);

  return (
    <div className="flex flex-col gap-3">
      <div role="tablist" className="flex border-b border-border">
        {PLATFORMS.map((p) => (
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
            <span className={`w-2 h-2 rounded-full ${PLATFORM_DOT_STYLES[p.id]}`} />
            {PLATFORM_LABELS[p.id]}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="flex flex-col gap-3">
        <div className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
          Screenshot — upload coming soon
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
            value={notes[activeTab] ?? ""}
            onChange={(e) => onNotesChange?.(activeTab, e.target.value)}
            placeholder={`Notes for ${PLATFORM_LABELS[activeTab]}…`}
            rows={3}
            className="border-input bg-transparent text-sm text-foreground leading-relaxed resize-none rounded-md border px-3 py-2 shadow-xs outline-none placeholder:text-muted-foreground focus:ring-[3px] focus:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>
      </div>
    </div>
  );
}
