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
import type { PlatformImagesMap, PlatformStatusMap } from "@/lib/data/types";
import type { StatusId } from "@/lib/config/statuses";
import { STATUSES } from "@/lib/config/statuses";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ImagePlus, X } from "lucide-react";

export interface PlatformVariantsProps {
  statuses?: PlatformStatusMap;
  notes?: Partial<Record<PlatformId, string>>;
  images?: PlatformImagesMap;
  onStatusChange?: (platform: PlatformId, value: StatusId | undefined) => void;
  onNotesChange?: (platform: PlatformId, value: string) => void;
  onImageChange?: (platform: PlatformId, value: string | undefined) => void;
}

export function PlatformVariants({
  statuses = {},
  notes = {},
  images = {},
  onStatusChange,
  onNotesChange,
  onImageChange,
}: PlatformVariantsProps) {
  const [activeTab, setActiveTab] = useState<PlatformId>(PLATFORMS[0].id);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const currentStatus = statuses[activeTab];
  const currentNotes = notes[activeTab] ?? "";
  const currentImage =
    typeof images[activeTab] === "string" && images[activeTab]!.startsWith("data:image/")
      ? images[activeTab]
      : undefined;

  function readFileAsDataUrl(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result;
      if (typeof result === "string" && result.startsWith("data:image/")) {
        onImageChange?.(activeTab, result);
      }
    };
    reader.readAsDataURL(file);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith("image/")) {
      readFileAsDataUrl(file);
    }
    // Reset input so the same file can be re-selected
    e.target.value = "";
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setIsDragging(false);
    }
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith("image/")) {
      readFileAsDataUrl(file);
    }
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
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Screenshot
          </label>
          {currentImage ? (
            <div className="relative group rounded-md overflow-hidden border border-border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={currentImage}
                alt={`Screenshot for ${PLATFORM_LABELS[activeTab]}`}
                className="w-full object-contain max-h-48"
              />
              <button
                type="button"
                onClick={() => onImageChange?.(activeTab, undefined)}
                aria-label={`Remove screenshot for ${PLATFORM_LABELS[activeTab]}`}
                className="absolute top-1.5 right-1.5 rounded-full bg-background/80 p-0.5 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-background"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ) : (
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`flex flex-col items-center justify-center gap-2 rounded-md border border-dashed px-3 py-5 text-xs text-muted-foreground transition-colors cursor-pointer ${
                isDragging
                  ? "border-foreground bg-muted/50 text-foreground"
                  : "border-border hover:border-foreground/50 hover:bg-muted/30"
              }`}
              onClick={() => fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
              aria-label={`Upload screenshot for ${PLATFORM_LABELS[activeTab]}`}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
            >
              <ImagePlus className="size-5 shrink-0" />
              <span className="text-center leading-snug">
                Drag &amp; drop or{" "}
                <span className="underline underline-offset-2">choose a file</span>
              </span>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
            aria-label={`File input for ${PLATFORM_LABELS[activeTab]} screenshot`}
          />
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
