"use client";

import { useRef, useState } from "react";
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
import { ImagePlus, X } from "lucide-react";

const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2 MB

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export interface PlatformVariantsProps {
  statuses?: PlatformStatusMap;
  notes?: Partial<Record<PlatformId, string>>;
  screenshots?: Partial<Record<PlatformId, string>>;
  onStatusChange?: (platform: PlatformId, value: StatusId | undefined) => void;
  onNotesChange?: (platform: PlatformId, value: string) => void;
  onScreenshotChange?: (platform: PlatformId, value: string | undefined) => void;
  onZoomShot?: (platform: PlatformId) => void;
}

export function PlatformVariants({
  statuses = {},
  notes = {},
  screenshots = {},
  onStatusChange,
  onNotesChange,
  onScreenshotChange,
  onZoomShot,
}: PlatformVariantsProps) {
  const [activeTab, setActiveTab] = useState<PlatformId>(PLATFORMS[0].id);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const currentStatus = statuses[activeTab];
  const currentNotes = notes[activeTab] ?? "";
  const currentScreenshot = screenshots[activeTab];

  async function handleFile(file: File) {
    if (!file.type.startsWith("image/")) return;
    if (file.size > MAX_FILE_SIZE) return;
    const dataUrl = await readFileAsDataUrl(file);
    onScreenshotChange?.(activeTab, dataUrl);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) void handleFile(file);
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

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
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Screenshot
          </label>
          {currentScreenshot ? (
            <div className="relative group">
              <img
                src={currentScreenshot}
                alt={`Screenshot for ${PLATFORM_LABELS[activeTab]}`}
                className={`max-h-40 w-full object-contain rounded-md border border-border ${onZoomShot ? "cursor-zoom-in" : ""}`}
                onClick={onZoomShot ? () => onZoomShot(activeTab) : undefined}
              />
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-1 right-1 size-6 opacity-0 group-hover:opacity-100 transition-opacity bg-background/80 cursor-pointer"
                aria-label="Remove screenshot"
                onClick={() => onScreenshotChange?.(activeTab, undefined)}
              >
                <X className="size-3.5" />
              </Button>
            </div>
          ) : (
            <div
              role="button"
              tabIndex={0}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              className={`flex flex-col items-center justify-center gap-1.5 rounded-md border border-dashed px-3 py-4 text-xs text-muted-foreground cursor-pointer transition-colors ${
                dragOver
                  ? "border-foreground bg-muted"
                  : "border-border hover:border-muted-foreground"
              }`}
            >
              <ImagePlus className="size-5" />
              <span>Drop an image or click to upload</span>
              <span className="text-[10px]">Max 2 MB</span>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileInput}
          />
        </div>
      </div>
    </div>
  );
}
